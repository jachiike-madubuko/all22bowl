// Team kits for the renderer: the colors of the player bases, afterimages, crowd, end zones.
// Two rules make the teams readable at a glance: (1) a base must stand out from the turf, and
// (2) the road team's base must not clash with the home team's (red vs orange, blue vs light blue
// are clashes — hue and lightness are compared in CIE Lab, not raw RGB).
// If the data module provides kitFor(team, opponent), its choice wins; otherwise we pick from the
// team's primary / secondary / white / navy.
import * as DATA from "./data.js";
import { shade, hexToRgb, rgbToHex } from "./util.js";

const TURF = "#348c3a";
const WHITE = "#f4f4ee";
const NAVY = "#1c2238";

// sRGB hex → CIE Lab (D65)
const LAB = new Map();
export function lab(hex) {
  let v = LAB.get(hex);
  if (v) return v;
  const [r, g, b] = hexToRgb(hex).map((c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  v = { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  v.C = Math.hypot(v.a, v.b);
  v.h = (Math.atan2(v.b, v.a) * 180) / Math.PI;
  LAB.set(hex, v);
  return v;
}
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
// Two colors read as different teams: far apart in lightness, or clearly different hues. Hue is
// weighed by chroma (CIE ΔH), so a pale color's hue counts for less: red/yellow are distinct,
// red/orange, red/magenta and blue/light-blue are not.
export function distinct(c1, c2) {
  const A = lab(c1), B = lab(c2);
  const dL = Math.abs(A.L - B.L);
  if (dL >= 34) return true;
  if (A.C > 22 && B.C > 22) {
    const gap = hueGap(A.h, B.h);
    const dH = 2 * Math.sqrt(A.C * B.C) * Math.sin(((gap / 2) * Math.PI) / 180);
    return dH >= 60 || (gap >= 55 && dH >= 45);
  }
  // one is near-gray: lightness has to do the work
  return dL >= 26 || Math.abs(A.C - B.C) > 45;
}
// Stands out from the grass.
export function readsOnTurf(c) {
  const A = lab(c), T = lab(TURF);
  const dE = Math.hypot(A.L - T.L, A.a - T.a, A.b - T.b);
  if (dE < 34) return false;
  if (A.C > 18 && hueGap(A.h, T.h) < 38 && Math.abs(A.L - T.L) < 26) return false;
  return true;
}

function fromKitFor(team, opp) {
  if (typeof DATA.kitFor !== "function") return null;
  try {
    const k = DATA.kitFor(team, opp);
    if (!k) return null;
    if (typeof k === "string") return { base: k, trim: null };
    const base = k.base || k.color || k.primary || k.jersey || k.main || k.fill;
    const trim = k.trim || k.rim || k.color2 || k.secondary || k.accent || null;
    return typeof base === "string" && /^#[0-9a-f]{6}$/i.test(base) ? { base, trim: typeof trim === "string" && /^#[0-9a-f]{6}$/i.test(trim) ? trim : null } : null;
  } catch (_) {
    return null;
  }
}

const valid = (c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

function pick(team, againstBase) {
  const cands = [team.color, team.primary, team.color2, team.secondary, WHITE, NAVY, "#ffd23f"].filter(valid);
  for (const c of cands) if (readsOnTurf(c) && (!againstBase || distinct(c, againstBase))) return c;
  // nothing ideal: the most distinct option
  let best = cands[0] || WHITE, bv = -1;
  for (const c of cands) {
    const A = lab(c), B = lab(againstBase || TURF);
    const v = Math.hypot(A.L - B.L, A.a - B.a, A.b - B.b);
    if (v > bv) { bv = v; best = c; }
  }
  return best;
}

function makeKit(team, base, trim) {
  // identity colors (end zones, crowd) are the team's true colors, not this game's road kit
  const primary = valid(team.primary) ? team.primary : valid(team.color) ? team.color : base;
  const secondary = valid(team.secondary) ? team.secondary : valid(team.color2) ? team.color2 : WHITE;
  const L = lab(base).L;
  const t = valid(trim) ? trim : base === primary ? secondary : primary;
  return {
    base, // player base / afterimage color
    trim: t, // ring on the base
    hi: shade(base, L > 80 ? -0.08 : 0.38), // top highlight
    rim: shade(base, L > 80 ? -0.32 : -0.42), // bottom shade
    dark: shade(base, -0.62),
    ghost: L > 75 ? shade(base, -0.1) : shade(base, 0.25),
    line: L > 80 ? shade(base, -0.08) : L < 30 ? shade(base, 0.3) : base, // sprite outline
    primary,
    secondary,
    light: L > 60, // a light kit (text on it should be dark)
  };
}

// { home, away } kits for a world (cached on a WeakMap per world).
const CACHE = new WeakMap();
export function kitsFor(world) {
  let k = CACHE.get(world);
  if (k) return k;
  const H = world.teams.home.data, A = world.teams.away.data;
  const kh = fromKitFor(H, A), ka = fromKitFor(A, H);
  const hb = kh ? kh.base : pick(H, null);
  let ab = ka ? ka.base : pick(A, hb);
  if (!ka && !distinct(ab, hb)) ab = pick(A, hb);
  k = { home: makeKit(H, hb, kh && kh.trim), away: makeKit(A, ab, ka && ka.trim) };
  CACHE.set(world, k);
  return k;
}

// A darker / lighter step of a color that is still a palette-ish hex (helpers for the stadium).
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
