/* Q01: the one PNG reader shared by every verification runner.
 *
 * The pass-3 runners each carried a copy of a decoder whose Paeth
 * predictor computed the distance to the left pixel twice:
 *     pc = Math.abs(a + c - 2 * b)          // wrong (that is a + c - 2b)
 *     pc = Math.abs(a + b - 2 * c)          // correct per PNG spec
 * so any image whose Paeth rows actually used the c predictor decoded
 * wrongly and every pixel statistic built on it was untrustworthy.
 *
 * This module implements the spec predictor with the standard tie-break
 * (pa <= pb && pa <= pc -> a, else pb <= pc -> b, else c), validates the
 * subset of PNG that the runners may encounter, and fails loudly on
 * anything outside it instead of silently returning wrong pixels.
 */
const zlib = require("node:zlib");
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngDecode(buf) {
  if (!buf || !buf.subarray || !buf.subarray(0, 8).equals(PNG_SIG))
    throw new Error("not a PNG");
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let seenIHDR = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
      seenIHDR = true;
    } else if (type === "IDAT") idat.push(data);
    off += 12 + len;
    if (type === "IEND") break;
  }
  if (!seenIHDR) throw new Error("PNG has no IHDR");
  if (bitDepth !== 8)
    throw new Error("unsupported PNG bit depth " + bitDepth);
  if (colorType !== 6 && colorType !== 2)
    throw new Error("unsupported PNG color type " + colorType);
  if (interlace !== 0)
    throw new Error("unsupported PNG interlace method " + interlace);
  if (!w || !h) throw new Error("PNG has no pixels");
  if (!idat.length) throw new Error("PNG has no image data");
  const bpp = colorType === 6 ? 4 : 3;
  const stride = w * bpp;
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch (e) {
    throw new Error("PNG image data does not inflate");
  }
  if (raw.length < h * (stride + 1))
    throw new Error(
      "PNG scanline data truncated (" + raw.length + " < " + h * (stride + 1) + ")",
    );
  const px = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    if (filter > 4) throw new Error("invalid PNG filter type " + filter);
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(b - c),
          pb = Math.abs(a - c),
          pc = Math.abs(a + b - 2 * c); /* Q01: was a + c - 2 * b */
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
    prev.set(cur);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, i = x * bpp;
      px[o] = cur[i];
      px[o + 1] = cur[i + 1];
      px[o + 2] = cur[i + 2];
      px[o + 3] = bpp === 4 ? cur[i + 3] : 255;
    }
  }
  return { w, h, px };
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/* Encode an RGBA pixel buffer as a plain (filter 0) truecolor+alpha PNG. */
function pngEncode(w, h, px) {
  const stride = w * 4;
  const rawBuf = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    rawBuf[y * (stride + 1)] = 0;
    Buffer.from(px.buffer, y * w * 4, stride).copy(rawBuf, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rawBuf, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* Q01 test support: encode explicit scanlines with per-row filter types.
 * `rows` is an array of { filter, bytes } where `bytes` are the DECODED
 * (reconstructed) scanline bytes; the forward filter transform derives the
 * stored bytes. colorType: 2 = RGB, 6 = RGBA. */
function pngEncodeRows(w, h, colorType, rows) {
  const bpp = colorType === 6 ? 4 : 3;
  const stride = w * bpp;
  const parts = [];
  const recon = [];
  for (let y = 0; y < h; y++) {
    const target = Buffer.from(rows[y].bytes);
    if (target.length !== stride)
      throw new Error("scanline " + y + " must be " + stride + " bytes");
    recon.push(target);
    const f = rows[y].filter;
    if (f > 4) throw new Error("invalid filter " + f);
    const stored = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? recon[y][x - bpp] : 0;
      const b = y > 0 ? recon[y - 1][x] : 0;
      const c = x >= bpp && y > 0 ? recon[y - 1][x - bpp] : 0;
      let d;
      if (f === 0) d = 0;
      else if (f === 1) d = a;
      else if (f === 2) d = b;
      else if (f === 3) d = (a + b) >> 1;
      else {
        const pa = Math.abs(b - c),
          pb = Math.abs(a - c),
          pc = Math.abs(a + b - 2 * c);
        d = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      stored[x] = (target[x] - d) & 255;
    }
    parts.push(Buffer.concat([Buffer.from([f]), stored]));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(parts))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = { pngDecode, pngEncode, pngEncodeRows, crc32, PNG_SIG };
