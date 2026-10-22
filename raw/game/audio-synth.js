// ALL-22 BOWL audio — the synth engine (audio team).
// The mix graph, chip wavetables, envelope voices (oscillator, noise, FM, sample), two SNES-style
// echo units, noise buffers and the sample bank. Works on any BaseAudioContext: the live
// AudioContext, or an OfflineAudioContext (sample-bank renders and the offline level tests).
//
// Graph (full mode):
//   voices → musicBg → duck ─┐
//   voices → musicFg ────────┴→ musicOut (music volume) ─┐
//   voices → sfxIn  ─────────┐                            ├→ master (mute·level) → limiter → softClip → out
//   crowd  → crowdIn ────────┴→ sfxOut   (sfx volume)   ─┘
//   echo sends: music → echoM (dotted-8th repeat) → musicOut; sfx → echoS (stadium slap) → sfxOut
// "lite" mode (bank renders): every bus is one gain straight into the destination.

export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const MASTER_LEVEL = 0.74; // master gain into the limiter (the live game and the offline lab)
// NaN-safe (→ a): a stray NaN must never reach an AudioParam (that throws)
export const clamp = (v, a, b) => (v >= a ? (v <= b ? v : b) : a);

// xorshift32 → [0, 1). Audio variation only (never touches the sim's RNG).
export function makeRand(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Linear up to 0.8, then a tanh knee that never passes ~0.945: the last line of defence against clipping.
function softClipCurve(n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, ax = Math.abs(x);
    c[i] = ax <= 0.8 ? x : Math.sign(x) * (0.8 + 0.18 * Math.tanh((ax - 0.8) / 0.18));
  }
  return c;
}
let CLIP_CURVE = null;

// Shared hard-ish drive curve for crunchy hits.
export function driveCurve(k = 6, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

const OAC = () => globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext || null;

export class Synth {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.lite = !!opts.lite;
    this.rand = makeRand(opts.seed || 0x22b0);
    this.bank = opts.bank || new Map();
    this.cap = opts.cap || 90;
    this.active = 0;
    this.peak = 0;
    this.created = 0;
    this.dropped = 0;
    this.waves = Object.create(null);
    this.noiseBufs = Object.create(null);
    this.curves = Object.create(null);
    this.hasPan = typeof ctx.createStereoPanner === "function";
    this.build(opts.level == null ? MASTER_LEVEL : opts.level);
  }

  // ---------- graph ----------
  build(level) {
    const c = this.ctx;
    if (this.lite) {
      const out = c.createGain();
      out.connect(c.destination);
      this.master = this.musicBg = this.musicFg = this.musicOut = this.sfxIn = this.sfxOut = this.crowdIn = this.duck = out;
      this.sendM = this.sendS = null;
      return;
    }
    const g = (v = 1) => {
      const n = c.createGain();
      n.gain.value = v;
      return n;
    };
    this.level = level;
    this.master = g(level);
    const lim = (this.limiter = c.createDynamicsCompressor());
    lim.threshold.value = -6;
    lim.knee.value = 4;
    lim.ratio.value = 10;
    lim.attack.value = 0.003;
    lim.release.value = 0.16;
    this.clip = c.createWaveShaper();
    this.clip.curve = CLIP_CURVE || (CLIP_CURVE = softClipCurve());
    this.master.connect(lim);
    lim.connect(this.clip);
    this.clip.connect(c.destination);
    this.musicOut = g(1);
    this.musicOut.connect(this.master);
    this.duck = g(1);
    this.duck.connect(this.musicOut);
    this.musicBg = g(1);
    this.musicBg.connect(this.duck);
    this.musicFg = g(1);
    this.musicFg.connect(this.musicOut);
    this.sfxOut = g(1);
    this.sfxOut.connect(this.master);
    this.sfxIn = g(1);
    this.sfxIn.connect(this.sfxOut);
    this.crowdIn = g(1);
    this.crowdIn.connect(this.sfxOut);
    // SNES-style echoes: a filtered feedback delay per family
    this.echoM = this.makeEcho(0.3, 0.3, 2400, 0.55, this.musicOut);
    this.echoS = this.makeEcho(0.16, 0.26, 2800, 0.6, this.sfxOut);
    this.sendM = [0.16, 0.36, 0.7].map((v) => { const n = g(v); n.connect(this.echoM.inp); return n; });
    this.sendS = [0.16, 0.36, 0.7].map((v) => { const n = g(v); n.connect(this.echoS.inp); return n; });
  }
  makeEcho(time, fb, lp, wet, dest) {
    const c = this.ctx;
    const inp = c.createGain();
    const d = c.createDelay(1);
    d.delayTime.value = time;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lp;
    f.Q.value = 0.5;
    const fbk = c.createGain();
    fbk.gain.value = fb;
    const w = c.createGain();
    w.gain.value = wet;
    inp.connect(d);
    d.connect(f);
    f.connect(fbk);
    fbk.connect(d);
    f.connect(w);
    w.connect(dest);
    return { inp, d, f, fbk, w };
  }
  busFor(name) {
    switch (name) {
      case "music": case "fg": return this.musicFg;
      case "bg": return this.musicBg;
      case "crowd": return this.crowdIn;
      default: return this.sfxIn;
    }
  }
  sendFor(bus, amt) {
    const list = bus === "music" || bus === "fg" || bus === "bg" ? this.sendM : this.sendS;
    if (!list) return null;
    return list[clamp(Math.round(amt), 1, 3) - 1];
  }

  // ---------- bookkeeping ----------
  now() { return this.ctx.currentTime; }
  at(t) {
    const now = this.ctx.currentTime;
    return t == null || !(t > now) ? now : t;
  }
  // Each source node is one active voice until its 'ended' event.
  track(src) {
    this.active++;
    this.created++;
    if (this.active > this.peak) this.peak = this.active;
    src.onended = () => {
      this.active--;
      src.onended = null;
    };
  }
  // prio 0: ambience/footsteps (first to go), 1: normal sfx, 2: music & key moments
  admit(prio) {
    const a = this.active, cap = this.cap;
    if (prio >= 2 ? a < cap * 1.8 : prio === 1 ? a < cap : a < cap * 0.55) return true;
    this.dropped++;
    return false;
  }
  route(node, o) {
    let last = node;
    if (o.pan && this.hasPan && Number.isFinite(o.pan)) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(o.pan, -1, 1);
      last.connect(p);
      last = p;
    }
    last.connect(o.out || this.busFor(o.bus));
    if (o.echo) {
      const s = this.sendFor(o.bus, o.echo);
      if (s) last.connect(s);
    }
  }
  filt(input, type, f, q, t, f2, tf) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.setValueAtTime(f, t);
    if (f2 > 0) b.frequency.exponentialRampToValueAtTime(f2, t + Math.max(0.01, tf));
    if (q != null) b.Q.value = q;
    input.connect(b);
    return b;
  }

  // Gain envelope on AudioParam p from time t; returns the voice length in seconds.
  //   percussive: {vol, a, h, dur}  — attack, optional hold, exponential decay to silence at dur
  //   gated:      {vol, a, d, s, gate, r} — attack, decay (τ = d) to s·vol, release (r) at gate
  env(p, t, o) {
    const v = o.vol == null ? 0.2 : o.vol >= 0 ? o.vol : 0;
    const a = o.a == null ? 0.003 : o.a;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + a);
    if (o.gate != null) {
      const gate = Math.max(a + 0.005, o.gate);
      const r = o.r == null ? 0.04 : o.r;
      if (o.s != null && o.s < 1) p.setTargetAtTime(v * o.s, t + a, o.d == null ? 0.1 : o.d);
      p.setTargetAtTime(0, t + gate, r / 3);
      return gate + r * 1.7;
    }
    const h = o.h || 0;
    const dur = Math.max(a + h + 0.006, o.dur == null ? 0.2 : o.dur);
    if (h > 0) p.setValueAtTime(v, t + a + h);
    p.exponentialRampToValueAtTime(v * 0.002 + 1e-5, t + dur);
    return dur;
  }

  // ---------- wavetables ----------
  wave(name) {
    let w = this.waves[name];
    if (w) return w;
    const N = 64;
    const re = new Float32Array(N), im = new Float32Array(N);
    const pulse = (d) => {
      for (let n = 1; n < N; n++) {
        re[n] = Math.sin(2 * Math.PI * n * d) / (n * Math.PI);
        im[n] = (1 - Math.cos(2 * Math.PI * n * d)) / (n * Math.PI);
      }
    };
    switch (name) {
      case "p12": pulse(0.125); break;
      case "p25": pulse(0.25); break;
      case "p50": pulse(0.5); break;
      case "nes": {
        // the 4-bit, 32-step triangle of an NES/2A03 — gritty chip bass
        const M = 1024;
        for (let n = 1; n < 40; n++) {
          let a = 0, b = 0;
          for (let i = 0; i < M; i++) {
            const k = ((i * 32) / M) | 0;
            const v = (k < 16 ? 15 - k : k - 16) / 7.5 - 1;
            a += v * Math.cos((2 * Math.PI * n * i) / M);
            b += v * Math.sin((2 * Math.PI * n * i) / M);
          }
          re[n] = (2 * a) / M;
          im[n] = (2 * b) / M;
        }
        break;
      }
      case "organ": {
        // drawbars 16' 8' 5⅓' 4' 2⅔' 2' 1⅗' 1⅓' 1' (play an octave down: harmonic 2 = written pitch)
        const H = { 1: 0.5, 2: 1, 3: 0.55, 4: 0.75, 6: 0.38, 8: 0.5, 10: 0.12, 12: 0.2, 16: 0.14 };
        for (const k in H) im[k] = H[k];
        break;
      }
      case "brass":
        for (let n = 1; n < N; n++) im[n] = (1 / n) * Math.pow(0.9, n - 1);
        break;
      case "reed":
        for (let n = 1; n < N; n += 2) im[n] = 1 / n;
        for (let n = 2; n < 12; n += 2) im[n] = 0.25 / n;
        break;
      default:
        pulse(0.5);
    }
    w = this.ctx.createPeriodicWave(re, im);
    this.waves[name] = w;
    return w;
  }

  // ---------- noise ----------
  noiseBuf(color) {
    let b = this.noiseBufs[color];
    if (b) return b;
    const c = this.ctx, sr = c.sampleRate, len = Math.floor(sr * 2), xf = Math.floor(sr * 0.05);
    const d = new Float32Array(len + xf);
    const r = makeRand(color === "pink" ? 7 : color === "brown" ? 11 : 3);
    if (color === "pink") {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else if (color === "brown") {
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    }
    b = c.createBuffer(1, len, sr);
    b.getChannelData(0).set(loopFrom(d, len, xf));
    this.noiseBufs[color] = b;
    return b;
  }
  curve(name) {
    return this.curves[name] || (this.curves[name] = name === "crunch" ? driveCurve(7) : name === "gtr" ? driveCurve(4.5) : driveCurve(3));
  }

  // ---------- voices ----------
  // Oscillator voice. o: {t, f, f2, glide, lin, wave|type, det, vol, a, h, dur | gate, d, s, r,
  //   lp, lp2, lpT, q, hp, vib:[rate, cents, delay], bus, echo, pan, prio}
  tone(o) {
    if (!(o.f > 0) || !this.admit(o.prio == null ? 1 : o.prio)) return null;
    const c = this.ctx, t = this.at(o.t);
    const osc = c.createOscillator();
    if (o.wave) osc.setPeriodicWave(this.wave(o.wave));
    else osc.type = o.type || "square";
    const f = osc.frequency;
    f.setValueAtTime(o.f, t);
    if (o.f2 > 0) {
      const gl = Math.max(0.005, o.glide || o.dur || 0.1);
      if (o.lin) f.linearRampToValueAtTime(o.f2, t + gl);
      else f.exponentialRampToValueAtTime(o.f2, t + gl);
    }
    if (o.det) osc.detune.setValueAtTime(o.det, t);
    const g = c.createGain();
    const len = this.env(g.gain, t, o);
    osc.connect(g);
    let out = g;
    if (o.lp) out = this.filt(out, "lowpass", o.lp, o.q, t, o.lp2, o.lpT || len);
    if (o.hp) out = this.filt(out, "highpass", o.hp, 0.7, t);
    this.route(out, o);
    if (o.vib) this.vibrato(osc, t, len, o.vib);
    osc.start(t);
    osc.stop(t + len + 0.01);
    this.track(osc);
    return osc;
  }
  vibrato(osc, t, len, v) {
    const [rate, cents, delay = 0.12] = v;
    if (len < delay + 0.1) return;
    const c = this.ctx;
    const l = c.createOscillator();
    l.frequency.value = rate;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setValueAtTime(0, t + delay);
    g.gain.linearRampToValueAtTime(cents, t + delay + 0.15);
    l.connect(g);
    g.connect(osc.detune);
    l.start(t);
    l.stop(t + len + 0.01);
    this.track(l);
  }
  // Filtered noise voice. o: {t, color, rate, vol, a, h, dur, bp, bp2, q, lp, lp2, hp, hp2, sweep, bus, echo, pan, prio}
  noise(o) {
    if (!this.admit(o.prio == null ? 1 : o.prio)) return null;
    const c = this.ctx, t = this.at(o.t);
    const buf = this.noiseBuf(o.color || "white");
    const src = c.createBufferSource();
    src.buffer = buf;
    if (o.rate) src.playbackRate.setValueAtTime(o.rate, t);
    const g = c.createGain();
    let len;
    if (o.vpts) {
      // explicit gain curve: [[dt, v], ...] (linear between points)
      const v = o.vol == null ? 1 : o.vol, P = o.vpts;
      g.gain.setValueAtTime(P[0][1] * v, t + P[0][0]);
      for (let i = 1; i < P.length; i++) g.gain.linearRampToValueAtTime(P[i][1] * v, t + P[i][0]);
      len = P[P.length - 1][0];
    } else len = this.env(g.gain, t, o);
    let out = src, first = null;
    const sw = o.sweep || len;
    if (o.bp) out = first = this.filt(out, "bandpass", o.bp, o.q == null ? 1 : o.q, t, o.bp2, sw);
    if (o.lp) { out = this.filt(out, "lowpass", o.lp, o.lq, t, o.lp2, sw); first = first || out; }
    if (o.hp) { out = this.filt(out, "highpass", o.hp, o.hq, t, o.hp2, sw); first = first || out; }
    if (o.fpts && first) {
      // explicit frequency path for the first filter: [[dt, hz], ...] (exponential between points)
      const fr = first.frequency, P = o.fpts;
      fr.cancelScheduledValues(t);
      fr.setValueAtTime(P[0][1], t + P[0][0]);
      for (let i = 1; i < P.length; i++) fr.exponentialRampToValueAtTime(P[i][1], t + P[i][0]);
    }
    if (o.shape) {
      const ws = c.createWaveShaper();
      ws.curve = this.curve(o.shape);
      out.connect(ws);
      out = ws;
    }
    out.connect(g);
    this.route(g, o);
    const off = this.rand() * Math.max(0, buf.duration - len * (o.rate || 1) - 0.05);
    src.start(t, off);
    src.stop(t + len + 0.01);
    this.track(src);
    return src;
  }
  // Two-operator FM (Genesis-style bells, slap bass, brass). o: {f, ratio, index, index2, idxT, type, ...env, bus, echo}
  fm(o) {
    if (!(o.f > 0) || !this.admit(o.prio == null ? 1 : o.prio)) return null;
    const c = this.ctx, t = this.at(o.t);
    const car = c.createOscillator();
    car.type = o.type || "sine";
    car.frequency.setValueAtTime(o.f, t);
    const mod = c.createOscillator();
    const mf = o.f * (o.ratio || 2);
    mod.frequency.setValueAtTime(mf, t);
    const mg = c.createGain();
    mg.gain.setValueAtTime(mf * (o.index == null ? 2 : o.index), t);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.05, mf * (o.index2 == null ? 0.2 : o.index2)), t + (o.idxT || 0.25));
    mod.connect(mg);
    mg.connect(car.frequency);
    if (o.f2 > 0) {
      const gl = o.glide || o.dur || 0.1;
      car.frequency.exponentialRampToValueAtTime(o.f2, t + gl);
      mod.frequency.exponentialRampToValueAtTime(o.f2 * (o.ratio || 2), t + gl);
    }
    const g = c.createGain();
    const len = this.env(g.gain, t, o);
    car.connect(g);
    let out = g;
    if (o.lp) out = this.filt(out, "lowpass", o.lp, o.q, t, o.lp2, o.lpT || len);
    this.route(out, o);
    car.start(t);
    mod.start(t);
    car.stop(t + len + 0.01);
    mod.stop(t + len + 0.01);
    this.track(car);
    this.track(mod);
    return car;
  }
  // Bank sample. o: {t, rate, det, vol, a, dur, fade, offset, loop, lp, bus, echo, pan, prio}
  sample(name, o = {}) {
    const buf = this.bank.get(name);
    if (!buf || !this.admit(o.prio == null ? 1 : o.prio)) return null;
    const c = this.ctx, t = this.at(o.t);
    const src = c.createBufferSource();
    src.buffer = buf;
    const rate = o.rate || 1;
    if (rate !== 1) src.playbackRate.setValueAtTime(rate, t);
    if (o.det) src.detune && src.detune.setValueAtTime(o.det, t);
    if (o.loop) src.loop = true;
    const g = c.createGain();
    const vol = o.vol == null ? 1 : o.vol;
    const full = (buf.duration - (o.offset || 0)) / rate;
    const len = o.dur ? Math.min(o.dur, o.loop ? o.dur : full) : full;
    if (o.a) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + o.a);
    } else g.gain.setValueAtTime(vol, t);
    if (o.dur && (o.loop || o.dur < full)) {
      const fd = Math.min(o.fade || 0.04, len * 0.5);
      g.gain.setValueAtTime(vol, t + len - fd);
      g.gain.linearRampToValueAtTime(0, t + len);
    }
    src.connect(g);
    let out = g;
    if (o.lp) out = this.filt(out, "lowpass", o.lp, o.q, t, o.lp2, o.lpT || len);
    if (o.hp) out = this.filt(out, "highpass", o.hp, 0.7, t);
    this.route(out, o);
    src.start(t, o.offset || 0);
    if (!o.loop || o.dur) src.stop(t + len + 0.01);
    this.track(src);
    return { src, gain: g };
  }

  // ---------- sample bank ----------
  // Renders one bank entry in its own OfflineAudioContext: build(synth, ctx) schedules the sound
  // from t = 0 into synth.master. Resolves to the AudioBuffer (normalized to `norm` peak), or null.
  static render(dur, sr, build, opts = {}) {
    const C = OAC();
    if (!C) return Promise.resolve(null);
    let oc;
    try {
      oc = new C(1, Math.ceil(dur * sr), sr);
    } catch (_) {
      try { oc = new C(1, Math.ceil(dur * 44100), 44100); } catch (e) { return Promise.resolve(null); }
    }
    const s = new Synth(oc, { lite: true, seed: opts.seed || 1, bank: opts.bank, cap: 4000 });
    try {
      build(s, oc);
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise((resolve, reject) => {
      let done = false;
      const fin = (buf) => {
        if (done) return;
        done = true;
        if (buf && opts.post) opts.post(buf.getChannelData(0), buf.sampleRate);
        if (buf && opts.norm) normalize(buf.getChannelData(0), opts.norm);
        resolve(buf);
      };
      oc.oncomplete = (e) => fin(e.renderedBuffer);
      try {
        const p = oc.startRendering();
        if (p && p.then) p.then(fin, reject);
      } catch (e) {
        reject(e);
      }
    });
  }
}

// ---------- buffer helpers ----------
export function normalize(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > m) m = a;
  }
  if (m > 1e-6) {
    const k = peak / m;
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return m;
}
// A seamless loop of `loopLen` samples cut from a longer render: the overhang past loopLen is
// crossfaded into the head, so sample loopLen-1 flows into sample 0 like adjacent samples.
export function loopFrom(d, loopLen, xf) {
  const out = new Float32Array(loopLen);
  for (let i = 0; i < loopLen; i++) out[i] = d[i];
  for (let i = 0; i < xf && loopLen + i < d.length; i++) {
    const a = i / xf;
    out[i] = d[i] * Math.sqrt(a) + d[loopLen + i] * Math.sqrt(1 - a);
  }
  return out;
}
export function reverse(d) {
  for (let i = 0, j = d.length - 1; i < j; i++, j--) {
    const x = d[i];
    d[i] = d[j];
    d[j] = x;
  }
}
