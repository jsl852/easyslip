import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "static");
const PAPER = [243, 239, 228];
const CARD = [255, 253, 248];
const TEAL = [15, 95, 90];
const INK = [28, 25, 21];
const FOLD = [228, 242, 240];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const start = y * (size * 4 + 1);
    raw[start] = 0;
    rgba.copy(raw, start + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function shade(mode, x, y) {
  const bg = mode === "maskable" ? TEAL : PAPER;
  const box = mode === "maskable" ? { x: 0.3, y: 0.22, w: 0.4, h: 0.56 } : { x: 0.2, y: 0.12, w: 0.6, h: 0.76 };
  const stroke = mode === "maskable" ? PAPER : TEAL;
  if (x < box.x || y < box.y || x > box.x + box.w || y > box.y + box.h) return bg;
  const fold = box.w * 0.22;
  const right = box.x + box.w;
  const fx = x - (right - fold);
  const fy = y - box.y;
  if (fx > 0 && fy > 0 && fx + fy < fold) return FOLD;
  const localX = x - box.x;
  const localY = y - box.y;
  const weight = 0.015;
  if (localX < weight || localY < weight || box.w - localX < weight || box.h - localY < weight) return stroke;
  if (fx > 0 && fy > 0 && Math.abs(fx + fy - fold) < weight) return stroke;
  for (const ly of [0.42, 0.55, 0.68]) {
    const lineY = box.y + box.h * ly;
    const lineRight = ly === 0.68 ? box.x + box.w * 0.72 : box.x + box.w * 0.82;
    if (Math.abs(y - lineY) < 0.01 && x > box.x + box.w * 0.16 && x < lineRight) return INK;
  }
  return CARD;
}

function render(size, mode) {
  const sample = size * 2;
  const big = Buffer.alloc(sample * sample * 4);
  for (let y = 0; y < sample; y++) {
    for (let x = 0; x < sample; x++) {
      const color = shade(mode, (x + 0.5) / sample, (y + 0.5) / sample);
      const i = (y * sample + x) * 4;
      big[i] = color[0];
      big[i + 1] = color[1];
      big[i + 2] = color[2];
      big[i + 3] = 255;
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = ((y * 2 + dy) * sample + (x * 2 + dx)) * 4;
          r += big[i];
          g += big[i + 1];
          b += big[i + 2];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / 4);
      out[o + 1] = Math.round(g / 4);
      out[o + 2] = Math.round(b / 4);
      out[o + 3] = 255;
    }
  }
  const corner = mode === "maskable" ? TEAL : PAPER;
  const center = out.slice((Math.floor(size / 2) * size + Math.floor(size / 2)) * 4);
  if (center[0] < 240) throw new Error(`${mode} center is not the receipt`);
  const edge = out.slice(0, 4);
  if (edge[0] !== corner[0] || edge[1] !== corner[1]) throw new Error(`${mode} background missed the corner`);
  return out;
}

function write(name, size, mode) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(size, render(size, mode)));
  console.log(path);
}

write("icons/icon-192.png", 192, "any");
write("icons/icon-512.png", 512, "any");
write("icons/icon-maskable-192.png", 192, "maskable");
write("icons/icon-maskable-512.png", 512, "maskable");
write("icons/apple-touch-icon.png", 180, "any");
write("apple-touch-icon.png", 180, "any");
