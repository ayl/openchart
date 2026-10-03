const { test } = require("node:test");
const assert = require("node:assert/strict");
const { environment, setup, pointer } = require("./harness.cjs");

function fixture() {
  const e = environment();
  setup(e);
  e.run(
    "delete state.edges[edge.id];state.order=state.order.filter(k=>!k.startsWith('e:'));invalidateGeomCaches();view={x:0,y:0,z:1};render();setTool('connect')",
  );
  return e;
}
function click(e, x, y, target = "#stage", extra = {}) {
  pointer(e, "down", x, y, target, extra);
  pointer(e, "up", x, y, target, extra);
}
function directions(e) {
  return e.json(
    "Object.values(state.edges).map(e=>[e.src===a.id?'A':e.src===b.id?'B':'other',e.dst===a.id?'A':e.dst===b.id?'B':'other'])",
  );
}
function port(e, node, side) {
  e.run(`hoverId=${node}.id;renderOverlay()`);
  return e.document
    .querySelector("#overlay")
    .querySelectorAll("[data-port]")
    .find(
      (p) =>
        p.getAttribute("data-node") === e.run(node + ".id") &&
        p.getAttribute("data-port") === side,
    );
}

test("Two-click connectors keep the first shape as source, including a reciprocal arrow", () => {
  const e = fixture();
  click(e, 100, 100);
  assert.equal(e.run("connectSource?.id"), e.run("a.id"));
  assert.deepEqual(directions(e), []);
  click(e, 400, 100);
  assert.deepEqual(directions(e), [["A", "B"]]);
  click(e, 400, 100);
  click(e, 100, 100);
  assert.deepEqual(directions(e), [
    ["A", "B"],
    ["B", "A"],
  ]);
  assert.equal(e.run("history.length"), 2);
  assert.equal(e.run("connectSource"), null);
  e.run(
    "const pair=Object.values(state.edges);const forward=routeEdge(pair[0]).pts,reverse=routeEdge(pair[1]).pts",
  );
  assert.notDeepEqual(e.json("forward[0]"), e.json("reverse.at(-1)"));
  assert.notDeepEqual(e.json("forward.at(-1)"), e.json("reverse[0]"));
  e.run("undo()");
  assert.deepEqual(directions(e), [["A", "B"]]);
});

test("Clicking a destination port finishes the pending connector instead of reversing its source", () => {
  const e = fixture();
  click(e, 100, 100);
  const target = port(e, "b", "w");
  assert.ok(target);
  click(e, 330, 100, target);
  assert.deepEqual(directions(e), [["A", "B"]]);
  assert.equal(e.run("Object.values(state.edges)[0].dstSide"), "w");
});

test("Connector tool does not reconnect an existing arrow when starting its reverse", () => {
  const e = fixture();
  e.run(
    "const first=makeEdge(a.id,b.id,'e','w');state.sel=new Set(['e:'+first.id]);setTool('select');render()",
  );
  const grip = e.document
    .querySelector("#overlay")
    .querySelectorAll("[data-end]")
    .find((el) => el.getAttribute("data-end") === "1");
  const p = e.json(
    "w2s(routeEdge(first).pts.at(-1).x,routeEdge(first).pts.at(-1).y)",
  );
  assert.ok(grip);
  e.run("setTool('connect')");
  assert.equal(
    e.document.querySelector("#overlay").querySelectorAll("[data-end]").length,
    0,
  );
  // Even a hit on a stale/overlapping endpoint element is creation intent
  // when the explicit connector tool is active.
  pointer(e, "down", p.x, p.y, grip);
  pointer(e, "move", 100, 100);
  pointer(e, "up", 100, 100);
  assert.deepEqual(directions(e), [
    ["A", "B"],
    ["B", "A"],
  ]);
  assert.equal(e.run("first.dst"), e.run("b.id"));
});

test("Port drag can add the opposite connector in select mode without changing the first", () => {
  const e = fixture();
  e.run("const first=makeEdge(a.id,b.id,'e','w');setTool('select')");
  const source = port(e, "b", "w");
  pointer(e, "down", 330, 100, source);
  pointer(e, "move", 170, 100);
  pointer(e, "up", 170, 100);
  assert.deepEqual(directions(e), [
    ["A", "B"],
    ["B", "A"],
  ]);
  assert.equal(e.run("Object.values(state.edges)[1].srcSide"), "w");
});

test("Dropping just outside a visible port attaches instead of opening the shape picker", () => {
  const e = fixture();
  pointer(e, "down", 100, 100);
  pointer(e, "move", 326, 100);
  pointer(e, "up", 326, 100);
  assert.deepEqual(directions(e), [["A", "B"]]);
  assert.equal(e.run("Object.values(state.edges)[0].dstSide"), "w");
  assert.equal(e.run("pendingPicker"), null);
});

test("Two taps can connect on a touchscreen without creating a self-loop", () => {
  const e = fixture();
  click(e, 100, 100, "#stage", { pointerType: "touch", pointerId: 11 });
  assert.equal(e.run("connectSource?.id"), e.run("a.id"));
  click(e, 100, 100, "#stage", { pointerType: "touch", pointerId: 12 });
  assert.deepEqual(directions(e), []);
  click(e, 400, 100, "#stage", { pointerType: "touch", pointerId: 13 });
  assert.deepEqual(directions(e), [["A", "B"]]);
});

test("Cancelling create-and-connect clears the pending source", () => {
  const e = fixture();
  pointer(e, "down", 100, 100);
  pointer(e, "move", 600, 400);
  pointer(e, "up", 600, 400);
  const cancel = e.document
    .querySelector("#shape-picker")
    .querySelectorAll("button")
    .find((b) => b.textContent === "Cancel");
  assert.ok(cancel);
  cancel.click();
  assert.equal(e.run("connectSource"), null);
  click(e, 400, 100);
  assert.deepEqual(
    directions(e),
    [],
    "cancelled source must not create an unintended edge",
  );
});

test("Replacing the document invalidates a pending connector even if IDs are reused", () => {
  const e = fixture();
  e.run(
    "connectSource={id:a.id,side:'e'};const replacement=validateDocument(JSON.parse(snapshot()));transact(()=>installDocument(replacement))",
  );
  assert.equal(e.run("connectSource"), null);
});

test("A deleted or locked source cannot create a dangling connector", () => {
  const e = fixture();
  e.run("a.locked=true");
  const before = e.run("snapshot()");
  e.run("completeConnection(a.id,b.id)");
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("history.length"), 0);
  e.run("delete state.nodes[a.id];completeConnection(a.id,b.id)");
  assert.equal(e.run("Object.keys(state.edges).length"), 0);
});

for (const [name, dx, dy] of [
  ["right", 300, 0],
  ["left", -300, 0],
  ["below", 0, 250],
  ["above", 0, -250],
])
  test(
    "Reciprocal " +
      name +
      " connectors keep arrows on their actual destinations",
    () => {
      const e = fixture();
      e.run(
        `a.x=430;a.y=372;b.x=a.x+${dx};b.y=a.y+${dy};routesDirty=true;render()`,
      );
      const a = e.json("center(a)"),
        b = e.json("center(b)");
      click(e, a.x, a.y);
      click(e, b.x, b.y);
      click(e, b.x, b.y);
      click(e, a.x, a.y);
      assert.deepEqual(directions(e), [
        ["A", "B"],
        ["B", "A"],
      ]);
      const ends = [];
      for (const id of e.json("Object.keys(state.edges)")) {
        const route = e.json(`routeEdge(state.edges['${id}']).pts`);
        const target = e.json(`center(state.nodes[state.edges['${id}'].dst])`);
        const tip = route.at(-1),
          prev = route.at(-2);
        assert.ok(
          (tip.x - prev.x) * (target.x - tip.x) +
            (tip.y - prev.y) * (target.y - tip.y) >
            0,
          "terminal segment must head into destination, never away",
        );
        const drawing = e.run(`drawEdge(state.edges['${id}'],el('defs'),true)`);
        const line = drawing.querySelector("path");
        assert.ok(line.getAttribute("marker-end"));
        assert.equal(line.getAttribute("marker-start"), null);
        ends.push([route[0], tip]);
      }
      assert.notDeepEqual(ends[0][0], ends[1][1]);
      assert.notDeepEqual(ends[0][1], ends[1][0]);
    },
  );

test("Select-mode endpoint dragging still reconnects rather than adding an arrow", () => {
  const e = fixture();
  e.run(
    "const c=makeNode('rect',400,300),first=makeEdge(a.id,b.id);setTool('select');state.sel=new Set(['e:'+first.id]);render()",
  );
  const grip = e.document
    .querySelector("#overlay")
    .querySelectorAll("[data-end]")
    .find((el) => el.getAttribute("data-end") === "1");
  const p = e.json("routeEdge(first).pts.at(-1)");
  pointer(e, "down", p.x, p.y, grip);
  pointer(e, "move", 400, 300);
  pointer(e, "up", 400, 300);
  assert.equal(e.run("Object.keys(state.edges).length"), 1);
  assert.equal(e.run("first.src"), e.run("a.id"));
  assert.equal(e.run("first.dst"), e.run("c.id"));
  assert.equal(e.run("history.length"), 1);
  e.run("undo()");
  assert.equal(e.run("state.edges[first.id].dst"), e.run("b.id"));
});

test("Near-port drops respect zoom and never attach through a locked foreground", () => {
  const e = fixture();
  for (const z of [0.5, 1, 2]) {
    e.run(`view.z=${z}`);
    const near = e.run(`connectionTarget({x:330*view.z-6,y:100*view.z})`);
    assert.equal(near.n.id, e.run("b.id"));
    assert.equal(near.side, "w");
    assert.equal(
      e.run("connectionTarget({x:330*view.z-12,y:100*view.z})"),
      null,
    );
  }
  e.run(
    "view.z=1;const cover=makeNode('rect',326,100);cover.locked=true;render()",
  );
  assert.equal(e.run("connectionTarget({x:326,y:100})"), null);
});

test("Starting from one port and clicking the other preserves both explicit sides", () => {
  const e = fixture();
  e.run("setTool('select')");
  click(e, 170, 100, port(e, "a", "e"));
  pointer(e, "move", 330, 100);
  const target = e.document
    .querySelector("#overlay")
    .querySelectorAll("[data-port]")
    .find(
      (el) =>
        el.getAttribute("data-node") === e.run("b.id") &&
        el.getAttribute("data-port") === "w",
    );
  assert.ok(
    target,
    "pending click-to-connect should still expose destination ports",
  );
  click(e, 330, 100, target);
  assert.deepEqual(directions(e), [["A", "B"]]);
  assert.deepEqual(
    e.json("Object.values(state.edges).map(e=>[e.srcSide,e.dstSide])"),
    [["e", "w"]],
  );
});
