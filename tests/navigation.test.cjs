const { test } = require("node:test");
const assert = require("node:assert/strict");
const { environment, setup, pointer } = require("./harness.cjs");

function fixture() {
  const e = environment();
  setup(e);
  e.run("view={x:0,y:0,z:1};render()");
  return e;
}

// Safari trackpads report cumulative GestureEvent scales, unlike the
// Ctrl-wheel deltas used by Chromium. Exercise the registered listeners.
function nativePinch(e, type, scale, extra = {}, target = "#stage") {
  let prevented = false;
  const init = {
    target: e.document.querySelector(target),
    clientX: 520,
    clientY: 302,
    scale,
    preventDefault() {
      prevented = true;
    },
    ...extra,
  };
  if (type === "start") init.target.fire("gesturestart", init);
  else e.windowEvent("gesture" + type, init);
  return prevented;
}

function wheel(e, extra = {}, target = "#stage") {
  let prevented = false;
  e.document.querySelector(target).fire("wheel", {
    clientX: 520,
    clientY: 302,
    deltaX: 0,
    deltaY: -25,
    ctrlKey: true,
    preventDefault() {
      prevented = true;
    },
    ...extra,
  });
  return prevented;
}

const touch = (id) => ({ pointerId: id, pointerType: "touch" });

test("Safari pinch uses cumulative scale, keeps its anchor, and saves only view", () => {
  const e = fixture();
  const doc = e.run("snapshot()"),
    writes = e.writes;
  e.run(
    "let solves=0;const oldRouteAll=routeAll;routeAll=(...args)=>{solves++;return oldRouteAll(...args)}",
  );
  assert.equal(nativePinch(e, "start", 1), true);
  nativePinch(e, "change", 1.2);
  nativePinch(e, "change", 1.5);
  assert.equal(e.run("view.z"), 1.5);
  assert.deepEqual(e.json("s2w(300,200)"), { x: 300, y: 200 });
  assert.equal(e.pendingFrames, 1);
  e.frame();
  assert.equal(e.document.querySelector("#zoomval").textContent, "150%");
  assert.equal(e.writes, writes);
  nativePinch(e, "end", 1.6);
  e.frame();
  assert.equal(e.run("view.z"), 1.6);
  assert.equal(e.run("gesture"), null);
  assert.equal(e.run("snapshot()"), doc);
  assert.equal(e.run("history.length"), 0);
  assert.equal(e.run("solves"), 0);
  e.advance(300);
  assert.equal(JSON.parse(e.storage.get("openchart.doc.v1")).view.z, 1.6);
});

test("Safari pinch clamps, supports moving midpoint, and starts a fresh scale each time", () => {
  const e = fixture();
  nativePinch(e, "start", 1);
  nativePinch(e, "change", 2, { clientX: 540, clientY: 312 });
  assert.deepEqual(e.json("s2w(320,210)"), { x: 300, y: 200 });
  nativePinch(e, "end", 2, { clientX: 540, clientY: 312 });
  nativePinch(e, "start", 1);
  nativePinch(e, "change", 0.75);
  assert.equal(e.run("view.z"), 1.5);
  nativePinch(e, "change", 100);
  assert.equal(e.run("view.z"), 4);
  nativePinch(e, "change", 0.001);
  assert.equal(e.run("view.z"), 0.1);
});

test("Native pinch and wheel input cannot apply the same zoom twice", () => {
  const e = fixture();
  nativePinch(e, "start", 1);
  nativePinch(e, "change", 1.5);
  const view = e.json("view");
  assert.equal(wheel(e), true);
  assert.deepEqual(e.json("view"), view);
  nativePinch(e, "end", 1.5);
  wheel(e);
  assert.ok(e.run("view.z") > 1.5);
});

test("Pinch over the inline editor zooms the canvas without committing its draft", () => {
  const e = fixture();
  e.run("editText(a);$('#txtedit').value='Uncommitted draft'");
  assert.equal(wheel(e, {}, "#txtedit"), true);
  assert.ok(e.run("view.z") > 1);
  const view = e.json("view");
  assert.equal(wheel(e, { ctrlKey: false }, "#txtedit"), false);
  assert.deepEqual(
    e.json("view"),
    view,
    "ordinary textarea scroll stays native",
  );
  assert.equal(nativePinch(e, "start", 1, {}, "#txtedit"), true);
  nativePinch(e, "change", 1.5, {}, "#txtedit");
  nativePinch(e, "end", 1.5, {}, "#txtedit");
  e.frame();
  assert.ok(Math.abs(e.run("view.z") - view.z * 1.5) < 1e-9);
  assert.equal(e.run("!!editing"), true);
  assert.equal(e.run("a.text"), "A");
  assert.equal(e.run("history.length"), 0);
  assert.equal(e.document.querySelector("#txtedit").value, "Uncommitted draft");
});

test("Safari pinch falls back to the last canvas pointer, then the center", () => {
  const e = fixture();
  nativePinch(e, "start", 1, { clientX: undefined, clientY: undefined });
  nativePinch(e, "change", 2, { clientX: undefined, clientY: undefined });
  assert.equal(e.run("view.z"), 2);
  assert.deepEqual(e.json("s2w(450,325)"), { x: 450, y: 325 });
  nativePinch(e, "end", 2, { clientX: undefined, clientY: undefined });
  e.run("view={x:0,y:0,z:1}");
  pointer(e, "move", 250, 175);
  nativePinch(e, "start", 1, { clientX: 0, clientY: 0 });
  nativePinch(e, "change", 2, { clientX: 0, clientY: 0 });
  assert.equal(e.run("view.z"), 2);
  assert.deepEqual(e.json("s2w(250,175)"), { x: 250, y: 175 });
});

test("Invalid native scales cannot poison view and blur makes late events inert", () => {
  const e = fixture();
  nativePinch(e, "start", 1);
  nativePinch(e, "change", 1.5);
  assert.equal(e.run("view.z"), 1.5);
  const view = e.json("view");
  for (const scale of [undefined, NaN, Infinity, 0, -1]) {
    nativePinch(e, "change", scale);
    assert.deepEqual(e.json("view"), view);
  }
  e.windowEvent("blur");
  nativePinch(e, "change", 2);
  nativePinch(e, "end", 2);
  assert.deepEqual(e.json("view"), { x: 0, y: 0, z: 1 });
  assert.equal(e.run("gesture"), null);
  wheel(e);
  assert.ok(e.run("view.z") > 1, "blur must not leave input blocked");
});

test("Touch pointer pinch owns scaling when Safari also emits native gestures", () => {
  const e = fixture();
  pointer(e, "down", 500, 300, "#stage", touch(11));
  nativePinch(e, "start", 1);
  pointer(e, "down", 700, 300, "#stage", touch(12));
  pointer(e, "move", 800, 300, "#stage", touch(12));
  assert.equal(e.run("view.z"), 1.5);
  const view = e.json("view");
  nativePinch(e, "change", 1.5);
  assert.deepEqual(e.json("view"), view);
  nativePinch(e, "end", 1.5);
  assert.equal(e.run("gesture.kind"), "pinch");
  pointer(e, "up", 800, 300, "#stage", touch(12));
  pointer(e, "up", 500, 300, "#stage", touch(11));
  assert.equal(e.run("view.z"), 1.5);
  assert.equal(e.run("history.length"), 0);
});

for (const event of ["pointercancel", "lostpointercapture"])
  test(
    "An ignored third contact's " + event + " does not cancel a pinch",
    () => {
      const e = fixture();
      pointer(e, "down", 500, 300, "#stage", touch(11));
      pointer(e, "down", 700, 300, "#stage", touch(12));
      pointer(e, "move", 800, 300, "#stage", touch(12));
      pointer(e, "down", 800, 400, "#stage", touch(13));
      e.document.querySelector("#stage").fire(event, { pointerId: 13 });
      assert.equal(e.run("gesture?.kind"), "pinch");
      assert.equal(e.run("view.z"), 1.5);
      pointer(e, "move", 900, 300, "#stage", touch(12));
      assert.equal(e.run("view.z"), 2);
      pointer(e, "up", 900, 300, "#stage", touch(12));
      pointer(e, "up", 500, 300, "#stage", touch(11));
      assert.equal(e.run("touchDrain"), false);
    },
  );

test("Unrelated pointer hover/release cannot resolve a pending touch placement", () => {
  const e = fixture();
  e.run("setTool('place','rect')");
  const before = e.run("snapshot()");
  pointer(e, "down", 600, 300, "#stage", touch(11));
  pointer(e, "move", 50, 50, "#stage", { pointerId: 1, pointerType: "mouse" });
  pointer(e, "up", 50, 50, "#stage", { pointerId: 1, pointerType: "mouse" });
  assert.equal(e.run("snapshot()"), before);
  assert.equal(e.run("gesture?.kind"), "touchPending");
  pointer(e, "up", 600, 300, "#stage", touch(11));
  assert.equal(e.run("Object.keys(state.nodes).length"), 3);
  assert.equal(e.run("history.length"), 1);
});

test("Cancelled pan restores the cursor as well as the view", () => {
  const e = fixture();
  e.run("setTool('pan')");
  pointer(e, "down", 500, 300);
  pointer(e, "move", 550, 300);
  e.document.querySelector("#stage").fire("pointercancel", { pointerId: 1 });
  assert.deepEqual(e.json("view"), { x: 0, y: 0, z: 1 });
  assert.equal(e.document.querySelector("#stage").style.cursor, "grab");
});

test("Native gestures outside the canvas leave browser zoom alone", () => {
  const e = fixture();
  assert.equal(nativePinch(e, "start", 1, {}, "#props"), false);
  assert.equal(nativePinch(e, "change", 2, {}, "#props"), false);
  assert.equal(nativePinch(e, "end", 2, {}, "#props"), false);
  assert.deepEqual(e.json("view"), { x: 0, y: 0, z: 1 });
});

test("Pointer hover during native pinch cannot start a document gesture", () => {
  const e = fixture();
  nativePinch(e, "start", 1);
  nativePinch(e, "change", 1.5);
  pointer(e, "move", 400, 300);
  pointer(e, "up", 400, 300);
  assert.equal(e.run("gesture.kind"), "nativePinch");
  assert.equal(e.run("view.z"), 1.5);
  nativePinch(e, "end", 1.5);
  assert.equal(e.run("history.length"), 0);
});
