// ALL-22 BOWL audio — the stadium (audio team). A crowd that breathes with the game:
// looping layers (murmur, roar, clapping, a filtered noise bed, the low rumble of 22 players'
// cleats) whose levels follow an excitement value; reactions on top ("oooh", "aww", cheers) and
// the DE-FENSE chant. The model runs ~15×/s from a JS timer (no per-frame work); the breathing is
// audio-rate (two slow LFOs on one gain), and layer levels are quantized (1 dB / 2 semitone steps)
// so an AudioParam only gets an automation event when its level really changes.
import { clamp } from "./audio-synth.js";

const smooth = (a, b, x) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};

export class Crowd {
  constructor(synth) {
    this.s = synth;
    this.layers = null;
    this.ex = 0.2; // smoothed excitement
    this.base = 0.2; // situation (phase, down, who has the ball)
    this.drive = 0; // live-play drivers (open field, near the goal, ball in the air)
    this.imp = 0; // event impulses (decay)
    this.impTau = 1.6;
    this.rumble = 0; // pack speed 0..1
    this.clapMul = 1;
    this.muffled = false;
    this.slow = false;
    this.lastT = 0;
    this.last = Object.create(null);
    this.lastReact = Object.create(null);
    this.chantN = 0;
    this.chantLeft = 0;
    this.chantNext = 0;
    this.chantV = null;
  }
  get running() { return !!this.layers; }

  start() {
    const s = this.s, c = s.ctx;
    if (this.layers || !s.bank.get("babble") || !s.bank.get("roar") || !s.bank.get("claps")) return false;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(1, c.currentTime, 0.4);
    // slow, irregular breathing: thousands of people never hold one level (1 ± ~0.15, audio-rate)
    this.breath = c.createGain();
    this.breath.gain.value = 1;
    this.lfos = [[0.113, 0.1], [0.339, 0.06], [0.83, 0.035]].map(([hz, depth]) => {
      const o = c.createOscillator();
      o.frequency.value = hz;
      const g = c.createGain();
      g.gain.value = depth;
      o.connect(g);
      g.connect(this.breath.gain);
      o.start(c.currentTime + s.rand() * 2);
      s.track(o);
      return o;
    });
    this.lp = c.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 16000;
    this.out.connect(this.breath);
    this.breath.connect(this.lp);
    this.lp.connect(s.crowdIn);
    const L = (this.layers = {});
    // wide layers: two decorrelated copies of the loop (half a loop apart) panned left and right
    const loop = (key, buf, filt, f, q, wide) => {
      if (!buf) return;
      const g = c.createGain();
      g.gain.value = 0;
      let fl = null;
      if (filt) {
        fl = c.createBiquadFilter();
        fl.type = filt;
        fl.frequency.value = f;
        if (q) fl.Q.value = q;
        fl.connect(g);
      }
      const head = fl || g;
      const srcs = [];
      const off = s.rand() * buf.duration;
      const copies = wide && s.hasPan ? [-0.6, 0.6] : [0];
      copies.forEach((pan, i) => {
        const src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        if (pan) {
          const p = c.createStereoPanner();
          p.pan.value = pan;
          src.connect(p);
          p.connect(head);
        } else src.connect(head);
        if (copies.length > 1) src.playbackRate.value = i ? 1.013 : 0.991; // drift apart, never phase-lock
        src.start(c.currentTime, (off + i * buf.duration * 0.5) % buf.duration);
        s.track(src);
        srcs.push(src);
      });
      g.connect(this.out);
      L[key] = { srcs, g, f: fl };
    };
    loop("murmur", s.bank.get("babble"), null, 0, 0, true);
    loop("roar", s.bank.get("roar"), "lowpass", 2600, 0.5, true);
    loop("claps", s.bank.get("claps"), null, 0, 0, true);
    loop("bed", s.noiseBuf("pink"), "lowpass", 700, 0.6, false);
    loop("rumble", s.noiseBuf("brown"), "lowpass", 150, 0.8, false);
    this.lastT = c.currentTime;
    for (const k in this.last) delete this.last[k];
    this.slow = false;
    this.applyLp(0.01);
    return true;
  }
  stop(fade = 0.6) {
    const L = this.layers;
    if (!L) return;
    const c = this.s.ctx, now = c.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, fade / 4);
    for (const k in L) {
      for (const src of L[k].srcs) {
        try { src.stop(now + fade + 0.05); } catch (_) {}
      }
    }
    for (const o of this.lfos || []) {
      try { o.stop(now + fade + 0.05); } catch (_) {}
    }
    this.lfos = null;
    const out = this.out, lp = this.lp, br = this.breath;
    setTimeout(() => {
      try { out.disconnect(); br.disconnect(); lp.disconnect(); } catch (_) {}
    }, (fade + 0.3) * 1000);
    this.layers = null;
    this.stopChant();
  }
  // pause menu: the stadium goes distant
  setMuffled(on) {
    this.muffled = on;
    this.applyLp(on ? 0.08 : 0.2);
  }
  // slow-motion run-in: the crowd is sucked out… and bursts back in at the score
  setSlow(on) {
    this.slow = on;
    this.applyLp(on ? 0.35 : 0.04);
  }
  applyLp(tau) {
    if (!this.lp) return;
    const now = this.s.ctx.currentTime, f = this.muffled ? 520 : this.slow ? 1100 : 16000;
    this.lp.frequency.cancelScheduledValues(now);
    this.lp.frequency.setTargetAtTime(f, now, tau);
  }
  // Excitement impulse (decays with tau seconds).
  pump(amount, tau = 1.6) {
    this.imp = Math.min(1.6, this.imp + amount);
    this.impTau = Math.max(tau, this.imp > 0.9 ? tau : 1.2);
  }
  // Reaction one-shot: 'ooh' | 'aww' | 'cheer'. Throttled per kind.
  react(kind, vol = 1, t) {
    const s = this.s, now = s.ctx.currentTime;
    if (now - (this.lastReact[kind] || -9) < (kind === "cheer" ? 1.1 : 0.8)) return false;
    this.lastReact[kind] = now;
    const name = kind === "cheer" ? "cheer" : kind === "aww" ? "aww" : "ooh";
    const v = clamp(vol, 0, 1.4) * (kind === "cheer" ? 0.5 : 0.42);
    const big = kind === "cheer" && vol > 0.8;
    s.sample(name, { t, rate: 0.94 + s.rand() * 0.12, vol: v, bus: "crowd", pan: big ? -0.35 : (s.rand() - 0.5) * 0.5, prio: 2 });
    if (big) {
      s.sample("cheer", { t: (t || now) + 0.09, rate: 0.86 + s.rand() * 0.08, vol: v * 0.7, bus: "crowd", pan: 0.35, prio: 1 });
      const n = 1 + Math.floor(s.rand() * 2.5);
      for (let i = 0; i < n; i++) this.fanWhistle((t || now) + 0.25 + s.rand() * 1.2);
    }
    return true;
  }
  // a fan's two-finger whistle somewhere in the stands: "wheeet!" or "wheet-whooo"
  fanWhistle(t) {
    const s = this.s;
    const f0 = 1650 + s.rand() * 650, top = f0 * (1.3 + s.rand() * 0.25), d = 0.22 + s.rand() * 0.3;
    const pan = (s.rand() - 0.5) * 1.3, vol = 0.022 + s.rand() * 0.022;
    s.tone({ t, f: f0, f2: top, glide: d * 0.3, lin: true, type: "sine", vol, a: 0.025, h: d * 0.45, dur: d, vib: [6.5, 22, 0.04], bus: "crowd", echo: 2, pan, prio: 0 });
    if (s.rand() < 0.45) s.tone({ t: t + d + 0.05, f: top * 0.98, f2: f0 * 0.82, glide: 0.3, type: "sine", vol: vol * 0.85, a: 0.02, h: 0.12, dur: 0.38, bus: "crowd", echo: 2, pan, prio: 0 });
  }
  // DE-FENSE! (clap clap) — up to n repetitions, one at a time (update() queues the next), so
  // stopChant() at the snap ends it at once.
  chant(n = 3) {
    if (this.chantLeft > 0) return;
    this.chantLeft = n;
    this.chantNext = this.s.ctx.currentTime + 0.05;
    this.chantRep();
  }
  chantRep() {
    const s = this.s;
    if (this.chantLeft <= 0) return;
    const i = this.chantN++;
    this.chantLeft--;
    this.chantV = s.sample("chant", { t: this.chantNext, rate: 1 + (s.rand() - 0.5) * 0.02, vol: 0.34 + Math.min(2, i % 3) * 0.05, bus: "crowd", prio: 1 });
    this.chantNext += 1.6;
  }
  stopChant() {
    this.chantLeft = 0;
    const v = this.chantV;
    this.chantV = null;
    if (!v) return;
    const now = this.s.ctx.currentTime, g = v.gain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0, now, 0.06);
  }
  // One frame of the crowd model (called ~15×/s while the game is on).
  update() {
    const L = this.layers;
    if (!L) return;
    const c = this.s.ctx, now = c.currentTime;
    const dt = clamp(now - this.lastT, 0, 0.5);
    this.lastT = now;
    this.imp *= Math.exp(-dt / this.impTau);
    if (this.imp < 0.3) this.impTau = 1.6;
    const target = clamp(this.base + this.drive + this.imp, 0, 1.7);
    const k = 1 - Math.exp(-dt / (target > this.ex ? 0.12 : 0.7));
    this.ex += (target - this.ex) * k;
    const e = this.ex;
    if (this.chantLeft > 0 && now > this.chantNext - 0.25) this.chantRep();
    // the odd whistle from the stands when things get loud
    if (e > 0.85 && this.s.rand() < dt * 1.3 * (e - 0.85)) this.fanWhistle(now + 0.02);
    const up = target > e; // rising: snap to it; falling: let the param glide down slowly
    this.gain("murmur", L.murmur.g.gain, (0.2 + 0.1 * Math.min(1, e)) * (1 - 0.45 * smooth(0.7, 1.4, e)), up);
    this.gain("roar", L.roar.g.gain, 0.55 * smooth(0.28, 1.35, e), up);
    if (L.roar.f) this.freq("roarF", L.roar.f.frequency, 1500 + 2200 * smooth(0.4, 1.4, e));
    this.gain("claps", L.claps.g.gain, 0.32 * smooth(0.55, 1.15, e) * this.clapMul, up);
    this.gain("bed", L.bed.g.gain, 0.05 + 0.1 * Math.min(1.3, e), up);
    if (L.bed.f) this.freq("bedF", L.bed.f.frequency, 450 + 1100 * Math.min(1.3, e));
    this.gain("rumble", L.rumble.g.gain, 0.5 * this.rumble, true);
  }
  // Level in 1 dB steps (below −50 dB → silent): an automation event only when the step changes.
  gain(key, p, v, up) {
    const q = v < 0.003 ? -99 : Math.round(20 * Math.log10(v));
    if (this.last[key] === q) return;
    this.last[key] = q;
    this.ramp(p, q === -99 ? 0 : Math.pow(10, q / 20), up ? 0.08 : 0.35);
  }
  // Frequency in 2-semitone steps.
  freq(key, p, hz) {
    const q = Math.round(6 * Math.log2(hz / 440));
    if (this.last[key] === q) return;
    this.last[key] = q;
    this.ramp(p, 440 * Math.pow(2, q / 6), 0.2);
  }
  ramp(p, v, tau) {
    const now = this.s.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setTargetAtTime(v, now, tau);
  }
}
