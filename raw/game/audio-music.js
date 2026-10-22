// ALL-22 BOWL audio — music (audio team): an original chiptune title theme, stings and jingles,
// stadium-organ cues, a compact song notation and a lookahead sequencer (notes are scheduled
// ~0.2 s ahead on the audio clock, so timing never depends on the frame rate).
//
// Notation (per bar, 16 steps of a 16th note):
//   c:  chords, "C" | "Bb F" (half bar each) | "Ab:4 Bb:4 C:8" (explicit steps). Qualities: m 7 maj7 m7 sus4 dim 5
//   l:  lead line, "G4:3 C5:3 E5:2" (note:steps; a bare note reuses the last length; r = rest)
//   h:  harmony line, or "auto" (the chord tone a 3rd–6th below each lead note)
//   b:  bass pattern name (drive | pump | walk | half | hold) or [[step, len], ...] root hits
//   a:  arpeggio pattern (up | updown)            st: brass stabs [[step, len], ...] or "hold"
//   d:  drum pattern name or {K, S, H, O, C, T, P, Q} lanes (16 chars: x hit, X accent, g ghost,
//       h/m/l toms, r timpani roll (32nds))
//   g:  overdriven power-chord guitar on the bar's chords (16 chars: x palm-muted chug, X ring out)
// Songs: {bpm, key (semitones), bus ('bg' duckable loop | 'fg' sting), loop, inst overrides, intro: [bars], body: [bars]}
import { midiHz } from "./audio-synth.js";

const NB = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteMidi(s) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) return null;
  return 12 * (Number(m[3]) + 1) + NB[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}
const QUAL = { "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus4: [0, 5, 7], dim: [0, 3, 6], "5": [0, 7] };
function parseChord(sym) {
  const m = /^([A-G][#b]?)(maj7|m7|m|7|sus4|dim|5)?$/.exec(sym);
  if (!m) throw new Error("bad chord " + sym);
  const pc = (noteMidi(m[1] + "4") - 60 + 12) % 12;
  return { pc, iv: QUAL[m[2] || ""] };
}
function parseChords(str, len = 16) {
  const parts = str.trim().split(/\s+/);
  const out = [];
  let s = 0;
  const even = len / parts.length;
  for (const p of parts) {
    const [sym, len] = p.split(":");
    const l = len ? Number(len) : even;
    out.push({ s, len: l, ...parseChord(sym) });
    s += l;
  }
  return out;
}
function parseLine(str) {
  const out = [];
  let s = 0, last = 2;
  for (const tok of str.trim().split(/\s+/)) {
    if (!tok) continue;
    const [n, l] = tok.split(":");
    if (l) last = Number(l);
    if (n !== "r") {
      const m = noteMidi(n);
      if (m == null) throw new Error("bad note " + tok);
      out.push({ s, d: last, m });
    }
    s += last;
  }
  return { notes: out, len: s };
}
const chordAt = (chords, step) => {
  let c = chords[0];
  for (const ch of chords) if (ch.s <= step) c = ch;
  return c;
};
// chord tones (any octave) within [lo, hi]
function tonesIn(ch, lo, hi) {
  const out = [];
  for (let m = lo; m <= hi; m++) if (ch.iv.includes((((m - ch.pc) % 12) + 12) % 12)) out.push(m);
  return out;
}

const BASS = {
  drive: [[0, 2, "R"], [2, 2, "R"], [4, 2, "O"], [6, 2, "R"], [8, 2, "R"], [10, 2, "R"], [12, 2, "O"], [14, 2, "5"]],
  pump: [[0, 2, "R"], [2, 2, "O"], [4, 2, "R"], [6, 2, "O"], [8, 2, "R"], [10, 2, "O"], [12, 2, "R"], [14, 2, "O"]],
  walk: [[0, 4, "R"], [4, 2, "R"], [6, 2, "5"], [8, 4, "O"], [12, 2, "5"], [14, 2, "3"]],
  half: [[0, 8, "R"], [8, 8, "5"]],
  march: [[0, 3, "R"], [8, 3, "5"]],
  hold: [[0, 16, "R"]],
};
const DRUMS = {
  A: { K: "x.......x.x.....", S: "....x.......x...", H: "x.x.x.x.x.x.x.x." },
  A1: { K: "x.......x.x.....", S: "....x.......x...", H: "..x.x.x.x.x.x.x.", C: "x..............." },
  fillA: { K: "x.......x.......", S: "....x.......xxXX", H: "x.x.x.x.x.x....." },
  fillB: { K: "x.......x.......", S: "....x...gxgxXxXX", H: "x.x.x.x........." },
  B: { K: "x...x...x...x...", S: "....x.......x...", H: "xgxgxgxgxgxgxgxg" },
  B1: { K: "x...x...x...x...", S: "....x.......x...", H: "..xgxgxgxgxgxgxg", C: "x..............." },
  fillT: { K: "x.......x.......", S: "....x...........", T: "........hhmmllll" },
  C: { K: "x.....x.x.......", S: "....x.......x...", H: "x...x...x...x...", O: "..x...x...x...x." },
  C1: { K: "x.....x.x.......", S: "....x.......x...", H: "....x...x...x...", O: "..x...x...x...x.", C: "x..............." },
  end: { K: "x...............", S: "........gxgxXXXX" },
  land: { K: "x...............", C: "x..............." },
  D: { K: "x.......x.......", S: "........x.......", H: "..x...x...x...x." },
  march: { K: "x.......x.......", S: "x..xx.x.x..xx.x." },
  march1: { K: "x.......x.......", S: "x..xx.x.x..xx.x.", C: "x..............." },
  marchEnd: { K: "x.......x.......", S: "x..xx.x.XxxXXxXX" },
  build: { K: "x...x...x...x...", S: "gggggggggxgxXXXX", H: "x.x.x.x........." },
  intro1: { K: "x.....x.x.......", C: "x...............", T: "............hmll" },
  intro2: { K: "x...x...x.......", S: "........gxgxXXXX" },
};

// ---------- compile ----------
export function compile(def) {
  const spb = 60 / def.bpm / 4;
  const key = def.key || 0;
  const ev = [];
  let step = 0;
  const bar = (b) => {
    const len = b.len || 16;
    const chords = b.c ? parseChords(b.c, len) : [];
    if (b.c && chords.reduce((a, c) => a + c.len, 0) !== len) throw new Error(`chords don't fill the bar: ${b.c}`);
    let lead = null;
    if (b.l) {
      lead = parseLine(b.l);
      if (lead.len !== len) throw new Error(`lead bar is ${lead.len} steps: ${b.l}`);
      for (const n of lead.notes) ev.push({ s: step + n.s, d: n.d, i: b.li || "lead", m: n.m + key, v: 1 });
    }
    if (b.h === "auto" && lead) {
      for (const n of lead.notes) {
        const ch = chordAt(chords, n.s);
        const cand = tonesIn(ch, n.m - 9, n.m - 3);
        if (cand.length) ev.push({ s: step + n.s, d: n.d, i: "harm", m: cand[cand.length - 1] + key, v: 1 });
      }
    } else if (b.h) {
      const h = parseLine(b.h);
      for (const n of h.notes) ev.push({ s: step + n.s, d: n.d, i: "harm", m: n.m + key, v: 1 });
    }
    // bass
    if (b.b) {
      for (const ch of chords) {
        let root = 36 + ch.pc; // A1..G#2: chip-bass register
        if (root > 44) root -= 12;
        const fifth = root + (ch.iv.includes(7) ? 7 : ch.iv.includes(6) ? 6 : 7);
        const third = root + (ch.iv.includes(3) ? 3 : ch.iv.includes(5) ? 5 : 4);
        const pat = Array.isArray(b.b) ? b.b.map(([s, l]) => [s - ch.s, l, "R"]) : BASS[b.b];
        for (const [s, l, tk] of pat) {
          if (s < 0 || s >= ch.len) continue;
          const m = tk === "R" ? root : tk === "O" ? root + 12 : tk === "5" ? fifth : third;
          ev.push({ s: step + ch.s + s, d: Math.min(l, ch.len - s), i: "bass", m: m + key, v: 1 });
        }
      }
    }
    // brass stabs: compact voicing in [58, 70)
    if (b.st) {
      const hits = b.st === "hold" ? chords.map((c) => [c.s, c.len]) : b.st;
      for (const [s, l] of hits) {
        const ch = chordAt(chords, s);
        for (const iv of ch.iv.slice(0, 4)) {
          let m = 60 + ((ch.pc + iv) % 12);
          if (m >= 70) m -= 12;
          if (m < 58) m += 12;
          ev.push({ s: step + s, d: l, i: b.sti || "brass", m: m + key, v: b.stv || 1 });
        }
      }
    }
    // arpeggio (16ths, chord tones from C5 up)
    if (b.a) {
      for (let s = 0; s < len; s++) {
        const ch = chordAt(chords, s);
        const tones = ch.iv.slice(0, 3).map((iv) => 72 + ((ch.pc + iv) % 12)).sort((x, y) => x - y);
        tones.push(tones[0] + 12);
        const seq = b.a === "updown" ? [0, 1, 2, 3, 2, 1] : [0, 1, 2, 3];
        ev.push({ s: step + s, d: 1, i: "arp", m: tones[seq[s % seq.length]] + key, v: s % 4 === 0 ? 1 : 0.7 });
      }
    }
    // drums
    if (b.d) {
      const dp = typeof b.d === "string" ? DRUMS[b.d] : b.d;
      if (!dp) throw new Error("no drum pattern " + b.d);
      for (const lane in dp) {
        const str = dp[lane];
        for (let s = 0; s < str.length && s < len; s++) {
          const ch = str[s];
          if (ch === ".") continue;
          const v = ch === "X" ? 1 : ch === "g" ? 0.4 : 0.8;
          if (lane === "T") ev.push({ s: step + s, d: 1, i: "T", m: ch === "h" ? 2 : ch === "m" ? 1 : 0, v: 0.85 });
          else if (lane === "P") {
            const c0 = chords.length ? chordAt(chords, s) : { pc: 7 };
            let root = 36 + c0.pc; // kettles tuned F2..E3
            if (root < 41) root += 12;
            root += key;
            if (ch === "r") {
              ev.push({ s: step + s, d: 0.5, i: "P", m: root, v: 0.3 + (0.5 * s) / str.length });
              ev.push({ s: step + s + 0.5, d: 0.5, i: "P", m: root, v: 0.3 + (0.5 * s) / str.length });
            } else ev.push({ s: step + s, d: 1, i: "P", m: root, v });
          } else ev.push({ s: step + s, d: 1, i: lane, v });
        }
      }
    }
    // power-chord guitar: root–5th–octave, root kept in E2..D#3
    if (b.g) {
      const hits = [];
      for (let s = 0; s < b.g.length && s < len; s++) if (b.g[s] !== ".") hits.push(s);
      hits.forEach((s, k) => {
        const ch = chordAt(chords, s);
        let root = 40 + ((ch.pc - 4 + 12) % 12);
        const ring = b.g[s] === "X";
        const next = k + 1 < hits.length ? hits[k + 1] : len;
        const d = ring ? next - s : 1;
        for (const iv of [0, 7, 12]) ev.push({ s: step + s, d, i: "gtr", m: root + iv + key, v: ring ? 1 : 0.8 });
      });
    }
    if (b.bell) {
      const bl = parseLine(b.bell);
      for (const n of bl.notes) ev.push({ s: step + n.s, d: n.d, i: "bell", m: n.m + key, v: 1 });
    }
    step += len;
  };
  for (const b of def.intro || []) bar(b);
  const introSteps = step;
  for (const b of def.body) bar(b);
  ev.sort((a, b) => a.s - b.s || (a.i < b.i ? -1 : 1));
  let loopIdx = ev.findIndex((e) => e.s >= introSteps);
  if (loopIdx < 0) loopIdx = ev.length;
  return { name: def.name, spb, ev, introSteps, loopSteps: def.loop ? step - introSteps : 0, total: step, loopIdx, bus: def.bus || "fg", inst: def.inst || {}, tail: def.tail == null ? 1.6 : def.tail, vol: def.vol || 1 };
}

// ---------- songs ----------
const rep = (n, b) => Array.from({ length: n }, () => ({ ...b }));
const R = (b, o) => ({ ...b, ...o });

// TITLE THEME — "Kickoff in Kanto": D major, 150 BPM, 36-bar loop (57.6 s) after a 2-bar intro.
// A: tresillo fanfare hook over I–I–bVII–IV · A': the answer, up to the dominant · B: driving
// relative-minor bridge ending on V/vi · C: soaring IV–V–iii–vi chorus home to I, guitars in ·
// D: a 4-bar breather (mellow triangle restates the hook over pads) building back to the top.
const A_ = { b: "drive", d: "A", st: [[6, 2], [14, 2]] };
const HOOK1 = "G4:3 C5:3 E5:2 G5:6 E5:2";
const TITLE = {
  name: "title", bpm: 150, key: 2, bus: "bg", loop: true, vol: 1,
  intro: [
    { c: "C", b: [[0, 4], [6, 2], [8, 4]], st: [[0, 4], [6, 2], [8, 4]], g: "X.....X.X.......", d: "intro1" },
    { c: "Ab:4 Bb:4 C:8", b: "hold", st: "hold", g: "X...X...X.......", d: "intro2" },
  ],
  body: [
    // A
    R(A_, { c: "C", l: HOOK1, d: "A1" }),
    R(A_, { c: "C", l: "A5:3 G5:3 E5:2 D5:2 E5:2 C5:4" }),
    R(A_, { c: "Bb", l: "F5:3 D5:3 Bb4:2 D5:6 F5:2" }),
    R(A_, { c: "F", l: "A5:4 G5:2 F5:2 C5:4 r:4" }),
    R(A_, { c: "C", l: HOOK1 }),
    R(A_, { c: "C", l: "A5:3 G5:3 E5:2 G5:2 A5:2 C6:4" }),
    R(A_, { c: "Bb F", l: "D6:3 C6:3 Bb5:2 A5:4 F5:4" }),
    R(A_, { c: "G", l: "G5:6 F5:2 D5:4 B4:4", d: "fillA" }),
    // A'
    R(A_, { c: "C", l: HOOK1, d: "A1" }),
    R(A_, { c: "C", l: "A5:3 G5:3 E5:2 D5:2 E5:2 C5:4" }),
    R(A_, { c: "Bb", l: "F5:3 D5:3 Bb4:2 D5:6 F5:2" }),
    R(A_, { c: "F", l: "A5:4 G5:2 F5:2 C5:4 r:4" }),
    R(A_, { c: "Am", l: "E5:3 C5:3 A4:2 C5:6 E5:2", h: "auto" }),
    R(A_, { c: "F", l: "A5:3 F5:3 C5:2 F5:4 A5:4", h: "auto" }),
    R(A_, { c: "G", l: "B5:3 G5:3 D5:2 G5:4 A5:2 B5:2", h: "auto" }),
    R(A_, { c: "G", l: "C6:4 B5:2 A5:2 B5:8", h: "auto", d: "fillB", st: [[0, 2], [6, 2], [8, 8]] }),
    // B
    { c: "Am", l: "A4:2 r:2 A4:2 C5:2 E5:4 D5:2 C5:2", li: "square", b: "pump", d: "B1", a: "up" },
    { c: "G", l: "B4:2 r:2 B4:2 D5:2 G5:4 F5:2 D5:2", li: "square", b: "pump", d: "B", a: "up" },
    { c: "F", l: "C5:2 r:2 C5:2 F5:2 A5:4 G5:2 F5:2", li: "square", b: "pump", d: "B", a: "up" },
    { c: "G", l: "G5:6 F5:2 E5:4 D5:4", li: "square", b: "pump", d: "B", a: "up" },
    { c: "Am", l: "A4:2 r:2 A4:2 C5:2 E5:4 D5:2 C5:2", li: "square", b: "pump", d: "B", a: "up" },
    { c: "G", l: "B4:2 r:2 B4:2 D5:2 G5:4 A5:2 B5:2", li: "square", b: "pump", d: "B", a: "up" },
    { c: "F", l: "C6:6 B5:2 A5:4 F5:4", li: "square", b: "pump", d: "B", a: "updown" },
    { c: "E7", l: "G#5:6 A5:2 B5:4 D6:4", b: [[0, 4], [8, 4], [12, 4]], d: "fillT", st: [[0, 4], [8, 8]] },
    // C (chorus)
    { c: "F", l: "C6:6 A5:2 F5:4 A5:4", li: "anthem", h: "auto", b: "walk", d: "C1", st: "hold", stv: 0.4, g: "X.x.x.x.X.x.x.x." },
    { c: "G", l: "B5:6 G5:2 D5:4 G5:4", li: "anthem", h: "auto", b: "walk", d: "C", st: "hold", stv: 0.4, g: "X.x.x.x.X.x.x.x." },
    { c: "Em", l: "G5:6 E5:2 B4:4 E5:4", li: "anthem", h: "auto", b: "walk", d: "C", st: "hold", stv: 0.4, g: "X.x.x.x.X.x.x.x." },
    { c: "Am", l: "A5:6 G5:2 A5:4 C6:4", li: "anthem", h: "auto", b: "walk", d: "C", st: "hold", stv: 0.4, g: "X.x.x.x.X.x.x.x." },
    { c: "F", l: "C6:6 A5:2 F5:4 A5:4", li: "anthem", h: "auto", b: "walk", d: "C1", st: "hold", stv: 0.4, g: "X.x.x.x.X.x.x.x." },
    { c: "G", l: "D6:6 B5:2 G5:4 B5:4", li: "anthem", h: "auto", b: "walk", d: "C", st: "hold", stv: 0.4, g: "X.x.x.x.X.x.x.x." },
    { c: "C", l: "C6:4 G5:2 E5:2 G5:2 E5:2 C5:2 E5:2", li: "anthem", h: "auto", b: "walk", d: "C", st: "hold", stv: 0.4, g: "X.x.x.x.X.x.x.x." },
    { c: "C", l: "C5:8 r:8", b: [[0, 8]], d: "land", st: [[0, 6]], g: "X..............." },
    // D (breakdown)
    { c: "C", l: "G5:6 E5:2 C5:4 E5:4", li: "soft", b: "half", st: "hold", sti: "pad", a: "updown", d: "D" },
    { c: "Bb", l: "F5:6 D5:2 Bb4:8", li: "soft", b: "half", st: "hold", sti: "pad", a: "updown", d: "D" },
    { c: "F", l: "C5:6 A4:2 F4:4 A4:4", li: "soft", b: "half", st: "hold", sti: "pad", a: "updown", d: "D" },
    { c: "G", l: "B4:4 D5:4 G5:8", li: "soft", b: [[0, 8], [8, 8]], st: "hold", sti: "pad", d: "build" },
  ],
};

// PREGAME / KICKOFF sting: "ta-ta-ta TAAA" over a timpani roll, then bVI–bVII–I.
const PREGAME = {
  name: "pregame", bpm: 140, key: 2, tail: 2.2,
  body: [
    { c: "C", l: "G4:1 G4:1 G4:2 C5:6 E5:2 G5:4", li: "brassLead", b: [[4, 12]], st: [[4, 12]], stv: 0.7, d: { P: "rrrrrrrrrrrrrrrr", K: "....x..........." } },
    { c: "Ab:4 Bb:4 C:8", l: "C6:4 D6:4 E6:8", li: "brassLead", b: "hold", st: "hold", d: { K: "x...x...x.......", S: "x...x...x.......", P: "x...x...x.......", C: "........x......." } },
  ],
};
// SECOND HALF: the cadence only.
const SECOND = {
  name: "second", bpm: 140, key: 2, tail: 2,
  body: [{ c: "Ab:4 Bb:4 C:8", l: "C6:4 D6:4 E6:8", li: "brassLead", b: "hold", st: "hold", d: { K: "x...x...x.......", S: "gxgxx...x.......", C: "........x......." } }],
};
// HALFTIME: a marching-band phrase, snare cadence, ta-da.
const HALFTIME = {
  name: "halftime", bpm: 128, key: 0, tail: 2,
  body: [
    { c: "F", l: "C5:2 F5:2 A5:2 F5:2 C6:4 A5:4", li: "brassLead", h: "auto", b: "half", d: { K: "x...x...x...x...", S: "x.xxx.x.x.xxx.x.", C: "x..............." } },
    { c: "C7:8 F:8", l: "Bb5:2 G5:2 E5:2 G5:2 F5:8", li: "brassLead", h: "auto", b: "half", d: { K: "x...x...x.......", S: "x.xxx.x.XxxX....", C: "........x......." }, st: [[8, 6]] },
  ],
};
// HALFTIME BAND: "Kanto Fight Song", a 16-bar march (F major, 32 s loop) under the halftime screen:
// oom-pah tuba, off-beat brass, snare cadence; the trio (bars 9–12) moves to B♭ with glockenspiel.
const M_ = { li: "brassLead", h: "auto", b: "march", st: [[4, 2], [12, 2]], stv: 0.8, d: "march" };
const BAND = {
  name: "band", bpm: 120, key: 0, bus: "bg", loop: true, vol: 0.8, inst: { bass: "tuba", harm: "horn2" },
  body: [
    R(M_, { c: "F", l: "C5:2 F5:2 A5:2 F5:2 C6:4 A5:4", d: "march1" }),
    R(M_, { c: "C7:8 F:8", l: "Bb5:2 G5:2 E5:2 G5:2 F5:8" }),
    R(M_, { c: "Bb", l: "D5:2 F5:2 Bb5:2 F5:2 D6:4 Bb5:4" }),
    R(M_, { c: "F:8 C7:8", l: "A5:2 C6:2 A5:2 F5:2 G5:8" }),
    R(M_, { c: "F", l: "C5:2 F5:2 A5:2 F5:2 C6:4 A5:4" }),
    R(M_, { c: "C7:8 F:8", l: "Bb5:2 G5:2 E5:2 G5:2 F5:8" }),
    R(M_, { c: "Bb:8 C7:8", l: "D6:2 C6:2 Bb5:2 D6:2 C6:2 Bb5:2 A5:2 G5:2" }),
    R(M_, { c: "F", l: "F5:4 A5:2 C6:2 F6:4 r:4", d: "marchEnd" }),
    // trio
    R(M_, { c: "Bb", l: "F5:4 Bb5:4 D6:6 C6:2", bell: "F6:4 Bb6:4 D7:6 C7:2", d: "march1" }),
    R(M_, { c: "Eb:8 Bb:8", l: "Bb5:4 G5:4 F5:8", bell: "Bb6:4 G6:4 F6:8" }),
    R(M_, { c: "Gm:8 C7:8", l: "G5:4 Bb5:4 E5:4 G5:4", bell: "G6:4 Bb6:4 E6:4 G6:4" }),
    R(M_, { c: "F:8 C7:8", l: "A5:4 C6:4 Bb5:4 G5:4", bell: "A6:4 C7:4 Bb6:4 G6:4" }),
    // home
    R(M_, { c: "F", l: "C5:2 F5:2 A5:2 F5:2 C6:4 A5:4", d: "march1" }),
    R(M_, { c: "Bb:8 G7:8", l: "D6:4 Bb5:4 B5:4 D6:4" }),
    R(M_, { c: "C7", l: "C6:2 Bb5:2 G5:2 E5:2 G5:4 Bb5:4" }),
    R(M_, { c: "F", l: "A5:4 C6:2 A5:2 F5:4 r:4", d: "marchEnd" }),
  ],
};
// VICTORY fanfare.
const VICTORY = {
  name: "victory", bpm: 132, key: 2, tail: 2.4,
  body: [
    { c: "C", l: "C5:2 E5:2 G5:2 C6:6 G5:2 C6:2", li: "brassLead", h: "auto", b: "drive", st: [[6, 6]], d: { K: "x.......x.......", S: "gggggggggggxgxXX", C: "x..............." } },
    { c: "F:8 G:8", l: "A5:4 C6:4 B5:4 D6:4", li: "brassLead", h: "auto", b: "drive", st: [[0, 3], [4, 3], [8, 3], [12, 3]], d: { K: "x...x...x...x...", S: "....x.......x.xx" } },
    { c: "Ab:4 Bb:4 C:8", l: "C6:4 D6:4 E6:8", li: "brassLead", h: "auto", b: "hold", st: "hold", d: { K: "x...x...x.......", S: "x...x...x.......", P: "x...x...rrrrrrrr", C: "........x......." },
      bell: "r:8 C6:1 E6:1 G6:1 C7:1 G6:1 C7:1 E7:2" },
  ],
};
// DEFEAT: slow, minor, dignified.
const DEFEAT = {
  name: "defeat", bpm: 92, key: 2, tail: 2.6,
  body: [
    { c: "Am:8 F:4 E:4", l: "E5:4 D5:4 C5:4 B4:4", li: "soft", b: "half", st: "hold", sti: "pad", d: { P: "x..............." } },
    { c: "Dm:6 E:2 Am:8", l: "A4:6 G#4:2 A4:8", li: "soft", b: "hold", st: "hold", sti: "pad", d: { P: "........rrrrrrr." } },
  ],
};
// TIE: unresolved, "to be continued".
const TIE = {
  name: "tie", bpm: 120, key: 2, tail: 2,
  body: [
    { c: "C:8 F:8", l: "E5:4 G5:4 A5:4 F5:4", li: "brassLead", b: "half", st: "hold", stv: 0.6, d: { K: "x.......x.......", S: "....x.......x..." } },
    { c: "Dm:8 Gsus4:8", l: "D5:4 F5:4 G5:8", li: "brassLead", b: "half", st: "hold", stv: 0.6, d: { K: "x.......x.......", P: "........rrrrrrr." } },
  ],
};
// GYM BADGE fanfare: sparkling run, then bVI–bVII–I to the top.
const BADGE = {
  name: "badge", bpm: 150, key: 2, tail: 2.4,
  body: [
    { c: "C:8 G:8", l: "C5:1 E5:1 G5:1 C6:1 E6:4 D6:2 C6:2 D6:4", h: "auto", b: "drive", st: [[4, 4], [12, 4]], d: { K: "x.......x.......", S: "....x.......x.x.", C: "x..............." } },
    { c: "Ab:4 Bb:4 C:8", l: "Eb6:2 C6:2 F6:2 D6:2 G6:8", b: "hold", st: "hold", d: { K: "x...x...x.......", S: "x...x...x.......", P: "x...x...x.......", C: "........x......." },
      bell: "r:8 E6:1 G6:1 C7:1 E7:1 G7:1 E7:1 C7:2" },
  ],
};
// GYM CHALLENGE: a leader steps up — minor-key tresillo stabs over timpani, the harmonic-minor
// dominant, then a rising arpeggio onto a held minor chord with a roll.
const CHALLENGE = {
  name: "challenge", bpm: 132, key: 2, tail: 2.2,
  body: [
    { c: "Cm:8 Ab:4 G:4", l: "C5:3 C5:3 C5:2 Eb5:4 D5:2 B4:2", li: "brassLead", b: [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]], st: [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]], g: "X..X..X.X...X...",
      d: { K: "x..x..x.x...x...", S: "........x...x.xx", P: "x..x..x.x...x..." } },
    { c: "Cm", l: "C5:2 Eb5:2 G5:4 C6:8", li: "brassLead", h: "auto", b: "hold", st: "hold", g: "X...............", d: { K: "x...............", C: "x...............", P: "....rrrrrrrrrrr." } },
  ],
};
// TOUCHDOWN brass hit (for the crowd favourite) and the "they scored" sting.
const TD = {
  name: "td", bpm: 160, key: 2, tail: 1.8,
  body: [{ c: "C", l: "G4:1 C5:1 E5:1 G5:3 E5:2 G5:8", li: "brassLead", h: "auto", b: [[0, 2], [6, 10]], st: [[6, 10]], d: { K: "x.....x.........", S: "gggggX..........", C: "......x........." } }],
};
const TD_AGAINST = {
  name: "tdAgainst", bpm: 110, key: 2, tail: 1.6,
  body: [{ c: "Ab:4 G:12", l: "C5:4 B4:12", li: "brassLead", b: "hold", st: "hold", stv: 0.8, d: { P: "x...x..........." } }],
};
const TURN_FOR = {
  name: "turnFor", bpm: 150, key: 2, tail: 1.6,
  body: [{ c: "Bb:4 C:12", l: "D5:2 F5:2 G5:12", li: "brassLead", b: "hold", st: "hold", d: { K: "x...x...........", C: "....x..........." } }],
};
const TURN_AGAINST = {
  name: "turnAgainst", bpm: 120, key: 2, tail: 1.6,
  body: [{ c: "Db:4 Cm:12", l: "Ab4:4 G4:12", li: "brassLead", b: "hold", st: "hold", stv: 0.8, d: { P: "x...x..........." } }],
};
const OVERTIME = {
  name: "overtime", bpm: 120, key: 2, tail: 2.2,
  body: [
    { c: "Cm", d: { P: "rrrrrrrrrrrrrrrr" }, st: [[12, 4]], b: [[12, 4]] },
    { c: "Ab:4 Bb:4 C:8", l: "Eb5:4 F5:4 G5:8", li: "brassLead", b: "hold", st: "hold", d: { K: "x...x...x.......", P: "x...x...x.......", C: "........x......." } },
  ],
};
// stadium organ cues (between plays)
const ORGAN_CHARGE = { name: "charge", bpm: 120, key: 2, bus: "bg", tail: 1.4, body: [{ len: 14, l: "G4:1 C5:1 E5:1 G5:3 E5:1 G5:7", li: "organ" }] };
const ORGAN_RISE = { name: "rise", bpm: 126, key: 0, bus: "bg", tail: 1.2,
  body: [
    { l: "C4:2 C#4:2 D4:2 D#4:2 E4:2 F4:2 F#4:2 G4:2", li: "organ", d: { Q: "x.x.x.x.x.x.x.x." } },
    { l: "G#4:2 A4:2 A#4:2 B4:2 C5:8", li: "organ", d: { Q: "x.x.x.x.x...x..." } },
  ] };
const ORGAN_LICK = { name: "lick", bpm: 116, key: 2, bus: "bg", tail: 1.2, body: [{ l: "C5:1 C5:1 Eb5:2 F5:1 F#5:1 G5:2 Bb5:2 G5:1 Bb5:1 C6:4", li: "organ" }] };
const ORGAN_TADA = { name: "tada", bpm: 132, key: 2, bus: "bg", tail: 1.2, body: [{ l: "G4:2 C5:2 E5:2 G5:2 C6:8", li: "organ" }] };
// menu previews for the volume sliders
const PREVIEW = { name: "preview", bpm: 150, key: 2, tail: 1, body: [{ len: 8, c: "C", l: "G4:1 C5:1 E5:1 G5:5", st: [[3, 5]], b: [[3, 5]], d: { K: "...x....", C: "...x...." } }] };

export const SONG_DEFS = { title: TITLE, band: BAND, challenge: CHALLENGE, pregame: PREGAME, second: SECOND, halftime: HALFTIME, victory: VICTORY, defeat: DEFEAT, tie: TIE, badge: BADGE, td: TD, tdAgainst: TD_AGAINST, turnFor: TURN_FOR, turnAgainst: TURN_AGAINST, overtime: OVERTIME, charge: ORGAN_CHARGE, rise: ORGAN_RISE, lick: ORGAN_LICK, tada: ORGAN_TADA, preview: PREVIEW };
export const SONGS = {};
for (const k in SONG_DEFS) SONGS[k] = compile(SONG_DEFS[k]);

// ---------- sequencer ----------
const LOOK = 0.2; // seconds scheduled ahead
const DRUM_SAMPLE = { K: "kick", S: "snare", H: "hat", O: "ohat", C: "crash", T: "tom", P: "timp", Q: "clap" };
const DRUM_VOL = { K: 0.31, S: 0.48, H: 0.25, O: 0.2, C: 0.34, T: 0.38, P: 0.4, Q: 0.3 };
const DRUM_PAN = { K: 0, S: 0.05, H: 0.25, O: 0.25, C: -0.2, Q: 0.1 };

export class Music {
  constructor(synth, opts = {}) {
    this.s = synth;
    this.offline = !!opts.offline;
    this.players = [];
    this.timer = null;
    this.muted = false;
    this.only = null; // test-only: Set of instrument names to render (stems)
  }
  isPlaying(name) {
    return this.players.some((p) => p.song.name === name && !p.stopped);
  }
  // Starts a song now (or at t). opts: {t, vol, onEnd}. Returns the player.
  play(name, opts = {}) {
    const song = SONGS[name];
    if (!song) return null;
    const s = this.s, c = s.ctx;
    const out = c.createGain();
    out.gain.value = (opts.vol == null ? 1 : opts.vol) * song.vol;
    out.connect(s.busFor(song.bus));
    const t0 = Math.max(c.currentTime + 0.03, opts.t || 0);
    const p = { song, t0, i: 0, pass: 0, out, stopped: false, done: false, endT: Infinity, onEnd: opts.onEnd || null };
    if (!song.loopSteps) p.endT = t0 + song.total * song.spb + song.tail;
    this.players.push(p);
    if (this.offline) return p;
    this.schedule(p, c.currentTime + LOOK);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 25);
    return p;
  }
  stop(nameOrPlayer, fade = 0.4) {
    const c = this.s.ctx, now = c.currentTime;
    for (const p of this.players) {
      if (p.stopped || (p !== nameOrPlayer && p.song.name !== nameOrPlayer && nameOrPlayer !== "*")) continue;
      p.stopped = true;
      const g = p.out.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
      else {
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
      }
      g.setTargetAtTime(0, now, Math.max(0.01, fade / 4));
      p.endT = Math.min(p.endT, now + fade + LOOK + 0.1);
    }
  }
  stopAll(fade) { this.stop("*", fade); }
  // everything but `keep` (e.g. the in-game stings when leaving a game, but not the title theme)
  stopExcept(keep, fade = 0.3) {
    for (const p of this.players) if (p.song.name !== keep) this.stop(p, fade);
  }
  tick() {
    const c = this.s.ctx, now = c.currentTime;
    for (let k = this.players.length - 1; k >= 0; k--) {
      const p = this.players[k];
      if (!p.stopped && !p.done) this.schedule(p, now + LOOK);
      if (now > p.endT) {
        this.players.splice(k, 1);
        try {
          p.out.disconnect();
          if (p.ampOut) p.ampOut.disconnect();
        } catch (_) {}
        if (p.onEnd) {
          try { p.onEnd(); } catch (_) {}
        }
      }
    }
    if (!this.players.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  // The song's guitar amp: drive → waveshaper → cabinet (HP 90 Hz, LP 2.6 kHz) → the song's out.
  amp(p) {
    if (p.amp) return p.amp;
    const c = this.s.ctx;
    const inp = c.createGain();
    inp.gain.value = 1.3;
    const ws = c.createWaveShaper();
    ws.curve = this.s.curve("gtr");
    ws.oversample = "2x";
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 90;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    lp.Q.value = 0.9;
    const out = c.createGain();
    out.gain.value = 0.14;
    inp.connect(ws);
    ws.connect(hp);
    hp.connect(lp);
    lp.connect(out);
    out.connect(p.out);
    if (this.s.sendM) out.connect(this.s.sendM[0]);
    p.amp = inp;
    p.ampOut = out;
    return inp;
  }
  // OfflineAudioContext: everything is scheduled before rendering.
  offlineFlush(seconds) {
    const end = this.s.ctx.currentTime + seconds;
    for (const p of this.players) this.schedule(p, end);
  }
  schedule(p, until) {
    const S = p.song, ev = S.ev, now = this.s.ctx.currentTime;
    // fell far behind (tab was throttled): skip ahead instead of bursting stale notes
    for (let guard = 0; guard < 4096; guard++) {
      if (p.i >= ev.length) {
        if (!S.loopSteps || p.stopped) {
          p.done = true;
          return;
        }
        p.pass++;
        p.i = S.loopIdx;
        continue;
      }
      const e = ev[p.i];
      const step = e.s + (p.pass > 0 ? p.pass * S.loopSteps : 0);
      const t = p.t0 + step * S.spb;
      if (t >= until) return;
      p.i++;
      if (t < now - 0.03 || this.muted || (this.only && !this.only.has(p.song.inst[e.i] || e.i))) continue;
      this.note(p, e, t);
    }
  }
  note(p, e, t) {
    const s = this.s, spb = p.song.spb, dur = e.d * spb, v = e.v == null ? 1 : e.v, out = p.out;
    const inst = p.song.inst[e.i] || e.i;
    const f = e.m != null ? midiHz(e.m) : 0;
    switch (inst) {
      case "lead":
        s.tone({ t, f, wave: "p25", gate: dur * 0.9, a: 0.004, d: 0.12, s: 0.72, r: 0.05, vol: 0.178 * v, out, bus: "music", echo: 2, vib: dur >= 0.35 ? [5.6, 16, 0.16] : null, prio: 2 });
        s.tone({ t, f, wave: "p12", det: 10, gate: dur * 0.9, a: 0.004, d: 0.12, s: 0.72, r: 0.05, vol: 0.062 * v, out, bus: "music", prio: 2 });
        break;
      case "brassLead":
        s.tone({ t, f, wave: "brass", gate: dur * 0.92, a: 0.012, d: 0.15, s: 0.8, r: 0.07, vol: 0.185 * v, lp: 900, lp2: 3400, lpT: 0.05, q: 1.5, out, bus: "music", echo: 2, vib: dur >= 0.35 ? [5.2, 14, 0.2] : null, prio: 2 });
        s.tone({ t, f, wave: "p25", det: -8, gate: dur * 0.9, a: 0.006, d: 0.12, s: 0.7, r: 0.05, vol: 0.064 * v, out, bus: "music", prio: 2 });
        break;
      case "soft":
        s.tone({ t, f, wave: "nes", gate: dur * 0.95, a: 0.02, d: 0.3, s: 0.8, r: 0.12, vol: 0.2 * v, out, bus: "music", echo: 3, vib: dur >= 0.3 ? [4.6, 18, 0.22] : null, prio: 2 });
        s.tone({ t, f: f * 2, wave: "p12", gate: dur * 0.95, a: 0.03, d: 0.3, s: 0.6, r: 0.12, vol: 0.02 * v, out, bus: "music", prio: 2 });
        break;
      case "square":
        // punchy staccato square for the bridge
        s.tone({ t, f, wave: "p50", gate: Math.min(dur * 0.62, 0.2 + dur * 0.3), a: 0.003, d: 0.08, s: 0.6, r: 0.04, vol: 0.13 * v, out, bus: "music", echo: 2, prio: 2 });
        s.tone({ t, f: f * 2, wave: "p12", gate: Math.min(dur * 0.5, 0.15), a: 0.003, r: 0.03, vol: 0.035 * v, out, bus: "music", pan: 0.2, prio: 2 });
        break;
      case "anthem":
        // chorus lift: pulse lead doubled by a brass voice and a soft octave above
        s.tone({ t, f, wave: "p25", gate: dur * 0.92, a: 0.004, d: 0.14, s: 0.75, r: 0.06, vol: 0.15 * v, out, bus: "music", echo: 2, vib: dur >= 0.35 ? [5.4, 15, 0.16] : null, prio: 2 });
        s.tone({ t, f, wave: "brass", gate: dur * 0.92, a: 0.015, d: 0.15, s: 0.8, r: 0.07, vol: 0.085 * v, lp: 1000, lp2: 3200, lpT: 0.06, q: 1.2, out, bus: "music", pan: -0.12, prio: 2 });
        s.tone({ t, f: f * 2, wave: "p12", gate: dur * 0.85, a: 0.01, d: 0.15, s: 0.6, r: 0.05, vol: 0.03 * v, out, bus: "music", pan: 0.15, prio: 2 });
        break;
      case "gtr": {
        const amp = this.amp(p);
        const gate = e.d <= 1 ? Math.min(dur * 0.75, 0.09) : dur * 0.94;
        for (const det of [-7, 7]) s.tone({ t, f, type: "sawtooth", det, gate, a: 0.002, d: e.d <= 1 ? 0.05 : 0.25, s: 0.65, r: e.d <= 1 ? 0.02 : 0.08, vol: 0.13 * v, out: amp, bus: "music", prio: 2 });
        break;
      }
      case "tuba":
        s.tone({ t, f, wave: "brass", gate: Math.max(0.08, dur * 0.8), a: 0.012, d: 0.1, s: 0.7, r: 0.06, vol: 0.26 * v, lp: 420, lp2: 1100, lpT: 0.04, q: 0.9, out, bus: "music", prio: 2 });
        s.tone({ t, f, wave: "nes", gate: Math.max(0.08, dur * 0.8), a: 0.006, d: 0.1, s: 0.7, r: 0.05, vol: 0.12 * v, out, bus: "music", prio: 2 });
        break;
      case "horn2":
        s.tone({ t, f, wave: "brass", gate: dur * 0.9, a: 0.014, d: 0.15, s: 0.75, r: 0.07, vol: 0.1 * v, lp: 800, lp2: 2300, lpT: 0.05, q: 1.2, out, bus: "music", echo: 1, pan: -0.25, prio: 2 });
        break;
      case "harm":
        s.tone({ t, f, wave: "p12", gate: dur * 0.88, a: 0.005, d: 0.12, s: 0.7, r: 0.05, vol: 0.11 * v, out, bus: "music", echo: 1, pan: -0.3, prio: 2 });
        break;
      case "bass":
        // 4-bit triangle body + a filtered pulse an octave up so it still reads on phone speakers
        s.tone({ t, f, wave: "nes", gate: Math.max(0.05, dur * 0.82), a: 0.003, d: 0.15, s: 0.75, r: 0.03, vol: 0.18 * v, out, bus: "music", prio: 2 });
        s.tone({ t, f: f * 2, wave: "p25", gate: Math.max(0.05, dur * 0.7), a: 0.003, d: 0.08, s: 0.5, r: 0.03, vol: 0.045 * v, lp: 1100, out, bus: "music", prio: 2 });
        break;
      case "brass":
        s.tone({ t, f, wave: "brass", gate: Math.max(0.08, dur * 0.85), a: 0.01, d: 0.12, s: 0.6, r: 0.06, vol: 0.08 * v, lp: 700, lp2: 2600, lpT: 0.04, q: 1.2, out, bus: "music", echo: 1, pan: ((e.m % 3) - 1) * 0.18, prio: 2 });
        break;
      case "pad":
        s.tone({ t, f, wave: "p50", gate: dur * 0.98, a: 0.12, d: 0.4, s: 0.8, r: 0.3, vol: 0.03 * v, lp: 1200, out, bus: "music", echo: 2, prio: 2 });
        break;
      case "arp":
        s.tone({ t, f, wave: "p12", gate: Math.min(0.07, dur * 0.7), a: 0.002, r: 0.02, vol: 0.09 * v, out, bus: "music", echo: 1, pan: 0.32, prio: 1 });
        break;
      case "organ":
        // drawbar organ (wave fundamental = 16'), slow Leslie-ish vibrato
        s.tone({ t, f: f / 2, wave: "organ", gate: dur * 0.92, a: 0.008, s: 1, r: 0.05, vol: 0.24 * v, out, bus: "music", echo: 2, vib: [6.4, 9, 0.02], prio: 2 });
        break;
      case "bell":
        s.fm({ t, f, ratio: 3.5, index: 1.6, index2: 0.08, idxT: 0.3, vol: 0.08 * v, a: 0.002, dur: 0.9, out, bus: "music", echo: 2, prio: 2 });
        break;
      case "T":
        s.sample("tom", { t, rate: [0.78, 1, 1.25][e.m] || 1, vol: DRUM_VOL.T * v, out, bus: "music", pan: (e.m - 1) * -0.3, prio: 2 });
        break;
      case "P":
        s.sample("timp", { t, rate: midiHz(e.m) / 98, vol: DRUM_VOL.P * v, out, bus: "music", echo: 1, prio: 2, dur: e.d < 1 ? 0.5 : 0, fade: 0.2 });
        break;
      default: {
        const name = DRUM_SAMPLE[inst];
        if (name) s.sample(name, { t, vol: DRUM_VOL[inst] * v, out, bus: "music", echo: inst === "S" || inst === "C" ? 1 : 0, pan: DRUM_PAN[inst], prio: 2 });
      }
    }
  }
}
