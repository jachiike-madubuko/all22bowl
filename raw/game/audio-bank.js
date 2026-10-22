// ALL-22 BOWL audio — the sample bank (audio team).
// Everything that is expensive or many-voiced is synthesized ONCE, off the main thread, with an
// OfflineAudioContext, and then played back as samples (like a 16-bit console's sample RAM):
// drums, the QB's "SET… HUT!", grunts, the referee's pea whistle, the stadium horn, and the crowd
// (murmur, roar and clap loops; "oooh", "aww", cheer one-shots; the DE-FENSE chant).
// Voices use formant synthesis: a buzzy glottal source through parallel vowel-formant filters.
import { Synth, loopFrom, reverse, makeRand, normalize } from "./audio-synth.js";

// Vowel formants (F1, F2, F3 in Hz; adult male averages, Peterson & Barney).
const V = {
  i: [270, 2290, 3010], I: [390, 1990, 2550], e: [530, 1840, 2480], ae: [660, 1720, 2410],
  a: [730, 1090, 2440], o: [570, 840, 2410], U: [440, 1020, 2240], u: [300, 870, 2240],
  A: [640, 1190, 2390], R: [490, 1350, 1690],
};
const BABBLE_VOWELS = ["i", "I", "e", "ae", "a", "o", "U", "u", "A", "R", "e", "a", "A"];

// ---------- formant voice ----------
// pts helpers: [[t, v], ...] → AudioParam automation (linear between points).
function auto(p, pts, t0 = 0, mul = 1) {
  p.setValueAtTime(pts[0][1] * mul, t0 + pts[0][0]);
  for (let i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i][1] * mul, t0 + pts[i][0]);
}
// A formant voice into `dest`. o: {t0, f0: [[t,f]], vow: [[t, [F1,F2,F3]]], amp: [[t,a]], fm (formant
// scale, female ≈ 1.17), tilt (source lowpass Hz), q: [q1,q2,q3], g: [g1,g2,g3], breath, end, jitter}
function voice(s, oc, dest, o) {
  const t0 = o.t0 || 0, end = t0 + o.end;
  const src = oc.createOscillator();
  src.type = "sawtooth";
  auto(src.frequency, o.f0, t0);
  if (o.jitter) {
    // slow random pitch wander (many voices never sing in tune)
    const lfo = oc.createOscillator();
    lfo.frequency.value = 3 + s.rand() * 4;
    const lg = oc.createGain();
    lg.gain.value = o.jitter;
    lfo.connect(lg);
    lg.connect(src.detune);
    lfo.start(t0);
    lfo.stop(end);
  }
  const tilt = oc.createBiquadFilter();
  tilt.type = "lowpass";
  tilt.frequency.value = o.tilt || 1400;
  tilt.Q.value = 0.4;
  src.connect(tilt);
  const env = oc.createGain();
  env.gain.value = 0;
  auto(env.gain, o.amp, t0);
  const fm = o.fm || 1;
  const q = o.q || [6, 9, 12];
  const gk = o.g || [1, 0.55, 0.25];
  let br = null;
  if (o.breath) {
    br = oc.createBufferSource();
    br.buffer = s.noiseBuf("white");
    const bg = oc.createGain();
    bg.gain.value = o.breath;
    br.connect(bg);
    br.out = bg;
    br.start(t0, s.rand());
    br.stop(end);
  }
  const nf = o.vow[0][1].length > 2 && !o.two ? 3 : 2;
  for (let k = 0; k < nf; k++) {
    const bp = oc.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = q[k];
    bp.frequency.setValueAtTime(o.vow[0][1][k] * fm, t0 + o.vow[0][0]);
    for (let i = 1; i < o.vow.length; i++) bp.frequency.linearRampToValueAtTime(o.vow[i][1][k] * fm, t0 + o.vow[i][0]);
    const g = oc.createGain();
    g.gain.value = gk[k] * (k === 0 ? 1 : 1.6);
    tilt.connect(bp);
    if (br) br.out.connect(bp);
    bp.connect(g);
    g.connect(env);
  }
  env.connect(dest);
  src.start(t0);
  src.stop(end);
}
// Filtered noise burst with a point envelope (consonants: h, s, f, t).
function burst(s, oc, dest, t0, pts, type, f, q, f2) {
  const n = oc.createBufferSource();
  n.buffer = s.noiseBuf("white");
  const b = oc.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  if (q) b.Q.value = q;
  let last = b;
  n.connect(b);
  if (f2) {
    const b2 = oc.createBiquadFilter();
    b2.type = "highpass";
    b2.frequency.value = f2;
    b.connect(b2);
    last = b2;
  }
  const g = oc.createGain();
  g.gain.value = 0;
  auto(g.gain, pts, t0);
  last.connect(g);
  g.connect(dest);
  n.start(t0, s.rand());
  n.stop(t0 + pts[pts.length - 1][0] + 0.01);
}

// ---------- claps (direct sample synthesis) ----------
function bandpassCoefs(f, q, sr) {
  const w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return [al / a0, 0, -al / a0, (-2 * Math.cos(w)) / a0, (1 - al) / a0];
}
// Adds one hand clap at time t (s) into d.
function addClap(d, sr, t, amp, co, rand) {
  const i0 = Math.floor(t * sr), n = Math.floor(sr * 0.035);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const tau = sr * (0.0025 + rand() * 0.002);
  for (let k = 0; k < n && i0 + k < d.length; k++) {
    const e = k < sr * 0.0008 ? k / (sr * 0.0008) : Math.exp(-(k - sr * 0.0008) / tau);
    const x = (rand() * 2 - 1) * e;
    const y = co[0] * x + co[1] * x1 + co[2] * x2 - co[3] * y1 - co[4] * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    if (i0 + k >= 0) d[i0 + k] += y * amp;
  }
}
// A crowd clapping along: `people` clappers at ~rate claps/s (loose), or synchronized `beats`.
function claps(d, sr, rand, { people = 40, rate = 3.2, from = 0, to = d.length / sr, beats = null, spread = 0.03, amp = 1 }) {
  for (let p = 0; p < people; p++) {
    const co = bandpassCoefs(900 + rand() * 1600, 1.2 + rand() * 1.2, sr);
    const a = amp * (0.4 + rand() * 0.6);
    if (beats) {
      for (const b of beats) addClap(d, sr, b + (rand() - 0.5) * 2 * spread, a, co, rand);
      continue;
    }
    const per = 1 / (rate * (0.8 + rand() * 0.4));
    for (let t = from + rand() * per; t < to; t += per * (0.9 + rand() * 0.2)) addClap(d, sr, t, a * (0.7 + rand() * 0.3), co, rand);
  }
}

// ---------- crowd voice textures ----------
function pick(rand, a) { return a[Math.floor(rand() * a.length)]; }
function crowdFloor(s, oc, dest, T, lvl, bp = 900, q = 0.5) {
  const n = oc.createBufferSource();
  n.buffer = s.noiseBuf("pink");
  n.loop = true;
  const f = oc.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = bp;
  f.Q.value = q;
  const g = oc.createGain();
  g.gain.value = lvl;
  n.connect(f);
  f.connect(g);
  g.connect(dest);
  n.start(0, s.rand());
  n.stop(T);
  return g;
}
function lowpassOut(oc, f, dest) {
  const lp = oc.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = f;
  lp.Q.value = 0.5;
  lp.connect(dest || oc.destination);
  return lp;
}

// A reaction from many voices: contour multipliers on pitch, vowel path, amplitude path.
function reaction(s, oc, dest, n, spec) {
  for (let v = 0; v < n; v++) {
    const female = s.rand() < 0.45;
    const base = female ? 190 + s.rand() * 80 : 105 + s.rand() * 55;
    const fm = female ? 1.16 : 1;
    const sc = 0.92 + s.rand() * 0.16;
    const t0 = s.rand() * (spec.jit || 0.1);
    voice(s, oc, dest, {
      t0, end: spec.end,
      f0: spec.f0.map(([t, m]) => [t * sc, base * m * (0.97 + s.rand() * 0.06)]),
      vow: spec.vow.map(([t, vv]) => [t * sc, vv]),
      amp: spec.amp.map(([t, a]) => [t * sc, a * (0.6 + s.rand() * 0.4)]),
      fm, tilt: spec.tilt || 1600, q: spec.q || [5, 7, 9], jitter: 18, breath: spec.breath || 0.05, two: true,
    });
  }
}

// ---------- recipes ----------
// name → {dur, sr, norm, loop (seconds, seamless), build(s, oc), post(d, sr, rand)}
export const BANK = {
  // ---- drums (44.1 kHz) ----
  kick: { dur: 0.42, sr: 44100, norm: 0.95, build(s, oc) {
    const o = oc.createOscillator();
    o.frequency.setValueAtTime(155, 0);
    o.frequency.exponentialRampToValueAtTime(52, 0.075);
    o.frequency.exponentialRampToValueAtTime(42, 0.4);
    const g = oc.createGain();
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(1, 0.002);
    g.gain.setTargetAtTime(0, 0.06, 0.09);
    const ws = oc.createWaveShaper();
    ws.curve = s.curve("soft");
    o.connect(g);
    g.connect(ws);
    ws.connect(s.master);
    o.start(0);
    o.stop(0.42);
    s.noise({ t: 0, dur: 0.012, vol: 0.3, hp: 2200, bus: "sfx" });
  } },
  snare: { dur: 0.32, sr: 44100, norm: 0.9, build(s) {
    s.noise({ t: 0, dur: 0.22, vol: 0.75, bp: 1900, q: 0.7, a: 0.001 });
    s.noise({ t: 0, dur: 0.12, vol: 0.35, hp: 5200, a: 0.001 });
    s.tone({ t: 0, f: 205, f2: 165, glide: 0.06, type: "triangle", dur: 0.1, vol: 0.6, a: 0.001 });
  } },
  hat: { dur: 0.09, sr: 44100, norm: 0.75, build(s, oc) { metal(s, oc, 0.05, 1); } },
  ohat: { dur: 0.4, sr: 44100, norm: 0.7, build(s, oc) { metal(s, oc, 0.32, 1); } },
  crash: { dur: 1.9, sr: 44100, norm: 0.8, build(s, oc) {
    metal(s, oc, 1.8, 0.62);
    s.noise({ t: 0, dur: 1.6, vol: 0.5, hp: 4200, a: 0.002 });
    s.noise({ t: 0, dur: 0.25, vol: 0.4, bp: 3000, q: 0.6, a: 0.001 });
  } },
  swell: { dur: 1.5, sr: 44100, norm: 0.7, build(s, oc) {
    metal(s, oc, 1.5, 0.62);
    s.noise({ t: 0, dur: 1.45, vol: 0.5, hp: 4200, a: 0.002 });
  }, post: (d) => reverse(d) },
  tom: { dur: 0.45, sr: 44100, norm: 0.9, build(s) {
    s.tone({ t: 0, f: 170, f2: 108, glide: 0.25, type: "sine", dur: 0.42, vol: 1, a: 0.001 });
    s.tone({ t: 0, f: 340, f2: 220, glide: 0.2, type: "triangle", dur: 0.12, vol: 0.25, a: 0.001 });
    s.noise({ t: 0, dur: 0.05, vol: 0.25, lp: 1800, a: 0.001 });
  } },
  clap: { dur: 0.25, sr: 44100, norm: 0.85, build(s, oc) {
    const pts = [[0, 0], [0.001, 1], [0.009, 0.2], [0.011, 0.9], [0.019, 0.2], [0.021, 0.8], [0.03, 0.45], [0.2, 0]];
    burst(s, oc, s.master, 0, pts, "bandpass", 1250, 1.1);
  } },
  timp: { dur: 1.6, sr: 44100, norm: 0.9, build(s) {
    // G2 kettle: inharmonic membrane modes, slight pitch sag, felt mallet
    const f = 98;
    [[1, 1, 1.5], [1.505, 0.5, 0.9], [1.995, 0.3, 0.7], [2.44, 0.15, 0.5]].forEach(([r, v, d]) =>
      s.tone({ t: 0, f: f * r * 1.012, f2: f * r, glide: 0.12, type: "sine", dur: d, vol: v, a: 0.003 }));
    s.noise({ t: 0, dur: 0.06, vol: 0.35, lp: 900, a: 0.001 });
  } },

  // ---- voices ----
  hut: { dur: 0.3, sr: 44100, norm: 0.9, build(s, oc) {
    const d = s.master;
    burst(s, oc, d, 0, [[0, 0], [0.012, 0.22], [0.035, 0.12], [0.045, 0]], "bandpass", 1500, 1.2);
    voice(s, oc, d, { t0: 0.028, end: 0.2, f0: [[0, 150], [0.02, 188], [0.1, 172], [0.14, 138]], vow: [[0, [700, 1220, 2500]], [0.14, [660, 1180, 2450]]],
      amp: [[0, 0], [0.012, 1], [0.1, 0.85], [0.125, 0.5], [0.135, 0]], tilt: 2600, q: [5, 8, 11], g: [1, 0.7, 0.35], breath: 0.06 });
    burst(s, oc, d, 0.205, [[0, 0], [0.002, 0.5], [0.014, 0]], "highpass", 3200, 0.7);
  } },
  set: { dur: 0.34, sr: 44100, norm: 0.85, build(s, oc) {
    const d = s.master;
    burst(s, oc, d, 0, [[0, 0], [0.03, 0.3], [0.075, 0.26], [0.09, 0]], "bandpass", 5600, 1.3, 3400);
    voice(s, oc, d, { t0: 0.08, end: 0.24, f0: [[0, 160], [0.04, 176], [0.13, 150]], vow: [[0, V.e], [0.13, [520, 1760, 2450]]],
      amp: [[0, 0], [0.015, 1], [0.1, 0.8], [0.125, 0]], tilt: 2400, q: [5, 9, 12], g: [1, 0.75, 0.35], breath: 0.05 });
    burst(s, oc, d, 0.255, [[0, 0], [0.002, 0.45], [0.013, 0]], "highpass", 3200, 0.7);
  } },
  oof: { dur: 0.3, sr: 44100, norm: 0.85, build(s, oc) {
    voice(s, oc, s.master, { t0: 0, end: 0.24, f0: [[0, 128], [0.06, 122], [0.2, 96]], vow: [[0, V.U], [0.15, V.A]],
      amp: [[0, 0], [0.025, 1], [0.12, 0.7], [0.2, 0]], tilt: 1300, q: [5, 7, 10], breath: 0.25 });
    burst(s, oc, s.master, 0.17, [[0, 0], [0.02, 0.12], [0.08, 0]], "highpass", 1500, 0.7);
  } },
  hah: { dur: 0.24, sr: 44100, norm: 0.85, build(s, oc) {
    burst(s, oc, s.master, 0, [[0, 0], [0.015, 0.25], [0.04, 0]], "bandpass", 1300, 1);
    voice(s, oc, s.master, { t0: 0.025, end: 0.2, f0: [[0, 142], [0.03, 150], [0.15, 116]], vow: [[0, V.a], [0.15, V.A]],
      amp: [[0, 0], [0.012, 1], [0.08, 0.6], [0.16, 0]], tilt: 2000, q: [5, 8, 11], breath: 0.15 });
  } },

  // ---- officials & stadium ----
  whistle: { dur: 0.42, sr: 44100, norm: 0.8, build(s, oc) { pea(s, oc, 0.36); } },
  whistleLong: { dur: 0.8, sr: 44100, norm: 0.8, build(s, oc) { pea(s, oc, 0.74); } },
  horn: { dur: 2.0, sr: 44100, norm: 0.85, build(s, oc) {
    // big stadium horn: a fat D power chord that scoops up into pitch, driven and filtered
    const sum = oc.createGain();
    const ws = oc.createWaveShaper();
    ws.curve = s.curve("soft");
    const lp = oc.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(700, 0);
    lp.frequency.linearRampToValueAtTime(1900, 0.12);
    lp.frequency.setTargetAtTime(1500, 0.3, 0.4);
    lp.Q.value = 1.2;
    const env = oc.createGain();
    env.gain.setValueAtTime(0, 0);
    env.gain.linearRampToValueAtTime(1, 0.06);
    env.gain.setValueAtTime(0.9, 1.55);
    env.gain.linearRampToValueAtTime(0, 1.9);
    sum.connect(ws);
    ws.connect(lp);
    lp.connect(env);
    env.connect(s.master);
    [[146.8, 0.5], [220, 0.36], [293.7, 0.3], [369.9, 0.14], [73.4, 0.3]].forEach(([f, v], i) => {
      const o = oc.createOscillator();
      o.type = "sawtooth";
      o.detune.setValueAtTime(-90 + i * 3, 0);
      o.detune.linearRampToValueAtTime(i * 3 - 4, 0.13);
      o.frequency.value = f;
      const g = oc.createGain();
      g.gain.value = v;
      o.connect(g);
      g.connect(sum);
      o.start(0);
      o.stop(1.95);
    });
  } },

  // ---- crowd (22.05 kHz) ----
  babble: { dur: 5.0, loop: 4.4, sr: 22050, norm: 0.8, build(s, oc) {
    const T = 5.0, out = lowpassOut(oc, 2600);
    const g = oc.createGain();
    g.gain.value = 0.32;
    g.connect(out);
    for (let v = 0; v < 18; v++) {
      const female = s.rand() < 0.42;
      const base = female ? 175 + s.rand() * 70 : 95 + s.rand() * 55;
      const fm = female ? 1.16 : 1;
      const f0 = [[0, base]], vow = [[0, V.A]], amp = [[0, 0]];
      let t = s.rand() * 0.8;
      while (t < T) {
        const k = 2 + Math.floor(s.rand() * 6);
        for (let i = 0; i < k && t < T; i++) {
          const sd = 0.09 + s.rand() * 0.15;
          const a = 0.35 + s.rand() * 0.65;
          vow.push([t + 0.02, V[pick(s.rand, BABBLE_VOWELS)]]);
          f0.push([t + 0.03, base * (0.88 + s.rand() * 0.3)]);
          amp.push([t + 0.025, a], [t + sd * 0.75, a * 0.75], [t + sd, a * 0.12]);
          t += sd;
        }
        amp.push([t + 0.04, 0]);
        t += 0.2 + s.rand() * 0.7;
        amp.push([t, 0]);
      }
      voice(s, oc, g, { t0: 0, end: T, f0, vow, amp, fm, tilt: 1300, q: [4, 6, 8], jitter: 12, breath: 0.08, two: true });
    }
    crowdFloor(s, oc, out, T, 0.32, 700, 0.6);
  } },
  roar: { dur: 5.0, loop: 4.4, sr: 22050, norm: 0.85, build(s, oc) {
    const T = 5.0, out = lowpassOut(oc, 4200);
    const g = oc.createGain();
    g.gain.value = 0.3;
    g.connect(out);
    for (let v = 0; v < 26; v++) {
      const female = s.rand() < 0.45;
      const base = female ? 250 + s.rand() * 130 : 140 + s.rand() * 90;
      const fm = female ? 1.16 : 1;
      const f0 = [[0, base]], vow = [[0, V.a]], amp = [[0, 0.5]];
      let t = 0;
      while (t < T) {
        const sd = 0.35 + s.rand() * 0.9;
        vow.push([t + 0.08, V[pick(s.rand, ["a", "ae", "e", "A", "a", "o"])]]);
        f0.push([t + 0.1, base * (0.92 + s.rand() * 0.22)]);
        const a = 0.4 + s.rand() * 0.6;
        amp.push([t + 0.1, a], [t + sd * 0.8, a * (0.6 + s.rand() * 0.4)]);
        if (s.rand() < 0.25) amp.push([t + sd * 0.95, 0.15]);
        t += sd;
      }
      voice(s, oc, g, { t0: 0, end: T, f0, vow, amp, fm, tilt: 2400, q: [3.5, 5, 7], jitter: 30, breath: 0.12, two: true });
    }
    crowdFloor(s, oc, out, T, 0.85, 1100, 0.5);
    crowdFloor(s, oc, out, T, 0.18, 2600, 0.8);
  } },
  claps: { dur: 3.4, loop: 3.0, sr: 22050, norm: 0.75, build() {}, post(d, sr, rand) {
    claps(d, sr, rand, { people: 46, rate: 2.6 });
  } },
  ooh: { dur: 2.0, sr: 22050, norm: 0.8, build(s, oc) {
    const out = lowpassOut(oc, 3000);
    const g = oc.createGain();
    g.gain.value = 0.3;
    g.connect(out);
    reaction(s, oc, g, 22, {
      end: 1.95, jit: 0.12, tilt: 1200,
      f0: [[0, 0.93], [0.14, 1.0], [0.45, 1.13], [0.95, 1.0], [1.75, 0.8]],
      vow: [[0, V.u], [0.5, [380, 820, 2300]], [1.2, [430, 780, 2300]]],
      amp: [[0, 0], [0.14, 0.7], [0.45, 1], [1.0, 0.6], [1.8, 0]],
    });
    const n = crowdFloor(s, oc, out, 1.9, 0, 450, 1.2);
    auto(n.gain, [[0, 0], [0.4, 0.22], [1.8, 0]]);
  } },
  aww: { dur: 2.0, sr: 22050, norm: 0.8, build(s, oc) {
    const out = lowpassOut(oc, 3000);
    const g = oc.createGain();
    g.gain.value = 0.3;
    g.connect(out);
    reaction(s, oc, g, 22, {
      end: 1.95, jit: 0.08, tilt: 1400,
      f0: [[0, 1.2], [0.3, 1.16], [0.9, 0.95], [1.7, 0.78]],
      vow: [[0, V.o], [0.55, V.a], [1.4, V.A]],
      amp: [[0, 0], [0.1, 1], [0.6, 0.75], [1.8, 0]],
    });
    const n = crowdFloor(s, oc, out, 1.9, 0, 700, 0.8);
    auto(n.gain, [[0, 0], [0.15, 0.25], [1.8, 0]]);
  } },
  cheer: { dur: 2.6, sr: 22050, norm: 0.85, build(s, oc) {
    const out = lowpassOut(oc, 4500);
    const g = oc.createGain();
    g.gain.value = 0.26;
    g.connect(out);
    reaction(s, oc, g, 26, {
      end: 2.55, jit: 0.07, tilt: 2400, breath: 0.1,
      f0: [[0, 0.85], [0.1, 1.22], [0.4, 1.28], [1.5, 1.2], [2.4, 1.05]],
      vow: [[0, V.e], [0.18, V.ae], [0.55, V.a], [2.4, V.A]],
      amp: [[0, 0], [0.07, 1], [1.2, 0.8], [2.45, 0]],
    });
    const n = crowdFloor(s, oc, out, 2.55, 0, 1200, 0.5);
    auto(n.gain, [[0, 0], [0.06, 0.9], [1.2, 0.6], [2.5, 0]]);
  }, post(d, sr, rand) {
    const c = new Float32Array(d.length);
    claps(c, sr, rand, { people: 30, rate: 3.6, from: 0.25, to: 2.3, amp: 0.5 });
    for (let i = 0; i < d.length; i++) d[i] += c[i] * Math.min(1, (d.length - i) / (sr * 0.4));
  } },
  chant: { dur: 1.7, sr: 22050, norm: 0.8, build(s, oc) {
    // "DE-FENSE!" + clap clap (loops at 1.6 s)
    const out = lowpassOut(oc, 3800);
    const g = oc.createGain();
    g.gain.value = 0.3;
    g.connect(out);
    for (let v = 0; v < 18; v++) {
      const female = v % 2 === 1;
      const P = (female ? 225 : 140) * (0.95 + s.rand() * 0.1);
      const fm = female ? 1.15 : 1;
      const j = (s.rand() - 0.5) * 0.05;
      // DEE
      voice(s, oc, g, { t0: 0.02 + j, end: 0.32 + j, f0: [[0, P * 0.95], [0.05, P * 1.04], [0.24, P]], vow: [[0, [300, 1900, 2700]], [0.06, V.i]],
        amp: [[0, 0], [0.02, 1], [0.2, 0.85], [0.26, 0]], fm, tilt: 2000, q: [5, 9, 11], jitter: 15, breath: 0.05 });
      // FENSE
      voice(s, oc, g, { t0: 0.43 + j, end: 0.8 + j, f0: [[0, P * 0.86], [0.2, P * 0.82], [0.3, P * 0.8]], vow: [[0, V.e], [0.22, [500, 1700, 2450]], [0.27, [260, 1500, 2400]]],
        amp: [[0, 0], [0.02, 1], [0.2, 0.8], [0.25, 0.35], [0.3, 0]], fm, tilt: 2000, q: [5, 9, 11], jitter: 15, breath: 0.05 });
    }
    burst(s, oc, out, 0.0, [[0, 0], [0.005, 0.25], [0.02, 0]], "lowpass", 600, 0.7);
    burst(s, oc, out, 0.37, [[0, 0], [0.02, 0.3], [0.06, 0.25], [0.075, 0]], "highpass", 1600, 0.7);
    burst(s, oc, out, 0.74, [[0, 0], [0.02, 0.42], [0.11, 0.3], [0.15, 0]], "highpass", 4200, 0.7);
  }, post(d, sr, rand) {
    const c = new Float32Array(d.length);
    claps(c, sr, rand, { people: 34, beats: [1.04, 1.3], spread: 0.025, amp: 0.55 });
    for (let i = 0; i < d.length; i++) d[i] += c[i];
  } },
};

// metallic hats/cymbals: the 808 recipe (six detuned square waves) through high bandpass + highpass
function metal(s, oc, dur, mul) {
  const sum = oc.createGain();
  sum.gain.value = 0.18;
  [205.3, 304.4, 369.6, 522.7, 540, 800].forEach((f) => {
    const o = oc.createOscillator();
    o.type = "square";
    o.frequency.value = f * (mul > 0.9 ? 1 : 1.42);
    o.connect(sum);
    o.start(0);
    o.stop(dur + 0.02);
  });
  const bp = oc.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = mul > 0.9 ? 10000 : 7600;
  bp.Q.value = 0.9;
  const hp = oc.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = mul > 0.9 ? 7000 : 4800;
  const env = oc.createGain();
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(1, 0.001);
  env.gain.setTargetAtTime(0, 0.002, dur / 4.5);
  sum.connect(bp);
  bp.connect(hp);
  hp.connect(env);
  env.connect(s.master);
  s.noise({ t: 0, dur: dur * 0.8, vol: 0.12, hp: 8000, a: 0.001 });
}

// Referee's pea whistle: ~2.9 kHz tone, the pea rattling it at ~40 Hz (FM + AM), breath noise.
function pea(s, oc, len) {
  const o = oc.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(2550, 0);
  o.frequency.exponentialRampToValueAtTime(2930, 0.03);
  o.frequency.setTargetAtTime(2880, len * 0.7, 0.05);
  const o2 = oc.createOscillator();
  o2.type = "sine";
  o2.frequency.setValueAtTime(2550 * 2.01, 0);
  o2.frequency.exponentialRampToValueAtTime(2930 * 2.01, 0.03);
  const pea = oc.createOscillator();
  pea.type = "triangle";
  pea.frequency.setValueAtTime(38, 0);
  pea.frequency.linearRampToValueAtTime(46, len);
  const fmg = oc.createGain();
  fmg.gain.value = 110;
  pea.connect(fmg);
  fmg.connect(o.frequency);
  // the pea rattles the level between ~55% and 100% (always positive), then the blow envelope
  const am = oc.createGain();
  am.gain.value = 0.78;
  const amd = oc.createGain();
  amd.gain.value = 0.22;
  pea.connect(amd);
  amd.connect(am.gain);
  const env = oc.createGain();
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(0.7, 0.012);
  env.gain.setValueAtTime(0.7, len - 0.05);
  env.gain.linearRampToValueAtTime(0, len);
  const g2 = oc.createGain();
  g2.gain.value = 0.08;
  o.connect(am);
  o2.connect(g2);
  g2.connect(am);
  am.connect(env);
  env.connect(s.master);
  [o, o2, pea].forEach((x) => { x.start(0); x.stop(len + 0.01); });
  burst(s, oc, s.master, 0, [[0, 0], [0.01, 0.16], [len - 0.05, 0.12], [len, 0]], "bandpass", 2900, 2.5);
}

// Renders the bank one entry at a time (gentle on slow phones). `order` lists names by priority.
// onEach(name, buffer) is called as each one lands. Returns a promise for the whole bank.
export async function renderBank(liveCtx, bank, order, onEach) {
  const names = order || Object.keys(BANK);
  for (const name of names) {
    const r = BANK[name];
    if (!r || bank.has(name)) continue;
    try {
      const rand = makeRand(name.length * 7919 + name.charCodeAt(0));
      let buf = await Synth.render(r.dur, r.sr, r.build, {
        seed: name.charCodeAt(0) * 31 + name.length,
        bank,
        post: r.post ? (d, sr) => r.post(d, sr, rand) : null,
      });
      if (!buf) continue;
      let data = buf.getChannelData(0);
      if (r.loop) data = loopFrom(data, Math.floor(r.loop * buf.sampleRate), Math.floor(Math.min(0.5, r.dur - r.loop) * buf.sampleRate));
      if (r.norm) normalize(data, r.norm);
      if (r.loop || data !== buf.getChannelData(0)) {
        const nb = liveCtx.createBuffer(1, data.length, buf.sampleRate);
        nb.getChannelData(0).set(data);
        buf = nb;
      }
      bank.set(name, buf);
      if (onEach) onEach(name, buf);
    } catch (e) {
      // a failed render just leaves that sound out
      if (onEach) onEach(name, null, e);
    }
  }
  return bank;
}

export const BANK_ORDER = ["kick", "snare", "hat", "ohat", "crash", "tom", "clap", "timp", "swell", "whistle", "whistleLong", "hut", "set", "horn", "oof", "hah",
  "babble", "roar", "claps", "ooh", "aww", "cheer", "chant"];
