// Test hooks: URL params (?quick ?autoplay ?speed ?seed ?opp ?debug ?qtr ?manual ?nopause) and
// window.__game { state(), stats(), errors, simulate({games, seed}), setSpeed(n), advance(ms),
// press(key, ms), choosePlay(id, flip?), user(), bus, world(), app, mirrorCheck(opts) }. simulate() runs full AI-vs-AI
// games headlessly (no rendering, silent bus) as fast as possible; mirrorCheck() is FLIP's mirror test (flip-test.js,
// loaded when called). state().play.flip: [offense, defense] (the calls' FLIPs) while either call is flipped.
//   ?manual=1   the rAF loop never advances the game; __game.advance(ms) runs ms of frames
//               synchronously (fixed-step sim, fx, camera, UI) and renders exactly one frame.
//   ?nopause=1  no auto-pause when the tab is hidden (also off under ?autoplay=1).
//   ?autoplay=1 CPU vs CPU; after the final whistle a rematch starts with seed + 1.
import { CFG } from "./config.js";
import { World } from "./world.js";
import { silentBus, bus, errorLog } from "./events.js";
import { makeTeam, GYMS } from "./data.js";
import { PARAMS, clamp } from "./util.js";

export const TEST = {
  quick: PARAMS.get("quick") === "1",
  autoplay: PARAMS.get("autoplay") === "1",
  speed: clamp(Number(PARAMS.get("speed")) || 1, 1, 8),
  seed: PARAMS.has("seed") ? Number(PARAMS.get("seed")) >>> 0 : null,
  opp: PARAMS.get("opp") || null,
  debug: PARAMS.get("debug") === "1",
  quarter: PARAMS.has("qtr") ? clamp(Number(PARAMS.get("qtr")) || 120, 10, 600) : null,
  manual: PARAMS.get("manual") === "1",
  nopause: PARAMS.get("nopause") === "1",
};

// Synthetic in-page key events (KeyboardEvent.key or .code names: "ArrowUp", "Space", "z", "1",
// "Shift", "Enter", "Escape"; "Shift+ArrowUp" holds several). Released after `ms` via a timer, so
// the rAF loop keeps running. Resolves when released.
const KEY_ALIAS = { " ": "Space", Space: "Space", Shift: "ShiftLeft", Control: "ControlLeft", Alt: "AltLeft", Esc: "Escape" };
function keyInit(name) {
  let code = KEY_ALIAS[name] || name;
  if (/^[a-z]$/i.test(name)) code = "Key" + name.toUpperCase();
  else if (/^[0-9]$/.test(name)) code = "Digit" + name;
  const key = code === "Space" ? " " : /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit\d$/.test(code) ? code.slice(5) : code.replace(/(Left|Right)$/, "") || code;
  return { code, key, bubbles: true, cancelable: true };
}
export function press(keys, ms = 80) {
  const list = String(keys).split("+").filter(Boolean).map(keyInit);
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : window;
  for (const k of list) target.dispatchEvent(new KeyboardEvent("keydown", k));
  return new Promise((resolve) => {
    setTimeout(() => {
      for (const k of list) target.dispatchEvent(new KeyboardEvent("keyup", k));
      resolve(true);
    }, Math.max(0, Number(ms) || 0));
  });
}

function simulateOne(seed, homeKey, awayKey, quarterSec) {
  const home = makeTeam(homeKey);
  const away = makeTeam(awayKey);
  const w = new World({ bus: silentBus, seed, headless: true, autoplay: true, home, away, quarterSec });
  let steps = 0;
  let exception = null;
  const MAX = 500000;
  try {
    while (w.phase !== "GAME_OVER" && steps < MAX) {
      w.update(CFG.DT);
      steps++;
    }
  } catch (e) {
    exception = String((e && e.stack) || e).slice(0, 500);
  }
  const s = w.summary();
  const tot = (k) => s.home[k] + s.away[k];
  return {
    seed, home: homeKey, away: awayKey, score: s.score, winner: s.winner, overtime: s.overtime, steps,
    timedOut: steps >= MAX, exception, errors: w.errors.slice(0, 10), stuck: s.stuck, plays: s.downs,
    avgPlaySec: Math.round(s.avgPlay * 100) / 100,
    rushes: tot("rushes"), rushYds: tot("rushYds"), att: tot("att"), comp: tot("comp"), passYds: tot("passYds"),
    sacks: tot("sacks"), ints: tot("ints"), fumblesLost: tot("fumblesLost"), punts: tot("punts"), fgMade: tot("fgMade"), fgAtt: tot("fgAtt"),
    totalYds: tot("totalYds"), firstDowns: tot("firstDowns"), tds: tot("tds"), bigPlays: tot("bigPlays"),
    // [football round 2 wiring] special teams / tries
    kr: tot("kr"), krYds: tot("krYds"), pr: tot("pr"), prYds: tot("prYds"), retTds: tot("retTds"), fairCatches: tot("fairCatches"), touchbacks: tot("touchbacks"),
    twoPtAtt: tot("twoPtAtt"), twoPtMade: tot("twoPtMade"), onsideAtt: tot("onsideAtt"), onsideRec: tot("onsideRec"), defTds: tot("defTds"),
    teamStats: { home: s.home, away: s.away },
  };
}

export function simulate(opts = {}) {
  const games = clamp(opts.games || 10, 1, 200);
  const seed = (opts.seed ?? 1) >>> 0;
  const t0 = performance.now();
  const results = [];
  for (let g = 0; g < games; g++) {
    const home = opts.home || "mine";
    const away = opts.away || GYMS[(g + seed) % GYMS.length].key;
    results.push(simulateOne((seed * 2654435761 + g * 40503) >>> 0 || 1, home, away, opts.quarterSec));
  }
  const n = results.length;
  const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0);
  const agg = {
    games: n,
    wallMs: Math.round(performance.now() - t0),
    avgPointsPerTeam: Math.round((results.reduce((a, r) => a + r.score.home + r.score.away, 0) / (2 * n)) * 10) / 10,
    yardsPerCarry: Math.round((sum("rushYds") / Math.max(1, sum("rushes"))) * 100) / 100,
    completionPct: Math.round((sum("comp") / Math.max(1, sum("att"))) * 1000) / 10,
    yardsPerAttempt: Math.round((sum("passYds") / Math.max(1, sum("att"))) * 100) / 100,
    sacksPerGame: Math.round((sum("sacks") / n) * 10) / 10,
    turnoversPerGame: Math.round(((sum("ints") + sum("fumblesLost")) / n) * 10) / 10,
    intsPerGame: Math.round((sum("ints") / n) * 10) / 10,
    playsPerGame: Math.round(sum("plays") / n),
    avgPlaySec: Math.round((results.reduce((a, r) => a + r.avgPlaySec, 0) / n) * 100) / 100,
    puntsPerGame: Math.round((sum("punts") / n) * 10) / 10,
    fgPerGame: Math.round((sum("fgMade") / n) * 10) / 10 + "/" + Math.round((sum("fgAtt") / n) * 10) / 10,
    overtimeGames: results.filter((r) => r.overtime).length,
    stuckDowns: sum("stuck"),
    exceptions: results.filter((r) => r.exception).length,
    timeouts: results.filter((r) => r.timedOut).length,
    invariantErrors: results.reduce((a, r) => a + r.errors.length, 0),
    // [football round 2 wiring]
    kickReturnAvg: Math.round((sum("krYds") / Math.max(1, sum("kr"))) * 10) / 10,
    puntReturnAvg: Math.round((sum("prYds") / Math.max(1, sum("pr"))) * 10) / 10,
    returnTds: sum("retTds"),
    fairCatchesPerGame: Math.round((sum("fairCatches") / n) * 10) / 10,
    twoPoint: `${sum("twoPtMade")}/${sum("twoPtAtt")}`,
    onside: `${sum("onsideRec")}/${sum("onsideAtt")}`,
    defensiveTds: sum("defTds"),
  };
  return { summary: agg, games: results.map(({ teamStats, ...r }) => r) };
}

// Installs window.__game for a live app.
export function installHooks(app) {
  const g = {
    errors: [],
    state() {
      const w = app.currentWorld();
      if (!w) return { screen: app.screen() };
      return {
        screen: app.screen(), quarter: w.quarter, clock: Math.round(w.clock * 10) / 10, score: { ...w.score },
        down: w.down, toGo: Math.round(w.toGo * 10) / 10, los: Math.round(w.los * 10) / 10, possession: w.possession,
        phase: w.phase, overtime: w.overtime, play: w.play ? { off: w.play.off.id, def: w.play.def.id, t: Math.round(w.play.t * 100) / 100, ...(w.play.flips && (w.play.flips.off || w.play.flips.def) ? { flip: [w.play.flips.off, w.play.flips.def] } : {}) } : null,
        user: w.userPlayer ? w.userPlayer.slot : null, ball: { state: w.ball.state, x: Math.round(w.ball.x * 10) / 10, y: Math.round(w.ball.y * 10) / 10, z: Math.round(w.ball.z * 10) / 10 },
      };
    },
    stats() {
      const w = app.currentWorld();
      return w ? w.summary() : null;
    },
    simulate,
    setSpeed(n) {
      app.setSpeed(clamp(Number(n) || 1, 1, 8));
      return app.speed();
    },
    world: () => app.currentWorld(),
    app,
    bus,
    advance: (ms) => {
      app.advance(ms);
      return g.state();
    },
    press,
    choosePlay: (id, flip) => app.choosePlay(id, flip),
    mirrorCheck: (opts) => import("./flip-test.js").then((m) => m.mirrorCheck(opts)),
    // the human-controlled player (null when none)
    user() {
      const w = app.currentWorld();
      const p = w && w.userPlayer;
      if (!p) return null;
      return {
        slot: p.slot, pos: p.pos, team: p.team, id: p.id, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100,
        vx: Math.round(p.vx * 100) / 100, vy: Math.round(p.vy * 100) / 100, facing: p.facing, state: p.state, anim: p.anim.state,
        hasBall: p.hasBall, active: !!w.userActive, down: p.isDown(w.time),
      };
    },
  };
  Object.defineProperty(g, "errors", { get: () => [...(app.currentWorld() ? app.currentWorld().errors : []), ...app.errors, ...errorLog] });
  globalThis.__game = g;
  return g;
}
