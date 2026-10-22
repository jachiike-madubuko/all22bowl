// ALL-22 BOWL audio (audio team) — everything is synthesized at runtime with WebAudio; no files.
//   audio-synth.js  mix graph (music/sfx buses → master → limiter → soft clip), chip waves, voices
//   audio-bank.js   one-time OfflineAudioContext renders: drums, QB voice, whistle, horn, crowd
//   audio-sfx.js    live, parameterized sound effects
//   audio-music.js  title theme, stings & jingles, stadium organ; lookahead sequencer
//   audio-crowd.js  the stadium: crowd layers driven by an excitement model + reactions/chant
//   audio-lab.js    offline test lab (not loaded by the game)
//
// PUBLIC API (stable). app.audio is the instance; the module functions talk to the live instance:
//   import { play, setVolume, getVolume, SOUND_NAMES } from "./audio.js"
//   new Audio(bus?)  bind(bus)  unlock(force?)  setMuted(m)  muted
//   startMusic() / stopMusic()     the title/menu theme (starts once the first gesture unlocks audio)
//   setGameAmbience(on)            the stadium (crowd) on/off; arms the pre-game sting; stops old stings
//   step()                         one footfall of the ball carrier (main.js calls it)
//   blip(hi) select() back() error()   menu sounds (ui.js)
//   play(name, opts) → bool        any named sound, see SOUND_NAMES:
//       music stings: pregame second halftime victory defeat tie badge challenge td tdAgainst turnFor
//                     turnAgainst overtime charge rise lick tada preview (menu loop ducks under them)
//       loops: band (halftime fight song; stop with app.audio.music.stop('band'))
//       sfx: blip blipHi select confirm back error pause resume tick reveal lock whistle horn chime
//            cheer ooh aww hit bigHit catch kick hut set sfxPreview
//   setVolume('music'|'sfx', 0..1) → stored value; getVolume(kind); volumes  (persisted)
//   setPaused(on)                  pause menu: stadium muffled + pause/resume tones (falls back to
//                                  watching app.paused until main.js calls it)
//   duck(amount, hold), duckCrowd(db, hold)   mix moves
//   stats()                        {state, voices, peakVoices, created, dropped, bank, music, crowd, events, session}
// Starts only after a user gesture (pointerup/touchend/keydown/click are watched here as well). Phones: see
// audio-unlock.js (iOS gesture rules, the ring/silent switch → navigator.audioSession + a silent <audio> loop).
// Persisted: all22bowl-muted ("1"/"0"), all22bowl-volume-music, all22bowl-volume-sfx (0..1).
// Game events come through main.js's gate (live, unpaused game only); the emitting World is learned
// from the shared bus (see the constructor). Unknown payload shapes are tolerated (new events:
// kickoff, return, fairCatch, onside, twoPoint).
import { bus as liveBus, reportError } from "./events.js";
import { Synth, clamp, MASTER_LEVEL as LEVEL } from "./audio-synth.js";
import { renderBank, BANK_ORDER } from "./audio-bank.js";
import * as SFX from "./audio-sfx.js";
import { Music, SONGS } from "./audio-music.js";
import { Crowd } from "./audio-crowd.js";
import { GESTURES, AudioSession, kick } from "./audio-unlock.js";

const KEY_MUTED = "all22bowl-muted";
const KEY_VOL = { music: "all22bowl-volume-music", sfx: "all22bowl-volume-sfx" };
const DEFAULT_VOL = { music: 0.75, sfx: 0.9 };
const HIT_BIG = 95, HIT_HUGE = 140; // config HIT thresholds

export const SOUND_NAMES = [
  // music stings (music volume)
  "pregame", "second", "halftime", "band", "victory", "defeat", "tie", "badge", "challenge", "td", "tdAgainst", "turnFor", "turnAgainst", "overtime",
  "charge", "rise", "lick", "tada", "preview",
  // sfx (sfx volume)
  "blip", "blipHi", "select", "confirm", "back", "error", "pause", "resume", "tick", "reveal", "lock",
  "whistle", "horn", "chime", "cheer", "ooh", "aww", "hit", "bigHit", "catch", "kick", "hut", "set", "sfxPreview",
];

let current = null;
// Module-level conveniences (the modes/UI teams can import these instead of reaching app.audio).
export function play(name, opts) { return current ? current.play(name, opts) : false; }
export function setVolume(kind, v) { return current ? current.setVolume(kind, v) : false; }
export function getVolume(kind) { return current ? current.getVolume(kind) : DEFAULT_VOL[kind]; }
export function audioInstance() { return current; }

function readNum(key, def) {
  try {
    const v = localStorage.getItem(key);
    if (v == null || v === "") return def;
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, 0, 1) : def;
  } catch (_) {
    return def;
  }
}
const taper = (v) => v * v; // perceptual slider curve
const quiet = (p) => { if (p && p.catch) p.catch(() => {}); }; // resume()/suspend() may reject

// Events the audio listens to (and records the emitting World for).
const EVENTS = ["kickoff", "return", "fairCatch", "onside", "twoPoint", "playCall", "presnap", "snap", "possession", "firstDown", "turnover",
  "whistle", "quarterEnd", "halftime", "secondHalf", "overtime", "gameOver", "handoff", "fake", "scramble", "throw", "catch", "drop", "deflect",
  "incomplete", "interception", "fumble", "fumbleDive", "kickSet", "kick", "punt", "pat", "fieldGoal", "block", "disengage", "pancake",
  "tackleAttempt", "tackle", "brokenTackle", "juke", "stiffArm", "dive", "diveEnd", "sack", "touchdown", "safety", "outOfBounds", "target",
  "switch", "bigPlay", "slowmo"];

export class Audio {
  constructor(bus) {
    current = this;
    this.ctx = null;
    this.synth = null;
    this.music = null;
    this.crowd = null;
    this.bank = new Map();
    this.bankState = "none"; // none | loading | ready
    let m = false;
    try { m = localStorage.getItem(KEY_MUTED) === "1"; } catch (_) {}
    this.muted = m;
    this.vol = { music: readNum(KEY_VOL.music, DEFAULT_VOL.music), sfx: readNum(KEY_VOL.sfx, DEFAULT_VOL.sfx) };
    this.wantMusic = false;
    this.ambience = false;
    this.paused = false;
    this.pausedExplicit = false;
    this.world = null;
    this.fav = "home"; // the crowd's team (the human's)
    this.offense = "home";
    this.unsub = [];
    this.counts = Object.create(null); // events heard (diagnostics)
    this.timers = new Set();
    this.lastAt = Object.create(null);
    this.pregameArmed = false;
    this.secondArmed = false;
    this.firstDownOrgan = false;
    this.organAt = -99;
    this.lastStepT = 0;
    this.kickSoon = false;
    this.resultOverride = null; // a sting name that replaces the next victory/defeat jingle (modes)
    // iPhone: the page's audio session ('playback' ignores the silent switch) + the silent loop (audio-unlock.js)
    this.session = new AudioSession(new URL("./silence.wav", import.meta.url).href);
    this.unlockAt = -1e9;
    this.autoResumeAt = -1e9;
    this.ran = false; // the context has reached 'running' at least once
    // learn which World emitted each event (the app's gate forwards payloads only): these direct
    // listeners on the shared bus run right before the gate's, for the same emit
    this._lastP = undefined;
    this._lastW = null;
    const rec = (p, _t, w) => {
      this._lastP = p;
      this._lastW = w || null;
    };
    for (const t of EVENTS) this.unsub.push(liveBus.on(t, rec));
    this.installUnlock();
    if (bus) this.bind(bus);
  }

  // ---------- lifecycle ----------
  // UNLOCK (why, in full: audio-unlock.js). iPhone Safari starts audio only inside touchend / click / keydown (and
  // the pointerup riding on a touchend), never touchstart / pointerdown, so GESTURES are watched on window in the
  // capture phase: the context is created / resumed + a one-sample silent buffer played synchronously inside the
  // gesture, before any game handler runs. Every later gesture re-tries while the context isn't 'running' (iOS:
  // 'interrupted' after a call / Siri / another app / a lock) or the silent loop that keeps iOS in the 'playback'
  // session (the ring/silent switch would mute 'ambient' Web Audio) has stopped. Hidden page: the context is
  // suspended and the loop paused; both come back on return (or at the next gesture if iOS refuses without one).
  installUnlock() {
    if (typeof window === "undefined") return;
    const fn = () => {
      const c = this.ctx;
      if (c && c.state === "running" && (this.muted || (this.session.want && !this.session.stalled))) return; // common case: all set
      this.unlock();
    };
    for (const ev of GESTURES) window.addEventListener(ev, fn, { capture: true, passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.session.hide();
        if (this.ctx) quiet(this.ctx.suspend());
        return;
      }
      if (!this.muted) this.session.show();
      if (this.ctx && this.ctx.state !== "running") quiet(this.ctx.resume());
    });
  }
  // force: create the context even before any user activation (test harnesses run with an
  // autoplay-permissive browser); real pages wait for a gesture, so no autoplay warnings
  unlock(force = false) {
    try {
      if (!this.ctx && !force) {
        const ua = typeof navigator !== "undefined" && navigator.userActivation;
        if (ua && !ua.hasBeenActive) return;
      }
      const hidden = typeof document !== "undefined" && document.hidden;
      // the session first ('playback' + the silent loop on iPhone), so the context starts inside it
      if (!this.muted && !hidden) this.session.claim();
      if (this.ctx) {
        if (this.ctx.state !== "running" && !hidden) {
          this.unlockAt = performance.now();
          kick(this.ctx);
        }
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      let ctx;
      try { ctx = new AC({ latencyHint: "interactive" }); } catch (_) { ctx = new AC(); }
      this.ctx = ctx;
      this.synth = new Synth(ctx, { bank: this.bank, level: LEVEL });
      this.music = new Music(this.synth);
      this.crowd = new Crowd(this.synth);
      this.applyMix(true);
      this.music.muted = this.muted;
      this.unlockAt = performance.now();
      // resume + a one-sample silent buffer inside the gesture (fully opens the output on older iOS)
      kick(ctx);
      ctx.addEventListener("statechange", () => this.onState());
      this.loadBank();
      this.timer = setInterval(() => this.tick(), 66);
    } catch (e) {
      reportError("audio.unlock", e);
    }
  }
  // iOS 'interrupted' (a call, Siri, another app's audio) or a suspend we didn't ask for, while the page is visible:
  // try to resume straight away (allowed once a gesture has started the context); the next gesture re-tries anyway
  onState() {
    const c = this.ctx;
    if (!c) return;
    if (c.state === "running") { this.ran = true; return; }
    if (c.state === "closed" || document.hidden) return;
    if (!this.ran && performance.now() - this.unlockAt > 5000) return; // never started by a gesture: nothing to restore
    const now = performance.now();
    if (now - this.autoResumeAt < 1000) return;
    this.autoResumeAt = now;
    quiet(c.resume());
  }
  loadBank() {
    if (this.bankState !== "none") return;
    this.bankState = "loading";
    renderBank(this.ctx, this.bank, BANK_ORDER, (name) => {
      if (name === "timp" && this.wantMusic) this.startMusic();
      if (name === "claps" && this.ambience) this.crowd.start();
    }).then(() => {
      this.bankState = "ready";
      if (this.ambience && !this.crowd.running) this.crowd.start();
      // the drums never arrived (no OfflineAudioContext?): play the theme without them
      if (this.wantMusic) this.startMusic();
    }, (e) => {
      this.bankState = "ready";
      reportError("audio.bank", e);
    });
  }
  get ready() { return !!this.ctx && this.ctx.state === "running"; }
  get t() { return this.ctx ? this.ctx.currentTime : 0; }
  // sfx gate: an unlocked, unmuted context that is running (or resuming inside this very gesture,
  // so the first menu click is heard on browsers that start contexts suspended)
  ok() {
    if (!this.synth || this.muted) return false;
    const st = this.ctx.state;
    return st === "running" || ((st === "suspended" || st === "interrupted") && performance.now() - (this.unlockAt || -1e9) < 600);
  }

  // ---------- mix ----------
  applyMix(now) {
    const s = this.synth;
    if (!s) return;
    const t = this.ctx.currentTime, tau = now ? 0.001 : 0.04;
    s.master.gain.setTargetAtTime(this.muted ? 0 : LEVEL, t, tau);
    s.musicOut.gain.setTargetAtTime(taper(this.vol.music), t, tau);
    s.sfxOut.gain.setTargetAtTime(taper(this.vol.sfx), t, tau);
  }
  setMuted(m) {
    this.muted = !!m;
    try { localStorage.setItem(KEY_MUTED, this.muted ? "1" : "0"); } catch (_) {}
    // sound off hands the iPhone's audio session back (the player's own music may play on); sound on claims it
    // again — the settings toggle runs inside the tap, so the silent loop may start
    if (this.muted) this.session.release();
    else if (this.ctx) this.session.claim();
    if (this.music) this.music.muted = this.muted;
    this.applyMix();
    if (!this.muted && this.wantMusic) this.startMusic();
  }
  setVolume(kind, v) {
    if (kind !== "music" && kind !== "sfx") return false;
    const n = Number(v);
    this.vol[kind] = Number.isFinite(n) ? clamp(n, 0, 1) : DEFAULT_VOL[kind];
    try { localStorage.setItem(KEY_VOL[kind], String(Math.round(this.vol[kind] * 1000) / 1000)); } catch (_) {}
    this.applyMix();
    return this.vol[kind];
  }
  getVolume(kind) { return this.vol[kind] != null ? this.vol[kind] : DEFAULT_VOL[kind]; }
  get volumes() { return { music: this.vol.music, sfx: this.vol.sfx }; }
  // music ducks under big moments: amount 0..1, held for `hold` seconds
  duck(amount = 0.7, hold = 1.5, release = 0.6) {
    const s = this.synth;
    if (!s) return;
    const g = s.duck.gain, t = this.ctx.currentTime;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
    }
    g.linearRampToValueAtTime(1 - amount, t + 0.08);
    g.setValueAtTime(1 - amount, t + 0.08 + hold);
    g.linearRampToValueAtTime(1, t + 0.08 + hold + release);
  }
  // the crowd dips under an in-game sting (broadcast-style sidechain), by `db` for `hold` seconds
  duckCrowd(db = 5, hold = 1.5, release = 0.8) {
    const s = this.synth;
    if (!s) return;
    const g = s.crowdIn.gain, t = this.ctx.currentTime, lo = Math.pow(10, -db / 20);
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
    else {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
    }
    g.linearRampToValueAtTime(lo, t + 0.12);
    g.setValueAtTime(lo, t + 0.12 + hold);
    g.linearRampToValueAtTime(1, t + 0.12 + hold + release);
  }
  setPaused(on) {
    this.pausedExplicit = true;
    this.applyPaused(!!on);
  }
  applyPaused(on) {
    if (on === this.paused) return;
    this.paused = on;
    if (this.crowd) this.crowd.setMuffled(on);
    if (this.ok()) (on ? SFX.pauseIn : SFX.pauseOut)(this.synth);
  }

  // ---------- music ----------
  startMusic() {
    this.wantMusic = true;
    if (!this.music || this.muted || (!this.bank.get("timp") && this.bankState !== "ready")) return;
    if (this.music.isPlaying("title")) return;
    this.music.play("title");
  }
  stopMusic() {
    this.wantMusic = false;
    if (this.music) this.music.stop("title", 0.5);
  }
  // a sting over the music: the menu loop ducks under it
  sting(name, opts = {}) {
    if (!this.music || this.muted || !SONGS[name]) return false;
    const S = SONGS[name];
    if (opts.only && this.music.isPlaying(name)) return false;
    const len = S.total * S.spb;
    if (S.bus !== "bg" && this.music.players.some((p) => p.song.bus === "bg" && !p.stopped)) this.duck(0.75, len + 0.3, 1.2);
    // in the stadium, the crowd dips a little so the band is heard
    if (S.bus !== "bg" && this.ambience && this.crowd && this.crowd.running) this.duckCrowd(opts.crowdDb == null ? 4 : opts.crowdDb, len * 0.8, 1);
    return !!this.music.play(name, { vol: opts.vol, t: opts.t });
  }

  // ---------- named sounds ----------
  play(name, opts = {}) {
    try {
      if (SONGS[name]) return this.sting(name, opts);
      if (!this.ok()) return false;
      const s = this.synth;
      switch (name) {
        case "blip": SFX.blip(s); break;
        case "blipHi": SFX.blip(s, { hi: true }); break;
        case "select": case "confirm": SFX.select(s); break;
        case "back": SFX.back(s); break;
        case "error": SFX.error(s); break;
        case "pause": SFX.pauseIn(s); break;
        case "resume": SFX.pauseOut(s); break;
        case "tick": SFX.tick(s, opts); break;
        case "reveal": SFX.reveal(s); break;
        case "lock": SFX.lock(s); break;
        case "whistle": SFX.whistle(s, opts); break;
        case "horn": SFX.horn(s, opts); break;
        case "chime": SFX.chime(s); break;
        case "cheer": case "ooh": case "aww":
          if (this.crowd) this.crowd.react(name, opts.vol || 1);
          else s.sample(name, { vol: 0.5 * (opts.vol || 1), bus: "crowd" });
          break;
        case "hit": SFX.hit(s, { power: opts.power || 70 }); break;
        case "bigHit": SFX.hit(s, { power: 160 }); break;
        case "catch": SFX.catchThump(s); break;
        case "kick": SFX.kick(s, opts); break;
        case "hut": case "set": SFX.voice(s, { word: name }); break;
        case "sfxPreview": SFX.hit(s, { power: 90 }); SFX.whistle(s, { t: s.now() + 0.25, vol: 0.7 }); break;
        default: return false;
      }
      return true;
    } catch (e) {
      reportError("audio.play", e);
      return false;
    }
  }
  // legacy menu calls (ui.js)
  blip(hi = false) { this.play(hi ? "blipHi" : "blip"); }
  select() { this.play("select"); }
  back() { this.play("back"); }
  error() { this.play("error"); }

  // ---------- the stadium ----------
  setGameAmbience(on) {
    this.ambience = !!on;
    this.resultOverride = null;
    this.clearTimers();
    // a result jingle or organ cue from the last game never runs over the next screen
    if (this.music) this.music.stopExcept("title", 0.35);
    if (on) {
      this.pregameArmed = true;
      this.secondArmed = false;
      this.world = null;
      this.paused = false;
      if (this.crowd) {
        this.crowd.setMuffled(false);
        this.crowd.base = 0.32;
        this.crowd.imp = 0;
        this.crowd.drive = 0;
        if (!this.crowd.running) this.crowd.start();
      }
    } else {
      this.world = null;
      if (this.crowd) this.crowd.stop(0.8);
    }
  }
  later(ms, fn) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      try { fn(); } catch (e) { reportError("audio.later", e); }
    }, ms);
    this.timers.add(id);
    return id;
  }
  clearTimers() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }
  // ~15 Hz: crowd model + live-play drivers read from the live World
  tick() {
    try {
      const cr = this.crowd;
      if (!cr || !cr.running) return;
      if (!this.pausedExplicit) {
        // fallback until main.js calls setPaused(): the app's pause flag via the test hooks
        const app = globalThis.__game && globalThis.__game.app;
        if (app) this.applyPaused(!!app.paused && app.scr === "game");
      }
      const w = this.world;
      let drive = 0, rumble = 0;
      // live plays (and kick returns, whatever phase the football team runs them in)
      const ph = w && w.phase;
      if (w && (ph === "LIVE" || ph === "KICKOFF" || ph === "RETURN")) {
        drive = 0.1;
        const b = w.ball;
        if (b.state === "air" && b.kind === "pass" && b.tArrive > b.tSpawn) drive += 0.3 * clamp((w.time - b.tSpawn) / (b.tArrive - b.tSpawn), 0, 1);
        const c = b.state === "held" ? b.carrier : null;
        if (c && c.state !== "tackled") {
          const dir = w.dirOf(c);
          let nd = 99;
          for (const p of w.players) {
            if (p.team === c.team || p.downUntil > w.time || (p.blockers && p.blockers.length)) continue;
            const d = Math.hypot(p.x - c.x, p.y - c.y);
            if (d < nd) nd = d;
          }
          const open = clamp((nd - 1.5) / 7, 0, 1);
          const sp = clamp(Math.hypot(c.vx, c.vy) / Math.max(1, c.r.speed), 0, 1);
          const toGoal = dir > 0 ? 100 - c.x : c.x;
          const gained = dir > 0 ? c.x - w.los : 0;
          drive += 0.25 * sp * open + 0.45 * clamp((22 - toGoal) / 22, 0, 1) * (0.4 + 0.6 * open) + 0.3 * clamp(gained / 30, 0, 1);
        }
        let sum = 0;
        for (const p of w.players) sum += Math.hypot(p.vx, p.vy);
        rumble = clamp(sum / Math.max(1, w.players.length) / 6.5, 0, 1);
      }
      cr.drive = drive;
      cr.rumble += (rumble - cr.rumble) * 0.35;
      cr.update();
    } catch (e) {
      reportError("audio.tick", e);
    }
  }
  // the ball carrier's footfalls (main.js) — louder and brighter with speed
  step() {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastStepT < 0.06) return;
    this.lastStepT = now;
    const w = this.world, c = w && w.ball && w.ball.carrier;
    const k = c ? clamp(Math.hypot(c.vx, c.vy) / Math.max(1, c.r.speed), 0, 1.1) : 0.6;
    SFX.step(this.synth, { k, pan: c ? this.pan(c) : 0, vol: c && c.mass > 1.2 ? 1.3 : 1 });
  }
  pan(p) {
    const w = this.world;
    if (!p || !w || !Number.isFinite(p.x)) return 0;
    const fx = w.ball && Number.isFinite(w.ball.x) ? w.ball.x : p.x;
    return clamp((p.x - fx) / 26, -0.75, 0.75);
  }
  // per-kind throttle (seconds of audio time)
  gap(key, sec) {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (now - (this.lastAt[key] || -99) < sec) return false;
    this.lastAt[key] = now;
    return true;
  }
  isFav(team) { return team === this.fav; }
  pitchOf(p) { return p && p.mass ? clamp(1.16 - 0.26 * (p.mass - 0.55), 0.86, 1.18) : 1; }

  // ---------- game events ----------
  bind(bus) {
    const on = (type, fn) => {
      this.unsub.push(bus.on(type, (p, _t, w) => {
        const world = w || (p === this._lastP ? this._lastW : null);
        if (world) this.world = world;
        this.counts[type] = (this.counts[type] || 0) + 1;
        // handlers always run (game-state bookkeeping: who has the ball, armed stings…); every
        // sound inside them is gated by ok() / a live crowd, so nothing plays before unlock
        try {
          fn(p || {}, world || this.world);
        } catch (e) {
          reportError(`audio "${type}"`, e);
        }
      }));
    };
    const s = () => this.synth;
    const cr = () => this.crowd;
    const ok = () => this.ok();

    // ---- flow ----
    on("playCall", (p, w) => {
      this.fav = p.human || "home";
      if (p.offense) this.offense = p.offense;
      const c = cr();
      if (!c) return;
      let base = 0.24;
      if (p.down >= 3) base += 0.1;
      if (p.los >= 80) base += 0.08;
      if (w && w.quarter >= 4 && Math.abs(w.score.home - w.score.away) <= 8 && w.clock < 60) base += 0.12;
      c.base = base;
      if (!ok()) return;
      // stadium organ between plays (never two in a row, never too often)
      const now = this.ctx.currentTime;
      if (now - this.organAt > 24) {
        let cue = null;
        const favDef = p.defense === this.fav;
        if (favDef && p.down >= 3) cue = s().rand() < 0.5 ? "rise" : "charge";
        else if (this.firstDownOrgan && s().rand() < 0.45) cue = s().rand() < 0.6 ? "lick" : "tada";
        if (cue) {
          this.organAt = now;
          this.later(650, () => {
            if (this.ok() && this.ambience) this.sting(cue);
            if (cue === "charge") this.later(1800, () => this.ok() && cr() && cr().react("cheer", 0.7));
          });
        }
      }
      this.firstDownOrgan = false;
    });
    on("possession", (p) => { if (p.team) this.offense = p.team; });
    on("presnap", (p) => {
      const c = cr();
      const kickPlay = p.off === "punt" || p.off === "fg";
      const favOff = this.offense === this.fav;
      const w = this.world;
      const third = w && w.down >= 3;
      if (c) c.base = favOff ? 0.14 : third ? 0.62 : 0.44;
      if (!ok()) return;
      // the visitors face 3rd down: DE-FENSE!
      if (!favOff && third && !kickPlay && c) c.chant(3);
      if (!kickPlay) {
        const qb = w && w.offPlayers ? w.offPlayers.find((x) => x.pos === "QB") : null;
        this.setTimer = this.later(720, () => {
          const ww = this.world;
          if (ww && ww.phase === "PRE_SNAP" && this.ok()) SFX.voice(this.synth, { word: "set", pitch: this.pitchOf(qb), vol: favOff ? 1 : 0.7 });
        });
      }
    });
    on("snap", (p) => {
      if (this.setTimer) {
        clearTimeout(this.setTimer);
        this.timers.delete(this.setTimer);
        this.setTimer = null;
      }
      const c = cr();
      if (c) {
        c.base = 0.32;
        c.stopChant(); // the chant breaks into a roar at the snap
      }
      this.blockN = 0;
      this.snapT = this.t;
      if (!ok()) return;
      const qb = p.qb;
      SFX.snapPop(s(), { pan: this.pan(qb) });
      if (qb && qb.pos === "QB") {
        // "hut-HUT!": the ball moves on the first
        const favOff = this.offense === this.fav, pitch = this.pitchOf(qb), v = favOff ? 1 : 0.75;
        SFX.voice(s(), { word: "hut", pitch, vol: 0.85 * v });
        SFX.voice(s(), { t: this.t + 0.24, word: "hut", pitch: pitch * 1.04, vol: v });
      }
    });
    // 'kickoff' = the teams line up (the boot comes later as 'kick' {kind:'kickoff'|'onside'})
    on("kickoff", (p) => {
      if (p.receiver) this.offense = p.receiver;
      const c = cr();
      if (c) {
        c.base = 0.5;
        c.pump(0.35, 2.5);
      }
      const sting = this.pregameArmed ? "pregame" : this.secondArmed ? "second" : null;
      this.pregameArmed = this.secondArmed = false;
      if (!ok()) return;
      if (sting) this.sting(sting);
    });
    on("return", (p) => {
      const c = cr();
      const r = p.returner || p.player || p.carrier;
      if (c) c.pump(0.35, 2);
      if (!ok()) return;
      SFX.catchThump(s(), { pan: this.pan(r) });
    });
    on("fairCatch", (p) => {
      const c = cr();
      if (c) c.imp *= 0.4;
      if (!ok()) return;
      SFX.catchThump(s(), { pan: this.pan(p.player || p.returner) });
    });
    on("onside", (p) => {
      const c = cr();
      if (c) c.pump(0.7, 2.5);
      if (!ok()) return;
      // the boot itself is voiced by the 'kick' {kind:'onside'} that follows
      SFX.bounce(s(), { t: this.t + 0.25, n: 6, vol: 1.2 });
      if (c) c.react("ooh", 1, this.t + 0.2);
    });
    on("twoPoint", (p) => {
      const c = cr();
      const fav = this.isFav(p.team);
      if (c) {
        c.base = 0.55;
        c.pump(p.good && fav ? 1 : 0.4, 3);
      }
      if (!ok()) return;
      if (p.good) {
        SFX.goodDing(s(), { vol: 0.8 });
        if (c) c.react(fav ? "cheer" : "aww", fav ? 1.1 : 0.8);
      } else if (c) c.react(fav ? "aww" : "cheer", 0.8);
    });
    on("quarterEnd", (p) => {
      if (!ok()) return;
      if (p.q === 1 || p.q === 3) SFX.quarterHorn(s());
    });
    on("halftime", () => {
      const c = cr();
      if (c) {
        c.base = 0.2;
        c.imp = 0;
      }
      if (!ok()) return;
      SFX.quarterHorn(s());
      this.later(900, () => this.sting("halftime"));
      // then the band plays the fight song under the halftime screen until the 2nd half
      this.bandTimer = this.later(5300, () => {
        const w = this.world;
        if (this.ok() && this.ambience && w && w.phase === "HALFTIME" && !this.music.isPlaying("band")) this.music.play("band");
      });
    });
    on("secondHalf", () => {
      this.secondArmed = true;
      if (this.bandTimer) {
        clearTimeout(this.bandTimer);
        this.timers.delete(this.bandTimer);
        this.bandTimer = null;
      }
      if (this.music) this.music.stop("band", 1.2);
    });
    on("overtime", () => {
      const c = cr();
      if (c) c.pump(0.6, 3);
      if (!ok()) return;
      this.sting("overtime");
    });
    on("gameOver", (p) => {
      const c = cr();
      const won = p.winner === this.fav, tie = p.winner === "tie";
      if (c) {
        c.base = won ? 0.6 : 0.25;
        c.pump(won ? 1.2 : 0.4, 5);
      }
      if (!ok()) return;
      SFX.horn(s(), { rate: 0.92, vol: 1 });
      SFX.whistle(s(), { t: this.t + 0.3, n: 3, long: true, vol: 0.9 });
      if (c) c.react(won ? "cheer" : tie ? "ooh" : "aww", 1.2, this.t + 0.4);
      // the results screen opens ~2.2 s after the final whistle (a mode can swap the jingle, e.g.
      // the Gym Challenge's badge fanfare: set audio.resultOverride = 'badge' before then)
      this.later(2300, () => {
        if (!this.ambience) return;
        const name = this.resultOverride || (tie ? "tie" : won ? "victory" : "defeat");
        this.resultOverride = null;
        this.sting(name);
        if (won && cr()) cr().react("cheer", 1);
      });
    });

    // ---- ball ----
    on("handoff", (p) => {
      if (!ok()) return;
      if (p.pitch) SFX.whoosh(s(), { dur: 0.22, f: 1100, vol: 0.7, pan: this.pan(p.to) });
      SFX.handoff(s(), { t: this.t + (p.pitch ? 0.18 : 0), pan: this.pan(p.to) });
    });
    on("fake", (p) => { if (ok()) SFX.handoff(s(), { pan: this.pan(p.qb) }); });
    on("scramble", () => { const c = cr(); if (c) c.pump(0.2); });
    on("throw", (p, w) => {
      const c = cr();
      if (c) c.pump(0.12);
      if (!ok()) return;
      const b = p.ball || (w && w.ball);
      const dur = b && w && b.tArrive > w.time ? b.tArrive - w.time : 0.8;
      SFX.throwZip(s(), { dur, pan: this.pan(p.qb) });
      if (p.qb && p.qb.types && p.qb.types[0] === "psychic") SFX.flair(s(), "psychic", { pan: this.pan(p.qb) });
    });
    on("catch", (p) => {
      const pl = p.player;
      if (!ok()) return;
      SFX.catchThump(s(), { hard: !!p.contested, pan: this.pan(pl) });
      if (p.kick || !pl) return;
      const c = cr();
      if (!c) return;
      if (this.isFav(pl.team)) {
        c.pump(p.contested ? 0.6 : 0.3);
        if (p.contested) c.react("cheer", 0.8);
      } else c.pump(0.12);
    });
    on("drop", (p) => {
      const c = cr();
      if (c) {
        c.pump(0.3);
        if (ok()) c.react("ooh", 1);
      }
      this.dropT = this.t;
    });
    on("deflect", (p) => {
      const c = cr();
      if (ok()) SFX.glance(s(), { pan: this.pan(p.player) });
      if (c) {
        c.pump(0.35);
        // a defender got a hand on it: the near-interception "OOOH"
        if (ok()) c.react("ooh", p.swat ? 1.1 : 0.8);
      }
      this.dropT = this.t;
    });
    on("incomplete", (p) => {
      if (!ok()) return;
      const w = this.world;
      if (w && w.play && w.play.kick) return;
      SFX.bounce(s(), { t: this.t + 0.12, n: 4, pan: 0 });
      const c = cr();
      if (!c || this.t - (this.dropT || -9) < 0.5) return;
      const tgt = p.target;
      if (tgt && this.isFav(tgt.team)) c.react("aww", 0.55);
      else c.pump(0.25);
    });
    on("interception", (p) => {
      const pl = p.player;
      const c = cr();
      const fav = pl && this.isFav(pl.team);
      if (c) c.pump(fav ? 1.1 : 0.5, fav ? 3 : 1.8);
      if (!ok()) return;
      SFX.catchThump(s(), { hard: true, pan: this.pan(pl) });
      if (c) c.react(fav ? "cheer" : "aww", 1.2);
      this.sting(fav ? "turnFor" : "turnAgainst");
    });
    on("fumble", (p) => {
      const c = cr();
      if (c) c.pump(0.6, 2);
      if (!ok()) return;
      SFX.bounce(s(), { t: this.t + 0.15, n: 6, vol: 1.3, pan: this.pan(p.carrier) });
      if (c) c.react("ooh", 1.2);
    });
    on("fumbleDive", (p) => { if (ok()) SFX.turf(s(), { pan: this.pan(p.player) }); });

    // ---- kicks ----
    on("kickSet", (p) => {
      const c = cr();
      if (c && p.kind === "fg") c.base = this.offense === this.fav ? 0.12 : 0.55;
    });
    on("kick", (p, w) => {
      const c = cr();
      if (c) c.pump(0.2);
      if (!ok()) return;
      // kickoffs and onside kicks boot here too (the 'kickoff' event was the line-up)
      const kind = p.kind === "kickoff" || p.kind === "onside" ? "kickoff" : "fg";
      SFX.kick(s(), { kind, pan: this.pan(p.kicker) });
      if (p.kind === "onside") return; // driven into the turf: bounces, no hang time
      const dur = w && w.ball && w.ball.tArrive > w.time ? w.ball.tArrive - w.time : kind === "kickoff" ? 2.4 : 1.25 + (p.distance || 30) / 45;
      SFX.ballFlight(s(), { dur });
    });
    on("punt", (p, w) => {
      if (!ok()) return;
      const dur = w && w.ball && w.ball.tArrive > w.time ? w.ball.tArrive - w.time : 3;
      SFX.kick(s(), { kind: "punt", pan: this.pan(p.kicker) });
      SFX.ballFlight(s(), { dur });
    });
    on("pat", (p) => {
      if (!ok()) return;
      SFX.kick(s(), { kind: "pat" });
      SFX.ballFlight(s(), { dur: 1.2 });
      const fav = this.isFav(p.team);
      this.later(1150, () => {
        if (!this.ok()) return;
        const c = cr();
        if (p.good) {
          SFX.goodDing(s(), { vol: 0.8 });
          if (c && fav) c.pump(0.4);
        } else {
          SFX.noGood(s());
          if (c) c.react(fav ? "aww" : "cheer", 0.7);
        }
      });
    });
    on("fieldGoal", (p) => {
      const fav = this.offense === this.fav;
      const c = cr();
      if (!ok()) return;
      if (p.good) {
        SFX.goodDing(s());
        if (c) {
          c.pump(fav ? 0.9 : 0.15, 2.5);
          c.react(fav ? "cheer" : "aww", fav ? 1 : 0.7);
        }
        if (fav) this.later(1400, () => this.ambience && this.sting("tada"));
      } else {
        SFX.noGood(s());
        if (c) c.react(fav ? "aww" : "cheer", 0.9);
      }
    });

    // ---- contact ----
    on("block", (p) => {
      if (!ok()) return;
      const now = this.t;
      if (now - (this.snapT || -9) < 0.7 && !this.lineDone) {
        this.lineDone = true;
        SFX.lineCrash(s(), { pan: this.pan(p.blocker) });
        return;
      }
      if (this.gap("block", 0.09)) {
        const k = p.blocker && p.blocker.r ? clamp(p.blocker.r.power / 110, 0.2, 1) : 0.5;
        SFX.blockThud(s(), { k, pan: this.pan(p.blocker) });
      }
    });
    on("snap", () => { this.lineDone = false; });
    on("disengage", (p) => { if (ok() && this.gap("diseng", 0.3)) SFX.disengage(s(), { pan: this.pan(p.defender) }); });
    on("pancake", (p) => {
      const c = cr();
      if (c) c.pump(0.3);
      if (!ok()) return;
      SFX.pancake(s(), { pan: this.pan(p.defender), pitch: this.pitchOf(p.defender) });
      if (c && this.gap("pancakeOoh", 3)) c.react("ooh", 0.6);
    });
    on("tackleAttempt", (p) => {
      if (ok() && this.gap("lunge", 0.25)) SFX.whoosh(s(), { dur: 0.18, f: 800, vol: 0.45, pan: this.pan(p.tackler) });
    });
    on("tackle", (p) => {
      const pw = p.power || 50;
      const c = cr();
      const favD = p.tackler && this.isFav(p.tackler.team);
      if (c) c.pump(0.12 + clamp(pw / 260, 0, 0.6) * (favD ? 1 : 0.6));
      if (!ok()) return;
      const pan = this.pan(p.carrier);
      SFX.hit(s(), { power: pw, pan });
      if (pw > HIT_BIG * 0.75) SFX.grunt(s(), { t: this.t + 0.02, pan, pitch: this.pitchOf(p.carrier), vol: pw > HIT_HUGE ? 1.2 : 0.8 });
      const ty = p.tackler && p.tackler.types && p.tackler.types[0];
      if (ty && pw > 60) SFX.flair(s(), ty, { t: this.t + 0.01, pan, vol: pw > HIT_BIG ? 1 : 0.6 });
      if (c && pw > HIT_HUGE) c.react("ooh", 1.1, this.t + 0.12);
      else if (c && pw > HIT_BIG && favD) c.pump(0.25);
    });
    on("brokenTackle", (p) => {
      const c = cr();
      const fav = p.carrier && this.isFav(p.carrier.team);
      if (c) c.pump(fav ? 0.4 : 0.25);
      if (!ok() || !this.gap("broken", 0.25)) return;
      SFX.glance(s(), { pan: this.pan(p.carrier) });
    });
    on("juke", (p) => {
      const c = cr();
      if (c) c.pump(0.18);
      if (!ok()) return;
      SFX.juke(s(), { pan: this.pan(p.player) });
      const ty = p.player && p.player.types && p.player.types[0];
      if (ty === "ghost" || ty === "electric" || ty === "psychic") SFX.flair(s(), ty, { pan: this.pan(p.player), vol: 0.8 });
    });
    on("stiffArm", (p) => {
      const c = cr();
      if (c) c.pump(0.2);
      if (ok()) SFX.stiffArm(s(), { pan: this.pan(p.player), pitch: this.pitchOf(p.player) });
    });
    on("dive", (p) => { if (ok()) SFX.whoosh(s(), { dur: 0.3, f: 650, pan: this.pan(p.player) }); });
    on("diveEnd", (p) => { if (ok() && this.gap("diveEnd", 0.2)) SFX.turf(s(), { pan: this.pan(p.player) }); });
    on("sack", (p) => {
      const c = cr();
      const fav = p.tackler ? this.isFav(p.tackler.team) : this.offense !== this.fav;
      if (c) c.pump(fav ? 0.9 : 0.35, 2.4);
      if (!ok() || !c) return;
      c.react(fav ? "cheer" : "aww", fav ? 1 : 0.8, this.t + 0.1);
    });
    on("outOfBounds", (p) => { if (ok()) SFX.turf(s(), { pan: this.pan(p.player) }); });

    // ---- scoring & results of plays ----
    on("touchdown", (p) => {
      const fav = this.isFav(p.team);
      const c = cr();
      if (c) c.setSlow(false);
      if (c) c.pump(fav ? 1.6 : 0.4, fav ? 4.5 : 1.5);
      if (!ok()) return;
      // the horn blares, then the band answers as it releases (they'd mask each other together)
      SFX.horn(s(), { t: this.t + 0.05, dur: 1.25 });
      if (c) {
        c.react(fav ? "cheer" : "aww", 1.3);
        if (fav) this.later(1200, () => cr() && cr().react("cheer", 1));
      }
      this.sting(fav ? "td" : "tdAgainst", { t: this.t + 1.0 });
    });
    on("safety", (p) => {
      const fav = this.isFav(p.team);
      const c = cr();
      if (c) c.pump(fav ? 1 : 0.3, 3);
      if (!ok()) return;
      SFX.horn(s(), { dur: 1.1 });
      if (c) c.react(fav ? "cheer" : "aww", 1);
    });
    on("whistle", (p) => {
      const c = cr();
      if (c) {
        c.base = 0.26;
        c.stopChant();
        if (c.slow) c.setSlow(false);
      }
      if (!ok() || !this.gap("whistle", 0.3)) return;
      const r = p.result || {};
      const w = this.world;
      const long = r.type === "td" || (w && w.play && w.play.turnover);
      SFX.whistle(s(), { t: this.t + 0.1, long, vol: r.type === "td" ? 0.7 : 1 });
    });
    on("firstDown", () => {
      const fav = this.offense === this.fav;
      const c = cr();
      const w = this.world;
      if (w && w.play && w.play.result && w.play.result.type === "td") return;
      if (c) c.pump(fav ? 0.4 : 0.1);
      if (fav) this.firstDownOrgan = true;
      if (ok()) SFX.chime(s());
    });
    on("turnover", (p) => {
      if (p.kind !== "downs" && p.kind !== "fumble") return;
      // the old defense takes over: their fans' moment (emitted before the possession flips). An
      // intercepted ball fumbled back to the original offense is the reverse.
      const w = this.world;
      let favGets = this.offense !== this.fav;
      if (p.kind === "fumble" && w && w.play && w.play.turnover) favGets = !favGets;
      const c = cr();
      if (c) c.pump(favGets ? 0.7 : 0.2, 2);
      if (!ok()) return;
      if (c) c.react(favGets ? "cheer" : "aww", 0.9);
      this.sting(favGets ? "turnFor" : "turnAgainst");
    });
    on("bigPlay", (p) => {
      const c = cr();
      if (p.player && this.isFav(p.player.team)) {
        if (c) c.pump(0.5, 2.5);
        this.firstDownOrgan = true; // the organist answers in the next huddle
      }
    });
    on("slowmo", (p) => {
      const c = cr();
      if (c) c.setSlow(!!p.on);
      if (!p.on) return;
      if (c) c.pump(0.7, 2);
      if (ok() && this.gap("riser", 2)) SFX.riser(s());
    });
    on("target", () => { if (ok() && this.gap("target", 0.06)) SFX.tick(s(), { vol: 0.8 }); });
    on("switch", () => { if (ok() && this.gap("switch", 0.06)) SFX.tick(s(), { hi: true, vol: 0.8 }); });
  }

  // ---------- diagnostics ----------
  stats() {
    const s = this.synth;
    return {
      state: this.ctx ? this.ctx.state : "none",
      muted: this.muted,
      volumes: this.volumes,
      bank: this.bankState === "ready" ? this.bank.size : this.bankState,
      voices: s ? s.active : 0,
      peakVoices: s ? s.peak : 0,
      created: s ? s.created : 0,
      dropped: s ? s.dropped : 0,
      music: this.music ? this.music.players.map((p) => p.song.name) : [],
      crowd: this.crowd && this.crowd.running ? Math.round(this.crowd.ex * 100) / 100 : null,
      events: { ...this.counts },
      paused: this.paused,
      session: this.session.stats(),
    };
  }
}
