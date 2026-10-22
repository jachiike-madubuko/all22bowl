// How many people play ALL-22 BOWL, and how far they get: Vercel Web Analytics custom events (cookieless), sent the
// way the builder sends its challenge events. Events sent before /_vercel/insights/script.js loads wait in its queue;
// if the script is blocked, nothing is sent and play carries on as normal. Two properties at most per event.
//   BOWL Game Started   {mode}          every kickoff: "BOWL exhibition" | "BOWL draft" | "BOWL gym challenge"
//   BOWL Game Finished  {mode, result}  the final whistle (a game quit early doesn't count): "win" | "loss" | "tie"
//   First Win           {game, vs}      a gym's first badge, or the Champion for the Hall of Fame (vs = the gym key or
//                                       "champion")
// Outside Kanto the mode ends with the region (regions.js tag: "BOWL gym challenge · Johto") and vs starts with it
// ("johto/violet"); Kanto sends the original values.
// The game's name leads the start and finish events, so the dashboard's event list shows BOWL apart from the other game
const NAMES = { "Game Started": "BOWL Game Started", "Game Finished": "BOWL Game Finished" };
export function track(name, data) {
  try {
    window.va = window.va || ((...args) => (window.vaq = window.vaq || []).push(args));
    window.va("event", { name: NAMES[name] || name, data });
  } catch (_) { /* analytics never gets in the way of play */ }
}
