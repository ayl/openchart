/* Route-invariant diagnostics for OpenChart (phase 0 of NEXT_PLAN.MD).
   The CHECKS source below is injected into the same VM context as the
   application script so it validates the real geometry functions, not a
   reimplementation. No painting involved: routes are checked as data. */

const CHECKS_SOURCE = `
function diagSegs(pts) {
  const s = [];
  for (let i = 1; i < pts.length; i++) s.push([pts[i - 1], pts[i]]);
  return s;
}
function diagFinite(pts) {
  return pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}
function diagNoZero(pts) {
  return pts.every((p, i) => !i || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y);
}
function diagAxisAligned(pts) {
  return pts.every((p, i) => !i || p.x === pts[i - 1].x || p.y === pts[i - 1].y);
}
/* Routes with more than two points must be orthogonal; a two-point route is
   an explicit straight connector and may run diagonally between offset ports. */
function diagOrthogonal(pts) {
  return pts.length <= 2 || diagAxisAligned(pts);
}
function diagNoReversal(pts) {
  const s = diagSegs(pts);
  for (let i = 1; i < s.length; i++) {
    const [a, b] = s[i - 1],
      [b2, c] = s[i];
    const axis = b.x === a.x ? "y" : b.y === a.y ? "x" : null;
    if (!axis) continue; // straight connectors are exempt
    if (b2[axis] !== b[axis]) continue;
    const d1 = b[axis] - a[axis],
      d2 = c[axis] - b[axis];
    if (d1 !== 0 && d2 !== 0 && Math.sign(d1) === -Math.sign(d2)) return false;
  }
  return true;
}
function diagSegRectHit(p, q, r) {
  if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return true;
  if (q.x > r.x && q.x < r.x + r.w && q.y > r.y && q.y < r.y + r.h) return true;
  const edges = [
    [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }],
    [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }],
    [{ x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
    [{ x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }],
  ];
  return edges.some((e) => diagSegX(p, q, e[0], e[1]) !== null);
}
function diagSegX(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) {
    /* collinear: report overlap midpoint when projections touch */
    const near = (a, b, c) => Math.min(a, b) - 1e-9 <= c && c <= Math.max(a, b) + 1e-9;
    const on = (p) =>
      near(p1.x, p2.x, p.x) && near(p1.y, p2.y, p.y);
    if (on(p3) || on(p4))
      return { x: (Math.max(Math.min(p1.x, p2.x), Math.min(p3.x, p4.x)) + Math.min(Math.max(p1.x, p2.x), Math.max(p3.x, p4.x))) / 2, y: (Math.max(Math.min(p1.y, p2.y), Math.min(p3.y, p4.y)) + Math.min(Math.max(p1.y, p2.y), Math.max(p3.y, p4.y))) / 2 };
    return null;
  }
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d,
    u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}
function diagInteriorHits(pts, skipIds) {
  const hits = [];
  const skip = new Set(skipIds);
  for (const n of Object.values(state.nodes)) {
    if (skip.has(n.id) || !isVisible(n)) continue;
    if (n.type === "textbox" || n.type === "container") continue;
    const r = {
      x: n.x + 1,
      y: n.y + 1,
      w: n.w - 2,
      h: n.h - 2,
    };
    for (const [p, q] of diagSegs(pts))
      if (diagSegRectHit(p, q, r)) {
        hits.push(n.id);
        break;
      }
  }
  return hits;
}
function diagSideOf(node, p) {
  const c = center(node);
  const dx = p.x - c.x,
    dy = p.y - c.y;
  if (Math.abs(dx) / node.w > Math.abs(dy) / node.h) return dx >= 0 ? "e" : "w";
  return dy >= 0 ? "s" : "n";
}
function diagPorts(nodeId) {
  const node = state.nodes[nodeId];
  const out = [];
  for (const e of Object.values(state.edges)) {
    if (!isVisible(e)) continue;
    if (e.src !== nodeId && e.dst !== nodeId) continue;
    const pts = routeEdge(e).pts;
    if (!pts || !pts.length) continue;
    let p, dir, remoteId;
    if (e.src === nodeId && e.dst === nodeId) {
      out.push({ edgeId: e.id, self: true, pts });
      continue;
    }
    if (e.src === nodeId) {
      p = pts[0];
      dir = "out";
      remoteId = e.dst;
    } else {
      p = pts[pts.length - 1];
      dir = "in";
      remoteId = e.src;
    }
    out.push({
      edgeId: e.id,
      dir,
      side: diagSideOf(node, p),
      point: { x: p.x, y: p.y },
      remoteId,
      remoteProj:
        diagSideOf(node, p) === "n" || diagSideOf(node, p) === "s"
          ? center(state.nodes[remoteId]).x
          : center(state.nodes[remoteId]).y,
    });
  }
  return out;
}
function diagCrossings() {
  const edges = Object.values(state.edges).filter(isVisible);
  const found = [];
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = routeEdge(edges[i]).pts,
        b = routeEdge(edges[j]).pts;
      const ports = [a[0], a[a.length - 1], b[0], b[b.length - 1]];
      let hits = [];
      for (const s1 of diagSegs(a))
        for (const s2 of diagSegs(b)) {
          const x = diagSegX(s1[0], s1[1], s2[0], s2[1]);
          if (x && !ports.some((p) => Math.hypot(p.x - x.x, p.y - x.y) < 2))
            hits.push(x);
        }
      if (hits.length)
        found.push({ a: edges[i].id, b: edges[j].id, count: hits.length });
    }
  return found;
}
/* Visible tip-to-border gap at the target, using the application's own
   centralized arrowhead geometry (arrowTrim, markerTipExtent,
   borderExtent): the painted path is trimmed along the final segment and
   the gap measured from the tip to the painted border along the approach. */
function diagArrowGap(edgeId) {
  const e = state.edges[edgeId];
  const r = routeEdge(e);
  if (!r || r.pts.length < 2) return null;
  const d = state.nodes[e.dst];
  if (!e.arrow || e.arrow === "none") return null;
  const p1 = r.pts[r.pts.length - 1],
    p0 = r.pts[r.pts.length - 2];
  const len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const ux = (p0.x - p1.x) / len,
    uy = (p0.y - p1.y) / len;
  const trim = arrowTrim(d, p1, ux, uy, e.sw, len);
  return trim - markerTipExtent(e.sw) - borderExtent(d, p1, ux, uy);
}
`;

function loadFixture(e, fixture) {
  e.run(
    "state.nodes={};state.edges={};state.order=[];state.sel=new Set();history=[];future=[];routeCache.clear();peerBaseline=null;",
  );
  e.run(
    "(function(){const d=validateDocument(JSON.parse(" +
      JSON.stringify(JSON.stringify(fixture.doc)) +
      "));Object.assign(state,d);state.sel=new Set();})()",
  );
  e.run("render();routeAll();");
}

function runInvariants(e, doc) {
  const edges = e.run("Object.keys(state.edges)");
  const problems = [];
  for (const id of edges) {
    const pts = e.run("routeEdge(state.edges[" + JSON.stringify(id) + "]).pts");
    if (!e.run("diagFinite(" + JSON.stringify(pts) + ")"))
      problems.push(id + ": non-finite coordinates");
    if (!e.run("diagNoZero(" + JSON.stringify(pts) + ")"))
      problems.push(id + ": zero-length segment");
    if (!e.run("diagOrthogonal(" + JSON.stringify(pts) + ")"))
      problems.push(id + ": diagonal segment in elbowed route");
    if (!e.run("diagNoReversal(" + JSON.stringify(pts) + ")"))
      problems.push(id + ": reverse-direction backtrack");
    const skip = e.run(
      "JSON.stringify([state.edges[" + JSON.stringify(id) + "].src, state.edges[" + JSON.stringify(id) + "].dst])",
    );
    const hits = e.run("diagInteriorHits(" + JSON.stringify(pts) + "," + skip + ")");
    if (hits.length) problems.push(id + ": passes through " + hits.join(","));
  }
  return problems;
}

module.exports = { CHECKS_SOURCE, loadFixture, runInvariants };
