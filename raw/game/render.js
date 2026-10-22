// Pixel-perfect renderer. Everything in the world is drawn into ONE low-res buffer where
// 1 buffer px = 1 sprite px (ART.PX px per yard), using integer coordinates and pixel primitives
// only (fillRect spans, pre-drawn masks, nearest-neighbor sprite transforms). The buffer is then
// blitted to the screen canvas at an integer scale with smoothing off (SPEC §6.0).
// Frame: field + stands (pre-rendered per orientation, crowd cheer frame toggled at ~8 Hz) →
// sky FX → LOS / first-down lines, end-zone flash, chains → ground FX (mist) → shadows + team
// bases → depth-sorted players (afterimages, spins, flashes) → goalposts → ball (spiral / tumble,
// shadow) → particles + pop-ups → weather → in-world marks (user arrow, targets, landing spot) →
// banners → blit.
import { CFG } from "./config.js";
import { ART, PX, PY, ZPX, FIELD_PX_W, FIELD_PX_H, FIELD_H_PX, wx, wy, chooseScale } from "./camera.js";
import { drawText, textCanvas, textWidth } from "./pixelfont.js";
import { poseFor, makePose } from "./anim.js";
import { shade } from "./util.js";
import { monFacing } from "./data.js";
import { kitsFor } from "./art-kit.js";
import { buildStadium, moodFor, LAYOUT, MOODS } from "./art-stadium.js";
import { B as BIND, keyCap, PAD_GLYPH } from "./bindings.js";

const PAL = CFG.PALETTE;
const OUTLINE = true; // kit-colored 1-px sprite outlines (team readability in piles)
const FW = CFG.FIELD_W;
const MID = FW / 2;
const SPR_CACHE = new Map(); // id → sprite record (shared across worlds)
const USER_ARROW = [9, 9, 7, 5, 3, 1]; // the human's down arrow, row widths (× the mark size)
const CHEVRON = [1, 2, 3, 4, 3, 2, 1]; // one ◀ of the punt-return hint, row widths (tip on the left)
// kept for older imports (crowd geometry now lives in art-stadium.js LAYOUT)
export const CROWD_Y0 = LAYOUT.CROWD_Y, CROWD_ROW_H = LAYOUT.ROW_H, CROWD_ROWS = LAYOUT.ROWS, CROWD_COL_W = 5;

// Touch screens (phones, tablets): kept for main.js / ui.js (the scale no longer depends on it).
export function isTouch() {
  try {
    return matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  } catch (_) {
    return false;
  }
}

// The visible viewport in CSS px: window.innerWidth/innerHeight, unless the layout disagrees about the width. iOS Safari
// can keep reporting a stale size after a tab or app switch (its tab animation shrinks the page), and a canvas sized to
// it drew the field in one corner of the screen. A fixed box covering the viewport (what the canvas covers) settles it.
let vpBox = null;
export function viewBox() {
  if (!vpBox) {
    vpBox = document.createElement("div");
    vpBox.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;visibility:hidden;pointer-events:none";
    document.body.append(vpBox);
  }
  return vpBox;
}
export function viewSize() {
  const r = viewBox().getBoundingClientRect();
  if (r.width > 0 && r.height > 0 && Math.abs(r.width - window.innerWidth) > 2) return { w: r.width, h: r.height };
  return { w: window.innerWidth, h: window.innerHeight };
}

// ---------- sprites ----------
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}
function mirror(src) {
  const c = canvas(src.width, src.height);
  const x = c.getContext("2d");
  x.translate(src.width, 0);
  x.scale(-1, 1);
  x.drawImage(src, 0, 0);
  return c;
}
function silhouette(src, color) {
  const c = canvas(src.width, src.height);
  const x = c.getContext("2d");
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}
// Nearest-neighbor rotation by `deg` (clockwise on screen) around the sprite's center, on raw
// pixels into an R×R canvas (R = the sprite's diagonal), so the result stays on the pixel grid.
function rotateNN(data, w, h, deg) {
  const R = Math.ceil(Math.hypot(w, h)) | 1;
  const out = canvas(R, R);
  const octx = out.getContext("2d");
  const od = octx.createImageData(R, R);
  const s32 = new Uint32Array(data.data.buffer), o32 = new Uint32Array(od.data.buffer);
  const a = (deg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const cx = w / 2, cy = h / 2, oc = R / 2;
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const dx = x + 0.5 - oc, dy = y + 0.5 - oc;
      // inverse rotation: destination → source
      const sx = Math.floor(ca * dx + sa * dy + cx), sy = Math.floor(-sa * dx + ca * dy + cy);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const v = s32[sy * w + sx];
      if (v >>> 24 < 128) continue;
      o32[y * R + x] = v | 0xff000000;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

export async function loadSprite(id) {
  if (SPR_CACHE.has(id)) return SPR_CACHE.get(id);
  const rec = { id, ok: false, w: 24, h: 24, L: null, R: null, WL: null, WR: null, dL: null, dR: null, rot: new Map(), sil: new Map() };
  SPR_CACHE.set(id, rec);
  const img = await loadImage(`sprites/pixel/${id}.png`);
  if (!img) return rec;
  const c = canvas(img.width, img.height);
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let xx = 0; xx < c.width; xx++) {
      const i = (y * c.width + xx) * 4 + 3;
      if (d.data[i] >= 128) {
        d.data[i] = 255;
        if (xx < x0) x0 = xx;
        if (xx > x1) x1 = xx;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      } else d.data[i] = 0;
    }
  x.putImageData(d, 0, 0);
  if (x1 < 0) return rec;
  const t = canvas(x1 - x0 + 1, y1 - y0 + 1);
  t.getContext("2d").drawImage(c, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
  // native facing: L (most FRLG front sprites look left), R, or F
  const f = monFacing(id);
  const left = f === "R" ? mirror(t) : t;
  rec.L = left;
  rec.R = mirror(left);
  rec.WL = silhouette(rec.L, "#ffffff");
  rec.WR = silhouette(rec.R, "#ffffff");
  rec.w = t.width;
  rec.h = t.height;
  rec.dL = rec.L.getContext("2d").getImageData(0, 0, rec.w, rec.h);
  rec.dR = rec.R.getContext("2d").getImageData(0, 0, rec.w, rec.h);
  rec.ok = true;
  // pre-warm the rotations big moments use (lying, dive arc, tumble), so they never hitch
  for (const deg of [90, -90, 45, -45]) {
    rotated(rec, false, deg, false);
    rotated(rec, true, deg, false);
  }
  return rec;
}
export function getSprite(id) {
  return SPR_CACHE.get(id);
}
function rotated(rec, facingRight, deg, white) {
  deg = ((Math.round(deg / 15) * 15) % 360 + 360) % 360;
  const key = (white ? 2000 : 0) + (facingRight ? 1000 : 0) + deg;
  let c = rec.rot.get(key);
  if (!c) {
    if (white) c = silhouette(rotated(rec, facingRight, deg, false), "#ffffff");
    else c = rotateNN(facingRight ? rec.dR : rec.dL, rec.w, rec.h, deg);
    rec.rot.set(key, c);
  }
  return c;
}
// The sprite with a 1-px outline in the team's kit color (4-neighbour dilation of its silhouette):
// in a scrum every body's edge says which side it is on. Cached per sprite × color × facing.
function outlined(rec, color, right) {
  let o = rec.out || (rec.out = new Map());
  let e = o.get(color);
  if (!e) {
    const make = (src) => {
      const c = canvas(src.width + 2, src.height + 2);
      const x = c.getContext("2d");
      const sil = silhouette(src, color);
      x.drawImage(sil, 0, 1);
      x.drawImage(sil, 2, 1);
      x.drawImage(sil, 1, 0);
      x.drawImage(sil, 1, 2);
      x.drawImage(src, 1, 1);
      return c;
    };
    e = { L: make(rec.L), R: make(rec.R) };
    o.set(color, e);
  }
  return right ? e.R : e.L;
}
function kitSil(rec, color, right) {
  let s = rec.sil.get(color);
  if (!s) rec.sil.set(color, (s = { L: silhouette(rec.L, color), R: silhouette(rec.R, color) }));
  return right ? s.R : s.L;
}

// ---------- pixel primitives ----------
const ELL = new Map();
function ellipseSpans(rx, ry) {
  const key = rx * 100 + ry;
  let s = ELL.get(key);
  if (s) return s;
  s = [];
  for (let dy = -ry; dy <= ry; dy++) {
    const t = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5));
    s.push([dy, Math.floor(rx * Math.sqrt(Math.max(0, t)) + 0.5)]);
  }
  ELL.set(key, s);
  return s;
}
export function fillEllipse(ctx, cx, cy, rx, ry) {
  const sp = ellipseSpans(rx, ry);
  for (let i = 0; i < sp.length; i++) {
    const hw = sp[i][1];
    if (hw > 0) ctx.fillRect(cx - hw, cy + sp[i][0], hw * 2 + 1, 1);
  }
}
// 1-px pixel ellipse outline (rows joined so there are no gaps on steep parts).
export function ringEllipse(ctx, cx, cy, rx, ry) {
  const sp = ellipseSpans(rx, ry);
  for (let i = 0; i < sp.length; i++) {
    const [dy, hw] = sp[i];
    if (hw <= 0 && i !== 0 && i !== sp.length - 1) continue;
    const nb = Math.max(i > 0 ? sp[i - 1][1] : -1, i < sp.length - 1 ? sp[i + 1][1] : -1);
    if (i === 0 || i === sp.length - 1 || nb < 0) {
      ctx.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
      continue;
    }
    const w = Math.max(1, hw - nb);
    ctx.fillRect(cx - hw, cy + dy, w, 1);
    ctx.fillRect(cx + hw - w + 1, cy + dy, w, 1);
  }
}
// Pre-drawn pixel masks, cached under numeric keys (no per-frame string building).
const CACHE = new Map();
const COLOR_ID = new Map();
const colorId = (c) => {
  let i = COLOR_ID.get(c);
  if (i === undefined) COLOR_ID.set(c, (i = COLOR_ID.size + 1));
  return i;
};
function cached(key, w, h, draw) {
  let c = CACHE.get(key);
  if (!c) {
    c = canvas(w, h);
    draw(c.getContext("2d"));
    CACHE.set(key, c);
  }
  return c;
}
// Dithered (checkerboard core + sparse edge) shadow ellipse.
function shadowCanvas(rx, ry, color = "#0b2410") {
  return cached(1e9 + colorId(color) * 1e5 + rx * 100 + ry, rx * 2 + 1, ry * 2 + 1, (x) => {
    x.fillStyle = color;
    for (const [dy, hw] of ellipseSpans(rx, ry)) {
      for (let xx = -hw; xx <= hw; xx++) {
        const core = Math.abs(xx) < hw * 0.6 && Math.abs(dy) < ry * 0.7;
        if (core || ((xx + dy) & 1) === 0) x.fillRect(rx + xx, ry + dy, 1, 1);
      }
    }
  });
}
// Team base: dark outline, trim ring, kit fill, top highlight, bottom shade.
function baseCanvas(kit, rx, ry) {
  return cached(2e9 + (colorId(kit.base) * 512 + colorId(kit.trim)) * 1e4 + rx * 100 + ry, rx * 2 + 5, ry * 2 + 5, (x) => {
    const cx = rx + 2, cy = ry + 2;
    x.fillStyle = "#0b0d14";
    fillEllipse(x, cx, cy + 1, rx + 2, ry + 1);
    fillEllipse(x, cx, cy, rx + 2, ry + 2);
    x.fillStyle = kit.trim;
    fillEllipse(x, cx, cy, rx + 1, ry + 1);
    x.fillStyle = kit.base;
    fillEllipse(x, cx, cy, rx, ry);
    x.fillStyle = kit.rim;
    for (const [dy, hw] of ellipseSpans(rx, ry)) if (dy >= ry - 1 && hw > 0) x.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
    x.fillStyle = kit.hi;
    const top = ellipseSpans(rx, ry)[1];
    if (top) x.fillRect(cx - (top[1] >> 1), cy + top[0], top[1] + 1, 1);
  });
}
// The human's ring: marching-ants dashes around the base (phase steps at ~10 Hz).
function userRing(rx, ry, phase) {
  return cached(3e9 + rx * 1e4 + ry * 100 + phase, rx * 2 + 3, ry * 2 + 3, (x) => {
    const N = Math.max(24, Math.round((rx + ry) * 2.4));
    for (let i = 0; i < N; i++) {
      const on = ((i + phase) >> 1) % 3 !== 0;
      const a = (i / N) * Math.PI * 2;
      const px = Math.round(rx + 1 + Math.cos(a) * rx), py = Math.round(ry + 1 + Math.sin(a) * ry);
      x.fillStyle = on ? "#ffd23f" : "#0b0d14";
      x.fillRect(px, py, 1, 1);
      if (on && Math.sin(a) > 0.3) {
        x.fillStyle = "#c99a12";
        x.fillRect(px, py + 1, 1, 1);
      }
    }
  });
}
export function bresenham(ctx, x0, y0, x1, y1, w = 1) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 4000; n++) {
    ctx.fillRect(x0, y0, w, w);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------- the ball: a 9×5 pixel football, 4 axis angles × 4 spiral frames ----------
const BALL_O = "#2a1206", BALL_B = "#6e3410", BALL_H = "#a8561e", BALL_L = "#d68a44", BALL_W = "#fbf6ea";
let BALLS = null, BIG_BALLS = null;
// small: 9×5 (held, low passes); big: 13×7 (a ball high in the air is closer to the camera —
// a bigger hand-drawn ball, still 1:1 pixels, never a scaled sprite)
export function ballFrames(big = false) {
  if (!BALLS) {
    BALLS = makeBalls(13, 4.4, 2.45);
    BIG_BALLS = makeBalls(17, 6.2, 3.3);
  }
  return big ? BIG_BALLS : BALLS;
}
function makeBalls(N, A, Bx) {
  const out = [];
  for (let ai = 0; ai < 4; ai++) {
    const ang = (ai * 45 * Math.PI) / 180;
    const row = [];
    for (let sp = 0; sp < 4; sp++) {
      const cxy = (N - 1) / 2;
      const c = canvas(N, N);
      const g = c.getContext("2d");
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const tip = A * 0.75, laceL = A * 0.45, laceW = Bx > 3 ? 0.7 : 0.55;
      const inside = (x, y) => {
        const dx = x - cxy, dy = y - cxy;
        const u = dx * ca - dy * sa, v = dx * sa + dy * ca;
        return (u * u) / (A * A) + (v * v) / (Bx * Bx) <= 1;
      };
      const lace = sp === 3 ? null : sp - 1; // spiral: laces roll over the top, then out of view
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          if (!inside(x, y)) {
            if (inside(x + 1, y) || inside(x - 1, y) || inside(x, y + 1) || inside(x, y - 1)) {
              g.fillStyle = BALL_O;
              g.fillRect(x, y, 1, 1);
            }
            continue;
          }
          const dx = x - cxy, dy = y - cxy;
          const u = dx * ca - dy * sa, v = dx * sa + dy * ca;
          const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
          let col = edge ? BALL_B : v < -Bx * 0.37 ? BALL_L : BALL_H;
          if (Math.abs(u) > tip && !edge) col = BALL_B; // the dark tips
          if (lace != null && Math.abs(v - lace * Bx * 0.37) < laceW && Math.abs(u) < laceL && !edge) col = BALL_W;
          g.fillStyle = col;
          g.fillRect(x, y, 1, 1);
        }
      }
      row.push(c);
    }
    out.push(row);
  }
  return out;
}

// Kept for older callers: the field + stands canvas for an offense/defense pair (clear-day mood).
export function buildField(offTeam, defTeam) {
  const kit = (t) => ({ base: t.color || t.primary, trim: t.color2 || t.secondary || "#f6f6f2", primary: t.primary || t.color, secondary: t.secondary || t.color2 || "#f6f6f2" });
  return buildStadium(offTeam, defTeam, { off: kit(offTeam), def: kit(defTeam) }, { ...MOODS.clear, name: "clear", gym: null }).canvas;
}

// ---------- the renderer ----------
export class Renderer {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d", { alpha: false });
    this.buf = document.createElement("canvas");
    this.b = this.buf.getContext("2d");
    this.fields = new Map();
    this.order = [];
    // per-player pose state, keyed by Player objects: a WeakMap, so finished games' players go
    // with their world (a Map grew ~48 entries per game and was never cleared)
    this.poses = new WeakMap();
    this.hudArt = 32; // buffer px under the top HUD (set every frame from hudBottomCss; see render)
    this.lastCarrier = null; // the last ball carrier this play (banner placement after the whistle)
    this.wrongWayPlay = null; // the play that already got its WRONG WAY! pop
    this.S = 1; // device px per art px (base, WIDE)
    this.k = 1; // backing supersample (2 when S = 1, so the pixel grid is auditable)
    this.s = 1; // backing px per art px
    this.dpr = 1;
    this.vw = 1;
    this.vh = 1;
    this.cssPerArt = 1;
    this.frame = 0;
    this._view = { w: 1, h: 1, s: 1 };
    this.resize();
  }
  // the canvas no longer covers the visible viewport (a size change no resize event reported)
  stale() {
    const v = viewSize();
    return Math.max(1, Math.round(v.w)) !== parseFloat(this.canvas.style.width) || Math.max(1, Math.round(v.h)) !== parseFloat(this.canvas.style.height);
  }
  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const v = viewSize();
    const cssW = Math.max(1, Math.round(v.w)), cssH = Math.max(1, Math.round(v.h));
    const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
    this.S = chooseScale(devW, devH);
    this.k = this.S === 1 ? Math.max(2, CFG.MIN_BACKING_SCALE || 2) : 1;
    this.s = this.S * this.k;
    this.canvas.width = devW * this.k;
    this.canvas.height = devH * this.k;
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    this.cssPerArt = this.S / dpr;
    this.baseVW = Math.ceil(this.canvas.width / this.s);
    this.baseVH = Math.ceil(this.canvas.height / this.s);
    this.buf.width = this.baseVW;
    this.buf.height = this.baseVH;
    this.ctx.imageSmoothingEnabled = false;
    this.b.imageSmoothingEnabled = false;
    this.vw = this.baseVW;
    this.vh = this.baseVH;
  }
  // The buffer view for a zoom level (whole steps of the integer scale; CLOSE camera, punch-in).
  view(zoom = 0) {
    const s = (this.S + Math.max(0, zoom | 0)) * this.k;
    const v = this._view;
    v.s = s;
    v.w = Math.ceil(this.canvas.width / s);
    v.h = Math.ceil(this.canvas.height / s);
    return v;
  }
  // Both field orientations (either team on offense) up front, so possession changes never hitch.
  prebuild(world) {
    for (const o of ["home", "away"]) this.fieldFor(world, o);
    // pre-warm the outlined sprites so the first snap never hitches
    const kits = kitsFor(world);
    for (const t of ["home", "away"]) {
      for (const p of world.teams[t].all) {
        const rec = getSprite(p.id);
        if (rec && rec.ok) {
          outlined(rec, kits[t].line, true);
          outlined(rec, kits[t].line, false);
        }
      }
    }
  }
  fieldFor(world, offense = world.offense) {
    const fc = this._fc || (this._fc = { world: null, home: null, away: null });
    if (fc.world === world && fc[offense]) return fc[offense];
    if (fc.world !== world) {
      fc.world = world;
      fc.home = fc.away = null;
    }
    return (fc[offense] = this.buildFieldFor(world, offense));
  }
  buildFieldFor(world, offense) {
    const defense = offense === "home" ? "away" : "home";
    const off = world.teams[offense].data, def = world.teams[defense].data;
    const kits = kitsFor(world);
    const mood = moodFor(world);
    const key = `${off.key}|${def.key}|${kits[offense].base}|${kits[defense].base}|${mood.name}`;
    let f = this.fields.get(key);
    if (!f) {
      f = buildStadium(off, def, { off: kits[offense], def: kits[defense] }, mood);
      f.mood = mood;
      this.fields.set(key, f);
      if (this.fields.size > 4) this.fields.delete(this.fields.keys().next().value);
    }
    return f;
  }
  pose(p) {
    let ps = this.poses.get(p);
    if (!ps) this.poses.set(p, (ps = makePose()));
    return ps;
  }

  // Draws a frame. zoom: whole extra steps of the integer scale (camera setting + punch-in).
  render(world, cam, fx, zoom = 0) {
    this.frame++;
    const v = this.view(zoom);
    const s = v.s, vw = v.w, vh = v.h;
    this.vw = vw;
    this.vh = vh;
    this.cssPerArt = s / this.k / this.dpr;
    // in-world marks keep about the same on-screen size on every device
    this.mk = Math.max(1, Math.min(3, Math.round(3.2 / Math.max(0.5, this.cssPerArt))));
    // the top HUD (scorebug, plus the ticker while it shows): ui reports its bottom edge in CSS px
    // as renderer.hudBottomCss (64 until it does). The camera centers the play in the area below
    // it; banners, pop-ups and target numbers stay under it.
    this.hudArt = Math.ceil((Number.isFinite(this.hudBottomCss) ? this.hudBottomCss : 64) / Math.max(0.5, this.cssPerArt));
    cam.hudPx = this.hudArt;
    if (fx) fx.safeTop = this.hudArt + 3;
    const b = this.b;
    const ox = cam.ix, oy = cam.iy;
    const kits = kitsFor(world);
    // field + stands
    const field = this.fieldFor(world);
    b.fillStyle = "#0b0d1c";
    b.fillRect(0, 0, vw, vh);
    b.drawImage(field.canvas, -ox, -oy);
    this.drawStandsLive(field, fx, ox, oy, vw, vh);
    if (fx && field.flashSky && oy < LAYOUT.SKY_H) {
      const lp = fx.lightningPhase();
      if (lp === 2) b.drawImage(field.flashSky, -ox, -oy);
      else if (lp === 1) {
        b.fillStyle = fx.pattern(b, "#a6b6ee", 4);
        b.fillRect(0, 0, vw, LAYOUT.SKY_H - oy - 12);
      }
    }
    if (fx) fx.drawSky(b, ox, oy, vw, vh);
    const t = world.time;
    const ph = world.phase;
    // touchdown: the end zone flashes the scoring team's color (dithered, stepped at 8 Hz)
    if (fx && fx.ezFlash > 0 && fx.ezTeam) {
      const kit = kits[fx.ezTeam];
      const from = fx.ezLeft ? -10 : 100;
      const x0 = Math.round(wx(from)) - ox, x1 = Math.round(wx(from + 10)) - ox;
      const y0 = Math.round(wy(0)) - oy;
      const on = (((fx.clock * 8) | 0) & 1) === 0;
      if (on) {
        // the end zone lights up (pre-rendered brighter copy), stepped at 8 Hz
        const lit = fx.ezLeft ? field.ezLeft : field.ezRight;
        b.drawImage(lit, (fx.ezLeft ? field.ezLeftX : field.ezRightX) - ox, field.ezY - oy);
      }
      // the scoring team's color lights the end zone's frame
      b.fillStyle = on ? kit.base : kit.trim;
      b.fillRect(x0, y0, x1 - x0, 3);
      b.fillRect(x0, y0 + FIELD_H_PX - 3, x1 - x0, 3);
      b.fillRect(x0, y0, 3, FIELD_H_PX);
      b.fillRect(x1 - 3, y0, 3, FIELD_H_PX);
    }
    // lines of scrimmage / first down + the chain crew on the far sideline
    if (ph === "PRE_SNAP" || ph === "LIVE" || ph === "PLAY_CALL") {
      const top = Math.round(wy(0)) - oy + 2, h = FIELD_H_PX - 4;
      const play = world.play;
      if (!(ph === "LIVE" && play && play.kick)) {
        b.fillStyle = "#0b2a6e";
        b.fillRect(Math.round(wx(world.los)) - ox, top, 1, h);
        b.fillStyle = PAL.los;
        b.fillRect(Math.round(wx(world.los)) - ox - 1, top, 1, h);
        if (world.firstDownX < 100) {
          b.fillStyle = "#a07c10";
          b.fillRect(Math.round(wx(world.firstDownX)) - ox, top, 1, h);
          b.fillStyle = PAL.first;
          b.fillRect(Math.round(wx(world.firstDownX)) - ox - 1, top, 1, h);
        }
      }
      // no chain crew on kickoffs (the LOS is the kicking spot) or on 2-point tries
      if (!(play && (play.kick === "kickoff" || play.tryMode))) this.drawChains(world, ox, oy);
    }
    if (fx) fx.drawGround(b, ox, oy, vw, vh);
    // depth sort players by y (insertion sort, no allocations)
    const ord = this.order;
    ord.length = 0;
    for (const p of world.players) ord.push(p);
    for (let i = 1; i < ord.length; i++) {
      const v2 = ord[i];
      let j = i - 1;
      while (j >= 0 && ord[j].y > v2.y) {
        ord[j + 1] = ord[j];
        j--;
      }
      ord[j + 1] = v2;
    }
    const ball = world.ball;
    // the ball carrier and the human's player are never buried: drawn after the depth-sorted
    // crowd (the human first, then the carrier and his ball on top of everyone)
    const carrier = ball.state === "held" && ball.carrier ? ball.carrier : null;
    const user = world.userPlayer && !world.autoplay ? world.userPlayer : null;
    // (kept through the play and its whistle only, and never across games)
    if (carrier) this.lastCarrier = carrier;
    else if ((ph !== "LIVE" && ph !== "DEAD") || this.lcWorld !== world) this.lastCarrier = null;
    this.lcWorld = world;
    // shadows + bases first (always under everyone), then the human's and the carrier's rings
    for (const p of ord) this.drawBase(world, kits, p, ox, oy, t);
    this.drawRings(world, kits, user, carrier, ox, oy, t);
    this.drawBallShadow(world, ox, oy);
    for (const p of ord) if (p !== carrier && p !== user) this.drawPlayer(world, kits, p, ox, oy, t, fx);
    if (user && user !== carrier) this.drawPlayer(world, kits, user, ox, oy, t, fx);
    if (carrier) this.drawPlayer(world, kits, carrier, ox, oy, t, fx);
    // goalposts; a kick that has crossed the end line goes behind them ("through the uprights")
    const behind = ball.state === "air" && (ball.kind === "fg" || ball.kind === "pat") && ball.x > 110;
    if (behind) this.drawBall(world, ox, oy, t);
    this.drawPosts(world, ox, oy, fx);
    if (!behind) this.drawBall(world, ox, oy, t);
    if (fx) {
      fx.cssPerArt = this.cssPerArt;
      fx.drawWorld(b, ox, oy, vw, vh);
    }
    if (fx) fx.drawWeather(b, ox, oy, vw, vh);
    this.drawOverlays(world, ox, oy, t, fx);
    if (fx) {
      // banners keep clear of the play: tell fx where the play is on screen. A dead or loose ball
      // (an incompletion lying downfield) isn't the play: the last carrier (the pile) is, or the
      // ball spot at the line of scrimmage.
      let fyy;
      if (ph !== "DEAD" && carrier) fyy = wy(carrier.y) - 20;
      else if (ph !== "DEAD" && ball.state === "air") fyy = wy(ball.y) - Math.max(0, ball.z) * ZPX;
      else if (this.lastCarrier) fyy = wy(this.lastCarrier.y) - 20;
      else fyy = wy(world.ballY != null ? world.ballY : ball.y);
      fx.drawScreen(b, vw, vh, Math.round(fyy) - oy);
    }
    // blit
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.buf, 0, 0, vw, vh, 0, 0, vw * s, vh * s);
  }

  // Crowd cheer frames (toggled at a stepped ~8 Hz) and the Cinnabar heat shimmer.
  drawStandsLive(field, fx, ox, oy, vw, vh) {
    const b = this.b;
    const L = LAYOUT;
    if (fx && fx.mood && fx.weatherOn && fx.mood.weather === "embers" && oy < L.CROWD_Y) {
      // heat shimmer: the sky and the upper deck wobble a pixel, row band by row band
      const ph = (fx.clock * 10) | 0;
      for (let y = 0; y < L.CROWD_Y; y += 3) {
        const off = ((y >> 1) + ph) % 4 === 0 ? 1 : ((y >> 1) + ph) % 4 === 2 ? -1 : 0;
        if (off) b.drawImage(field.canvas, Math.max(0, ox), y, Math.min(vw, FIELD_PX_W - Math.max(0, ox)), 3, Math.max(0, -ox) + off, y - oy, Math.min(vw, FIELD_PX_W - Math.max(0, ox)), 3);
      }
    }
    // flashbulbs: on big moments cameras pop all over the stands (1-frame white pixels)
    if (fx && fx.cheer > 1.1 && oy < L.WALL_Y) {
      const n = Math.min(14, Math.round(fx.cheer * 4));
      const f = this.frame;
      b.fillStyle = "#ffffff";
      for (let i = 0; i < n; i++) {
        const h = (((f * 2654435761) ^ (i * 40503)) >>> 0) % 100000;
        const x = (h * 7) % vw, y = L.CROWD_Y + ((h >> 3) % (L.ROWS * L.ROW_H)) - oy;
        if (y < 0 || y >= vh) continue;
        b.fillRect(x, y, 1, 1);
        if (i & 1) { b.fillRect(x - 1, y, 3, 1); b.fillRect(x, y - 1, 1, 3); }
      }
    }
    if (!fx || fx.cheer < 0.22 || (((fx.clock * 8) | 0) & 1) === 0) return;
    const sx = Math.max(0, ox), w = Math.min(vw, FIELD_PX_W - sx);
    if (w <= 0) return;
    const ty = field.cheerTopY - oy;
    if (ty + field.cheerTop.height > 0 && ty < vh) b.drawImage(field.cheerTop, sx, 0, w, field.cheerTop.height, sx - ox, ty, w, field.cheerTop.height);
    const by = field.cheerBotY - oy;
    if (by + field.cheerBot.height > 0 && by < vh) b.drawImage(field.cheerBot, sx, 0, w, field.cheerBot.height, sx - ox, by, w, field.cheerBot.height);
  }

  // Down marker + chain on the far sideline (broadcast detail).
  drawChains(world, ox, oy) {
    const b = this.b;
    const Y = Math.round(wy(-0.75)) - oy;
    if (Y < -30 || Y > this.vh + 10) return;
    const x0 = Math.round(wx(world.los)) - ox;
    const x1 = world.firstDownX < 100 ? Math.round(wx(world.firstDownX)) - ox : null;
    if (x1 != null) {
      b.fillStyle = "#d8d8d0";
      for (let x = x0; x <= x1; x += 2) b.fillRect(x, Y - 10, 1, 1);
      for (let k = 0; k < 2; k++) {
        const x = k ? x1 : x0;
        b.fillStyle = "#0b0d14";
        b.fillRect(x - 1, Y - 12, 3, 13);
        b.fillStyle = "#ff5a1a";
        b.fillRect(x, Y - 11, 1, 11);
        b.fillStyle = "#ffffff";
        b.fillRect(x, Y - 11, 1, 2);
      }
    }
    // the down box
    const dx = x0 + 6;
    b.fillStyle = "#0b0d14";
    b.fillRect(dx - 1, Y - 21, 9, 11);
    b.fillRect(dx + 3, Y - 11, 1, 12);
    b.fillStyle = "#ff7a1a";
    b.fillRect(dx, Y - 20, 7, 9);
    b.drawImage(this.digit(Math.max(1, Math.min(4, world.down)), 1, "#0b0d14", true), dx + 2, Y - 18);
  }

  drawBase(world, kits, p, ox, oy, t) {
    const rec = getSprite(p.id);
    const w = rec && rec.ok ? rec.w : 24;
    const X = Math.round(wx(p.x)) - ox, Y = Math.round(wy(p.y)) - oy;
    if (X < -60 || Y < -80 || X > this.vw + 60 || Y > this.vh + 60) return;
    const b = this.b;
    const rx = Math.max(7, Math.min(13, Math.round(w * 0.27))), ry = Math.max(3, Math.round(rx * 0.42));
    const lying = p.state === "tackled" || p.downUntil > t || p.anim.state === "pile";
    const sh = shadowCanvas(lying ? rx + 6 : rx + 3, ry + 1);
    b.drawImage(sh, X - (sh.width >> 1) + 2, Y - (sh.height >> 1) + 1);
    if (lying) return;
    const base = baseCanvas(kits[p.team], rx, ry);
    b.drawImage(base, X - rx - 2, Y - ry - 2);
  }
  // Ground rings drawn above every base (a lower player's base never cuts them): the human's
  // marching ants, and the ball carrier's stepped team-colored pulse (a ping that grows in three
  // whole-pixel steps: white → trim → kit) — the ball is always easy to find in a crowd.
  drawRings(world, kits, user, carrier, ox, oy, t) {
    const b = this.b;
    for (let k = 0; k < 2; k++) {
      const p = k ? carrier : user;
      if (!p || (k && p === user)) continue; // the human carrier keeps his yellow ring
      if (p.state === "tackled" || p.downUntil > t || p.anim.state === "pile") continue;
      const X = Math.round(wx(p.x)) - ox, Y = Math.round(wy(p.y)) - oy;
      if (X < -60 || Y < -80 || X > this.vw + 60 || Y > this.vh + 60) continue;
      const rec = getSprite(p.id);
      const w = rec && rec.ok ? rec.w : 24;
      const rx = Math.max(7, Math.min(13, Math.round(w * 0.27))), ry = Math.max(3, Math.round(rx * 0.42));
      if (!k) {
        const ring = userRing(rx + 5, ry + 3, ((t * 10) | 0) % 6);
        b.drawImage(ring, X - rx - 6, Y - ry - 4);
        continue;
      }
      const kit = kits[p.team];
      const st = ((t * 7) | 0) % 3;
      const R = rx + 4 + st * 2, Ry = ry + 2 + st;
      b.fillStyle = "#0b0d14";
      ringEllipse(b, X, Y + 1, R, Ry);
      b.fillStyle = st === 0 ? "#ffffff" : st === 1 ? kit.trim : kit.base;
      ringEllipse(b, X, Y, R, Ry);
    }
  }

  drawPlayer(world, kits, p, ox, oy, t, fx) {
    const rec = getSprite(p.id);
    if (!rec || !rec.ok) return;
    const X = Math.round(wx(p.x)) - ox, Y = Math.round(wy(p.y)) - oy;
    if (X < -70 || Y < -90 || X > this.vw + 70 || Y > this.vh + 90) return;
    const ps = poseFor(p, t, this.pose(p));
    if (ps.hidden) return;
    const b = this.b;
    const right = p.facing > 0;
    const kit = kits[p.team];
    // afterimages at top speed (ball carriers, the human's player, anyone flat out): up to three
    // kit-colored ghosts, stepped alpha
    const trail = p.anim.trail;
    const star = (world.ball.state === "held" && world.ball.carrier === p) || (p.isUser && !world.autoplay);
    if (star && trail.length >= 3 && ps.sprint > 0.84 && !ps.lying && !ps.rot) {
      for (let i = trail.length - 3, n = 0; i >= 0; i -= 3, n++) {
        const tx = Math.round(wx(trail[i])) - ox, ty = Math.round(wy(trail[i + 1])) - oy;
        if (Math.abs(tx - X) + Math.abs(ty - Y) < 5) continue;
        b.globalAlpha = i === 0 ? 0.5 : i === 3 ? 0.32 : 0.18;
        const img = kitSil(rec, kit.ghost, trail[i + 2] > 0);
        b.drawImage(img, tx - (img.width >> 1), ty - img.height + 2 + ps.oy);
      }
      b.globalAlpha = 1;
    }
    // hit flash: white silhouette, flickering every 2 frames (it would otherwise hold for the
    // whole hit-stop freeze and read as a white blob)
    if (ps.flash && ((this.frame >> 1) & 1)) ps.flash = false;
    let img = right ? rec.R : rec.L;
    if (ps.flash) img = right ? rec.WR : rec.WL;
    if (ps.lying || ps.rot) {
      const deg = ps.lying || ps.rot;
      // spin afterimages: the two previous steps of the spin, ghosted
      if (ps.spin) {
        const dir = right ? 1 : -1;
        for (let k = 2; k >= 1; k--) {
          const g = rotated(rec, right, deg - dir * 45 * k, false);
          b.globalAlpha = k === 2 ? 0.2 : 0.42;
          b.drawImage(g, X - (g.width >> 1) - dir * 3 * k, Y - Math.round(rec.h / 2) - (g.height >> 1) + 2 + ps.oy);
        }
        b.globalAlpha = 1;
      }
      const r = rotated(rec, right, deg, ps.flash);
      let ry;
      if (ps.lying) {
        // lying: the rotated sprite's content is rec.w tall; rest it on the ground point
        const dh = Math.max(1, Math.round(rec.w * (1 - (ps.flat || 0))));
        if (dh !== rec.w) {
          // pancaked: flattened (whole-pixel vertical squash of the rotated sprite)
          const top = (r.height - rec.w) >> 1;
          b.drawImage(r, 0, top, r.width, rec.w, X - (r.width >> 1) + ps.ox, Y + 3 - dh + ps.oy, r.width, dh);
          ps.sx0 = X;
          ps.top = Y + 3 - dh + ps.oy;
          ps.drawn = this.frame;
          return;
        }
        ry = Y + 3 - ((r.height + rec.w) >> 1);
      } else ry = Y - Math.round(rec.h / 2) - (r.height >> 1) + 2;
      if (ps.alpha < 1) b.globalAlpha = ps.alpha;
      b.drawImage(r, X - (r.width >> 1) + ps.ox, ry + ps.oy);
      b.globalAlpha = 1;
      if (p.hasBall && world.ball.state === "held" && world.ball.carrier === p && !(fx && fx.spike && fx.spike.by === p)) this.drawHeldBall(X + (right ? 4 : -4), Y - 4 + ps.oy);
      ps.sx0 = X;
      ps.top = ps.lying ? Y + 3 - rec.w + ps.oy : Y - rec.h + ps.oy;
      ps.drawn = this.frame;
      return;
    }
    if (!ps.flash && OUTLINE) img = outlined(rec, kit.line, right);
    const dw = Math.max(1, Math.round(img.width * ps.sx)), dh = Math.max(1, Math.round(img.height * ps.sy));
    const dx = X - (dw >> 1) + ps.ox, dy = Y - dh + (img.height > rec.h ? 3 : 2) + ps.oy;
    const lean = ps.lean * (right ? 1 : -1);
    if (ps.alpha < 1) b.globalAlpha = ps.alpha;
    if (lean === 0) {
      b.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
    } else {
      // whole-pixel shear: three horizontal bands shifted toward the lean
      const h3 = Math.ceil(img.height / 3), d3 = Math.ceil(dh / 3);
      for (let k = 0; k < 3; k++) {
        const sy = k * h3, sh = Math.min(h3, img.height - sy);
        const ddy = k * d3, ddh = Math.min(d3, dh - ddy);
        if (sh <= 0 || ddh <= 0) continue;
        const off = Math.round((lean * (2 - k)) / 2);
        b.drawImage(img, 0, sy, img.width, sh, dx + off, dy + ddy, dw, ddh);
      }
    }
    b.globalAlpha = 1;
    // ball in hand (tucked on the facing side) — gone once a TD scorer has spiked it
    if (p.hasBall && world.ball.state === "held" && world.ball.carrier === p && !(fx && fx.spike && fx.spike.by === p)) {
      this.drawHeldBall(X + (right ? 5 : -5) + ps.ox, dy + Math.round(dh * 0.56));
    }
    ps.sx0 = X;
    ps.top = dy;
    ps.drawn = this.frame;
  }
  // the receiver boxes' labels for the player's bindings (bindings.js) and the controller's look (padStyle "ps":
  // PlayStation symbols); key[i] null = his number. Rebuilt only when either changes.
  recLabels() {
    const v = BIND.ver * 2 + (this.padStyle === "ps" ? 1 : 0);
    if (this.recV === v) return this.recL;
    this.recV = v;
    const PS = { A: "\u2715", B: "\u25cb", X: "\u25a1", Y: "\u25b3", LB: "L1", RB: "R1", LT: "L2", RT: "R2", BACK: "SH" };
    const word = { ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT" };
    this.recL = {
      pad: BIND.recPad.map((l) => { const n = l.length ? PAD_GLYPH[l[0]] : "-"; return this.padStyle === "ps" && PS[n] ? PS[n] : n; }),
      key: [1, 2, 3, 4, 5].map((n) => { const k = BIND.kb[`rec${n}`][0]; return k === `Digit${n}` ? null : k ? word[k] || keyCap(k) : "-"; }),
    };
    return this.recL;
  }
  // cached digit canvases for the per-frame marks (no text rasterizing in the frame loop)
  // a controller button's name (X, Y, LB, RB, RT) in the 5×7 font, cached like the digits
  label(str, scale, color) {
    const key = `${str}|${scale}|${color}`;
    const d = this.labels || (this.labels = new Map());
    let c = d.get(key);
    if (!c) d.set(key, (c = textCanvas(str, scale, color)));
    return c;
  }
  digit(n, scale, color, tiny) {
    const key = n * 1000 + scale * 100 + (tiny ? 50 : 0) + (color === "#0b0d14" ? 1 : 2);
    const d = this.digits || (this.digits = new Map());
    let c = d.get(key);
    if (!c) d.set(key, (c = textCanvas(String(n), scale, color, { tiny })));
    return c;
  }
  drawHeldBall(x, y) {
    const f = ballFrames()[0][1];
    this.b.drawImage(f, x - 6, y - 6);
  }
  drawUserArrow(X, top, t) {
    const b = this.b;
    const m = this.mk;
    const bob = (((t * 4) | 0) % 2) * m;
    const y = top - 10 * m - bob;
    // a chunky down arrow (one size up from the old 7-wide one, so he's found in a crowd at a
    // glance): dark outline, yellow fill, light top edge
    const rows = USER_ARROW;
    for (let i = 0; i < rows.length; i++) {
      const w = rows[i] * m;
      b.fillStyle = "#0b0d14";
      b.fillRect(X - (w >> 1) - 1, y + i * m - 1, w + 2, m + 2);
    }
    for (let i = 0; i < rows.length; i++) {
      const w = rows[i] * m;
      b.fillStyle = i === 0 ? "#fff3c4" : PAL.yellow;
      b.fillRect(X - (w >> 1), y + i * m, w, m);
    }
  }

  // The human receiving a punt: a blinking ◀◀ just left of his feet (the return goes toward
  // x = 0), from the snap until he has 10 yards on the return or is down; with one WRONG WAY!
  // pop per play if he carries it back toward his own goal line inside his 10.
  drawPuntReturnHint(world, up, ox, oy, t, fx) {
    const play = world.play, ball = world.ball;
    if (!play || world.phase !== "LIVE") return;
    const ret = play.ret;
    let show = false;
    if (!ret) show = play.kick === "punt" && up.team === world.defense;
    else if (ret.kind === "punt" && ball.state === "held" && ball.carrier === up && up.state !== "tackled" && !up.isDown(world.time)) {
      show = up.x > ret.catchX - 10;
      if (fx && up.vx > 1 && up.x > 90 && this.wrongWayPlay !== play) {
        this.wrongWayPlay = play;
        fx.warn("WRONG WAY!", up.x, up.y);
      }
    }
    if (!show) return;
    const b = this.b;
    const m = this.mk;
    const X = Math.round(wx(up.x)) - ox, Y = Math.round(wy(up.y)) - oy;
    const rec = getSprite(up.id);
    const rx = Math.max(7, Math.min(13, Math.round((rec && rec.ok ? rec.w : 24) * 0.27)));
    // blink: bright on one beat, a dim copy a step further left on the other (reads as "go left")
    const on = ((t * 4) | 0) % 2 === 0;
    const tw = 4 * m, th = CHEVRON.length * m; // one ◀: 4 × 7 mark units
    const x0 = X - rx - 8 - (tw * 2 + m) - (on ? 0 : m), y0 = Y - 3 - (th >> 1);
    for (let pass = 0; pass < 2; pass++) {
      b.fillStyle = pass ? (on ? PAL.yellow : "#c99a12") : "#0b0d14";
      for (let c = 0; c < 2; c++) {
        const cx = x0 + c * (tw + m);
        for (let i = 0; i < CHEVRON.length; i++) {
          const w = CHEVRON[i] * m;
          const rx0 = cx + tw - w; // right-aligned rows: the tip points left
          if (pass) b.fillRect(rx0, y0 + i * m, w, m);
          else b.fillRect(rx0 - 1, y0 + i * m - 1, w + 2, m + 2);
        }
      }
    }
    // a tiny RETURN label over the arrows (rasterized once)
    const ls = Math.max(1, m - 1);
    if (!this.retLbl || this.retLblS !== ls) {
      this.retLblS = ls;
      this.retLbl = textCanvas("RETURN", ls, PAL.yellow, { tiny: true, outline: "#0b0d14", outlineW: 1 });
    }
    const lbl = this.retLbl;
    b.drawImage(lbl, x0 + tw + (m >> 1) - (lbl.width >> 1) + (on ? 0 : m), y0 - lbl.height - 1);
  }

  drawBallShadow(world, ox, oy) {
    const ball = world.ball;
    if (ball.state === "held" || world.phase === "PLAY_CALL") return;
    if (ball.state === "air" && ball.z < -0.3 && ball.kind !== "pass") return;
    if (ball.state === "dead" && world.phase !== "PRE_SNAP" && world.phase !== "DEAD" && world.phase !== "KICKOFF") return;
    const X = Math.round(wx(ball.x)) - ox, Y = Math.round(wy(ball.y)) - oy;
    const z = Math.max(0, ball.z);
    const rx = z > 6 ? 3 : 4;
    const sh = shadowCanvas(rx, 1, "#0a2010");
    this.b.drawImage(sh, X - rx, Y - 1);
    this.b.fillStyle = "#0a2010";
    this.b.fillRect(X - 1, Y, 3, 1); // solid core so it reads at any height
  }
  drawBall(world, ox, oy, t) {
    const ball = world.ball;
    if (ball.state === "held" && ball.carrier) return;
    if (world.phase === "PLAY_CALL") return;
    if (ball.state === "dead" && world.phase !== "PRE_SNAP" && world.phase !== "DEAD" && world.phase !== "KICKOFF") return;
    const b = this.b;
    // a kick that has come down behind the end line is gone (into the net / the end stands)
    if (ball.state === "air" && ball.z < -0.3 && ball.kind !== "pass") return;
    let X = Math.round(wx(ball.x)) - ox;
    const zpx = Math.round(Math.max(0, ball.z) * ZPX);
    const Y = Math.round(wy(ball.y)) - oy - zpx - 2;
    const big = ball.state === "air" && ball.z > 2.6 && ball.kind !== "pitch" && ball.kind !== "snapback";
    const frames = ballFrames(big);
    const half = big ? 8 : 6;
    let f;
    const kick = ball.kind === "kickoff" || ball.kind === "punt" || ball.kind === "fg" || ball.kind === "pat" || ball.kind === "fumble" || ball.kind === "snapback";
    if (ball.state === "air" || ball.state === "loose") {
      if (kick || ball.state === "loose") {
        // end over end
        const k = ((ball.spin * 2.2) | 0) & 3;
        f = frames[k][k & 1 ? 3 : 1];
      } else {
        // spiral along the flight path: axis from the on-screen velocity, laces rolling
        const svx = ball.vx * PX, svy = ball.vy * PY - ball.vz * ZPX;
        let a = (Math.atan2(-svy, svx) * 180) / Math.PI; // screen angle, y up
        a = ((a % 180) + 180) % 180;
        const ai = Math.round(a / 45) % 4;
        f = frames[ai][((ball.spin * 3) | 0) & 3];
      }
      // FG / PAT through the uprights: ride the posts' slant above the crossbar
      if ((ball.kind === "fg" || ball.kind === "pat") && ball.x > 104) {
        const above = Math.max(0, ball.z - 3.33) * ZPX;
        X += Math.round(above * 0.35 * Math.min(1, (ball.x - 104) / 6));
      }
    } else f = frames[0][1];
    b.drawImage(f, X - half, Y - half);
  }

  // Goalposts at both end lines: gooseneck, crossbar across the field (vertical on screen) and
  // uprights leaning outward for depth; they flash after a good kick.
  drawPosts(world, ox, oy, fx) {
    const b = this.b;
    const flash = fx && fx.postFlash > 0 && (((fx.clock * 10) | 0) & 1) === 0;
    for (let pi = 0; pi < 2; pi++) {
      const x = pi ? -10 : 110, lean = pi ? -1 : 1;
      const X = Math.round(wx(x)) - ox;
      if (X < -80 || X > this.vw + 80) continue;
      const cz = Math.round(3.33 * ZPX);
      const yT = Math.round(wy(MID - 3.08)) - oy - cz, yB = Math.round(wy(MID + 3.08)) - oy - cz;
      const yG = Math.round(wy(MID)) - oy;
      const gx = X + lean * 14; // the post stands behind the end line
      const main = flash ? "#ffffff" : "#ffd23f", dark = flash ? "#fff3c4" : "#b8860b", hi = "#fff3c4";
      // gooseneck: post from the ground, then the arm to the crossbar
      b.fillStyle = "#0b0d14";
      b.fillRect(gx - 2, yG - cz - 2, 5, cz + 4);
      b.fillStyle = dark;
      b.fillRect(gx - 1, yG - cz, 3, cz + 1);
      b.fillStyle = main;
      b.fillRect(gx - 1, yG - cz, 2, cz + 1);
      // pad at the base
      b.fillStyle = "#1b2547";
      b.fillRect(gx - 2, yG - 9, 5, 9);
      const ax0 = Math.min(gx, X), ax1 = Math.max(gx, X);
      b.fillStyle = "#0b0d14";
      b.fillRect(ax0 - 1, yG - cz - 2, ax1 - ax0 + 3, 4);
      b.fillStyle = main;
      b.fillRect(ax0, yG - cz - 1, ax1 - ax0 + 1, 2);
      // crossbar (spans the field width: vertical on screen)
      b.fillStyle = "#0b0d14";
      b.fillRect(X - 2, yT - 1, 5, yB - yT + 3);
      b.fillStyle = dark;
      b.fillRect(X - 1, yT, 3, yB - yT + 1);
      b.fillStyle = main;
      b.fillRect(X - 1, yT, 2, yB - yT + 1);
      // uprights, slanting outward with height
      const H = 92;
      for (const yy of [yT, yB]) {
        b.fillStyle = "#0b0d14";
        for (let k = 0; k <= H; k += 1) b.fillRect(X + Math.round(k * 0.35 * lean) - 2, yy - k - 1, 4, 2);
        b.fillStyle = main;
        for (let k = 0; k <= H; k++) b.fillRect(X + Math.round(k * 0.35 * lean) - 1, yy - k, 2, 1);
        b.fillStyle = hi;
        for (let k = 0; k <= H; k += 3) b.fillRect(X + Math.round(k * 0.35 * lean) - 1, yy - k, 1, 1);
        // wind ribbon on top
        b.fillStyle = "#e8352a";
        const tx = X + Math.round(H * 0.35 * lean);
        b.fillRect(tx + (lean > 0 ? 1 : -4), yy - H - 1 + (((this.frame >> 3) & 1)), 4, 1);
      }
    }
  }

  drawOverlays(world, ox, oy, t, fx) {
    const b = this.b;
    const ball = world.ball;
    const vw = this.vw, vh = this.vh;
    const m = this.mk;
    // the human's player: a bouncing arrow over his head, drawn over everyone
    const up = world.userPlayer;
    if (up && !world.autoplay && world.phase !== "PLAY_CALL") {
      const ps = this.poses.get(up);
      if (ps && ps.drawn === this.frame) this.drawUserArrow(ps.sx0, ps.top - 3, t);
      // punt returns run LEFT (toward x = 0) while every other carry runs right: say so
      this.drawPuntReturnHint(world, up, ox, oy, t, fx);
    }
    // landing marker under a ball in the air (passes and kicks)
    if (ball.state === "air" && (ball.kind === "pass" || ball.kind === "punt" || ball.kind === "kickoff") && (world.phase === "LIVE" || world.phase === "KICKOFF")) {
      const X = Math.round(wx(ball.aimX)) - ox, Y = Math.round(wy(ball.aimY)) - oy;
      const blink = ((t * 8) | 0) % 2;
      b.fillStyle = "#0b0d14";
      ringEllipse(b, X, Y + 1, 9, 4);
      b.fillStyle = blink ? PAL.yellow : "#ffffff";
      ringEllipse(b, X, Y, 9, 4);
      b.fillRect(X - 2, Y, 5, 1);
      b.fillRect(X, Y - 1, 1, 3);
    }
    // target numbers over receivers when the human's QB can throw (clamped into the view); with a controller in hand,
    // the button that throws to each one instead (input.js: X Y LB RB RT = receivers 1-5)
    const play = world.play;
    if (!play || world.phase !== "LIVE" || play.thrown || !play.off || play.off.type !== "pass") return;
    const u = world.userPlayer;
    if (!u || u.pos !== "QB" || !u.hasBall || play.qbRunner || world.autoplay) return;
    const tg = play.progression;
    const bh = 7 * m + 6;
    const topLimit = this.hudArt + 2; // under the scorebug (and the ticker while it shows)
    for (let i = 0; i < tg.length && i < 5; i++) {
      const r = tg[i];
      const rec = getSprite(r.id);
      const h = rec && rec.ok ? rec.h : 30;
      const hot = i === play.targetIdx % tg.length;
      const ink = hot ? "#0b0d14" : "#1b2547";
      // the receiver's key (his number until the player rebinds it) or, with a controller in hand, his button
      const rl = this.recLabels(), lab = this.padLabels ? rl.pad[i] : rl.key[i];
      const glyph = lab ? this.label(lab, m, ink) : this.digit(i + 1, m, ink, false);
      const bw = (lab ? textWidth(lab, m) : 5 * m) + 6;
      const X = Math.round(wx(r.x)) - ox, Yf = Math.round(wy(r.y)) - oy - h - 8 - bh;
      const bob = hot ? ((t * 4) | 0) % 2 : 0;
      const cx = Math.max(2, Math.min(vw - bw - 2, X - (bw >> 1)));
      const cy = Math.max(topLimit, Math.min(vh - bh - 6, Yf - bob));
      b.fillStyle = "#0b0d14";
      b.fillRect(cx - 1, cy - 1, bw + 2, bh + 2);
      b.fillStyle = hot ? PAL.yellow : "#f6f6f2";
      b.fillRect(cx, cy, bw, bh);
      b.fillStyle = hot ? "#c99a12" : "#9aa6c8";
      b.fillRect(cx, cy + bh - m, bw, m);
      b.fillStyle = hot ? "#fff8d0" : "#ffffff";
      b.fillRect(cx, cy, bw, 1);
      b.drawImage(glyph, cx + Math.round((bw - glyph.width) / 2), cy + Math.round((bh - 7 * m) / 2));
      const off = X < 0 || X > vw || Yf < topLimit - 2 || Yf > vh - bh;
      if (!off) {
        // pointer down to the receiver
        b.fillStyle = "#0b0d14";
        b.fillRect(cx + (bw >> 1) - 3, cy + bh + 1, 7, 1);
        b.fillStyle = hot ? PAL.yellow : "#f6f6f2";
        b.fillRect(cx + (bw >> 1) - 2, cy + bh, 5, 1);
        b.fillRect(cx + (bw >> 1) - 1, cy + bh + 1, 3, 1);
        b.fillRect(cx + (bw >> 1), cy + bh + 2, 1, 1);
      } else {
        // off-screen: an arrow on the box pointing toward him
        const dirx = X < 0 ? -1 : X > vw ? 1 : 0, diry = Yf < topLimit ? -1 : Yf > vh - bh ? 1 : 0;
        b.fillStyle = hot ? PAL.yellow : "#f6f6f2";
        const ax = dirx < 0 ? cx - 4 : dirx > 0 ? cx + bw + 2 : cx + (bw >> 1);
        const ay = diry < 0 ? cy - 4 : diry > 0 ? cy + bh + 2 : cy + (bh >> 1);
        for (let k = 0; k < 3; k++) {
          if (dirx) b.fillRect(ax + (dirx < 0 ? k : -k), ay - (2 - k), 1, (2 - k) * 2 + 1);
          else b.fillRect(ax - (2 - k), ay + (diry < 0 ? k : -k), (2 - k) * 2 + 1, 1);
        }
      }
    }
  }
}
