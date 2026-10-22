// Player and Ball. Plain data + tiny helpers; systems (physics/ai/world) do the work.
import { CFG } from "./config.js";
import { ratingsFor, roleOf, monData } from "./data.js";
import { makeAnimState } from "./anim.js";

const POS_OF_ROLE = { SLOT: "WR", DT: "DT", MLB: "MLB" };

export class Player {
  constructor(teamKey, slot, id, side, scheme, boost) {
    this.team = teamKey; // 'home' | 'away'
    this.slot = slot;
    this.id = id; // dex number
    this.side = side; // 'O' | 'D' | 'K'
    this.role = slot === "K" ? "K" : roleOf(slot, scheme);
    this.pos = POS_OF_ROLE[this.role] || this.role;
    this.r = ratingsFor(id, slot, scheme, boost);
    const d = monData(id) || { types: ["normal"] };
    this.types = d.types;
    this.rad = CFG.PLAYER_R * (0.9 + 0.25 * this.r.nk);
    this.mass = 0.55 + this.r.nk;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.tvx = 0; // desired velocity (set by AI / input)
    this.tvy = 0;
    this.facing = 1;
    this.homeX = 0; // alignment at the snap
    this.homeY = 0;
    this.fromX = 0; // where he started hustling to the alignment from (PRE_SNAP ease)
    this.fromY = 0;
    this.state = "idle"; // idle | stance | live | engaged | down | tackled | celebrate
    this.engaged = null; // blocker → defender it is locked with
    this.blockers = []; // defender ← blockers locked on it
    this.blockTarget = null;
    this.shedAt = 0;
    this.freeUntil = 0;
    this.noEngage = null;
    this.noEngageUntil = 0;
    this.stunUntil = 0;
    this.downUntil = 0;
    this.slowUntil = 0;
    this.lastTry = -9;
    this.diveUntil = 0;
    this.dived = false;
    this.jukeUntil = 0;
    this.jukeCd = 0;
    this.jukeDir = 1;
    this.stiffUntil = 0;
    this.stiffCd = 0;
    this.throwAt = 0;
    this.throwTarget = null;
    this.hasBall = false;
    this.isUser = false;
    this.onField = false;
    this.ai = { job: "idle", pts: null, pi: 0, t0: 0, target: null, zone: null, seenVx: 0, seenVy: 0, react: 0, sit: false, wait: 0, think: 0, mode: "", lane: null, hole: null, claimT: -1, claimBy: null, read: 0, ppTarget: null };
    this.anim = makeAnimState(); // presentation slot: owned by anim.js (set from bus events), never by the sim
    this.stats = { carries: 0, rushYds: 0, rec: 0, recYds: 0, att: 0, comp: 0, passYds: 0, td: 0, tackles: 0, sacks: 0, ints: 0, brokenTackles: 0, pancakes: 0, rets: 0, retYds: 0 };
  }
  get speed() {
    return Math.hypot(this.vx, this.vy);
  }
  isDown(t) {
    return this.downUntil > t || this.state === "tackled";
  }
  resetForDown() {
    this.vx = this.vy = this.tvx = this.tvy = 0;
    this.state = "stance";
    this.engaged = null;
    this.blockers.length = 0;
    this.blockTarget = null;
    this.shedAt = 0;
    this.freeUntil = 0;
    this.noEngage = null;
    this.noEngageUntil = 0;
    this.stunUntil = this.downUntil = this.slowUntil = 0;
    this.lastTry = -9;
    this.diveUntil = 0;
    this.dived = false;
    this.jukeUntil = this.jukeCd = this.stiffUntil = this.stiffCd = 0;
    this.throwAt = 0;
    this.throwTarget = null;
    this.hasBall = false;
    this.ai.job = "idle";
    this.ai.pts = null;
    this.ai.pi = 0;
    this.ai.target = null;
    this.ai.zone = null;
    this.ai.sit = false;
    this.ai.mode = "";
    this.ai.wait = 0;
    this.ai.seenVx = this.ai.seenVy = 0;
    this.ai.lane = null;
    this.ai.hole = null;
    this.ai.claimT = -1;
    this.ai.claimBy = null;
    this.ai.ppTarget = null;
    this.ai.jammed = false;
    this.ai.trail = 0;
    this.ai.assign = null;
    this.ai.wallDepth = 0;
    this.ai.stSlot = null; // special-teams formation spot (punt unit)
    this.ai.released = false;
  }
}

export class Ball {
  constructor() {
    this.state = "dead"; // held | air | loose | dead
    this.carrier = null;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.from = null;
    this.target = null; // intended receiver
    this.kind = "pass"; // pass | pitch | punt | fg | kickoff | kick (bouncing kick) | tee | snapback | fumble | dead
    this.tSpawn = 0;
    this.tArrive = 0;
    this.aimX = 0;
    this.aimY = 0;
    this.resolved = false;
    this.spin = 0;
    this.bounces = 0;
    this.good = false;
    this.landX = 0;
    this.onside = false;
    this.touchedR = false; // a kickoff touched by the receiving team
    this.restT = 0;
    this.fumbledBy = null;
  }
  holdBy(p) {
    this.state = "held";
    this.carrier = p;
    this.kind = "dead";
    this.target = null;
    this.z = 1.0;
    this.vx = this.vy = this.vz = 0;
    p.hasBall = true;
  }
}
