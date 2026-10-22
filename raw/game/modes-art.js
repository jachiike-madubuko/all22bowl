// Pixel art for the modes screens (Draft + Gym Challenge), all drawn in code onto small canvases that
// the DOM scales by whole device pixels (image-rendering: pixelated) — the same one-grid rule as the
// field: no smoothing, no gradients, hard 1-px outlines, stepped shading.
//   loadMon(id) → trimmed sprite {c, w, h, top}   monCanvas(id, opts)   headshot(id, size, opts)
//   badgeCanvas(key, opts) (Kanto: Boulder … Earth + the Champion's cup; Johto: Zephyr … Rising + the
//   winged cup; Hoenn: Stone … Rain + the gem stand; Sinnoh: Coal … Beacon + the crown; another region's gyms
//   get a medal in their colors)   badgeArt(key) → {w, h, px}
//   spinFrames(key) (coin-spin frames for the badge-earned moment)   cardBack()   townMap(state) (the region's)
//   pixelSize(canvas, w, h, cssPerPx)   fitScale(w, h, maxW, maxH)   miniCard()   badgeOf / badgeName
import { monName, gymByKey, GYMS, REGION } from "./data.js";
import { shade } from "./util.js";

const doc = () => globalThis.document;
const mk = (w, h) => {
  const c = doc().createElement("canvas");
  c.width = Math.max(1, w | 0);
  c.height = Math.max(1, h | 0);
  return c;
};

// Size a canvas so each art pixel is a whole number of device pixels, close to `cssPerPx` CSS px.
// Returns the CSS px per art px actually used.
export function pixelSize(cv, artW, artH, cssPerPx = 1) {
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  const k = Math.max(1, Math.round(cssPerPx * dpr));
  cv.style.width = (artW * k) / dpr + "px";
  cv.style.height = (artH * k) / dpr + "px";
  return k / dpr;
}
// The largest whole-device-pixel scale that fits artW×artH into maxW×maxH CSS px (at least 1 device px).
export function fitScale(artW, artH, maxW, maxH) {
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  const k = Math.max(1, Math.floor(Math.min((maxW * dpr) / artW, (maxH * dpr) / artH)));
  return k / dpr;
}

// ---------- sprites ----------
const SPR = new Map();
// Loads sprites/pixel/{id}.png, binarizes alpha and trims it: {c (canvas), w, h, cx (head center x)}.
export function loadMon(id) {
  let p = SPR.get(id);
  if (p) return p;
  p = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const W = img.width, H = img.height;
        const c = mk(W, H);
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, W, H);
        const a = d.data;
        let x0 = W, y0 = H, x1 = -1, y1 = -1;
        for (let y = 0; y < H; y++) {
          for (let xx = 0; xx < W; xx++) {
            const i = (y * W + xx) * 4 + 3;
            if (a[i] >= 128) {
              a[i] = 255;
              if (xx < x0) x0 = xx;
              if (xx > x1) x1 = xx;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            } else a[i] = 0;
          }
        }
        if (x1 < 0) return resolve(null);
        x.putImageData(d, 0, 0);
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const t = mk(w, h);
        t.getContext("2d").drawImage(c, x0, y0, w, h, 0, 0, w, h);
        // opaque mask of the trimmed sprite (headshots look for the head with it)
        const mask = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) mask[y * w + xx] = a[((y + y0) * W + xx + x0) * 4 + 3] ? 1 : 0;
        resolve({ c: t, w, h, mask, crops: new Map() });
      } catch (_) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = `sprites/pixel/${id}.png`;
  });
  SPR.set(id, p);
  return p;
}

// A whole sprite on a fixed art-pixel box (feet on the bottom edge by default), drawn at `scale` CSS px
// per art px. Returns the canvas at once; it fills in when the sprite has loaded.
// opts: platform (color: a battle-style platform ellipse under the feet), feet (px above the bottom
// edge), silhouette (color: draw a flat silhouette instead, e.g. a white hit flash).
export function monCanvas(id, { box = 64, scale = 1, align = "bottom", flip = false, cls = "", platform = null, feet = null, silhouette = null } = {}) {
  const W = Array.isArray(box) ? box[0] : box, H = Array.isArray(box) ? box[1] : box;
  const cv = mk(W, H);
  cv.className = "mo-px " + cls;
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", monName(id));
  pixelSize(cv, W, H, scale);
  const lift = feet != null ? feet : platform ? 5 : 0;
  loadMon(id).then((s) => {
    if (!s) return;
    const x = cv.getContext("2d");
    x.clearRect(0, 0, W, H);
    if (platform) drawPlatform(x, W >> 1, H - 6, Math.min(30, (W >> 1) - 3), 5, platform);
    const dx = Math.floor((W - s.w) / 2);
    const dy = align === "bottom" ? Math.max(0, H - lift - s.h) : align === "top" ? 0 : Math.floor((H - s.h) / 2);
    let src = s.c;
    if (silhouette) {
      const t = mk(s.w, s.h);
      const tx = t.getContext("2d");
      tx.drawImage(s.c, 0, 0);
      tx.globalCompositeOperation = "source-in";
      tx.fillStyle = silhouette;
      tx.fillRect(0, 0, s.w, s.h);
      src = t;
    }
    if (flip) {
      x.save();
      x.translate(W, 0);
      x.scale(-1, 1);
      x.drawImage(src, W - dx - s.w, dy);
      x.restore();
    } else x.drawImage(src, dx, dy);
  });
  return cv;
}
// A pixel battle platform: a flat ellipse in the type color, darker underside, light rim on top.
function drawPlatform(x, cx, cy, rx, ry, color) {
  const mid = shade(color, -0.35), dark = shade(color, -0.6), rim = shade(color, 0.15);
  for (let dy = -ry; dy <= ry; dy++) {
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5)))) + 0.5);
    x.fillStyle = dy >= ry - 1 ? dark : dy <= -ry + 1 ? rim : mid;
    x.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
  // a few lighter speckles on the top face
  x.fillStyle = rim;
  for (let i = -rx + 4; i < rx - 4; i += 7) x.fillRect(cx + i, cy - 1 + ((i >> 1) & 1), 2, 1);
}

// A size×size crop around the Pokémon's head (top of the sprite), 1 art px = `scale` CSS px.
// Where to crop a size×size headshot: the window near the top that holds the most of the Pokémon
// (wing tips and tails lose to the head and body), slightly preferring higher windows.
function cropOf(s, size) {
  let c = s.crops.get(size);
  if (c) return c;
  const { w, h, mask } = s;
  const cw = Math.min(size, w), ch = Math.min(size, h);
  // integral image of the mask
  const I = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  const sum = (x, y) => I[(y + ch) * (w + 1) + x + cw] - I[y * (w + 1) + x + cw] - I[(y + ch) * (w + 1) + x] + I[y * (w + 1) + x];
  let best = -1e9, bx = 0, by = 0;
  const maxY = Math.max(0, Math.min(h - ch, Math.round(h * 0.3)));
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= w - cw; x++) {
      const v = sum(x, y) - y * cw * 0.35 - Math.abs(x + cw / 2 - w / 2) * 0.4;
      if (v > best) { best = v; bx = x; by = y; }
    }
  }
  c = { x: bx, y: by, w: cw, h: ch };
  s.crops.set(size, c);
  return c;
}

// A size×size crop around the Pokémon's head and shoulders, 1 art px = `scale` CSS px.
export function headshot(id, size = 20, { scale = 1, cls = "" } = {}) {
  const cv = mk(size, size);
  cv.className = "mo-px mo-head " + cls;
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", monName(id));
  pixelSize(cv, size, size, scale);
  loadMon(id).then((s) => {
    if (!s) return;
    const x = cv.getContext("2d");
    x.clearRect(0, 0, size, size);
    const c = cropOf(s, size);
    const dx = Math.floor((size - c.w) / 2), dy = size - c.h;
    x.drawImage(s.c, c.x, c.y, c.w, c.h, dx, dy, c.w, c.h);
  });
  return cv;
}

// ---------- badges (16×16, built from shape tests + stepped shading + auto outline) ----------
// Each badge: pal = [outline, c1 (light) .. c4 (dark), white], shape(dx, dy) → palette index or 0
// (or {col} for a color off the palette, e.g. a gold gem), where dx/dy are pixel-center offsets from
// the badge center.
const oct = (dx, dy, r, c) => Math.abs(dx) <= r && Math.abs(dy) <= r && Math.abs(dx) + Math.abs(dy) <= c;
const disc = (dx, dy, cx, cy, r) => (dx - cx) * (dx - cx) + (dy - cy) * (dy - cy) <= r * r;
const tri = (dx, dy, tx, ty, by, half) => dy >= ty && dy <= by && Math.abs(dx - tx) <= (half * (dy - ty)) / Math.max(0.01, by - ty);
const RAINBOW = ["#e83a3a", "#ff9a2a", "#ffe23a", "#4ccf4c", "#3a8af0", "#a45ae8"];
// pixel offsets (floor dx, floor dy) of the Thunder Badge's bolt
const BOLT = new Set([[0, -3], [1, -3], [-1, -2], [0, -2], [-2, -1], [-1, -1], [0, -1], [1, -1], [0, 0], [1, 0], [-1, 1], [0, 1], [-1, 2]].map(([x, y]) => x * 100 + y));
// … of the Dynamo Badge's filament, and the centers of the Cobble Badge's stones
const FILAMENT = new Set([[-2, -2], [-1, -3], [0, -2], [1, -3], [1, -2], [-2, -1], [-2, 0], [-2, 1], [1, -1], [1, 0], [1, 1]].map(([x, y]) => x * 100 + y));
const COBBLES = [[0, 0], [-3.3, -2.4], [0.4, -3.9], [3.6, -2], [3.4, 2], [0.2, 3.7], [-3.4, 1.8]];

export const BADGES = {
  boulder: {
    name: "BOULDER", pal: ["#24242c", "#f4f4f6", "#cdcdd6", "#9c9cab", "#6c6c7c", "#ffffff"],
    shape(dx, dy) {
      if (!oct(dx, dy, 6.5, 9.6)) return 0;
      const d = dx + dy;
      if (oct(dx, dy, 3.6, 5.4)) return d < -4 ? 5 : d < 0 ? 1 : d < 3 ? 2 : 3;
      // facet edges along the diagonals between the table and the rim
      if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.6 && Math.abs(dx) > 2.5) return d < 0 ? 3 : 4;
      if ((Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6) && (Math.abs(dx) > 3.9 || Math.abs(dy) > 3.9)) return d < 0 ? 2 : 3;
      return d < -2 ? 2 : d < 2.5 ? 3 : 4;
    },
  },
  cascade: {
    name: "CASCADE", pal: ["#163c84", "#e6f6ff", "#98d4ff", "#55a8f0", "#2f74d0", "#ffffff"],
    shape(dx, dy) {
      const body = disc(dx, dy, 0, 2.4, 5.2) || tri(dx, dy, 0, -7, 2.4, 4.9);
      if (!body) return 0;
      if ((dx > -3.6 && dx < -1.8 && dy > -1.5 && dy < 3) || (dx > -2.6 && dx < -1 && dy > -4 && dy < -1.5)) return 5;
      const d = dx * 0.9 + dy * 0.45;
      return d < -2.2 ? 1 : d < 0.6 ? 2 : d < 3.2 ? 3 : 4;
    },
  },
  thunder: {
    name: "THUNDER", pal: ["#6a2c00", "#fff1a0", "#ffd23f", "#ff9a1a", "#d86800", "#ffffff"],
    shape(dx, dy) {
      const star = oct(dx, dy, 4.9, 99) || Math.abs(dx) + Math.abs(dy) <= 7.4;
      if (!star) return 0;
      const ad = Math.abs(dx) + Math.abs(dy);
      if (oct(dx, dy, 3.4, 4.6)) {
        // a lightning bolt in the yellow core
        const X = Math.floor(dx), Y = Math.floor(dy);
        if (BOLT.has(X * 100 + Y)) return 4;
        return dx + dy < -2 ? 1 : 2;
      }
      return ad > 6 && dx + dy > 0 ? 4 : dx + dy < -1 ? 3 : dx + dy < 3 ? 3 : 4;
    },
  },
  rainbow: {
    name: "RAINBOW", pal: ["#2a2040", "#fffbe0", "#ffe46a", "#e8b030", "#b07818", "#ffffff"],
    shape(dx, dy) {
      if (disc(dx, dy, 0, 0, 1.9)) return dx + dy < -0.5 ? 5 : 2;
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const px = Math.cos(a) * 5.05, py = Math.sin(a) * 5.05;
        if (disc(dx, dy, px, py, 2.45)) {
          const out = (dx - px) * Math.cos(a) + (dy - py) * Math.sin(a);
          return { petal: i, dark: out > 0.9 };
        }
      }
      return 0;
    },
  },
  soul: {
    name: "SOUL", pal: ["#5a1030", "#ffd6ea", "#ff92c8", "#f0509c", "#b8306c", "#ffffff"],
    shape(dx, dy) {
      const X = dx / 6.3, Y = -(dy - 0.9) / 5.8;
      const v = Math.pow(X * X + Y * Y - 1, 3) - X * X * Y * Y * Y;
      if (v > 0) return 0;
      if (disc(dx, dy, -3, -2.4, 1.2)) return 5;
      const d = dx * 0.7 + dy;
      return d < -3.5 ? 1 : d < 0 ? 2 : d < 3.5 ? 3 : 4;
    },
  },
  marsh: {
    name: "MARSH", pal: ["#4a3006", "#fff4b8", "#ffd84a", "#e8a820", "#a86c10", "#ffffff"],
    shape(dx, dy) {
      const r = Math.hypot(dx, dy);
      if (r > 7.1 || (r > 2.9 && r < 4.8)) return 0;
      const d = dx + dy;
      if (r <= 2.9) return d < -1.5 ? 5 : d < 1 ? 2 : 3;
      return d < -4 ? 1 : d < 0 ? 2 : d < 4 ? 3 : 4;
    },
  },
  volcano: {
    name: "VOLCANO", pal: ["#560a00", "#fff0a0", "#ffd23f", "#ff8a1a", "#e2401c", "#ffffff"],
    shape(dx, dy) {
      const outer = disc(dx, dy, 0, 2.8, 4.7) || tri(dx, dy, 0.2, -7.2, 2.6, 3.4) || tri(dx, dy, -3.6, -3.8, 3, 2.4) || tri(dx, dy, 3.9, -4.6, 3, 2.5);
      if (!outer) return 0;
      const core = disc(dx, dy, 0, 3.6, 2.3) || tri(dx, dy, 0.2, -1.6, 3.6, 2);
      const mid = disc(dx, dy, 0, 3.1, 3.5) || tri(dx, dy, 0.2, -4.6, 3, 2.9);
      if (core) return dy < 2.5 && dx < 0.5 ? 1 : 2;
      if (mid) return 3;
      return 4;
    },
  },
  earth: {
    name: "EARTH", pal: ["#143c10", "#d2f7a8", "#86dc5c", "#4caf3a", "#2a7a22", "#ffffff"],
    shape(dx, dy) {
      const u = (dx - dy) / Math.SQRT2, v = (dx + dy) / Math.SQRT2; // u: along the leaf (bottom-left → top-right)
      const stem = u < -6.4 && u > -8.6 && Math.abs(v) < 0.75;
      if (stem) return 4;
      if (Math.abs(u) > 7) return 0;
      const half = 4.1 * Math.pow(Math.max(0, 1 - (u / 7) * (u / 7)), 0.75);
      if (Math.abs(v) > half) return 0;
      if (Math.abs(v) < 0.55 && u < 5.6) return 4; // the vein
      if (u > -4 && u < 4.5 && Math.abs(v + u * 0.45) < 0.5 && Math.abs(v) > 0.9) return 4; // side veins
      return v < -1.6 ? 1 : v < 0 ? 2 : v < 2.2 ? 3 : 4;
    },
  },
  champion: {
    name: "CHAMPION", pal: ["#4a3006", "#fff6c0", "#ffd84a", "#e8a820", "#a86c10", "#ffffff"],
    shape(dx, dy) {
      const bowl = dy >= -6.6 && dy <= 0.4 && Math.abs(dx) <= 5.6 - Math.max(0, dy + 3.2) * 0.75;
      const handle = (Math.abs(dx) > 5.1 && Math.abs(dx) < 7.4 && dy > -5.6 && dy < -1.4 && Math.hypot(Math.abs(dx) - 5.4, dy + 3.5) > 0.9);
      const stem = Math.abs(dx) <= 1.1 && dy > 0.4 && dy <= 3.6;
      const base = dy > 3.6 && dy <= 6.6 && Math.abs(dx) <= 2.6 + (dy - 3.6) * 0.9;
      if (!(bowl || handle || stem || base)) return 0;
      if (bowl && dy < -5.3) return 1; // rim
      if (bowl && dx > -3.6 && dx < -2.3 && dy > -4.6 && dy < -0.9) return 5;
      const d = dx;
      return d < -2.5 ? 2 : d < 1.8 ? 3 : 4;
    },
  },
  // ----- Johto (our own designs, themed by each gym's type and badge name) -----
  zephyr: {
    // a feather riding the wind: tip to the top left, quill to the bottom right, its vane split by the breeze
    name: "ZEPHYR", pal: ["#24163f", "#f4f0ff", "#cfc2f2", "#9d86d6", "#66509e", "#ffffff"],
    shape(dx, dy) {
      const x = dx + 7.5, y = dy + 7.5, a = (x + y) / 2, p = (x - y) / 2;
      if (x === y && a >= 1.5 && a <= 14.5) return a > 11 ? 4 : 5;
      const s = Math.sin((Math.PI * (a - 0.6)) / 11.6);
      if (s <= 0) return 0;
      const k = Math.pow(s, 0.75);
      if (p < -3.9 * k || p > 2.5 * k) return 0;
      if (p < -1 && (Math.abs(a - p * 0.5 - 4.8) < 0.5 || Math.abs(a - p * 0.5 - 8.4) < 0.5)) return 0;
      if (p > 1 && Math.abs(a + p * 0.5 - 7.2) < 0.5) return 0;
      return p < 0 ? (p < -2.4 ? 2 : 1) : p < 1.4 ? 3 : 4;
    },
  },
  hive: {
    // a cluster of seven honeycomb cells, each lit from the top left
    name: "HIVE", pal: ["#3e2400", "#fff2b0", "#ffd04a", "#f0a020", "#b86c10", "#ffffff"],
    shape(dx, dy) {
      const R = 2.75;
      for (let i = 0; i < 7; i++) {
        const a = Math.PI / 6 + ((i - 1) * Math.PI) / 3;
        const cx = i ? Math.cos(a) * R * Math.sqrt(3) : 0, cy = i ? Math.sin(a) * R * Math.sqrt(3) : 0;
        const x = Math.abs(dx - cx), y = Math.abs(dy - cy);
        const inHex = (r) => y <= r * 0.866 && x * 0.866 + y * 0.5 <= r * 0.866;
        if (!inHex(R + 0.15)) continue;
        if (!inHex(R - 0.75)) return 4;
        const lit = dx - cx + dy - cy;
        return lit < -1.2 ? 1 : cx + cy > 1 ? 3 : 2;
      }
      return 0;
    },
  },
  plain: {
    // a prize rosette: a scalloped pink ring, a gold heart and two ribbon tails
    name: "PLAIN", pal: ["#4a1028", "#ffe6f0", "#ffb3d2", "#f07aa8", "#c04878", "#ffffff"],
    shape(dx, dy) {
      const cy = -1.8, r = Math.hypot(dx, dy - cy), a = Math.atan2(dy - cy, dx);
      if (r <= 2.4) return { col: dx + dy - cy < -1 ? "#fff6c0" : dx + dy - cy < 1.5 ? "#ffd84a" : "#e8a820" };
      if (r <= 5.2 + 0.7 * Math.cos(a * 10)) return r < 3.2 ? 4 : dx + dy - cy < -2 ? 1 : dx + dy - cy < 2 ? 2 : 3;
      for (const s of [-1, 1]) {
        const tx = s * (1.7 + (dy - 2.5) * 0.55);
        if (dy > 2.5 && dy < 7.6 && Math.abs(dx - tx) < 1.3 && !(dy > 6.5 && Math.abs(dx - tx) < 0.5)) return s < 0 ? 2 : 3;
      }
      return 0;
    },
  },
  fog: {
    // a paper lantern glowing in the fog: ribbed, capped, a pale flame inside
    name: "FOG", pal: ["#1c1030", "#efe6ff", "#c4aef0", "#8e72cc", "#5a4290", "#ffffff"],
    shape(dx, dy) {
      const ax = Math.abs(dx);
      if (ax <= 0.5 && dy < -6.2) return 4;
      if (ax <= 2.6 && dy >= -6.2 && dy < -4.6) return dx < -1 ? 3 : 4;
      if (ax <= 2.6 && dy > 4.6 && dy <= 6.2) return dx < -1 ? 3 : 4;
      if (ax <= 0.5 && dy > 6.2) return 3;
      const ex = dx / 5.7, ey = dy / 5.2;
      if (ex * ex + ey * ey > 1) return 0;
      if (Math.abs(dy + 2.4) < 0.5 || Math.abs(dy - 0.6) < 0.5 || Math.abs(dy - 3.2) < 0.5) return 4;
      const g = Math.hypot(dx + 0.5, dy + 0.6);
      return g < 1.6 ? 5 : g < 2.9 ? 1 : dx < 1.6 ? 2 : 3;
    },
  },
  storm: {
    // a whirlpool off the stormy coast: three arms winding into a white eye
    name: "STORM", pal: ["#06263a", "#dcfbff", "#8ee0ec", "#3aa8c8", "#1c6a96", "#ffffff"],
    shape(dx, dy) {
      const r = Math.hypot(dx, dy);
      if (r > 7.2) return 0;
      if (r < 1.3) return 5;
      const s = Math.sin(3 * Math.atan2(dy, dx) + r * 1.05);
      return s > 0.45 ? (dx + dy < 0 ? 1 : 2) : s > -0.3 ? 3 : 4;
    },
  },
  mineral: {
    // a steel cog: eight teeth, a dark hub, the axle hole
    name: "MINERAL", pal: ["#141c26", "#f4f8fc", "#c2ccd8", "#8a9aac", "#58687c", "#ffffff"],
    shape(dx, dy) {
      const r = Math.hypot(dx, dy);
      if (r > (Math.cos(8 * Math.atan2(dy, dx)) > 0.1 ? 7.5 : 5.9) || r < 1.5) return 0;
      if (r < 2.7) return 4;
      const d = dx + dy;
      return d < -4 ? 1 : d < 0 ? 2 : d < 4 ? 3 : 4;
    },
  },
  glacier: {
    // a snowflake: six arms, each with a pair of twigs, around a bright core
    name: "GLACIER", pal: ["#12304e", "#f6fdff", "#c4ecfa", "#80c8ea", "#3e88c0", "#ffffff"],
    shape(dx, dy) {
      if (Math.hypot(dx, dy) < 1.6) return 5;
      for (let k = 0; k < 6; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 3, c = Math.cos(a), s = Math.sin(a);
        const t = dx * c + dy * s, p = -dx * s + dy * c;
        if (t < 0) continue;
        if (Math.abs(p) < 0.8 && t <= 7.4) return t > 5.6 ? 1 : k < 3 ? 2 : 3;
        const tt = t - 3.9;
        if (tt > 0 && tt < 2.5 && Math.abs(Math.abs(p) - tt) < 0.6) return 3;
      }
      return 0;
    },
  },
  rising: {
    // a dragon crest: two wings swept up around a gold gem, a fang rising between them
    name: "RISING", pal: ["#081634", "#d8f6ff", "#7ad1e8", "#3a7bd5", "#1f4f8a", "#ffffff"],
    shape(dx, dy) {
      const ax = Math.abs(dx);
      if (ax + Math.abs(dy - 2) <= 2.3) return { col: dx + dy < 1.2 ? "#fff3b0" : dx + dy < 3.4 ? "#ffd23f" : "#e0901a" };
      if (ax <= 1.3 - (-1 - dy) * 0.22 && dy > -7.4 && dy < -0.4) return dx < 0 ? 1 : 2;
      if (ax < 1.2 || ax > 7.4) return 0;
      const top = -0.6 - (ax - 1.2) * 1.0, bot = 3.4 - (ax - 1.2) * 0.85 + 1.7 * Math.abs(Math.sin(((ax - 1.2) * Math.PI) / 2.1));
      if (dy < top || dy > bot) return 0;
      return dy - top < 1.1 ? 2 : dx < 0 ? 3 : 4;
    },
  },
  wingcup: {
    // the Johto Champion's trophy, pixel by pixel: a silver cup on a stem, wings for handles, a blue gem
    name: "CHAMPION", pal: ["#1c2632", "#ffffff", "#d8e0e8", "#a4b2c0", "#6a7a8c", "#ffffff"],
    rows: [
      "................",
      "2..............4",
      "22............44",
      "222.11111111.444",
      ".22225233334444.",
      "..22253gG33444..",
      "....253GG334....",
      ".....223334.....",
      "......2334......",
      ".......33.......",
      ".......34.......",
      "......2334......",
      ".....223344.....",
      "....11111111....",
      "....22333344....",
      "................",
    ],
    shape(dx, dy) {
      const c = this.rows[dy + 7.5][dx + 7.5];
      return c === "." ? 0 : c === "G" ? { col: "#3a86ff" } : c === "g" ? { col: "#9ee0ff" } : +c;
    },
  },
  // ----- Hoenn (our own designs, themed by each badge's name and its gym) -----
  stone: {
    // a cairn: three flat stones stacked, each lit from the top left, a seam of shadow under each
    name: "STONE", pal: ["#2a2018", "#f4ead6", "#d4bf9e", "#a8906c", "#6e5840", "#ffffff"],
    shape(dx, dy) {
      for (const [cx, cy, rx, ry] of [[0.4, -4.6, 3.7, 2.2], [-0.4, -0.4, 5.6, 2.5], [0, 4.4, 7.4, 3]]) {
        const u = (dx - cx) / rx, v = (dy - cy) / ry;
        if (u * u + v * v > 1) continue;
        if (v > 0.6) return 4;
        const d = u * 0.7 + v;
        return d < -0.75 ? 1 : d < 0 ? 2 : d < 0.5 ? 3 : 4;
      }
      return 0;
    },
  },
  knuckle: {
    // a boxing glove, the thumb stitched off at its side, laced into a gold cuff
    name: "KNUCKLE", pal: ["#0a1e34", "#d6eeff", "#7cb8e6", "#2c7fb8", "#1a5480", "#ffffff"],
    shape(dx, dy) {
      if (dy > 4 && dy < 7.4 && Math.abs(dx + 0.5) <= 4.1) return Math.abs(dx + 0.5) < 0.6 ? 5 : { col: dy < 5 ? "#fff0b0" : dx < -1 ? "#f6c14b" : "#d89a2a" };
      if (dy > 3) return 0;
      const body = ((dx + 0.9) / 5.2) ** 2 + ((dy + 1.4) / 5.9) ** 2 <= 1, thumb = ((dx - 4.6) / 2) ** 2 + ((dy - 0.2) / 2.9) ** 2 <= 1;
      if (dx === 3.5 && thumb && body) return 0;
      if (thumb && dx > 3.5) return dx > 5 ? 4 : 3;
      if (!body) return 0;
      if (Math.hypot(dx + 3.2, dy + 4.2) < 1.3) return 5;
      const d = dx * 0.8 + dy;
      return d < -5 ? 1 : d < -1 ? 2 : d < 3 ? 3 : 4;
    },
  },
  dynamo: {
    // a light bulb at full glow: the filament burning orange, a blue screw base below
    name: "DYNAMO", pal: ["#4a3200", "#fffbe0", "#ffe66a", "#f5c518", "#c89400", "#ffffff"],
    shape(dx, dy) {
      const ax = Math.abs(dx);
      if (dy > 3.4 && dy <= 6.4 && ax <= 2.6) return { col: Math.floor(dy) & 1 ? "#8ec2ee" : "#3a6ea5" };
      if (dy > 6.4 && ax <= 1.4) return { col: "#24466e" };
      if (!(disc(dx, dy, 0, -2.2, 5.5) || (dy >= 0.5 && dy <= 3.4 && ax <= 2.9 - (dy - 0.5) * 0.12))) return 0;
      if (FILAMENT.has(Math.floor(dx) * 100 + Math.floor(dy))) return { col: "#ff8a1a" };
      if (Math.hypot(dx + 2.5, dy + 4.3) < 1.3) return 5;
      const d = dx + dy;
      return d < -4.5 ? 1 : d < -0.5 ? 2 : d < 3.5 ? 3 : 4;
    },
  },
  heat: {
    // a hot spring: three wisps of steam curling up out of a brimming red bowl
    name: "HEAT", pal: ["#5a1004", "#fff2c8", "#ffcf6b", "#e8542a", "#a8240e", "#ffffff"],
    shape(dx, dy) {
      if (dy >= 1 && dy <= 2.2 && Math.abs(dx) <= 7.3) return dx < -3 ? 1 : 2;
      if (dy > 2.2) {
        const hw = 6.7 * Math.sqrt(Math.max(0, 1 - ((dy - 2.2) / 5.3) ** 2));
        return Math.abs(dx) <= hw ? (dy < 3.2 ? { col: "#ffe0a0" } : dx < -2.5 ? 3 : 4) : 0;
      }
      if (dy < -7.4 || dy > -0.2) return 0;
      for (const x0 of [-3.9, 0, 3.9]) if (Math.abs(dx - x0 - Math.sin(dy * 1.15) * 0.8) < 0.75) return dy < -4 ? 5 : 1;
      return 0;
    },
  },
  balance: {
    // a brass balance: a post on its foot, the beam level, two pans hanging even
    name: "BALANCE", pal: ["#3a2a06", "#fff4c0", "#f0d070", "#c8a038", "#8a6a1e", "#ffffff"],
    shape(dx, dy) {
      const ax = Math.abs(dx);
      if (disc(dx, dy, 0, -6.3, 1.3)) return 2;
      if (dy >= -4.8 && dy <= -3.6 && ax <= 6.5) return dy < -4.2 ? 1 : 3;
      if (ax <= 0.8 && dy > -5.4 && dy <= 4.8) return dx < 0 ? 2 : 3;
      if (Math.abs(ax - 5.5) <= 0.45 && dy > -3.6 && dy < 0.4) return 4;
      if (dy >= 0.4 && dy <= 2.8 && Math.abs(ax - 5.4) <= 2.2 - (dy - 0.4) * 0.5) return dy < 1.2 ? 1 : dx < 0 ? 2 : 3;
      if (dy > 4.8 && dy <= 7.3 && ax <= 1.6 + (dy - 4.8) * 1.15) return dy > 6.3 ? 4 : { col: "#6b8e23" };
      return 0;
    },
  },
  feather: {
    // a white feather drifting across a round patch of sky, its vane parted by the wind
    name: "FEATHER", pal: ["#0e2a44", "#ffffff", "#d6ecfa", "#4fa3d1", "#2a6a9a", "#ffffff"],
    shape(dx, dy) {
      const r = Math.hypot(dx, dy);
      if (r > 7.3) return 0;
      // along the feather (u, from the quill's end at the bottom left) and across it (v)
      const u = (dx - dy) / Math.SQRT2 + 6.4, v = (dx + dy) / Math.SQRT2;
      if (Math.abs(v) < 0.5 && u > 0.6 && u < 12.6) return u < 3.4 ? { col: "#e0eaf4" } : 4;
      const s = Math.sin((Math.PI * (u - 2.6)) / 10.4);
      if (u > 2.6 && u < 13 && s > 0 && v > -2.6 * Math.pow(s, 0.7) && v < 2.1 * Math.pow(s, 0.7) && Math.abs(u - (v < 0 ? 6.4 : 8.6)) > 0.5) return v < 0 ? 1 : 2;
      return r > 6.4 ? 4 : 3;
    },
  },
  mind: {
    // the sun cradled in a crescent moon: two minds, one badge
    name: "MIND", pal: ["#3a0a28", "#ffd6ee", "#f490c8", "#c2448f", "#8a2464", "#ffffff"],
    shape(dx, dy) {
      const sr = Math.hypot(dx + 1.6, dy + 1.4), sa = Math.atan2(dy + 1.4, dx + 1.6);
      if (sr <= 3.1) return { col: Math.hypot(dx + 2.5, dy + 2.3) < 1.2 ? "#ffffff" : dx + dy < -3.4 ? "#fff3b0" : "#f4d35e" };
      if (disc(dx, dy, 1.9, 0.5, 6.5) && !disc(dx, dy, -0.6, -1.2, 5.1)) {
        const d = dx * 0.6 + dy;
        return d < -1.5 ? 1 : d < 2 ? 2 : d < 4.5 ? 3 : 4;
      }
      if (sr > 4 && sr < 6.4 && Math.cos(sa * 8) > 0.6 && (sa < -0.4 || sa > 2.4)) return { col: "#f4d35e" };
      return 0;
    },
  },
  rain: {
    // a storm cloud over Sootopolis's sky, rain slanting down beneath it
    name: "RAIN", pal: ["#0a2050", "#eaf8ff", "#a8e0f4", "#4a9ae6", "#2a5fbb", "#ffffff"],
    shape(dx, dy) {
      const r = Math.hypot(dx, dy);
      if (r > 7.3) return 0;
      if (disc(dx, dy, -2.9, -1.6, 2.3) || disc(dx, dy, 0.3, -3, 2.8) || disc(dx, dy, 3.3, -1.3, 2.2) || (dy >= -1.6 && dy <= 0.4 && Math.abs(dx) <= 5.2)) return dy > -0.2 ? 2 : dx + dy < -4.5 ? 5 : 1;
      if (dy > 1 && ((dx + dy * 0.5 + 40) % 2.6) < 0.6 && ((dy + 0.5) % 2) < 1.2) return 2;
      return r > 6.4 ? 4 : { col: "#1e4a96" };
    },
  },
  // ----- Sinnoh -----
  coal: {
    // a mine cart heaped with coal, embers glinting in the lumps
    name: "COAL", pal: ["#1a0e06", "#e8b888", "#b07a4a", "#7a5230", "#4a2e16", "#ffffff"],
    shape(dx, dy) {
      const ax = Math.abs(dx);
      if (disc(dx, dy, -3.7, 5.4, 1.9) || disc(dx, dy, 3.7, 5.4, 1.9)) return { col: Math.hypot(ax - 3.7, dy - 5.4) < 0.8 ? "#c8c0b8" : "#2e2a2c" };
      if (dy >= -1.6 && dy <= 4 && ax <= 7.1 - (dy + 1.6) * 0.42) {
        if (dy < -0.6) return 1;
        if (Math.abs(ax - 3.2) < 0.5 && dy < 3) return 4;
        return dx < -2.5 ? 2 : dx < 3 ? 3 : 4;
      }
      if (dy < -1.6 && (disc(dx, dy, -3.4, -2.2, 2.7) || disc(dx, dy, 0.1, -3.7, 3.3) || disc(dx, dy, 3.5, -2.3, 2.6))) {
        const X = Math.floor(dx), Y = Math.floor(dy);
        if ((X === -3 && Y === -3) || (X === 2 && Y === -4) || (X === 0 && Y === -6)) return { col: "#f2b134" };
        return { col: (X + 2 * Y) % 3 === 0 ? "#5c5658" : dx + dy < -3 ? "#46404a" : "#262224" };
      }
      return 0;
    },
  },
  forest: {
    // an old pine in three tiers, pink blossoms tucked in its boughs
    name: "FOREST", pal: ["#0a2a14", "#c8f0b0", "#6cc070", "#2e8b57", "#1e5a38", "#ffffff"],
    shape(dx, dy) {
      if (Math.abs(dx) <= 1.1 && dy > 4 && dy <= 7.4) return { col: dx < 0 ? "#8a5e3a" : "#5a3a22" };
      for (const [ty, by, half] of [[-7.6, -2.6, 3.4], [-4.9, 0.8, 5.3], [-2, 4.2, 7.1]]) {
        if (!tri(dx, dy, 0, ty, by, half)) continue;
        const X = Math.floor(dx), Y = Math.floor(dy);
        if ((X === -2 && Y === -4) || (X === 2 && Y === -1) || (X === -4 && Y === 2) || (X === 4 && Y === 3)) return { col: "#f5a3c7" };
        if (dy > by - 1) return 4;
        return dx < -1.2 ? 1 : dx < 0.8 ? 2 : 3;
      }
      return 0;
    },
  },
  cobble: {
    // a round of cobblestones set in dark mortar, ringed in Veilstone red
    name: "COBBLE", pal: ["#1c1c22", "#f0f0f2", "#c4c4cc", "#8e8e9a", "#5e5e6a", "#ffffff"],
    shape(dx, dy) {
      const r = Math.hypot(dx, dy);
      if (r > 7.3) return 0;
      if (r > 5.7) return { col: dx + dy < -3 ? "#e8705e" : dx + dy < 3 ? "#c0392b" : "#8a2418" };
      let d1 = 99, d2 = 99, c = null;
      for (const p of COBBLES) {
        const d = Math.hypot(dx - p[0], dy - p[1]);
        if (d < d1) { d2 = d1; d1 = d; c = p; } else if (d < d2) d2 = d;
      }
      if (d2 - d1 < 0.9 || r > 5.1) return 4;
      const l = (dx - c[0]) + (dy - c[1]);
      return l < -1.6 ? 1 : l < 0.4 ? 2 : 3;
    },
  },
  fen: {
    // a lily pad on the marsh, notched and veined, a golden water lily open on it and a drop of dew
    name: "FEN", pal: ["#0c2a14", "#d8f4b0", "#8ad060", "#4a9a3a", "#2a6a2a", "#ffffff"],
    shape(dx, dy) {
      const fr = Math.hypot(dx + 2, dy + 2.1), fa = Math.atan2(dy + 2.1, dx + 2);
      if (fr < 1.2) return { col: "#e8902a" };
      if (fr < 3.6 && Math.cos(5 * fa) > -0.3) return { col: fa < -1.2 && fa > -2.6 ? "#ffffff" : dx + dy < -4.4 ? "#fff6c8" : "#ffd166" };
      if (Math.hypot(dx - 3.4, dy - 2.6) < 1.1) return { col: Math.hypot(dx - 3.1, dy - 2.3) < 0.6 ? "#ffffff" : "#5ab0e8" };
      const pr = Math.hypot(dx - 0.2, dy - 0.3), pa = Math.atan2(dy - 0.3, dx - 0.2);
      // the slit from the stem out to the rim, running down to the right
      if (pr > 7.1 || ((dx - 0.2) * 0.76 + (dy - 0.3) * 0.65 > 1 && Math.abs((dy - 0.3) * 0.76 - (dx - 0.2) * 0.65) < 0.55)) return 0;
      if (pr > 6.2) return 4;
      if (Math.abs(Math.sin(pa * 3.5)) < 0.16 && pr > 1.4) return 3;
      return dx + dy < -3 ? 1 : dx + dy < 2 ? 2 : 3;
    },
  },
  relic: {
    // an ancient urn, gold-banded, a wisp of ghost-fire rising from its mouth
    name: "RELIC", pal: ["#1c0828", "#f0d8ff", "#c39bd3", "#8e4aa8", "#5a2470", "#ffffff"],
    shape(dx, dy) {
      const ax = Math.abs(dx);
      if (dy < -3.6) {
        const t = (dy + 7.8) / 4.2, cx = 0.3 + Math.sin(dy * 1.5) * 0.7 * (1 - t);
        if (Math.abs(dx - cx) <= 0.3 + t * 1.7) return { col: Math.abs(dx - cx) < 0.3 + t * 0.7 ? "#ffffff" : "#f5b7b1" };
        return 0;
      }
      if (dy <= -2.6) return ax <= 2.9 ? { col: dx < 0 ? "#fff3b0" : "#e0a820" } : 0;
      const hr = Math.hypot(ax - 3.9, dy + 0.3);
      if (dy < 0.6 && hr > 0.6 && hr < 1.6 && ax > 2.6) return 3;
      if (dy <= -0.8) return ax <= 1.8 ? (dx < 0 ? 2 : 4) : 0;
      if (dy > 6.1) return ax <= 2.1 + (dy - 6.1) * 0.8 ? { col: dx < 0 ? "#fff3b0" : "#e0a820" } : 0;
      const u = dx / 5.1, v = (dy - 2.7) / 3.7;
      if (u * u + v * v > 1) return ax <= 1.6 && dy < 1.4 ? (dx < 0 ? 2 : 4) : 0;
      if (dy > 2.2 && dy < 3.2) return { col: dx < 0 ? "#fff3b0" : "#e0a820" };
      const d = dx * 0.8 + dy - 2.7;
      return d < -3 ? 1 : d < 0 ? 2 : d < 2.5 ? 3 : 4;
    },
  },
  mine: {
    // a miner's steel helmet: a ridged dome over the brim, its lamp blazing at the front
    name: "MINE", pal: ["#141c26", "#f4f8fc", "#c2ccd6", "#8c98a4", "#56626e", "#ffffff"],
    shape(dx, dy) {
      const ax = Math.abs(dx);
      if (dy > 3.4 && dy <= 5.6) return ax <= 7.4 - Math.max(0, dy - 4.6) * 1.4 ? (dy < 4.2 ? 3 : 4) : 0;
      if (dy > 3.4) return 0;
      if (ax > 6.3 * Math.sqrt(Math.max(0, 1 - ((dy - 3.4) / 9.2) ** 2))) return 0;
      const lr = Math.hypot(dx, dy - 0.2);
      if (lr < 1.4) return { col: "#ffffff" };
      if (lr < 2.5) return { col: "#ffd23f" };
      if (lr < 3.2) return { col: "#2c3e50" };
      if (ax < 0.7 && dy < -3) return 1;
      return dx < -3 ? 1 : dx < 0 ? 2 : dx < 3 ? 3 : 4;
    },
  },
  icicle: {
    // icicles hanging from a ledge of packed snow, the longest one in the middle
    name: "ICICLE", pal: ["#0e2a44", "#f6fdff", "#c6ecfa", "#85c1e9", "#4a8ec0", "#ffffff"],
    shape(dx, dy) {
      if (dy >= -6.8 && dy <= -3.4 && Math.abs(dx) <= 7.3 - (dy < -6 ? 0.9 : 0)) return dy < -5.8 ? 5 : dy < -4.4 ? 1 : 2;
      for (const [x, len, hw] of [[-5.4, 4.6, 1.3], [-2.6, 8.2, 1.6], [0.4, 10.9, 1.9], [3.5, 7.4, 1.6], [6, 3.9, 1.1]]) {
        const t = (dy + 3.4) / len;
        if (t < 0 || t > 1) continue;
        const w = hw * (1 - t);
        if (Math.abs(dx - x) <= w + 0.15) return dx < x - 0.2 ? 1 : dx < x + w * 0.5 ? 3 : 4;
      }
      return 0;
    },
  },
  beacon: {
    // a lighthouse: the lamp blazing in its glass room, a gallery round it, the striped tower on its rock
    name: "BEACON", pal: ["#2a1e00", "#fffbe0", "#ffe76a", "#f1c40f", "#c89400", "#ffffff"],
    shape(dx, dy) {
      const ax = Math.abs(dx);
      if (dy < -6.2) return ax <= 1.7 - (-6.2 - dy) * 0.9 ? { col: "#1b4f72" } : 0;
      if (dy <= -3.4) return ax <= 2.4 ? (ax < 0.9 ? 5 : ax < 1.9 ? 1 : 3) : 0;
      if (dy <= -2.4) return ax <= 3 ? { col: "#1b4f72" } : 0;
      if (dy <= 6.2) {
        if (ax > 1.7 + (dy + 2.4) * 0.17) return 0;
        return { col: Math.floor((dy + 2.4) / 2.2) & 1 ? (dx < 0 ? "#3a7ab0" : "#1b4f72") : dx < 0.5 ? "#f4f8fc" : "#c4d0dc" };
      }
      return ax <= 4.3 ? { col: dx < 0 ? "#8a96a4" : "#5e6a78" } : 0;
    },
  },
  // the Champions' trophies: Hoenn's great blue stone on a silver stand, Sinnoh's black-jeweled gold crown
  gemstand: {
    name: "CHAMPION", pal: ["#1c2632", "#ffffff", "#d8e0e8", "#a4b2c0", "#6a7a8c", "#ffffff"],
    rows: [
      "................",
      ".....gggggg.....",
      "....gGgGGgGD....",
      "...gGGgGGGDGD...",
      "..2gGGGGGGDDD4..",
      "..22GGGGGDDDD44.",
      "...2dGGGGDDDd4..",
      "....dDGGGDDd....",
      ".....dDGDDd.....",
      "......dDDd......",
      ".......34.......",
      ".......34.......",
      "......2334......",
      ".....223344.....",
      "....11111111....",
      "....22333344....",
    ],
    shape(dx, dy) {
      const c = this.rows[dy + 7.5][dx + 7.5];
      return c === "." ? 0 : c === "g" ? { col: "#c8f4ff" } : c === "G" ? { col: "#4ac0ec" } : c === "D" ? { col: "#1e78a8" } : c === "d" ? { col: "#145a80" } : +c;
    },
  },
  crown: {
    name: "CHAMPION", pal: ["#3a2a06", "#fff6c0", "#ffd84a", "#e8a820", "#a86c10", "#ffffff"],
    shape(dx, dy) {
      const ax = Math.abs(dx);
      if (ax > 7) return 0;
      if (dy > 0.6 && dy <= 6.4) {
        if (Math.abs(dx) < 2 && Math.abs(dy - 3.5) < 2 && Math.abs(dx) + Math.abs(dy - 3.5) < 3) return { col: dx === -0.5 && dy === 2.5 ? "#ffffff" : "#1c1c22" };
        if (Math.abs(ax - 4.5) < 0.6 && Math.abs(dy - 3.3) < 0.6) return 5;
        return dy < 1.6 ? 1 : dy > 5.4 ? 4 : dx < -2 ? 2 : 3;
      }
      if (dy > 6.4) return 0;
      // three points, the middle one tallest, each topped with a ball
      const c = dx < -2.5 ? -5 : dx > 2.5 ? 5 : 0, t = Math.min(1, Math.abs(dx - c) / 2.5);
      const top = (c === 0 ? -5.2 : -3.4) + t * 3.6;
      if (disc(dx, dy, c, top - 1.5, 1.1)) return 1;
      if (dy < top) return 0;
      return dx < -2 ? 2 : dx < 2 ? 3 : 4;
    },
  },
};

// Gym (team) keys → their badge; badge keys pass through. The Champion's trophy is the region's.
const GYM_BADGE = {
  pewter: "boulder", cerulean: "cascade", vermilion: "thunder", celadon: "rainbow", fuchsia: "soul", saffron: "marsh", cinnabar: "volcano", viridian: "earth",
  violet: "zephyr", azalea: "hive", goldenrod: "plain", ecruteak: "fog", cianwood: "storm", olivine: "mineral", mahogany: "glacier", blackthorn: "rising",
  rustboro: "stone", dewford: "knuckle", mauville: "dynamo", lavaridge: "heat", petalburg: "balance", fortree: "feather", mossdeep: "mind", sootopolis: "rain",
  oreburgh: "coal", eterna: "forest", veilstone: "cobble", pastoria: "fen", hearthome: "relic", canalave: "mine", snowpoint: "icicle", sunyshore: "beacon",
};
const TROPHY = { kanto: "champion", johto: "wingcup", hoenn: "gemstand", sinnoh: "crown" }[REGION.key] || "champion";
export const badgeOf = (key) => {
  if (key === "champion") return TROPHY;
  if (BADGES[key]) return key;
  if (GYM_BADGE[key]) return GYM_BADGE[key];
  const g = gymByKey(key);
  if (!g) return "boulder";
  BADGES[g.key] = medal(g);
  return g.key;
};
export const badgeName = (key) => BADGES[badgeOf(key)].name;
// A gym with no badge art yet (a region that has its league data, not its pixels): a medal in the team's colors
// with a star, under the badge's own name.
function medal(g) {
  const c = (g.colors && g.colors[0]) || g.primary || "#8d99ae";
  return {
    name: String(g.badge || g.city || "GYM").toUpperCase(), pal: [shade(c, -0.7), shade(c, 0.7), shade(c, 0.35), c, shade(c, -0.35), "#ffffff"],
    shape(dx, dy) {
      if (!oct(dx, dy, 7.1, 9.8)) return 0;
      const a = Math.atan2(dy + 0.3, dx), r = Math.hypot(dx, dy + 0.3);
      if (r < 2.4 + 1.9 * Math.pow(Math.max(0, Math.cos(2.5 * (a + Math.PI / 2))), 3)) return 5;
      if (!oct(dx, dy, 5.6, 7.9)) return 4;
      return dx + dy < -2 ? 1 : dx + dy < 3 ? 2 : 3;
    },
  };
}

const ART = new Map();
// The badge as a 16×16 index map with a 1-px outline: {w, h, px: Uint8Array, map: [index → color]}
// (0 transparent, 1 outline, 2–6 = pal[1..5], 7+ = extra colors such as the Rainbow petals).
export function badgeArt(key) {
  let a = ART.get(key);
  if (a) return a;
  key = badgeOf(key);
  const B = BADGES[key];
  const S = 16;
  const map = [null, B.pal[0], B.pal[1], B.pal[2], B.pal[3], B.pal[4], B.pal[5]];
  const extra = new Map();
  const px = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = B.shape(x + 0.5 - 8, y + 0.5 - 8);
      if (!v) continue;
      if (typeof v === "object") {
        const col = v.col || (v.dark ? shade(RAINBOW[v.petal], -0.28) : RAINBOW[v.petal]);
        if (!extra.has(col)) { extra.set(col, map.length); map.push(col); }
        px[y * S + x] = extra.get(col);
      } else px[y * S + x] = v + 1;
    }
  }
  // outline: transparent pixels touching the shape (4-neighbors) take the outline color
  const out = new Uint8Array(px);
  const on = (xx, yy) => xx >= 0 && yy >= 0 && xx < S && yy < S && px[yy * S + xx] > 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!px[y * S + x] && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) out[y * S + x] = 1;
    }
  }
  a = { w: S, h: S, px: out, map };
  ART.set(key, a);
  return a;
}

function paint(ctx, art, ox = 0, oy = 0, { mono = null, squash = 1, back = false } = {}) {
  const { w, h, px, map } = art;
  const sw = Math.max(1, Math.round(w * squash));
  const x0 = ox + Math.floor((w - sw) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < sw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / sw));
      const v = px[y * w + sx];
      if (!v) continue;
      let col = mono || map[v];
      if (!mono && back && v > 1) col = shade(col, -0.35);
      ctx.fillStyle = col;
      ctx.fillRect(x0 + x, oy + y, 1, 1);
    }
  }
}

// A badge canvas (16×16 art px) at `scale` CSS px per art px; locked = dark silhouette.
export function badgeCanvas(key, { scale = 2, locked = false, cls = "" } = {}) {
  const art = badgeArt(key);
  const cv = mk(art.w, art.h);
  cv.className = "mo-px mo-badge " + cls;
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", `${badgeName(key)} ${key === "champion" ? "TROPHY" : "BADGE"}${locked ? " (not earned)" : ""}`);
  pixelSize(cv, art.w, art.h, scale);
  const x = cv.getContext("2d");
  paint(x, art, 0, 0, {});
  if (locked) {
    // not earned yet: the badge's own design, darkened and dithered (a whole-pixel checkerboard of
    // navy over a dimmed copy), so it reads as "still to win" rather than missing art
    const img = x.getImageData(0, 0, art.w, art.h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const p = i >> 2;
      if (((p % art.w) + ((p / art.w) | 0)) & 1) {
        d[i] = 0x22; d[i + 1] = 0x2b; d[i + 2] = 0x4d;
      } else {
        d[i] = (d[i] * 0.34 + 0x1b * 0.66) | 0; d[i + 1] = (d[i + 1] * 0.34 + 0x25 * 0.66) | 0; d[i + 2] = (d[i + 2] * 0.34 + 0x47 * 0.66) | 0;
      }
      d[i + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    // a faint rim so the socket still reads
    const { px, w } = art;
    x.fillStyle = "#3d4a78";
    for (let i = 0; i < px.length; i++) if (px[i] === 1) x.fillRect(i % w, (i / w) | 0, 1, 1);
  }
  return cv;
}

// Coin-spin frames: full → squashed → edge → (back) → full, as canvases of the same size.
export function spinFrames(key, mono = null) {
  const art = badgeArt(key);
  const steps = [1, 0.75, 0.45, 0.15, 0.45, 0.75, 1, 0.75, 0.45, 0.15, 0.45, 0.75];
  return steps.map((q, i) => {
    const c = mk(art.w, art.h);
    paint(c.getContext("2d"), art, 0, 0, { squash: q, back: i > 3 && i < 9 && q < 0.8, mono });
    return c;
  });
}
export function drawFrame(target, frame) {
  const x = target.getContext("2d");
  x.clearRect(0, 0, target.width, target.height);
  x.drawImage(frame, 0, 0);
}

// ---------- card back (48×64): navy diagonal stripes + a Poké Ball ----------
let BACK = null;
export function cardBack() {
  const W = 48, H = 64;
  const cv = mk(W, H);
  cv.className = "mo-px mo-cardback";
  const x = cv.getContext("2d");
  if (!BACK) {
    BACK = mk(W, H);
    const b = BACK.getContext("2d");
    b.fillStyle = "#1b2547";
    b.fillRect(0, 0, W, H);
    b.fillStyle = "#22305c";
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) if (((xx + y) & 7) < 2) b.fillRect(xx, y, 1, 1);
    b.fillStyle = "#2b3a6b";
    b.fillRect(2, 2, W - 4, 1); b.fillRect(2, H - 3, W - 4, 1); b.fillRect(2, 2, 1, H - 4); b.fillRect(W - 3, 2, 1, H - 4);
    const cx = 24, cy = 32, R = 13;
    for (let y = -R - 1; y <= R + 1; y++) {
      for (let xx = -R - 1; xx <= R + 1; xx++) {
        const d = Math.hypot(xx + 0.5, y + 0.5);
        let col = null;
        if (d <= R + 0.6 && d > R - 0.6) col = "#0b0d14";
        else if (d <= R - 0.6) {
          if (Math.abs(y + 0.5) <= 1.2) col = "#0b0d14";
          else if (y < 0) col = (xx + y < -12 && d < R - 3) ? "#ff7b6e" : (xx + y > 6 ? "#b8261e" : "#e8352a");
          else col = xx + y > 8 ? "#c9cdd8" : "#f6f6f2";
          const bd = Math.hypot(xx + 0.5, y + 0.5);
          if (bd <= 4.6) col = bd > 3.4 ? "#0b0d14" : bd > 2.2 ? "#f6f6f2" : (xx + y < 0 ? "#ffffff" : "#dfe3ec");
        }
        if (col) { b.fillStyle = col; b.fillRect(cx + xx, cy + y, 1, 1); }
      }
    }
  }
  x.drawImage(BACK, 0, 0);
  return cv;
}

// A small card icon (11×14) for buttons.
export function miniCard({ scale = 1, cls = "" } = {}) {
  const W = 11, H = 14;
  const cv = mk(W, H);
  cv.className = "mo-px " + cls;
  pixelSize(cv, W, H, scale);
  const x = cv.getContext("2d");
  const P = (c, a, b, w = 1, h = 1) => { x.fillStyle = c; x.fillRect(a, b, w, h); };
  P("#0b0d14", 0, 0, W, H);
  P("#f6f6f2", 1, 1, W - 2, H - 2);
  P("#1b2547", 2, 2, W - 4, H - 4);
  P("#0b0d14", 3, 4, 5, 5);
  P("#e8352a", 4, 4, 3, 2);
  P("#e8352a", 3, 5, 1, 1); P("#e8352a", 7, 5, 1, 1);
  P("#f6f6f2", 4, 7, 3, 2);
  P("#f6f6f2", 3, 7, 1, 1); P("#f6f6f2", 7, 7, 1, 1);
  P("#0b0d14", 3, 6, 5, 1);
  P("#f6f6f2", 5, 6, 1, 1);
  return cv;
}

// ---------- the region's Town Map (23×18 tiles of 8 px = 184×144) ----------
// Tiles: ~ sea, ^ mountains, t trees, w a lake, . grass, v a volcano, s sand, * snow. places: town centers in tiles
// (x, y), gyms keyed like the teams, the League (the Champion) as indigo; routes / sea: paths through those places or
// [x, y] waypoints; towns: the places without a gym, drawn as two little houses (their roof colors).
const KANTO_ROWS = [
  "~~~~~~~~~~~~~~~~~~~~~~~",
  "~~^^^^^^^^^^^^^^^tt~~~~",
  "~^^^tt^^^^^^^^^...tt~~~",
  "~^^.......t^^.......~~~",
  "~^..tt....tt.....t..t~~",
  "~^..tt...........t..t~~",
  "~^^..t..............t~~",
  "~^...t..............t~~",
  "~^......t...........t~~",
  "~^^.....t...ww......tt~",
  "~~^.....t...........~~~",
  "~~~.....t...........~~~",
  "~~~~...tt..........~~~~",
  "~~~~~~~.t...tt....~~~~~",
  "~~~~~~~.t..ttt..~~~~~~~",
  "~~~~~~~~~...~~~~~~~~~~~",
  "~~~..~~.~~~~~~~~~~~~~~~",
  "~~~~~~~~~~~~~~~~~~~~~~~",
];
const MAPS = {
  kanto: {
    rows: KANTO_ROWS,
    places: {
      indigo: [1.5, 3], pewter: [4, 3], cerulean: [15, 3], viridian: [4, 8], pallet: [4, 12], cinnabar: [3.5, 16],
      celadon: [10, 7], saffron: [15, 7], lavender: [19, 7], vermilion: [15, 11], fuchsia: [12, 14],
    },
    routes: [
      ["pallet", "viridian"], ["viridian", "pewter"], ["pewter", [9, 3], "cerulean"], ["cerulean", "saffron"], ["saffron", "vermilion"],
      ["celadon", "saffron"], ["saffron", "lavender"], ["cerulean", [19, 3], "lavender"], ["lavender", [19, 12], [15, 12], "vermilion"],
      ["celadon", [7, 7], [7, 14], "fuchsia"], ["fuchsia", [17, 14], [19, 12]], ["viridian", [1.5, 8], "indigo"],
    ],
    sea: [["fuchsia", [12, 16], "cinnabar"], ["pallet", "cinnabar"]],
    towns: { pallet: ["#e8352a", "#3a86ff"], lavender: ["#9b5de5", "#9b5de5"] },
  },
  // Johto: the Lake of Rage up north, Mt. Mortar and the Ice Path, Cianwood out west across the sea, the League east
  // past New Bark
  johto: {
    rows: [
      "~~~~~^^^^^^^tww^^^^^^^~",
      "~~~~^^...^^^twwt^^^.^^~",
      "~~~^.......^^t.t.^^...~",
      "~~~^......^^^...^^....~",
      "~~~~.t.....^^^....^...~",
      "~~~~...t.....t.....^^.~",
      "~~~~~...t...........^^~",
      "~~~~~....tt.........^^~",
      "~~~~~~...tt...........~",
      "~..~~~...t.........^^~~",
      "~..~~.........t.......~",
      "~..~~~.........t.....~~",
      "~~~~~.ttt............~~",
      "~~~~~.ttt.^^.........~~",
      "~~~~~~.......~~~~...~~~",
      "~~~~~~~....~~~~~~~~~~~~",
      "~~~.~~~~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~~~~~~~~",
    ],
    places: {
      violet: [13, 8], azalea: [6, 14], goldenrod: [6, 10], ecruteak: [8, 4], cianwood: [1.5, 10], olivine: [5, 7],
      mahogany: [14, 4], blackthorn: [19, 3], indigo: [21, 8], newbark: [19, 12], cherrygrove: [15, 13],
    },
    routes: [
      ["newbark", "cherrygrove"], ["cherrygrove", [15, 9], "violet"], ["violet", [13, 13], "azalea"], ["azalea", [5, 12], "goldenrod"],
      ["goldenrod", [7, 7], "ecruteak"], ["violet", [11, 7], [7, 7]], ["ecruteak", [5, 5], "olivine"], ["ecruteak", "mahogany"],
      ["mahogany", [14, 1.5]], ["mahogany", [17, 3], "blackthorn"], ["blackthorn", [18, 7], [17, 12.5]], ["newbark", [21, 11], "indigo"],
    ],
    sea: [["olivine", [3, 8], "cianwood"]],
    towns: { newbark: ["#5bd15b", "#e8352a"], cherrygrove: ["#ff6fb5", "#3a86ff"] },
  },
  // Hoenn: Mt. Chimney (v) over the Route 111 sands (s), Fortree's woods to the north-east, open sea to the east and
  // south with Mossdeep, Sootopolis in its crater ring, Ever Grande (the League), Dewford and Pacifidlog
  hoenn: {
    rows: [
      "~~~~~~~~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~~~~~~~~",
      "~~~^^^^^vv^^.ttt~~~~~~~",
      "~~.^^^^^vv^ss.ttt.~~~~~",
      "~~..^^^^^^.ss..tt...~~~",
      "~...t.^^^...s.......~~~",
      "~..tt.............~~..~",
      "~...t............~~~.~~",
      "~~..t...........~~~~~~~",
      "~~..........^^..~~~~~~~",
      "~~~...........~~~^^^~~~",
      "~~~~..........~~~^w^~~~",
      "~~~~~~.....~~~~~~^^^~~~",
      "~~~~~~~~~~~~~~~~~~~~..~",
      "~~..~~~~~~~~~~~~~~~~..~",
      "~~..~~~~~~~~.~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~~~~~~~~",
    ],
    places: {
      rustboro: [1.5, 6], petalburg: [3, 9], mauville: [9, 8], lavaridge: [5, 5], fortree: [14.5, 3], mossdeep: [20.5, 6.5],
      sootopolis: [18, 11], dewford: [2.5, 14.5], indigo: [20.5, 13.5], littleroot: [6, 11], lilycove: [18.5, 4.5],
    },
    routes: [
      ["littleroot", [6, 9], "petalburg"], ["petalburg", [2.5, 7], "rustboro"], ["rustboro", [5, 7], "mauville"], ["mauville", [9.5, 5], "lavaridge"],
      ["mauville", [14, 8], [14.5, 5], "fortree"], ["fortree", [17, 3.5], "lilycove"], ["mauville", [8.5, 11.5]],
    ],
    sea: [["petalburg", [2.5, 12], "dewford"], ["dewford", [8.5, 13], [8.5, 12]], ["lilycove", [20, 5], "mossdeep"], ["mossdeep", [19.5, 9], "sootopolis"], ["sootopolis", [20, 12.5], "indigo"]],
    towns: { littleroot: ["#f2a33a", "#5bd15b"], lilycove: ["#4fc3e8", "#e8352a"] },
  },
  // Sinnoh: Mt. Coronet down the middle, the snowfields (*) and Lake Acuity up north, Eterna's forest, Canalave across the
  // channel to the west, the Great Marsh by Pastoria, Sunyshore on the south-east coast, the League on its island
  sinnoh: {
    rows: [
      "~~~~~~~~~~~~~~~~~~~~~~~",
      "~~~~**********~~~~~~~~~",
      "~~~***w*****^^**~~~~~~~",
      "~~~*******^^^^***~~~~~~",
      "~~~~....t.^^^^....~~~~~",
      "~~~...ttt..^^^.....~~~~",
      "~~...tt....^^^......~~~",
      "~~~........^^^....~~~~~",
      "~.~~.......^^.....~~..~",
      "~..~~......^^..w..~~..~",
      "~..~~.......^.....~~~~~",
      "~~~~~.......^.....~~~~~",
      "~~~~~~..w.........~~~~~",
      "~~~~~~~.......~~....~~~",
      "~~~~~~~~~...~~~~~..~~~~",
      "~~~~~~~~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~~~~~~~~",
      "~~~~~~~~~~~~~~~~~~~~~~~",
    ],
    places: {
      oreburgh: [9.5, 8], eterna: [5.5, 4.5], veilstone: [17, 5], pastoria: [15, 11], hearthome: [14.5, 7], canalave: [1.5, 9.5],
      snowpoint: [4.5, 2.5], sunyshore: [17.5, 13.5], indigo: [20.5, 8.5], twinleaf: [8.5, 13.5], jubilife: [7, 10.5],
    },
    routes: [
      ["twinleaf", "jubilife"], ["jubilife", "oreburgh"], ["jubilife", [5.5, 7], "eterna"], ["eterna", "snowpoint"], ["oreburgh", "hearthome"],
      ["hearthome", [14.5, 5], "veilstone"], ["hearthome", "pastoria"], ["pastoria", [17, 12.5], "sunyshore"],
    ],
    sea: [["jubilife", [3, 10], "canalave"], ["sunyshore", [19.5, 11], "indigo"]],
    towns: { twinleaf: ["#5bd15b", "#3a86ff"], jubilife: ["#9b5de5", "#ffd23f"] },
  },
};
// A region with no map drawn yet: its gyms around an island, the League in the middle.
function plainMap() {
  const rows = [];
  for (let y = 0; y < 18; y++) {
    let r = "";
    for (let x = 0; x < 23; x++) r += x < 2 || y < 2 || x > 20 || y > 15 ? "~" : (x * 7 + y * 13) % 17 === 0 ? "t" : ".";
    rows.push(r);
  }
  const places = { indigo: [11, 9] };
  GYMS.forEach((g, i) => {
    const a = Math.PI * (0.75 + i / 4);
    places[g.key] = [Math.round(11 + Math.cos(a) * 7.5), Math.round(9 + Math.sin(a) * 5)];
  });
  const routes = GYMS.map((g, i) => [g.key, i + 1 < GYMS.length ? GYMS[i + 1].key : "indigo"]);
  return { rows, places, routes, sea: [], towns: {} };
}
const MAP = MAPS[REGION.key] || plainMap();
export const MAP_W = 23 * 8, MAP_H = 18 * 8;
const pt = (p) => (typeof p === "string" ? MAP.places[p] : p);
const tc = (v) => Math.round(v * 8 + 4);

let MAP_BASE = null;
function mapBase() {
  if (MAP_BASE) return MAP_BASE;
  const c = mk(MAP_W, MAP_H);
  const x = c.getContext("2d");
  const at = (tx, ty) => (MAP.rows[ty] && MAP.rows[ty][tx]) || "~";
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let ty = 0; ty < 18; ty++) {
    for (let tx = 0; tx < 23; tx++) {
      const t = at(tx, ty);
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const X = tx * 8 + px, Y = ty * 8 + py;
          const b = BAYER[(Y & 3) * 4 + (X & 3)];
          let col;
          if (t === "~") {
            const wave = (X * 7 + Y * 13) % 41 === 0 || (X * 7 + Y * 13) % 41 === 7;
            col = wave && (Y & 3) === 1 ? "#4f8ee0" : b < 2 ? "#2f66b8" : "#2858a8";
          } else if (t === "w") {
            col = px === 0 || py === 0 || px === 7 || py === 7 ? "#3b7a30" : (px + py) % 5 === 0 ? "#6aa6ec" : "#3f78c8";
          } else if (t === "^") {
            // one peak per tile: light west face, dark east face, a snowy tip on the high ridge
            const half = (py + 1) >> 1;
            const inPeak = px >= 4 - half && px <= 3 + half;
            if (inPeak) col = py <= 1 && ty <= 2 ? "#f2f2ea" : px < 4 ? "#d2a46a" : "#8e6438";
            else col = py >= 6 ? "#7c5630" : "#a87a46";
          } else if (t === "v") {
            // a volcano: a peak in dark rock, its crater glowing
            const half = (py + 1) >> 1;
            const inPeak = px >= 4 - half && px <= 3 + half;
            if (inPeak) col = py <= 1 ? (px === 3 || px === 4 ? "#ff6a1a" : "#5a4440") : px < 4 ? "#8a6a5c" : "#5a443e";
            else col = py >= 6 ? "#6a4e40" : "#86685a";
          } else if (t === "s") {
            // desert sand: pale, with wind ripples
            col = (py === 2 || py === 6) && ((px + tx * 3) & 3) !== 0 ? "#d6bc7c" : b < 4 ? "#e4d098" : "#eedcaa";
          } else if (t === "*") {
            // a snowfield: blue-white dither, a snowy pine standing on every few tiles
            const pine = ((tx * 5 + ty * 3) & 3) === 0 && py >= 1 && py <= 6 && Math.abs(px - 3.5) <= (py + 1) >> 1;
            col = pine ? (py === 1 || px < 3 ? "#f6fafc" : "#2e5a48") : b < 3 ? "#d6e2ee" : "#f0f5fa";
          } else if (t === "t") {
            // round trees on a 4-px grid
            const lx = px & 3, ly = py & 3;
            col = (lx === 0 && ly === 0) ? "#5cb04c" : ly === 3 || lx === 3 ? "#1f5a22" : (lx === 1 && ly === 1) ? "#49a84a" : "#2f7a32";
          } else {
            const tuft = (px === 2 && py === 5) || (px === 3 && py === 4) || (px === 4 && py === 5);
            col = tuft && ((tx + ty) & 1) ? "#4c9a3c" : b < 3 ? "#5aa848" : "#68b850";
          }
          x.fillStyle = col;
          x.fillRect(X, Y, 1, 1);
        }
      }
    }
  }
  // coastline: a light foam pixel on water next to land, a dark edge on land next to water
  const land = (X, Y) => at((X / 8) | 0, (Y / 8) | 0) !== "~";
  for (let Y = 0; Y < MAP_H; Y++) {
    for (let X = 0; X < MAP_W; X++) {
      const L = land(X, Y);
      const nb = (dx, dy) => X + dx >= 0 && Y + dy >= 0 && X + dx < MAP_W && Y + dy < MAP_H && land(X + dx, Y + dy) !== L;
      if (nb(1, 0) || nb(-1, 0) || nb(0, 1) || nb(0, -1)) {
        x.fillStyle = L ? "#e2d494" : "#a8d8f0";
        x.fillRect(X, Y, 1, 1);
      } else if (!L && (nb(2, 0) || nb(-2, 0) || nb(0, 2) || nb(0, -2)) && ((X + Y) & 1)) {
        x.fillStyle = "#3f78c8";
        x.fillRect(X, Y, 1, 1);
      }
    }
  }
  // routes: 2-px sandy paths with a darker edge
  const line = (a, b, fn) => {
    let [x0, y0] = a, [x1, y1] = b;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 600; n++) {
      fn(x0, y0, n);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const route = (pts, sea) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pt(pts[i - 1]), b = pt(pts[i]);
      line([tc(a[0]), tc(a[1])], [tc(b[0]), tc(b[1])], (X, Y, n) => {
        if (sea) {
          if (n % 3 === 0) { x.fillStyle = "#e6f2ff"; x.fillRect(X, Y, 1, 1); }
          return;
        }
        x.fillStyle = "#b39a62";
        x.fillRect(X - 1, Y - 1, 3, 3);
      });
      if (!sea) line([tc(a[0]), tc(a[1])], [tc(b[0]), tc(b[1])], (X, Y) => { x.fillStyle = "#ead8a0"; x.fillRect(X, Y, 1, 1); x.fillRect(X - 1 + ((X + Y) & 1), Y, 1, 1); });
    }
  };
  for (const r of MAP.sea) route(r, true);
  for (const r of MAP.routes) route(r, false);
  // towns: small white blocks with an ink outline
  const house = (X, Y, roof) => {
    x.fillStyle = "#0b0d14";
    x.fillRect(X - 1, Y - 1, 6, 6);
    x.fillStyle = roof;
    x.fillRect(X, Y, 4, 2);
    x.fillStyle = "#f6f6f2";
    x.fillRect(X, Y + 2, 4, 2);
    x.fillStyle = "#0b0d14";
    x.fillRect(X + 1, Y + 3, 1, 1);
  };
  for (const k of [...Object.keys(MAP.towns), "indigo"]) {
    const [cx, cy] = MAP.places[k];
    const X = tc(cx), Y = tc(cy);
    if (k === "indigo") {
      // the League: a gold-roofed hall
      x.fillStyle = "#0b0d14";
      x.fillRect(X - 5, Y - 4, 11, 9);
      x.fillStyle = "#ffd23f";
      x.fillRect(X - 4, Y - 3, 9, 3);
      x.fillStyle = "#f6f6f2";
      x.fillRect(X - 4, Y, 9, 4);
      x.fillStyle = "#0b0d14";
      x.fillRect(X, Y + 2, 1, 2);
    } else {
      house(X - 5, Y - 3, MAP.towns[k][0]);
      house(X + 1, Y - 1, MAP.towns[k][1]);
    }
  }
  MAP_BASE = c;
  return c;
}

// The region's Town Map with the ladder drawn on it. state: {status: {key → 'won'|'next'|'locked'}, champion:
// 'won'|'next'|'locked'}. Earned gyms show their badge; the next one a bright marker; the rest a
// locked plate.
export function townMap(state) {
  const cv = mk(MAP_W, MAP_H);
  cv.className = "mo-px mo-map";
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", `Map of ${REGION.name} with the eight gyms`);
  const x = cv.getContext("2d");
  x.drawImage(mapBase(), 0, 0);
  for (const key of Object.keys(state.status || {})) {
    const p = MAP.places[key === "champion" ? "indigo" : key];
    if (!p) continue;
    const st = state.status[key];
    const X = tc(p[0]), Y = tc(p[1]);
    if (st === "won") {
      paint(x, badgeArt(key), X - 8, Y - 8);
    } else {
      // gym plate: 10×10 block; next = red with a white rim, locked = slate
      const next = st === "next";
      x.fillStyle = "#0b0d14";
      x.fillRect(X - 5, Y - 5, 11, 11);
      x.fillStyle = next ? "#f6f6f2" : "#55608a";
      x.fillRect(X - 4, Y - 4, 9, 9);
      x.fillStyle = next ? "#e8352a" : "#2b3456";
      x.fillRect(X - 3, Y - 3, 7, 7);
      x.fillStyle = next ? "#ffd23f" : "#55608a";
      if (key === "champion") {
        // a tiny crown
        x.fillRect(X - 2, Y, 5, 2);
        x.fillRect(X - 2, Y - 2, 1, 2); x.fillRect(X, Y - 2, 1, 2); x.fillRect(X + 2, Y - 2, 1, 2);
      } else {
        x.fillRect(X - 1, Y - 1, 3, 3);
      }
    }
  }
  return cv;
}
export const mapPoint = (key) => {
  const p = MAP.places[key === "champion" ? "indigo" : key];
  return p ? [tc(p[0]), tc(p[1])] : [MAP_W / 2, MAP_H / 2];
};
