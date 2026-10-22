// Tiny event bus. world/physics emit; anim, fx, audio and ui subscribe.
// Each World owns a bus (headless simulations get their own silent one), and the live game's
// world (and the title-screen attract world) use the shared `bus` exported here.
//
// Listeners are called as fn(payload, type, world): the sim always emits through world.emit(), so
// the third argument is the World that emitted (read world.time / world.players from it; never
// write sim state from a listener). bus.on('*', fn) sees every event. A listener that throws is
// isolated: the error is logged once (console.error + reportError → __game.errors) and the
// remaining listeners and the sim step carry on.
//
// Event contract (payloads). Positions are in yards (world units); players are Player objects.
//   flow:     kickoff {receiver, kicker, returner}   playCall {offense, defense, down, toGo, los, fourth, human}
//             presnap {off, def}   snap {qb}   possession {team}   firstDown {los}   turnover {kind}
//             whistle {result}   quarterEnd {q}   halftime {}   secondHalf {}   overtime {}
//             gameOver {winner, score}   scoreChange {score, team, pts, why}
//   per step: formationStep {} (PRE_SNAP, after players move to their spots)
//             liveStep {} (LIVE, after contact + boundaries resolved while the play is still live)
//   ball:     handoff {from, to, pitch?}   fake {qb}   scramble {qb}   throwStart {qb, target} (windup)
//             throw {qb, target, ball}   catch {player, contested?, kick?}   drop {player}
//             deflect {player, swat}   incomplete {x, y, why, target}   interception {player}
//             fumble {carrier, tackler}   fumbleDive {player} (a player falls on a loose ball)
//   kicks:    kickSet {kind, holder, kicker} (snap reached the holder)   kick {kind:'fg', distance, kicker}
//             punt {distance, kicker}   pat {good, team, kicker}   fieldGoal {good, distance}
//   contact:  block {blocker, defender}   disengage {defender, blockers}   pancake {blocker, defender}
//             tackleAttempt {tackler, carrier}   tackle {tackler, carrier, power}
//             brokenTackle {tackler, carrier}   juke {player}   stiffArm {player}   dive {player}
//             diveEnd {player} (dive window over: diver is on the turf)   sack {qb, tackler}
//   scoring:  touchdown {team, scorer, defensive}   safety {team}   outOfBounds {player}
//   misc:     target {idx}   switch {player}   bigPlay {player, yards}   slowmo {on}
//   [football round 2 — appended wiring; full notes at the top of world.js]
//   kicks:    kickoff {receiver, kicker, returner, kicking, free, spot}   kick {kind:'kickoff'|'onside'|'fg', kicker, distance}
//             onside {team, kicker}   onsideRecovered {team, success, player}   kickBounce {x, y}
//             return {player, kind:'kickoff'|'punt', x, y}   fairCatch {player, stage:'signal'|'catch'}
//             touchback {team, kind, player, kneel}   puntDowned {player, x}   scoop {player}
//   tries:    patChoice {team, choice:'kick'|'two'}   twoPoint {team, good, scorer?, defensive?}
//   also:     catch {player, kick:true} only for a touchback kneel (returns send catch {player, ret});
//             tackle {..., progress:true} = forward-progress whistle; touchdown {..., returnKind}

// Errors from listeners, data fallbacks etc. (surfaced through window.__game.errors).
export const errorLog = [];
const seen = new Set();
export function reportError(where, e) {
  const msg = `${where}: ${String((e && e.stack) || e).slice(0, 300)}`;
  const key = `${where}|${String((e && e.message) || e).slice(0, 80)}`;
  if (seen.has(key)) return;
  seen.add(key);
  if (errorLog.length < 30) errorLog.push(msg);
  try { console.error(msg); } catch (_) {}
}

export function createBus() {
  const map = new Map();
  const call = (list, payload, type, src) => {
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](payload, type, src);
      } catch (e) {
        reportError(`bus listener for "${type}"`, e);
      }
    }
  };
  const bus = {
    on(type, fn) {
      let list = map.get(type);
      if (!list) map.set(type, (list = []));
      list.push(fn);
      return () => bus.off(type, fn);
    },
    off(type, fn) {
      const list = map.get(type);
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit(type, payload, src) {
      const list = map.get(type);
      if (list) call(list, payload, type, src);
      const any = map.get("*");
      if (any) call(any, payload, type, src);
    },
    clear() {
      map.clear();
    },
  };
  return bus;
}

// The live game's bus (anim/fx/audio/ui listen here).
export const bus = createBus();

// A bus that drops everything (headless simulation, attract mode without fx).
export const silentBus = { on: () => () => {}, off() {}, emit() {}, clear() {} };

// Shared empty payload for the per-step events (no allocation per step).
export const NO_PAYLOAD = Object.freeze({});
