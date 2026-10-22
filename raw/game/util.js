// Small shared helpers: a seeded PRNG (game logic never uses Math.random) and math.

export function makeRng(seed = 1) {
  let s = seed >>> 0 || 0x9e3779b9;
  const rng = {
    seed: s,
    next() {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(a, b) {
      return a + (b - a) * rng.next();
    },
    int(a, b) {
      return a + Math.floor((b - a + 1) * rng.next());
    },
    chance(p) {
      return rng.next() < p;
    },
    pick(arr) {
      return arr[Math.floor(rng.next() * arr.length)];
    },
    // Roughly normal, mean 0, sd 1.
    gauss() {
      return (rng.next() + rng.next() + rng.next() + rng.next() - 2) * 1.732;
    },
  };
  return rng;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
export const sign = (v) => (v < 0 ? -1 : 1);
export const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
export const smooth01 = (t) => t * t * (3 - 2 * t);

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) | (clamp(r | 0, 0, 255) << 16) | (clamp(g | 0, 0, 255) << 8) | clamp(b | 0, 0, 255)).toString(16).slice(1);
}
export function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  return k >= 0 ? rgbToHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : rgbToHex(r * (1 + k), g * (1 + k), b * (1 + k));
}
export function colorDist(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

// Reads URL params once.
export const PARAMS = (() => {
  try {
    return new URLSearchParams(globalThis.location ? globalThis.location.search : "");
  } catch (_) {
    return new URLSearchParams("");
  }
})();
