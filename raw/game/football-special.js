// Special teams (football team): kickoffs (deep, onside, free kicks after a safety), punts once the
// ball is away (coverage, fielding, fair catches, bouncing balls, downing), and kick returns (return
// blocking, the returner). Pure simulation: no DOM; randomness via w.rng; events via w.emit.
//
// Frames: during a KICKOFF the receiving team is the offense (w.possession, moves right, x from its own
// goal line) and the kicking team kicks from x = w.kickSpot toward x = 0. During a PUNT the punting
// team stays the offense and the returner (defense) runs back toward x = 0. world.js owns the rules
// (results, possession, scoring); this module owns positions, the kick's flight and who does what.
import { CFG } from "./config.js";
import { clamp } from "./util.js";
import { steer, maxSpeed } from "./physics.js";
import { carryThink, pursue, engageMove } from "./ai.js";

const FW = CFG.FIELD_W;
const MID = FW / 2;
const KO_STAGGER = 1.5; // kickoff lines: every other man this much further from the ball (a zigzag)
// The zigzag is presentation only: the deeper men creep up during the kicker's approach
// (preKickStep), so the whole line is set a step behind the ball at the boot. Live and headless
// worlds line up and run the approach the same way, so simulate() measures the real kickoff.
const koStagger = () => KO_STAGGER;

const ONSIDE_SURPRISE_REACT = 0.8; // seconds a receiving team not expecting an onside kick takes to react
const retScore = (p) => p.r.speed * 1.0 + p.r.agility * 0.012 + p.r.hands * 0.006;

// ---------- Kickoff ----------
// Special-teams units drawn from the whole roster: the kicker plus the ten fastest (no QB) cover;
// the receiving side sends its best return man back, two more fliers as upbacks, and its strongest
// bodies up front. Each unit is ordered by role (see setupKickoff).
const RET_POS = { HB: 1, WR: 1, FB: 1, CB: 1, S: 1 };
export function kickoffUnits(w, receiver, kicking) {
  const kt = w.teams[kicking], rt = w.teams[receiver];
  const kPool = [...kt.O, ...kt.D].filter((p) => p.slot !== "QB");
  kPool.sort((a, b) => b.r.speed - a.r.speed);
  const K = [kt.K, ...kPool.slice(0, 10)];
  const rPool = [...rt.O, ...rt.D].filter((p) => p.slot !== "QB");
  const skill = rPool.filter((p) => RET_POS[p.pos]).sort((a, b) => retScore(b) - retScore(a));
  const returner = skill[0] || rPool[0];
  const up = skill.slice(1, 3);
  const rest = rPool.filter((p) => p !== returner && !up.includes(p));
  rest.sort((a, b) => b.r.power + b.r.anchor * 0.5 - (a.r.power + a.r.anchor * 0.5));
  const front = rest.slice(0, 5);
  const others = rest.slice(5).sort((a, b) => b.r.power * 0.5 + b.r.speed * 6 - (a.r.power * 0.5 + a.r.speed * 6));
  const mid = others.slice(0, 3);
  return { R: [returner, ...up, ...mid, ...front], K, roles: { returner, up, mid, front } };
}

// Lines both units up. w.offPlayers = receiving unit, w.defPlayers = kicking unit (kicker first).
// Returns {kicker, returner}.
export function setupKickoff(w, opts = {}) {
  const S = w.kickSpot;
  const free = !!opts.free;
  const R = w.offPlayers, K = w.defPlayers;
  const kicker = K.find((p) => p.slot === "K") || K[0];
  // receiving team: best return man deep, two upbacks, a mid line, the big men up front
  const roles = opts.roles;
  const returner = roles ? roles.returner : R[0];
  const up = roles ? roles.up : R.slice(1, 3);
  const mid = roles ? roles.mid : R.slice(3, 6);
  const front = roles ? roles.front : R.slice(6);
  const deep = free ? 50 : 61.5;
  const place = (p, x, y) => {
    p.homeX = p.x = x;
    p.homeY = p.y = clamp(y, 1.2, FW - 1.2);
    p.facing = 1;
  };
  const onsideLook = !!opts.expectOnside;
  place(returner, S - deep, MID);
  up.forEach((p, i) => place(p, S - (onsideLook ? 24 : deep - 12), MID + (i ? 5.5 : -5.5)));
  mid.forEach((p, i) => place(p, S - (onsideLook ? 18 : 30), MID + (i - (mid.length - 1) / 2) * 11));
  // the front line zigzags (every other man 1.5 yd deeper, away from the ball) so the sprites don't
  // stack into one overlapping column on screen
  // (the hands team crowds the restraining line when it smells an onside kick)
  front.forEach((p, i) => place(p, S - (onsideLook ? 16 : 13.5) - (i % 2 ? koStagger(w) : 0), MID + (i - (front.length - 1) / 2) * 9));
  if (w.play) w.play.onsideLook = onsideLook;
  for (const p of up) p.ai.wallDepth = 8;
  for (const p of mid) p.ai.wallDepth = 17;
  for (const p of front) p.ai.wallDepth = 27;
  w.kickSide = w.rng.chance(0.5) ? 1 : -1;
  alignKickingTeam(w, !!opts.onside, true);
  for (const p of w.players) {
    p.vx = p.vy = p.tvx = p.tvy = 0;
    p.ai.job = "idle";
  }
  returner.ai.job = "returner";
  for (const p of K) p.ai.job = p === kicker ? "kicksafety" : "cover";
  for (const p of R) if (p !== returner) p.ai.job = "retblock";
  return { kicker, returner };
}

// Kicking team: ten across one yard behind the ball (fastest on the edges), the kicker deeper for
// his run-up; the onside look bunches them toward the kick side. place = teleport (initial setup).
export function alignKickingTeam(w, onside, place) {
  const S = w.kickSpot;
  const K = w.defPlayers;
  const kicker = K.find((p) => p.slot === "K") || K[0];
  const cover = K.filter((p) => p !== kicker);
  const side = w.kickSide || 1;
  const lanes = onside
    ? [1.5, 3.5, 5.5, 7.5, 9.5, 12, -3.5, -8, -14, -20].map((v) => v * side)
    : [-22, -17.5, -12.5, -7.5, -3, 3, 7.5, 12.5, 17.5, 22];
  const sorted = cover.slice().sort((a, b) => a.r.speed - b.r.speed); // fastest to the edges (gunners)
  const laneOrder = onside ? lanes.slice() : lanes.slice().sort((a, b) => Math.abs(a) - Math.abs(b));
  if (onside) sorted.reverse(); // onside: the fastest in the bunch
  // ...but a late shift (B, or the CPU's call) keeps every man on his side: lanes in lateral order, nobody crosses
  if (onside && !place) {
    sorted.sort((a, b) => a.y - b.y);
    laneOrder.sort((a, b) => a - b);
  }
  // zigzag: every other man across the field (in sideline-to-sideline order) lines up 1.5 yd further
  // back (away from the ball), so the line reads as a staggered row instead of a totem pole of sprites
  const byY = sorted.map((p, i) => laneOrder[i % laneOrder.length]).sort((a, b) => a - b);
  sorted.forEach((p, i) => {
    const dy = laneOrder[i % laneOrder.length];
    p.homeX = S + 1.0 + (byY.indexOf(dy) % 2 ? koStagger(w) : 0);
    p.homeY = clamp(MID + dy, 1.2, FW - 1.2);
    p.ai.lane = p.homeY;
    // the two middle men trail the first wave as a safety net
    p.ai.trail = !onside && Math.abs(dy) < 4 ? 1 : 0;
    if (place) {
      p.x = p.homeX;
      p.y = p.homeY;
    }
    p.facing = -1;
  });
  kicker.homeX = S + 5.5;
  kicker.homeY = MID - 1.2;
  if (place) {
    kicker.x = kicker.homeX;
    kicker.y = kicker.homeY;
  }
  kicker.facing = -1;
}

// Pre-kick: everybody to his spot (a late onside shift hustles); the kicker runs up to the ball.
// By the rules the cover men may not cross the ball before it's kicked (and get no real running
// start): as the kicker starts his approach they creep up and set a step behind the ball, so the boot
// comes with the line still behind it, live and headless alike. (A full-speed running start put them
// on the ball at the boot and won ~90% of expected onside kicks.)
export const KO_SET_BEHIND = 0.6; // where the cover line sets, yards behind the ball
export function preKickStep(w, kicker, dt, approachLeft) {
  const S = w.kickSpot;
  for (const p of w.players) {
    if (p === kicker && approachLeft < 0.75) {
      steer(w, p, S + 0.4, MID - 0.4, 0.75, 0.3);
      continue;
    }
    if (p !== kicker && p.team !== w.offense && approachLeft < 0.75) {
      steer(w, p, S + KO_SET_BEHIND, p.homeY, 0.9, 0.9);
      if (p.x < S + KO_SET_BEHIND) {
        // never past the line before the boot
        if (p.vx < 0) p.vx = 0;
        if (p.tvx < 0) p.tvx = 0;
      }
      if (Math.abs(p.x - (S + KO_SET_BEHIND)) < 0.3 && Math.abs(p.y - p.homeY) < 0.3) p.facing = -1;
      continue;
    }
    const d = steer(w, p, p.homeX, p.homeY, 0.9, 0.6);
    if (d < 0.3) {
      p.tvx = p.tvy = 0;
      p.facing = p.team === w.offense ? 1 : -1;
    }
  }
}

// The boot. kind 'deep' | 'onside'. The ball: 'air' (kind 'kickoff') for deep kicks, a hopping
// 'loose' ball (kind 'kick') for onside kicks.
export function launchKickoff(w, kicker, kind, free) {
  const b = w.ball;
  const S = w.kickSpot;
  const kn = clamp((kicker.r.kick - 50) / 60, 0, 1);
  b.carrier = null;
  b.from = kicker;
  b.target = null;
  b.resolved = false;
  b.bounces = 0;
  b.touchedR = false;
  b.x = S - 0.3;
  b.y = MID;
  b.z = 0.15;
  b.tSpawn = w.time;
  if (kind === "onside") {
    const side = w.kickSide || 1;
    const dist = CFG.ONSIDE_DIST + w.rng.range(-1.2, 1.8);
    const ay = MID + side * w.rng.range(5, 11);
    b.state = "loose";
    b.kind = "kick";
    b.onside = true;
    // driven into the turf: one big hop the cover men can run under, then skips (looseKickStep)
    b.vx = -dist / 1.75;
    b.vy = (ay - MID) / 2.1;
    b.vz = 5.4;
    b.aimX = S - dist;
    b.aimY = ay;
    b.landX = b.aimX;
    b.tArrive = w.time + 0.8;
    return { distance: dist };
  }
  const depth = (free ? CFG.KICK_DEPTH - 9 : CFG.KICK_DEPTH) + 7 * kn + w.rng.range(-5.5, 5);
  const T = CFG.KICK_HANG + 0.45 * kn + w.rng.range(-0.25, 0.25);
  b.onside = false;
  b.state = "air";
  b.kind = "kickoff";
  b.aimX = S - depth;
  b.aimY = MID + w.rng.range(-10, 10);
  b.landX = b.aimX;
  b.tArrive = w.time + T;
  b.vx = (b.aimX - b.x) / T;
  b.vy = (b.aimY - b.y) / T;
  b.vz = (CFG.CATCH_Z - b.z + 0.5 * CFG.KICK_GRAVITY * T * T) / T;
  return { distance: depth };
}

// ---------- Punt (after the boot) ----------
// Called by the world when the punt leaves the punter's foot: assigns the return team's jobs.
export function puntAway(w) {
  const b = w.ball;
  const play = w.play;
  play.kickAway = true;
  const ret = play.returner;
  if (ret) ret.ai.job = "returner";
  for (const p of w.defPlayers) if (p !== ret) p.ai.job = "retblock";
  for (const p of w.offPlayers) if (p.slot !== "K") p.ai.job = "cover";
  const k = w.offPlayers.find((p) => p.slot === "K");
  if (k) k.ai.job = "kicksafety";
  // lanes: spread the coverage across the field toward the landing spot
  const cov = w.offPlayers.filter((p) => p.ai.job === "cover").sort((a, b) => a.y - b.y);
  cov.forEach((p, i) => (p.ai.lane = clamp(b.aimY + (i - (cov.length - 1) / 2) * 4.2, 3, FW - 3)));
  assignReturnBlocks(w);
  // CPU returner: let the deep ones bounce (hoping for a touchback); fair catches in kickFlightStep
  play.letBounce = !ret || (!retIsHuman(w, ret) && (b.aimX > 96.5 || (b.aimX > 91 && w.rng.chance(0.75))));
}

// The punt team: the long snapper (C), the punter, the two fastest as gunners and seven more
// athletes (speed + strength) to protect and cover. spots: player → formation spot (stSlot).
export function puntUnit(team) {
  const c = team.O.find((p) => p.slot === "C") || team.O[0];
  const pool = [...team.O, ...team.D].filter((p) => p !== c && p.slot !== "QB");
  pool.sort((a, b) => b.r.speed - a.r.speed);
  const gunners = pool.slice(0, 2);
  const rest = pool.slice(2).sort((a, b) => b.r.power * 0.5 + b.r.speed * 9 - (a.r.power * 0.5 + a.r.speed * 9));
  const body = rest.slice(0, 7).sort((a, b) => b.r.power - a.r.power);
  const spots = new Map();
  spots.set(c, "C");
  spots.set(team.K, "K");
  gunners.forEach((p, i) => spots.set(p, i ? "WR2" : "WR1"));
  ["LG", "RG", "LT", "RT", "FB", "TE", "HB"].forEach((s, i) => body[i] && spots.set(body[i], s));
  return { players: [...spots.keys()], spots };
}

// Punt formation extras: the best return man back deep, set before the snap.
export function puntReturner(w) {
  const cands = w.defPlayers.filter((p) => p.pos === "CB" || p.pos === "S");
  cands.sort((a, b) => retScore(b) - retScore(a));
  return cands[0] || w.defPlayers[w.defPlayers.length - 1];
}

const retIsHuman = (w, p) => p && p.isUser && !w.autoplay && w.human === p.team;

// ---------- Flight / arrival ----------
// Kicked ball in the air (kickoff or punt). Returns true when the ball's fate is decided this step.
export function kickFlightStep(w, dt) {
  const b = w.ball;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  b.vz -= CFG.KICK_GRAVITY * dt;
  b.spin += dt * 9;
  const play = w.play;
  // CPU fair-catch signal on punts, about a second out
  if (b.kind === "punt" && !play.fairCatch && !play.fairCatchChecked && w.time >= b.tArrive - 0.9) {
    play.fairCatchChecked = true;
    const ret = play.returner;
    if (ret && !retIsHuman(w, ret) && !play.letBounce) {
      const eta = coverEta(w, b.aimX, b.aimY);
      const left = b.tArrive - w.time;
      if (eta < left + 0.1 && w.rng.chance(0.85)) signalFairCatch(w, ret);
    }
  }
  if (!play.arrived && w.time >= b.tArrive) {
    play.arrived = true;
    if (arrival(w)) return true;
  }
  if (b.state === "air" && b.z <= 0) {
    // nobody fielded it: it hits the turf and skips on
    b.z = 0;
    b.state = "loose";
    b.vz = Math.max(1.2, -b.vz * 0.38);
    b.vx *= b.kind === "punt" ? 0.45 : 0.5;
    b.vy *= 0.5;
    b.kind = "kick";
    b.bounces = 1;
    b.restT = 0;
    w.emit("kickBounce", { x: b.x, y: b.y });
  }
  return false;
}

// The moment the kick comes down to catching height.
function arrival(w) {
  const b = w.ball;
  const play = w.play;
  const punt = b.kind === "punt";
  const recvTeam = punt ? w.defense : w.offense;
  if (punt && b.x >= 100) {
    // into the end zone: touchback, nobody fields that
    return touchback(w, null, "punt", false);
  }
  if (punt && play.letBounce) return false;
  // who's under it?
  let best = null, bd = CFG.KICK_CATCH_R;
  const list = punt ? w.defPlayers : w.offPlayers;
  for (const p of list) {
    if (p.downUntil > w.time || p.state === "tackled" || p.engaged || p.blockers.length) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return false;
  // coverage in his face?
  let gd = 9;
  const other = punt ? w.offPlayers : w.defPlayers;
  for (const d of other) {
    if (d.downUntil > w.time || d.state === "tackled") continue;
    gd = Math.min(gd, Math.hypot(d.x - best.x, d.y - best.y));
  }
  if (punt && play.fairCatch) {
    // a fair catch: the play is over where he catches it (rarely muffed)
    if (w.rng.chance(0.012)) return muff(w, best);
    b.holdBy(best);
    w.emit("fairCatch", { player: best, stage: "catch" });
    w.endPlay({ type: "fairCatch", spot: best.x, y: best.y, carrier: best, team: recvTeam });
    return true;
  }
  const hands = clamp(best.r.hands / 75, 0.6, 1.4);
  const pMuff = (CFG.MUFF_P + (gd < 1.7 ? 0.05 : gd < 3 ? 0.015 : 0)) / hands;
  if (w.rng.chance(pMuff)) return muff(w, best);
  b.holdBy(best);
  play.ret = { kind: punt ? "punt" : "kickoff", player: best, catchX: best.x, inEZ: punt ? best.x >= 100 : best.x <= 0 };
  // CPU returners take a knee deep in the end zone
  if (!punt && best.x < -CFG.KNEEL_DEPTH * 0.5 && !retIsHuman(w, best)) {
    const pk = clamp((-best.x - CFG.KNEEL_DEPTH) / 4.5, 0, 0.92) - (best.r.speed > 8 ? 0.15 : 0);
    if (w.rng.chance(pk)) {
      w.emit("catch", { player: best, kick: true });
      return touchback(w, best, "kickoff", true);
    }
  }
  w.emit("catch", { player: best, ret: play.ret.kind });
  w.setCarrier(best, "return");
  // gathering a punt takes a beat before he can turn upfield
  if (punt) best.slowUntil = w.time + 0.5;
  return false;
}

function muff(w, p) {
  const b = w.ball;
  b.state = "loose";
  b.kind = "fumble";
  b.carrier = null;
  b.fumbledBy = p;
  b.x = p.x;
  b.y = p.y;
  b.z = 1.0;
  const a = w.rng.range(0, Math.PI * 2);
  b.vx = Math.cos(a) * 2.5;
  b.vy = Math.sin(a) * 2.5;
  b.vz = 2.5;
  b.tSpawn = w.time;
  w.play.muffed = true;
  w.play.ret = { kind: w.play.kick === "punt" ? "punt" : "kickoff", player: p, catchX: p.x, inEZ: false };
  w.emit("fumble", { carrier: p, tackler: null, muff: true });
  return false;
}

function touchback(w, player, kind, kneel) {
  const team = kind === "punt" ? w.defense : w.offense;
  w.emit("touchback", { team, kind, player, kneel: !!kneel });
  w.endPlay({ type: "touchback", spot: kind === "punt" ? 100 : 0, team, kind, carrier: player });
  return true;
}

export function signalFairCatch(w, p) {
  const play = w.play;
  if (!play || play.fairCatch || play.kick !== "punt" || w.ball.state !== "air" || w.ball.kind !== "punt") return false;
  play.fairCatch = p;
  w.emit("fairCatch", { player: p, stage: "signal" });
  return true;
}

// Fastest coverage man's arrival time at (x, y).
function coverEta(w, x, y) {
  let best = 99;
  for (const p of w.offPlayers) {
    if (p.slot === "K" || p.downUntil > w.time) continue;
    const t = Math.max(0, Math.hypot(p.x - x, p.y - y) - 1.5) / Math.max(4, maxSpeed(w, p));
    if (t < best) best = t;
  }
  return best;
}

// ---------- Bouncing kicks ----------
// A kick on the ground ('loose', kind 'kick'): it skips and rolls; players field it, down it or
// recover it. Returns true when the play ended.
export function looseKickStep(w, dt) {
  const b = w.ball;
  const play = w.play;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.z += b.vz * dt;
  b.vz -= CFG.GRAVITY * dt;
  b.spin += dt * Math.hypot(b.vx, b.vy) * 1.6;
  if (b.z <= 0) {
    b.z = 0;
    if (b.vz < -1.2) {
      // hop: odd bounces for a football
      b.vz = -b.vz * (0.42 + w.rng.range(-0.08, 0.1));
      b.vx *= 0.72;
      b.vy = b.vy * 0.7 + w.rng.range(-1, 1) * Math.min(2.5, Math.abs(b.vx) * 0.3);
      b.bounces++;
    } else {
      b.vz = 0;
      const sp = Math.hypot(b.vx, b.vy);
      const ns = Math.max(0, sp - 4.5 * dt);
      if (sp > 0) {
        b.vx *= ns / sp;
        b.vy *= ns / sp;
      }
    }
  }
  const punt = play.kick === "punt";
  const sp = Math.hypot(b.vx, b.vy);
  b.restT = sp < 0.35 && b.z < 0.05 ? (b.restT || 0) + dt : 0;
  // out of bounds
  if (b.y < -0.3 || b.y > FW + 0.3) {
    // ...inside the receiving team's end zone: touchback
    if (punt ? b.x >= 100 : b.x <= 0) return touchback(w, null, punt ? "punt" : "kickoff", false);
    if (punt) {
      w.endPlay({ type: "downed", spot: clamp(b.x, 0.5, 99.5), y: b.y, oob: true });
    } else {
      const spot = b.touchedR ? clamp(b.x, 1, 99) : CFG.KICKOFF_OOB_SPOT;
      w.endPlay({ type: "kickOob", spot, y: b.y, team: w.offense });
    }
    return true;
  }
  if (punt) {
    if (b.x >= 100) return touchback(w, null, "punt", false);
    // the player's own man may scoop up a punt that got past him and return it (an untouched punt is a live ball);
    // on a hop that's chancy and it can squirt off him, a muff either team can recover (CPU returners let a bouncing
    // punt roll, as real ones do)
    const u = w.userPlayer;
    const ud = u && u.team === w.defense && retIsHuman(w, u) && b.z < 1.15 && u.downUntil <= w.time && u.state !== "tackled" ? Math.hypot(u.x - b.x, u.y - b.y) : Infinity;
    // the punting team downs it (unless he's on it first)
    for (const p of w.offPlayers) {
      if (p.downUntil > w.time || p.state === "tackled" || b.z > 1.0) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < 0.85 && !(ud < 0.9 && ud < d)) {
        w.emit("puntDowned", { player: p, x: b.x });
        w.endPlay({ type: "downed", spot: b.x, y: b.y, by: p });
        return true;
      }
    }
    if (ud < 0.9) {
      const hop = b.z > 0.45 || sp > 5;
      if (w.rng.chance((hop ? 0.11 : 0.4) * clamp(u.r.hands / 75, 0.6, 1.3))) {
        b.holdBy(u);
        play.ret = { kind: "punt", player: u, catchX: u.x, inEZ: false };
        w.emit("catch", { player: u, ret: "punt" });
        w.setCarrier(u, "return");
        u.slowUntil = w.time + 0.5;
        return false;
      }
      if (hop && w.rng.chance(0.03)) return muff(w, u);
    }
    if (b.restT > 0.45) {
      w.endPlay({ type: "downed", spot: b.x, y: b.y });
      return true;
    }
    return false;
  }
  // kickoff: the receiving team picks it up and returns it; the kicking team may recover once it
  // has gone ten yards (or a receiver touched it)
  if (b.x <= -9.5) return touchback(w, null, "kickoff", false);
  const S = w.kickSpot;
  const tenYards = b.x <= S - 10 || b.touchedR;
  const low = b.z < 1.15;
  if (!low) return false;
  let pick = null, pd = 0.9;
  for (const p of w.players) {
    if (p.downUntil > w.time || p.state === "tackled" || p.engaged || p.blockers.length) continue;
    if (p.team !== w.offense && !tenYards) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < pd) { pd = d; pick = p; }
  }
  if (pick) {
    const hop = b.z > 0.45 || sp > 5;
    const hands = clamp(pick.r.hands / 75, 0.6, 1.3);
    // an onside kick takes crazy hops: nobody fields it cleanly while it's bouncing (tuned with ONSIDE_SHIFT and the
    // hands team's depth: the kicking team recovers ~12% of the onside kicks the receivers expect, ~30% of surprises)
    const recv = pick.team === w.offense;
    const pr = (b.onside ? (recv ? (hop ? 0.055 : 0.18) : hop ? 0.09 : 0.34) : recv ? (hop ? 0.11 : 0.4) : hop ? 0.085 : 0.32) * hands;
    if (recv) b.touchedR = true;
    if (b.onside && !w.rng.chance(pr) && w.rng.chance(0.08)) {
      // it caroms off him
      b.vx += w.rng.range(-3, 3);
      b.vy += w.rng.range(-3, 3);
      b.vz = Math.max(b.vz, w.rng.range(1, 2.6));
      return false;
    }
    if (w.rng.chance(pr)) {
      if (pick.team === w.offense) {
        // fielded: return it (or down it in the end zone)
        b.holdBy(pick);
        play.ret = { kind: "kickoff", player: pick, catchX: pick.x, inEZ: pick.x <= 0 };
        if (b.onside) {
          w.emit("onsideRecovered", { team: w.defense, success: false, player: pick });
          w.endPlay({ type: "kickRecovery", spot: pick.x, y: pick.y, recoveredBy: pick, onside: true });
          return true;
        }
        if (pick.x <= 0 && !retIsHuman(w, pick) && w.rng.chance(0.6)) return touchback(w, pick, "kickoff", true);
        w.emit("catch", { player: pick, ret: "kickoff" });
        w.setCarrier(pick, "return");
        return false;
      }
      // kicking team's ball
      w.emit("fumbleDive", { player: pick });
      pick.downUntil = w.time + 1;
      if (b.onside) w.emit("onsideRecovered", { team: w.defense, success: true, player: pick });
      w.endPlay({ type: "kickRecovery", spot: b.x, y: b.y, recoveredBy: pick, onside: !!b.onside, big: true });
      return true;
    }
  }
  if (b.restT > 1.4) {
    // nobody wanted it
    if (b.x <= 0) return touchback(w, null, "kickoff", false);
    w.endPlay({ type: "kickOob", spot: clamp(b.x, 1, 99), y: b.y, team: w.offense });
    return true;
  }
  return false;
}

// ---------- AI once the kick is away ----------
export function think(w, dt) {
  const b = w.ball;
  const play = w.play;
  const carrier = b.state === "held" ? b.carrier : null;
  for (const p of w.players) {
    if (p.state === "tackled") {
      p.tvx = p.tvy = 0;
      continue;
    }
    if (p.downUntil > w.time && p.diveUntil <= w.time) {
      p.tvx = p.tvy = 0;
      continue;
    }
    if (p.diveUntil > w.time) continue;
    if (p.isUser && w.userActive && !(p === play.returner && !carrier && w.stickIdle)) continue;
    if (carrier === p) {
      carryThink(w, p, dt);
      continue;
    }
    if (carrier) {
      if (p.team === carrier.team) returnBlock(w, p, carrier, dt);
      else if (p.ai.job === "kicksafety") safetyThink(w, p, carrier, dt);
      else chaseCarrier(w, p, carrier, dt);
      continue;
    }
    // ball in the air or bouncing
    const kickingTeam = play.kick === "punt" ? w.offense : w.defense;
    if (p.team === kickingTeam) coverLane(w, p, dt);
    // a surprise onside kick: the front line has already turned to run back and set the wall, so it
    // reacts a beat late (the hands team, lined up for it, goes right away)
    else if (b.onside && !play.onsideLook && w.time - b.tSpawn < ONSIDE_SURPRISE_REACT) setWall(w, p, dt);
    else if (p === play.returner || (b.state === "loose" && b.kind === "kick" && Math.hypot(p.x - b.x, p.y - b.y) < 9)) fieldBall(w, p, dt);
    else setWall(w, p, dt);
  }
}

// Coverage team while the ball is in the air / bouncing: sprint down in lanes, converge late.
function coverLane(w, p, dt) {
  const b = w.ball;
  if (p.blockers.length) {
    steer(w, p, b.aimX, b.aimY, 1, 0);
    return;
  }
  if (p.engaged) return;
  if (p.ai.job === "kicksafety") {
    const dir = w.play.kick === "punt" ? 1 : -1;
    steer(w, p, b.aimX - dir * 18, b.aimY * 0.6 + MID * 0.4, 0.7, 1.5);
    return;
  }
  if (b.state === "loose") {
    // a bouncing kick: go get it (kickoffs: only worth it once it's gone ten yards)
    steer(w, p, b.x + b.vx * 0.25, b.y + b.vy * 0.25, 1, 0);
    return;
  }
  const dir = w.play.kick === "punt" ? 1 : -1; // direction the coverage runs
  const start = w.play.kick === "punt" ? w.los : w.kickSpot;
  const span = Math.max(8, Math.abs(b.aimX - start));
  const k = clamp(((p.x - start) * dir) / span, 0, 1);
  const lane = p.ai.lane != null ? p.ai.lane : p.homeY;
  // stay in the lane early, squeeze toward the ball late; pull up a few yards short of the catch
  const ty = lane + (b.aimY - lane) * clamp(k * 0.85 - 0.05, 0, 0.75);
  const remain = Math.max(0, b.tArrive - w.time);
  const stop = b.aimX - dir * (2.8 + Math.max(0, remain - 0.8) * 2.2 + (p.ai.trail ? 9 : 0));
  steer(w, p, dir > 0 ? Math.min(stop, p.x + 14) : Math.max(stop, p.x - 14), clamp(ty, 1, FW - 1), p.ai.trail ? 0.88 : 1, 0.6);
}

// The returner (or anyone near a bouncing kickoff) goes to the ball.
function fieldBall(w, p, dt) {
  const b = w.ball;
  if (b.state === "air") {
    const punt = w.play.kick === "punt";
    if (punt && w.play.letBounce && p === w.play.returner) {
      // let it go: back off toward the 10
      steer(w, p, Math.min(90, b.aimX - 2), b.aimY, 0.6, 1);
      p.facing = -1;
      return;
    }
    const remain = Math.max(0, b.tArrive - w.time);
    // settle under it a step early, a touch behind the spot so he catches it moving forward
    const back = punt ? 0.45 : -0.45;
    const d = steer(w, p, b.aimX + back, b.aimY, remain < 0.6 ? 1 : 0.92, 0.8);
    if (d < 1) p.facing = punt ? -1 : 1;
    return;
  }
  steer(w, p, b.x + b.vx * 0.2, b.y + b.vy * 0.2, 1, 0);
}

// Man assignments for the return team, made when the ball is kicked: blockers and coverage paired
// off by lateral order (left to right), so the blocks spread across the field.
export function assignReturnBlocks(w) {
  const play = w.play;
  const punt = play.kick === "punt";
  const recv = punt ? w.defense : w.offense;
  const ret = play.returner;
  const blockers = w.players.filter((p) => p.team === recv && p !== ret);
  const cover = w.players.filter((p) => p.team !== recv && p.ai.job !== "kicksafety" && p.slot !== "K");
  blockers.sort((a, b) => a.y - b.y);
  cover.sort((a, b) => (a.ai.lane != null ? a.ai.lane : a.y) - (b.ai.lane != null ? b.ai.lane : b.y));
  const n = blockers.length;
  for (let i = 0; i < n; i++) {
    const j = Math.round((i * (cover.length - 1)) / Math.max(1, n - 1));
    blockers[i].ai.assign = cover[j] || null;
  }
  // the return lane: up the middle, shaded away from where the coverage is thickest
  let sum = 0;
  for (const c of cover) sum += c.y - MID;
  play.retLane = clamp(MID - Math.sign(sum) * w.rng.range(0, 5), 12, FW - 12);
}

// The returner's designed lane once he has the ball (a preference: carryThink still reads daylight).
export function startReturn(w, p) {
  const play = w.play;
  const dir = w.dirOf(p);
  const ly = play.retLane != null ? play.retLane : MID;
  p.ai.job = "carry";
  p.ai.pts = [[p.x + dir * 9, p.y * 0.4 + ly * 0.6], [p.x + dir * 20, ly], [p.x + dir * 34, ly * 0.7 + p.y * 0.3]];
  p.ai.pi = 0;
}

// Return team before the catch: drop toward the wall spot, then turn and lock on to my man as he
// arrives (or when the ball is about to come down).
function setWall(w, p, dt) {
  const b = w.ball;
  if (p.engaged) {
    p.tvx = p.tvy = 0;
    return;
  }
  const punt = w.play.kick === "punt";
  const dir = punt ? -1 : 1; // return direction
  const remain = b.state === "air" ? b.tArrive - w.time : 0;
  const man = p.ai.assign;
  if (man && man.blockers.length === 0 && man.downUntil <= w.time) {
    const dm = Math.hypot(man.x - p.x, man.y - p.y);
    if (dm < 4.5 || remain < (punt ? 1.1 : 1.6)) return engageMove(w, p, man, b.aimX, b.aimY);
  } else {
    // my man is taken care of: pick up anyone close and free
    let tgt = null, td = 3.5;
    for (const d of w.players) {
      if (d.team === p.team || d.downUntil > w.time || d.blockers.length >= 1 || d.ai.job === "kicksafety") continue;
      const dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd < td) { td = dd; tgt = d; }
    }
    if (tgt) return engageMove(w, p, tgt, b.aimX, b.aimY);
  }
  // the wall: a set depth in front of the catch, spread by lane
  const depth = punt ? (p.pos === "CB" || p.pos === "S" ? 10 : 15) : p.ai.wallDepth || 14;
  const lateral = clamp((p.homeY - MID) * (punt ? 0.35 : 0.55), -14, 14);
  const tx = b.aimX + dir * depth;
  const ty = clamp(b.aimY * 0.5 + MID * 0.5 + lateral, 2, FW - 2);
  steer(w, p, tx, ty, 0.95, 1.2);
}

// Return team after the catch: my man if he's still coming, otherwise the most dangerous unblocked
// threat in front of the returner (claims spread the blockers out).
function returnBlock(w, p, c, dt) {
  if (p.engaged) {
    p.tvx = p.tvy = 0;
    return;
  }
  const dir = w.dirOf(c);
  const man = p.ai.assign;
  if (man && man.blockers.length === 0 && man.downUntil <= w.time && man.state !== "tackled" && (man.x - c.x) * dir > -1.5 && Math.hypot(man.x - c.x, man.y - c.y) < 20) {
    man.ai.claimT = w.time;
    man.ai.claimBy = p;
    return engageMove(w, p, man, c.x, c.y);
  }
  let tgt = null, best = 1e9;
  for (const d of w.players) {
    if (d.team === p.team || d.downUntil > w.time || d.state === "tackled" || d.blockers.length >= 1) continue;
    if (p.noEngage === d && p.noEngageUntil > w.time) continue;
    const ahead = (d.x - c.x) * dir;
    if (ahead < -3) continue; // already beaten: let him go
    const dc = Math.hypot(d.x - c.x, d.y - c.y);
    if (dc > 16) continue;
    const dp = Math.hypot(d.x - p.x, d.y - p.y);
    let s = dp * 0.9 + dc * 0.55;
    if (d.ai.claimT === w.time && d.ai.claimBy !== p) s += 4;
    if (s < best) { best = s; tgt = d; }
  }
  if (tgt && best < 16) {
    tgt.ai.claimT = w.time;
    tgt.ai.claimBy = p;
    return engageMove(w, p, tgt, c.x, c.y);
  }
  // nobody to block: lead the way
  steer(w, p, c.x + dir * 5, c.y + (p.y > c.y ? 2.5 : -2.5), 0.85, 1);
}

// Coverage after the catch: pursuit. The trailers keep their depth as a second wave until the
// returner comes to them.
function chaseCarrier(w, p, c, dt) {
  if (p.engaged) return;
  if (p.ai.trail) {
    const dir = w.dirOf(c);
    const gap = (p.x - c.x) * dir;
    if (gap > 7 && Math.hypot(p.x - c.x, p.y - c.y) > 8) {
      steer(w, p, c.x + dir * Math.max(7, gap - 2), c.y * 0.7 + p.y * 0.3, 0.8, 1);
      return;
    }
  }
  pursue(w, p, c, dt);
}

// Kicker / punter: the last line of defense — shadow the returner, then come up when he's close.
function safetyThink(w, p, c, dt) {
  const d = Math.hypot(c.x - p.x, c.y - p.y);
  if (d < 11) return pursue(w, p, c, dt);
  const dir = w.dirOf(c);
  steer(w, p, c.x + dir * 10, c.y, 0.7, 1.5);
}
