#!/usr/bin/env node
// Draws the Termwise mark (docs/DESIGN.md neo-brutalist style) and writes every app icon and
// splash image app.json points at. Dependency-free: geometric shapes, 3x3 supersampling, and a
// tiny PNG encoder on node:zlib. Re-run after changing the mark:  node scripts/generate-icons.mjs
//
// The mark: a yellow planner page, tilted like the TERMWISE wordmark stamp, with a blue header
// band, two binder rings, a bold check, a thick ink border and a hard offset shadow, and the
// wordmark's pink tab tucked behind it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'images');

// ---- colors (src/theme/tokens.ts) ------------------------------------------------------------

const hex = (value) => {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};
const CLEAR = [0, 0, 0, 0];
const LIGHT = {
  bg: hex('#FFF4DE'),
  ink: hex('#111111'),
  shadow: hex('#111111'),
  onAccent: hex('#111111'),
  yellow: hex('#FFD23F'),
  pink: hex('#FF6B9D'),
  blue: hex('#4D96FF'),
};
// Dark mode keeps the black shadow and lets a light border carry the edge; text on accents stays dark.
const DARK = { ...LIGHT, bg: hex('#141414'), ink: hex('#F4F1EA'), shadow: hex('#000000') };

// ---- geometry (mark space: the page is 560 wide, centered on 0,0) ------------------------------

const PAGE = 560;
const BORDER = 32;
const RADIUS = 44;
const SHADOW = 36;
const TAB = 300;

const rad = (deg) => (deg * Math.PI) / 180;
const page = { cx: 0, cy: 0, angle: rad(-4) };
const tab = { cx: -200, cy: -200, angle: rad(8) };
const shifted = (frame, by) => ({ ...frame, dx: by, dy: by });

const rrect = (frame, w, h, r, color, y = 0, x = 0) => ({ kind: 'rrect', frame, w, h, r, x, y, color });
const capsule = (frame, ax, ay, bx, by, r, color) => ({ kind: 'capsule', frame, ax, ay, bx, by, r, color });

/** Back to front. `cut` paints transparency (the monochrome icon's cut-outs). */
function markShapes(c, { mono = false } = {}) {
  const inner = PAGE - BORDER * 2;
  const top = -inner / 2;
  const bandBottom = top + 130;
  const check = [
    [-145, 75],
    [-40, 175],
    [160, -20],
  ];
  const strokes = (color) => [
    capsule(page, ...check[0], ...check[1], 40, color),
    capsule(page, ...check[1], ...check[2], 40, color),
  ];
  const rings = (color) => [-140, 140].map((x) => rrect(page, 56, 140, 28, color, -PAGE / 2, x));

  if (mono) {
    const solid = [255, 255, 255, 255];
    return [
      rrect(page, PAGE, PAGE, RADIUS, solid),
      rrect(page, inner, 28, 0, CLEAR, bandBottom + 2),
      ...strokes(CLEAR),
      ...rings(solid),
    ];
  }
  return [
    rrect(shifted(tab, 24), TAB, TAB, 0, c.shadow),
    rrect(tab, TAB, TAB, 0, c.ink),
    rrect(tab, TAB - 56, TAB - 56, 0, c.pink),
    rrect(shifted(page, SHADOW), PAGE, PAGE, RADIUS, c.shadow),
    rrect(page, PAGE, PAGE, RADIUS, c.ink),
    rrect(page, inner, inner, RADIUS - BORDER, c.yellow),
    // Header band; its rounded bottom corners hide under the divider.
    rrect(page, inner, 142, RADIUS - BORDER, c.blue, top + 71),
    rrect(page, inner, 28, 0, c.ink, bandBottom + 2),
    ...rings(c.ink),
    ...strokes(c.onAccent),
  ];
}

// ---- rasterizer --------------------------------------------------------------------------------

function toLocal(frame, px, py) {
  const x = px - frame.cx - (frame.dx ?? 0);
  const y = py - frame.cy - (frame.dy ?? 0);
  const cos = Math.cos(-frame.angle);
  const sin = Math.sin(-frame.angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

function inside(shape, px, py) {
  const [lx, ly] = toLocal(shape.frame, px, py);
  if (shape.kind === 'rrect') {
    const qx = Math.abs(lx - shape.x) - shape.w / 2 + shape.r;
    const qy = Math.abs(ly - shape.y) - shape.h / 2 + shape.r;
    const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
    return outside + Math.min(Math.max(qx, qy), 0) - shape.r <= 0;
  }
  const vx = shape.bx - shape.ax;
  const vy = shape.by - shape.ay;
  const t = Math.max(0, Math.min(1, ((lx - shape.ax) * vx + (ly - shape.ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(lx - shape.ax - t * vx, ly - shape.ay - t * vy) <= shape.r;
}

/** Mark-space bounding box of a shape (corners of its local box, rotated and shifted). */
function bounds(shape) {
  const { frame } = shape;
  const pad = shape.kind === 'capsule' ? shape.r : 0;
  const xs = shape.kind === 'rrect' ? [shape.x - shape.w / 2, shape.x + shape.w / 2] : [Math.min(shape.ax, shape.bx) - pad, Math.max(shape.ax, shape.bx) + pad];
  const ys = shape.kind === 'rrect' ? [shape.y - shape.h / 2, shape.y + shape.h / 2] : [Math.min(shape.ay, shape.by) - pad, Math.max(shape.ay, shape.by) + pad];
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  const points = xs.flatMap((x) => ys.map((y) => [x * cos - y * sin + frame.cx + (frame.dx ?? 0), x * sin + y * cos + frame.cy + (frame.dy ?? 0)]));
  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}

function unionBounds(shapes) {
  const all = shapes.filter((shape) => shape.color[3] > 0).map(bounds);
  return {
    minX: Math.min(...all.map((b) => b.minX)),
    maxX: Math.max(...all.map((b) => b.maxX)),
    minY: Math.min(...all.map((b) => b.minY)),
    maxY: Math.max(...all.map((b) => b.maxY)),
  };
}

const SAMPLES = 3;

/**
 * Renders `shapes` into a size x size RGBA buffer: the mark is centered and scaled so its widest
 * side spans `fill` of the canvas. `background` null = transparent.
 */
function render(size, shapes, { fill, background }) {
  const box = unionBounds(shapes);
  const scale = (fill * size) / Math.max(box.maxX - box.minX, box.maxY - box.minY);
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;
  const toMark = (p) => [(p[0] - size / 2) / scale + midX, (p[1] - size / 2) / scale + midY];
  const pixelBoxes = shapes.map((shape) => {
    const b = bounds(shape);
    return {
      minX: (b.minX - midX) * scale + size / 2 - 1,
      maxX: (b.maxX - midX) * scale + size / 2 + 1,
      minY: (b.minY - midY) * scale + size / 2 - 1,
      maxY: (b.maxY - midY) * scale + size / 2 + 1,
    };
  });
  const base = background ?? CLEAR;
  const out = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const nearby = [];
      for (let i = shapes.length - 1; i >= 0; i -= 1) {
        const b = pixelBoxes[i];
        if (px + 1 >= b.minX && px <= b.maxX && py + 1 >= b.minY && py <= b.maxY) nearby.push(shapes[i]);
      }
      // Premultiplied sum over the subsamples (topmost shape that covers a sample wins).
      let r = 0;
      let g = 0;
      let bl = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const [mx, my] = toMark([px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES]);
          const hit = nearby.find((shape) => inside(shape, mx, my));
          const color = hit ? hit.color : base;
          const alpha = color[3] / 255;
          r += color[0] * alpha;
          g += color[1] * alpha;
          bl += color[2] * alpha;
          a += alpha;
        }
      }
      const at = (py * size + px) * 4;
      const n = SAMPLES * SAMPLES;
      if (a > 0) {
        out[at] = Math.round(r / a);
        out[at + 1] = Math.round(g / a);
        out[at + 2] = Math.round(bl / a);
      }
      out[at + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

function solid(size, color) {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < out.length; i += 4) out.set(color, i);
  return out;
}

// ---- PNG ----------------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** RGBA buffer -> PNG. `opaque` drops the alpha channel (color type 2), as iOS wants for icons. */
function png(size, rgba, { opaque = false } = {}) {
  const channels = opaque ? 3 : 4;
  const rows = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * channels + 1);
    rows[row] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      const from = (y * size + x) * 4;
      const to = row + 1 + x * channels;
      for (let c = 0; c < channels; c += 1) rows[to + c] = rgba[from + c];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = opaque ? 2 : 6; // truecolor / truecolor + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- outputs ------------------------------------------------------------------------------------

// Android adaptive icons: launchers mask the 108 dp layer to as little as a 66 dp circle, so the
// whole mark (shadow corners included) stays inside that circle.
const ADAPTIVE_FILL = 0.45;

const outputs = [
  // iOS app icon: full bleed, no transparency (iOS rounds the corners itself).
  { file: 'icon.png', size: 1024, opaque: true, pixels: () => render(1024, markShapes(LIGHT), { fill: 0.72, background: LIGHT.bg }) },
  { file: 'favicon.png', size: 48, opaque: true, pixels: () => render(48, markShapes(LIGHT), { fill: 0.8, background: LIGHT.bg }) },
  // Splash images sit on the splash backgroundColor (#FFF4DE light, #141414 dark).
  { file: 'splash-icon.png', size: 1024, pixels: () => render(1024, markShapes(LIGHT), { fill: 0.92, background: null }) },
  { file: 'splash-icon-dark.png', size: 1024, pixels: () => render(1024, markShapes(DARK), { fill: 0.92, background: null }) },
  { file: 'android-icon-foreground.png', size: 1024, pixels: () => render(1024, markShapes(LIGHT), { fill: ADAPTIVE_FILL, background: null }) },
  { file: 'android-icon-background.png', size: 1024, opaque: true, pixels: () => solid(1024, LIGHT.bg) },
  { file: 'android-icon-monochrome.png', size: 1024, pixels: () => render(1024, markShapes(LIGHT, { mono: true }), { fill: ADAPTIVE_FILL, background: null }) },
];

mkdirSync(OUT, { recursive: true });
for (const output of outputs) {
  const started = Date.now();
  const data = png(output.size, output.pixels(), { opaque: output.opaque });
  writeFileSync(join(OUT, output.file), data);
  console.log(`${output.file}  ${output.size}x${output.size}  ${(data.length / 1024).toFixed(1)} KB  ${Date.now() - started} ms`);
}
