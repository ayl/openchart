const { test } = require("node:test");
const assert = require("node:assert/strict");
const { environment, setup, pointer } = require("./harness.cjs");

function fixture() {
  const e = environment();
  setup(e);
  e.run(
    "view={x:0,y:0,z:1};a.x=430;a.y=372;b.x=830;b.y=572;routesDirty=true;render()",
  );
  return e;
}
function button(e, text) {
  return e.document
    .querySelector("#props")
    .querySelectorAll("button")
    .find((b) => b.textContent === text);
}
function endpoint(e, end) {
  return e.document
    .querySelector("#overlay")
    .querySelectorAll("[data-end]")
    .find((el) => +el.getAttribute("data-end") === end);
}

for (const [dir, label, dx, dy] of [
  ["n", "above", 0, -1],
  ["s", "below", 0, 1],
  ["e", "to the right", 1, 0],
  ["w", "to the left", -1, 0],
])
  for (const activation of ["pointer", "keyboard"]) {
    test(`Quick-create ${dir} via ${activation} points from the selected box to the new box`, () => {
      const e = fixture();
      e.run("state.sel=new Set([a.id]);render()");
      const old = e.run("snapshot()");
      const control = e.document.querySelector(`[data-quick="${dir}"]`);
      if (activation === "keyboard")
        e.document
          .querySelector("#stage")
          .fire("keydown", { target: control, key: "Enter" });
      else {
        const x = e.run("center(a).x") + dx * (e.run("a.w") / 2 + 22);
        const y = e.run("center(a).y") + dy * (e.run("a.h") / 2 + 22);
        pointer(e, "down", x, y, control);
        pointer(e, "up", x, y, control);
      }
      const edge = e.json("Object.values(state.edges).at(-1)"),
        source = e.json("a");
      assert.equal(
        edge.src,
        source.id,
        "the arrow button is an outgoing connection in every direction",
      );
      const added = e.json(`state.nodes['${edge.dst}']`);
      assert.equal(edge.srcSide, dir);
      assert.equal(edge.dstSide, { n: "s", s: "n", e: "w", w: "e" }[dir]);
      assert.ok((added.x - source.x) * dx + (added.y - source.y) * dy > 0);
      const pts = e.json(`routeEdge(state.edges['${edge.id}']).pts`);
      const tip = pts.at(-1),
        prev = pts.at(-2);
      assert.ok(
        (tip.x - prev.x) * dx + (tip.y - prev.y) * dy > 0,
        "painted end tangent follows the button arrow",
      );
      assert.equal(
        control.getAttribute("aria-label"),
        "Add next step " + label,
      );
      assert.equal(e.run("history.length"), 1);
      e.run("finishEdit(true);undo()");
      assert.equal(e.run("snapshot()"), old);
    });
  }

test("The ArrowUp key only nudges a selection; it never creates or reverses a connector", () => {
  const e = fixture();
  e.run("state.sel=new Set([a.id])");
  const endpoints = e.json("[edge.src,edge.dst,edge.srcSide,edge.dstSide]"),
    y = e.run("a.y");
  e.key("ArrowUp");
  assert.equal(e.run("a.y"), y - 1);
  assert.deepEqual(
    e.json("[edge.src,edge.dst,edge.srcSide,edge.dstSide]"),
    endpoints,
  );
  assert.equal(e.run("Object.keys(state.edges).length"), 1);
});

test("Reverse preserves manual bends, explicit ports, arrow styles and label position", () => {
  const e = fixture();
  e.run(
    "b.y=a.y;edge.srcSide='e';edge.dstSide='w';edge.waypoints=[{x:640,y:400},{x:640,y:490},{x:740,y:490},{x:740,y:400}];edge.label='Return';edge.labelAuto=false;edge.labelT=.3;edge.labelOff=18;edge.arrow='open';state.sel=new Set(['e:'+edge.id]);render();refreshProps(true)",
  );
  const before = e.run("snapshot()"),
    points = e.json("routeEdge(edge).pts"),
    label = e.json("edgeLabelPlacement(edge,routeEdge(edge))"),
    waypoints = e.json("edge.waypoints");
  button(e, "Reverse").click();
  assert.deepEqual(e.json("[edge.src,edge.dst]"), e.json("[b.id,a.id]"));
  assert.deepEqual(e.json("edge.waypoints"), waypoints.reverse());
  assert.deepEqual(e.json("routeEdge(edge).pts"), points.reverse());
  assert.deepEqual(
    e.json("[edge.srcSide,edge.dstSide,edge.startArrow,edge.arrow]"),
    ["w", "e", "none", "open"],
  );
  const afterLabel = e.json("edgeLabelPlacement(edge,routeEdge(edge))");
  assert.ok(Math.hypot(afterLabel.x - label.x, afterLabel.y - label.y) < 1e-7);
  assert.equal(e.run("history.length"), 1);
  e.run("undo()");
  assert.equal(e.run("snapshot()"), before);
});

for (const end of [0, 1])
  test(`Clicking connector endpoint ${end} is a no-op, not a reset of manual routing`, () => {
    const e = fixture();
    e.run(
      "edge.waypoints=[{x:720,y:400},{x:720,y:600}];edge.label='Manual';edge.labelAuto=false;edge.labelT=.25;edge.labelOff=12;state.sel=new Set(['e:'+edge.id]);render()",
    );
    const before = e.run("snapshot()"),
      writes = e.writes,
      p = e.json(
        `routeEdge(edge).pts[${end ? "routeEdge(edge).pts.length-1" : "0"}]`,
      ),
      grip = endpoint(e, end);
    pointer(e, "down", p.x, p.y, grip);
    pointer(e, "up", p.x, p.y, grip);
    assert.equal(e.run("snapshot()"), before);
    assert.equal(e.run("history.length"), 0);
    assert.equal(e.writes, writes);
  });

test("Dragging an endpoint away and back preserves its automatic side and manual route", () => {
  const e = fixture();
  e.run(
    "edge.waypoints=[{x:720,y:400},{x:720,y:600}];state.sel=new Set(['e:'+edge.id]);render()",
  );
  const before = e.run("snapshot()"),
    p = e.json("routeEdge(edge).pts.at(-1)"),
    grip = endpoint(e, 1);
  pointer(e, "down", p.x, p.y, grip);
  pointer(e, "move", p.x + 100, p.y + 100);
  e.frame();
  pointer(e, "up", p.x, p.y);
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("history.length"), 0);
});

test("A preview uses the configured connector route and width", () => {
  const e = fixture();
  e.run(
    "ensureAppearance().edgeDefaults={route:'straight',width:8,arrow:'open',startArrow:'none'};const g={kind:'connect',src:b.id,side:null,start:center(b),last:center(a)};const target={n:a,side:null};let captured;const originalRoute=routeEdge;routeEdge=(c)=>{captured={...c};return originalRoute(c)};previewConnection(g,target)",
  );
  assert.equal(e.run("captured.route"), "straight");
  assert.equal(e.run("captured.sw"), 8);
  assert.equal(e.run("captured.arrow"), "open");
});

test("Repeated connection previews do not leak phantom segments into committed routing caches", () => {
  const e = fixture();
  e.run(
    "routeAll();const g={kind:'connect',src:b.id,side:null,start:center(b),last:center(a)},target={n:a,side:null};const countGrid=()=>[...overlayGrid.values()].reduce((n,cell)=>n+cell.length,0);const beforeGrid=countGrid();const oldCache=routeCache,oldIncident=incidentCache,oldSegments=segGrid,oldOverlay=overlayGrid,oldLabels=labelBoxes;const oldRoute=JSON.stringify([...routeCache])",
  );
  const doc = e.run("snapshot()");
  e.run("for(let i=0;i<12;i++)previewConnection(g,target)");
  assert.equal(e.run("countGrid()"), e.run("beforeGrid"));
  assert.equal(
    e.run(
      "routeCache===oldCache&&incidentCache===oldIncident&&segGrid===oldSegments&&overlayGrid===oldOverlay&&labelBoxes===oldLabels",
    ),
    true,
  );
  assert.equal(e.run("JSON.stringify([...routeCache])"), e.run("oldRoute"));
  assert.equal(e.run("snapshot()"), doc);
});

test("A free-end preview arrow uses the last nonzero segment, not a duplicate endpoint", () => {
  const e = fixture();
  e.run(
    "gesture={kind:'connect',src:a.id,side:'e',start:{x:570,y:400},last:{x:570,y:250}};drawConnectionPreview()",
  );
  const d = e.document
    .querySelector('[data-preview-arrow="dst"]')
    .getAttribute("d");
  const p = d.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g).map(Number);
  const vx = p[2] - (p[0] + p[4]) / 2,
    vy = p[3] - (p[1] + p[5]) / 2;
  assert.ok(
    Math.abs(vx) < 1e-7 && vy < 0,
    "arrow must point up along the vertical terminal segment: " + d,
  );
});

test("Source-reconnect preview keeps its fixed destination on the actual port", () => {
  const e = fixture();
  e.run(
    "edge.srcSide='e';edge.dstSide='n';render();const end=routeEdge(edge).pts.at(-1);gesture={kind:'endpoint',id:edge.id,end:0,start:routeEdge(edge).pts[0],last:{x:100,y:650}};drawConnectionPreview()",
  );
  const d = e.document
    .querySelector('[data-preview-arrow="dst"]')
    .getAttribute("d");
  const tip = e.json("end");
  assert.ok(
    d.includes(`L${tip.x} ${tip.y}`),
    "preview keeps the fixed destination: " + d,
  );
});

test("Escape inside the create-and-connect picker fully cancels connector intent", () => {
  const e = fixture();
  e.run("setTool('connect')");
  pointer(e, "down", 500, 400);
  pointer(e, "move", 600, 200);
  pointer(e, "up", 600, 200);
  e.document.querySelector("#shape-picker").fire("keydown", { key: "Escape" });
  assert.equal(e.run("pendingPicker"), null);
  assert.equal(e.run("connectSource"), null);
});

for (const kind of ["pointercancel", "lostpointercapture", "blur"])
  test(`A ${kind} during connector creation cannot leave an armed source`, () => {
    const e = fixture();
    e.run("setTool('connect')");
    const before = e.run("snapshot()");
    pointer(e, "down", 500, 400);
    pointer(e, "move", 600, 200);
    if (kind === "blur") e.windowEvent("blur");
    else e.document.querySelector("#stage").fire(kind, { pointerId: 1 });
    assert.equal(e.run("gesture"), null);
    assert.equal(e.run("connectSource"), null);
    assert.equal(e.run("snapshot()"), before);
    assert.equal(e.run("history.length"), 0);
  });

test("Window blur cancels a waiting two-click connector too", () => {
  const e = fixture();
  e.run("setTool('connect')");
  pointer(e, "down", 500, 400);
  pointer(e, "up", 500, 400);
  assert.ok(e.run("connectSource"));
  e.windowEvent("blur");
  assert.equal(e.run("connectSource"), null);
});

test("Set as default preserves dashed connector style on creation and reload", () => {
  const e = fixture();
  e.run(
    "edge.dash='dashed';edge.route='curved';edge.sw=4;edge.startArrow='open';edge.arrow='solid';state.sel=new Set(['e:'+edge.id]);setDefaultStyle();const added=makeEdge(b.id,a.id)",
  );
  assert.equal(e.run("added.dash"), "dashed");
  assert.deepEqual(
    e.json("[added.route,added.sw,added.startArrow,added.arrow]"),
    ["curved", 4, "open", "solid"],
  );
  e.run(
    "transact(()=>installDocument(validateDocument(JSON.parse(snapshot()))));const addedAgain=makeEdge(b.id,a.id)",
  );
  assert.equal(e.run("addedAgain.dash"), "dashed");
});

test("Automatic sides and Reset route do exactly the separate operations they promise", () => {
  const e = fixture();
  e.run(
    "edge.srcSide='e';edge.dstSide='w';edge.waypoints=[{x:720,y:400},{x:720,y:600}];edge.label='Fixed';edge.labelAuto=false;edge.labelT=.3;edge.labelOff=12;state.sel=new Set(['e:'+edge.id]);render();refreshProps(true)",
  );
  const points = e.json("edge.waypoints");
  button(e, "Use automatic sides").click();
  assert.deepEqual(e.json("[edge.srcSide,edge.dstSide]"), [null, null]);
  assert.deepEqual(
    e.json("edge.waypoints"),
    points,
    "changing attachment mode must not erase bends",
  );
  e.run("edge.srcSide='n';edge.dstSide='s';refreshProps(true)");
  button(e, "Reset route").click();
  assert.deepEqual(e.json("[edge.srcSide,edge.dstSide]"), [null, null]);
  assert.equal(e.run("edge.waypoints"), undefined);
  assert.deepEqual(e.json("[edge.labelAuto,edge.labelT,edge.labelOff]"), [
    false,
    0.3,
    12,
  ]);
});

for (const mode of ["straight", "orthogonal", "curved"])
  test(`Reverse twice preserves ${mode} connector identity, styles and endpoints`, () => {
    const e = fixture();
    e.run(
      `edge.route='${mode}';edge.srcSide='e';edge.dstSide='w';edge.arrow='none';edge.startArrow='solid';edge.label='Source arrow';edge.labelAuto=false;edge.labelT=.25;edge.labelOff=15;state.sel=new Set(['e:'+edge.id]);render();refreshProps(true)`,
    );
    const before = e.run("snapshot()");
    button(e, "Reverse").click();
    button(e, "Reverse").click();
    assert.equal(e.run("snapshot()"), before);
    assert.equal(e.run("history.length"), 2);
  });

test("Legacy bends survive Reverse and remain geometrically reversed", () => {
  const e = fixture();
  e.run(
    "b.y=a.y;edge.srcSide='e';edge.dstSide='w';edge.bend={dx:0,dy:90};state.sel=new Set(['e:'+edge.id]);render();refreshProps(true)",
  );
  const points = e.json("routeEdge(edge).pts");
  button(e, "Reverse").click();
  assert.deepEqual(e.json("edge.bend"), { dx: 0, dy: 90 });
  assert.deepEqual(e.json("routeEdge(edge).pts"), points.reverse());
});

test("Preview cache isolation also holds when routing throws", () => {
  const e = fixture();
  e.run(
    "const oldCache=routeCache,oldIncident=incidentCache,oldSegments=segGrid,oldOverlay=overlayGrid,oldLabels=labelBoxes;routeEdge=()=>{throw Error('simulated route failure')}",
  );
  assert.throws(
    () =>
      e.run(
        "previewConnection({kind:'connect',src:a.id,side:null},{n:b,side:null})",
      ),
    /simulated route failure/,
  );
  assert.equal(
    e.run(
      "routeCache===oldCache&&incidentCache===oldIncident&&segGrid===oldSegments&&overlayGrid===oldOverlay&&labelBoxes===oldLabels",
    ),
    true,
  );
});
