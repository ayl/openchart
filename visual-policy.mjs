/* V01: the shared, testable visual-comparison policy.
 *
 * Every comparator outcome is TYPED and preserved through every adapter:
 *
 *   match             same dimensions, within tolerance
 *   pixel-mismatch    same dimensions, meaningful decoded-pixel difference
 *                     with valid counts
 *   dimension-mismatch  the two images have different sizes
 *   decode-failure    the PNG bytes could not be decoded
 *   missing-candidate  the runner never captured the artifact (runner error)
 *   pending           no approved baseline yet (review flow, not a pass)
 *
 * A paint-control succeeds ONLY on a meaningful same-size decoded-pixel
 * mismatch with valid counts. Missing, invalid, or differently sized
 * artifacts NEVER count as successful paint detection.
 */
import { pngDecode, pngEncode } from "./tests/png.cjs";

/* Documented tolerance: a pixel matches when every channel differs by at
 * most TOL; at most MAX_BAD_FRACTION of all pixels may mismatch
 * (anti-aliasing and GPU dithering wiggle). */
export const TOL = 16;
export const MAX_BAD_FRACTION = 0.0005;

/* Compare two PNG byte buffers. The result carries a typed status; "ok" is
 * kept for legacy callers that only need a boolean. */
export function comparePixels(name, candBuf, baseBuf, maskRects = []) {
  let cand, base;
  try {
    cand = pngDecode(candBuf);
    base = pngDecode(baseBuf);
  } catch (e) {
    return {
      status: "decode-failure",
      ok: false,
      reason:
        "PNG decode failed: " +
        (e && e.message ? e.message : String(e)),
    };
  }
  if (cand.w !== base.w || cand.h !== base.h) {
    return {
      status: "dimension-mismatch",
      ok: false,
      reason:
        "size differs: candidate " +
        cand.w +
        "x" +
        cand.h +
        " vs reference " +
        base.w +
        "x" +
        base.h,
    };
  }
  const applyMask = (img) => {
    for (const m of maskRects)
      for (let y = Math.max(0, m.y); y < Math.min(img.h, m.y + m.h); y++)
        for (let x = Math.max(0, m.x); x < Math.min(img.w, m.x + m.w); x++)
          img.px.fill(0, (y * img.w + x) * 4, (y * img.w + x) * 4 + 4);
  };
  applyMask(cand);
  applyMask(base);
  let bad = 0;
  const diff = new Uint8Array(cand.px.length);
  for (let i = 0; i < cand.px.length; i += 4) {
    const d = Math.max(
      Math.abs(cand.px[i] - base.px[i]),
      Math.abs(cand.px[i + 1] - base.px[i + 1]),
      Math.abs(cand.px[i + 2] - base.px[i + 2]),
    );
    if (d > TOL) {
      bad++;
      diff[i] = 255;
      diff[i + 1] = 0;
      diff[i + 2] = 0;
      diff[i + 3] = 255;
    } else {
      diff[i] = cand.px[i];
      diff[i + 1] = cand.px[i + 1];
      diff[i + 2] = cand.px[i + 2];
      diff[i + 3] = 255;
    }
  }
  const total = cand.w * cand.h;
  const frac = bad / total;
  const ok = frac <= MAX_BAD_FRACTION;
  return {
    status: ok ? "match" : "pixel-mismatch",
    ok,
    reason: ok
      ? ""
      : bad +
        "/" +
        total +
        " pixels (" +
        (frac * 100).toFixed(4) +
        "%) exceed tolerance",
    bad,
    total,
    diffPng: pngEncode(cand.w, cand.h, diff),
  };
}

/* Pure policy: a mutation control passes only when the compare actually
 * detected an injected change - a meaningful same-size pixel mismatch with
 * valid counts. Anything else (match, dimension-mismatch, decode-failure,
 * missing, pending) fails the control. */
export function judgeMutationControl(cmp) {
  return (
    cmp.status === "pixel-mismatch" &&
    Number.isFinite(cmp.bad) &&
    cmp.bad >= 0 &&
    Number.isFinite(cmp.total) &&
    cmp.total > 0
  );
}

/* Pure policy: a restoration proof passes on a positive match or on a
 * pending baseline (the review flow); every other outcome - including a
 * dimension mismatch or a decode failure - is a HARD failure. */
export function judgeRestoration(cmp) {
  return cmp.status === "match" || cmp.status === "pending";
}

/* Classification for the exit/approval contract. */
export function classify(r) {
  if (r.status === "pass" || r.status === "match") return "pass";
  if (r.status === "pending") return "pending";
  return "fail"; /* includes missing-candidate: a broken run is an error */
}
