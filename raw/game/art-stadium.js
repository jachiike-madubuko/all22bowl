// The stadium: sky strip (per-gym mood), light towers, upper deck, a crowd drawn in two frames
// (seated / cheering) that the renderer toggles at a stepped ~8 Hz, the front wall with ad boards,
// team benches, the turf (per-pixel hashed texture over mowed 5-yard stripes), lines, numbers,
// end zones with the team name + a pixel emblem of the team's type, the midfield logo, and the
// near-side wall with the front-row crowd seen from behind. Built once per field orientation.
// Everything is fillRect pixels / ImageData on the 1:1 sprite grid (SPEC §6.0).
import { CFG } from "./config.js";
import { ART, PX, PY, FIELD_PX_W, FIELD_PX_H, FIELD_TOP, FIELD_H_PX, ix, iy } from "./camera.js";
import { drawText, textCanvas, textWidth, rotate90 } from "./pixelfont.js";
import { makeRng, shade, hexToRgb } from "./util.js";
import { mix, lab } from "./art-kit.js";
import { REGION } from "./data.js";

const FW = CFG.FIELD_W;
const MID = FW / 2;

// ---------- layout (buffer rows) ----------
export const LAYOUT = (() => {
  const L = { SKY_H: 34, DECK_Y: 34, DECK_H: 6, CROWD_Y: 40, ROWS: 6, ROW_H: 10, WALL_Y: 100, WALL_H: 16, BENCH_Y: 116 };
  L.FIELD_Y = FIELD_TOP;
  L.FIELD_B = FIELD_TOP + FIELD_H_PX; // first row below the field
  L.BWALL_Y = L.FIELD_B + 12;
  L.BCROWD_Y = L.BWALL_Y + 14;
  L.BCROWD_H = FIELD_PX_H - L.BCROWD_Y;
  return L;
})();

// ---------- moods (one per gym) ----------
export const MOODS = {
  clear: { sky: ["#3f7fd8", "#5895e2", "#74abec", "#94c3f4"], lit: false, night: 0, weather: null, cloud: "#e8f2ff", turf: ["#3b9a41", "#348c3a", "#2c7c33", "#45a84a", "#307f36"] },
  rain: { sky: ["#3c4656", "#4a5566", "#5a6576", "#6c7888"], lit: true, night: 0.25, weather: "rain", cloud: "#2e3644", turf: ["#34874a", "#2e7b43", "#266b3a", "#3c9254", "#2a723f"] },
  night: { sky: ["#03040e", "#070a1c", "#0c1230", "#131c44"], lit: true, night: 1, weather: "lightning", stars: true, moon: true, turf: ["#2f8540", "#29783a", "#206631", "#38914c", "#246e36"] },
  petals: { sky: ["#6fb8ec", "#8ccaf2", "#b4def6", "#ffd8ea"], lit: false, night: 0, weather: "petals", cloud: "#fff4fa", turf: ["#42a848", "#3a9a41", "#308838", "#4eb554", "#348e3c"] },
  mist: { sky: ["#1e0e2c", "#2c1540", "#3e1e56", "#58306e"], lit: true, night: 0.6, weather: "mist", stars: true, turf: ["#348449", "#2e7843", "#26683a", "#3d8f53", "#2a703f"] },
  psychic: { sky: ["#3e2066", "#5a2e80", "#7c3e96", "#a8579e"], lit: true, night: 0.4, weather: "sparkle", stars: true, turf: ["#3a9545", "#33873e", "#2b7636", "#45a04f", "#2f7e3a"] },
  heat: { sky: ["#2a0806", "#4e1009", "#82200f", "#c2421a"], lit: true, night: 0.45, weather: "embers", smoke: true, turf: ["#57943b", "#4f8735", "#43772d", "#62a045", "#4a7f31"] },
  dusk: { sky: ["#2c2a46", "#544462", "#8a5c66", "#c8845e"], lit: true, night: 0.35, weather: "dust", turf: ["#46913d", "#3f8437", "#357430", "#509c47", "#3a7b33"] },
  sunset: { sky: ["#241c48", "#5c2c62", "#c0503e", "#f29a3e"], lit: true, night: 0.3, weather: "motes", sun: true, turf: ["#4e993d", "#468b37", "#3b7a2f", "#59a447", "#418333"] },
  // Johto. fx: the weather's own colors (feathers for petals, fireflies for sparkle, fog for mist, spray for motes)
  breeze: { sky: ["#4a86e0", "#64a0ea", "#88b8f2", "#b0d2f8"], lit: false, night: 0, weather: "petals", fx: ["#ffffff", "#e6defa", "#c6b6ee"], cloud: "#f4f8ff", turf: ["#3d9c43", "#368e3c", "#2e7e35", "#47aa4c", "#328138"] },
  forest: { sky: ["#141e2c", "#1e3036", "#2c4640", "#46624c"], lit: true, night: 0.5, weather: "sparkle", fx: ["#f4ff9a", "#d4f060", "#a8e048"], stars: true, turf: ["#33874a", "#2d7b43", "#256b3a", "#3b9253", "#29723f"] },
  fog: { sky: ["#100e22", "#1c1a36", "#2e2a4e", "#46406a"], lit: true, night: 0.55, weather: "mist", fx: ["#aaa2cc", "#7a7298"], stars: true, moon: true, turf: ["#348449", "#2e7843", "#26683a", "#3d8f53", "#2a703f"] },
  storm: { sky: ["#26323e", "#33424f", "#425362", "#546778"], lit: true, night: 0.3, weather: "rain", cloud: "#1e2832", turf: ["#34874a", "#2e7b43", "#266b3a", "#3c9254", "#2a723f"] },
  harbor: { sky: ["#18204a", "#30346a", "#68467a", "#c87264"], lit: true, night: 0.45, weather: "motes", fx: ["#eef6ff", "#b8d4ee"], stars: true, turf: ["#45903d", "#3e8337", "#357330", "#4f9b47", "#3a7a33"] },
  snow: { sky: ["#7c8ea8", "#90a2ba", "#a6b6cc", "#bccadc"], lit: true, night: 0.15, weather: "snow", cloud: "#dde6ee", turf: ["#4a9656", "#438a4f", "#3a7c46", "#57a462", "#3f804a"] },
  aurora: { sky: ["#03050c", "#071022", "#0b1a30", "#112640"], lit: true, night: 1, weather: "sparkle", fx: ["#ffffff", "#a8f0ff", "#8affd0"], stars: true, aurora: true, turf: ["#2f8540", "#29783a", "#206631", "#38914c", "#246e36"] },
  // Hoenn (fx as in Johto: stone dust, sea spray, sparks, ash for snow, blossoms, psychic glints, water glints)
  morning: { sky: ["#5a8cd6", "#76a2e0", "#9ebce8", "#e4d2be"], lit: false, night: 0, weather: "dust", fx: ["#d8d0c6", "#b8aea2"], cloud: "#f8f4ee", turf: ["#3d9a42", "#368c3b", "#2e7c34", "#47a84c", "#327f37"] },
  tropic: { sky: ["#1c92d6", "#36a8e2", "#66c2ee", "#a4dcf6"], lit: false, night: 0, weather: "motes", fx: ["#ffffff", "#c6eeff"], cloud: "#ffffff", turf: ["#40a446", "#38963f", "#2f8536", "#4ab250", "#338a3a"] },
  dynamo: { sky: ["#1a1838", "#2c2654", "#4a386c", "#86587a"], lit: true, night: 0.5, weather: "sparkle", fx: ["#ffffff", "#fff27a", "#ffd23f"], stars: true, turf: ["#34874a", "#2e7b43", "#266b3a", "#3c9254", "#2a723f"] },
  ash: { sky: ["#3c2e34", "#584040", "#7c5646", "#a67658"], lit: true, night: 0.35, weather: "snow", fx: ["#cfc9c3", "#a59f99", "#7d7773"], turf: ["#56903c", "#4e8336", "#42732e", "#619c46", "#497b32"] },
  meadow: { sky: ["#62a6e6", "#7eb8ec", "#a4ccee", "#d4eadc"], lit: false, night: 0, weather: "petals", fx: ["#ffffff", "#fff0a0", "#ffc4da"], cloud: "#ffffff", turf: ["#42a848", "#3a9a41", "#308838", "#4eb554", "#348e3c"] },
  canopy: { sky: ["#2a3632", "#36443e", "#44544c", "#58685e"], lit: true, night: 0.3, weather: "rain", cloud: "#222c28", turf: ["#34874a", "#2e7b43", "#266b3a", "#3c9254", "#2a723f"] },
  launch: { sky: ["#04061a", "#0a1032", "#141e4c", "#283064"], lit: true, night: 0.85, weather: "motes", fx: ["#ffb8e0", "#ffe6a0"], stars: true, moon: true, turf: ["#2f8540", "#29783a", "#206631", "#38914c", "#246e36"] },
  crater: { sky: ["#0a2240", "#103658", "#185072", "#246c8a"], lit: true, night: 0.55, weather: "sparkle", fx: ["#ffffff", "#8ee3ef", "#4fc3e8"], stars: true, turf: ["#30864a", "#2a7a44", "#22683a", "#389252", "#26703e"] },
  // Sinnoh (coal dust, leaves for petals, marsh mist, festival sparkles, sunlight motes)
  coal: { sky: ["#281c24", "#462c2a", "#744430", "#ae6c3a"], lit: true, night: 0.45, weather: "dust", fx: ["#3c3634", "#5e5652", "#4a4442", "#6e6662", "#f2b134"], turf: ["#4a8c3c", "#438036", "#38702f", "#549846", "#3e7832"] },
  grove: { sky: ["#3c86cc", "#5a9cd4", "#86b8da", "#b6d4c2"], lit: false, night: 0, weather: "petals", fx: ["#9ad85a", "#5bb04a", "#d8f08a"], cloud: "#eef6ee", turf: ["#36964a", "#308a43", "#287a3a", "#40a254", "#2c823f"] },
  canyon: { sky: ["#3876ce", "#5690d6", "#84aed8", "#d2ba9a"], lit: false, night: 0, weather: "dust", cloud: "#f4ece0", turf: ["#5a9a3e", "#528e38", "#457e30", "#64a648", "#4c8634"] },
  marsh: { sky: ["#38483a", "#4a5c48", "#607458", "#7c906a"], lit: true, night: 0.25, weather: "mist", fx: ["#a8c8a0", "#7a9a74"], turf: ["#33844c", "#2d7845", "#25683c", "#3b9056", "#297041"] },
  gala: { sky: ["#281640", "#462258", "#76386a", "#b8687a"], lit: true, night: 0.5, weather: "sparkle", fx: ["#ffffff", "#ffb8d8", "#ffd86a"], stars: true, turf: ["#3a9545", "#33873e", "#2b7636", "#45a04f", "#2f7e3a"] },
  canal: { sky: ["#121a30", "#1c2842", "#2a3854", "#3a4a66"], lit: true, night: 0.5, weather: "rain", cloud: "#10182a", turf: ["#34874a", "#2e7b43", "#266b3a", "#3c9254", "#2a723f"] },
  blizzard: { sky: ["#3c4864", "#4e5c78", "#66748e", "#808ea6"], lit: true, night: 0.35, weather: "snow", cloud: "#98a2b6", turf: ["#468f52", "#3f834b", "#367542", "#529c5d", "#3b7a46"] },
  solar: { sky: ["#2a8ce0", "#46a4ea", "#78c0f2", "#c2e4f8"], lit: false, night: 0, weather: "motes", fx: ["#fff6c0", "#ffd84a"], turf: ["#42a646", "#3a983f", "#318736", "#4cb450", "#358c3a"] },
};
const GYM_MOOD = {
  pewter: "dusk", cerulean: "rain", vermilion: "night", celadon: "petals", fuchsia: "mist", saffron: "psychic", cinnabar: "heat", viridian: "sunset",
  violet: "breeze", azalea: "forest", goldenrod: "clear", ecruteak: "fog", cianwood: "storm", olivine: "harbor", mahogany: "snow", blackthorn: "aurora",
  rustboro: "morning", dewford: "tropic", mauville: "dynamo", lavaridge: "ash", petalburg: "meadow", fortree: "canopy", mossdeep: "launch", sootopolis: "crater",
  oreburgh: "coal", eterna: "grove", veilstone: "canyon", pastoria: "marsh", hearthome: "gala", canalave: "canal", snowpoint: "blizzard", sunyshore: "solar",
};
// The stadium is the gym's: the visiting gym (or the home gym in attract mode); else a clear day.
export function moodFor(world) {
  const a = world.teams.away.data.key, h = world.teams.home.data.key;
  const key = GYM_MOOD[a] ? a : GYM_MOOD[h] ? h : null;
  const name = key ? GYM_MOOD[key] : "clear";
  return { ...MOODS[name], name, gym: key };
}

// ---------- type emblems (12×12 pixel maps: '#' main, '+' light, 'o' detail) ----------
const EMBLEMS = {
  fire: { c: { "#": "#ff6a1a", "+": "#ffd23f", o: "#fff6c8" }, m: ["......#.....", ".....##.....", ".....###....", "....####.#..", "...#####.##.", "...##+####..", "..##+++###..", ".##++++####.", ".##+++o+###.", ".##++ooo+##.", "..##+ooo+#..", "...##+++##.."] },
  water: { c: { "#": "#3a86ff", "+": "#bdeaff", o: "#ffffff" }, m: [".....##.....", ".....##.....", "....####....", "....####....", "...######...", "..##+#####..", "..#++#####..", ".##+#######.", ".##+#######.", ".##########.", "..########..", "...######..."] },
  grass: { c: { "#": "#3fae4d", "+": "#b8f59a", o: "#1f6b2c" }, m: ["..........##", "........####", "......######", ".....####+##", "....####+###", "...####+####", "..####+####.", "..###+####..", "..##+####...", "..#+###.....", ".#+.........", "#..........."] },
  electric: { c: { "#": "#ffd23f", "+": "#fff8d0", o: "#f4a81d" }, m: ["......+####.", ".....+####..", "....+####...", "...+####....", "..+#######..", "......####..", ".....####...", "....####....", "....###.....", "...###......", "...##.......", "..#........."] },
  psychic: { c: { "#": "#6a2c96", "+": "#ff8fd0", o: "#ffd6f0" }, m: ["............", "....####....", "..##++++##..", ".#++####++#.", "#++#oooo#++#", "#+#oo##oo#+#", "#+#oo##oo#+#", "#++#oooo#++#", ".#++####++#.", "..##++++##..", "....####....", "............"] },
  ice: { c: { "#": "#9ee0ff", "+": "#ffffff", o: "#4cc9f0" }, m: [".....##.....", "...#.##.#...", "....####....", ".#...##...#.", "..#..##..#..", "####+##+####", "####+##+####", "..#..##..#..", ".#...##...#.", "....####....", "...#.##.#...", ".....##....."] },
  ghost: { c: { "#": "#9b5de5", "+": "#d2bcff", o: "#1a0d2a" }, m: ["...######...", "..########..", ".##########.", ".###oo##oo#.", ".###oo##oo#.", ".##########.", ".##+####+##.", ".##########.", ".##########.", ".##########.", ".##.##.##.#.", ".#...#...#.."] },
  rock: { c: { "#": "#a8845a", "+": "#e2caa0", o: "#5e4020" }, m: ["....#####...", "..###+++##..", ".##++######.", ".#++####o##.", "##+#######o#", "##+########o", "##########o#", "#o########o#", "##o#######o.", ".##o####oo#.", "..##oooo##..", "...######..."] },
  ground: { c: { "#": "#c99a5a", "+": "#f0d8a8", o: "#7a5428" }, m: ["............", ".....##.....", "....####....", "...##++##...", "..########..", "..#oooooo#..", ".##########.", ".##++++++##.", "############", "#oooooooooo#", "############", "............"] },
  fighting: { c: { "#": "#e8352a", "+": "#8f1d1d", o: "#ffb0a0" }, m: ["............", "..##.##.##..", ".###.###.##.", ".##########.", ".#+#+#+#+##.", ".##########.", ".###########", ".###########", ".##########.", "..########..", "...######...", "...######..."] },
  flying: { c: { "#": "#d6ecff", "+": "#ffffff", o: "#7aa8d8" }, m: ["#...........", "##..........", "###.........", "####........", "#####.......", "######+.....", ".######++...", "..#######++.", "...#########", "....#######.", ".....#####..", ".......##..."] },
  bug: { c: { "#": "#8fd14f", "+": "#c8f08a", o: "#2f5a14" }, m: ["..#......#..", "...#....#...", "....####....", "...######...", "..##o##o##..", ".###o##o###.", ".##########.", ".#o##oo##o#.", ".#o##oo##o#.", "..###oo###..", "...######...", "....####...."] },
  dragon: { c: { "#": "#6a5df0", "+": "#ffd23f", o: "#ffffff" }, m: ["....####....", "...######...", "..##o#####..", "..######+#..", "...####.....", "....####....", ".....####...", "......####..", ".......###..", "..##..####..", "..########..", "...######..."] },
  poison: { c: { "#": "#4a1a68", "+": "#ecc0ff", o: "#a84fd8" }, m: ["......####..", ".....#++oo#.", ".....#+ooo#.", ".....#oooo#.", "......####..", ".####.......", "#++oo#......", "#+ooo#..##..", "#oooo#.#+o#.", "#oooo#.#oo#.", ".####...##..", "............"] },
  normal: { c: { "#": "#ffd23f", "+": "#fff8d0", o: "#f4a81d" }, m: [".....##.....", ".....##.....", "....####....", "....####....", "############", ".####++####.", "..###++###..", "...######...", "..########..", "..###..###..", ".###....###.", ".##......##."] },
  ball: { c: { "#": "#e8352a", "+": "#f6f6f2", o: "#0b0d14" }, m: ["....####....", "..########..", ".##+#######.", ".#+########.", "#+##########", "#####oo#####", "ooooo++ooooo", "+++++oo+++++", "++++++++++++", ".++++++++++.", "..++++++++..", "....++++...."] },
  steel: { c: { "#": "#9aa8b8", "+": "#e2eaf2", o: "#3a4656" }, m: [".....++.....", "...++++++...", "..++++++##..", ".++++######.", ".+++#oo####.", ".++#oooo###.", ".++#oooo###.", ".++##oo####.", ".+#########.", "..########..", "...######...", ".....##....."] },
  dark: { c: { "#": "#5c4a78", "+": "#a898c8", o: "#ffd23f" }, m: ["....####....", "..++##......", ".+##........", ".+#.......o.", "+##......ooo", "+#........o.", "+#..........", "###.........", ".##.........", ".###........", "..####......", "....####...."] },
};
export function emblemFor(team) {
  if (team.key === "mine" || team.key === "draft") return "ball";
  return EMBLEMS[team.type] ? team.type : "normal";
}
// Draws an emblem with a 1-px outline; (x, y) top-left; scale whole px.
export function drawEmblem(g, kind, x, y, s = 1, outline = "#0b0d14") {
  const e = EMBLEMS[kind] || EMBLEMS.normal;
  const m = e.m;
  // outline: every cell stamped 1 px larger, then the fills on top
  g.fillStyle = outline;
  for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) if (m[r][c] !== ".") g.fillRect(x + c * s - 1, y + r * s - 1, s + 2, s + 2);
  for (let r = 0; r < 12; r++) {
    for (let c = 0; c < 12; c++) {
      const ch = m[r][c];
      if (ch === ".") continue;
      g.fillStyle = e.c[ch];
      g.fillRect(x + c * s, y + r * s, s, s);
    }
  }
}

// ---------- helpers ----------
function mk(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}
const abgr = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
};
const hash = (x, y) => (((x * 73856093) ^ (y * 19349663) ^ (x * y * 83492791)) >>> 0);
const SKIN = ["#f1c7a0", "#d9a273", "#a8714a", "#7a4e2f", "#ffd9b8", "#c68a5c"];
const HAIR = ["#2a1a10", "#5b3a1e", "#e0b24a", "#1b1b1b", "#8f1d1d", "#d8d0c8", "#3a2a1a"];
const FANCY = ["#e8352a", "#f6f6f2", "#ffd23f", "#3a86ff", "#ff7a1a", "#9b5de5", "#5bd15b", "#4cc9f0", "#ff6fb5"];
function fillEllipse(g, cx, cy, rx, ry) {
  for (let dy = -ry; dy <= ry; dy++) {
    const t = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5));
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, t)) + 0.5);
    if (hw > 0) g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
}
// The top half of an ellipse standing on row `base` (domes, mounds): rows base - ry … base - 1.
function fillDome(g, cx, base, rx, ry) {
  for (let dy = 1; dy <= ry; dy++) {
    const t = 1 - ((dy - 0.5) * (dy - 0.5)) / (ry * ry);
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, t)) + 0.5);
    if (hw > 0) g.fillRect(cx - hw, base - dy, hw * 2 + 1, 1);
  }
}
// A 1-px line between whole-pixel points (braces, conveyors, beams).
function pxLine(g, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 4000; n++) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
// A cable sagging `sag` px between two points, one pixel per column (power lines, rope bridges, string lights).
function pxCable(g, x0, y0, x1, y1, sag) {
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / Math.max(1, x1 - x0);
    g.fillRect(x, Math.round(y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)), 1, 1);
  }
}

// ---------- the stands (top) ----------
function drawSky(g, W, mood, rng) {
  const L = LAYOUT;
  const bands = mood.sky;
  const bh = [6, 8, 9, 11]; // = SKY_H (34)
  let y = 0;
  for (let i = 0; i < bands.length; i++) {
    g.fillStyle = bands[i];
    g.fillRect(0, y, W, bh[i]);
    // dithered seam between bands (stepped, no gradients)
    if (i < bands.length - 1) {
      g.fillStyle = bands[i + 1];
      for (let x = i & 1; x < W; x += 2) g.fillRect(x, y + bh[i] - 1, 1, 1);
      for (let x = 0; x < W; x += 4) g.fillRect(x + (i & 2), y + bh[i] - 2, 1, 1);
    }
    y += bh[i];
  }
  if (mood.stars) {
    for (let i = 0; i < W / 7; i++) {
      g.fillStyle = rng.next() < 0.7 ? "#cfd8ff" : "#fff3c4";
      const sx = (rng.next() * W) | 0, sy = (rng.next() * (L.SKY_H - 12)) | 0;
      g.fillRect(sx, sy, 1, 1);
      if (rng.next() < 0.08) { g.fillRect(sx - 1, sy, 3, 1); g.fillRect(sx, sy - 1, 1, 3); }
    }
  }
  if (mood.aurora) {
    // the aurora: curtains of green streaks hanging from a wavy hem, their tops dithered away
    for (let x = 0; x < W; x++) {
      const hem = 13 + Math.round(Math.sin(x * 0.011) * 4 + Math.sin(x * 0.043 + 1) * 2);
      const h = 6 + Math.round(3 + Math.sin(x * 0.07) * 3) + ((x * 13) % 7 < 2 ? 3 : 0);
      for (let k = 0; k < h; k++) {
        const y = hem - k, t = k / h;
        if (y < 1 || (t > 0.55 && (x + y) & 1) || (t > 0.8 && x & 1)) continue;
        g.fillStyle = t < 0.2 ? "#8affd0" : t < 0.55 ? "#3ec88a" : "#24806a";
        g.fillRect(x, y, 1, 1);
      }
    }
  }
  if (mood.moon) {
    const mx = Math.round(W * 0.31);
    g.fillStyle = "#fff6d8";
    fillEllipse(g, mx, 9, 5, 5);
    g.fillStyle = mood.sky[0];
    fillEllipse(g, mx + 3, 8, 4, 4);
  }
  if (mood.sun) {
    // a low sun sinking behind the skyline, stepped rings
    const sx = Math.round(W * 0.62), sy = L.SKY_H - 4;
    g.fillStyle = "#ffb04a";
    fillEllipse(g, sx, sy, 20, 13);
    g.fillStyle = "#ffd27a";
    fillEllipse(g, sx, sy, 14, 9);
    g.fillStyle = "#fff2c0";
    fillEllipse(g, sx, sy, 8, 5);
  }
  if (mood.cloud) {
    for (let i = 0; i < W / 120; i++) {
      const cx = (rng.next() * W) | 0, cy = 4 + ((rng.next() * 10) | 0);
      const w = 16 + ((rng.next() * 18) | 0);
      g.fillStyle = mood.cloud;
      g.fillRect(cx, cy, w, 3);
      g.fillRect(cx + 4, cy - 2, w - 10, 2);
      g.fillRect(cx + 8, cy - 4, 6, 2);
      g.fillRect(cx - 4, cy + 3, w + 8, 2);
      g.fillStyle = shade(mood.cloud, -0.12);
      g.fillRect(cx - 4, cy + 4, w + 8, 1);
    }
  }
  drawSkyline(g, W, mood, makeRng(5150));
  if (mood.name === "clear") drawBlimp(g, Math.round(W * 0.42), 5);
}
// The sky lit by a lightning flash: pale bands, the same skyline as black silhouettes.
function drawFlashSky(g, W, mood) {
  const bands = ["#e8eeff", "#d2dcff", "#bccaf8", "#a6b6ee"];
  const bh = [6, 8, 9, 11];
  let y = 0;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = bands[i];
    g.fillRect(0, y, W, bh[i]);
    y += bh[i];
  }
  drawSkyline(g, W, mood, makeRng(5150));
}

// A pixel blimp with the league wordmark (clear-day stadium).
function drawBlimp(g, x, y) {
  g.fillStyle = "#0b0d14";
  fillEllipse(g, x + 22, y + 6, 23, 7);
  g.fillStyle = "#c8ccd8";
  fillEllipse(g, x + 22, y + 6, 22, 6);
  g.fillStyle = "#e8ecf4";
  fillEllipse(g, x + 20, y + 4, 17, 3);
  g.fillStyle = "#8a92a8";
  g.fillRect(x + 2, y + 9, 40, 2);
  // tail fins + gondola
  g.fillStyle = "#e8352a";
  g.fillRect(x - 2, y + 1, 4, 3);
  g.fillRect(x - 2, y + 8, 4, 3);
  g.fillStyle = "#1b2547";
  g.fillRect(x + 18, y + 13, 8, 3);
  drawText(g, "ALL-22", x + 6, y + 3, 1, "#e8352a", { tiny: true });
}

// Per-gym skyline along the bottom of the sky strip: the stadium's sense of place. The landmarks of Johto, Hoenn
// and Sinnoh stand every 760 px from LANDMARK, midway between two light towers (drawTowers: every 380 px from 150).
const LANDMARK = 340;
function drawSkyline(g, W, mood, rng) {
  const L = LAYOUT;
  const B = L.SKY_H; // skyline base
  const gym = mood.gym;
  const col = (c) => (g.fillStyle = c);
  if (gym === "pewter") {
    // Mt. Moon: two ranges of jagged peaks against the dusk
    for (const [far, c, hi] of [[1, "#5a4a66", "#7a6280"], [0, "#2e2840", "#4a3e5c"]]) {
      let h = 10;
      for (let x = 0; x < W; x++) {
        const k = Math.sin(x * (far ? 0.021 : 0.033) + far * 2) * 6 + Math.sin(x * 0.11 + far) * 2 + ((x * 7919) % 5) * 0.3;
        h = Math.round((far ? 20 : 12) + k);
        col(c);
        g.fillRect(x, B - h, 1, h);
        col(hi);
        g.fillRect(x, B - h, 1, 1);
      }
    }
  } else if (gym === "cerulean") {
    // rain-gray hills, the Nugget Bridge and a water tower
    col("#4c5868");
    for (let x = 0; x < W; x++) g.fillRect(x, B - 8 - Math.round(Math.sin(x * 0.015) * 3), 1, 12);
    for (let x0 = 60; x0 < W; x0 += 520) {
      col("#2e3644");
      g.fillRect(x0, B - 10, 160, 2);
      for (let k = 0; k <= 160; k += 40) g.fillRect(x0 + k, B - 18, 2, 18);
      for (let k = 0; k < 160; k += 4) g.fillRect(x0 + k, B - 10 - Math.round(Math.abs(Math.sin((k / 40) * Math.PI)) * 7), 1, 1);
      const tx = x0 + 260;
      g.fillRect(tx + 2, B - 12, 1, 12);
      g.fillRect(tx + 9, B - 12, 1, 12);
      fillEllipse(g, tx + 6, B - 16, 6, 4);
      col("#5a6878");
      g.fillRect(tx + 2, B - 18, 6, 1);
    }
  } else if (gym === "vermilion") {
    // the harbor at night: the S.S. Anne and dock cranes, windows lit
    for (let x0 = 40; x0 < W; x0 += 640) {
      col("#05060c");
      g.fillRect(x0, B - 8, 150, 8);
      g.fillRect(x0 + 6, B - 10, 140, 2);
      g.fillRect(x0 + 30, B - 15, 90, 5);
      g.fillRect(x0 + 45, B - 19, 60, 4);
      g.fillRect(x0 + 60, B - 26, 7, 7);
      g.fillRect(x0 + 82, B - 26, 7, 7);
      col("#e8352a");
      g.fillRect(x0 + 60, B - 26, 7, 2);
      g.fillRect(x0 + 82, B - 26, 7, 2);
      col("#ffd27a");
      for (let k = 0; k < 40; k++) if (rng.next() < 0.6) g.fillRect(x0 + 34 + k * 2, B - 13, 1, 1);
      for (let k = 0; k < 64; k++) if (rng.next() < 0.5) g.fillRect(x0 + 10 + k * 2, B - 6, 1, 1);
      // cranes
      col("#0b0e1c");
      for (const cx of [x0 + 220, x0 + 300]) {
        g.fillRect(cx, B - 24, 2, 24);
        g.fillRect(cx - 14, B - 24, 30, 2);
        for (let k = 0; k < 8; k++) g.fillRect(cx - 14 + k * 2, B - 22 + k, 1, 1);
        col("#ff4a4a");
        g.fillRect(cx, B - 26, 2, 2);
        col("#0b0e1c");
      }
    }
  } else if (gym === "celadon") {
    // the department store and round trees
    for (let x0 = 80; x0 < W; x0 += 560) {
      col("#6a86a6");
      g.fillRect(x0, B - 26, 54, 26);
      col("#7e9aba");
      g.fillRect(x0, B - 26, 54, 2);
      col("#ffd8ea");
      for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) g.fillRect(x0 + 4 + c * 6, B - 21 + r * 5, 3, 2);
      col("#3fa34d");
      g.fillRect(x0 + 10, B - 30, 34, 4);
    }
    for (let x = 0; x < W; x += 9 + ((x * 31) % 7)) {
      const r = 4 + ((x * 13) % 4);
      col("#3a8a4c");
      fillEllipse(g, x, B - r - 1, r, r);
      col("#55a865");
      g.fillRect(x - 1, B - 2 * r, 3, 1);
    }
  } else if (gym === "fuchsia") {
    // Safari Zone palms in the purple haze
    col("#24102e");
    for (let x = 0; x < W; x += 40 + ((x * 17) % 30)) {
      const h = 14 + ((x * 7) % 10);
      for (let k = 0; k < h; k++) g.fillRect(x + Math.round(Math.sin(k * 0.15) * 2), B - k, 2, 1);
      const tx = x + Math.round(Math.sin(h * 0.15) * 2), ty = B - h;
      for (let k = 0; k < 9; k++) {
        g.fillRect(tx - k, ty + Math.round(k * k * 0.08), 1, 1);
        g.fillRect(tx + 1 + k, ty + Math.round(k * k * 0.08), 1, 1);
        g.fillRect(tx - Math.round(k * 0.6), ty - 1 + Math.round(k * 0.4), 1, 1);
        g.fillRect(tx + 1 + Math.round(k * 0.6), ty - 1 + Math.round(k * 0.4), 1, 1);
      }
    }
  } else if (gym === "saffron") {
    // Saffron City: the city's tower over the skyline, windows lit
    for (let x = 0; x < W; ) {
      const w = 12 + ((x * 13) % 16), h = 10 + ((x * 29) % 14);
      col("#2a1640");
      g.fillRect(x, B - h, w, h);
      col("#ffd27a");
      for (let yy = B - h + 2; yy < B - 1; yy += 3) for (let xx = x + 2; xx < x + w - 1; xx += 3) if (rng.next() < 0.35) g.fillRect(xx, yy, 1, 1);
      x += w + 2;
    }
    for (let x0 = 300; x0 < W; x0 += 700) {
      col("#1c0e2c");
      g.fillRect(x0, 2, 31, B - 2);
      g.fillRect(x0 + 12, 0, 7, 2);
      col("#ff8fd0");
      for (let yy = 11; yy < B - 2; yy += 3) for (let xx = x0 + 3; xx < x0 + 29; xx += 4) if (rng.next() < 0.6) g.fillRect(xx, yy, 2, 1);
      col("#ffffff");
      drawText(g, "SAFFRON", x0 + 2, 4, 1, "#ffffff", { tiny: true }); // the windows start under the sign
    }
  } else if (gym === "cinnabar") {
    // the volcano: a glowing crater and lava runs
    for (let x0 = 200; x0 < W; x0 += 760) {
      for (let k = 0; k < 70; k++) {
        const h = Math.round(30 - Math.abs(k - 35) * 0.75);
        col("#2a0c08");
        g.fillRect(x0 + k, B - h, 1, h);
      }
      col("#ff6a1a");
      g.fillRect(x0 + 30, B - 30, 10, 2);
      col("#ffd23f");
      g.fillRect(x0 + 32, B - 30, 6, 1);
      col("#e8352a");
      for (let k = 0; k < 14; k++) g.fillRect(x0 + 33 + Math.round(Math.sin(k) * 2) - (k >> 1), B - 28 + k, 1, 1);
      for (let k = 0; k < 10; k++) g.fillRect(x0 + 38 + (k >> 1), B - 28 + k, 1, 1);
    }
    col("#3a120a");
    for (let x = 0; x < W; x++) g.fillRect(x, B - 3 - Math.round(Math.abs(Math.sin(x * 0.05)) * 2), 1, 5);
  } else if (gym === "viridian") {
    // Viridian Forest: a black pine line against the sunset
    col("#140c24");
    for (let x = 0; x < W; x += 5 + ((x * 11) % 5)) {
      const h = 9 + ((x * 23) % 12);
      for (let k = 0; k < h; k++) {
        const hw = Math.floor((k / h) * 4) + (k % 3 === 0 ? 1 : 0);
        g.fillRect(x - hw, B - h + k, hw * 2 + 1, 1);
      }
    }
    g.fillRect(0, B - 3, W, 3);
  } else if (gym === "violet") {
    // Violet City: the Sprout Tower (three roofs with upturned eaves, a spire) over purple roofs and round trees
    for (let x = 0; x < W; x += 9 + ((x * 17) % 8)) {
      const r = 3 + ((x * 7) % 3);
      col("#4f8a5e");
      fillEllipse(g, x, B - r, r + 1, r);
      col("#62a070");
      g.fillRect(x - 1, B - 2 * r, 2, 1);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      for (const hx of [x0 - 76, x0 - 50, x0 + 48, x0 + 74]) {
        col("#e8e0d0");
        g.fillRect(hx, B - 7, 14, 7);
        col("#8a6ac8");
        g.fillRect(hx - 1, B - 10, 16, 3);
        g.fillRect(hx + 1, B - 11, 12, 1);
        col("#5a7aa0");
        g.fillRect(hx + 3, B - 5, 3, 3);
        g.fillRect(hx + 9, B - 5, 3, 2);
      }
      for (const [ty, bw, th] of [[B - 10, 22, 10], [B - 19, 16, 9], [B - 27, 10, 8]]) {
        col("#6a4a30");
        g.fillRect(x0 - (bw >> 1), ty, bw, th);
        col("#8a6a48");
        g.fillRect(x0 - (bw >> 1), ty, 2, th);
        col("#3a2e48");
        g.fillRect(x0 - (bw >> 1) - 4, ty - 2, bw + 8, 2);
        g.fillRect(x0 - (bw >> 1) - 5, ty - 3, 2, 1);
        g.fillRect(x0 + (bw >> 1) + 3, ty - 3, 2, 1);
        col("#ffd27a");
        g.fillRect(x0 - 1, ty + 3, 2, 2);
      }
      col("#3a2e48");
      g.fillRect(x0, B - 34, 1, 7);
      g.fillRect(x0 - 1, B - 31, 3, 1);
    }
  } else if (gym === "azalea") {
    // Ilex Forest at dusk: a wall of round crowns, the Slowpoke Well's shrine with a lit doorway
    for (let x = -8; x < W + 8; x += 5 + ((x * 13) % 5)) {
      const r = 4 + ((x * 29) % 5), cy = B - 9 - ((x * 7) % 5);
      col("#14241a");
      fillEllipse(g, x, cy, r, r);
      col("#22382a");
      g.fillRect(x - 2, cy - r, 3, 1);
      g.fillRect(x - 3, cy - r + 1, 2, 1);
    }
    col("#14241a");
    g.fillRect(0, B - 9, W, 9);
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#2a1a14");
      g.fillRect(x0, B - 12, 18, 12);
      col("#4a2a1c");
      g.fillRect(x0 - 3, B - 15, 24, 3);
      g.fillRect(x0 - 1, B - 17, 20, 2);
      g.fillRect(x0 - 4, B - 16, 2, 1);
      g.fillRect(x0 + 20, B - 16, 2, 1);
      col("#ffd27a");
      g.fillRect(x0 + 7, B - 8, 4, 8);
    }
  } else if (gym === "goldenrod") {
    // Goldenrod City at noon: a dense skyline, the department store in pink and gold, the Radio Tower
    for (let x = 0; x < W; ) {
      const w = 10 + ((x * 13) % 14), h = 8 + ((x * 29) % 12);
      col((x >> 3) & 1 ? "#a8b8cc" : "#98aac2");
      g.fillRect(x, B - h, w, h);
      col("#7f93ad");
      for (let yy = B - h + 2; yy < B - 1; yy += 3) for (let xx = x + 2; xx < x + w - 1; xx += 3) g.fillRect(xx, yy, 1, 1);
      x += w + 1;
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      const sx = x0 - 84;
      col("#e6dcd0");
      g.fillRect(sx, B - 22, 46, 22);
      col("#e9a3c0");
      g.fillRect(sx, B - 22, 46, 3);
      col("#ffd84a");
      g.fillRect(sx, B - 19, 46, 1);
      col("#8aa2c0");
      for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) g.fillRect(sx + 3 + c * 6, B - 15 + r * 5, 4, 2);
      const tx = x0 + 30;
      col("#d8dee6");
      g.fillRect(tx, B - 30, 8, 30);
      g.fillRect(tx + 3, 1, 2, B - 31);
      g.fillRect(tx - 3, B - 24, 3, 3);
      col("#b8c2ce");
      g.fillRect(tx + 6, B - 30, 2, 30);
      col("#e8352a");
      for (let yy = B - 26; yy < B; yy += 8) g.fillRect(tx, yy, 8, 2);
      col("#ff4a4a");
      g.fillRect(tx + 3, 0, 2, 1);
    }
  } else if (gym === "ecruteak") {
    // Ecruteak at dusk: the nine-tiered Tin Tower with gold eaves, the charred Burned Tower, lantern-lit houses
    for (let x0 = 0; x0 < W; x0 += 34) {
      col("#120f22");
      g.fillRect(x0 + 2, B - 7, 22, 7);
      col("#1c1832");
      g.fillRect(x0, B - 10, 26, 3);
      g.fillRect(x0 - 1, B - 11, 2, 1);
      g.fillRect(x0 + 25, B - 11, 2, 1);
      col("#ffd27a");
      g.fillRect(x0 + 9, B - 5, 2, 2);
    }
    for (let x0 = LANDMARK - 40; x0 < W; x0 += 760) {
      for (let t = 0; t < 9; t++) {
        const bw = 26 - t * 2, y = B - 4 - t * 3;
        col("#1a1630");
        g.fillRect(x0 - (bw >> 1), y - 1, bw, 5);
        col("#e0c068");
        g.fillRect(x0 - (bw >> 1) - 2, y - 1, bw + 4, 1);
      }
      g.fillRect(x0, B - 34, 1, 4);
      const bx = x0 + 90;
      col("#16121c");
      g.fillRect(bx - 14, B - 10, 28, 10);
      g.fillRect(bx - 10, B - 18, 20, 8);
      for (let k = 0; k < 14; k++) g.fillRect(bx - 7 + k, B - 22 + ((k * 5) % 4), 1, 4);
      col("#3a2a2a");
      g.fillRect(bx - 16, B - 11, 32, 1);
      g.fillRect(bx - 12, B - 19, 24, 1);
      col("#ff7a3a");
      g.fillRect(bx - 3, B - 6, 2, 2);
    }
  } else if (gym === "cianwood") {
    // Cianwood's coast in a storm: the sea heaving under whitecaps, cliffs throwing up spray
    col("#1c3442");
    g.fillRect(0, B - 9, W, 9);
    for (let x = 0; x < W; x++) {
      const crest = Math.round(Math.abs(Math.sin(x * 0.09)) * 2);
      col("#2a4a5a");
      g.fillRect(x, B - 9 - crest, 1, 2);
      if (Math.sin(x * 0.09) > 0.85 || (x * 7) % 23 === 0) {
        col("#cfe4ea");
        g.fillRect(x, B - 10 - crest, 1, 1);
      }
    }
    for (let x0 = 90; x0 < W; x0 += 520) {
      for (let k = 0; k < 60; k++) {
        const h = Math.round(24 - Math.abs(k - 22) * 0.55 + ((k * 7) % 5) * 0.6);
        col("#20242c");
        g.fillRect(x0 + k, B - h, 1, h);
        col("#343a46");
        g.fillRect(x0 + k, B - h, 1, 1);
      }
      col("#e8f4f8");
      for (let k = 0; k < 8; k++) {
        g.fillRect(x0 - 4 + k * 2, B - 11 - (k & 1) - ((k * 3) % 4), 1, 2);
        g.fillRect(x0 + 52 + k * 2, B - 11 - (k & 1) - ((k * 5) % 4), 1, 2);
      }
    }
  } else if (gym === "olivine") {
    // Olivine harbor at dusk: the lighthouse throwing stepped beams across the bay, a freighter at the pier
    col("#1c2a4c");
    g.fillRect(0, B - 6, W, 6);
    col("#3a4e7a");
    for (let x = 0; x < W; x += 5) g.fillRect(x + ((x >> 2) & 1), B - 5 + ((x * 3) % 4), 2, 1);
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#fff3a8");
      for (let k = 1; k < 70; k++) {
        const spread = Math.floor(k / 10);
        for (let d = -spread; d <= spread; d++) {
          if ((k + d) & 1) continue;
          g.fillRect(x0 + 4 + k, B - 28 + d, 1, 1);
          g.fillRect(x0 - 4 - k, B - 28 + d, 1, 1);
        }
      }
      col("#e8e4dc");
      g.fillRect(x0 - 3, B - 26, 7, 26);
      g.fillRect(x0 - 4, B - 8, 9, 8);
      col("#b8b2a8");
      g.fillRect(x0 + 2, B - 26, 2, 26);
      col("#c8402a");
      g.fillRect(x0 - 3, B - 18, 7, 2);
      g.fillRect(x0 - 3, B - 12, 7, 2);
      col("#2a2a36");
      g.fillRect(x0 - 4, B - 31, 9, 2);
      g.fillRect(x0 - 2, B - 33, 5, 2);
      col("#fff3a8");
      g.fillRect(x0 - 3, B - 29, 7, 3);
      const sx = x0 + 108;
      col("#141a2e");
      g.fillRect(sx, B - 9, 70, 5);
      g.fillRect(sx + 4, B - 4, 62, 2);
      g.fillRect(sx + 48, B - 15, 14, 6);
      g.fillRect(sx + 52, B - 19, 4, 4);
      col("#ffd27a");
      for (let k = 0; k < 6; k++) g.fillRect(sx + 50 + k * 2, B - 13, 1, 1);
    }
  } else if (gym === "mahogany") {
    // Mahogany in winter: two snowcapped ranges (Mt. Mortar, the Ice Path) and pines under fresh snow
    for (const [far, c, cap] of [[1, "#7486a2", "#eef4fa"], [0, "#56667e", "#f6fafc"]]) {
      for (let x = 0; x < W; x++) {
        const k = Math.abs(((x + far * 37) % 90) - 45);
        const h = Math.round((far ? 26 : 18) - k * (far ? 0.42 : 0.3) + Math.sin(x * 0.2) * 0.8);
        if (h <= 0) continue;
        col(c);
        g.fillRect(x, B - h, 1, h);
        col(cap);
        g.fillRect(x, B - h, 1, Math.max(1, Math.round((h - (far ? 14 : 10)) * 0.6)));
      }
    }
    for (let x = 0; x < W; x += 7 + ((x * 11) % 6)) {
      const h = 7 + ((x * 23) % 6);
      col("#1e3a2e");
      for (let k = 0; k < h; k++) {
        const hw = Math.floor((k / h) * 3);
        g.fillRect(x - hw, B - h + k, hw * 2 + 1, 1);
      }
      col("#f6fafc");
      g.fillRect(x, B - h, 1, 1);
      g.fillRect(x - 1, B - h + 3, 3, 1);
    }
  } else if (gym === "blackthorn") {
    // Blackthorn under the aurora: jagged peaks, the Dragon Shrine on its crag, the town's lit windows
    for (let x = 0; x < W; x++) {
      const h = Math.round(16 + Math.sin(x * 0.031) * 6 + Math.abs(Math.sin(x * 0.13)) * 4);
      col("#070a14");
      g.fillRect(x, B - h, 1, h);
      col("#1a2640");
      g.fillRect(x, B - h, 1, 1);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      const y = B - 27;
      col("#070a14");
      for (let k = 0; k < 9; k++) g.fillRect(x0 - 10 - k, y + 8 + k, 20 + k * 2, 1);
      g.fillRect(x0 - 19, y + 17, 38, B - y - 17);
      col("#16203a");
      g.fillRect(x0 - 7, y + 2, 14, 6);
      col("#4a6a9a");
      g.fillRect(x0 - 10, y, 20, 2);
      g.fillRect(x0 - 11, y - 1, 2, 1);
      g.fillRect(x0 + 9, y - 1, 2, 1);
      g.fillRect(x0 - 1, y - 3, 2, 3);
      col("#ffd27a");
      g.fillRect(x0 - 4, y + 4, 2, 2);
      g.fillRect(x0 + 2, y + 4, 2, 2);
    }
    col("#ffd27a");
    for (let x = 3; x < W; x += 9) if ((x * 7) % 5 < 2) g.fillRect(x, B - 3 - ((x * 3) % 3), 1, 1);
  } else if (gym === "rustboro") {
    // Rustboro in the morning: gray crags in steps, a city of cut stone, the glass tower and the school's clock tower
    for (let x = 0; x < W; x++) {
      const s = (x / 13) | 0, h = 12 + ((s * 37) % 6) + Math.round(Math.sin(s * 0.9) * 3);
      col(x % 13 > 9 ? "#7e746e" : "#968a84");
      g.fillRect(x, B - h, 1, h);
      col("#b6aaa0");
      g.fillRect(x, B - h, 1, 1);
    }
    for (let x = 0; x < W; ) {
      const w = 12 + ((x * 13) % 9), h = 7 + ((x * 29) % 7);
      col("#ccbca2");
      g.fillRect(x, B - h, w, h);
      col("#ab9a82");
      for (let yy = B - h + 3; yy < B; yy += 3) g.fillRect(x, yy, w, 1);
      g.fillRect(x + w - 2, B - h, 2, h);
      col("#4a5a72");
      for (let yy = B - h + 2; yy < B - 1; yy += 3) for (let xx = x + 2; xx < x + w - 3; xx += 4) g.fillRect(xx, yy, 2, 1);
      x += w + 1;
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#56657a");
      g.fillRect(x0 - 10, B - 29, 20, 29);
      g.fillRect(x0 - 7, B - 31, 14, 2);
      g.fillRect(x0 - 4, B - 33, 8, 2);
      col("#9cc6ea");
      for (let yy = B - 27; yy < B - 1; yy += 3) g.fillRect(x0 - 8, yy, 13, 2);
      col("#36424f");
      g.fillRect(x0 + 6, B - 29, 4, 29);
      col("#ff4a4a");
      g.fillRect(x0, 0, 1, 1);
      const sx = x0 + 64;
      col("#e8dcc4");
      g.fillRect(sx, B - 11, 36, 11);
      g.fillRect(sx + 13, B - 21, 10, 10);
      col("#b4583a");
      g.fillRect(sx - 2, B - 13, 40, 2);
      g.fillRect(sx + 12, B - 23, 12, 2);
      g.fillRect(sx + 14, B - 25, 8, 2);
      g.fillRect(sx + 17, B - 27, 2, 2);
      col("#ffffff");
      fillEllipse(g, sx + 18, B - 17, 3, 3);
      col("#2a2a36");
      g.fillRect(sx + 18, B - 19, 1, 2);
      g.fillRect(sx + 18, B - 17, 2, 1);
      col("#4a5a72");
      for (const k of [0, 1, 4, 5]) g.fillRect(sx + 3 + k * 6, B - 8, 3, 3);
      col("#6a4a30");
      g.fillRect(sx + 16, B - 6, 4, 6);
    }
  } else if (gym === "dewford") {
    // Dewford Town under a tropical sun: open sea, a sand island with palms and thatched huts, the granite cave in its
    // rocky hill, a fishing boat and a few gulls
    col("#2a88cc");
    g.fillRect(0, B - 7, W, 7);
    col("#5cb6e8");
    for (let x = 0; x < W; x += 5) g.fillRect(x + ((x >> 2) & 3), B - 6 + ((x * 7) % 5), 2, 1);
    col("#ffffff");
    for (let x = 3; x < W; x += 17 + ((x * 7) % 11)) g.fillRect(x, B - 7, 2, 1);
    for (let x = 60; x < W; x += 230 + ((x * 3) % 90)) {
      const y = 6 + ((x * 7) % 9);
      for (let k = 0; k < 5; k++) g.fillRect(x + k, y + (k & 1 ? 0 : 1), 1, 1);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      for (let k = -130; k <= 130; k++) {
        const h = 3 + Math.round(2 * Math.sqrt(1 - (k / 131) * (k / 131)));
        col("#f2dea2");
        g.fillRect(x0 + k, B - 5 - h, 1, h);
        col("#ffffff");
        g.fillRect(x0 + k, B - 5, 1, 1);
      }
      for (let k = 0; k < 80; k++) {
        const h = Math.round(19 - Math.abs(k - 40) * 0.38 + Math.abs(Math.sin(k * 0.5)) * 1.5);
        col(k > 46 ? "#74695f" : "#8c8078");
        g.fillRect(x0 - 70 + k, B - 8 - h, 1, h);
        col("#b0a49a");
        g.fillRect(x0 - 70 + k, B - 8 - h, 1, 1);
      }
      col("#1c1612");
      g.fillRect(x0 - 36, B - 15, 8, 7);
      g.fillRect(x0 - 35, B - 16, 6, 1);
      for (const hx of [x0 + 34, x0 + 66]) {
        col("#efe4cc");
        g.fillRect(hx, B - 13, 9, 5);
        col("#6a4a2a");
        g.fillRect(hx + 4, B - 11, 2, 3);
        col("#d8b060");
        g.fillRect(hx - 1, B - 15, 11, 2);
        g.fillRect(hx + 1, B - 17, 7, 2);
        g.fillRect(hx + 3, B - 18, 3, 1);
        col("#b08a40");
        g.fillRect(hx - 1, B - 14, 11, 1);
      }
      for (const px of [x0 + 20, x0 + 52, x0 + 92, x0 - 104, x0 - 120]) {
        const h = 12 + ((px * 7) % 5);
        col("#8a6438");
        for (let k = 0; k < h; k++) g.fillRect(px + Math.round(Math.sin(k * 0.16) * 2), B - 9 - k, 2, 1);
        const tx = px + Math.round(Math.sin(h * 0.16) * 2), ty = B - 9 - h;
        col("#2a7a38");
        for (let k = 0; k < 8; k++) {
          g.fillRect(tx - k, ty + Math.round(k * k * 0.09), 1, 2);
          g.fillRect(tx + 1 + k, ty + Math.round(k * k * 0.09), 1, 2);
        }
        for (let k = 0; k < 5; k++) {
          g.fillRect(tx - Math.round(k * 0.7), ty - 1 - k + Math.round(k * k * 0.12), 1, 1);
          g.fillRect(tx + 1 + Math.round(k * 0.7), ty - 1 - k + Math.round(k * k * 0.12), 1, 1);
        }
        col("#4cb050");
        g.fillRect(tx - 2, ty - 1, 6, 1);
      }
      const bx = x0 + 262;
      col("#f2f2ee");
      g.fillRect(bx, B - 7, 18, 3);
      g.fillRect(bx + 2, B - 4, 14, 1);
      col("#d83a2a");
      g.fillRect(bx, B - 5, 18, 1);
      col("#e8e0d0");
      g.fillRect(bx + 4, B - 10, 6, 3);
      col("#3a3a46");
      g.fillRect(bx + 5, B - 9, 2, 1);
      g.fillRect(bx + 13, B - 16, 1, 9);
      g.fillRect(bx + 10, B - 13, 7, 1);
    }
  } else if (gym === "mauville") {
    // Mauville at dusk: lit city blocks, power pylons with sagging lines, the raised cycling road on its piers, and
    // the city under one roof: a glass arcade dome glowing over the skyline
    for (let x0 = 60; x0 < W; x0 += 190) {
      const top = B - 27;
      col("#17132e");
      for (let k = 0; k < 27; k++) {
        const hw = 1 + ((k * 5) >> 4);
        g.fillRect(x0 - hw, top + k, 1, 1);
        g.fillRect(x0 + hw, top + k, 1, 1);
        if (k > 9 && k % 6 === 4) for (let d = 1 - hw; d < hw; d++) if ((d + k) & 1) g.fillRect(x0 + d, top + k, 1, 1);
      }
      g.fillRect(x0, top - 2, 1, 2);
      g.fillRect(x0 - 8, top + 3, 17, 1);
      g.fillRect(x0 - 6, top + 8, 13, 1);
      col("#0e0b20");
      for (const s of [-8, 8]) pxCable(g, x0 + s, top + 4, x0 + 190 + s, top + 4, 6);
      col("#c8d0f0");
      for (const s of [-8, -6, 6, 8]) g.fillRect(x0 + s, top + (Math.abs(s) === 8 ? 4 : 9), 1, 1);
    }
    for (let x = 0, i = 0; x < W; i++) {
      const w = 9 + ((i * 7) % 10), h = 9 + ((i * 11) % 13);
      col("#201e3c");
      g.fillRect(x, B - h, w, h);
      col("#2c2a4e");
      g.fillRect(x, B - h, w, 1);
      col("#ffd27a");
      for (let yy = B - h + 2; yy < B - 1; yy += 3) for (let xx = x + 2; xx < x + w - 1; xx += 3) if (rng.next() < 0.38) g.fillRect(xx, yy, 1, 1);
      x += w + 1 + ((i * 5) % 3);
    }
    // the cycling road: a railed deck on piers
    col("#181630");
    for (let x = 12; x < W; x += 44) g.fillRect(x, B - 10, 3, 10);
    col("#46426e");
    g.fillRect(0, B - 12, W, 2);
    col("#77709e");
    g.fillRect(0, B - 12, W, 1);
    for (let x = 0; x < W; x += 3) g.fillRect(x, B - 14, 1, 2);
    g.fillRect(0, B - 14, W, 1);
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#120f26");
      fillDome(g, x0, B - 11, 33, 14);
      col("#ffcf5a");
      fillDome(g, x0, B - 11, 31, 13);
      col("#ffe9a0");
      fillDome(g, x0 - 6, B - 18, 13, 5);
      col("#7a5a6a");
      for (let k = -24; k <= 24; k += 8) {
        const h = Math.floor(13 * Math.sqrt(1 - (k / 31.5) * (k / 31.5)));
        g.fillRect(x0 + k, B - 11 - h, 1, h);
      }
      g.fillRect(x0 - 27, B - 17, 55, 1);
      col("#2a2648");
      g.fillRect(x0 - 38, B - 11, 76, 11);
      col("#ffd27a");
      for (let k = -34; k < 34; k += 6) g.fillRect(x0 + k, B - 8, 3, 3);
      col("#fff6c8");
      g.fillRect(x0 - 1, B - 26, 2, 2);
    }
  } else if (gym === "lavaridge") {
    // Mt. Chimney over Lavaridge: an ash-gray range, the volcano with its glowing crater, lava runs and a drifting
    // plume, the cable car's line up the slope, and the town's hot springs steaming at its foot
    for (let x = 0; x < W; x++) {
      const h = Math.round(13 + Math.sin(x * 0.017) * 4 + Math.sin(x * 0.061 + 2) * 2);
      col("#5c4644");
      g.fillRect(x, B - h, 1, h);
      col("#7a605a");
      g.fillRect(x, B - h, 1, 1);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      // the cone: steep up top, flaring at the base; the crater a notch; gullies down the lit west flank
      const cone = (a) => (a < 6 ? 27 : Math.round(31 * Math.pow(Math.max(0, 1 - a / 92), 1.55)));
      for (let k = -92; k <= 92; k++) {
        const a = Math.abs(k), h = cone(a);
        if (h <= 0) continue;
        col(k < -5 ? "#4c3634" : "#362628");
        g.fillRect(x0 + k, B - h, 1, h);
        if (k < -8 && k > -60 && (a * 5) % 11 < 2) {
          col("#3e2c2c");
          g.fillRect(x0 + k, B - h + 2, 1, Math.max(1, Math.round(h * (0.25 + ((a * 3) % 5) * 0.1))));
        }
        col(k < 0 ? "#76584e" : "#4a3836");
        g.fillRect(x0 + k, B - h, 1, a < 6 ? 1 : 2);
      }
      col("#ff6a1a");
      g.fillRect(x0 - 5, B - 27, 11, 1);
      for (let k = 0; k < 12; k++) {
        g.fillRect(x0 - 7 - k + Math.round(Math.sin(k * 0.9)), B - 26 + k + (k >> 2), 1, 1);
        g.fillRect(x0 + 7 + (k >> 1), B - 26 + k, 1, 1);
      }
      col("#ffd23f");
      g.fillRect(x0 - 3, B - 27, 6, 1);
      g.fillRect(x0 - 1, B - 28, 3, 1);
      // the plume: billows rising from the crater and drifting east, paler as they thin, a shadowed underside
      for (let k = 0; k < 9; k++) {
        const cx = x0 + 1 + k * 7 + ((k * k) >> 1), cy = Math.max(2, 5 - k), r = 3 + Math.min(5, (k + 1) >> 1);
        col(k < 3 ? "#54484a" : "#665a58");
        fillEllipse(g, cx + 1, cy + 1, r, 2);
        col(k < 3 ? "#78686a" : k < 6 ? "#8a7e7a" : "#9c928e");
        fillEllipse(g, cx, cy, r, 2);
        fillEllipse(g, cx - (r >> 1), cy - 1, r >> 1, 1);
      }
      col("#2a2024");
      pxLine(g, x0 - 150, B - 5, x0 - 48, B - 21);
      for (const k of [0, 51]) g.fillRect(x0 - 150 + k, B - 5 - Math.round(k * 0.157), 1, 5);
      col("#e8352a");
      g.fillRect(x0 - 112, B - 10, 5, 4);
      col("#f6f6f2");
      g.fillRect(x0 - 111, B - 9, 3, 1);
      col("#2a2024");
      g.fillRect(x0 - 110, B - 11, 1, 1);
      for (const hx of [x0 + 98, x0 + 124, x0 + 168]) {
        col("#c8a888");
        g.fillRect(hx, B - 7, 12, 7);
        col("#8a4a3a");
        g.fillRect(hx - 1, B - 9, 14, 2);
        col("#ffd27a");
        g.fillRect(hx + 3, B - 5, 2, 2);
        g.fillRect(hx + 8, B - 5, 2, 2);
      }
      for (const px of [x0 + 113, x0 + 150]) {
        col("#cfe8ee");
        fillEllipse(g, px, B - 2, 6, 1);
        col("#7ec6dc");
        g.fillRect(px - 4, B - 2, 9, 1);
        col("#e8e2dc");
        for (let k = 0; k < 9; k++) {
          if (k & 1) continue;
          g.fillRect(px - 3 + Math.round(Math.sin(k * 0.8) * 2), B - 5 - k, 1, 1);
          g.fillRect(px + 2 + Math.round(Math.sin(k * 0.8 + 2) * 2), B - 6 - k, 1, 1);
        }
      }
    }
  } else if (gym === "petalburg") {
    // Petalburg on a fair afternoon: the woods' round crowns behind, little houses with red and blue roofs, flower
    // beds, and the gym: a broad columned hall under a green roof with a gold crest
    for (let x = -8; x < W + 8; x += 6 + ((x * 13) % 5)) {
      const r = 5 + ((x * 29) % 4), cy = B - 10 - ((x * 7) % 4);
      col("#3e7a48");
      fillEllipse(g, x, cy, r, r - 1);
      col("#5a9a5a");
      g.fillRect(x - 2, cy - r + 2, 3, 1);
    }
    col("#3e7a48");
    g.fillRect(0, B - 10, W, 10);
    for (let x = 12; x < W; x += 40 + ((x * 11) % 14)) {
      const roof = (x >> 3) & 1 ? "#d84a3a" : "#3a7ad8";
      col("#f4efe2");
      g.fillRect(x, B - 8, 14, 8);
      col(roof);
      g.fillRect(x - 1, B - 11, 16, 3);
      g.fillRect(x + 1, B - 12, 12, 1);
      col(shade(roof, -0.3));
      g.fillRect(x - 1, B - 9, 16, 1);
      col("#5a7aa0");
      g.fillRect(x + 2, B - 6, 3, 2);
      g.fillRect(x + 9, B - 6, 3, 2);
      col("#8a5a3a");
      g.fillRect(x + 6, B - 5, 2, 5);
    }
    for (let x = 0; x < W; x += 2) {
      col((x * 7) % 3 ? "#ff8fbf" : "#ffe46a");
      if ((x * 13) % 7 < 4) g.fillRect(x, B - 1 - ((x >> 1) & 1), 1, 1);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#efe6d0");
      g.fillRect(x0 - 28, B - 14, 56, 14);
      col("#3a6a3e");
      g.fillRect(x0 - 31, B - 17, 62, 3);
      g.fillRect(x0 - 27, B - 19, 54, 2);
      g.fillRect(x0 - 21, B - 21, 42, 2);
      col("#2a4e2e");
      g.fillRect(x0 - 31, B - 15, 62, 1);
      col("#d4c8ae");
      for (let k = -24; k <= 24; k += 8) if (k) g.fillRect(x0 + k, B - 13, 2, 13);
      col("#6a4a30");
      g.fillRect(x0 - 3, B - 9, 6, 9);
      col("#ffd23f");
      g.fillRect(x0 - 4, B - 20, 9, 1);
      g.fillRect(x0, B - 22, 1, 4);
      g.fillRect(x0 - 5, B - 19, 3, 1);
      g.fillRect(x0 + 3, B - 19, 3, 1);
    }
  } else if (gym === "fortree") {
    // Fortree in the rain: tall trunks under a dark canopy, treehouses on their platforms with lit windows, rope
    // bridges strung between them; the gym's big lodge on the stoutest tree
    // misty trees far back, then the undergrowth
    for (let x = 6; x < W; x += 27 + ((x * 11) % 13)) {
      col("#3e4e46");
      g.fillRect(x, 12, 2, B - 12);
      col("#40564a");
      fillEllipse(g, x + 1, 11, 9 + ((x * 3) % 4), 4);
    }
    col("#1a2620");
    g.fillRect(0, B - 4, W, 4);
    col("#24342a");
    for (let x = 0; x < W; x += 3) g.fillRect(x, B - 5 - ((x * 7) % 3 === 0 ? 1 : 0), 2, 1);
    // trees every 52–81 px, leaving a clearing at each landmark for the gym's lodge
    const trees = [];
    for (let x = 14; x < W; x += 52 + ((x * 7) % 30)) {
      const d = (((x - LANDMARK) % 760) + 760) % 760;
      if (d > 40 && d < 720) trees.push(x);
    }
    for (const x of trees) {
      col("#3a2a1e");
      g.fillRect(x, 6, 5, B - 6);
      col("#54402c");
      g.fillRect(x, 6, 1, B - 6);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#3a2a1e");
      g.fillRect(x0 - 4, 6, 9, B - 6);
      col("#54402c");
      g.fillRect(x0 - 4, 6, 2, B - 6);
    }
    const houses = [];
    trees.forEach((x, i) => {
      if (i % 2) return;
      const y = B - 15 - ((x * 3) % 6);
      houses.push([x + 2, y]);
      col("#6a5038");
      g.fillRect(x - 6, y, 17, 1);
      col("#8a6a48");
      g.fillRect(x - 3, y - 6, 11, 6);
      col("#5a3a26");
      g.fillRect(x - 5, y - 8, 15, 2);
      g.fillRect(x - 3, y - 9, 11, 1);
      col("#ffd27a");
      g.fillRect(x + 4, y - 4, 2, 2);
    });
    // rope bridges: a plank walk and its hand rope, hung between neighboring houses
    for (let i = 1; i < houses.length; i++) {
      const [ax, ay] = houses[i - 1], [bx, by] = houses[i];
      if (bx - ax > 150) continue;
      col("#8a7050");
      pxCable(g, ax + 9, ay, bx - 7, by, 4);
      col("#a89068");
      pxCable(g, ax + 9, ay - 3, bx - 7, by - 3, 3);
      for (let x = ax + 13; x < bx - 8; x += 5) {
        const t = (x - ax - 9) / Math.max(1, bx - ax - 16);
        const y0 = Math.round(ay - 3 + (by - ay) * t + 12 * t * (1 - t)), y1 = Math.round(ay + (by - ay) * t + 16 * t * (1 - t));
        if (y1 > y0) g.fillRect(x, y0 + 1, 1, y1 - y0 - 1);
      }
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      const y = B - 13;
      col("#6a5038");
      g.fillRect(x0 - 16, y, 33, 2);
      col("#9a7a52");
      g.fillRect(x0 - 12, y - 9, 25, 9);
      col("#5a3a26");
      g.fillRect(x0 - 15, y - 12, 31, 3);
      g.fillRect(x0 - 11, y - 14, 23, 2);
      col("#ffd27a");
      g.fillRect(x0 - 8, y - 6, 3, 3);
      g.fillRect(x0 + 6, y - 6, 3, 3);
      col("#4a3420");
      g.fillRect(x0 - 1, y - 6, 3, 6);
      col("#4fa3d1");
      for (let k = -13; k <= 13; k += 4) g.fillRect(x0 + k, y - 9, 2, 2 + (k & 2 ? 1 : 0));
    }
    // the canopy: each crown three clumps of leaves, lit along their tops
    const crowns = trees.slice();
    for (let x0 = LANDMARK; x0 < W; x0 += 760) crowns.push(x0);
    for (const x of crowns) {
      col("#18301f");
      fillEllipse(g, x + 2, 4, 15, 5);
      fillEllipse(g, x - 9, 8, 9, 4);
      fillEllipse(g, x + 13, 7, 9, 4);
      col("#24402a");
      g.fillRect(x - 6, 0, 13, 1);
      g.fillRect(x - 14, 5, 8, 1);
      g.fillRect(x + 9, 4, 8, 1);
      col("#335a3a");
      for (const [dx, dy] of [[-4, 2], [3, 1], [-12, 6], [11, 5], [16, 7], [-1, 4]]) g.fillRect(x + dx, dy, 2, 1);
    }
  } else if (gym === "mossdeep") {
    // Mossdeep at night: the dark sea, white houses along the island's shore, and the space center: a rocket on its
    // red launch tower beside the observatory dome and a radar dish
    col("#0c1636");
    g.fillRect(0, B - 6, W, 6);
    col("#33447e");
    for (let x = 0; x < W; x += 5) g.fillRect(x + ((x >> 2) & 1), B - 5 + ((x * 3) % 4), 2, 1);
    col("#141c34");
    g.fillRect(0, B - 9, W, 3);
    for (let x = 6; x < W; x += 26 + ((x * 13) % 18)) {
      col("#d6dee8");
      g.fillRect(x, B - 13, 9, 5);
      col("#6a7a98");
      g.fillRect(x - 1, B - 14, 11, 1);
      g.fillRect(x + 8, B - 13, 1, 5);
      col("#ffd27a");
      g.fillRect(x + 2, B - 11, 2, 2);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#3a4458");
      g.fillRect(x0 - 12, B - 9, 30, 2);
      col("#a8342a");
      g.fillRect(x0 + 8, 3, 1, B - 12);
      g.fillRect(x0 + 13, 3, 1, B - 12);
      for (let y = 4; y < B - 9; y += 4) {
        g.fillRect(x0 + 8, y, 6, 1);
        for (let k = 1; k < 4; k++) g.fillRect(x0 + 8 + k, y + k, 1, 1);
      }
      g.fillRect(x0 + 4, 10, 4, 1);
      g.fillRect(x0 + 4, 18, 4, 1);
      col("#ff4a4a");
      g.fillRect(x0 + 10, 1, 2, 2);
      col("#eef2f8");
      g.fillRect(x0 - 3, 7, 7, B - 16);
      g.fillRect(x0 - 2, 5, 5, 2);
      g.fillRect(x0 - 1, 3, 3, 2);
      g.fillRect(x0, 2, 1, 1);
      col("#b4bece");
      g.fillRect(x0 + 2, 7, 2, B - 16);
      g.fillRect(x0 + 1, 4, 1, 3);
      col("#d83a2a");
      g.fillRect(x0 - 3, 12, 7, 1);
      g.fillRect(x0 - 3, B - 15, 7, 2);
      g.fillRect(x0 - 5, B - 14, 2, 5);
      g.fillRect(x0 + 4, B - 14, 2, 5);
      // the observatory: a dome on a drum, its slit open to the stars
      col("#aab4c6");
      g.fillRect(x0 - 62, B - 13, 25, 4);
      col("#d6dde8");
      fillDome(g, x0 - 50, B - 13, 10, 7);
      col("#aab4c6");
      fillDome(g, x0 - 46, B - 13, 5, 5);
      col("#d6dde8");
      fillDome(g, x0 - 47, B - 13, 4, 4);
      col("#141c34");
      g.fillRect(x0 - 52, B - 19, 2, 6);
      col("#ffd27a");
      g.fillRect(x0 - 58, B - 12, 2, 2);
      g.fillRect(x0 - 42, B - 12, 2, 2);
      // the radar dish on its tripod, the feed at its center
      col("#8e98aa");
      g.fillRect(x0 + 44, B - 15, 1, 6);
      pxLine(g, x0 + 44, B - 13, x0 + 41, B - 10);
      pxLine(g, x0 + 44, B - 13, x0 + 47, B - 10);
      fillEllipse(g, x0 + 44, B - 19, 5, 4);
      col("#dfe5ee");
      fillEllipse(g, x0 + 44, B - 19, 4, 3);
      col("#aab4c6");
      g.fillRect(x0 + 45, B - 18, 3, 2);
      col("#ff4a4a");
      g.fillRect(x0 + 44, B - 19, 1, 1);
    }
  } else if (gym === "sootopolis") {
    // Sootopolis inside its crater: sheer walls lit along the rim, white houses cut in terraces, the lake below with
    // the gym's white hall on its islet, and the cave mouth in the wall
    const wall = (x) => Math.round(23 + Math.sin(x * 0.008) * 4 + Math.sin(x * 0.037 + 1) * 2 + (((x >> 2) * 7) % 5 === 0 ? 1 : 0));
    for (let x = 0; x < W; x++) {
      const h = wall(x);
      col("#1c2e40");
      g.fillRect(x, B - h, 1, h);
      // striations down the rock, and the rim catching the last light
      if ((x * 13) % 9 === 0) {
        col("#243a4e");
        g.fillRect(x, B - h + 2, 1, Math.max(1, h - 8 - ((x * 7) % 6)));
      }
      col("#4a6a80");
      g.fillRect(x, B - h, 1, 1);
      col("#2e485c");
      g.fillRect(x, B - h + 1, 1, 1);
    }
    for (const [ty, step, off] of [[B - 9, 21, 0], [B - 15, 27, 9], [B - 21, 33, 17]]) {
      col("#16263a");
      for (let x = 0; x < W; x++) if (wall(x) > B - ty + 3) g.fillRect(x, ty + 4, 1, 1);
      for (let x = off; x < W; x += step + ((x * 7) % 9)) {
        if (wall(x) < B - ty + 6 || wall(x + 7) < B - ty + 6) continue;
        col("#eef2f6");
        g.fillRect(x, ty, 7, 4);
        col("#c4d2dc");
        g.fillRect(x + 6, ty, 1, 4);
        g.fillRect(x, ty, 7, 1);
        col("#1a2a3a");
        g.fillRect(x + 1, ty + 2, 2, 2);
        col("#ffd27a");
        g.fillRect(x + 4, ty + 1, 1, 1);
      }
    }
    col("#185472");
    g.fillRect(0, B - 4, W, 4);
    col("#4aa8c8");
    for (let x = 0; x < W; x += 6) g.fillRect(x + ((x >> 3) & 3), B - 3 + ((x * 5) % 3), 2, 1);
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#a8b8c4");
      g.fillRect(x0 - 17, B - 5, 34, 2);
      col("#f2f6f8");
      g.fillRect(x0 - 12, B - 12, 24, 7);
      col("#2a6fdb");
      fillDome(g, x0, B - 12, 8, 6);
      col("#8ec8f0");
      g.fillRect(x0 - 3, B - 17, 2, 2);
      col("#5a8ab0");
      for (let k = -9; k <= 9; k += 6) g.fillRect(x0 + k, B - 10, 2, 3);
      col("#081420");
      g.fillRect(x0 + 104, B - 13, 12, 9);
      g.fillRect(x0 + 106, B - 15, 8, 2);
      g.fillRect(x0 + 108, B - 16, 4, 1);
    }
  } else if (gym === "oreburgh") {
    // Oreburgh's coal mine at dusk: smoggy hills, black coal heaps, brick blocks with lit windows, the pit's stepped
    // benches, the headframe's wheel over a conveyor, and two stacks smoking
    for (let x = 0; x < W; x++) {
      const h = Math.round(12 + Math.sin(x * 0.013) * 4 + Math.sin(x * 0.047 + 1) * 2);
      col("#3c2a28");
      g.fillRect(x, B - h, 1, h);
      col("#563c34");
      g.fillRect(x, B - h, 1, 1);
    }
    for (let x = 0, i = 0; x < W; i++) {
      const w = 11 + ((i * 7) % 9), h = 6 + ((i * 5) % 7);
      col("#5e3226");
      g.fillRect(x, B - h, w, h);
      col("#4a261c");
      for (let yy = B - h + 2; yy < B; yy += 2) g.fillRect(x + ((yy >> 1) & 1) * 2, yy, w - 2, 1);
      col("#ffd27a");
      for (let yy = B - h + 2; yy < B - 1; yy += 3) for (let xx = x + 2; xx < x + w - 2; xx += 4) if (rng.next() < 0.45) g.fillRect(xx, yy, 2, 1);
      x += w + 3 + ((i * 11) % 30);
    }
    for (let x = 30, i = 0; x < W; x += 90 + ((i * 37) % 60), i++) {
      const r = 10 + ((i * 7) % 6);
      col("#141012");
      fillDome(g, x, B, r, Math.round(r * 0.6));
      col("#2e2828");
      for (let k = 1; k < r * 0.6; k++) g.fillRect(x - Math.round(r * Math.sqrt(1 - (k / (r * 0.6)) ** 2)) + 1, B - k, 2, 1);
      col("#f2b134");
      g.fillRect(x - 2, B - 3, 1, 1);
      g.fillRect(x + 3, B - 5, 1, 1);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      // the pit: a hill cut into stepped benches
      for (let k = 0; k < 90; k++) {
        const h = Math.round(17 - Math.abs(k - 45) * 0.36);
        for (let y = B - h; y < B; y++) {
          col(((B - y) % 4 === 3) ? "#7a5c44" : ((B - y) >> 2) & 1 ? "#4a3628" : "#5a4434");
          g.fillRect(x0 + 92 + k, y, 1, 1);
        }
      }
      // the stacks and their smoke
      for (const sx of [x0 - 76, x0 - 62]) {
        col("#6e3424");
        g.fillRect(sx, B - 26, 4, 26);
        col("#8a4a34");
        g.fillRect(sx, B - 26, 1, 26);
        col("#e8e0d8");
        g.fillRect(sx, B - 23, 4, 1);
        col("#5a5050");
        fillEllipse(g, sx + 4, B - 29, 3, 2);
        fillEllipse(g, sx + 11, B - 31, 4, 2);
        col("#463e3e");
        fillEllipse(g, sx + 20, B - 32, 5, 2);
      }
      // the conveyor down to its heap
      col("#141012");
      fillDome(g, x0 + 64, B, 12, 7);
      col("#2a2220");
      pxLine(g, x0 + 6, B - 19, x0 + 60, B - 7);
      pxLine(g, x0 + 6, B - 18, x0 + 60, B - 6);
      for (const k of [18, 36]) g.fillRect(x0 + 6 + k, B - 19 + Math.round((k * 12) / 54), 1, 19 - Math.round((k * 12) / 54));
      col("#f2b134");
      g.fillRect(x0 + 62, B - 6, 1, 1);
      // the headframe: two legs leaning together, braces, the winding wheel on top
      col("#2a2220");
      for (let k = 0; k < 24; k++) {
        const d = 9 - Math.round((k * 7) / 24);
        g.fillRect(x0 - d - 1, B - 1 - k, 2, 1);
        g.fillRect(x0 + d, B - 1 - k, 2, 1);
        if (k === 8 || k === 16) g.fillRect(x0 - d, B - 1 - k, d * 2 + 1, 1);
      }
      pxLine(g, x0 - 8, B - 9, x0 + 6, B - 17);
      for (let dy = -5; dy <= 5; dy++) {
        for (let dx = -5; dx <= 5; dx++) {
          const d = Math.hypot(dx, dy);
          if ((d > 4.2 && d <= 5.4) || (d <= 4.2 && (dx === 0 || dy === 0 || dx === dy || dx === -dy))) g.fillRect(x0 + dx, B - 29 + dy, 1, 1);
        }
      }
      col("#e2a23a");
      g.fillRect(x0, B - 29, 1, 1);
    }
  } else if (gym === "eterna") {
    // Eterna by its old forest: tall pines in two layers, timber houses with lit windows, and the gym's greenhouse
    // with its arched glass roof and blooms inside
    for (const [far, c, hi] of [[1, "#2e5e44", "#3e7656"], [0, "#1e4a32", "#2e6242"]]) {
      for (let x = far * 4, i = 0; x < W; x += (far ? 9 : 7) + ((i * 5) % 5), i++) {
        const h = (far ? 20 : 13) + ((i * 7) % (far ? 9 : 8));
        col(c);
        for (let k = 0; k < h; k++) {
          const hw = Math.floor((k / h) * (far ? 4 : 5)) + (k % 4 === 3 ? 1 : 0);
          g.fillRect(x - hw, B - h + k, hw * 2 + 1, 1);
        }
        col(hi);
        g.fillRect(x, B - h, 1, 2);
        g.fillRect(x - 1, B - h + 4, 1, 1);
      }
    }
    for (let x = 30, i = 0; x < W; x += 64 + ((i * 29) % 40), i++) {
      col("#8a5e3a");
      g.fillRect(x, B - 8, 13, 8);
      col("#6a4628");
      g.fillRect(x + 4, B - 8, 1, 8);
      g.fillRect(x + 8, B - 8, 1, 8);
      col("#5a3a22");
      g.fillRect(x - 1, B - 10, 15, 2);
      g.fillRect(x + 1, B - 11, 11, 1);
      col("#ffd27a");
      g.fillRect(x + 1, B - 6, 2, 2);
      g.fillRect(x + 10, B - 6, 2, 2);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#d8d0c0");
      g.fillRect(x0 - 24, B - 4, 49, 4);
      col("#f4f8f8");
      fillDome(g, x0, B - 4, 23, 14);
      col("#bfe2ea");
      fillDome(g, x0, B - 4, 21, 13);
      col("#3a9a4a");
      for (let k = -18; k <= 18; k += 3) g.fillRect(x0 + k, B - 7 - ((k * 7) & 3), 2, 3 + ((k * 7) & 3));
      col("#f5a3c7");
      for (const k of [-14, -5, 7, 15]) g.fillRect(x0 + k, B - 9 - (k & 1), 2, 2);
      col("#f4f8f8");
      for (let k = -14; k <= 14; k += 7) {
        const h = Math.floor(13 * Math.sqrt(1 - (k / 21.5) * (k / 21.5)));
        g.fillRect(x0 + k, B - 4 - h, 1, h);
      }
      g.fillRect(x0 - 17, B - 11, 35, 1);
      col("#e6f6fa");
      g.fillRect(x0 - 9, B - 15, 6, 1);
      g.fillRect(x0 - 12, B - 13, 3, 1);
    }
  } else if (gym === "veilstone") {
    // Veilstone, cut into the rock: red mesas ringing the city, tan blocks carved into the stone, the department
    // store's tall facade, and the meteorites resting on their hill
    for (let x = 0; x < W; x++) {
      const s = (x / 17) | 0, h = 17 + ((s * 29) % 8) + Math.round(Math.sin(s * 0.7) * 2);
      col(x % 17 > 13 ? "#7c3e28" : "#9a5434");
      g.fillRect(x, B - h, 1, h);
      if ((x * 7) % 23 === 0) {
        col("#6e3422");
        g.fillRect(x, B - h + 2, 1, h - 7);
      }
      col("#c8784c");
      g.fillRect(x, B - h, 1, 1);
    }
    for (let x = 0, i = 0; x < W; i++) {
      const w = 10 + ((i * 7) % 10), h = 7 + ((i * 5) % 8);
      col("#d0b48e");
      g.fillRect(x, B - h, w, h);
      col("#b09070");
      g.fillRect(x + w - 2, B - h, 2, h);
      col("#e4ccaa");
      g.fillRect(x, B - h, w - 2, 1);
      col("#5a6a86");
      for (let yy = B - h + 2; yy < B - 1; yy += 3) for (let xx = x + 2; xx < x + w - 3; xx += 4) g.fillRect(xx, yy, 2, 2);
      x += w + 2 + ((i * 13) % 9);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#e8dcc8");
      g.fillRect(x0 - 32, B - 29, 26, 29);
      col("#c4b498");
      g.fillRect(x0 - 10, B - 29, 4, 29);
      col("#d83a2a");
      g.fillRect(x0 - 32, B - 26, 26, 2);
      col("#5a7aa0");
      for (let yy = B - 22; yy < B - 2; yy += 4) for (let xx = x0 - 29; xx < x0 - 10; xx += 4) g.fillRect(xx, yy, 2, 2);
      col("#4a4a56");
      g.fillRect(x0 - 23, B - 5, 6, 5);
      col("#a07a52");
      fillDome(g, x0 + 66, B, 34, 8);
      for (const [dx, r] of [[-16, 5], [-3, 7], [12, 5], [22, 4]]) {
        col("#463c36");
        fillEllipse(g, x0 + 66 + dx, B - 8 - r + 2, r, r - 1);
        col("#6c6058");
        g.fillRect(x0 + 66 + dx - r + 2, B - 8 - 2 * r + 4, r, 1);
        g.fillRect(x0 + 66 + dx - r + 1, B - 8 - 2 * r + 5, 2, 1);
      }
    }
  } else if (gym === "pastoria") {
    // the Great Marsh by Pastoria: hazy crowns, still pools under reed beds and cattails, the observation tower, and the
    // gym under its blue roof
    for (let x = -8, i = 0; x < W + 8; x += 6 + ((i * 3) % 5), i++) {
      const r = 4 + ((i * 7) % 4), cy = B - 9 - ((i * 5) % 4);
      col("#4e6450");
      fillEllipse(g, x, cy, r, r - 1);
      col("#5c7460");
      g.fillRect(x - 1, cy - r + 2, 2, 1);
    }
    col("#4e6450");
    g.fillRect(0, B - 9, W, 9);
    col("#3a5a5c");
    g.fillRect(0, B - 4, W, 4);
    col("#86a8a2");
    for (let x = 0; x < W; x += 7) g.fillRect(x + ((x >> 3) & 3), B - 3 + ((x * 5) % 3), 3, 1);
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      // the observation tower: braced legs, a roofed deck up top
      col("#5a4632");
      for (let k = 0; k < 22; k++) {
        const d = 6 - Math.round((k * 3) / 22);
        g.fillRect(x0 - d, B - 1 - k, 1, 1);
        g.fillRect(x0 + d, B - 1 - k, 1, 1);
      }
      for (const k of [6, 13]) {
        const d = 6 - Math.round((k * 3) / 22);
        pxLine(g, x0 - d, B - 1 - k, x0 + d, B - 8 - k);
      }
      col("#7a6044");
      g.fillRect(x0 - 8, B - 23, 17, 2);
      col("#8a6a48");
      for (let k = -7; k <= 7; k += 2) g.fillRect(x0 + k, B - 26, 1, 3);
      g.fillRect(x0 - 8, B - 27, 17, 1);
      col("#8a3a2a");
      g.fillRect(x0 - 9, B - 30, 19, 2);
      g.fillRect(x0 - 6, B - 32, 13, 2);
      // the gym: a long hall with a blue roof
      const hx = x0 + 52;
      col("#e6e0d0");
      g.fillRect(hx, B - 10, 42, 7);
      col("#2a6aa8");
      g.fillRect(hx - 3, B - 13, 48, 3);
      g.fillRect(hx + 1, B - 15, 40, 2);
      col("#5a96d0");
      g.fillRect(hx + 1, B - 15, 40, 1);
      col("#46566a");
      for (let k = 4; k < 40; k += 7) g.fillRect(hx + k, B - 8, 3, 3);
    }
    // reed beds in clumps, open water between them with lily pads
    for (let c = 0, x0 = 4; x0 < W; c++) {
      const n = 4 + ((c * 5) % 6);
      for (let k = 0; k < n; k++) {
        const x = x0 + k * 2 + ((k * 7) % 3 === 0 ? 1 : 0), h = 4 + ((c * 3 + k * 5) % 7);
        col(k & 1 ? "#58763c" : "#6e9048");
        g.fillRect(x, B - h, 1, h);
        if ((k * 3 + c) % 4 === 0) {
          col("#6a4428");
          g.fillRect(x, B - h - 2, 1, 2);
        }
      }
      col("#5e8a46");
      g.fillRect(x0 + n * 2 + 4, B - 2, 3, 1);
      x0 += n * 2 + 10 + ((c * 11) % 14);
    }
  } else if (gym === "hearthome") {
    // Hearthome's festival night: rooftops strung with lights, the bell tower's spire, and the contest hall's great
    // dome lit in pink and gold
    const tops = [];
    for (let x = 0, i = 0; x < W; i++) {
      const w = 12 + ((i * 7) % 10), h = 9 + ((i * 5) % 9);
      col("#2c1a3c");
      g.fillRect(x, B - h, w, h);
      col("#3c2650");
      g.fillRect(x, B - h, w, 1);
      col("#ffd27a");
      for (let yy = B - h + 2; yy < B - 1; yy += 3) for (let xx = x + 2; xx < x + w - 2; xx += 3) if (rng.next() < 0.4) g.fillRect(xx, yy, 1, 1);
      tops.push([x + (w >> 1), B - h]);
      x += w + 2;
    }
    const bulbs = ["#ff8fc8", "#ffd23f", "#ffffff", "#8affd0"];
    for (let i = 1; i < tops.length; i++) {
      const [ax, ay] = tops[i - 1], [bx, by] = tops[i];
      col("#5a4468");
      pxCable(g, ax, ay - 1, bx, by - 1, 3);
      for (let x = ax + 2, n = 0; x < bx - 1; x += 3, n++) {
        const t = (x - ax) / Math.max(1, bx - ax);
        col(bulbs[(n + i) % 4]);
        g.fillRect(x, Math.round(ay - 1 + (by - ay) * t + 12 * t * (1 - t)) + 1, 1, 1);
      }
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      // spotlights sweeping up from the hall: stepped, dithered beams
      col("#fff3c8");
      for (let k = 2; k < 26; k++) {
        const spread = k >> 3;
        for (let d = -spread; d <= spread; d++) {
          if ((k + d) & 1) continue;
          g.fillRect(x0 - 20 - k + d, B - 12 - k, 1, 1);
          g.fillRect(x0 + 20 + k + d, B - 12 - k, 1, 1);
        }
      }
      col("#3a2448");
      g.fillRect(x0 - 32, B - 11, 64, 11);
      col("#ffd27a");
      for (let k = -26; k <= 22; k += 8) {
        g.fillRect(x0 + k, B - 7, 4, 7);
        g.fillRect(x0 + k + 1, B - 8, 2, 1);
      }
      col("#c86a9a");
      fillDome(g, x0, B - 11, 27, 14);
      col("#f2e2ee");
      fillDome(g, x0, B - 11, 25, 13);
      col("#ff8fc0");
      g.fillRect(x0 - 24, B - 14, 49, 2);
      g.fillRect(x0 - 17, B - 20, 35, 1);
      col("#ffd23f");
      g.fillRect(x0 - 1, B - 26, 3, 2);
      g.fillRect(x0, B - 28, 1, 2);
      col("#ffffff");
      g.fillRect(x0 - 12, B - 22, 5, 1);
      g.fillRect(x0 - 15, B - 20, 2, 1);
      // the bell tower
      const tx = x0 - 72;
      col("#4a3058");
      g.fillRect(tx, B - 20, 9, 20);
      col("#5a3c6a");
      g.fillRect(tx, B - 20, 2, 20);
      for (let k = 0; k < 10; k++) {
        col("#4a3058");
        g.fillRect(tx + (k >> 1), B - 21 - k, 9 - (k >> 1) * 2, 1);
      }
      col("#ffd27a");
      fillEllipse(g, tx + 4, B - 15, 2, 2);
      g.fillRect(tx + 4, B - 32, 1, 2);
    }
  } else if (gym === "canalave") {
    // Canalave on a rainy evening: lamplit houses along the quay, the canal under its raised drawbridge, the library's
    // columned facade, and a freighter at the dock
    for (let x = 0, i = 0; x < W; i++) {
      const w = 11 + ((i * 7) % 9), h = 8 + ((i * 5) % 8);
      col("#262c3c");
      g.fillRect(x, B - h, w, h);
      col("#323a4e");
      g.fillRect(x - 1, B - h - 1, w + 2, 2);
      col("#ffd27a");
      for (let yy = B - h + 2; yy < B - 4; yy += 3) for (let xx = x + 2; xx < x + w - 2; xx += 4) if (rng.next() < 0.5) g.fillRect(xx, yy, 2, 2);
      x += w + 1 + ((i * 3) % 4);
    }
    col("#141c2e");
    g.fillRect(0, B - 4, W, 4);
    col("#2a3650");
    g.fillRect(0, B - 5, W, 1);
    for (let x = 18; x < W; x += 41) {
      col("#14182a");
      g.fillRect(x, B - 11, 1, 6);
      col("#ffe9a0");
      g.fillRect(x - 1, B - 12, 3, 1);
      col("#c8a050");
      for (let k = 0; k < 4; k++) if (k !== 1) g.fillRect(x - (k & 1), B - 4 + k, 2 - (k & 1), 1);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#141c2e");
      g.fillRect(x0 - 24, B - 9, 48, 9);
      // the drawbridge: two leaves raised over the canal
      for (const s of [-1, 1]) {
        col("#5a5e6e");
        g.fillRect(x0 + s * 16 - 4, B - 9, 9, 9);
        col("#3a3e4c");
        for (let k = 0; k < 14; k++) g.fillRect(x0 + s * (12 - Math.round(k * 0.45)) - (s < 0 ? 0 : 2), B - 10 - k, 3, 1);
        col("#c84a3a");
        g.fillRect(x0 + s * 6 - 1, B - 24, 2, 1);
      }
      // the library: pediment, columns, tall lit windows
      const lx = x0 + 52;
      col("#b8aa8c");
      g.fillRect(lx, B - 20, 46, 20);
      for (let k = 0; k < 6; k++) g.fillRect(lx + 2 + k * 2, B - 22 - k, 42 - k * 4, 1);
      col("#d4c8aa");
      for (let k = 2; k < 46; k += 6) g.fillRect(lx + k, B - 19, 2, 19);
      col("#ffd27a");
      for (let k = 5; k < 44; k += 6) g.fillRect(lx + k, B - 16, 2, 9);
      col("#8a7c62");
      g.fillRect(lx - 2, B - 20, 50, 1);
      // the freighter
      const sx = x0 - 150;
      col("#0c1220");
      g.fillRect(sx, B - 9, 64, 5);
      g.fillRect(sx + 4, B - 4, 56, 1);
      g.fillRect(sx + 46, B - 15, 12, 6);
      g.fillRect(sx + 50, B - 19, 3, 4);
      col("#c84a3a");
      g.fillRect(sx, B - 9, 64, 1);
      col("#ffd27a");
      for (let k = 0; k < 5; k++) g.fillRect(sx + 48 + k * 2, B - 13, 1, 1);
      col("#1c2436");
      for (const cx of [sx + 12, sx + 30]) {
        g.fillRect(cx, B - 18, 1, 9);
        pxLine(g, cx, B - 18, cx + 10, B - 13);
      }
    }
  } else if (gym === "snowpoint") {
    // Snowpoint in the snow: Mt. Coronet's white shoulder, a snowfield, pines under snow, cottages with heavy roofs and
    // warm windows, and the old temple under its tiered roofs
    // Mt. Coronet between the landmarks: rock below, snow above the treeline, ridges down the flanks
    for (let x = 0; x < W; x++) {
      const d = ((x - LANDMARK) % 760 + 760) % 760 - 380, a = Math.abs(d);
      const ridge = Math.abs(Math.sin(x * 0.05)) * 2.5 + Math.abs(Math.sin(x * 0.13 + 1)) * 1.2;
      const h = Math.round(9 + 22 * Math.pow(Math.max(0, 1 - a / 175), 1.6) + ridge * Math.min(1, a / 50));
      col(d < 0 ? "#66728e" : "#525e7a");
      g.fillRect(x, B - h, 1, h);
      const cap = h - 17 + ((x * 7) % 3);
      if (cap > 0) {
        col(d < 0 ? "#eef2f8" : "#c4cede");
        g.fillRect(x, B - h, 1, cap);
        if ((x * 5) % 7 === 0 && a > 6) {
          col(d < 0 ? "#c4cede" : "#9ea8bc");
          g.fillRect(x, B - h + 2, 1, cap + 1);
        }
      } else {
        col("#dfe6ee");
        g.fillRect(x, B - h, 1, 1);
      }
    }
    col("#dfe6ee");
    g.fillRect(0, B - 5, W, 5);
    col("#f6fafc");
    g.fillRect(0, B - 5, W, 1);
    for (let x = 4, i = 0; x < W; x += 11 + ((i * 7) % 9), i++) {
      const h = 7 + ((i * 5) % 6);
      col("#1c3448");
      for (let k = 0; k < h; k++) {
        const hw = Math.floor((k / h) * 3);
        g.fillRect(x - hw, B - 3 - h + k, hw * 2 + 1, 1);
      }
      col("#f6fafc");
      g.fillRect(x, B - 3 - h, 1, 1);
      g.fillRect(x - 1, B - 3 - h + 3, 3, 1);
      g.fillRect(x - 2, B - 3 - h + 6, 2, 1);
    }
    for (let x = 40, i = 0; x < W; x += 70 + ((i * 23) % 40), i++) {
      col("#4a3a30");
      g.fillRect(x, B - 9, 14, 7);
      col("#f4f8fc");
      g.fillRect(x - 2, B - 12, 18, 3);
      g.fillRect(x, B - 13, 14, 1);
      col("#c8d4e2");
      g.fillRect(x - 2, B - 10, 18, 1);
      col("#ffd27a");
      g.fillRect(x + 3, B - 7, 2, 2);
      g.fillRect(x + 9, B - 7, 2, 2);
      col("#e2ecf4");
      g.fillRect(x + 11, B - 16, 2, 3);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#7a7c8a");
      g.fillRect(x0 - 18, B - 12, 37, 10);
      col("#5c5e6c");
      for (let k = -15; k <= 15; k += 6) g.fillRect(x0 + k, B - 11, 2, 9);
      col("#1a1c26");
      g.fillRect(x0 - 3, B - 9, 7, 7);
      for (const [y, hw] of [[B - 14, 23], [B - 20, 17], [B - 26, 11]]) {
        col("#3a3c4c");
        g.fillRect(x0 - hw, y, hw * 2 + 1, 2);
        g.fillRect(x0 - hw + 4, y - 4, hw * 2 - 7, 4);
        col("#f4f8fc");
        g.fillRect(x0 - hw - 1, y - 1, hw * 2 + 3, 1);
        g.fillRect(x0 - hw + 3, y - 5, hw * 2 - 5, 1);
        g.fillRect(x0 - hw - 2, y + 1, 1, 1);
        g.fillRect(x0 + hw + 1, y + 1, 1, 1);
      }
      col("#ffd27a");
      g.fillRect(x0 - 1, B - 24, 3, 2);
    }
  } else if (gym === "sunyshore") {
    // Sunyshore at noon: a blazing high sun, the sea, walkways roofed with solar panels on their piers, white towers,
    // and the lighthouse on the point
    const sx = Math.round(W * 0.38), sy = 9;
    col("#fff2b0");
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      for (let r = 9; r < 15; r++) if (r & 1) g.fillRect(sx + Math.round(Math.cos(a) * r), sy + Math.round(Math.sin(a) * r), 1, 1);
    }
    col("#ffd84a");
    fillEllipse(g, sx, sy, 7, 7);
    col("#fff2b0");
    fillEllipse(g, sx, sy, 5, 5);
    col("#ffffff");
    fillEllipse(g, sx - 1, sy - 1, 2, 2);
    col("#2c7ad4");
    g.fillRect(0, B - 6, W, 6);
    col("#ffffff");
    for (let x = 0; x < W; x += 6) if ((x * 7) % 5 < 2) g.fillRect(x + ((x >> 3) & 3), B - 5 + ((x * 3) % 4), 2, 1);
    for (let x = 0, i = 0; x < W; i++) {
      const w = 10 + ((i * 7) % 8), h = 10 + ((i * 5) % 9);
      if (i % 3 === 1) {
        col("#eef3f8");
        g.fillRect(x, B - h, w, h - 4);
        col("#c4d0dc");
        g.fillRect(x + w - 2, B - h, 2, h - 4);
        col("#3a6ab0");
        for (let yy = B - h + 2; yy < B - 6; yy += 3) for (let xx = x + 2; xx < x + w - 3; xx += 3) g.fillRect(xx, yy, 2, 1);
        col("#203c7c");
        g.fillRect(x, B - h - 1, w, 1);
      }
      x += w + 4;
    }
    // the walkways: a deck on piers down into the sea, roofed with tilted solar panels
    col("#7a8aa0");
    for (let x = 6; x < W; x += 16) g.fillRect(x, B - 10, 2, 6);
    col("#d8dee6");
    g.fillRect(0, B - 11, W, 2);
    col("#a4b0c0");
    g.fillRect(0, B - 10, W, 1);
    for (let x = 1; x < W; x += 8) {
      col("#7a8aa0");
      g.fillRect(x + 3, B - 13, 1, 2);
      col("#22408a");
      g.fillRect(x, B - 16, 7, 3);
      col("#7aa6ee");
      g.fillRect(x, B - 16, 7, 1);
      col("#3a5cb0");
      g.fillRect(x + 3, B - 15, 1, 2);
    }
    for (let x0 = LANDMARK; x0 < W; x0 += 760) {
      col("#8a8478");
      fillDome(g, x0, B - 4, 18, 6);
      col("#f2f4f8");
      g.fillRect(x0 - 3, B - 27, 7, 19);
      col("#c4ccd8");
      g.fillRect(x0 + 2, B - 27, 2, 19);
      col("#2a9a8a");
      g.fillRect(x0 - 3, B - 21, 7, 2);
      g.fillRect(x0 - 3, B - 14, 7, 2);
      col("#3a4458");
      g.fillRect(x0 - 5, B - 28, 11, 1);
      g.fillRect(x0 - 3, B - 33, 7, 1);
      g.fillRect(x0 - 1, B - 34, 3, 1);
      col("#ffe27a");
      g.fillRect(x0 - 3, B - 32, 7, 4);
      col("#ffffff");
      g.fillRect(x0 - 2, B - 31, 2, 2);
    }
  } else {
    // a pale far-off city
    col(shade(mood.sky[3], -0.12));
    for (let x = 0; x < W; ) {
      const w = 10 + ((x * 13) % 14), h = 6 + ((x * 29) % 10);
      g.fillRect(x, B - h, w, h);
      x += w + 3;
    }
  }
}

function drawTowers(g, W, mood) {
  const L = LAYOUT;
  for (let x = 150; x < W - 40; x += 380) {
    // lattice pole behind the crowd
    g.fillStyle = "#141a30";
    g.fillRect(x + 4, 8, 5, L.DECK_Y - 6);
    g.fillStyle = "#2c3554";
    for (let y = 8; y < L.DECK_Y + 2; y += 4) {
      g.fillRect(x + 4, y, 5, 1);
      g.fillRect(x + 5 + ((y >> 2) & 1) * 2, y + 1, 1, 3);
    }
    // light bank: 19×9 frame with three rows of lamps
    g.fillStyle = "#0b0e1e";
    g.fillRect(x - 3, 0, 19, 9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 6; c++) {
        g.fillStyle = mood.lit ? (r === 0 ? "#fffbe6" : r === 1 ? "#fff6c8" : "#ffe9a0") : r === 0 ? "#c9cbbf" : "#a4a69a";
        g.fillRect(x - 2 + c * 3, 1 + r * 3, 2, 2);
      }
    }
    if (mood.lit) {
      // glow halo: stepped rings of ordered dither (no blur)
      g.fillStyle = "#fff3a8";
      for (let gx = -9; gx <= 24; gx++) for (let gy = 0; gy <= 14; gy++) {
        const inX = gx >= -3 && gx <= 15, inY = gy <= 8;
        if (inX && inY) continue;
        const d = Math.max(gx < -3 ? -3 - gx : gx > 15 ? gx - 15 : 0, gy > 8 ? gy - 8 : 0);
        const keep = d <= 2 ? ((gx + gy) & 1) === 0 : d <= 4 ? (gx & 1) === 0 && (gy & 1) === 0 : d <= 6 && (gx & 3) === 0 && (gy & 3) === 0;
        if (keep) g.fillRect(x + gx, gy, 1, 1);
      }
    }
  }
}

// Section aisles (stairs) every AISLE px break the crowd into readable blocks.
const AISLE = 136, AISLE_W = 8;
const isAisle = (x) => ((x % AISLE) + AISLE) % AISLE < AISLE_W;

// The crowd: one fixed list of fans, rendered as a seated frame and a cheering frame.
function makeFans(W, offCols, defCols, rng) {
  const L = LAYOUT;
  const mid = ix(50);
  const fans = [];
  for (let row = 0; row < L.ROWS; row++) {
    for (let x = 1 + (row % 2) * 2; x < W - 5; x += 5) {
      if (isAisle(x) || isAisle(x + 4)) continue;
      if (rng.next() < 0.07) continue; // empty seat
      const cols = x < mid ? offCols : defCols;
      const r = rng.next();
      const shirt = r < 0.6 ? cols[rng.next() < 0.68 ? 0 : 1] : FANCY[(rng.next() * FANCY.length) | 0];
      fans.push({
        row, x: x + ((rng.next() * 2) | 0) - (row % 2 ? 0 : 0), shirt, skin: SKIN[(rng.next() * SKIN.length) | 0],
        hair: rng.next() < 0.62 ? HAIR[(rng.next() * HAIR.length) | 0] : null,
        jump: rng.next() < 0.6 ? 1 + ((rng.next() * 2) | 0) : 0, arms: rng.next() < 0.55, sign: row > 0 && rng.next() < 0.009 ? cols[0] : null,
        flag: rng.next() < 0.012,
      });
    }
  }
  return fans;
}
function drawCrowd(g, W, fans, frame, mood, offCols, defCols) {
  const L = LAYOUT;
  const dark = mood.night >= 0.6;
  const seatA = dark ? "#0e1228" : "#1a2140", seatB = dark ? "#121834" : "#20294c", riser = dark ? "#080a18" : "#121831";
  for (let row = 0; row < L.ROWS; row++) {
    const y = L.CROWD_Y + row * L.ROW_H;
    g.fillStyle = row % 2 ? seatA : seatB;
    g.fillRect(0, y, W, L.ROW_H);
    g.fillStyle = riser;
    g.fillRect(0, y + L.ROW_H - 1, W, 1);
  }
  // aisles: concrete stairs with step lines and a handrail
  for (let x = 0; x < W; x += AISLE) {
    g.fillStyle = dark ? "#262a3c" : "#3a4058";
    g.fillRect(x, L.CROWD_Y, AISLE_W, L.ROWS * L.ROW_H);
    g.fillStyle = dark ? "#1a1d2c" : "#2a2f44";
    for (let y = L.CROWD_Y + 2; y < L.CROWD_Y + L.ROWS * L.ROW_H; y += 4) g.fillRect(x, y, AISLE_W, 1);
    g.fillStyle = dark ? "#5a6078" : "#8a92b0";
    g.fillRect(x + (AISLE_W >> 1), L.CROWD_Y, 1, L.ROWS * L.ROW_H);
  }
  const mid = ix(50);
  for (const f of fans) {
    const y = L.CROWD_Y + f.row * L.ROW_H - (frame ? f.jump : 0);
    const x = f.x;
    const shirt = dark ? shade(f.shirt, -0.3) : f.shirt;
    g.fillStyle = shirt;
    g.fillRect(x, y + 5, 4, 3);
    g.fillStyle = shade(shirt, -0.38);
    g.fillRect(x, y + 7, 4, 1);
    g.fillStyle = dark ? shade(f.skin, -0.3) : f.skin;
    g.fillRect(x + 1, y + 3, 2, 2);
    if (f.hair) {
      g.fillStyle = f.hair;
      g.fillRect(x + 1, y + 2, 2, 1);
    }
    if (frame && f.jump && f.arms) {
      g.fillStyle = dark ? shade(f.skin, -0.3) : f.skin;
      g.fillRect(x - 1, y + 1, 1, 4);
      g.fillRect(x + 4, y + 1, 1, 4);
    }
    if (f.sign) {
      // a sign held up over the head (raised higher when cheering)
      const sy = y - (frame ? 4 : 2);
      g.fillStyle = "#0b0d14";
      g.fillRect(x - 3, sy - 1, 11, 6);
      g.fillStyle = "#f6f6f2";
      g.fillRect(x - 2, sy, 9, 4);
      g.fillStyle = f.sign;
      g.fillRect(x - 1, sy + 1, 2, 2);
      g.fillRect(x + 2, sy + 1, 4, 1);
      g.fillRect(x + 2, sy + 2, 3, 1);
    }
    if (f.flag) {
      const cols = x < mid ? offCols : defCols;
      g.fillStyle = "#d8d0c0";
      g.fillRect(x + 4, y - 5, 1, 9);
      g.fillStyle = cols[0];
      g.fillRect(x + 5, y - 5 + (frame ? 1 : 0), 5, 2);
      g.fillStyle = cols[1];
      g.fillRect(x + 5, y - 3 + (frame ? 1 : 0), 5, 2);
    }
  }
  // upper-deck shadow over the back rows: ordered dither, stepped (50% then 25%)
  g.fillStyle = "#05060f";
  for (let y = L.CROWD_Y; y < L.CROWD_Y + 14; y++) {
    const half = y < L.CROWD_Y + 7;
    for (let x = (y & 1); x < W; x += half ? 2 : 4) g.fillRect(x + (half ? 0 : (y & 2)), y, 1, 1);
  }
}

// Ad boards along a wall strip. y: top of the boards; h: board height (≥ 9).
const ADS = [
  { t: `${REGION.name.toUpperCase()} LEAGUE`, bg: "#b0201a", fg: "#ffd23f", icon: "star" },
  { t: "ALL22POKEMON.COM", bg: "#0b0d14", fg: "#5bd15b", icon: null },
  { t: "SNACK BAR", bg: "#1b2547", fg: "#f6f6f2", icon: "cup" },
  { t: "GO TEAM!", bg: "#2f6fd1", fg: "#f6f6f2", icon: "football" },
  { t: "ALL-22 BOWL", bg: "#ffd23f", fg: "#0b0d14", icon: null },
];
function drawAdIcon(g, kind, x, y) {
  if (kind === "football") {
    // side-on, laces up
    g.fillStyle = "#0b0d14";
    g.fillRect(x + 1, y + 1, 5, 5);
    g.fillRect(x, y + 2, 7, 3);
    g.fillStyle = "#9a5530";
    g.fillRect(x + 2, y + 2, 3, 3);
    g.fillRect(x + 1, y + 3, 5, 1);
    g.fillStyle = "#f6f6f2";
    g.fillRect(x + 2, y + 3, 3, 1);
    g.fillRect(x + 3, y + 2, 1, 1);
    g.fillRect(x + 3, y + 4, 1, 1);
  } else if (kind === "star") {
    g.fillStyle = "#ffd23f";
    g.fillRect(x + 3, y, 1, 7);
    g.fillRect(x, y + 2, 7, 1);
    g.fillRect(x + 1, y + 3, 5, 2);
    g.fillRect(x + 1, y + 5, 2, 2);
    g.fillRect(x + 4, y + 5, 2, 2);
  } else if (kind === "cup") {
    // a soda: straw, lid, red cup with a white band
    g.fillStyle = "#f6f6f2";
    g.fillRect(x + 5, y, 1, 1);
    g.fillRect(x + 4, y + 1, 1, 1);
    g.fillStyle = "#8d99ae";
    g.fillRect(x, y + 2, 7, 1);
    g.fillStyle = "#e8352a";
    g.fillRect(x + 1, y + 3, 5, 2);
    g.fillRect(x + 2, y + 5, 3, 2);
    g.fillStyle = "#f6f6f2";
    g.fillRect(x + 1, y + 4, 5, 1);
  }
}
function drawAds(g, x0, x1, y, h, startIdx) {
  let i = startIdx;
  let x = x0;
  while (x < x1 - 40) {
    const ad = ADS[i % ADS.length];
    const tw = textWidth(ad.t, 1, 1);
    const w = tw + (ad.icon ? 12 : 0) + 14;
    if (x + w > x1) break;
    g.fillStyle = "#05060c";
    g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle = ad.bg;
    g.fillRect(x, y, w, h);
    g.fillStyle = shade(ad.bg, 0.28);
    g.fillRect(x, y, w, 1);
    g.fillStyle = shade(ad.bg, -0.35);
    g.fillRect(x, y + h - 1, w, 1);
    let tx = x + 7;
    const ty = y + ((h - 7) >> 1);
    if (ad.icon) {
      drawAdIcon(g, ad.icon, tx, ty);
      tx += 12;
    }
    drawText(g, ad.t, tx, ty, 1, ad.fg);
    x += w + 6;
    i++;
  }
}

function drawWall(g, W, offCols, defCols) {
  const L = LAYOUT;
  const mid = ix(50);
  const y = L.WALL_Y;
  g.fillStyle = "#0a0c18";
  g.fillRect(0, y, W, L.WALL_H);
  g.fillStyle = offCols[0];
  g.fillRect(0, y, mid, 2);
  g.fillStyle = defCols[0];
  g.fillRect(mid, y, W - mid, 2);
  drawAds(g, 18, W - 10, y + 4, 10, 0);
  g.fillStyle = "#e8ecf2";
  g.fillRect(0, y + L.WALL_H - 2, W, 1);
}

// Team benches on the far sideline: reserves in kit, a coach, coolers.
function drawBenches(g, offKit, defKit, rng) {
  const L = LAYOUT;
  const benches = [[ix(16), ix(42), offKit], [ix(58), ix(84), defKit]];
  for (const [x0, x1, kit] of benches) {
    g.fillStyle = "#3a3f52";
    g.fillRect(x0, L.BENCH_Y + 3, x1 - x0, 2);
    g.fillStyle = "#23283a";
    g.fillRect(x0, L.BENCH_Y + 5, x1 - x0, 1);
    for (let x = x0 + 2; x < x1 - 3; x += 4 + ((rng.next() * 3) | 0)) {
      const back = rng.next() < 0.5;
      const y = L.BENCH_Y + (back ? 1 : 3);
      const skin = SKIN[(rng.next() * SKIN.length) | 0];
      g.fillStyle = back ? shade(kit.base, -0.25) : kit.base;
      g.fillRect(x, y + 2, 3, 3);
      g.fillStyle = kit.trim;
      g.fillRect(x, y + 2, 3, 1);
      g.fillStyle = "#e6e6e0";
      g.fillRect(x, y + 5, 3, 1);
      g.fillStyle = "#1b1f2e";
      g.fillRect(x, y + 6, 1, 2);
      g.fillRect(x + 2, y + 6, 1, 2);
      g.fillStyle = skin;
      g.fillRect(x + 1, y, 1, 2);
      g.fillStyle = kit.base;
      g.fillRect(x, y - 1, 3, 1);
    }
    // coolers
    for (const cx of [x0 - 6, x1 + 2]) {
      g.fillStyle = "#ff7a1a";
      g.fillRect(cx, L.BENCH_Y + 4, 4, 4);
      g.fillStyle = "#f6f6f2";
      g.fillRect(cx, L.BENCH_Y + 3, 4, 1);
    }
  }
}

// End stands behind both end lines: a padded back wall and a block of fans, so a TD or a field
// goal at the edge of the field is framed by a full stadium.
function drawEndStands(g, W, offCols, defCols, mood, rng) {
  const L = LAYOUT;
  const y0 = L.BENCH_Y, y1 = L.BWALL_Y;
  const dark = mood.night >= 0.6;
  for (const [side, cols] of [[-1, offCols], [1, defCols]]) {
    const wallX = side > 0 ? ix(118) : ix(-18) - 6;
    const x0 = side > 0 ? wallX + 6 : 0, x1 = side > 0 ? W : wallX;
    // seats
    for (let y = y0; y < y1; y += L.ROW_H) {
      g.fillStyle = ((y - y0) / L.ROW_H) & 1 ? (dark ? "#0e1228" : "#1a2140") : dark ? "#121834" : "#20294c";
      g.fillRect(x0, y, x1 - x0, L.ROW_H);
      g.fillStyle = dark ? "#080a18" : "#121831";
      g.fillRect(x0, y + L.ROW_H - 1, x1 - x0, 1);
      for (let x = x0 + 1 + ((y / L.ROW_H) & 1) * 2; x < x1 - 4; x += 5) {
        if (rng.next() < 0.08) continue;
        const r = rng.next();
        const shirt0 = r < 0.6 ? cols[rng.next() < 0.7 ? 0 : 1] : FANCY[(rng.next() * FANCY.length) | 0];
        const shirt = dark ? shade(shirt0, -0.3) : shirt0;
        g.fillStyle = shirt;
        g.fillRect(x, y + 5, 4, 3);
        g.fillStyle = shade(shirt, -0.38);
        g.fillRect(x, y + 7, 4, 1);
        const skin = SKIN[(rng.next() * SKIN.length) | 0];
        g.fillStyle = dark ? shade(skin, -0.3) : skin;
        g.fillRect(x + 1, y + 3, 2, 2);
        if (rng.next() < 0.6) {
          g.fillStyle = HAIR[(rng.next() * HAIR.length) | 0];
          g.fillRect(x + 1, y + 2, 2, 1);
        }
      }
    }
    // back wall: padding in the team color with a white trim
    g.fillStyle = "#0a0c18";
    g.fillRect(wallX, y0, 6, y1 - y0);
    g.fillStyle = cols[0];
    g.fillRect(wallX + 1, y0, 3, y1 - y0);
    g.fillStyle = "#e8ecf2";
    g.fillRect(side > 0 ? wallX : wallX + 5, y0, 1, y1 - y0);
  }
}

// ---------- the near side (bottom) ----------
function makeFrontFans(W, offCols, defCols, rng) {
  const mid = ix(50);
  const fans = [];
  const rows = [{ y: 4, step: 6, head: 3, sh: 5 }, { y: 13, step: 7, head: 4, sh: 6 }, { y: 23, step: 8, head: 4, sh: 7 }];
  rows.forEach((r, ri) => {
    for (let x = 2 + ri * 3; x < W - 8; x += r.step) {
      if (rng.next() < 0.1) continue;
      const cols = x < mid ? offCols : defCols;
      fans.push({
        ri, x: x + ((rng.next() * 2) | 0), y: r.y, head: r.head, sh: r.sh,
        hair: HAIR[(rng.next() * HAIR.length) | 0], skin: SKIN[(rng.next() * SKIN.length) | 0],
        shirt: rng.next() < 0.62 ? cols[rng.next() < 0.7 ? 0 : 1] : FANCY[(rng.next() * FANCY.length) | 0],
        cheer: rng.next() < 0.65, finger: rng.next() < 0.08 ? cols[0] : null, cap: rng.next() < 0.22 ? cols[rng.next() < 0.5 ? 0 : 1] : null,
      });
    }
  });
  return fans;
}
function drawFrontCrowd(g, W, y0, h, fans, frame, mood) {
  const dark = mood.night >= 0.6;
  g.fillStyle = dark ? "#07091a" : "#0e1228";
  g.fillRect(0, y0, W, h);
  g.fillStyle = dark ? "#0c1026" : "#161c38";
  for (const ry of [11, 21]) g.fillRect(0, y0 + ry, W, 1);
  for (const f of fans) {
    const up = frame && f.cheer ? 1 + (f.ri === 2 ? 1 : 0) : 0;
    const x = f.x, y = y0 + f.y - up;
    const shirt = dark ? shade(f.shirt, -0.3) : f.shirt;
    // shoulders (seen from behind)
    g.fillStyle = shirt;
    g.fillRect(x - ((f.sh - f.head) >> 1), y + f.head, f.sh, 4);
    g.fillStyle = shade(shirt, -0.35);
    g.fillRect(x - ((f.sh - f.head) >> 1), y + f.head + 3, f.sh, 1);
    // back of the head: hair, a little skin at the neck
    g.fillStyle = f.cap || f.hair;
    g.fillRect(x, y, f.head, f.head);
    g.fillStyle = dark ? shade(f.skin, -0.3) : f.skin;
    g.fillRect(x + 1, y + f.head - 1, f.head - 2, 1);
    if (frame && f.cheer) {
      g.fillStyle = dark ? shade(f.skin, -0.3) : f.skin;
      g.fillRect(x - 2, y - 2, 1, f.head + 2);
      g.fillRect(x + f.head + 1, y - 2, 1, f.head + 2);
      if (f.finger) {
        g.fillStyle = f.finger;
        g.fillRect(x + f.head + 1, y - 6, 2, 5);
        g.fillRect(x + f.head + 2, y - 8, 1, 2);
      }
    }
  }
}

// ---------- field paint ----------
function drawNumbers(g) {
  const ink = "#f2f6ee", shadowC = "#256d2e";
  // digit size follows the field scale (the 5×7 font at ×3 ≈ 1.5 yd tall at 22 px/yd)
  const S = PX >= 19 ? 3 : 2, A = S + 2; // A: rows of the direction arrow
  for (let yd = 10; yd <= 90; yd += 10) {
    const n = String(yd <= 50 ? yd : 100 - yd);
    const X = ix(yd);
    for (const ny of [9.2, FW - 9.2]) {
      const Y = iy(ny) - Math.round(3.5 * S);
      const d0 = n[0], d1 = n[1];
      const w0 = textWidth(d0, S, 1), w1 = textWidth(d1, S, 1);
      const gap = S + 1;
      for (const [c, xx] of [[d0, X - gap - w0], [d1, X + gap + 1]]) {
        drawText(g, c, xx + 1, Y + 1, S, shadowC);
        drawText(g, c, xx, Y, S, ink);
      }
      if (yd !== 50) {
        const dir = yd < 50 ? -1 : 1;
        const ax = dir < 0 ? X - gap - w0 - A - 3 : X + gap + 1 + w1 + 3;
        const ay = Y + Math.round(3.5 * S);
        g.fillStyle = ink;
        for (let k = 0; k < A; k++) g.fillRect(ax + (dir < 0 ? k : A - 1 - k), ay - k, 1, k * 2 + 1);
      }
    }
  }
}

function drawLines(g) {
  const ink = "#eef4ea";
  const top = LAYOUT.FIELD_Y, bot = LAYOUT.FIELD_B;
  const fh = bot - top;
  g.fillStyle = ink;
  // sidelines and end lines (2 px), goal lines (2 px), 5-yard lines (1 px)
  g.fillRect(ix(-10) - 1, top, ix(110) - ix(-10) + 2, 2);
  g.fillRect(ix(-10) - 1, bot - 2, ix(110) - ix(-10) + 2, 2);
  for (const yd of [-10, 0, 100, 110]) g.fillRect(ix(yd) - 1, top, 2, fh);
  for (let yd = 5; yd < 100; yd += 5) g.fillRect(ix(yd), top + 2, 1, fh - 4);
  // hashes + sideline ticks at every yard
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const X = ix(yd);
    g.fillRect(X, iy(CFG.HASH_TOP) - 2, 1, 4);
    g.fillRect(X, iy(CFG.HASH_BOT) - 2, 1, 4);
    g.fillRect(X, top + 3, 1, 3);
    g.fillRect(X, bot - 6, 1, 3);
  }
  // PAT spots
  g.fillRect(ix(2) - 1, iy(MID), 3, 1);
  g.fillRect(ix(98) - 1, iy(MID), 3, 1);
}

function drawPylons(g) {
  for (const yd of [-10, 0, 100, 110]) {
    for (const yy of [0, FW]) {
      const X = ix(yd), Y = iy(yy);
      g.fillStyle = "#b8460c";
      g.fillRect(X - 1, Y - 5, 3, 6);
      g.fillStyle = "#ff7a1a";
      g.fillRect(X - 1, Y - 5, 2, 5);
      g.fillStyle = "#ffd0a0";
      g.fillRect(X - 1, Y - 5, 1, 1);
    }
  }
}

function drawEndZone(g, team, kit, from, to, dir) {
  const L = LAYOUT;
  const x0 = ix(from), x1 = ix(to);
  const cx = Math.round((x0 + x1) / 2), cy = Math.round((L.FIELD_Y + L.FIELD_B) / 2);
  const name = (team.short || team.name || "").toUpperCase();
  const em = emblemFor(team);
  const ES = 3, EW = 12 * ES;
  const room = L.FIELD_B - L.FIELD_Y - 2 * (EW + 22);
  const unit = textWidth(name, 1, 1, true);
  const s = Math.max(2, Math.min(6, Math.floor(room / Math.max(1, unit))));
  const light = lab(team.secondary || "#ffffff").L > 55;
  const ramp = light ? ["#ffffff", shade(team.secondary || "#ffffff", 0.45), team.secondary || "#ffffff"] : ["#ffffff", "#fff3c4", "#ffd23f"];
  const t = textCanvas(name, s, ramp, { bold: true, outline: shade(team.primary || "#000000", -0.65), outlineW: Math.max(1, s >> 1), shadow: "#06080e", shadowD: Math.max(1, s >> 1) });
  const r = rotate90(t, dir);
  g.drawImage(r, cx - (r.width >> 1), cy - (r.height >> 1));
  const half = (r.height >> 1) + 12;
  drawEmblem(g, em, cx - (EW >> 1), cy - half - EW, ES);
  drawEmblem(g, em, cx - (EW >> 1), cy + half, ES);
}

function drawMidLogo(g) {
  const cx = ix(50), cy = iy(MID) - 6;
  const rx = 26, ry = 16;
  g.fillStyle = "#0b0d14";
  fillEllipse(g, cx, cy, rx + 2, ry + 2);
  // top half red, bottom half white (stepped shading, no gradients)
  for (let dy = -ry; dy <= ry; dy++) {
    const t = 1 - (dy * dy) / ((ry + 0.5) * (ry + 0.5));
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, t)) + 0.5);
    if (hw <= 0) continue;
    if (dy < -1) {
      g.fillStyle = "#e8352a";
      g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
      g.fillStyle = "#b8231c";
      g.fillRect(cx + hw - 3, cy + dy, 3, 1);
    } else if (dy > 1) {
      g.fillStyle = "#f2f2ec";
      g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
      g.fillStyle = "#c8ccd4";
      g.fillRect(cx + hw - 3, cy + dy, 3, 1);
      if (dy > ry - 3) g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
    }
  }
  // shine
  g.fillStyle = "#ff8a7a";
  g.fillRect(cx - 17, cy - 11, 7, 2);
  g.fillRect(cx - 19, cy - 9, 3, 2);
  // band + button
  g.fillStyle = "#0b0d14";
  g.fillRect(cx - rx - 1, cy - 1, rx * 2 + 3, 3);
  fillEllipse(g, cx, cy, 8, 5);
  g.fillStyle = "#f2f2ec";
  fillEllipse(g, cx, cy, 5, 3);
  g.fillStyle = "#c8ccd4";
  g.fillRect(cx - 2, cy + 1, 5, 1);
  // wordmark
  const wm = textCanvas("ALL-22", 2, ["#ffffff", "#fff27a", "#ffd23f", "#ffa82e"], { bold: true, outline: "#14275e", outlineW: 1, shadow: "#0d3a16", shadowD: 1 });
  g.drawImage(wm, cx - (wm.width >> 1), cy + ry + 5);
}

// ---------- build ----------
// off/def: team data; kits: {off, def} from art-kit; mood from moodFor().
export function buildStadium(off, def, kits, mood) {
  const L = LAYOUT;
  const W = FIELD_PX_W, H = FIELD_PX_H;
  const c = mk(W, H);
  const g = c.getContext("2d");
  const rng = makeRng(2207);
  const offCols = [off.primary || kits.off.primary, off.secondary || kits.off.secondary];
  const defCols = [def.primary || kits.def.primary, def.secondary || kits.def.secondary];

  // turf + aprons + bench area, per pixel
  const y0 = L.DECK_Y + L.DECK_H + L.ROWS * L.ROW_H + L.WALL_H; // = BENCH_Y
  const y1 = L.BWALL_Y;
  const img = g.createImageData(W, y1 - y0);
  const px = new Uint32Array(img.data.buffer);
  const tp = mood.turf || MOODS.clear.turf;
  const A = abgr(tp[0]), B = abgr(tp[1]), D = abgr(tp[2]), Lt = abgr(tp[3]), D2 = abgr(tp[4]);
  const AP = abgr("#2d7633"), APD = abgr("#286a2e"), APL = abgr("#33803a");
  const TR = abgr("#245c2c"), TRD = abgr("#1f5226");
  const ezc = (kit, team) => {
    const base = team.primary || kit.primary;
    return [abgr(shade(base, -0.12)), abgr(shade(base, -0.28)), abgr(shade(base, -0.4))];
  };
  const ezL = ezc(kits.off, off), ezR = ezc(kits.def, def);
  const fTop = L.FIELD_Y, fBot = L.FIELD_B;
  const xL = ix(-10), x0g = ix(0), x100 = ix(100), xR = ix(110);
  for (let y = y0; y < y1; y++) {
    const row = (y - y0) * W;
    const inField = y >= fTop && y < fBot;
    for (let x = 0; x < W; x++) {
      const h = hash(x, y);
      let col;
      if (!inField) {
        if (y < fTop && y < fTop - 3 && y >= L.BENCH_Y) col = h % 11 === 0 ? TRD : TR; // bench strip
        else col = h % 13 === 0 ? APD : h % 17 === 0 ? APL : AP;
      } else if (x < xL || x >= xR) col = h % 13 === 0 ? APD : h % 17 === 0 ? APL : AP;
      else if (x < x0g) {
        const k = ((x + (y - fTop) * 2) >> 3) & 1;
        col = k ? ezL[0] : ezL[1];
        if (h % 23 === 0) col = ezL[2];
      } else if (x >= x100) {
        const k = ((x - (y - fTop) * 2) >> 3) & 1;
        col = k ? ezR[0] : ezR[1];
        if (h % 23 === 0) col = ezR[2];
      } else {
        const yd = (x - x0g) / PX;
        col = Math.floor(yd / 5) % 2 ? B : A;
        const m = h % 29;
        if (m === 0) col = D;
        else if (m === 1 && (y & 1)) col = Lt;
        else if (m === 2) col = D2;
      }
      px[row + x] = col;
    }
  }
  g.putImageData(img, 0, y0);

  // stands: sky, towers, deck, crowd (frame 0), wall, benches
  drawSky(g, W, mood, rng);
  drawTowers(g, W, mood);
  g.fillStyle = mood.night >= 0.6 ? "#070914" : "#10142a";
  g.fillRect(0, L.DECK_Y, W, L.DECK_H);
  g.fillStyle = "#2a3160";
  g.fillRect(0, L.DECK_Y, W, 1);
  // little lit windows along the upper-deck fascia
  for (let x = 6; x < W; x += 11) {
    g.fillStyle = mood.lit ? "#ffe9a0" : "#4a5482";
    g.fillRect(x, L.DECK_Y + 2, 3, 2);
  }
  const fans = makeFans(W, offCols, defCols, rng);
  drawCrowd(g, W, fans, 0, mood, offCols, defCols);
  drawWall(g, W, offCols, defCols);
  drawBenches(g, kits.off, kits.def, rng);
  drawEndStands(g, W, offCols, defCols, mood, rng);

  // field paint
  drawEndZone(g, off, kits.off, -10, 0, -1);
  drawEndZone(g, def, kits.def, 100, 110, 1);
  drawLines(g);
  drawNumbers(g);
  drawMidLogo(g);
  drawPylons(g);

  // near side: wall with ads + front-row crowd
  g.fillStyle = "#0a0c18";
  g.fillRect(0, L.BWALL_Y, W, L.BCROWD_Y - L.BWALL_Y);
  g.fillStyle = "#e8ecf2";
  g.fillRect(0, L.BWALL_Y, W, 1);
  drawAds(g, 40, W - 10, L.BWALL_Y + 2, 10, 2);
  const mid = ix(50);
  g.fillStyle = offCols[0];
  g.fillRect(0, L.BCROWD_Y - 1, mid, 1);
  g.fillStyle = defCols[0];
  g.fillRect(mid, L.BCROWD_Y - 1, W - mid, 1);
  const front = makeFrontFans(W, offCols, defCols, rng);
  drawFrontCrowd(g, W, L.BCROWD_Y, L.BCROWD_H, front, 0, mood);

  // the cheering frames of both crowds (blitted over the seated ones at ~8 Hz)
  const top = mk(W, L.ROWS * L.ROW_H);
  const tg = top.getContext("2d");
  tg.translate(0, -L.CROWD_Y);
  drawCrowd(tg, W, fans, 1, mood, offCols, defCols);
  const bot = mk(W, L.BCROWD_H);
  const bg = bot.getContext("2d");
  bg.translate(0, -L.BCROWD_Y);
  drawFrontCrowd(bg, W, L.BCROWD_Y, L.BCROWD_H, front, 1, mood);
  // lit end zones for the touchdown flash: the same pixels pushed toward white (a palette step)
  const litEZ = (x0, x1) => {
    const w = x1 - x0, h = L.FIELD_B - L.FIELD_Y;
    const cv = mk(w, h);
    const cg = cv.getContext("2d");
    cg.drawImage(c, x0, L.FIELD_Y, w, h, 0, 0, w, h);
    const id = cg.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] + ((255 - d[i]) * 0.42) | 0;
      d[i + 1] = d[i + 1] + ((255 - d[i + 1]) * 0.42) | 0;
      d[i + 2] = d[i + 2] + ((246 - d[i + 2]) * 0.42) | 0;
    }
    cg.putImageData(id, 0, 0);
    return cv;
  };
  const ezLeft = litEZ(ix(-10) + 1, ix(0) - 1), ezRight = litEZ(ix(100) + 1, ix(110) - 1);
  let flashSky = null;
  if (mood.weather === "lightning") {
    flashSky = mk(W, L.SKY_H);
    const fg = flashSky.getContext("2d");
    drawFlashSky(fg, W, mood);
    drawTowers(fg, W, mood);
  }
  return { canvas: c, cheerTop: top, cheerTopY: L.CROWD_Y, cheerBot: bot, cheerBotY: L.BCROWD_Y, flashSky, ezLeft, ezRight, ezLeftX: ix(-10) + 1, ezRightX: ix(100) + 1, ezY: L.FIELD_Y };
}
