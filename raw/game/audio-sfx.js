// ALL-22 BOWL audio — live sound effects (audio team). Each recipe schedules a few short synth
// voices (or bank samples) on a Synth: fn(synth, opts). Common opts: t (audio time, default now),
// pan (−1..1), vol (scale). Parameterized at runtime — hit power, flight time, speed, Pokémon type.
import { clamp, midiHz } from "./audio-synth.js";

const HUGE = 140, BIG = 95; // config.js HIT thresholds (presentation copy)

// ---------- menus ----------
export function blip(s, o = {}) {
  s.tone({ t: o.t, f: o.hi ? 2093 : 1568, wave: "p25", vol: 0.17 * (o.vol || 1), a: 0.001, dur: 0.045, bus: "sfx", echo: 1, prio: 1 });
}
export function select(s, o = {}) {
  const t = s.at(o.t);
  s.tone({ t, f: 1319, wave: "p25", vol: 0.18, a: 0.001, dur: 0.06, bus: "sfx", prio: 1 });
  s.tone({ t: t + 0.055, f: 1760, wave: "p25", vol: 0.19, a: 0.001, h: 0.03, dur: 0.16, bus: "sfx", echo: 2, prio: 1 });
  s.tone({ t: t + 0.055, f: 880, wave: "nes", vol: 0.18, a: 0.001, dur: 0.12, bus: "sfx", prio: 1 });
}
export function back(s, o = {}) {
  const t = s.at(o.t);
  s.tone({ t, f: 1760, wave: "p25", vol: 0.17, a: 0.001, dur: 0.05, bus: "sfx", prio: 1 });
  s.tone({ t: t + 0.05, f: 1175, wave: "p25", vol: 0.17, a: 0.001, h: 0.02, dur: 0.12, bus: "sfx", echo: 1, prio: 1 });
}
export function error(s, o = {}) {
  const t = s.at(o.t);
  s.tone({ t, f: 110, wave: "p50", vol: 0.09, a: 0.002, h: 0.12, dur: 0.2, lp: 1600, bus: "sfx", prio: 1 });
  s.tone({ t, f: 116.5, wave: "p25", vol: 0.06, a: 0.002, h: 0.12, dur: 0.2, lp: 1600, bus: "sfx", prio: 1 });
}
export function pauseIn(s, o = {}) {
  const t = s.at(o.t);
  [2093, 1568, 1047].forEach((f, i) => s.tone({ t: t + i * 0.045, f, wave: "p12", vol: 0.11, a: 0.001, dur: 0.07, bus: "sfx", echo: 1, prio: 1 }));
}
export function pauseOut(s, o = {}) {
  const t = s.at(o.t);
  [1047, 1568, 2093].forEach((f, i) => s.tone({ t: t + i * 0.045, f, wave: "p12", vol: 0.11, a: 0.001, dur: 0.07, bus: "sfx", echo: 1, prio: 1 }));
}
export function tick(s, o = {}) {
  s.tone({ t: o.t, f: o.hi ? 1760 : 1175, wave: "p12", vol: 0.08 * (o.vol || 1), a: 0.001, dur: 0.03, bus: "sfx", prio: 1 });
}
// card flip / reveal shimmer (draft & gym screens)
export function reveal(s, o = {}) {
  const t = s.at(o.t);
  s.noise({ t, bp: 1800, bp2: 5200, q: 2, sweep: 0.18, vol: 0.07, a: 0.06, dur: 0.22, bus: "sfx", prio: 1 });
  [1568, 1976, 2349, 3136].forEach((f, i) => s.fm({ t: t + 0.05 + i * 0.04, f, ratio: 3.5, index: 1.2, index2: 0.05, vol: 0.035, a: 0.002, dur: 0.5, bus: "sfx", echo: 2, prio: 1 }));
}
// draft pick locked in: a punchy "ka-CHUNK" + bright chord
export function lock(s, o = {}) {
  const t = s.at(o.t);
  s.tone({ t, f: 220, f2: 90, glide: 0.08, type: "triangle", vol: 0.3, a: 0.001, dur: 0.12, bus: "sfx", prio: 1 });
  s.noise({ t, lp: 2400, vol: 0.18, a: 0.001, dur: 0.05, bus: "sfx", prio: 1 });
  [1175, 1480, 1760].forEach((f) => s.tone({ t: t + 0.06, f, wave: "p25", vol: 0.04, a: 0.002, h: 0.05, dur: 0.3, bus: "sfx", echo: 2, prio: 1 }));
}

// ---------- the line ----------
// QB voice: o.word 'hut' | 'set'; o.pitch scales the voice (heavier QBs sound deeper)
export function voice(s, o = {}) {
  const r = (o.pitch || 1) * (0.97 + s.rand() * 0.06);
  s.sample(o.word || "hut", { t: o.t, rate: r, vol: 0.42 * (o.vol || 1), bus: "sfx", echo: 1, pan: o.pan, prio: 1 });
}
// center snaps the ball into the QB's hands
export function snapPop(s, o = {}) {
  const t = s.at(o.t);
  s.tone({ t, f: 300, f2: 170, glide: 0.04, type: "triangle", vol: 0.16, a: 0.001, dur: 0.06, bus: "sfx", pan: o.pan, prio: 1 });
  s.noise({ t, lp: 1400, vol: 0.12, a: 0.001, dur: 0.035, bus: "sfx", pan: o.pan, prio: 1 });
}
// pads popping all along the line at the snap
export function lineCrash(s, o = {}) {
  const t = s.at(o.t);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const dt = 0.01 + s.rand() * 0.07, pan = clamp((o.pan || 0) + (i - 2) * 0.12, -1, 1);
    s.noise({ t: t + dt, lp: 260 + s.rand() * 200, vol: 0.22, a: 0.001, dur: 0.07, bus: "sfx", pan, prio: 0 });
    s.noise({ t: t + dt, bp: 1300 + s.rand() * 900, q: 2.5, vol: 0.07, a: 0.0005, dur: 0.03, bus: "sfx", pan, prio: 0 });
  }
  s.tone({ t: t + 0.02, f: 95, f2: 55, glide: 0.08, type: "sine", vol: 0.28, a: 0.002, dur: 0.12, bus: "sfx", pan: o.pan, prio: 1 });
}
export function blockThud(s, o = {}) {
  const t = s.at(o.t), k = clamp(o.k == null ? 0.5 : o.k, 0, 1);
  s.noise({ t, lp: 250 + 250 * k, vol: 0.12 + 0.1 * k, a: 0.001, dur: 0.06 + 0.04 * k, bus: "sfx", pan: o.pan, prio: 0 });
  s.noise({ t, bp: 1600, q: 3, vol: 0.04 + 0.04 * k, a: 0.0005, dur: 0.025, bus: "sfx", pan: o.pan, prio: 0 });
}
export function disengage(s, o = {}) {
  s.noise({ t: o.t, bp: 700, q: 1.5, vol: 0.05, a: 0.003, dur: 0.07, bus: "sfx", pan: o.pan, prio: 0 });
}
// one cleat on turf; o.k = speed factor 0..1: a soft thud, the grass "tch" (what cuts through a
// crowd), and at a sprint the cleats' click
export function step(s, o = {}) {
  const t = s.at(o.t), k = clamp(o.k == null ? 0.6 : o.k, 0, 1.2);
  const v = (0.055 + 0.085 * k) * (o.vol || 1);
  s.noise({ t, color: "pink", lp: 380 + s.rand() * 200 + 250 * k, vol: v * 1.5, a: 0.002, dur: 0.045, bus: "sfx", pan: o.pan, prio: 0 });
  s.noise({ t: t + 0.003, bp: 1500 + s.rand() * 900, q: 1.6, vol: v * 0.9, a: 0.001, dur: 0.022, bus: "sfx", pan: o.pan, prio: 0 });
  if (k > 0.7) s.noise({ t: t + 0.004, bp: 3200 + s.rand() * 900, q: 4, vol: v * 0.5, a: 0.0005, dur: 0.01, bus: "sfx", pan: o.pan, prio: 0 });
}

// ---------- contact ----------
// Tackle hit, scaled by power (config HIT: SMALL 40, BIG 95, HUGE 140): thump → body → pad crack
// → driven crunch → helmet clacks → sub boom.
export function hit(s, o = {}) {
  const p = o.power == null ? 60 : o.power, t = s.at(o.t), pan = o.pan || 0;
  const k = clamp((p - 20) / 140, 0, 1);
  s.tone({ t, f: 125 + 45 * k, f2: 42, glide: 0.1 + 0.12 * k, type: "sine", vol: 0.42 + 0.38 * k, a: 0.002, dur: 0.16 + 0.26 * k, bus: "sfx", pan, prio: 1 });
  s.noise({ t, color: "pink", lp: 600 + 1100 * k, lp2: 220, vol: 0.5 + 0.35 * k, a: 0.001, dur: 0.1 + 0.14 * k, bus: "sfx", pan, prio: 1 });
  s.noise({ t, bp: 1150 + 600 * k, q: 1.4, vol: 0.2 + 0.25 * k, a: 0.0008, dur: 0.045 + 0.05 * k, bus: "sfx", pan, prio: 1 });
  if (p > 70) s.noise({ t: t + 0.003, bp: 1900 + 500 * k, q: 0.9, vol: 0.06 + 0.12 * k, shape: "crunch", a: 0.0008, dur: 0.06 + 0.1 * k, bus: "sfx", pan, echo: p > BIG ? 1 : 0, prio: 1 });
  if (p > BIG) {
    const n = p > HUGE ? 3 : 2;
    for (let i = 0; i < n; i++) s.noise({ t: t + 0.004 + s.rand() * 0.035, bp: 2300 + s.rand() * 1100, q: 7, vol: 0.12, a: 0.0004, dur: 0.03, bus: "sfx", pan, prio: 1 });
  }
  if (p > HUGE) {
    s.tone({ t, f: 72, f2: 30, glide: 0.45, type: "sine", vol: 0.5, a: 0.003, dur: 0.7, bus: "sfx", echo: 1, prio: 2 });
    s.noise({ t: t + 0.01, color: "brown", lp: 380, vol: 0.55, a: 0.004, dur: 0.5, bus: "sfx", prio: 2 });
  }
}
// carrier shakes a tackler: glancing pad slap + scuff
export function glance(s, o = {}) {
  const t = s.at(o.t);
  s.noise({ t, bp: 900, q: 1.2, vol: 0.2, a: 0.001, dur: 0.07, bus: "sfx", pan: o.pan, prio: 1 });
  s.tone({ t, f: 140, f2: 80, glide: 0.06, type: "sine", vol: 0.2, a: 0.002, dur: 0.09, bus: "sfx", pan: o.pan, prio: 1 });
}
export function stiffArm(s, o = {}) {
  const t = s.at(o.t);
  s.tone({ t, f: 160, f2: 70, glide: 0.07, type: "sine", vol: 0.34, a: 0.002, dur: 0.13, bus: "sfx", pan: o.pan, prio: 1 });
  s.noise({ t, lp: 900, vol: 0.28, a: 0.001, dur: 0.07, bus: "sfx", pan: o.pan, prio: 1 });
  s.noise({ t, bp: 1600, q: 2, vol: 0.12, a: 0.0006, dur: 0.03, bus: "sfx", pan: o.pan, prio: 1 });
  s.sample("hah", { t: t + 0.01, rate: o.pitch || 1, vol: 0.32, bus: "sfx", pan: o.pan, prio: 1 });
}
export function grunt(s, o = {}) {
  s.sample("oof", { t: o.t, rate: (o.pitch || 1) * (0.94 + s.rand() * 0.1), vol: 0.3 * (o.vol || 1), bus: "sfx", pan: o.pan, prio: 1 });
}
export function pancake(s, o = {}) {
  const t = s.at(o.t);
  hit(s, { t, power: 85, pan: o.pan });
  s.noise({ t: t + 0.1, color: "brown", lp: 260, vol: 0.4, a: 0.003, dur: 0.22, bus: "sfx", pan: o.pan, prio: 1 });
  grunt(s, { t: t + 0.03, pan: o.pan, pitch: o.pitch });
}
// air movement: dive lunge, tackle attempt
export function whoosh(s, o = {}) {
  const t = s.at(o.t), d = o.dur || 0.28;
  s.noise({ t, bp: o.f || 700, bp2: (o.f || 700) * 0.45, q: 1.1, sweep: d, vol: 0.2 * (o.vol || 1), a: d * 0.35, dur: d, bus: "sfx", pan: o.pan, prio: 1 });
}
export function turf(s, o = {}) {
  const t = s.at(o.t);
  s.noise({ t, color: "pink", lp: 320, vol: 0.32, a: 0.002, dur: 0.14, bus: "sfx", pan: o.pan, prio: 1 });
  s.tone({ t, f: 80, f2: 48, glide: 0.08, type: "sine", vol: 0.22, a: 0.002, dur: 0.12, bus: "sfx", pan: o.pan, prio: 1 });
  s.noise({ t: t + 0.03, hp: 2500, vol: 0.03, a: 0.01, dur: 0.18, bus: "sfx", pan: o.pan, prio: 0 });
}
export function juke(s, o = {}) {
  const t = s.at(o.t);
  s.noise({ t, bp: 4200, bp2: 1300, q: 1.6, sweep: 0.16, vol: 0.36, a: 0.02, dur: 0.17, bus: "sfx", pan: o.pan, prio: 1 });
  s.noise({ t: t + 0.02, color: "pink", lp: 700, vol: 0.26, a: 0.001, dur: 0.05, bus: "sfx", pan: o.pan, prio: 1 });
  s.tone({ t: t + 0.01, f: 2300, f2: 3100, glide: 0.035, type: "sine", vol: 0.02, a: 0.002, dur: 0.05, bus: "sfx", pan: o.pan, prio: 0 });
}

// ---------- the ball ----------
// spiral leaving the QB's hand and fizzing downfield (o.dur = flight time)
export function throwZip(s, o = {}) {
  const t = s.at(o.t), d = clamp(o.dur || 0.6, 0.25, 2.2);
  const vp = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24, arc = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
    vp.push([u * d, (0.55 + 0.45 * Math.sin(i * 2.2)) * arc]);
  }
  vp[0][1] = 0;
  vp[24][1] = 0;
  s.noise({ t, bp: 900, q: 2.4, fpts: [[0, 700], [d * 0.4, 2400], [d, 1000]], vpts: vp, vol: 0.42, bus: "sfx", pan: o.pan, prio: 1 });
  s.noise({ t, lp: 900, vol: 0.3, a: 0.002, dur: 0.06, bus: "sfx", pan: o.pan, prio: 1 }); // release snap
}
export function catchThump(s, o = {}) {
  const t = s.at(o.t), k = o.hard ? 1.25 : 1;
  s.tone({ t, f: 230, f2: 150, glide: 0.05, type: "triangle", vol: 0.45 * k, a: 0.001, dur: 0.09, bus: "sfx", pan: o.pan, prio: 1 });
  s.noise({ t, lp: 1100, vol: 0.42 * k, a: 0.0008, dur: 0.055, bus: "sfx", pan: o.pan, prio: 1 });
  s.noise({ t, bp: 1700, q: 2.5, vol: 0.2 * k, a: 0.0005, dur: 0.022, bus: "sfx", pan: o.pan, prio: 1 });
}
export function handoff(s, o = {}) {
  const t = s.at(o.t);
  s.tone({ t, f: 190, f2: 120, glide: 0.05, type: "triangle", vol: 0.16, a: 0.001, dur: 0.07, bus: "sfx", pan: o.pan, prio: 1 });
  s.noise({ t, lp: 800, vol: 0.14, a: 0.001, dur: 0.05, bus: "sfx", pan: o.pan, prio: 1 });
}
// football bouncing on turf: end over end, irregular, decaying (o.n bounces)
export function bounce(s, o = {}) {
  const t = s.at(o.t), n = o.n || 4;
  let dt = 0, gap = 0.2 + s.rand() * 0.06, v = 0.34 * (o.vol || 1);
  for (let i = 0; i < n; i++) {
    const tip = s.rand() < 0.4;
    s.tone({ t: t + dt, f: tip ? 340 : 240 + s.rand() * 40, f2: tip ? 250 : 170, glide: 0.04, type: "triangle", vol: v, a: 0.001, dur: 0.06, bus: "sfx", pan: o.pan, prio: 1 });
    s.noise({ t: t + dt, lp: tip ? 1500 : 700, vol: v * 0.8, a: 0.001, dur: 0.04, bus: "sfx", pan: o.pan, prio: 1 });
    dt += gap;
    gap *= 0.62 + s.rand() * 0.25;
    v *= 0.62;
  }
}
// boot meets ball (o.kind 'kickoff' | 'fg' | 'punt' | 'pat')
export function kick(s, o = {}) {
  const t = s.at(o.t), punt = o.kind === "punt";
  s.tone({ t, f: punt ? 150 : 190, f2: 62, glide: 0.08, type: "sine", vol: 0.62, a: 0.001, dur: 0.18, bus: "sfx", pan: o.pan, prio: 2 });
  s.noise({ t, lp: punt ? 1200 : 2000, vol: 0.4, a: 0.0006, dur: 0.045, bus: "sfx", pan: o.pan, prio: 2 });
  s.noise({ t, bp: punt ? 520 : 820, q: 2.2, vol: 0.3, a: 0.0006, dur: 0.06, bus: "sfx", pan: o.pan, echo: 1, prio: 2 });
}
// the ball's hang time: an airy rising/falling whistle over the whole flight (o.dur)
export function ballFlight(s, o = {}) {
  const t = s.at(o.t), d = clamp(o.dur || 2, 0.6, 4.5);
  s.noise({ t, bp: 1100, q: 5, fpts: [[0, 900], [d * 0.45, 2300], [d, 1200]], vpts: [[0, 0], [d * 0.2, 0.6], [d * 0.5, 1], [d * 0.85, 0.5], [d, 0]], vol: 0.07, bus: "sfx", prio: 1 });
  s.tone({ t, f: 880, f2: 1320, glide: d * 0.45, type: "sine", vol: 0.018, a: d * 0.3, h: d * 0.2, dur: d, bus: "sfx", echo: 2, prio: 0 });
}

// ---------- officials, scoreboard, PA ----------
export function whistle(s, o = {}) {
  const t = s.at(o.t);
  const n = o.n || 1;
  for (let i = 0; i < n; i++) s.sample(o.long && i === n - 1 ? "whistleLong" : "whistle", { t: t + i * 0.42, rate: 0.98 + s.rand() * 0.04, vol: 0.55 * (o.vol || 1), bus: "sfx", echo: 2, prio: 2 });
}
export function horn(s, o = {}) {
  s.sample("horn", { t: o.t, rate: o.rate || 1, vol: 0.5 * (o.vol || 1), dur: o.dur || 0, fade: 0.25, bus: "sfx", echo: 3, prio: 2 });
}
// end of a quarter: the horn, lower and shorter
export function quarterHorn(s, o = {}) {
  horn(s, { t: o.t, rate: 0.84, dur: 1.1, vol: 0.85 });
}
// broadcast first-down chime: two FM bells a fourth apart (A5 → D6 in the game's key)
export function chime(s, o = {}) {
  const t = s.at(o.t);
  s.fm({ t, f: 880, ratio: 3.5, index: 1.4, index2: 0.06, idxT: 0.25, vol: 0.19, a: 0.002, dur: 0.7, bus: "sfx", echo: 2, prio: 2 });
  s.fm({ t: t + 0.12, f: 1175, ratio: 3.5, index: 1.4, index2: 0.06, idxT: 0.3, vol: 0.2, a: 0.002, dur: 1.0, bus: "sfx", echo: 2, prio: 2 });
  s.tone({ t: t + 0.12, f: 587, wave: "nes", vol: 0.12, a: 0.002, dur: 0.35, bus: "sfx", prio: 1 });
}
// field goal: "ding-ding-DING" up the D triad
export function goodDing(s, o = {}) {
  const t = s.at(o.t);
  [1175, 1480, 1760].forEach((f, i) => s.fm({ t: t + i * 0.11, f, ratio: 3.5, index: 1.5, index2: 0.06, vol: 0.17 + i * 0.03, a: 0.002, dur: 0.6 + i * 0.4, bus: "sfx", echo: 2, prio: 2 }));
}
export function noGood(s, o = {}) {
  const t = s.at(o.t);
  s.tone({ t, f: midiHz(50), f2: midiHz(49), glide: 0.2, wave: "brass", vol: 0.14, a: 0.01, h: 0.12, dur: 0.3, lp: 900, bus: "sfx", prio: 2 });
  s.tone({ t: t + 0.28, f: midiHz(49), f2: midiHz(47), glide: 0.5, wave: "brass", vol: 0.14, a: 0.01, h: 0.25, dur: 0.6, lp: 800, lp2: 300, bus: "sfx", echo: 1, prio: 2 });
}
// slow-motion: a reverse-cymbal swell + low drone sucking the air out before the score
export function riser(s, o = {}) {
  const t = s.at(o.t);
  s.sample("swell", { t, vol: 0.38, bus: "sfx", echo: 1, prio: 2 });
  s.tone({ t, f: 55, f2: 82, glide: 1.4, wave: "brass", vol: 0.1, a: 0.6, h: 0.6, dur: 1.5, lp: 300, lp2: 900, bus: "sfx", prio: 1 });
}

// ---------- Pokémon type flair (subtle accents on big moments) ----------
export function flair(s, type, o = {}) {
  const t = s.at(o.t), pan = o.pan, v = o.vol || 1;
  switch (type) {
    case "electric":
      s.fm({ t, f: 900, ratio: 7.13, index: 9, index2: 1, idxT: 0.1, vol: 0.05 * v, a: 0.001, dur: 0.14, bus: "sfx", pan, prio: 0 });
      s.noise({ t, hp: 3500, vol: 0.05 * v, a: 0.001, dur: 0.08, bus: "sfx", pan, prio: 0 });
      break;
    case "fire":
      s.noise({ t, hp: 2600, vol: 0.06 * v, a: 0.01, dur: 0.3, bus: "sfx", pan, prio: 0 });
      s.noise({ t, color: "brown", lp: 500, vol: 0.12 * v, a: 0.02, dur: 0.25, bus: "sfx", pan, prio: 0 });
      break;
    case "water":
      s.noise({ t, bp: 1400, bp2: 500, q: 1.5, vol: 0.12 * v, a: 0.005, dur: 0.22, bus: "sfx", pan, prio: 0 });
      for (let i = 0; i < 3; i++) s.tone({ t: t + 0.03 + i * 0.05, f: 500 + s.rand() * 300, f2: 1400, glide: 0.05, type: "sine", vol: 0.035 * v, a: 0.002, dur: 0.06, bus: "sfx", pan, prio: 0 });
      break;
    case "rock": case "ground":
      s.noise({ t, color: "brown", lp: 240, vol: 0.3 * v, a: 0.004, dur: 0.35, bus: "sfx", pan, prio: 0 });
      break;
    case "psychic":
      [2093, 2637, 3136].forEach((f, i) => s.tone({ t: t + i * 0.03, f, type: "sine", vol: 0.018 * v, a: 0.05, dur: 0.5, vib: [7, 30, 0.05], bus: "sfx", echo: 3, pan, prio: 0 }));
      break;
    case "ghost":
      s.tone({ t, f: 620, f2: 1050, glide: 0.18, type: "sine", vol: 0.04 * v, a: 0.04, dur: 0.4, vib: [8, 45, 0.04], bus: "sfx", echo: 2, pan, prio: 0 });
      break;
    case "ice":
      s.fm({ t, f: 2637, ratio: 2.76, index: 2, index2: 0.1, vol: 0.035 * v, a: 0.001, dur: 0.35, bus: "sfx", echo: 2, pan, prio: 0 });
      break;
    case "grass": case "bug":
      s.noise({ t, bp: 3600, q: 1.2, vol: 0.06 * v, a: 0.01, dur: 0.16, bus: "sfx", pan, prio: 0 });
      break;
    case "poison":
      for (let i = 0; i < 3; i++) s.tone({ t: t + i * 0.06, f: 260 + s.rand() * 120, f2: 800, glide: 0.07, type: "sine", vol: 0.04 * v, a: 0.003, dur: 0.08, bus: "sfx", pan, prio: 0 });
      break;
    case "dragon":
      s.tone({ t, f: 82, f2: 62, glide: 0.3, type: "sawtooth", vol: 0.07 * v, a: 0.02, dur: 0.35, lp: 500, bus: "sfx", pan, prio: 0 });
      break;
    case "fighting":
      s.noise({ t: t + 0.02, color: "pink", lp: 1200, vol: 0.18 * v, a: 0.001, dur: 0.06, bus: "sfx", pan, prio: 0 });
      break;
    case "flying":
      whoosh(s, { t, dur: 0.18, f: 900, vol: 0.5 * v, pan });
      break;
    default:
  }
}
