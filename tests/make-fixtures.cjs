/* Builds the plan's reproduction fixtures as real OpenChart documents
   (version 2 save format) using the application's own constructors. */
const fs = require("node:fs");
const path = require("node:path");
const { environment } = require("./harness.cjs");

function build(name, description, buildScene) {
  const e = environment();
  e.run(buildScene);
  const doc = e.run("docData()");
  return { name, description, doc };
}

const fixtures = [
  build(
    "ports-opposite",
    "An incoming and an outgoing connector whose remote endpoints are both above the same box: both resolved to the single top-center port (review finding: shared point ~(140,216)).",
    "state.nodes={};state.edges={};state.order=[];const B=makeNode('rect',500,400),A=makeNode('rect',300,160),C=makeNode('rect',700,160);makeEdge(A.id,B.id);makeEdge(B.id,C.id);render();",
  ),
  build(
    "ports-crowded",
    "Several independent connectors meeting one side: three incoming from different sources plus one outgoing, all with remotes above. Ports must be distinct and ordered by remote position.",
    "state.nodes={};state.edges={};state.order=[];const B=makeNode('rect',500,400),W1=makeNode('rect',380,140),W2=makeNode('rect',500,80),W3=makeNode('rect',580,160),W4=makeNode('rect',720,100);makeEdge(W1.id,B.id);makeEdge(W2.id,B.id);makeEdge(W3.id,B.id);makeEdge(B.id,W4.id);render();",
  ),
  build(
    "reciprocal",
    "A->B and B->A between two aligned shapes: separate arrowheads with parallel, consistently-handed approaches.",
    "state.nodes={};state.edges={};state.order=[];const A=makeNode('rect',200,300),B=makeNode('rect',600,300);makeEdge(A.id,B.id);makeEdge(B.id,A.id);render();",
  ),
  build(
    "diamond-attachments",
    "A decision diamond approached and left on all four sides: attachments on the perimeter, no diagonal elbow segments.",
    "state.nodes={};state.edges={};state.order=[];const D=makeNode('decision',500,300),N=makeNode('rect',500,80),S=makeNode('rect',500,520),W=makeNode('rect',200,300),E=makeNode('rect',820,300);makeEdge(N.id,D.id);makeEdge(D.id,S.id);makeEdge(W.id,D.id);makeEdge(D.id,E.id);render();",
  ),
  build(
    "shared-node-overlap",
    "Two connectors share endpoint A; one approaches A along the corridor of the other. Crossings away from the shared attachment are currently excluded from avoidance (phase 1 remaining work).",
    "state.nodes={};state.edges={};state.order=[];const A=makeNode('rect',200,400),B=makeNode('rect',520,400),C=makeNode('rect',700,220);makeEdge(A.id,B.id);makeEdge(C.id,A.id);render();",
  ),
  build(
    "arrow-clearance",
    "Arrowheads arriving on all four sides of one box, with mixed connector and border widths: the visible tip-to-border gap should be ~2 diagram units at 100% zoom.",
    "state.nodes={};state.edges={};state.order=[];const M=makeNode('rect',500,300),N=makeNode('rect',500,80),S=makeNode('rect',500,520),W=makeNode('rect',200,300),E=makeNode('rect',820,300);M.sw=3;const e1=makeEdge(N.id,M.id),e2=makeEdge(S.id,M.id),e3=makeEdge(W.id,M.id),e4=makeEdge(E.id,M.id);e2.sw=3;e3.sw=1;e4.sw=2.5;render();",
  ),
];

const dir = path.join(__dirname, "fixtures");
fs.mkdirSync(dir, { recursive: true });
for (const f of fixtures)
  fs.writeFileSync(
    path.join(dir, f.name + ".json"),
    JSON.stringify(f, null, 2) + "\n",
  );
console.log("wrote", fixtures.length, "fixtures:", fixtures.map((f) => f.name).join(", "));
