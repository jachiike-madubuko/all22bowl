// Formations and plays (pure data) plus the helpers that turn them into field coordinates.
// Coordinates are relative to the ball at the snap: dx = yards ahead (+) / behind (−) the LOS,
// dy = yards across from the ball (− = toward the top sideline).
// Route points are relative to the receiver's own alignment, with dy measured INSIDE-positive
// (toward the ball) for players split away from the ball; backs use absolute dy ("abs": true).

// ---------- Offensive formations ----------
const LINE = { C: [-0.6, 0], LG: [-0.75, -2.5], RG: [-0.75, 2.5], LT: [-0.85, -5.0], RT: [-0.85, 5.0], TE: [-0.95, 7.4] };
export const OFF_FORMATIONS = {
  I: { ...LINE, WR1: [-0.8, -16], WR2: [-1.6, 14.5], QB: [-1.3, 0], FB: [-4.0, 0], HB: [-6.4, 0] },
  GUN: { ...LINE, WR1: [-0.8, -16], WR2: [-1.6, 14.5], QB: [-5.0, 0], FB: [-3.4, -2.5], HB: [-5.1, 2.0] },
  PUNT: { ...LINE, TE: [-0.95, 5.85], WR1: [-0.8, -21], WR2: [-0.8, 21], QB: [-5.2, -1.6], FB: [-5.2, 1.6], HB: [-1.6, -5.8], K: [-13.5, 0] },
  FG: { ...LINE, WR1: [-1.0, -7.8], WR2: [-1.0, 7.8], QB: [-6.8, 0.2], FB: [-1.8, -5.8], HB: [-1.8, 5.8], K: [-8.8, -1.6] },
  // three to the left: wide out, slot, flexed tight end (screens to the outside)
  TRIPS: { ...LINE, TE: [-1.0, -8.0], WR1: [-0.8, -18], FB: [-1.2, -13.0], WR2: [-1.6, 15], QB: [-5.0, 0], HB: [-5.1, 2.0] },
  // I formation with the split end in jet motion, tight to the formation at the snap
  JET: { ...LINE, WR1: [-1.3, -6.6], WR2: [-1.6, 14.5], QB: [-1.3, 0], FB: [-4.0, 0], HB: [-6.4, 0] },
};
const SLOT_SPOT = [-1.2, -10.5];

// flip: the formation mirrored across the ball (a FLIPped call, see mirrorPlay)
export function offenseAlignment(scheme, formation, flip) {
  const f = { ...OFF_FORMATIONS[formation] };
  if (scheme && scheme.off === "slot" && (formation === "I" || formation === "GUN")) {
    f.FB = SLOT_SPOT;
    if (formation === "I") f.HB = [-5.6, 0];
  }
  if (flip) for (const s in f) f[s] = [f[s][0], -f[s][1]];
  return f;
}

// ---------- Routes (receiver-relative, dy inside-positive) ----------
export const ROUTES = {
  SLANT: { pts: [[1.8, 0], [5.5, 3.2], [15, 8.5], [24, 12]] },
  CURL: { pts: [[11.5, 0], [10, 1.2]], sit: true },
  GO: { pts: [[6, -0.8], [55, -1.6]] },
  SEAM: { pts: [[7, 0.5], [55, 1.2]] },
  POST: { pts: [[11, 0], [33, 8.5], [50, 12]] },
  COMEBACK: { pts: [[15, 0], [13, -2.4]], sit: true },
  OUT: { pts: [[11, 0], [12.2, -3], [12.5, -14]] },
  FLAT: { pts: [[1.5, 0], [3, -3.5], [4.5, -12]] },
  DRAG: { pts: [[2.5, 1], [4.5, 7], [5.5, 30]] },
  SWING_T: { pts: [[-0.6, -3], [1.2, -7], [4, -11], [9, -13]], abs: true },
  SWING_B: { pts: [[-0.6, 3], [1.2, 7], [4, 11], [9, 13]], abs: true },
  CHECK: { pts: [[2.5, 0], [5, 0]], abs: true, sit: true },
  // block first, then leak out as the checkdown
  CHECK_LATE: { pts: [[1.5, 1.5], [4, 3]], abs: true, sit: true, wait: 0.9 },
  SCREEN_B: { pts: [[0.4, 3.6], [1.3, 7.4]], abs: true, wait: 0.85, sit: true },
  FLAT_T: { pts: [[0.5, -3], [2, -7], [4, -12]], abs: true },
  // a wide receiver steps back behind the line for a quick screen
  WR_SCREEN: { pts: [[-0.6, 0.6], [-0.7, 0.9]], sit: true },
  // everybody deep, drifting inside toward the jump-ball spot
  HAIL: { pts: [[6, -0.4], [20, 2.5], [46, 7]] },
  HAIL_SEAM: { pts: [[7, 0.5], [46, 3]] },
  DIG: { pts: [[12, 0], [13, 4], [14, 16]] },
};

// ---------- Offensive plays ----------
// type 'run': qb.kind handoff|toss, carrier path (ball-relative). type 'pass': routes per slot,
// progression (read order), drop (yards the QB retreats), readAt (s), pa (play-action fake).
// block: run scheme for the line ('zone' straight ahead, 'reach' toward the play side, 'pull').
// wide: the side (dy sign) a play that goes outside attacks (the CPU takes it to the wide side of the field, cpuFlip);
// descFlip: the description of the FLIPped play, when the description names a side (mirrorPlay).
export const OFF_PLAYS = [
  {
    id: "dive", name: "HB DIVE", type: "run", formation: "I", tag: "INSIDE RUN", side: 1,
    desc: "Downhill behind the guard.",
    qb: { kind: "handoff", mesh: [-2.6, 0.8] },
    path: [[-2.6, 0.8], [0.6, 3.0], [5, 3.5], [14, 3.7]],
    lead: { FB: [[-0.6, 2.8], [2.8, 3.4]] },
    block: "zone",
  },
  {
    id: "sweep", name: "HB TOSS", type: "run", formation: "I", tag: "OUTSIDE RUN", side: 1, wide: 1,
    desc: "Pitch it wide and turn the corner.",
    qb: { kind: "toss", mesh: [-2.0, 1.2], at: 0.25 },
    path: [[-5.6, 3.8], [-3.8, 10.5], [0.2, 14.2], [7, 15.8], [20, 16]],
    lead: { FB: [[-3.4, 6], [-0.8, 11.5], [2.5, 13.5]] },
    crack: ["WR2"],
    block: "reach",
  },
  {
    id: "counter", name: "COUNTER", type: "run", formation: "I", tag: "MISDIRECTION", side: 1, misdirection: 1.45,
    desc: "Step left, guard pulls to kick out the end, fullback leads through the hole.",
    descFlip: "Step right, guard pulls to kick out the end, fullback leads through the hole.",
    qb: { kind: "handoff", mesh: [-3.0, 0.5] },
    path: [[-5.9, -0.5], [-3.1, 0.6], [0.3, 3.8], [5, 6.4], [14, 6.8]],
    lead: { FB: [[-3.4, -0.6], [-0.9, 2.6], [2.2, 4.2]] },
    pull: { LG: [[-2.2, -1.2], [-2.0, 3.2], [0.8, 6.6]] },
    hinge: ["LT"], // the backside tackle seals the backside edge
    block: "zone", blockSide: -1, // down blocks: the line seals the defense away from the hole
  },
  {
    id: "slants", name: "QUICK SLANTS", type: "pass", formation: "GUN", tag: "QUICK PASS",
    desc: "Fast in-breaking routes. Get it out quick.",
    drop: 1.0, readAt: 0.42,
    routes: { WR1: "SLANT", WR2: "SLANT", TE: "FLAT", HB: "SWING_B", FB: "SLANT" },
    fbBlocks: true,
    progression: ["WR1", "WR2", "FB", "TE", "HB"],
  },
  {
    id: "curlflat", name: "CURL FLAT", type: "pass", formation: "GUN", tag: "MEDIUM PASS",
    desc: "Curls sit down in the holes, flats stretch wide.",
    drop: 2.2, readAt: 0.85,
    routes: { WR1: "CURL", WR2: "CURL", TE: "FLAT", FB: "FLAT_T", HB: "CHECK" },
    progression: ["WR2", "WR1", "TE", "FB", "HB"],
  },
  {
    id: "verts", name: "FOUR VERTS", type: "pass", formation: "GUN", tag: "DEEP PASS",
    desc: "Everybody goes deep. Air it out.",
    drop: 2.4, readAt: 1.25,
    routes: { WR1: "GO", WR2: "GO", TE: "SEAM", FB: "SEAM", HB: "CHECK_LATE" },
    progression: ["WR2", "WR1", "TE", "FB", "HB"],
  },
  {
    id: "papost", name: "PA POST", type: "pass", formation: "I", tag: "PLAY ACTION",
    desc: "Fake the dive, hit the post over the top.",
    pa: true, qb: { mesh: [-2.6, 0.55] }, drop: 6.2, readAt: 1.45,
    routes: { WR1: "POST", WR2: "COMEBACK", TE: "DRAG" },
    fake: "HB",
    progression: ["WR1", "TE", "WR2"],
  },
  {
    id: "screen", name: "HB SCREEN", type: "pass", formation: "GUN", tag: "SCREEN",
    desc: "Let them rush, dump it to the back behind a wall.",
    drop: 2.6, readAt: 1.0, screen: "HB", screenLead: ["LG", "C", "RG"], screenRelease: 0.95, wide: 1,
    routes: { WR1: "GO", WR2: "GO", HB: "SCREEN_B" },
    progression: ["HB"],
  },
  // ---- round 2 ----
  {
    id: "hbDraw", name: "HB DRAW", type: "run", formation: "GUN", tag: "DELAYED RUN", side: 1, draw: true,
    desc: "Show pass, let the rush fly by, then hand it up the middle.",
    qb: { kind: "handoff", mesh: [-5.7, 1.0], at: 0.55 },
    path: [[-5.5, 1.3], [-2.0, 1.7], [1.2, 2.4], [6, 2.6], [16, 2.4]],
    lead: { FB: [[-2.2, -0.6], [0.6, 0.4], [3.2, 0.6]] },
    block: "draw",
  },
  {
    id: "wrScreen", name: "WR SCREEN", type: "pass", formation: "TRIPS", tag: "QUICK SCREEN",
    desc: "Trips left: the slot and tight end block, throw it out wide right away.",
    descFlip: "Trips right: the slot and tight end block, throw it out wide right away.",
    drop: 0.8, readAt: 0.4, screen: "WR1", screenLead: ["FB"], screenRelease: 0.05, wide: -1,
    routes: { WR1: "WR_SCREEN", WR2: "GO", HB: "CHECK" },
    progression: ["WR1", "WR2", "HB"],
  },
  {
    id: "reverse", name: "REVERSE", type: "run", formation: "JET", tag: "TRICK PLAY", side: 1, carrier: "WR1", misdirection: 1.4, edge: 2, wide: 1,
    desc: "Jet motion: the receiver takes it around the right end while the back fakes the dive left.",
    descFlip: "Jet motion: the receiver takes it around the left end while the back fakes the dive right.",
    motion: { slot: "WR1", vy: 1 },
    qb: { kind: "handoff", mesh: [-2.0, -1.2] },
    path: [[-2.2, -0.9], [-1.8, 4.5], [0.4, 10.5], [5, 14], [16, 15]],
    fake: "HB", fakePath: [[-3.0, -1.4], [0.5, -2.6]],
    lead: { FB: [[-2.8, 2.2], [-0.6, 7.2], [1.6, 9.8]] },
    crack: ["WR2"],
    block: "zone",
  },
  {
    id: "qbSneak", name: "QB SNEAK", type: "run", formation: "I", tag: "SHORT YARDAGE", side: 1, carrier: "QB",
    desc: "Quarterback keeps it and pushes behind the center.",
    qb: { kind: "keep" },
    lunge: 1.0, // the QB falls forward over the pile
    path: [[-0.4, 0.3], [1.8, 0.4], [5, 0.4], [12, 0.4]],
    lead: { FB: [[-1.2, 0.6], [1.0, 0.8]], HB: [[-2.6, -0.6], [0.4, -0.7]] },
    block: "wedge",
  },
  {
    id: "teSeam", name: "TE SEAM", type: "pass", formation: "GUN", tag: "MIDDLE PASS",
    desc: "Tight end splits the safeties up the seam; outs hold the corners.",
    drop: 2.3, readAt: 0.95,
    routes: { TE: "SEAM", WR1: "OUT", WR2: "DIG", FB: "FLAT_T", HB: "CHECK" },
    progression: ["TE", "WR2", "WR1", "HB", "FB"],
  },
  {
    id: "hailMary", name: "HAIL MARY", type: "pass", formation: "GUN", tag: "LAST CHANCE",
    desc: "Everybody to the end zone. Throw it up and pray.",
    drop: 3.4, readAt: 2.1, hail: true,
    routes: { WR1: "HAIL", WR2: "HAIL", TE: "HAIL_SEAM", FB: "HAIL" },
    progression: ["WR2", "WR1", "TE", "FB"],
  },
];

export const KICK_PLAYS = {
  punt: { id: "punt", name: "PUNT", type: "kick", kick: "punt", formation: "PUNT", desc: "Flip the field." },
  fg: { id: "fg", name: "FIELD GOAL", type: "kick", kick: "fg", formation: "FG", desc: "Three points." },
  kickoff: { id: "kickoff", name: "KICKOFF", type: "kick", kick: "kickoff", formation: "KICKOFF", desc: "Boot it deep and cover." },
  onside: { id: "onside", name: "ONSIDE KICK", type: "kick", kick: "kickoff", onside: true, formation: "KICKOFF", desc: "Kick it short and fight for it." },
};
// The receiving side's "play" on kickoffs / punt returns.
export const RETURN_PLAY = { id: "return", name: "RETURN", tag: "SPECIAL TEAMS", desc: "Set the wall, find a seam.", rush: { 34: [], 43: [] }, cover: "none", deep: [] };

// ---------- Defensive plays ----------
// rush: slots that rush the passer (by scheme). cover: 'man' | 'zone'. deep: safeties kept deep.
// zones: per slot (ball-relative dx downfield, dy across), radius r.
export const DEF_PLAYS = [
  {
    id: "base", name: "BASE MAN", tag: "BALANCED", desc: "Man coverage underneath, two safeties deep.",
    rush: { 34: ["DE1", "NT", "DE2", "OLB1"], 43: ["DE1", "NT", "ILB2", "DE2"] },
    cover: "man", deep: ["S1", "S2"], press: false,
  },
  {
    id: "blitz", name: "BLITZ", tag: "PRESSURE", desc: "Six rushers, man everywhere, one safety.",
    rush: { 34: ["DE1", "NT", "DE2", "OLB1", "OLB2", "ILB1"], 43: ["DE1", "NT", "ILB2", "DE2", "OLB1", "OLB2"] },
    cover: "man", deep: ["S2"], press: true, blitz: true,
  },
  {
    id: "cover2", name: "COVER 2", tag: "ZONE", desc: "Corners sit in the flats, safeties split the deep halves.",
    rush: { 34: ["DE1", "NT", "DE2", "OLB1"], 43: ["DE1", "NT", "ILB2", "DE2"] },
    cover: "zone", deep: ["S1", "S2"], press: false,
    zones: {
      CB1: [4.5, -15, 6], CB2: [4.5, 15, 6], S1: [17, -11, 10], S2: [17, 11, 10],
      ILB1: [7.5, -4.5, 5.5], ILB2: [7.5, 4.5, 5.5], OLB1: [7, -9.5, 5.5], OLB2: [7, 9.5, 5.5],
    },
  },
  {
    id: "runstop", name: "RUN STOP", tag: "STACK THE BOX", desc: "Eight in the box, attack the run on the snap.",
    rush: { 34: ["DE1", "NT", "DE2", "OLB1", "OLB2"], 43: ["DE1", "NT", "ILB2", "DE2"] },
    cover: "man", deep: ["S2"], press: true, box: true,
  },
  {
    id: "prevent", name: "PREVENT", tag: "NO BIG PLAYS", desc: "Three rushers, everyone else drops deep.",
    rush: { 34: ["DE1", "NT", "DE2"], 43: ["DE1", "NT", "DE2"] },
    cover: "zone", deep: ["S1", "S2"], press: false,
    zones: {
      CB1: [12, -15, 7], CB2: [12, 15, 7], S1: [24, -9, 11], S2: [24, 9, 11],
      ILB1: [10, -5, 6], ILB2: [10, 5, 6], OLB1: [8, -12, 6], OLB2: [8, 12, 6],
    },
  },
  // ---- round 2 ----
  {
    id: "zoneBlitz", name: "ZONE BLITZ", tag: "FIRE ZONE", desc: "Two linebackers come, an end drops into coverage. Three deep.",
    rush: { 34: ["DE1", "NT", "OLB1", "OLB2", "ILB1"], 43: ["DE1", "NT", "ILB2", "OLB1", "OLB2"] },
    cover: "zone", deep: ["S1", "CB1", "CB2"], press: false, blitz: true,
    zones: {
      S1: [18, 0, 12], CB1: [13, -16, 9], CB2: [13, 16, 9],
      DE2: [4.5, 6.5, 5], ILB1: [7, -3, 6], ILB2: [7, -3, 6], S2: [8, 6, 6],
    },
  },
  {
    id: "cover3", name: "COVER 3", tag: "THREE DEEP", desc: "Corners and the free safety split the deep thirds; four underneath.",
    rush: { 34: ["DE1", "NT", "DE2", "OLB1"], 43: ["DE1", "NT", "ILB2", "DE2"] },
    cover: "zone", deep: ["S1", "CB1", "CB2"], press: false,
    zones: {
      S1: [18, 0, 12], CB1: [14, -16, 9], CB2: [14, 16, 9],
      S2: [6.5, -11, 6], OLB1: [5, -12, 6], OLB2: [5, 12, 6], ILB1: [7.5, -3.5, 5.5], ILB2: [7.5, 3.5, 5.5],
    },
    // 4-3: the Mike sits in the middle hook and the strong safety takes the curl
    zones43: { ILB1: [7.5, 0, 6], S2: [8, 6, 6] },
  },
  {
    id: "goalLine", name: "GOAL LINE", tag: "NO GAIN", desc: "Everybody in the box. Seven rush, four in tight man.",
    rush: { 34: ["DE1", "NT", "DE2", "OLB1", "OLB2", "ILB1", "ILB2"], 43: ["DE1", "NT", "ILB2", "DE2", "OLB1", "OLB2", "ILB1"] },
    cover: "man", deep: [], press: true, box: true, goal: true,
  },
];

// Zones for a defensive call in a given scheme (34 / 43): the base table plus scheme overrides.
export function zonesFor(dplay, scheme) {
  if (!dplay.zones) return null;
  const extra = scheme === 43 || scheme === "43" ? dplay.zones43 : dplay.zones34;
  return extra ? { ...dplay.zones, ...extra } : dplay.zones;
}

// Defensive alignment by scheme (ball-relative, dx downfield).
export const DEF_FORMATIONS = {
  34: { DE1: [0.95, -4.2], NT: [0.95, 0], DE2: [0.95, 4.2], OLB1: [1.1, -7.8], OLB2: [1.1, 8.0], ILB1: [4.8, -2.9], ILB2: [4.8, 2.9], CB1: [5.5, -16], CB2: [5.5, 15], S1: [12.5, -8.5], S2: [12.5, 8.5] },
  43: { DE1: [0.95, -6.2], NT: [0.95, -1.5], ILB2: [0.95, 1.5], DE2: [0.95, 6.2], OLB1: [4.2, -7.0], ILB1: [4.8, 0], OLB2: [4.2, 7.0], CB1: [5.5, -16], CB2: [5.5, 15], S1: [12.5, -8.5], S2: [12.5, 8.5] },
};

// The defensive front by scheme, mirrored across the ball for a FLIPped call.
const mirrorSpots = (f) => Object.fromEntries(Object.entries(f).map(([s, [dx, dy]]) => [s, [dx, -dy]]));
const DEF_FLIPPED = { 34: mirrorSpots(DEF_FORMATIONS[34]), 43: mirrorSpots(DEF_FORMATIONS[43]) };
export const defAlignment = (scheme, flip) => (flip ? DEF_FLIPPED : DEF_FORMATIONS)[scheme] || (flip ? DEF_FLIPPED : DEF_FORMATIONS)[34];

export const offPlay = (id) => OFF_PLAYS.find((p) => p.id === id) || KICK_PLAYS[id] || OFF_PLAYS[0];
export const defPlay = (id) => DEF_PLAYS.find((p) => p.id === id) || (id === "return" ? RETURN_PLAY : DEF_PLAYS[0]);

// ---------- FLIP ----------
// A FLIPped call runs the play mirrored left ↔ right (every dy → −dy): the formation (offenseAlignment / defAlignment
// with flip), routes (routePoints), the run path, mesh points, lead and pull paths, the fake, the zone / reach side
// (side, blockSide), jet motion; on defense the front, the zones and with them the blitz side. Every player keeps his
// own job from his mirrored spot: on a flipped COUNTER the same left guard pulls, from the right side of the line. The
// name stays; a description that names a side reads the other one (descFlip). Kicks don't flip (punts and field goals
// are symmetric; onside kicks already go to a random side). Defensive calls are drawn against an offense with its
// strength (the tight end) on the right: a defense mirrors with a flipped offense, and its own FLIP mirrors it against
// the formation (world.js toPreSnap). mirrorPlay(play) → the play itself for kicks, else its
// mirror image (flip: true), made once per play and kept, so the cards redraw without allocating.
const negPts = (pts) => pts.map(([dx, dy]) => [dx, -dy]);
const negEach = (o) => Object.fromEntries(Object.entries(o).map(([s, pts]) => [s, negPts(pts)]));
const negZones = (z) => Object.fromEntries(Object.entries(z).map(([s, [dx, dy, r]]) => [s, [dx, -dy, r]]));
const MIRRORS = new Map();
export function mirrorPlay(play) {
  if (!play || play.flip || play.type === "kick" || play === RETURN_PLAY) return play;
  const key = (play.type ? "o:" : "d:") + play.id;
  let m = MIRRORS.get(key);
  if (m && m.base === play) return m;
  m = { ...play, flip: true, base: play };
  if (play.type) {
    if (play.side != null) m.side = -play.side;
    if (play.blockSide != null) m.blockSide = -play.blockSide;
    if (play.wide != null) m.wide = -play.wide;
    if (play.path) m.path = negPts(play.path);
    if (play.fakePath) m.fakePath = negPts(play.fakePath);
    if (play.lead) m.lead = negEach(play.lead);
    if (play.pull) m.pull = negEach(play.pull);
    if (play.qb && play.qb.mesh) m.qb = { ...play.qb, mesh: [play.qb.mesh[0], -play.qb.mesh[1]] };
    if (play.motion) m.motion = { ...play.motion, vy: -play.motion.vy };
    if (play.descFlip) m.desc = play.descFlip;
  } else {
    for (const k of ["zones", "zones34", "zones43"]) if (play[k]) m[k] = negZones(play[k]);
  }
  MIRRORS.set(key, m);
  return m;
}
// The call as it runs: flipped or not.
export const asCalled = (play, flip) => (flip ? mirrorPlay(play) : play);

// A route's absolute waypoints for a receiver aligned at (x0, y0) with the ball at (bx, by). Split receivers break
// relative to the ball (inside-positive dy); backs' routes are absolute, mirrored on a flipped play (flip).
export function routePoints(routeKey, x0, y0, by, flip) {
  const r = ROUTES[routeKey];
  if (!r) return [];
  // (flipped: the mirror image of the same rule, so a receiver right on the ball's line breaks the mirrored way too)
  const inside = flip ? (y0 >= by ? -1 : 1) : y0 <= by ? 1 : -1;
  const s = flip ? -1 : 1;
  return r.pts.map(([dx, dy]) => [x0 + dx, r.abs ? y0 + dy * s : y0 + dy * inside]);
}

// Diagram data for the play-call cards: lines per player in ball-relative coordinates.
export function playDiagram(play, scheme) {
  const out = { players: [], lines: [] };
  if (!play) return out;
  const isDef = !play.type;
  const fs = play.flip ? -1 : 1;
  if (isDef) {
    const f = defAlignment(scheme.def, play.flip);
    const rush = new Set(play.rush[scheme.def] || play.rush[34]);
    const zones = zonesFor(play, scheme.def);
    for (const slot in f) {
      let [dx, dy] = f[slot];
      if (play.box && (slot === "S1")) { dx = 7; dy = -4 * fs; }
      if (play.goal && slot.startsWith("S")) { dx = 4; dy = (slot === "S1" ? -5 : 5) * fs; }
      if (play.press && slot.startsWith("CB")) dx = 1.8;
      if (play.blitz && rush.has(slot) && (slot === "ILB1" || slot === "ILB2")) dx = 2.6;
      out.players.push({ slot, dx, dy, kind: "D" });
      if (rush.has(slot)) out.lines.push({ kind: "rush", pts: [[dx, dy], [-3.5, dy * 0.4]] });
      else if (play.cover === "zone" && zones && zones[slot]) {
        const z = zones[slot];
        out.lines.push({ kind: "zone", pts: [[dx, dy], [z[0], z[1]]], r: z[2] });
      } else if ((play.deep || []).includes(slot)) out.lines.push({ kind: "zone", pts: [[dx, dy], [dx + 6, dy * 1.2]], r: 7 });
      else out.lines.push({ kind: "man", pts: [[dx, dy], [dx + 3, dy]] });
    }
    return out;
  }
  const f = offenseAlignment(scheme, play.formation, play.flip);
  for (const slot in f) {
    if (slot === "K") continue;
    const [dx, dy] = f[slot];
    out.players.push({ slot, dx, dy, kind: "O" });
  }
  if (play.type === "run") {
    const carrier = play.carrier || "HB";
    const start = f[carrier] || f.HB;
    out.lines.push({ kind: "run", pts: [[start[0], start[1]], ...play.path] });
    if (play.fake && play.fakePath && f[play.fake]) out.lines.push({ kind: "fake", pts: [f[play.fake], ...play.fakePath] });
    if (play.lead) for (const s in play.lead) if (f[s] && !(scheme.off === "slot" && s === "FB")) out.lines.push({ kind: "block", pts: [f[s], ...play.lead[s]] });
    if (play.pull) for (const s in play.pull) out.lines.push({ kind: "block", pts: [f[s], ...play.pull[s]] });
    for (const s of ["LT", "LG", "C", "RG", "RT", "TE"]) {
      if (play.pull && play.pull[s]) continue;
      const [dx, dy] = f[s];
      const side = play.blockSide || play.side || 1;
      const shift = play.block === "reach" ? 1.2 * side : play.block === "zone" ? 0.6 * side : 0;
      // draw: the line shows pass protection first
      if (play.block === "draw") out.lines.push({ kind: "block", pts: [[dx, dy], [dx - 1.2, dy]] });
      else out.lines.push({ kind: "block", pts: [[dx, dy], [dx + 1.6, dy + shift]] });
    }
  } else if (play.type === "pass") {
    for (const s in play.routes) {
      if (!f[s]) continue;
      if (s === "FB" && play.fbBlocks && scheme.off !== "slot") continue;
      const [dx, dy] = f[s];
      const pts = routePoints(play.routes[s], dx, dy, 0, play.flip);
      out.lines.push({ kind: play.screen === s ? "screen" : "route", pts: [[dx, dy], ...pts.map((p) => [Math.min(p[0], 26), p[1]])], read: play.progression.indexOf(s) });
    }
    // screen: the releasing blockers lead out in front of the catch
    if (play.screen && play.screenLead && f[play.screen]) {
      const t = f[play.screen];
      for (const s of play.screenLead) {
        if (!f[s]) continue;
        out.lines.push({ kind: "block", pts: [f[s], [Math.max(f[s][0], 0) + 2.4, f[s][1] + (t[1] - f[s][1]) * 0.55]] });
      }
    }
    out.lines.push({ kind: "drop", pts: [f.QB, [f.QB[0] - Math.min(play.drop || 1, 3), f.QB[1]]] });
  }
  return out;
}
