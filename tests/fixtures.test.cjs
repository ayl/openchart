/* Fixture-based route checks (phase 0/1 of NEXT_PLAN.MD).
   Hard invariants must hold for every fixture. Target assertions encode the
   plan's intended behavior; ones not yet implemented are skipped with the
   owning phase so the suite stays green while the gap stays visible. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { environment } = require("./harness.cjs");
const { CHECKS_SOURCE, loadFixture, runInvariants } = require("./geometry.cjs");

const FIXTURE_DIR = path.join(__dirname, "fixtures");
const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8")));

function withChecks(e) {
  e.run(CHECKS_SOURCE);
  return e;
}
function load(e, fixture) {
  loadFixture(e, fixture);
  withChecks(e);
  return e;
}
const ports = (e, nodeId) => JSON.parse(e.run("JSON.stringify(diagPorts(" + JSON.stringify(nodeId) + "))"));
const nodes = (e) => e.run("Object.keys(state.nodes)");

for (const fixture of fixtures) {
  test("fixtures/" + fixture.name + " — route invariants", () => {
    const e = load(environment(), fixture);
    const problems = runInvariants(e, fixture.doc);
    assert.deepEqual(problems, []);
  });
}

/* --- phase 1 targets: ordered, separated attachment ports --- */

test("targets/ports-opposite — in+out with remotes above get distinct ports", () => {
  const e = load(environment(), fixtures.find((f) => f.name === "ports-opposite"));
  const B = nodes(e).find((id) => e.run("state.nodes[" + JSON.stringify(id) + "].y") > 300);
  const list = ports(e, B).filter((p) => p.side === "n");
  assert.equal(list.length, 2);
  const distinct = new Set(list.map((p) => Math.round(p.point.x) + "," + Math.round(p.point.y)));
  assert.equal(distinct.size, 2, "both connectors share one port: " + JSON.stringify(list));
});

test("targets/ports-crowded — ports are distinct and ordered by remote position", () => {
  const e = load(environment(), fixtures.find((f) => f.name === "ports-crowded"));
  const B = nodes(e).find((id) => e.run("state.nodes[" + JSON.stringify(id) + "].y") > 300);
  const list = ports(e, B).filter((p) => p.side === "n");
  assert.equal(list.length, 4);
  const xs = list.map((p) => p.point.x);
  assert.equal(new Set(xs).size, 4, "ports not distinct: " + JSON.stringify(list));
  const byRemote = [...list].sort((a, b) => a.remoteProj - b.remoteProj);
  const ordered = byRemote.map((p) => p.point.x);
  assert.deepEqual(
    [...ordered].sort((a, b) => a - b),
    ordered,
    "ports not ordered by remote position: " + JSON.stringify(byRemote),
  );
});

test("targets/reciprocal — parallel approaches without crossing", () => {
  const e = load(environment(), fixtures.find((f) => f.name === "reciprocal"));
  const ids = e.run("Object.keys(state.edges)");
  const pts1 = e.run("routeEdge(state.edges[" + JSON.stringify(ids[0]) + "]).pts");
  const pts2 = e.run("routeEdge(state.edges[" + JSON.stringify(ids[1]) + "]).pts");
  assert.equal(pts1.length, 2, "straight connectors stay straight");
  assert.equal(pts2.length, 2, "straight connectors stay straight");
  const cross = e.run(
    "diagSegX(" +
      JSON.stringify(pts1[0]) + "," + JSON.stringify(pts1[1]) + "," +
      JSON.stringify(pts2[0]) + "," + JSON.stringify(pts2[1]) + ") !== null",
  );
  assert.equal(cross, false, "reciprocal connectors cross");
  const A = nodes(e)[0];
  const ends = [pts1, pts2].map((pts) =>
    pts[0].x < pts[1].x ? pts[0] : pts[1],
  );
  assert.notEqual(ends[0].y, ends[1].y, "ports at the shared end coincide");
});

test("targets/diamond-attachments — perimeter ports and orthogonal routes", () => {
  const e = load(environment(), fixtures.find((f) => f.name === "diamond-attachments"));
  const D = nodes(e).find((id) => e.run("state.nodes[" + JSON.stringify(id) + "].type") === "decision");
  for (const p of ports(e, D)) {
    const onPerimeter = e.run(
      "(function(){var n=state.nodes[" + JSON.stringify(D) + "],c=center(n),p=" +
        JSON.stringify(p.point) +
        ";return Math.abs(Math.abs((p.x-c.x)/(n.w/2))+Math.abs((p.y-c.y)/(n.h/2))-1)<1e-6;})()",
    );
    assert.equal(onPerimeter, true, "port off the diamond perimeter: " + JSON.stringify(p));
  }
  const ids = e.run("Object.keys(state.edges)");
  for (const id of ids) {
    const pts = e.run("routeEdge(state.edges[" + JSON.stringify(id) + "]).pts");
    assert.equal(
      e.run("diagAxisAligned(" + JSON.stringify(pts) + ")"),
      true,
      "diagonal segment on a diamond route",
    );
  }
});

test("targets/shared-node-overlap — conflicts away from the shared node are avoided", () => {
  const e = load(environment(), fixtures.find((f) => f.name === "shared-node-overlap"));
  const crossings = JSON.parse(e.run("JSON.stringify(diagCrossings())"));
  assert.deepEqual(
    crossings,
    [],
    "connectors sharing a node still conflict away from it",
  );
});

test("targets/arrow-clearance — visible tip-to-border gap is ~2 units", () => {
  const e = load(environment(), fixtures.find((f) => f.name === "arrow-clearance"));
  const ids = e.run("Object.keys(state.edges)");
  for (const id of ids) {
    const gap = e.run("diagArrowGap(" + JSON.stringify(id) + ")");
    assert.ok(
      gap > 1.2 && gap < 2.8,
      "gap out of range for " + id + ": " + gap,
    );
  }
});
