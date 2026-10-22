// Game modes: DRAFT YOUR TEAM (an arena draft: 22 starters + a kicker, pick 1 of 3 each round) and the
// GYM CHALLENGE (the region's 8 gyms in badge order, then its Champion — in Kanto Blue's Pallet Champions;
// badges, a badge case and a Hall of Fame). Owner: modes team. UI lives in modes-ui.js, pixel art in
// modes-art.js, styles in bowl-modes.css; data.js builds the teams (makeTeam('mydraft' | <gym> | 'champion')).
//
// Wiring: main.js calls installModes(app) once (before boot). Everything else hooks in from here
// without touching the other teams' files:
//   - title: "DRAFT YOUR TEAM" + "GYM CHALLENGE" entries (ui.addMenuButton('title', {label, onClick})
//     when the UI exposes it, else injected after each ui.showTitle()),
//   - team select: a third card, YOUR DRAFT (after each ui.showTeamSelect()),
//   - app.startGame / app.leaveGame: bind / clear the challenge context of the live World,
//   - bus 'gameOver': records gym results (saved at once), then ui.showResults() shows the badge
//     moment first and adds NEXT GYM / GYM LADDER / HALL OF FAME to the results.
// Saves (localStorage): all22bowl-drafted-v1 (the drafted team), all22bowl-draft-run-v1 (a draft in
// progress), all22bowl-gyms-v1 (badges, record, chosen team, Hall of Fame); each region keeps its own
// (data.js saveKey: all22bowl-gyms-johto-v1 ...), Kanto the original keys.
// Test hooks: window.__game.modes (state, open*, draft*, playGym, finish, grant, reset) and URL params
// ?draft=1 ?gyms=1 ?badges=1 ?hall=1 (open that screen after boot), ?draftseed=N.
import { bus, reportError } from "./events.js";
import { makeRng, clamp, PARAMS } from "./util.js";
import {
  makeTeam, LADDER, GYMS, gymByKey, readDraftedTeam, saveDraftedTeam, DEX, slotFit, partialOverall,
  teamOverall, dominantType, ALL_SLOTS, colorDelta, KIT_TURF_MIN, ladderTune, REGION, validId, saveKey,
} from "./data.js";
import { ModesUI } from "./modes-ui.js";
import { track } from "./track.js";

export const DRAFT_ORDER = ["QB", "HB", "WR1", "WR2", "TE", "FB", "LT", "LG", "C", "RG", "RT", "DE1", "NT", "DE2", "OLB1", "ILB1", "ILB2", "OLB2", "CB1", "CB2", "S1", "S2", "K"];
export const DRAFT_REROLLS = 2;
const RUN_KEY = saveKey("all22bowl-draft-run-v1");
const GYMS_KEY = saveKey("all22bowl-gyms-v1");
// analytics: the mode value carries the region outside Kanto ("BOWL gym challenge · Johto")
const TAG = (globalThis.ALL22_REGIONS && globalThis.ALL22_REGIONS.tag(REGION)) || "";

const ls = () => {
  try { return globalThis.localStorage || null; } catch (_) { return null; }
};
function readJSON(key) {
  try {
    const s = ls();
    return s ? JSON.parse(s.getItem(key) || "null") : null;
  } catch (_) {
    return null;
  }
}
function writeJSON(key, v) {
  try {
    const s = ls();
    if (!s) return;
    if (v == null) s.removeItem(key);
    else s.setItem(key, JSON.stringify(v));
  } catch (_) {}
}
const today = () => {
  try { return new Date().toISOString().slice(0, 10); } catch (_) { return ""; }
};
// ---------- the arena draft ----------
// Each round offers three Pokémon for the open spot: a blue chip (one of the ~12 best fits still
// available), a solid starter and a wild card from deeper in the pool — so reading the fit meter and
// the ratings matters, and a sharp draft ends near OVR 99 while a careless one lands in the 80s.
// Seeded: the same seed and choices give the same draft. Two rerolls per draft.
export class DraftRun {
  static create(seed, scheme) {
    const r = new DraftRun({ v: 1, seed: seed >>> 0 || 1, scheme: { def: scheme && scheme.def === "43" ? "43" : "34", off: scheme && scheme.off === "slot" ? "slot" : "fb" }, round: 0, picks: {}, rerolls: DRAFT_REROLLS, rolls: 0, options: [] });
    r.options = r.roll();
    return r;
  }
  static restore(o) {
    if (!o || o.v !== 1 || !o.picks || !Array.isArray(o.options) || !Number.isInteger(o.round)) return null;
    if (o.round < 0 || o.round > DRAFT_ORDER.length) return null;
    for (let i = 0; i < o.round; i++) if (!validId(o.picks[DRAFT_ORDER[i]])) return null;
    const r = new DraftRun(o);
    if (!r.done && (r.options.length !== 3 || !r.options.every(validId))) r.options = r.roll();
    return r;
  }
  constructor(o) {
    this.v = 1;
    this.seed = o.seed >>> 0 || 1;
    this.scheme = { def: o.scheme && o.scheme.def === "43" ? "43" : "34", off: o.scheme && o.scheme.off === "slot" ? "slot" : "fb" };
    this.round = o.round | 0;
    this.picks = { ...o.picks };
    this.rerolls = clamp(o.rerolls | 0, 0, DRAFT_REROLLS);
    this.rolls = o.rolls | 0;
    this.options = (o.options || []).slice(0, 3);
  }
  get slot() { return DRAFT_ORDER[this.round]; }
  get done() { return this.round >= DRAFT_ORDER.length; }
  taken() { return new Set(Object.values(this.picks)); }
  roll(exclude = []) {
    const slot = this.slot;
    if (!slot) return [];
    const rng = makeRng((this.seed ^ Math.imul(this.round + 1, 0x9e3779b1) ^ Math.imul(this.rolls + 7, 0x85ebca6b)) >>> 0);
    const taken = this.taken();
    for (const id of exclude) taken.add(id);
    const ranked = DEX().filter((id) => !taken.has(id)).map((id) => ({ id, v: slotFit(id, slot, this.scheme) + rng.next() * 7 }));
    ranked.sort((a, b) => b.v - a.v);
    const chosen = [];
    const from = (lo, hi) => {
      const pool = ranked.slice(lo, Math.max(lo + 1, Math.min(hi, ranked.length))).filter((c) => !chosen.includes(c.id));
      const list = pool.length ? pool : ranked.filter((c) => !chosen.includes(c.id));
      if (list.length) chosen.push(list[Math.floor(rng.next() * list.length)].id);
    };
    from(0, 12); // blue chip
    from(8, 40); // solid starter
    from(25, 100); // wild card
    for (let i = chosen.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
    }
    return chosen;
  }
  pick(i) {
    const id = this.options[i];
    if (this.done || !validId(id)) return false;
    this.picks[this.slot] = id;
    this.round++;
    this.rolls = 0;
    this.options = this.done ? [] : this.roll();
    return true;
  }
  reroll() {
    if (this.done || this.rerolls <= 0) return false;
    this.rerolls--;
    this.rolls++;
    this.options = this.roll(this.options);
    return true;
  }
  lineup() {
    const l = {};
    for (const s of DRAFT_ORDER) if (this.picks[s]) l[s] = this.picks[s];
    return l;
  }
  overall() {
    const l = this.lineup();
    if (this.done) return teamOverall(l, this.scheme);
    return partialOverall(l, this.scheme);
  }
  toJSON() {
    return { v: 1, seed: this.seed, scheme: this.scheme, round: this.round, picks: this.picks, rerolls: this.rerolls, rolls: this.rolls, options: this.options };
  }
}

// Team names for a fresh draft: a place in the region + a mascot from the team's main type.
const PLACES_BY_REGION = {
  kanto: [["KANTO", "KAN"], ["PALLET", "PLT"], ["LAVENDER", "LAV"], ["INDIGO", "IND"], ["SEAFOAM", "SEA"], ["VICTORY", "VIC"], ["MT. MOON", "MTM"], ["SAFARI", "SFZ"]],
  johto: [["JOHTO", "JOH"], ["NEW BARK", "NBK"], ["ILEX", "ILX"], ["ALPH", "ALP"], ["MT. SILVER", "MTS"], ["SPROUT", "SPR"], ["WHIRL", "WHI"], ["TOHJO", "TOH"]],
  hoenn: [["HOENN", "HOE"], ["LITTLEROOT", "LTR"], ["SLATEPORT", "SLP"], ["LILYCOVE", "LIL"], ["FALLARBOR", "FAL"], ["PACIFIDLOG", "PAC"], ["MT. PYRE", "MTP"], ["VERDANTURF", "VRD"]],
  sinnoh: [["SINNOH", "SIN"], ["TWINLEAF", "TWL"], ["JUBILIFE", "JUB"], ["SOLACEON", "SOL"], ["CELESTIC", "CEL"], ["FLOAROMA", "FLO"], ["CORONET", "COR"], ["SANDGEM", "SDG"]],
};
const PLACES = PLACES_BY_REGION[REGION.key] || [[REGION.name.toUpperCase(), REGION.name.slice(0, 3).toUpperCase()]];
const MASCOTS = {
  fire: "FLAMES", water: "WAVES", electric: "SPARKS", grass: "SPROUTS", poison: "STINGERS", psychic: "PSYCHICS",
  fighting: "BRAWLERS", rock: "BOULDERS", ground: "QUAKES", flying: "WINGS", bug: "SWARM", ghost: "PHANTOMS",
  dragon: "DRAGONS", ice: "BLIZZARD", normal: "STAMPEDE", fairy: "PIXIES", steel: "IRONCLADS", dark: "SHADES",
};
// Kit colors the drafted team can wear (all readable on the turf), each with its trim.
export const DRAFT_COLORS = [
  ["#e8352a", "#f6f6f2"], ["#ff7a1a", "#0b0d14"], ["#ffd23f", "#1b2547"], ["#2ec4b6", "#0b0d14"], ["#3a86ff", "#ffd23f"],
  ["#9b5de5", "#f6f6f2"], ["#ff6fb5", "#1b2547"], ["#1b1d24", "#ffd23f"], ["#f6f6f2", "#e8352a"],
].filter(([p]) => colorDelta(p, "#2f8f3a") >= KIT_TURF_MIN);
const TYPE_KIT = { fire: 1, water: 4, electric: 2, grass: 3, poison: 5, psychic: 6, fighting: 0, rock: 7, ground: 1, flying: 4, bug: 3, ghost: 5, dragon: 5, ice: 3, normal: 0, fairy: 6, steel: 7, dark: 7 };
export function draftIdentity(lineup, placeIdx = 0, colorIdx = null) {
  const type = dominantType(lineup);
  const [place, abbr] = PLACES[((placeIdx % PLACES.length) + PLACES.length) % PLACES.length];
  const ci = colorIdx != null ? colorIdx : Math.min(DRAFT_COLORS.length - 1, TYPE_KIT[type] ?? 0);
  const [primary, secondary] = DRAFT_COLORS[((ci % DRAFT_COLORS.length) + DRAFT_COLORS.length) % DRAFT_COLORS.length];
  return { name: `${place} ${MASCOTS[type] || "STARS"}`, abbr, primary, secondary, type, placeIdx, colorIdx: ci };
}

// ---------- the Gym Challenge save ----------
const TEAM_KINDS = ["mine", "mydraft", "draft"];
export class GymStore {
  constructor() {
    this.load();
  }
  fresh() {
    return { v: 1, team: "mine", quickSeed: ((Date.now() % 9973) + 1) | 0, badges: {}, champion: null, attempts: {}, record: { w: 0, l: 0, t: 0 }, hall: [], runs: 1, titles: 0 };
  }
  load() {
    const o = readJSON(GYMS_KEY);
    const f = this.fresh();
    if (!o || o.v !== 1) {
      this.s = f;
      return;
    }
    // a badge (or the title) counts only when its saved result is a real one: anything else is dropped
    const badges = {};
    for (const g of GYMS) {
      const r = sanitizeResult(o.badges && o.badges[g.key]);
      if (r) badges[g.key] = r;
    }
    // tries per gym: known ladder keys with whole, non-negative counts only
    const attempts = {};
    if (o.attempts && typeof o.attempts === "object") for (const g of LADDER) if (Number.isInteger(o.attempts[g.key]) && o.attempts[g.key] >= 0) attempts[g.key] = o.attempts[g.key];
    const count = (k) => Math.max(0, (o.record && o.record[k]) | 0);
    this.s = {
      v: 1,
      team: TEAM_KINDS.includes(o.team) ? o.team : "mine",
      quickSeed: Number.isInteger(o.quickSeed) && o.quickSeed > 0 ? o.quickSeed : f.quickSeed,
      badges,
      champion: sanitizeResult(o.champion),
      attempts,
      record: { w: count("w"), l: count("l"), t: count("t") },
      hall: Array.isArray(o.hall) ? o.hall.filter(validHall).slice(0, 12) : [],
      runs: Math.max(1, o.runs | 0),
      titles: Math.max(0, o.titles | 0),
    };
  }
  save() {
    writeJSON(GYMS_KEY, this.s);
  }
  badgeCount() {
    return GYMS.filter((g) => this.s.badges[g.key]).length;
  }
  has(key) {
    return key === "champion" ? !!this.s.champion : !!this.s.badges[key];
  }
  // The next opponent on the ladder (null once the Champion has fallen this run).
  nextKey() {
    for (const g of GYMS) if (!this.s.badges[g.key]) return g.key;
    return this.s.champion ? null : "champion";
  }
  status(key) {
    if (this.has(key)) return "won";
    return this.nextKey() === key ? "next" : "locked";
  }
  playable(key) {
    return this.status(key) !== "locked";
  }
  record(key, result, score, teamName) {
    const s = this.s;
    s.attempts[key] = (s.attempts[key] | 0) + 1;
    if (result === "win") s.record.w++;
    else if (result === "tie") s.record.t++;
    else s.record.l++;
    let fresh = false;
    if (result === "win") {
      const entry = { date: today(), score: [score.home | 0, score.away | 0], team: String(teamName || "").slice(0, 24), tries: s.attempts[key] };
      if (key === "champion") {
        fresh = !s.champion;
        if (fresh) {
          s.champion = entry;
          s.titles++;
        }
      } else if (!s.badges[key]) {
        s.badges[key] = entry;
        fresh = true;
      }
    }
    this.save();
    return fresh;
  }
  get teamKind() {
    return this.s.team;
  }
  setTeamKind(k) {
    if (!TEAM_KINDS.includes(k)) return;
    this.s.team = k;
    this.save();
  }
  rerollQuick() {
    this.s.quickSeed = (this.s.quickSeed * 48271 + 11) % 2147483647 || 7;
    this.save();
  }
  userTeam(kind = this.s.team) {
    if (kind === "mydraft" && !readDraftedTeam()) kind = "mine";
    return makeTeam(kind, { seed: this.s.quickSeed });
  }
  addHall(entry) {
    this.s.hall.unshift(entry);
    this.s.hall = this.s.hall.slice(0, 12);
    this.save();
  }
  newRun() {
    this.s.badges = {};
    this.s.champion = null;
    this.s.attempts = {};
    this.s.runs++;
    this.save();
  }
}
// A saved game result, or null when it isn't one (no finite, non-negative final score).
function sanitizeResult(r) {
  if (!r || typeof r !== "object" || !Array.isArray(r.score)) return null;
  const [a, b] = r.score;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  return {
    date: typeof r.date === "string" ? r.date.slice(0, 10) : "",
    score: [Math.round(a), Math.round(b)],
    team: typeof r.team === "string" ? r.team.slice(0, 24) : "",
    tries: Math.max(0, r.tries | 0),
  };
}
function validHall(h) {
  return h && typeof h === "object" && h.lineup && ALL_SLOTS.every((s) => validId(h.lineup[s]));
}

// ---------- the controller ----------
export class Modes {
  constructor(app) {
    this.app = app;
    this.ui = app.ui;
    this.store = new GymStore();
    this.run = DraftRun.restore(readJSON(RUN_KEY));
    this.ctx = null; // the live challenge game: {kind:'gym', key, world, homeKind, celebrated, result}
    this.pending = null;
    this.view = new ModesUI(this);
    this.firstTitle = true;
    this.patchTitle();
    this.patchTeamSelect();
    this.patchGameFlow();
    this.patchResults();
    this.patchScreenName();
    bus.on("gameOver", (p, type, w) => this.onGameOver(p, w));
    bus.on("gameOver", (p, type, w) => this.trackFinal(p, w));
    this.installHooks();
  }

  // ----- screens -----
  setScr(name) {
    this.app.scr = name;
    if (name !== "vs") this.pending = null; // left the VS screen before kickoff: no game
  }
  sfx(kind) {
    try { this.ui.sfx(kind); } catch (_) {}
  }
  openTitle() {
    this.app.goTitle();
  }
  openDraft() {
    this.setScr("draft");
    if (this.run && !this.run.done) this.view.draftIntro({ resume: this.run });
    else this.view.draftIntro({ resume: null });
  }
  startDraft(scheme) {
    const seedP = PARAMS.get("draftseed");
    const seed = seedP != null ? Number(seedP) >>> 0 : (Date.now() ^ Math.imul(this.store.s.runs + 3, 2654435761)) >>> 0;
    this.run = DraftRun.create(seed, scheme);
    this.saveRun();
    this.setScr("draft");
    this.view.draftRound(this.run);
  }
  resumeDraft() {
    if (!this.run) return this.openDraft();
    this.setScr("draft");
    if (this.run.done) this.finishDraft();
    else this.view.draftRound(this.run);
  }
  saveRun() {
    writeJSON(RUN_KEY, this.run && !this.run.done ? this.run.toJSON() : null);
  }
  draftPick(i) {
    const r = this.run;
    if (!r || r.done) return false;
    const before = r.overall();
    if (!r.pick(i)) return false;
    const after = r.done ? null : r.overall();
    r.lastDelta = before && after ? after.ovr - before.ovr : null; // shown next to TEAM OVR
    this.saveRun();
    if (r.done) this.finishDraft();
    return true;
  }
  draftReroll() {
    const r = this.run;
    if (!r || !r.reroll()) return false;
    this.saveRun();
    return true;
  }
  // The finished draft becomes YOUR DRAFT (saved; replaces the previous one).
  finishDraft() {
    const r = this.run;
    if (!r || !r.done) return;
    const lineup = r.lineup();
    const id = draftIdentity(lineup);
    const ov = teamOverall(lineup, r.scheme);
    saveDraftedTeam({ name: id.name, abbr: id.abbr, primary: id.primary, secondary: id.secondary, lineup, scheme: r.scheme, ovr: ov.ovr, created: today(), placeIdx: id.placeIdx, colorIdx: id.colorIdx });
    this.draftLook = { placeIdx: 0, colorIdx: id.colorIdx };
    writeJSON(RUN_KEY, null);
    this.setScr("draft");
    this.view.draftDone({ celebrate: true });
  }
  restyleDraft(change) {
    const d = readDraftedTeam();
    if (!d) return;
    const look = this.draftLook || { placeIdx: 0, colorIdx: null };
    if (change.place) look.placeIdx = (look.placeIdx || 0) + 1;
    if (change.color != null) look.colorIdx = change.color;
    this.draftLook = look;
    const id = draftIdentity(d.lineup, look.placeIdx, look.colorIdx);
    saveDraftedTeam({ ...d, name: id.name, abbr: id.abbr, primary: id.primary, secondary: id.secondary });
  }
  // Play the drafted team: straight to the opponent select (exhibition).
  playDraft() {
    if (!readDraftedTeam()) return this.openDraft();
    this.app.goOppSelect(makeTeam("mydraft"));
  }
  openLadder(sel) {
    this.setScr("gyms");
    this.view.ladder(sel || this.store.nextKey() || "champion");
  }
  openVs(key) {
    if (!gymByKey(key) || !this.store.playable(key)) return this.openLadder(key);
    this.setScr("vs");
    this.view.vs(key, this.store.userTeam());
  }
  openBadges(back) {
    this.setScr("badges");
    this.view.badgeCase(back || (() => this.openLadder()));
  }
  openHall(opts = {}) {
    this.setScr("hall");
    this.view.hall(opts);
  }

  // Kick off a ladder game (from the VS screen).
  async playGym(key) {
    const g = gymByKey(key);
    if (!g || !this.store.playable(key)) return false;
    const home = this.store.userTeam();
    const away = ladderTune(makeTeam(key));
    this.pending = { kind: "gym", key, homeKind: home.key, homeName: home.name };
    try {
      await this.app.preloadTeams(home, away);
    } catch (e) {
      reportError("modes.playGym", e);
    }
    if (!this.pending || this.pending.key !== key || this.app.scr !== "vs") return false;
    this.app.startGame(home, away);
    return true;
  }

  onGameOver(p, w) {
    const c = this.ctx;
    if (!c || c.world !== w || c.recorded) return;
    c.recorded = true;
    const win = p.winner === "home";
    c.result = win ? "win" : p.winner === "tie" ? "tie" : "loss";
    const home = w.teams.home.data;
    c.fresh = this.store.record(c.key, c.result, p.score || w.score, home.name);
    if (win && c.fresh) track("First Win", { game: "BOWL", vs: TAG ? `${REGION.key}/${c.key}` : c.key });
    if (win && c.key === "champion" && c.fresh) {
      this.store.addHall({
        date: today(), name: home.name, abbr: home.abbr, primary: home.primary, secondary: home.secondary,
        lineup: { ...home.lineup }, scheme: { ...home.scheme }, ovr: home.overall ? home.overall.ovr : 0, kind: home.key,
        score: [w.score.home, w.score.away], record: { ...this.store.s.record }, run: this.store.s.runs,
      });
    }
    if (win && c.fresh) {
      const a = this.app.audio;
      try {
        // the badge fanfare replaces the victory jingle as the badge moment opens (~2.3 s after
        // the final whistle); play it now only if the audio has no such hook or the jingle is past
        if (a && "resultOverride" in a && w.phase === "GAME_OVER" && w.phaseT < 2) a.resultOverride = "badge";
        else if (a && typeof a.play === "function") a.play("badge");
        else if (a && typeof a.fanfare === "function") setTimeout(() => a.fanfare(), 2600);
      } catch (_) {}
    }
  }

  // analytics (track.js): one "Game Finished" per started game that reaches the final whistle (the title's attract game
  // and a game quit early never get here)
  trackFinal(p, w) {
    if (!w || !w.trackMode || w.trackedFinal) return;
    w.trackedFinal = true;
    track("Game Finished", { mode: w.trackMode, result: p.winner === "home" ? "win" : p.winner === "away" ? "loss" : "tie" });
  }

  // ----- hooks into the app / ui (no edits to their files) -----
  patchTitle() {
    const ui = this.ui;
    // the UI's hook when it has one (briefed as addMenuButton(screen, {label, onClick})); either way
    // decorateTitle() makes sure both entries exist after every title render
    if (typeof ui.addMenuButton === "function") {
      try {
        ui.addMenuButton("title", { label: "DRAFT YOUR TEAM", onClick: () => this.openDraft(), id: "modes-draft" });
        ui.addMenuButton("title", { label: "GYM CHALLENGE", onClick: () => this.openLadder(), id: "modes-gyms" });
      } catch (e) {
        reportError("modes.addMenuButton", e);
      }
    }
    const orig = ui.showTitle.bind(ui);
    ui.showTitle = (...a) => {
      const r = orig(...a);
      try {
        this.view.decorateTitle();
      } catch (e) {
        reportError("modes.title", e);
      }
      if (this.firstTitle) {
        this.firstTitle = false;
        this.openFromParams();
      }
      return r;
    };
  }
  openFromParams() {
    if (PARAMS.get("draft") === "1") this.openDraft();
    else if (PARAMS.get("gyms") === "1") this.openLadder();
    else if (PARAMS.get("badges") === "1") this.openBadges();
    else if (PARAMS.get("hall") === "1") this.openHall();
  }
  patchTeamSelect() {
    const ui = this.ui;
    const orig = ui.showTeamSelect.bind(ui);
    ui.showTeamSelect = (...a) => {
      const r = orig(...a);
      try {
        this.view.decorateTeamSelect();
      } catch (e) {
        reportError("modes.teamSelect", e);
      }
      return r;
    };
  }
  patchGameFlow() {
    const app = this.app;
    const start = app.startGame.bind(app);
    app.startGame = (home, away, ...rest) => {
      const pend = this.pending;
      const prev = this.ctx;
      this.pending = null;
      // a rematch / restart of the same ladder game stays in the challenge (at ladder strength)
      const again = !pend && prev && away && home && away.key === prev.key && home.key === prev.homeKind;
      if (again) ladderTune(away);
      const r = start(home, away, ...rest);
      const w = app.world;
      if (pend) this.ctx = { ...pend, world: w, celebrated: false, recorded: false, result: null };
      else if (again) this.ctx = { ...prev, world: w, celebrated: false, recorded: false, result: null };
      else this.ctx = null;
      this.view.chip(this.ctx);
      // analytics (track.js): every kickoff of a game someone plays (not the ?autoplay CPU-vs-CPU loop)
      if (w && !w.autoplay) {
        w.trackMode = (this.ctx ? "BOWL gym challenge" : home && home.key === "mydraft" ? "BOWL draft" : "BOWL exhibition") + TAG;
        track("Game Started", { mode: w.trackMode });
      }
      return r;
    };
    const leave = app.leaveGame.bind(app);
    app.leaveGame = (...a) => {
      this.ctx = null;
      this.pending = null;
      this.view.chip(null);
      return leave(...a);
    };
  }
  patchResults() {
    const ui = this.ui;
    const orig = ui.showResults.bind(ui);
    ui.showResults = (w, onRematch, onNewOpp, onQuit, ...rest) => {
      const c = this.ctx;
      if (!c || c.world !== w) return orig(w, onRematch, onNewOpp, onQuit, ...rest);
      if (!c.recorded) this.onGameOver({ winner: w.winner, score: w.score }, w);
      const show = () => {
        orig(w, () => this.retry(), () => this.toLadder(), onQuit, ...rest);
        try {
          this.view.decorateResults(w, c);
        } catch (e) {
          reportError("modes.results", e);
        }
      };
      if (c.result === "win" && c.fresh && !c.celebrated) {
        c.celebrated = true;
        this.view.badgeMoment(c, show);
      } else show();
    };
  }
  patchScreenName() {
    const app = this.app;
    const orig = app.screen.bind(app);
    app.screen = () => {
      const m = this.ui.modalEl;
      if (m && m.classList && m.classList.contains("mo-badge-modal")) return "badge";
      return orig();
    };
  }

  // results-screen actions for ladder games
  retry() {
    this.app.restart();
  }
  toLadder(sel) {
    this.app.leaveGame();
    this.openLadder(sel);
  }
  nextGym() {
    const k = this.store.nextKey();
    this.app.leaveGame();
    if (k) this.openVs(k);
    else this.openHall({ induct: true });
  }
  toHall() {
    this.app.leaveGame();
    this.openHall({ induct: true });
  }

  // ----- test hooks -----
  installHooks() {
    const g = globalThis.__game;
    if (!g) return;
    const self = this;
    g.modes = {
      state() {
        const r = self.run;
        return {
          screen: self.app.screen(),
          challenge: self.ctx ? { key: self.ctx.key, result: self.ctx.result, home: self.ctx.homeKind } : null,
          badges: GYMS.filter((x) => self.store.s.badges[x.key]).map((x) => x.key),
          champion: !!self.store.s.champion,
          next: self.store.nextKey(),
          team: self.store.s.team,
          record: { ...self.store.s.record },
          hall: self.store.s.hall.length,
          draft: r ? { round: r.round, slot: r.slot || null, options: r.options.slice(), rerolls: r.rerolls, done: r.done, ovr: r.overall() } : null,
          drafted: (() => { const d = readDraftedTeam(); return d ? { name: d.name, abbr: d.abbr, ovr: teamOverall(d.lineup, d.scheme).ovr } : null; })(),
        };
      },
      openDraft: () => self.openDraft(),
      openLadder: (k) => self.openLadder(k),
      openBadges: () => self.openBadges(),
      openHall: (o) => self.openHall(o || {}),
      openVs: (k) => self.openVs(k || self.store.nextKey()),
      draftStart: (o = {}) => {
        if (o.seed != null) self.run = DraftRun.create(o.seed, o);
        else self.run = DraftRun.create((Date.now() >>> 0) || 1, o);
        self.saveRun();
        self.setScr("draft");
        self.view.draftRound(self.run);
        return self.run.options.slice();
      },
      draftPick: (i = 0) => {
        const ok = self.draftPick(i);
        if (ok && self.run && !self.run.done && self.app.scr === "draft") self.view.draftRound(self.run);
        return ok;
      },
      draftReroll: () => {
        const ok = self.draftReroll();
        if (ok && self.app.scr === "draft") self.view.draftRound(self.run);
        return ok;
      },
      // finish the draft by always taking the best fit (or `pick` index) each round
      draftAuto: (pick = "best") => {
        if (!self.run || self.run.done) g.modes.draftStart({ seed: 7 });
        const r = self.run;
        while (r && !r.done) {
          let i = typeof pick === "number" ? pick : 0;
          if (pick === "best") {
            let bv = -1;
            r.options.forEach((id, k) => { const v = slotFit(id, r.slot, r.scheme); if (v > bv) { bv = v; i = k; } });
          }
          self.draftPick(i);
        }
        return g.modes.state().drafted;
      },
      setTeam: (k) => { self.store.setTeamKind(k); return self.store.s.team; },
      // kick off a ladder game straight away (as if KICK OFF was pressed on its VS screen)
      playGym: (k) => {
        self.setScr("vs");
        return self.playGym(k || self.store.nextKey());
      },
      // end the live game now with this result (flow tests); goes through world.endGame()
      finish: (result = "win") => {
        const w = self.app.world;
        if (!w || w.phase === "GAME_OVER") return false;
        const us = result === "win" ? 24 : result === "tie" ? 10 : 7, them = result === "win" ? 10 : result === "tie" ? 10 : 21;
        w.score.home = us;
        w.score.away = them;
        w.lastScoreSum = us + them; // a test shortcut, not a scoring play: keep the debug invariant quiet
        w.endGame();
        return true;
      },
      grant: (n = 8) => {
        LADDER.slice(0, clamp(n | 0, 0, 9)).forEach((x) => self.store.record(x.key, "win", { home: 21, away: 14 }, "TEST"));
        return g.modes.state().badges;
      },
      reset: (all = false) => {
        if (all) { writeJSON(GYMS_KEY, null); self.store.load(); }
        else self.store.newRun();
        return g.modes.state();
      },
      store: self.store,
    };
  }
}

export function installModes(app) {
  if (!app || !app.ui) return null;
  try {
    return (app.modes = new Modes(app));
  } catch (e) {
    reportError("installModes", e);
    return null;
  }
}
