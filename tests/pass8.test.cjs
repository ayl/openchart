const { test } = require("node:test");
const assert = require("node:assert/strict");
const { inflateSync } = require("node:zlib");
const { environment, setup, pointer } = require("./harness.cjs");

function fixture() {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1}; $('#stages-panel').hidden=true;");
  return e;
}
function field(e, name) {
  return e.document
    .querySelector("#props")
    .querySelectorAll(".field")
    .find((r) => r.querySelector(".field-label")?.textContent === name)
    ?.querySelector("input,select");
}
function wheel(e, changes = {}) {
  e.document.querySelector("#stage").fire("wheel", {
    clientX: 520,
    clientY: 302,
    deltaX: 0,
    deltaY: 0,
    ...changes,
  });
}
function story(e) {
  e.run(
    "const s1=addBuildStage('Overview'),s2=addBuildStage('Inputs'),s3=addBuildStage('Results'); assignBuildStage([a.id],s1); assignBuildStage([b.id],s2); const c=makeNode('decision',650,220);c.text='Result';c.revealStageId=s3;const edge2=makeEdge(b.id,c.id);render();",
  );
}

test("R01: repeated stale text/numeric/select/color changes cannot overwrite an imported object", () => {
  const e = fixture();
  e.run("state.sel=new Set([a.id]);refreshProps(true)");
  const text = field(e, "Label"),
    width = field(e, "W");
  assert.ok(text);
  text.focus();
  text.value = "Old draft";
  const controls = e.document
    .querySelector("#props")
    .querySelectorAll("input,select");
  e.run(
    "const replacement=validateDocument(JSON.parse(snapshot())); Object.assign(replacement.nodes[a.id],{text:'Imported',w:280,h:120,fill:'#112233',fontSize:24,align:'left'}); transact(()=>installDocument(replacement));",
  );
  const before = e.run("snapshot()"),
    hist = e.run("history.length");
  for (let i = 0; i < 4; i++)
    for (const control of controls) {
      control.fire("focus");
      control.fire("input");
      control.fire("change");
      control.fire("blur");
    }
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("history.length"), hist);
});

test("R01: viewport repaint preserves draft and selects text only when opening", () => {
  const e = fixture();
  let selects = 0;
  e.document.querySelector("#txtedit").select = () => selects++;
  e.run("editText(a); $('#txtedit').value='Draft';render();render()");
  wheel(e, { deltaY: 8 });
  e.frame();
  wheel(e, { ctrlKey: true, deltaY: -8 });
  e.frame();
  assert.equal(selects, 1);
  assert.equal(e.run("!!editing"), true);
  assert.equal(e.run("a.text"), "A");
  assert.equal(e.run("history.length"), 0);
  assert.equal(e.document.querySelector("#txtedit").value, "Draft");
});

test("R02: identical pointer moves across painted frames do not oscillate", () => {
  const e = fixture();
  e.run(
    "showGuides=true;b.y+=8;edge.srcSide='e';edge.dstSide='w';state.sel=new Set([b.id]);render()",
  );
  pointer(e, "down", 400, 108);
  const ys = [];
  for (let i = 0; i < 8; i++) {
    pointer(e, "move", 400, 102);
    e.frame();
    ys.push(e.run("b.y"));
  }
  assert.equal(new Set(ys).size, 1);
  assert.equal(ys[0], 72);
  pointer(e, "up", 400, 102);
  assert.equal(e.run("b.y"), 72);
});

test("R03: exhausted quick-create changes no document, history, or save", () => {
  const e = fixture();
  e.run(
    "for(let i=1;i<=11;i++) makeNode('rect',100+i*220,100); state.sel=new Set([a.id]);render()",
  );
  const before = e.run("snapshot()"),
    writes = e.writes;
  e.run("quickCreate('e')");
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("history.length"), 0);
  assert.equal(e.writes, writes);
});

for (const direction of ["n", "s", "e", "w"])
  test("R03: quick-create direction " + direction, () => {
    const e = fixture();
    e.run("state.sel=new Set([a.id])");
    e.run(`quickCreate('${direction}')`);
    // Directional arrow buttons now always add an outgoing next step,
    // including Up/Left (the user's corrected interaction contract).
    assert.equal(e.run("Object.values(state.edges).at(-1).src===a.id"), true);
    e.run("finishEdit();undo()");
    assert.equal(e.run("Object.keys(state.nodes).length"), 2);
  });

test("R03: source reconnect preview puts the destination arrow on the destination", () => {
  const e = fixture();
  e.run(
    "const c=makeNode('rect',100,300);render();gesture={kind:'endpoint',id:edge.id,end:0,start:{x:170,y:300},last:{x:170,y:300}};drawConnectionPreview()",
  );
  const d = e.document
    .querySelector('[data-preview-arrow="dst"]')
    .getAttribute("d");
  const route = e.json(
    "previewConnection(gesture,connectionTarget(gesture.last)).pts",
  );
  const tip = route.at(-1);
  assert.ok(d.includes(`L${tip.x} ${tip.y}`), d);
  e.run("edge.arrow='none';edge.startArrow='open';drawConnectionPreview()");
  assert.equal(e.document.querySelector('[data-preview-arrow="dst"]'), null);
  assert.ok(e.document.querySelector('[data-preview-arrow="src"]'));
});

test("R04: document Auto-fit preserves locked layer geometry", () => {
  const e = fixture();
  e.run(
    "a.autofit=true;a.text='Professional label';state.layers[0].locked=true;state.sel.clear();refreshProps(true)",
  );
  const size = field(e, "Body size");
  assert.ok(size);
  size.value = "96";
  size.fire("change");
  assert.equal(e.run("a.w"), 140);
  assert.equal(e.run("a.h"), 56);
});

test("R01: numeric Enter commits once and Escape cancels repeated late callbacks", () => {
  const e = fixture();
  e.run(
    "let committed=0;const input=numeric(10,()=>committed++);input.focus();input.value='20'",
  );
  e.run(
    "input.fire('keydown',{key:'Enter'});input.fire('change');input.fire('change')",
  );
  assert.equal(e.run("committed"), 1);
  e.run(
    "input.focus();input.value='40';input.fire('input');input.fire('keydown',{key:'Escape'});input.fire('change');input.fire('change')",
  );
  assert.equal(e.run("committed"), 1);
});

test("D01: visiting Settings preserves the active label draft", () => {
  const e = fixture();
  e.run("editText(a);$('#txtedit').value='Unsaved draft'");
  e.document
    .querySelector("#txtedit")
    .fire("blur", { relatedTarget: e.document.querySelector("#editor-theme") });
  e.run("setEditorTheme('dark')");
  assert.equal(e.run("!!editing"), true);
  assert.equal(e.run("a.text"), "A");
  assert.equal(e.run("history.length"), 0);
});

test("G01: wheel units, fractions, modifiers, anchor, and coalescing", () => {
  const e = fixture();
  const before = e.run("snapshot()");
  wheel(e, { deltaX: 0.25, deltaY: 0.5 });
  wheel(e, { deltaX: 1, deltaY: 2, deltaMode: 1 });
  assert.deepEqual(e.json("view"), { x: -16.25, y: -32.5, z: 1 });
  assert.equal(e.pendingFrames, 1);
  e.frame();
  wheel(e, { deltaX: 3, deltaY: 2, shiftKey: true });
  assert.equal(e.run("view.x"), -21.25);
  const anchor = e.json("s2w(300,200)");
  wheel(e, { deltaY: -24, ctrlKey: true });
  e.frame();
  const after = e.json("s2w(300,200)");
  assert.ok(
    Math.abs(anchor.x - after.x) < 1e-8 && Math.abs(anchor.y - after.y) < 1e-8,
  );
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("history.length"), 0);
  e.run("view={x:0,y:0,z:1}");
  wheel(e, { deltaY: 1, deltaMode: 2 });
  assert.equal(e.run("view.y"), -650);
});

for (const mode of ["select", "place", "text", "connect"])
  test("G01: pinch in " + mode + " creates no objects/history", () => {
    const e = fixture();
    e.run(`setTool('${mode}','rect')`);
    const before = e.run("snapshot()");
    pointer(e, "down", 600, 300, "#stage", {
      pointerId: 11,
      pointerType: "touch",
    });
    pointer(e, "down", 700, 300, "#stage", {
      pointerId: 12,
      pointerType: "touch",
    });
    assert.equal(e.run("gesture.kind"), "pinch");
    pointer(e, "move", 750, 300, "#stage", {
      pointerId: 12,
      pointerType: "touch",
    });
    e.frame();
    pointer(e, "up", 760, 300, "#stage", {
      pointerId: 12,
      pointerType: "touch",
    });
    pointer(e, "move", 550, 400, "#stage", {
      pointerId: 11,
      pointerType: "touch",
    });
    pointer(e, "up", 550, 400, "#stage", {
      pointerId: 11,
      pointerType: "touch",
    });
    assert.equal(e.run("snapshot()"), before);
    assert.equal(e.run("history.length"), 0);
    assert.equal(e.run("touchDrain"), false);
    assert.equal(e.run("view.z"), 1.6);
  });

test("G01: touch placement commits exactly once on tap release; pinch rolls back drag", () => {
  const e = fixture();
  e.run("setTool('place','rect')");
  pointer(e, "down", 650, 300, "#stage", {
    pointerId: 11,
    pointerType: "touch",
  });
  assert.equal(e.run("Object.keys(state.nodes).length"), 2);
  pointer(e, "up", 650, 300, "#stage", { pointerId: 11, pointerType: "touch" });
  assert.equal(e.run("Object.keys(state.nodes).length"), 3);
  assert.equal(e.run("history.length"), 1);
  const before = e.run("snapshot()");
  pointer(e, "down", 100, 100, "#stage", {
    pointerId: 11,
    pointerType: "touch",
  });
  pointer(e, "move", 125, 130, "#stage", {
    pointerId: 11,
    pointerType: "touch",
  });
  e.frame();
  pointer(e, "down", 300, 300, "#stage", {
    pointerId: 12,
    pointerType: "touch",
  });
  assert.equal(e.run("snapshot()"), before);
});

test("D01: editor theme leaves chart, draft, export, routes, and history unchanged", () => {
  const e = fixture();
  e.run("editText(a);$('#txtedit').value='Draft'");
  const before = e.run("snapshot()"),
    svg = e.run("buildExportSVG(false)");
  e.run("setEditorTheme('dark')");
  assert.equal(e.document.body.getAttribute("data-editor-theme"), "dark");
  e.run("setEditorTheme('light');setEditorTheme('system')");
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("buildExportSVG(false)"), svg);
  assert.equal(e.run("history.length"), 0);
  assert.equal(e.run("!!editing"), true);
  assert.equal(
    JSON.parse(e.storage.get("openchart.ui.prefs")).editorTheme,
    "system",
  );
});

test("S01: stable stages, assignments, reorder, delete, undo and v4 round trip", () => {
  const e = fixture();
  story(e);
  assert.equal(e.run("docData().version"), 4);
  const before = e.run("snapshot()");
  assert.equal(
    e.run(
      "JSON.stringify(validateDocument(JSON.parse(snapshot())).presentation)",
    ),
    e.run("JSON.stringify(state.presentation)"),
  );
  e.run("reorderBuildStage(s2,-1)");
  assert.equal(e.run("a.revealStageId===s1 && b.revealStageId===s2"), true);
  e.run("undo()");
  assert.equal(e.run("snapshot()"), before);
  e.run("deleteBuildStage(s2,s1)");
  assert.equal(e.run("state.nodes[b.id].revealStageId===s1"), true);
  assert.equal(e.run("Object.keys(state.nodes).length"), 3);
  e.run("undo()");
  assert.equal(e.run("snapshot()"), before);
  e.run(
    "const plain=JSON.parse(snapshot());plain.version=3;delete plain.presentation;for(const o of [...Object.values(plain.nodes),...Object.values(plain.edges)])delete o.revealStageId;installDocument(validateDocument(plain))",
  );
  assert.equal(e.run("buildStages().length"), 0);
});

test("S01: invalid stage references/IDs/limits fail loudly and v4 preserves inherited fonts", () => {
  const e = fixture();
  story(e);
  assert.throws(
    () =>
      e.run(
        "const bad=JSON.parse(snapshot());bad.nodes[a.id].revealStageId='missing';validateDocument(bad)",
      ),
    /missing build stage/,
  );
  assert.throws(
    () =>
      e.run(
        "const dupe=JSON.parse(snapshot());dupe.presentation.stages.push(dupe.presentation.stages[0]);validateDocument(dupe)",
      ),
    /duplicate stage/,
  );
  e.run("installDocument(validateDocument(JSON.parse(snapshot())))");
  assert.equal(e.run("state.nodes[a.id].fontSize"), undefined);
});

test("S01: stage and drawing-layer operations respect locks and active drawing layer", () => {
  const e = fixture();
  story(e);
  e.run("a.locked=true;assignBuildStage([a.id],s3)");
  assert.equal(e.run("a.revealStageId"), e.run("s1"));
  assert.equal(e.run("deleteBuildStage(s1,s2)"), false);
  const before = e.run("snapshot()");
  e.run("state.sel=new Set([b.id]);moveSelectionToLayer('missing')");
  assert.equal(e.run("snapshot()"), before);
  e.run(
    "state.layers.push({id:'upper',name:'Upper',visible:true,locked:false});moveSelectionToLayer('upper')",
  );
  assert.equal(e.run("b.layerId"), "upper");
  assert.notEqual(e.run("state.activeLayer"), "upper");
});

test("S01: layer bridge copies nodes, uses automatic edges, leaves drawing membership/order alone", () => {
  const e = fixture();
  e.run(
    "state.layers.push({id:'upper',name:'Details',visible:true,locked:false});b.layerId='upper';edge.layerId='upper';const priorOrder=JSON.stringify(state.order),priorActive=state.activeLayer;applyLayerStages(state.layers.map(l=>({...l,checked:true})))",
  );
  assert.equal(e.run("buildStages().length"), 2);
  assert.equal(e.run("edge.revealStageId"), null);
  assert.equal(e.run("stageRevealMap().get('e:'+edge.id)"), 2);
  assert.equal(
    e.run(
      "JSON.stringify(state.order)===priorOrder && state.activeLayer===priorActive",
    ),
    true,
  );
});

test("S01: stage assignment after cancelling a provisional move targets restored objects", () => {
  const e = fixture();
  story(e);
  const x = e.run("a.x");
  pointer(e, "down", 100, 100);
  pointer(e, "move", 150, 130);
  e.frame();
  e.run("assignBuildStage([a.id],s3)");
  assert.equal(e.run("state.nodes[a.id].x"), x);
  assert.equal(e.run("state.nodes[a.id].revealStageId"), e.run("s3"));
  assert.equal(e.run("gesture"), null);
  e.run("undo()");
  assert.equal(e.run("state.nodes[a.id].revealStageId"), e.run("s1"));
});

test("S01: focused stage names and pending deletion cannot act on an imported document", () => {
  const e = fixture();
  story(e);
  e.run("$('#stages-panel').hidden=false;renderStages()");
  const oldName = e.document
    .querySelector("#stages-list")
    .querySelector("input");
  oldName.focus();
  oldName.value = "Stale draft";
  e.run(
    "stageUI.deleteId=s1;stageUI.deleteEpoch=docEpoch;const replacement=validateDocument(JSON.parse(snapshot()));replacement.presentation.stages[0].name='Imported stage';installDocument(replacement);refreshProps(true)",
  );
  const newName = e.document
    .querySelector("#stages-list")
    .querySelector("input");
  assert.notEqual(newName, oldName);
  assert.equal(newName.value, "Imported stage");
  oldName.fire("change");
  oldName.fire("change");
  e.document.querySelector("#stage-delete-apply").click();
  assert.equal(e.run("buildStages().length"), 3);
  assert.equal(e.run("buildStages()[0].name"), "Imported stage");
});

test("S01: replaced stage assignment controls are permanently inert", () => {
  const e = fixture();
  story(e);
  e.run(
    "$('#stages-panel').hidden=false;state.sel=new Set([a.id]);renderStages()",
  );
  const old = e.document
    .querySelector("#stage-assignment")
    .querySelector("select");
  e.run("state.sel=new Set([b.id]);renderStages()");
  const before = e.run("snapshot()");
  old.value = e.run("s3");
  old.fire("change");
  assert.equal(e.run("snapshot()"), before);
});

test("S02: frames are cumulative with fixed geometry, endpoints, manual labels, and bounds", () => {
  const e = fixture();
  story(e);
  e.run(
    "edge.label='Manual label';edge.labelPos=0.35;edge.labelOff=30;edge.waypoints=[{x:230,y:100},{x:230,y:160},{x:290,y:160},{x:290,y:100}];routesDirty=true;render();const scene=captureStageScene();",
  );
  const a = e.run("stageFrame(scene,1)"),
    b = e.run("stageFrame(scene,2)"),
    c = e.run("stageFrame(scene,3)");
  assert.equal((a.match(/data-export-key=/g) || []).length, 1);
  assert.equal((b.match(/data-export-key=/g) || []).length, 3);
  assert.equal((c.match(/data-export-key=/g) || []).length, 5);
  const part = e.run("scene.parts[0].svg");
  assert.ok(a.includes(part) && b.includes(part) && c.includes(part));
  assert.equal(a.match(/viewBox="[^"]*"/)[0], c.match(/viewBox="[^"]*"/)[0]);
  assert.equal(e.run("captureStageScene()===scene"), true);
  const saved = e.run("scene.doc");
  e.run("a.x+=999");
  assert.equal(e.run("scene.doc"), saved);
  assert.equal(e.run("stageFrame(scene,1)"), a);
});

test("S02: nested container dependencies, not-before edges, and hidden layers", () => {
  const e = fixture();
  story(e);
  e.run(
    "const parent=makeNode('container',200,300);parent.revealStageId=s3;a.parentId=parent.id;edge.revealStageId=s1;const reveals=stageRevealMap()",
  );
  assert.equal(e.run("reveals.get(a.id)"), 3);
  assert.equal(e.run("reveals.get('e:'+edge.id)"), 3);
  e.run("state.layers[0].visible=false");
  assert.equal(e.run("captureStageScene().parts.length"), 0);
});

test("S03: preview is read-only, page size is constant and memory limits clamp all frames together", async () => {
  const e = fixture();
  story(e);
  const before = e.run("snapshot()");
  await e.run("openSequence()");
  e.document.querySelector("#sequence-next").click();
  assert.equal(e.run("stageUI.preview"), 2);
  assert.equal(e.run("snapshot()"), before);
  const size = e.json(
    "sequenceOutputSize({width:40000,height:20000,stages:Array(50)}, {scale:3})",
  );
  assert.ok(
    size.w <= 8192 && size.h <= 8192 && size.w * size.h * 50 <= 40000000,
  );
  assert.equal(size.clamped, true);
});

test("S03: ZIP stored entries have valid central offsets, CRCs, and safe names", () => {
  const e = fixture();
  const bytes = Buffer.from(
    e.run(
      "zipFiles([{name:'stage-001.png',data:utf8('frame1')},{name:'manifest.json',data:utf8('{}')}])",
    ),
  );
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  const central = bytes.readUInt32LE(bytes.length - 6);
  assert.equal(bytes.readUInt32LE(central), 0x02014b50);
  assert.equal(bytes.readUInt32LE(14), e.run("zipCRC(utf8('frame1'))"));
  assert.equal(bytes.readUInt16LE(bytes.length - 12), 2);
  assert.throws(
    () => e.run("zipFiles([{name:'../escape',data:utf8('x')}])"),
    /Unsafe/,
  );
});

test("S03: lossless PDF embeds RGB + alpha and valid xref offsets, including deflate fallback", async () => {
  const e = fixture();
  const img = await e.run(
    "pdfRasterImage(new Uint8Array([255,0,0,255,0,255,0,128]),2,1)",
  );
  assert.deepEqual([...inflateSync(img.data)], [255, 0, 0, 0, 255, 0]);
  assert.deepEqual([...inflateSync(img.alpha)], [255, 128]);
  const pdf = Buffer.from(
    await e.run(
      "(async()=>{const im=await pdfRasterImage(new Uint8Array([255,0,0,255]),1,1);return rasterPDF([im,im],400,200,'a4-landscape')})()",
    ),
  );
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.includes("/Count 2"));
  assert.equal(
    (text.match(/\/MediaBox \[0 0 842.0000 595.0000\]/g) || []).length,
    2,
  );
  const xref = +text.match(/startxref\n(\d+)/)[1];
  assert.equal(pdf.subarray(xref, xref + 4).toString(), "xref");
  e.run("CompressionStream=undefined");
  const stored = await e.run("deflateBytes(utf8('Fallback — lossless'))");
  assert.equal(inflateSync(stored).toString(), "Fallback — lossless");
});

test("G01: third contact and cancellation drain safely, preserving an inline draft", () => {
  const e = fixture();
  e.run("editText(a);$('#txtedit').value='Uncommitted'");
  pointer(e, "down", 500, 300, "#stage", {
    pointerType: "touch",
    pointerId: 11,
  });
  pointer(e, "move", 520, 300, "#stage", {
    pointerType: "touch",
    pointerId: 11,
  });
  pointer(e, "down", 700, 300, "#stage", {
    pointerType: "touch",
    pointerId: 12,
  });
  pointer(e, "down", 800, 400, "#stage", {
    pointerType: "touch",
    pointerId: 13,
  });
  pointer(e, "up", 800, 400, "#stage", { pointerType: "touch", pointerId: 13 });
  assert.equal(e.run("gesture.kind"), "pinch");
  e.document.querySelector("#stage").fire("pointercancel", { pointerId: 11 });
  pointer(e, "up", 700, 300, "#stage", { pointerType: "touch", pointerId: 12 });
  assert.equal(e.run("touchDrain"), false);
  assert.equal(e.run("!!editing"), true);
  assert.equal(e.run("a.text"), "A");
  assert.equal(e.run("history.length"), 0);
});

test("G01: view frames reposition the active editor without solving routes", () => {
  const e = fixture();
  e.run("editText(a)");
  e.run(
    "let solves=0;const originalRouteAll=routeAll;routeAll=(...args)=>{solves++;return originalRouteAll(...args)}",
  );
  const left = e.document.querySelector("#txtedit").style.left;
  wheel(e, { deltaX: 25 });
  e.frame();
  assert.notEqual(e.document.querySelector("#txtedit").style.left, left);
  assert.equal(e.run("solves"), 0);
});

test("S01: stage-mode placement, duplicate, missing clipboard stages, and new document", () => {
  const e = fixture();
  story(e);
  e.run(
    "$('#stages-panel').hidden=false;stageUI.active=s2;const extra=makeNode('rect',700,400)",
  );
  assert.equal(e.run("extra.revealStageId"), e.run("s2"));
  e.run("state.sel=new Set([a.id]);duplicateSel()");
  assert.equal(
    e.run("state.nodes[[...state.sel][0]].revealStageId"),
    e.run("s1"),
  );
  e.run("copySelection();loadTemplate(null);pasteSelection()");
  assert.equal(e.run("buildStages().length"), 0);
  assert.equal(e.run("Object.values(state.nodes)[0].revealStageId"), null);
  assert.equal(e.run("validateDocument(JSON.parse(snapshot())).legacy"), false);
});

test("S02: stage metadata and previews do not trigger new route solves", async () => {
  const e = fixture();
  e.run(
    "let solves=0;const originalRouteAll=routeAll;routeAll=(...args)=>{solves++;return originalRouteAll(...args)}",
  );
  e.run("const id=addBuildStage();assignBuildStage([a.id],id)");
  assert.equal(e.run("solves"), 0);
  await e.run("openSequence()");
  const after = e.run("solves");
  e.run(
    "refreshSequencePreview();refreshSequencePreview();setEditorTheme('dark');refreshSequencePreview()",
  );
  assert.equal(e.run("solves"), after);
});

async function drainExport(e, promise) {
  let done = false;
  promise.finally(() => {
    done = true;
  });
  for (let i = 0; i < 100 && !done; i++) {
    e.advance(100);
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(done, "job completes within controlled idle turns");
  await promise;
}

test("S03: cancelled export releases canvases, downloads nothing and permits retry", async () => {
  const e = fixture();
  story(e);
  await e.run("openSequence()");
  e.run(`let downloads=0,freed=0;download=()=>downloads++;
    rasterizeSVG=async()=>({canvas:{width:2,_h:1,get height(){return this._h},set height(v){this._h=v;if(v===0)freed++},toBlob(cb){sequenceJob.cancelled=true;cb(new Blob(['png']))}}});`);
  const job = e.run("exportSequence()");
  await drainExport(e, job);
  assert.equal(e.run("downloads"), 0);
  assert.equal(e.run("freed"), 1);
  assert.equal(e.run("sequenceJob"), null);
  assert.match(
    e.document.querySelector("#sequence-status").textContent,
    /cancelled/,
  );
  assert.equal(e.document.querySelector("#sequence-download").disabled, false);
});

test("S03: encoding failure leaves dialog retryable; source changes cannot mix frames", async () => {
  const e = fixture();
  story(e);
  await e.run("openSequence()");
  const doc = e.run("sequenceScene.doc");
  e.run(`let downloads=0,freed=0;download=()=>downloads++;
    rasterizeSVG=async()=>({canvas:{width:2,_h:1,get height(){return this._h},set height(v){this._h=v;if(v===0)freed++},toBlob(cb){cb(null)}}});`);
  await drainExport(e, e.run("exportSequence()"));
  assert.equal(e.run("downloads"), 0);
  assert.equal(e.run("freed"), 1);
  assert.match(
    e.document.querySelector("#sequence-status").textContent,
    /PNG encoding failed/,
  );
  e.run("a.text='Changed';refreshSequencePreview(true)");
  assert.equal(e.run("sequenceScene.doc"), doc);
  assert.match(
    e.document.querySelector("#sequence-status").textContent,
    /diagram changed/,
  );
});

test("P01: frame instrumentation retires cancelled IDs and excludes measurement frames", () => {
  const fs = require("node:fs"),
    vm = require("node:vm"),
    path = require("node:path");
  const source = fs.readFileSync(
    path.join(__dirname, "../perf-check.mjs"),
    "utf8",
  );
  const literal = source
    .split("\n")
    .find((line) => line.includes("window.__rafIds=new Set"));
  const code = JSON.parse(literal.trim().slice(2));
  const callbacks = new Map();
  let next = 0;
  const ctx = {
    requestAnimationFrame: (cb) => {
      callbacks.set(++next, cb);
      return next;
    },
    cancelAnimationFrame: (id) => callbacks.delete(id),
  };
  ctx.window = ctx;
  vm.runInNewContext(code, ctx);
  const one = ctx.requestAnimationFrame(() => {});
  assert.equal(ctx.__rafPending, 1);
  ctx.cancelAnimationFrame(one);
  assert.equal(ctx.__rafPending, 0);
  const two = ctx.requestAnimationFrame(() => {});
  callbacks.get(two)(0);
  assert.equal(ctx.__rafPending, 0);
  ctx.__measureRaf(() => {});
  assert.equal(ctx.__rafPending, 0);
});

/* ===== S04: export the build stages as SVG (vector, one file per stage) ===== */

function zipEntries(buf) {
  /* The app writes STORE-entry zips (method 0), so entries parse directly. */
  const out = [];
  let at = 0;
  while (at + 30 <= buf.length) {
    if (
      buf[at] === 0x50 && buf[at + 1] === 0x4b && buf[at + 2] === 3 && buf[at + 3] === 4
    ) {
      const nlen = buf[at + 26] | (buf[at + 27] << 8);
      const elen = buf[at + 28] | (buf[at + 29] << 8);
      const size =
        buf[at + 18] | (buf[at + 19] << 8) | (buf[at + 20] << 16) | (buf[at + 21] << 24);
      const name = Buffer.from(buf.slice(at + 30, at + 30 + nlen)).toString("utf8");
      const start = at + 30 + nlen + elen;
      out.push({ name, data: Buffer.from(buf.slice(start, start + size)) });
      at = start + size;
    } else {
      at++;
    }
  }
  return out;
}

test("S04: svg sequence export writes one vector file per stage, no rasterization", async () => {
  const e = fixture();
  story(e);
  await e.run("openSequence()");
  e.run('$("#sequence-format").value="svg"');
  e.run(
    "let saved=[];download=(name,content,type)=>{saved.push({name:name,content:content,type:type})};" +
      "rasterizeSVG=()=>{throw new Error('rasterized-by-accident')};",
  );
  const before = e.run("snapshot()");
  const hist = e.run("history.length");
  await drainExport(e, e.run("exportSequence()"));
  assert.equal(e.run("saved.length"), 1, "exactly one ZIP download");
  const dl = JSON.parse(e.run("JSON.stringify({name:saved[0].name,type:saved[0].type})"));
  assert.match(dl.name, /-build\.zip$/, "the staged SVG export ships as a ZIP");
  assert.equal(dl.type, "application/zip");
  assert.doesNotMatch(
    e.document.querySelector("#sequence-status").textContent,
    /rasterized-by-accident/,
    "vector frames never touch the raster path",
  );
  const entries = zipEntries(e.run("saved[0].content"));
  const names = entries.map((x) => x.name);
  assert.equal(entries.length, 4, "three stage files plus manifest");
  assert.equal(names.filter((n) => n.endsWith(".svg")).length, 3);
  assert.ok(names.includes("manifest.json"));
  const svgs = entries
    .filter((x) => x.name.endsWith(".svg"))
    .sort((p, q) => (p.name < q.name ? -1 : 1));
  for (const [i, f] of svgs.entries()) {
    const text = f.data.toString("utf8");
    const frame = e.run("stageFrame(sequenceScene," + (i + 1) + ")");
    assert.equal(text, frame, "stage file " + (i + 1) + " is the exact frame SVG");
    assert.ok(text.startsWith("<svg"), "standalone SVG document");
    assert.ok(text.endsWith("</svg>"));
  }
  assert.equal(svgs[0].data.toString("utf8").includes("Result"), false, "stage 1 excludes later objects");
  assert.equal(svgs[2].data.toString("utf8").includes("Result"), true, "stage 3 is cumulative");
  const manifest = JSON.parse(
    entries.find((x) => x.name === "manifest.json").data.toString("utf8"),
  );
  assert.equal(manifest.vector, true, "manifest records vector output");
  assert.equal(manifest.rasterPDF, false);
  assert.equal(manifest.width, e.run("sequenceScene.width"));
  assert.equal(manifest.height, e.run("sequenceScene.height"));
  assert.equal(manifest.stages.length, 3);
  assert.ok(manifest.stages.every((s) => s.file.endsWith(".svg")));
  assert.equal(e.run("snapshot()"), before, "export never mutates the document");
  assert.equal(e.run("history.length"), hist, "export records no undo step");
});

test("S04: svg format adjusts the dialog and honors subrange plus JSON", async () => {
  const e = fixture();
  story(e);
  await e.run("openSequence()");
  e.run('$("#sequence-format").value="svg";refreshSequencePreview()');
  assert.equal(e.document.querySelector("#sequence-page").disabled, true, "no PDF page size for vector files");
  assert.equal(e.document.querySelector("#sequence-json").disabled, false, "editable JSON stays available");
  assert.equal(e.document.querySelector("#sequence-download").textContent, "Download ZIP");
  const counts = e.document.querySelector("#sequence-counts").textContent;
  assert.match(counts, /· vector/);
  assert.match(counts, new RegExp("fixed output " + e.run("sequenceScene.width") + " × " + e.run("sequenceScene.height")));
  e.run('$("#sequence-format").value="png";refreshSequencePreview()');
  assert.equal(e.document.querySelector("#sequence-page").disabled, true, "page size stays pdf-only");
  e.run('$("#sequence-format").value="svg";$("#sequence-first").value="2";$("#sequence-last").value="3";$("#sequence-json").checked=true');
  e.run("let saved=[];download=(name,content,type)=>{saved.push({name:name,content:content})}");
  await drainExport(e, e.run("exportSequence()"));
  const entries = zipEntries(e.run("saved[0].content"));
  const svgNames = entries.map((x) => x.name).filter((n) => n.endsWith(".svg"));
  assert.equal(svgNames.length, 2, "From/Through subrange exports two stages");
  assert.ok(entries.some((x) => x.name === "manifest.json"));
  const editable = entries.find((x) => x.name.endsWith("-editable.json"));
  assert.ok(editable, "opt-in editable JSON rides along");
  assert.equal(editable.data.toString("utf8"), e.run("snapshot()"));
  const manifest = JSON.parse(entries.find((x) => x.name === "manifest.json").data.toString("utf8"));
  assert.deepEqual(manifest.stages.map((s) => s.index), [2, 3]);
});
