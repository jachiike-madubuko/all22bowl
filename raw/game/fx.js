// Particles, hit-stop, screen shake, slow-mo, the TD/INT punch-in, big pixel banners, pop-up words,
// confetti, fireworks, crowd cheer, type-themed flair and per-gym weather — all driven by bus events
// and drawn as whole pixels into the low-res buffer (SPEC §6.0: pixel squares, stepped/dithered
// fades, no smooth alpha ramps). Particles live in a fixed struct-of-arrays pool: no per-frame
// allocations. Presentation only: never writes sim state.
import { CFG, HIT } from "./config.js";
import { PX, PY, ZPX, wx, wy, ART } from "./camera.js";
import { textCanvas, textWidth } from "./pixelfont.js";
import { makeRng, shade, PARAMS } from "./util.js";
import { footfall } from "./anim.js";
import { monName } from "./data.js";
import { kitsFor } from "./art-kit.js";
import { moodFor, LAYOUT } from "./art-stadium.js";
import { ballFrames } from "./render.js";

const PAL = CFG.PALETTE;
const MAXP = 1100;
const AUTOPLAY = PARAMS.get("autoplay") === "1";

// particle kinds
const K_DUST = 0, K_SPARK = 1, K_STAR = 2, K_CONF = 3, K_EMBER = 4, K_LEAF = 5, K_BUBBLE = 6, K_FEATHER = 7, K_ZAP = 8,
  K_STREAK = 9, K_TWINKLE = 10, K_RING = 11, K_DROP = 12, K_PUFF = 13, K_RAINBOW = 14, K_BUZZ = 15, K_FIRE = 16, K_IMPACT = 17;

// Type flair: colors + particle style per type (sprints, hits, big moments). Gen 1's fifteen types
// plus the modern ones POKEDATA uses (steel, fairy, dark).
const FLAIR = {
  fire: { c: ["#ffd23f", "#ff7a1a", "#e8352a", "#fff3c4"], k: K_EMBER },
  electric: { c: ["#ffd23f", "#fff8d0", "#f4a81d"], k: K_ZAP },
  water: { c: ["#4cc9f0", "#9ee0ff", "#3a86ff", "#e6f8ff"], k: K_DROP },
  grass: { c: ["#5bd15b", "#2f9e44", "#b8f28a"], k: K_LEAF },
  ice: { c: ["#e6f8ff", "#9ee0ff", "#ffffff"], k: K_TWINKLE },
  psychic: { c: ["#ff6fb5", "#c780ff", "#ffc6e5"], k: K_TWINKLE },
  ghost: { c: ["#9b5de5", "#5b2a86", "#cbb2ff"], k: K_PUFF },
  poison: { c: ["#a84fd8", "#c77dff", "#e0b0ff"], k: K_BUBBLE },
  rock: { c: ["#8a5a2b", "#b08a5a", "#5e4020", "#d0b080"], k: K_DUST, heavy: true },
  ground: { c: ["#c29b62", "#8a5a2b", "#e0c89a"], k: K_DUST, heavy: true },
  fighting: { c: ["#e8352a", "#f6f6f2", "#ffd23f"], k: K_SPARK, pow: true },
  flying: { c: ["#ffffff", "#e6f2ff", "#cfe4f8"], k: K_FEATHER },
  bug: { c: ["#b8f28a", "#5bd15b", "#ffd23f"], k: K_BUZZ },
  dragon: { c: ["#e8352a", "#ff7a1a", "#ffd23f", "#5bd15b", "#4cc9f0", "#9b5de5"], k: K_RAINBOW },
  normal: { c: ["#e8dcb8", "#d9c9a0", "#b8a67a"], k: K_DUST },
  steel: { c: ["#e0e6ee", "#a0aab8", "#ffffff"], k: K_SPARK },
  fairy: { c: ["#ffc6e5", "#ff8fc8", "#ffffff"], k: K_TWINKLE },
  dark: { c: ["#4a5068", "#2a2f40", "#8d99ae"], k: K_PUFF },
};
const flairOf = (p) => FLAIR[p.types[0]] || FLAIR.normal;
const DUST = ["#d9c9a0", "#b8a67a", "#e8dcb8", "#c8b890"];
const HEAVY_DUST = ["#b08a5a", "#d9c9a0", "#8a6a3a", "#c8a878"];
const STARC = ["#ffffff", "#ffd23f", "#fff3c4"];
const SPARKC = ["#ffffff", "#ffd23f"];

// banner ramps (per-row color ramps, top → bottom)
const R_GOLD = ["#ffffff", "#fff27a", "#ffd23f", "#ffa82e", "#ff7a1f"];
const R_RED = ["#ffe0e6", "#ff9aae", "#ff4f6d", "#d81f4a"];
const R_ORANGE = ["#fff0d8", "#ffb35f", "#ff7a1f", "#d8481a"];
const R_BLUE = ["#ffffff", "#d8ecff", "#8cc8ff", "#4ea4ff"];
const R_GREEN = ["#ffffff", "#d2ffc0", "#7ee06a", "#2fae4a"];
const R_GRAY = ["#ffffff", "#dde2ec", "#aab2c8"];
const R_PINK = ["#ffffff", "#ffd6e8", "#ff8fc8"];

// 2×2 ordered-dither patterns (made once, per buffer context)
function patternCanvas(color, on) {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 4;
  const x = c.getContext("2d");
  x.fillStyle = color;
  // 4×4 Bayer thresholds: on = how many of 16 cells are filled
  const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let i = 0; i < 16; i++) if (B[i] < on) x.fillRect(i & 3, i >> 2, 1, 1);
  return c;
}

export class FX {
  constructor(bus, cam) {
    this.cam = cam;
    this.rng = makeRng(777); // visual-only randomness (never the sim's RNG)
    // particle pool (struct of arrays)
    this.px = new Float32Array(MAXP); this.py = new Float32Array(MAXP); this.pz = new Float32Array(MAXP);
    this.pvx = new Float32Array(MAXP); this.pvy = new Float32Array(MAXP); this.pvz = new Float32Array(MAXP);
    this.life = new Float32Array(MAXP); this.max = new Float32Array(MAXP); this.grav = new Float32Array(MAXP);
    this.size = new Uint8Array(MAXP); this.kind = new Uint8Array(MAXP); this.seed = new Uint16Array(MAXP);
    this.col = new Array(MAXP).fill("#ffffff");
    this.n = 0;
    // ball trail ring (screen-independent world positions)
    this.trailX = new Float32Array(10); this.trailY = new Float32Array(10); this.trailZ = new Float32Array(10);
    this.trailN = 0; this.trailI = 0;
    // weather (screen-space with parallax)
    // (room for the densest mood × 4: bigger views draw more drops, see drawWeather)
    this.wxp = new Float32Array(300); this.wyp = new Float32Array(300); this.wvx = new Float32Array(300); this.wvy = new Float32Array(300);
    this.wph = new Float32Array(300); this.wn = 0; this.wbase = 0;
    this.weatherOn = true;
    this.weatherCheck = 0;
    this.mood = null;
    this.lightning = 0; this.lightningNext = 6; this.boltX = 0;
    // timers / state read by main.js and the renderer
    this.hitStop = 0;
    this.slowmo = false;
    this.slowT = 0;
    this.slowDone = false;
    this.bars = 0; // cinematic letterbox (0..1), slides in during the TD slow-mo
    this.punch = 0;
    this.cheer = 0;
    this.clock = 0;
    this.flashT = 0;
    this.flashColor = "#ffffff";
    this.ezFlash = 0;
    this.ezTeam = null;
    this.ezLeft = false;
    this.postFlash = 0;
    this.confetti = 0;
    this.confettiCols = ["#ffd23f", "#ffffff"];
    this.confettiX = 105;
    this.fireworks = 0;
    this.spike = null;
    this.spikeAt = null;
    this.banners = [];
    this.pops = [];
    // true while the play-call panel (or a full-screen menu) covers the field: no banners or pop-up
    // words drawn behind it (main.js sets it each frame; ui.js clears them when the panel opens)
    this.covered = false;
    this.popMute = 0; // s left with no pop-up words (TOUCHDOWN! slams in alone)
    this.safeTop = 2; // buffer rows under the top HUD (set each frame by the renderer)
    this.world = null;
    this.attract = false;
    this.lastDeflect = null;
    this.lastDeflectT = -9;
    this.intX = 0;
    this.lastMiss = -9;
    this.unsub = [];
    this.pat = new Map();
    this.bind(bus);
  }
  // Drop the banners and pop-up words now (the play-call panel just opened over the field).
  clearWords() {
    this.banners.length = 0;
    this.pops.length = 0;
  }
  // attract: the title-screen game (no banners, pop-ups, slow-mo or punch-ins over the menus)
  setWorld(w, attract = false) {
    this.world = w;
    this.attract = !!attract;
    this.banners.length = 0;
    this.pops.length = 0;
    this.popMute = 0;
    this.n = 0;
    this.trailN = 0;
    this.slowmo = false;
    this.slowT = 0;
    this.punch = 0;
    this.confetti = 0;
    this.ezFlash = 0;
    this.postFlash = 0;
    this.fireworks = 0;
    this.spike = null;
    this.spikeAt = null;
    this.bars = 0;
    this.barsHold = 0;
    this.mood = w ? moodFor(w) : null;
    this.moodWorld = w;
    this.lightning = 0;
    this.lightningNext = 4;
    this.readWeatherSetting();
    this.seedWeather();
  }
  destroy() {
    for (const u of this.unsub) u();
    this.unsub.length = 0;
  }
  readWeatherSetting() {
    try {
      this.weatherOn = globalThis.localStorage ? localStorage.getItem("all22bowl-weather") !== "off" : true;
    } catch (_) {
      this.weatherOn = true;
    }
  }

  // ---------- spawning ----------
  spawn(x, y, z, vx, vy, vz, life, c, size = 1, g = 9, kind = K_DUST) {
    if (this.n >= MAXP) return -1;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.pvx[i] = vx; this.pvy[i] = vy; this.pvz[i] = vz;
    this.life[i] = life; this.max[i] = life; this.grav[i] = g;
    this.size[i] = size; this.kind[i] = kind; this.col[i] = c;
    this.seed[i] = (this.rng.next() * 65535) | 0;
    return i;
  }
  burst(x, y, z, n, colors, speed, life, size = 1, up = 3, kind = K_DUST, g = 9) {
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      const s = speed * r.range(0.35, 1);
      this.spawn(x, y, z, Math.cos(a) * s, Math.sin(a) * s * 0.7, r.range(up * 0.4, up), life * r.range(0.6, 1.15), colors[(r.next() * colors.length) | 0], r.next() < 0.3 ? size + 1 : size, g, kind);
    }
  }
  dust(x, y, n = 3, heavy = false) {
    this.burst(x, y, 0.05, n, heavy ? HEAVY_DUST : DUST, heavy ? 2.6 : 1.5, heavy ? 0.55 : 0.4, heavy ? 2 : 1, 1.2, K_PUFF, 4);
  }
  ring(x, y, color, size = 10, life = 0.3) {
    this.spawn(x, y, 0, 0, 0, 0, life, color, size, 0, K_RING);
  }
  stars(x, y, z, n, speed = 5) {
    this.burst(x, y, z, Math.ceil(n * 0.4), STARC, speed, 0.42, 2, 3.5, K_STAR, 7);
    this.burst(x, y, z, n, SPARKC, speed * 1.3, 0.3, 1, 3, K_SPARK, 9);
  }
  // Type flair burst (hits, jukes, TDs)
  typeBurst(p, x, y, n, z = 1) {
    const f = flairOf(p);
    const k = f.k;
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      const s = (k === K_ZAP ? 5 : k === K_FEATHER || k === K_LEAF ? 2 : 3.2) * r.range(0.4, 1);
      const up = k === K_EMBER || k === K_BUBBLE ? r.range(1.5, 3) : r.range(1, 3.5);
      const g = k === K_EMBER || k === K_BUBBLE ? -1.5 : k === K_FEATHER || k === K_LEAF ? 1.6 : k === K_TWINKLE || k === K_PUFF ? 0.5 : 8;
      this.spawn(x, y, z + r.range(-0.3, 0.6), Math.cos(a) * s, Math.sin(a) * s * 0.7, up, r.range(0.4, 0.8), f.c[(r.next() * f.c.length) | 0], f.heavy ? 2 : 1, g, k);
    }
  }
  // A single flair particle trailing a sprinter (type-specific motion).
  flairTrail(p) {
    const f = flairOf(p);
    const r = this.rng;
    const k = f.k;
    const bx = p.x - p.facing * 0.55, by = p.y + r.range(-0.25, 0.25);
    const z = r.range(0.3, 1.9);
    const g = k === K_EMBER || k === K_BUBBLE ? -1.2 : k === K_FEATHER || k === K_LEAF ? 1.2 : k === K_TWINKLE || k === K_PUFF || k === K_RAINBOW || k === K_BUZZ ? 0 : 3;
    this.spawn(bx, by, z, -p.vx * 0.25 + r.range(-0.4, 0.4), r.range(-0.4, 0.4), k === K_DUST ? r.range(0.3, 1) : r.range(-0.3, 0.6), r.range(0.35, 0.6), f.c[(r.next() * f.c.length) | 0], f.heavy ? 2 : 1, g, k);
  }
  banner(text, ramp, opts = {}) {
    if (this.attract) return;
    const b = { text, ramp, sub: opts.sub || "", t: -(opts.delay || 0), dur: opts.dur || 1.6, edge: opts.edge || ramp[ramp.length - 1], big: !!opts.big, small: !!opts.small, prio: opts.prio ?? (opts.small ? 1 : 2), pos: opts.pos || 0 };
    const cur = this.banners[0];
    if (cur && cur.prio > b.prio && cur.t < cur.dur - 0.3 && cur.dur < 50) {
      b.t = Math.min(b.t, -(cur.dur - cur.t)); // after the current one (which may not have started yet)
      this.banners.length = 1;
      this.banners.push(b);
    } else {
      this.banners.length = 0;
      this.banners.push(b);
    }
  }
  // A red warning word over a player (the renderer's WRONG WAY! on a punt return).
  warn(text, x, y) {
    this.pop(text, x, y, R_RED, 1, 1.1);
  }
  pop(text, x, y, color = R_GOLD, scale = 2, dur = 0.9) {
    if (this.attract || this.popMute > 0) return;
    // scale is a size class: 1 = small word, 2 = word, 3+ = big; turned into whole-pixel text
    // sizes at draw time from the screen scale (so pop-ups read the same on every device)
    // stack on top of a recent pop at the same spot instead of overlapping it
    let lift = 0;
    const unit = Math.max(1, Math.round(15 / (7 * (this.cssPerArt || 2))));
    for (const q of this.pops) if (q.t < 0.45 && Math.abs(q.x - x) < 2.5 && Math.abs(q.y - y) < 2.5) lift = Math.max(lift, q.lift + 7 * unit + 6);
    this.pops.push({ text, x, y, t: 0, dur, color, scale, lift });
    if (this.pops.length > 6) this.pops.shift();
  }
  shake(px) {
    this.cam.addShake(px);
  }
  nameOf(p) {
    try {
      return p ? monName(p.id) : "";
    } catch (_) {
      return "";
    }
  }

  // ---------- events ----------
  bind(bus) {
    const on = (t, fn) => this.unsub.push(bus.on(t, (payload, type, w) => {
      // only the world on screen makes effects
      if (w && this.world && w !== this.world) return;
      fn(payload, w);
    }));
    on("tackle", ({ tackler, carrier, power }, w) => {
      const pw = Math.max(0, Math.min(1.4, (power - 30) / 115));
      const big = power > HIT.BIG, huge = power > HIT.HUGE;
      this.hitStop = Math.max(this.hitStop, 0.04 + 0.07 * Math.min(1, pw));
      this.shake(1.5 + 5 * Math.min(1, pw));
      const mx = (tackler.x + carrier.x) / 2, my = (tackler.y + carrier.y) / 2;
      // comic impact burst: spokes snapping out from the contact point
      this.spawn(mx, my, 1.2, 0, 0, 0, 0.16 + pw * 0.06, big ? "#ffd23f" : "#ffffff", big ? 2 : 1, 0, K_IMPACT);
      this.stars(mx, my, 1.1, 6 + Math.round(pw * 10), 4 + pw * 3);
      this.dust(carrier.x, carrier.y + 0.2, 6 + Math.round(pw * 8), big || flairOf(carrier).heavy || flairOf(tackler).heavy);
      if (big) this.ring(carrier.x, carrier.y, "#f6f6f2", 8 + Math.round(pw * 8), 0.28);
      this.typeBurst(tackler, mx, my, big ? 10 : 5);
      if (carrier.types.includes("water") || tackler.types.includes("water")) this.typeBurstTyped("water", mx, my, 10);
      if (huge) {
        this.pop(this.rng.pick(["BOOM!", "POW!", "WHAM!", "CRUNCH!"]), mx, my, R_GOLD, 3, 0.95);
      } else if (big && tackler.types.includes("fighting")) this.pop("POW!", mx, my, R_RED, 2, 0.8);
      else if (big) this.pop(this.rng.pick(["WHAM!", "SMACK!"]), mx, my, R_GRAY, 2, 0.7);
      this.cheer = Math.max(this.cheer, big ? 1.2 : 0.6);
    });
    on("brokenTackle", ({ tackler, carrier }, w) => {
      this.stars(tackler.x, tackler.y, 1.0, 5, 3.5);
      this.dust(tackler.x, tackler.y, 4, false);
      this.shake(2);
      const now = w ? w.time : 0;
      if (!(now - this.lastMiss < 0.9)) {
        this.lastMiss = now;
        this.pop(carrier.r.power > tackler.r.power ? "SHED!" : "MISSED!", tackler.x, tackler.y, R_BLUE, 2, 0.75);
      }
      this.cheer = Math.max(this.cheer, 0.8);
    });
    on("pancake", ({ blocker, defender }) => {
      this.dust(defender.x, defender.y, 14, true);
      this.ring(defender.x, defender.y, "#e8dcb8", 12, 0.3);
      this.stars((blocker.x + defender.x) / 2, (blocker.y + defender.y) / 2, 1, 4, 3);
      this.shake(3);
      this.hitStop = Math.max(this.hitStop, 0.05);
      this.pop("PANCAKE!", defender.x, defender.y, R_GOLD, 1, 0.9);
    });
    on("block", ({ blocker, defender }) => {
      this.burst((blocker.x + defender.x) / 2, (blocker.y + defender.y) / 2, 1.1, 4, SPARKC, 2.5, 0.2, 1, 1.5, K_SPARK, 6);
    });
    on("juke", ({ player }) => {
      this.typeBurst(player, player.x, player.y, 9, 0.8);
      this.dust(player.x, player.y + 0.2, 5, false);
      this.pop("JUKE!", player.x, player.y, R_BLUE, 1, 0.7);
      this.cheer = Math.max(this.cheer, 0.6);
    });
    on("stiffArm", ({ player }) => {
      const ax = player.x + player.facing * 0.8;
      this.burst(ax, player.y, 1.3, 8, SPARKC, 3.2, 0.25, 1, 2, K_SPARK, 6);
      this.burst(ax, player.y, 1.3, 2, STARC, 2.5, 0.3, 2, 2, K_STAR, 4);
      this.shake(1.5);
      this.pop("STIFF ARM!", player.x, player.y, R_ORANGE, 1, 0.75);
    });
    on("dive", ({ player }) => {
      this.dust(player.x, player.y + 0.2, 5, false);
      for (let i = 0; i < 3; i++) this.spawn(player.x - player.facing * 0.6, player.y + this.rng.range(-0.3, 0.3), this.rng.range(0.4, 1.4), 0, 0, 0, 0.2, "#ffffff", 5 + i * 2, 0, K_STREAK);
    });
    on("diveEnd", ({ player }) => this.dust(player.x, player.y, 6, false));
    on("fumbleDive", ({ player }) => this.dust(player.x, player.y, 8, true));
    on("handoff", ({ to }) => { if (to) this.dust(to.x, to.y, 3, false); });
    on("throw", ({ qb }) => {
      const f = flairOf(qb);
      if (qb.types.includes("psychic")) {
        this.ring(qb.x, qb.y, "#ff6fb5", 9, 0.35);
        this.typeBurst(qb, qb.x, qb.y, 10, 1.6);
      } else this.burst(qb.x + qb.facing * 0.4, qb.y, 1.8, 5, f.c, 2.2, 0.3, 1, 1.2, f.k === K_DUST ? K_SPARK : f.k, 3);
    });
    on("catch", ({ player, kick }) => {
      if (!player) return;
      // sparkle: twinkles + a couple of stars around the catch
      this.burst(player.x, player.y, 1.9, 7, STARC, 2.8, 0.45, 1, 1.6, K_TWINKLE, 0.5);
      this.burst(player.x, player.y, 1.9, 2, STARC, 2, 0.35, 2, 1.5, K_STAR, 2);
      // a kick fielded for a kneel gets its TOUCHBACK banner from the 'touchback' event
      if (!kick) this.pop("+", player.x, player.y, R_GOLD, 2, 0.45);
    });
    on("interception", ({ player }, w) => {
      this.intX = player.x;
      this.hitStop = Math.max(this.hitStop, 0.09);
      this.shake(4);
      this.pop("!", player.x, player.y, R_RED, 4, 0.9);
      this.burst(player.x, player.y, 1.6, 14, STARC, 4, 0.55, 1, 3, K_TWINKLE, 1);
      this.typeBurst(player, player.x, player.y, 10, 1.2);
      this.banner("INTERCEPTION!", R_RED, { sub: `${this.nameOf(player)} PICKS IT!`, dur: 2.0, edge: "#ff4f6d" });
      if (!this.attract) this.punch = Math.max(this.punch, CFG.PUNCH_TIME || 1);
      this.cheer = 2;
    });
    on("deflect", ({ player, swat }, w) => {
      this.stars(player.x, player.y, 1.9, 6, 3.5);
      this.lastDeflect = player;
      this.lastDeflectT = w ? w.time : 0;
      this.pop(swat ? "SWAT!" : "TIPPED!", player.x, player.y, R_GRAY, 2, 0.7);
      this.cheer = Math.max(this.cheer, 1);
    });
    on("incomplete", ({ why }, w) => {
      if (w && w.play && w.play.kick) return;
      let sub = "";
      if (why === "breakup" && this.lastDeflect && w && w.time - this.lastDeflectT < 0.6) sub = `BROKEN UP BY ${this.nameOf(this.lastDeflect)}`;
      else if (why === "drop") sub = "DROPPED!";
      else if (why === "oob") sub = "OUT OF BOUNDS";
      this.banner("INCOMPLETE", R_GRAY, { small: true, dur: 1.3, sub, edge: "#8a93ad", delay: 0.15 });
    });
    on("sack", ({ qb, tackler }) => {
      this.banner("SACK!", R_ORANGE, { sub: tackler ? `SACKED BY ${this.nameOf(tackler)}` : "", dur: 1.7, edge: "#ff6a1f" });
      this.shake(5);
      this.hitStop = Math.max(this.hitStop, 0.1);
      this.cheer = Math.max(this.cheer, 1.6);
    });
    on("fumble", ({ carrier, tackler }) => {
      this.banner("FUMBLE!", R_ORANGE, { sub: tackler ? `${this.nameOf(tackler)} KNOCKS IT LOOSE` : "", dur: 1.6, edge: "#ff9b3f" });
      this.shake(5);
      this.pop("!", carrier.x, carrier.y, R_ORANGE, 3, 0.8);
      this.stars(carrier.x, carrier.y, 1.2, 8, 4);
      this.cheer = 2;
    });
    on("touchdown", ({ team, scorer, defensive }, w) => {
      const td = w && w.teams[team] ? w.teams[team].data : null;
      const kits = w ? kitsFor(w) : null;
      const kit = kits ? kits[team] : null;
      let sub = td ? td.name : "";
      if (scorer && w && w.play) {
        const play = w.play;
        let yds = 0, how = "RUN";
        const rk = w.play.ret && w.play.ret.player === scorer ? w.play.ret.kind : null;
        if (rk === "kickoff" || rk === "punt") {
          // kick returns: from where he fielded it (kickoffs run right, punt returns run left)
          const cx = play.ret.catchX;
          yds = Math.round(rk === "punt" ? cx : 100 - cx);
          how = rk === "punt" ? "PUNT RETURN" : "KICK RETURN";
        } else if (defensive || play.turnover) {
          yds = Math.round(play.intSpot != null ? play.intSpot : this.intX);
          how = play.intercepted ? "PICK SIX" : "RETURN";
        } else {
          yds = Math.round(100 - (play.startLos != null ? play.startLos : w.los));
          how = play.completed ? "CATCH" : "RUN";
        }
        sub = how === "PICK SIX" ? `${this.nameOf(scorer)} PICK SIX!` : `${this.nameOf(scorer)} ${Math.max(1, yds)} YD ${how}`;
      }
      if (this.slowmo || this.bars > 0) this.barsHold = 0.9;
      // TOUCHDOWN! slams in alone: no STIFF ARM! / POW! from the same frame, none for a second
      this.pops.length = 0;
      this.popMute = 1.0;
      // low band (0.76): the camera frames the scorer above it (camera.js TD target)
      this.banner("TOUCHDOWN!", R_GOLD, { big: true, dur: 2.6, sub, edge: kit ? kit.base : "#ffd23f", pos: 0.76 });
      if (!this.attract) this.punch = Math.max(this.punch, (CFG.PUNCH_TIME || 1) * 1.25);
      this.cheer = 3;
      this.shake(3);
      this.flashT = 0.018;
      this.flashColor = "#fff3c4";
      this.ezFlash = 1.8;
      this.ezTeam = team;
      this.ezLeft = !!defensive;
      this.confetti = 2.4;
      this.confettiCols = kit ? [kit.primary, kit.secondary, kit.base, "#ffffff", "#ffd23f"] : ["#ffd23f", "#ffffff"];
      this.confettiX = defensive ? -5 : 105;
      this.confettiY = scorer ? scorer.y : CFG.FIELD_W / 2;
      this.fireworks = 2.2;
      if (scorer) this.typeBurst(scorer, scorer.x, scorer.y, 22, 1.2);
      // the spike: the scorer slams the ball ~0.4 s after crossing (see anim celebrate)
      this.spike = null;
      this.spikeAt = !this.attract && scorer && w ? { by: scorer, t: w.time + 0.42 } : null;
    });
    on("firstDown", (_, w) => {
      if (w && w.play && w.play.result && w.play.result.type === "td") return;
      this.banner("FIRST DOWN", R_BLUE, { small: true, dur: 1.3, edge: "#4ea4ff", delay: 0.1 });
      this.cheer = Math.max(this.cheer, 0.8);
    });
    on("safety", ({ team }, w) => {
      const td = w && w.teams[team] ? w.teams[team].data : null;
      this.banner("SAFETY!", R_PINK, { sub: td ? `2 POINTS ${td.short || td.name}` : "", dur: 2, edge: "#ff4f6d" });
      this.shake(5);
      this.cheer = 2;
    });
    on("fieldGoal", ({ good, distance }, w) => {
      const d = Math.round(distance);
      if (good) {
        this.banner("IT'S GOOD!", R_GREEN, { sub: `${d} YD FIELD GOAL`, dur: 2, edge: "#4ade80" });
        this.cheer = 2;
        this.postFlash = 1.2;
        this.confetti = 1.0;
        const kits = w ? kitsFor(w) : null;
        const kit = kits ? kits[w.offense] : null;
        this.confettiCols = kit ? [kit.primary, kit.secondary, "#ffffff"] : ["#ffd23f", "#ffffff"];
        this.confettiX = 108;
        this.confettiY = CFG.FIELD_W / 2;
      } else {
        const b = w && w.ball;
        const mid = CFG.FIELD_W / 2;
        const why = b ? (b.aimY < mid - 3.1 ? "WIDE LEFT" : b.aimY > mid + 3.1 ? "WIDE RIGHT" : "NO GOOD") : "";
        this.banner("NO GOOD!", R_GRAY, { sub: `${d} YD TRY ${why === "NO GOOD" ? "IS SHORT" : why}`, dur: 2, edge: "#8a93ad" });
      }
    });
    on("pat", ({ good }) => {
      this.banner(good ? "EXTRA POINT" : "PAT NO GOOD", good ? R_GREEN : R_GRAY, { small: true, sub: good ? "IS GOOD" : "", dur: 1.25, delay: 0.75, prio: 2 });
      if (good) this.postFlash = 1.6;
    });
    on("turnover", ({ kind }) => {
      if (kind === "downs") this.banner("TURNOVER", R_PINK, { sub: "ON DOWNS", dur: 1.8, edge: "#ff4f6d" });
    });
    on("punt", ({ distance, kicker }) => {
      this.banner("PUNT", R_GRAY, { small: true, dur: 0.9, edge: "#8a93ad", pos: 0.8 });
      if (kicker) this.dust(kicker.x, kicker.y, 4, false);
    });
    on("kick", ({ kicker }) => { if (kicker) this.dust(kicker.x, kicker.y, 4, false); });
    // 'kickoff' = the teams line up; the boot is 'kick' {kind: 'kickoff' | 'onside'} (dust above)
    on("kickoff", ({ free }) => {
      this.banner(free ? "FREE KICK" : "KICKOFF", R_BLUE, { small: true, dur: 1.0, edge: "#5bc0f8", pos: 0.8 });
    });
    // ---- special teams and tries (football round 2 events) ----
    on("onside", () => {
      this.banner("ONSIDE KICK!", R_ORANGE, { small: true, dur: 1.2, edge: "#ff9b3f", pos: 0.8 });
      this.cheer = Math.max(this.cheer, 1.4);
    });
    on("onsideRecovered", ({ success, player }) => {
      if (success) {
        this.banner("RECOVERED!", R_GOLD, { sub: player ? `${this.nameOf(player)} HAS IT!` : "ONSIDE KICK", dur: 1.8, edge: "#ffd23f" });
        this.cheer = 2.2;
        this.shake(3);
      } else if (player) this.pop("GOT IT!", player.x, player.y, R_BLUE, 1, 0.8);
      if (player) this.burst(player.x, player.y, 1.4, 10, STARC, 3.5, 0.5, 1, 2.5, K_TWINKLE, 1);
    });
    on("touchback", ({ kneel, player }) => {
      this.banner("TOUCHBACK", R_BLUE, { small: true, dur: 1.1, delay: kneel ? 0.25 : 0.1, edge: "#5bc0f8" });
      if (player && kneel) this.dust(player.x, player.y, 4, false);
    });
    on("fairCatch", ({ player, stage }) => {
      if (stage === "signal" && player) this.pop("FAIR CATCH", player.x, player.y, R_BLUE, 1, 1.0);
    });
    on("kickBounce", ({ x, y }) => { if (Number.isFinite(x) && Number.isFinite(y)) this.dust(x, y, 4, false); });
    on("puntDowned", ({ player, x }) => {
      if (player) this.pop("DOWNED", player.x, player.y, R_GRAY, 1, 0.8);
      else if (Number.isFinite(x)) this.dust(x, CFG.FIELD_W / 2, 3, false);
    });
    on("scoop", ({ player }) => {
      if (!player) return;
      this.pop("SCOOP!", player.x, player.y, R_ORANGE, 2, 0.8);
      this.cheer = Math.max(this.cheer, 1.6);
    });
    on("twoPoint", ({ team, good, scorer, defensive }, w) => {
      if (good) {
        const kits = w ? kitsFor(w) : null;
        const kit = kits && team ? kits[team] : null;
        this.banner("2-POINT GOOD!", R_GOLD, { sub: scorer ? `${this.nameOf(scorer)} GETS IN!` : "", dur: 2.0, edge: kit ? kit.base : "#ffd23f" });
        this.cheer = 2.6;
        this.shake(3);
        this.confetti = 1.4;
        this.confettiCols = kit ? [kit.primary, kit.secondary, kit.base, "#ffffff"] : ["#ffd23f", "#ffffff"];
        this.confettiX = 105;
        this.confettiY = scorer ? scorer.y : CFG.FIELD_W / 2;
        if (scorer) this.typeBurst(scorer, scorer.x, scorer.y, 14, 1.1);
      } else if (defensive) {
        this.banner("DEFENSE SCORES 2", R_PINK, { sub: scorer ? `${this.nameOf(scorer)} TAKES IT BACK` : "", dur: 1.9, edge: "#ff4f6d" });
        this.cheer = 2;
      } else this.banner("NO GOOD", R_GRAY, { small: true, sub: "2-POINT TRY FAILS", dur: 1.5, edge: "#8a93ad", delay: 0.15 });
    });
    on("quarterEnd", ({ q }) => {
      if (q >= 4) return;
      this.banner(q === 2 ? "HALFTIME" : `END OF Q${q}`, R_BLUE, { dur: 2, edge: "#5bc0f8", prio: 1 });
    });
    on("overtime", () => this.banner("OVERTIME!", R_GOLD, { sub: "TOUCHDOWN WINS IT", dur: 2.2 }));
    on("gameOver", ({ winner }, w) => {
      const td = w && winner && winner !== "tie" ? w.teams[winner].data : null;
      this.banner("FINAL", R_GOLD, { dur: 99, sub: td ? `VICTORY: ${td.name}` : "IT'S A TIE", prio: 3 });
      this.confetti = 3;
      const kits = w ? kitsFor(w) : null;
      const kit = kits && td ? kits[winner] : null;
      this.confettiCols = kit ? [kit.primary, kit.secondary, "#ffffff", "#ffd23f"] : ["#ffd23f", "#ffffff"];
      this.confettiX = w ? w.ball.x : 50;
      this.confettiY = w ? w.ball.y : CFG.FIELD_W / 2;
      this.cheer = 3;
    });
    on("bigPlay", () => { this.cheer = Math.max(this.cheer, 1.5); });
    on("switch", ({ player }) => { if (player) this.ring(player.x, player.y, "#ffd23f", 12, 0.25); });
    on("snap", () => {
      this.banners = this.banners.filter((b) => b.dur > 50);
      this.slowDone = false;
    });
    const clearSpike = () => { this.spike = null; this.spikeAt = null; };
    on("pat", clearSpike);
    on("kickoff", clearSpike);
    on("playCall", clearSpike);
    on("whistle", () => {
      this.slowmo = false;
      this.slowT = 0;
    });
  }
  typeBurstTyped(type, x, y, n) {
    const f = FLAIR[type];
    if (f) this.burst(x, y, 0.9, n, f.c, 3, 0.45, 1, 2.5, f.k === K_DROP ? K_DROP : f.k, 8);
  }

  // ---------- per frame ----------
  update(dt, world) {
    const frozen = this.hitStop > 0; // hit-stop: the picture freezes (the shake keeps going)
    this.clock += dt;
    const fdt = frozen ? 0 : dt * (this.slowmo ? CFG.SLOWMO : 1);
    const t = world.time;
    const live = world.phase === "LIVE";
    if (!this.mood || this.moodWorld !== world) {
      this.mood = moodFor(world);
      this.moodWorld = world;
    }
    // weather setting can change from the settings screen
    this.weatherCheck -= dt;
    if (this.weatherCheck <= 0) {
      this.weatherCheck = 1.5;
      const was = this.weatherOn;
      this.readWeatherSetting();
      if (this.weatherOn && !was) this.seedWeather();
    }
    if (fdt > 0 && (live || world.phase === "DEAD" || world.phase === "KICKOFF")) this.watch(world, fdt, t);
    // slow-mo ends on its own after a while (real time) if no whistle came
    if (this.slowmo) {
      this.slowT -= dt;
      if (this.slowT <= 0 || !live) this.slowmo = false;
    }
    // letterbox: in fast while the slow-mo runs, out after the touchdown celebration starts
    const wantBars = this.slowmo || (this.barsHold > 0);
    if (this.barsHold > 0) this.barsHold -= dt;
    this.bars = wantBars ? Math.min(1, this.bars + dt * 6) : Math.max(0, this.bars - dt * 3);
    // particles
    if (fdt > 0) this.stepParticles(fdt);
    // ball trail ring
    const b = world.ball;
    if (fdt > 0 && b.state === "air" && b.kind !== "snapback") {
      this.trailI = (this.trailI + 1) % 10;
      this.trailX[this.trailI] = b.x;
      this.trailY[this.trailI] = b.y;
      this.trailZ[this.trailI] = b.z;
      if (this.trailN < 10) this.trailN++;
    } else if (b.state !== "air") this.trailN = 0;
    // banners / pops age in place (no per-frame arrays)
    if (this.banners.length) {
      const bn = this.banners[0];
      bn.t += dt;
      for (let i = 1; i < this.banners.length; i++) this.banners[i].t += dt;
      if (bn.t > bn.dur) this.banners.shift();
    }
    let j = 0;
    for (let i = 0; i < this.pops.length; i++) {
      const pp = this.pops[i];
      pp.t += dt;
      if (pp.t < pp.dur) this.pops[j++] = pp;
    }
    this.pops.length = j;
    if (this.popMute > 0) this.popMute -= dt;
    this.cheer = Math.max(0, this.cheer - dt * 0.45);
    if (this.flashT > 0) this.flashT -= dt;
    if (this.punch > 0) this.punch -= dt;
    if (this.ezFlash > 0) this.ezFlash -= dt;
    if (this.postFlash > 0) this.postFlash -= dt;
    // confetti over the end zone / field
    if (this.confetti > 0 && fdt > 0) {
      this.confetti -= dt;
      const r = this.rng;
      const cols = this.confettiCols;
      // a shower over the celebration (where the camera is), not across the whole field
      const cy = this.confettiY != null ? this.confettiY : CFG.FIELD_W / 2;
      for (let i = 0; i < 4; i++) {
        const yy = Math.max(-3, Math.min(CFG.FIELD_W + 3, cy + r.range(-16, 16)));
        this.spawn(this.confettiX + r.range(-13, 13), yy, r.range(6, 13), r.range(-0.8, 0.8), r.range(-0.4, 0.4), 0, r.range(1.8, 2.6), cols[(r.next() * cols.length) | 0], r.next() < 0.6 ? 2 : 1, 0, K_CONF);
      }
    }
    // fireworks over the stands
    if (this.fireworks > 0 && fdt > 0) {
      this.fireworks -= dt;
      if (this.rng.next() < dt * 3.2) {
        const r = this.rng;
        const fx = this.confettiX + r.range(-25, 25), fy = r.range(-11.5, -9);
        const cols = this.confettiCols;
        const c = cols[(r.next() * cols.length) | 0];
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * Math.PI * 2;
          this.spawn(fx, fy, 1.5, Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2, r.range(0.6, 0.9), i & 1 ? c : "#ffffff", 1, 2.5, K_SPARK);
        }
      }
    }
    // TD spike: the ball leaves the scorer's hand and bounces end over end
    if (this.spikeAt && world.time >= this.spikeAt.t) {
      const p = this.spikeAt.by;
      this.spike = { by: p, x: p.x + p.facing * 0.4, y: p.y + 0.1, z: 1.2, vx: p.facing * 1.6, vy: 0, vz: -7, spin: 0, bounces: 0 };
      this.spikeAt = null;
      this.dust(p.x + p.facing * 0.5, p.y + 0.1, 6, false);
      this.shake(2);
    }
    const sk = this.spike;
    if (sk && fdt > 0) {
      sk.x += sk.vx * fdt;
      sk.y += sk.vy * fdt;
      sk.z += sk.vz * fdt;
      sk.vz -= 14 * fdt;
      sk.spin += fdt * (6 + Math.abs(sk.vz));
      if (sk.z <= 0) {
        sk.z = 0;
        if (sk.vz < -1.2 && sk.bounces < 5) {
          if (sk.bounces === 0) this.burst(sk.x, sk.y, 0.1, 6, DUST, 2, 0.35, 1, 1.2, K_PUFF, 4);
          sk.vz = -sk.vz * 0.52;
          sk.vx *= 0.7;
          sk.bounces++;
        } else {
          sk.vz = 0;
          sk.vx *= Math.pow(0.05, fdt);
        }
      }
    }
    this.updateWeather(dt, world);
  }

  // Per-frame effects that depend on the live world: footstep dust, sprint trails/afterimages,
  // speed lines, flair, block sparks, slow-mo gating.
  watch(w, dt, t) {
    const r = this.rng;
    const b = w.ball;
    const carrier = b.state === "held" ? b.carrier : null;
    for (const p of w.players) {
      const a = p.anim;
      const sp = Math.hypot(p.vx, p.vy);
      const sprint = sp / Math.max(1, p.r.speed);
      // afterimage trail: [x, y, facing] × up to 3, newest first (shifted in place)
      a.trailT -= dt;
      const tr = a.trail;
      if (sprint > 0.86 && a.trailT <= 0 && p.downUntil <= t) {
        a.trailT = 0.055;
        if (tr.length >= 6) { tr[6] = tr[3]; tr[7] = tr[4]; tr[8] = tr[5]; }
        if (tr.length >= 3) { tr[3] = tr[0]; tr[4] = tr[1]; tr[5] = tr[2]; }
        tr[0] = p.x; tr[1] = p.y; tr[2] = p.facing;
      } else if (sprint < 0.78 && tr.length && a.trailT <= 0) {
        tr.length -= 3; // fade out one ghost at a time
        a.trailT = 0.05;
      }
      if (sp > 3.5 && footfall(p, t, dt) && p.downUntil <= t && r.next() < (p === carrier ? 0.7 : 0.16)) {
        const heavy = p.r.nk > 0.75 || flairOf(p).heavy;
        this.spawn(p.x - p.vx * 0.04, p.y + 0.15, 0.05, -p.vx * 0.12 + r.range(-0.4, 0.4), r.range(-0.3, 0.3), r.range(0.4, 1.1), heavy ? 0.45 : 0.32, DUST[(r.next() * 4) | 0], heavy ? 2 : 1, 5, K_PUFF);
      }
      // type flair off sprinters (ball carriers, the human's player, anyone flying at top speed)
      if (sprint > 0.88 && p.downUntil <= t && (p === carrier || p.isUser || sprint > 0.97)) {
        a.dustT = (a.dustT || 0) - dt;
        if (a.dustT <= 0) {
          a.dustT = p === carrier ? 0.05 : 0.11;
          this.flairTrail(p);
        }
      }
      // speed lines behind a carrier at full tilt
      if (p === carrier && sprint > 0.9 && r.next() < 0.45) {
        this.spawn(p.x - p.facing * 1.0, p.y + r.range(-0.5, 0.5), r.range(0.3, 2.4), 0, 0, 0, 0.16, "#ffffff", 4 + ((r.next() * 5) | 0), 0, K_STREAK);
      }
      // sparks at the contact point of locked blocks
      const d = p.engaged;
      if (d && r.next() < 0.03) this.spawn((p.x + d.x) / 2, (p.y + d.y) / 2, r.range(0.6, 1.5), r.range(-2, 2), r.range(-1, 1), r.range(1, 3), 0.18, r.next() < 0.5 ? "#ffd23f" : "#ffffff", 1, 6, K_SPARK);
    }
    // slow-mo for the last steps of a TD run: inside 3.6 yd, moving at the goal, nobody within 2.2
    if (!this.attract && !AUTOPLAY && w.phase === "LIVE" && !this.slowDone && carrier && !w.headless) {
      const dir = w.dirOf(carrier);
      const toGoal = dir > 0 ? 100 - carrier.x : carrier.x;
      if (toGoal > 0 && toGoal < 3.6 && carrier.vx * dir > 3) {
        let free = true;
        for (const q of w.players) {
          if (q.team === carrier.team || q.downUntil > t || q.state === "tackled") continue;
          if (Math.hypot(q.x - carrier.x, q.y - carrier.y) < 2.2) { free = false; break; }
        }
        if (free) {
          this.slowmo = true;
          this.slowT = 1.6;
          this.slowDone = true;
        }
      }
    }
  }

  stepParticles(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const k = this.kind[i];
      if (k === K_STREAK || k === K_RING || k === K_IMPACT) { i++; continue; }
      if (k === K_CONF) {
        // flutter down, sway, settle on the turf
        this.pz[i] = Math.max(0, this.pz[i] - dt * 2.4);
        this.pvx[i] += Math.sin(this.life[i] * 7 + i) * dt * 3;
        if (this.pz[i] <= 0) { this.pvx[i] = 0; this.pvy[i] = 0; }
      } else {
        this.pz[i] += this.pvz[i] * dt;
        this.pvz[i] -= this.grav[i] * dt;
        if (k === K_LEAF || k === K_FEATHER) this.pvx[i] += Math.sin(this.life[i] * 9 + i) * dt * 4;
        if (this.pz[i] < 0) {
          this.pz[i] = 0;
          this.pvz[i] *= -0.3;
          this.pvx[i] *= 0.55;
          this.pvy[i] *= 0.55;
        }
      }
      this.px[i] += this.pvx[i] * dt;
      this.py[i] += this.pvy[i] * dt;
      i++;
    }
  }
  kill(i) {
    const j = --this.n;
    if (i === j) return;
    this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
    this.pvx[i] = this.pvx[j]; this.pvy[i] = this.pvy[j]; this.pvz[i] = this.pvz[j];
    this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.grav[i] = this.grav[j];
    this.size[i] = this.size[j]; this.kind[i] = this.kind[j]; this.col[i] = this.col[j]; this.seed[i] = this.seed[j];
  }

  // ---------- weather (per gym mood, screen space with parallax) ----------
  seedWeather() {
    const m = this.mood;
    this.wn = 0;
    if (!m || !m.weather || !this.weatherOn) return;
    const counts = { rain: 70, petals: 40, embers: 42, sparkle: 26, dust: 30, motes: 24, mist: 12, snow: 66, lightning: 0 };
    // seeded for views up to 4× a 640×360 buffer; drawWeather shows a share that keeps the density
    this.wbase = counts[m.weather] || 0;
    const n = this.wbase * 4;
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      this.wxp[i] = r.range(0, 2048);
      this.wyp[i] = r.range(0, 1024);
      this.wph[i] = r.next();
      this.wvx[i] = r.range(0.7, 1.3);
      this.wvy[i] = r.range(0.7, 1.3);
    }
    this.wn = n;
  }
  updateWeather(dt, world) {
    const m = this.mood;
    if (!m || !this.weatherOn) return;
    const kind = m.weather;
    if (kind === "lightning") {
      this.lightningNext -= dt;
      if (this.lightningNext <= 0) {
        this.lightningNext = this.rng.range(6, 13);
        this.lightning = 0.32;
        this.boltX = this.rng.range(0.15, 0.85);
      }
      if (this.lightning > 0) this.lightning -= dt;
      return;
    }
    for (let i = 0; i < this.wn; i++) {
      let vx = 0, vy = 0;
      switch (kind) {
        case "rain": vx = -55; vy = 250; break;
        case "petals": vx = 16 + Math.sin(this.clock * 1.3 + i) * 10; vy = 11; break;
        case "embers": vx = Math.sin(this.clock * 2 + i) * 6; vy = -20; break;
        case "dust": vx = 13; vy = Math.sin(this.clock * 0.8 + i) * 3; break;
        case "motes": vx = 6; vy = -3 + Math.sin(this.clock + i) * 3; break;
        case "mist": vx = 4; vy = 0; break;
        case "snow": vx = Math.sin(this.clock * 0.9 + i) * 7; vy = 21; break;
        case "sparkle": {
          this.wph[i] += dt * 1.6;
          if (this.wph[i] >= 1) {
            this.wph[i] -= 1;
            this.wxp[i] = this.rng.range(0, 2048);
            this.wyp[i] = this.rng.range(0, 1024);
          }
          continue;
        }
      }
      this.wxp[i] = (this.wxp[i] + vx * this.wvx[i] * dt + 2048) % 2048;
      this.wyp[i] = (this.wyp[i] + vy * this.wvy[i] * dt + 1024) % 1024;
      this.wph[i] = (this.wph[i] + dt * 0.9) % 1;
    }
  }

  // ---------- drawing ----------
  pattern(b, color, on) {
    let row = this.pat.get(color);
    if (!row) this.pat.set(color, (row = []));
    let p = row[on];
    if (!p) p = row[on] = b.createPattern(patternCanvas(color, on), "repeat");
    return p;
  }
  // Low mist (ground layer, under the players): banks of soft horizontal wisps (1-px dashes, two
  // tones, densest in the middle) drifting along the sidelines and through the end zones.
  drawGround(b, ox, oy, vw, vh) {
    const m = this.mood;
    if (!m || m.weather !== "mist" || !this.weatherOn) return;
    const FWy = CFG.FIELD_W;
    // banks spread over the whole field canvas, as many per yard on any ART.PX
    const span = (ART.X1 - ART.X0) * PX + 112;
    const nb = Math.min(this.wn, Math.round((this.wbase * span) / 2200));
    for (let i = 0; i < nb; i++) {
      const w = 70 + ((i * 37) % 70), h = 9 + ((i * 13) % 6);
      const cx = Math.round((this.wxp[i] / 2048) * span - 150 - ox);
      const lane = i % 3;
      const cy = Math.round((lane === 0 ? wy(-1.4) : lane === 1 ? wy(FWy + 1.6) : wy(3 + ((i * 17) % 48))) - oy);
      if (cx + w < 0 || cx - w > vw || cy + h < 0 || cy - h > vh) continue;
      const n = lane === 2 ? 7 : 16;
      for (let k = 0; k < n; k++) {
        // a fixed scatter of dashes inside the bank's ellipse
        const u = ((k * 7919 + i * 104729) % 1000) / 1000, v = ((k * 3571 + i * 7307) % 1000) / 1000;
        const dy = Math.round((v * 2 - 1) * h);
        const span = Math.sqrt(Math.max(0, 1 - (dy * dy) / (h * h)));
        const len = Math.max(4, Math.round(span * (10 + ((k * 13) % 22))));
        const dx = Math.round((u * 2 - 1) * w * span);
        b.fillStyle = Math.abs(dy) < h * 0.4 && k & 1 ? (m.fx ? m.fx[0] : "#a462c8") : m.fx ? m.fx[1] : "#7c3d9e";
        b.fillRect(cx + dx - (len >> 1), cy + dy, len, 1);
      }
    }
  }
  // Lightning: 0 = dark, 1 = flicker, 2 = full flash (the renderer swaps in the lit sky).
  lightningPhase() {
    if (!this.weatherOn || this.lightning <= 0 || !this.mood || this.mood.weather !== "lightning") return 0;
    const L = this.lightning;
    return L > 0.25 ? 2 : L > 0.21 ? 0 : L > 0.15 ? 2 : L > 0.1 ? 1 : 0;
  }
  // Sky effects over the stands (the lightning bolt), drawn right after the field.
  drawSky(b, ox, oy, vw, vh) {
    const ph = this.lightningPhase();
    if (ph !== 2) return;
    const sky = LAYOUT.SKY_H;
    if (oy > sky) return;
    // the bolt: a forked zigzag from the top of the sky down to the skyline
    let x = Math.round(this.boltX * vw), y = -oy;
    const end = sky - 10 - oy;
    let s = 0;
    while (y < end && s < 20) {
      const nx = x + (s & 1 ? 3 : -2) + ((s * 7) % 3) - 1;
      const ny = y + 3;
      b.fillStyle = "#7a8cff";
      b.fillRect(Math.min(x, nx) - 1, y, Math.abs(nx - x) + 3, 3);
      b.fillStyle = "#ffffff";
      for (let k = 0; k < 3; k++) b.fillRect(x + Math.round(((nx - x) * k) / 3), y + k, 1, 1);
      if (s === 3) for (let k = 0; k < 5; k++) b.fillRect(x + k + 1, y + 1 + k, 1, 1); // fork
      x = nx;
      y = ny;
      s++;
    }
  }
  drawWorld(b, ox, oy, vw, vh) {
    const z2px = ZPX;
    // ball trail: a short spiral streak stepping from white to gray
    if (this.trailN > 1) {
      for (let k = 1; k < this.trailN; k++) {
        const idx = (this.trailI - k + 10) % 10;
        const X = Math.round(wx(this.trailX[idx])) - ox, Y = Math.round(wy(this.trailY[idx]) - this.trailZ[idx] * z2px) - oy;
        b.fillStyle = k < 3 ? "#ffffff" : k < 6 ? "#c8d0e0" : "#8a93ad";
        if (k < 7 || (k & 1)) b.fillRect(X, Y, 1, 1);
      }
    }
    const fr = (this.clock * 60) | 0;
    const sk = this.spike;
    if (sk) {
      const X = Math.round(wx(sk.x)) - ox, Yg = Math.round(wy(sk.y)) - oy;
      const Y = Yg - Math.round(sk.z * z2px) - 2;
      const frames = ballFrames(false);
      const k = ((sk.spin * 1.5) | 0) & 3;
      b.fillStyle = "#0a2010";
      b.fillRect(X - 3, Yg, 7, 1);
      b.fillRect(X - 2, Yg + 1, 5, 1);
      b.drawImage(sk.z > 0.05 ? frames[k][k & 1 ? 3 : 1] : frames[0][1], X - 6, Y - 6);
    }
    for (let i = 0; i < this.n; i++) {
      const X = Math.round(wx(this.px[i])) - ox, Y = Math.round(wy(this.py[i]) - this.pz[i] * z2px) - oy;
      if (X < -16 || Y < -16 || X > vw + 16 || Y > vh + 16) continue;
      const f = this.life[i] / this.max[i];
      const k = this.kind[i];
      // stepped fade: full, then every other frame, then one frame in four
      if (k !== K_STAR && k !== K_RING && k !== K_IMPACT && (f < 0.2 ? (fr + i) % 4 !== 0 : f < 0.4 ? (fr + i) % 2 !== 0 : false)) continue;
      const s = this.size[i];
      b.fillStyle = this.col[i];
      switch (k) {
        case K_STAR: {
          // 4-point impact star shrinking in steps: 5 → 3 → 1
          const r = f > 0.6 ? 2 : f > 0.3 ? 1 : 0;
          b.fillRect(X - r, Y, r * 2 + 1, 1);
          b.fillRect(X, Y - r, 1, r * 2 + 1);
          if (r === 2 && s > 2) { b.fillStyle = "#ffffff"; b.fillRect(X, Y, 1, 1); }
          break;
        }
        case K_TWINKLE: {
          const ph = ((f * 6) | 0) % 3;
          if (ph === 1) { b.fillRect(X - 1, Y, 3, 1); b.fillRect(X, Y - 1, 1, 3); }
          else b.fillRect(X, Y, 1, 1);
          break;
        }
        case K_CONF: {
          // flutter: 2×1 ↔ 1×2
          if (((fr >> 2) + i) & 1) b.fillRect(X, Y, s > 1 ? 2 : 1, 1);
          else b.fillRect(X, Y, 1, s > 1 ? 2 : 1);
          break;
        }
        case K_LEAF:
          if (((fr >> 3) + i) & 1) b.fillRect(X, Y, 2, 1);
          else { b.fillRect(X, Y, 1, 1); b.fillRect(X + 1, Y + 1, 1, 1); }
          break;
        case K_FEATHER:
          b.fillRect(X, Y, 3, 1);
          b.fillStyle = "#cfe4f8";
          b.fillRect(X + (((fr >> 3) + i) & 1 ? 2 : 0), Y + 1, 1, 1);
          break;
        case K_BUBBLE: {
          if (f < 0.15) { b.fillRect(X - 2, Y, 1, 1); b.fillRect(X + 2, Y, 1, 1); b.fillRect(X, Y - 2, 1, 1); b.fillRect(X, Y + 2, 1, 1); }
          else { b.fillRect(X - 1, Y - 1, 3, 1); b.fillRect(X - 1, Y + 1, 3, 1); b.fillRect(X - 1, Y, 1, 1); b.fillRect(X + 1, Y, 1, 1); }
          break;
        }
        case K_ZAP: {
          // a little lightning zigzag that flickers
          if ((fr + i) & 1) break;
          const d = this.seed[i] & 1 ? 1 : -1;
          b.fillRect(X, Y, 2, 1);
          b.fillRect(X + d * 1, Y + 1, 1, 1);
          b.fillRect(X, Y + 2, 2, 1);
          b.fillRect(X - d, Y + 3, 1, 1);
          break;
        }
        case K_STREAK:
          b.fillRect(X - (s >> 1), Y, s, 1);
          break;
        case K_IMPACT: {
          // 8 spokes snapping outward in 3 steps (comic "impact" burst)
          const u = 1 - f;
          const step = u < 0.34 ? 0 : u < 0.67 ? 1 : 2;
          const r0 = (step === 0 ? 4 : step === 1 ? 8 : 13) * s, len = (step === 2 ? 4 : 6) * s;
          if (step === 2) b.fillStyle = "#ffd23f";
          for (let d = 0; d < 8; d++) {
            if (step === 2 && d & 1) continue;
            const dx = d === 0 || d === 1 || d === 7 ? 1 : d === 3 || d === 4 || d === 5 ? -1 : 0;
            const dy = d === 1 || d === 2 || d === 3 ? 1 : d === 5 || d === 6 || d === 7 ? -1 : 0;
            const diag = dx && dy;
            const rr = diag ? Math.round(r0 * 0.75) : r0, ll = diag ? Math.round(len * 0.75) : len;
            for (let k = 0; k < ll; k++) {
              const px = X + dx * (rr + k), py = Y + Math.round(dy * (rr + k) * 0.7);
              b.fillRect(px, py, 1, 1);
              if (s > 1 && !diag) b.fillRect(px + (dy ? 1 : 0), py + (dx ? 1 : 0), 1, 1);
            }
          }
          break;
        }
        case K_RING: {
          // expanding ground ring (shockwave), stepped
          const u = 1 - f;
          const rx = Math.max(2, Math.round(s * (0.4 + u))), ry = Math.max(1, Math.round(rx * 0.45));
          ringSpans(b, X, Y, rx, ry, f < 0.4 && fr & 1);
          break;
        }
        case K_EMBER:
          b.fillStyle = (fr + this.seed[i]) & 4 ? this.col[i] : "#ff7a1a";
          b.fillRect(X, Y, 1, s > 1 && f > 0.5 ? 2 : 1);
          break;
        case K_RAINBOW: {
          const RB = FLAIR.dragon.c;
          b.fillStyle = RB[((fr >> 2) + (this.seed[i] & 7)) % RB.length];
          b.fillRect(X, Y, 2, 1);
          break;
        }
        case K_BUZZ:
          // bug buzz: jittering little dashes
          b.fillRect(X + ((fr + i) & 1), Y, 3, 1);
          break;
        case K_PUFF: {
          const sz = f > 0.55 ? s + 1 : s;
          b.fillRect(X - (sz >> 1), Y - (sz >> 1), sz, sz);
          break;
        }
        default:
          b.fillRect(X, Y, f > 0.5 ? s : Math.max(1, s - 1), f > 0.5 ? s : Math.max(1, s - 1));
      }
    }
    // pop-up words (slam in, rise, blink out)
    const cpa = this.cssPerArt || 2;
    const unit = Math.max(1, Math.round(15 / (7 * cpa))); // ≈15 CSS px tall words
    for (const pp of this.covered ? [] : this.pops) {
      const base = pp.text.length <= 1 ? Math.max(2, unit * 2) : pp.scale >= 3 ? unit + 1 : unit;
      const sc = pp.t < 0.06 ? base + 1 : base;
      if (pp.sc !== sc) {
        pp.sc = sc;
        pp.img = textCanvas(pp.text, sc, pp.color, { bold: true, outline: "#0b0d14", outlineW: 1, shadow: "#0b0d14", shadowD: 1 });
      }
      const img = pp.img;
      const u = pp.t / pp.dur;
      if (u > 0.75 && ((pp.t * 20) | 0) % 2) continue;
      const rise = Math.round(Math.min(1, u * 3) * 12 + u * 8);
      let X = Math.round(wx(pp.x)) - ox - (img.width >> 1);
      let Y = Math.round(wy(pp.y)) - 46 - oy - rise - pp.lift - (img.height >> 1);
      // whole words, always: kept on screen and under the top HUD (no "PANCAK…" at a sideline);
      // a pop entirely off screen (far from the camera) stays unseen, as before
      if (X + img.width <= 0 || X >= vw || Y + img.height <= 0 || Y >= vh) continue;
      X = Math.max(2, Math.min(vw - img.width - 2, X));
      Y = Math.max(this.safeTop || 2, Math.min(vh - img.height - 2, Y));
      b.drawImage(img, X, Y);
    }
  }
  // Weather over the play (sparse 1-px particles; never hides the action).
  drawWeather(b, ox, oy, vw, vh) {
    const m = this.mood;
    if (!m || !this.weatherOn || !this.wn) return;
    const kind = m.weather;
    if (kind === "mist" || kind === "lightning") return;
    const par = kind === "rain" ? 1.25 : 0.9;
    // a mood's own particle colors: Johto's feathers, fireflies and spray; Hoenn's stone dust, ash and sea spray;
    // Sinnoh's coal dust, leaves and festival sparkles
    const fc = m.fx;
    const fr = (this.clock * 60) | 0;
    // same density on every view size (the counts were tuned for a 640×360 buffer)
    const nDraw = Math.min(this.wn, Math.round(this.wbase * Math.max(1, Math.min(4, (vw * vh) / 230400))));
    for (let i = 0; i < nDraw; i++) {
      const X = Math.round(((this.wxp[i] - ox * par) % vw + vw) % vw);
      const Y = Math.round(((this.wyp[i] - oy * par) % vh + vh) % vh);
      switch (kind) {
        case "rain": {
          // slanted streak (4-5 px), and now and then a splash ring on the turf
          b.fillStyle = i & 1 ? "#a8c8e0" : "#d2e6f4";
          b.fillRect(X, Y, 1, 2);
          b.fillRect(X - 1, Y + 2, 1, 2);
          if (i % 3 === 0) b.fillRect(X - 2, Y + 4, 1, 1);
          const sp = (fr + i * 13) % 48;
          if (sp < 4) {
            const sx = (i * 197 + ((fr / 48) | 0) * 331) % vw, sy = (i * 113 + ((fr / 48) | 0) * 173) % vh;
            b.fillStyle = "#c8e0f0";
            if (sp < 2) b.fillRect(sx, sy, 1, 1);
            else { b.fillRect(sx - 2, sy, 1, 1); b.fillRect(sx + 2, sy, 1, 1); b.fillRect(sx - 1, sy - 1, 3, 1); }
          }
          break;
        }
        case "petals":
          b.fillStyle = fc ? fc[i % 3] : i % 3 === 0 ? "#ffd1e6" : i % 3 === 1 ? "#ffa6cf" : "#ff7fbf";
          if (((fr >> 3) + i) & 1) b.fillRect(X, Y, 2, 1);
          else b.fillRect(X, Y, 1, 2);
          if (i % 4 === 0) { b.fillStyle = "#ffffff"; b.fillRect(X, Y, 1, 1); }
          break;
        case "embers":
          b.fillStyle = ((fr >> 2) + i) % 3 === 0 ? "#fff3c4" : i & 1 ? "#ffb02e" : "#ff6a1a";
          b.fillRect(X, Y, 1, i % 5 === 0 ? 2 : 1);
          break;
        case "sparkle": {
          const ph = this.wph[i];
          b.fillStyle = fc ? fc[i % 3] : i % 3 === 0 ? "#ffffff" : i & 1 ? "#ff9ad8" : "#c99aff";
          if (ph < 0.25 || ph > 0.75) b.fillRect(X, Y, 1, 1);
          else if (ph < 0.6) { b.fillRect(X - 1, Y, 3, 1); b.fillRect(X, Y - 1, 1, 3); }
          else { b.fillRect(X - 2, Y, 5, 1); b.fillRect(X, Y - 2, 1, 5); }
          break;
        }
        case "dust":
          b.fillStyle = fc ? fc[i % fc.length] : i & 1 ? "#d8b88a" : "#b8946a";
          b.fillRect(X, Y, 1, 1);
          break;
        case "motes":
          b.fillStyle = ((fr >> 3) + i) & 1 ? (fc ? fc[0] : "#ffe29a") : fc ? fc[1] : "#ffc46a";
          b.fillRect(X, Y, 1, 1);
          break;
        case "snow":
          // flakes: most 1 px, every third a 2×2, one in four pale blue (a mood's fx: Lavaridge's ash)
          b.fillStyle = fc ? fc[i % fc.length] : i % 4 === 0 ? "#dcecff" : "#ffffff";
          if (i % 3 === 0) b.fillRect(X, Y, 2, 2);
          else b.fillRect(X, Y, 1, 1);
          break;
      }
    }
  }
  // Screen-space: banners (wipe-in band + slam), full-screen flash.
  drawScreen(b, vw, vh, focusY = -1) {
    if (this.bars > 0) {
      // stepped slide (whole 3-px steps), solid black: no fades
      const h = Math.round((vh * 0.11 * this.bars) / 3) * 3;
      if (h > 0) {
        b.fillStyle = "#000000";
        b.fillRect(0, 0, vw, h);
        b.fillRect(0, vh - h, vw, h);
        b.fillStyle = "#1b2547";
        b.fillRect(0, h, vw, 1);
        b.fillRect(0, vh - h - 1, vw, 1);
      }
    }
    if (this.flashT > 0) {
      // impact frame: a light ordered-dither veil for a couple of frames (never an alpha blend)
      b.fillStyle = this.pattern(b, this.flashColor, this.flashT > 0.03 ? 5 : 3);
      b.fillRect(0, 0, vw, vh);
    }
    const bn = this.banners[0];
    if (!bn || bn.t < 0 || this.covered) return;
    const t = bn.t;
    const tw = textWidth(bn.text, 1, 1, true) + 2;
    const maxS = bn.big ? 6 : bn.small ? 3 : 5;
    // fits the width, and never more than ~12% of the view height (the band stays a band)
    const base = Math.max(2, Math.min(maxS, Math.floor((vw * (bn.big ? 0.68 : bn.small ? 0.4 : 0.56)) / tw), Math.floor((vh * (bn.small ? 0.07 : 0.12)) / 7)));
    let sc = base;
    if (t < 0.05) sc = base + 3;
    else if (t < 0.1) sc = base + 2;
    else if (t < 0.15) sc = Math.max(2, base - 1);
    else if (t < 0.2) sc = base + 1;
    const ow = Math.max(1, sc >> 1);
    if (!bn.imgs) bn.imgs = [];
    const img = bn.imgs[sc] || (bn.imgs[sc] = textCanvas(bn.text, sc, bn.ramp, { bold: true, outline: "#140c06", outlineW: ow, shadow: "#000000", shadowD: ow }));
    const baseH = 7 * base + Math.max(1, base >> 1) * 3;
    const subS = vw >= 900 ? 2 : 1;
    if (bn.sub && bn.subS !== subS) {
      bn.subS = subS;
      bn.subImg = textCanvas(bn.sub, subS, "#ffffff", { outline: "#000000", outlineW: 1 });
    }
    const subImg = bn.sub ? bn.subImg : null;
    const pad = bn.small ? 4 : 6;
    const bandH = baseH + pad * 2 + (subImg ? subImg.height + 3 : 0);
    // the band's top row for a slot: under the top HUD (safeTop) and inside the view
    const safe = this.safeTop || 2;
    const topOf = (pos) => Math.max(safe, Math.min(vh - bandH - 3, Math.round(vh * pos) - (bandH >> 1)));
    // placed once: the default spot, or the other half of the screen if the play is under it
    // (tested where the clamped band really lands)
    if (bn.cy == null) {
      let pos = bn.pos || (bn.big ? 0.27 : bn.small ? 0.2 : 0.23);
      const t0 = topOf(pos);
      if (focusY >= 0 && focusY > t0 - 34 && focusY < t0 + bandH + 34) pos = pos < 0.5 ? 0.76 : 0.24;
      bn.cy = pos;
    }
    const top = topOf(bn.cy);
    // wipe in from the center, wipe out at the end
    const out = bn.dur < 50 ? Math.max(0, (t - (bn.dur - 0.18)) / 0.18) : 0;
    const k = Math.min(1, t / 0.12) * (1 - out);
    const bandW = Math.round(vw * k);
    if (bandW <= 0) return;
    const bx0 = Math.round((vw - bandW) / 2);
    // a solid body (nothing on the field shows through as dots), with an ordered-dither fringe
    // on the two rows next to each colored edge
    b.fillStyle = "#05060c";
    b.fillRect(bx0, top + 2, bandW, Math.max(0, bandH - 4));
    b.fillStyle = this.pattern(b, "#05060c", 12);
    b.fillRect(bx0, top, bandW, 2);
    b.fillRect(bx0, top + bandH - 2, bandW, 2);
    b.fillStyle = bn.edge;
    b.fillRect(bx0, top - 2, bandW, 2);
    b.fillRect(bx0, top + bandH, bandW, 2);
    b.fillStyle = "#05060c";
    b.fillRect(bx0, top - 3, bandW, 1);
    b.fillRect(bx0, top + bandH + 2, bandW, 1);
    // the text is revealed by the band (clipped to its whole rect): mid-wipe it reads as a wipe,
    // and the slam-in overshoot (letters a few sizes up) stays inside the band, never over the field
    const tx = Math.round(vw / 2 - img.width / 2);
    const ty = top + pad + Math.round((baseH - img.height) / 2);
    this.clipDraw(b, img, tx, ty, bx0, bx0 + bandW, top, top + bandH);
    if (subImg && t > 0.12) this.clipDraw(b, subImg, Math.round(vw / 2 - subImg.width / 2), top + bandH - pad - subImg.height + 2, bx0, bx0 + bandW, top, top + bandH);
  }
  // draws img at (x, y) clipped to the columns [x0, x1) and rows [y0, y1) — whole-pixel source
  // rect, no transforms
  clipDraw(b, img, x, y, x0, x1, y0 = -1e9, y1 = 1e9) {
    const sx = Math.max(0, x0 - x), ex = Math.min(img.width, x1 - x);
    const sy = Math.max(0, y0 - y), ey = Math.min(img.height, y1 - y);
    if (ex <= sx || ey <= sy) return;
    b.drawImage(img, sx, sy, ex - sx, ey - sy, x + sx, y + sy, ex - sx, ey - sy);
  }
}

// ring helper (pixel ellipse outline from spans)
function ringSpans(b, cx, cy, rx, ry, thin) {
  let prev = -1;
  for (let dy = -ry; dy <= ry; dy++) {
    const t = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5));
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, t)) + 0.5);
    const w = Math.max(1, prev < 0 ? hw * 2 + 1 : Math.abs(hw - prev) + 1);
    if (dy === -ry || dy === ry) b.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
    else {
      b.fillRect(cx - hw, cy + dy, Math.min(w, hw + 1), 1);
      if (!thin) b.fillRect(cx + hw - Math.min(w, hw + 1) + 1, cy + dy, Math.min(w, hw + 1), 1);
      else b.fillRect(cx + hw, cy + dy, 1, 1);
    }
    prev = hw;
  }
}
