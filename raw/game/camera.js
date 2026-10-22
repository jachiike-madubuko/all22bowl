// Camera + art geometry. The sim works in yards; everything on screen is drawn into ONE low-res
// buffer where 1 buffer px = 1 sprite px, then blitted at an integer scale. This module owns the
// yard → buffer-pixel mapping (PX/PY/ZPX, wx/wy), picks the integer screen scale, and follows the
// play with a critically damped spring whose target leads the ball carrier along his velocity.
// The view origin and the shake snap to whole buffer pixels (SPEC §6.0: no sub-pixel shimmer).
import { CFG } from "./config.js";

// ---- Art geometry (the art team's own constants; CFG.PX_PER_YARD etc. are no longer read) ----
// Sprites are drawn at 1×, so PX sets how big the players are relative to the field: at 22 px/yd a
// typical trimmed sprite (~50 px) spans ~2.2 yd, so the line of scrimmage, kickoff lanes and piles
// read as separate bodies instead of one blob (14.5 px/yd made every player 3–4 yd wide).
// Phones in landscape see few rows at their whole-pixel scale (×2: ~500-650, the scorebug covering ~100 of them), so
// they get a flatter field: more of its 53 yards from sideline to sideline fit, and routes toward a sideline stay on
// screen. Tablets and desktops keep the full oblique look.
const PHONE = typeof window !== "undefined" && Math.min(window.innerWidth || 1e4, window.innerHeight || 1e4) < 520;
export const ART = {
  PX: 22, // buffer px per yard (x)
  SQUASH: PHONE ? 0.5 : 0.62, // oblique look: px per yard (y) = PX * SQUASH
  ZPX: 15, // buffer px per yard of height (ball arcs, hops)
  X0: -22, // leftmost yard in the field canvas (room behind the end lines for the goalposts)
  X1: 122,
  STANDS: 128, // stands strip above the top sideline (sky + skyline, crowd, wall, bench area)
  APRON: 58, // below the bottom sideline: apron, wall with ads, front-row crowd
  // Screen scale (see chooseScale): a typical player ~SPRITE_H buffer px tall should fill about
  // SPRITE_FRAC of the visible height while about VIEW_YARDS yards show across the screen.
  SPRITE_H: 50,
  SPRITE_FRAC: 0.1,
  VIEW_YARDS: 48,
  MIN_VIEW_H: 200, // never pick a scale that leaves fewer buffer rows than this
  PHONE_ROWS: 480, // … or, on a phone, fewer than this (wide phones like a Pro Max would pick ×3: ~400 rows)
  LEAD_X: 0.17, // pre-snap: frame the LOS this fraction of the view left of center
  HUD_PX: 9, // nudge targets down so the scorebug never covers the play
};
export const PX = ART.PX;
export const PY = ART.PX * ART.SQUASH;
export const ZPX = ART.ZPX;
export const FIELD_TOP = ART.STANDS;
export const FIELD_PX_W = Math.round((ART.X1 - ART.X0) * PX);
export const FIELD_H_PX = Math.round(CFG.FIELD_W * PY);
export const FIELD_PX_H = ART.STANDS + FIELD_H_PX + ART.APRON;
export const wx = (x) => (x - ART.X0) * PX; // world → buffer px (unrounded)
export const wy = (y) => ART.STANDS + y * PY;
export const ix = (x) => Math.round((x - ART.X0) * PX); // rounded helpers
export const iy = (y) => Math.round(ART.STANDS + y * PY);

// Integer screen scale (device px per buffer px) of the standard (WIDE) camera; CLOSE and the
// punch-in add whole steps. Sprites stay 1:1 in the buffer, so the scale alone sets how big a player
// is on screen: pick the scale whose typical player (ART.SPRITE_H rows) is closest — in log terms —
// to ART.SPRITE_FRAC of the visible height, weighing in how far the visible width is from
// ART.VIEW_YARDS. Landscape phone 844×390 @3 → ×2 (player ~9–10% of the height, ~57 yd), Retina Mac
// 1440×900 @2 → ×3 (~44 yd), 1920×1080 → ×2, 1280×720 → ×1 (~58 yd); never fewer than MIN_VIEW_H rows.
export function chooseScale(deviceW, deviceH = 0) {
  let best = 1, bestErr = 1e9;
  // a tall (portrait) window: size the players for a 4:3 slice of it, not its whole height
  const effH = Math.min(deviceH, deviceW * 0.75);
  for (let s = 1; s <= 12; s++) {
    if (deviceH && s > 1 && deviceH / s < (PHONE ? ART.PHONE_ROWS : ART.MIN_VIEW_H)) break;
    const yards = deviceW / (s * PX);
    const frac = effH > 0 ? (ART.SPRITE_H * s) / effH : ART.SPRITE_FRAC;
    const err = Math.abs(Math.log(frac / ART.SPRITE_FRAC)) + Math.abs(Math.log(yards / ART.VIEW_YARDS));
    if (err < bestErr) { bestErr = err; best = s; }
  }
  return best;
}

const PRESNAP = { PLAY_CALL: 1, PRE_SNAP: 1, QUARTER_BREAK: 1, HALFTIME: 1, PREGAME: 1 };
const cl = (lo, hi, v) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

export class Camera {
  constructor() {
    this.x = 0; // view center, buffer px
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.shake = 0;
    this.ix = 0; // integer top-left used for drawing
    this.iy = 0;
    this.seed = 1;
    this.snapNext = true;
    this.leadX = 0; // smoothed lookahead (buffer px)
    this.leadY = 0;
    this.lastOffense = null;
    this.lastWorld = null;
    this.tx = 0;
    this.ty = 0;
    this.intro = 0;
  }
  addShake(px) {
    this.shake = Math.max(this.shake, px);
  }

  // Where the camera wants to look this frame (buffer px). Pre-snap it frames the LOS left of
  // center (the offense sees downfield); a QB in the pocket keeps the routes in view; a carrier
  // gets a lookahead along his velocity (smoothed, so jukes don't jerk the view); kicks and passes
  // lean toward where the ball comes down.
  target(w, vw, vh, dt) {
    if (w !== this.lastWorld || w.offense !== this.lastOffense) {
      // new game, or the field flipped (offense always attacks to the right): cut, don't pan
      if (this.lastWorld === w) this.snapNext = true;
      else this.intro = 0.7; // a new game opens on the stadium (sky, skyline, crowd), then pans down
      this.lastWorld = w;
      this.lastOffense = w.offense;
      this.leadX = this.leadY = 0;
    }
    const ph = w.phase, b = w.ball, play = w.play;
    let tx, ty, lx = 0, ly = 0;
    const zLift = (z) => Math.max(0, z) * ZPX;
    if (PRESNAP[ph]) {
      tx = wx(w.los) + vw * ART.LEAD_X;
      ty = wy(w.ballY);
      // the human's pass play: frame the whole pattern, or at least his first read (so the snap doesn't start under
      // the HUD)
      const o = ph === "PRE_SNAP" && play && play.off && !w.autoplay && w.human === w.offense ? play.off : null;
      if (o && o.type === "pass" && o.progression && o.progression.length) {
        const recs = w.offPlayers ? o.progression.map((s) => w.offPlayers.find((p) => p.slot === s)).filter(Boolean) : [];
        const all = this.keepAll(ty, recs.map((p) => wy(p.y)), vh);
        if (all != null) ty = all;
        else if (recs[0]) ty = this.keepRead(ty, wy(recs[0].y), vh);
      }
    } else if (b.state === "held" && b.carrier) {
      const c = b.carrier;
      if (ph === "LIVE" && play && play.off && play.off.type === "pass" && !play.thrown && !play.qbRunner && c.pos === "QB") {
        // in the pocket: hold the line of scrimmage and the routes in view (all of them while they fit)
        tx = Math.max(wx(c.x) + vw * 0.2, wx(w.los) + vw * 0.1);
        ty = wy(c.y);
        const pr = play.progression;
        // touch (main.js sets footPx / footW): a receiver in the receiver buttons' columns, or running into them within
        // ~0.6 s, keeps clear of their rows at the bottom
        const feet = pr && this.footPx ? pr.map((p) => (wx(p.x + Math.max(0, p.vx || 0) * 0.6) - tx + vw / 2 > vw - this.footW - 24 ? this.footPx : 0)) : null;
        const ri = pr && pr.length ? (play.targetIdx | 0) % pr.length : -1;
        const ys = ri >= 0 ? pr.map((p) => wy(p.y)) : null;
        const all = ri >= 0 ? this.keepAll(ty, ys, vh, feet) : null;
        if (all != null) ty = all;
        else if (ri >= 0) ty = this.keepRead(ty, ys[ri], vh, feet ? feet[ri] : 0);
      } else if (ph === "LIVE" && play && play.kick && c === (w.kick && w.kick.holder)) {
        tx = wx(c.x) + vw * 0.2; // FG / punt: show the kick coming
        ty = wy(c.y);
      } else {
        tx = wx(c.x);
        ty = wy(c.y);
        if (ph === "LIVE" || ph === "KICKOFF") {
          lx = c.vx * PX * 0.42;
          ly = c.vy * PY * 0.28;
        }
      }
    } else if (b.state === "air") {
      // ride the ball, leaning toward where it comes down
      const lean = b.kind === "pass" ? 0.3 : b.kind === "pitch" ? 0.2 : 0.38;
      tx = wx(b.x) + (wx(b.aimX) - wx(b.x)) * lean;
      ty = wy(b.y) + (wy(b.aimY) - wy(b.y)) * lean * 0.6 - zLift(b.z) * 0.4;
    } else {
      tx = wx(b.x);
      ty = wy(b.y) - zLift(b.z) * 0.5;
    }
    // touchdown: the scorer, a few yards deeper into the end zone he scored in, framed in the
    // upper middle so he celebrates above the TOUCHDOWN band (fx puts it at 0.76 of the view)
    const res = play && play.result;
    if (res && res.type === "td" && res.scorer && !play.tryMode && (ph === "DEAD" || ph === "LIVE")) {
      const sc = res.scorer;
      tx = wx(sc.x + (res.spot === 0 ? -3 : 3));
      ty = wy(sc.y) + vh * 0.12;
      lx = ly = 0;
    }
    const k = 1 - Math.exp(-dt * 3.2);
    this.leadX += (lx - this.leadX) * k;
    this.leadY += (ly - this.leadY) * k;
    this.tx = tx + this.leadX;
    // center the play in the area below the top HUD (renderer sets hudPx: buffer px it covers)
    this.ty = ty + this.leadY - Math.max(ART.HUD_PX, Math.round((this.hudPx || 0) / 2));
    if (this.intro > 0) {
      // establishing shot: hold on the top of the stadium, then let the spring pan down
      this.intro -= dt;
      this.ty = vh / 2;
    }
  }

  // A pass play's whole pattern (pre-snap and in the pocket): the ball (qy) and every receiver (ys), centered in the
  // rows below the top HUD with room for each one's sprite and number box. Null when it doesn't fit: keepRead below.
  // feet[i]: rows receiver i also keeps clear at the bottom (the touch receiver buttons over his column), as far as
  // the screen allows without pushing anyone under the HUD.
  keepAll(qy, ys, vh, feet) {
    const hud = this.hudPx || 0, sh = Math.max(ART.HUD_PX, Math.round(hud / 2));
    let lo = qy, hi = qy, hiF = qy;
    ys.forEach((y, i) => {
      if (y < lo) lo = y;
      if (y > hi) hi = y;
      hiF = Math.max(hiF, y + ((feet && feet[i]) || 0));
    });
    const top = lo - 62, bot = hi + 12, botF = hiF + 12; // the same margins keepRead keeps around the read
    if (bot - top > vh - hud) return null;
    // view center T = ty - sh (see target); centering the pattern between the HUD and the bottom edge (the buttons)
    const T = Math.min(Math.max((top + botF) / 2 - hud / 2, bot - vh / 2), top + vh / 2 - hud);
    return T + sh;
  }

  // A pass play's framing (pre-snap and in the pocket): lean 35% from the ball (ty) toward the
  // current read (ry), keep him and his number box out from under the top HUD (phones!) and off
  // the bottom edge (foot rows more over the touch receiver buttons), but the ball itself always stays in view.
  keepRead(ty, ry, vh, foot = 0) {
    const hud = this.hudPx || 0, sh = Math.max(ART.HUD_PX, Math.round(hud / 2));
    const qy = ty;
    // view center T = ty - sh (see target); a point P shows at wy(P) - T + vh / 2
    let T = ty + (ry - ty) * 0.35 - sh;
    T = Math.max(Math.min(T, ry + vh / 2 - hud - 62), ry - vh / 2 + 12 + foot);
    T = Math.min(Math.max(T, qy - vh / 2 + 34), qy + vh / 2 - hud - 40);
    return T + sh;
  }

  // One frame: pick the target from the world and spring toward it. vw/vh: buffer view size.
  follow(dt, w, vw, vh) {
    this.target(w, vw, vh, dt);
    this.update(dt, this.tx, this.ty, vw, vh);
  }

  // tx, ty: target view center (buffer px). viewW/H: buffer view size.
  update(dt, tx, ty, viewW, viewH) {
    // clamp so we never show past the field canvas (unless the view is larger)
    tx = cl(viewW / 2, FIELD_PX_W - viewW / 2, tx);
    ty = cl(viewH / 2, FIELD_PX_H - viewH / 2, ty);
    if (this.snapNext) {
      this.x = tx;
      this.y = ty;
      this.vx = this.vy = 0;
      this.snapNext = false;
    } else if (dt > 0) {
      // critically damped spring (a touch softer vertically: vertical motion reads as jitter)
      const k = CFG.CAM_STIFF || 7.5, kv = k * 0.85;
      const h = Math.min(dt, 1 / 30);
      this.vx += (k * k * (tx - this.x) - 2 * k * this.vx) * h;
      this.vy += (kv * kv * (ty - this.y) - 2 * kv * this.vy) * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.x = cl(viewW / 2, FIELD_PX_W - viewW / 2, this.x);
      this.y = cl(viewH / 2, FIELD_PX_H - viewH / 2, this.y);
    }
    // shake: whole pixels, decaying
    let sx = 0, sy = 0;
    if (this.shake > 0.5) {
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
      const r1 = (this.seed & 0xffff) / 0xffff;
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
      const r2 = (this.seed & 0xffff) / 0xffff;
      sx = Math.round((r1 * 2 - 1) * this.shake);
      sy = Math.round((r2 * 2 - 1) * this.shake * 0.7);
      if (dt > 0) this.shake *= Math.pow(0.0009, dt);
    } else this.shake = 0;
    this.ix = Math.round(this.x - viewW / 2) + sx;
    this.iy = Math.round(this.y - viewH / 2) + sy;
  }

  // screen (CSS px, relative to the canvas) → world yards
  screenToWorld(cssX, cssY, cssPerArtPx) {
    const bx = cssX / cssPerArtPx + this.ix;
    const by = cssY / cssPerArtPx + this.iy;
    return { x: bx / PX + ART.X0, y: (by - ART.STANDS) / PY };
  }
}
