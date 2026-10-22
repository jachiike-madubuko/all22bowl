// Game state machine + rules: phases of a down, downs & distance, scoring, PAT / 2-point tries,
// FG, punts and kickoffs with real returns, clock, quarters, halftime, overtime, stats, invariants.
// No DOM: the live game, the title-screen attract mode and headless simulate() all run this.
//
// ============================ ROUND-2 RULES & EVENTS ============================
// Phases: PREGAME → KICKOFF (teams set, kicker's approach; the human kicking team picks A=deep /
//   B=onside or calls chooseKickoff('deep'|'onside')) → LIVE (the kick, the return) → DEAD → ...
//   → PLAY_CALL → PRE_SNAP → LIVE → DEAD → ... After a TD (not in OT): PAT_CHOICE (the human calls
//   choosePAT('kick'|'two') or presses A=kick / B=go for two; the CPU follows the 2-point chart)
//   → PAT (kick presentation) or a 2-point try (a normal PLAY_CALL/PRE_SNAP/LIVE down from the 2,
//   w.tryMode = {team}; untimed) → KICKOFF. After a safety the safetied team free-kicks from its 20.
// Kickoff frame: the receiving team is the offense (moves right); the kick comes from w.kickSpot.
// Punts: the punting team stays the offense; the returner runs back toward x = 0.
// w.play.kick: 'kickoff' | 'punt' | 'fg' | null;  w.play.kickAway: the ball has left the foot;
// w.play.returner / w.play.ret = {kind, player, catchX, inEZ, left}; w.play.onside; w.play.fairCatch.
// API (new): choosePAT(choice), chooseKickoff(kind), actionLabels() → {a, b} | null (button labels
//   for the current special-teams context), signalFairCatch via the human returner's B button.
// FLIP: submitCall(side, id, flip) runs a call mirrored (playbook.js mirrorPlay; the CPU offense flips too, cpuCall /
//   AI.cpuFlip). A defense lines up to the offense's formation: its calls are drawn for an offense with its strength (the
//   tight end) on the right, so against a flipped offense it mirrors too, and its own FLIP mirrors it against the
//   formation (its blitz and strong side go the other way). w.play.flips = {off, def} (the calls), w.play.off.flip /
//   w.play.def.flip (how they line up), w.play.par (−1: the flipped offense's mirror parity).
// New events (payloads; everything else unchanged — see events.js):
//   kickoff {receiver, kicker, returner, kicking, free, spot}  (teams lined up; banner time)
//   kick {kind:'kickoff'|'onside'|'fg', kicker, distance}       (the boot)
//   onside {team, kicker}                                        (onside kick attempted)
//   onsideRecovered {team (kicking), success, player}
//   kickBounce {x, y}                                            (a kick hit the turf unfielded)
//   return {player, kind:'kickoff'|'punt', x, y}                 (a returner has it and goes)
//   fairCatch {player, stage:'signal'|'catch'}
//   touchback {team (receiving), kind:'kickoff'|'punt', player, kneel}
//   puntDowned {player, x}
//   scoop {player}                                               (a defender scoops a fumble and runs)
//   patChoice {team, choice:'kick'|'two'}
//   twoPoint {team, good, scorer?, defensive?}                   (no 'touchdown' event on a try)
//   catch {player, kick:true} only for a touchback kneel; returns send catch {player, ret}.
//   tackle {..., progress:true} for a forward-progress whistle.
// Whistle results (result.type): td, tackle, oob, incomplete, fg, punt(legacy), safety, recovery,
//   touchback, fairCatch, downed, kickOob, kickRecovery; result.label = short broadcast text for kick
//   plays / tries / returns (lower third); result.returnYds on returns.
// Team stats (stats[team], summary().home/away) add: kr krYds pr prYds retTds longRet intRetYds,
//   longPlay (longest gain from scrimmage), top (seconds of possession), defTds, touchbacks,
//   fairCatches, patAtt patMade twoPtAtt twoPtMade onsideAtt onsideRec. Pick-sixes count in the
//   thrower's ints and fumble-return TDs in the fumbler's fumblesLost. Player stats add rets, retYds.
// Feel: the formation hustles into place in CFG.SET_SEC and an early SNAP is queued (fires at
//   CFG.PRESNAP_MIN_SEC); a carrier stood up in a pile is down at his furthest spot (forward progress).
// ===============================================================================
import { CFG } from "./config.js";
import { makeRng, clamp } from "./util.js";
import { Player, Ball } from "./entities.js";
import { OFF_SLOTS, DEF_SLOTS, resolveColors } from "./data.js";
import { offPlay, defPlay, KICK_PLAYS, RETURN_PLAY, mirrorPlay } from "./playbook.js";
import * as PH from "./physics.js";
import * as AI from "./ai.js";
import * as ST from "./football-special.js";
import { NO_PAYLOAD } from "./events.js";

const FW = CFG.FIELD_W;
const MID = FW / 2;
const ease = (k) => k * k * (3 - 2 * k);

function newTeamStats() {
  return {
    plays: 0, rushes: 0, rushYds: 0, att: 0, comp: 0, passYds: 0, sacks: 0, sackYds: 0, ints: 0, fumblesLost: 0, firstDowns: 0, tds: 0,
    totalYds: 0, punts: 0, fgMade: 0, fgAtt: 0, thirdAtt: 0, thirdConv: 0, bigPlays: 0, top: 0,
    // round 2
    kr: 0, krYds: 0, pr: 0, prYds: 0, retTds: 0, longRet: 0, longPlay: 0, defTds: 0, touchbacks: 0, fairCatches: 0,
    twoPtAtt: 0, twoPtMade: 0, patAtt: 0, patMade: 0, onsideAtt: 0, onsideRec: 0, intRetYds: 0,
  };
}

const yardText = (x) => {
  const v = Math.round(x);
  return v === 50 ? "50" : String(v < 50 ? v : 100 - v);
};

export class World {
  constructor(opts) {
    this.bus = opts.bus;
    this.seed = opts.seed >>> 0 || 1;
    this.rng = makeRng(this.seed);
    this.headless = !!opts.headless;
    this.autoplay = !!opts.autoplay;
    this.human = this.autoplay ? null : opts.human || "home";
    this.debug = !!opts.debug;
    this.quarterSec = opts.quarterSec || CFG.QUARTER_SEC;
    const home = opts.home, away = opts.away;
    resolveColors(home, away);
    this.teams = { home: this.makeTeam("home", home), away: this.makeTeam("away", away) };
    this.ball = new Ball();
    this.players = [];
    this.offPlayers = [];
    this.defPlayers = [];
    this.time = 0;
    this.dtStep = CFG.DT;
    this.phase = "PREGAME";
    this.phaseT = 0;
    this.quarter = 1;
    this.clock = this.quarterSec;
    this.score = { home: 0, away: 0 };
    this.possession = "home";
    this.down = 1;
    this.toGo = 10;
    this.los = 25;
    this.ballY = MID;
    this.firstDownX = 35;
    this.play = null;
    this.pending = {};
    this.lastCall = {};
    this.overtime = false;
    this.otPoss = { home: 0, away: 0 };
    this.log = [];
    this.errors = [];
    this.stats = { home: newTeamStats(), away: newTeamStats() };
    this.userPlayer = null;
    this.userActive = false;
    this.stickIdle = true;
    this.input = null;
    this.snapRequested = false;
    this.resume = "call";
    this.openingReceiver = null;
    this.winner = null;
    this.deadWait = CFG.DEAD_TIME;
    this.downs = 0;
    this.stuck = 0;
    this.playDurations = 0;
    this.lastClock = this.clock;
    this.lastScoreSum = 0;
    this.scoreEvents = 0;
    this.kick = null;
    this.drive = { plays: 0, yards: 0, start: 25 };
    this.fourthDown = false;
    this.slowmo = false;
    this.kickSpot = 100 - CFG.KICKOFF_SPOT;
    this.kickChoice = null;
    this.kickReadyAt = 0;
    this.kickTeam = null;
    this.onsideLast = { home: false, away: false }; // each team's last kickoff was an onside kick
    this.patTeam = null;
    this.patChoice = null;
    this.tryMode = null;
  }

  makeTeam(key, data) {
    const O = OFF_SLOTS.map((s) => new Player(key, s, data.lineup[s], "O", data.scheme, data.boost || 1));
    const D = DEF_SLOTS.map((s) => new Player(key, s, data.lineup[s], "D", data.scheme, data.boost || 1));
    const K = new Player(key, "K", data.lineup.K || data.lineup.QB, "K", data.scheme, data.boost || 1);
    return { key, data, O, D, K, all: [...O, ...D, K] };
  }

  get offense() { return this.possession; }
  get defense() { return this.possession === "home" ? "away" : "home"; }
  other(team) { return team === "home" ? "away" : "home"; }
  teamStats(team) { return this.stats[team]; }
  scoreDiff(team) { return this.score[team] - this.score[this.other(team)]; }
  dirOf(p) { return p.team === this.offense ? 1 : -1; }
  isHuman(team) { return !this.autoplay && this.human === team; }

  // Every sim event goes out through here: listeners get (payload, type, world).
  emit(type, payload) {
    this.bus.emit(type, payload, this);
  }

  setPhase(ph) {
    this.phase = ph;
    this.phaseT = 0;
  }
  waited(s) {
    return this.phaseT >= (this.headless ? Math.min(s, CFG.HEADLESS_WAIT) : s);
  }

  // A fresh play record (scrimmage downs, kicks, tries).
  newPlay(off, def, extra) {
    return Object.assign({
      off, def, t: 0, thrown: false, handed: false, completed: false, intercepted: false, turnover: false, turnoverKind: null, fumbled: false,
      qbRunner: false, faked: false, result: null, progression: [], targetIdx: 0, kick: off.type === "kick" ? off.kick : null,
      offSkill: this.teams[this.offense].data.skill, defSkill: this.teams[this.defense].data.skill, startLos: this.los, startDown: this.down,
      startToGo: this.toGo, carrierStartX: this.los, rushPlay: false, maxX: this.los, catchX: 0, clockOn: true, kickAway: false,
      ret: null, gain: null, returner: null, returnYds: null, onside: false, fairCatch: null, tryMode: !!this.tryMode, handT: 0,
      par: off.flip ? -1 : 1, // mirror parity: a FLIPped offensive call runs as the mirror image (ai.js parOf)
      flips: null, // the calls' FLIPs {off, def} (scrimmage downs)
    }, extra || {});
  }

  // ---------- main step ----------
  // input: the human's intents for this step (Input.state, read-only here; null for CPU-only
  // worlds). consumedInput tells the caller the edge presses were used (→ input.endTick()).
  update(dt, input = null) {
    this.input = input;
    this.consumedInput = false;
    this.dtStep = dt;
    this.time += dt;
    this.phaseT += dt;
    switch (this.phase) {
      case "PREGAME":
        this.startGame();
        break;
      case "KICKOFF":
        this.kickoffSetStep(dt);
        break;
      case "PLAY_CALL":
        this.huddleStep(dt);
        if (this.pending.off && this.pending.def) this.toPreSnap();
        else if (this.phaseT > CFG.PLAYCLOCK * 3) this.autoCallMissing();
        break;
      case "PRE_SNAP":
        this.preSnapStep(dt);
        break;
      case "LIVE":
        this.liveStep(dt);
        break;
      case "DEAD":
        this.deadStep(dt);
        if (this.waited(this.deadWait)) this.applyResult();
        break;
      case "PAT_CHOICE":
        this.patChoiceStep(dt);
        break;
      case "PAT":
        this.kickFlight(dt);
        if (this.waited(1.5)) this.afterPat();
        break;
      case "QUARTER_BREAK":
        this.easePlayers(dt);
        if (this.waited(1.6)) this.resumeAfterBreak();
        break;
      case "HALFTIME":
        if (this.autoplay || this.headless ? this.waited(2.5) : this.halftimeDone) this.startSecondHalf();
        break;
      case "GAME_OVER":
        this.easePlayers(dt);
        break;
    }
    if (this.debug || this.headless) this.checkInvariants();
  }

  // ---------- game flow ----------
  startGame() {
    this.receivingFirst = this.rng.chance(0.5) ? "home" : "away";
    this.openingReceiver = this.receivingFirst;
    this.startKickoff(this.receivingFirst);
  }

  // Kickoff (or a free kick after a safety): line both units up; the boot comes after the kicker's
  // approach (CPU) or the human's A (deep) / B (onside).
  startKickoff(receiver, opts = {}) {
    const kickTeam = this.other(receiver);
    this.possession = receiver;
    this.tryMode = null;
    this.kickTeam = kickTeam;
    const units = ST.kickoffUnits(this, receiver, kickTeam);
    this.fieldPlayers(units.R, units.K);
    for (const p of this.players) {
      p.resetForDown();
      p.state = "stance";
    }
    const free = !!opts.free;
    this.kickSpot = 100 - (free ? CFG.FREE_KICK_SPOT : CFG.KICKOFF_SPOT);
    this.los = this.kickSpot;
    this.ballY = MID;
    this.down = 1;
    this.toGo = 10;
    this.firstDownX = 100;
    const human = this.isHuman(kickTeam);
    const onsideCall = AI.cpuOnside(this, kickTeam);
    // a CPU onside kick lines up like any kickoff and shifts into the onside bunch as the human's does
    this.cpuOnsideCall = !human && onsideCall;
    this.kickChoice = human || onsideCall ? null : "deep";
    this.kickReadyAt = this.kickChoice ? CFG.KICKOFF_SET : Infinity;
    this.play = this.newPlay(KICK_PLAYS.kickoff, RETURN_PLAY, { kick: "kickoff", clockOn: false, free, kickTeam, startLos: this.kickSpot });
    // the receiving team brings its hands team when it sees an onside kick coming: the kicking team trailing late, or
    // one that has tried one this game, on its very next kickoff and from the 4th quarter on (a trick team's first one,
    // or the human's, is a surprise; a deep kick into the hands team costs the kicker field position, so not all game)
    const tried = this.teamStats(kickTeam).onsideAtt > 0 && (this.onsideLast[kickTeam] || this.quarter >= 4 || this.overtime);
    const expectOnside = AI.onsideTime(this, kickTeam) || tried;
    const { kicker, returner } = ST.setupKickoff(this, { free, onside: this.kickChoice === "onside", expectOnside, roles: units.roles });
    this.play.kicker = kicker;
    this.play.returner = returner;
    this.kick = { kind: "kickoff", k: kicker, stage: "set", free };
    const b = this.ball;
    b.state = "held";
    b.carrier = null;
    b.kind = "tee";
    b.onside = false;
    b.x = this.kickSpot - 0.3;
    b.y = MID;
    b.z = 0.15;
    b.vx = b.vy = b.vz = 0;
    // the human: the returner when receiving, a coverage man when kicking
    for (const t of ["home", "away"]) for (const p of this.teams[t].all) p.isUser = false;
    this.userPlayer = null;
    this.userActive = false;
    if (this.human && !this.autoplay) {
      if (receiver === this.human) this.setUser(returner);
      else {
        // kicking: the cover man nearest the middle of the field (on screen, right behind the ball,
        // with a lane at the returner) — the defense's ILB1 often isn't on the kickoff unit at all
        let best = null, bd = 1e9;
        for (const p of this.defPlayers) {
          if (p === kicker || p.slot === "K") continue;
          const d = Math.abs(p.y - MID);
          if (d < bd) { bd = d; best = p; }
        }
        this.setUser(best || this.defPlayers.find((p) => p.slot === (this.prevDefUserSlot || "ILB1")) || this.defPlayers[4]);
      }
    }
    this.setPhase("KICKOFF");
    this.emit("kickoff", { receiver, kicker, returner, kicking: kickTeam, free, spot: this.kickSpot });
  }

  kickoffSetStep(dt) {
    const inp = this.input;
    if (this.cpuOnsideCall && !this.kickChoice && this.phaseT >= CFG.ONSIDE_CPU_CALL) this.chooseKickoff("onside");
    if (this.isHuman(this.defense) && !this.kickChoice) {
      if (inp) {
        this.consumedInput = true;
        if (this.phaseT > 0.35) {
          if (inp.aPressed) this.chooseKickoff("deep");
          else if (inp.bPressed) this.chooseKickoff("onside");
        }
      }
      // trailing: ui.js shows the DEEP / ONSIDE decision panel (same condition as flowWanted) — give
      // a first-time reader time to take it in; otherwise the quick A = deep / B = onside hint
      const lim = this.score[this.human] < this.score[this.offense] ? CFG.KICKOFF_CHOICE_AUTO : CFG.KICKOFF_HUMAN_AUTO;
      if (this.phaseT > lim) this.chooseKickoff("deep");
    }
    ST.preKickStep(this, this.kick.k, dt, this.kickReadyAt - this.phaseT);
    for (const p of this.players) PH.integrate(this, p, dt);
    PH.separate(this);
    if (!this.kickChoice) return;
    // headless worlds run the same approach (no shortcut), so simulate() measures the real kickoff
    if (this.phaseT >= this.kickReadyAt) this.bootKickoff();
  }

  // The human kicking team's call (A = deep, B = onside also work; the CPU's onside call comes here too). False
  // when there's no call open. The onside shift gets ONSIDE_SHIFT to set before the boot.
  chooseKickoff(kind) {
    if (this.phase !== "KICKOFF" || this.kickChoice) return false;
    this.kickChoice = kind === "onside" ? "onside" : "deep";
    if (this.kickChoice === "onside") ST.alignKickingTeam(this, true);
    this.kickReadyAt = this.phaseT + (this.kickChoice === "onside" ? CFG.ONSIDE_SHIFT : 0.75);
    return true;
  }

  bootKickoff() {
    const k = this.kick;
    const play = this.play;
    const onside = this.kickChoice === "onside";
    const info = ST.launchKickoff(this, k.k, onside ? "onside" : "deep", k.free);
    play.onside = onside;
    play.kickAway = true;
    k.stage = onside ? "loose" : "flight";
    ST.assignReturnBlocks(this);
    this.onsideLast[this.defense] = onside;
    if (onside) {
      this.teamStats(this.defense).onsideAtt++;
      this.emit("onside", { team: this.defense, kicker: k.k });
    }
    this.setPhase("LIVE");
    for (const p of this.players) p.state = "live";
    this.emit("kick", { kind: onside ? "onside" : "kickoff", kicker: k.k, distance: info.distance });
  }

  setPossession(team, los, mirrorEvent = true) {
    const changed = team !== this.possession;
    this.possession = team;
    this.los = clamp(los, 1, 99);
    this.down = 1;
    this.toGo = Math.min(10, 100 - this.los);
    this.firstDownX = Math.min(100, this.los + 10);
    this.ballY = MID;
    this.drive = { plays: 0, yards: 0, start: this.los };
    if (changed || mirrorEvent) this.emit("possession", { team });
  }

  toPlayCall() {
    // overtime: possessions are counted when they start (otPoss), so the offense has finished one fewer: see otOver
    if (this.overtime && !this.tryMode && this.otOver(this.otPoss[this.offense] - 1, this.otPoss[this.defense])) return this.endGame();
    this.setPhase("PLAY_CALL");
    this.pending = {};
    this.kick = null;
    this.fourthDown = this.down === 4 && !this.tryMode;
    this.fieldPlayers(this.teams[this.offense].O, this.teams[this.defense].D);
    this.ball.state = "dead";
    this.ball.x = this.los;
    this.ball.y = this.ballY;
    this.ball.z = 0.1;
    this.setupHuddles();
    // CPU sides call instantly; the human's side waits for the UI
    const off = this.offense, def = this.defense;
    if (!this.isHuman(off)) this.cpuCall("off");
    if (!this.isHuman(def)) this.cpuCall("def");
    this.emit("playCall", { offense: off, defense: def, down: this.down, toGo: this.toGo, los: this.los, fourth: this.fourthDown, human: this.human, tryMode: !!this.tryMode });
  }

  // Both teams jog into huddles while the plays are called.
  setupHuddles() {
    const spots = (list, cx, cy, face) => {
      list.forEach((p, i) => {
        const a = (i / list.length) * Math.PI * 2;
        p.resetForDown();
        p.state = "idle";
        p.hx = cx + Math.cos(a) * 1.9;
        p.hy = cy + Math.sin(a) * 2.3;
        if (Math.hypot(p.x - p.hx, p.y - p.hy) > 26 || !Number.isFinite(p.x)) {
          p.x = p.hx + (face > 0 ? -6 : 6);
          p.y = p.hy;
        }
        p.huddleFace = Math.cos(a) > 0 ? -1 : 1;
      });
    };
    spots(this.offPlayers, this.los - 7, this.ballY, 1);
    spots(this.defPlayers, Math.min(this.los + 7.5, 106), this.ballY, -1);
  }

  huddleStep(dt) {
    for (const p of this.players) {
      if (p.hx == null) continue;
      const d = PH.steer(this, p, p.hx, p.hy, 0.55, 1.2);
      if (d < 0.4) p.facing = p.huddleFace;
      PH.integrate(this, p, dt);
      if (d < 0.4) p.facing = p.huddleFace;
    }
    PH.separate(this);
  }

  cpuOffense(team) {
    if (this.tryMode) return AI.cpuOffenseCall(this, team);
    // last play of the half/game in range: kick it (end of the half: always take the points, even
    // trailing and even on 4th down, where the chart would punt from the long end of the range; end
    // of the game: only when 3 points ties it or better)
    const lastKick = (this.quarter === 2 || this.quarter === 4) && this.clock < 6 && this.los >= CFG.FG_RANGE_LOS - 4 && (this.quarter === 2 || this.scoreDiff(team) >= -3) && !this.overtime;
    if (lastKick && this.quarter === 2) return "fg";
    if (this.down === 4) {
      const d = AI.cpuFourthDown(this, team);
      if (d === "punt" || d === "fg") return d;
    }
    if (lastKick) return "fg";
    return AI.cpuOffenseCall(this, team);
  }

  // The human's FIELD GOAL on 1st-3rd down (submitCall takes 'fg' on any down): in range (the 4th-down
  // panel's) with LATE_FG_SEC or less left in the 2nd or 4th quarter, or in overtime when a made kick
  // wins it (the other team has had its possession, tied). null when it isn't offered, else the coach's call:
  // 'fg' when 3 points help (as the CPU's last kick: always at the half, at the end of the game when they tie
  // it or better) or 'go' (run a play).
  lateKick() {
    if (this.tryMode || this.down === 4 || this.los < CFG.FG_RANGE_LOS) return null;
    if (this.overtime) return this.otPoss[this.defense] >= 1 && this.scoreDiff(this.offense) >= 0 ? "fg" : null;
    if ((this.quarter !== 2 && this.quarter !== 4) || this.clock > CFG.LATE_FG_SEC) return null;
    return this.quarter === 2 || this.scoreDiff(this.offense) >= -3 ? "fg" : "go";
  }

  // Identifies one play-call decision (so the UI shows exactly one panel per down per side).
  callKey(side) {
    return `${this.downs}|${this.quarter}|${this.possession}|${this.down}|${this.los.toFixed(2)}|${side}|${this.log.length}`;
  }

  autoCallMissing() {
    if (!this.pending.off) this.cpuCall("off");
    if (!this.pending.def) this.cpuCall("def");
  }

  // The CPU's call for one side ('off' | 'def'), FLIPped or not (AI.cpuFlip; never with CFG.CPU_FLIP off).
  cpuCall(side) {
    const id = side === "off" ? this.cpuOffense(this.offense) : AI.cpuDefenseCall(this, this.defense);
    this.pending[side] = id;
    this.pending[side + "Flip"] = AI.cpuFlip(this, side, id);
  }

  // The UI submits the human's call ('punt' / 'fg' allowed on 4th down for the offense, 'fg' when lateKick()); flip:
  // run it mirrored (FLIP on the play call; kicks never flip).
  submitCall(side, id, flip = false) {
    if (this.phase !== "PLAY_CALL") return false;
    if (this.tryMode && side === "off" && (id === "punt" || id === "fg")) id = "dive";
    if (side === "off") this.pending.off = id;
    else this.pending.def = id;
    this.pending[side + "Flip"] = !!flip;
    return true;
  }

  fieldPlayers(O, D) {
    this.offPlayers = O.slice();
    this.defPlayers = D.slice();
    this.players = [...this.offPlayers, ...this.defPlayers];
    for (const t of ["home", "away"]) for (const p of this.teams[t].all) p.onField = false;
    for (const p of this.players) p.onField = true;
  }

  toPreSnap() {
    const offId = this.pending.off, defId = this.pending.def;
    const oTeam = this.teams[this.offense], dTeam = this.teams[this.defense];
    let off = offPlay(offId);
    let def = off.type === "kick" && off.kick === "punt" ? RETURN_PLAY : defPlay(defId);
    // FLIPped calls run mirrored (playbook.js mirrorPlay). The defense sets to the formation's strength: it mirrors with a
    // flipped offense, and its own FLIP mirrors it against the formation. (Against a kick nothing flips.)
    const flips = { off: false, def: false };
    if (off.type !== "kick") {
      flips.off = !!this.pending.offFlip;
      flips.def = !!this.pending.defFlip;
      if (flips.off) off = mirrorPlay(off);
      if (flips.off !== flips.def) def = mirrorPlay(def);
    }
    // kick formations bring the kicker on (punts: a special-teams unit from the whole roster)
    let O = oTeam.O.slice();
    let unit = null;
    if (off.type === "kick") {
      if (off.kick === "punt") {
        unit = ST.puntUnit(oTeam);
        O = unit.players;
      } else {
        const i = O.findIndex((p) => p.slot === "FB");
        O[i] = oTeam.K;
      }
    }
    // remember where everyone is so they can hustle to their spots (no teleporting)
    const prev = new Map();
    if (!this.headless) for (const p of this.players) prev.set(p, [p.x, p.y]);
    this.fieldPlayers(O, dTeam.D);
    for (const p of this.players) p.resetForDown();
    if (unit) for (const [p, spot] of unit.spots) p.ai.stSlot = spot;
    this.play = this.newPlay(off, def, { kick: off.type === "kick" ? off.kick : null, flips });
    if (off.kick === "punt") this.play.returner = ST.puntReturner(this);
    this.ball.state = "held";
    this.ball.carrier = null;
    AI.alignFormation(this);
    for (const p of this.players) {
      let fx = p.homeX, fy = p.homeY;
      const pr = prev.get(p);
      if (pr && Number.isFinite(pr[0]) && Math.hypot(pr[0] - p.homeX, pr[1] - p.homeY) < 30) {
        fx = pr[0];
        fy = pr[1];
      }
      p.fromX = p.x = fx;
      p.fromY = p.y = fy;
    }
    const c = this.offPlayers.find((p) => p.slot === "C");
    this.ball.x = this.los;
    this.ball.y = this.ballY;
    this.ball.z = 0.3;
    this.ball.carrier = null;
    this.ball.state = "dead";
    if (c) c.hasBall = false;
    this.snapRequested = false;
    this.userActive = false;
    this.pickUserPresnap();
    this.setPhase("PRE_SNAP");
    this.emit("presnap", { off: off.id, def: def.id });
  }

  // Players hustle to their alignment on a time-based ease (set in SET_SEC); an early SNAP press is
  // queued and fires as soon as PRESNAP_MIN_SEC has passed.
  preSnapStep(dt) {
    this.applyUserPresnap();
    const humanOff = this.isHuman(this.offense) && this.play.off.type !== "kick";
    const setSec = this.headless ? 0.05 : humanOff ? CFG.SET_SEC : CFG.SET_SEC_CPU;
    const k = Math.min(1, this.phaseT / setSec), e = ease(k);
    for (const p of this.players) {
      const nx = p.fromX + (p.homeX - p.fromX) * e, ny = p.fromY + (p.homeY - p.fromY) * e;
      if (k < 1) {
        p.vx = (nx - p.x) / dt;
        p.vy = (ny - p.y) / dt;
        if (Math.abs(p.vx) > 0.6) p.facing = p.vx > 0 ? 1 : -1;
      } else {
        p.vx = p.vy = 0;
        p.facing = p.side === "D" || (p.team !== this.offense) ? -1 : 1;
      }
      p.tvx = p.tvy = 0;
      p.x = nx;
      p.y = ny;
    }
    this.emit("formationStep", NO_PAYLOAD);
    const set = k >= 1;
    if (humanOff) {
      if ((this.snapRequested && this.phaseT >= CFG.PRESNAP_MIN_SEC && set) || this.phaseT > CFG.PRESNAP_HUMAN_AUTO) this.snap();
    } else if (this.headless ? this.waited(CFG.PRESNAP_AUTO) : set && this.phaseT > Math.max(CFG.PRESNAP_AUTO, setSec + 0.35)) this.snap();
  }

  pickUserPresnap() {
    for (const t of ["home", "away"]) for (const p of this.teams[t].all) p.isUser = false;
    this.userPlayer = null;
    if (!this.human || this.autoplay) return;
    if (this.offense === this.human) {
      if (this.play.kick) return;
      this.setUser(this.offPlayers.find((p) => p.slot === "QB"));
    } else {
      if (this.play.kick === "punt" && this.play.returner) return this.setUser(this.play.returner);
      const pref = this.prevDefUserSlot || "ILB1";
      this.setUser(this.defPlayers.find((p) => p.slot === pref) || this.defPlayers[4]);
    }
  }

  setUser(p) {
    if (this.userPlayer) this.userPlayer.isUser = false;
    this.userPlayer = p || null;
    if (p) p.isUser = true;
    this.userActive = false;
  }

  requestSnap() {
    if (this.phase === "PRE_SNAP") this.snapRequested = true;
  }

  snap() {
    for (const p of this.players) {
      p.x = p.homeX;
      p.y = p.homeY;
      p.vx = p.vy = 0;
      p.facing = p.side === "D" || p.team !== this.offense ? -1 : 1;
    }
    this.snapRequested = false;
    this.setPhase("LIVE");
    const qb = this.offPlayers.find((p) => p.slot === "QB");
    const b = this.ball;
    AI.setupPlay(this);
    for (const p of this.players) p.state = "live";
    if (this.play.kick) {
      const k = this.offPlayers.find((p) => p.slot === "K");
      const holder = this.play.kick === "fg" ? this.offPlayers.find((p) => p.slot === "QB") : k;
      this.kick = { kind: this.play.kick, k, holder, stage: "snap" };
      b.state = "air";
      b.kind = "snapback";
      b.x = this.los;
      b.y = this.ballY;
      b.z = 0.4;
      b.tSpawn = this.time;
      const T = 0.45;
      b.tArrive = this.time + T;
      b.aimX = holder.x + 0.3;
      b.aimY = holder.y;
      b.vx = (b.aimX - b.x) / T;
      b.vy = (b.aimY - b.y) / T;
      b.vz = (1.0 - 0.4 + 0.5 * CFG.GRAVITY * T * T) / T;
      if (this.play.kick === "fg") this.teamStats(this.offense).fgAtt++;
      this.emit("snap", { qb: holder });
      return;
    }
    b.holdBy(qb);
    this.play.carrier = qb;
    const mo = this.play.off.motion;
    if (mo) {
      // jet motion: he's already at speed when the ball is snapped
      const m = this.offPlayers.find((p) => p.slot === mo.slot);
      if (m) m.vy = mo.vy * m.r.speed * 0.85;
    }
    if (this.play.off.carrier === "QB") {
      // QB sneak: he's the ball carrier from the snap
      this.play.qbRunner = true;
      this.play.rushPlay = true;
      this.play.handed = true;
    }
    this.downs++;
    if (!this.tryMode) {
      this.teamStats(this.offense).plays++;
      if (this.play.startDown === 3) this.teamStats(this.offense).thirdAtt++;
      this.drive.plays++;
    }
    this.emit("snap", { qb });
  }

  handoff(qb, rb) {
    const b = this.ball;
    qb.hasBall = false;
    b.holdBy(rb);
    this.play.handed = true;
    this.play.handT = this.time;
    this.emit("handoff", { from: qb, to: rb });
    this.setCarrier(rb, "handoff");
  }

  setCarrier(p, how) {
    const play = this.play;
    play.carrier = p;
    if (how === "handoff" || how === "pitch") {
      play.handed = true;
      play.rushPlay = true;
      play.carrierStartX = this.los;
      if (!play.handT) play.handT = this.time;
    }
    if (how === "int" || how === "scoop" || how === "return") {
      const dir = this.dirOf(p);
      play.gain = { player: p, x: p.x, inEZ: dir > 0 ? p.x <= 0 : p.x >= 100, left: false };
    }
    if (how === "int") {
      play.turnover = true;
      play.turnoverKind = "int";
      play.intBy = p;
    }
    if (how === "scoop") {
      play.turnover = true;
      play.turnoverKind = "fumble";
      play.scoopBy = p;
      play.scoopX = p.x;
    }
    if (how === "catch" && play.off.screen === p.slot) {
      // screen: follow the convoy upfield
      const dir = this.dirOf(p);
      p.ai.job = "carry";
      p.ai.pts = [[this.los + dir * 2.5, p.y + (this.ballY - p.y) * 0.12], [this.los + dir * 9, p.y + (this.ballY - p.y) * 0.2]];
      p.ai.pi = 0;
    }
    if (how === "return") {
      play.clockOn = true;
      if (!play.ret) play.ret = { kind: play.kick === "punt" ? "punt" : "kickoff", player: p, catchX: p.x, inEZ: play.gain.inEZ };
      play.ret.left = false;
      ST.startReturn(this, p);
      this.emit("return", { player: p, kind: play.ret.kind, x: p.x, y: p.y });
    }
    p.ai.think = 0;
    // human control follows the ball on the human's team
    if (this.human && !this.autoplay) {
      if (p.team === this.human) {
        if (this.userPlayer !== p) {
          const keep = this.userActive && this.input && (Math.abs(this.input.mx) + Math.abs(this.input.my) > 0.2);
          this.setUser(p);
          this.userActive = !!keep;
        }
      } else if ((how === "int" || how === "scoop") && this.userPlayer && this.userPlayer.team === this.human) {
        // our ball got taken away: switch to whoever is closest to the returner
        let best = null, bd = 1e9;
        for (const q of this.players) {
          if (q.team !== this.human || q.state === "tackled") continue;
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bd) { bd = d; best = q; }
        }
        this.setUser(best);
      } else if (how !== "int" && how !== "scoop" && this.userPlayer && this.userPlayer.team === this.human) {
        // the other team has a new ball carrier (handoff, pitch, catch, return): when the human isn't
        // steering, or his man is out of the play, hand him the defender with the best shot at the
        // carrier (time to reach where the carrier will be in 0.5 s) — never a spectator on defense
        const u = this.userPlayer;
        const inp = this.input;
        const idle = !inp || Math.abs(inp.mx) + Math.abs(inp.my) <= 0.2;
        const ax = p.x + p.vx * 0.5, ay = p.y + p.vy * 0.5;
        if (idle || u.state === "tackled" || Math.hypot(u.x - p.x, u.y - p.y) > 8) {
          let best = null, be = 1e9;
          for (const q of this.players) {
            if (q.team !== this.human || q.state === "tackled" || q.slot === "K") continue;
            const e = Math.hypot(q.x - ax, q.y - ay) / Math.max(1, PH.maxSpeed(this, q));
            if (e < be) { be = e; best = q; }
          }
          // only for a clear gain: at least 3 yd closer to that spot than the current man
          if (best && best !== u && (u.state === "tackled" || Math.hypot(best.x - ax, best.y - ay) <= Math.hypot(u.x - ax, u.y - ay) - 3)) {
            this.setUser(best);
            this.emit("switch", { player: best, auto: true });
          }
        }
      }
    }
  }

  // ---------- live play ----------
  liveStep(dt) {
    const play = this.play;
    play.t += dt;
    if (!this.overtime && this.quarter <= 4 && play.clockOn && !play.tryMode && this.clock > 0) {
      const c0 = this.clock;
      this.clock = Math.max(0, this.clock - dt);
      this.stats[this.offense].top += c0 - this.clock;
    }
    this.applyUser(dt);
    if (this.phase !== "LIVE") return;
    if (play.kick && play.kickAway && play.kick !== "fg") ST.think(this, dt);
    else AI.think(this, dt);
    for (const p of this.players) {
      if (p.throwAt > 0 && this.time >= p.throwAt) PH.releaseThrow(this, p);
    }
    if (play.kick) this.kickLive(dt);
    if (this.phase !== "LIVE") return;
    PH.updateEngagements(this, dt);
    for (const p of this.players) {
      if (p.engaged || p.blockers.length) continue;
      PH.integrate(this, p, dt);
    }
    PH.separate(this);
    for (const p of this.players) {
      if (p.hasBall) continue;
      if (p.x < -11.5) p.x = -11.5;
      else if (p.x > 111.5) p.x = 111.5;
      if (p.y < -3) p.y = -3;
      else if (p.y > FW + 3) p.y = FW + 3;
    }
    PH.updateBall(this, dt);
    if (this.phase !== "LIVE") return;
    // a carrier (or a receiver who just caught it) in the end zone has scored before any tackle
    this.checkGoalLine();
    if (this.phase !== "LIVE") return;
    if (PH.forwardProgress(this)) return;
    PH.tryTackles(this);
    if (this.phase !== "LIVE") return;
    this.checkBoundaries();
    if (this.phase !== "LIVE") return;
    // QB past the line becomes a runner
    const c = this.ball.state === "held" ? this.ball.carrier : null;
    if (c && !play.kick && c.pos === "QB" && !play.qbRunner && !play.thrown && c.x > this.los + 0.4) {
      play.qbRunner = true;
      play.rushPlay = true;
      this.emit("scramble", { qb: c });
    }
    if (c) {
      play.maxX = Math.max(play.maxX, c.x);
      const g = play.gain;
      if (g && g.player === c && !g.left) {
        const dir = this.dirOf(c);
        if (dir > 0 ? c.x > 0.5 : c.x < 99.5) {
          g.left = true;
          if (play.ret) play.ret.left = true;
        }
      }
      // the momentum exception (endPlay): possession gained outside the end zone carried straight into it; lost
      // if he turns upfield before he gets there, or comes back out of it
      if (g && g.player === c && !g.inEZ && !g.moLost) {
        const dir = this.dirOf(c);
        if (dir > 0 ? c.x <= 0 : c.x >= 100) g.moIn = true;
        else if (g.moIn || c.vx * dir >= 0) g.moLost = true;
      }
    }
    // dive recovery
    for (const p of this.players) {
      if (p.diveUntil && this.time > p.diveUntil) {
        p.diveUntil = 0;
        this.emit("diveEnd", { player: p });
      }
    }
    this.emit("liveStep", NO_PAYLOAD);
    // slow-mo on a clear run to the end zone
    if (c && !this.headless) {
      const dir = this.dirOf(c);
      const toGoal = dir > 0 ? 100 - c.x : c.x;
      let threat = false;
      if (toGoal < CFG.SLOWMO_DIST) {
        for (const d of this.players) {
          if (d.team === c.team || d.downUntil > this.time) continue;
          if (Math.hypot(d.x - c.x, d.y - c.y) < 2.2) threat = true;
        }
      }
      const on = toGoal < CFG.SLOWMO_DIST && toGoal > 0 && !threat;
      if (on !== this.slowmo) {
        this.slowmo = on;
        this.emit("slowmo", { on });
      }
    }
    if (play.t > CFG.MAX_DOWN_TIME) {
      this.stuck++;
      this.errors.push(`stuck down at t=${play.t.toFixed(1)} (${play.off.id})`);
      const cc = this.ball.state === "held" ? this.ball.carrier : null;
      if (play.kick && !cc) this.endPlay({ type: "downed", spot: clamp(this.ball.x, 1, 99), timeout: true });
      else this.endPlay({ type: cc ? "tackle" : "incomplete", spot: cc ? cc.x : this.los, timeout: true });
    }
  }

  kickLive(dt) {
    const k = this.kick;
    const b = this.ball;
    if (!k) return;
    if (k.kind === "kickoff" || (k.kind === "punt" && k.stage === "flight")) {
      if (b.state === "air" && (b.kind === "kickoff" || b.kind === "punt")) ST.kickFlightStep(this, dt);
      else if (b.state === "loose" && b.kind === "kick") ST.looseKickStep(this, dt);
      return;
    }
    if (k.stage === "snap") {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.vz -= CFG.GRAVITY * dt;
      if (this.time >= b.tArrive) {
        b.state = "held";
        b.carrier = k.holder;
        b.kind = "dead";
        k.stage = "set";
        k.kickAt = this.time + (k.kind === "fg" ? 0.55 : 1.15);
        this.emit("kickSet", { kind: k.kind, holder: k.holder, kicker: k.k });
      }
      return;
    }
    if (k.stage === "set") {
      b.x = k.holder.x + 0.2;
      b.y = k.holder.y;
      b.z = k.kind === "fg" ? 0.2 : 1.0;
      // kicker approaches the ball on FGs
      if (k.kind === "fg") PH.steer(this, k.k, k.holder.x - 0.6, k.holder.y - 0.3, 0.55, 0.2);
      if (this.time >= k.kickAt) this.launchKick();
      return;
    }
    if (k.stage === "flight") this.kickFlight(dt);
  }

  launchKick() {
    const k = this.kick;
    const b = this.ball;
    const kr = k.k.r.kick;
    b.state = "air";
    b.carrier = null;
    if (k.holder) k.holder.hasBall = false;
    k.stage = "flight";
    b.tSpawn = this.time;
    b.x = k.holder.x + 0.3;
    b.z = k.kind === "fg" ? 0.2 : 1.1;
    if (k.kind === "punt") {
      const kn = clamp((kr - 45) / 70, 0, 1);
      let dist = CFG.PUNT_NET_MIN + (CFG.PUNT_NET_MAX - CFG.PUNT_NET_MIN) * kn + this.rng.range(-5, 5);
      // near midfield: pooch it to pin them deep instead of booting it into the end zone
      if (this.los > 50 && this.los + dist > 96 && this.rng.chance(0.75)) dist = Math.max(22, 92 - this.los + this.rng.range(-3, 5));
      const T = CFG.PUNT_HANG + 0.4 * kn + this.rng.range(-0.3, 0.3);
      b.kind = "punt";
      b.aimX = Math.min(this.los + dist, 112);
      b.aimY = clamp(this.ballY + this.rng.range(-10, 10), 6, FW - 6);
      b.landX = b.aimX;
      b.tArrive = this.time + T;
      b.vx = (b.aimX - b.x) / T;
      b.vy = (b.aimY - b.y) / T;
      b.vz = (CFG.CATCH_Z - b.z + 0.5 * CFG.KICK_GRAVITY * T * T) / T;
      this.teamStats(this.offense).punts++;
      ST.puntAway(this);
      this.play.clockOn = false; // the clock waits for the return (or the ball to be downed)
      // the human punting team covers it with a gunner
      if (this.isHuman(this.offense)) {
        let best = null, bd = 1e9;
        for (const p of this.offPlayers) {
          if (p.slot === "K") continue;
          const d = Math.hypot(p.x - b.aimX, p.y - b.aimY);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) this.setUser(best);
      }
      this.emit("punt", { distance: dist, kicker: k.k });
    } else {
      const dist = 100 - this.los + 17;
      const kn = clamp((kr - 50) / 60, 0, 1);
      const p = clamp(0.99 - Math.pow(Math.max(0, dist - 18) / (44 + 10 * kn), 2) * 0.75, 0.04, 0.99);
      const good = this.rng.next() < p;
      const T = 1.25 + dist / 45;
      b.kind = "fg";
      b.good = good;
      b.aimX = 110.5;
      const miss = good ? 0 : (this.rng.chance(0.5) ? -1 : 1) * this.rng.range(4.2, 7.5);
      b.aimY = MID + (good ? this.rng.range(-2, 2) : miss);
      b.landX = 110.5;
      b.tArrive = this.time + T;
      b.vx = (b.aimX - b.x) / T;
      b.vy = (b.aimY - b.y) / T;
      const endZ = good ? 4.5 : this.rng.range(1.5, 5);
      b.vz = (endZ - b.z + 0.5 * CFG.GRAVITY * T * T) / T;
      k.fgDist = Math.round(dist);
      this.play.kickAway = true;
      this.emit("kick", { kind: "fg", distance: dist, kicker: k.k });
    }
  }

  // Field goals / PATs in the air.
  kickFlight(dt) {
    const b = this.ball;
    if (b.state !== "air") return;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    b.vz -= CFG.GRAVITY * dt;
    b.spin += dt * 9;
    if (this.phase === "LIVE" && this.time >= b.tArrive && b.kind === "fg") {
      this.endPlay({ type: "fg", good: b.good, distance: this.kick.fgDist });
    }
    if (this.phase === "PAT" && b.z < 0) b.z = 0;
  }

  // ---------- human control ----------
  applyUserPresnap() {
    const inp = this.input;
    if (!inp || !this.human || this.autoplay) return;
    this.consumedInput = true;
    if (inp.aPressed && this.offense === this.human) this.requestSnap();
    if (inp.bPressed && this.defense === this.human) this.switchDefender(true);
  }

  switchDefender(presnap) {
    const b = this.ball;
    const ref = b.state === "held" && b.carrier ? b.carrier : b;
    let best = null, bd = 1e9;
    for (const p of this.players) {
      if (p.team !== this.human || p === this.userPlayer || p.state === "tackled") continue;
      let d = Math.hypot(p.x - ref.x, p.y - ref.y);
      if (presnap) d = Math.hypot(p.x - (this.userPlayer ? this.userPlayer.x : ref.x), p.y - ref.y) + (p.x < this.los + 2 ? 4 : 0);
      if (d < bd) { bd = d; best = p; }
    }
    if (presnap) {
      // cycle through defenders by distance from the ball
      const list = this.defPlayers.filter((p) => p.team === this.human).sort((a, b2) => Math.hypot(a.x - this.los, a.y - this.ballY) - Math.hypot(b2.x - this.los, b2.y - this.ballY));
      const i = list.indexOf(this.userPlayer);
      best = list[(i + 1) % list.length];
      if (best && best.slot !== "K") this.prevDefUserSlot = best.slot;
    }
    if (best) {
      this.setUser(best);
      this.emit("switch", { player: best });
    }
  }

  applyUser(dt) {
    const inp = this.input;
    const u = this.userPlayer;
    if (!inp || !u || !this.human || this.autoplay) return;
    this.consumedInput = true;
    const mag = Math.hypot(inp.mx, inp.my);
    this.stickIdle = mag < 0.2;
    const b = this.ball;
    const play = this.play;
    // run plays: the exchange is automatic; you take over the back after the handoff
    const meshing = play.off.type === "run" && !play.handed && u.pos === "QB";
    // fielding a kick: the returner drifts under the ball on his own unless the stick says otherwise
    const fielding = play.kick && play.kickAway && play.returner === u && b.state !== "held";
    if (mag > 0.2 && !meshing) this.userActive = true;
    if (this.userActive && !(fielding && this.stickIdle) && u.state !== "tackled" && u.downUntil <= this.time && !u.engaged) {
      const sp = PH.maxSpeed(this, u) * Math.min(1, mag);
      if (mag > 0.05) {
        u.tvx = (inp.mx / mag) * sp;
        u.tvy = (inp.my / mag) * sp;
      } else {
        u.tvx = 0;
        u.tvy = 0;
      }
      if (u.blockers.length) {
        u.tvx = (inp.mx / Math.max(mag, 0.05)) * 2;
        u.tvy = (inp.my / Math.max(mag, 0.05)) * 2;
      }
    }
    // special teams buttons for the returner
    if (play.kick && play.returner === u) {
      if (fielding) {
        if (inp.bPressed && play.kick === "punt") ST.signalFairCatch(this, u);
        return;
      }
      const g = play.ret;
      if (inp.bPressed && b.carrier === u && g && g.inEZ && !g.left) {
        // take a knee in the end zone: touchback
        this.emit("touchback", { team: u.team, kind: g.kind, player: u, kneel: true });
        this.endPlay({ type: "touchback", spot: g.kind === "punt" ? 100 : 0, team: u.team, kind: g.kind, carrier: u });
        return;
      }
    }
    const isCarrier = b.state === "held" && b.carrier === u;
    const canThrow = isCarrier && u.pos === "QB" && !play.thrown && !play.qbRunner && play.off.type === "pass" && u.throwAt === 0;
    if (canThrow) {
      const tg = play.progression;
      if (inp.num >= 1 && inp.num <= tg.length) PH.startThrow(this, u, tg[inp.num - 1]);
      else if (inp.aPressed && tg.length) PH.startThrow(this, u, tg[play.targetIdx % tg.length]);
      if (inp.bPressed && tg.length) {
        play.targetIdx = (play.targetIdx + 1) % tg.length;
        this.emit("target", { idx: play.targetIdx });
      }
      if (inp.tapX != null) {
        let best = null, bd = 4;
        for (const r of tg) {
          const d = Math.hypot(r.x - inp.tapX, r.y - inp.tapY);
          if (d < bd) { bd = d; best = r; }
        }
        if (best) PH.startThrow(this, u, best);
      }
    } else if (isCarrier) {
      if (inp.aPressed) PH.juke(this, u);
      if (inp.bPressed) PH.stiffArm(this, u);
    } else if (u.team !== (b.carrier ? b.carrier.team : this.offense) || (b.state === "air" && u.team !== this.offense)) {
      // defending
      const c = b.state === "held" ? b.carrier : null;
      if (inp.aPressed) {
        if (c && Math.hypot(c.x - u.x, c.y - u.y) < CFG.DIVE_RANGE) PH.dive(this, u, c.x + c.vx * 0.15, c.y + c.vy * 0.15);
        else if (b.state === "air") {
          // jump the route: sprint to the ball
          this.userActive = false;
        } else if (c) PH.dive(this, u, u.x + (c.x - u.x) * 0.5, u.y + (c.y - u.y) * 0.5);
      }
      if (inp.bPressed) this.switchDefender(false);
    }
  }

  // Button labels for the current special-teams context (touch buttons / hints), or null.
  actionLabels() {
    if (!this.human || this.autoplay) return null;
    const u = this.userPlayer, b = this.ball, play = this.play;
    if (this.phase === "KICKOFF" && this.defense === this.human && !this.kickChoice) return { a: "KICK", b: "ONSIDE" };
    if (this.phase === "PAT_CHOICE" && this.patTeam === this.human && !this.patChoice) return { a: "KICK", b: "GO FOR 2" };
    if (this.phase === "LIVE" && play && play.kick && u && play.returner === u) {
      if (b.state === "air" && play.kick === "punt") return { a: "A", b: play.fairCatch ? "FAIR" : "FAIR CATCH" };
      if (b.carrier === u && play.ret && play.ret.inEZ && !play.ret.left) return { a: "SPIN", b: "KNEEL" };
    }
    return null;
  }

  // ---------- end of a play ----------
  checkGoalLine() {
    const b = this.ball;
    const c = b.state === "held" ? b.carrier : null;
    if (!c || c.state === "tackled") return;
    const dir = this.dirOf(c);
    if (dir > 0 && c.x >= 100) return this.endPlay({ type: "td", team: c.team, scorer: c, spot: 100 });
    if (dir < 0 && c.x <= 0) return this.endPlay({ type: "td", team: c.team, scorer: c, spot: 0, defensive: true });
  }

  checkBoundaries() {
    this.checkGoalLine();
    if (this.phase !== "LIVE") return;
    const b = this.ball;
    const c = b.state === "held" ? b.carrier : null;
    if (!c || c.state === "tackled") return;
    if (c.y < 0 || c.y > FW || c.x < -10 || c.x > 110) {
      c.state = "tackled";
      this.emit("outOfBounds", { player: c });
      return this.endPlay({ type: "oob", spot: c.x, carrier: c, y: c.y });
    }
  }

  endPlay(result) {
    if (this.phase !== "LIVE") return;
    const play = this.play;
    play.result = result;
    if (play.kick !== "kickoff") this.playDurations += play.t;
    if (this.slowmo) {
      // the presentation's slow motion ends with the play
      this.slowmo = false;
      this.emit("slowmo", { on: false });
    }
    // a loose ball dead in an end zone (scrimmage plays, tries, kick returns and muffs): TD / safety / touchback
    if (result.type === "recovery") this.endZoneRecovery(result);
    // scoring is decided now (banner timing); rules finish after the dead-ball pause
    const b = this.ball;
    const c = b.state === "held" ? b.carrier : null;
    // tackled, but the ball broke the plane going down: touchdown
    if (result.type === "tackle" && c && !result.timeout) {
      const dir = this.dirOf(c);
      if ((dir > 0 && result.spot >= 100) || (dir < 0 && result.spot <= 0)) {
        result.type = "td";
        result.team = c.team;
        result.scorer = c;
        result.spot = dir > 0 ? 100 : 0;
        if (dir < 0) result.defensive = true;
      }
    }
    if ((result.type === "tackle" || result.type === "oob") && c) {
      const dir = this.dirOf(c);
      const inOwnEZ = dir > 0 ? result.spot <= 0 : result.spot >= 100;
      if (inOwnEZ) {
        // possession that came by a kick or a turnover in the end zone: touchback; gained between his 5 and the
        // goal line with his momentum carrying him in (and never back out): the ball where he got it; otherwise safety
        const g = play.gain;
        if (g && g.player === c && g.inEZ && !g.left) result.touchback = true;
        else if (g && g.player === c && !g.inEZ && !g.moLost && (dir > 0 ? g.x : 100 - g.x) < 5) result.spot = g.x;
        else {
          result.type = "safety";
          result.team = this.other(c.team);
        }
      }
      if (!play.kick && c.pos === "QB" && !play.thrown && !play.handed && !play.turnover && result.spot < this.los && result.type === "tackle") {
        result.sack = true;
        if (!play.tryMode) {
          if (result.tackler) result.tackler.stats.sacks++;
          this.teamStats(this.defense).sacks++;
        }
        this.emit("sack", { qb: c, tackler: result.tackler });
      }
    }
    // return yardage (kick returns, INT and fumble returns)
    const g = play.gain;
    if (g && c && g.player === c && (result.type === "tackle" || result.type === "oob" || result.type === "td")) {
      const dir = this.dirOf(c);
      const end = result.type === "td" ? (dir > 0 ? 100 : 0) : result.spot;
      play.returnYds = result.touchback ? 0 : (end - g.x) * dir;
      result.returnYds = Math.round(play.returnYds);
    }
    if (play.tryMode) this.scoreTry(result);
    else {
      if (result.type === "td") {
        const team = result.team;
        this.addScore(team, 6, "TD");
        result.scorer.stats.td++;
        this.teamStats(team).tds++;
        if (play.ret && play.ret.player === result.scorer) this.teamStats(team).retTds++;
        if (play.turnover) this.teamStats(team).defTds++;
        result.scorer.state = "celebrate";
        result.returnKind = play.ret ? play.ret.kind : play.turnover ? play.turnoverKind : null;
        this.emit("touchdown", { team, scorer: result.scorer, defensive: !!result.defensive, returnKind: result.returnKind });
      }
      if (result.type === "safety") {
        const team = result.team || this.defense;
        result.team = team;
        this.addScore(team, 2, "SAFETY");
        this.emit("safety", { team });
      }
      if (result.type === "fg") {
        if (result.good) {
          this.addScore(this.offense, 3, "FG");
          this.teamStats(this.offense).fgMade++;
        }
        this.emit("fieldGoal", { good: result.good, distance: result.distance });
      }
    }
    if (play.kick === "kickoff" || play.kick === "punt") this.labelKick(result);
    const lost = result.type === "recovery" && result.recoveredBy && result.recoveredBy.team !== (play.ret ? play.ret.player.team : this.offense);
    const big = result.type === "td" || play.turnover || result.type === "safety" || lost || result.big || result.twoPoint;
    this.deadWait = big ? CFG.DEAD_TIME_BIG : result.type === "fg" ? 2.2 : CFG.DEAD_TIME;
    this.setPhase("DEAD");
    this.emit("whistle", { result });
  }

  // A fumble (scrimmage, or on an INT / fumble / kick return) or a muffed kick dead in an end zone, in
  // the frame of the team that fumbled it (P). Recovered in the end zone the recovering team attacks: TD
  // for it. In P's own end zone (recovered by P, or out of bounds there): safety — a touchback when that
  // possession began in this end zone and never left it, or when P muffed a kick (the kick put it there).
  // In the end zone P attacks (the other team recovers it there, or it goes out of bounds there):
  // touchback, the other team's ball at its 20. On a 2-point try P scores only if the fumbler recovers it.
  endZoneRecovery(result) {
    const x = result.rawX != null ? result.rawX : result.spot;
    if (!(x <= 0 || x >= 100)) return;
    const play = this.play;
    const off = this.offense;
    const fb = this.ball.fumbledBy;
    const P = fb ? fb.team : play.turnover ? this.defense : off;
    const rec = result.oob ? null : result.recoveredBy;
    const attacks = (T) => (T === off ? x >= 100 : x <= 0);
    // on a try only the player who fumbled may recover it for a score: a teammate's recovery ends the try
    if (rec && attacks(rec.team) && play.tryMode && fb && rec.team === P && rec !== fb) return;
    if (rec && attacks(rec.team)) {
      const R = rec.team;
      if (R !== P && !play.turnover) {
        // taken away in the end zone: a fumble-return TD for the stats
        play.turnover = true;
        play.turnoverKind = "fumble";
      }
      result.type = "td";
      result.team = R;
      result.scorer = rec;
      result.spot = R === off ? 100 : 0;
      if (R !== off) result.defensive = true;
      return;
    }
    if (attacks(P)) {
      result.touchback = true;
      result.tbTeam = this.other(P);
      return;
    }
    const g = play.gain;
    if (play.muffed || (g && g.player && g.player.team === P && g.inEZ && !g.left)) {
      result.touchback = true;
      result.tbTeam = P;
      return;
    }
    result.type = "safety";
    result.team = this.other(P);
    result.spot = P === off ? 0 : 100;
  }

  // Broadcast text for kick plays (the UI's lower third may use result.label).
  labelKick(r) {
    const play = this.play;
    const ry = r.returnYds != null ? r.returnYds : null;
    switch (r.type) {
      case "touchback": r.label = "TOUCHBACK"; break;
      case "fairCatch": r.label = "FAIR CATCH"; break;
      case "downed": r.label = r.oob ? "PUNT OUT OF BOUNDS" : `PUNT DOWNED AT THE ${yardText(100 - r.spot)}`; break;
      case "kickOob": r.label = "KICKOFF OUT OF BOUNDS"; break;
      case "kickRecovery": r.label = play.onside ? (r.recoveredBy && r.recoveredBy.team === this.defense ? "ONSIDE KICK RECOVERED!" : "ONSIDE KICK FAILS") : "LOOSE BALL RECOVERED"; break;
      case "td": r.label = play.ret && r.scorer === play.ret.player ? `${play.ret.kind === "punt" ? "PUNT" : "KICKOFF"} RETURN TOUCHDOWN` : play.turnover ? "FUMBLE RETURN TOUCHDOWN" : "TOUCHDOWN"; break;
      case "recovery": r.label = play.muffed ? "MUFFED KICK!" : "FUMBLE ON THE RETURN"; break;
      default:
        if (r.touchback) r.label = "TOUCHBACK";
        else if (play.ret && ry != null) r.label = `${play.ret.kind === "punt" ? "PUNT" : "KICK"} RETURN · ${Math.max(0, ry)} YDS`;
    }
  }

  addScore(team, pts, why) {
    this.score[team] += pts;
    this.scoreEvents++;
    this.log.push({ q: this.quarter, clock: this.clock, team, pts, why });
    this.emit("scoreChange", { score: { ...this.score }, team, pts, why });
  }

  deadStep(dt) {
    PH.updateBall(this, dt);
    const b = this.ball;
    if (b.state === "air" && b.kind !== "pass" && b.kind !== "pitch") {
      // a kick still in the air after the whistle (field goals sail on through the uprights)
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.vz -= CFG.GRAVITY * dt;
      b.spin += dt * 9;
      if (b.z <= 0) {
        b.z = 0;
        b.state = "loose";
        b.kind = "kick";
        b.vz = 0;
        b.vx *= 0.4;
        b.vy *= 0.4;
      }
    } else if (b.state === "loose" && b.kind === "kick") {
      // a dead kick still rolls to a stop
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= 0.94;
      b.vy *= 0.94;
      b.z = Math.max(0, b.z + b.vz * dt);
      b.vz = b.z > 0 ? b.vz - CFG.GRAVITY * dt : 0;
    }
    for (const p of this.players) {
      if (p.state === "celebrate") {
        p.tvx = p.tvy = 0;
      } else if (p.state !== "tackled") {
        // jog to the pile / celebrate with the scorer
        const r = this.play && this.play.result;
        if (r && r.type === "td" && p.team === r.team && r.scorer && p !== r.scorer && Math.hypot(p.x - r.scorer.x, p.y - r.scorer.y) < 22) {
          PH.steer(this, p, r.scorer.x - this.dirOf(r.scorer) * 1.2, r.scorer.y + (p.y > r.scorer.y ? 1.4 : -1.4), 0.7, 1);
        } else {
          p.tvx *= 0.9;
          p.tvy *= 0.9;
        }
      }
      if (p.engaged || p.blockers.length) PH.disengage(this, p.engaged || p);
      PH.integrate(this, p, dt);
    }
    PH.separate(this);
  }

  easePlayers(dt) {
    for (const p of this.players) {
      p.tvx = p.tvy = 0;
      PH.integrate(this, p, dt);
    }
  }

  applyResult() {
    const play = this.play;
    const r = play.result;
    if (play.tryMode) return this.finishTry();
    const off = this.offense, def = this.defense;
    const st = this.teamStats(off);
    let runoff = false;
    let next = "call";
    const spot = clamp(r.spot != null ? r.spot : this.los, -10, 110);
    const gained = spot - this.los;
    const carrier = play.carrier;
    const recordYards = (yds) => {
      if (play.rushPlay && !play.turnover) {
        st.rushes++;
        st.rushYds += yds;
        if (carrier) {
          carrier.stats.rushYds += yds;
          carrier.stats.carries++;
        }
      } else if (play.completed && !play.turnover) {
        st.passYds += yds;
        if (carrier) carrier.stats.recYds += yds;
        const qb = this.teams[off].O.find((p) => p.slot === "QB");
        if (qb) qb.stats.passYds += yds;
      } else if (r.sack) {
        st.sackYds += -yds;
      }
      st.totalYds += yds;
      if (yds > st.longPlay) st.longPlay = Math.round(yds);
      this.drive.yards += yds;
      if (yds >= 20) {
        st.bigPlays++;
        this.emit("bigPlay", { player: carrier, yards: yds });
      }
    };
    this.recordReturn();
    // kick plays (other than scores) hand the ball to whoever has it at the whistle
    if ((play.kick === "kickoff" || (play.kick === "punt" && play.kickAway)) && r.type !== "td" && r.type !== "safety") {
      this.applyKickResult(r, spot);
      if (this.phase === "GAME_OVER") return;
      return this.dispatch("call");
    }
    switch (r.type) {
      case "td": {
        if (play.turnover) {
          // pick-six / fumble return TD: charge the team that gave it up
          const loser = this.teamStats(this.other(r.team));
          if (play.turnoverKind === "fumble") loser.fumblesLost++;
          else loser.ints++;
          if (play.turnoverKind === "fumble") this.emit("turnover", { kind: "fumble" });
        } else if (!play.ret) {
          recordYards(100 - this.los);
          // a touchdown on 3rd down converts it (box score: 3RD DOWNS)
          if (play.startDown === 3) st.thirdConv++;
        }
        if (this.overtime) return this.endGame();
        this.patTeam = r.team;
        next = "pat";
        break;
      }
      case "safety": {
        if (!play.kick && !play.turnover && !play.ret) recordYards(gained);
        if (this.overtime) return this.endGame();
        // the safetied team free-kicks from its own 20
        this.kickTeam = this.other(r.team || def);
        next = "freekick";
        break;
      }
      case "fg": {
        if (r.good) {
          if (this.overtime && this.otOver(this.otPoss[off], this.otPoss[def])) return this.endGame();
          this.kickTeam = off;
          next = "kickoff";
        } else {
          this.turnover(Math.max(20, 100 - (this.los - 7)), "missedFG");
        }
        break;
      }
      case "punt": {
        // legacy result (a punt that ended before the kick was away)
        const land = r.spot;
        this.turnover(land >= 100 ? CFG.PUNT_TB_SPOT : 100 - land, "punt");
        break;
      }
      case "incomplete": {
        this.advanceDown(this.los, false);
        break;
      }
      case "recovery": {
        // possession at the whistle goes to the team holding the ball (an end-zone touchback: r.tbTeam
        // at its own 20, see endZoneRecovery)
        const rec = r.recoveredBy;
        const holder = r.tbTeam || (rec ? rec.team : play.turnover ? def : off);
        const offAt = r.touchback ? 20 : clamp(spot, 1, 99);
        const defAt = r.touchback ? 20 : 100 - clamp(spot, 1, 99);
        if (play.turnover) {
          // intercepted (or scooped), then fumbled on the return
          if (play.turnoverKind === "fumble") st.fumblesLost++;
          else st.ints++;
          if (holder === off) {
            // the original offense got it back: a fresh series at the spot
            this.teamStats(def).fumblesLost++;
            this.emit("turnover", { kind: "fumble" });
            this.setPossession(off, offAt);
          } else this.turnover(defAt, play.turnoverKind === "fumble" ? "fumble" : "int");
        } else if (holder !== off) {
          st.fumblesLost++;
          this.turnover(defAt, "fumble");
        } else {
          recordYards(gained);
          this.advanceDown(clamp(spot, 1, 99), true);
          runoff = !r.oob;
        }
        break;
      }
      default: {
        // tackle / oob / timeout
        if (play.turnover) {
          // interception (or fumble) return ended
          if (play.turnoverKind === "fumble") st.fumblesLost++;
          else st.ints++;
          const kind = play.turnoverKind === "fumble" ? "fumble" : "int";
          if (r.touchback) this.turnover(20, kind);
          else this.turnover(100 - clamp(spot, 1, 99), kind);
          break;
        }
        recordYards(gained);
        this.advanceDown(clamp(spot, 0.5, 99.5), true);
        runoff = r.type === "tackle";
      }
    }
    if (runoff && !this.overtime && this.phase !== "GAME_OVER") {
      const late = (this.quarter === 2 || this.quarter === 4) && this.clock < 30;
      const c0 = this.clock;
      this.clock = Math.max(0, this.clock - (late ? 4 : CFG.RUNOFF));
      this.stats[this.offense].top += c0 - this.clock;
    }
    if (this.phase === "GAME_OVER") return;
    this.dispatch(next);
  }

  // Return yards into the stats (kick returns by kind; INT / fumble returns as intRetYds).
  recordReturn() {
    const play = this.play;
    const g = play.gain;
    if (!g || play.returnYds == null) return;
    const yds = Math.round(play.returnYds);
    const st = this.teamStats(g.player.team);
    if (play.ret && play.ret.player === g.player) {
      if (play.ret.kind === "punt") {
        st.pr++;
        st.prYds += yds;
      } else {
        st.kr++;
        st.krYds += yds;
      }
      g.player.stats.rets++;
      g.player.stats.retYds += yds;
      if (yds > st.longRet) st.longRet = yds;
    } else if (play.turnover) {
      st.intRetYds += yds;
      g.player.stats.retYds += yds;
      if (yds > st.longRet) st.longRet = yds;
    }
  }

  // Kickoffs and punts: whoever has the ball at the whistle gets it at the spot (in his own frame).
  applyKickResult(r, spot) {
    const play = this.play;
    const punt = play.kick === "punt";
    const recv = punt ? this.defense : this.offense;
    const kicking = this.other(recv);
    const giveOwn = (team, own) => {
      this.setPossession(team, clamp(own, 1, 99));
      if (this.overtime) this.otPoss[team]++;
    };
    const giveAt = (team, x) => {
      const own = team === this.offense ? x : 100 - x;
      if (team === recv && own <= 0) return giveOwn(team, punt ? CFG.PUNT_TB_SPOT : CFG.KICKOFF_TB_SPOT);
      giveOwn(team, own);
    };
    switch (r.type) {
      case "touchback":
        this.teamStats(recv).touchbacks++;
        return giveOwn(recv, punt ? CFG.PUNT_TB_SPOT : CFG.KICKOFF_TB_SPOT);
      case "fairCatch":
        this.teamStats(recv).fairCatches++;
        return giveAt(recv, spot);
      case "downed":
      case "kickOob":
      case "punt":
        return giveAt(recv, spot);
      case "kickRecovery":
      case "recovery": {
        // dead in the receiving team's end zone (a muffed kick, or a return that never left it): touchback
        if (r.touchback && (r.tbTeam || recv) === recv) {
          this.teamStats(recv).touchbacks++;
          return giveOwn(recv, punt ? CFG.PUNT_TB_SPOT : CFG.KICKOFF_TB_SPOT);
        }
        // a return fumbled into the kicking team's end zone (recovered there, or out of bounds there): the kicking
        // team's ball at its own 20, a fumble lost (as endZoneRecovery's touchback on a scrimmage play)
        if (r.touchback) {
          this.teamStats(recv).fumblesLost++;
          this.emit("turnover", { kind: "fumble" });
          return giveOwn(kicking, 20);
        }
        const team = r.recoveredBy ? r.recoveredBy.team : recv;
        if (team === kicking) {
          if (r.type === "kickRecovery" && play.onside) this.teamStats(kicking).onsideRec++;
          else {
            this.teamStats(recv).fumblesLost++;
            this.emit("turnover", { kind: "fumble" });
          }
        }
        return giveAt(team, spot);
      }
      default: {
        // a return ended (tackle / out of bounds / stuck)
        if (r.touchback) {
          this.teamStats(recv).touchbacks++;
          return giveOwn(recv, punt ? CFG.PUNT_TB_SPOT : CFG.KICKOFF_TB_SPOT);
        }
        const team = r.carrier ? r.carrier.team : recv;
        if (team === kicking && play.turnover) {
          this.teamStats(recv).fumblesLost++;
          this.emit("turnover", { kind: "fumble" });
        }
        return giveAt(team, spot);
      }
    }
  }

  advanceDown(spot, live) {
    const st = this.teamStats(this.offense);
    if (spot >= this.firstDownX) {
      st.firstDowns++;
      if (this.play && this.play.startDown === 3) st.thirdConv++;
      this.los = spot;
      this.down = 1;
      this.toGo = Math.min(10, 100 - spot);
      this.firstDownX = Math.min(100, spot + 10);
      this.ballY = clamp(this.ball.y, CFG.HASH_TOP, CFG.HASH_BOT);
      this.emit("firstDown", { los: spot });
      return;
    }
    this.los = spot;
    this.toGo = Math.max(0.5, this.firstDownX - spot);
    if (live) this.ballY = clamp(this.play && this.play.result && this.play.result.y != null ? this.play.result.y : this.ballY, CFG.HASH_TOP, CFG.HASH_BOT);
    this.down++;
    if (this.down > 4) {
      this.emit("turnover", { kind: "downs" });
      this.turnover(100 - spot, "downs", true);
    }
  }

  turnover(newLos, kind, silent) {
    const nt = this.defense;
    if (!silent && kind !== "punt" && kind !== "missedFG") this.emit("turnover", { kind });
    if (kind === "missedFG") this.emit("turnover", { kind });
    this.setPossession(nt, newLos);
    if (this.overtime) this.otPoss[nt]++;
  }

  dispatch(next) {
    const clockOut = !this.overtime && this.clock <= 0;
    if (next === "pat") {
      this.startPatChoice();
      return;
    }
    if (next === "kickoff" || next === "freekick") {
      if (clockOut) {
        this.resume = next;
        return this.endQuarter();
      }
      return this.startKickoff(this.other(this.kickTeam), { free: next === "freekick" });
    }
    if (clockOut) {
      this.resume = "call";
      return this.endQuarter();
    }
    this.toPlayCall();
  }

  // ---------- after a touchdown: kick or go for two ----------
  startPatChoice() {
    const team = this.patTeam;
    this.possession = team;
    this.patChoice = null;
    this.tryMode = null;
    this.setPhase("PAT_CHOICE");
    if (!this.isHuman(team)) this.choosePAT(AI.cpuPatChoice(this, team));
  }

  patChoiceStep(dt) {
    this.easePlayers(dt);
    const inp = this.input;
    if (!this.isHuman(this.patTeam) || this.patChoice) return;
    if (inp) {
      this.consumedInput = true;
      if (this.phaseT > 0.4) {
        if (inp.aPressed) return void this.choosePAT("kick");
        if (inp.bPressed) return void this.choosePAT("two");
      }
    }
    if (this.phaseT > CFG.PAT_CHOICE_AUTO) this.choosePAT("kick");
  }

  // The scoring team's call after a TD: 'kick' (PAT) or 'two' (a 2-point try from the 2).
  choosePAT(choice) {
    if (this.phase !== "PAT_CHOICE" || this.patChoice) return false;
    this.patChoice = choice === "two" ? "two" : "kick";
    this.emit("patChoice", { team: this.patTeam, choice: this.patChoice });
    if (this.patChoice === "two") this.startTwoPoint();
    else this.startPat();
    return true;
  }

  startPat() {
    const team = this.patTeam;
    this.possession = team;
    const O = this.teams[team].O.slice();
    const fbi = O.findIndex((p) => p.slot === "FB");
    if (fbi >= 0) O[fbi] = this.teams[team].K;
    this.fieldPlayers(O, this.teams[this.other(team)].D);
    // quick presentation: ball through the uprights from the 15
    const k = this.teams[team].K;
    const good = this.rng.next() < clamp(CFG.PAT_P + (k.r.kick - 70) * 0.001, 0.85, 0.995);
    this.patGood = good;
    this.teamStats(team).patAtt++;
    if (good) this.teamStats(team).patMade++;
    this.los = 85;
    this.ballY = MID;
    for (const p of this.players) p.resetForDown();
    this.play = this.newPlay(KICK_PLAYS.fg, defPlay("base"), { kick: "pat", offSkill: 0.6, defSkill: 0.6 });
    AI.alignFormation(this);
    const b = this.ball;
    b.state = "air";
    b.kind = "fg";
    b.x = 78;
    b.y = MID;
    b.z = 0.2;
    const T = 1.2;
    b.aimX = 110.5;
    b.aimY = MID + (good ? this.rng.range(-1.5, 1.5) : (this.rng.chance(0.5) ? -1 : 1) * 5);
    b.tSpawn = this.time;
    b.tArrive = this.time + T;
    b.vx = (b.aimX - b.x) / T;
    b.vy = (b.aimY - b.y) / T;
    b.vz = (4.5 - 0.2 + 0.5 * CFG.GRAVITY * T * T) / T;
    b.good = good;
    this.setPhase("PAT");
    if (good) this.addScore(team, 1, "PAT");
    this.emit("pat", { good, team, kicker: k });
  }

  afterPat() {
    this.kickTeam = this.patTeam;
    this.dispatch("kickoff");
  }

  // One scrimmage down from the 2, untimed: a TD is worth 2; a defensive return is worth 2 the other way.
  startTwoPoint() {
    const team = this.patTeam;
    this.possession = team;
    this.tryMode = { team };
    this.teamStats(team).twoPtAtt++;
    this.los = CFG.TWO_PT_LOS;
    this.down = 1;
    this.toGo = 100 - this.los;
    this.firstDownX = 100;
    this.ballY = MID;
    this.toPlayCall();
  }

  // Scores a 2-point try at the whistle (called from endPlay).
  scoreTry(result) {
    const team = this.tryMode ? this.tryMode.team : this.offense;
    const play = this.play;
    if (result.type === "td" && result.team === team && !play.turnover) {
      this.addScore(team, 2, "2PT");
      this.teamStats(team).twoPtMade++;
      result.twoPoint = true;
      result.label = "2-POINT TRY GOOD";
      if (result.scorer) result.scorer.state = "celebrate";
      this.emit("twoPoint", { team, good: true, scorer: result.scorer });
    } else if (result.type === "td" && result.team !== team) {
      this.addScore(result.team, 2, "DEF 2PT");
      result.label = "DEFENSIVE 2-POINT RETURN";
      this.emit("twoPoint", { team, good: false, defensive: true, scorer: result.scorer });
    } else {
      result.label = "2-POINT TRY FAILS";
      this.emit("twoPoint", { team, good: false });
    }
  }

  finishTry() {
    const team = this.tryMode ? this.tryMode.team : this.patTeam;
    this.tryMode = null;
    this.kickTeam = team;
    this.dispatch("kickoff");
  }

  endQuarter() {
    const q = this.quarter;
    this.emit("quarterEnd", { q });
    if (q === 1 || q === 3) {
      this.quarter++;
      this.clock = this.quarterSec;
      this.lastClock = this.clock;
      this.setPhase("QUARTER_BREAK");
      return;
    }
    if (q === 2) {
      this.setPhase("HALFTIME");
      this.halftimeDone = false;
      this.emit("halftime", {});
      return;
    }
    // end of regulation
    if (this.score.home !== this.score.away) return this.endGame();
    this.overtime = true;
    this.quarter = 5;
    this.clock = 0;
    this.otPoss = { home: 0, away: 0 };
    this.emit("overtime", {});
    this.setPhase("QUARTER_BREAK");
    this.resume = "otkick";
  }

  // Overtime, as in ALL-22 PRO: a touchdown or a safety ends it at once (applyResult). Otherwise, once both teams
  // have finished a possession, it's over the first time the score isn't tied (so a field goal on the opening drive
  // gets answered), and a tie once both have had OT_MAX_POSSESSIONS. a, b: the two teams' finished possessions.
  otOver(a, b) {
    return (a >= 1 && b >= 1 && this.score.home !== this.score.away) || (a >= CFG.OT_MAX_POSSESSIONS && b >= CFG.OT_MAX_POSSESSIONS);
  }

  resumeAfterBreak() {
    if (this.resume === "otkick") {
      const recv = this.rng.chance(0.5) ? "home" : "away";
      return this.startKickoff(recv);
    }
    if (this.resume === "kickoff" || this.resume === "freekick") return this.startKickoff(this.other(this.kickTeam), { free: this.resume === "freekick" });
    this.toPlayCall();
  }

  continueHalftime() {
    this.halftimeDone = true;
  }

  startSecondHalf() {
    this.quarter = 3;
    this.clock = this.quarterSec;
    this.lastClock = this.clock;
    this.emit("secondHalf", {});
    this.startKickoff(this.other(this.openingReceiver));
  }

  endGame() {
    this.winner = this.score.home > this.score.away ? "home" : this.score.away > this.score.home ? "away" : "tie";
    this.setPhase("GAME_OVER");
    this.emit("gameOver", { winner: this.winner, score: { ...this.score } });
  }

  // ---------- stats / summaries ----------
  mvp() {
    let best = null, bv = -1e9;
    const winner = this.winner && this.winner !== "tie" ? this.winner : null;
    for (const t of ["home", "away"]) {
      for (const p of this.teams[t].all) {
        const s = p.stats;
        let v = s.passYds * 0.045 + s.rushYds * 0.1 + s.recYds * 0.1 + s.retYds * 0.05 + s.td * 6 + s.tackles * 1.2 + s.sacks * 3 + s.ints * 5 + s.pancakes * 0.8 + s.brokenTackles * 0.6;
        if (winner && t !== winner) v *= 0.6;
        if (v > bv) { bv = v; best = p; }
      }
    }
    return best;
  }

  summary() {
    return {
      score: { ...this.score }, winner: this.winner, quarter: this.quarter, overtime: this.overtime,
      home: { ...this.stats.home }, away: { ...this.stats.away }, downs: this.downs, stuck: this.stuck,
      avgPlay: this.downs ? this.playDurations / this.downs : 0, log: this.log.slice(),
    };
  }

  // ---------- invariants ----------
  invErr(m) {
    if (this.errors.length < 50) this.errors.push(`${m} @q${this.quarter} ${this.clock.toFixed(1)} ${this.phase}`);
  }
  checkInvariants() {
    const err = this.boundErr || (this.boundErr = (m) => this.invErr(m));
    for (const p of this.players) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.vx) || !Number.isFinite(p.vy)) {
        err(`non-finite position ${p.slot}`);
        p.x = Number.isFinite(p.x) ? p.x : this.los;
        p.y = Number.isFinite(p.y) ? p.y : MID;
        p.vx = p.vy = 0;
      }
      if (p.x < -16 || p.x > 116 || p.y < -8 || p.y > FW + 8) {
        err(`off field ${p.slot} ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        p.x = clamp(p.x, -12, 112);
        p.y = clamp(p.y, -4, FW + 4);
      }
    }
    const b = this.ball;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) {
      err("non-finite ball");
      b.x = this.los;
      b.y = MID;
      b.z = 0;
    }
    if (this.clock > this.lastClock + 1e-6 && this.phase !== "QUARTER_BREAK" && this.phase !== "HALFTIME" && this.phase !== "KICKOFF") {
      if (!(this.quarter >= 3 && this.lastClock <= 0)) err(`clock went up ${this.lastClock.toFixed(2)} -> ${this.clock.toFixed(2)}`);
    }
    this.lastClock = this.clock;
    const sum = this.score.home + this.score.away;
    if (sum !== this.lastScoreSum) {
      if (this.scoreEvents === 0) err("score changed without a scoring event");
      this.lastScoreSum = sum;
      this.scoreEvents = 0;
    }
  }
}
