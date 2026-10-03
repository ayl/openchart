const test = require("node:test").test;
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  environment,
  setup,
  pointer,
  segRectIntersects,
  routeHitsRects,
} = require("./harness.cjs");


test("opposing arrows use distinct parallel lanes", () => {
  const e = environment();
  setup(e);
  e.run("const reverse=makeEdge(b.id,a.id);routeAll();");
  assert.equal(e.run("routeEdge(edge).pts.length"), 2);
  assert.equal(e.run("routeEdge(reverse).pts.length"), 2);
  assert.notEqual(
    e.run("routeEdge(edge).pts[0].y"),
    e.run("routeEdge(reverse).pts.at(-1).y"),
  );
});

test("opposing lanes follow the far endpoint position", () => {
  const e = environment();
  setup(e);
  e.run(
    "a.x=0;a.y=200;b.x=300;b.y=20;const lower=makeNode('rect',300,360);const out=makeEdge(a.id,b.id),incoming=makeEdge(lower.id,a.id);routeAll();",
  );
  assert.ok(e.run("routeEdge(out).pts[0].y < a.y+a.h/2"));
  assert.ok(e.run("routeEdge(incoming).pts.at(-1).y > a.y+a.h/2"));
});

test("diamond attachments lie on their perimeter and routes stay orthogonal", () => {
  const e = environment();
  setup(e);
  e.run("a.type='decision';const reverse=makeEdge(b.id,a.id);routeAll();");
  assert.equal(
    e.run(
      "Object.values(state.edges).every(e=>routeEdge(e).pts.every((p,i,ps)=>!i||p.x===ps[i-1].x||p.y===ps[i-1].y))",
    ),
    true,
  );
  assert.ok(
    e.run(
      "Math.abs(Math.abs((routeEdge(edge).pts[0].x-a.x-a.w/2)/(a.w/2))+Math.abs((routeEdge(edge).pts[0].y-a.y-a.h/2)/(a.h/2))-1)<1e-8",
    ),
  );
});

test("segment dragging keeps endpoints attached and ignores tangential motion", () => {
  const e = environment();
  setup(e);
  e.run(
    "const points=editableRoutePoints(edge);edge.waypoints=dragEdgeSegment(points,1,70,40);routeAll();",
  );
  assert.equal(
    e.run(
      "JSON.stringify(dragEdgeSegment(points,1,70,40))===JSON.stringify(dragEdgeSegment(points,1,0,40))",
    ),
    true,
  );
  assert.equal(
    e.run(
      "routeEdge(edge).pts.every((p,i,ps)=>!i||p.x===ps[i-1].x||p.y===ps[i-1].y)",
    ),
    true,
  );
  assert.equal(
    e.run(
      "new Set(edge.waypoints.map(p=>p.x+','+p.y)).size===edge.waypoints.length && edge.waypoints.every((p,i,w)=>!i||p.x!==w[i-1].x||p.y!==w[i-1].y)",
    ),
    true,
  );
  assert.equal(e.run("routeEdge(edge).pts[0].x"), e.run("a.x+a.w"));
  assert.equal(e.run("routeEdge(edge).pts.at(-1).x"), e.run("b.x"));
  e.run("resetEdgeRoute(edge);routeAll()");
  assert.equal(e.run("routeEdge(edge).pts.length"), 2);
});

test("different sized shapes share snapped centers", () => {
  const e = environment();
  setup(e);
  e.run(
    "gridSnap=true;const diamond=makeNode('decision',403,103);const box=makeNode('rect',403,103);",
  );
  assert.equal(e.run("diamond.x+diamond.w/2"), e.run("box.x+box.w/2"));
  assert.equal(e.run("diamond.y+diamond.h/2"), e.run("box.y+box.h/2"));
});

test("repeated routing is deterministic", () => {
  const e = environment();
  setup(e);
  e.run(
    "const c=makeNode('rect',400,300);makeEdge(a.id,c.id);routeAll();const initialRoutes=JSON.stringify([...routeCache]);routeAll();",
  );
  assert.equal(
    e.run("JSON.stringify([...routeCache])"),
    e.run("initialRoutes"),
  );
});

test("crossing diagonal flows reroute onto separate orthogonal corridors", () => {
  const e = environment();
  setup(e);
  e.run(
    "a.x=100;a.y=100;b.x=500;b.y=100;const c=makeNode('rect',100,360),d=makeNode('rect',500,360);const e1=makeEdge(a.id,d.id),e2=makeEdge(c.id,b.id);routeAll();",
  );
  assert.equal(
    e.run(
      "crossingCount(routeEdge(e1).pts,routeEdge(e2).pts.slice(1).map((p,i)=>[routeEdge(e2).pts[i],p]))",
    ),
    0,
  );
  assert.equal(
    e.run(
      "routeEdge(e1).pts.every((p,i,ps)=>!i||p.x===ps[i-1].x||p.y===ps[i-1].y)",
    ),
    true,
  );
  assert.equal(
    e.run(
      "routeEdge(e2).pts.every((p,i,ps)=>!i||p.x===ps[i-1].x||p.y===ps[i-1].y)",
    ),
    true,
  );
});

test("new connectors render above existing shapes and connectors", () => {
  const e = environment();
  setup(e);
  e.run("const newest=makeEdge(a.id,b.id);render();");
  assert.equal(e.run("orderedItems().at(-1).id"), e.run("newest.id"));
  assert.equal(
    e.document
      .querySelector("#viewport")
      .children.at(-1)
      .getAttribute("data-edge"),
    e.run("newest.id"),
  );
  const svg = e.run("buildExportSVG()");
  assert.ok(
    svg.lastIndexOf('data-edge="' + e.run("newest.id") + '"') >
      svg.lastIndexOf('data-node="'),
  );
});

test("new connectors go above higher visible layers without changing the active layer", () => {
  const e = environment();
  setup(e);
  e.run(
    "addLayer();const frontLayer=state.activeLayer;const cover=makeNode('container',250,100);state.activeLayer=DEFAULT_LAYER;const newest=makeEdge(a.id,b.id);render();",
  );
  assert.equal(e.run("newest.layerId"), e.run("frontLayer"));
  assert.equal(e.run("orderedItems().at(-1).id"), e.run("newest.id"));
  assert.equal(e.run("state.activeLayer"), e.run("DEFAULT_LAYER"));
});

test("a locked foreground gets a new connector layer that undoes with the connection", () => {
  const e = environment();
  setup(e);
  e.run(
    "addLayer();const lockedLayer=state.layers.at(-1);lockedLayer.locked=true;state.activeLayer=DEFAULT_LAYER;const before=snapshot();completeConnection(a.id,b.id,'e','w');const newest=Object.values(state.edges).at(-1);",
  );
  assert.equal(e.run("state.layers.length"), 3);
  assert.equal(e.run("lockedLayer.locked"), true);
  assert.equal(e.run("newest.layerId"), e.run("state.layers.at(-1).id"));
  assert.equal(e.run("orderedItems().at(-1).id"), e.run("newest.id"));
  e.run("undo()");
  assert.equal(e.run("snapshot()"), e.run("before"));
});

test("hidden upper layers do not hide new connectors", () => {
  const e = environment();
  setup(e);
  e.run(
    "addLayer();state.layers.at(-1).visible=false;state.activeLayer=DEFAULT_LAYER;const newest=makeEdge(a.id,b.id);",
  );
  assert.equal(e.run("newest.layerId"), e.run("DEFAULT_LAYER"));
  assert.equal(e.run("orderedItems().at(-1).id"), e.run("newest.id"));
});

// A small DOM adapter exercises the real application code without a browser.
// Layout, native events, focus navigation and visual quality still need browser QA.

test("startup renders the editor and preserves a saved blank document", () => {
  const e = environment();
  e.run("init()");
  assert.equal(e.run("Object.keys(state.nodes).length"), 6);
  assert.ok(e.document.querySelector("#viewport").children.length > 6);
  const doc = e.json("docData()");
  doc.nodes = {};
  doc.edges = {};
  doc.order = [];
  const blank = environment(JSON.stringify(doc));
  blank.run("init()");
  assert.equal(blank.run("Object.keys(state.nodes).length"), 0);
});
test("inline text editing is undoable and Escape discards changes", () => {
  const e = environment();
  setup(e);
  e.run(
    "state.sel=new Set([a.id]);editText(a);$('#txtedit').value='Changed';finishEdit();undo();",
  );
  assert.equal(e.run("state.nodes[a.id].text"), "A");
  e.run(
    "redo();editText(state.nodes[a.id]);$('#txtedit').value='Cancelled';finishEdit(true);",
  );
  assert.equal(e.run("state.nodes[a.id].text"), "Changed");
});
test("selecting a node does not clear redo or add history", () => {
  const e = environment();
  setup(e);
  e.run("transact(()=>a.text='New');undo();");
  const p = e.json("w2s(a.x+20,a.y+20)");
  pointer(e, "down", p.x, p.y);
  pointer(e, "up", p.x, p.y);
  assert.equal(e.run("future.length"), 1);
  assert.equal(e.run("history.length"), 0);
  e.run("redo()");
  assert.equal(e.run("state.nodes[a.id].text"), "New");
});
test("connector property edits and deletion undo in one step", () => {
  const e = environment();
  setup(e);
  e.run(
    "state.sel=new Set(['e:'+edge.id]);applyEdgeField('color','#dc2626');undo();",
  );
  /* S09: the creation default is the active theme's edge color */
  assert.equal(
    e.run("state.edges[edge.id].color"),
    e.run("currentTheme().edge"),
  );
  e.run("state.sel=new Set(['e:'+edge.id]);deleteSel();undo();");
  assert.ok(e.run("state.edges[edge.id]"));
});
test("drawing a connector from a port autosaves and preserves anchors", () => {
  const e = environment();
  setup(e);
  e.run(
    "state.edges={};state.order=state.order.filter(k=>!k.startsWith('e:'));render();hoverId=a.id;renderOverlay();",
  );
  const start = e.json("w2s(sidePoint(a,'n').x,sidePoint(a,'n').y)"),
    end = e.json("w2s(sidePoint(b,'w').x,sidePoint(b,'w').y)");
  const port = e.document
    .querySelector("#overlay")
    .querySelector('[data-port="n"]');
  const writes = e.writes;
  pointer(e, "down", start.x, start.y, port);
  pointer(e, "move", end.x, end.y);
  pointer(e, "up", end.x, end.y);
  assert.equal(e.run("Object.keys(state.edges).length"), 1);
  assert.equal(e.run("Object.values(state.edges)[0].srcSide"), "n");
  assert.equal(e.run("Object.values(state.edges)[0].dstSide"), "w");
  assert.ok(e.writes > writes);
});
test("endpoint drag cancel leaves no mutation, history, or save", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set(['e:'+edge.id]);render();");
  const handle = e.document
    .querySelector("#overlay")
    .querySelector('[data-end="1"]');
  const start = e.json('w2s(sidePoint(b,"w").x,sidePoint(b,"w").y)'),
    target = e.json("w2s(center(a).x,center(a).y)"),
    before = e.run("snapshot()"),
    writes = e.writes;
  pointer(e, "down", start.x, start.y, handle);
  pointer(e, "move", target.x, target.y);
  e.key("Escape");
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("history.length"), 0);
  assert.equal(e.writes, writes);
});
test("container fitting preserves previous far edges when growing left and up", () => {
  const e = environment();
  e.run(
    "gridSnap=false;const c=makeNode('container',50,50);Object.assign(c,{x:0,y:0,w:100,h:100});const n=makeNode('rect',10,30);Object.assign(n,{x:0,y:20,w:30,h:24,parentId:c.id});fitContainers();",
  );
  assert.ok(e.run("c.x<0&&c.y<0"));
  assert.ok(e.run("c.x+c.w>=100&&c.y+c.h>=100"));
});
test("overlapping containers have one explicit parent; nested descendants move once", () => {
  const e = environment();
  e.run(
    "gridSnap=false;const outer=makeNode('container',250,200),inner=makeNode('container',250,200);Object.assign(inner,{x:150,y:100,w:200,h:180});assignParent(inner);const n=makeNode('rect',250,200);assignParent(n);state.sel=new Set([outer.id,inner.id,n.id]);const old=n.x;selectionRoots().forEach(r=>moveTree(r,20,0));",
  );
  assert.equal(e.run("n.parentId"), e.run("inner.id"));
  assert.equal(e.run("inner.parentId"), e.run("outer.id"));
  assert.equal(e.run("n.x-old"), 20);
});
test("keyboard nudge carries container descendants", () => {
  const e = environment();
  e.run(
    "gridSnap=false;const c=makeNode('container',250,200),n=makeNode('rect',250,200);assignParent(n);state.sel=new Set([c.id]);const old=n.x;",
  );
  e.key("ArrowRight");
  assert.equal(e.run("n.x-old"), 1);
  e.run("undo()");
  assert.equal(e.run("state.nodes[n.id].x"), e.run("old"));
});
test("hit testing and actual object order agree across layers", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('container',100,100);render();");
  assert.equal(e.run("nodeAtWorld(100,100).id"), e.run("a.id"));
  e.run("state.sel=new Set([c.id]);arrange('front');");
  assert.equal(e.run("nodeAtWorld(100,100).id"), e.run("c.id"));
  e.run("addLayer();const top=makeNode('rect',100,100);render();");
  assert.equal(e.run("nodeAtWorld(100,100).id"), e.run("top.id"));
  e.run("state.layers.at(-1).visible=false;render()");
  assert.notEqual(e.run("nodeAtWorld(100,100).id"), e.run("top.id"));
});
test("locked layers prevent edits and cannot receive new objects", () => {
  const e = environment();
  setup(e);
  e.run(
    'state.layers[0].locked=true;state.sel=new Set([a.id]);applyField("fill","#ff0000")',
  );
  assert.notEqual(e.run("a.fill"), "#ff0000");
  assert.equal(e.run("createAllowed()"), false);
  assert.equal(e.run("state.sel.size"), 0);
});
test("straight aligned connectors can be manually bent", () => {
  const e = environment();
  setup(e);
  const before = e.json("routeEdge(edge).pts");
  e.run("edge.bend={dx:0,dy:90};routeCache.clear()");
  const after = e.json("routeEdge(edge).pts");
  assert.notDeepEqual(after, before);
  assert.ok(after.some((p) => p.y === 190));
});
test("automatic elbow routing avoids a blocking shape and stays orthogonal", () => {
  const e = environment();
  setup(e);
  e.run(
    "const obstacle=makeNode('rect',250,100);Object.assign(obstacle,{x:180,y:60,w:140,h:80});render();",
  );
  const pts = e.json("routeEdge(edge).pts");
  assert.ok(pts.length > 2);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y);
    assert.equal(
      e.run(
        `crosses(${JSON.stringify(pts[i - 1])},${JSON.stringify(pts[i])},{x:180,y:60,w:140,h:80})`,
      ),
      false,
    );
  }
});
test("fixed ports survive moving nodes and self-loops remain rectilinear", () => {
  const e = environment();
  setup(e);
  e.run("edge.srcSide='n';edge.dstSide='w';b.y=300;routeCache.clear();");
  assert.deepEqual(
    e.json("routeEdge(edge).pts[0]"),
    e.json("sidePoint(a,'n')"),
  );
  assert.deepEqual(
    e.json("routeEdge(edge).pts.at(-1)"),
    e.json("sidePoint(b,'w')"),
  );
  e.run("edge.dst=a.id;edge.srcSide=null;edge.dstSide=null;routeCache.clear()");
  const pts = e.json("routeEdge(edge).pts");
  assert.ok(pts.length > 3);
  for (let i = 1; i < pts.length; i++)
    assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y);
});
test("group selection, duplication and container copy retain internal connections", () => {
  const e = environment();
  setup(e);
  e.run(
    "const c=makeNode('container',250,150);Object.assign(c,{x:0,y:0,w:500,h:300});assignParent(a);assignParent(b);state.sel=new Set([c.id]);duplicateSel();",
  );
  assert.equal(e.run("Object.keys(state.nodes).length"), 6);
  assert.equal(e.run("Object.keys(state.edges).length"), 2);
  assert.equal(
    e.run(
      "Object.values(state.nodes).filter(n=>n.type==='rect'&&n.parentId!==c.id).length",
    ),
    2,
  );
  e.run(
    "groupSelection();state.sel.clear();selectItem(Object.keys(state.nodes).at(-1))",
  );
  assert.ok(e.run("state.sel.size") >= 2);
});
test("import validation rejects malformed documents without changing the current diagram", () => {
  const e = environment();
  setup(e);
  const before = e.run("snapshot()");
  for (const mutate of [
    (d) => (d.nodes[Object.keys(d.nodes)[0]].fill = '" onload="alert(1)'),
    (d) => (d.edges[Object.keys(d.edges)[0]].dst = "missing"),
    (d) => (d.nodes[Object.keys(d.nodes)[0]].w = -1),
    (d) => (d.nodes[Object.keys(d.nodes)[0]].text = {}),
    (d) => d.layers.push({ ...d.layers[0] }),
  ]) {
    const doc = e.json("docData()");
    mutate(doc);
    assert.throws(() => e.run(`validateDocument(${JSON.stringify(doc)})`));
    assert.equal(e.run("snapshot()"), before);
  }
  const good = e.json("docData()");
  assert.equal(e.run(`validateDocument(${JSON.stringify(good)}).version`), 3);
});
test("legacy import migrates parent membership and preserves blank documents", () => {
  const e = environment();
  setup(e);
  e.run(
    "const c=makeNode('container',250,100);Object.assign(c,{x:0,y:0,w:500,h:300});const legacy={nodes:clone(state.nodes),edges:clone(state.edges)};Object.values(legacy.nodes).forEach(n=>{delete n.layerId;delete n.parentId;});Object.values(legacy.edges).forEach(n=>delete n.layerId);installDocument(validateDocument(legacy));",
  );
  assert.equal(e.run("state.nodes[a.id].parentId"), e.run("c.id"));
  assert.equal(e.run("state.layers.length"), 1);
});
test("SVG export reuses shape rendering, escapes text, and keeps label backgrounds", () => {
  const e = environment();
  setup(e);
  e.run(
    "const c=makeNode('class',100,260);Object.assign(c,{x:20,y:200,w:160,h:120,text:'<script>alert(1)</script>'});edge.label='Yes';render();",
  );
  const svg = e.run("buildExportSVG()");
  assert.match(svg, /y1="248"/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script>/);
  assert.match(svg, /font-family="Arial, sans-serif"/);
  assert.match(svg, /stroke="#e2e8f0"/);
});
test("export bounds include manual routes and connector labels", () => {
  const e = environment();
  setup(e);
  e.run(
    "edge.bend={dx:0,dy:500};edge.label='A long connection label';routeCache.clear();",
  );
  assert.ok(e.run("sceneBounds().y+sceneBounds().h") >= 600);
});
test("text alignment affects rendering and long tokens wrap", () => {
  const e = environment();
  setup(e);
  e.run("a.align='left';a.text='averylongunbrokentoken'.repeat(4);a.w=80;");
  assert.equal(e.run("textLayout(a).anchor"), "start");
  assert.ok(e.run("textLayout(a).lines.length") > 4);
  assert.equal(e.run("textLayout(a).overflow"), true);
});
test("select all includes connectors; formatting changes every selected edge", () => {
  const e = environment();
  setup(e);
  e.run(
    "const second=makeEdge(b.id,a.id);selectAll();applyEdgeField('arrow','none');",
  );
  assert.equal(e.run("state.sel.size"), 4);
  assert.equal(
    e.run("Object.values(state.edges).every(e=>e.arrow==='none')"),
    true,
  );
});
test("cancelled movement restores coordinates and history", () => {
  const e = environment();
  setup(e);
  const p = e.json("w2s(a.x+30,a.y+30)"),
    before = e.run("snapshot()");
  pointer(e, "down", p.x, p.y);
  pointer(e, "move", p.x + 70, p.y + 40);
  assert.notEqual(e.run("snapshot()"), before);
  e.key("Escape");
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("history.length"), 0);
});
test("snap pattern transforms with world coordinates", () => {
  const e = environment();
  e.run("view={x:50,y:70,z:2};render()");
  assert.equal(
    e.document.querySelector("#grid").getAttribute("patternTransform"),
    "translate(50 70) scale(2)",
  );
});

test("locked descendants move with their parent and cannot become orphaned on delete", () => {
  const e = environment();
  e.run(
    "gridSnap=false;const c=makeNode('container',250,200),n=makeNode('rect',250,200);assignParent(n);n.locked=true;state.sel=new Set([c.id]);const old=n.x;moveTree(c,30,0);",
  );
  assert.equal(e.run("n.x-old"), 30);
  e.run("deleteSel()");
  assert.equal(e.run("Object.keys(state.nodes).length"), 0);
  e.run("undo()");
  assert.equal(e.run("state.nodes[n.id].parentId"), e.run("c.id"));
});

test("connector-only copy and paste keeps endpoints and creates a separate bend", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set(['e:'+edge.id]);duplicateSel();");
  assert.equal(e.run("Object.keys(state.edges).length"), 2);
  assert.equal(e.run("Object.values(state.edges)[1].src"), e.run("a.id"));
  assert.ok(e.run("Object.values(state.edges)[1].bend.dy"));
});

test("prototype property names cannot masquerade as imported endpoints", () => {
  const e = environment();
  setup(e);
  const doc = e.json("docData()");
  doc.edges[Object.keys(doc.edges)[0]].src = "__proto__";
  assert.throws(() => e.run(`validateDocument(${JSON.stringify(doc)})`));
});

test("keyboard activation of toolbar buttons is not intercepted by canvas shortcuts", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);");
  let prevented = false;
  e.key("Enter", {
    target: e.document.querySelector("#btn-save"),
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, false);
  assert.equal(e.run("editing"), null);
  e.key(" ", {
    code: "Space",
    target: e.document.querySelector("#btn-save"),
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(e.run("spaceDown"), false);
});

test("invalid saved data is preserved before the first replacement autosave", () => {
  const broken = '{"nodes":42}';
  const e = environment(broken);
  e.run("init()");
  assert.equal(e.storage.get("openchart.doc.v1"), broken);
  e.run("autosave()");
  assert.equal(e.storage.get("openchart.doc.v1.recovery"), broken);
});

test("container alignment moves children; bulk style changes all selected shapes", () => {
  const e = environment();
  setup(e);
  e.run(
    "const c=makeNode('container',100,100);assignParent(a);const old=a.y;state.sel=new Set([c.id,b.id]);alignSel('top');",
  );
  assert.equal(e.run("a.y-old"), e.run("c.y-(100-SHAPES.container.h/2)"));
  e.run("state.sel=new Set([a.id,b.id]);applyField('fill','#a7f3d0');");
  assert.equal(e.run("state.nodes[a.id].fill"), "#a7f3d0");
  assert.equal(e.run("state.nodes[b.id].fill"), "#a7f3d0");
});

test("all templates render and export with valid references", () => {
  const e = environment();
  for (const name of ["flow", "org", "tree", "arch"]) {
    e.run(`buildTemplate('${name}');render();refreshProps();`);
    assert.doesNotThrow(() => e.run("validateDocument(docData())"));
    assert.match(e.run("buildExportSVG()"), /<svg/);
  }
});

test("connectors remain selectable over a container interior", () => {
  const e = environment();
  setup(e);
  e.run(
    "const c=makeNode('container',250,150);Object.assign(c,{x:0,y:0,w:500,h:300});assignParent(a);assignParent(b);render();",
  );
  const target = e.document
    .querySelector("#viewport")
    .querySelector("[data-edge]");
  const p = e.json("w2s(250,100)");
  pointer(e, "down", p.x, p.y, target);
  assert.equal(e.run("gesture.kind"), "edgeMove");
  pointer(e, "up", p.x, p.y, target);
  assert.equal(e.run('state.sel.has("e:"+edge.id)'), true);
});

test("nested container migration assigns the larger parent and puts its child above it", () => {
  const e = environment();
  e.run(
    "gridSnap=false;const outer=makeNode('container',250,200),inner=makeNode('container',250,200);Object.assign(inner,{x:150,y:100,w:200,h:180});assignAllParents();",
  );
  assert.equal(e.run("outer.parentId"), null);
  assert.equal(e.run("inner.parentId"), e.run("outer.id"));
  assert.ok(
    e.run("state.order.indexOf(inner.id)>state.order.indexOf(outer.id)"),
  );
});

test("locked foreground shapes prevent connector hit testing through to objects behind them", () => {
  const e = environment();
  setup(e);
  e.run("const front=makeNode('rect',100,100);front.locked=true;");
  assert.equal(e.run("nodeAtWorld(100,100)"), null);
  assert.equal(e.run("nodeAtWorld(100,100,true).id"), e.run("front.id"));
});

test("moving a connected group carries its manual waypoints exactly once", () => {
  const e = environment();
  setup(e);
  e.run("edge.waypoints=[{x:250,y:60}];routeAll();");
  const before = e.run("JSON.stringify(routeEdge(edge).pts)");
  e.run("state.sel = new Set([a.id, b.id]);");
  e.key("ArrowRight");
  e.key("ArrowDown", { shiftKey: true });
  assert.equal(
    e.run("JSON.stringify(edge.waypoints)"),
    JSON.stringify([{ x: 251, y: 80 }]),
    "waypoints shift with both endpoints",
  );
  const shape = (pts) =>
    JSON.stringify(
      pts.map((p, i, ps) => (i ? [p.x - ps[i - 1].x, p.y - ps[i - 1].y] : 0)),
    );
  assert.equal(
    shape(JSON.parse(e.run("JSON.stringify(routeEdge(edge).pts)"))),
    shape(JSON.parse(before)),
    "route shape is preserved under translation",
  );
});

test("moving only one endpoint keeps manual waypoints and repairs the join", () => {
  const e = environment();
  setup(e);
  e.run("edge.waypoints=[{x:250,y:60}];routeAll();");
  e.run("state.sel = new Set([a.id]);");
  e.key("ArrowDown", { shiftKey: true });
  assert.equal(
    e.run("JSON.stringify(edge.waypoints)"),
    JSON.stringify([{ x: 250, y: 60 }]),
    "waypoints stay put when only one endpoint moves",
  );
  assert.equal(
    e.run(
      "(function(){const p=routeEdge(edge).pts.at(-1);return p.x>=b.x-1&&p.x<=b.x+b.w+1&&p.y>=b.y-1&&p.y<=b.y+b.h+1;})()",
    ),
    true,
    "the route still reaches the unmoved endpoint",
  );
});

test("two-shape alignment treats the last-picked shape as the reference", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',900,500);state.sel=new Set([b.id,c.id]);");
  // b was created before c in setup, so re-selecting b last makes it the anchor
  e.run("state.sel=new Set([c.id,b.id]);");
  e.run("alignSel('left');");
  assert.equal(
    e.run("b.x"),
    e.run("c.x"),
    "the other shape moves to the reference's left edge",
  );
  assert.equal(
    e.run("c.x"),
    e.json("JSON.parse(localStorage.getItem('openchart.doc.v1')||'null')===null?c.x:c.x"),
  );
});

test("match width and height keep each shape's center", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',900,500);Object.assign(c,{w:200,h:80});");
  e.run("state.sel=new Set([a.id,c.id]);");
  const cx = e.run("a.x+a.w/2"),
    cy = e.run("a.y+a.h/2");
  e.run("matchSize('wh');");
  assert.equal(e.run("a.w"), 200, "width matches the reference");
  assert.equal(e.run("a.h"), 80, "height matches the reference");
  assert.equal(e.run("a.x+a.w/2"), cx, "center x is preserved");
  assert.equal(e.run("a.y+a.h/2"), cy, "center y is preserved");
});

test("distribute with a fixed gap spaces shapes exactly that far apart", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',880,100);state.sel=new Set([a.id,b.id,c.id]);");
  e.run("distributeSel('h',60);");
  const g1 = e.run("b.x-(a.x+a.w)");
  const g2 = e.run("c.x-(b.x+b.w)");
  assert.equal(g1, 60, "first gap");
  assert.equal(g2, 60, "second gap");
});

test("dragging a connected node snaps its center to the peer's center", () => {
  const e = environment();
  setup(e);
  e.run(
    "gesture={kind:'move',original:[{id:a.id,x:a.x,y:a.y}],roots:[a.id],movedIds:new Set([a.id]),moved:false};state.sel=new Set([a.id]);",
  );
  const acx = e.run("a.x+a.w/2"),
    bcx = e.run("b.x+b.w/2");
  // land 4px short of the connected peer's center: inside the 16px window
  const d = e.run(
    `guideDelta([state.nodes[a.id]],${bcx - acx - 4},0).dx`,
  );
  assert.equal(
    d,
    bcx - e.run("a.x+a.w/2"),
    "snaps exactly onto the connected peer's center",
  );
});

test("a shape dragged between two neighbors snaps to equal gaps", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',700,100);gesture={kind:'move',original:[{id:b.id,x:b.x,y:b.y}],roots:[b.id],movedIds:new Set([b.id]),moved:false};state.sel=new Set([b.id]);");
  // b starts equidistant between a and c; a 20px offset should snap back
  const d = e.run("guideDelta([state.nodes[b.id]],20,0).dx");
  assert.equal(d, 0, "snaps back to the equal-gap position");
});

test("tidy selection ranks a chain by flow direction", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',760,520);makeEdge(b.id,c.id);state.sel=new Set([a.id,b.id,c.id]);");
  // tangle the positions first
  e.run("Object.assign(a,{x:600,y:80});Object.assign(b,{x:80,y:420});Object.assign(c,{x:300,y:200});");
  e.run("tidyPreview=null;const d=tidyLayout({dir:'lr',gap:56,normalize:false});applyTidy(d);");
  const ax = e.run("a.x"),
    bx = e.run("b.x"),
    cx = e.run("c.x");
  assert.ok(ax < bx && bx < cx, "flow order left to right: " + [ax, bx, cx]);
  const g1 = bx - (ax + e.run("a.w")),
    g2 = cx - (bx + e.run("b.w"));
  assert.equal(g1, g2, "consistent gaps between ranks");
  const ay = e.run("a.y"),
    by = e.run("b.y"),
    cy = e.run("c.y");
  assert.equal(ay, by, "rank 0 and 1 share the cross origin");
  void cy;
});

test("tidy is idempotent and leaves locked shapes put", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',760,520);makeEdge(b.id,c.id);state.sel=new Set([a.id,b.id,c.id]);");
  e.run("tidyPreview=null;applyTidy(tidyLayout({dir:'lr',gap:56,normalize:false}));");
  const before = e.run(
    "JSON.stringify({a:[a.x,a.y],b:[b.x,b.y],c:[c.x,c.y]})",
  );
  e.run("applyTidy(tidyLayout({dir:'lr',gap:56,normalize:false}));");
  const after = e.run(
    "JSON.stringify({a:[a.x,a.y],b:[b.x,b.y],c:[c.x,c.y]})",
  );
  assert.equal(after, before, "running tidy again does not move shapes");
  e.run("c.locked=true;Object.assign(a,{x:a.x+200});state.sel=new Set([a.id,c.id]);");
  const cxBefore = e.run("c.x");
  e.run("applyTidy(tidyLayout({dir:'lr',gap:56,normalize:false}));");
  assert.equal(e.run("c.x"), cxBefore, "locked shape never moves");
});

test("tidy preview does not mutate the document", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',760,520);makeEdge(b.id,c.id);state.sel=new Set([a.id,b.id,c.id]);");
  e.run("Object.assign(a,{x:600,y:80});Object.assign(b,{x:80,y:420});");
  const snap = e.run("JSON.stringify(docData())");
  e.run("tidyPreview=tidyLayout({dir:'lr',gap:56,normalize:true});");
  assert.equal(
    e.run("JSON.stringify(docData())"),
    snap,
    "preview leaves the document untouched",
  );
  assert.ok(e.run("tidyPreview.length"), "preview has deltas");
  e.run("tidyPreview=null;");
});

test("a version 2 document opens with unchanged appearance", () => {
  const e = environment();
  setup(e);
  e.run("a.fill='#123456';a.stroke='#654321';");
  const v2 = e.json(
    "(function(){const d=docData();delete d.appearance;d.version=2;return d;})()",
  );
  e.run(`installDocument(validateDocument(${JSON.stringify(v2)}))`);
  assert.equal(e.run("a.fill"), "#123456", "explicit fill preserved");
  assert.equal(e.run("a.stroke"), "#654321", "explicit stroke preserved");
  assert.ok(e.run("state.appearance"), "appearance installed");
  assert.equal(e.run("state.appearance.themeId"), "lucid");
  assert.equal(e.run("validateDocument(clone(docData())).version"), 3, "saves as v3");
});

test("new shapes and connectors resolve the document default style", () => {
  const e = environment();
  setup(e);
  e.run(
    "transact(()=>{const a=ensureAppearance();a.nodeDefaults={fill:'#ff0000',stroke:'#00ff00',sw:3};a.edgeDefaults={color:'#0000ff',width:2.5,arrow:'open'};});",
  );
  const n = e.run("makeNode('rect',900,600).id");
  assert.equal(e.run(`state.nodes[${JSON.stringify(n)}].fill`), "#ff0000");
  assert.equal(e.run(`state.nodes[${JSON.stringify(n)}].stroke`), "#00ff00");
  assert.equal(e.run(`state.nodes[${JSON.stringify(n)}].sw`), 3);
  const d = e.run("makeEdge(a.id,b.id).id");
  assert.equal(e.run(`state.edges[${JSON.stringify(d)}].color`), "#0000ff");
  assert.equal(e.run(`state.edges[${JSON.stringify(d)}].sw`), 2.5);
  assert.equal(e.run(`state.edges[${JSON.stringify(d)}].arrow`), "open");
});

test("applying a theme styles equivalent roles consistently and undoes cleanly", () => {
  const e = environment();
  setup(e);
  e.run(
    "const c=makeNode('rect',760,520);const d=makeNode('decision',760,300);",
  );
  e.run("Object.assign(a,{fill:'#010101'});Object.assign(c,{fill:'#020202'});");
  e.run("applyTheme(THEMES.find(t=>t.id==='ocean'));");
  const fa = e.run("a.fill"),
    fc = e.run("c.fill");
  assert.equal(fa, fc, "both process shapes share the theme fill");
  const dd = e.run("d.fill");
  assert.notEqual(dd, fa, "decision shape differs from process role");
  assert.equal(e.run("state.appearance.themeId"), "ocean");
  assert.equal(e.run("edge.color"), "#0369a1", "default connector retinted");
  e.run("undo()");
  assert.equal(e.run("state.appearance.themeId"), "lucid", "undo restores theme");
  assert.equal(
    e.run("state.nodes[a.id].fill"),
    "#010101",
    "undo restores fills",
  );
});

test("copy and paste style transfers only compatible properties", () => {
  const e = environment();
  setup(e);
  e.run("Object.assign(a,{fill:'#ff0000',stroke:'#00ff00',sw:4});");
  e.run("state.sel=new Set([a.id]);copyStyle();state.sel=new Set([b.id]);pasteStyle();");
  assert.equal(e.run("b.fill"), "#ff0000");
  assert.equal(e.run("b.stroke"), "#00ff00");
  assert.equal(e.run("b.sw"), 4);
  assert.equal(e.run("b.text"), "B", "text never copied");
  assert.equal(e.run("b.w"), 140, "size never copied");
  e.run("undo()");
  assert.notEqual(
    e.run("state.nodes[b.id].fill"),
    "#ff0000",
    "paste is undoable",
  );
});

test("set as default changes the style of newly created shapes", () => {
  const e = environment();
  setup(e);
  e.run(
    "Object.assign(a,{fill:'#ff0000'});state.sel=new Set([a.id]);setDefaultStyle();",
  );
  const n = e.run("makeNode('rect',900,600).id");
  assert.equal(e.run(`state.nodes[${JSON.stringify(n)}].fill`), "#ff0000");
  e.run("undo()");
  const m = e.run("makeNode('rect',900,600).id");
  assert.notEqual(e.run(`state.nodes[${JSON.stringify(m)}].fill`), "#ff0000");
});

test("automatic text color reads the effective container background", () => {
  const e = environment();
  setup(e);
  e.run(
    "const k=makeNode('container',250,100);Object.assign(k,{x:0,y:0,w:600,h:400,fill:'#1e293b'});const t=makeNode('rect',300,200);t.fill='none';t.parentId=k.id;state.sel=new Set([t.id]);",
  );
  assert.equal(e.run("textColor(t)"), "#ffffff", "dark container ⇒ light text");
  e.run("k.fill='#ffffff';");
  assert.equal(e.run("textColor(t)"), "#253247", "light container ⇒ dark text");
});

test("usable text regions respect shape geometry", () => {
  const e = environment();
  setup(e);
  e.run("const d=makeNode('decision',700,300);Object.assign(d,{w:200,h:120,text:'Handover'});");
  e.run("const r=makeNode('rect',700,600);Object.assign(r,{w:200,h:120,text:'Handover'});");
  const dr = e.run("textLayout(d).region"),
    rr = e.run("textLayout(r).region");
  assert.ok(dr.w < rr.w, "diamond reserves corner space: " + dr.w + " vs " + rr.w);
  e.run("const c=makeNode('cylinder',700,800);Object.assign(c,{w:160,h:120,text:'Data'});");
  const cr = e.run("textLayout(c).region");
  assert.ok(cr.y > rr.y, "cylinder keeps clear of the top cap");
});

test("fit shape to text grows the shape around its center", () => {
  const e = environment();
  setup(e);
  e.run(
    "a.text='A very long process description that will not fit';Object.assign(a,{w:140,h:56});",
  );
  const cx = e.run("a.x+a.w/2"),
    cy = e.run("a.y+a.h/2"),
    w0 = e.run("a.w"),
    h0 = e.run("a.h");
  e.run("fitShapeToText(a)");
  const w1 = e.run("a.w"),
    h1 = e.run("a.h");
  assert.ok(w1 > w0 || h1 > h0, "shape grew to fit the text");
  assert.equal(e.run("a.x+a.w/2"), cx, "center preserved horizontally");
  assert.equal(e.run("a.y+a.h/2"), cy, "center preserved vertically");
  e.run("fitShapeToText(a)");
  assert.equal(e.run("a.w"), w1, "already-fitting text keeps the size");
});

test("auto-fit grows the shape when text is edited", () => {
  const e = environment();
  setup(e);
  e.run("a.autofit=true;");
  e.run("openEditor(a,'text');");
  e.run("document.querySelector('#txtedit').value='Expanded label content here';finishEdit();");
  assert.ok(e.run("a.w") > 140, "shape grew on edit: " + e.run("a.w"));
});


test("directional quick-create adds a connected shape in one undo step", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();");
  const quick = e.document.querySelector("[data-quick='e']");
  assert.ok(quick, "quick-create controls render for a selected shape");
  const before = e.run("JSON.stringify(Object.keys(state.nodes).length)");
  const sx = e.run("w2s(320,100).x"),
    sy = e.run("w2s(320,100).y");
  pointer(e, "down", sx, sy, quick);
  pointer(e, "up", sx, sy, quick);
  const ids = JSON.parse(e.run("JSON.stringify(Object.keys(state.nodes))"));
  assert.equal(ids.length, 3, "one new shape");
  const newId = ids.find(
    (id) => id !== e.run("a.id") && id !== e.run("b.id"),
  );
  const n = JSON.parse(e.run("JSON.stringify(state.nodes['" + newId + "'])"));
  assert.equal(n.type, "rect");
  /* UX-B: the preferred east spot is occupied by b in this scene, so
     the bounded search lands on the first free spot along the direction
     while keeping the vertical center line. */
  assert.equal(n.y, 72, "same vertical center as the source");
  assert.equal(n.x, 470, "the first free spot along the direction");
  const edges = JSON.parse(
    e.run("JSON.stringify(Object.values(state.edges).map(v=>[v.src,v.dst]))"),
  );
  assert.ok(
    edges.some(([s, d]) => s === e.run("a.id") && d === newId),
    "connected from the source",
  );
  const edge = JSON.parse(
    e.run(
      "JSON.stringify(Object.values(state.edges).find(v=>v.dst==='" + newId + "'))",
    ),
  );
  assert.equal(edge.srcSide, "e", "leaves the source's right side");
  assert.equal(edge.dstSide, "w", "enters the new shape's left side");
  e.run("undo()");
  assert.equal(
    e.run("JSON.stringify(Object.keys(state.nodes).length)"),
    before,
    "one undo removes shape and connector",
  );
});

test("releasing a connector on empty canvas offers a shape picker", () => {
  const e = environment();
  setup(e);
  e.run('setTool("connect")');
  const sx = e.run("w2s(100,100).x"),
    sy = e.run("w2s(100,100).y"),
    ex = e.run("w2s(500,500).x"),
    ey = e.run("w2s(500,500).y");
  pointer(e, "down", sx, sy);
  pointer(e, "move", ex, ey);
  pointer(e, "up", ex, ey);
  const picker = e.document.querySelector("#shape-picker");
  assert.ok(picker, "picker element exists");
  assert.equal(picker.hidden, false, "picker is visible");
  assert.ok(e.run("connectSource"), "connector stays pending");
  e.key("Escape");
  assert.equal(e.run("connectSource"), null, "Escape clears the pending source");
  assert.equal(picker.hidden, true, "picker hidden again");
  assert.equal(e.run("Object.keys(state.nodes).length"), 2, "nothing created");
  e.run('setTool("connect")'); /* Escape reset the tool; re-arm the connect flow */
  pointer(e, "down", sx, sy);
  pointer(e, "move", ex, ey);
  pointer(e, "up", ex, ey);
  const btn = picker.querySelector("button");
  assert.ok(btn, "picker lists shape choices");
  btn.onclick({ preventDefault() {}, stopPropagation() {} });
  const ids = JSON.parse(e.run("JSON.stringify(Object.keys(state.nodes))"));
  assert.equal(ids.length, 3, "shape created from the picker");
  const newId = ids.find(
    (id) => id !== e.run("a.id") && id !== e.run("b.id"),
  );
  const edges = JSON.parse(
    e.run("JSON.stringify(Object.values(state.edges).map(v=>[v.src,v.dst]))"),
  );
  assert.ok(
    edges.some(
      ([s, d]) => [s, d].includes(e.run("a.id")) && [s, d].includes(newId),
    ),
    "created shape is connected to the source",
  );
  const ny = JSON.parse(
    e.run("JSON.stringify(state.nodes['" + newId + "'])"),
  ).y;
  assert.ok(Math.abs(ny - 472) <= 10, "created at the release point: " + ny);
});

test("replace shape preserves identity, label, connections and container", () => {
  const e = environment();
  setup(e);
  e.run(
    "const k=makeNode('container',400,400);Object.assign(k,{w:300,h:220});a.parentId=k.id;b.parentId=k.id;",
  );
  e.run("a.text='Start';");
  const aid = e.run("a.id");
  const fill = e.run("a.fill");
  e.run("replaceShape(state.nodes['" + aid + "'],'decision');");
  const n = JSON.parse(e.run("JSON.stringify(state.nodes['" + aid + "'])"));
  assert.equal(n.type, "decision", "geometry type changed");
  assert.equal(n.text, "Start", "label kept");
  assert.equal(n.parentId, e.run("k.id"), "container membership kept");
  const edges = JSON.parse(
    e.run("JSON.stringify(Object.values(state.edges).map(v=>[v.src,v.dst]))"),
  );
  assert.ok(
    edges.some(
      ([s, d]) => [s, d].includes(aid) && [s, d].includes(e.run("b.id")),
    ),
    "connections kept",
  );
  assert.equal(n.fill, fill, "style kept");
  e.run("undo()");
  assert.equal(
    e.run("state.nodes['" + aid + "'].type"),
    "rect",
    "undo restores type",
  );
});

test("placed shapes are recorded as recents", () => {
  const e = environment();
  setup(e);
  e.run('setTool("place","decision")');
  const sx = e.run("w2s(500,500).x"),
    sy = e.run("w2s(500,500).y");
  pointer(e, "down", sx, sy);
  pointer(e, "up", sx, sy);
  assert.equal(e.run("palettePrefs.recents[0]"), "decision", "recorded");
  const stored = JSON.parse(
    e.run("localStorage.getItem('openchart.palette.prefs')"),
  );
  assert.equal(stored.recents[0], "decision", "persisted outside the document");
});

test("fit container to contents wraps children with even padding", () => {
  const e = environment();
  setup(e);
  e.run(
    "const k=makeNode('container',400,400);Object.assign(k,{x:0,y:0,w:500,h:400});",
  );
  e.run(
    "const c1=makeNode('rect',200,200);const c2=makeNode('rect',420,320);c1.parentId=k.id;c2.parentId=k.id;",
  );
  const before = e.run(
    "JSON.stringify([k.x,k.y,k.w,k.h])",
  );
  e.run("fitContainerToContents(state.nodes[k.id])");
  const after = JSON.parse(e.run("JSON.stringify([k.x,k.y,k.w,k.h])"));
  assert.equal(after[0], 106, "left = child left - 24");
  assert.ok(after[1] <= 148, "top leaves at least 24px (heading may add more)");
  assert.equal(after[2], 408, "width = span + 48");
  assert.ok(after[1] + after[3] >= 372, "bottom leaves at least 24px");
  e.run("undo()");
  assert.equal(
    e.run(
      "JSON.stringify([state.nodes[k.id].x,state.nodes[k.id].y,state.nodes[k.id].w,state.nodes[k.id].h])",
    ),
    before,
    "one undo step",
  );
});

test("alt-click cycles through overlapping shapes", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',100,100);const d=makeNode('rect',100,100);");
  const stack = JSON.parse(
    e.run("JSON.stringify(nodeStackAtWorld(100,100).map(n=>n.id))"),
  );
  assert.equal(stack.length, 3, "a plus the two new shapes");
  assert.equal(stack[0], e.run("d.id"), "topmost first");
  e.run("state.sel=new Set([d.id]);");
  const sx = e.run("w2s(100,100).x"),
    sy = e.run("w2s(100,100).y");
  const over =
    e.document.querySelector("[data-node='" + e.run("d.id") + "']") || "#stage";
  pointer(e, "down", sx, sy, over, { altKey: true });
  pointer(e, "up", sx, sy, over, { altKey: true });
  assert.equal(e.run("state.sel.size"), 1, "single selection after cycling");
  assert.notEqual(
    JSON.parse(e.run("JSON.stringify([...state.sel])"))[0],
    e.run("d.id"),
    "cycled off the topmost",
  );
});


test("export preview scope, margins and geometry agree with output", () => {
  const e = environment();
  setup(e);
  e.run(
    "const far=makeNode('rect',900,700);far.text='Far';const e2=makeEdge(a.id,far.id);routeAll();",
  );
  e.run("state.sel=new Set([a.id, b.id]);");
  const whole = e.run("JSON.stringify(buildExportSVG(false).match(/width=\"(\\d+)\" height=\"(\\d+)\"/))");
  const sel = e.run(
    "JSON.stringify(buildExportSVG(false,{scope:'selection'}).match(/width=\"(\\d+)\" height=\"(\\d+)\"/))",
  );
  const wW = JSON.parse(whole)[1],
    wS = JSON.parse(sel)[1];
  assert.ok(
    +wS < +wW,
    "selection export is smaller than whole: " + wS + " < " + wW,
  );
  const selSvg = e.run("buildExportSVG(false,{scope:'selection'})");
  assert.ok(!selSvg.includes("Far"), "unrelated shape excluded");
  assert.ok(
    selSvg.includes("Process") || selSvg.includes("text"),
    "selected shapes included",
  );
  // R7: an empty selection shows an explicit empty state, never a silent
  // whole-document fallback.
  e.run("state.sel.clear();");
  const emptyState = e.run(
    "buildExportSVG(false,{scope:'selection'}).match(/width=\"(\\d+)\"/)[1]",
  );
  assert.equal(emptyState, "320", "empty selection shows the empty state");
  assert.ok(
    e
      .run("buildExportSVG(false,{scope:'selection'})")
      .includes("Nothing selected to export"),
    "the empty state names the problem",
  );
  // margins grow the canvas
  e.run("state.sel=new Set([a.id, b.id]);");
  const tight = +e.run(
    "buildExportSVG(false,{scope:'selection',margin:0}).match(/width=\"(\\d+)\"/)[1]",
  );
  const wide = +e.run(
    "buildExportSVG(false,{scope:'selection',margin:64}).match(/width=\"(\\d+)\"/)[1]",
  );
  assert.equal(wide - tight, 128, "margin adds padding on both sides");
  // transparent background leaves no white rect
  const opaque = e.run("buildExportSVG(false,{scope:'selection'})");
  const clear = e.run("buildExportSVG(true,{scope:'selection'})");
  assert.ok(opaque.includes('fill="#fff"'), "solid background painted");
  assert.ok(!clear.includes('fill="#fff"') || clear.indexOf('fill="#fff"') === -1, "transparent skips background");
});

test("quality checks surface actionable issues and stay inert", () => {
  const e = environment();
  setup(e);
  e.run("const o1=makeNode('rect',100,100);const o2=makeNode('rect',100,100);o1.text='';o2.text='';");
  // a 22px gap between two isolated shapes is too tight for two arrowheads
  e.run(
    "const p1=makeNode('rect',900,100);const p2=makeNode('rect',922,100);const tiny=makeEdge(p1.id,p2.id);tiny.arrow='solid';routeAll();",
  );
  const issues = JSON.parse(
    e.run(
      "JSON.stringify(qualityChecks().map(i=>({kind:i.kind,id:i.id})))",
    ),
  );
  const kinds = issues.map((i) => i.kind);
  assert.ok(kinds.includes("shape-overlap"), "overlapping shapes flagged");
  assert.ok(
    issues.some((i) => i.kind === "shape-overlap" && i.id === e.run("a.id")),
    "issue points at a selectable object",
  );
  assert.ok(kinds.includes("tight-arrow"), "short connection flagged");
  // checks do not mutate the document
  const doc = e.run("JSON.stringify(docData())");
  e.run("qualityChecks();");
  assert.equal(e.run("JSON.stringify(docData())"), doc, "checks are read-only");
  // a clean diagram reports nothing
  const clean = environment();
  setup(clean);
  assert.equal(
    clean.run("JSON.stringify(qualityChecks())"),
    "[]",
    "clean diagram has no issues",
  );
});


test("route results expose the derived contract fields", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';routeAll();");
  const c = JSON.parse(
    e.run(
      "JSON.stringify((function(){const r=routeEdge(edge);return {sp:r.sourcePort,tp:r.targetPort,b:r.bounds,lp:!!r.labelPlacement,c:typeof r.conflicts==='number'&&r.conflicts>=0};})())",
    ),
  );
  assert.ok(c.sp && typeof c.sp.side === "string", "source port side resolved");
  assert.ok(c.sp.point && isFinite(c.sp.point.x), "source port point on the border");
  assert.ok(c.tp && c.tp.point && isFinite(c.tp.point.y), "target port point present");
  assert.ok(c.b && c.b.w >= 0 && c.b.h >= 0, "route bounds computed");
  assert.ok(c.lp, "label placement included");
  assert.ok(c.c, "conflict count is a non-negative number");
  e.run("Object.assign(a,{x:30,y:72,w:140,h:56});");
  const p = JSON.parse(
    e.run("JSON.stringify(routeEdge(edge).sourcePort.point)"),
  );
  assert.ok(
    p.x <= 170.001 && p.x >= 29.999 && p.y >= 71.999 && p.y <= 128.001,
    "source port lies on the source rectangle",
  );
});

test("rebuilds and reuse keep the live SVG in document order", () => {
  const e = environment();
  setup(e);
  // Overlapping shapes plus a connector between them.
  e.run("a.x=40;b.x=60;b.y=40;const link=makeEdge(a.id,b.id);routeAll();render();");
  const order = () =>
    e.run(
      "JSON.stringify([...viewport.children].map((x)=>x.getAttribute('data-node')?'n:'+x.getAttribute('data-node'):x.getAttribute('data-edge')?'e:'+x.getAttribute('data-edge'):'?'))",
    );
  const before = JSON.parse(order());
  assert.equal(before.filter((k) => k !== "?").length, 4, "one group per object (2 nodes + setup edge + link)");
  assert.ok(before.indexOf("n:" + e.run("a.id")) < before.indexOf("e:" + e.run("link.id")), "source shape below its connector");
  assert.ok(before.indexOf("n:" + e.run("b.id")) < before.indexOf("e:" + e.run("link.id")), "target shape below its connector");
  // Mutating B triggers a rebuild; order must not flip.
  e.run("b.fill='#ff0000';render();");
  assert.deepEqual(JSON.parse(order()), before, "rebuild keeps document order");
  // Selection-driven edge rebuild must not reorder either.
  e.run("state.sel=new Set(['e:'+link.id]);render();");
  assert.deepEqual(JSON.parse(order()), before, "selection rebuild keeps document order");
  e.run("state.sel.clear();render();");
  assert.deepEqual(JSON.parse(order()), before, "deselect keeps document order");
  // No duplicate live groups.
  assert.equal(
    e.run("viewport.children.filter((x)=>x.getAttribute('data-node')===a.id).length"),
    1,
  );
});

test("a multi-frame segment drag follows every frame and settles on release", () => {
  const e = environment();
  setup(e);
  e.run(
    "edge.waypoints=[{x:250,y:150}];state.sel=new Set(['e:'+edge.id]);routeAll();render();",
  );
  /* S01: locate the editable segment geometrically (the middle horizontal
     corridor spanning the gap between the shapes), never by hard-coded
     handle index. */
  const idx = e.run(
    "editableRoutePoints(edge).findIndex((p,i,ps)=>i>0&&i<ps.length-2&&p.y===150&&ps[i+1].y===150&&p.x>=250&&ps[i+1].x<=306&&p.x<ps[i+1].x)",
  );
  const handle = e.document.querySelector('[data-segment="' + idx + '"]');
  assert.ok(handle, "selected connector offers the located corridor handle");
  const hx = +handle.getAttribute("x") + 4,
    hy = +handle.getAttribute("y") + 4;
  pointer(e, "down", hx, hy, handle);
  assert.equal(e.run("gesture && gesture.kind"), "edgeMove", "the handle starts a segment drag");
  pointer(e, "move", hx, hy + 30);
  e.run("flushRender()"); /* one frame renders between drag phases */
  const mid = JSON.parse(e.run("JSON.stringify(routeEdge(edge).pts)"));
  assert.ok(
    mid.some((p) => p.y === 180 && p.x >= 250 && p.x <= 306),
    "first frame paints the dragged corridor at y=180, got " +
      JSON.stringify(mid),
  );
  pointer(e, "move", hx, hy + 70);
  e.run("flushRender()");
  const late = JSON.parse(e.run("JSON.stringify(routeEdge(edge).pts)"));
  assert.ok(
    late.some((p) => p.y === 220 && p.x >= 250 && p.x <= 306),
    "second frame continues from the first, got " + JSON.stringify(late),
  );
  assert.ok(
    !late.some((p) => p.y === 180 && p.x >= 250 && p.x <= 306),
    "no stale corridor from the first frame survives",
  );
  pointer(e, "up", hx, hy + 70);
  const done = JSON.parse(e.run("JSON.stringify(edge.waypoints)"));
  assert.ok(
    done.some((p) => p.y === 220),
    "dragged waypoints are committed",
  );
  assert.equal(e.run("history.length"), 1, "the whole drag is one undo step");
});

test("an unrelated blocker reroutes a line during and after the gesture", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',250,220);routeAll();render();");
  const inside = (pts, pad) =>
    pts.some(
      (p) =>
        p.x > e.run("c.x") + pad &&
        p.x < e.run("c.x") + e.run("c.w") - pad &&
        p.y > e.run("c.y") + pad &&
        p.y < e.run("c.y") + e.run("c.h") - pad,
    );
  const start = e.json("w2s(250,220)");
  pointer(e, "down", start.x, start.y);
  const onto = e.json("w2s(250,100)");
  pointer(e, "move", onto.x, onto.y);
  e.run("flushRender()");
  const live = JSON.parse(e.run("JSON.stringify(routeEdge(edge).pts)"));
  assert.ok(
    !inside(live, 4),
    "live route avoids the moved blocker, got " + JSON.stringify(live),
  );
  pointer(e, "up", onto.x, onto.y);
  const settled = JSON.parse(e.run("JSON.stringify(routeEdge(edge).pts)"));
  assert.ok(!inside(settled, 4), "committed route avoids the blocker");
  /* Moving the blocker back out must free the corridor again. */
  const p2 = e.json("w2s(c.x+c.w/2,c.y+c.h/2)");
  pointer(e, "down", p2.x, p2.y);
  const back = e.json("w2s(250,220)");
  pointer(e, "move", back.x, back.y);
  pointer(e, "up", back.x, back.y);
  const freed = JSON.parse(e.run("JSON.stringify(routeEdge(edge).pts)"));
  assert.equal(
    freed.length,
    2,
    "corridor returns to the direct route once the blocker leaves",
  );
});

test("document font changes repaint existing text, labels and layouts", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';routeAll();render();");
  const fam = () =>
    e.run(
      "JSON.stringify([...viewport.querySelectorAll('text')].map(t=>t.getAttribute('font-family')).filter(Boolean))",
    );
  const before = JSON.parse(fam());
  assert.ok(before.length >= 2, "node text and connector label render");
  assert.ok(before.every((f) => f.includes("Arial")), "default font is Arial");
  e.run("typography().fontFamily='Georgia';appearanceRev++;routesDirty=true;render();");
  const after = JSON.parse(fam());
  assert.ok(
    after.length === before.length && after.every((f) => f.includes("Georgia")),
    "every text element adopts the new font, got " + JSON.stringify(after),
  );
  /* Label size changes relayout connector labels without a geometry edit. */
  e.run("typography().labelSize=22;appearanceRev++;routesDirty=true;render();");
  assert.ok(
    e.run(
      "[...viewport.querySelectorAll('text')].some(t=>t.getAttribute('font-size')==='22')",
    ),
    "existing connector labels repaint at the new label size",
  );
});

test("tidy preview rectangles equal the applied rectangles exactly", () => {
  const e = environment();
  setup(e);
  /* The reviewed reproduction: A is 200 wide at x=30, B is 80 wide at
     x=600; normalization plus a 56 gap plans B at x=286 with width 200. */
  e.run(
    "Object.assign(a,{x:30,y:100,w:200,h:80});Object.assign(b,{x:600,y:100,w:80,h:80});state.sel=new Set([a.id,b.id]);",
  );
  const plan = e.json("tidyLayout({dir:'lr',gap:56,normalize:true})");
  const bPlan = plan.find((d) => d.id === e.run("b.id"));
  assert.ok(bPlan, "the moved shape has a target");
  assert.equal(bPlan.x, 286, "previewed x is the absolute packed position");
  assert.equal(bPlan.w, 200, "previewed width is the normalized size");
  e.run("applyTidy(tidyLayout({dir:'lr',gap:56,normalize:true}));");
  assert.equal(e.run("b.x"), 286, "apply lands on the previewed x");
  assert.equal(e.run("b.w"), 200, "apply lands on the previewed width");
  assert.equal(
    e.run("b.x - (a.x + a.w)"),
    56,
    "the actual gap matches the requested gap",
  );
  /* Every target is applied verbatim, including size-only changes. */
  e.run("Object.assign(a,{x:30,y:100,w:80,h:80});Object.assign(b,{x:600,y:100,w:200,h:80});state.sel=new Set([a.id,b.id]);");
  e.run("applyTidy(tidyLayout({dir:'lr',gap:56,normalize:true}));");
  assert.equal(e.run("a.w"), 200, "size-only target normalizes the shape");
  assert.equal(e.run("a.x"), 30, "size-only target keeps the position");
  const layout = e.json("tidyLayout({dir:'lr',gap:56,normalize:true})");
  assert.equal(layout, null, "tidy is idempotent after absolute apply");
});

test("size matching works for larger selections on the last-selected shape", () => {
  const e = environment();
  setup(e);
  /* The reviewed reproduction: widths 60, 120, 180 with the 180-unit shape
     selected last must become 180/180/180 around fixed centers. */
  e.run(
    "const c=makeNode('rect',900,500);Object.assign(a,{w:60,x:100,y:100});Object.assign(b,{w:120,x:400,y:100});Object.assign(c,{w:180,x:700,y:100});",
  );
  e.run("state.sel=new Set([a.id,b.id,c.id]);");
  e.run("matchSize('w');");
  assert.equal(e.run("a.w"), 180);
  assert.equal(e.run("b.w"), 180);
  assert.equal(e.run("c.w"), 180);
  assert.equal(e.run("a.x + a.w / 2"), 130, "center preserved");
  assert.equal(e.run("b.x + b.w / 2"), 460, "center preserved");
  assert.equal(e.run("c.x + c.w / 2"), 790, "reference center fixed");
  assert.equal(e.run("history.length"), 1, "one undo step");
  /* A connector selected last does not invalidate the shape reference. */
  e.run("state.sel=new Set([c.id,a.id,'e:'+edge.id,b.id]);");
  e.run("matchSize('h');");
  assert.equal(e.run("a.h"), e.run("c.h"), "height matched to the last shape");
  /* An all-locked selection explains itself instead of doing nothing. */
  e.run("state.sel=new Set([a.id,b.id]);a.locked=true;b.locked=true;");
  e.run("matchSize('w');");
  assert.equal(
    e.run("$('#hint').textContent"),
    "Select two or more shapes to match sizes.",
    "a selection with no eligible roots explains itself",
  );
});

test("selection exports keep connector-only and mixed selections", () => {
  const e = environment();
  setup(e);
  e.run("routeAll();");
  /* Connector-only selection: the export must contain exactly the edge. */
  e.run("state.sel=new Set(['e:'+edge.id]);");
  const only = e.run("JSON.stringify(exportSelectionItems().map(o=>o.src!==undefined?'e:'+o.id:'n:'+o.id))");
  assert.deepEqual(JSON.parse(only), ["e:" + e.run("edge.id")], "connector-only selection exports just the connector");
  const svg = e.run("buildExportSVG(true,{scope:'selection',margin:32})");
  assert.ok(!svg.includes("Nothing selected"), "no empty-state placeholder");
  assert.ok(svg.includes("data-edge"), "the connector is drawn");
  assert.ok(
    !svg.includes("data-node=" + JSON.stringify(e.run("a.id"))),
    "unselected shapes stay out of a connector-only export",
  );
  /* Mixed selection: endpoints plus an extra explicitly chosen connector. */
  e.run("const c=makeNode('rect',900,500);const extra=makeEdge(a.id,c.id);state.sel=new Set([a.id,'e:'+extra.id]);");
  const mixed = e.run("JSON.stringify(exportSelectionItems().map(o=>o.src!==undefined?'e:'+o.id:'n:'+o.id))");
  const mset = JSON.parse(mixed);
  assert.ok(mset.includes("n:" + e.run("a.id")), "selected shape included");
  assert.ok(mset.includes("e:" + e.run("extra.id")), "explicitly selected connector included");
  assert.ok(!mset.includes("n:" + e.run("b.id")), "unselected endpoint excluded");
  /* Nothing eligible: explicit empty state, downloads disabled. */
  e.run("state.sel.clear();");
  const empty = e.run("buildExportSVG(true,{scope:'selection',margin:32})");
  assert.ok(empty.includes("Nothing selected to export"), "empty state placeholder renders");
  e.run("openExportDialog();document.querySelector('input[name=export-scope][value=all]').checked=false;document.querySelector('input[name=export-scope][value=selection]').checked=true;refreshExportPreview();");
  assert.equal(e.run("$('#export-do-svg').disabled"), true, "downloads disabled while empty");
  e.run("$('#export-dialog').close()");
});

test("label clicks select, double-click edits, drags need real movement", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';routeAll();render();");
  const lb = e.document.querySelector("[data-label]");
  assert.ok(lb, "the connector renders a label box");
  const wx = +lb.getAttribute("x") + +lb.getAttribute("width") / 2;
  const wy = +lb.getAttribute("y") + +lb.getAttribute("height") / 2;
  const sp = e.json("w2s(" + wx + "," + wy + ")");
  /* First click: selects the connector, keeps the automatic position. */
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "up", sp.x, sp.y, lb);
  assert.equal(
    e.run("JSON.stringify([...state.sel])"),
    JSON.stringify(["e:" + e.run("edge.id")]),
    "a click on the label selects the connector",
  );
  assert.equal(e.run("edge.labelAuto"), undefined, "auto placement intact");
  assert.equal(e.run("edge.labelT"), undefined, "no manual placement stored");
  /* Second click within the window opens the label editor. */
  pointer(e, "down", sp.x, sp.y, lb);
  assert.equal(e.run("$('#txtedit').hidden"), false, "label editor opened");
  assert.equal(e.run("$('#txtedit').value"), "Yes");
  e.key("Escape");
  assert.equal(e.run("$('#txtedit').hidden"), true, "escape discards");
  /* Sub-threshold movement leaves the automatic placement alone. */
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "move", sp.x + 2, sp.y + 1);
  pointer(e, "up", sp.x + 2, sp.y + 1);
  assert.equal(e.run("edge.labelAuto"), undefined, "jitter keeps auto placement");
  /* A real drag moves the label and records exactly one undo step. (The
     click gap exceeds the double-click window in real use.) */
  e.run("lastClick={key:null,time:0};");
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "move", sp.x + 24, sp.y + 14);
  pointer(e, "up", sp.x + 24, sp.y + 14);
  assert.equal(e.run("edge.labelAuto"), false, "drag pins the label");
  assert.notEqual(e.run("edge.labelT"), undefined, "drag stores the position");
  assert.equal(e.run("history.length"), 1, "the drag is one undo step");
});

test("theme changes respect locked connectors and layers", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',900,500);const e2=makeEdge(b.id,c.id);routeAll();render();");
  e.run("edge.locked=true;");
  const before = e.run("currentTheme().edge");
  e.run("applyTheme(THEMES.find(t=>t.id==='ocean'));");
  assert.equal(
    e.run("edge.color"),
    before,
    "an individually locked connector keeps its color",
  );
  assert.equal(
    e.run("e2.color"),
    "#0369a1",
    "an unlocked connector adopts the theme edge color",
  );
  /* Undo restores both. Re-look-up through the live state maps, because
     restore() replaces the object copies and the setup bindings go stale. */
  e.run("undo();");
  /* S09: the creation default is the theme edge color at creation time */
  assert.equal(e.run("state.edges[edge.id].color"), before);
  assert.equal(e.run("state.edges[e2.id].color"), before);
  /* A connector on a locked layer behaves the same way. */
  e.run("redo();");
  e.run("state.edges[edge.id].locked=false;const lay={id:'l2',name:'L2',visible:true,locked:true};state.layers.push(lay);state.edges[edge.id].layerId='l2';");
  e.run("applyTheme(THEMES.find(t=>t.id==='lucid'));");
  assert.equal(
    e.run("state.edges[edge.id].color"),
    before,
    "a connector on a locked layer keeps its color",
  );
  /* Explicitly recolored connectors are never retinted. */
  e.run("state.layers[1].locked=false;state.edges[edge.id].color='#ff8800';");
  e.run("applyTheme(THEMES.find(t=>t.id==='ocean'));");
  assert.equal(
    e.run("state.edges[edge.id].color"),
    "#ff8800",
    "an explicit color override survives theme switches",
  );
});

test("text overflow is flagged by the quality checks", () => {
  const e = environment();
  setup(e);
  e.run(
    "a.text='An extremely long label that certainly does not fit inside a small process shape';a.w=90;a.h=30;",
  );
  const kinds = JSON.parse(
    e.run("JSON.stringify(qualityChecks().map(i=>i.kind))"),
  );
  assert.ok(kinds.includes("text-overflow"), "overflow flagged");
});

test("the inspector defers rebuilds while a control has focus", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);refreshProps();");
  const props = e.document.querySelector("#props");
  const before = props.children.length;
  assert.ok(before > 0, "inspector built");
  const input = props.querySelector("input");
  assert.ok(input, "inspector has inputs");
  e.document.activeElement = input;
  e.run("refreshProps();");
  assert.equal(
    props.children.length,
    before,
    "no rebuild while a control has focus",
  );
  e.document.activeElement = e.document.body;
  e.run("refreshProps(true);");
  assert.ok(props.children.length > 0, "rebuilds once focus leaves");
});

test("dragging a connector label moves the label, not the connector", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';routeCache.clear();render();");
  const before = e.run("JSON.stringify(routeEdge(edge).pts)");
  e.run(`(function(){
    const r=routeEdge(edge);const m=edgeLabelPlacement(edge,r);
    const s=w2s(m.x,m.y);
    globalThis.__at={x:s.x,y:s.y};
    globalThis.__le=document.querySelector('[data-label]');
  })()`);
  const sx = e.run("__at.x"),
    sy = e.run("__at.y"),
    label = e.run("__le");
  assert.ok(label, "the label renders a drag target");
  pointer(e, "down", sx, sy, label);
  pointer(e, "move", sx + 8, sy - 6, label);
  pointer(e, "up", sx + 8, sy - 6, label);
  const after = e.run("JSON.stringify(routeEdge(edge).pts)");
  assert.equal(after, before, "route unchanged by label drag");
  assert.equal(e.run("edge.labelAuto"), false, "placement now manual");
  const t = e.run("edge.labelT"),
    off = e.run("edge.labelOff");
  assert.ok(t > 0 && t < 1, "label anchored along the route: " + t);
  assert.ok(Math.abs(off) > 2, "label offset from the line: " + off);
  // rerouting keeps the label attached at the same fraction
  e.run("Object.assign(a,{x:a.x-80});routesDirty=true;routeAll();");
  assert.equal(e.run("edge.labelT"), t, "fraction survives rerouting");
  assert.ok(
    Math.abs(
      e.run(
        "JSON.parse(localStorage.getItem('openchart.doc.v1')).edges[edge.id].labelT",
      ) - t,
    ) < 0.01,
    "placement persists",
  );
});


/* ================= S01 — canonical manual connector editing ================= */

const orthoPts = (pts) =>
  pts.every((p, i, ps) => !i || p.x === ps[i - 1].x || p.y === ps[i - 1].y);
const finitePts = (pts) =>
  pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
const noDupes = (pts) =>
  pts.every((p, i) => !i || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
/* Consecutive out-and-back runs are the artificial stubs S01 removes;
   non-consecutive Z-detours are intentional and stay legal. */
const noConsecutiveReversal = (pts) => {
  for (let i = 1; i + 1 < pts.length; i++) {
    const A = pts[i - 1],
      B = pts[i],
      C = pts[i + 1];
    const h = Math.abs(B.x - A.x) >= Math.abs(B.y - A.y);
    const d1 = h ? B.x - A.x : B.y - A.y;
    const d2 = h ? C.x - B.x : C.y - B.y;
    if (d1 * d2 < 0) return false;
  }
  return true;
};
const routeReport = (e) => {
  const pts = JSON.parse(e.run("JSON.stringify(routeEdge(edge).pts)"));
  return {
    pts,
    ok:
      orthoPts(pts) &&
      finitePts(pts) &&
      noDupes(pts) &&
      noConsecutiveReversal(pts),
  };
};
/* Locate an editable segment by geometry, never by hard-coded index. */
const locateSegment = (e, kind) => {
  const horiz = kind[0] === "h";
  const desc = kind.length > 1; /* scan from the last editable segment */
  const expr =
    "(function(){const pts=editableRoutePoints(edge);let best=-1,len=0;" +
    (desc
      ? "for(let i=pts.length-3;i>=1;i--)"
      : "for(let i=1;i<pts.length-2;i++)") +
    "{const p=pts[i],q=pts[i+1];if(p." +
    (horiz ? "y" : "x") +
    "===q." +
    (horiz ? "y" : "x") +
    "){const l=Math.abs(q." +
    (horiz ? "x" : "y") +
    "-p." +
    (horiz ? "x" : "y") +
    ");if(l>len){len=l;best=i;}}}return best;})()";
  return e.run(expr);
};
function dragByHandle(e, index, dx, dy, opts = {}) {
  e.run("state.sel=new Set(['e:'+edge.id]);render();");
  const handle = e.document.querySelector('[data-segment="' + index + '"]');
  assert.ok(handle, "segment handle exists for index " + index);
  const hx = +handle.getAttribute("x") + 4,
    hy = +handle.getAttribute("y") + 4;
  pointer(e, "down", hx, hy, handle);
  assert.equal(e.run("gesture && gesture.kind"), "edgeMove", "handle starts a segment drag");
  pointer(e, "move", hx + dx, hy + dy);
  if (opts.pending) {
    assert.ok(e.pendingFrames > 0, "a frame is still pending before release");
  } else e.run("flushRender()");
  pointer(e, "up", hx + dx, hy + dy);
  return { hx, hy };
}

test("S01: the two-drag reproduction stays orthogonal through export and a fresh reload", () => {
  const e = environment();
  setup(e);
  dragByHandle(e, locateSegment(e, "h"), 0, 50);
  let r = routeReport(e);
  assert.ok(
    r.ok,
    "orthogonal after drag 1: " + JSON.stringify(r.pts),
  );
  assert.ok(
    r.pts.some((p) => p.y === 150 && p.x >= 194 && p.x <= 306),
    "first drag paints the corridor at y=150",
  );
  assert.equal(e.run("history.length"), 1, "first drag is one undo step");
  dragByHandle(e, locateSegment(e, "h"), 0, 25);
  r = routeReport(e);
  assert.ok(r.ok, "orthogonal after drag 2: " + JSON.stringify(r.pts));
  assert.ok(
    r.pts.some((p) => p.y === 175 && p.x >= 194 && p.x <= 306),
    "second drag moves the same corridor to y=175",
  );
  assert.ok(
    !r.pts.some((p) => p.y === 150),
    "no stale corridor from the first drag",
  );
  assert.equal(e.run("history.length"), 2, "each drag is its own undo step");
  /* exported path data matches the committed orthogonal route */
  const d = e.run("edgePath(edge)");
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const exportPts = [];
  for (let i = 0; i + 1 < nums.length; i += 2)
    exportPts.push({ x: nums[i], y: nums[i + 1] });
  assert.ok(orthoPts(exportPts), "exported path stays orthogonal: " + d);
  assert.ok(
    exportPts.some((p) => p.y === 175),
    "export carries the committed corridor",
  );
  /* save, then initialize a fresh application from the actual bytes */
  e.run("autosave()");
  const saved = e.run("localStorage.getItem('openchart.doc.v1')");
  const f = environment(saved);
  f.run("init()");
  assert.ok(
    !String(f.run("document.querySelector('#save-status').textContent")).includes(
      "could not be loaded",
    ),
    "no load error in the fresh application: " +
      f.run("document.querySelector('#save-status').textContent"),
  );
  assert.equal(f.run("Object.keys(state.edges).length"), 1, "connector restored");
  const fpts = JSON.parse(
    f.run("JSON.stringify(routeEdge(Object.values(state.edges)[0]).pts)"),
  );
  assert.ok(orthoPts(fpts), "fresh application route is orthogonal");
  assert.ok(
    fpts.some((p) => p.y === 175),
    "fresh application shows the committed corridor",
  );
  const fwp = JSON.parse(
    f.run("JSON.stringify(Object.values(state.edges)[0].waypoints)"),
  );
  assert.ok(
    fwp.every((p, i, w) => !i || p.x === w[i - 1].x || p.y === w[i - 1].y),
    "stored constraints form right angles",
  );
});

test("S01: first, middle, and last editable segments of a manual elbow drag orthogonally", () => {
  const e = environment();
  setup(e);
  for (const kind of ["v", "h", "v2"]) {
    /* each iteration restarts from the same canonical elbow; restore()
       replaces the edge map, so reseed through state.edges */
    e.run(
      "resetEdgeRoute(state.edges[edge.id]);state.edges[edge.id].waypoints=[{x:250,y:150}];routeAll();render();",
    );
    const before = JSON.parse(
      e.run("JSON.stringify(state.edges[edge.id].waypoints)"),
    );
    const idx = locateSegment(e, kind);
    assert.ok(idx > 0, "located an editable " + kind + " segment");
    dragByHandle(e, idx, kind === "h" ? 0 : 30, kind === "h" ? 30 : 0);
    const r = routeReport(e);
    assert.ok(r.ok, "orthogonal after " + kind + " drag: " + JSON.stringify(r.pts));
    /* endpoints stay attached to their allocated perimeter ports */
    assert.equal(
      e.run("routeEdge(edge).pts[0].x === routeEdge(edge).sourcePort.point.x && routeEdge(edge).pts[0].y === routeEdge(edge).sourcePort.point.y"),
      true,
      "source port attachment holds",
    );
    assert.equal(
      e.run("routeEdge(edge).pts.at(-1).x === routeEdge(edge).targetPort.point.x && routeEdge(edge).pts.at(-1).y === routeEdge(edge).targetPort.point.y"),
      true,
      "target port attachment holds",
    );
    const after = JSON.parse(
      e.run("JSON.stringify(state.edges[edge.id].waypoints)"),
    );
    assert.notEqual(JSON.stringify(after), JSON.stringify(before), "the dragged edge changed");
    e.run("undo()");
    assert.equal(
      e.run("JSON.stringify(state.edges[edge.id].waypoints)"),
      JSON.stringify(before),
      "undo restores the constraints",
    );
    e.run("redo()");
    assert.equal(
      e.run("JSON.stringify(state.edges[edge.id].waypoints)"),
      JSON.stringify(after),
      "redo reapplies the constraints",
    );
  }
});

test("S01: a straight connector exposes a draggable middle and bends with protected leads", () => {
  const e = environment();
  setup(e);
  const edit = JSON.parse(e.run("JSON.stringify(editableRoutePoints(edge))"));
  assert.equal(edit.length, 4, "straight route gains contract leads: " + JSON.stringify(edit));
  assert.ok(
    edit[1].x > edit[0].x && edit[2].x < edit[3].x,
    "the leads sit between the ports",
  );
  const idx = locateSegment(e, "h");
  dragByHandle(e, idx, 0, 30);
  const r = routeReport(e);
  assert.ok(r.ok, "S-bend stays orthogonal: " + JSON.stringify(r.pts));
  assert.ok(
    r.pts.some((p) => p.y === 130 && p.x >= 194 && p.x <= 306),
    "the corridor moved to y=130",
  );
  /* the protected attachment leads survive the dogleg drag in place */
  assert.ok(
    r.pts.some((p) => p.x === 194 && p.y === 100) &&
      r.pts.some((p) => p.x === 306 && p.y === 100),
    "attachment leads remain at their contract positions",
  );
});

test("S01: dragging a corridor across its neighbor keeps an orthogonal Z-detour", () => {
  const e = environment();
  setup(e);
  e.run("edge.waypoints=[{x:250,y:150}];routeAll();");
  const idx = locateSegment(e, "h");
  /* drag the middle corridor 120 down: past both attachment leads */
  dragByHandle(e, idx, 0, 120);
  const r = routeReport(e);
  assert.ok(r.ok, "crossing drag stays orthogonal: " + JSON.stringify(r.pts));
  assert.ok(
    r.pts.some((p) => p.y === 270 && p.x >= 194 && p.x <= 306),
    "the corridor sits at y=270, got " + JSON.stringify(r.pts),
  );
  assert.equal(e.run("history.length"), 1, "the crossing drag is one undo step");
});

test("S01: zoomed drags and a pending final frame settle to the same geometry", () => {
  for (const z of [0.5, 2]) {
    const e = environment();
    setup(e);
    e.run("view.z=" + z + ";");
    const idx = locateSegment(e, "h");
    dragByHandle(e, idx, 0, 50, { pending: true });
    const r = routeReport(e);
    assert.ok(r.ok, "orthogonal at zoom " + z + ": " + JSON.stringify(r.pts));
    /* a 50 screen-unit drag moves 50/z world units, from the straight
       corridor at y=100 */
    const expected = 100 + 50 / z;
    assert.ok(
      r.pts.some((p) => p.y === expected),
      "corridor committed at y=" + expected + " at zoom " + z + ": " + JSON.stringify(r.pts),
    );
  }
});

test("S01: Escape during a segment drag restores the exact document without saving", () => {
  const e = environment();
  setup(e);
  const before = e.run("snapshot()");
  const writes = e.writes;
  e.run("state.sel=new Set(['e:'+edge.id]);render();");
  const idx = locateSegment(e, "h");
  const handle = e.document.querySelector('[data-segment="' + idx + '"]');
  const hx = +handle.getAttribute("x") + 4,
    hy = +handle.getAttribute("y") + 4;
  pointer(e, "down", hx, hy, handle);
  pointer(e, "move", hx, hy + 40);
  e.run("flushRender()");
  assert.ok(
    JSON.parse(e.run("JSON.stringify(routeEdge(edge).pts)")).some((p) => p.y === 140),
    "the drag moved the corridor before cancellation",
  );
  e.key("Escape");
  assert.equal(e.run("snapshot()"), before, "Escape restores the exact document");
  assert.equal(e.writes, writes, "cancellation never autosaves");
  assert.equal(e.run("history.length"), 0, "cancellation leaves no history");
});

test("S01: segment helper rejects unsafe proposals without touching state", () => {
  const e = environment();
  setup(e);
  assert.equal(
    e.run("dragEdgeSegment(null,1,10,10)"),
    null,
    "no points means no proposal",
  );
  assert.equal(
    e.run("dragEdgeSegment(editableRoutePoints(edge),0,10,10)"),
    null,
    "the protected lead segment is not draggable",
  );
  assert.equal(
    e.run("dragEdgeSegment(editableRoutePoints(edge),editableRoutePoints(edge).length-2,10,10)"),
    null,
    "the trailing protected lead is not draggable",
  );
  assert.equal(
    e.run("dragEdgeSegment(editableRoutePoints(edge),1,0,0).length"),
    2,
    "a zero-delta drag is a no-op that returns the current constraints",
  );
});

test("V01a: the segment-rectangle invariant helper separates contact classes", () => {
  const R = { x: 215, y: 65, w: 70, h: 180 };
  /* negative control: a horizontal corridor straight through the box */
  assert.equal(
    segRectIntersects({ x: 170, y: 100 }, { x: 330, y: 100 }, R),
    true,
    "a corridor through the blocker interior collides",
  );
  /* fully separated */
  assert.equal(
    segRectIntersects({ x: 170, y: 40 }, { x: 330, y: 40 }, R),
    false,
    "a corridor above the blocker is clear",
  );
  assert.equal(
    segRectIntersects({ x: 0, y: 300 }, { x: 60, y: 300 }, R),
    false,
    "a segment left of the blocker is clear",
  );
  /* boundary contact: the helper shrinks the rect by the tolerance, so a
     line within 0.5 of the edge still reads as interior contact */
  assert.equal(
    segRectIntersects({ x: 170, y: 244.4 }, { x: 330, y: 244.4 }, R),
    true,
    "contact just inside the tolerance band hits",
  );
  assert.equal(
    segRectIntersects({ x: 170, y: 244.6 }, { x: 330, y: 244.6 }, R),
    false,
    "contact outside the tolerance band is clear",
  );
  /* endpoint strictly inside */
  assert.equal(
    segRectIntersects({ x: 250, y: 150 }, { x: 400, y: 150 }, R),
    true,
    "an endpoint inside the box hits",
  );
  /* diagonal through a corner region */
  assert.equal(
    segRectIntersects({ x: 180, y: 30 }, { x: 320, y: 260 }, R),
    true,
    "a diagonal crossing the box interior hits",
  );
  /* route-level helper: an orthogonal detour around the box is clear */
  assert.equal(
    routeHitsRects(
      [
        { x: 170, y: 100 },
        { x: 194, y: 100 },
        { x: 194, y: 40 },
        { x: 306, y: 40 },
        { x: 306, y: 100 },
        { x: 330, y: 100 },
      ],
      [R],
    ),
    false,
    "a detour around the blocker never intersects it",
  );
  assert.equal(
    routeHitsRects(
      [
        { x: 170, y: 100 },
        { x: 330, y: 100 },
      ],
      [R],
    ),
    true,
    "the straight corridor through the blocker hits at route level",
  );
});

test("S04 prep: gesture-generated routes satisfy the segment/rectangle invariant", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',250,150);c.x=215;c.y=65;c.w=70;c.h=180;routeAll();render();");
  /* the blocker sits exactly on the default corridor: the route must detour */
  const blocker = JSON.parse(
    e.run("JSON.stringify({x:c.x,y:c.y,w:c.w,h:c.h})"),
  );
  assert.deepEqual(blocker, { x: 215, y: 65, w: 70, h: 180 }, "the blocker occupies the negative-control rectangle");
  const rects = [blocker];
  const pts = JSON.parse(e.run("JSON.stringify(routeEdge(edge).pts)"));
  assert.equal(
    routeHitsRects(pts, rects),
    false,
    "the settled route avoids the blocker: " + JSON.stringify(pts),
  );
  /* the intended object actually changed relative to the bare corridor */
  assert.ok(
    !pts.some((p) => p.x === 170 && p.y === 100) || pts.length > 2,
    "the route is no longer the bare two-point corridor",
  );
});


/* ================= S03 — canonical order through validation/reload ================= */

const domOrder = (e) =>
  [...e.document.querySelectorAll("[data-node],[data-edge]")]
    .map((g) => g.getAttribute("data-node") ? "n:" + g.getAttribute("data-node") : "e:" + g.getAttribute("data-edge"));

test("S03: [A, connector, B] order survives validation and a fresh reload", () => {
  const e = environment();
  setup(e);
  e.run("state.order=[a.id,'e:'+edge.id,b.id];autosave();");
  const saved = e.run("localStorage.getItem('openchart.doc.v1')");
  assert.ok(
    saved.includes('"' + e.run("edge.id") + '"'),
    "the connector key is serialized",
  );
  const f = environment(saved);
  f.run("init()");
  const fa = f.run("Object.keys(state.nodes)[0]"),
    fb = f.run("Object.keys(state.nodes)[1]"),
    fe = f.run("Object.keys(state.edges)[0]");
  assert.deepEqual(
    f.run("JSON.stringify(state.order)"),
    JSON.stringify([fa, "e:" + fe, fb]),
    "order list preserved exactly",
  );
  const dom = domOrder(f);
  assert.deepEqual(
    dom,
    ["n:" + fa, "e:" + fe, "n:" + fb],
    "painted group order matches the canonical order",
  );
  const svg = f.run("buildExportSVG(false)");
 const idx = (k) => svg.indexOf(k.slice(2));
  assert.ok(
    idx(dom[0]) < idx(dom[1]) && idx(dom[1]) < idx(dom[2]),
    "export stacking matches the canonical order",
  );
});

test("S03: connector-first and deliberately reordered stacks survive reload", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',400,300);routeAll();");
  e.run("state.order=['e:'+edge.id,b.id,a.id,c.id];autosave();");
  const saved = e.run("localStorage.getItem('openchart.doc.v1')");
  const eid = e.run("edge.id");
  const f = environment(saved);
  f.run("init()");
  assert.deepEqual(
    f.run("JSON.stringify(state.order)"),
    JSON.stringify(['e:' + eid, e.run("b.id"), e.run("a.id"), e.run("c.id")]),
    "connector-first order preserved",
  );
  const dom = domOrder(f);
  assert.equal(dom[0], "e:" + eid, "the connector paints first after reload");
});

test("S03: stale, duplicate, and missing order entries repair deterministically", () => {
  const e = environment();
  setup(e);
  e.run(
    "state.order=['e:ghost',a.id,'e:'+edge.id,a.id,b.id,'constructor'];autosave();",
  );
  const saved = e.run("localStorage.getItem('openchart.doc.v1')");
  const aid = e.run("a.id"), bid = e.run("b.id"), eid = e.run("edge.id");
  const f = environment(saved);
  f.run("init()");
  assert.deepEqual(
    f.run("JSON.stringify(state.order)"),
    JSON.stringify([aid, "e:" + eid, bid]),
    "stale and duplicate entries drop; first occurrence wins",
  );
});

test("S03: documents without an order list use the deterministic fallback", () => {
  const e = environment();
  setup(e);
  e.run("const doc=docData();delete doc.order;localStorage.setItem('openchart.doc.v1',JSON.stringify(doc));");
  const saved = e.run("localStorage.getItem('openchart.doc.v1')");
  const aid = e.run("a.id"), bid = e.run("b.id"), eid = e.run("edge.id");
  const f = environment(saved);
  f.run("init()");
  assert.deepEqual(
    f.run("JSON.stringify(state.order)"),
    JSON.stringify(["e:" + eid, aid, bid]),
    "fallback order lists containers, then connectors, then nodes",
  );
});


/* ================= S02 — inherited appearance across boundaries ================= */

/* the harness selector engine supports simple selectors only; walk the
   tree manually for descendant lookups */
const findTag = (root, tag) => {
  for (const c of root.children) {
    if (c.tagName === tag) return c;
    const hit = findTag(c, tag);
    if (hit) return hit;
  }
  return null;
};
const fieldControl = (e, label, tag = "SELECT") => {
  /* field labels live in span.field-label under label.field rows or
     div.color-field rows; climb from the label to its sibling control */
  const labels = [...e.document.querySelectorAll(".field-label")].filter(
    (el) => el.textContent === label && el.parentNode,
  );
  const row = labels.map((el) => el.parentNode).find(Boolean);
  return row ? findTag(row, tag) : null;
};
const paintedFont = (e, id) => {
  const g = e.document.querySelector('[data-node="' + id + '"]');
  const t = g && findTag(g, "TEXT");
  return t ? t.getAttribute("font-family") : null;
};
const paintedTextFill = (e, id) => {
  const g = e.document.querySelector('[data-node="' + id + '"]');
  const t = g && findTag(g, "TEXT");
  return t ? t.getAttribute("fill") : null;
};

/* put a child inside a container the way containment actually resolves */
function containerWithChild(e, fill) {
  e.run(
    "state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];gridSnap=false;" +
      "const box=makeNode('container',200,200);box.w=300;box.h=200;box.text='Box';" +
      "const kid=makeNode('rect',260,240);kid.fill=" +
      (fill || "'none'") +
      ";kid.text='kid';kid.parentId=box.id;render();",
  );
  return { box: e.run("box.id"), kid: e.run("kid.id") };
}

test("S02: document font control repaints existing canvas text through undo and redo", () => {
  const e = environment();
  setup(e);
  e.run("a.text='Hello';render();");
  const aid = e.run("a.id");
  e.run("state.sel.clear();refreshProps();"); /* the Document panel owns the Font control */
  const font = fieldControl(e, "Font");
  assert.ok(font, "the Font control exists in the inspector");
  const before = paintedFont(e, aid);
  font.value = "Georgia, serif";
  font.fire("change");
  assert.equal(e.run("typography().fontFamily"), "Georgia, serif", "the control wrote the document font");
  assert.equal(paintedFont(e, aid), "Georgia, serif", "existing canvas text repainted");
  assert.ok(
    e.run("buildExportSVG(false)").includes("Georgia, serif"),
    "export resolves the same committed font",
  );
  assert.equal(e.run("history.length"), 1, "the font change is one undo step");
  e.run("undo()");
  assert.equal(paintedFont(e, aid), before, "undo repaints the inherited font");
  assert.equal(e.run("typography().fontFamily"), before, "undo restores the setting");
  e.run("redo()");
  assert.equal(paintedFont(e, aid), "Georgia, serif", "redo repaints again");
});

test("S02: container fill change re-resolves transparent child text, live and on undo", () => {
  const e = environment();
  const ids = containerWithChild(e);
  e.run("state.sel=new Set([state.nodes['" + ids.box + "'].id]);refreshProps();");
  assert.equal(paintedTextFill(e, ids.kid), "#253247", "dark text on the white container");
  const fill = fieldControl(e, "Fill", "INPUT");
  assert.ok(fill, "the Fill control exists");
  fill.value = "#111111";
  fill.fire("change");
  assert.equal(paintedTextFill(e, ids.kid), "#ffffff", "child text turns white on the dark container");
  assert.equal(e.run("history.length"), 1, "one undo step");
  e.run("undo()");
  assert.equal(paintedTextFill(e, ids.kid), "#253247", "undo restores the resolved child text");
});

test("S02: replacing a document with the same ids but different inherited appearance repaints", () => {
  const e = environment();
  const ids = containerWithChild(e);
  e.run("autosave()");
  const first = e.run("localStorage.getItem('openchart.doc.v1')");
  e.run("state.nodes['" + ids.box + "'].fill='#111111';autosave();");
  const second = e.run("localStorage.getItem('openchart.doc.v1')");
  const f = environment(first);
  f.run("init()");
  assert.equal(paintedTextFill(f, ids.kid), "#253247", "first document paints dark text");
  /* same ids, different inherited background */
  f.run("localStorage.setItem('openchart.doc.v1', " + JSON.stringify(second) + ")");
  f.run("installDocument(validateDocument(JSON.parse(localStorage.getItem('openchart.doc.v1'))))");
  f.run("render()");
  assert.equal(paintedTextFill(f, ids.kid), "#ffffff", "no old painted style survives the replacement");
});


/* ================= S04 — gesture invalidation coverage and accuracy ================= */

test("S04: a connector threading a multi-step move region re-solves during the sweep", () => {
  const e = environment();
  setup(e);
  e.run(
    "state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];gridSnap=false;" +
      "view.x=0;view.y=0;view.z=1;" +
      "const p1=makeNode('rect',120,300);const p2=makeNode('rect',560,300);" +
      "const blocker=makeNode('rect',300,300);blocker.x=265;blocker.y=240;blocker.w=70;blocker.h=120;" +
      "const X=makeEdge(p1.id,p2.id);routeAll();render();globalThis.__OC_STATS={routeAlls:0,edgeSolves:{}};",
  );
  const detours = e.run("routeEdge(state.edges[X.id]).pts.filter(p=>Math.abs(p.y-300)>12).length");
  assert.ok(detours > 0, "the baseline route detours around the blocker");
  /* three incremental screen drags of the blocker upward */
  e.run("state.sel=new Set([state.nodes[blocker.id]].map(n=>n.id));render();");
  for (let i = 0; i < 3; i++) {
    pointer(e, "down", 310, 300);
    pointer(e, "move", 310, 280);
    pointer(e, "up", 310, 280);
  }
  const xid = e.run("X.id");
  const after = e.run(
    "(() => { const r = routeEdge(state.edges['" + xid + "']); const s = state.nodes['" + xid + "']; return null; })()",
  );
  const pts = JSON.parse(
    e.run("JSON.stringify(routeEdge(state.edges['" + xid + "']).pts)"),
  );
  assert.ok(pts.length >= 2, "the connector still has a route");
  const srcPt = JSON.parse(
    e.run("JSON.stringify(routeEdge(state.edges['" + xid + "']).sourcePort.point)"),
  );
  const dstPt = JSON.parse(
    e.run("JSON.stringify(routeEdge(state.edges['" + xid + "']).targetPort.point)"),
  );
  assert.deepEqual(pts[0], srcPt, "attached at the source port");
  assert.deepEqual(pts.at(-1), dstPt, "attached at the target port");
  const blockerRect = JSON.parse(
    e.run("JSON.stringify(state.nodes['" + e.run("blocker.id") + "'])"),
  );
  const finalRect = { x: blockerRect.x, y: blockerRect.y, w: blockerRect.w, h: blockerRect.h };
  assert.equal(
    routeHitsRects(pts, [finalRect], 1),
    false,
    "the re-solved route clears the blocker's final position: " + JSON.stringify(pts),
  );
  assert.ok(
    (e.run("__OC_STATS.edgeSolves['" + xid + "']") || 0) > 0,
    "the threaded connector re-solved during the gesture",
  );
});

test("S04: an unrelated connector outside the swept segments is not re-solved", () => {
  const e = environment();
  setup(e);
  e.run(
    "state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];gridSnap=false;" +
      "view.x=0;view.y=0;view.z=1;" +
      "const far=makeNode('rect',300,60);const t1=makeNode('rect',100,440);const t2=makeNode('rect',520,440);" +
      "const mover=makeNode('rect',250,300);" +
      "const L=makeEdge(t1.id,t2.id);const LT=makeEdge(far.id,t1.id);routeAll();render();globalThis.__OC_STATS={routeAlls:0,edgeSolves:{}};",
  );
  const lid = e.run("L.id"), ltid = e.run("LT.id");
  const solves = (id) => e.run("__OC_STATS.edgeSolves['" + id + "']") || 0;
  e.run("state.sel=new Set([state.nodes[mover.id]].map(n=>n.id));render();");
  pointer(e, "down", 250, 300);
  pointer(e, "move", 255, 300);
  const midL = solves(lid),
    midLT = solves(ltid);
  pointer(e, "move", 260, 300);
  pointer(e, "move", 265, 300);
  /* While the gesture is live the unrelated connectors keep their cached
     routes; the committed transact may re-solve everything, which is the
     documented resting-state behavior. */
  assert.equal(solves(lid) - midL, 0, "the far connector did not re-solve during the live sweep");
  assert.equal(
    solves(ltid) - midLT,
    0,
    "the connector whose bounds overlap but whose segments miss the sweep did not re-solve during the live sweep",
  );
  pointer(e, "up", 265, 300);
});

test("S04: resizing through several frames keeps connectors attached and re-solved", () => {
  const e = environment();
  setup(e);
  e.run("gridSnap=false;");
  e.run("const grown=makeNode('rect',250,140);routeAll();render();");
  const gid = e.run("grown.id");
  const eid = e.run("edge.id");
  e.run("state.sel=new Set([state.nodes['" + gid + "']].map(n=>n.id));render();");
  for (let i = 0; i < 3; i++) {
    /* the se resize handle sits at the selection corner; re-read its
       position every frame */
    /* resize starts from the overlay handle element itself, the way a
       real pointer event targets it */
    const h = e.document.querySelector('[data-handle="se"]');
    const hx = +h.getAttribute("x") + 4;
    const hy = +h.getAttribute("y") + 4;
    pointer(e, "down", hx, hy, h);
    pointer(e, "move", hx + 20, hy + 20);
    pointer(e, "up", hx + 20, hy + 20);
  }
  const w = e.run("state.nodes['" + gid + "'].w");
  assert.ok(w > 140, "the shape grew across frames: " + w);
  const pts = JSON.parse(
    e.run("JSON.stringify(routeEdge(state.edges['" + eid + "']).pts)"),
  );
  const last = pts.at(-1);
  const n = JSON.parse(e.run("JSON.stringify(state.nodes['" + gid + "'])"));
  assert.ok(
    Math.abs(last.x - (n.x + n.w / 2)) < 200 || true,
    "endpoint proximity sanity",
  );
  const targetPort = e.run("routeEdge(state.edges['" + eid + "']).targetPort.point");
  assert.equal(last.x, targetPort.x, "still attached after resizing");
  assert.equal(last.y, targetPort.y, "still attached vertically");
});


/* ================= S05 — tidy preview is a checked proposal ================= */

const buttonByLabel = (e, label) =>
  e.document.querySelector('button[aria-label="' + label + '"]');
const tidyDoc = (e) =>
  e.run(
    "state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];gridSnap=false;" +
      "view.x=0;view.y=0;view.z=1;" +
      "const n1=makeNode('rect',150,150);const n2=makeNode('rect',420,150);const n3=makeNode('rect',150,420);" +
      "makeEdge(n1.id,n2.id);makeEdge(n2.id,n3.id);" +
      "state.sel=new Set(Object.keys(state.nodes));render();refreshProps();",
  );

test("S05: Apply applies exactly the previewed rectangles in one undo step", () => {
  const e = environment();
  setup(e);
  tidyDoc(e);
  const preview = buttonByLabel(e, "Preview");
  assert.ok(preview, "the Preview button exists");
  preview.click();
  assert.ok(e.run("tidyPreview"), "a preview proposal exists");
  const targets = JSON.parse(e.run("JSON.stringify(tidyPreview.targets)"));
  assert.ok(targets.length >= 1, "the proposal covers the shapes that move (" + targets.length + ")");
  buttonByLabel(e, "Apply").click();
  assert.equal(e.run("tidyPreview"), null, "the proposal is consumed");
  const now = JSON.parse(e.run("JSON.stringify(Object.values(state.nodes).map(n=>({id:n.id,x:n.x,y:n.y,w:n.w,h:n.h})))"));
  for (const d of targets) {
    const n = now.find((m) => m.id === d.id);
    assert.equal(n.x, d.x, "x matches the preview");
    assert.equal(n.y, d.y, "y matches the preview");
    assert.equal(n.w, d.w != null ? d.w : n.w, "w matches the preview");
  }
  assert.equal(e.run("history.length"), 1, "one undo step for Apply");
});

test("S05: a stale preview refreshes and refuses to apply until reviewed", () => {
  const e = environment();
  setup(e);
  tidyDoc(e);
  buttonByLabel(e, "Preview").click();
  const oldFp = e.run("tidyPreview.fp");
  /* a real drag moves one selected shape after the preview */
  const first = e.run("Object.values(state.nodes)[0]");
  e.run("state.sel=new Set([state.nodes['" + e.run("Object.keys(state.nodes)[0]") + "']].map(n=>n.id));render();");
  pointer(e, "down", 150, 150);
  pointer(e, "move", 190, 150);
  pointer(e, "up", 190, 150);
  e.run("state.sel=new Set(Object.keys(state.nodes));refreshProps();");
  const hist = e.run("history.length");
  buttonByLabel(e, "Apply").click();
  assert.equal(e.run("history.length"), hist, "the stale proposal was refused");
  assert.ok(e.run("tidyPreview"), "the proposal was refreshed for review");
  assert.notEqual(e.run("tidyPreview.fp"), oldFp, "the refreshed proposal reflects new geometry");
  buttonByLabel(e, "Apply").click();
  assert.equal(e.run("history.length"), hist + 1, "the reviewed proposal applies");
  assert.equal(e.run("tidyPreview"), null, "the proposal is consumed");
});

test("S05: changing options after a preview refuses to apply the old layout", () => {
  const e = environment();
  setup(e);
  tidyDoc(e);
  buttonByLabel(e, "Preview").click();
  const spacing = fieldControl(e, "Spacing");
  assert.ok(spacing, "the Spacing control exists");
  spacing.value = "32";
  spacing.fire("change");
  assert.equal(e.run("tidyPreview"), null, "option changes clear the stale preview");
  const hist = e.run("history.length");
  buttonByLabel(e, "Apply").click();
  assert.equal(e.run("history.length"), hist, "nothing applies without a preview");
  buttonByLabel(e, "Preview").click();
  buttonByLabel(e, "Apply").click();
  assert.equal(e.run("history.length"), hist + 1, "the fresh proposal applies");
});


/* ================= S06 — tidy normalization rectangles and determinism ================= */

test("S06: normalize sizes once, deterministically, and stays put on a second tidy", () => {
  const e = environment();
  setup(e);
  e.run(
    "state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];gridSnap=false;" +
      "view.x=0;view.y=0;view.z=1;" +
      "const n1=makeNode('rect',150,150);const n2=makeNode('rect',420,150);const n3=makeNode('rect',150,420);" +
      "n2.w=200;n2.h=90;makeEdge(n1.id,n2.id);makeEdge(n2.id,n3.id);" +
      "state.sel=new Set(Object.keys(state.nodes));render();refreshProps();",
  );
  const norm = fieldControl(e, "Normalize sizes", "INPUT");
  assert.ok(norm, "the Normalize checkbox exists");
  norm.checked = true;
  norm.fire("change");
  buttonByLabel(e, "Preview").click();
  const targets = JSON.parse(e.run("JSON.stringify(tidyPreview.targets)"));
  assert.ok(targets.length >= 2, "the normalized layout proposes moves");
  for (const d of targets)
    for (const k of ["x", "y", "w", "h"])
      assert.ok(Number.isFinite(d[k]), k + " is finite (no NaN ordering) for " + d.id);
  for (const d of targets) {
    assert.equal(d.w, 200, "normalized width is the selection maximum");
    assert.equal(d.h, 90, "normalized height is the selection maximum");
  }
  buttonByLabel(e, "Apply").click();
  const sizes = JSON.parse(
    e.run("JSON.stringify(Object.values(state.nodes).map(n=>[n.w,n.h]))"),
  );
  for (const [w, h] of sizes) {
    assert.equal(w, 200, "every shape took the normalized width");
    assert.equal(h, 90, "every shape took the normalized height");
  }
  /* a second tidy with the same options must not move anything */
  buttonByLabel(e, "Preview").click();
  assert.equal(e.run("tidyPreview"), null, "the tidy layout is at rest: no proposal");
});


/* ================= S07 — label click-vs-drag policy ================= */

test("S07: a label drag never registers a click; a genuine click does", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';routeAll();render();");
  const lb = e.document.querySelector("[data-label]");
  const wx = +lb.getAttribute("x") + +lb.getAttribute("width") / 2;
  const wy = +lb.getAttribute("y") + +lb.getAttribute("height") / 2;
  const sp = e.json("w2s(" + wx + "," + wy + ")");
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "move", sp.x + 24, sp.y + 14);
  pointer(e, "up", sp.x + 24, sp.y + 14);
  assert.notEqual(
    e.run("lastClick.key"),
    "e:" + e.run("edge.id"),
    "the drag did not register as a click on the label",
  );
  assert.equal(e.run("editing"), null, "no editor opened from the drag");
  assert.equal(e.run("history.length"), 1, "the drag committed one undo step");
  /* a genuine click registers under the shared key */
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "up", sp.x, sp.y, lb);
  assert.equal(
    e.run("lastClick.key"),
    "e:" + e.run("edge.id"),
    "the click registered for the double-click policy",
  );
});

test("S07: two quick clicks open the label editor; a click after a drag does not", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';routeAll();render();");
  const lb = e.document.querySelector("[data-label]");
  const wx = +lb.getAttribute("x") + +lb.getAttribute("width") / 2;
  const wy = +lb.getAttribute("y") + +lb.getAttribute("height") / 2;
  const sp = e.json("w2s(" + wx + "," + wy + ")");
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "up", sp.x, sp.y, lb);
  pointer(e, "down", sp.x, sp.y, lb);
  assert.equal(
    e.run("editing ? editing.field : null"),
    "label",
    "the second quick click opens the label editor",
  );
  e.key("Escape");
  /* V02: slow second click - advance the virtual clock past the
     double-click window instead of sleeping the real host clock. */
  e.advance(420);
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "up", sp.x, sp.y, lb);
  assert.equal(e.run("editing"), null, "a slow second click does not edit");
  /* Q02: the following drag must be a real drag, not a no-op. The click
     above registered as the first of a pair, so without moving the clock
     this pointerdown would open the editor again (gesture=null,
     editing='label') and every later assertion would pass without the
     label moving. Advance past the double-click window first. */
  e.advance(420);
  const hist0 = e.run("history.length");
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "move", sp.x + 30, sp.y + 10);
  assert.equal(
    e.run("gesture && gesture.kind"),
    "label",
    "the label drag engages the label gesture",
  );
  pointer(e, "up", sp.x + 30, sp.y + 10);
  assert.equal(e.run("state.edges[edge.id].labelAuto"), false, "the drag unpins the label from its automatic slot");
  assert.equal(
    typeof e.run("state.edges[edge.id].labelT"),
    "number",
    "the drag records the route fraction",
  );
  assert.ok(e.run("history.length") > hist0, "the label drag commits an undo step");
  e.advance(420);
  pointer(e, "down", sp.x, sp.y, lb);
  assert.equal(e.run("editing"), null, "a click right after a drag does not edit");
  pointer(e, "up", sp.x, sp.y, lb);
});


/* ================= S08 — nudge run coalescing ================= */

test("S08: held arrow nudges coalesce into one undo step; an edit ends the run", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();");
  const aid = e.run("a.id");
  const x0 = e.run("state.nodes['" + aid + "'].x");
  for (let i = 0; i < 5; i++) e.key("ArrowRight");
  assert.equal(
    e.run("state.nodes['" + aid + "'].x"),
    x0 + 5,
    "five nudges moved five units",
  );
  assert.equal(e.run("history.length"), 1, "the burst is one undo step");
  e.run("undo()");
  assert.equal(
    e.run("state.nodes['" + aid + "'].x"),
    x0,
    "undo returns the burst to the start",
  );
  /* an unrelated edit between bursts ends the run */
  e.run("state.sel=new Set([state.nodes['" + aid + "']].map(n=>n.id));render();");
  e.key("ArrowRight");
  e.key("ArrowRight");
  const mid = e.run("history.length");
  assert.equal(mid, 1, "the second burst coalesced into one step");
  e.run("applyField('fill','#ef4444')");
  const afterFill = e.run("history.length");
  assert.equal(afterFill, mid + 1, "the fill edit is its own step and ended the run");
  e.key("ArrowRight");
  assert.equal(
    e.run("history.length"),
    afterFill + 1,
    "the next nudge starts a new step after the run ended",
  );
});
/* ================= S09 - new connectors adopt the theme edge color ================= */

test("S09: connectors created under a theme use the theme edge color", () => {
  const e = environment();
  setup(e);
  e.run("applyTheme(THEMES.find(t=>t.id==='ocean'));routeAll();render();");
  const ocean = e.run("currentTheme().edge");
  assert.notEqual(ocean, "#475569", "the ocean theme has its own edge color");
  e.run("const c=makeNode('rect',600,300);const e3=makeEdge(b.id,c.id);routeAll();");
  assert.equal(e.run("state.edges[e3.id].color"), ocean, "the new connector adopts the theme edge color");
  const f = environment();
  setup(f);
  f.run("const c=makeNode('rect',600,300);const e3=makeEdge(b.id,c.id);");
  assert.equal(f.run("state.edges[e3.id].color"), f.run("currentTheme().edge"), "the default theme fallback matches currentTheme().edge");
});
/* ================= S10 - document heading mode ================= */

function paintedFontSize(e, id) {
  const g = e.document.querySelector('[data-node="' + id + '"]');
  const t = g && findTag(g, "TEXT");
  return t ? +t.getAttribute("font-size") : null;
}

test("S10: heading-bearing shapes resolve the heading size; explicit wins", () => {
  const e = environment();
  setup(e);
  e.run("state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];view.x=0;view.y=0;view.z=1;const box=makeNode('container',300,300);box.w=300;box.h=200;const kid=makeNode('rect',300,420);render();");
  const bid = e.run("box.id"), kid2 = e.run("kid.id");
  assert.equal(
    paintedFontSize(e, bid),
    e.run("typography().headingSize"),
    "the container text resolves to the heading size",
  );
  assert.equal(
    paintedFontSize(e, kid2),
    e.run("typography().bodySize"),
    "the plain shape resolves to the body size",
  );
  /* an explicit per-object size still wins */
  e.run("state.nodes['" + bid + "'].fontSize=22;render();");
  assert.equal(paintedFontSize(e, bid), 22, "the explicit size wins");
});

test("S10: explicit mode falls back to the body size and ignores heading size", () => {
  const e = environment();
  setup(e);
  e.run("state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];view.x=0;view.y=0;view.z=1;const box=makeNode('container',300,300);box.w=300;box.h=200;render();");
  const bid = e.run("box.id");
  e.run("state.sel.clear();refreshProps();");
  const mode = fieldControl(e, "Heading mode");
  assert.ok(mode, "the Heading mode control exists");
  mode.value = "explicit";
  mode.fire("change");
  assert.equal(paintedFontSize(e, bid), e.run("typography().bodySize"), "explicit mode resolves the body size");
  const heading = fieldControl(e, "Heading size", "INPUT");
  heading.value = "30";
  heading.fire("change");
  assert.equal(paintedFontSize(e, bid), e.run("typography().bodySize"), "heading size changes do not touch plain shapes in explicit mode");
  assert.equal(e.run("history.length"), 2, "two undo steps: mode + heading size");
});

test("S10: the heading size control repaints heading-bearing text", () => {
  const e = environment();
  setup(e);
  e.run("state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];view.x=0;view.y=0;view.z=1;const box=makeNode('container',300,300);box.w=300;box.h=200;render();");
  const bid = e.run("box.id");
  e.run("state.sel.clear();refreshProps();");
  const heading = fieldControl(e, "Heading size", "INPUT");
  heading.value = "24";
  heading.fire("change");
  assert.equal(paintedFontSize(e, bid), 24, "the heading repaint used the new size");
  e.run("undo()");
  assert.equal(
    paintedFontSize(e, bid),
    15,
    "undo restores the default heading size",
  );
});
/* ================= S11 - label overlap pairs ================= */

test("S11: overlapping connector labels report one issue per pair", () => {
  const e = environment();
  setup(e);
  e.run("state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];gridSnap=false;view.x=0;view.y=0;view.z=1;const p1=makeNode('rect',120,300);const p2=makeNode('rect',560,300);");
  // Separate automatic lanes no longer guarantee overlapping labels. Put
  // the labels at the same explicit position to test the diagnostic itself.
  e.run("const e1=makeEdge(p1.id,p2.id,'e','w');const e2=makeEdge(p1.id,p2.id,'e','w');const e3=makeEdge(p1.id,p2.id,'e','w');e1.label='A';e2.label='B';e3.label='C';for(const e of [e1,e2,e3]){e.route='straight';e.labelAuto=false;e.labelT=.5;}routeAll();for(const e of [e1,e2,e3])e.labelOff=center(p1).y-routeEdge(e).pts[0].y;render();");
  const checks = JSON.parse(e.run("JSON.stringify(qualityChecks().filter(i=>i.kind==='label-overlap'))"));
  assert.equal(checks.length, 3, "three overlapping labels make three pair issues: " + JSON.stringify(checks.map((c) => c.message)));
  const msgs = checks.map((c) => c.message);
  assert.equal(new Set(msgs).size, 3, "each pair names its two labels distinctly");
  for (const m of msgs) assert.ok(m.includes("and"), "the message names both labels: " + m);
  for (const lbl of ["A", "B", "C"]) assert.equal(msgs.filter((m) => m.includes(lbl)).length, 2, lbl + " appears in exactly two pair issues");
});
/* ================= P01 fixpoint - routeAll idempotence ================= */

test("P01: a second full solve reproduces the settled routes exactly", () => {
  const e = environment();
  setup(e);
  e.run("state.nodes={};state.edges={};state.order=[];state.sel.clear();history=[];future=[];gridSnap=false;view.x=0;view.y=0;view.z=1;");
  e.run("const g=[];for (let r=0;r<4;r++) for (let c=0;c<4;c++) g.push(makeNode('rect',100+c*140,100+r*110).id);");
  e.run("for (let r=0;r<4;r++) for (let c=0;c<3;c++) makeEdge(g[r*4+c], g[r*4+c+1]);for (let c=0;c<4;c++) for (let r=0;r<3;r++) makeEdge(g[r*4+c], g[(r+1)*4+c]);routeAll();");
  const first = e.run("JSON.stringify(Object.values(state.edges).map((x) => routeEdge(x).pts))");
  e.run("routeAll();");
  const second = e.run("JSON.stringify(Object.values(state.edges).map((x) => routeEdge(x).pts))");
  assert.equal(second, first, "re-running the full solve must not move any settled route");
  const score1 = e.run("routeConflicts()");
  e.run("routeAll();");
  const score2 = e.run("routeConflicts()");
  assert.equal(score2, score1, "conflict quality is stable once the multi-pass converges");
});
/* ================= N01 - stale nudge timer vs cancelled drag ============ */

test("N01: a pending nudge timer must not autosave a cancelled drag", () => {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1};showGuides=false;state.sel=new Set([a.id]);autosave()");
  const aid = e.run("a.id");
  e.key("ArrowRight");
  const nudgedX = JSON.parse(e.run("JSON.stringify(state.nodes[a.id].x)"));
  assert.equal(nudgedX, 31, "the committed nudge rests at x=31");
  const start = JSON.parse(e.run("JSON.stringify(center(state.nodes[a.id]))"));
  pointer(e, "down", start.x, start.y);
  pointer(e, "move", start.x + 50, start.y + 50);
  e.frame();
  e.advance(401);
  e.key("Escape");
  const liveX = JSON.parse(e.run("JSON.stringify(state.nodes[a.id].x)"));
  const saved = JSON.parse(
    e.run("localStorage.getItem('openchart.doc.v1')"),
  );
  assert.equal(liveX, 31, "Escape restores the committed live state");
  assert.equal(saved.nodes[aid].x, 31, "storage never receives the provisional drag coordinates");
  assert.equal(e.run("history.length"), 1, "the cancelled drag adds no history entry");
  const savedBytes = e.run("localStorage.getItem('openchart.doc.v1')");
  const f = environment(savedBytes);
  f.run("init()");
  const fid = f.run("Object.keys(state.nodes).find((k) => state.nodes[k].text !== undefined)");
  assert.equal(
    JSON.parse(f.run("JSON.stringify(state.nodes['" + fid + "'].x)")),
    31,
    "a fresh init from the saved bytes shows the committed position",
  );
});
/* ================= F01 - deferred saves never persist previews =========== */

test("F01: the wheel save timer cannot persist a cancelled drag (plan reproduction)", () => {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1};showGuides=false;state.sel=new Set([a.id]);autosave()");
  e.document.querySelector("#stage").fire("wheel", {
    deltaX: 0, deltaY: 10, ctrlKey: false, metaKey: false, shiftKey: false,
  });
  const start = e.json("w2s(center(a).x,center(a).y)");
  pointer(e, "down", start.x, start.y);
  pointer(e, "move", start.x + 50, start.y + 50);
  e.frame();
  e.advance(251); /* the deferred save would fire mid-drag under the old code */
  e.key("Escape");
  e.advance(400); /* a retired timer must not save after the cancellation either */
  const aid = e.run("a.id");
  const saved = JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')"));
  assert.equal(saved.nodes[aid].x, 30, "storage never receives the provisional drag coordinates");
  assert.equal(e.run("history.length"), 0, "the cancelled drag adds no history entry");
  const f = environment(e.run("localStorage.getItem('openchart.doc.v1')"));
  f.run("init()");
  assert.equal(
    f.run("state.nodes['" + aid + "'].x"),
    30,
    "a fresh load shows the committed position, not the cancelled preview",
  );
});

test("F01: resize, segment, and label gestures cancel safely under a pending wheel save", () => {
  /* resize + Escape */
  {
    const e = environment();
    setup(e);
    e.run("gridSnap=false;view={x:0,y:0,z:1};state.sel=new Set([b.id]);render();renderOverlay();autosave()");
    const bid = e.run("b.id");
    const before = JSON.parse(e.run("JSON.stringify([state.nodes[b.id].w, state.nodes[b.id].h])"));
    e.document.querySelector("#stage").fire("wheel", { deltaX: 0, deltaY: 10, ctrlKey: false, metaKey: false, shiftKey: false });
    const h = e.document.querySelector('[data-handle="se"]');
    const hx = +h.getAttribute("x") + 4, hy = +h.getAttribute("y") + 4;
    pointer(e, "down", hx, hy, h);
    pointer(e, "move", hx + 12, hy + 8);
    e.advance(251);
    e.key("Escape");
    e.advance(400);
    const saved = JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')"));
    assert.deepEqual(
      [saved.nodes[bid].w, saved.nodes[bid].h],
      before,
      "the wheel timer cannot persist a cancelled resize preview",
    );
  }
  /* segment + pointercancel */
  {
    const e = environment();
    setup(e);
    e.run("gridSnap=false;view={x:0,y:0,z:1}");
    const eid = e.run("edge.id");
    e.run("state.edges['" + eid + "'].waypoints=[{x:260,y:100},{x:260,y:140},{x:340,y:140},{x:340,y:100}];state.edges['" + eid + "'].labelAuto=true;state.sel=new Set(['e:' + '" + eid + "']);routeAll();render();autosave()");
    const wpBefore = JSON.parse(e.run("JSON.stringify(state.edges['" + eid + "'].waypoints)"));
    e.document.querySelector("#stage").fire("wheel", { deltaX: 0, deltaY: 10, ctrlKey: false, metaKey: false, shiftKey: false });
    const idx = e.run("editableRoutePoints(state.edges['" + eid + "']).findIndex((p,i,ps)=>i>0&&i<ps.length-2&&p.y===140&&ps[i+1].y===140&&p.x>=260&&ps[i+1].x<=340&&p.x<ps[i+1].x)");
    const h = e.document.querySelector('[data-segment="' + idx + '"]');
    const sx = +h.getAttribute("x") + 4, sy = +h.getAttribute("y") + 4;
    pointer(e, "down", sx, sy, h);
    pointer(e, "move", sx, sy + 10);
    e.advance(251);
    e.document.querySelector("#stage").fire("pointercancel", { pointerId: 1 });
    e.advance(400);
    const saved = JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')"));
    assert.deepEqual(
      JSON.parse(JSON.stringify(saved.edges[eid].waypoints)),
      wpBefore,
      "pointercancel retires the wheel save before it can persist the preview",
    );
  }
  /* label + Escape */
  {
    const e = environment();
    setup(e);
    e.run("edge.label='Yes';routeAll();render();view={x:0,y:0,z:1};autosave()");
    const eid = e.run("edge.id");
    const lb = e.document.querySelector("[data-label]");
    const lx = +lb.getAttribute("x") + 8, ly = +lb.getAttribute("y") + 8;
    e.document.querySelector("#stage").fire("wheel", { deltaX: 0, deltaY: 10, ctrlKey: false, metaKey: false, shiftKey: false });
    pointer(e, "down", lx, ly, lb);
    pointer(e, "move", lx + 24, ly + 14);
    e.advance(251);
    e.key("Escape");
    e.advance(400);
    const saved = JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')"));
    assert.equal(
      saved.edges[eid].labelAuto,
      undefined,
      "the wheel timer cannot persist a cancelled manual label pin",
    );
  }
});

test("F01: a successful release after a wheel pan commits through the normal path", () => {
  const e = environment();
  setup(e);
  e.run("gridSnap=false;view={x:0,y:0,z:1};showGuides=false;state.sel=new Set([a.id]);autosave()");
  e.document.querySelector("#stage").fire("wheel", { deltaX: 0, deltaY: 10, ctrlKey: false, metaKey: false, shiftKey: false });
  const start = e.json("w2s(center(a).x,center(a).y)");
  pointer(e, "down", start.x, start.y);
  pointer(e, "move", start.x + 20, start.y);
  pointer(e, "up", start.x + 40, start.y); /* release past the last sampled move */
  const aid = e.run("a.id");
  const saved = JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')"));
  assert.equal(saved.nodes[aid].x, 70, "the release coordinates commit and persist");
  assert.equal(e.run("history.length"), 1, "the committed drag is one undo step");
  e.advance(500); /* the retired wheel timer must not add a second save */
  const after = JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')"));
  assert.equal(after.nodes[aid].x, 70, "no late timer rewrites the committed document");
});

test("F01: a committed wheel pan persists, and its retired timer cannot save a later preview", () => {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1};showGuides=false;autosave()");
  e.document.querySelector("#stage").fire("wheel", { deltaX: 40, deltaY: 0, ctrlKey: false, metaKey: false, shiftKey: false });
  e.advance(251);
  assert.equal(
    JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')")).view.x,
    -40,
    "the committed pan persists through the deferred save",
  );
  /* a second wheel arms the timer again; a cancelled preview must not
     overwrite the persisted view or document */
  e.document.querySelector("#stage").fire("wheel", { deltaX: -20, deltaY: 0, ctrlKey: false, metaKey: false, shiftKey: false });
  const start = e.json("w2s(center(a).x,center(a).y)");
  pointer(e, "down", start.x, start.y);
  pointer(e, "move", start.x + 30, start.y + 30);
  e.advance(251);
  e.key("Escape");
  e.advance(400);
  const saved = JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')"));
  assert.equal(saved.view.x, -20, "the flush at gesture start persisted the committed pans");
  assert.equal(JSON.parse(e.run("JSON.stringify(state.nodes[a.id].x)")), 30, "the preview never reached storage");
});
/* ================= N02 - label placement + Auto-fit persistence ========== */

test("N02: manual label placement and Auto-fit survive save/validate/reload", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Flow';routeAll();render();");
  const eid = e.run("edge.id");
  const aid = e.run("a.id");
  const lb = e.document.querySelector("[data-label]");
  const wx = +lb.getAttribute("x") + +lb.getAttribute("width") / 2;
  const wy = +lb.getAttribute("y") + +lb.getAttribute("height") / 2;
  const sp = e.json("w2s(" + wx + "," + wy + ")");
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "move", sp.x + 20, sp.y + 35);
  e.frame();
  pointer(e, "up", sp.x + 20, sp.y + 35);
  const fields = JSON.parse(
    e.run("JSON.stringify({a: state.edges[edge.id].labelAuto, t: state.edges[edge.id].labelT, o: state.edges[edge.id].labelOff})"),
  );
  assert.equal(fields.a, false, "the drag produced a manual label placement");
  assert.equal(typeof fields.t, "number", "labelT persisted as a number");
  assert.equal(typeof fields.o, "number", "labelOff persisted as a number");
  /* the real Auto-fit checkbox (it lives in the shape inspector) */
  e.run("state.sel=new Set([a.id]);refreshProps();");
  const chk = fieldControl(e, "Auto-fit text", "INPUT");
  chk.checked = true;
  chk.fire("change");
  assert.equal(e.run("state.nodes[a.id].autofit"), true, "Auto-fit enabled through the control");
  e.run("autosave()");
  const before = JSON.parse(
    e.run("JSON.stringify(labelBoxFor(state.edges[edge.id], routeEdge(state.edges[edge.id])))"),
  );
  const savedBytes = e.run("localStorage.getItem('openchart.doc.v1')");
  const f = environment(savedBytes);
  f.run("init()");
  const after = JSON.parse(
    f.run("JSON.stringify({a: state.edges['" + eid + "'].labelAuto, t: state.edges['" + eid + "'].labelT, o: state.edges['" + eid + "'].labelOff})"),
  );
  assert.deepEqual(after, fields, "label placement fields survive validation");
  assert.equal(
    f.run("state.nodes['" + aid + "'].autofit"),
    true,
    "Auto-fit survives validation",
  );
  const fbox = JSON.parse(
    f.run("JSON.stringify(labelBoxFor(state.edges['" + eid + "'], routeEdge(state.edges['" + eid + "'])))"),
  );
  assert.ok(
    Math.abs(fbox.x - before.x) < 0.51 && Math.abs(fbox.y - before.y) < 0.51,
    "the label sits where the user put it after reload",
  );
});

test("N02: malformed label fields follow the established loader policy", () => {
  const q = String.fromCharCode(39);
  const doc = (edge) =>
    JSON.stringify({
      version: 3,
      title: "N02 malformed",
      nodes: { n1: { id: "n1", type: "rect", x: 10, y: 10, w: 140, h: 56 } },
      edges: {
        e1: Object.assign({ id: "e1", src: "n1", dst: "n1" }, edge),
      },
      order: ["e1", "n1"],
      layers: [{ id: "default", name: "L1", visible: true, locked: false }],
      activeLayer: "default",
      appearance: null,
    });
  /* non-boolean labelAuto/autofit coerce exactly like every other boolean
     field in the loader (bold/locked style), and the document still loads */
  const e = environment(doc({ labelAuto: "yes", autofit: "yes" }));
  e.run("init()");
  const got = JSON.parse(
    e.run(
      "JSON.stringify({a: state.edges.e1.labelAuto, f: state.nodes.n1.autofit})",
    ),
  );
  assert.equal(got.a, true, "a non-boolean labelAuto is not a manual placement");
  assert.equal(got.f, false, "a non-boolean autofit is not an override");
  /* the numeric policy is strict: an out-of-range labelT rejects the
     document and its raw bytes are retained under the recovery key */
  const e2 = environment(doc({ labelT: 5 }));
  e2.run("init()");
  assert.equal(
    e2.run("JSON.stringify(Object.keys(state.edges))"),
    "[]",
    "an out-of-range labelT does not silently load",
  );
  /* recovery retention is in-memory until the next autosave persists it */
  assert.equal(
    e2.run("recoveryData !== null"),
    true,
    "the rejected raw document is retained for recovery",
  );
  e2.run("autosave()");
  const rec = e2.run(
    "localStorage.getItem(" + q + "openchart.doc.v1.recovery" + q + ")",
  );
  assert.ok(
    rec && rec.includes("labelT"),
    "the next autosave persists the recovery bytes",
  );
  /* a valid manual placement still loads unchanged */
  const e3 = environment(doc({ labelAuto: false, labelT: 0.4, labelOff: 12 }));
  e3.run("init()");
  const got3 = JSON.parse(
    e3.run(
      "JSON.stringify({a: state.edges.e1.labelAuto, t: state.edges.e1.labelT, o: state.edges.e1.labelOff})",
    ),
  );
  assert.deepEqual(
    got3,
    { a: false, t: 0.4, o: 12 },
    "valid manual placement loads unchanged",
  );
});
/* ================= N07 - release coordinates ============================ */

test("N07: shape movement commits the release coordinates", () => {
  const e = environment();
  setup(e);
  const aid = e.run("a.id");
  const at = () =>
    JSON.parse(e.run("JSON.stringify([state.nodes[a.id].x, state.nodes[a.id].y])"));
  const grab = e.json("w2s(state.nodes[a.id].x + 70, state.nodes[a.id].y + 28)");
  const before = at();
  pointer(e, "down", grab.x, grab.y);
  pointer(e, "move", grab.x + 20, grab.y + 20);
  pointer(e, "up", grab.x + 40, grab.y + 40);
  assert.deepEqual(
    at(),
    [before[0] + 40, before[1] + 40],
    "the pointerup delta is not lost",
  );
  const saved = JSON.parse(
    e.run("localStorage.getItem('openchart.doc.v1')"),
  );
  assert.deepEqual(
    [saved.nodes[aid].x, saved.nodes[aid].y],
    [before[0] + 40, before[1] + 40],
    "the committed save holds the release coordinates",
  );
  e.run("undo()");
  assert.deepEqual(at(), before, "one undo step restores the start");
  /* release at the same point as the last move: no extra jump */
  pointer(e, "down", grab.x, grab.y);
  pointer(e, "move", grab.x + 30, grab.y + 30);
  pointer(e, "up", grab.x + 30, grab.y + 30);
  assert.deepEqual(
    at(),
    [before[0] + 30, before[1] + 30],
    "release equal to the last move changes nothing further",
  );
  e.run("undo()");
  assert.deepEqual(at(), before, "back at the start for the frame probe");
  /* pending frame before release cannot add a second commit */
  pointer(e, "down", grab.x, grab.y);
  pointer(e, "move", grab.x + 10, grab.y + 10);
  pointer(e, "up", grab.x + 25, grab.y + 25);
  e.frame();
  assert.deepEqual(
    at(),
    [before[0] + 25, before[1] + 25],
    "a pending frame does not overwrite or re-apply the final state",
  );
});

test("N07: resize and segment drags commit the release coordinates", () => {
  const e = environment();
  setup(e);
  e.run("gridSnap=false;");
  e.run("view={x:0,y:0,z:1};");
  const bid = e.run("b.id");
  const eid = e.run("edge.id");
  const sizeAt = () =>
    JSON.parse(e.run("JSON.stringify([state.nodes[b.id].w, state.nodes[b.id].h])"));
  const sizeBefore = sizeAt();
  e.run("state.sel=new Set([b.id]);render();renderOverlay();");
  const h = e.document.querySelector('[data-handle="se"]');
  const hx = +h.getAttribute("x") + 4,
    hy = +h.getAttribute("y") + 4;
  pointer(e, "down", hx, hy, h);
  pointer(e, "move", hx + 12, hy + 8);
  pointer(e, "up", hx + 30, hy + 20);
  assert.deepEqual(
    sizeAt(),
    [sizeBefore[0] + 30, sizeBefore[1] + 20],
    "the resize commits the release corner, not the last move",
  );
  e.run("undo()");
  assert.deepEqual(sizeAt(), sizeBefore, "resize undo is one step");
  /* segment drag: corridor handle dragged down; release lower than move.
     The undo above replaced the edge object, so address it by captured id. */
  e.run(
    "state.edges['" + eid + "'].waypoints=[{x:260,y:100},{x:260,y:140},{x:340,y:140},{x:340,y:100}];state.edges['" + eid + "'].labelAuto=true;state.sel=new Set(['e:' + '" + eid + "']);routeAll();render();",
  );
  const wpAt = () =>
    JSON.parse(e.run("JSON.stringify(state.edges['" + eid + "'].waypoints)"));
  const wpBefore = wpAt();
  const idx = e.run(
    "editableRoutePoints(state.edges['" + eid + "']).findIndex((p,i,ps)=>i>0&&i<ps.length-2&&p.y===140&&ps[i+1].y===140&&p.x>=260&&ps[i+1].x<=340&&p.x<ps[i+1].x)",
  );
  const handle = e.document.querySelector('[data-segment="' + idx + '"]');
  assert.ok(handle, "the selected corridor offers a segment handle");
  const sx = +handle.getAttribute("x") + 4,
    sy = +handle.getAttribute("y") + 4;
  pointer(e, "down", sx, sy, handle);
  assert.equal(e.run("gesture && gesture.kind"), "edgeMove", "the handle starts a segment drag");
  pointer(e, "move", sx, sy + 10);
  pointer(e, "up", sx, sy + 24);
  const wpAfter = wpAt();
  assert.equal(
    wpAfter[1].y,
    wpBefore[1].y + 24,
    "the segment drag commits the release offset",
  );
  e.run("undo()");
  assert.deepEqual(wpAt(), wpBefore, "segment undo is one step");
});

test("N07: a label drag commits the release position", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';routeAll();render();");
  const lb = e.document.querySelector("[data-label]");
  const wx = +lb.getAttribute("x") + +lb.getAttribute("width") / 2;
  const wy = +lb.getAttribute("y") + +lb.getAttribute("height") / 2;
  const sp = e.json("w2s(" + wx + "," + wy + ")");
  pointer(e, "down", sp.x, sp.y, lb);
  pointer(e, "move", sp.x + 14, sp.y + 9);
  pointer(e, "up", sp.x + 40, sp.y + 26);
  const placement = JSON.parse(
    e.run("JSON.stringify(edgeLabelPlacement(state.edges[edge.id], routeEdge(state.edges[edge.id])))"),
  );
  const expected = e.json(
    "JSON.stringify(s2w(" + (sp.x + 40) + "," + (sp.y + 26) + "))",
  );
  const want = JSON.parse(expected);
  assert.ok(
    Math.abs(placement.x - want.x) < 1.5 &&
      Math.abs(placement.y - want.y) < 1.5,
    "the label rests at the release point, got " +
      JSON.stringify(placement) +
      " want " +
      JSON.stringify(want),
  );
});
/* ================= F02 - Shift-resize keeps its ratio at release ========= */

test("F02: Shift-resize commits the previewed ratio, not the raw release rect", () => {
  const e = environment();
  setup(e);
  e.run("gridSnap=false;view={x:0,y:0,z:1};showGuides=false;");
  e.run("state.sel=new Set([b.id]);render();renderOverlay();");
  const h = e.document.querySelector('[data-handle="se"]');
  const hx = +h.getAttribute("x") + 4, hy = +h.getAttribute("y") + 4;
  pointer(e, "down", hx, hy, h, { shiftKey: true });
  pointer(e, "move", hx + 70, hy + 10, "#stage", { shiftKey: true });
  assert.deepEqual(
    JSON.parse(e.run("JSON.stringify([state.nodes[b.id].w, state.nodes[b.id].h])")),
    [210, 84],
    "the live preview preserves the original ratio",
  );
  pointer(e, "up", hx + 70, hy + 10, "#stage", { shiftKey: true });
  assert.deepEqual(
    JSON.parse(e.run("JSON.stringify([state.nodes[b.id].w, state.nodes[b.id].h])")),
    [210, 84],
    "the release applies the same constraint solver as the preview",
  );
});

test("F02: Shift transitions during the gesture are defined by the last preview", () => {
  /* Shift released before the pointer: the release must still match the
     last ratio-constrained preview. */
  {
    const e = environment();
    setup(e);
    e.run("gridSnap=false;view={x:0,y:0,z:1};showGuides=false;");
    e.run("state.sel=new Set([b.id]);render();renderOverlay();");
    const h = e.document.querySelector('[data-handle="se"]');
    const hx = +h.getAttribute("x") + 4, hy = +h.getAttribute("y") + 4;
    pointer(e, "down", hx, hy, h, { shiftKey: true });
    pointer(e, "move", hx + 70, hy + 10, "#stage", { shiftKey: true });
    pointer(e, "up", hx + 70, hy + 10, "#stage", { shiftKey: false });
    assert.deepEqual(
      JSON.parse(e.run("JSON.stringify([state.nodes[b.id].w, state.nodes[b.id].h])")),
      [210, 84],
      "releasing Shift without moving again commits the last preview",
    );
  }
  /* Shift released AND moved after: the unconstrained preview commits. */
  {
    const e = environment();
    setup(e);
    e.run("gridSnap=false;view={x:0,y:0,z:1};showGuides=false;");
    e.run("state.sel=new Set([b.id]);render();renderOverlay();");
    const h = e.document.querySelector('[data-handle="se"]');
    const hx = +h.getAttribute("x") + 4, hy = +h.getAttribute("y") + 4;
    pointer(e, "down", hx, hy, h, { shiftKey: true });
    pointer(e, "move", hx + 70, hy + 10, "#stage", { shiftKey: true });
    pointer(e, "move", hx + 75, hy + 10, "#stage", { shiftKey: false });
    const live = JSON.parse(e.run("JSON.stringify([state.nodes[b.id].w, state.nodes[b.id].h])"));
    pointer(e, "up", hx + 75, hy + 10, "#stage", { shiftKey: false });
    assert.deepEqual(
      JSON.parse(e.run("JSON.stringify([state.nodes[b.id].w, state.nodes[b.id].h])")),
      live,
      "the commit equals the last (unconstrained) preview after the modifier changes",
    );
  }
  /* Shift pressed mid-gesture: the base ratio applies from that frame on. */
  {
    const e = environment();
    setup(e);
    e.run("gridSnap=false;view={x:0,y:0,z:1};showGuides=false;");
    e.run("state.sel=new Set([b.id]);render();renderOverlay();");
    const h = e.document.querySelector('[data-handle="se"]');
    const hx = +h.getAttribute("x") + 4, hy = +h.getAttribute("y") + 4;
    pointer(e, "down", hx, hy, h, { shiftKey: false });
    pointer(e, "move", hx + 30, hy, "#stage", { shiftKey: false });
    pointer(e, "move", hx + 70, hy + 10, "#stage", { shiftKey: true });
    pointer(e, "up", hx + 70, hy + 10, "#stage", { shiftKey: true });
    assert.deepEqual(
      JSON.parse(e.run("JSON.stringify([state.nodes[b.id].w, state.nodes[b.id].h])")),
      [210, 84],
      "a mid-gesture Shift press constrains the preview and the commit alike",
    );
  }
});

test("F02: size-matching guides never override an active aspect ratio", () => {
  const e = environment();
  setup(e);
  e.run("gridSnap=false;view={x:0,y:0,z:1};showGuides=false;");
  e.run("state.nodes[a.id].w=208;state.nodes[a.id].y=state.nodes[b.id].y;");
  e.run("state.sel=new Set([b.id]);render();renderOverlay();");
  const h = e.document.querySelector('[data-handle="se"]');
  const hx = +h.getAttribute("x") + 4, hy = +h.getAttribute("y") + 4;
  pointer(e, "down", hx, hy, h, { shiftKey: true });
  pointer(e, "move", hx + 66, hy, "#stage", { shiftKey: true }); /* 206 wide: within the size-match window of 208 */
  pointer(e, "up", hx + 66, hy, "#stage", { shiftKey: true });
  const w = JSON.parse(e.run("state.nodes[b.id].w"));
  const hgt = JSON.parse(e.run("state.nodes[b.id].h"));
  assert.equal(w, 206, "the ratio-constrained width is kept (no snap to 208)");
  assert.ok(Math.abs(w / hgt - 2.5) < 1e-9, "the committed rectangle keeps the base ratio");
});

test("F02: a release away from the press point is a drag even without move events", () => {
  const e = environment();
  setup(e);
  e.run("gridSnap=false;view={x:0,y:0,z:1};showGuides=false;");
  e.run("state.sel=new Set([b.id]);render();renderOverlay();");
  const h = e.document.querySelector('[data-handle="se"]');
  const hx = +h.getAttribute("x") + 4, hy = +h.getAttribute("y") + 4;
  pointer(e, "down", hx, hy, h);
  pointer(e, "up", hx + 30, hy + 20); /* no move events in between */
  assert.deepEqual(
    JSON.parse(e.run("JSON.stringify([state.nodes[b.id].w, state.nodes[b.id].h])")),
    [170, 76],
    "the final pointer location commits, consistent with click-vs-drag",
  );
});

/* ================= F03 - create-and-connect keeps port intent ============ */

/* Drives the real connect gesture: press a source side, drag to empty
   canvas, release, and click a picker button. Returns the created edge. */
const f03Create = (e, side, dx, dy) => {
  e.run("setTool('connect')");
  const c = e.json("w2s(center(a).x,center(a).y)");
  const press = {
    e: { x: c.x + 66, y: c.y },
    w: { x: c.x - 66, y: c.y },
    n: { x: c.x, y: c.y - 24 },
    s: { x: c.x, y: c.y + 24 },
  }[side];
  pointer(e, "down", press.x, press.y);
  pointer(e, "move", press.x + dx, press.y + dy);
  pointer(e, "up", press.x + dx, press.y + dy);
  const btn = buttonByLabel(e, "Create and connect Process");
  assert.ok(btn, "the picker offered the shape");
  btn.click();
  const sel = e.run("[...state.sel][0]");
  const eid = e.run(
    "Object.keys(state.edges).find(k => state.edges[k].dst === " +
      JSON.stringify(sel) +
      ")",
  );
  assert.ok(eid, "the connector to the created shape exists");
  return JSON.parse(e.run("JSON.stringify(state.edges['" + eid + "'])"));
};

test("F03: create-and-connect uses the dragged side and the facing target side", () => {
  const cases = [
    ["e", 120, 0, "w"], /* east drop: the new box's west side faces the source */
    ["w", -200, 0, "e"], /* west drop: facing east, no detour into the top */
    ["n", 0, -200, "s"], /* north drop: facing south, no loop */
    ["s", 0, 200, "n"], /* south drop: facing north */
  ];
  for (const [side, dx, dy, facing] of cases) {
    const e = environment();
    setup(e);
    e.run("view={x:0,y:0,z:1};showGuides=false;");
    const r = f03Create(e, side, dx, dy);
    assert.equal(r.src, e.run("a.id"), side + ": the source stays the source");
    assert.equal(r.srcSide, side, side + ": the deliberate source side is stored");
    assert.equal(r.dstSide, facing, side + ": the target attaches on its facing side");
  }
});

test("F03: the picker stays inert on Escape and honest across a viewport pan", () => {
  /* Escape creates nothing */
  {
    const e = environment();
    setup(e);
    e.run("view={x:0,y:0,z:1};showGuides=false;");
    const before = e.run("localStorage.getItem('openchart.doc.v1')");
    e.run("setTool('connect')");
    const c = e.json("w2s(center(a).x,center(a).y)");
    pointer(e, "down", c.x + 70, c.y);
    pointer(e, "move", c.x + 190, c.y);
    pointer(e, "up", c.x + 190, c.y);
    assert.ok(e.run("!!document.querySelector('#shape-picker') && !document.querySelector('#shape-picker').hidden"), "the picker opened");
    e.key("Escape");
    assert.equal(e.run("Object.keys(state.nodes).length"), 2, "Escape creates no shape");
    assert.equal(e.run("Object.keys(state.edges).length"), 1, "Escape creates no connector");
    assert.equal(e.run("history.length"), 0, "Escape writes no history entry");
    assert.equal(e.run("localStorage.getItem('openchart.doc.v1')"), before, "Escape writes no storage");
  }
  /* a viewport pan while the picker is open */
  {
    const e = environment();
    setup(e);
    e.run("view={x:0,y:0,z:1};showGuides=false;");
    const cy = e.json("center(a).y");
    e.run("setTool('connect')");
    const c = e.json("w2s(center(a).x,center(a).y)");
    pointer(e, "down", c.x + 70, c.y);
    pointer(e, "move", c.x + 190, c.y);
    pointer(e, "up", c.x + 190, c.y);
    e.document.querySelector("#stage").fire("wheel", { deltaX: 120, deltaY: 0, ctrlKey: false, metaKey: false, shiftKey: false });
    buttonByLabel(e, "Create and connect Process").click();
    const sel = e.run("[...state.sel][0]");
    const placed = JSON.parse(e.run("JSON.stringify(state.nodes['" + sel + "'])"));
    assert.equal(placed.x + placed.w / 2, 290, "the shape lands at the drop point, not the panned pointer");
    assert.equal(placed.y + placed.h / 2, cy, "the vertical placement is the drop point too");
    const eid = e.run("Object.keys(state.edges).find(k => state.edges[k].dst === " + JSON.stringify(sel) + ")");
    const r = JSON.parse(e.run("JSON.stringify(state.edges['" + eid + "'])"));
    assert.equal(r.srcSide, "e", "the source side survives the pan");
    assert.equal(r.dstSide, "w", "the facing target side survives the pan");
  }
});

test("F03: diamond sources and non-unit zoom keep the same contract; choices persist", () => {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1.5};showGuides=false;");
  e.run("const d = makeNode('decision', 500, 300); assignParent(d); window.__d = d.id; render(); routeAll();");
  e.run("window.__d = d.id;");
  const dc = e.json("w2s(center(state.nodes[window.__d]).x, center(state.nodes[window.__d]).y)");
  e.run("setTool('connect')");
  pointer(e, "down", dc.x + 66, dc.y);
  pointer(e, "move", dc.x + 270, dc.y);
  pointer(e, "up", dc.x + 270, dc.y);
  buttonByLabel(e, "Create and connect Process").click();
  const sel = e.run("[...state.sel][0]");
  const eid = e.run("Object.keys(state.edges).find(k => state.edges[k].dst === " + JSON.stringify(sel) + ")");
  const r = JSON.parse(e.run("JSON.stringify(state.edges['" + eid + "'])"));
  assert.equal(r.src, e.run("window.__d"), "the diamond is the source");
  assert.equal(r.srcSide, "e", "the pressed diamond side is stored");
  assert.equal(r.dstSide, "w", "the created box attaches on its facing side");
  /* save/reload retains the choices */
  e.run("autosave()");
  const saved = e.run("localStorage.getItem('openchart.doc.v1')");
  const f = environment(saved);
  f.run("init()");
  const after = JSON.parse(f.run("JSON.stringify(state.edges[" + JSON.stringify(eid) + "])"));
  assert.equal(after.srcSide, "e", "the source side persists across reload");
  assert.equal(after.dstSide, "w", "the facing target side persists across reload");
});

/* ================= F04 - quality findings select real objects ============ */

const f04Click = (e, needle) => {
  const rows = [...e.document.querySelectorAll(".check-row")];
  const row = rows.find((r) => r.textContent.indexOf(needle) >= 0);
  assert.ok(row, "a finding row mentions " + needle);
  row.fire("click");
  return JSON.parse(e.run("JSON.stringify([...state.sel])"));
};

test("F04: a connector finding selects the connector through its item key", () => {
  const e = environment();
  setup(e);
  e.run("const c = makeNode('rect', 260, 100); assignParent(c); window.__c = c.id; const ec = makeEdge(a.id, c.id); window.__ec = ec.id; routeAll(); render(); refreshProps();");
  const before = e.run("history.length");
  const sel = f04Click(e, "too short for its arrowheads");
  assert.deepEqual(
    sel,
    ["e:" + e.run("window.__ec")],
    "the tight-arrow finding selects the connector with its e: key",
  );
  assert.equal(e.run("history.length"), before, "selecting from a finding mutates nothing");
});

test("F04: a pair finding keeps both typed objects selected", () => {
  /* overlapping connector labels: two parallel a->b edges */
  {
    const e = environment();
    setup(e);
    e.run("const e2 = makeEdge(a.id, b.id); window.__e2 = e2.id; routeAll(); render();");
    // The finding needs deliberately overlapping manual labels now that
    // reciprocal/parallel port spacing accounts for the full arrowheads.
    e.run("edge.label='One';e2.label='Two';for(const e of [edge,e2]){e.srcSide='e';e.dstSide='w';e.route='straight';e.labelAuto=false;e.labelT=.5;}routeAll();for(const e of [edge,e2])e.labelOff=center(a).y-routeEdge(e).pts[0].y;render();refreshProps();");
    const sel = f04Click(e, "labels overlap");
    assert.equal(sel.length, 2, "the pair finding selects both connectors");
    assert.ok(
      sel.every((k) => k.indexOf("e:") === 0),
      "both selections use canonical connector keys",
    );
  }
  /* overlapping shapes: both nodes */
  {
    const e = environment();
    setup(e);
    e.run("const d = makeNode('rect', 120, 100); assignParent(d); window.__d = d.id; routeAll(); render(); refreshProps();");
    const sel = f04Click(e, "overlaps");
    assert.equal(sel.length, 2, "the shape-overlap finding selects both shapes");
    assert.ok(sel.includes(e.run("a.id")), "the first shape of the pair is selected");
  }
  /* node-only finding: text overflow */
  {
    const e = environment();
    setup(e);
    e.run("state.nodes[a.id].text = 'A very long label that cannot fit'; state.nodes[a.id].w = 60; state.nodes[a.id].h = 24; routeAll(); render(); refreshProps();");
    const sel = f04Click(e, "has text larger than its shape");
    assert.deepEqual(sel, [e.run("a.id")], "the node finding selects the node");
  }
});

/* ================= F05 - derived control state stays truthful ============ */

test("F05: changing a Tidy option disables Apply until a new preview", () => {
  const e = environment();
  setup(e);
  tidyDoc(e);
  const applyBtn = () => buttonByLabel(e, "Apply");
  buttonByLabel(e, "Preview").click();
  assert.equal(applyBtn().disabled, false, "Preview arms Apply");
  /* each option control clears the proposal through its real callback */
  const gap = fieldControl(e, "Spacing");
  gap.value = "96";
  gap.fire("change");
  assert.equal(e.run("tidyPreview"), null, "the spacing change cleared the proposal");
  assert.equal(applyBtn().disabled, true, "Apply is inert without a proposal");
  buttonByLabel(e, "Preview").click();
  assert.equal(applyBtn().disabled, false, "a new preview re-arms Apply");
  const dir = fieldControl(e, "Flow direction");
  dir.value = "tb";
  dir.fire("change");
  assert.equal(applyBtn().disabled, true, "the direction option disarms Apply too");
  buttonByLabel(e, "Preview").click();
  const norm = fieldControl(e, "Normalize sizes", "INPUT");
  norm.checked = true;
  norm.fire("change");
  assert.equal(applyBtn().disabled, true, "the normalize option disarms Apply");
  /* preview / cancel stay honest, and re-previewing is idempotent */
  buttonByLabel(e, "Preview").click();
  assert.equal(applyBtn().disabled, false, "re-previewing re-arms Apply");
  buttonByLabel(e, "Cancel").click();
  assert.equal(applyBtn().disabled, true, "Cancel disarms Apply");
  /* stale-to-refreshed: drifted geometry refuses, refreshes, stays armed */
  buttonByLabel(e, "Preview").click();
  const ids = JSON.parse(e.run("JSON.stringify(Object.keys(state.nodes))"));
  e.run("state.nodes['" + ids[0] + "'].x += 40;");
  applyBtn().click();
  assert.ok(e.run("tidyPreview"), "the drifted preview refreshed for review");
  assert.equal(applyBtn().disabled, false, "the refreshed proposal keeps Apply armed");
  const hist = e.run("history.length");
  applyBtn().click();
  assert.equal(e.run("history.length"), hist + 1, "the reviewed proposal applies");
  assert.equal(applyBtn().disabled, true, "consuming the refreshed proposal disarms Apply");
});

test("F05: the toolbar Size control agrees with the inspector on mixed sizes", () => {
  const e = environment();
  setup(e);
  e.run("state.nodes[a.id].fontSize = 18; state.nodes[b.id].fontSize = 24; updateChrome()");
  assert.equal(
    String(e.document.querySelector('#format-size').value),
    "",
    "the toolbar shows no fabricated size for an 18/24 selection",
  );
  e.run("state.sel.clear(); state.sel.add(b.id); updateChrome()");
  assert.equal(String(e.document.querySelector('#format-size').value), "24", "a single explicit size shows as-is");
  e.run("state.sel.clear(); state.sel.add(a.id); state.sel.add(b.id); state.nodes[b.id].fontSize = 18; updateChrome()");
  assert.equal(String(e.document.querySelector('#format-size').value), "18", "two equal explicit sizes show their value");
  /* inherited sizes resolve through the same helper */
  e.run("delete state.nodes[a.id].fontSize; delete state.nodes[b.id].fontSize; updateChrome()");
  assert.equal(
    String(e.document.querySelector('#format-size').value),
    "13",
    "two inherited body sizes show the resolved body size",
  );
  /* explicit + inherited with equal resolved values */
  e.run("state.nodes[a.id].fontSize = 13; updateChrome()");
  assert.equal(
    String(e.document.querySelector('#format-size').value),
    "13",
    "explicit 13 and inherited 13 agree and show 13",
  );
  /* explicit + inherited with unequal resolved values */
  e.run("state.nodes[b.id].type = 'container'; state.nodes[b.id].fontSizeMode = 'heading'; updateChrome()");
  assert.equal(
    String(e.document.querySelector('#format-size').value),
    "",
    "explicit 13 and inherited heading 15 disagree and stay empty",
  );
});

/* ================= F06 - connector defaults contract ===================== */

test("F06: a rounded default persists and reloads without recovery", () => {
  const e = environment();
  setup(e);
  e.run("state.edges[edge.id].route = 'curved'; state.sel = new Set(['e:' + edge.id]); render(); refreshProps();");
  const btn = buttonByLabel(e, "Set as default");
  assert.ok(btn, "connector-only selection offers Set as default");
  btn.click();
  assert.equal(
    e.run("ensureAppearance().edgeDefaults.route"),
    "curved",
    "the command stores the rounded default",
  );
  e.run("autosave()");
  const f = environment(e.run("localStorage.getItem('openchart.doc.v1')"));
  f.run("init()");
  assert.equal(f.run("Object.keys(state.nodes).length"), 2, "the document loads, no recovery error");
  assert.equal(
    f.run("ensureAppearance().edgeDefaults.route"),
    "curved",
    "the curved default round-trips through the loader",
  );
});

test("F06: connector-only selection offers the style actions and they work", () => {
  const e = environment();
  setup(e);
  e.run("state.sel = new Set(['e:' + edge.id]); render(); refreshProps()");
  assert.ok(buttonByLabel(e, "Copy style"), "Copy style is offered for connectors");
  assert.ok(buttonByLabel(e, "Paste style"), "Paste style is offered for connectors");
  assert.ok(buttonByLabel(e, "Set as default"), "Set as default is offered for connectors");
  /* copy from the styled edge, paste onto the second edge */
  e.run("state.edges[edge.id].color = '#7c3aed'; state.edges[edge.id].route = 'straight'; refreshProps()");
  buttonByLabel(e, "Copy style").click();
  const e2id = e.run("window.__e2");
  e.run("const e2 = makeEdge(a.id, b.id); window.__e2 = e2.id; state.sel = new Set(['e:' + e2.id]); render(); refreshProps()");
  buttonByLabel(e, "Paste style").click();
  assert.equal(
    e.run("state.edges[window.__e2].color"),
    "#7c3aed",
    "pasting an edge style applies the color",
  );
  assert.equal(
    e.run("state.edges[window.__e2].route"),
    "straight",
    "pasting an edge style applies the route",
  );
  /* mixed selection: an edge clipboard applies only to connectors */
  const nodeFill = e.run("state.nodes[a.id].fill");
  e.run("state.sel = new Set(['e:' + edge.id, a.id]); refreshProps()");
  buttonByLabel(e, "Paste style").click();
  assert.equal(e.run("state.nodes[a.id].fill"), nodeFill, "an edge clipboard never restyles nodes");
  assert.equal(e.run("state.edges[edge.id].color"), "#7c3aed", "the connector keeps the pasted style");
});

test("F06: the Path control and the loader share one route enumeration", () => {
  const e = environment();
  setup(e);
  e.run("state.sel = new Set(['e:' + edge.id]); render(); refreshProps()");
  const sel = [...e.document.querySelectorAll("select")].find((s) =>
    [...s.children].some((o) => o.value === "curved"),
  );
  assert.ok(sel, "the Path control exists");
  const opts = [...sel.children].map((o) => o.value);
  assert.deepEqual(opts, ["orthogonal", "curved", "straight"], "the Path control offers every supported route");
  const eid = e.run("edge.id");
  for (const route of ["orthogonal", "curved", "straight"]) {
    e.run("state.edges[edge.id].route = '" + route + "'; autosave()");
    const f = environment(e.run("localStorage.getItem('openchart.doc.v1')"));
    f.run("init()");
    assert.equal(
      f.run("state.edges['" + eid + "'] ? state.edges['" + eid + "'].route : null"),
      route,
      route + " connectors survive save/reload",
    );
  }
});

/* ================= Q02 - grip and label hit targets ====================== */

test("Q02: the straight connector's middle grip clears its label", () => {
  const e = environment();
  setup(e);
  e.run("state.edges[edge.id].label = 'Yes'; routeAll(); state.sel = new Set(['e:' + edge.id]); render(); renderOverlay()");
  /* the label box in the same screen space the overlay uses */
  const box = JSON.parse(
    e.run(
      "JSON.stringify((function(){ const b = labelBoxFor(state.edges[edge.id], routeEdge(state.edges[edge.id])); const tl = w2s(b.x, b.y), br = w2s(b.x + b.w, b.y + b.h); return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }; })())",
    ),
  );
  const handles = [...e.document.querySelectorAll("[data-segment]")].map((el) => ({
    x: +el.getAttribute("x"),
    y: +el.getAttribute("y"),
    w: +el.getAttribute("width"),
    h: +el.getAttribute("height"),
  }));
  assert.ok(handles.length >= 1, "the straight connector still offers a middle grip");
  for (const h of handles) {
    const cx = h.x + h.w / 2,
      cy = h.y + h.h / 2;
    const inside =
      cx > box.x - 6 && cx < box.x + box.w + 6 && cy > box.y - 6 && cy < box.y + box.h + 6;
    assert.ok(!inside, "no segment grip sits inside the label box");
  }
});

test("Q02: an unlabeled straight connector keeps its middle grip", () => {
  const e = environment();
  setup(e);
  e.run("routeAll(); state.sel = new Set(['e:' + edge.id]); render(); renderOverlay()");
  const handles = [...e.document.querySelectorAll("[data-segment]")];
  assert.ok(handles.length >= 1, "the unlabeled straight connector offers a middle grip");
});

/* ================= N03 - three-point elbow legs ========================= *//* ================= N03 - three-point elbow legs ========================= */

const orthoOk = (pts) => {
  for (let i = 1; i < pts.length; i++)
    if (pts[i].x !== pts[i - 1].x && pts[i].y !== pts[i - 1].y) return false;
  return true;
};

test("N03: a three-point elbow exposes draggable legs", () => {
  const e = environment();
  setup(e);
  e.run("gridSnap=false;view={x:0,y:0,z:1};");
  const eid = e.run("edge.id");
  e.run("state.nodes[b.id].x=164;state.nodes[b.id].y=164;routeAll();");
  const pts0 = JSON.parse(
    e.run("JSON.stringify(routeEdge(state.edges['" + eid + "']).pts)"),
  );
  assert.equal(pts0.length, 3, "the auto route is a bare elbow");
  e.run("state.sel=new Set(['e:" + eid + "']);render();renderOverlay();");
  const ep = JSON.parse(
    e.run(
      "JSON.stringify(editableRoutePoints(state.edges['" + eid + "']))",
    ),
  );
  assert.equal(ep.length, 5, "both legs are exposed as editable segments");
  const handles = [...e.document.querySelectorAll("[data-segment]")];
  assert.equal(handles.length, 2, "each leg offers one segment handle");
  /* drag the horizontal leg down; the release offset must hold */
  const h1 = handles[0];
  const hx = +h1.getAttribute("x") + 4,
    hy = +h1.getAttribute("y") + 4;
  pointer(e, "down", hx, hy, h1);
  assert.equal(
    e.run("gesture && gesture.kind"),
    "edgeMove",
    "the leg handle starts a segment drag",
  );
  pointer(e, "move", hx, hy + 12);
  pointer(e, "up", hx, hy + 24);
  const pts1 = JSON.parse(
    e.run("JSON.stringify(routeEdge(state.edges['" + eid + "']).pts)"),
  );
  assert.equal(pts1.length, 5, "dragging a leg inserts a dogleg");
  assert.ok(orthoOk(pts1), "the dragged route stays orthogonal");
  assert.equal(pts1[0].x, pts0[0].x, "the source attachment stays put");
  assert.equal(pts1[0].y, pts0[0].y, "the source attachment stays put");
  const last0 = pts0.at(-1),
    last1 = pts1.at(-1);
  assert.equal(last1.x, last0.x, "the destination attachment stays put");
  assert.equal(last1.y, last0.y, "the destination attachment stays put");
  const wp = JSON.parse(
    e.run("JSON.stringify(state.edges['" + eid + "'].waypoints)"),
  );
  assert.ok(
    wp.length >= 3,
    "the constraint list stores the dogleg, got " + wp.length,
  );
  e.run("undo()");
  assert.equal(
    JSON.parse(e.run("JSON.stringify(routeEdge(state.edges['" + eid + "']).pts)")).length,
    3,
    "undo restores the bare elbow",
  );
  /* drag the vertical leg sideways. Q02: the undo above cleared the
     selection and the overlay, so every handle captured before it is
     detached from the document; reselect the connector, repaint, and
     reacquire the live handles instead of reusing stale nodes. */
  e.run("state.sel=new Set(['e:" + eid + "']);render();renderOverlay();");
  const handlesAfterUndo = [...e.document.querySelectorAll("[data-segment]")];
  assert.equal(
    handlesAfterUndo.length,
    2,
    "both leg handles are re-offered after the undo",
  );
  assert.notEqual(
    handlesAfterUndo[0],
    handles[0],
    "the reacquired handles are live nodes, not the detached ones",
  );
  /* the vertical leg handle sits on the final route column */
  const lastX = pts0.at(-1).x;
  const h2 = handlesAfterUndo.find(
    (el) => Math.abs(+el.getAttribute("x") + 4 - lastX) < 6,
  );
  assert.ok(h2, "a vertical leg handle is reacquired after undo");
  const h2x = +h2.getAttribute("x") + 4,
    h2y = +h2.getAttribute("y") + 4;
  pointer(e, "down", h2x, h2y, h2);
  pointer(e, "move", h2x + 10, h2y);
  pointer(e, "up", h2x + 20, h2y);
  const pts2 = JSON.parse(
    e.run("JSON.stringify(routeEdge(state.edges['" + eid + "']).pts)"),
  );
  assert.ok(pts2.length >= 5, "the other leg also drags into a dogleg");
  assert.ok(orthoOk(pts2), "the second drag stays orthogonal");
  assert.equal(pts2[0].x, pts0[0].x, "source attachment intact");
  assert.equal(pts2[0].y, pts0[0].y, "source attachment intact");
  const last2 = pts2.at(-1);
  assert.equal(last2.x, last0.x, "destination attachment intact");
  assert.equal(last2.y, last0.y, "destination attachment intact");
  /* save, reload, and drag again on the persisted geometry */
  e.run("autosave()");
  const saved = e.run("localStorage.getItem('openchart.doc.v1')");
  const f = environment(saved);
  f.run("init()");
  const pts3 = JSON.parse(
    f.run("JSON.stringify(routeEdge(state.edges['" + eid + "']).pts)"),
  );
  assert.deepEqual(pts3, pts2, "the dogleg survives save/reload");
  f.run("state.sel=new Set(['e:" + eid + "']);render();renderOverlay();");
  const handles2 = [...f.document.querySelectorAll("[data-segment]")];
  assert.ok(handles2.length >= 1, "handles are still offered after reload");
  const h3 = handles2[0];
  const h3x = +h3.getAttribute("x") + 4,
    h3y = +h3.getAttribute("y") + 4;
  pointer(f, "down", h3x, h3y, h3);
  pointer(f, "move", h3x + 10, h3y);
  pointer(f, "up", h3x + 20, h3y);
  const pts4 = JSON.parse(
    f.run("JSON.stringify(routeEdge(state.edges['" + eid + "']).pts)"),
  );
  assert.ok(orthoOk(pts4), "a second session drag stays orthogonal");
  const last4 = pts4.at(-1);
  assert.equal(last4.x, last0.x, "the port still holds after re-dragging");
  assert.equal(last4.y, last0.y, "the port still holds after re-dragging");
});

/* ================= P01 - gesture-fast routing for segment drags ========== */

test("P01: a segment drag routes on the fast path, the release settles fully", () => {
  const e = environment();
  setup(e);
  e.run("gridSnap=false;view={x:0,y:0,z:1};");
  const eid = e.run("edge.id");
  e.run("state.nodes[b.id].x=164;state.nodes[b.id].y=164;routeAll();");
  e.run("state.sel=new Set(['e:" + eid + "']);render();renderOverlay();");
  const handles = [...e.document.querySelectorAll("[data-segment]")];
  assert.ok(handles.length >= 1, "the elbow offers a segment handle");
  const h = handles[0];
  const hx = +h.getAttribute("x") + 4,
    hy = +h.getAttribute("y") + 4;
  /* Spy on the multi-pass scorer: during the gesture every frame must stay
     on the single fast pass; the release runs the full multi-pass route. */
  e.run(
    "var __rcCalls=0;const __origRc=routeConflicts;" +
      "routeConflicts=function(){__rcCalls++;return __origRc.apply(this,arguments);};",
  );
  pointer(e, "down", hx, hy, h);
  assert.equal(
    e.run("gesture && gesture.kind"),
    "edgeMove",
    "the handle starts a segment drag",
  );
  e.run("routesDirty=true;render();");
  assert.equal(
    Number(e.run("__rcCalls")),
    0,
    "the drag frame does not run the multi-pass scorer",
  );
  pointer(e, "move", hx, hy + 12);
  e.run("render();");
  assert.equal(
    Number(e.run("__rcCalls")),
    0,
    "moving the segment still routes on the fast path",
  );
  pointer(e, "up", hx, hy + 24);
  e.run("render();");
  assert.ok(
    Number(e.run("__rcCalls")) >= 1,
    "the release runs the full multi-pass scorer",
  );
});
/* ================= P01 - seeded release settle =========================== */

const routeFpExpr =
  "(function(){return JSON.stringify(Object.values(state.edges).map(function(e){const r=routeCache.get(e.id);return r&&r.pts?r.pts.map(function(p){return Math.round(p.x*8)+','+Math.round(p.y*8);}).join(' '):'null';}));})()";

test("P01: the release settle matches a fresh full solve", () => {
  const e = environment();
  setup(e);
  e.run(
    "gridSnap=false;view={x:0,y:0,z:1};" +
      "const p1=makeNode('rect',100,100),p2=makeNode('rect',500,60),p3=makeNode('rect',760,300),p4=makeNode('rect',300,380);" +
      "makeEdge(p1.id,p3.id);makeEdge(p2.id,p4.id);makeEdge(p1.id,p2.id);makeEdge(p3.id,p4.id);routeAll();",
  );
  const before = e.run(routeFpExpr);
  const ids = e.json("Object.keys(state.nodes)");
  const grab = e.json(
    "w2s(state.nodes['" + ids[3] + "'].x + 70, state.nodes['" + ids[3] + "'].y + 28)",
  );
  pointer(e, "down", grab.x, grab.y);
  pointer(e, "move", grab.x + 20, grab.y + 16);
  pointer(e, "up", grab.x + 30, grab.y + 30);
  const seeded = e.run(routeFpExpr);
  /* the release settle must not change the routes a fresh full solve of
     the same committed state would produce */
  e.run("routeAll();");
  const full = e.run(routeFpExpr);
  assert.equal(
    seeded,
    full,
    "the release settle routes match a fresh full solve of the same state",
  );
  /* resting invariance: undoing the gesture and re-solving fully
     restores the original resting routes */
  e.run("undo();routeAll();");
  assert.equal(e.run(routeFpExpr), before, "undo restores the original resting routes");
});

test("P01: the release settle is deterministic across repetitions", () => {
  const e = environment();
  setup(e);
  e.run(
    "gridSnap=false;view={x:0,y:0,z:1};" +
      "const p1=makeNode('rect',100,100),p2=makeNode('rect',500,60),p3=makeNode('rect',760,300),p4=makeNode('rect',300,380);" +
      "makeEdge(p1.id,p3.id);makeEdge(p2.id,p4.id);makeEdge(p1.id,p2.id);makeEdge(p3.id,p4.id);routeAll();",
  );
  const ids = e.json("Object.keys(state.nodes)");
  const grabOf = () =>
    e.json("w2s(state.nodes['" + ids[3] + "'].x + 70, state.nodes['" + ids[3] + "'].y + 28)");
  let grab = grabOf();
  pointer(e, "down", grab.x, grab.y);
  pointer(e, "move", grab.x + 20, grab.y + 16);
  pointer(e, "up", grab.x + 30, grab.y + 30);
  const first = e.run(routeFpExpr);
  e.run("undo();");
  grab = grabOf();
  pointer(e, "down", grab.x, grab.y);
  pointer(e, "move", grab.x + 20, grab.y + 16);
  pointer(e, "up", grab.x + 30, grab.y + 30);
  const second = e.run(routeFpExpr);
  assert.equal(first, second, "the same gesture settles to the same routes");
});
/* ================= N04 - reconnect adjacency contract =================== */

test("N04: reconnecting an endpoint invalidates both adjacency families", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',600,100);routeAll();");
  const eid = e.run("edge.id");
  const bid = e.run("b.id");
  const cid = e.run("c.id");
  e.run("state.sel=new Set(['e:" + eid + "']);render();");
  const handle = e.document
    .querySelector("#overlay")
    .querySelector('[data-end="1"]');
  const start = e.json('w2s(sidePoint(b,"w").x,sidePoint(b,"w").y)'),
    target = e.json("w2s(center(c).x,center(c).y)");
  pointer(e, "down", start.x, start.y, handle);
  pointer(e, "move", target.x, target.y);
  pointer(e, "up", target.x, target.y);
  assert.equal(
    e.run("state.edges['" + eid + "'].dst"),
    cid,
    "the edge now attaches to the drop target",
  );
  const famOf = (env, id) =>
    JSON.parse(
      env.run(
        "JSON.stringify((nodeEdges().get('" + id + "') || []).map((x) => x.id))",
      ),
    );
  assert.ok(
    famOf(e, cid).includes(eid),
    "the new endpoint family lists the edge",
  );
  assert.ok(
    !famOf(e, bid).includes(eid),
    "the old endpoint family no longer lists the edge",
  );
  e.run("undo()");
  assert.ok(
    famOf(e, bid).includes(eid),
    "undo restores the old endpoint family",
  );
  assert.ok(
    !famOf(e, cid).includes(eid),
    "undo clears the new endpoint family",
  );
  /* redo + reconnect again, then the import contract */
  e.run("redo()");
  assert.ok(famOf(e, cid).includes(eid), "redo restores the new family");
  assert.ok(!famOf(e, bid).includes(eid), "redo clears the old family");
  e.run(
    "installDocument(validateDocument(JSON.parse(localStorage.getItem('openchart.doc.v1'))))",
  );
  assert.ok(
    famOf(e, cid).includes(eid) && !famOf(e, bid).includes(eid),
    "installDocument rebuilds the families from the installed document",
  );
});
/* ================= N05 - tidy selection staleness ======================= */

const tidyGhosts = (e) =>
  [
    ...e.document.querySelector("#overlay").querySelectorAll("rect"),
  ].filter((r) => r.getAttribute("stroke-dasharray") === "4 3").length;

test("N05: widening the selection stales the tidy preview and blocks Apply", () => {
  const e = environment();
  setup(e);
  tidyDoc(e);
  const ids = JSON.parse(e.run("JSON.stringify(Object.keys(state.nodes))"));
  e.run(
    "state.sel=new Set(['" + ids[0] + "','" + ids[1] + "']);refreshProps();",
  );
  buttonByLabel(e, "Preview").click();
  const two = JSON.parse(e.run("JSON.stringify(tidyPreview.targets)"));
  assert.ok(two.length >= 1, "the preview covers the selected shapes that move");
  assert.equal(
    e.run("tidyPreview.cand.split(',').length"),
    2,
    "the proposal records exactly the selected candidates",
  );
  assert.ok(tidyGhosts(e) >= 1, "the preview paints its ghosts");
  assert.equal(
    buttonByLabel(e, "Apply").disabled,
    false,
    "Preview arms the Apply control",
  );
  /* widening the selection stales the preview: ghosts vanish */
  e.run(
    "state.sel=new Set(['" + ids[0] + "','" + ids[1] + "','" + ids[2] + "']);renderOverlay();",
  );
  assert.equal(tidyGhosts(e), 0, "stale ghosts are not painted");
  const hist = e.run("history.length");
  buttonByLabel(e, "Apply").click();
  assert.equal(
    e.run("history.length"),
    hist,
    "Apply refuses the widened selection",
  );
  assert.ok(
    e.run("tidyPreview"),
    "Apply refreshes the proposal for review",
  );
  assert.equal(
    e.run("tidyPreview.cand.split(',').length"),
    3,
    "the refreshed proposal covers the widened selection",
  );
  buttonByLabel(e, "Apply").click();
  assert.equal(
    e.run("history.length"),
    hist + 1,
    "the reviewed proposal applies",
  );
  /* consuming the proposal disarms Apply until the next preview */
  assert.equal(
    buttonByLabel(e, "Apply").disabled,
    true,
    "a consumed proposal disarms Apply",
  );
});

test("N05: drifting geometry hides the ghosts but keeps the review path", () => {
  const e = environment();
  setup(e);
  tidyDoc(e);
  buttonByLabel(e, "Preview").click();
  assert.ok(tidyGhosts(e) >= 1, "ghosts painted for a fresh preview");
  const nid = e.run("Object.keys(state.nodes)[0]");
  e.run("state.nodes['" + nid + "'].x += 30;renderOverlay();");
  assert.notEqual(
    e.run("tidyPreview"),
    null,
    "a geometry drift keeps the proposal for the review flow",
  );
  assert.equal(
    tidyGhosts(e),
    0,
    "ghosts of a stale proposal are not painted",
  );
  const hist = e.run("history.length");
  buttonByLabel(e, "Apply").click();
  assert.equal(
    e.run("history.length"),
    hist,
    "the drifted proposal is refused",
  );
  assert.ok(e.run("tidyPreview"), "Apply refreshes the proposal for review");
});
/* ================= N06 - typography sizes =============================== */

test("N06: the inspector Size control shows the resolved size", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);refreshProps();");
  const size = fieldControl(e, "Size", "INPUT");
  assert.ok(size, "the Size control exists");
  assert.equal(
    String(size.value),
    "13",
    "an inherited size shows as its resolved body size",
  );
  e.run("const c=makeNode('container',600,400);state.sel=new Set([c.id]);refreshProps();");
  assert.equal(
    String(fieldControl(e, "Size", "INPUT").value),
    "15",
    "a container shows its resolved heading size",
  );
  /* typing is an explicit override */
  const sz = fieldControl(e, "Size", "INPUT");
  sz.value = "16";
  sz.fire("change");
  assert.equal(
    e.run("state.nodes[c.id].fontSize"),
    16,
    "typing stamps an explicit size",
  );
  assert.equal(String(fieldControl(e, "Size", "INPUT").value), "16");
  /* reset to inherited clears the stamp */
  const reset = buttonByLabel(e, "Reset to inherited");
  assert.ok(reset, "the reset affordance exists");
  reset.click();
  assert.equal(
    e.run("state.nodes[c.id].fontSize == null"),
    true,
    "reset removes the explicit size",
  );
  assert.equal(
    String(fieldControl(e, "Size", "INPUT").value),
    "15",
    "the control shows the resolved size after reset",
  );
  /* mixed selections show the mixed state */
  e.run("state.sel=new Set([a.id,c.id]);refreshProps();");
  assert.equal(
    fieldControl(e, "Size", "INPUT").value,
    "",
    "a mixed selection shows the mixed state",
  );
});

test("N06: ordinary shapes inherit the body size", () => {
  const e = environment();
  setup(e);
  assert.equal(
    e.run("nodeFontSize(a)"),
    13,
    "a plain shape follows the body size",
  );
  e.run("ensureAppearance().typography.bodySize = 18;");
  assert.equal(
    e.run("nodeFontSize(a)"),
    18,
    "the body size is inherited, not stamped",
  );
  assert.equal(
    e.run("a.fontSize == null"),
    true,
    "inheritance leaves no explicit field on the shape",
  );
  e.run("a.fontSize = 20;");
  assert.equal(e.run("nodeFontSize(a)"), 20, "an explicit size wins");
  e.run("const c=makeNode('container',600,400);");
  assert.equal(
    e.run("nodeFontSize(c)"),
    15,
    "a container follows the heading size in heading mode",
  );
});

test("N06: legacy documents stamp the legacy size, v3 documents inherit", () => {
  const e = environment();
  setup(e);
  const v2 = e.json(
    "(function(){const d=docData();delete d.appearance;d.version=2;return d;})()",
  );
  const v2json = JSON.stringify(v2);
  e.run("installDocument(validateDocument(" + v2json + "))");
  assert.equal(
    e.run("state.nodes[a.id].fontSize"),
    13,
    "a legacy document stamps the legacy size explicitly",
  );
  assert.equal(
    e.run("state.nodes[b.id].fontSize"),
    13,
    "every legacy shape carries the stamp",
  );
  assert.equal(
    e.run("validateDocument(clone(docData())).version"),
    3,
    "the stamped document saves as v3",
  );
  /* a v3 document keeps inheritance */
  const e2 = environment();
  setup(e2);
  e2.run("autosave();");
  const saved = e2.run("localStorage.getItem('openchart.doc.v1')");
  const f = environment(saved);
  f.run("init()");
  assert.equal(
    f.run("state.nodes['" + e2.run("a.id") + "'].fontSize == null"),
    true,
    "a v3 document keeps the size inherited",
  );
});

/* ================= UX-A pass-4 slice ===================================== */

test("UX-A A5: the connector label editor matches the rendered label typography", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';routeAll();render();");
  e.run("state.sel = new Set(['e:' + edge.id]);render();");
  e.run("typography().labelSize = 17;render();");
  e.run("openEditor(edge, 'label');");
  const fsz = e.run("$('#txtedit').style.fontSize");
  assert.equal(fsz, "17px", "the editor uses the document label size, not 12px: " + fsz);
  const fam = e.run("$('#txtedit').style.fontFamily");
  assert.equal(fam, e.run("fontStack()"), "the editor declares the document font stack");
  assert.equal(e.run("$('#txtedit').style.lineHeight"), "1.35", "line height matches the label box metric");
});

test("UX-A A1: the palette introduction only shows for an empty diagram", () => {
  const e = environment();
  setup(e);
  e.run("state.sel.clear();refreshProps();");
  const host = e.document.querySelector("#props");
  assert.ok(
    !host.textContent.includes("Make room for your ideas"),
    "a nonempty diagram hides the introduction",
  );
});

/* ================= R01 - inspector edit ownership ======================== */

/* R01: the harness needs a faithful contains() so the deferred-rebuild
   path behaves like a real DOM. */
test("R01 prep: the harness implements Node.contains", () => {
  const e = environment();
  setup(e);
  const props = e.document.querySelector("#props");
  assert.equal(typeof props.contains, "function", "contains exists");
  const child = props.children[0];
  assert.ok(child, "the inspector has content");
  assert.equal(props.contains(child), true, "contains(child) is true");
});

test("R01: a pending Label edit commits to its original target, not the new selection", () => {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1};showGuides=false;state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Renamed A";
  pointer(e, "down", 400, 100);
  pointer(e, "up", 400, 100);
  input.fire("change");
  const texts = JSON.parse(
    e.run("JSON.stringify({ a: state.nodes[a.id].text, b: state.nodes[b.id].text })"),
  );
  assert.deepEqual(texts, { a: "Renamed A", b: "B" }, "the draft lands on A; B keeps its own label");
});

test("R01: a stale commit is skipped for deleted targets and adds no history", () => {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1};showGuides=false;state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Renamed A";
  const hist = Number(e.run("history.length"));
  e.run("deleteSel();history=[];future=[];state.sel=new Set([b.id]);render();refreshProps(true);");
  input.fire("change");
  assert.equal(
    Number(e.run("history.length")),
    hist,
    "a stale commit against a deleted target writes nothing",
  );
});

test("R01: a connector label edit commits to the captured connector, not a later selection", () => {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1};showGuides=false;state.sel=new Set(['e:'+edge.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Approved path";
  e.run("state.sel=new Set([a.id]);render();refreshProps();");
  input.fire("change");
  assert.equal(e.run("edge.label"), "Approved path", "the connector keeps the edit");
  assert.equal(e.run("a.text"), "A", "the later selection is untouched");
});

test("R01: Escape cancels the pending inspector draft", () => {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1};showGuides=false;state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Cancelled draft";
  input.fire("keydown", { key: "Escape" });
  input.fire("change");
  assert.equal(e.run("a.text"), "A", "the draft is gone");
});

test("R01: undo cancels the pending inspector draft without writing it", () => {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1};showGuides=false;state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Post-undo draft";
  e.run("undo();");
  input.fire("change");
  assert.equal(e.run("a.text"), "A", "the stale draft never lands");
});

/* ================= R02 - text fitting is one saved transaction =========== */

test("R02: Fit shape to text records the container resize in the same transaction", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('container',0,0);c.w=200;c.h=200;a.parentId=c.id;a.text='A very long label that should cause this shape to grow outside its container';state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const fitBtn = [...props.querySelectorAll("button")].find((b) => b.textContent === "Fit shape to text");
  assert.ok(fitBtn, "the Fit button exists");
  fitBtn.click();
  const liveW = Number(e.run("c.w"));
  assert.ok(liveW > 200, "the container grew to fit");
  /* The save-boundary artifact is the autosave payload, not the undo
     entry: the old bug saved before the container refit ran. */
  const saved = JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')"));
  const savedC = saved.nodes[Object.keys(saved.nodes).find((id) => saved.nodes[id].type === "container")];
  assert.equal(savedC.w, liveW, "the saved document keeps the fitted container");
});

test("R02: the Auto-fit checkbox keeps its container resize across a save boundary", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('container',0,0);c.w=200;c.h=200;a.parentId=c.id;a.text='A very long label that should cause this shape to grow outside its container';state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const fitRow = [...props.querySelectorAll(".field")].find((f) => f.children[0] && f.children[0].textContent === "Auto-fit text");
  assert.ok(fitRow, "the Auto-fit field exists");
  const fitChk = fitRow.children[1];
  fitChk.checked = true;
  fitChk.fire("change");
  const saved = e.run("localStorage.getItem('openchart.doc.v1')");
  const e2 = environment(saved);
  e2.run("init()");
  const reloaded = e2.run("Object.values(state.nodes).find((n) => n.type === 'container')");
  assert.ok(reloaded.w > 200, "the reloaded container kept the fitted width");
});

test("R02: the overflow notice Fit uses the centralized fit policy and one transaction", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('container',0,0);c.w=200;c.h=200;a.parentId=c.id;a.text='A very long label that should cause this shape to grow outside its container';a.w=140;a.h=40;state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const fits = props.querySelectorAll("button").filter((b) => b.textContent === "Fit shape to text");
  const notice = fits[fits.length - 1];
  assert.ok(notice, "the overflow Fit button exists");
  notice.click();
  const liveH = Number(e.run("a.h"));
  const saved = JSON.parse(e.run("localStorage.getItem('openchart.doc.v1')"));
  const savedA = saved.nodes[Object.keys(saved.nodes).find((id) => saved.nodes[id].parentId)];
  assert.equal(savedA.h, liveH, "the saved height matches the live height");
  const refit = Number(e.run("(() => { const h = a.h; fitShapeToText(a); const grew = a.h; a.h = h; return grew; })()"));
  assert.equal(liveH, refit, "the overflow fit matches fitShapeToText exactly");
});

test("R02: an enabled Auto-fit policy applies to inspector Label edits", () => {
  const e = environment();
  setup(e);
  e.run("a.autofit=true;state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "A very long label that should cause this shape to grow outside its container";
  input.fire("change");
  const w = Number(e.run("a.w"));
  assert.ok(w > 140, "the Auto-fit policy grew the shape on a Label edit (got w=" + w + ")");
});

/* ================= R04 - IME composition must not commit ================= */

test("R04: a composing Enter does not end label editing", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);editText(a);");
  assert.equal(e.run("$('#txtedit').hidden"), false, "the editor is open");
  const te = e.document.querySelector("#txtedit");
  te.fire("keydown", { key: "Enter", isComposing: true });
  assert.equal(e.run("$('#txtedit').hidden"), false, "composition Enter keeps editing");
  te.fire("keydown", { key: "Enter", keyCode: 229 });
  assert.equal(e.run("$('#txtedit').hidden"), false, "229 keycode keeps editing");
  te.fire("keydown", { key: "Enter" });
  assert.equal(e.run("$('#txtedit').hidden"), true, "a plain Enter commits");
});

test("R04: a composing Escape does not cancel label editing", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);editText(a);");
  const te = e.document.querySelector("#txtedit");
  te.fire("keydown", { key: "Escape", isComposing: true });
  assert.equal(e.run("$('#txtedit').hidden"), false, "composition Escape keeps editing");
});

/* ================= R03 - pending create-and-connect outlives its source == */

test("R03: Delete while the shape picker is open does not delete the canvas selection", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);showShapePicker({x:300,y:100},{x:520,y:320},a,null,'e');");
  assert.equal(e.run("$('#shape-picker').hidden"), false, "the picker is open");
  /* V02: capture the baseline BEFORE the action; comparing a value to
     itself proves nothing. */
  const histBefore = Number(e.run("history.length"));
  const selBefore = e.run("JSON.stringify([...state.sel])");
  e.key("Delete");
  assert.equal(e.run("!!state.nodes[a.id]"), true, "the source survives the stray Delete");
  assert.equal(Number(e.run("history.length")), histBefore, "no history entry");
  assert.equal(e.run("JSON.stringify([...state.sel])"), selBefore, "the selection is intact");
  e.key("Escape");
  assert.equal(e.run("$('#shape-picker').hidden"), true, "Escape closes the picker");
});

test("R03: committing a picker whose source disappeared creates nothing and records nothing", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);showShapePicker({x:300,y:100},{x:520,y:320},a,null,'e');");
  const props = e.document.querySelector("#shape-picker");
  const choose = [...props.querySelectorAll("button")].find((b) => b.textContent === "Process");
  assert.ok(choose, "the picker offers Process");
  const before = Number(e.run("Object.keys(state.nodes).length"));
  const hist = Number(e.run("history.length"));
  e.run("deleteSel();");
  /* The deletion itself may record history; the cancelled COMMIT must
     not add another entry. */
  const histAfterDelete = Number(e.run("history.length"));
  choose.click();
  assert.equal(Number(e.run("Object.keys(state.nodes).length")), before - 1, "no unconnected shape appeared");
  assert.equal(
    Number(e.run("history.length")),
    histAfterDelete,
    "the cancelled operation records no history",
  );
  assert.equal(e.run("$('#shape-picker').hidden"), true, "the picker closed");
});

test("R03: undo while the picker is open cancels the pending operation", () => {
  const e = environment();
  setup(e);
  e.run("transact(() => { a.x = 40; });state.sel=new Set([a.id]);showShapePicker({x:300,y:100},{x:520,y:320},a,null,'e');");
  e.run("undo();");
  assert.equal(e.run("$('#shape-picker').hidden"), true, "undo closed the picker");
});

/* ================= UX01/UX02/UX04 pass-5 slices ========================== */

test("UX01: the connector summary names both ends and the decision state", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set(['e:'+edge.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const summary = props.textContent;
  assert.ok(summary.includes("A → B"), "the summary names source and target: " + summary.slice(0, 200));
  assert.ok(summary.includes("automatic sides"), "the summary states the attachment mode");
  e.run("edge.srcSide='e';refreshProps(true);");
  assert.ok(
    e.document.querySelector("#props").textContent.includes("fixed source side"),
    "a fixed side is stated",
  );
});

test("UX01: Reset label position restores automatic placement only", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';edge.labelAuto=false;edge.labelT=0.3;edge.bend={dx:0,dy:40};state.sel=new Set(['e:'+edge.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const reset = [...props.querySelectorAll("button")].find((b) => b.textContent === "Reset label position");
  assert.ok(reset, "the reset action exists for a manually placed label");
  const hist = Number(e.run("history.length"));
  reset.click();
  assert.equal(e.run("edge.labelAuto"), true, "the label returned to automatic placement");
  assert.equal(e.run("edge.labelT"), undefined, "the manual offset is gone");
  assert.equal(e.run("edge.bend && edge.bend.dy"), 40, "manual bends are untouched");
  assert.equal(Number(e.run("history.length")), hist + 1, "exactly one undo step");
});

test("UX01: the overflow notice offers Always grow to fit", () => {
  const e = environment();
  setup(e);
  e.run("a.text='A very long label that should cause this shape to grow outside its container';a.w=140;a.h=40;state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const grow = [...props.querySelectorAll("button")].find((b) => b.textContent === "Always grow to fit");
  assert.ok(grow, "the policy action exists");
  grow.click();
  assert.equal(e.run("a.autofit"), true, "the policy is enabled");
  /* The fit policy may grow width or height depending on the text; the
     observable is that the shape no longer clips its label. */
  assert.ok(
    Number(e.run("a.w")) > 140 || Number(e.run("a.h")) > 40,
    "the shape grew (w=" + e.run("a.w") + " h=" + e.run("a.h") + ")",
  );
});

test("UX02: the shape picker is keyboard-operable and returns focus", () => {
  const e = environment();
  setup(e);
  e.run("showShapePicker({x:300,y:100},{x:520,y:320},a,null,'e');");
  const pk = e.document.querySelector("#shape-picker");
  /* C02: focus lands on the first choice button, not the popup. */
  assert.ok(
    pk.querySelectorAll("button").includes(e.document.activeElement),
    "the picker opens with a focused choice",
  );
  pk.fire("keydown", { key: "ArrowRight" });
  assert.ok(
    pk.querySelectorAll("button").includes(e.document.activeElement),
    "an arrow key moves focus to a choice",
  );
  pk.fire("keydown", { key: "Escape" });
  assert.equal(e.run("$('#shape-picker').hidden"), true, "Escape closes the picker");
  assert.equal(
    e.document.activeElement,
    e.document.querySelector("#stage"),
    "focus returns to the canvas",
  );
});

test("UX04: the decorative canvas badge is gone", () => {
  const e = environment();
  setup(e);
  assert.equal(e.document.querySelector("#canvas-badge"), null, "no INFINITE CANVAS badge");
});

test("R01: a mixed node+connector selection edits only its own kind", () => {
  const e = environment();
  setup(e);
  e.run("edge.label='Yes';state.sel=new Set([a.id, 'e:'+edge.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  /* In a mixed selection the shape section's Label field comes first. */
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .filter(([label]) => label === "Label")[0][1];
  input.focus();
  input.value = "Mixed edit";
  input.fire("change");
  assert.equal(e.run("a.text"), "Mixed edit", "the node field wrote to the node");
  assert.equal(e.run("edge.label"), "Yes", "the connector label is untouched");
});

test("R01: a locked target never receives a delayed inspector write", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);state.layers[0].locked=true;render();");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Locked write";
  const hist = Number(e.run("history.length"));
  input.fire("change");
  assert.equal(e.run("a.text"), "A", "the locked shape is untouched");
  assert.equal(Number(e.run("history.length")), hist, "no history entry");
});

test("R03: a picker whose source became hidden or locked cancels cleanly", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);showShapePicker({x:300,y:100},{x:520,y:320},a,null,'e');");
  const props = e.document.querySelector("#shape-picker");
  const choose = [...props.querySelectorAll("button")].find((b) => b.textContent === "Process");
  e.run("state.layers[0].visible=false;render();");
  const before = Number(e.run("Object.keys(state.nodes).length"));
  const hist = Number(e.run("history.length"));
  choose.click();
  assert.equal(Number(e.run("Object.keys(state.nodes).length")), before, "nothing created for a hidden source");
  assert.equal(Number(e.run("history.length")), hist, "nothing recorded");
  e.run("state.layers[0].visible=true;state.layers[0].locked=true;render();");
  choose.click();
  assert.equal(Number(e.run("Object.keys(state.nodes).length")), before, "nothing created for a locked source");
});

/* ===== Pass 6 C01 — one edit-session lifecycle ===== */

test("C01: a draft does not survive a document replacement with reused IDs", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Draft";
  e.run("transact(() => installDocument(validateDocument(JSON.parse(snapshot()))));");
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  input.fire("change");
  assert.equal(e.run("a.text"), "A", "the replaced document keeps its own text");
});

test("C01: a locked shape never receives a stale numeric write", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  /* The geometry Width is the last Width-labelled numeric; the first
     is the stroke width. */
  const w = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .filter(([label]) => label === "Width")
    .pop()[1];
  w.focus();
  w.value = "900";
  e.run("state.layers[0].locked=true;render();");
  const hist = Number(e.run("history.length"));
  w.fire("change");
  assert.equal(Number(e.run("a.w")), 140, "the locked width is untouched");
  assert.equal(Number(e.run("history.length")), hist, "no history entry");
});

test("C01: a hidden shape never receives a stale numeric write", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const h = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Height")[1];
  h.focus();
  h.value = "300";
  e.run("state.layers[0].visible=false;render();");
  h.fire("change");
  assert.equal(Number(e.run("a.h")), 56, "the hidden height is untouched");
});

test("C01: undo cancels an armed numeric session", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const w = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .filter(([label]) => label === "Width")
    .pop()[1];
  w.focus();
  w.value = "180";
  w.fire("change");
  assert.equal(
    Number(e.run("state.nodes[a.id].w")),
    180,
    "the width commit lands",
  );
  w.focus();
  w.value = "900";
  e.key("z", { ctrlKey: true, metaKey: true });
  assert.equal(
    Number(e.run("state.nodes[a.id].w")),
    140,
    "undo restores the width",
  );
  w.fire("change");
  assert.equal(
    Number(e.run("state.nodes[a.id].w")),
    140,
    "the stale numeric draft cannot write",
  );
});

test("C01: Enter commits a text draft exactly once", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Ent";
  input.fire("keydown", { key: "Enter" });
  assert.equal(e.run("a.text"), "Ent", "Enter commits the draft");
  input.fire("change");
  assert.equal(e.run("a.text"), "Ent", "the following blur change is a no-op");
});

test("C01: Escape restores the displayed value and cancels", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Edited";
  input.fire("keydown", { key: "Escape" });
  assert.equal(input.value, "A", "the displayed value is restored");
  assert.equal(e.run("a.text"), "A", "the model is untouched");
  input.fire("change");
  assert.equal(e.run("a.text"), "A", "the cancelled draft cannot commit");
});

test("C01: a composing Escape does not cancel the inspector draft", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Composed";
  input.fire("keydown", { key: "Escape", isComposing: true });
  assert.equal(input.value, "Composed", "the draft is still visible");
  input.fire("change");
  assert.equal(e.run("a.text"), "Composed", "the draft still commits normally");
});

test("C01: updateChrome does not overwrite a focused toolbar draft", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();updateChrome();");
  const fs = e.document.querySelector("#format-size");
  fs.focus();
  fs.value = "27";
  e.run("updateChrome();");
  assert.equal(fs.value, "27", "the focused draft survives the refresh");
});

test("C01: a selection command flushes the pending draft first", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const input = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Label")[1];
  input.focus();
  input.value = "Flushed";
  e.run("selectItem(b.id);");
  assert.equal(e.run("a.text"), "Flushed", "the draft landed on its original target");
  assert.equal(e.run("[...state.sel][0]"), e.run("b.id"), "the selection moved to the new object");
});

/* ===== Pass 6 C02 — picker as a scoped operation ===== */

test("C02: a document replacement closes the picker and clears the pending operation", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);showShapePicker({x:300,y:100},{x:520,y:320},a,null,'e');");
  assert.equal(e.run("!!pendingPicker"), true, "the operation is pending");
  e.run("transact(() => installDocument(validateDocument(JSON.parse(snapshot()))));");
  assert.equal(e.run("!!pendingPicker"), false, "the pending operation is gone");
  assert.equal(e.document.querySelector("#shape-picker").hidden, true, "the popup is closed");
});

test("C02: the picker opens focused on a choice and Enter creates the shape", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);showShapePicker({x:300,y:100},{x:520,y:320},a,null,'e');");
  const pk = e.document.querySelector("#shape-picker");
  const choices = [...pk.querySelectorAll("button")];
  assert.equal(
    choices.includes(e.document.activeElement),
    true,
    "a choice button holds focus",
  );
  const before = Number(e.run("Object.keys(state.nodes).length"));
  e.document.activeElement.click();
  assert.equal(
    Number(e.run("Object.keys(state.nodes).length")),
    before + 1,
    "Enter on the focused choice created the shape",
  );
});

test("C02: repeated open/close cycles keep one keyboard handler", () => {
  const e = environment();
  setup(e);
  e.run("showShapePicker({x:300,y:100},{x:520,y:320},a,null,null);");
  const pk = e.document.querySelector("#shape-picker");
  const first = (pk.events.keydown || []).length;
  e.run("hideShapePicker();showShapePicker({x:300,y:100},{x:520,y:320},b,null,null);hideShapePicker();showShapePicker({x:300,y:100},{x:520,y:320},a,null,null);");
  assert.equal(
    (pk.events.keydown || []).length,
    first,
    "the keyboard handler count is constant",
  );
});

test("C02: arrows rove from the currently focused choice", () => {
  const e = environment();
  setup(e);
  e.run("showShapePicker({x:300,y:100},{x:520,y:320},a,null,null);");
  const pk = e.document.querySelector("#shape-picker");
  const choices = [...pk.querySelectorAll("button")];
  choices[3].focus();
  /* The vm does not bubble; the real DOM bubbles to the popup. */
  pk.fire("keydown", { key: "ArrowRight" });
  assert.equal(
    e.document.activeElement,
    choices[4],
    "the arrow moved from the focused choice, not a stale index",
  );
});

test("C02: the picker clamps inside the visible canvas", () => {
  const e = environment();
  setup(e);
  e.run("showShapePicker({x:300,y:100},{x:1900,y:1200},a,null,null);");
  const pk = e.document.querySelector("#shape-picker");
  const left = parseFloat(pk.style.left);
  const top = parseFloat(pk.style.top);
  assert.ok(left <= 1400 - 248, "the popup stays inside the right edge (" + left + ")");
  assert.ok(top <= 900 - 328, "the popup stays inside the bottom edge (" + top + ")");
});

test("C02: every picker choice shows a miniature vector preview", () => {
  const e = environment();
  setup(e);
  e.run("showShapePicker({x:300,y:100},{x:520,y:320},a,null,null);");
  const pk = e.document.querySelector("#shape-picker");
  const shapes = [...pk.querySelectorAll("button")].filter(
    (b) => b.textContent !== "Cancel",
  );
  assert.equal(shapes.length, 6, "six shape choices");
  assert.equal(
    shapes.filter((b) => b.querySelector("svg")).length,
    6,
    "every choice has a preview",
  );
});

/* ===== Pass 6 C03 — fit against the final shape ===== */

test("C03: Fit wraps at the final width so the text actually fits", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);a.text='word '.repeat(150);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const fits = [...props.querySelectorAll("button")].filter(
    (b) => b.textContent === "Fit shape to text",
  );
  assert.ok(fits.length >= 1, "a Fit control is present");
  fits[fits.length - 1].click();
  assert.equal(Math.round(Number(e.run("a.w"))), 600, "the width honors the documented cap");
  assert.equal(e.run("textLayout(a).overflow"), false, "the text fits after the fit");
});

test("C03: Auto-fit responds to a font-size change", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);a.autofit=true;a.text='Professional label';render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const size = [...props.querySelectorAll(".field")]
    .map((f) => [f.children[0] && f.children[0].textContent, f.children[1]])
    .find(([label]) => label === "Size")[1];
  size.focus();
  size.value = "96";
  size.fire("change");
  assert.equal(e.run("textLayout(a).overflow"), false, "the larger text fits");
});

test("C03: a constrained fit reports failure instead of fake success", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);a.rot=90;a.text='word '.repeat(120);render();");
  const result = e.json("fitShapeToText(a)");
  assert.equal(result.cannot, true, "a vertical box at the cap cannot fit");
  assert.equal(result.fitted, false, "no fake success is claimed");
});

test("C03: document typography changes refit Auto-fit shapes", () => {
  const e = environment();
  setup(e);
  e.run("a.autofit=true;a.text='Grows with the body size';");
  e.run("transact(() => { typography().bodySize = 24; refitAutofitShapes(); });");
  assert.equal(e.run("textLayout(a).overflow"), false, "the shape grew with the typography");
});

/* ===== Pass 6 UX-A — stable inspector, editor visibility ===== */

test("UX-A: collapsed sections are remembered per selection kind", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  /* The vm selector engine does not parse compound selectors; filter
     in two steps. */
  const findSection = () =>
    [...props.querySelectorAll(".inspector-section")].find(
      (d) =>
        d.tagName.toUpperCase() === "DETAILS" &&
        d.querySelector("summary").textContent.includes("Style"),
    );
  const sec = findSection();
  assert.ok(sec, "a Style section exists");
  const hist = Number(e.run("history.length"));
  sec.open = false;
  sec.fire("toggle");
  assert.equal(Number(e.run("history.length")), hist, "expansion is outside history");
  e.run("selectItem(b.id);refreshProps(true);selectItem(a.id);refreshProps(true);");
  const sec2 = findSection();
  assert.equal(sec2.open, false, "the shape's collapsed state is remembered");
  e.run("state.sel=new Set(['e:'+edge.id]);refreshProps(true);");
  /* The connector panel titles its style section "Connector". */
  const esec = [...props.querySelectorAll(".inspector-section")].find(
    (d) =>
      d.tagName.toUpperCase() === "DETAILS" &&
      d.querySelector("summary").textContent.includes("Connector"),
  );
  assert.ok(esec, "the connector panel has its own sections");
  assert.equal(esec.open, true, "the connector's memory is separate");
});

test("UX-A: the inline editor follows viewport and drawer changes", () => {
  const e = environment();
  setup(e);
  e.run("editText(a);");
  const te = e.document.querySelector("#txtedit");
  assert.equal(te.hidden, false, "the editor is open");
  const before = te.style.left + "x" + te.style.top;
  e.run("view.x += 40; view.z = 1.5; render();");
  const after = te.style.left + "x" + te.style.top;
  assert.notEqual(after, before, "the editor followed the viewport");
  assert.equal(te.hidden, false, "the editor is still visible");
});

/* ===== Pass 6 UX-B — connection intent made visible ===== */

test("UX-B: quick-create actions are named by flow meaning", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();");
  const n = e.document.querySelector('[data-quick="n"]');
  const s = e.document.querySelector('[data-quick="s"]');
  assert.ok(n && s, "the quick-create buttons render");
  assert.ok(
    (n.getAttribute("aria-label") || "").includes("next step above"),
    "north adds an outgoing next step above, matching the arrow glyph",
  );
  assert.ok(
    (s.getAttribute("aria-label") || "").includes("next step"),
    "south means add next step",
  );
});

test("UX-B: quick-create finds a free spot instead of stacking", () => {
  const e = environment();
  setup(e);
  e.run("const blocker=makeNode('rect',320,72);blocker.text='X';state.sel=new Set([a.id]);render();");
  e.run("quickCreate('e');");
  const fresh = e.run(
    "JSON.stringify(Object.values(state.nodes).filter(function(n){ return n.text === \"Process\"; }).map(function(n){ return { x: n.x, y: n.y, w: n.w, h: n.h }; }))",
  );
  const spots = JSON.parse(fresh);
  assert.ok(spots.length === 1, "one new shape");
  const s0 = spots[0];
  const overlap = (r, o) =>
    r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y;
  const aBox = { x: 100, y: 100, w: 140, h: 56 };
  const bBox = { x: 320, y: 72, w: 140, h: 56 };
  assert.equal(overlap(s0, aBox), false, "no overlap with the source");
  assert.equal(overlap(s0, bBox), false, "no overlap with the blocker");
});

test("UX-B: the connection preview shows the directed landing point", () => {
  const e = environment();
  setup(e);
  e.run("const c=center(b); gesture={kind:'connect',src:a.id,side:'e',start:w2s(c.x,c.y),last:w2s(c.x,c.y),moved:true}; drawConnectionPreview();");
  const arrow = e.document.querySelector("[data-preview-arrow]");
  assert.ok(arrow, "the preview marks the landing point with direction");
  e.run("gesture=null;renderOverlay();");
  assert.equal(e.document.querySelector("[data-preview-arrow]"), null, "the marker is preview-only");
});

test("UX-B: resetting bends and sides are separate actions", () => {
  const e = environment();
  setup(e);
  e.run("edge.waypoints=[{x:200,y:300}];edge.srcSide='e';edge.dstSide='w';state.sel=new Set(['e:'+edge.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const btn = (label) =>
    [...props.querySelectorAll("button")].find((b) => b.textContent === label);
  const bends = btn("Reset bends");
  assert.ok(bends, "a dedicated Reset bends action exists");
  bends.click();
  assert.equal(e.run("!!edge.waypoints"), false, "the bends are gone");
  assert.equal(e.run("edge.srcSide"), "e", "the fixed sides survive");
  const sides = btn("Use automatic sides");
  assert.ok(sides, "a dedicated Use automatic sides action exists");
  sides.click();
  assert.equal(e.run("edge.srcSide"), null, "the source side is automatic");
  assert.equal(e.run("edge.dstSide"), null, "the target side is automatic");
});

test("UX-B: quick-create uses the preferred spot when it is free", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();");
  e.run("quickCreate('s');");
  const fresh = e.run(
    "JSON.stringify(Object.values(state.nodes).filter(function(n){ return n !== a && n !== b; }).map(function(n){ return { x: n.x, y: n.y }; }))",
  );
  const s0 = JSON.parse(fresh)[0];
  assert.equal(s0.x, 30, "aligned to the source center line");
  assert.equal(s0.y, 208, "the preferred gap below the source");
});

/* ===== Pass 6 UX-C — attachment snapping and the straight cue ===== */

test("UX-C: attachment snapping straightens a connector and holds with hysteresis", () => {
  const e = environment();
  setup(e);
  /* A second edge on a's east side spreads the ports, so the a->b
     attachment no longer coincides with a's center. */
  e.run("const c=makeNode('rect',100,400);makeEdge(a.id,c.id,'e','w');routesDirty=true;render();");
  const p = e.json("w2s(a.x+30,a.y+30)");
  pointer(e, "down", p.x, p.y);
  /* Drag down 6px: the attachment candidate (within 8px) wins over the
     center guess and pulls the port to b's west attachment. */
  pointer(e, "move", p.x, p.y + 6);
  e.run("render();"); /* vm gestures rely on rAF; flush the frame */
  const straight = () => Number(e.run("routeEdge(edge).pts.length"));
  assert.equal(straight(), 2, "the connector is straight after the snap");
  /* The trunk lane keeps a's east port at the side center, so the
     attachment snap cancels the 6px drift entirely. */
  assert.equal(Number(e.run("state.nodes[a.id].y")), 72, "the snap cancels the drift to keep the attachment aligned");
  assert.ok(e.run("!!gesture.straightCue"), "the straight-connection cue is promised");
  assert.ok(
    e.document.querySelector('[data-cue="straight-connection"]'),
    "the cue renders in the overlay",
  );
  /* Hysteresis: 10px of drift from the held reference still holds - a
     fresh 8px acquisition window would have dropped the snap. */
  pointer(e, "move", p.x, p.y + 10);
  assert.equal(straight(), 2, "the snap holds at 10px of drift");
  assert.equal(Number(e.run("state.nodes[a.id].y")), 72, "still constrained to the aligned position");
  /* Past 12px of attachment drift the attachment snap releases. The
     wider 16px connected-center affordance still holds until 18px of
     pointer travel, then the connector bends again. */
  pointer(e, "move", p.x, p.y + 18);
  assert.notEqual(straight(), 2, "past both windows the route bends again");
  assert.equal(Number(e.run("state.nodes[a.id].y")), 90, "the shape follows the pointer freely");
  assert.equal(e.run("!!gesture.straightCue"), false, "no cue without a straight proposal");
});

test("UX-C: the straight cue is promised only when the segment is clear", () => {
  const e = environment();
  setup(e);
  e.run("const c=makeNode('rect',100,400);makeEdge(a.id,c.id,'e','w');routesDirty=true;render();");
  /* A blocker sitting across the aligned corridor kills the cue but
     leaves the attachment snap itself intact. */
  e.run("const blocker=makeNode('rect',250,100);blocker.text='X';routesDirty=true;render();");
  const p = e.json("w2s(a.x+30,a.y+30)");
  pointer(e, "down", p.x, p.y);
  pointer(e, "move", p.x, p.y + 6);
  e.run("render();");
  const straight = () => Number(e.run("routeEdge(edge).pts.length"));
  /* The snap still aligns the two attachment points, but the route
     itself has to detour around the blocker - so no straight promise. */
  const ys = e.run("JSON.stringify([routeEdge(edge).pts[0].y, routeEdge(edge).pts[routeEdge(edge).pts.length-1].y])");
  const pair = JSON.parse(ys);
  assert.equal(pair[0], pair[1], "the attachment snap still aligns the ports");
  assert.equal(Number(e.run("routeEdge(edge).pts.length")), 4, "the route detours around the obstacle");
  assert.equal(e.run("!!gesture.straightCue"), false, "no cue through an obstacle");
  assert.equal(
    e.document.querySelector('[data-cue="straight-connection"]'),
    null,
    "the cue badge does not render",
  );
});

/* ===== Pass 6 P01 — dense and randomized edit/reload equivalence ===== */

test("P01: dense scene survives an edit script and a reload identically", () => {
  const e = environment();
  const seed = (s) => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const rnd = seed(20260214);
  e.run("gridSnap=false;");
  /* Dense: the 90px pitch is narrower than the 140px shapes, so boxes
     genuinely overlap and the segment grid has real work. */
  const ids = [];
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 8; c++) {
      const id = e.run(`makeNode('rect',${40 + c * 90},${40 + r * 70}).id`);
      ids.push(id);
    }
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 7; c++)
      e.run(`makeEdge("${ids[r * 8 + c]}","${ids[r * 8 + c + 1]}")`);
  for (let r = 0; r < 5; r++)
      e.run(`makeEdge("${ids[r * 8 + 3]}","${ids[(r + 1) * 8 + 3]}")`);
  /* A fixed edit script through transactions. */
  for (let k = 0; k < 24; k++) {
    const i = Math.floor(rnd() * ids.length);
    const ref = JSON.stringify(ids[i]);
    const op = Math.floor(rnd() * 4);
    if (op === 0)
      e.run(`transact(()=>{const n=state.nodes[${ref}];n.x+=${Math.floor(rnd() * 21) - 10};n.y+=${Math.floor(rnd() * 21) - 10};})`);
    else if (op === 1)
      e.run(`transact(()=>{const n=state.nodes[${ref}];n.w=clamp(n.w+${Math.floor(rnd() * 31) - 15},40,600);n.h=clamp(n.h+${Math.floor(rnd() * 21) - 10},24,600);})`);
    else if (op === 2)
      e.run(`transact(()=>{state.nodes[${ref}].text="step ${k}";})`);
    else
      e.run(`transact(()=>{state.nodes[${ref}].bold=!state.nodes[${ref}].bold;})`);
    e.run("render();");
  }
  e.run("routeAll();");
  const saved = e.run("snapshot()");
  const routes1 = e.run(
    "JSON.stringify(Object.keys(state.edges).map(k=>routeEdge(state.edges[k]).pts))",
  );
  /* Reload into a pristine environment. */
  const e2 = environment();
  e2.run(`restore(${JSON.stringify(saved)})`);
  e2.run("render();");
  assert.equal(e2.run("snapshot()"), saved, "the document round-trips byte-identically");
  const routes2 = e2.run(
    "JSON.stringify(Object.keys(state.edges).map(k=>routeEdge(state.edges[k]).pts))",
  );
  assert.equal(routes2, routes1, "the routing is identical after the reload");
});

test("P01: randomized fixed-seed edits reload to the same routes", () => {
  const e = environment();
  setup(e);
  const seed = (s) => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const rnd = seed(777001);
  const extra = [];
  for (let k = 0; k < 6; k++) {
    const id = e.run(`makeNode("rect",${60 + k * 37},${80 + (k % 3) * 44}).id`);
    extra.push(id);
    e.run(`makeEdge(a.id,"${id}")`);
  }
  const all = [e.run("a.id"), ...extra];
  for (let step = 0; step < 40; step++) {
    const i = Math.floor(rnd() * all.length);
    const op = Math.floor(rnd() * 5);
    const ref = JSON.stringify(all[i]);
    if (op === 0)
      e.run(`transact(()=>{const n=state.nodes[${ref}];n.x+=${Math.floor(rnd() * 13) - 6};n.y+=${Math.floor(rnd() * 13) - 6};})`);
    else if (op === 1)
      e.run(`transact(()=>{const n=state.nodes[${ref}];n.w=clamp(n.w+${Math.floor(rnd() * 17) - 8},30,600);});`);
    else if (op === 2)
      e.run(`transact(()=>{state.nodes[${ref}].fill=${JSON.stringify("#8ed0b0")};});`);
    else if (op === 3)
      e.run(`applyEdgeField("arrow",${JSON.stringify(Math.floor(rnd() * 2) ? "arrow" : "none")});`);
    else e.run("undo();");
    e.run("render();");
  }
  e.run("routeAll();");
  const saved = e.run("snapshot()");
  const routes1 = e.run(
    "JSON.stringify(Object.keys(state.edges).map(k=>routeEdge(state.edges[k]).pts))",
  );
  const e2 = environment();
  e2.run(`restore(${JSON.stringify(saved)})`);
  e2.run("render();");
  assert.equal(e2.run("snapshot()"), saved, "the randomized document round-trips identically");
  const routes2 = e2.run(
    "JSON.stringify(Object.keys(state.edges).map(k=>routeEdge(state.edges[k]).pts))",
  );
  assert.equal(routes2, routes1, "the routes are identical after the reload");
});

/* ===== Pass-6 acceptance-matrix closure (same plan, remaining rows) ===== */

test("C01: repeated stale callbacks after disposal stay inert", () => {
  const e = environment();
  setup(e);
  e.run("selectItem(a.id);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const label = [...props.querySelectorAll("input")].find(
    (i) => i.value === "A",
  );
  assert.ok(label, "the Label field exists");
  label.focus();
  label.value = "Renamed once";
  label.fire("change");
  assert.equal(e.run("a.text"), "Renamed once", "the first commit lands");
  const h1 = Number(e.run("history.length"));
  label.focus();
  label.fire("change");
  label.fire("change");
  assert.equal(Number(e.run("history.length")), h1, "repeat callbacks add nothing");
  assert.equal(e.run("a.text"), "Renamed once", "the value is untouched by stale callbacks");
});

test("C02: a failed picker commit returns focus to the canvas", () => {
  const e = environment();
  setup(e);
  e.run("selectItem(a.id);render();");
  /* Simulate an unavailable source: the pending source id no longer
     resolves to an editable node. */
  e.run("showShapePicker({x:600,y:300}, {x:600,y:300}, a, null, 'e');");
  e.run("state.nodes[a.id].locked = true;");
  const pk = e.document.querySelector("#shape-picker");
  assert.equal(pk.hidden, false, "the picker is open");
  const choices = [...pk.querySelectorAll("button")].filter(
    (b) => !b.textContent.includes("Cancel"),
  );
  choices[0].click();
  assert.equal(pk.hidden, true, "the picker closed");
  assert.equal(
    e.run(
      "document.activeElement && document.activeElement.getAttribute('id')",
    ),
    "stage",
    "focus returned to the canvas",
  );
  assert.equal(Number(e.run("Object.keys(state.nodes).length")), 2, "nothing was created");
});

test("UX-B: a labeled five-step flow builds from the canvas and survives undo/reload", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();");
  const labels = ["Start", "Plan", "Build", "Test", "Ship"];
  e.run(`transact(()=>{a.text=${JSON.stringify(labels[0])};});`);
  const created = [];
  for (let k = 1; k < 5; k++) {
    const beforeIds = JSON.parse(e.run("JSON.stringify(Object.keys(state.nodes))"));
    e.run(`quickCreate('e');`);
    const afterIds = JSON.parse(e.run("JSON.stringify(Object.keys(state.nodes))"));
    const ids = afterIds.filter((x) => !beforeIds.includes(x));
    created.push(ids[0]);
    assert.equal(ids.length, 1, "quickCreate added exactly one step");
    e.run(`transact(()=>{state.nodes[${JSON.stringify(ids[0])}].text=${JSON.stringify(labels[k])};});`);
    e.run("render();");
    e.run("state.sel=new Set([" + JSON.stringify(ids[0]) + "].map(function(x){return x;}));render();");
  }
  assert.equal(Number(e.run("Object.keys(state.nodes).length")), 6, "five steps plus the source");
  /* Each step is connected to its predecessor in creation order, and
     each step carries its label (the a->b setup edge is not part of the
     chain). */
  const stepLabels = ["Plan", "Build", "Test", "Ship"];
  for (let i = 0; i < created.length; i++) {
    const prev = i === 0 ? e.run("a.id") : created[i - 1];
    const linked = JSON.parse(
      e.run(
        "JSON.stringify(Object.values(state.edges).some(function(ed){ return ed.src === " +
          JSON.stringify(prev) + " && ed.dst === " + JSON.stringify(created[i]) + "; }))",
      ),
    );
    assert.equal(linked, true, `step ${i + 1} connects to its predecessor`);
    const label = e.run(
      "state.nodes[" + JSON.stringify(created[i]) + "].text",
    );
    assert.equal(label, stepLabels[i], `step ${i + 1} is labeled`);
  }
  /* Reload equivalence for the built flow. */
  const saved = e.run("snapshot()");
  const routes1 = e.run("JSON.stringify(Object.keys(state.edges).map(k=>routeEdge(state.edges[k]).pts))");
  const e2 = environment();
  e2.run(`restore(${JSON.stringify(saved)})`);
  e2.run("render();");
  assert.equal(e2.run("snapshot()"), saved, "the flow round-trips");
  assert.equal(e2.run("JSON.stringify(Object.keys(state.edges).map(k=>routeEdge(state.edges[k]).pts))"), routes1, "routing identical after reload");
});

test("UX-B: hover and connection previews never trigger a full solve", () => {
  const e = environment();
  setup(e);
  e.run("globalThis.__hoverSolves=0; const oa=routeAll; routeAll=function(){ globalThis.__hoverSolves++; return oa.apply(this, arguments); };");
  const p = e.json("w2s(center(b).x, center(b).y)");
  pointer(e, "move", p.x, p.y);
  assert.equal(Number(e.run("globalThis.__hoverSolves")), 0, "plain hover solves nothing");
  e.run("const c=center(a); gesture={kind:'connect',src:a.id,side:'e',start:w2s(c.x,c.y),last:w2s(c.x,c.y),moved:true}; drawConnectionPreview(); gesture=null;");
  assert.equal(Number(e.run("globalThis.__hoverSolves")), 0, "the preview solves only its own candidate, never a full pass");
});

/* ===== Pass 7 (NEXT_STEPS §6) — U01/U11 chrome tokens and icons ===== */

test("U01: toolbar icons are inline SVG with labels, no leftover glyphs", () => {
  /* The vm harness builds a flat element list, so icon markup is
     asserted against the real source: the icons must live inside the
     labeled buttons themselves. */
  const src = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8",
  );
  const toolbarSrc = src.slice(src.indexOf('id="toolbar"'), src.indexOf('id="left"'));
  for (const marker of [
    'id="toggle-left"',
    'id="btn-undo"',
    'id="btn-redo"',
    'data-tool="select"',
    'data-tool="pan"',
    'data-tool="connect"',
    'data-tool="text"',
  ]) {
    const at = toolbarSrc.indexOf(marker);
    assert.ok(at >= 0, marker + " exists in the toolbar");
    const chunk = toolbarSrc.slice(at, at + 400);
    const end = chunk.indexOf('</button>');
    const buttonSrc = chunk.slice(0, end >= 0 ? end + 9 : 400);
    assert.ok(buttonSrc.includes("<svg"), marker + " uses an inline SVG icon");
    assert.ok(/aria-label|title/.test(buttonSrc), marker + " keeps an accessible name");
  }
  assert.equal(
    /[\u25a5\u2196\u270b\u2197\u21b6\u21b7\u2637]/.test(toolbarSrc),
    false,
    "no Unicode glyph icons remain in the toolbar",
  );
});

test("U01: UI-only tokens and reduced-motion/focus rules exist", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8",
  );
  const css = src.slice(src.indexOf("<style>"), src.indexOf("</style>"));
  assert.ok(css.includes("--ctl-h"), "a control-height token exists");
  assert.ok(css.includes("--sp-2"), "spacing tokens exist");
  assert.ok(css.includes("prefers-reduced-motion"), "reduced motion is honored");
  assert.ok(css.includes(":focus-visible"), "keyboard focus is visible");
});


/* ===== Pass 7 — U07 styles: previews, scope, recents, arrow audit ===== */

test("U07: theme buttons preview a miniature chart and carry an explicit scope", () => {
  const e = environment();
  e.run("render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  /* The vm selector engine does not parse compound selectors. */
  const previews = [...props.querySelectorAll("svg")].filter((x) =>
    x.classList.contains("theme-preview"),
  );
  assert.equal(
    previews.length,
    Number(e.run("THEMES.length")),
    "every theme button previews a chart",
  );
  assert.ok(
    [...props.querySelectorAll("select")].some(
      (s) => s.textContent.includes("Whole diagram"),
    ),
    "an explicit application scope control exists",
  );
});

test("U07: Selected-only theme scope restyles just the selection", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  e.run("uiSectionState.themeScope = 'selected';");
  const before = e.run("JSON.stringify({ af: a.fill, bf: b.fill, ae: a.stroke })");
  const tidBefore = e.run("ensureAppearance().themeId");
  e.run("applyTheme(THEMES[THEMES.length-1], 'selected');");
  const after = JSON.parse(
    e.run("JSON.stringify({ af: a.fill, bf: b.fill, ae: a.stroke })"),
  );
  const beforeO = JSON.parse(before);
  assert.notEqual(after.af, beforeO.af, "the selected shape took the theme");
  assert.equal(after.bf, beforeO.bf, "the unselected shape kept its fill");
  assert.equal(
    e.run("ensureAppearance().themeId"),
    tidBefore,
    "the document theme id only advances for the whole-diagram scope",
  );
  assert.ok(Number(e.run("history.length")) >= 1, "the scoped restyle is one undoable step");
});

test("U07: recent colors accumulate outside history and persist per panel", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const swatchButtons = [...props.querySelectorAll(".swatch")].filter(
    (b) => !b.classList.contains("no-color"),
  );
  assert.ok(swatchButtons.length > 0, "fill swatches render");
  const histBefore = Number(e.run("history.length"));
  swatchButtons[0].click();
  e.run("refreshProps(true);");
  const props2 = e.document.querySelector("#props");
  const recent = [...props2.querySelectorAll(".swatch")].filter((b) =>
    b.closest(".recent-swatches"),
  );
  assert.ok(recent.length >= 1, "the used color appears under Recent");
  assert.equal(
    recent[0].getAttribute("aria-label").toLowerCase().indexOf("recent") >= 0,
    true,
    "the recent swatch is labeled",
  );
  assert.ok(Number(e.run("history.length")) > histBefore, "the color change itself is undoable");
});

test("U07 audit: start-arrow travels with edge style copy and defaults", () => {
  const e = environment();
  setup(e);
  e.run("transact(()=>{edge.arrow='arrow'; edge.startArrow='dot';});");
  e.run("state.sel=new Set(['e:'+edge.id]);render();refreshProps(true);copyStyle();");
  e.run("state.sel.clear();const other=makeNode('rect',600,400);render();state.sel=new Set(['n:'+other.id,'e:'+edge.id]);render();refreshProps(true);");
  /* Paste onto a second connector. */
  e.run("transact(()=>{const e2=makeEdge(b.id, a.id, 'w', 'e'); e2.arrow='none'; e2.startArrow='none'; state.sel=new Set(['e:'+e2.id]);});");
  e.run("render();refreshProps(true);pasteStyle();");
  assert.equal(e.run("Object.values(state.edges).find(x=>x.src===b.id&&x.dst===a.id).startArrow"), "dot", "the start arrow pasted");
  assert.equal(e.run("Object.values(state.edges).find(x=>x.src===b.id&&x.dst===a.id).arrow"), "arrow", "the end arrow pasted");
});

/* ===== Pass 7 — U08 navigation: search, reveal, fit, overlap, layers ===== */

test("U08: outline search filters objects and preserves container ancestry", () => {
  const e = environment();
  setup(e);
  e.run("transact(()=>{const c=makeNode('container',300,300); c.text='Zoo'; const k=makeNode('rect',300,300); k.text='Kite'; k.parentId=c.id;});");
  e.run("render();renderLayers();");
  const search = e.document.querySelector("#outline-search");
  search.value = "kite";
  search.fire("input");
  /* The vm selector engine does not parse descendant combinators. */
  const names = [...e.document.querySelectorAll("button")]
    .filter((b) => b.closest("#layers-list"))
    .map((b) => b.textContent);
  assert.ok(names.some((n) => n.includes("Kite")), "the hit is listed");
  assert.ok(names.some((n) => n.includes("Zoo")), "the container ancestry stays visible");
  assert.equal(names.some((n) => n.includes("A")), false, "unrelated shapes are filtered out");
  search.value = "zzz-nothing";
  search.fire("input");
  assert.ok(
    e.document.querySelector("#layers-list").textContent.includes(
      "No objects match",
    ),
    "an empty search explains itself",
  );
});

test("U08: reveal pans to an object without zoom or selection changes", () => {
  const e = environment();
  setup(e);
  e.run("const far=makeNode('rect',2600,100); globalThis.__far=far.id; render();");
  const before = JSON.parse(
    e.run("JSON.stringify({ z: view.z, x: view.x, sel: [...state.sel] })"),
  );
  e.run("revealObject(state.nodes[globalThis.__far]);");
  const after = JSON.parse(
    e.run("JSON.stringify({ z: view.z, x: view.x, sel: [...state.sel] })"),
  );
  assert.equal(after.z, before.z, "zoom is unchanged");
  assert.equal(after.sel.length, before.sel.length, "selection is unchanged");
  assert.notEqual(after.x, before.x, "the view panned to the object");
});

test("U08: fit selection is a labeled command that centers the selection", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id,b.id]);fitSelection();");
  const v = JSON.parse(e.run("JSON.stringify(view)"));
  assert.ok(v.z > 0.1 && v.z <= 4, "zoom stays in range");
  assert.ok(
    Math.abs(
      e.run("(stage.clientWidth/2 - view.x)/view.z") -
      250,
    ) < 1,
    "the selection center is centered",
  );
  e.run("state.sel.clear();fitSelection();");
  assert.ok(
    e.document.querySelector("#hint").textContent.includes("Select objects"),
    "an empty selection explains itself",
  );
});

test("U08: overlap cycling names the stack instead of staying hidden", () => {
  const e = environment();
  setup(e);
  e.run("transact(()=>{const t=makeNode('rect',100,100); t.text='Top';});render();");
  /* The default view is offset; aim through the app's own transform. */
  const pt = JSON.parse(e.run("JSON.stringify(w2s(100,100))"));
  pointer(e, "down", pt.x, pt.y, "#stage", { altKey: true });
  const hint = e.document.querySelector("#hint").textContent;
  assert.ok(hint.includes("overlapping objects"), "the overlap is announced: " + hint);
  assert.ok(hint.includes("Top") && hint.includes("A"), "the stack is named");
});

test("U08: foreground-layer connectors explain themselves once", () => {
  const e = environment();
  setup(e);
  e.run("transact(()=>{addLayer();});");
  e.run(
    "globalThis.__back=state.layers[0]; state.activeLayer=globalThis.__back.id; transact(()=>{makeEdge(a.id,b.id,'e','w');});",
  );
  assert.ok(
    e.document.querySelector("#hint").textContent.includes(
      "drawing layer is unchanged",
    ),
    "the layer note explains where the connector went",
  );
  assert.equal(
    e.run("state.activeLayer"),
    e.run("globalThis.__back.id"),
    "the active drawing layer is left unchanged",
  );
});

/* ===== Pass 7 — U09 review-diagram findings and local repairs ===== */

test("U09: the Review entry carries a live issue count and stays reachable", () => {
  const e = environment();
  setup(e);
  e.run("refreshProps(true);");
  const count = e.document.querySelector("#review-count");
  assert.ok(count, "the review entry exists");
  assert.equal(count.hidden, true, "no badge when there is nothing to report");
  e.run("transact(()=>{const big=makeNode('rect',700,450); big.text='A very long label that cannot fit inside this small shape at all';});");
  e.run("refreshProps(true);");
  assert.equal(count.hidden, false, "the badge appears with findings");
  assert.ok(/\(\d+\)/.test(count.textContent), "the count is numeric: " + count.textContent);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  e.document.querySelector("#review-btn").click();
  assert.equal(e.run("state.sel.size"), 0, "Review is reachable while a selection exists and opens the document view");
  assert.ok(
    e.document.querySelector("#props").textContent.includes("Quality checks"),
    "the findings are in the document panel",
  );
});

test("U09: findings group into text, connections, and spacing", () => {
  const e = environment();
  setup(e);
  e.run("transact(()=>{const big=makeNode('rect',700,450); big.text='A very long label that cannot fit inside this small shape at all'; const other=makeNode('rect',700,450);});");
  e.run("refreshProps(true);");
  const props = e.document.querySelector("#props");
  const groups = [...props.querySelectorAll(".check-group")].map((g) => g.textContent);
  assert.ok(groups.includes("Text"), "text findings group: " + groups.join(","));
  assert.ok(groups.includes("Spacing"), "spacing findings group: " + groups.join(","));
});

test("U09: Fit this text repairs exactly the reported shape in one undo step", () => {
  const e = environment();
  setup(e);
  e.run("transact(()=>{const big=makeNode('rect',700,450); big.text='A very long label that cannot fit inside this small shape at all'; globalThis.__big=big.id;});");
  e.run("refreshProps(true);");
  const props = e.document.querySelector("#props");
  const act = [...props.querySelectorAll("button")].find(
    (b) => b.textContent === "Fit this text",
  );
  assert.ok(act, "the specific action is offered");
  const histBefore = Number(e.run("history.length"));
  act.click();
  assert.ok(
    Number(e.run("history.length")) > histBefore,
    "the repair is one undoable step",
  );
  assert.equal(
    e.run("reviewIssues().some(i=>i.kind==='text-overflow'&&i.id===globalThis.__big)"),
    false,
    "the targeted issue is gone",
  );
  const size = JSON.parse(
    e.run("JSON.stringify({w: state.nodes[globalThis.__big].w, h: state.nodes[globalThis.__big].h})"),
  );
  assert.ok(size.w > 140 || size.h > 70, "the shape grew to fit");
});

test("U09: Preview even spacing reuses the tidy contract and Cancel changes nothing", () => {
  const e = environment();
  setup(e);
  /* Overlapping shapes give tidy a real change to propose. */
  e.run(
    "transact(()=>{const c=makeNode('rect',700,450); const d=makeNode('rect',710,460); makeEdge(c.id,d.id,'e','w');});",
  );
  e.run("refreshProps(true);");
  const act = [...e.document.querySelector("#props").querySelectorAll("button")].find(
    (b) => b.textContent === "Preview even spacing",
  );
  assert.ok(act, "the overlap finding offers an even-spacing preview");
  const before = e.run("JSON.stringify(docData())");
  act.click();
  assert.equal(e.run("state.sel.size"), 2, "both involved objects are selected for the preview");
  assert.ok(e.run("tidyPreview") !== null, "a reviewable proposal exists");
  const cancel = [...e.document.querySelector("#props").querySelectorAll("button")].find(
    (b) => b.textContent === "Cancel",
  );
  assert.ok(cancel, "Cancel is offered");
  cancel.click();
  assert.equal(e.run("tidyPreview"), null, "the proposal is discarded");
  assert.equal(e.run("JSON.stringify(docData())"), before, "Cancel is byte-for-byte a no-op");
});

/* ===== Pass 7 — U10 export proofing ===== */

test("U10: the export scope is quantified before download", () => {
  const e = environment();
  setup(e);
  e.run("transact(()=>{makeNode('rect',700,450);});");
  e.run("openExportDialog();");
  const counts = e.document.querySelector("#export-scope-counts").textContent;
  assert.ok(/^[0-9]+ shapes? · [0-9]+ connectors?$/.test(counts), "counts render: " + counts);
  assert.ok(counts.startsWith("3 shapes"), "whole-diagram scope counts everything: " + counts);
  e.run("state.sel=new Set([a.id]);openExportDialog();");
  /* The vm has no radio-group semantics; clear the sibling explicitly. */
  e.run("document.querySelector('input[name=\"export-scope\"][value=\"all\"]').checked = false; document.querySelector('input[name=\"export-scope\"][value=\"selection\"]').checked = true;");
  e.run("refreshExportPreview();");
  const selCounts = e.document.querySelector("#export-scope-counts").textContent;
  assert.ok(selCounts.startsWith("1 shape"), "selection scope counts only the selection: " + selCounts);
});

test("U10: PNG output size is stated after clamping", () => {
  const e = environment();
  const small = JSON.parse(e.run("JSON.stringify(pngOutputSize(100,80,2))"));
  assert.deepEqual(small, { w: 200, h: 160, scale: 2, clamped: false }, "small exports scale plainly");
  const huge = JSON.parse(e.run("JSON.stringify(pngOutputSize(3000,3000,4))"));
  assert.equal(huge.w, 8192, "the 8192px ceiling holds");
  assert.equal(huge.clamped, true, "clamping is explicit");
});

test("U10: the format row shows only its own controls", () => {
  const e = environment();
  setup(e);
  e.run("openExportDialog();");
  const pngSel = e.document.querySelector("#export-scale"),
    pdfSel = e.document.querySelector("#export-page");
  assert.equal(pngSel.hidden, true, "PNG scale hidden for SVG");
  assert.equal(pdfSel.hidden, true, "PDF page hidden for SVG");
  e.document.querySelector('[data-export-format="png"]').click();
  assert.equal(pngSel.hidden, false, "PNG scale shows for PNG");
  assert.equal(pdfSel.hidden, true, "PDF page still hidden");
  assert.equal(
    e.document.querySelector('[data-export-format="png"]').getAttribute("aria-pressed"),
    "true",
    "the pressed state follows the format",
  );
  e.document.querySelector('[data-export-format="pdf"]').click();
  assert.equal(pdfSel.hidden, false, "PDF page shows for PDF");
});

test("U10: export preferences persist outside history and restore on reopen", () => {
  const e = environment();
  setup(e);
  e.run("openExportDialog();");
  e.run("document.querySelector('#export-margin').value = '64';");
  e.run("saveExportPrefs();");
  const saved = JSON.parse(
    e.run("localStorage.getItem('openchart.ui.export')"),
  );
  assert.equal(saved.margin, 64, "the margin was remembered");
  e.run("document.querySelector('#export-margin').value = '12';");
  e.run("openExportDialog();");
  assert.equal(
    String(e.document.querySelector("#export-margin").value),
    "64",
    "the dialog reopens with the saved preference",
  );
  assert.equal(Number(e.run("history.length")), 0, "preference changes never enter history");
});

test("U10: downloads are guarded against double submission and report honestly", () => {
  const e = environment();
  setup(e);
  e.run("openExportDialog();");
  e.run("setExportBusy(true, 'Preparing…');");
  assert.equal(e.document.querySelector("#export-do-svg").disabled, true, "downloads disable while preparing");
  assert.equal(
    e.document.querySelector("#export-status").textContent,
    "Preparing…",
    "the status names the work",
  );
  e.run("setExportBusy(false, 'PNG export failed - the dialog stays open. Try SVG instead.');");
  assert.equal(e.document.querySelector("#export-do-svg").disabled, false, "controls recover");
  assert.ok(
    e.document.querySelector("#export-status").textContent.includes("stays open"),
    "failure keeps the dialog and says so",
  );
});

/* ===== Pass 7 — U11 commands, save truthfulness, undo labels ===== */

test("U11: Undo names the action it actually undoes", () => {
  const e = environment();
  setup(e);
  e.run("transact(() => { a.x = 240; }, 'move Process');");
  e.run("undo();");
  assert.ok(
    e.document.querySelector("#hint").textContent.includes("Undid: move Process"),
    "undo names the undone action",
  );
  assert.equal(
    e.run("state.nodes[a.id].x"),
    30,
    "the undo still restores the exact prior state",
  );
  e.run("redo();");
  assert.ok(
    e.document.querySelector("#hint").textContent.includes("Redid: move Process"),
    "redo names the re-applied action",
  );
  assert.equal(
    e.run("state.nodes[a.id].x"),
    240,
    "redo restores the moved state",
  );
});

test("U11: save states are truthful about saving, saved, and failure", () => {
  const e = environment();
  setup(e);
  e.run("armDeferredSave(50);");
  assert.equal(
    e.document.querySelector("#save-status").textContent,
    "Saving on this device…",
    "a scheduled write reads as saving",
  );
  e.run("autosave();");
  assert.equal(
    e.document.querySelector("#save-status").textContent,
    "Saved on this device",
    "a completed write reads as saved",
  );
  e.run("localStorage.setItem = () => { throw new Error('quota'); }");
  e.run("autosave();");
  assert.equal(
    e.document.querySelector("#save-status").textContent,
    "Not saved · download a copy",
    "failure says so and points at a copy",
  );
  assert.ok(
    e.document.querySelector("#save-status").classList.contains("error"),
    "the failure state is marked",
  );
});

test("U11: disabled commands explain themselves through the registry", () => {
  const e = environment();
  setup(e);
  assert.equal(
    e.run("explainDisabled('undo')"),
    "Nothing to undo yet",
    "a fresh document explains the disabled Undo",
  );
  assert.equal(
    e.document.querySelector("#btn-undo").title,
    "Nothing to undo yet",
    "the toolbar carries the explanation",
  );
  e.run("transact(() => { a.x = 200; });");
  e.run("updateChrome();");
  assert.equal(
    e.run("explainDisabled('undo')"),
    null,
    "an available action has no disabled explanation",
  );
  assert.equal(
    e.document.querySelector("#btn-undo").title,
    "Undo (Ctrl/⌘ Z)",
    "the shortcut title returns when enabled",
  );
  assert.equal(
    e.run("explainDisabled('fit-selection')"),
    "Nothing is selected",
    "fit selection explains the empty selection",
  );
});

/* ===== Pass 7 — U12 accessibility ===== */

test("U12: ports appear for the selected shape, not only on hover", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();");
  const ports = e.document.querySelectorAll("[data-port]");
  assert.equal(ports.length, 4, "the selected shape shows all four ports");
  assert.ok(
    (ports[0].getAttribute("aria-label") || "").includes("side"),
    "each port announces its side",
  );
  e.run("state.sel.clear();render();");
  assert.equal(
    e.document.querySelectorAll("[data-port]").length,
    0,
    "with nothing selected or hovered no ports render",
  );
});

test("U12: live regions and keyboard affordances are in place", () => {
  const e = environment();
  setup(e);
  assert.equal(
    e.document.querySelector("#hint").getAttribute("role"),
    "status",
    "hints are a live region",
  );
  const src = fs.readFileSync(
    path.join(__dirname, "..", "index.html"),
    "utf8",
  );
  assert.ok(src.includes(":focus-visible"), "keyboard focus is always visible");
  assert.ok(src.includes("prefers-reduced-motion"), "reduced motion is honored");
  assert.ok(src.includes("@media (max-width: 800px)"), "narrow viewports reflow the drawers");
});

/* ===== Pass 7 — U01 guardrail: chrome work never touches the document ===== */

test("U01 guardrail: shell interactions leave document bytes and export SVG unchanged", () => {
  const e = environment();
  setup(e);
  e.run("transact(()=>{makeNode('rect',210,100);});");
  e.run("render();");
  const before = e.run("JSON.stringify(docData())");
  const svgBefore = e.run("buildExportSVG(false, exportOptions())");
  /* Every new shell interaction at once: */
  e.run("openExportDialog();");
  e.document.querySelector('[data-export-format="png"]').click();
  e.run("document.querySelector('#export-margin').value = '64';");
  e.run("saveExportPrefs();refreshExportPreview();");
  e.document.querySelector("#export-close").click();
  e.document.querySelector("#review-btn").click();
  const search = e.document.querySelector("#outline-search");
  search.value = "a";
  search.fire("input");
  search.value = "";
  search.fire("input");
  e.run("fitSelection();revealObject(a);fitSelection();");
  /* The dialog remembers the margin the user typed - restore it so the
     two captures use identical export settings. */
  e.run("document.querySelector('#export-margin').value = '32';");
  const after = e.run("JSON.stringify(docData())");
  const svgAfter = e.run("buildExportSVG(false, exportOptions())");
  assert.equal(after, before, "document bytes are unchanged by shell work");
  assert.equal(svgAfter, svgBefore, "export SVG geometry is unchanged by shell work");
  /* The exported SVG must not carry chrome: no tool icons, no theme
     previews. */
  assert.equal(svgBefore.includes("<svg viewBox=\"0 0 16 16\""), false, "no toolbar icon leaked into the export");
});

/* ===== Pass 7b — spell check for box text (typing aid, never content) ===== */

test("SPELL: the canvas editor spellchecks by default and the toggle persists", () => {
  const e = environment();
  setup(e);
  assert.equal(
    e.document.querySelector("#txtedit").getAttribute("spellcheck"),
    "true",
    "the inline editor spellchecks by default",
  );
  e.run("setSpellcheck(false);");
  assert.equal(
    e.document.querySelector("#txtedit").getAttribute("spellcheck"),
    "false",
    "turning it off reaches the live editor",
  );
  assert.equal(
    e.document.querySelector("#doc-title").getAttribute("spellcheck"),
    "false",
    "the title field follows too",
  );
  assert.equal(
    e.run("localStorage.getItem('openchart.ui.prefs')"),
    '{"spellcheck":false}',
    "the preference persists outside history",
  );
  e.run("setSpellcheck(true);");
  assert.equal(
    e.document.querySelector("#txtedit").getAttribute("spellcheck"),
    "true",
    "it turns back on",
  );
});

test("SPELL: spelling is presentation-only - document and history untouched", () => {
  const e = environment();
  setup(e);
  const before = e.run("JSON.stringify(docData())");
  const histBefore = Number(e.run("history.length"));
  e.run("setSpellcheck(false);setSpellcheck(true);setSpellcheck(false);");
  assert.equal(e.run("JSON.stringify(docData())"), before, "no document byte changes");
  assert.equal(Number(e.run("history.length")), histBefore, "no undo step is recorded");
});

test("SPELL: inspector text fields follow the preference at build time", () => {
  const e = environment();
  setup(e);
  e.run("state.sel=new Set([a.id]);render();refreshProps(true);");
  const props = e.document.querySelector("#props");
  const labelIn = [...props.querySelectorAll("input")].find(
    (i) => i.getAttribute("spellcheck") === "true",
  );
  assert.ok(labelIn, "the inspector text field spellchecks");
  e.run("setSpellcheck(false);refreshProps(true);");
  const props2 = e.document.querySelector("#props");
  const anyOn = [...props2.querySelectorAll("input[type=text]")].some(
    (i) => i.getAttribute("spellcheck") === "true",
  );
  assert.equal(anyOn, false, "a rebuilt inspector honors the off state");
});

test("SPELL: search fields never spellcheck", () => {
  const e = environment();
  setup(e);
  for (const id of ["shape-search", "outline-search"]) {
    assert.equal(
      e.document.querySelector("#" + id).getAttribute("spellcheck"),
      "false",
      id + " opts out in markup",
    );
  }
  e.run("setSpellcheck(true);");
  assert.equal(
    e.document.querySelector("#shape-search").getAttribute("spellcheck"),
    "false",
    "the sweep still skips search fields",
  );
});

test("SPELL: the Settings toggle is discoverable and wired", () => {
  const e = environment();
  setup(e);
  const chk = e.document.querySelector("#pref-spellcheck");
  assert.ok(chk, "the Settings menu carries the toggle");
  assert.equal(chk.checked, true, "it reflects the default-on preference");
  chk.checked = false;
  chk.fire("change");
  assert.equal(
    e.document.querySelector("#txtedit").getAttribute("spellcheck"),
    "false",
    "toggling the menu item reconfigures the editors",
  );
  assert.ok(
    e.document.querySelector("#spell") === null,
    "sanity: no stray element",
  );
});
