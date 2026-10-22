// Pixel art for the DOM UI (UI team): type emblems, stars, the football, HUD icons, the animated
// title logo, the octagonal play-clock ring, sprite thumbnails and the help diagrams.
// Everything is drawn 1:1 into small canvases (fillRect only) and shown with image-rendering:
// pixelated at a WHOLE number of device pixels per art pixel (crisp on every devicePixelRatio).
//
// Exports other modules may reuse (modes team: draft cards, badges...):
//   crispScale(artPx, cssTarget) → CSS px per art px (integer device px), dpr()
//   iconURL(name) / iconImg(name, cssTarget, cls)   names: star, starOff, ball, sound, mute, pause,
//                                                   arrowR, arrowL, check, lock, and every type below
//   typeIcon(type, cssTarget) → <img> emblem for a Pokémon type ("fire", "water", ...)
//   TYPE_COLORS, spriteEl(id, cssTarget, cls) (crisp sprite <img>/<canvas>), drawRing(cv, frac, hot)
//   Logo (animated title logo canvas), padArt(), touchArt()
import { drawText } from "./pixelfont.js";

const INK = "#0b0d14";

export const dpr = () => Math.min(3, Math.max(1, window.devicePixelRatio || 1));
// CSS px per art px so one art px is a whole number of device px, as close to cssTarget/artPx as allowed.
export function crispScale(artPx, cssTarget) {
  const d = dpr();
  const m = Math.max(1, Math.round((cssTarget * d) / artPx));
  return m / d;
}
// Same, but never larger than cssTarget (floor), unless that would be < 1 device px per art px.
export function crispFloor(artPx, cssTarget) {
  const d = dpr();
  const m = Math.max(1, Math.floor((cssTarget * d) / artPx + 0.001));
  return m / d;
}

export const TYPE_COLORS = {
  normal: "#a8a77a", fire: "#ee8130", water: "#6390f0", electric: "#f7d02c", grass: "#7ac74c", ice: "#96d9d6",
  fighting: "#c22e28", poison: "#a33ea1", ground: "#e2bf65", flying: "#a98ff3", psychic: "#f95587", bug: "#a6b91a",
  rock: "#b6a136", ghost: "#735797", dragon: "#6f35fc", dark: "#705746", steel: "#b7b7ce", fairy: "#d685ad",
};

// ---------- pixel maps ('.' = clear; other chars index the palette) ----------
const ICONS = {
  star: { pal: { a: "#ffd23f", b: "#f4a81d" }, rows: [
    "....a....",
    "....a....",
    "...aaa...",
    "aaaaaaaaa",
    ".aaaaabb.",
    "..aaabb..",
    "..aabbb..",
    ".aab..bb.",
    ".ab....b.",
  ] },
  starOff: { pal: { a: "#2b3561", b: "#222a4f" }, rows: null },
  ball: { pal: { d: "#4a2410", b: "#9a5524", w: "#f6f6f2", h: "#c47a3c" }, rows: [
    "...ddddd...",
    ".ddbhhhbdd.",
    "dbbwbwbwbbd",
    "dbbwwwwwbbd",
    "dbbbbbbbbbd",
    ".ddbbbbbdd.",
    "...ddddd...",
  ] },
  sound: { pal: { w: "#f6f6f2" }, rows: [
    "....w......",
    "...ww...w..",
    "..www....w.",
    "wwwww.w..w.",
    "wwwww..w.w.",
    "wwwww.w..w.",
    "..www....w.",
    "...ww...w..",
    "....w......",
  ] },
  mute: { pal: { w: "#f6f6f2", r: "#e8352a" }, rows: [
    "....w......",
    "...ww......",
    "..www.r...r",
    "wwwww..r.r.",
    "wwwww...r..",
    "wwwww..r.r.",
    "..www.r...r",
    "...ww......",
    "....w......",
  ] },
  pause: { pal: { w: "#f6f6f2" }, rows: [
    "ww..ww",
    "ww..ww",
    "ww..ww",
    "ww..ww",
    "ww..ww",
    "ww..ww",
    "ww..ww",
  ] },
  arrowR: { pal: { a: "#ffd23f" }, rows: ["a...", "aa..", "aaa.", "aaaa", "aaa.", "aa..", "a..."] },
  arrowL: { pal: { a: "#ffd23f" }, rows: ["...a", "..aa", ".aaa", "aaaa", ".aaa", "..aa", "...a"] },
  keyU: { pal: { a: "#0b0d14" }, rows: ["...a...", "..aaa..", ".aaaaa.", "aaaaaaa", "..aaa..", "..aaa..", "..aaa.."] },
  keyD: { pal: { a: "#0b0d14" }, rows: ["..aaa..", "..aaa..", "..aaa..", "aaaaaaa", ".aaaaa.", "..aaa..", "...a..."] },
  keyL: { pal: { a: "#0b0d14" }, rows: ["...a...", "..aa...", ".aaaaaa", "aaaaaaa", ".aaaaaa", "..aa...", "...a..."] },
  keyR: { pal: { a: "#0b0d14" }, rows: ["...a...", "...aa..", "aaaaaa.", "aaaaaaa", "aaaaaa.", "...aa..", "...a..."] },
  check: { pal: { a: "#5bd15b" }, rows: ["......a", ".....aa", "a...aa.", "aa.aa..", ".aaa...", "..a...."] },
  lock: { pal: { a: "#8d99ae", b: "#4a5068" }, rows: ["..aaa..", ".a...a.", ".a...a.", "aaaaaaa", "aabbbaa", "aaabaaa", "aaaaaaa"] },
  trophy: { pal: { a: "#ffd23f", b: "#f4a81d", c: "#fff3c4", d: "#8a5a2b" }, rows: [
    "aaaaaaaaaaa",
    "aacaaaaaaba",
    "a.acaaaab.a",
    "a.acaaaab.a",
    ".aacaaaabb.",
    "..aaaaabb..",
    "...aaabb...",
    "....abb....",
    "....abb....",
    "...aaabb...",
    "..ddddddd..",
    "..ddddddd..",
  ] },
  live: { pal: { r: "#e8352a", w: "#ff8a7a" }, rows: [".rrr.", "rwrrr", "rrrrr", "rrrrr", ".rrr."] },
  // ---- type emblems (11×11) ----
  normal: { pal: { a: "#c6c5a0", b: "#8a895f" }, rows: [
    "...aaaaa...",
    "..aaaaaaa..",
    ".aab...baa.",
    ".ab.....ba.",
    ".ab.....ba.",
    ".ab.....ba.",
    ".ab.....ba.",
    ".aab...baa.",
    "..aaaaaaa..",
    "...aaaaa...",
    "...........",
  ] },
  fire: { pal: { a: "#e8352a", b: "#ff7a1a", c: "#ffd23f" }, rows: [
    ".....a.....",
    "....aa.....",
    "....aaa..a.",
    "...aaaa.aa.",
    "..aaabaaaa.",
    "..aabbbaaa.",
    ".aabbcbbaa.",
    ".aabcccbaa.",
    ".aabcccbaa.",
    "..aabcbaa..",
    "...aaaaa...",
  ] },
  water: { pal: { a: "#3a86ff", b: "#1b4fb8", w: "#9ee0ff" }, rows: [
    ".....a.....",
    "....aaa....",
    "....aaa....",
    "...aaaaa...",
    "..aaaaaaa..",
    "..awaaaaa..",
    ".aawaaaaaa.",
    ".aawaaaaba.",
    ".aaaaaaaba.",
    "..aaaaabb..",
    "...aaaaa...",
  ] },
  electric: { pal: { a: "#ffd23f", b: "#f4a81d" }, rows: [
    "......aaa..",
    ".....aaa...",
    "....aaa....",
    "...aaa.....",
    "..aaaaaaa..",
    "......aab..",
    ".....aab...",
    "....aab....",
    "...ab......",
    "..ab.......",
    "..a........",
  ] },
  grass: { pal: { a: "#5bd15b", b: "#2f9e44" }, rows: [
    ".........a.",
    "......aaaa.",
    "....aaaaaa.",
    "...aaaaaba.",
    "..aaaaabaa.",
    "..aaaabaaa.",
    ".aaaabaaa..",
    ".aaabaaa...",
    ".aabaaa....",
    ".ba........",
    "b..........",
  ] },
  ice: { pal: { a: "#96d9d6", w: "#f6f6f2" }, rows: [
    ".....a.....",
    "...a.a.a...",
    "....aaa....",
    ".a...a...a.",
    "..a..a..a..",
    "aaaaawaaaaa",
    "..a..a..a..",
    ".a...a...a.",
    "....aaa....",
    "...a.a.a...",
    ".....a.....",
  ] },
  fighting: { pal: { a: "#e0623c", b: "#8f1d1d" }, rows: [
    "...........",
    "..aaaaaaa..",
    ".aabababaa.",
    ".aabababaa.",
    ".aaaaaaaaa.",
    ".baaaaaaaa.",
    ".abaaaaaaa.",
    "..aaaaaaaa.",
    "..aaaaaaa..",
    "...aaaaa...",
    "...........",
  ] },
  poison: { pal: { a: "#b36ad6", k: "#3b1a52" }, rows: [
    "...aaaaa...",
    "..aaaaaaa..",
    ".aaaaaaaaa.",
    ".aakaaakaa.",
    ".akkkakkka.",
    ".aakaaakaa.",
    "..aaakaaa..",
    "...aaaaa...",
    "...a.a.a...",
    "...aaaaa...",
    "...........",
  ] },
  ground: { pal: { a: "#e2bf65", b: "#a07a2c" }, rows: [
    "...........",
    "...........",
    "....aaa....",
    "...aaaaa...",
    "..aabaaaa..",
    "..abaaaaa..",
    ".aaaaabaaa.",
    ".aaaaaabaa.",
    "aaabaaaaaaa",
    "aabaaaabaaa",
    "aaaaaaaaaaa",
  ] },
  flying: { pal: { a: "#c9bdf7", b: "#8a74d6" }, rows: [
    "...........",
    "........aa.",
    "......aaaa.",
    "....aaaaab.",
    "..aaaaaabb.",
    ".aaaaaabb..",
    "aaaaaabb...",
    ".aaaaabb...",
    "...aaaab...",
    ".....aab...",
    "...........",
  ] },
  psychic: { pal: { a: "#f95587", b: "#ffb3cc", k: "#5b1030" }, rows: [
    "...........",
    "...aaaaa...",
    ".aa.....aa.",
    "a...bbb...a",
    "a..bbkbb..a",
    "a..bkkkb..a",
    "a..bbkbb..a",
    "a...bbb...a",
    ".aa.....aa.",
    "...aaaaa...",
    "...........",
  ] },
  bug: { pal: { a: "#3b5a14", b: "#a6b91a" }, rows: [
    ".a.......a.",
    "..a.....a..",
    "...aaaaa...",
    "..abbbbba..",
    ".abbbabbba.",
    ".abbbabbba.",
    "abbbbabbbba",
    ".abbbabbba.",
    ".abbbabbba.",
    "..abbabba..",
    "...aaaaa...",
  ] },
  rock: { pal: { a: "#b6a136", b: "#7a6a20", c: "#e0d27a" }, rows: [
    "...........",
    "....aaaa...",
    "..aaccaaa..",
    ".aacaaaaaa.",
    ".acaaaaaaab",
    "aaaaaaaaabb",
    "aaaaaaaabbb",
    "aaaaaaaabbb",
    ".aaaaaabbb.",
    "..abbbbbb..",
    "...........",
  ] },
  ghost: { pal: { a: "#8a6bb5", w: "#f6f6f2", k: "#0b0d14" }, rows: [
    "...aaaaa...",
    "..aaaaaaa..",
    ".aaaaaaaaa.",
    ".aawkaawka.",
    ".aawkaawka.",
    ".aaaaaaaaa.",
    ".aaaakaaaa.",
    ".aaaaaaaaa.",
    ".aaaaaaaaa.",
    ".a.aa.aa.a.",
    "...........",
  ] },
  dragon: { pal: { a: "#8a5cff" }, rows: [
    "..........a",
    ".........aa",
    "......a.aa.",
    ".....aa.a..",
    "....aa.aa.a",
    "...aa.aa.aa",
    "..aa.aa.aa.",
    ".aa.aa.aa..",
    "aa.aa.aa...",
    "a..a..a....",
    "...........",
  ] },
  dark: { pal: { a: "#9a7a62" }, rows: [
    "....aaaa...",
    "..aaaa.....",
    ".aaa.......",
    ".aa........",
    "aaa........",
    "aaa........",
    "aaa........",
    ".aa........",
    ".aaa.......",
    "..aaaa.....",
    "....aaaa...",
  ] },
  steel: { pal: { a: "#b7b7ce", b: "#7c7c96" }, rows: [
    "...aaaaa...",
    "..aaaaaaa..",
    ".aaaaaaaaa.",
    "aaaa...aaab",
    "aaa.....abb",
    "aaa.....abb",
    "aaa.....abb",
    "aaaa...aabb",
    ".aaaaaaabb.",
    "..aaaabbb..",
    "...abbbb...",
  ] },
  fairy: { pal: { a: "#ffb3d9", w: "#f6f6f2" }, rows: [
    ".....a.....",
    ".....a.....",
    "....aaa....",
    "...aaaaa...",
    "aaaaawaaaaa",
    "...aaaaa...",
    "....aaa....",
    ".....a.....",
    ".....a.....",
    "...........",
    "...........",
  ] },
};
ICONS.starOff.rows = ICONS.star.rows;
// a PlayStation pad's face buttons (hints, How to Play, the controls screen), drawn on the keycap's dark face
Object.assign(ICONS, {
  psX: { pal: { a: "#7cb2ff" }, rows: ["a...a", ".a.a.", "..a..", ".a.a.", "a...a"] },
  psO: { pal: { a: "#ff6a6a" }, rows: [".aaa.", "a...a", "a...a", "a...a", ".aaa."] },
  psSq: { pal: { a: "#f08cdc" }, rows: ["aaaaa", "a...a", "a...a", "a...a", "aaaaa"] },
  psTri: { pal: { a: "#4fe0a8" }, rows: ["..a..", ".a.a.", ".a.a.", "a...a", "aaaaa"] },
});

// rows → canvas, with an optional 1-px ink outline around the shape
export function pixCanvas(rows, pal, outline = true) {
  const pad = outline ? 1 : 0;
  const h = rows.length, w = rows[0].length;
  const cv = document.createElement("canvas");
  cv.width = w + pad * 2;
  cv.height = h + pad * 2;
  const g = cv.getContext("2d");
  const on = (x, y) => y >= 0 && y < h && x >= 0 && x < w && rows[y][x] !== ".";
  if (outline) {
    g.fillStyle = INK;
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
      if (on(x, y)) continue;
      if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1) || on(x - 1, y - 1) || on(x + 1, y - 1) || on(x - 1, y + 1) || on(x + 1, y + 1)) g.fillRect(x + pad, y + pad, 1, 1);
    }
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x];
    if (c === ".") continue;
    g.fillStyle = pal[c] || "#ff00ff";
    g.fillRect(x + pad, y + pad, 1, 1);
  }
  return cv;
}

const urlCache = new Map();
const NO_OUTLINE = new Set(["arrowR", "arrowL", "pause", "keyU", "keyD", "keyL", "keyR", "psX", "psO", "psSq", "psTri"]);
export function iconURL(name) {
  let u = urlCache.get(name);
  if (u) return u;
  const def = ICONS[name] || ICONS.normal;
  const cv = pixCanvas(def.rows, def.pal, !NO_OUTLINE.has(name));
  u = { url: cv.toDataURL(), w: cv.width, h: cv.height };
  urlCache.set(name, u);
  return u;
}
// A crisp <img> of an icon, sized as close to cssTarget (height) as whole device pixels allow.
export function iconImg(name, cssTarget = 16, cls = "pxi") {
  const ic = iconURL(name);
  const img = document.createElement("img");
  img.className = cls;
  img.src = ic.url;
  img.alt = "";
  img.draggable = false;
  const k = crispScale(ic.h, cssTarget);
  img.style.width = ic.w * k + "px";
  img.style.height = ic.h * k + "px";
  return img;
}
export function typeIcon(type, cssTarget = 22) {
  const t = ICONS[type] && TYPE_COLORS[type] ? type : "normal";
  const img = iconImg(t, cssTarget, "pxi type-ic");
  img.alt = t.toUpperCase();
  img.title = t.toUpperCase();
  return img;
}
// CSS custom properties with icon data URLs (pure-CSS pixel arrows, stars, etc.).
export function installCssIcons(root = document.documentElement) {
  for (const n of ["arrowR", "arrowL", "star", "starOff", "ball", "check"]) root.style.setProperty(`--ic-${n}`, `url("${iconURL(n).url}")`);
  // 50% ordered dither (2×2 Bayer: two navy pixels, two clear) for scrims over the field: no alpha
  // blending, each pattern pixel a whole number of device px (--dither-sz; use with pixelated)
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 2;
    const g = c.getContext("2d");
    g.fillStyle = "#141a2e";
    g.fillRect(0, 0, 1, 1);
    g.fillRect(1, 1, 1, 1);
    root.style.setProperty("--dither-navy", `url("${c.toDataURL()}")`);
    const d = dpr();
    root.style.setProperty("--dither-sz", (2 * Math.max(1, Math.round(d))) / d + "px");
  } catch (_) {}
}

// ---------- sprites: crisp at any size ----------
// The 64×64 FRLG sprites at a whole number of device px per sprite px. When the target is smaller
// than 1 device px per sprite px allows (DPR 1), a 2:1 "mode" thumbnail (32×32) keeps outlines.
const SPR = 64;
const thumbCache = new Map();
function thumb(id) {
  let t = thumbCache.get(id);
  if (t) return t;
  t = document.createElement("canvas");
  t.width = t.height = SPR / 2;
  thumbCache.set(id, t);
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = SPR;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const src = g.getImageData(0, 0, SPR, SPR).data;
      const tg = t.getContext("2d");
      const out = tg.createImageData(SPR / 2, SPR / 2);
      const o = out.data;
      for (let y = 0; y < SPR / 2; y++) for (let x = 0; x < SPR / 2; x++) {
        // the 4 source pixels: pick the most common opaque color; dark outline pixels win ties
        let best = -1, bestN = 0, opaque = 0;
        const idx = [((y * 2) * SPR + x * 2) * 4, ((y * 2) * SPR + x * 2 + 1) * 4, ((y * 2 + 1) * SPR + x * 2) * 4, ((y * 2 + 1) * SPR + x * 2 + 1) * 4];
        for (let i = 0; i < 4; i++) {
          const a = idx[i];
          if (src[a + 3] < 128) continue;
          opaque++;
          let n = 0;
          for (let j = 0; j < 4; j++) {
            const b = idx[j];
            if (src[b + 3] >= 128 && src[b] === src[a] && src[b + 1] === src[a + 1] && src[b + 2] === src[a + 2]) n++;
          }
          const dark = src[a] + src[a + 1] + src[a + 2] < 150 ? 0.5 : 0;
          if (n + dark > bestN) { bestN = n + dark; best = a; }
        }
        const d = (y * (SPR / 2) + x) * 4;
        if (opaque >= 2 && best >= 0) {
          o[d] = src[best]; o[d + 1] = src[best + 1]; o[d + 2] = src[best + 2]; o[d + 3] = 255;
        }
      }
      tg.putImageData(out, 0, 0);
    } catch (_) {}
  };
  img.src = `sprites/pixel/${id}.png`;
  return t;
}
export function spriteEl(id, cssTarget = 48, cls = "spr", alt = "") {
  const d = dpr();
  const m = Math.floor((cssTarget * d) / SPR + 0.2);
  let e;
  if (m >= 1) {
    e = document.createElement("img");
    e.src = `sprites/pixel/${id}.png`;
    e.alt = alt;
    e.draggable = false;
    const css = (SPR * m) / d;
    e.style.width = e.style.height = css + "px";
  } else {
    // smaller than the source allows at this DPR: a 32×32 thumbnail at whole device pixels
    const src = thumb(id);
    e = document.createElement("canvas");
    e.width = e.height = SPR / 2;
    const draw = () => e.getContext("2d").drawImage(src, 0, 0);
    draw();
    setTimeout(draw, 120);
    setTimeout(draw, 600);
    const mm = Math.max(1, Math.round((cssTarget * d) / (SPR / 2)));
    const css = ((SPR / 2) * mm) / d;
    e.style.width = e.style.height = css + "px";
    e.setAttribute("aria-label", alt);
    e.setAttribute("role", "img");
  }
  e.className = cls;
  return e;
}

// ---------- the octagonal play-clock ring ----------
// frac 0..1 of the ring lit clockwise from 12 o'clock; hot = last seconds (red).
const RING = 24;
let ringPts = null;
function ringPixels() {
  if (ringPts) return ringPts;
  ringPts = [];
  const c = (RING - 1) / 2;
  const oct = (x, y) => Math.max(Math.abs(x), Math.abs(y), (Math.abs(x) + Math.abs(y)) * 0.7071);
  for (let y = 0; y < RING; y++) for (let x = 0; x < RING; x++) {
    const dx = x - c, dy = y - c;
    const d = oct(dx, dy);
    if (d <= c + 0.01 && d > c - 3.05) {
      let a = Math.atan2(dx, -dy) / (Math.PI * 2);
      if (a < 0) a += 1;
      ringPts.push(x, y, a, d > c - 1.01 ? 1 : 0);
    }
  }
  return ringPts;
}
export const RING_SIZE = RING;
export function drawRing(cv, frac, hot) {
  if (cv.width !== RING) cv.width = cv.height = RING;
  const g = cv.getContext("2d");
  g.clearRect(0, 0, RING, RING);
  const pts = ringPixels();
  const on = hot ? "#e8352a" : frac > 0.5 ? "#5bd15b" : "#ffd23f";
  const onEdge = hot ? "#8f1d1d" : frac > 0.5 ? "#2f9e44" : "#f4a81d";
  for (let i = 0; i < pts.length; i += 4) {
    const lit = pts[i + 2] < frac;
    g.fillStyle = lit ? (pts[i + 3] ? onEdge : on) : pts[i + 3] ? "#0b0d14" : "#26305a";
    g.fillRect(pts[i], pts[i + 1], 1, 1);
  }
}

// ---------- title logo ----------
const GLYPHS = {
  A: ["..######..", ".########.", "###....###", "###....###", "###....###", "##########", "##########", "###....###", "###....###", "###....###", "###....###", "###....###"],
  L: ["###......", "###......", "###......", "###......", "###......", "###......", "###......", "###......", "###......", "###......", "#########", "#########"],
  "-": ["......", "......", "......", "......", "######", "######", "......", "......", "......", "......", "......", "......"],
  2: [".########.", "##########", "###....###", "......####", ".....####.", "....####..", "...####...", "..####....", ".####.....", "####......", "##########", "##########"],
  B: ["#########.", "##########", "###....###", "###....###", "###...###.", "#########.", "##########", "###....###", "###....###", "###....###", "##########", "#########."],
  O: [".########.", "##########", "###....###", "###....###", "###....###", "###....###", "###....###", "###....###", "###....###", "###....###", "##########", ".########."],
  W: ["###.....###", "###.....###", "###.....###", "###.....###", "###.###.###", "###.###.###", "###.###.###", "###.###.###", "###########", "####.#.####", "###.....###", "##.......##"],
};
const GH = 12;
function wordMask(s, gap) {
  const gl = [...s].map((c) => GLYPHS[c]);
  const w = gl.reduce((a, g) => a + g[0].length, 0) + gap * (gl.length - 1);
  const m = new Uint8Array(w * GH);
  let x0 = 0;
  for (const g of gl) {
    for (let y = 0; y < GH; y++) for (let x = 0; x < g[0].length; x++) if (g[y][x] === "#") m[y * w + x0 + x] = 1;
    x0 += g[0].length + gap;
  }
  return { m, w };
}
const GOLD = ["#fff3c4", "#ffe26e", "#ffd23f", "#ffd23f", "#ffd23f", "#f4a81d", "#f4a81d", "#f4a81d", "#ff9a1a", "#ff7a1a", "#ff7a1a", "#ff7a1a"];
const ICE = ["#ffffff", "#f6f6f2", "#f6f6f2", "#f6f6f2", "#dcecff", "#dcecff", "#b0dcff", "#b0dcff", "#86c8f5", "#86c8f5", "#5fb2ec", "#5fb2ec"];

// The ALL-22 BOWL logo: chunky glyphs with a color ramp per row, a 2-px extrusion and an ink
// outline, plus a stepped diagonal shine that sweeps across the letters (glyph pixels only).
export class Logo {
  constructor() {
    const top = wordMask("ALL-22", 2), bot = wordMask("BOWL", 3);
    this.W = Math.max(top.w, bot.w) + 8;
    this.H = GH * 2 + 14;
    const cv = (this.canvas = document.createElement("canvas"));
    cv.width = this.W;
    cv.height = this.H;
    cv.className = "logo-cv";
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", "ALL-22 BOWL");
    this.base = document.createElement("canvas");
    this.base.width = this.W;
    this.base.height = this.H;
    this.mask = new Uint8Array(this.W * this.H);
    const g = this.base.getContext("2d");
    const put = (wm, ox, oy, ramp, ext, ext2) => {
      const { m, w } = wm;
      const occ = new Uint8Array(this.W * this.H);
      for (let y = 0; y < GH; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) for (let d = 0; d <= 2; d++) occ[(oy + y + d) * this.W + ox + x + d] = 1;
      g.fillStyle = INK;
      for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
        if (occ[y * this.W + x]) continue;
        let n = false;
        for (let dy = -1; dy <= 1 && !n; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < this.W && yy < this.H && occ[yy * this.W + xx]) { n = true; break; }
        }
        if (n) g.fillRect(x, y, 1, 1);
      }
      for (let y = 0; y < GH; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) {
        g.fillStyle = ext2;
        g.fillRect(ox + x + 2, oy + y + 2, 1, 1);
      }
      for (let y = 0; y < GH; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) {
        g.fillStyle = ext;
        g.fillRect(ox + x + 1, oy + y + 1, 1, 1);
      }
      for (let y = 0; y < GH; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) {
        g.fillStyle = ramp[y];
        g.fillRect(ox + x, oy + y, 1, 1);
        this.mask[(oy + y) * this.W + ox + x] = 1;
      }
    };
    put(top, ((this.W - top.w) >> 1) - 1, 1, GOLD, "#e8352a", "#8f1d1d");
    put(bot, ((this.W - bot.w) >> 1) - 1, GH + 9, ICE, "#3a86ff", "#1b256e");
    this.g = cv.getContext("2d");
    this.t = -1;
    this.frame = -1;
    this.raf = 0;
    this.draw(0);
  }
  // shine position by time: a 3-px diagonal band crossing every 3.6 s, stepped at 24 fps
  draw(time) {
    const frame = Math.floor(time * 24);
    if (frame === this.frame) return;
    this.frame = frame;
    const g = this.g;
    g.clearRect(0, 0, this.W, this.H);
    g.drawImage(this.base, 0, 0);
    const period = 3.6, sweep = 1.3;
    const ph = (time % period) / sweep;
    if (ph > 1) return;
    const pos = Math.floor(-this.H + ph * (this.W + this.H * 2));
    g.fillStyle = "#ffffff";
    for (let y = 0; y < this.H; y++) {
      for (let k = 0; k < 3; k++) {
        const x = pos + (this.H - y) + k;
        if (x >= 0 && x < this.W && this.mask[y * this.W + x]) g.fillRect(x, y, 1, 1);
      }
    }
  }
  start() {
    if (this.raf) return;
    const t0 = performance.now();
    const loop = (now) => {
      if (!this.canvas.isConnected) { this.raf = 0; return; }
      this.draw((now - t0) / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  // size the canvas so it is about cssWidth wide at a whole number of device px per art px
  fit(cssWidth) {
    const k = crispFloor(this.W, cssWidth);
    this.canvas.style.width = this.W * k + "px";
    this.canvas.style.height = this.H * k + "px";
  }
}

// ---------- help diagrams ----------
function rect(g, c, x, y, w, h) {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}
function disc(g, c, cx, cy, r) {
  g.fillStyle = c;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) g.fillRect(cx + x, cy + y, 1, 1);
}
// A standard-mapping gamepad (A bottom, B right, X left, Y top; LB/RB on top; START in the middle).
export function padArt() {
  const cv = document.createElement("canvas");
  cv.width = 76;
  cv.height = 40;
  const g = cv.getContext("2d");
  const body = "#c9cfdc", shade = "#8d99ae", dark = "#3a3f52";
  // shoulders
  rect(g, INK, 9, 1, 18, 7); rect(g, INK, 49, 1, 18, 7);
  rect(g, shade, 10, 2, 16, 5); rect(g, shade, 50, 2, 16, 5);
  rect(g, "#b3bccd", 10, 2, 16, 2); rect(g, "#b3bccd", 50, 2, 16, 2);
  // body + grips (ink outline first)
  const shape = (c, o) => {
    rect(g, c, 6 - o, 7 - o, 64 + o * 2, 18 + o * 2);
    rect(g, c, 4 - o, 10 - o, 68 + o * 2, 12 + o * 2);
    rect(g, c, 5 - o, 20 - o, 20 + o * 2, 14 + o * 2);
    rect(g, c, 7 - o, 33 - o, 16 + o * 2, 3 + o * 2);
    rect(g, c, 51 - o, 20 - o, 20 + o * 2, 14 + o * 2);
    rect(g, c, 53 - o, 33 - o, 16 + o * 2, 3 + o * 2);
  };
  shape(INK, 1);
  shape(body, 0);
  rect(g, "#e6eaf2", 7, 7, 62, 2);
  rect(g, shade, 6, 33, 18, 2); rect(g, shade, 52, 33, 18, 2);
  // d-pad
  rect(g, dark, 15, 10, 5, 13); rect(g, dark, 11, 14, 13, 5);
  rect(g, "#5a6078", 16, 11, 3, 4); rect(g, "#5a6078", 12, 15, 4, 3);
  // left stick
  disc(g, INK, 26, 26, 4); disc(g, dark, 26, 26, 3); disc(g, "#5a6078", 25, 25, 1);
  // back / start
  rect(g, dark, 31, 14, 5, 2); rect(g, dark, 40, 14, 5, 2);
  // face buttons
  disc(g, INK, 58, 11, 3); disc(g, "#ffd23f", 58, 11, 2);
  disc(g, INK, 52, 16, 3); disc(g, "#3a86ff", 52, 16, 2);
  disc(g, INK, 64, 16, 3); disc(g, "#e8352a", 64, 16, 2);
  disc(g, INK, 58, 21, 3); disc(g, "#5bd15b", 58, 21, 2);
  // right stick
  disc(g, INK, 48, 26, 4); disc(g, dark, 48, 26, 3);
  return cv;
}
// A phone in landscape, the QB in the pocket: field, floating stick (left), and the receiver buttons 1-5 that take
// A and B's place (green open, gold, red covered); a tap on 1 throws to the receiver tagged 1 on the field.
export function touchArt() {
  const cv = document.createElement("canvas");
  cv.width = 76;
  cv.height = 40;
  const g = cv.getContext("2d");
  rect(g, INK, 1, 3, 74, 34);
  rect(g, "#3a3f52", 2, 4, 72, 32);
  rect(g, "#1c5e26", 6, 6, 64, 28);
  for (let x = 6; x < 70; x += 8) rect(g, "#2a8034", x, 6, 4, 28);
  rect(g, "#4aa3ff", 30, 6, 1, 28);
  rect(g, "#5a6078", 3, 18, 1, 4);
  // joystick
  disc(g, INK, 16, 26, 6); disc(g, "#26305a", 16, 26, 5); disc(g, INK, 18, 25, 3); disc(g, "#ffd23f", 18, 25, 2);
  // the QB, the pass to receiver 1, a defender on receiver 2
  rect(g, "#ff6fb5", 24, 16, 3, 3);
  for (let x = 28; x < 44; x += 3) rect(g, "#fff3c4", x, 17 - ((x - 28) >> 3), 1, 1);
  rect(g, "#e8352a", 61, 18, 3, 3);
  // the receivers with their number tags (as on the field)
  for (const [n, x, y] of [[1, 45, 16], [2, 57, 18]]) {
    rect(g, "#f6f6f2", x, y, 3, 3);
    rect(g, INK, x - 2, y - 10, 7, 9);
    rect(g, "#f6f6f2", x - 1, y - 9, 5, 7);
    drawText(g, String(n), x, y - 8, 1, INK, { tiny: true });
  }
  // the receiver buttons (1 tapped: a yellow ring)
  rect(g, INK, 37, 23, 31, 10);
  const looks = [["#5bd15b", "#2f8f2f"], ["#ff8a80", "#e8352a"], ["#ffd23f", "#f4a81d"], ["#5bd15b", "#2f8f2f"], ["#ff8a80", "#e8352a"]];
  looks.forEach(([c, shade], i) => {
    const x = 38 + i * 6;
    rect(g, c, x, 24, 5, 7);
    rect(g, shade, x, 31, 5, 1);
    drawText(g, String(i + 1), x + 1, 25, 1, INK, { tiny: true });
  });
  // (the ring replaces button 1's dark frame, so it doesn't eat into button 2's left column)
  rect(g, "#ffd23f", 37, 23, 7, 1); rect(g, "#ffd23f", 37, 32, 7, 1); rect(g, "#ffd23f", 37, 24, 1, 8); rect(g, "#ffd23f", 43, 24, 1, 8);
  return cv;
}
// Pixel-art touch controls: octagon stick base/knob and round arcade buttons (normal + pressed).
export function touchSkins() {
  const mk = (w, h, f) => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    f(cv.getContext("2d"));
    return cv.toDataURL();
  };
  const oct = (g, c, n, inset) => {
    const a = Math.round(n * 0.3);
    for (let y = inset; y < n - inset; y++) {
      const t = Math.min(y - inset, n - inset - 1 - y);
      const cut = Math.max(0, a - t);
      g.fillStyle = c;
      g.fillRect(inset + cut, y, n - inset * 2 - cut * 2, 1);
    }
  };
  const button = (main, light, dark, pressed) => (g) => {
    const r = 13, c = 14;
    const dy = pressed ? 1 : 0;
    if (!pressed) disc(g, INK, c, c + 1, r);
    disc(g, INK, c, c + dy, r);
    disc(g, dark, c, c + dy, r - 1);
    disc(g, main, c, c - 1 + dy, r - 2);
    if (!pressed) {
      rect(g, light, c - 6, c - 8 + dy, 5, 2);
      rect(g, light, c - 8, c - 6 + dy, 2, 4);
    }
  };
  return {
    base: mk(36, 36, (g) => { oct(g, INK, 36, 0); oct(g, "#f6f6f2", 36, 1); oct(g, INK, 36, 3); oct(g, "#1b2547", 36, 4); oct(g, "#26305a", 36, 9); }),
    knob: mk(18, 18, (g) => { oct(g, INK, 18, 0); oct(g, "#f4a81d", 18, 1); oct(g, "#ffd23f", 18, 2); rect(g, "#fff3c4", 5, 4, 5, 2); }),
    a: mk(29, 30, button("#e8352a", "#ff9a8a", "#8f1d1d", false)),
    aOn: mk(29, 30, button("#ff5a4a", "#ffc0b0", "#8f1d1d", true)),
    b: mk(29, 30, button("#3a86ff", "#a8d0ff", "#1b256e", false)),
    bOn: mk(29, 30, button("#5aa0ff", "#cfe4ff", "#1b256e", true)),
  };
}
