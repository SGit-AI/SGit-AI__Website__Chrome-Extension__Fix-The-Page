#!/usr/bin/env node
// Draws the extension's icons (16, 48, 128) as PNGs, with no dependencies: a rounded teal square and a
// white "T" for title. Run: node admin/build/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'extension', 'icons');

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

// Coverage of a pixel by a shape, sampled 4x4, for soft edges.
function coverage(x, y, inside) {
  let n = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside(x + (i + .5) / 4, y + (j + .5) / 4)) n++;
  return n / 16;
}
function roundedSquare(size) {
  const r = size * 0.22, lo = size * 0.04, hi = size * 0.96;
  return (px, py) => {
    if (px < lo || px > hi || py < lo || py > hi) return false;
    const cx = px < lo + r ? lo + r : px > hi - r ? hi - r : px;
    const cy = py < lo + r ? lo + r : py > hi - r ? hi - r : py;
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };
}
function glyphT(size) {
  const barTop = size * 0.26, barBot = size * 0.40, barL = size * 0.24, barR = size * 0.76;
  const stemL = size * 0.43, stemR = size * 0.57, stemBot = size * 0.78;
  return (px, py) => (py >= barTop && py <= barBot && px >= barL && px <= barR) || (py >= barTop && py <= stemBot && px >= stemL && px <= stemR);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [16, 48, 128]) {
  const sq = roundedSquare(size), t = glyphT(size);
  const buf = png(size, (x, y) => {
    const a = coverage(x, y, sq);
    if (a === 0) return [0, 0, 0, 0];
    const g = coverage(x, y, t);
    // teal #115e59 under, white glyph over
    const r = Math.round(0x11 + (255 - 0x11) * g), gg = Math.round(0x5e + (255 - 0x5e) * g), b = Math.round(0x59 + (255 - 0x59) * g);
    return [r, gg, b, Math.round(a * 255)];
  });
  fs.writeFileSync(path.join(OUT, `${size}.png`), buf);
  console.log(`icons: wrote ${size}.png (${buf.length} bytes)`);
}
