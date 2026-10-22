// Movement integration, collisions, blocking engagements, and contact resolution
// (tackles, broken tackles, dives, jukes, stiff-arms, throws, catches, interceptions, fumbles).
// Pure simulation: no DOM. Everything random goes through w.rng.
import { CFG, HIT } from "./config.js";
import { clamp } from "./util.js";

const FW = CFG.FIELD_W;
// The play's mirror parity (−1 on a FLIPped offensive call, world.js newPlay): what has no side of its own — a tie, a
// random spray left or right — goes the mirrored way on a flipped play (the statistics don't change), so a flipped play
// is the exact mirror image of the original (ai.js parOf).
const parOf = (w) => (w.play && w.play.par < 0 ? -1 : 1);

// ---------- Movement ----------
export function maxSpeed(w, p) {
  let s = p.r.speed;
  if (p.hasBall) s *= CFG.CARRIER_SPEED_MUL;
  if (p.slowUntil > w.time) s *= 0.55;
  if (p.stunUntil > w.time) s *= 0.25;
  if (p.diveUntil > w.time) s = Math.max(s, 9.5);
  if (p.jukeUntil > w.time) s *= 1.08;
  return s;
}

// Steer toward (tx, ty) at `frac` of top speed; slows down to arrive.
export function steer(w, p, tx, ty, frac = 1, arrive = 1.2) {
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.05) {
    p.tvx = 0;
    p.tvy = 0;
    return d;
  }
  let sp = maxSpeed(w, p) * frac;
  if (arrive > 0 && d < arrive) sp *= d / arrive;
  p.tvx = (dx / d) * sp;
  p.tvy = (dy / d) * sp;
  return d;
}
export function steerDir(w, p, dx, dy, frac = 1) {
  const d = Math.hypot(dx, dy);
  if (d < 1e-4) {
    p.tvx = p.tvy = 0;
    return;
  }
  const sp = maxSpeed(w, p) * Math.min(1, frac);
  p.tvx = (dx / d) * sp;
  p.tvy = (dy / d) * sp;
}

export function integrate(w, p, dt) {
  if (p.state === "tackled" || p.downUntil > w.time) {
    // sliding on the turf
    p.vx *= 0.88;
    p.vy *= 0.88;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return;
  }
  const userMul = p.isUser && w.userActive ? CFG.USER_ACCEL_MUL : 1;
  const acc = p.r.accel * userMul;
  let dvx = p.tvx - p.vx, dvy = p.tvy - p.vy;
  const dv = Math.hypot(dvx, dvy);
  const cur = Math.hypot(p.vx, p.vy);
  const want = Math.hypot(p.tvx, p.tvy);
  const braking = want < cur - 0.05 || p.vx * p.tvx + p.vy * p.tvy < 0;
  const step = acc * (braking ? CFG.DECEL_MUL : 1) * dt;
  if (dv > step) {
    dvx *= step / dv;
    dvy *= step / dv;
  }
  p.vx += dvx;
  p.vy += dvy;
  // hard cap (states can lower the cap mid-stride)
  const cap = maxSpeed(w, p) * 1.04;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > cap) {
    p.vx *= cap / sp;
    p.vy *= cap / sp;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (Math.abs(p.vx) > 0.7) p.facing = p.vx > 0 ? 1 : -1;
}

// Push overlapping players apart (mass-weighted). Locked blocking pairs are skipped.
export function separate(w) {
  const ps = w.players;
  const n = ps.length;
  for (let i = 0; i < n; i++) {
    const a = ps[i];
    if (a.state === "tackled" || a.downUntil > w.time) continue;
    for (let j = i + 1; j < n; j++) {
      const b = ps[j];
      if (b.state === "tackled" || b.downUntil > w.time) continue;
      if (a.engaged === b || b.engaged === a) continue;
      const min = (a.rad + b.rad) * (a.team === b.team ? 0.75 : 1);
      const dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const over = (min - d) * 0.5;
      const nx = dx / d, ny = dy / d;
      // a ball carrier is hard to stop by bumping (tackles do that)
      let ma = a.mass * (a.hasBall ? 1.5 : 1), mb = b.mass * (b.hasBall ? 1.5 : 1);
      const ka = mb / (ma + mb), kb = ma / (ma + mb);
      a.x -= nx * over * 2 * ka;
      a.y -= ny * over * 2 * ka;
      b.x += nx * over * 2 * kb;
      b.y += ny * over * 2 * kb;
      // remove closing velocity
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        a.vx += nx * rv * ka * 0.6;
        a.vy += ny * rv * ka * 0.6;
        b.vx -= nx * rv * kb * 0.6;
        b.vy -= ny * rv * kb * 0.6;
      }
    }
  }
}

// ---------- Blocking ----------
export function canEngage(w, b, d) {
  if (d.state === "tackled" || d.downUntil > w.time || d.hasBall) return false;
  if (d.freeUntil > w.time) return false;
  if (b.noEngage === d && b.noEngageUntil > w.time) return false;
  if (d.blockers.length >= 2) return false;
  if (b.engaged || b.downUntil > w.time) return false;
  return true;
}

export function engage(w, b, d) {
  b.engaged = d;
  d.blockers.push(b);
  const edge = b.r.power - d.r.anchor;
  if (d.blockers.length === 1 && edge > CFG.PANCAKE_EDGE && w.rng.chance(CFG.PANCAKE_P * (edge / CFG.PANCAKE_EDGE)) && !d.hasBall) {
    pancake(w, b, d);
    return;
  }
  const ratio = (b.r.anchor * 0.55 + b.r.power * 0.45) / Math.max(20, d.r.power * 0.65 + d.r.agility * 0.35);
  let t = CFG.SHED_BASE * Math.pow(ratio, 1.25) * w.rng.range(0.6, 1.45);
  if (w.play && w.play.offSkill != null) t *= 0.92 + 0.16 * (b.team === w.offense ? w.play.offSkill : w.play.defSkill);
  if (w.play && w.play.off && w.play.off.type === "run") t *= CFG.RUN_BLOCK_HOLD;
  else if (w.play && w.play.off && w.play.off.type === "pass") t *= CFG.PASS_BLOCK_HOLD;
  t = clamp(t, CFG.SHED_MIN, CFG.SHED_MAX);
  if (d.blockers.length === 2) d.shedAt = Math.max(d.shedAt, w.time) + t * (CFG.DOUBLE_TEAM_SHED - 1);
  else d.shedAt = w.time + t;
  w.emit("block", { blocker: b, defender: d });
}

export function pancake(w, b, d) {
  disengage(w, d);
  d.downUntil = w.time + CFG.PANCAKE_TIME * w.rng.range(0.85, 1.2);
  d.vx = (d.x - b.x) * 2.2;
  d.vy = (d.y - b.y) * 2.2;
  b.noEngage = d;
  b.noEngageUntil = w.time + 2;
  b.stats.pancakes++;
  w.emit("pancake", { blocker: b, defender: d });
}

export function disengage(w, d) {
  w.emit("disengage", { defender: d, blockers: d.blockers });
  for (const b of d.blockers) {
    b.engaged = null;
    b.noEngage = d;
    b.noEngageUntil = w.time + CFG.REENGAGE_COOLDOWN;
  }
  d.blockers.length = 0;
}

// Engaged defenders and their blockers move as a unit. `goal(d)` gives the point the defender
// is fighting toward; `protect(d)` the point the blockers keep it away from.
export function updateEngagements(w, dt) {
  const ps = w.players;
  for (let i = 0; i < ps.length; i++) {
    const d = ps[i];
    if (!d.blockers.length) continue;
    if (d.state === "tackled" || d.downUntil > w.time || w.time >= d.shedAt || d.hasBall) {
      if (w.time >= d.shedAt && d.downUntil <= w.time) {
        d.freeUntil = w.time + 0.55;
        d.slowUntil = 0;
      }
      disengage(w, d);
      continue;
    }
    // drop blockers that are down
    for (let k = d.blockers.length - 1; k >= 0; k--) {
      const b = d.blockers[k];
      if (b.downUntil > w.time || b.state === "tackled" || b.engaged !== d) {
        b.engaged = null;
        d.blockers.splice(k, 1);
      }
    }
    if (!d.blockers.length) continue;
    // forces
    let bPow = 0, bAnc = 0, bx = 0, by = 0;
    for (const b of d.blockers) {
      bPow += b.r.power;
      bAnc += b.r.anchor;
      bx += b.x;
      by += b.y;
    }
    const nb = d.blockers.length;
    bx /= nb;
    by /= nb;
    let pdx = d.x - bx, pdy = d.y - by;
    let pl = Math.hypot(pdx, pdy) || 1;
    pdx /= pl;
    pdy /= pl;
    // defender's intent (set by AI as its desired velocity)
    let gdx = d.tvx, gdy = d.tvy;
    const gl = Math.hypot(gdx, gdy);
    if (gl > 1e-3) {
      gdx /= gl;
      gdy /= gl;
    } else {
      gdx = -pdx;
      gdy = -pdy;
    }
    const runBlock = w.play && w.play.off && w.play.off.type === "run" && !w.play.turnover;
    const drive = clamp((bPow * (runBlock ? 1.18 : 1) - d.r.anchor * 0.9 * (nb > 1 ? 0.8 : 1)) / 40, -0.6, 1.4) * CFG.BLOCK_PUSH;
    const rush = clamp((d.r.power - (bAnc / nb) * 0.9 * (nb > 1 ? 1.5 : 1)) / 40, -0.5, 1.2) * CFG.BLOCK_PUSH * (runBlock ? 0.45 : 0.42);
    // lateral slide toward the goal direction (perpendicular part)
    const along = gdx * pdx + gdy * pdy;
    let sx = gdx - along * pdx, sy = gdy - along * pdy;
    const agil = clamp(d.r.agility / 90, 0.4, 1.4) / nb;
    let vx = pdx * Math.max(0, drive) - pdx * Math.max(0, rush) * Math.max(0, -along) * 1.0 + sx * CFG.BLOCK_SLIDE * agil;
    let vy = pdy * Math.max(0, drive) - pdy * Math.max(0, rush) * Math.max(0, -along) * 1.0 + sy * CFG.BLOCK_SLIDE * agil;
    if (rush > 0 && along < 0) {
      // pushing straight back into the blocker: the pocket collapses slowly
      vx += gdx * rush * 0.35;
      vy += gdy * rush * 0.35;
    }
    d.vx = vx;
    d.vy = vy;
    d.x += vx * dt;
    d.y += vy * dt;
    // blockers stay locked in front, slowly rotating to keep the protected point covered
    for (const b of d.blockers) {
      let ldx = b.x - d.x, ldy = b.y - d.y;
      let ll = Math.hypot(ldx, ldy) || 1;
      ldx /= ll;
      ldy /= ll;
      // mirror: the blocker slides around to stay on the defender's path to its goal
      const turn = clamp(b.r.agility / Math.max(30, d.r.agility), 0.35, 1.3) * 2.2 * dt;
      ldx += (gdx - ldx) * turn;
      ldy += (gdy - ldy) * turn;
      ll = Math.hypot(ldx, ldy) || 1;
      const contact = (b.rad + d.rad) * 0.92;
      const nx = d.x + (ldx / ll) * contact, ny = d.y + (ldy / ll) * contact;
      b.vx = (nx - b.x) / dt;
      b.vy = (ny - b.y) / dt;
      b.x = nx;
      b.y = ny;
      b.facing = d.x > b.x ? 1 : -1;
    }
    d.facing = bx > d.x ? 1 : -1;
  }
}

// ---------- Forward progress ----------
// A carrier stood up in a pile (no forward gain while slow for FORWARD_PROGRESS_SEC, with a defender
// within FORWARD_PROGRESS_R) is down at his furthest spot — ends the endless shoving matches.
export function forwardProgress(w) {
  const b = w.ball;
  const play = w.play;
  const c = b.state === "held" ? b.carrier : null;
  if (!c || c.state === "tackled" || !play) return false;
  if (c.pos === "QB" && c.ai.job === "qb" && !play.qbRunner && !play.handed && !play.turnover) return false; // pocket
  const dir = w.dirOf(c);
  if (play.fpCarrier !== c) {
    play.fpCarrier = c;
    play.fpX = c.x;
    play.fpT = w.time;
    return false;
  }
  const fwd = (c.x - play.fpX) * dir;
  if (fwd > 0.15) play.fpX = c.x;
  if (fwd > 0.15 || Math.hypot(c.vx, c.vy) > 2.6) {
    play.fpT = w.time;
    return false;
  }
  if (w.time - play.fpT < CFG.FORWARD_PROGRESS_SEC) return false;
  let nd = null, ndd = CFG.FORWARD_PROGRESS_R;
  for (const d of w.players) {
    if (d.team === c.team || d.downUntil > w.time || d.state === "tackled") continue;
    const dd = Math.hypot(d.x - c.x, d.y - c.y);
    if (dd < ndd) { ndd = dd; nd = d; }
  }
  if (!nd) {
    play.fpT = w.time;
    return false;
  }
  c.state = "tackled";
  nd.stats.tackles++;
  w.emit("tackle", { tackler: nd, carrier: c, power: 45, progress: true });
  w.endPlay({ type: "tackle", spot: play.fpX, carrier: c, tackler: nd, power: 45, y: c.y, progress: true });
  return true;
}

// ---------- Tackling ----------
export function hitPower(d, c) {
  const rvx = d.vx - c.vx, rvy = d.vy - c.vy;
  const dx = c.x - d.x, dy = c.y - d.y;
  const dl = Math.hypot(dx, dy) || 1;
  const closing = Math.max(0, (rvx * dx + rvy * dy) / dl);
  return { closing, power: closing * (9 + 13 * d.mass) + d.r.power * 0.45 + (d.diveUntil > 0 ? 18 : 0) };
}

export function tryTackles(w) {
  const ball = w.ball;
  const c = ball.carrier;
  if (ball.state !== "held" || !c || c.state === "tackled") return;
  const ps = w.players;
  let gang = 0;
  for (let i = 0; i < ps.length; i++) {
    const d = ps[i];
    if (d.team === c.team || d.downUntil > w.time || d.state === "tackled") continue;
    const dd = Math.hypot(d.x - c.x, d.y - c.y);
    if (dd < 1.4) gang++;
  }
  for (let i = 0; i < ps.length; i++) {
    const d = ps[i];
    if (d.team === c.team || d.state === "tackled") continue;
    if (d.downUntil > w.time && d.diveUntil <= w.time) continue;
    if (d.stunUntil > w.time) continue;
    const diving = d.diveUntil > w.time;
    const reach = c.rad + d.rad + CFG.TACKLE_RANGE + (diving ? 0.5 : 0);
    const dd = Math.hypot(d.x - c.x, d.y - c.y);
    if (dd > reach) continue;
    if (w.time - d.lastTry < CFG.TACKLE_INTERVAL) continue;
    d.lastTry = w.time;
    const { closing, power } = hitPower(d, c);
    let p = CFG.TACKLE_BASE + CFG.TACKLE_POWER_K * (d.r.power - c.r.power) + CFG.TACKLE_CLOSE_K * closing;
    // squared up in front of him (not chasing from behind): a sure-handed open-field tackle
    if (!d.blockers.length && (d.x - c.x) * c.vx + (d.y - c.y) * c.vy > 0) p += CFG.TACKLE_FRONT;
    // a receiver hit as the ball arrives hasn't got going yet
    if (w.play.catchT && w.time - w.play.catchT < 0.45 && c === w.play.carrier) p += CFG.TACKLE_CATCH;
    if (c.jukeUntil > w.time) p -= CFG.JUKE_EVADE * c.r.juke * clamp(c.r.agility / 85, 0.6, 1.3);
    if (c.stiffUntil > w.time) p -= 0.28 * clamp(c.r.power / Math.max(20, d.r.power), 0.4, 1.6);
    if (diving) p += CFG.DIVE_BONUS;
    if (d.blockers.length) p *= CFG.ENGAGED_TACKLE_MUL;
    if (gang > 1) p += 0.1 * (gang - 1);
    if (c.pos === "QB" && !w.play.thrown && c.x < w.los + 0.5) p += 0.02; // sacks: QBs aren't built for contact
    const dSkill = d.team === w.offense ? w.play.offSkill : w.play.defSkill;
    p += (dSkill - 0.65) * 0.1;
    p = clamp(p, CFG.TACKLE_MIN, CFG.TACKLE_MAX);
    w.emit("tackleAttempt", { tackler: d, carrier: c });
    if (w.rng.next() < p) {
      tackle(w, d, c, power);
      return;
    }
    // broken tackle
    d.stunUntil = w.time + CFG.BROKEN_STUN;
    if (!diving) {
      d.vx *= -0.3;
      d.vy *= -0.3;
    }
    c.slowUntil = w.time + CFG.BROKEN_SLOW;
    c.stats.brokenTackles++;
    w.emit("brokenTackle", { tackler: d, carrier: c });
  }
}

export function tackle(w, d, c, power) {
  const dir = w.dirOf(c);
  const backing = c.vx * dir < 0; // backpedalling (a QB in his drop, a runner giving ground) at the hit
  c.state = "tackled";
  d.downUntil = w.time + 1.2;
  d.stats.tackles++;
  // carrier slides a bit along the tackler's momentum
  c.vx = c.vx * 0.35 + d.vx * 0.35;
  c.vy = c.vy * 0.35 + d.vy * 0.35;
  d.vx *= 0.5;
  d.vy *= 0.5;
  // the carrier's momentum carries the ball forward as he goes down; a stronger back falls forward more
  // (not one caught backpedalling)
  let fall = clamp((c.vx * dir) * CFG.FALL_MOMENTUM, 0, 0.75) * dir;
  if (c.r.power > d.r.power * 0.95 && !backing) fall += CFG.FALL_FORWARD * w.rng.range(0.4, 1.2) * dir;
  // a designed lunge (QB sneak): he falls forward over the pile
  const lunge = w.play && w.play.off && w.play.off.lunge && c.slot === "QB" ? w.play.off.lunge : 0;
  if (lunge && fall * dir < lunge) fall = lunge * w.rng.range(0.7, 1.15) * dir;
  // down in his own end zone he stays there (a fall out of it let a backpedalling QB escape the safety)
  if (dir > 0 ? c.x <= 0 : c.x >= 100) fall = 0;
  // fumble?
  const fumbleP = CFG.FUMBLE_K * (power / Math.max(30, c.r.toughness)) * (power > HIT.BIG ? 1.4 : 0.6);
  w.emit("tackle", { tackler: d, carrier: c, power });
  if (w.rng.next() < fumbleP && c.pos !== "K") {
    fumble(w, c, d);
    return;
  }
  w.endPlay({ type: "tackle", spot: c.x + fall, carrier: c, tackler: d, power, y: c.y });
}

export function fumble(w, c, d) {
  const b = w.ball;
  c.hasBall = false;
  b.state = "loose";
  b.kind = "fumble";
  b.carrier = null;
  b.x = c.x;
  b.y = c.y;
  b.z = 1;
  const a = w.rng.range(0, Math.PI * 2);
  b.vx = Math.cos(a) * 3 + d.vx * 0.3;
  b.vy = Math.sin(a) * 3 * parOf(w) + d.vy * 0.3;
  b.vz = 3.5;
  b.tSpawn = w.time;
  b.fumbledBy = c;
  w.play.fumbled = true;
  w.emit("fumble", { carrier: c, tackler: d });
}

// ---------- Carrier moves ----------
export function juke(w, c) {
  if (c.jukeCd > w.time || c.state === "tackled") return false;
  c.jukeUntil = w.time + CFG.JUKE_TIME;
  c.jukeCd = w.time + CFG.JUKE_COOLDOWN;
  // burst sideways, away from the nearest threat
  let nd = null, best = 1e9;
  for (const d of w.players) {
    if (d.team === c.team || d.downUntil > w.time) continue;
    const dd = Math.hypot(d.x - c.x, d.y - c.y);
    if (dd < best) { best = dd; nd = d; }
  }
  const side = nd ? (nd.y > c.y || (nd.y === c.y && parOf(w) < 0) ? -1 : 1) : parOf(w);
  c.jukeDir = side;
  c.vy += side * 3.2;
  w.emit("juke", { player: c });
  return true;
}
export function stiffArm(w, c) {
  if (c.stiffCd > w.time || c.state === "tackled") return false;
  c.stiffUntil = w.time + CFG.STIFF_TIME;
  c.stiffCd = w.time + CFG.STIFF_COOLDOWN;
  w.emit("stiffArm", { player: c });
  return true;
}
export function dive(w, d, tx, ty) {
  if (d.dived || d.downUntil > w.time || d.blockers.length) return false;
  d.dived = true;
  const dx = tx - d.x, dy = ty - d.y;
  const l = Math.hypot(dx, dy) || 1;
  const sp = Math.max(Math.hypot(d.vx, d.vy), 6) + CFG.DIVE_LUNGE / 0.35 * 0.5;
  d.vx = (dx / l) * sp;
  d.vy = (dy / l) * sp;
  d.tvx = d.vx;
  d.tvy = d.vy;
  d.diveUntil = w.time + 0.35;
  d.downUntil = w.time + 0.35 + CFG.DIVE_MISS_DOWN;
  if (Math.abs(dx) > 0.2) d.facing = dx > 0 ? 1 : -1;
  w.emit("dive", { player: d });
  return true;
}

// ---------- Passing ----------
export function pressureOn(w, qb) {
  let p = 0;
  for (const d of w.players) {
    if (d.team === qb.team || d.downUntil > w.time || d.blockers.length) continue;
    const dd = Math.hypot(d.x - qb.x, d.y - qb.y);
    if (dd < CFG.PRESSURE_R + 1.2) p = Math.max(p, 1 - dd / (CFG.PRESSURE_R + 1.2));
  }
  return p;
}

export function startThrow(w, qb, target) {
  if (qb.throwAt > 0 || w.play.thrown || !qb.hasBall) return false;
  qb.throwAt = w.time + CFG.THROW_WINDUP;
  qb.throwTarget = target;
  qb.facing = target.x >= qb.x ? 1 : -1;
  w.emit("throwStart", { qb, target });
  return true;
}

// Where a receiver will be after T seconds if he keeps running his route.
const PRED = [0, 0];
export function predictRoute(r, T, out) {
  let x = r.x, y = r.y;
  const sp = Math.max(4.5, Math.hypot(r.vx, r.vy), r.r.speed * 0.85);
  let left = T * sp;
  const pts = r.ai.job === "route" ? r.ai.pts : null;
  if (pts && !r.ai.sit && r.ai.pi < pts.length) {
    let i = r.ai.pi;
    let lx = r.vx, ly = r.vy;
    while (left > 0 && i < pts.length) {
      const dx = pts[i][0] - x, dy = pts[i][1] - y;
      const d = Math.hypot(dx, dy);
      if (d >= left) {
        x += (dx / d) * left;
        y += (dy / d) * left;
        left = 0;
        break;
      }
      x = pts[i][0];
      y = pts[i][1];
      left -= d;
      lx = dx;
      ly = dy;
      i++;
    }
    if (left > 0 && !r.ai.routeSit) {
      const l = Math.hypot(lx, ly) || 1;
      x += (lx / l) * left;
      y += (ly / l) * left;
    }
  } else if (!r.ai.sit) {
    x += r.vx * T;
    y += r.vy * T;
  }
  out[0] = x;
  out[1] = y;
  return out;
}

// Called when the windup finishes.
export function releaseThrow(w, qb) {
  const rec = qb.throwTarget;
  qb.throwAt = 0;
  qb.throwTarget = null;
  // a QB who ran past the line during the windup is a runner now: no forward pass
  if (!qb.hasBall || !rec || w.play.qbRunner) return;
  const b = w.ball;
  const armN = clamp((qb.r.arm - 40) / 75, 0, 1);
  let speed = CFG.BALL_SPEED_MIN + (CFG.BALL_SPEED_MAX - CFG.BALL_SPEED_MIN) * armN;
  // lead the receiver: where will he be when the ball gets there?
  let ax = rec.x, ay = rec.y, T = 0.5;
  for (let k = 0; k < 3; k++) {
    const d = Math.hypot(ax - qb.x, ay - qb.y);
    let sp = speed;
    if (d > 22) sp *= 1 - Math.min(0.24, (d - 22) / 110);
    T = Math.max(0.25, d / sp);
    predictRoute(rec, T + 0.08, PRED);
    ax = PRED[0];
    ay = PRED[1];
  }
  // aim inside the sidelines and the end lines (a ball led past the back of the end zone can't be caught)
  ax = clamp(ax, -9.2, 109.2);
  ay = clamp(ay, 1.0, FW - 1.0);
  if (qb.ai.throwAway) {
    ax = rec.x + 3;
    ay = rec.y < FW / 2 || (rec.y === FW / 2 && parOf(w) < 0) ? -4 : FW + 4;
  }
  const d = Math.hypot(ax - qb.x, ay - qb.y);
  // accuracy
  const pressure = pressureOn(w, qb);
  const acc = clamp(qb.r.accuracy, 0.25, 1.1);
  const err = (CFG.ACC_BASE + d * CFG.ACC_DIST * (1.2 - acc) + Math.max(0, d - 18) * CFG.ACC_DEEP + pressure * CFG.ACC_PRESSURE) * (qb.isUser ? 0.9 : 1);
  const ex = w.rng.gauss() * err * 0.55, ey = w.rng.gauss() * err * parOf(w);
  b.accErr = Math.hypot(ex, ey);
  ax += ex;
  ay += ey;
  b.state = "air";
  b.kind = "pass";
  b.carrier = null;
  qb.hasBall = false;
  b.from = qb;
  b.target = rec;
  b.x = qb.x + qb.facing * 0.3;
  b.y = qb.y;
  b.z = CFG.RELEASE_Z;
  b.aimX = ax;
  b.aimY = ay;
  b.tSpawn = w.time;
  b.tArrive = w.time + T;
  b.vx = (ax - b.x) / T;
  b.vy = (ay - b.y) / T;
  b.vz = (CFG.CATCH_Z - CFG.RELEASE_Z + 0.5 * CFG.GRAVITY * T * T) / T;
  b.resolved = false;
  b.dist = d;
  w.play.thrown = true;
  w.play.throwT = w.time;
  w.play.throwFrom = qb.x;
  qb.stats.att++;
  w.teamStats(qb.team).att++;
  w.emit("throw", { qb, target: rec, ball: b });
}

export function startPitch(w, qb, rb) {
  const b = w.ball;
  qb.hasBall = false;
  b.state = "air";
  b.kind = "pitch";
  b.carrier = null;
  b.from = qb;
  b.target = rb;
  b.x = qb.x;
  b.y = qb.y;
  b.z = 1.1;
  const T = 0.32;
  const ax = rb.x + rb.vx * T, ay = rb.y + rb.vy * T;
  b.aimX = ax;
  b.aimY = ay;
  b.tSpawn = w.time;
  b.tArrive = w.time + T;
  b.vx = (ax - b.x) / T;
  b.vy = (ay - b.y) / T;
  b.vz = (1.1 - 1.1 + 0.5 * CFG.GRAVITY * T * T) / T;
  b.resolved = false;
  w.emit("handoff", { from: qb, to: rb, pitch: true });
}

// Ball flight + catch resolution for passes/pitches; bouncing for loose balls.
export function updateBall(w, dt) {
  const b = w.ball;
  b.spin += dt * (b.state === "air" ? 14 : 0);
  if (b.state === "held") {
    const c = b.carrier;
    if (c) {
      b.x = c.x + c.facing * 0.25;
      b.y = c.y + 0.05 * parOf(w);
      b.z = c.state === "tackled" ? 0.3 : 1.0;
    }
    return;
  }
  if (b.state === "air") {
    // kicks (snaps to the holder, punts, kickoffs, field goals) are flown by the world / special teams
    if (b.kind !== "pass" && b.kind !== "pitch") return;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.vz -= CFG.GRAVITY * dt;
    if (b.kind === "pitch") {
      if (w.time >= b.tArrive - 0.02) {
        const rb = b.target;
        b.holdBy(rb);
        w.setCarrier(rb, "pitch");
      }
      return;
    }
    if (b.kind === "pass") {
      resolvePass(w, b);
      if (b.state === "air" && b.z <= 0.05) {
        b.z = 0;
        incomplete(w, b, "ground");
      }
      return;
    }
    // kicks are handled by the world
    return;
  }
  if (b.state === "loose") {
    if (b.kind === "kick") return; // bouncing kicks: football-special.js
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.vz -= CFG.GRAVITY * dt;
    if (b.z <= 0) {
      b.z = 0;
      if (b.vz < -1.5) {
        b.vz = -b.vz * 0.45;
        b.bounces++;
        b.vx *= 0.7;
        b.vy *= 0.7;
      } else {
        b.vz = 0;
        b.vx *= 0.9;
        b.vy *= 0.9;
      }
    }
    if (b.kind === "fumble") {
      // first player to fall on it — or a defender with room to run scoops it up
      for (const p of w.players) {
        if (p.downUntil > w.time || p.state === "tackled") continue;
        if (b.z > 1.2) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < 0.75 && w.rng.chance(0.35)) {
          const fb = b.fumbledBy;
          if (!w.play.turnover && fb && fb.team === w.offense && p.team === w.defense && !p.isUser && roomToRun(w, p, 2.6) && w.rng.chance(CFG.SCOOP_P)) {
            b.holdBy(p);
            w.emit("scoop", { player: p });
            w.setCarrier(p, "scoop");
            return;
          }
          w.emit("fumbleDive", { player: p });
          p.downUntil = w.time + 1;
          w.endPlay({ type: "recovery", spot: b.x, recoveredBy: p, y: b.y });
          return;
        }
      }
      if (b.y < -0.5 || b.y > FW + 0.5 || b.x < -10 || b.x > 110) {
        // out of bounds: offense keeps it at the spot
        w.endPlay({ type: "recovery", spot: clamp(b.x, 0.5, 99.5), rawX: b.x, recoveredBy: b.fumbledBy, y: b.y, oob: true });
      }
    }
  }
}

// No opponent of p within r yards (and p on his feet).
export function roomToRun(w, p, r) {
  for (const d of w.players) {
    if (d.team === p.team || d.downUntil > w.time || d.state === "tackled") continue;
    if (Math.hypot(d.x - p.x, d.y - p.y) < r) return false;
  }
  return true;
}

function incomplete(w, b, why) {
  b.state = "loose";
  b.kind = "dead";
  b.vz = 2.2;
  b.vx *= 0.25;
  b.vy *= 0.25;
  b.z = 0.2;
  w.emit("incomplete", { x: b.x, y: b.y, why, target: b.target });
  w.endPlay({ type: "incomplete", spot: w.los, why });
}

// In flight: a defender right in the throwing lane can get a hand on a low ball (one try each).
function laneDefense(w, b) {
  const rec = b.target;
  const ps = w.players;
  for (let i = 0; i < ps.length; i++) {
    const d = ps[i];
    if (d.team === rec.team || d.downUntil > w.time || d.state === "tackled" || d.ai.laneTry === b.tSpawn) continue;
    if (b.z > CFG.LANE_Z || Math.hypot(d.x - b.x, d.y - b.y) > CFG.LANE_REACH) continue;
    d.ai.laneTry = b.tSpawn;
    const skill = d.team === w.offense ? w.play.offSkill : w.play.defSkill;
    const pInt = CFG.LANE_INT * clamp(d.r.hands / 75, 0.5, 1.5) * (0.7 + 0.6 * skill);
    const r = w.rng.next();
    if (r < pInt) return intercept(w, b, d);
    if (r < pInt + CFG.LANE_TIP) {
      b.resolved = true;
      return deflect(w, b, d, true);
    }
  }
}

function resolvePass(w, b) {
  if (b.resolved) return;
  const descending = b.vz < 0;
  // the catch is decided as the ball comes down to the receiver; before that only the lane matters
  const flight = b.tArrive - b.tSpawn;
  const arriving = w.time >= b.tArrive - 0.12 || (descending && b.z <= CFG.CATCH_Z_MAX + 0.3 && w.time >= b.tArrive - Math.min(0.3, flight * 0.3));
  if (!arriving) {
    if (b.z <= CFG.CATCH_Z_MAX) laneDefense(w, b);
    return;
  }
  if (b.z > CFG.CATCH_Z_MAX + 0.6) return;
  const rec = b.target;
  const ps = w.players;
  // nearest defender to the ball
  let nd = null, ndd = 1e9;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.team === rec.team || p.downUntil > w.time || p.state === "tackled") continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < ndd) { ndd = d; nd = p; }
  }
  const dr = rec.downUntil > w.time ? 99 : Math.hypot(rec.x - b.x, rec.y - b.y);
  const reachR = CFG.CATCH_REACH + (b.z > 2 ? 0 : 0.2);
  const reachHigh = b.z > CFG.CATCH_Z_MAX ? 0 : 1;
  if (!reachHigh) return;
  const defReach = nd && ndd < CFG.CATCH_REACH * 0.95;
  if (dr > reachR && !defReach) return;
  b.resolved = true;
  const offSkill = rec.team === w.offense ? w.play.offSkill : w.play.defSkill;
  const defSkill = nd ? (nd.team === w.offense ? w.play.offSkill : w.play.defSkill) : 0.6;
  // Hail Mary: a jump ball in a crowd — a prayer, not a pitch-and-catch
  if (w.play.off.hail && flight > 1.6 && dr <= reachR) {
    let near = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.team !== rec.team && p.downUntil <= w.time && p.state !== "tackled" && Math.hypot(p.x - b.x, p.y - b.y) < 5) near++;
    }
    if (near) {
      const r = w.rng.next();
      const pInt = 0.1 + 0.04 * Math.min(3, near);
      const pCatch = clamp(0.22 - 0.06 * (near - 1), 0.08, 0.22) * clamp(rec.r.hands / 70, 0.7, 1.3);
      if (r < pInt) return intercept(w, b, nd);
      if (r < pInt + pCatch) return complete(w, b, rec);
      return deflect(w, b, nd, true);
    }
  }
  // defender got there first (overthrow / underthrow / jumped route)
  if (defReach && (dr > reachR || ndd < dr * 0.6)) {
    const pInt = clamp(CFG.INT_BASE * 0.6 * (nd.r.hands / 75) * (0.75 + 0.5 * defSkill), 0.03, 0.28);
    const r = w.rng.next();
    if (r < pInt) return intercept(w, b, nd);
    if (r < pInt + 0.5) return deflect(w, b, nd, true);
    if (dr > reachR) return deflect(w, b, nd);
  }
  if (dr > reachR) return;
  const contested = nd && ndd < CFG.CONTEST_RANGE;
  const q = contested ? 1 - ndd / CFG.CONTEST_RANGE : 0;
  // a crowd under the ball (double coverage, a Hail Mary jump ball): somebody gets a hand on it
  let crowd = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    if (p.team !== rec.team && p.downUntil <= w.time && p.state !== "tackled" && Math.hypot(p.x - b.x, p.y - b.y) < CFG.CROWD_R) crowd++;
  }
  if (contested || crowd >= 2) {
    const pInt = CFG.INT_BASE * 0.55 * Math.max(q, crowd >= 2 ? 0.5 : 0) * clamp(nd.r.hands / 75, 0.5, 1.6) * (0.7 + 0.6 * defSkill);
    const pPbu = CFG.PBU_BASE * q * (0.8 + 0.4 * defSkill) + CFG.CROWD_PBU * Math.max(0, crowd - 1);
    const r = w.rng.next();
    if (r < pInt) return intercept(w, b, nd);
    if (r < pInt + pPbu) return deflect(w, b, nd, true);
  }
  let pc = CFG.CATCH_BASE + CFG.CATCH_HANDS_K * (rec.r.hands - 60) - q * 0.14 + (dr < 0.5 ? 0.05 : 0) - (b.z > 2.0 ? 0.08 / rec.r.highHands : 0);
  // a moon ball (long hang time) is hard to track over the shoulder
  if (flight > 2.0) pc -= Math.min(0.3, (flight - 2.0) * 0.22);
  pc += (offSkill - 0.6) * 0.08;
  pc = clamp(pc, 0.3, 0.97);
  if (w.rng.next() < pc) return complete(w, b, rec);
  // drop
  w.emit("drop", { player: rec });
  incomplete(w, b, "drop");
}

function deflect(w, b, d, swat = false) {
  w.emit("deflect", { player: d, swat });
  b.vx = b.vx * -0.25 + w.rng.range(-2, 2);
  b.vy = b.vy * 0.2 + w.rng.range(-3, 3) * parOf(w);
  incomplete(w, b, "breakup");
  w.play.breakup = d;
}

function complete(w, b, rec) {
  if (rec.y < 0 || rec.y > FW || rec.x > 110) {
    incomplete(w, b, "oob");
    return;
  }
  b.holdBy(rec);
  rec.stats.rec++;
  w.play.completed = true;
  w.play.catchX = rec.x;
  w.play.catchT = w.time;
  const qb = b.from;
  if (qb) qb.stats.comp++;
  w.teamStats(rec.team).comp++;
  w.emit("catch", { player: rec, contested: false });
  w.setCarrier(rec, "catch");
}

function intercept(w, b, d) {
  // picked off out of bounds (past a sideline or an end line): no interception
  if (d.y < 0 || d.y > FW || d.x > 110 || d.x < -10) return deflect(w, b, d);
  b.holdBy(d);
  d.stats.ints++;
  w.play.intercepted = true;
  w.play.intSpot = d.x;
  disengage(w, d);
  w.emit("interception", { player: d });
  w.setCarrier(d, "int");
}
