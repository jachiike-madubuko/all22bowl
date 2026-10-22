// Per-player behaviour by assignment (blocking, routes, rushing, coverage, pursuit, ball carrying),
// the CPU quarterback's reads, CPU play calling (with team identities), and the autopilot that
// drives the human's team when nobody is touching the controls. Pure simulation: no DOM; w.rng only.
// Special teams once the kick is away live in football-special.js.
import { CFG } from "./config.js";
import { clamp } from "./util.js";
import { OFF_PLAYS, DEF_PLAYS, offenseAlignment, defAlignment, routePoints, zonesFor, offPlay } from "./playbook.js";
import { steer, steerDir, maxSpeed, canEngage, engage, disengage, startThrow, startPitch, pressureOn, dive, juke, stiffArm, predictRoute } from "./physics.js";

const FW = CFG.FIELD_W;
const ELIGIBLE = ["WR1", "WR2", "TE", "FB", "HB"];
const ANG = [-1.25, -0.85, -0.5, -0.22, 0, 0.22, 0.5, 0.85, 1.25];
const ANG_C = ANG.map(Math.cos);
const ANG_S = ANG.map(Math.sin);
const STEPS = [1.4, 3.0, 5.2];

const skillOf = (w, p) => (p.team === w.offense ? w.play.offSkill : w.play.defSkill);
// The play's mirror parity (world.js newPlay: −1 when the offense FLIPped its call). A choice that has no side of its
// own (a tie: a receiver right on the ball's line, two cuts equally open) breaks the mirrored way on a flipped play, so a
// flipped play runs as the exact mirror image of the original against the mirrored defense (game/flip-test.js).
const parOf = (w) => (w.play && w.play.par < 0 ? -1 : 1);
// (a plain loop: this runs for several players every step — no closures)
function slotOf(w, side, s) {
  const list = side === "O" ? w.offPlayers : w.defPlayers;
  for (let i = 0; i < list.length; i++) if (list[i].slot === s) return list[i];
  return null;
}

// ---------- Team identity ----------
// team.style ('air' | 'ground' | 'balanced' | 'blitz' | 'trick') and team.aggression (0–1) come from
// data.js when present; otherwise the gym's character (defaults to balanced).
const STYLE_BY_KEY = { pewter: "ground", cerulean: "balanced", vermilion: "air", celadon: "balanced", fuchsia: "blitz", saffron: "trick", cinnabar: "air", viridian: "ground" };
const AGGR_BY_STYLE = { air: 0.62, ground: 0.42, balanced: 0.5, blitz: 0.58, trick: 0.72 };
export function teamStyle(w, key) {
  const d = w.teams[key].data;
  const s = d.style || STYLE_BY_KEY[d.key];
  return s && AGGR_BY_STYLE[s] != null ? s : "balanced";
}
export function teamAggression(w, key) {
  const d = w.teams[key].data;
  return Number.isFinite(d.aggression) ? clamp(d.aggression, 0, 1) : AGGR_BY_STYLE[teamStyle(w, key)];
}

// ---------- Formation ----------
// Places all 22 on the field for the coming snap (offense at x < los, defense at x > los).
export function alignFormation(w) {
  const play = w.play.off;
  const dplay = w.play.def;
  const oTeam = w.teams[w.offense], dTeam = w.teams[w.defense];
  const los = w.los, by = w.ballY;
  const f = offenseAlignment(oTeam.data.scheme, play.formation, play.flip);
  for (const p of w.offPlayers) {
    const a = f[p.ai.stSlot || p.slot] || [-2, 0];
    // backed up against the goal line: the punter / holder can't line up past the end line
    p.homeX = Math.max(los + a[0], play.type === "kick" ? -9.2 : -9.5);
    p.homeY = clamp(by + a[1], 0.8, FW - 0.8);
    p.x = p.homeX;
    p.y = p.homeY;
    p.facing = 1;
  }
  // defense
  const scheme = dTeam.data.scheme.def === "43" ? 43 : 34;
  // a FLIPped defense: the front mirrored, every man in his own job from the other side (CB1 takes the bottom receiver)
  const df = defAlignment(scheme, dplay.flip);
  const fs = dplay.flip ? -1 : 1;
  const cbTop = dplay.flip ? "CB2" : "CB1", cbBot = dplay.flip ? "CB1" : "CB2";
  const rushSet = new Set(dplay.rush ? dplay.rush[scheme] || dplay.rush[34] : []);
  const deepSet = new Set(dplay.deep || []);
  // eligible receivers sorted by y (outermost first) for corner alignment
  const recs = w.offPlayers.filter((p) => ELIGIBLE.includes(p.slot) && p.slot !== "QB");
  recs.sort((a, b) => a.homeY - b.homeY);
  const top = recs[0], bot = recs[recs.length - 1];
  const kick = play.type === "kick";
  const ret = w.play.returner;
  const gunners = kick ? w.offPlayers.filter((p) => { const s = p.ai.stSlot || p.slot; return s === "WR1" || s === "WR2"; }).sort((a, b) => a.homeY - b.homeY) : [];
  for (const p of w.defPlayers) {
    let a = df[p.slot] || [5, 0];
    let dx = a[0], dy = a[1];
    if (p.slot === cbTop && top) dy = top.homeY - by + 0.4;
    if (p.slot === cbBot && bot) dy = bot.homeY - by - 0.4;
    if (p.slot.startsWith("CB")) dx = dplay.press ? 1.6 : dplay.id === "prevent" ? 9 : deepSet.has(p.slot) ? 7 : 5.5;
    if (dplay.box && p.slot === "S1") { dx = 7; dy = -4.5 * fs; }
    if (dplay.goal && p.slot.startsWith("S")) { dx = 4.2; dy = (p.slot === "S1" ? -5 : 5) * fs; }
    if (dplay.blitz && rushSet.has(p.slot) && (p.slot === "ILB1" || p.slot === "ILB2")) dx = 2.6;
    if (dplay.id === "prevent" && p.slot.startsWith("S")) dx = 19;
    if (dplay.id === "cover2" && p.slot.startsWith("S")) { dx = 14; dy = (p.slot === "S1" ? -11 : 11) * fs; }
    if ((dplay.id === "cover3" || dplay.id === "zoneBlitz") && p.slot === "S1") { dx = 14; dy = 0; }
    if ((dplay.id === "cover3" || dplay.id === "zoneBlitz") && p.slot === "S2") { dx = 8; dy = 6.5 * fs; }
    if (kick) {
      if (play.kick === "punt") {
        if (p === ret) { dx = 41; dy = 0; }
        else if (p.slot === "CB1" && gunners[0]) { dx = 1.8; dy = gunners[0].homeY - by + 0.6; }
        else if (p.slot === "CB2" && gunners[1]) { dx = 1.8; dy = gunners[gunners.length - 1].homeY - by - 0.6; }
        else if (p.slot.startsWith("S") || p.slot.startsWith("CB")) { dx = 13; dy = p.slot === "S1" || p.slot === "CB1" ? -7 : 7; }
      } else if (p.slot.startsWith("S") || p.slot === "CB1") { dx = 10; dy = p.slot === "S1" ? -6 : p.slot === "S2" ? 6 : 0; }
    }
    // keep the deep guys inside the field when the ball is near the goal line
    p.homeX = Math.min(los + dx, kick ? 108 : 109.5);
    if (p.homeX > 100 && !kick) p.homeX = Math.min(p.homeX, 100 + Math.max(1, dx * 0.4));
    p.homeY = clamp(by + dy, 0.8, FW - 0.8);
    p.x = p.homeX;
    p.y = p.homeY;
    p.facing = -1;
  }
}

// ---------- Assignments at the snap ----------
// Reaction to a handoff (s) by position: the line feels it, linebackers read it, the secondary is
// turned away. Misdirection (draws, reverses) fools everybody longer.
const REACT = { DE: 0.07, DT: 0.07, NT: 0.07, OLB: 0.15, ILB: 0.17, MLB: 0.17, CB: 0.27, S: 0.3 };

export function setupPlay(w) {
  const play = w.play.off;
  const dplay = w.play.def;
  const by = w.ballY;
  const oTeam = w.teams[w.offense];
  const dScheme = w.teams[w.defense].data.scheme.def === "43" ? 43 : 34;
  const isSlotScheme = oTeam.data.scheme.off === "slot";
  const side = play.side || 1;
  const fo = play.flip ? -1 : 1, fd = dplay.flip ? -1 : 1; // FLIPped calls (playbook.js mirrorPlay)
  w.play.progression = [];
  const screenLead = new Set(play.screenLead || []);
  for (const p of w.offPlayers) {
    const ai = p.ai;
    ai.t0 = 0;
    ai.react = 0;
    ai.hole = null;
    ai.lane = null;
    if (play.type === "kick") {
      const s = ai.stSlot || p.slot;
      ai.job = s === "K" ? "kicker" : s.startsWith("WR") ? "gunner" : "block";
      ai.mode = "pass";
      continue;
    }
    if (play.type === "run" && play.carrier === "QB" && p.slot === "QB") {
      // QB sneak: he carries it from the snap
      ai.job = "carry";
      ai.pts = play.path.map(([dx, dy]) => [w.los + dx, by + dy]);
      ai.pi = 0;
      continue;
    }
    if (p.slot === "QB") {
      ai.job = "qb";
      continue;
    }
    if (play.type === "run") {
      if (p.slot === (play.carrier || "HB") && play.carrier !== "QB") {
        ai.job = "carry";
        ai.pts = play.path.map(([dx, dy]) => [w.los + dx, by + dy]);
        ai.pi = 0;
        continue;
      }
      if (play.fake === p.slot && play.fakePath) {
        // the decoy: carry out the fake, then block
        ai.job = "fake";
        ai.pts = play.fakePath.map(([dx, dy]) => [w.los + dx, by + dy]);
        ai.pi = 0;
        continue;
      }
      if (play.lead && play.lead[p.slot] && !(isSlotScheme && p.slot === "FB")) {
        ai.job = "block";
        ai.mode = "lead";
        ai.pts = play.lead[p.slot].map(([dx, dy]) => [w.los + dx, by + dy]);
        ai.hole = ai.pts[ai.pts.length - 1];
        ai.pi = 0;
        continue;
      }
      if (play.pull && play.pull[p.slot]) {
        ai.job = "block";
        ai.mode = "pull";
        ai.pts = play.pull[p.slot].map(([dx, dy]) => [w.los + dx, by + dy]);
        ai.hole = ai.pts[ai.pts.length - 1];
        ai.pi = 0;
        continue;
      }
      if (p.slot.startsWith("WR") || (isSlotScheme && p.slot === "FB")) {
        ai.job = "block";
        ai.mode = play.crack && play.crack.includes(p.slot) ? "crack" : "stalk";
        continue;
      }
      if (p.slot === "FB" || p.slot === "HB") {
        // an extra back on a QB sneak / reverse: lead up the middle
        ai.job = "block";
        ai.mode = "lead";
        ai.pts = [[w.los + 1, by + (p.slot === "FB" ? 0.6 : -0.6) * fo]];
        ai.hole = ai.pts[0];
        ai.pi = 0;
        continue;
      }
      ai.job = "block";
      ai.mode = play.block === "reach" ? "reach" : play.block === "draw" ? "draw" : play.block === "wedge" ? "wedge" : "zone";
      // zone lanes slide toward the play side (C's lane offsets); the wedge squeezes inside;
      // a hinge blocker steps back outside to seal the backside edge
      const bs = play.blockSide || side;
      const shift = ai.mode === "reach" ? 2.2 : ai.mode === "wedge" ? 0 : 1.2;
      if (play.hinge && play.hinge.includes(p.slot)) ai.lane = p.homeY - bs * 2.6;
      else ai.lane = ai.mode === "wedge" ? p.homeY * 0.55 + by * 0.45 : p.homeY + bs * shift;
      continue;
    }
    // pass plays
    const route = play.routes[p.slot];
    const fbBlocks = p.slot === "FB" && play.fbBlocks && !isSlotScheme;
    if (screenLead.has(p.slot) && !(route && play.screen === p.slot)) {
      ai.job = "block";
      ai.mode = "screenlead";
      continue;
    }
    if (route && !fbBlocks) {
      ai.job = "route";
      ai.pts = routePoints(route, p.homeX, p.homeY, by, play.flip).map(([x, y]) => [Math.min(x, 108.5), clamp(y, 1.2, FW - 1.2)]);
      ai.pi = 0;
      ai.sit = false;
      ai.routeSit = !!ROUTE_SIT[route];
      ai.wait = ROUTE_WAIT[route] || 0;
      continue;
    }
    if (play.fake === p.slot) {
      ai.job = "fake";
      ai.pts = [[w.los - 2.6, by + 0.55 * fo], [w.los - 0.5, by + 1.0 * fo]];
      ai.pi = 0;
      continue;
    }
    ai.job = "block";
    ai.mode = "pass";
  }
  if (play.type === "pass") {
    for (const s of play.progression) {
      const p = slotOf(w, "O", s);
      if (p && p.ai.job === "route") w.play.progression.push(p);
    }
  }
  // QB plan
  const qb = slotOf(w, "O", "QB");
  if (qb && qb.ai.job === "qb") {
    const ai = qb.ai;
    if (play.type === "run") {
      ai.plan = { kind: play.qb.kind, mesh: [w.los + play.qb.mesh[0], by + play.qb.mesh[1]], at: play.qb.at || 0 };
    } else if (play.type === "pass") {
      // per dropback (rolled once, never per frame): the read starts a beat early or late, and the QB
      // is a little more or less willing to let it go — so he doesn't throw on a fixed clock to read #1
      ai.plan = {
        kind: "pass", pa: !!play.pa, mesh: play.pa ? [w.los + play.qb.mesh[0], by + play.qb.mesh[1]] : null, dropX: qb.homeX - (play.pa ? 0 : play.drop), paDropX: w.los - play.drop,
        readAt: play.readAt + w.rng.next() * 0.3,
        openSep: CFG.QB_OPEN_SEP + (w.rng.next() * 0.8 - 0.3),
      };
    } else ai.plan = { kind: "kick" };
    ai.readIdx = 0;
    ai.decided = false;
    ai.throwAway = false;
    ai.scramble = false;
  }
  // ---- defense ----
  const rushers = new Set((dplay.rush[dScheme] || dplay.rush[34] || []).filter((s) => !!slotOf(w, "D", s)));
  const deep = new Set(dplay.deep || []);
  const zones = zonesFor(dplay, dScheme);
  // the defense rolls its underneath zones toward a trips side (the left; the right on a flipped call)
  const tripsShift = play.formation === "TRIPS" ? -4 * fo : 0;
  const misdirection = play.misdirection || (play.draw ? 1.8 : 1);
  const coverage = [];
  for (const p of w.defPlayers) {
    const ai = p.ai;
    ai.t0 = 0;
    ai.target = null;
    ai.zone = null;
    ai.read = null;
    ai.react = (REACT[p.pos] || 0.15) * (1.3 - 0.6 * w.play.defSkill) * misdirection;
    if (play.type === "kick") {
      if (play.kick === "punt" && p === w.play.returner) ai.job = "returner";
      else if (["DE1", "NT", "DE2", "ILB2", "OLB1", "OLB2"].includes(p.slot)) ai.job = "rush";
      else if (play.kick === "punt" && p.pos === "CB") {
        ai.job = "jam";
        let g = null, gd = 1e9;
        for (const q of w.offPlayers) {
          if (q.ai.job !== "gunner") continue;
          const d = Math.abs(q.homeY - p.homeY);
          if (d < gd) { gd = d; g = q; }
        }
        ai.target = g;
      } else ai.job = "kickret";
      continue;
    }
    if (rushers.has(p.slot)) {
      ai.job = "rush";
      ai.contain = p.slot === "DE1" || p.slot === "DE2" || p.slot.startsWith("OLB");
      continue;
    }
    if (deep.has(p.slot)) {
      ai.job = "deep";
      const z = zones && zones[p.slot];
      ai.zone = z ? [w.los + z[0], clamp(by + z[1], 2, FW - 2), z[2]] : [w.los + 15, p.slot === "S1" || deep.size === 1 ? (deep.size === 1 ? by : by - 10 * fd) : by + 10 * fd, 10];
      if (deep.size === 1) ai.zone[1] = FW / 2 * 0.3 + by * 0.7;
      continue;
    }
    if (dplay.cover === "zone" && zones && zones[p.slot]) {
      const z = zones[p.slot];
      ai.job = "zone";
      ai.zone = [w.los + z[0], clamp(by + z[1] + tripsShift, 2, FW - 2), z[2]];
      continue;
    }
    coverage.push(p);
  }
  // man matching: corners on the outside receivers, the rest by proximity
  const recs = w.offPlayers.filter((p) => p.ai.job === "route" || (play.type === "run" && ELIGIBLE.includes(p.slot)) || p.ai.job === "fake");
  const taken = new Set();
  const order = coverage.slice().sort((a, b) => (a.pos === "CB" ? 0 : a.pos === "S" ? 1 : 2) - (b.pos === "CB" ? 0 : b.pos === "S" ? 1 : 2));
  for (const d of order) {
    let best = null, bd = 1e9;
    for (const r of recs) {
      if (taken.has(r)) continue;
      let dd = Math.abs(r.homeY - d.homeY) + Math.abs(r.homeX - d.homeX) * 0.3;
      if (d.pos === "CB" && !r.slot.startsWith("WR") && r.slot !== "FB") dd += 6;
      if (dd < bd) { bd = dd; best = r; }
    }
    if (best && (d.pos === "CB" || bd < 16)) {
      taken.add(best);
      d.ai.job = "man";
      d.ai.target = best;
      d.ai.cushion = dplay.press ? 0.6 : d.pos === "CB" ? 2.4 : 1.4;
    } else {
      d.ai.job = "zone";
      d.ai.zone = [w.los + 6, clamp(d.homeY, 4, FW - 4), 6];
    }
    if (d.pos === "ILB" || d.pos === "MLB" || d.pos === "OLB") d.ai.read = dplay.box ? 0.08 : CFG.RUN_READ;
  }
  for (const d of w.defPlayers) {
    if (d.ai.job === "zone" && (d.pos === "ILB" || d.pos === "MLB" || d.pos === "OLB")) d.ai.read = dplay.box ? 0.08 : CFG.RUN_READ;
    if (d.ai.read == null) d.ai.read = 0;
    if (d.pos === "S" && dplay.box) d.ai.read = 0.2;
    // a draw looks like pass: nobody steps downhill
    if (play.draw) d.ai.read = 0;
  }
}
const ROUTE_SIT = { CURL: 1, COMEBACK: 1, CHECK: 1, CHECK_LATE: 1, SCREEN_B: 1, WR_SCREEN: 1 };
const ROUTE_WAIT = { SCREEN_B: 0.85, CHECK_LATE: 0.9 };

// ---------- Live thinking ----------
// Pass protection: match free blockers to rushers (nearest lane first), once per step.
const PP_R = [], PP_B = [];
let ppQb = null, ppStamp = 0;
const byQbDist = (a, b) => Math.hypot(a.x - ppQb.x, a.y - ppQb.y) - Math.hypot(b.x - ppQb.x, b.y - ppQb.y);
function passPro(w) {
  PP_R.length = PP_B.length = 0;
  const qb = w.ball.carrier;
  const stamp = ++ppStamp;
  for (const p of w.offPlayers) {
    p.ai.ppTarget = null;
    if (p.ai.job === "block" && (p.ai.mode === "pass" || (p.ai.mode === "screenlead" && w.play.t < (w.play.off.screenRelease || 0.8)) || w.play.kick)) PP_B.push(p);
    else if (p.ai.job === "fake" && w.play.t > 0.8) PP_B.push(p);
  }
  if (!qb) return;
  for (const d of w.defPlayers) {
    if (d.downUntil > w.time || d.state === "tackled") continue;
    if (d.ai.job === "rush" || (d.x < w.los + 1.2 && d.vx < -0.5)) PP_R.push(d);
  }
  ppQb = qb;
  PP_R.sort(byQbDist);
  for (const b of PP_B) if (b.engaged) {
    b.ai.ppUsed = stamp;
    b.ai.ppTarget = b.engaged;
  }
  for (const r of PP_R) {
    if (r.blockers.length) continue;
    let best = null, bd = 1e9;
    for (const b of PP_B) {
      if (b.ai.ppUsed === stamp) continue;
      const d = Math.abs(b.homeY - r.y) * 1.0 + Math.abs(b.x - r.x) * 0.5;
      if (d < bd) { bd = d; best = b; }
    }
    if (best) {
      best.ai.ppUsed = stamp;
      best.ai.ppTarget = r;
    }
  }
  // leftovers help on the nearest engaged rusher
  for (const b of PP_B) {
    if (b.ai.ppUsed === stamp) continue;
    let best = null, bd = 6;
    for (const r of PP_R) {
      if (r.blockers.length !== 1) continue;
      const d = Math.hypot(b.x - r.x, b.y - r.y);
      if (d < bd) { bd = d; best = r; }
    }
    b.ai.ppTarget = best;
  }
}

export function think(w, dt) {
  const ps = w.players;
  const play = w.play;
  const b = w.ball;
  if (play && (play.off.type === "pass" || (play.kick && play.kick !== "kickoff")) && b.state === "held" && b.carrier && b.carrier.team === w.offense && !play.turnover) passPro(w);
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.state === "tackled") {
      p.tvx = p.tvy = 0;
      continue;
    }
    if (p.downUntil > w.time && p.diveUntil <= w.time) {
      p.tvx = p.tvy = 0;
      continue;
    }
    if (p.diveUntil > w.time) continue;
    if (p.isUser && w.userActive) continue; // the human drives this one
    thinkOne(w, p, dt);
  }
}

function thinkOne(w, p, dt) {
  const b = w.ball;
  const play = w.play;
  // punts / field goals before the boot
  if (play.kick && !play.kickAway) return kickPreThink(w, p, dt);
  // ball carrier
  if (b.state === "held" && b.carrier === p) {
    if (p.pos === "QB" && p.ai.job === "qb" && !play.qbRunner) return qbThink(w, p, dt);
    return carryThink(w, p, dt);
  }
  // loose ball: nearby players go get it
  if (b.state === "loose" && b.kind === "fumble") {
    if (Math.hypot(p.x - b.x, p.y - b.y) < 14 && !p.engaged) {
      steer(w, p, b.x + b.vx * 0.2, b.y + b.vy * 0.2, 1, 0);
      return;
    }
  }
  const offenseHasBall = b.state === "held" && b.carrier && b.carrier.team === p.team;
  const carrier = b.state === "held" ? b.carrier : null;
  const carrierIsPocketQb = carrier && carrier.pos === "QB" && !play.qbRunner && carrier.ai.job === "qb";
  // --- ball's team (offense, or the defense after a pick) ---
  if (offenseHasBall) {
    if (p.side === "O" || play.turnover) {
      if (carrierIsPocketQb || play.kick) return offenseThink(w, p, dt);
      return escortThink(w, p, carrier, dt);
    }
  }
  // --- the team without the ball ---
  if (carrier && carrier.team !== p.team) {
    if (carrierIsPocketQb && !play.turnover) return defenseThink(w, p, dt, carrier);
    // the handoff fools them for a beat (more on draws / reverses): keep playing the decoy
    if (play.handT && play.decoy && play.decoy !== carrier && w.time < play.handT + p.ai.react && !play.turnover) {
      const dcy = play.decoy;
      if (dcy.pos === "QB" && dcy.ai.job === "qb") return defenseThink(w, p, dt, dcy);
      return pursue(w, p, dcy, dt);
    }
    return pursue(w, p, carrier, dt);
  }
  // ball in the air
  if (b.state === "air") {
    if (b.kind === "pass") {
      if (p.team === w.offense) return offenseAirThink(w, p, dt);
      return defenseAirThink(w, p, dt);
    }
    if (b.kind === "pitch") {
      if (p.team === w.offense) return offenseThink(w, p, dt);
      return defenseThink(w, p, dt, null);
    }
    // kicks
    return kickCoverThink(w, p, dt);
  }
  // dead / loose (incomplete): ease up
  p.tvx *= 0.9;
  p.tvy *= 0.9;
}

// ---------- Punts / field goals before the kick ----------
function kickPreThink(w, p, dt) {
  const k = w.kick;
  const holder = k && k.holder;
  if (p.team === w.offense) {
    const job = p.ai.job;
    if (job === "kicker" || p === holder) {
      p.tvx = p.tvy = 0;
      return;
    }
    if (job === "gunner") return steer(w, p, p.x + 10, p.homeY * 0.85 + FW * 0.075, 1, 0);
    return blockThink(w, p, dt, "pass");
  }
  const b = w.ball;
  switch (p.ai.job) {
    case "rush":
      return rushThink(w, p, holder || b);
    case "jam": {
      // hold up the gunner at the line for a moment
      const g = p.ai.target;
      if (p.engaged) return;
      if (g && g.blockers.length < 1 && !p.ai.jammed) {
        engageMove(w, p, g, w.los + 45, g.y);
        if (p.engaged === g) {
          p.ai.jammed = true;
          g.shedAt = Math.min(g.shedAt, w.time + 0.25 + 0.3 * w.rng.next());
        }
        return;
      }
      return steer(w, p, p.x + 6, p.y, 0.7, 1);
    }
    case "returner": {
      // drift to where the punt usually lands
      const tx = Math.min(w.los + 42, 98);
      return steer(w, p, tx, w.ballY, 0.35, 1.5);
    }
    default:
      return steer(w, p, p.homeX + 3, p.homeY, 0.4, 1);
  }
}

// ---------- Offense ----------
function offenseThink(w, p, dt) {
  const job = p.ai.job;
  if (job === "route") return routeThink(w, p, dt);
  if (job === "block") return blockThink(w, p, dt);
  if (job === "carry") return carryPathThink(w, p, dt);
  if (job === "fake") return fakeThink(w, p, dt);
  if (job === "gunner") return steer(w, p, p.x + 10, p.homeY * 0.85 + FW * 0.075, 1, 0);
  if (job === "kicker") {
    p.tvx = p.tvy = 0;
    return;
  }
  if (job === "qb") {
    p.tvx = p.tvy = 0;
  }
}

function routeThink(w, p, dt) {
  const ai = p.ai;
  const t = w.play.t;
  if (ai.wait && t < ai.wait) {
    // screen back: sell pass protection first (set up in the pocket, don't drift deep)
    const nr = nearestOppTo(w, p, p, 1.6, true);
    if (nr && nr.ai.job === "rush") return engageMove(w, p, nr, w.ball.x, w.ball.y, 1.0);
    return steer(w, p, p.homeX + 0.3, p.homeY, 0.4, 0.5);
  }
  if (!ai.pts || ai.pi >= ai.pts.length) {
    // (out of room at the back of the end zone: he settles there too, never on out the back)
    if (ai.routeSit || ai.sit || p.x >= 106.5) {
      ai.sit = true;
      // settle into the soft spot: drift away from the nearest defender
      const nd = nearestOpp(w, p);
      if (nd && nd.d < 3) {
        const dy = p.y - nd.p.y;
        steerDir(w, p, -0.3, dy > 0 || (dy === 0 && parOf(w) > 0) ? 1 : -1, 0.22);
      } else {
        p.tvx *= 0.8;
        p.tvy *= 0.8;
      }
      p.facing = -1;
      return;
    }
    // keep running the last leg
    return steerDir(w, p, 1, 0, 1);
  }
  const [tx, ty] = ai.pts[ai.pi];
  const d = steer(w, p, tx, clamp(ty, 0.6, FW - 0.6), 1, tx >= 106 ? 2 : 0); // (pulling up at the back of the end zone)
  if (d < 0.75) ai.pi++;
}

function fakeThink(w, p, dt) {
  const ai = p.ai;
  const run = w.play.off.type === "run";
  if ((w.play.t < 0.8 || (run && w.play.t < 1.4)) && ai.pts && ai.pi < ai.pts.length) {
    const [tx, ty] = ai.pts[ai.pi];
    if (steer(w, p, tx, ty, run ? 1 : 0.9, 0) < 0.6) ai.pi++;
    return;
  }
  return blockThink(w, p, dt, run ? "stalk" : "pass");
}

function carryPathThink(w, p, dt) {
  // running back before the handoff: run the path toward the mesh
  const ai = p.ai;
  const play = w.play;
  if (!ai.pts || ai.pi >= ai.pts.length) return steerDir(w, p, 1, 0, 0.6);
  // draw: sit at the mesh in a pass-pro look until the ball comes
  if (play.off.draw && !play.handed && ai.pi >= 1) {
    const [mx, my] = ai.pts[0];
    steer(w, p, mx, my, 0.4, 0.5);
    p.facing = 1;
    return;
  }
  const [tx, ty] = ai.pts[ai.pi];
  const frac = ai.pi === 0 ? 0.85 : 0.95;
  if (steer(w, p, tx, ty, frac, 0) < 0.7) ai.pi++;
}

function qbThink(w, qb, dt) {
  const ai = qb.ai;
  const plan = ai.plan || { kind: "pass" };
  const play = w.play;
  const t = play.t;
  if (qb.throwAt > 0) {
    qb.tvx *= 0.5;
    qb.tvy *= 0.5;
    return;
  }
  if (plan.kind === "handoff" || plan.kind === "toss") {
    const [mx, my] = plan.mesh;
    steer(w, qb, mx, my, 0.75, 0.6);
    const hb = slotOf(w, "O", "HB");
    if (plan.kind === "toss" && t >= plan.at && hb) {
      startPitch(w, qb, hb);
      play.handed = true;
      play.handT = w.time;
      play.decoy = qb;
      return;
    }
    const rb = play.off.carrier && play.off.carrier !== "QB" ? slotOf(w, "O", play.off.carrier) : hb;
    if (rb && plan.kind === "handoff") {
      // the exchange: as soon as the back is in reach (scaled by their size), after a beat
      const at = Math.max(0.3, plan.at || 0);
      const reach = qb.rad + rb.rad + 0.4;
      if ((t >= at && Math.hypot(rb.x - qb.x, rb.y - qb.y) < reach) || t > 1.1 + (plan.at || 0)) {
        // the defense flows to the decoy (the faking back on an end-around)
        play.decoy = (play.off.fake && play.off.fakePath && slotOf(w, "O", play.off.fake)) || qb;
        w.handoff(qb, rb);
      }
    }
    return;
  }
  if (plan.kind !== "pass") return;
  // play action: sell the fake
  if (plan.pa && t < 0.62) {
    steer(w, qb, plan.mesh[0], plan.mesh[1], 0.8, 0.6);
    if (t > 0.42 && !play.faked) {
      play.faked = true;
      w.emit("fake", { qb });
    }
    return;
  }
  const dropX = plan.pa ? plan.paDropX : plan.dropX;
  const human = qb.isUser && !w.autoplay;
  // pocket movement: drop, then slide away from pressure
  let tx = dropX, ty = qb.homeY;
  let prx = 0, pry = 0;
  for (const d of w.players) {
    if (d.team === qb.team || d.downUntil > w.time || d.blockers.length) continue;
    const dd = Math.hypot(d.x - qb.x, d.y - qb.y);
    if (dd < 3.2) {
      prx += (qb.x - d.x) / (dd * dd + 0.3);
      pry += (qb.y - d.y) / (dd * dd + 0.3);
    }
  }
  if (Math.abs(qb.x - dropX) < 0.6 || t > 1.2) {
    tx = qb.x + prx * 1.4 + 0.15;
    ty = qb.y + pry * 1.8;
    tx = clamp(tx, w.los - 9, w.los - 0.8);
  }
  steer(w, qb, tx, clamp(ty, 3, FW - 3), qb.x > dropX + 0.4 ? 0.85 : 0.55, 0.5);
  if (human) return; // the human throws
  if (ai.scramble) {
    play.qbRunner = true;
    return;
  }
  if (t < plan.readAt * 0.7) return;
  const skill = play.offSkill;
  const press = pressureOn(w, qb);
  const prog = play.progression;
  if (!prog.length) return;
  // designed screen: dump it to the target as soon as he's out of his pass-pro act
  const scr = prog[0];
  if (play.off.screen && t >= plan.readAt && scr.ai.job === "route" && scr.downUntil <= w.time && (!scr.ai.wait || scr.ai.pi >= 1 || t >= scr.ai.wait + 0.55)) {
    startThrow(w, qb, prog[0]);
    return;
  }
  // Hail Mary: buy time until they get there (the end zone, or 40 yards out), then throw it up
  if (play.off.hail) {
    let deep = null;
    for (const r of prog) if (r.downUntil <= w.time && (!deep || r.x > deep.x)) deep = r;
    const goal = Math.min(100, w.los + 40);
    if (deep && ((t >= plan.readAt && deep.x >= goal - 11) || t >= 4.4 || (press > 0.7 && t > 1.6))) startThrow(w, qb, deep);
    return;
  }
  const steps = Math.floor((t - plan.readAt) / (CFG.QB_READ_STEP * (1.25 - 0.4 * skill)));
  const idx = clamp(steps, 0, prog.length - 1);
  let best = null, bestSep = -9;
  for (let i = 0; i < prog.length; i++) {
    const r = prog[i];
    if (r.downUntil > w.time) continue;
    const sep = openness(w, qb, r);
    const needDepth = w.down >= 3 && r.x + 1 < w.firstDownX ? 0.35 : 0;
    // a deep shot needs a clear window (a bad deep ball is a pick)
    const deepNeed = r.x - w.los > CFG.QB_DEEP_YDS ? CFG.QB_DEEP_SEP : 0;
    const score = sep - needDepth - deepNeed * 0.5 - i * 0.12;
    if (score > bestSep) { bestSep = score; best = r; }
    const routeReady = !r.ai.routeSit || r.ai.sit || (r.ai.pts && r.ai.pi >= r.ai.pts.length - 1);
    if (i <= idx && t >= plan.readAt && routeReady && sep - needDepth - deepNeed >= plan.openSep - 0.6 * skill && r.x > qb.x + 1) {
      startThrow(w, qb, r);
      return;
    }
  }
  // hot read: a free rusher is bearing down — get it out to whoever's open, now
  if (t > plan.readAt * 0.5 && best && bestSep > 1.6 - 0.6 * skill && hotRusher(w, qb, 3.0 + 1.1 * skill) && w.rng.chance(0.035 + 0.08 * skill)) {
    startThrow(w, qb, best);
    return;
  }
  if (press > 0.3 && t > plan.readAt * 0.6) {
    if (best && bestSep > 0.7 - 0.4 * skill) {
      startThrow(w, qb, best);
      return;
    }
    // escape the rush if there's room, throw it away, or eat it
    if (press > 0.5 && w.rng.chance(0.05 + 0.05 * skill) && qb.r.speed > 6.3) {
      ai.scramble = true;
      return;
    }
    if (press > 0.6 && best && w.rng.chance(0.04 + 0.08 * skill)) {
      ai.throwAway = true;
      startThrow(w, qb, best);
      return;
    }
  }
  if (t > CFG.QB_MAX_HOLD + skill * 0.6) {
    if (best && bestSep > 0.6) startThrow(w, qb, best);
    else if (best) {
      ai.throwAway = true;
      startThrow(w, qb, best);
    }
  }
}

// An unblocked defender inside r yards of the QB and closing on him.
function hotRusher(w, qb, r) {
  for (const d of w.players) {
    if (d.team === qb.team || d.downUntil > w.time || d.blockers.length || d.state === "tackled") continue;
    const dx = qb.x - d.x, dy = qb.y - d.y;
    const dd = Math.hypot(dx, dy);
    if (dd > r || dd < 0.01) continue;
    if ((d.vx * dx + d.vy * dy) / dd > 2) return true;
  }
  return false;
}

// How open a receiver will be at the catch point (yards of separation, roughly). A defender
// sitting in the throwing lane caps it (build D's lane check), and a crowd costs a little.
const OP = [0, 0];
export function openness(w, qb, r) {
  const d0 = Math.hypot(r.x - qb.x, r.y - qb.y);
  const T = d0 / 22;
  // where the throw would meet him: along his route (as the throw leads him), else straight on
  predictRoute(r, T + 0.18, OP);
  const cx = OP[0], cy = OP[1];
  const lx = cx - qb.x, ly = cy - qb.y;
  const ll2 = lx * lx + ly * ly || 1;
  // a deep ball sails over the underneath defenders: only the end of its flight matters
  const u0 = d0 > 24 ? 0.68 : d0 > 18 ? 0.4 : 0.15;
  let sep = 9, lane = 99, crowd = 0;
  for (const d of w.players) {
    if (d.team === r.team || d.downUntil > w.time) continue;
    const u = ((d.x - qb.x) * lx + (d.y - qb.y) * ly) / ll2;
    // a rusher in the backfield won't cover anybody — but he can still bat a ball thrown through him
    const rusher = d.ai.job === "rush" && d.x < w.los + 1;
    if (rusher) {
      if (u > 0.1 && u < 0.6 && d0 < 16) {
        const ld = Math.hypot(qb.x + lx * u - d.x, qb.y + ly * u - d.y);
        if (ld < lane) lane = ld;
      }
      continue;
    }
    const dd = Math.hypot(d.x - cx, d.y - cy) - maxSpeed(w, d) * T * 0.45;
    if (dd < sep) sep = dd;
    if (dd < 3.2) crowd++;
    if (u > u0 && u < 0.92) {
      const ld = Math.hypot(qb.x + lx * u - d.x, qb.y + ly * u - d.y);
      if (ld < lane) lane = ld;
    }
  }
  if (lane < CFG.QB_LANE_R) sep = Math.min(sep, lane * 0.8);
  if (cy < 1 || cy > FW - 1) sep -= 1.5;
  return sep - CFG.QB_CROWD_K * Math.max(0, crowd - 1);
}

// ---------- Blocking ----------
function blockThink(w, p, dt, forceMode) {
  const play = w.play;
  const mode = forceMode || p.ai.mode;
  const t = play.t;
  // screen: at the release the line lets its rusher through and leaks out in front
  if (p.engaged && mode === "screenlead" && t >= (play.off.screenRelease || 0.8) && !p.ai.released) {
    p.ai.released = true;
    disengage(w, p.engaged);
  }
  if (p.engaged) {
    p.tvx = p.tvy = 0;
    return;
  }
  const b = w.ball;
  const qb = slotOf(w, "O", "QB");
  const carrier = b.state === "held" ? b.carrier : null;
  let tgt = null;
  if (mode === "pass" || play.kick || (mode === "screenlead" && t < (play.off.screenRelease || 0.8))) {
    // pass pro: the rusher assigned by passPro()
    const prot = carrier || qb || p;
    tgt = p.ai.ppTarget;
    if (tgt && (tgt.downUntil > w.time || (p.noEngage === tgt && p.noEngageUntil > w.time))) tgt = null;
    if (!tgt) {
      // set the pocket
      const sx = p.homeX - (p.pos === "OL" ? 1.1 : 1.6);
      steer(w, p, sx, p.homeY, 0.5, 0.5);
      return;
    }
    return engageMove(w, p, tgt, prot.x, prot.y, 1.5);
  }
  if (mode === "screenlead") {
    // released: lead out in front of the screen target (C's screen-block release). The first man
    // out takes the force player on the outside, the next ones climb inside / upfield.
    const scr = slotOf(w, "O", play.off.screen) || p;
    const holder = carrier && carrier.team === p.team && carrier.pos !== "QB" ? carrier : scr;
    const k = Math.max(0, (play.off.screenLead || []).indexOf(p.slot));
    const out = holder.y > w.ballY || (holder.y === w.ballY && parOf(w) > 0) ? 1 : -1;
    const sx = Math.max(w.los + 1.5, holder.x + 2.5) + k * 2.2;
    const sy = clamp(holder.y + out * (2.4 - k * 2.0), 3, FW - 3);
    return leadBlockAt(w, p, sx, sy, carrier || holder);
  }
  if (mode === "draw") {
    // show pass first; once the back has it, block the run
    if (!play.handed && t < 0.75) {
      const nearRusher = nearestOppTo(w, p, p, 2.2, true);
      if (nearRusher) return engageMove(w, p, nearRusher, (qb || p).x, (qb || p).y, 1.2);
      return steer(w, p, p.homeX - 1.0, p.homeY, 0.5, 0.5);
    }
    return runBlock(w, p, carrier, p.homeY);
  }
  if (mode === "lead" || mode === "pull") {
    const ai = p.ai;
    const hole = ai.hole || [w.los + 1.5, p.y];
    if (ai.pts && ai.pi < ai.pts.length - 1) {
      // on the way: run the path (a puller stays behind the line), knock off anyone in the way
      const [tx, ty] = ai.pts[ai.pi];
      const near = nearestOppTo(w, p, p, 1.4, true);
      if (near && (mode === "lead" || t > 0.5)) return engageMove(w, p, near, carrier ? carrier.x : p.x - 2, carrier ? carrier.y : p.y);
      if (steer(w, p, tx, ty, 1, 0) < 0.9) ai.pi++;
      return;
    }
    return leadBlockAt(w, p, hole[0], hole[1], carrier);
  }
  if (mode === "stalk" || mode === "crack") {
    const ref = carrier || p;
    const r = mode === "crack" ? 9 : 6.5;
    tgt = nearestOppTo(w, p, p, r, true);
    if (tgt) return engageMove(w, p, tgt, ref.x, ref.y);
    return steer(w, p, p.homeX + 3, p.homeY, 0.5, 0.5);
  }
  // zone / reach / wedge run blocking
  return runBlock(w, p, carrier, p.ai.lane != null ? p.ai.lane : p.homeY);
}

// Run blocking (build C's claims): pick the most dangerous defender in my lane that nobody else has
// claimed this step; drive him off the ball. No one there: climb to the second level.
function runBlock(w, p, carrier, laneY) {
  const t = w.time;
  let tgt = null, bs = 1e9;
  for (const d of w.players) {
    if (d.team === p.team || d.downUntil > t || d.state === "tackled" || d.blockers.length >= 2) continue;
    if (p.noEngage === d && p.noEngageUntil > t) continue;
    const ahead = d.x - w.los;
    if (ahead > 6.5 || d.x < p.x - 2.5) continue;
    const lat = Math.abs(d.y - laneY);
    if (lat > (ahead < 2.5 ? 3.4 : 4.2)) continue;
    let s = lat + Math.abs(d.x - p.x) * 0.7 + (ahead > 2.5 ? 1.2 : 0);
    if (d.ai.claimT === t && d.ai.claimBy !== p) s += 3.5;
    if (d.blockers.length) s += 5;
    if (s < bs) { bs = s; tgt = d; }
  }
  if (tgt) {
    tgt.ai.claimT = t;
    tgt.ai.claimBy = p;
    const ref = carrier || p;
    return engageMove(w, p, tgt, ref.x - 2.5, ref.y);
  }
  steer(w, p, p.x + 3, laneY, 0.7, 0.5);
}

// Lead / pull / screen blocks (build C's lead-to-hole): go to the hole, block the first defender who
// shows up there (closest to the hole, then to the carrier); otherwise keep heading for the hole.
function leadBlockAt(w, p, hx, hy, carrier) {
  const t = w.time;
  let best = null, bs = 1e9;
  for (const d of w.players) {
    if (d.team === p.team || d.downUntil > t || d.state === "tackled" || d.blockers.length >= 1) continue;
    if (p.noEngage === d && p.noEngageUntil > t) continue;
    const dh = Math.hypot(d.x - hx, d.y - hy);
    if (dh > 5.5) continue;
    let s = dh + (carrier ? Math.hypot(d.x - carrier.x, d.y - carrier.y) * 0.4 : 0);
    if (d.ai.claimT === t && d.ai.claimBy !== p) s += 3;
    if (s < bs) { bs = s; best = d; }
  }
  if (best && (Math.hypot(p.x - hx, p.y - hy) < 3.5 || best.x < hx + 1)) {
    best.ai.claimT = t;
    best.ai.claimBy = p;
    const ref = carrier || p;
    return engageMove(w, p, best, ref.x, ref.y);
  }
  steer(w, p, hx, hy, 1, 0.4);
}

// Move into a blocking position on `d` (between d and the protected point) and lock on.
export function engageMove(w, b, d, px, py, depth = 0.85) {
  const dd = Math.hypot(d.x - b.x, d.y - b.y);
  if (dd < b.rad + d.rad + CFG.ENGAGE_RANGE && canEngage(w, b, d)) {
    engage(w, b, d);
    b.tvx = b.tvy = 0;
    return;
  }
  let vx = px - d.x, vy = py - d.y;
  const vl = Math.hypot(vx, vy) || 1;
  const fit = Math.min(depth, Math.max(0.6, vl - 0.5));
  const tx = d.x + (vx / vl) * fit, ty = d.y + (vy / vl) * fit;
  steer(w, b, tx, ty, 1, 0.3);
}

function nearestOpp(w, p) {
  let best = null, bd = 1e9;
  for (const d of w.players) {
    if (d.team === p.team || d.downUntil > w.time) continue;
    const dd = Math.hypot(d.x - p.x, d.y - p.y);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best ? { p: best, d: bd } : null;
}
// nearest unblocked opponent to `ref` within r of me
export function nearestOppTo(w, me, ref, r, unblocked) {
  let best = null, bd = 1e9;
  for (const d of w.players) {
    if (d.team === me.team || d.downUntil > w.time || d.state === "tackled") continue;
    if (unblocked && d.blockers.length >= 1) continue;
    if (me.noEngage === d && me.noEngageUntil > w.time) continue;
    if (Math.hypot(d.x - me.x, d.y - me.y) > r) continue;
    const dd = Math.hypot(d.x - ref.x, d.y - ref.y);
    if (dd < bd) { bd = dd; best = d; }
  }
  return best;
}

// Teammates of the ball carrier: block for him. Linemen keep working their lanes; everyone picks
// a threat in front of the carrier (claims spread them out).
function escortThink(w, p, c, dt) {
  if (p === c) return;
  if (p.engaged) {
    p.tvx = p.tvy = 0;
    return;
  }
  const t = w.time;
  const dir = w.dirOf(c);
  // designed run blocks stay on until the carrier is past the line
  const play = w.play;
  if (!play.turnover && p.ai.job === "block" && play.off.type === "run" && c.x < w.los + 1.5 && (p.ai.mode === "zone" || p.ai.mode === "reach" || p.ai.mode === "wedge" || p.ai.mode === "draw" || p.ai.mode === "lead" || p.ai.mode === "pull")) {
    return blockThink(w, p, dt);
  }
  if (!play.turnover && p.ai.job === "block" && p.ai.mode === "screenlead") return blockThink(w, p, dt);
  let best = null, bs = 1e9;
  const range = p.pos === "OL" ? 5 : 9;
  for (const d of w.players) {
    if (d.team === p.team || d.downUntil > t || d.state === "tackled" || d.blockers.length >= 1) continue;
    if (p.noEngage === d && p.noEngageUntil > t) continue;
    const ahead = (d.x - c.x) * dir;
    if (ahead < -2) continue;
    const dc = Math.hypot(d.x - c.x, d.y - c.y);
    if (dc > 11) continue;
    const dp = Math.hypot(d.x - p.x, d.y - p.y);
    if (dp > range + 4) continue;
    let s = dp * 0.8 + dc * 0.6;
    if (d.ai.claimT === t && d.ai.claimBy !== p) s += 4;
    if (s < bs) { bs = s; best = d; }
  }
  if (best) {
    best.ai.claimT = t;
    best.ai.claimBy = p;
    return engageMove(w, p, best, c.x, c.y);
  }
  steer(w, p, c.x + dir * 5, c.y + (p.y > c.y || (p.y === c.y && parOf(w) < 0) ? 2.5 : -2.5), 0.75, 1);
}

// The ball carrier: run the designed path, then find daylight; juke/stiff-arm when a hit is coming.
export function carryThink(w, c, dt) {
  const ai = c.ai;
  const dir = w.dirOf(c);
  // outside runs press the edge on the designed path before reading daylight
  const edge = w.play.off.edge;
  if (edge != null && ai.job === "carry" && ai.pts && ai.pi <= edge && ai.pi < ai.pts.length && dir > 0 && !w.play.turnover) {
    const [tx, ty] = ai.pts[ai.pi];
    if (steer(w, c, tx, clamp(ty, 1, FW - 1), 1, 0) < 1.2) ai.pi++;
    evade(w, c);
    return;
  }
  // designed path (as a preference) until past the line, then daylight
  let px = 0, py = 0;
  if (ai.job === "carry" && ai.pts && ai.pi < ai.pts.length && (w.play.ret ? true : dir > 0 && c.x < w.los + 3)) {
    const [tx, ty] = ai.pts[ai.pi];
    px = tx - c.x;
    py = ty - c.y;
    const pl = Math.hypot(px, py);
    if (pl < 0.9) ai.pi++;
    px /= pl || 1;
    py /= pl || 1;
  }
  ai.think -= w.dtStep;
  if (ai.think <= 0) {
    ai.think = 0.1;
    const d = daylight(w, c, dir, px, py);
    ai.ldx = d[0];
    ai.ldy = d[1];
  }
  steerDir(w, c, ai.ldx || dir, ai.ldy || 0, 1);
  evade(w, c);
}

// Evasive moves when a hit is coming: stiff-arm (if he's the stronger man) or juke.
function evade(w, c) {
  const skill = skillOf(w, c);
  const nd = nearestOpp(w, c);
  if (nd && nd.d < 1.9 && nd.d > 0.7 && !nd.p.blockers.length) {
    const r = w.rng.next();
    if (r < 0.05 * skill) {
      if (c.r.power > nd.p.r.power * 1.05 && w.rng.chance(0.6)) stiffArm(w, c);
      else juke(w, c);
    }
  }
}
const DL_TMP = [0, 0];
export function daylight(w, c, dir, px = 0, py = 0) {
  let bestS = -1e9, bx = dir, by = 0;
  const fwdW = 2.2;
  const mir = parOf(w) < 0; // (two cuts equally good: the mirrored one on a flipped play)
  for (let k = 0; k < ANG.length; k++) {
    const dx = ANG_C[k] * dir, dy = ANG_S[k];
    let clear = 8;
    for (let i = 0; i < w.players.length; i++) {
      const d = w.players[i];
      if (d === c || d.downUntil > w.time || d.state === "tackled") continue;
      // teammates are obstacles too (a lineman's back), but softer
      const eng = d.team === c.team ? (d.engaged ? 0.9 : 1.6) : d.blockers.length ? 1.4 : 0;
      for (let s = 0; s < STEPS.length; s++) {
        const st = STEPS[s];
        const qx = c.x + dx * st, qy = c.y + dy * st;
        const dd = Math.hypot(d.x - qx, d.y - qy) - st * 0.5 + eng;
        if (dd < clear) clear = dd;
      }
    }
    const py5 = c.y + dy * 4;
    const side = py5 < 1.2 || py5 > FW - 1.2 ? 5 : py5 < 3 || py5 > FW - 3 ? 1.2 : 0;
    const pathBias = px || py ? (dx * px + dy * py) * 2.4 : 0;
    const s = Math.min(clear, 5.5) * 1.15 + ANG_C[k] * fwdW - side - Math.abs(ANG[k]) * 0.25 + pathBias;
    if (s > bestS || (mir && s === bestS)) { bestS = s; bx = dx; by = dy; }
  }
  DL_TMP[0] = bx;
  DL_TMP[1] = by;
  return DL_TMP;
}

// ---------- Defense ----------
// Coverage sack order: who peels off first to go after a QB who holds the ball (see defenseThink).
const LATE_RUSH_ORDER = { ILB1: 0, MLB: 0, ILB2: 0.5, OLB1: 1, OLB2: 1.5, DE1: 0, DE2: 0, NT: 0, DT1: 0, DT2: 0, CB1: 4, CB2: 4.5, S1: 5, S2: 5.5 };

function defenseThink(w, p, dt, qb) {
  const ai = p.ai;
  const t = w.play.t;
  if (p.engaged) return;
  // run read for linebackers
  if (ai.read && t < ai.read + (w.play.faked ? CFG.PA_BITE : 0)) {
    // step downhill, mirror the backfield
    const bite = w.play.faked ? 1.2 : 0.4;
    return steer(w, p, p.homeX - bite * 2, p.homeY + (w.ball.y - p.homeY) * 0.15, 0.45, 0.5);
  }
  // [merge] a QB who holds the ball forever (nobody open, or an idle human passer) gets a coverage
  // sack: the underneath defenders peel off one by one and come after him (CPU QBs throw first)
  if (qb && (ai.job === "zone" || ai.job === "man") && t > CFG.LATE_RUSH_T + (LATE_RUSH_ORDER[p.slot] ?? 3) * 0.55) return rushThink(w, p, qb);
  switch (ai.job) {
    case "rush": return rushThink(w, p, qb);
    case "man": return manThink(w, p, dt);
    case "zone": return zoneThink(w, p);
    case "deep": return deepThink(w, p);
    case "kickret": return steer(w, p, p.homeX, p.homeY, 0.4, 1);
    default: return rushThink(w, p, qb);
  }
}

function rushThink(w, p, qb) {
  const target = qb || slotOf(w, "O", "QB") || w.ball;
  let tx = target.x, ty = target.y;
  if (p.ai.contain && Math.abs(p.y - ty) > 1.0) {
    // keep outside leverage until level with the QB
    const out = p.homeY < w.ballY || (p.homeY === w.ballY && parOf(w) < 0) ? -1 : 1;
    if (p.x > target.x + 1.5) ty = target.y + out * 1.6;
  }
  // linemen engaged: push toward the QB (physics handles it); free: go
  steer(w, p, tx - 0.3, ty, 1, 0);
  // AI sack dive
  if (!p.isUser && qb && qb.hasBall && Math.hypot(p.x - qb.x, p.y - qb.y) < 1.9 && Math.hypot(p.x - qb.x, p.y - qb.y) > 1.0 && w.rng.chance(0.06)) dive(w, p, qb.x, qb.y);
}

function manThink(w, p, dt) {
  const r = p.ai.target;
  if (!r) return zoneThink(w, p);
  const skill = skillOf(w, p);
  // reaction lag: the defender reacts to the receiver's velocity with a delay (a man already in
  // jet motion at the snap leaves him a step behind)
  let lag = CFG.COVER_LAG * (1.3 - 0.6 * skill) * clamp(80 / Math.max(30, p.r.agility), 0.7, 1.5);
  const mo = w.play.off.motion;
  if (mo && r.slot === mo.slot && w.play.t < 1.4) lag *= 3;
  const k = Math.min(1, w.dtStep / lag);
  p.ai.seenVx += (r.vx - p.ai.seenVx) * k;
  p.ai.seenVy += (r.vy - p.ai.seenVy) * k;
  const cushion = p.ai.cushion || 1.5;
  const depthBias = r.x < p.x - 0.5 ? 0 : cushion * 0.5;
  let tx = r.x + p.ai.seenVx * 0.35 + cushion * 0.55 + depthBias;
  let ty = r.y + p.ai.seenVy * 0.35 + (r.y < w.ballY || (r.y === w.ballY && parOf(w) < 0) ? 0.45 : -0.45);
  // before the receiver gets going, hold the cushion (on the field: not past the end line behind him)
  steer(w, p, Math.min(tx, 108.5), ty, 1, tx > 108.5 ? 2 : 0.4);
}

function zoneThink(w, p) {
  const z = p.ai.zone;
  if (!z) return steer(w, p, w.los + 6, p.homeY, 0.7, 1);
  const [zx, zy, zr] = z;
  // most dangerous receiver in my zone
  let best = null, bd = 1e9;
  for (const r of w.offPlayers) {
    if (r.ai.job !== "route") continue;
    const dd = Math.hypot(r.x - zx, r.y - zy);
    if (dd < zr + 2 && dd < bd) { bd = dd; best = r; }
  }
  if (best) {
    const tx = zx * 0.3 + (best.x + best.vx * 0.3 + 1) * 0.7;
    const ty = zy * 0.3 + (best.y + best.vy * 0.3) * 0.7;
    return steer(w, p, tx, ty, 0.95, 0.4);
  }
  steer(w, p, zx, zy, 0.8, 1.0);
}

// Deep zone: stay on top of the deepest threat in (or coming into) my area, shading his side.
function deepThink(w, p) {
  const z = p.ai.zone;
  const [zx, zy, zr] = z;
  let deepest = null, dv = -1e9;
  for (const r of w.offPlayers) {
    if (r.ai.job !== "route") continue;
    if (Math.abs(r.y + r.vy * 0.4 - zy) > zr + 5) continue;
    const v = r.x + Math.max(0, r.vx) * 0.5;
    if (v > dv) { dv = v; deepest = r; }
  }
  let tx = zx, ty = zy;
  if (deepest) {
    tx = Math.max(zx - 2, deepest.x + 2.6 + Math.max(0, deepest.vx) * 0.35);
    ty = zy * 0.22 + (deepest.y + deepest.vy * 0.3) * 0.78;
  }
  steer(w, p, Math.min(tx, 109), clamp(ty, 2, FW - 2), 0.95, 0.8);
}

// Chase the carrier: an intercept course (where can I meet him?), leverage when I'm in front of him
// (stay between him and the goal line, mirror his cuts), and break down to close when near.
export function pursue(w, d, c, dt) {
  if (d.engaged) return;
  if (d.blockers.length) {
    // fight through toward the carrier
    steer(w, d, c.x, c.y, 1, 0);
    return;
  }
  const skill = skillOf(w, d);
  const human = c.isUser && w.userActive;
  const rx = c.x - d.x, ry = c.y - d.y;
  const dd = Math.hypot(rx, ry);
  const sp = maxSpeed(w, d);
  const dir = w.dirOf(c);
  let vx = c.vx, vy = c.vy;
  // the human cuts hard: read his velocity a bit more cautiously (aim toward the goal line too)
  if (human) {
    vx = vx * 0.75 + dir * Math.max(0, c.r.speed * 0.25);
    vy *= 0.6;
  }
  // earliest time T with |c + v T - d| = sp T
  const a = vx * vx + vy * vy - sp * sp;
  const bq = 2 * (rx * vx + ry * vy);
  const cq = dd * dd;
  let T = dd / Math.max(1, sp);
  let solved = false;
  if (Math.abs(a) > 1e-6) {
    const disc = bq * bq - 4 * a * cq;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      const t1 = (-bq - s) / (2 * a), t2 = (-bq + s) / (2 * a);
      const tt = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
      if (tt > 0) {
        T = tt;
        solved = true;
      }
    }
  }
  // he's faster and I can't meet him: take the angle that cuts off his path to the goal line
  if (!solved && vx * dir > 2) T = clamp(((dir > 0 ? 100 : 0) - c.x) / vx, 0.6, 2.6);
  const lead = human ? 0.9 : 0.72 + 0.28 * skill;
  T = clamp(T, 0, solved ? 1.8 : 2.6) * lead;
  const ahead = (d.x - c.x) * dir; // > 0: I'm between him and the goal line
  // in front of him: shade his lateral cut instead of flying past it (leverage)
  const latK = ahead > 0.8 && dd < 10 ? 0.75 : 1;
  let tx = c.x + vx * T + dir * 0.4, ty = c.y + vy * T * latK;
  if (dd < 1.5) {
    // wrap up: aim right at him (a hair ahead) — no overrunning
    tx = c.x + vx * 0.15;
    ty = c.y + vy * 0.15;
  }
  steer(w, d, tx, clamp(ty, -1, FW + 1), 1, 0);
  if (!d.isUser && !d.dived && dd < 2.4 && dd > 1.0) {
    const closing = ((c.x - d.x) * (d.vx - c.vx) + (c.y - d.y) * (d.vy - c.vy)) / Math.max(0.1, dd);
    // trailing him step for step: lunge for the shoestrings
    const trailing = (d.x - c.x) * c.vx + (d.y - c.y) * c.vy < 0 && Math.hypot(c.vx, c.vy) > 3;
    const p = closing > 1.5 && dd < 2.2 ? 0.022 + 0.03 * skill + (human ? 0.012 : 0) : trailing && dd < 2.2 ? 0.05 + 0.05 * skill : 0;
    if (p > 0 && w.rng.chance(p)) dive(w, d, c.x + c.vx * 0.25, c.y + c.vy * 0.25);
  }
}

// Pass in the air.
function offenseAirThink(w, p, dt) {
  const b = w.ball;
  if (p === b.target) {
    // (a ball sailing out the back of the end zone: he stays on the field)
    steer(w, p, Math.min(b.aimX, 109), b.aimY, 1, b.aimX > 108 ? 1.5 : 0.25);
    return;
  }
  if (p.ai.job === "block") return blockThink(w, p, dt);
  // other receivers drift toward the ball to block after the catch
  const dx = b.aimX - p.x, dy = b.aimY - p.y;
  if (Math.hypot(dx, dy) < 15) return steer(w, p, b.aimX - 1, b.aimY + (p.y > b.aimY || (p.y === b.aimY && parOf(w) < 0) ? 3 : -3), 0.6, 1);
  p.tvx *= 0.9;
  p.tvy *= 0.9;
}
function defenseAirThink(w, d, dt) {
  const b = w.ball;
  if (d.engaged || d.blockers.length) return;
  const skill = skillOf(w, d);
  const react = CFG.BALL_REACT * (1.4 - 0.7 * skill);
  const since = w.time - b.tSpawn;
  const remain = Math.max(0.05, b.tArrive - w.time);
  const dd = Math.hypot(b.aimX - d.x, b.aimY - d.y);
  const sp = maxSpeed(w, d);
  // a long ball hangs: anyone who can get under it goes (jump ball)
  if (since > react && dd < Math.max(13, remain * sp * 0.95) && dd / sp < remain + 0.9) {
    steer(w, d, Math.min(b.aimX, 109), b.aimY, 1, b.aimX > 108 ? 1.5 : 0.2);
    return;
  }
  if (d.ai.job === "man" && d.ai.target) return manThink(w, d, dt);
  if (d.ai.job === "rush") {
    d.tvx *= 0.9;
    d.tvy *= 0.9;
    return;
  }
  // drift toward the ball
  steer(w, d, b.aimX, b.aimY, 0.7, 1);
}

function kickCoverThink(w, p, dt) {
  const b = w.ball;
  // field goal / PAT in the air: everybody eases up and watches
  if (b.kind === "fg") {
    p.tvx *= 0.9;
    p.tvy *= 0.9;
    return;
  }
  if (p.team === w.offense) {
    if (p.engaged) return;
    return steer(w, p, Math.min(b.landX || b.aimX, 108), b.aimY + (p.homeY - w.ballY) * 0.4, p.ai.job === "gunner" ? 1 : 0.8, 1);
  }
  if (p.ai.job === "kickret") return steer(w, p, Math.min(b.landX || b.aimX, 109), b.aimY + (p.homeY - w.ballY) * 0.2, 0.9, 1);
  p.tvx *= 0.9;
  p.tvy *= 0.9;
}

// ---------- CPU play calling ----------
function weighted(rng, table) {
  let sum = 0;
  for (const k in table) sum += Math.max(0, table[k]);
  let r = rng.next() * sum;
  let lastK = null;
  for (const k in table) {
    const v = Math.max(0, table[k]);
    if (!(v > 0)) continue; // a zero weight is never picked (not even on an exact-zero roll)
    lastK = k;
    r -= v;
    if (r <= 0) return k;
  }
  return lastK || Object.keys(table)[0];
}

export function cpuFourthDown(w, teamKey) {
  const los = w.los, toGo = w.toGo;
  const sd = w.scoreDiff(teamKey);
  const inFG = los >= CFG.FG_RANGE_LOS;
  const ag = teamAggression(w, teamKey);
  // overtime: a punt or a short field goal while trailing (answering the other team's field goal) loses it
  if (w.overtime) return inFG && sd >= -3 ? "fg" : sd < 0 || (toGo <= 2 && los >= 45) ? "go" : "punt";
  const late = w.quarter >= 4 && w.clock < 75;
  if (late && sd < 0) {
    if (-sd <= 3 && inFG) return "fg";
    return "go";
  }
  if (late && sd > 0 && !inFG && toGo > 1) return "punt";
  if (toGo <= 1 && los >= 38 - 12 * (ag - 0.5)) return "go";
  if (toGo <= 3 && los >= 52 - 10 * (ag - 0.5) && !inFG) return "go";
  if (ag > 0.6 && toGo <= 4 && los >= 58 && !inFG) return "go";
  if (inFG) return toGo <= 1 && los >= 92 - 6 * (ag - 0.5) ? "go" : "fg";
  return "punt";
}

// FLIP (CFG.CPU_FLIP): the CPU's offense flips its calls too, so a play's name doesn't give its side away. With the ball on
// a hash a play that goes outside (playbook `wide`) attacks the wide side of the field CPU_WIDE_P of the time; anything
// else is a coin flip. Kicks never flip. The CPU's defense doesn't: it sets to the formation's strength (world.js
// toPreSnap), so a flipped offense meets it lined up as the plays were drawn, mirrored.
export function cpuFlip(w, side, id) {
  if (!CFG.CPU_FLIP || side !== "off") return false;
  const play = offPlay(id);
  if (!play || play.type === "kick" || play.id !== id) return false;
  const lean = w.ballY - FW / 2; // > 0: the ball sits toward the bottom sideline, the wide side is the top (dy < 0)
  if (play.wide && Math.abs(lean) >= CFG.CPU_HASH_OFF) {
    const wideSide = lean > 0 ? -1 : 1;
    const toWide = w.rng.chance(CFG.CPU_WIDE_P);
    return (play.wide === wideSide) !== toWide;
  }
  return w.rng.chance(0.5);
}

const RUNS = ["dive", "sweep", "counter", "hbDraw", "reverse", "qbSneak"];
const PASSES = ["slants", "curlflat", "verts", "papost", "screen", "wrScreen", "teSeam", "hailMary"];

export function cpuOffenseCall(w, teamKey) {
  const rng = w.rng;
  const down = w.down, toGo = w.toGo, los = w.los;
  const sd = w.scoreDiff(teamKey);
  const late = (w.quarter === 2 || w.quarter >= 4) && w.clock < 45 && !w.overtime; // (overtime is untimed)
  // trailing on the half's / game's last snap: only a pass can stop the clock (a run that is stopped
  // in bounds ends it), so no runs at all — applied after the team-identity factors below
  const lastSnap = late && sd < 0 && w.clock < 6;
  // QB Sneak only at 1 to go (it converts poorly; never a 1st & 10 call)
  const t = { dive: 1, sweep: 0.8, counter: 0.7, hbDraw: 0.4, reverse: 0.1, qbSneak: 0, slants: 0.9, curlflat: 1, verts: 0.6, papost: 0.65, screen: 0.3, wrScreen: 0.3, teSeam: 0.7, hailMary: 0 };
  // a small 1st-down dive lean (stopgap: the dive averages ~1.6 yd/carry in even matchups until the blocking rework)
  if (down === 1) { t.dive += 0.2; t.papost += 0.3; t.teSeam += 0.2; }
  if (toGo >= 8 && down >= 2) { t.dive = 0.25; t.sweep = 0.25; t.counter = 0.25; t.hbDraw = 0.55; t.qbSneak = 0; t.curlflat += 0.8; t.verts += 0.6; t.slants += 0.3; t.screen += 0.3; t.wrScreen += 0.3; t.teSeam += 0.4; }
  if (toGo <= 2) { t.dive += 1.4; t.counter += 0.4; t.slants += 0.4; t.verts = 0.15; t.hbDraw = 0.2; t.qbSneak = toGo <= 1 ? 1.4 : 0; }
  if (los >= 88) { t.dive += 0.8; t.counter += 0.4; t.slants += 0.2; t.curlflat += 0.4; t.papost += 0.3; t.verts = 0.1; t.screen = 0.2; t.wrScreen = 0.3; t.teSeam += 0.2; t.reverse = 0.04; if (los >= 97 && toGo <= 1) t.qbSneak += 0.8; }
  if (late && sd < 0) {
    t.dive = 0.1; t.sweep = 0.1; t.counter = 0.1; t.hbDraw = 0.1; t.qbSneak = 0; t.reverse = 0.05;
    t.verts += 1.4; t.curlflat += 0.8; t.slants += 0.4; t.teSeam += 0.5; t.screen *= 0.5; t.wrScreen *= 0.5;
    if (w.clock < 9 && 100 - los > 28 && (w.quarter === 2 || -sd > 3 || los < CFG.FG_RANGE_LOS)) t.hailMary = 8;
  }
  if (late && sd > 0) { t.dive += 1.5; t.sweep += 0.6; t.counter += 0.4; t.verts = 0.05; t.hailMary = 0; }
  // team identity
  const style = teamStyle(w, teamKey);
  if (style === "air") {
    for (const k of PASSES) t[k] *= 1.35;
    t.verts *= 1.5;
    t.papost *= 1.2;
    for (const k of RUNS) t[k] *= 0.7;
  } else if (style === "ground") {
    // they'll run on you even when you know it's coming
    if (toGo >= 8 && !(late && sd < 0)) { t.dive += 0.35; t.counter += 0.3; t.hbDraw += 0.4; }
    for (const k of RUNS) t[k] *= 1.9;
    t.papost *= 1.3;
    for (const k of PASSES) if (k !== "papost") t[k] *= 0.66;
    t.verts *= 0.7;
  } else if (style === "trick") {
    t.papost *= 1.8;
    t.reverse = (t.reverse + 0.12) * 3;
    t.hbDraw *= 1.6;
    t.screen *= 1.5;
    t.wrScreen *= 1.5;
    t.counter *= 1.3;
  }
  if (lastSnap) for (const k of RUNS) t[k] = 0; // after identity: trick teams re-add the reverse
  // keep it varied: don't repeat the last call too often
  const last = w.lastCall[teamKey];
  if (last && t[last] != null) t[last] *= 0.45;
  const id = weighted(rng, t);
  w.lastCall[teamKey] = id;
  return id;
}

export function cpuDefenseCall(w, teamKey) {
  const rng = w.rng;
  const down = w.down, toGo = w.toGo;
  const oppDiff = -w.scoreDiff(teamKey);
  const late = w.quarter >= 4 && w.clock < 60 && !w.overtime;
  const t = { base: 1.3, blitz: 0.5, cover2: 1, runstop: 0.7, prevent: 0.05, zoneBlitz: 0.4, cover3: 0.9, goalLine: 0 };
  if (toGo <= 2) { t.runstop += 1.4; t.blitz += 0.3; t.cover2 = 0.4; t.cover3 = 0.4; t.goalLine += toGo <= 1 ? 0.7 : 0.2; }
  if (toGo >= 8 && down >= 2) { t.cover2 += 0.8; t.base += 0.3; t.runstop = 0.15; t.blitz += 0.3; t.zoneBlitz += 0.5; t.cover3 += 0.6; }
  if (w.los >= 92) { t.runstop += 0.7; t.blitz += 0.3; t.goalLine += w.los >= 97 ? 2.6 : 1.0; t.prevent = 0; }
  if (w.tryMode) { t.goalLine += 1.5; t.blitz += 0.4; }
  if (late && oppDiff < 0 && oppDiff >= -8) { t.prevent += 1.6; t.cover2 += 0.5; t.cover3 += 0.4; t.blitz *= 0.4; t.zoneBlitz *= 0.4; }
  if (late && oppDiff < 0 && w.clock < 9 && w.los < 72) t.prevent += 3;
  const skill = w.teams[teamKey].data.skill;
  if (skill < 0.5) { t.blitz *= 0.6; t.zoneBlitz *= 0.6; }
  const style = teamStyle(w, teamKey);
  if (style === "blitz") { t.blitz *= 2.2; t.zoneBlitz *= 2.6; t.runstop *= 1.2; }
  else if (style === "ground") { t.runstop *= 1.3; t.base *= 1.1; }
  else if (style === "air") { t.cover2 *= 1.15; t.cover3 *= 1.15; }
  const key = "def_" + teamKey;
  const last = w.lastCall[key];
  if (last && t[last] != null) t[last] *= 0.6;
  const id = weighted(rng, t);
  w.lastCall[key] = id;
  return id;
}

// Onside kick? Trailing late (one or two scores, the clock running out); trick teams now and then.
export function cpuOnside(w, kickTeam) {
  if (w.overtime) return false;
  if (onsideTime(w, kickTeam)) return true;
  if (w.quarter <= 3 && teamStyle(w, kickTeam) === "trick" && w.rng.chance(0.035)) return true;
  return false;
}
// The situation that calls for an onside kick (the receiving team sees it coming): trailing late by one or two scores.
export function onsideTime(w, kickTeam) {
  const sd = w.scoreDiff(kickTeam);
  return !w.overtime && w.quarter >= 4 && sd < 0 && sd >= -16 && w.clock < w.quarterSec * 0.4;
}

// PAT or 2-point try, by the classic chart late; aggressive / trick teams gamble now and then.
const TWO_AHEAD = [1, 4, 5, 12, 15, 19];
const TWO_BEHIND = [-2, -5, -9, -12, -16];
export function cpuPatChoice(w, team) {
  const lead = w.scoreDiff(team);
  const late = w.quarter >= 4 || (w.quarter === 3 && w.clock < w.quarterSec * 0.3);
  if (late) return TWO_AHEAD.includes(lead) || TWO_BEHIND.includes(lead) ? "two" : "kick";
  const ag = teamAggression(w, team);
  const style = teamStyle(w, team);
  if (w.rng.chance(0.015 + Math.max(0, ag - 0.5) * (style === "trick" ? 0.35 : 0.15))) return "two";
  return "kick";
}

export const ALL_OFF = OFF_PLAYS.map((p) => p.id);
export const ALL_DEF = DEF_PLAYS.map((p) => p.id);
