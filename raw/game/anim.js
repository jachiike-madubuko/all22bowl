// Procedural sprite poses (single-frame sprites, so all motion is procedural and whole-pixel).
// This module OWNS p.anim (presentation state): attachAnim(bus) subscribes to the sim's events and
// sets the pose state; the sim (world/physics) never writes p.anim. poseFor() turns it into a pose.
// poseFor(player, time, out) → {ox, oy, sx, sy, lean, rot, lying, flat, flash, alpha, hidden,
//   sprint, spin, air}
//   ox/oy: whole-pixel offsets; sx/sy: squash/stretch (applied as whole-pixel size changes);
//   lean: shear in px (top of the sprite shifts toward the facing direction);
//   rot: degrees CLOCKWISE on screen, quantized to 15° (nearest-neighbor rotation in the renderer);
//   lying: 0 | 90 | -90 (on the turf, head to the right / left); flat: pancake squash (0..1);
//   spin: a juke spin is on (the renderer draws rotation afterimages); air: px off the ground.

// The per-player presentation slot (Player constructor calls this; only anim/fx/render touch it).
export function makeAnimState() {
  return {
    state: "idle", t0: 0, phase: 0, flash: 0, hopT: -9, spinT: -9, throwT: -9, catchT: -9, hitT: -9, diveT: -9, celebT: -9,
    trail: [], trailT: 0, rot: 1, dust: 0, delay: 0, pileRot: 75, pileUp: 4, fall: 1, then: "", kneelAt: 0, dustT: 0,
  };
}

const LINE = { OL: 1, DE: 1, DT: 1, NT: 1 };
const LINE_TE = { OL: 1, DE: 1, DT: 1, NT: 1, TE: 1 };

// New down / new phase: back in a stance, no trail, no flash.
function resetAnim(p) {
  const a = p.anim;
  a.state = "stance";
  a.trail.length = 0;
  a.flash = 0;
  a.delay = 0;
  a.then = "";
}
function set(p, state, t) {
  if (!p) return;
  p.anim.state = state;
  p.anim.t0 = t;
}
// Small deterministic per-player variety (no RNG: presentation must not touch the sim's RNG).
const vary = (p, k) => (((p.id * 7919 + k * 104729 + (p.slot ? p.slot.length * 31 : 0)) % 1000) / 1000);

// Event-driven pose state. One call per bus (the live bus is shared by the game and the
// title-screen attract world; each listener gets the emitting World as its third argument).
// Register BEFORE fx/audio so their listeners see the new pose state (as when the sim set it).
export function attachAnim(bus) {
  const offs = [];
  const on = (type, fn) => offs.push(bus.on(type, fn));
  // ---- flow ----
  // 'kickoff' = both units line up (receiving team = offense); the boot is 'kick' {kind:'kickoff'|
  // 'onside'} below, when everybody starts running. The kicker's approach animates from his speed.
  on("kickoff", ({ returner }, _, w) => {
    for (const p of w.players) { resetAnim(p); p.anim.state = "idle"; }
    if (returner) set(returner, "ready", w.time);
  });
  on("playCall", (_, __, w) => {
    for (const p of w.players) { resetAnim(p); p.anim.state = "idle"; }
  });
  on("presnap", (_, __, w) => {
    for (const p of w.players) {
      resetAnim(p);
      set(p, LINE[p.pos] ? "stance" : "idle", w.time);
    }
  });
  // players jogging to their spots stand up; set linemen (and TEs) get down in a stance
  on("formationStep", (_, __, w) => {
    for (const p of w.players) {
      const a = p.anim;
      if (p.vx !== 0 || p.vy !== 0) {
        if (a.state === "stance") a.state = "idle";
      } else {
        if (a.state !== "stance" && a.state !== "idle" && a.state !== "kneel") a.state = "idle";
        if (LINE_TE[p.pos]) a.state = "stance";
      }
    }
  });
  on("snap", ({ qb }, _, w) => {
    for (const p of w.players) set(p, "run", w.time);
    const c = w.offPlayers.find((p) => p.slot === "C");
    if (c) set(c, "hike", w.time);
  });
  // get back up once the sim lets a player move again; delayed pile-ons
  on("liveStep", (_, __, w) => {
    const t = w.time;
    for (const p of w.players) {
      const a = p.anim;
      const s = a.state;
      if (p.downUntil > t || p.state === "tackled" || p.stunUntil > t || t - a.t0 <= 0.3) continue;
      if (s === "stumble") set(p, "run", t);
      else if (s === "down" || s === "pancaked" || s === "dive" || (s === "pile" && t - a.t0 > 0.9)) set(p, "rise", t);
    }
  });
  // a fumble keeps the play alive: nobody stays on the pile
  on("fumble", (_, __, w) => {
    for (const p of w.players) if (p.anim.state === "pile") set(p, "run", w.time);
  });
  on("touchdown", ({ scorer, team }, _, w) => {
    if (!scorer) return;
    scorer.anim.state = "celebrate";
    scorer.anim.celebT = w.time;
    for (const p of w.players) {
      if (p === scorer || p.team !== team || p.state === "tackled") continue;
      set(p, "hype", w.time + vary(p, 1) * 0.5);
    }
  });
  on("outOfBounds", ({ player }, _, w) => set(player, "oob", w.time));
  // ---- kicks ----
  on("kickSet", ({ kind, holder }, _, w) => { if (kind === "fg") set(holder, "kneel", w.time); });
  on("kick", ({ kicker }, _, w) => set(kicker, "kick", w.time));
  // [football round 2 wiring] kickoffs are live plays now: everybody runs on the boot; a returner
  // who takes a knee kneels; a good 2-point try celebrates like a TD.
  on("kick", ({ kind, kicker }, _, w) => {
    if (kind !== "kickoff" && kind !== "onside") return;
    for (const p of w.players) if (p !== kicker && (p.anim.state === "idle" || p.anim.state === "stance")) set(p, "run", w.time);
  });
  on("touchback", ({ player, kneel }, _, w) => { if (player && kneel) set(player, "kneel", w.time); });
  on("twoPoint", ({ good, scorer }, _, w) => {
    if (!good || !scorer) return;
    scorer.anim.state = "celebrate";
    scorer.anim.celebT = w.time;
  });
  on("punt", ({ kicker }, _, w) => set(kicker, "kick", w.time));
  on("pat", ({ kicker }, _, w) => {
    for (const p of w.players) resetAnim(p);
    set(kicker, "kick", w.time);
    const h = w.offPlayers.find((p) => p.slot === "QB");
    if (h) set(h, "kneel", w.time);
  });
  // ---- ball ----
  on("throwStart", ({ qb }, _, w) => {
    qb.anim.state = "throw";
    qb.anim.throwT = w.time;
  });
  on("handoff", ({ from, pitch }, _, w) => {
    if (pitch) {
      from.anim.state = "throw";
      from.anim.throwT = w.time;
    } else set(from, "handoff", w.time);
  });
  on("fake", ({ qb }, _, w) => set(qb, "handoff", w.time));
  on("catch", ({ player, kick }, _, w) => {
    if (!player) return;
    const a = player.anim;
    // a kick fielded in the end zone is taken down (touchback kneel); anywhere else it's a catch
    a.state = kick && player.x < 0.5 ? "catchKneel" : "catch";
    a.catchT = w.time;
    a.t0 = w.time;
    a.flash = w.time + 0.08;
  });
  on("interception", ({ player }, _, w) => {
    player.anim.state = "catch";
    player.anim.catchT = w.time;
    player.anim.flash = w.time + 0.12;
  });
  on("drop", ({ player }, _, w) => set(player, "drop", w.time));
  on("deflect", ({ player, swat }, _, w) => { if (swat) set(player, "swat", w.time); });
  on("fumbleDive", ({ player }, _, w) => {
    set(player, "dive", w.time);
    player.anim.diveT = w.time;
    player.anim.fall = w.ball.x >= player.x ? 1 : -1;
  });
  // ---- contact ----
  on("block", ({ blocker, defender }, _, w) => {
    set(blocker, "block", w.time);
    set(defender, "block", w.time);
  });
  on("disengage", ({ defender, blockers }, _, w) => {
    for (const b of blockers) if (b.anim.state === "block") set(b, "run", w.time);
    if (defender.anim.state === "block") set(defender, "run", w.time);
  });
  on("pancake", ({ blocker, defender }, _, w) => {
    set(blocker, "drive", w.time);
    set(defender, "pancaked", w.time);
    defender.anim.fall = defender.x < blocker.x ? -1 : 1;
    defender.anim.flash = w.time + 0.06;
  });
  on("brokenTackle", ({ tackler }, _, w) => {
    set(tackler, "stumble", w.time);
    tackler.anim.flash = w.time + 0.05;
  });
  on("tackle", ({ tackler, carrier }, _, w) => {
    const t = w.time;
    const c = carrier.anim;
    c.state = "tumble";
    c.t0 = t;
    c.hitT = t;
    c.flash = t + 0.06;
    // fall away from the hit, on screen
    c.fall = tackler.x <= carrier.x ? 1 : -1;
    if (Math.abs(tackler.x - carrier.x) < 0.2) c.fall = carrier.facing >= 0 ? 1 : -1;
    set(tackler, "dive", t);
    tackler.anim.diveT = t;
    tackler.anim.fall = tackler.x <= carrier.x ? 1 : -1;
    // gang tackle: nearby defenders pile on, staggered
    let n = 0;
    for (const p of w.players) {
      if (p === tackler || p === carrier || p.team === carrier.team || p.state === "tackled" || p.downUntil > t) continue;
      const d = Math.hypot(p.x - carrier.x, p.y - carrier.y);
      if (d > 2.1 || n >= 3) continue;
      n++;
      const a = p.anim;
      a.state = "pile";
      a.t0 = t + 0.06 + n * 0.07;
      a.fall = p.x <= carrier.x ? 1 : -1;
      a.pileRot = 45 + Math.round(vary(p, 3) * 3) * 15;
      a.pileUp = 3 + n * 3;
    }
  });
  on("juke", ({ player }, _, w) => {
    player.anim.state = "juke";
    player.anim.spinT = w.time;
  });
  on("stiffArm", ({ player }, _, w) => {
    set(player, "stiff", w.time);
    player.anim.flash = w.time + 0.05;
  });
  on("dive", ({ player }, _, w) => {
    set(player, "dive", w.time);
    player.anim.diveT = w.time;
    player.anim.fall = player.facing >= 0 ? 1 : -1;
  });
  on("diveEnd", ({ player }, _, w) => {
    if (player.anim.state === "dive") set(player, "down", w.time);
  });
  return () => { for (const off of offs) off(); };
}

const STEP = 15;
const q = (deg) => Math.round(deg / STEP) * STEP;

export function makePose() {
  return { ox: 0, oy: 0, sx: 1, sy: 1, lean: 0, rot: 0, lying: 0, flat: 0, flash: false, alpha: 1, hidden: false, sprint: 0, spin: false, air: 0 };
}

export function poseFor(p, t, out) {
  out.ox = 0;
  out.oy = 0;
  out.sx = 1;
  out.sy = 1;
  out.lean = 0;
  out.rot = 0;
  out.lying = 0;
  out.flat = 0;
  out.alpha = 1;
  out.spin = false;
  out.air = 0;
  out.flash = p.anim.flash > t;
  out.hidden = false;
  const a = p.anim;
  const sp = Math.hypot(p.vx, p.vy);
  const sprint = Math.min(1, sp / Math.max(1, p.r.speed));
  out.sprint = sprint;
  const since = t - a.t0;
  const fwd = p.facing >= 0 ? 1 : -1; // clockwise = falling toward +x on screen
  switch (a.state) {
    case "stance":
      out.sy = 0.88;
      out.sx = 1.06;
      out.oy = 0;
      // a breath every couple of seconds
      if (((t * 0.7 + vary(p, 2)) % 1) < 0.12) out.sy = 0.9;
      return out;
    case "idle":
      if (sp > 0.6) return runPose(p, t, sp, sprint, out);
      out.sy = ((t * 0.55 + vary(p, 4)) % 1) < 0.18 ? 1.03 : 1;
      return out;
    case "kneel":
      out.sy = 0.8;
      out.sx = 1.06;
      return out;
    case "ready": {
      // kickoff returner waiting under the ball: bouncing on his toes
      if (sp > 1.2) return runPose(p, t, sp, sprint, out);
      out.oy = ((t * 5 + vary(p, 5)) % 1) < 0.5 ? -1 : 0;
      out.sy = 1.04;
      return out;
    }
    case "catchKneel": {
      const u = since / 0.3;
      if (u < 1) {
        out.oy = -Math.round(Math.sin(Math.PI * u) * 5);
        out.air = -out.oy;
        out.sy = u < 0.25 ? 1.08 : 1;
        return out;
      }
      out.sy = 0.8;
      out.sx = 1.06;
      return out;
    }
    case "hike": {
      if (since < 0.16) {
        out.sy = 0.86;
        out.sx = 1.08;
        out.lean = -1;
        return out;
      }
      return runPose(p, t, sp, sprint, out);
    }
    case "block": {
      out.lean = 2 + (((t * 6 + vary(p, 6)) % 1) < 0.5 ? 1 : 0);
      out.ox = ((t * 18) | 0) % 2 ? 1 : 0;
      out.sx = 1.05;
      out.sy = 0.95;
      return out;
    }
    case "drive": {
      // a blocker who just pancaked his man: big lean, then back to running
      if (since < 0.45) {
        out.lean = 3;
        out.sx = 1.08;
        out.sy = 0.94;
        return out;
      }
      return runPose(p, t, sp, sprint, out);
    }
    case "pancaked": {
      // knocked onto his back, flattened, then lies there
      const back = -fwd;
      if (since < 0.1) {
        out.rot = q(45 * back);
        out.oy = -3;
        out.air = 3;
      } else {
        out.lying = 90 * back;
        out.flat = since < 0.22 ? 0.45 : since < 0.4 ? 0.25 : 0.15;
      }
      return out;
    }
    case "down":
      out.lying = 90 * (a.fall || fwd);
      return out;
    case "rise": {
      // getting up off the turf
      if (since < 0.09) out.rot = q(60 * (a.fall || fwd));
      else if (since < 0.18) out.rot = q(30 * (a.fall || fwd));
      else if (since < 0.28) { out.sy = 0.9; out.sx = 1.05; }
      else return runPose(p, t, sp, sprint, out);
      return out;
    }
    case "tumble": {
      // the hit: flash, lifted and spun by the tackle, lands, a little bounce, lies still
      const d = a.fall || 1;
      if (since < 0.06) { out.rot = q(30 * d); out.flash = true; }
      else if (since < 0.16) { out.rot = q(60 * d); out.oy = -4; out.air = 4; }
      else if (since < 0.24) { out.rot = q(75 * d); out.oy = -2; out.air = 2; }
      else if (since < 0.3) out.lying = 90 * d;
      else if (since < 0.36) { out.lying = 90 * d; out.oy = -1; }
      else out.lying = 90 * d;
      return out;
    }
    case "oob": {
      // skidding to a stop past the sideline
      if (since < 0.35) {
        out.lean = -2;
        out.sx = 1.06;
        out.sy = 0.94;
        return out;
      }
      if (sp > 0.8) return runPose(p, t, sp, sprint, out);
      return out;
    }
    case "dive": {
      // launch, arc through the air, land on the belly and slide
      const d = a.fall || fwd;
      const u = since / 0.34;
      if (u < 1) {
        out.rot = q(d * (25 + 65 * u));
        const h = Math.round(Math.sin(Math.PI * Math.min(1, u * 1.1)) * 8);
        out.oy = -h;
        out.air = h;
        out.sx = 1.06;
      } else out.lying = 90 * d;
      return out;
    }
    case "pile": {
      // pile-on: wait, hop onto the heap, stay on top of it
      if (since < 0) return runPose(p, t, sp, sprint, out);
      const d = a.fall || fwd;
      const u = since / 0.28;
      if (u < 1) {
        out.rot = q(d * (20 + (a.pileRot - 20) * u));
        const h = Math.round(Math.sin(Math.PI * u) * 7) + Math.round(a.pileUp * u);
        out.oy = -h;
        out.air = h;
      } else {
        out.rot = q(d * a.pileRot);
        out.oy = -a.pileUp;
        out.air = a.pileUp;
      }
      return out;
    }
    case "stumble": {
      const u = since / 0.6;
      if (u < 1) {
        out.rot = ((t * 10) | 0) % 2 ? 15 : -15;
        out.sy = 0.94;
        out.ox = -fwd * (since < 0.12 ? 2 : 1);
        return out;
      }
      return runPose(p, t, sp, sprint, out);
    }
    case "throw": {
      const u = t - a.throwT;
      if (u < 0.18) {
        out.lean = -2;
        out.sx = 0.96;
        out.sy = 1.02;
      } else if (u < 0.3) {
        out.lean = 3;
        out.sx = 1.12;
        out.sy = 0.94;
        if (u < 0.22) out.flash = true;
      } else if (u < 0.5) out.lean = 1;
      else return runPose(p, t, sp, sprint, out);
      return out;
    }
    case "handoff": {
      if (since < 0.22) {
        out.lean = 2;
        out.sx = 1.04;
        return out;
      }
      return runPose(p, t, sp, sprint, out);
    }
    case "kick": {
      if (since < 0.15) {
        out.lean = -2;
        out.sy = 1.02;
      } else if (since < 0.32) {
        out.lean = 3;
        out.oy = -2;
        out.air = 2;
        out.sx = 1.1;
        out.sy = 0.95;
        if (since < 0.19) out.flash = true;
      } else if (since < 0.6) {
        const u = (since - 0.32) / 0.28;
        out.lean = 2;
        out.oy = -Math.round(Math.sin(Math.PI * u) * 3);
        out.air = -out.oy;
      } else if (sp > 0.8) return runPose(p, t, sp, sprint, out);
      return out;
    }
    case "catch": {
      const u = (t - a.catchT) / 0.32;
      if (u < 1) {
        out.oy = -Math.round(Math.sin(Math.PI * u) * 7);
        out.air = -out.oy;
        out.sy = u < 0.2 ? 1.1 : u > 0.85 ? 0.92 : 1;
        if (u < 0.15) out.flash = true;
        return out;
      }
      return runPose(p, t, sp, sprint, out);
    }
    case "swat":
    case "drop": {
      const u = since / 0.32;
      if (u < 1) {
        out.oy = -Math.round(Math.sin(Math.PI * u) * 6);
        out.air = -out.oy;
        out.sy = u < 0.2 ? 1.08 : 1;
        return out;
      }
      if (a.state === "drop" && since < 0.7) {
        out.sy = 0.92;
        out.sx = 1.04;
        return out;
      }
      return runPose(p, t, sp, sprint, out);
    }
    case "juke": {
      const u = (t - a.spinT) / 0.3;
      if (u < 1) {
        out.rot = q(fwd * 360 * u) % 360;
        out.sx = 0.92;
        out.spin = true;
        if (p.types.includes("ghost") && ((t * 30) | 0) % 2) out.alpha = 0.5;
        return out;
      }
      return runPose(p, t, sp, sprint, out);
    }
    case "stiff": {
      if (since < 0.4) {
        out.lean = 3;
        out.sx = 1.12;
        out.sy = 0.96;
        out.ox = fwd * (since < 0.16 ? 3 : 1);
        return out;
      }
      return runPose(p, t, sp, sprint, out);
    }
    case "celebrate": {
      // the scorer: slows up, spikes the ball, then jump, jump, spin-jump
      let tt = t - a.celebT;
      if (tt < 0.5) {
        if (tt > 0.32) {
          out.lean = 3;
          out.sy = 0.9;
          out.sx = 1.08;
          return out;
        }
        return runPose(p, t, sp, sprint, out);
      }
      tt -= 0.5;
      const hop = 0.42;
      const k = Math.floor(tt / hop), u = (tt % hop) / hop;
      const h = Math.round(Math.sin(Math.PI * u) * 11);
      out.oy = -h;
      out.air = h;
      if (u < 0.12 || u > 0.9) {
        out.sy = 0.86;
        out.sx = 1.1;
      } else out.sy = 1.06;
      if (k % 3 === 2 && u > 0.1 && u < 0.9) out.rot = q(fwd * 360 * ((u - 0.1) / 0.8)) % 360;
      return out;
    }
    case "hype": {
      // teammates: run to the scorer, then bounce
      if (since < 0 || sp > 1.4) return runPose(p, t, sp, sprint, out);
      const hop = 0.38 + vary(p, 7) * 0.12;
      const u = ((t - a.t0) % hop) / hop;
      const h = Math.round(Math.sin(Math.PI * u) * (5 + vary(p, 8) * 5));
      out.oy = -h;
      out.air = h;
      if (u < 0.12) {
        out.sy = 0.9;
        out.sx = 1.06;
      }
      return out;
    }
    default:
      return runPose(p, t, sp, sprint, out);
  }
}

function runPose(p, t, sp, sprint, out) {
  if (sp < 0.5) {
    out.sy = ((t * 0.55 + vary(p, 4)) % 1) < 0.18 ? 1.03 : 1;
    return out;
  }
  // stride: hop rate grows with speed; bob 1–3 px
  const rate = 3.2 + sp * 0.9;
  const ph = (t + p.id * 0.13) * rate;
  const s = Math.abs(Math.sin(ph * Math.PI));
  out.oy = -Math.round(s * (1 + sprint * 2));
  out.air = -out.oy;
  out.lean = sprint > 0.85 ? 2 : sprint > 0.45 ? 1 : 0;
  if (s < 0.22) {
    out.sy = 0.94;
    out.sx = 1.05;
  }
  return out;
}

// Footfall test for dust puffs (true on the frame a foot lands).
export function footfall(p, t, dt) {
  const sp = Math.hypot(p.vx, p.vy);
  if (sp < 2.5) return false;
  const rate = 3.2 + sp * 0.9;
  const a = Math.floor((t + p.id * 0.13) * rate);
  const b = Math.floor((t - dt + p.id * 0.13) * rate);
  return a !== b;
}
