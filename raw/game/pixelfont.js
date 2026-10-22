// Built-in bitmap fonts for every piece of in-world text (banners, yard numbers, end zones,
// pop-ups, ad boards). Text is rasterized from a 1× glyph mask with fillRect pixels at whole-number
// scales — never canvas fillText — so it sits on the same pixel grid as the sprites (SPEC §6.0).
//   textCanvas(str, scale, color, opts) → cached canvas. color: a CSS color, or an array = per-row
//     color ramp top → bottom (e.g. white → yellow → orange). opts: bold, outline (color),
//     outlineW (buffer px, default = scale), shadow (true | color: drop shadow), shadowD (px),
//     spacing (font px between glyphs), tiny (3×5 font).
//   drawText(ctx, str, x, y, scale, color, opts)   textWidth(str, scale, spacing, bold)
//   drawTextVertical(ctx, str, x, y, scale, color, dir)   rotate90(canvas, dir)

const G = {
  A: "01110,10001,10001,11111,10001,10001,10001", B: "11110,10001,10001,11110,10001,10001,11110",
  C: "01110,10001,10000,10000,10000,10001,01110", D: "11110,10001,10001,10001,10001,10001,11110",
  E: "11111,10000,10000,11110,10000,10000,11111", F: "11111,10000,10000,11110,10000,10000,10000",
  G: "01110,10001,10000,10111,10001,10001,01111", H: "10001,10001,10001,11111,10001,10001,10001",
  I: "01110,00100,00100,00100,00100,00100,01110", J: "00111,00010,00010,00010,00010,10010,01100",
  K: "10001,10010,10100,11000,10100,10010,10001", L: "10000,10000,10000,10000,10000,10000,11111",
  M: "10001,11011,10101,10101,10001,10001,10001", N: "10001,10001,11001,10101,10011,10001,10001",
  O: "01110,10001,10001,10001,10001,10001,01110", P: "11110,10001,10001,11110,10000,10000,10000",
  Q: "01110,10001,10001,10001,10101,10010,01101", R: "11110,10001,10001,11110,10100,10010,10001",
  S: "01111,10000,10000,01110,00001,00001,11110", T: "11111,00100,00100,00100,00100,00100,00100",
  U: "10001,10001,10001,10001,10001,10001,01110", V: "10001,10001,10001,10001,10001,01010,00100",
  W: "10001,10001,10001,10101,10101,10101,01010", X: "10001,10001,01010,00100,01010,10001,10001",
  Y: "10001,10001,10001,01010,00100,00100,00100", Z: "11111,00001,00010,00100,01000,10000,11111",
  0: "01110,10001,10011,10101,11001,10001,01110", 1: "00100,01100,00100,00100,00100,00100,01110",
  2: "01110,10001,00001,00010,00100,01000,11111", 3: "11111,00010,00100,00010,00001,10001,01110",
  4: "00010,00110,01010,10010,11111,00010,00010", 5: "11111,10000,11110,00001,00001,10001,01110",
  6: "00110,01000,10000,11110,10001,10001,01110", 7: "11111,00001,00010,00100,01000,01000,01000",
  8: "01110,10001,10001,01110,10001,10001,01110", 9: "01110,10001,10001,01111,00001,00010,01100",
  "!": "00100,00100,00100,00100,00100,00000,00100", "?": "01110,10001,00001,00010,00100,00000,00100",
  ".": "00000,00000,00000,00000,00000,01100,01100", ",": "00000,00000,00000,00000,01100,00100,01000",
  "-": "00000,00000,00000,11111,00000,00000,00000", "+": "00000,00100,00100,11111,00100,00100,00000",
  "'": "00100,00100,01000,00000,00000,00000,00000", ":": "00000,01100,01100,00000,01100,01100,00000",
  "/": "00001,00001,00010,00100,01000,10000,10000", "&": "01100,10010,10100,01000,10101,10010,01101",
  "<": "00010,00100,01000,10000,01000,00100,00010", ">": "01000,00100,00010,00001,00010,00100,01000",
  "#": "01010,01010,11111,01010,11111,01010,01010", " ": "00000,00000,00000,00000,00000,00000,00000",
  "(": "00010,00100,01000,01000,01000,00100,00010", ")": "01000,00100,00010,00010,00010,00100,01000",
  "%": "11000,11001,00010,00100,01000,10011,00011", "=": "00000,00000,11111,00000,11111,00000,00000",
  "é": "00010,00100,01110,10001,11111,10000,01110", "É": "00010,11111,10000,11110,10000,10000,11111",
  "♀": "01110,10001,10001,01110,00100,01110,00100", "♂": "00111,00011,00101,01110,10010,10010,01100",
  "▲": "00000,00100,01110,11111,00000,00000,00000", "▼": "00000,00000,11111,01110,00100,00000,00000",
  "★": "00100,00100,11111,01110,01110,11011,10001", "·": "00000,00000,00000,01100,01100,00000,00000",
  "@": "01110,10001,10111,10101,10111,10000,01110", "_": "00000,00000,00000,00000,00000,00000,11111",
  // a PlayStation pad's face buttons (the receiver boxes) and a few more keys a receiver can be bound to
  "\u2715": "00000,10001,01010,00100,01010,10001,00000", "\u25cb": "00000,01110,10001,10001,10001,01110,00000",
  "\u25a1": "00000,11111,10001,10001,10001,11111,00000", "\u25b3": "00000,00100,01010,01010,10001,11111,00000",
  ";": "00000,01100,01100,00000,01100,00100,01000", "[": "01110,01000,01000,01000,01000,01000,01110",
  "]": "01110,00010,00010,00010,00010,00010,01110", "`": "01000,00100,00000,00000,00000,00000,00000",
  "\\": "10000,10000,01000,00100,00010,00001,00001", "*": "00000,10101,01110,11111,01110,10101,00000",
};
// Compact 3×5 font for ad boards, the down marker and other tiny labels.
const T = {
  A: "010,101,111,101,101", B: "110,101,110,101,110", C: "011,100,100,100,011", D: "110,101,101,101,110",
  E: "111,100,110,100,111", F: "111,100,110,100,100", G: "011,100,101,101,011", H: "101,101,111,101,101",
  I: "111,010,010,010,111", J: "001,001,001,101,010", K: "101,110,100,110,101", L: "100,100,100,100,111",
  M: "101,111,111,101,101", N: "110,101,101,101,101", O: "010,101,101,101,010", P: "110,101,110,100,100",
  Q: "010,101,101,110,011", R: "110,101,110,101,101", S: "011,100,010,001,110", T: "111,010,010,010,010",
  U: "101,101,101,101,111", V: "101,101,101,101,010", W: "101,101,111,111,101", X: "101,101,010,101,101",
  Y: "101,101,010,010,010", Z: "111,001,010,100,111",
  0: "111,101,101,101,111", 1: "010,110,010,010,111", 2: "110,001,010,100,111", 3: "110,001,010,001,110",
  4: "101,101,111,001,001", 5: "111,100,110,001,110", 6: "011,100,111,101,111", 7: "111,001,010,010,010",
  8: "111,101,111,101,111", 9: "111,101,111,001,110",
  ".": "000,000,000,000,010", "-": "000,000,111,000,000", "!": "010,010,010,000,010", "'": "010,010,000,000,000",
  "&": "010,101,010,101,011", " ": "000,000,000,000,000", "é": "001,010,111,110,011", "É": "001,111,110,100,111",
  ":": "000,010,000,010,000", "/": "001,001,010,100,100", "+": "000,010,111,010,000", "?": "110,001,010,000,010",
  "♀": "010,101,010,111,010", "♂": "011,001,110,101,010", "#": "101,111,101,111,101",
};
const parse = (src, w) => {
  const out = {};
  for (const k in src) out[k] = src[k].split(",").map((r) => [...r].map((c) => c === "1"));
  out.__w = w;
  return out;
};
const BIG = parse(G, 5);
const TINY = parse(T, 3);

export const FONT_W = 5;
export const FONT_H = 7;
export const TINY_W = 3;
export const TINY_H = 5;

function glyphOf(font, ch) {
  return font[ch] || font[ch.toUpperCase()] || font[ch.normalize ? ch.normalize("NFD")[0].toUpperCase() : ch] || font["?"];
}
function prep(str) {
  // the bitmap fonts are upper case (é kept for POKéMON)
  let s = "";
  for (const ch of String(str)) s += ch === "é" || ch === "♀" || ch === "♂" ? ch : ch.toUpperCase();
  return s;
}

// Width in buffer px of a string at `scale` (spacing in font px; bold glyphs are 1 font px wider).
export function textWidth(str, scale = 1, spacing = 1, bold = false, tiny = false) {
  const n = [...String(str)].length;
  const gw = (tiny ? TINY_W : FONT_W) + (bold ? 1 : 0);
  return n ? (n * (gw + spacing) - spacing) * scale : 0;
}

// 1× mask of a string: Uint8Array w×h.
const MASKS = new Map();
function mask(str, bold, spacing, tiny) {
  const key = (tiny ? "t" : "b") + (bold ? 1 : 0) + spacing + "|" + str;
  let m = MASKS.get(key);
  if (m) return m;
  const font = tiny ? TINY : BIG;
  const gw = font.__w, gh = tiny ? TINY_H : FONT_H;
  const chars = [...str];
  const adv = gw + (bold ? 1 : 0) + spacing;
  const w = Math.max(1, chars.length * adv - spacing);
  const data = new Uint8Array(w * gh);
  chars.forEach((ch, i) => {
    const g = glyphOf(font, ch);
    for (let r = 0; r < gh; r++) {
      for (let c = 0; c < gw; c++) {
        if (!g[r][c]) continue;
        const x = i * adv + c;
        data[r * w + x] = 1;
        if (bold && x + 1 < w) data[r * w + x + 1] = 1;
      }
    }
  });
  m = { data, w, h: gh };
  if (MASKS.size > 600) MASKS.clear();
  MASKS.set(key, m);
  return m;
}

// Paints the mask at (x, y) with whole-pixel scale. color: string or per-row ramp array.
function paintMask(ctx, m, x, y, s, color) {
  const ramp = Array.isArray(color) ? color : null;
  if (!ramp) ctx.fillStyle = color;
  for (let r = 0; r < m.h; r++) {
    if (ramp) ctx.fillStyle = ramp[Math.min(ramp.length - 1, Math.floor((r * ramp.length) / m.h))];
    const row = r * m.w;
    let c = 0;
    while (c < m.w) {
      if (!m.data[row + c]) { c++; continue; }
      let e = c;
      while (e < m.w && m.data[row + e]) e++;
      ctx.fillRect(x + c * s, y + r * s, (e - c) * s, s);
      c = e;
    }
  }
}
// Outline ring: the mask stamped in 8 directions at distance o (buffer px).
function paintRing(ctx, m, x, y, s, o, color) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) paintMask(ctx, m, x + dx * o, y + dy * o, s, color);
}

// Draws text with its top-left glyph pixel at (x, y). See the header for options.
export function drawText(ctx, str, x, y, scale, color, opts = {}) {
  x = Math.round(x);
  y = Math.round(y);
  const s = Math.max(1, scale | 0);
  const up = prep(str);
  const m = mask(up, !!opts.bold, opts.spacing ?? 1, !!opts.tiny);
  const o = opts.outline ? Math.max(1, opts.outlineW ?? s) : 0;
  if (opts.shadow) {
    const d = opts.shadowD ?? s;
    const sc = typeof opts.shadow === "string" ? opts.shadow : opts.outline || "#0b0d14";
    if (o) paintRing(ctx, m, x + d, y + d, s, o, sc);
    paintMask(ctx, m, x + d, y + d, s, sc);
  }
  if (o) paintRing(ctx, m, x, y, s, o, opts.outline);
  let col = color;
  if (!Array.isArray(color) && opts.lower) col = [color, color, color, color, opts.lower, opts.lower, opts.lower];
  paintMask(ctx, m, x, y, s, col);
  if (opts.shine && !Array.isArray(color)) {
    ctx.fillStyle = opts.shine;
    for (let c = 0; c < m.w; c++) if (m.data[c]) ctx.fillRect(x + c * s, y, s, Math.max(1, s >> 1));
  }
}

// Pre-renders text into its own (cached) canvas, padded for the outline and shadow.
const CANVASES = new Map();
export function textCanvas(str, scale, color, opts = {}) {
  const s = Math.max(1, scale | 0);
  const key = `${str}|${s}|${Array.isArray(color) ? color.join(",") : color}|${opts.bold ? 1 : 0}|${opts.outline || ""}|${opts.outlineW ?? ""}|${opts.shadow || ""}|${opts.shadowD ?? ""}|${opts.spacing ?? 1}|${opts.tiny ? 1 : 0}|${opts.lower || ""}|${opts.shine || ""}`;
  let c = CANVASES.get(key);
  if (c) return c;
  const up = prep(str);
  const m = mask(up, !!opts.bold, opts.spacing ?? 1, !!opts.tiny);
  const o = opts.outline ? Math.max(1, opts.outlineW ?? s) : 0;
  const d = opts.shadow ? opts.shadowD ?? s : 0;
  c = document.createElement("canvas");
  c.width = m.w * s + o * 2 + d;
  c.height = m.h * s + o * 2 + d;
  drawText(c.getContext("2d"), str, o, o, s, color, opts);
  if (CANVASES.size > 500) CANVASES.clear();
  CANVASES.set(key, c);
  return c;
}

// Text rotated 90° (reads bottom-to-top when dir = -1, top-to-bottom when dir = 1), for end zones.
export function drawTextVertical(ctx, str, x, y, scale, color, dir = -1) {
  const up = prep(str);
  ctx.fillStyle = color;
  let cy = y;
  for (const ch of up) {
    const g = glyphOf(BIG, ch);
    for (let r = 0; r < FONT_H; r++) {
      for (let c = 0; c < FONT_W; c++) {
        if (!g[r][c]) continue;
        if (dir < 0) ctx.fillRect(x + r * scale, cy - c * scale - scale, scale, scale);
        else ctx.fillRect(x + (FONT_H - 1 - r) * scale, cy + c * scale, scale, scale);
      }
    }
    cy += dir * (FONT_W + 1) * scale;
  }
}

// Rotates a canvas by exactly 90° (dir = 1 clockwise, -1 counter-clockwise): pixel-exact.
export function rotate90(src, dir = 1) {
  const w = src.width, h = src.height;
  const c = document.createElement("canvas");
  c.width = h;
  c.height = w;
  const sd = src.getContext("2d").getImageData(0, 0, w, h);
  const g = c.getContext("2d");
  const od = g.createImageData(h, w);
  const s32 = new Uint32Array(sd.data.buffer), o32 = new Uint32Array(od.data.buffer);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // clockwise: (x, y) → (h-1-y, x); counter-clockwise: (x, y) → (y, w-1-x)
      const nx = dir > 0 ? h - 1 - y : y, ny = dir > 0 ? x : w - 1 - x;
      o32[ny * h + nx] = s32[y * w + x];
    }
  }
  g.putImageData(od, 0, 0);
  return c;
}
