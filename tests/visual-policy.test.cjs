/* V01: the visual comparison policy is exercised through REAL PNG bytes:
 * comparator -> typed outcome -> judgment -> classification. A synthetic
 * status the production code never emits is not regression coverage. */
const { test } = require("node:test");
const assert = require("node:assert/strict");

test("V01: the typed comparison policy judged real PNG bytes", async () => {
  const policy = await import("../visual-policy.mjs");
  const { pngEncode } = await import("../tests/png.cjs");
  const { comparePixels, judgeMutationControl, judgeRestoration, classify } =
    policy;
  const fill = (w, h, rgba) => {
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < px.length; i += 4) px.set(rgba, i);
    return px;
  };
  const WHITE = [255, 255, 255, 255];
  const RED = [255, 0, 0, 255];
  const png = (w, h, rgba) => pngEncode(w, h, fill(w, h, rgba));

  /* The exact plan reproduction: two opaque-white PNGs of sizes 1x1 and
     2x1. The production mapping must NOT turn a screenshot size error
     into a successful paint-change detection. */
  const dim = comparePixels("t", png(1, 1, WHITE), png(2, 1, WHITE));
  assert.equal(dim.status, "dimension-mismatch");
  assert.equal(judgeMutationControl(dim), false);
  assert.equal(judgeRestoration(dim), false);
  assert.equal(classify(dim), "fail");

  const bytes = png(3, 2, WHITE);
  const match = comparePixels("t", bytes, bytes);
  assert.equal(match.status, "match");
  assert.equal(judgeMutationControl(match), false);
  assert.equal(judgeRestoration(match), true);
  assert.equal(classify(match), "pass");

  const mixed = new Uint8Array(fill(2, 1, WHITE));
  mixed.set(RED, 4);
  const detect = comparePixels("t", pngEncode(2, 1, mixed), png(2, 1, WHITE));
  assert.equal(detect.status, "pixel-mismatch");
  assert.ok(detect.bad >= 1 && detect.total === 2, "valid counts");
  assert.equal(judgeMutationControl(detect), true);
  assert.equal(judgeRestoration(detect), false);
  assert.equal(classify(detect), "fail");

  const bad = comparePixels("t", new Uint8Array([1, 2, 3]), png(1, 1, WHITE));
  assert.equal(bad.status, "decode-failure");
  assert.equal(judgeMutationControl(bad), false);
  assert.equal(judgeRestoration(bad), false);
  assert.equal(classify(bad), "fail");

  assert.equal(judgeMutationControl({ status: "missing-candidate" }), false);
  assert.equal(judgeMutationControl({ status: "pending" }), false);
  assert.equal(judgeRestoration({ status: "pending" }), true);
  assert.equal(classify({ status: "missing-candidate" }), "fail");
  assert.equal(classify({ status: "pending" }), "pending");
});
