const { test } = require("node:test");
const assert = require("node:assert/strict");
const { environment, setup } = require("./harness.cjs");
const { loadFixture } = require("./geometry.cjs");

function fixture() {
  const e = environment();
  setup(e);
  return e;
}

test("Routing refinement continues while the whole-scene score improves", () => {
  const e = fixture();
  e.run(`
    var scores = [], passNumber = 0;
    routeEdge = function(e) {
      passNumber++;
      const r = {pts: [{x: 0, y: passNumber}, {x: 100, y: passNumber}]};
      routeCache.set(e.id, r);
      return r;
    };
    sceneRouteQuality = function() {
      scores.push(passNumber);
      return {crossings: 10 - passNumber, quality: 100};
    };
    routeAll();
  `);
  assert.equal(
    e.run("passNumber"),
    6,
    "baseline plus all five improving passes",
  );
  assert.equal(e.run("routeCache.get(edge.id).pts[0].y"), 6);
});

test("Routing refinement retains the best complete scene when a pass worsens", () => {
  const e = fixture();
  e.run(`
    var passNumber = 0;
    routeEdge = function(e) {
      const y = ++passNumber;
      const r = {pts: [{x: 0, y}, {x: 100, y}]};
      routeCache.set(e.id, r);
      return r;
    };
    sceneRouteQuality = () => ({crossings: [8, 5, 3, 6, 9, 10][passNumber - 1], quality: 100});
    routeAll();
  `);
  assert.equal(e.run("passNumber"), 4);
  assert.equal(e.run("routeCache.get(edge.id).pts[0].y"), 3);
});

test("Crossing-free scenes can still improve in bend and label quality", () => {
  const e = fixture();
  assert.equal(
    e.run(
      "betterRouteQuality({crossings:0,quality:100},{crossings:0,quality:200})",
    ),
    true,
  );
  assert.equal(
    e.run(
      "betterRouteQuality({crossings:1,quality:10},{crossings:0,quality:200})",
    ),
    false,
  );
  e.run(`
    var simple = [{x:0,y:0},{x:100,y:0},{x:100,y:100}];
    var bent = [{x:0,y:0},{x:50,y:0},{x:50,y:100},{x:100,y:100}];
  `);
  assert.ok(e.run("routeQuality(simple) < routeQuality(bent)"));
  assert.equal(
    e.run("routeQuality([{x:0,y:0},{x:50,y:0},{x:100,y:0}])"),
    e.run("routeQuality([{x:0,y:0},{x:100,y:0}])"),
  );
});

test("Fast route candidates avoid labels, with coordinates to go around them", () => {
  const e = fixture();
  e.run(`
    labelBoxes = [{edge:'other',x:40,y:-12,w:20,h:24}];
    var query = makePeerQuery(edge, false);
    query.count = () => 0;
    query.segPen = (p,q) => labelBoxPenalty(p,q,edge);
    var routed = orthogonalRoute({x:0,y:0},{x:100,y:0},[],50,'x',query);
  `);
  assert.equal(e.run("routeLabelPenalty(routed,edge)"), 0);
  assert.ok(e.run("routed.some(p=>Math.abs(p.y)>12)"));
});

test("Label penalties are independent of path sampling density", () => {
  const e = fixture();
  e.run("labelBoxes=[{edge:'other',x:20,y:-10,w:60,h:20}]");
  assert.equal(e.run("routeLabelPenalty([{x:0,y:0},{x:100,y:0}],edge)"), 5000);
  assert.equal(
    e.run(
      "routeLabelPenalty([{x:0,y:0},{x:30,y:0},{x:60,y:0},{x:100,y:0}],edge)",
    ),
    5000,
  );
});

test("Locked connector labels remain routing obstacles after the cache clears", () => {
  const e = fixture();
  e.run(`
    edge.label='Protected label'; edge.locked=true; routeAll();
    var labelRoute=routeCache.get(edge.id);
    peerBaseline=new Map([[edge.id,labelRoute]]);routeCache.clear();segGridRebuild();
  `);
  assert.equal(e.run("ensureLabelBoxes().length"), 1);
});

test("Same-source crossings away from a declared trunk are counted", () => {
  const e = fixture();
  e.run(`
    var other={id:'other',src:edge.src,dst:'another'};
    var it={o:other,a:{x:500,y:400},b:{x:500,y:600}};
  `);
  assert.equal(
    e.run("peerSegmentConflict({x:400,y:500},{x:600,y:500},it,edge)"),
    true,
  );
});

test("Touching the shared box does not exempt the far end of a long segment", () => {
  const e = fixture();
  e.run(`
    var other={id:'other',src:edge.src,dst:'another'};
    var it={o:other,a:sidePoint(a,'e'),b:{x:800,y:center(a).y}};
  `);
  assert.equal(
    e.run("peerSegmentConflict({x:600,y:0},{x:600,y:200},it,edge)"),
    true,
  );
});

test("Matching declared buses share their trunk but not unrelated downstream segments", () => {
  const e = fixture();
  e.run(`
    var other={id:'other',src:edge.src,dst:'another'};
    var branch={key:'bus',segments:[[{x:300,y:100},{x:300,y:500}]]};
    var it={o:other,a:{x:300,y:100},b:{x:300,y:400},route:{branch}};
  `);
  assert.equal(
    e.run("peerSegmentConflict({x:300,y:200},{x:300,y:500},it,edge,branch)"),
    false,
  );
  assert.equal(
    e.run("peerSegmentConflict({x:200,y:300},{x:400,y:300},it,edge)"),
    true,
  );
  e.run("it.a={x:600,y:100};it.b={x:600,y:400}");
  assert.equal(
    e.run("peerSegmentConflict({x:500,y:300},{x:700,y:300},it,edge,branch)"),
    true,
  );
});

test("Peer segment scores are not multiplied by spatial grid cells", () => {
  const e = fixture();
  e.run(`
    var other={...edge,id:'other'};
    state.edges.other=other;
    var r={pts:[{x:0,y:500},{x:1600,y:500}]};
    peerBaseline=new Map([['other',r]]);routeCache.clear();segGridRebuild();
  `);
  assert.equal(
    e.run("segmentPeerPenalty({x:100,y:500},{x:1500,y:500},edge,false)"),
    100000,
  );
});

test("Updated overlay routes replace their old baseline rather than scoring both", () => {
  const e = fixture();
  e.run(`
    var other={...edge,id:'other'};state.edges.other=other;
    peerBaseline=new Map([['other',{pts:[{x:0,y:500},{x:600,y:500}]}]]);
    routeCache.clear();segGridRebuild();
    var next={pts:[{x:0,y:800},{x:600,y:800}]};
    routeCache.set('other',next);overlayInsert(other,next);
  `);
  assert.equal(
    e.run("queryPeerCrossings([{x:300,y:400},{x:300,y:600}],edge,true)"),
    0,
  );
  assert.equal(
    e.run("queryPeerCrossings([{x:300,y:400},{x:300,y:900}],edge,true)"),
    1,
  );
});

for (const hide of ["connector", "endpoint"]) {
  test(`Hidden ${hide} geometry does not deflect visible connectors`, () => {
    const e = fixture();
    e.run(`
      const hiddenNode=makeNode('rect',800,800);
      const other=makeEdge(a.id,hiddenNode.id);
      state.layers.push({id:'hidden',name:'Hidden',visible:false,locked:false});
      ${hide === "connector" ? "other.layerId='hidden'" : "hiddenNode.layerId='hidden'"};
      other.label='Not a visible obstacle';
      const r={pts:[{x:0,y:500},{x:600,y:500}]};
      routeCache.clear();routeCache.set(other.id,r);
      peerBaseline=new Map(routeCache);segGridRebuild();
      overlayInsert(other,r);
    `);
    assert.equal(e.run("queryPeerCrossings([{x:300,y:400},{x:300,y:600}],edge,true)"), 0);
    assert.equal(e.run("ensureLabelBoxes().length"), 0);
    assert.deepEqual(e.json("sceneRouteQuality()"), {crossings:0,quality:0});
  });
}

test("Twelve fixed incoming ports stay distinct on a small box", () => {
  const e = fixture();
  e.run(`
    state.edges={};state.order=state.order.filter(k=>!k.startsWith('e:'));
    a.h=40;var incoming=[];
    for(let i=0;i<12;i++){
      const n=makeNode('rect',600,i*70);
      incoming.push(makeEdge(n.id,a.id,'w','e'));
    }
    incidentCache=new Map();
    var ys=incoming.map(e=>distributedSidePoint(a,'e',state.nodes[e.src],e.id,'dst',e).y);
  `);
  assert.equal(e.run("new Set(ys).size"), 12);
  assert.deepEqual(e.json("ys.slice().sort((a,b)=>a-b)"), e.json("ys"));
  assert.ok(e.run("ys.every(y=>y>a.y+4&&y<a.y+a.h-4)"));
});

test("Independent duplicate flows use separate, matching lanes at both ends", () => {
  const e = fixture();
  e.run("var second=makeEdge(a.id,b.id);routeAll()");
  const routes = e.json("[routeEdge(edge).pts,routeEdge(second).pts]");
  assert.equal(routes[0].length, 2);
  assert.equal(routes[1].length, 2);
  assert.notEqual(routes[0][0].y, routes[1][0].y);
  assert.equal(routes[0][0].y, routes[0][1].y);
  assert.equal(routes[1][0].y, routes[1][1].y);
});

test("Tree forks retain one explicit shared bus and accurate endpoint metadata", () => {
  const e = fixture();
  e.run(
    "b.y-=100;var child=makeNode('rect',400,200);makeEdge(a.id,child.id);routeAll()",
  );
  assert.equal(
    e.run("new Set([...routeCache.values()].map(r=>r.branch?.key)).size"),
    1,
  );
  assert.ok(
    e.run("[...routeCache.values()].every(r=>!!r.branch&&r.conflicts===0)"),
  );
  assert.ok(
    e.run(
      "[...routeCache.values()].every(r=>JSON.stringify(r.pts[0])===JSON.stringify(r.sourcePort.point)&&JSON.stringify(r.pts.at(-1))===JSON.stringify(r.targetPort.point))",
    ),
  );
  const first = e.json("[...routeCache]");
  e.run("routeAll()");
  assert.deepEqual(e.json("[...routeCache]"), first);
});

test("Crowded automatic arrivals use facing adjacent sides without crossings", () => {
  const e = fixture();
  e.run(`
    state.edges={};state.order=state.order.filter(k=>!k.startsWith('e:'));
    a.h=40;var incoming=[];
    for(let i=0;i<8;i++){
      const n=makeNode('rect',600,-180+i*80);
      incoming.push(makeEdge(n.id,a.id));
    }
    routeAll();
  `);
  assert.deepEqual(e.json("incoming.map(e=>routeEdge(e).targetPort.side)"), [
    "n",
    "n",
    "n",
    "e",
    "e",
    "s",
    "s",
    "s",
  ]);
  assert.ok(e.run(`incoming.every((e,i)=>incoming.slice(i+1).every(other=>{
    const a=routeEdge(e).targetPort,b=routeEdge(other).targetPort;
    return a.side!==b.side || Math.hypot(a.point.x-b.point.x,a.point.y-b.point.y)>=portPitch(1.8)-1e-6;
  }))`), "arrival lanes clear the full large marker viewport plus breathing room");
  assert.equal(e.run("routeConflicts()"), 0);
  assert.equal(
    e.run(
      "new Set(incoming.map(e=>JSON.stringify(routeEdge(e).targetPort.point))).size",
    ),
    8,
  );
  assert.ok(
    e.run("incoming.every(e=>e.dstSide===null)"),
    "allocation is derived, not a manual port edit",
  );
  const before = e.json("incoming.map(e=>routeEdge(e).pts)");
  const saved = e.run("snapshot()");
  const reload = environment();
  reload.run(`restore(${JSON.stringify(saved)});render()`);
  assert.deepEqual(
    reload.json("Object.values(state.edges).map(e=>routeEdge(e).pts)"),
    before,
  );
});

test("Fixed sides and manual constraints are reservations during crowded allocation", () => {
  const e = fixture();
  e.run(`
    state.edges={};state.order=state.order.filter(k=>!k.startsWith('e:'));a.h=40;
    var incoming=[];
    for(let i=0;i<8;i++){
      const n=makeNode('rect',600,-180+i*80);
      incoming.push(makeEdge(n.id,a.id,'w','e'));
    }
    portSidePlan=planPortSides();
  `);
  assert.ok(e.run("incoming.every(e=>resolvedPortSides(e).ds==='e')"));
});

test("Small movements preserve lane order and attachment sides in a crowded scene", () => {
  const e = fixture();
  e.run(`
    state.edges={};state.order=state.order.filter(k=>!k.startsWith('e:'));a.h=40;
    var incoming=[];
    for(let i=0;i<8;i++){
      const n=makeNode('rect',600,-180+i*80);incoming.push(makeEdge(n.id,a.id));
    }
    routeAll();
  `);
  const topology = () =>
    e.json(
      "incoming.map(e=>{const r=routeEdge(e);return [r.sourcePort.side,r.targetPort.side,r.pts.slice(1).map((p,i)=>p.x===r.pts[i].x?'v':'h')];})",
    );
  const before = topology();
  e.run("a.x+=1;a.y+=1;invalidateGeomCaches();routeAll()");
  assert.deepEqual(topology(), before);
  assert.equal(e.run("routeConflicts()"), 0);
});

test("Bend scoring includes attachment leads, retaining balanced facing-port doglegs", () => {
  const e = fixture();
  e.run(`
    var routed=orthogonalRoute({x:24,y:0},{x:76,y:100},[],50,'x',null,
      [{x:0,y:0},{x:100,y:100}]);
  `);
  assert.deepEqual(e.json("routed"), [
    { x: 24, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 100 },
    { x: 76, y: 100 },
  ]);
});

test("A nearly aligned return flow is not pulled to the top by an unrelated branch", () => {
  const e = environment();
  loadFixture(e, require("./fixtures/routing-reciprocal-hub.json"));
  assert.deepEqual(
    e.json(
      "[routeEdge(state.edges.request).sourcePort.side,routeEdge(state.edges.request).targetPort.side]",
    ),
    ["e", "w"],
  );
  assert.deepEqual(
    e.json(
      "[routeEdge(state.edges.response).sourcePort.side,routeEdge(state.edges.response).targetPort.side]",
    ),
    ["w", "e"],
  );
  assert.equal(e.run("routeConflicts()"), 0);
});

for (const name of [
  "routing-capacity",
  "routing-branches",
  "routing-reciprocal-hub",
]) {
  test(`Routing quality/export fixture: ${name}`, () => {
    const e = environment();
    loadFixture(e, require(`./fixtures/${name}.json`));
    assert.equal(e.run("routeConflicts()"), 0);
    assert.equal(
      e.run(
        "Object.values(state.edges).reduce((sum,e)=>sum+routeLabelPenalty(routeEdge(e).pts,e),0)",
      ),
      0,
    );
    const paths = e.json("Object.values(state.edges).map(e=>edgePath(e))");
    const svg = e.run("buildExportSVG()");
    for (const d of paths)
      assert.ok(
        svg.includes(`d="${d}"`),
        "SVG uses the same painted connector geometry",
      );
    const routes = e.json(
      "Object.values(state.edges).map(e=>routeEdge(e).pts)",
    );
    e.run("routeAll()");
    assert.deepEqual(
      e.json("Object.values(state.edges).map(e=>routeEdge(e).pts)"),
      routes,
    );
  });
}
