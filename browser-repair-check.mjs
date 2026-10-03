/*
 * Repair verification in an isolated browser (R1 runner model).
 *
 * Launches its own disposable headless Chrome (throwaway profile), serves
 * index.html from disk on an ephemeral port, and exercises the reviewed
 * failure modes with real pointer input. Exits nonzero on failure.
 * Evidence: shots/repair-pass5/*.png plus console PASS/FAIL lines (the
 * pass-1 and pass-2 shots/repair trees stay untouched as history).
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
/* V02: dependency-free PNG decode so the DOWNLOADED artifact can be
   inspected pixel-by-pixel in the runner, not just on the page.
   Q01: the decoder is the one shared reader (tests/png.cjs); the pass-3
   local copy computed the Paeth distance to c as a + c - 2b, so its
   pixel statistics on Paeth-filtered screenshots were untrustworthy. */
import { pngDecode } from "./tests/png.cjs";
/* Ink = pixels that differ from the dominant corner color (the artifact's
   own background). frame counts ink in the 2px border band: nonzero means
   the content was clipped by the canvas. */
function pngInk(img) {
  const { w, h, px } = img;
  const at = (x, y) => (y * w + x) * 4;
  /* V02: the background is the dominant quantized color of the whole
     image — corners alone sit inside rounded-rect notches and anti-
     aliasing, which misjudges an opaque white canvas as translucent. */
  const counts = new Map();
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      const i = at(x, y);
      const k = (px[i] >> 4) + "," + (px[i + 1] >> 4) + "," + (px[i + 2] >> 4) + "," + (px[i + 3] >> 6);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  const bg = [(top[0] << 4) + 8, (top[1] << 4) + 8, (top[2] << 4) + 8, (top[3] << 6) + 32];
  let ink = 0, frame = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = at(x, y);
      const isBg =
        Math.abs(px[i] - bg[0]) <= 16 &&
        Math.abs(px[i + 1] - bg[1]) <= 16 &&
        Math.abs(px[i + 2] - bg[2]) <= 16 &&
        Math.abs(px[i + 3] - bg[3]) <= 40;
      if (!isBg) {
        ink++;
        if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) frame++;
      }
    }
  }
  return { w, h, ink, frame, bg };
}

const here = path.dirname(fileURLToPath(import.meta.url));
/* Q02: pass-4 evidence lives under shots/repair-pass5/; the pass-1..3
   trees stay untouched as history. */
const outDir = path.join(here, "shots", "repair-pass6");
fs.mkdirSync(outDir, { recursive: true });

const fails = [];
const pass = (what) => console.log("PASS " + what);
const bad = (what, detail) => {
  console.log("FAIL " + what + (detail ? " — " + detail : ""));
  fails.push(what);
};
const assert = (cond, what, detail) => (cond ? pass(what) : bad(what, detail));

let browser = null, server = null, profile = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const c = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  return null;
}

class Page {
  constructor(wsUrl) {
    this.pending = new Map();
    this.id = 0;
    this.ws = new WebSocket(wsUrl);
  }
  async open() {
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", () => rej(new Error("ws failed")), { once: true });
    });
    this.ws.addEventListener("message", (d) => {
      const m = JSON.parse(String(d.data));
      if (m.method === "Inspector.targetCrashed") {
        for (const p of this.pending.values()) p.rej(new Error("target crashed"));
        this.pending.clear();
        return;
      }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    return this;
  }
  send(method, params = {}, timeoutMs = 45000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error("CDP request timed out after " + timeoutMs + "ms: " + method));
      }, timeoutMs);
      this.pending.set(id, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); },
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        rej(e);
      }
    });
  }
  async eval(expr) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("page error in [" + expr.slice(0, 160) + "] : " + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  }
  fire(expr) {
    return this.send("Runtime.evaluate", { expression: expr, awaitPromise: false });
  }
  async shot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outDir, file), Buffer.from(r.data, "base64"));
  }
  async mouse(x, y, type, button = "left", clicks = 1) {
    await this.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button,
      /* the CDP parameter is clickCount - a wrong name silently disabled
         click synthesis for every synthesized mouse click */
      clickCount: clicks,
      pointerType: "mouse",
    });
  }
  async drag(from, to, steps = 8, midAction = null) {
    await this.mouse(from.x, from.y, "mousePressed");
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await this.mouse(x, y, "mouseMoved");
      if (midAction && i === Math.floor(steps / 2)) await midAction();
    }
    await this.mouse(to.x, to.y, "mouseReleased");
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

try {
  const bin = findChrome();
  if (!bin) throw new Error("no Chrome binary (set CHROME_PATH)");
  const port = await new Promise((res) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(here, "index.html")));
    });
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; server = s; res(p); });
  });
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "openchart-repair-"));
  browser = spawn(bin, [
    "--headless=new", "--no-sandbox", "--remote-debugging-port=0",
    "--user-data-dir=" + profile, "--no-first-run", "--window-size=1440,900",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let buf = "";
  const re = new RegExp("DevTools listening on (ws://\\S+)");
  const wsUrl = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("browser did not start")), 20000);
    browser.stderr.on("data", (d) => {
      buf += String(d);
      const m = re.exec(buf);
      if (m) { clearTimeout(t); res(m[1]); }
    });
  });
  const dbgPort = Number(new URL(wsUrl.replace("ws://", "http://").split("/devtools")[0]).port);
  const put = await fetch("http://127.0.0.1:" + dbgPort + "/json/new?" + encodeURIComponent("http://127.0.0.1:" + port + "/"), { method: "PUT" });
  const target = await put.json();
  const page = await new Page(target.webSocketDebuggerUrl).open();
  const waitReady = async () => {
    for (let i = 0; i < 100; i++) {
      if (await page.eval("(function(){const s=document.querySelector('#stage');return !!s && s.children.length>0 && document.fonts.status==='loaded';})()").catch(() => false)) return;
      await sleep(120);
    }
    throw new Error("page not ready");
  };
  await waitReady();
  /* Q02: the runner owns its fixtures. The default template is cleared so
     regression scenes never mix with — or inherit state from — the demo
     flowchart; every scene records the document identity it runs against
     and the viewport it runs in. */
  await page.eval(
    "(function(){ buildTemplate('__isolated__'); state.title='Repair fixture'; })()",
  );
  /* Build a scene: a→b edge with a label, a blocker below the line, an
     overlapping second shape for rebuild/stacking checks. */
  await page.eval("(function(){"
    + "window.nA=makeNode('rect',100,100);nA.text='Alpha';window.a2=makeNode('rect',700,300);a2.text='Beta';"
    + "window.b2=makeNode('rect',900,280);b2.text='Gamma';b2.fill='#fca5a5';"
    + "b2.x=760;b2.y=330;" /* overlap a2 */
    + "window.c2=makeNode('rect',250,220);c2.text='Blocker';"
    + "window.labeled=makeEdge(nA.id,a2.id);labeled.label='Yes';"
    + "makeEdge(a2.id,b2.id);"
    + "routeAll();state.sel=new Set([labeled.id]);render();"
    + "})()");
  await sleep(250);
  /* Pointer events arrive in viewport coordinates while the app reads
     them relative to the stage, so offset every canvas-space target. */
  /* Q02: record the loaded identity and the viewport for every scene.
     Evidence ties each result to a specific document shape and window. */
  const recordScene = async (name) => {
    const ident = JSON.parse(
      await page.eval(
        "(function(){ return JSON.stringify({ title: state.title, nodes: Object.keys(state.nodes).length, edges: Object.keys(state.edges).length, sel: state.sel.size, view: { x: Math.round(view.x), y: Math.round(view.y), z: +view.z.toFixed(3) }, viewport: innerWidth + 'x' + innerHeight }); })()",
      ),
    );
    console.log(
      "SCENE " + name + ": identity nodes=" + ident.nodes + " edges=" + ident.edges +
        " sel=" + ident.sel + " view=" + JSON.stringify(ident.view) +
        " viewport=" + ident.viewport,
    );
    return ident;
  };
  const baseScene = await recordScene("fixture");
  assert(
    baseScene.nodes === 4 && baseScene.edges === 2,
    "scene isolation: the fixture stands on an empty document, not the template",
    JSON.stringify(baseScene),
  );
    const stageOff = JSON.parse(await page.eval("(function(){ const r=document.querySelector('#stage').getBoundingClientRect(); return JSON.stringify({x:r.left,y:r.top}); })()"));
  const pg = (local) => ({ x: local.x + stageOff.x, y: local.y + stageOff.y });

  /* R3 — mixed cached/rebuilt stacking. */
  {
    const order = () => page.eval("JSON.stringify([...document.querySelector('#viewport').children].map(x=>x.getAttribute('data-node')?('n'+x.getAttribute('data-node').slice(0,4)):('e'+(x.getAttribute('data-edge')||'').slice(0,4))))");
    const before = await order();
    await page.eval("(function(){ b2.fill='#93c5fd'; render(); })()");
    const afterRebuild = await order();
    assert(before === afterRebuild, "R3: rebuild keeps document order");
    const dup = await page.eval("(function(){ const kids=[...document.querySelector('#viewport').children].map(x=>x.getAttribute('data-node')||x.getAttribute('data-edge')); return new Set(kids).size !== kids.length; })()");
    assert(!dup, "R3: no duplicate live groups");
    /* selection-driven edge rebuild must not reorder either */
    await page.eval("(function(){ state.sel=new Set(['e:'+labeled.id]); render(); })()");
    assert((await order()) === before, "R3: selection rebuild keeps order");
    await page.eval("(function(){ state.sel.clear(); render(); })()");
  }

  /* R2 — multi-frame segment drag with pointer input. */
  {
    await page.eval("(function(){ edge=labeled; labeled.waypoints=[{x:250,y:150}]; state.sel=new Set(['e:'+labeled.id]); routeAll(); render(); })()");
    /* S01: locate the editable segment geometrically (the longest horizontal
       corridor between the ports), never by hard-coded handle index. */
    const handle = await page.eval("(function(){ const pts=editableRoutePoints(labeled); let best=-1, bestLen=0; for (let i=1;i<pts.length-2;i++){ const a=pts[i], b=pts[i+1]; if (a.y!==b.y) continue; const len=Math.abs(b.x-a.x); if (len>bestLen){ bestLen=len; best=i; } } if (best<0) return { none:true }; const h=document.querySelector(\'[data-segment=\"\'+best+\'\"]\'); if (!h) return { none:true }; const r=h.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2, seg:{ y:pts[best].y, x0:Math.min(pts[best].x,pts[best+1].x), x1:Math.max(pts[best].x,pts[best+1].x) } }; })()");
    assert(handle && !handle.none, "R2: segment handle present for the located corridor", handle && handle.none ? "no horizontal editable segment" : "");
    if (handle && !handle.none) {
      const seg = handle.seg;
      await page.mouse(handle.x, handle.y, "mousePressed");
      await page.mouse(handle.x, handle.y + 20, "mouseMoved");
      await sleep(60); /* let a frame render */
      const mid = await page.eval("JSON.stringify(routeEdge(labeled).pts)");
      await page.mouse(handle.x, handle.y + 40, "mouseMoved");
      await sleep(60);
      const late = await page.eval("JSON.stringify(routeEdge(labeled).pts)");
      await page.mouse(handle.x, handle.y + 40, "mouseReleased");
      await sleep(80);
      const done = await page.eval("(function(){ return JSON.stringify({wp:labeled.waypoints, pts:routeEdge(labeled).pts}); })()");
      const inSpan = (q) => q.x >= seg.x0 - 1 && q.x <= seg.x1 + 1;
      assert(
        JSON.parse(mid).some((p) => Math.abs(p.y - (seg.y + 20)) < 6 && inSpan(p)),
        "R2: painted route follows the first drag frame",
        mid,
      );
      assert(
        JSON.parse(late).some((p) => Math.abs(p.y - (seg.y + 40)) < 6 && inSpan(p)),
        "R2: painted route follows the second frame",
        late,
      );
      const d = JSON.parse(done);
      assert(
        d.wp.some((p) => Math.abs(p.y - (seg.y + 40)) < 6),
        "R2: committed waypoints match the drag",
      );
      await page.shot("R2-segment-drag.png");
    }
    await page.eval("(function(){ delete labeled.waypoints; labeled.labelAuto=undefined; routeAll(); state.sel.clear(); render(); })()");
  }

  /* R4 — unrelated blocker dragged across the line. */
  {
    /* a clean straight corridor: nA(100,100) to a2(700,100) runs flat */
    await page.eval("(function(){ nA.x=100;nA.y=100;a2.x=700;a2.y=100;const n=state.nodes[c2.id]; n.x=250;n.y=220; routesDirty=true; routeAll(); render(); })()");
    const pristine = await page.eval("routeEdge(labeled).pts.length");
    assert(pristine === 2, "R4: the clean corridor is a straight route", "pts=" + pristine);
    /* press inside the blocker, well clear of the connector line */
    const grab = await page.eval("w2s(320,250)");
    const drop = await page.eval("w2s(320,130)");
    let midPts = null;
    await page.drag(pg({ x: grab.x, y: grab.y }), pg({ x: drop.x, y: drop.y }), 10, async () => {
      midPts = await page.eval("JSON.stringify(routeEdge(labeled).pts)");
    });
    await sleep(120);
    const settled = await page.eval("(function(){ const n=state.nodes[c2.id]; return JSON.stringify({ r: routeEdge(labeled).pts, cx:n.x, cy:n.y }); })()");
    const st = JSON.parse(settled);
    assert(Math.abs(st.cx - 250) < 1.01 && Math.abs(st.cy - 100) < 1.01, "R4: the blocker landed across the line", settled);
    const inside = (pts, pad) => pts.some((p) => p.x > st.cx + pad && p.x < st.cx + 140 - pad && p.y > st.cy + pad && p.y < st.cy + 56 - pad);
    assert(midPts && !inside(JSON.parse(midPts), 4), "R4: live route avoids the blocker mid-drag", midPts);
    assert(!inside(st.r, 4), "R4: committed route avoids the blocker", JSON.stringify(st.r));
    /* drag it back out: grab above the line, drop back at the start */
    const grab2 = await page.eval("w2s(320,110)");
    const drop2 = await page.eval("w2s(320,230)");
    await page.drag(pg({ x: grab2.x, y: grab2.y }), pg({ x: drop2.x, y: drop2.y }), 10);
    await sleep(120);
    const freed = await page.eval("routeEdge(labeled).pts.length");
    assert(freed === pristine, "R4: corridor frees after the blocker leaves", "pts=" + freed + " pristine=" + pristine);
    await page.shot("R4-blocker.png");
    await page.eval("(function(){ const n=state.nodes[c2.id]; n.x=1000;n.y=520; routesDirty=true; routeAll(); render(); })()");
  }
  /* R5 — tidy preview vs apply equality (the 200/80 reproduction). */
  {
    await page.eval("(function(){"
      + "nA.x=30;nA.y=100;nA.w=200;nA.h=80;a2.x=600;a2.y=100;a2.w=80;a2.h=80;"
      + "state.sel=new Set([nA.id,a2.id]);routeAll();render();refreshProps();"
      + "tidyOpts.dir='lr';tidyOpts.gap=56;tidyOpts.normalize=true;"
      + "tidyPreview=makeTidyProposal();renderOverlay();" /* S05 proposal */
      + "})()");
    const plan = await page.eval("JSON.stringify(tidyPreview.targets)");
    await page.eval("(function(){ applyTidy(tidyPreview.targets); tidyPreview=null; routeAll(); render(); })()");
    await sleep(150);
    const bpos = await page.eval("(function(){ const n=state.nodes[a2.id]; return JSON.stringify({x:n.x,w:n.w,gap:n.x-(state.nodes[nA.id].x+state.nodes[nA.id].w)}); })()");
    const p = JSON.parse(bpos);
    const bid = await page.eval("a2.id");
    const planB = JSON.parse(plan).find((d) => d.id === bid);
    assert(planB && Math.abs(planB.x - 286) < 0.51 && planB.w === 200, "R5: preview plans B at x=286 w=200", plan);
    assert(Math.abs(p.x - 286) < 0.51 && p.w === 200 && Math.abs(p.gap - 56) < 0.51, "R5: applied rectangle equals the preview", bpos);
    await page.shot("R5-tidy.png");
    await page.eval("(function(){ nA.x=30;nA.y=72;nA.w=140;nA.h=56;a2.x=330;a2.y=72;a2.w=140;a2.h=56; routesDirty=true; routeAll(); render(); })()");
  }

  /* R6 — document font change repaints existing text. */
  {
    const before = await page.eval("(function(){ const t=document.querySelector('#viewport text'); return t ? t.getAttribute('font-family') : null; })()");
    await page.eval("(function(){ typography().fontFamily='Georgia, serif'; appearanceRev++; routesDirty=true; render(); })()");
    await sleep(150);
    const after = await page.eval("(function(){ return JSON.stringify([...document.querySelectorAll('#viewport text')].map(t=>t.getAttribute('font-family')).filter(Boolean).slice(0,3)); })()");
    assert(before && before.includes("Arial"), "R6: text starts on the default font", before);
    assert(JSON.parse(after).length > 0 && JSON.parse(after).every((f) => f.includes("Georgia")), "R6: font change repaints existing text", after);
    await page.eval("(function(){ typography().fontFamily='Arial, sans-serif'; appearanceRev++; routesDirty=true; render(); })()");
  }

  /* R7 — connector-only selection export. */
  {
    await page.eval("(function(){ state.sel=new Set(['e:'+labeled.id]); routeAll(); render(); })()");
    const items = await page.eval("JSON.stringify(exportSelectionItems().map(o=>o.src!==undefined?'e':'n'+o.id))");
    assert(JSON.parse(items).length === 1 && JSON.parse(items)[0] === "e", "R7: connector-only selection exports the connector", items);
    const svg = await page.eval("(function(){ const s=buildExportSVG(false,{scope:'selection',margin:16}); return s; })()");
    assert(svg.includes("data-edge") && !svg.includes("data-node"), "R7: connector-only SVG contains only the connector");
    fs.writeFileSync(path.join(outDir, "R7-connector-only.svg"), svg);
    /* empty state + disabled downloads */
    await page.eval("(function(){ state.sel.clear(); openExportDialog(); document.querySelector('input[name=export-scope][value=all]').checked=false; document.querySelector('input[name=export-scope][value=selection]').checked=true; refreshExportPreview(); })()");
    await sleep(200);
    const disabled = await page.eval("$('#export-do-svg').disabled && $('#export-do-png').disabled && $('#export-do-pdf').disabled");
    const note = await page.eval("(function(){ return document.querySelector('#export-preview').innerHTML.includes('Nothing selected'); })()");
    assert(disabled && note, "R7: empty selection shows the explicit state and disables downloads");
    await page.shot("R7-empty-state.png");
    /* artifact check: the exact SVG that downloads, rasterized and judged
       on NON-BACKGROUND pixels (V02). An alpha-only count would pass an
       opaque blank canvas, so two blank controls must both fail here. */
    await page.eval("(function(){ state.sel=new Set([nA.id,a2.id,'e:'+labeled.id]); document.querySelector('input[name=export-scope][value=all]').checked=true; refreshExportPreview(); })()");
    await sleep(200);
    const dl = await page.eval("(function(){ const o=exportOptions(); return buildExportSVG(o.transparent,o); })()");
    fs.writeFileSync(path.join(outDir, "R7-download.svg"), dl);
    await page.eval("(function(){"
      + "window.__ocInkStats = async function(svgText, scale){"
      + "  const {canvas} = await rasterizeSVG(svgText, scale);"
      + "  const d = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;"
      + "  const W=canvas.width, H=canvas.height;"
      + "  const at=(x,y)=>{const i=(y*W+x)*4; return [d[i],d[i+1],d[i+2],d[i+3]];"
      + "  };"
      + "  const counts={};"
      + "  for (let y=0;y<H;y+=4) for (let x=0;x<W;x+=4){ const i=(y*W+x)*4; const k=(d[i]>>4)+','+(d[i+1]>>4)+','+(d[i+2]>>4)+','+(d[i+3]>>6); counts[k]=(counts[k]||0)+1; }"
      + "  const top=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];})[0].split(',').map(Number);"
      + "  const bg=[(top[0]<<4)+8,(top[1]<<4)+8,(top[2]<<4)+8,(top[3]<<6)+32];"
      + "  const isBg=function(i){ return Math.abs(d[i]-bg[0])<=16 && Math.abs(d[i+1]-bg[1])<=16 && Math.abs(d[i+2]-bg[2])<=16 && Math.abs(d[i+3]-bg[3])<=40; };"
      + "  let ink=0, frame=0;"
      + "  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const i=(y*W+x)*4; if(!isBg(i)){ ink++; if(x<2||y<2||x>=W-2||y>=H-2) frame++; } }"
      + "  return {w:W,h:H,ink:ink,frame:frame,bg:bg};"
      + "};"
      + "})()");
    const rast = await page.eval("(async function(){ return JSON.stringify(await __ocInkStats(buildExportSVG(false, exportOptions()), 2)); })()");
    const rr = JSON.parse(rast);
    assert(rr.ink > 500, "V02: PNG artifact rasterizes with non-background content", rast);
    assert(rr.frame <= 2 * rr.w + 2 * rr.h, "V02: the artifact's ink stays off the canvas frame (no clipping beyond a 1px raster fringe)", "frameInk=" + rr.frame);
    const blankSvg = String.fromCharCode(60) + "svg xmlns=" + String.fromCharCode(39) + "http://www.w3.org/2000/svg" + String.fromCharCode(39) + " width=" + String.fromCharCode(39) + "400" + String.fromCharCode(39) + " height=" + String.fromCharCode(39) + "300" + String.fromCharCode(39) + "></svg>";
    const blankT = JSON.parse(await page.eval("(async function(){ return JSON.stringify(await __ocInkStats(" + JSON.stringify(blankSvg) + ", 2)); })()"));
    assert(blankT.ink < 100, "V02: transparent-blank control fails the ink check", JSON.stringify(blankT));
    const whiteSvg = String.fromCharCode(60) + "svg xmlns=" + String.fromCharCode(39) + "http://www.w3.org/2000/svg" + String.fromCharCode(39) + " width=" + String.fromCharCode(39) + "400" + String.fromCharCode(39) + " height=" + String.fromCharCode(39) + "300" + String.fromCharCode(39) + String.fromCharCode(62) + "<rect width=" + String.fromCharCode(39) + "400" + String.fromCharCode(39) + " height=" + String.fromCharCode(39) + "300" + String.fromCharCode(39) + " fill=" + String.fromCharCode(39) + "%23ffffff" + String.fromCharCode(39) + "/></svg>";
    const blankW = JSON.parse(await page.eval("(async function(){ return JSON.stringify(await __ocInkStats(" + JSON.stringify(whiteSvg) + ", 2)); })()"));
assert(blankW.ink < 100, "V02: opaque-white blank control fails the ink check", JSON.stringify(blankW));
    await page.shot("R7-preview.png");
    /* V02: exercise the REAL download buttons through the browser. */
    const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchart-dl-"));
    try {
      await page.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
    } catch (e) {
      await page.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dlDir });
    }
    const waitDownload = async (ext, before) => {
      for (let i = 0; i < 60; i++) {
        await sleep(150);
        const fresh = fs.readdirSync(dlDir).filter((x) => x.endsWith(ext) && !before.has(x));
        if (fresh.length) return path.join(dlDir, fresh[0]);
      }
      return null;
    };
    const listDir = () => new Set(fs.readdirSync(dlDir));
    const resetDir = () => { for (const f of fs.readdirSync(dlDir)) fs.rmSync(path.join(dlDir, f), { force: true }); };
    const clickDownload = async (sel) => {
      try {
        await page.eval(sel + ".click()");
        return null;
      } catch (e) {
        return String(e && e.message || e).slice(0, 300);
      }
    };
    let before = listDir();
    resetDir();
    const svgErr = await clickDownload("$('#export-do-svg')");
    const svgFile = await waitDownload(".svg", listDir());
    assert(svgFile, "V02: clicking Download SVG writes a real file", svgErr);
    if (svgFile) {
      const svgText = fs.readFileSync(svgFile, "utf8");
      assert(svgText.includes("data-node") && svgText.includes("data-edge"), "V02: the downloaded SVG carries shapes and connectors");
      assert(svgText.includes("<text"), "V02: the downloaded SVG carries labels");
      const dr = JSON.parse(await page.eval("(async function(){ return JSON.stringify(await __ocInkStats(" + JSON.stringify(svgText) + ", 2)); })()"));
      assert(dr.ink > 500 && dr.frame <= 2 * dr.w + 2 * dr.h, "V02: the downloaded SVG rasterizes with content and no frame clipping beyond a 1px raster fringe", JSON.stringify(dr));
    }
    /* selection scope: the downloaded file must carry only the selection */
    before = listDir();
    await page.eval("(function(){ state.sel=new Set([nA.id]); openExportDialog(); document.querySelector('input[name=export-scope][value=selection]').checked=true; refreshExportPreview(); })()");
    await sleep(200);
    const scopeState = await page.eval("(function(){ return JSON.stringify({open:document.getElementById('export-dialog').open, dis:document.getElementById('export-do-svg').disabled}); })()");
    resetDir();
    const scopeErr = await clickDownload("$('#export-do-svg')");
    const scopeFile = await waitDownload(".svg", listDir());
    assert(scopeFile, "V02: the scoped SVG download writes a real file", scopeState + " err=" + scopeErr);
    if (scopeFile) {
      const scoped = fs.readFileSync(scopeFile, "utf8");
      const naId = await page.eval("nA.id");
      const a2Id = await page.eval("a2.id");
      assert(scoped.includes('data-node="' + naId + '"'), "V02: the scoped SVG contains the selected shape");
      assert(!scoped.includes('data-node="' + a2Id + '"'), "V02: the scoped SVG excludes unselected shapes");
      assert(!scoped.includes("data-edge"), "V02: the scoped SVG excludes connectors leaving the selection");
    }
    await page.eval("(function(){ state.sel.clear(); })()");
    before = listDir();
    await page.eval("(function(){ openExportDialog(); const r=document.querySelector('input[name=export-scope][value=all]'); if(r) r.checked=true; refreshExportPreview(); })()");
    await sleep(200);
    resetDir();
    const pngErr = await clickDownload("$('#export-do-png')");
    const pngFile = await waitDownload(".png", listDir());
    assert(pngFile, "V02: clicking Download PNG writes a real file", pngErr);
    if (pngFile) {
      const bytes = fs.readFileSync(pngFile);
      const stats = pngInk(pngDecode(bytes));
      assert(stats.w > 200 && stats.h > 200, "V02: the downloaded PNG has real dimensions", JSON.stringify(stats));
      assert(stats.ink > 500, "V02: the downloaded PNG carries non-background content", JSON.stringify(stats));
      assert(stats.frame <= 2 * stats.w + 2 * stats.h, "V02: the downloaded PNG has no frame clipping beyond a 1px raster fringe", JSON.stringify(stats));
      fs.copyFileSync(pngFile, path.join(outDir, "V02-download.png"));
    }

    /* PDF workflow: capture the print document built for the iframe */
    const pdfDoc = await page.eval("(function(){ printPDF(buildExportSVG(false,exportOptions()),'diagram',false,'a4-landscape'); const f=[...document.querySelectorAll('iframe')].pop(); return f ? f.srcdoc.slice(0,400) : null; })()");
    assert(
      pdfDoc && pdfDoc.includes("@page{size:A4 landscape;margin:18pt}"),
      "R7/R9: print document constructed with page setup (PDF output itself is not verified in this environment)",
      pdfDoc,
    );
    await page.eval("(function(){ document.querySelectorAll('iframe').forEach(f=>f.remove()); $('#export-dialog').close(); })()");
  }

  /* R8 — label double-click vs drag with real pointer. */
  {
    /* make sure the export dialog from R7 is gone and nothing is selected */
    await page.eval("(function(){ const d=$('#export-dialog'); if (d && d.open) d.close(); document.querySelectorAll('iframe').forEach(f=>f.remove()); state.sel.clear(); render(); })()");
    await sleep(150);
    const lb = await page.eval("(function(){ const l=[...document.querySelectorAll('[data-label]')].find(x=>x.getAttribute('data-label')===labeled.id); if (!l) return null; const r=l.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()");
    /* the label client rect is already viewport-space: use it directly */
    await page.mouse(lb.x, lb.y, "mousePressed");
    await page.mouse(lb.x, lb.y, "mouseReleased");
    await sleep(120);
    const sel1 = await page.eval("JSON.stringify([...state.sel])");
    assert(sel1 === JSON.stringify(["e:" + (await page.eval("labeled.id"))]), "R8: first label click selects the connector", sel1);
    const auto1 = await page.eval("labeled.labelAuto");
    assert(auto1 !== false, "R8: click keeps the automatic label position");
    await page.mouse(lb.x, lb.y, "mousePressed", "left", 2);
    await page.mouse(lb.x, lb.y, "mouseReleased", "left", 2);
    await sleep(200);
    const editing = await page.eval("!( $('#txtedit').hidden )");
    assert(editing, "R8: double-click opens the label editor");
    await page.eval("(function(){ finishEdit(true); })()");
    const closed = await page.eval('$(' + JSON.stringify('#txtedit') + ').hidden');
    assert(closed, "R8: the editor closes without changing the label");
    await sleep(120);
    /* Q02: reacquire the label rect before the drag — the click and the
       editor round-trip re-rendered the connector, so the rect captured
       before them may no longer cover the label. */
    const lbNow = await page.eval("(function(){ const l=[...document.querySelectorAll('[data-label]')].find(x=>x.getAttribute('data-label')===labeled.id); if (!l) return null; const r=l.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()");
    assert(lbNow, "R8: the connector label is still rendered for the drag");
    await page.mouse(lbNow.x, lbNow.y, "mousePressed");
    await page.mouse(lbNow.x + 20, lbNow.y + 10, "mouseMoved");
    await sleep(60);
    const gkind = await page.eval("gesture && gesture.kind");
    const hit = await page.eval("(function(){ const el=document.elementFromPoint(" + lbNow.x + "," + lbNow.y + "); const n=el && el.closest && el.closest('[data-node]'); return JSON.stringify({ hit: el ? el.tagName : 'none', nodeId: n ? n.getAttribute('data-node') : null, node: n ? (function(){ const o=state.nodes[n.getAttribute('data-node')]; return o ? {x:o.x,y:o.y,w:o.w,h:o.h,type:o.type} : null; })() : null, lb: " + JSON.stringify(lbNow) + ", pts: routeEdge(labeled).pts, label: labeled.label }); })()");
    await page.mouse(lbNow.x + 40, lbNow.y + 20, "mouseReleased");
    await sleep(120);
    assert(gkind === "label", "R8: the label drag engages the label gesture", "gesture=" + gkind + " hit=" + hit);
    await sleep(120);
    const moved = await page.eval("(function(){ return JSON.stringify({auto:labeled.labelAuto,t:labeled.labelT}); })()");
    const mv = JSON.parse(moved);
    assert(mv.auto === false && typeof mv.t === "number", "R8: a real drag pins the label", moved);
    await page.shot("R8-label.png");
    await page.eval("(function(){ undo(); render(); })()");
  }

  /* V02 — pass-3 fixes N01..N07, exercised with real UI input. */
  {
    /* N07: the release coordinates commit (release past the last move). */
    await page.eval("(function(){ state.sel.clear(); gridSnap=false; render(); })()");
    const n7 = await page.eval("(function(){ const n=makeNode('rect',120,520); n.x=120;n.y=520;n.w=140;n.h=56; n.text='N7'; render(); return n.id; })()");
    const p7a = await page.eval("w2s(150,548)");
    const p7b = await page.eval("w2s(190,560)");
    const p7c = await page.eval("w2s(226,584)");
    await page.mouse(pg(p7a).x, pg(p7a).y, "mousePressed");
    await page.mouse(pg(p7b).x, pg(p7b).y, "mouseMoved");
    await sleep(60);
    await page.mouse(pg(p7c).x, pg(p7c).y, "mouseReleased");
    await sleep(150);
    const n7pos = JSON.parse(await page.eval("(function(){ const n=state.nodes[" + JSON.stringify(n7) + "]; return JSON.stringify({x:n.x,y:n.y}); })()"));
    assert(Math.abs(n7pos.x - 196) < 1.01 && Math.abs(n7pos.y - 556) < 1.01, "N07: the release point commits (not the last sampled move)", JSON.stringify(n7pos));
    await page.eval("(function(){ transact(function(){ const n=state.nodes[" + JSON.stringify(n7) + "]; n.x=120;n.y=530; }); render(); })()");

    /* N01: one keypress, one transaction; a mouse press cancels the pending
       nudge run and the armed timer saves nothing more. */
    const n1 = await page.eval("(function(){ const n=makeNode('rect',420,520); n.x=420;n.y=520;n.w=140;n.h=56; n.text='N1'; state.sel=new Set([n.id]); render(); return n.id; })()");
    const h1 = await page.eval("history.length");
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await sleep(80);
    const x1 = await page.eval("state.nodes[" + JSON.stringify(n1) + "].x");
    assert(Math.abs(x1 - 421) < 0.01, "N01: the arrow key nudges exactly one step immediately", "x=" + x1);
    const p1 = await page.eval("w2s(900,700)");
    await page.mouse(pg(p1).x, pg(p1).y, "mousePressed");
    await page.mouse(pg(p1).x, pg(p1).y, "mouseReleased");
    await sleep(550);
    const x2 = await page.eval("state.nodes[" + JSON.stringify(n1) + "].x");
    assert(Math.abs(x2 - 421) < 0.01, "N01: the cancelled nudge run saves nothing more", "x=" + x2);
    assert((await page.eval("history.length")) === h1 + 1, "N01: one keypress is exactly one transaction");

    /* N06: the inspector Size control shows the resolved size. */
    const n6 = await page.eval("(function(){ const n=makeNode('container',700,520); n.text='N6'; state.sel=new Set([n.id]); render(); refreshProps(); return n.id; })()");
    const vals = JSON.parse(await page.eval("(function(){ return JSON.stringify([...document.querySelectorAll('#props input[type=number]')].map(function(i){return i.value;})); })()"));
    assert(vals.map(String).includes("15"), "N06: the container shows its resolved heading size (15)", JSON.stringify(vals));
    await page.eval("(function(){ const i=[...document.querySelectorAll('#props input[type=number]')].find(function(x){return x.value==='15';}); i.value='16'; i.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await sleep(80);
    assert((await page.eval("state.nodes[" + JSON.stringify(n6) + "].fontSize")) === 16, "N06: typing stamps an explicit size override");
    await page.eval("(function(){ const b=[...document.querySelectorAll('#props button')].find(function(x){return x.textContent==='Reset to inherited';}); b.click(); })()");
    await sleep(80);
    assert((await page.eval("state.nodes[" + JSON.stringify(n6) + "].fontSize == null")), "N06: reset-to-inherited clears the explicit stamp");

    /* N05: tidy preview ghosts obey the selection contract. */
    const n5x = await page.eval("(function(){ const n=makeNode('rect',900,300); n.x=900;n.y=300;n.w=140;n.h=56; render(); return n.id; })()");
    const n5y = await page.eval("(function(){ const n=makeNode('rect',900,420); n.x=900;n.y=420;n.w=140;n.h=56; render(); return n.id; })()");
    await page.eval("(function(){ const nA=state.nodes[" + JSON.stringify(n1) + "], nB=state.nodes[" + JSON.stringify(n7) + "], nC=state.nodes[" + JSON.stringify(n5x) + "]; transact(function(){ nA.x=420;nA.y=520; nB.x=150;nB.y=540; nC.x=440;nC.y=640; makeEdge(nA.id,nB.id); makeEdge(nB.id,nC.id); }); routeAll(); render(); state.sel=new Set([" + JSON.stringify(n1) + "," + JSON.stringify(n7) + "," + JSON.stringify(n5x) + "]); refreshProps(); })()");
    const ghostCount = async () => JSON.parse(await page.eval("(function(){ return JSON.stringify([...document.querySelectorAll('#overlay rect')].filter(function(r){return r.getAttribute('stroke-dasharray')==='4 3';}).length); })()"));
    await page.eval("(function(){ const b=[...document.querySelectorAll('#props button')].find(function(x){return x.textContent==='Preview';}); b.click(); })()");
    await sleep(80);
    const g1 = await ghostCount();
    assert(g1 >= 1, "N05: the tidy preview paints ghosts", "ghosts=" + g1);
    await page.eval("(function(){ state.sel=new Set([" + JSON.stringify(n1) + "," + JSON.stringify(n7) + "," + JSON.stringify(n5x) + "," + JSON.stringify(n5y) + "]); renderOverlay(); })()");
    await sleep(150);
    const g2 = await ghostCount();
    assert(g2 === 0, "N05: widening the selection hides the stale ghosts", "ghosts=" + g2);
    const h5 = await page.eval("history.length");
    await page.eval("(function(){ const b=[...document.querySelectorAll('#props button')].find(function(x){return x.textContent==='Apply';}); b.click(); })()");
    await sleep(80);
    assert((await page.eval("history.length")) === h5, "N05: Apply refuses the widened selection");
    assert((await page.eval("!!tidyPreview")), "N05: Apply refreshed the proposal for review");
    await page.eval("(function(){ const b=[...document.querySelectorAll('#props button')].find(function(x){return x.textContent==='Apply';}); b.click(); })()");
    await sleep(80);
    assert((await page.eval("history.length")) === h5 + 1, "N05: the reviewed proposal applies");
    await page.eval("(function(){ const dead=new Set([" + JSON.stringify(n1) + "," + JSON.stringify(n7) + "," + JSON.stringify(n5x) + "," + JSON.stringify(n5y) + "," + JSON.stringify(n6) + "]); transact(function(){ for (const id of dead) { delete state.nodes[id]; state.order=state.order.filter(function(x){return x!==id;}); } for (const id of [...Object.keys(state.edges)]) { const e=state.edges[id]; if (dead.has(e.src)||dead.has(e.dst)) { delete state.edges[id]; state.order=state.order.filter(function(x){return x!==id;}); } } state.sel.clear(); }); routesDirty=true; invalidateGeomCaches(); routeAll(); render(); })()");

    /* N03: a three-point elbow exposes draggable legs. */
    const e3 = JSON.parse(await page.eval("(function(){ const a=makeNode('rect',120,560); a.x=120;a.y=560;a.w=140;a.h=56; const b=makeNode('rect',360,680); b.x=360;b.y=680;b.w=140;b.h=56;window.bId4=b.id; const e=makeEdge(a.id,b.id); e.srcSide='e'; e.dstSide='n'; routeAll(); render(); return JSON.stringify({id:e.id,n:routeEdge(e).pts.length}); })()"));
    assert(e3.n === 3, "N03: the L route has three points", JSON.stringify(e3));
    await page.eval("(function(){ state.sel=new Set(['e:" + e3.id + "']); routeAll(); render(); })()");
    const leg = JSON.parse(await page.eval("(function(){ const e=state.edges[" + JSON.stringify(e3.id) + "]; const ep=editableRoutePoints(e); const h=[...document.querySelectorAll('#overlay [data-segment]')].map(function(x){return x.getAttribute('data-segment');}); return JSON.stringify({ep:ep.length,handles:h}); })()"));
    assert(leg.ep === 5, "N03: the three-point elbow exposes five editable points", JSON.stringify(leg));
    assert(leg.handles.includes("1") && leg.handles.includes("2"), "N03: both split legs render handles", JSON.stringify(leg.handles));
    const h1el = await page.eval("(function(){ const el=document.querySelector('#overlay [data-segment=\"1\"]'); const r=el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()");
    const cornerY = await page.eval("routeEdge(state.edges[" + JSON.stringify(e3.id) + "]).pts[1].y");
    await page.mouse(h1el.x, h1el.y, "mousePressed");
    await page.mouse(h1el.x, h1el.y + 30, "mouseMoved");
    await sleep(60);
    const midHas = await page.eval("(function(){ return routeEdge(state.edges[" + JSON.stringify(e3.id) + "]).pts.some(function(q){return Math.abs(q.y-(" + cornerY + "+30))<6;}); })()");
    await page.mouse(h1el.x, h1el.y + 30, "mouseReleased");
    await sleep(120);
    assert(midHas, "N03: the leg follows the live drag");
    const done = JSON.parse(await page.eval("(function(){ return JSON.stringify(routeEdge(state.edges[" + JSON.stringify(e3.id) + "]).pts); })()"));
    const doneHas = done.some((q) => Math.abs(q.y - (cornerY + 30)) < 6);
    assert(doneHas && done.length >= 5, "N03: the leg commits as a dogleg elbow", JSON.stringify(done));
    await page.shot("N03-elbow.png");
    await page.eval("(function(){ const e=state.edges[" + JSON.stringify(e3.id) + "]; delete e.srcSide; delete e.dstSide; delete e.waypoints; state.sel.clear(); routesDirty=true; routeAll(); render(); })()");

    /* N04: reconnecting an endpoint updates both adjacency families. */
    const n4 = await page.eval("(function(){ const c=makeNode('rect',700,600); c.x=700;c.y=600;c.w=140;c.h=56; c.text='N4'; render(); return c.id; })()");
    await page.eval("(function(){ state.sel=new Set(['e:" + e3.id + "']); routeAll(); render(); })()");
    /* N04: straighten the corridor first so the dst endpoint handle sits
       inside the visible stage (the viewport is 1440x813) */
    await page.eval("(function(){ const b=state.nodes[bId4]; b.x=520;b.y=560; routesDirty=true; routeAll(); render(); state.sel=new Set(['e:" + e3.id + "']); routeAll(); render(); })()");
    const hEnd = await page.eval("(function(){ const el=document.querySelector('#overlay [data-end=\"1\"]'); if(!el) return null; const r=el.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()");
    assert(hEnd, "N04: the endpoint handle is present");
    const cPt = await page.eval("(function(){ const c=state.nodes[" + JSON.stringify(n4) + "]; return w2s(c.x,c.y); })()");
    await page.drag(hEnd, pg(cPt), 8);
    await sleep(150);
    const fam = JSON.parse(await page.eval("(function(){ const e=state.edges[" + JSON.stringify(e3.id) + "]; const m=nodeEdges(); return JSON.stringify({src:e.src,dst:e.dst,a:(m.get(e.src)||[]).some(function(x){return x.id===e.id;}),b:(m.get(e.dst)||[]).some(function(x){return x.id===e.id;})}); })()"));
    assert(fam.dst === n4 && fam.b, "N04: the reconnected endpoint joins the new node's family", JSON.stringify(fam));
    assert(fam.a, "N04: the source family is intact after the reconnect", JSON.stringify(fam));
    await page.shot("N04-reconnect.png");
    await page.eval("(function(){ const e=state.edges[" + JSON.stringify(e3.id) + "]; transact(function(){ e.src=state.nodes[Object.keys(state.nodes)[0]].id; e.dst=" + JSON.stringify(n4) + "; }); state.sel.clear(); routesDirty=true; routeAll(); render(); })()");

    /* N02: a manually placed label survives save and reload. */
    await page.eval("(function(){ state.sel.clear(); routeAll(); render(); })()");
    const labeledId = await page.eval("labeled.id");
    const lb2 = await page.eval("(function(){ const l=[...document.querySelectorAll('[data-label]')].find(function(x){return x.getAttribute('data-label')==='" + labeledId + "'}); if(!l) return null; const r=l.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()");
    await page.drag(lb2, { x: lb2.x + 40, y: lb2.y + 20 }, 6);
    await sleep(120);
    const pinned = JSON.parse(await page.eval("(function(){ const e=state.edges[" + JSON.stringify(labeledId) + "]; return JSON.stringify({auto:e.labelAuto,t:e.labelT}); })()"));
    assert(pinned.auto === false && typeof pinned.t === "number", "N02: the drag pins the label", JSON.stringify(pinned));
    await page.eval("autosave()");
    /* autosave may be debounced: wait until the pinned label is actually
       persisted before reloading, then fail loudly if it never lands */
    let persisted = false;
    for (let i = 0; i < 30 && !persisted; i++) {
      await sleep(150);
      persisted = await page.eval("(function(){ const d=localStorage.getItem('openchart.doc.v1'); return !!d && d.indexOf('\"labelAuto\":false') >= 0; })()");
    }
    assert(persisted, "N02: autosave persists the pinned label", "never landed in localStorage");
    await page.fire("location.reload()");
    await waitReady();
    await sleep(400);
    await recordScene("N02-reload");
    /* look the edge up by id: with the isolated fixture document this is
       the only labeled connector, and the id lookup cannot be ambiguous */
    const afterRaw = JSON.parse(await page.eval("(function(){ const e=state.edges[" + JSON.stringify(labeledId) + "]; return JSON.stringify(e ? {auto:e.labelAuto,t:e.labelT,o:e.labelOff} : null); })()"));
    assert(
      afterRaw && afterRaw.auto === false && typeof afterRaw.t === "number",
      "N02: the pinned label survives save and reload",
      JSON.stringify(afterRaw),
    );
    await page.shot("N02-label-reload.png");
  }

  /* Performance counters: pan/zoom/selection vs drag settle. */
  {
    await recordScene("perf");
    await page.eval("(function(){"
      + "globalThis.__OC_STATS={routeAlls:0,renders:0};"
      + "for(let i=0;i<40;i++) makeNode('rect',1200+(i%8)*90,600+Math.floor(i/8)*80);"
      + "routeAll();render();"
      + "})()");
    const t0r = await page.eval("(function(){ const s=performance.now(); routeAll(); const ms=performance.now()-s; return ms; })()");
    /* pan: view-only frames must not route */
    await page.eval("(function(){ __OC_STATS.routeAlls=0; for(let i=0;i<10;i++){ view.x+=5; requestRenderView(); flushRender(); } })()");
    const panRoutes = await page.eval("__OC_STATS.routeAlls");
    assert(panRoutes === 0, "perf: pan does not route", "routeAlls=" + panRoutes);
    /* zoom: view-only */
    await page.eval("(function(){ __OC_STATS.routeAlls=0; for(let i=0;i<5;i++){ view.z*=1.05; requestRenderView(); flushRender(); } })()");
    const zoomRoutes = await page.eval("__OC_STATS.routeAlls");
    assert(zoomRoutes === 0, "perf: zoom does not route", "routeAlls=" + zoomRoutes);
    /* a drag on the big fixture: settle once */
    const gp = await page.eval("w2s(1240,640)");
    const gq = await page.eval("w2s(1330,700)");
    const t0 = Date.now();
    await page.drag(pg({ x: gp.x, y: gp.y }), pg({ x: gq.x, y: gq.y }), 8);
    await sleep(200);
    const settleMs = Date.now() - t0;
    console.log("PERF routeAll(ms): " + t0r.toFixed(1) + "  drag+settle(ms): " + settleMs);
    await page.shot("PERF-fixture.png");
  }

  /* UX-A pass-4 slice — exercised with real UI input. */
  {
    /* A1: the favorite star is a sibling of the placement button. */
    const starInfo = await page.eval(
      "(function(){ const s=document.querySelector('.fav-star'); if (!s) return null; const cell=s.closest('.pal-cell'); const add=cell && cell.querySelector('.pal-item'); return JSON.stringify({ cell: !!cell, add: !!add, nested: add ? !!add.querySelector('button') : null, sibling: s.parentElement !== add, label: s.getAttribute('aria-label') }); })()",
    );
    /* temporary diagnostic */
    const si = starInfo && JSON.parse(starInfo);
    assert(si && si.cell && si.add, "UX-A: the palette renders favorite cells", starInfo);
    assert(!si.nested, "UX-A: no button is nested inside the placement button");
    assert(si.sibling, "UX-A: the favorite star is a sibling control");
    const starPos = await page.eval(
      "(function(){ const s=document.querySelector('.fav-star'); const r=s.getBoundingClientRect(); return JSON.stringify({x:r.x+4,y:r.y+4}); })()",
    );
    const sp0 = JSON.parse(starPos);
    const favs0 = JSON.parse(await page.eval("JSON.stringify(palettePrefs.favs)"));
    await page.mouse(sp0.x, sp0.y, "mouseMoved");
    /* re-acquire the star rect right before the click: a palette rebuild
       (recents/favorites) replaces the DOM between evaluations */
    const starPos2 = await page.eval(
      "(function(){ const s=document.querySelector('.fav-star'); const r=s.getBoundingClientRect(); return JSON.stringify({x:r.x+4,y:r.y+4}); })()",
    );
    const sp = JSON.parse(starPos2);
    await page.mouse(sp.x, sp.y, "mousePressed");
    await page.mouse(sp.x, sp.y, "mouseReleased");
    await sleep(150);
    const favs1 = JSON.parse(await page.eval("JSON.stringify(palettePrefs.favs)"));
    assert(
      JSON.stringify(favs1) !== JSON.stringify(favs0) && favs1.length === favs0.length + 1,
      "UX-A: the star favorites the shape",
      favs0.length + " -> " + favs1.length,
    );
    /* A1: the introduction is hidden on a nonempty diagram. */
    const intro = await page.eval(
      "document.getElementById('props').textContent.includes('Make room for your ideas')",
    );
    assert(!intro, "UX-A: the introduction is hidden on a nonempty diagram");
    /* A5: the inline label editor matches the document label typography. */
    await page.eval("(function(){ typography().labelSize = 17; render(); })()");
    await page.eval("(function(){ const es = Object.values(state.edges); const e1 = es.find(function(x){ return x.label; }) || es[0]; if (e1 && !e1.label) { e1.label = 'QA'; routesDirty = true; routeAll(); } window.__qaEdge = e1; render(); })()");
    await page.eval("(function(){ openEditor(window.__qaEdge, 'label'); })()");
    const ed = JSON.parse(
      await page.eval(
        "(function(){ const t=$('#txtedit'); return JSON.stringify({ fs: t.style.fontSize, lh: t.style.lineHeight }); })()",
      ),
    );
    const expectFs = JSON.parse(
      await page.eval("(function(){ const qa = window.__qaEdge; return JSON.stringify({ isEdge: qa && qa.src !== undefined, expect: (qa && qa.src !== undefined ? typography().labelSize : nodeFontSize(qa)) * view.z }); })()"),
    );
    /* CSS serializes the style value rounded; compare numerically */
    assert(
      expectFs.isEdge && Math.abs(parseFloat(ed.fs) - expectFs.expect) < 0.05,
      "UX-A: the label editor uses the document label size at view zoom",
      ed.fs + " want " + expectFs.expect.toFixed(3),
    );
    assert(ed.lh === "1.35", "UX-A: the label editor matches the label line height", ed.lh);
    await page.eval("(function(){ finishEdit(true); typography().labelSize = 12; render(); })()");
    await page.shot("UXA-palette.png");
  }

  /* V02: the R01 inspector focus/change/blur journey with real events.
     The scene is rebuilt here because the N02 reload cleared the page. */
  {
    await page.eval(
      "(function(){ state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];view.x=0;view.y=0;view.z=1;" +
        "window.__v2a=makeNode('rect',100,100);__v2a.text='Alpha';routeAll();routesDirty=false;render();refreshProps(); })()",
    );
    await sleep(200);
    await page.eval("(function(){ state.sel=new Set([window.__v2a.id]); render(); refreshProps(); })()");
    await sleep(150);
    const lf = JSON.parse(
      await page.eval(
        "(function(){ const rows=[...document.querySelectorAll('#props .field')].map(function(x){ return [x.children[0]&&x.children[0].textContent, x.children[1]]; }).filter(function(r){ return r[0]==='Label'; }); if (!rows.length) return null; const r=rows[0][1].getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 }); })()",
      ),
    );
    assert(!!lf, "R01 browser: the shape Label field is present", String(lf));
    await page.mouse(lf.x, lf.y, "mousePressed");
    await page.mouse(lf.x, lf.y, "mouseReleased");
    await sleep(100);
    /* select the existing text the way a user would (ctrl+A), then type */
    await page.eval("(function(){ if (document.activeElement && document.activeElement.select) document.activeElement.select(); })()");
    await page.send("Input.insertText", { text: "Browser draft" });
    await sleep(90);
    /* a deliberate canvas press must flush the draft to its target */
    const cp = pg({ x: 900, y: 620 });
    await page.mouse(cp.x, cp.y, "mousePressed");
    await page.mouse(cp.x, cp.y, "mouseReleased");
    await sleep(180);
    const out = JSON.parse(
      await page.eval(
        "(function(){ return JSON.stringify({ t: state.nodes[window.__v2a.id].text, sel: state.sel.size }); })()",
      ),
    );
    assert(
      out.t === "Browser draft",
      "R01 browser: the canvas press flushed the draft to its target",
      JSON.stringify(out),
    );
    await page.shot("V02-r01-flush.png");
  }

  /* V02: the create-and-connect picker journey with real input. */
  {
    await page.eval(
      "(function(){ state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];view.x=0;view.y=0;view.z=1;" +
        "window.__p1=makeNode('rect',200,200);__p1.text='Source';routeAll();routesDirty=false;render(); })()",
    );
    await sleep(200);
    const n0 = JSON.parse(
      await page.eval(
        "JSON.stringify({ n: Object.keys(state.nodes).length, e: Object.keys(state.edges).length })",
      ),
    );
    /* ports render for the hovered shape; hover the source first */
    const hoverP = pg({ x: 270, y: 228 });
    await page.mouse(hoverP.x, hoverP.y, "mouseMoved");
    await sleep(140);
    /* open the picker the way a user does: press a port, drag to empty space */
    const portP = JSON.parse(
      await page.eval(
        "(function(){ const ports=[...document.querySelectorAll('[data-node][data-port]')]; if (!ports.length) return null; const r=ports[0].getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width/2, y: r.y + r.height/2 }); })()",
      ),
    );
    assert(!!portP, "picker journey: a port is reachable", String(portP));
    await page.mouse(portP.x, portP.y, "mousePressed");
    await page.mouse(portP.x + 12, portP.y + 8, "mouseMoved");
    const toP = pg({ x: 620, y: 480 });
    await page.mouse(toP.x, toP.y, "mouseMoved");
    await page.mouse(toP.x, toP.y, "mouseReleased");
    await sleep(180);
    const pk = JSON.parse(
      await page.eval(
        "(function(){ const pkEl=document.querySelector('#shape-picker'); const b=[...pkEl.querySelectorAll('button')]; return JSON.stringify({ open: !pkEl.hidden, focused: b.includes(document.activeElement), pending: !!pendingPicker }); })()",
      ),
    );
    assert(
      pk.open && pk.focused && pk.pending,
      "picker journey: the popup opens with a focused choice",
      JSON.stringify(pk),
    );
    /* initial Enter acts: the highlighted choice is created and connected */
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await sleep(220);
    const made = JSON.parse(
      await page.eval(
        "(function(){ return JSON.stringify({ n: Object.keys(state.nodes).length, e: Object.keys(state.edges).length, closed: document.querySelector('#shape-picker').hidden, linked: Object.values(state.edges).some(function(x){ return x.src === window.__p1.id; }) }); })()",
      ),
    );
    assert(
      made.n === n0.n + 1 && made.e === n0.e + 1 && made.closed && made.linked,
      "picker journey: initial Enter created and connected the shape",
      JSON.stringify({ n0: n0, made: made }),
    );
    await page.shot("V02-picker-created.png");
    await page.eval(
      "(function(){ const ids=Object.keys(state.nodes); state.sel=new Set([ids[ids.length-1]]); deleteSel(); })()",
    );
    await sleep(120);
  }

  /* SPELL: native spell checking reaches the inline editor, honors the
     Settings toggle, and never touches the search fields. */
  {
    await page.eval(
      "(function(){ state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];" +
      "window.__sp=makeNode('rect',300,200);__sp.text='Spelled';routeAll();routesDirty=false;render();editText(__sp); })()",
    );
    await sleep(160);
    const sp = JSON.parse(
      await page.eval(
        "(function(){ const te=document.querySelector('#txtedit'); return JSON.stringify({ open: !te.hidden, prop: te.spellcheck, attr: te.getAttribute('spellcheck') }); })()",
      ),
    );
    assert(
      sp.open && sp.prop === true && sp.attr === "true",
      "SPELL browser: the inline editor spellchecks by default",
      JSON.stringify(sp),
    );
    await page.eval(
      "(function(){ document.querySelector('#pref-spellcheck').click(); })()",
    );
    await sleep(90);
    const sp2 = JSON.parse(
      await page.eval(
        "(function(){ const te=document.querySelector('#txtedit'); return JSON.stringify({ attr: te.getAttribute('spellcheck'), prop: te.spellcheck, stored: localStorage.getItem('openchart.ui.prefs'), title: document.querySelector('#doc-title').getAttribute('spellcheck'), search: document.querySelector('#shape-search').getAttribute('spellcheck') }); })()",
      ),
    );
    assert(
      sp2.attr === "false" && sp2.prop === false && sp2.title === "false" && sp2.search === "false" && JSON.parse(sp2.stored).spellcheck === false,
      "SPELL browser: the Settings toggle turns spelling off, searches stay out",
      JSON.stringify(sp2),
    );
    await page.shot("SPELL-editor.png");
    await page.eval(
      "(function(){ finishEdit(true); document.querySelector('#pref-spellcheck').click(); })()",
    );
    await sleep(90);
  }
  /* S04: staged SVG export - vector files in a ZIP, no raster pass. */
  {
    await page.eval(
      "(function(){ state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];" +
      "window.__s1=makeNode('rect',260,200);__s1.text='First';window.__s2=makeNode('rect',520,200);__s2.text='Second';" +
      "const st=addBuildStage('Intro');assignBuildStage([__s1.id],st);routeAll();routesDirty=false;render(); })()",
    );
    await sleep(160);
    const st = JSON.parse(
      await page.eval(
        "(async function(){ await openSequence(); return JSON.stringify({ stages: sequenceScene.stages.length }); })()",
      ),
    );
    assert(
      st.stages >= 1,
      "S04 browser: build stages exist for the sequence",
      JSON.stringify(st),
    );
    const dl = JSON.parse(
      await page.eval(
        "(async function(){ window.__origDownload=download; download=(n,c,t)=>{window.__dl={name:n,type:t,bytes:c.length};};" +
        "document.querySelector('#sequence-format').value='svg'; await exportSequence();" +
        "return JSON.stringify({ dl: window.__dl, status: document.querySelector('#sequence-status').textContent, pageDisabled: document.querySelector('#sequence-page').disabled }); })()",
      ),
    );
    assert(
      dl.dl && /-build\.zip$/.test(dl.dl.name) && dl.dl.type === "application/zip",
      "S04 browser: staged SVG export downloads a ZIP",
      JSON.stringify(dl),
    );
    assert(
      /Downloaded/.test(dl.status),
      "S04 browser: the export reports success",
      JSON.stringify(dl),
    );
    assert(
      dl.pageDisabled === true,
      "S04 browser: PDF page size is inactive for vector output",
      JSON.stringify(dl),
    );
    await page.eval(
      "(function(){ download=window.__origDownload; document.querySelector('#sequence-dialog').close(); state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];routeAll();routesDirty=false;render(); })()",
    );
    await sleep(120);
  }
  console.log(fails.length ? "BROWSER REPAIR CHECKS FAILED: " + fails.length : "BROWSER REPAIR CHECKS PASSED");
  process.exitCode = fails.length ? 1 : 0;
} catch (e) {
  console.error("BROWSER CHECK ERROR:", e.message);
  process.exitCode = 1;
} finally {
  try { if (browser) browser.kill(); } catch (e) {}
  try { if (server) server.close(); } catch (e) {}
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
}
