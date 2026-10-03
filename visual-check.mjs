/*
 * Visual test matrix runner — isolated by design (repair R1).
 *
 * Launches its own disposable headless Chrome with a throwaway
 * user-data-dir, serves the app from local disk on two ephemeral ports
 * (separate origins, separate localStorage), and creates its own pages.
 * It never touches an existing browser session, any pre-existing tab, or
 * the user's saved diagram. If isolation cannot be established it fails
 * before writing anything.
 *
 * Usage:
 *   node visual-check.mjs                run all fixtures (candidates only)
 *   node visual-check.mjs --approve      promote candidate shots to baselines
 *   node visual-check.mjs --selftest     prove failure detection + cleanup
 *
 * Contract (Q02):
 *   - Missing candidates are runner ERRORS (exit 1), not pending approval.
 *   - Pending baselines print PENDING, never PASS, never join the passed
 *     count, and hold exit code 3.
 *   - Q01: the paint-only negative control and the restoration proof are
 *     judged against THIS RUN's pristine capture; approved baselines never
 *     validate safety controls,
 *     so bootstrap approval still demonstrates detection.
 *   - Failures split into hard (safety/identity/geometry/negative
 *     control/runner errors) and reviewable visual differences.
 *     --approve refuses hard failures; after review it promotes exactly
 *     the current run's candidates and records provenance in
 *     baselines/manifest.json.
 *
 * Requires a Chrome/Chromium binary (CHROME_PATH env or standard locations).
 * Exits nonzero when any check fails.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/* Q02: pass-4 artifacts live under shots/repair-pass5/; the pass-1..3
   trees are preserved untouched as history. */
const matrixDir = path.join(here, "shots", "repair-pass6", "matrix");
const candidatesDir = path.join(matrixDir, "candidates");
const baselinesDir = path.join(matrixDir, "baselines");
const diffsDir = path.join(matrixDir, "diffs");
const APPROVE = process.argv.includes("--approve");
const SELFTEST = process.argv.includes("--selftest");
fs.mkdirSync(candidatesDir, { recursive: true });

const results = [];
/* V01: the manifest of candidates captured by THIS run. --approve promotes
   exactly these files (never stale files left by an earlier run), and only
   when nothing failed. */
const runManifest = new Set();
let serverA = null, serverB = null, browser = null, profileDir = null, debugPort = 0;
let ws = null;

/* ---- V01 C: dependency-free PNG decode/encode + pixel comparison ------
   A screenshot is a visual check only when its decoded pixels are compared
   with an approved baseline under a documented tolerance. Missing baselines
   are reported as pending, never as passes. */
/* Q01: one shared decoder for every runner (see tests/png.cjs). The
   pass-3 local copy computed the Paeth distance to c as a + c - 2b,
   so screenshots whose Paeth rows used the c predictor decoded wrongly. */
import { pngDecode, pngEncode, crc32 } from "./tests/png.cjs";
/* V01: the comparator and the approval policy live in one shared,
   byte-testable module (visual-policy.mjs); the runner consumes typed
   outcomes only - match, pixel-mismatch, dimension-mismatch,
   decode-failure, missing-candidate, pending. */
import {
  comparePixels,
  judgeMutationControl,
  judgeRestoration,
  classify,
  TOL,
  MAX_BAD_FRACTION,
} from "./visual-policy.mjs";
/* Compare one candidate against its approved baseline. Returns a result
   object; a missing baseline is PENDING, never a pass. */
function compareCandidate(name, maskRects = []) {
  const candPath = path.join(candidatesDir, name);
  const basePath = path.join(baselinesDir, name);
  if (!fs.existsSync(candPath)) return { status: "missing-candidate" };
  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(diffsDir, { recursive: true });
    return { status: "pending", reason: "no approved baseline yet" };
  }
  const r = comparePixels(name, fs.readFileSync(candPath), fs.readFileSync(basePath), maskRects);
  if (r.diffPng) {
    fs.mkdirSync(diffsDir, { recursive: true });
    fs.writeFileSync(path.join(diffsDir, "diff-" + name), r.diffPng);
  }
  /* V01: the typed outcome passes through unchanged. */
  return {
    status: r.status,
    reason: r.reason,
    bad: r.bad,
    total: r.total,
  };
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
      this.ws.addEventListener("error", () => rej(new Error("page websocket failed")), { once: true });
    });
    this.ws.addEventListener("message", (d) => {
      const m = JSON.parse(String(d.data));
      if (m.method === "Inspector.targetCrashed") {
        for (const p of this.pending.values()) p.rej(new Error("page target crashed (try --no-sandbox or a different Chrome build)"));
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
  /* V01: every CDP request carries a deadline. A hung page or transport
     fails the run loudly instead of hanging the runner forever. */
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
    const r = await this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw new Error("page error: " + JSON.stringify(r.exceptionDetails).slice(0, 1200));
    return r.result.value;
  }
  /* Fire-and-forget evaluation (used for navigation, which never settles). */
  evalFire(expr) {
    return this.send("Runtime.evaluate", { expression: expr, awaitPromise: false }).then(
      (r) => r.result && r.result.value,
    );
  }
  async shot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(candidatesDir, file), Buffer.from(r.data, "base64"));
    runManifest.add(file);
    return r.data.length;
  }
  close() {
    try { this.ws.close(); } catch (e) {}
  }
}

function fail(msg) {
  throw new Error(msg);
}
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}
function serve(port) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(fs.readFileSync(path.join(here, "index.html")));
    });
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}
const freePort = () =>
  new Promise((res) => {
    const s = http.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

async function launchBrowser() {
  const bin = findChrome();
  if (!bin) fail("No Chrome/Chromium binary found (set CHROME_PATH).");
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "openchart-visual-"));
  browser = spawn(
    bin,
    [
      "--headless=new",
      /* The renderer sandbox cannot start inside restricted CI environments;
         this profile is throwaway and runner-owned, so the standard CI
         workaround applies. */
      "--no-sandbox",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profileDir,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,900",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    const t = setTimeout(() => rej(new Error("browser did not start")), 20000);
    browser.stderr.on("data", (d) => {
      buf += String(d);
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(t);
        res(m[1]);
      }
    });
  });
  debugPort = Number(new URL(wsUrl.replace("ws://", "http://")).port);
  if (!debugPort) fail("cannot determine the isolated browser's debugging port");
}
async function newPage(url) {
  let res;
  try {
    res = await fetch("http://127.0.0.1:" + debugPort + "/json/new?" + encodeURIComponent(url), { method: "PUT" });
    if (res.status === 405 || res.status === 501)
      res = await fetch("http://127.0.0.1:" + debugPort + "/json/new?" + encodeURIComponent(url));
  } catch (e) {
    fail("cannot create a test page: " + e.message);
  }
  if (!res.ok) fail("cannot create a test page (HTTP " + res.status + ")");
  const target = await res.json();
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) fail("target did not provide a debugger URL; isolation is not usable");
  return await new Page(wsUrl).open();
}
async function waitReady(page, deadline = 15000) {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = await page.eval(
        "(function(){ const svg = document.querySelector('#stage'); return !!svg && svg.children.length > 0 && document.fonts.status === 'loaded'; })()",
      );
    } catch (e) { ok = false; }
    if (ok) return;
    if (Date.now() - start > deadline)
      fail("page did not become ready within " + deadline + "ms");
    await new Promise((r) => setTimeout(r, 120));
  }
}
/* V01 C: the paint must actually have happened before a screenshot: the
   document fonts are loaded and at least two scheduled frames completed. */
async function settle(page) {
  await page.eval(
    "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
  );
  await new Promise((r) => setTimeout(r, 60));
}
/* Q02: the mutation guard compares the FULL documented state — the whole
   document (docData: nodes, edges, order, layers, appearance, title), the
   view, and the persisted preferences — not a hand-picked geometry
   subset, so a view-only operation cannot quietly change anything. */
const geometry = (page) =>
  page
    .eval(
      "JSON.stringify({doc: docData(), view: view, prefs: { gridSnap: gridSnap, showGrid: showGrid, showGuides: showGuides }})",
    )
    .then(JSON.parse);
/* Q02: every result carries a structured status AND a failure class.
 *  - status "pass"            → counted as passed, printed PASS
 *  - status "pending"         → NOT a pass, printed PENDING, holds exit 3
 *  - status "missing-candidate" → a RUNNER error: it fails the run (exit 1)
 *    instead of masquerading as pending approval
 *  - anything else            → fail (exit 1)
 * Failure classes separate hard failures (safety, identity, geometry,
 * negative control) from explicitly reviewable visual differences: the
 * approval path may accept the latter after review, never the former. */
/* Q01: the negative control and the restoration proof always compare
   against THIS RUN's pristine capture at the same view/state. An
   approved baseline is stale by definition during a legitimate UI
   change and must never be the reference that validates a safety
   control; baseline comparison is reserved for the reviewable
   difference flow. */
function controlRef(base) {
  const pristineCand = path.join(candidatesDir, base + "-z1.png");
  return fs.existsSync(pristineCand)
    ? { path: pristineCand, what: "this run's pristine capture" }
    : null;
}
/* V01: the judgment policy is imported from visual-policy.mjs. */
function record(what, ok, detail, status, kind) {
  results.push({
    what,
    ok,
    detail,
    status: status || (ok ? "pass" : "fail"),
    kind: kind || "hard", /* "visual" = reviewable pixel difference */
  });
  return ok;
}
async function cleanup() {
  try { if (ws) ws.close(); } catch (e) {}
  try { if (browser) browser.kill(); } catch (e) {}
  try { if (serverA) serverA.close(); } catch (e) {}
  try { if (serverB) serverB.close(); } catch (e) {}
  try { if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true }); } catch (e) {}
}
try {
  if (!findChrome()) {
    console.log("VISUAL CHECKS PENDING: no Chrome binary available; isolation cannot be established.");
    console.log("Set CHROME_PATH and re-run. Nothing was written or modified.");
    process.exit(2);
  }
  const portA = await freePort(), portB = await freePort();
  serverA = await serve(portA);
  serverB = await serve(portB);
  await launchBrowser();

  /* Sentinel: a document in a separate ORIGIN (separate localStorage key
     space) that the runner must never modify. */
  const sentinelPage = await newPage("http://127.0.0.1:" + portB + "/");
  await waitReady(sentinelPage);
  const sentinelDoc = JSON.stringify({
    version: 3,
    title: "SENTINEL — must not change",
    nodes: { s1: { id: "s1", type: "rect", x: 10, y: 10, w: 140, h: 56, text: "sentinel" } },
    edges: {}, order: ["s1"],
    layers: [{ id: "default", name: "L1", visible: true, locked: false }],
    activeLayer: "default", appearance: null,
  });
  await sentinelPage.evalFire("localStorage.setItem('openchart.doc.v1', " + JSON.stringify(sentinelDoc) + "); location.reload()");
  await new Promise((r) => setTimeout(r, 1200));
  await waitReady(sentinelPage);
  /* Capture after the app's own load-time normalization so the comparison
     measures whether the RUN changes it, not serialization drift. */
  const sentinelBefore = await sentinelPage.eval("localStorage.getItem('openchart.doc.v1')");

  const fixtures = fs.readdirSync(path.join(here, "tests", "fixtures")).filter((f) => f.endsWith(".json"));
  let negCtlFor = null;
  const negSaved = [];
  for (const fx of fixtures) {
    const raw = JSON.parse(fs.readFileSync(path.join(here, "tests", "fixtures", fx), "utf8"));
    const page = await newPage("http://127.0.0.1:" + portA + "/");
    await page.evalFire("localStorage.setItem('openchart.doc.v1', " + JSON.stringify(JSON.stringify(raw.doc)) + "); location.reload()");
    await waitReady(page);
    const base = fx.replace(/\.json$/, "");
    /* V01 C: the loaded document must BE the fixture, not the default
       template: ids, counts, and title are checked against the source. */
    const ident = await page.eval(
      "JSON.stringify({n:Object.keys(state.nodes).length,e:Object.keys(state.edges).length,t:state.title,ids:Object.keys(state.nodes).sort()})",
    );
    const identWant = JSON.stringify({
      n: Object.keys(raw.doc.nodes || {}).length,
      e: Object.keys(raw.doc.edges || {}).length,
      t: raw.doc.title,
      ids: Object.keys(raw.doc.nodes || {}).sort(),
    });
    record(base + ": loaded document identity matches the fixture", ident === identWant, ident === identWant ? "" : ident + " != " + identWant);
    /* Q01: the document-mutation guard covers the WHOLE zoom/selection/
       export sequence, not only what follows the zoom loop. The view is
       set to the canonical comparison state first. */
    await page.eval("(function(){ view.z = 1; view.x = 0; view.y = 0; renderView(); renderOverlay(); })()");
    await settle(page);
    const before = await geometry(page);
    for (const zoom of [0.5, 1, 2]) {
      await page.eval("(function(){ view.z = " + zoom + "; view.x = 0; view.y = 0; renderView(); renderOverlay(); })()");
      await settle(page);
      await page.shot(base + "-z" + zoom + ".png");
      const cmp = compareCandidate(base + "-z" + zoom + ".png");
      record(
        base + " zoom " + zoom + " pixels " + (cmp.status === "match" ? "match the baseline" : "[" + cmp.status + "]"),
        cmp.status === "match" || cmp.status === "pending",
        cmp.reason || ("status=" + cmp.status + (cmp.bad != null ? " bad=" + cmp.bad : "")),
        cmp.status,
        "visual",
      );
    }
    /* V01 C negative control: an appearance-only change (connector paint)
       with unchanged document geometry must FAIL the pixel comparison. */
    if (negCtlFor === null) {
      negCtlFor = base;
      /* V01: the zoom loop leaves the view at z=2. Reset to the exact
         baseline view first, so a recolored shot compared against the z=1
         baseline mismatches because of the tampering, not the zoom. */
      await page.eval("(function(){ view.z = 1; view.x = 0; view.y = 0; renderView(); renderOverlay(); })()");
      await settle(page);
      /* Q01: capture the full document/view/preference state before the
         mutation so the restoration proof can compare state as well as
         pixels. */
      const preMutation = await geometry(page);
      await page.eval("(function(){ globalThis.negSaved = []; Object.values(state.edges).forEach((e) => { negSaved.push(e.color); e.color = '#ff00ff'; }); routesDirty = true; render(); })()");
      await settle(page);
      await page.shot(base + "-negctl.png");
      /* the negative control is judged against the PRISTINE z=1 look —
         the approved baseline when one exists, otherwise THIS RUN's own
         pristine z=1 capture, so bootstrap approval still demonstrates
         paint detection. It is never judged against its own capture
         (which would make tampering self-approving). */
      const negCand = path.join(candidatesDir, base + "-negctl.png");
      const negRef = controlRef(base);
      let neg = { status: "missing-candidate", reason: "no candidate captured" };
      if (fs.existsSync(negCand) && negRef) {
        const raw = comparePixels(
          base + "-negctl.png",
          fs.readFileSync(negCand),
          fs.readFileSync(negRef.path),
        );
        neg = {
          status: raw.status,
          reason: (raw.reason || "status=" + raw.status) + " (vs " + negRef.what + ")",
          bad: raw.bad,
          total: raw.total,
        };
      } else if (fs.existsSync(negCand)) {
        neg = { status: "missing-candidate", reason: "no pristine reference captured" };
      }
      /* Q02: the negative control is a HARD safety check. A pending or
         missing reference holds approval open; it never counts as a pass. */
      const okNeg = judgeMutationControl(neg);
      record(
        okNeg
          ? "negative control: appearance-only change is caught by pixel compare"
          : "negative control [" + neg.status + "]",
        okNeg,
        okNeg ? ("bad=" + neg.bad + "/" + neg.total) : neg.reason || neg.status,
        okNeg ? "pass" : neg.status,
      );
      /* restore, then prove the pristine look is recoverable: the restored
         shot must match the same z=1 baseline (or be pending with it). */
      await page.eval("(function(){ Object.values(state.edges).forEach((e, i) => { e.color = negSaved[i]; }); routesDirty = true; render(); })()");
      await settle(page);
      await page.shot(base + "-restored.png");
      const resCand = path.join(candidatesDir, base + "-restored.png");
      let res = { status: "missing-candidate", reason: "no candidate captured" };
      if (fs.existsSync(resCand) && negRef) {
        const raw2 = comparePixels(
          base + "-restored.png",
          fs.readFileSync(resCand),
          fs.readFileSync(negRef.path),
        );
        res = {
          status: raw2.status,
          reason: (raw2.reason || "") + " (vs " + negRef.what + ")",
          bad: raw2.bad,
          total: raw2.total,
        };
      } else if (fs.existsSync(resCand)) {
        res = { status: "missing-candidate", reason: "no pristine reference captured" };
      }
      /* Q01: a failed restoration is a safety failure - it is hard,
         never approvable. The restored document state is compared too. */
      const postRestore = await geometry(page);
      const stateOk =
        JSON.stringify(preMutation) === JSON.stringify(postRestore);
      record(
        base + ": restored document state matches the pre-mutation state",
        stateOk,
        stateOk ? "" : "document, view, or preferences changed across the restore",
        stateOk ? "pass" : "pixel-mismatch",
        stateOk ? "visual" : "hard",
      );
      record(
        base + ": restored document matches the pristine look [" + res.status + "]",
        judgeRestoration(res),
        res.reason || ("status=" + res.status + (res.bad != null ? " bad=" + res.bad : "")),
        res.status,
        judgeRestoration(res) ? "visual" : "hard",
      );
    }
    /* V02: interaction shots use the real shared selection command, so
       the inspector reflects what a user would see. */
    await page.eval("(function(){ const ids = Object.keys(state.nodes); if (ids.length) { selectItem(ids[0]); render(); renderOverlay(); refreshProps(); } })()");
    await settle(page);
    const selUi = JSON.parse(await page.eval("JSON.stringify({ sel: state.sel.size, title: document.querySelector('#selection-title').textContent })"));
    record(
      base + ": real selection updates the inspector heading",
      selUi.sel === 1 && selUi.title && selUi.title !== "Document",
      JSON.stringify(selUi),
      selUi.sel === 1 && selUi.title !== "Document" ? "pass" : "fail",
    );
    await page.shot(base + "-selected.png");
    const selCmp = compareCandidate(base + "-selected.png");
    record(
      base + " selected pixels [" + selCmp.status + "]",
      selCmp.status === "match" || selCmp.status === "pending",
      selCmp.reason || ("status=" + selCmp.status + (selCmp.bad != null ? " bad=" + selCmp.bad : "")),
      selCmp.status,
      "visual",
    );
    await page.eval("(function(){ state.sel.clear(); render(); renderOverlay(); refreshProps(); })()");
    await settle(page);
    const desUi = JSON.parse(await page.eval("JSON.stringify(document.querySelector('#selection-title').textContent)"));
    record(
      base + ": deselection returns the inspector to the document view",
      desUi === "Document",
      JSON.stringify(desUi),
      desUi === "Document" ? "pass" : "fail",
    );
    await page.shot(base + "-deselected.png");
    const desCmp = compareCandidate(base + "-deselected.png");
    record(
      base + " deselected pixels [" + desCmp.status + "]",
      desCmp.status === "match" || desCmp.status === "pending",
      desCmp.reason || ("status=" + desCmp.status + (desCmp.bad != null ? " bad=" + desCmp.bad : "")),
      desCmp.status,
      "visual",
    );
    await page.eval("openExportDialog()");
    await settle(page);
    await page.shot(base + "-export.png");
    const expCmp = compareCandidate(base + "-export.png");
    record(
      base + " export preview pixels [" + expCmp.status + "]",
      expCmp.status === "match" || expCmp.status === "pending",
      expCmp.reason || ("status=" + expCmp.status + (expCmp.bad != null ? " bad=" + expCmp.bad : "")),
      expCmp.status,
      "visual",
    );
    await page.eval("document.getElementById('export-dialog').close()");
    await new Promise((r) => setTimeout(r, 120));
    /* Q01: restore the view before the full-state comparison. */
    await page.eval("(function(){ view.z = 1; view.x = 0; view.y = 0; renderView(); renderOverlay(); })()");
    await settle(page);
    const after = await geometry(page);
    record(
      base + ": zoom/selection/export-preview do not mutate the document",
      JSON.stringify(before) === JSON.stringify(after),
      JSON.stringify(before) === JSON.stringify(after)
        ? ""
        : "document, view, or preferences changed during a view-only operation",
    );
    if (SELFTEST && base === fixtures[0].replace(/\.json$/, "")) {
      /* Q02 runner-level contract tests: the status classification is
         exercised with synthetic rows covering every class the gate
         relies on — a missing candidate is an error, a pending baseline
         is not a pass, an intentional visual difference is reviewable,
         and a safety failure is hard. */
      const synth = [
        { what: "inject: missing candidate", status: "missing-candidate", kind: "visual" },
        { what: "inject: pending baseline", status: "pending", kind: "visual" },
        { what: "inject: intentional diff", status: "pixel-mismatch", bad: 40, total: 100, kind: "visual" },
        { what: "inject: failed safety check", status: "pixel-mismatch", bad: 9, total: 100, kind: "hard" },
        { what: "inject: clean check", status: "pass", kind: "hard" },
      ];
      const cls = synth.map((r) => classify(r));
      record(
        "selftest: classification table matches the contract",
        JSON.stringify(cls) === JSON.stringify(["fail", "pending", "fail", "fail", "pass"]),
        "got " + JSON.stringify(cls),
      );
      const approvable = synth.filter((r) => classify(r) === "fail" && r.kind === "visual");
      const blocked = synth.filter((r) => classify(r) === "fail" && r.kind !== "visual");
      /* Q01: pure policy tests. A stale baseline must never validate the
         control; a no-op mutation must fail it; restoration failure is
         hard and never approvable. */
      const ref = controlRef(fixtures[0].replace(/\.json$/, ""));
      record(
        "selftest: control reference is this run's pristine capture",
        !!ref &&
          ref.path.includes("candidates") &&
          !ref.path.includes("baselines"),
        ref ? ref.path : "no pristine candidate",
      );
      /* V01: the policy is exercised through REAL PNG bytes - comparator
         -> typed outcome -> judgment -> approval - never synthetic
         statuses the production code does not emit. */
      const whitePx = (w, h) =>
        new Uint8Array(w * h * 4).fill(255);
      const oneByOne = pngEncode(1, 1, whitePx(1, 1));
      const twoByOne = pngEncode(2, 1, whitePx(2, 1));
      const sameA = pngEncode(2, 1, whitePx(2, 1));
      const diffPx = whitePx(2, 1);
      diffPx[0] = 0;
      const diffB = pngEncode(2, 1, diffPx);
      const dimCmp = comparePixels("selftest-dim", oneByOne, twoByOne);
      const detectCmp = comparePixels("selftest-detect", diffB, sameA);
      const matchCmp = comparePixels("selftest-match", sameA, sameA);
      const badCmp = comparePixels(
        "selftest-bad",
        new Uint8Array([0x00]),
        sameA,
      );
      record(
        "selftest: byte chain - dimension mismatch never passes the control",
        dimCmp.status === "dimension-mismatch" &&
          judgeMutationControl(dimCmp) === false,
        "status=" + dimCmp.status,
      );
      record(
        "selftest: byte chain - a real paint difference passes the control",
        detectCmp.status === "pixel-mismatch" &&
          judgeMutationControl(detectCmp) === true,
        "status=" + detectCmp.status,
      );
      record(
        "selftest: byte chain - identical bytes match and restore",
        matchCmp.status === "match" &&
          judgeMutationControl(matchCmp) === false &&
          judgeRestoration(matchCmp) === true,
        "status=" + matchCmp.status,
      );
      record(
        "selftest: byte chain - a decode failure fails every control",
        badCmp.status === "decode-failure" &&
          judgeMutationControl(badCmp) === false &&
          judgeRestoration(badCmp) === false &&
          classify(badCmp) === "fail",
        "status=" + badCmp.status,
      );
      record(
        "selftest: a no-op mutation fails the mutation control",
        judgeMutationControl({ status: "match", bad: 0, total: 4 }) === false,
        "match must not pass",
      );
      record(
        "selftest: failed restoration is hard and never approvable",
        judgeRestoration({ status: "pixel-mismatch" }) === false &&
          judgeRestoration({ status: "match" }) === true &&
          classify({ status: "pixel-mismatch", kind: "hard" }) === "fail",
        "restoration mismatch is a hard failure",
      );
      record(
        "selftest: without a pristine candidate there is no control reference",
        controlRef("no-such-fixture-base") === null,
        "the control cannot run without this-run pristine evidence",
      );
      record(
        "selftest: approval path accepts only reviewable differences",
        approvable.length === 2 && blocked.length === 1,
        "reviewable=" + approvable.length + " hard=" + blocked.length,
      );
      /* Inject the class of silent drift R2/R4 guard against. */
      await page.eval("(function(){ const n = state.nodes[Object.keys(state.nodes)[0]]; n.x += 5; })()");
      const drifted = await geometry(page);
      const detected = JSON.stringify(before) !== JSON.stringify(drifted);
      record("selftest: injected geometry change is detected", detected);
      await page.eval("(function(){ const n = state.nodes[Object.keys(state.nodes)[0]]; n.x -= 5; })()");
      const restored = await geometry(page);
      record("selftest: document restored byte-for-byte", JSON.stringify(restored) === JSON.stringify(before));
    }
    page.close();
  }
  const sentinelAfter = await sentinelPage.eval("localStorage.getItem('openchart.doc.v1')");
  record(
    "sentinel document unchanged (separate origin)",
    typeof sentinelBefore === "string" && sentinelBefore.length > 0 && sentinelBefore === sentinelAfter,
    sentinelBefore === sentinelAfter ? "" : "sentinel storage changed during the run",
  );
  sentinelPage.close();

  /* Q02: failures split into hard failures (safety, identity, geometry,
     negative control, runner errors) and explicitly reviewable visual
     differences. Pending baselines are neither: they hold approval open. */
  const failed = results.filter((r) => classify(r) === "fail");
  const hard = failed.filter((r) => r.kind !== "visual");
  const reviewable = failed.filter((r) => r.kind === "visual");
  const pending = results.filter((r) => classify(r) === "pending");
  const passedCount = results.filter((r) => classify(r) === "pass").length;
  /* --approve promotes exactly the candidates this run captured, and only
     when every failure is an explicitly reviewable visual difference.
     Hard failures never approve; stale files from earlier runs are never
     promoted; the negative-control capture is never an approved look. A
     manifest records the provenance of what was accepted. */
  if (APPROVE) {
    if (hard.length) {
      console.log("APPROVE REFUSED: " + hard.length + " hard failure(s) (safety/identity/geometry/runner errors); baselines were not modified.");
      for (const r of hard) console.log("  hard failure: " + r.what);
    } else {
      fs.mkdirSync(baselinesDir, { recursive: true });
      let promoted = 0;
      const promotedFiles = [];
      for (const f of [...runManifest].sort()) {
        /* the negative-control capture is evidence, never an approved look */
        if (f.includes("-negctl")) continue;
        fs.copyFileSync(path.join(candidatesDir, f), path.join(baselinesDir, f));
        promoted++;
        promotedFiles.push(f);
      }
      fs.writeFileSync(
        path.join(baselinesDir, "manifest.json"),
        JSON.stringify(
          {
            when: new Date().toISOString(),
            promoted: promotedFiles,
            reviewedDifferences: reviewable.map((r) => ({ what: r.what, detail: r.detail })),
            note: "Promoted from the current run's candidates after review. Negative-control captures are excluded by policy and never become baselines.",
          },
          null,
          2,
        ),
      );
      console.log("Promoted " + promoted + " current-run candidate(s) to baselines; negative controls excluded.");
      if (reviewable.length)
        console.log("Approved with " + reviewable.length + " reviewed visual difference(s) recorded in baselines/manifest.json.");
    }
  }
  fs.mkdirSync(matrixDir, { recursive: true });
  /* Q02: statuses are structured, detected from the status field — never
     by grepping detail text. */
  fs.writeFileSync(
    path.join(matrixDir, "summary.json"),
    JSON.stringify({ when: new Date().toISOString(), selftest: SELFTEST, approve: APPROVE, passed: passedCount, failed: failed.length, hard: hard.length, reviewable: reviewable.length, pending: pending.length, results }, null, 2),
  );
  /* Q02: pending records never print PASS and never join the passed count. */
  for (const r of results) {
    const c = classify(r);
    console.log(
      (c === "pass" ? "PASS " : c === "pending" ? "PENDING " : "FAIL ") +
        r.what +
        (r.detail ? " — " + r.detail : ""),
    );
  }
  if (pending.length)
    console.log("VISUAL BASELINES PENDING (unapproved, not passes): " + pending.length);
  console.log(
    failed.length
      ? "VISUAL CHECKS FAILED: " + failed.length + (reviewable.length ? " (" + reviewable.length + " reviewable visual difference(s); run with --approve after review)" : "")
      : pending.length
        ? "VISUAL CHECKS PENDING APPROVAL: " + results.length + " checks, " + pending.length + " pending"
        : "VISUAL CHECKS PASSED: " + passedCount + " checks",
  );
  /* fail-closed: failures exit 1; pending baselines exit 3 (never success). */
  process.exitCode = failed.length ? 1 : pending.length ? 3 : 0;
} catch (e) {
  console.error("VISUAL RUNNER ERROR:", e.message);
  console.error("(cleanup follows; nothing outside the runner-owned browser/profile was touched)");
  process.exitCode = 1;
} finally {
  await cleanup();
}
