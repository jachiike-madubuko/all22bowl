// The Patch Notes dot: every Patch Notes link (a[data-notes-link]: the footers, the games page's header) shows a dot
// while there's a note this browser hasn't seen, that is while NOTES_LATEST is later than its last visit to
// /patch-notes (patch-notes.js keeps that time in localStorage as all22-notes-seen) or it has never been there. It
// rides along in this file because every page with a script and a Patch Notes link already loads it, so the dot costs
// no request of its own (the info pages and the Scouting Guide run no scripts of their own: no dot there).
// To publish a note: 1. add it at the top of patch-notes.html, 2. set NOTES_LATEST to the time it goes live (when you
// push it, or a few minutes after).
(() => {
  "use strict";
  const NOTES_LATEST = "2026-10-15T23:40:00-04:00"; // the newest patch note, as it went live (US Eastern)
  const SEEN = "all22-notes-seen";
  function mark() {
    let seen = null;
    try {
      seen = Number(localStorage.getItem(SEEN)) || 0;
    } catch (_) { /* storage blocked: the visit can't be remembered, so no dot */ }
    const fresh = seen !== null && seen < Date.parse(NOTES_LATEST);
    for (const a of document.querySelectorAll("a[data-notes-link]")) {
      a.classList.toggle("notes-new", fresh);
      if (fresh) a.setAttribute("aria-label", `${a.textContent.trim()} (new)`);
      else a.removeAttribute("aria-label");
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mark, { once: true });
  else mark();
  // back from the notes (a page restored from the back-forward cache), or the notes opened in another tab
  addEventListener("pageshow", (e) => { if (e.persisted) mark(); });
  addEventListener("storage", (e) => { if (e.key === SEEN || e.key === null) mark(); });
})();

// Cloud saves: what the site keeps in this browser's storage (the builder's lineups and settings, My teams,
// challenge stats, ALL-22 BOWL and PRO progress and settings, Fantasy Draft seats) follows a signed-in player to
// their other devices. Loaded first on every page that writes those keys, it notes when each one changes here (it
// wraps localStorage.setItem / removeItem for the synced keys only; the pages' own save code stays as it is),
// pulls the account's copy when the page loads, and pushes changes a couple of seconds after they happen and when
// the page is hidden.
// Joining two devices' copies: progress merges (Gym Challenge and Pokémon League: every win counts and the furthest
// run is kept; challenge stats: the best of each; My teams and Fantasy seats: both lists), anything else goes to the
// newest change, and a team that loses that way (a builder lineup, BOWL's drafted team or a draft's picks) is kept in
// My teams first, as "From this device". The device remembers which account last synced it: the first sign-in on a
// device brings its progress into the account (what was there before cloud saves counts as old, so the account's
// copy wins where it has one), and signing in with a different account loads that account's saves instead of mixing
// them (a shared family computer): what changed here since the last account's copy is put aside for that account
// and joins its saves when it signs in here again (if it can't be put aside, the storage being full, nothing changes
// on the device and the account page says why). If the last account was deleted meanwhile, the device's progress
// joins the new account's instead, except anything that works like a password (a Fantasy Draft seat's token), which
// never goes from one account to another: it's put aside too. Nothing on the device is ever just thrown away.
// Pages hear about saves that came in with an "all22:saves" event ({ keys, replaced, kept }); a page that loads its
// saves once and keeps them (the games, /play: <script src="saves.js" data-reload>) reloads instead, if nobody has
// touched it yet (or another account's saves replaced its own).
(() => {
  "use strict";
  // ---------- The rollout switch ----------
  // The new account features (cloud saves, My teams, the builder's sign-in through /account, the games' account links)
  // are on for everyone (ACCOUNTS_ON, stage 2 of the rollout). One browser can still opt out, as an escape hatch:
  // /account?beta=0 turns them off there, and /account?beta=1 back on. Pages read window.ALL22_ACCOUNTS. The server
  // side (accounts, the age question, saves) runs either way.
  const ACCOUNTS_ON = true;
  const BETA_KEY = "all22-accounts-beta"; // this browser's own choice: "1" on, "0" off (none: ACCOUNTS_ON)
  let choice = null;
  try {
    if (/^\/account(\.html)?$/.test(location.pathname)) {
      const asked = new URLSearchParams(location.search).get("beta");
      if (asked === "1" || asked === "0") localStorage.setItem(BETA_KEY, asked);
    }
    choice = localStorage.getItem(BETA_KEY);
  } catch (_) { /* storage blocked: as everyone else */ }
  window.ALL22_ACCOUNTS = choice === "0" ? false : choice === "1" ? true : ACCOUNTS_ON;
  if (!window.ALL22_ACCOUNTS) return; // off: nothing wrapped, nothing synced

  let store = null;
  try { store = window.localStorage; } catch (_) { /* storage blocked: nothing to sync */ }
  if (!store || typeof Storage === "undefined") return;
  const reloadPage = Boolean(document.currentScript && "reload" in document.currentScript.dataset);

  // The keys that sync (api/_lib/saves.mjs has the same list). Volume, mute and the challenges' runs stay here. The
  // games' regions are named one by one (a new region is added here and there).
  const KEYS = [
    /^pokemon-all22-lineup-(gen[2-9]-|all-)?(legends-)?v1$/, // the builder's lineup for each pool
    /^pokemon-all22-(style|gen|formation|legends|shiny)-v1$/, // the builder's settings (shiny: the lineups' players shown not shiny)
    /^pokemon-all22-teams-([1-9]|all)-v1$/, // My teams, per generation
    /^pokemon-all22-(draft|151)-stats-v1$/, // the challenges' lifetime stats
    /^all22bowl-(gyms|draft-run|drafted)(-(johto|hoenn|sinnoh))?-v1$/, // ALL-22 BOWL: Gym Challenge, draft, drafted team (per region)
    /^all22bowl-(settings|weather)$/,
    /^all22pro-league(-(johto|hoenn|sinnoh))?-v1$/, // ALL-22 PRO: the Pokémon League (per region)
    /^all22pro-settings-v1$/,
    /^all22(bowl|pro)-controls-v1$/, // both games' controls (Settings → CONTROLS: the keys and buttons the player chose)
    /^all22-games-region$/,
    /^fd-(seats|team)-v1$/, // Fantasy Draft: your seats in leagues, your last team name
  ];
  const savable = (k) => typeof k === "string" && k.length <= 64 && KEYS.some((re) => re.test(k));
  const MAX_VALUE = 64 * 1024; // the most a value can be to go to the account (the server's limit), in bytes
  // A string's size in UTF-8, counted as the server counts it.
  function byteLength(s) {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
        n += 4;
        i++;
      } else n += 3;
    }
    return n;
  }

  // ---------- Joining two copies ----------
  const parse = (s) => {
    try { return JSON.parse(s); } catch (_) { return null; }
  };
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
  const int = (v) => (Number.isFinite(v) ? Math.floor(v) : 0);
  const maxRecord = (a, b) => ({ w: Math.max(int(a && a.w), int(b && b.w)), l: Math.max(int(a && a.l), int(b && b.l)), t: Math.max(int(a && a.t), int(b && b.t)) });
  const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
  const unionBy = (list, id) => {
    const seen = new Map();
    for (const x of list) if (x && typeof x === "object" && !seen.has(id(x))) seen.set(id(x), x);
    return [...seen.values()];
  };
  // Challenge stats: the best of each (counts aren't added up: a run counted on both devices counts once).
  const stats = (x, y) => {
    const out = { ...x };
    for (const f of ["runs", "perfect", "bestScore", "bestWins"]) out[f] = Math.max(int(x[f]), int(y[f]));
    return out;
  };
  // ALL-22 BOWL's Gym Challenge (game/modes.js GymStore): the later run (more runs started) is the one in play, with
  // its badges, Champion and tries; within the same run every badge counts. The record and titles never go down,
  // and both Halls of Fame join.
  const gyms = (x, y) => {
    if (x.v !== 1) return y;
    if (y.v !== 1) return x;
    const rx = int(x.runs) || 1;
    const ry = int(y.runs) || 1;
    const [cur, other] = rx >= ry ? [x, y] : [y, x];
    const out = { ...cur };
    if (rx === ry) {
      out.badges = { ...obj(other.badges), ...obj(cur.badges) };
      out.champion = cur.champion || other.champion || null;
      const tries = { ...obj(other.attempts) };
      for (const [k, n] of Object.entries(obj(cur.attempts) || {})) tries[k] = Math.max(int(n), int(tries[k]));
      out.attempts = tries;
    }
    out.record = maxRecord(x.record, y.record);
    out.titles = Math.max(int(x.titles), int(y.titles));
    out.runs = Math.max(rx, ry);
    out.hall = unionBy([...(x.hall || []), ...(y.hall || [])], (h) => JSON.stringify([h.run, h.date, h.name, h.score]))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || int(b.run) - int(a.run)).slice(0, 12);
    return out;
  };
  // ALL-22 PRO's Pokémon League (allpro/league.js): the later season is the one in play; within the same season
  // every team beaten counts. The career record, the Hall of Fame (and its unlock), the Legends win and the
  // history join.
  const league = (x, y) => {
    if (!Array.isArray(x.beaten)) return y;
    if (!Array.isArray(y.beaten)) return x;
    const sx = int(x.season) || 1;
    const sy = int(y.season) || 1;
    const [cur, other] = sx >= sy ? [x, y] : [y, x];
    const out = { ...cur };
    if (sx === sy) {
      out.beaten = union(cur.beaten, other.beaten);
      out.seen = union(cur.seen, other.seen);
      out.record = maxRecord(cur.record, other.record);
      out.hofDone = Boolean(cur.hofDone || other.hofDone);
      if (union(other.beaten).length > union(cur.beaten).length) out.at = other.at;
    }
    out.hof = Boolean(x.hof || y.hof);
    out.bonus = Boolean(x.bonus || y.bonus);
    out.career = maxRecord(x.career, y.career);
    out.hofList = unionBy([...(x.hofList || []), ...(y.hofList || [])], (h) => String(h.d)).sort((a, b) => int(a.d) - int(b.d)).slice(-12);
    out.history = unionBy([...(x.history || []), ...(y.history || [])], (h) => `${h.k}|${h.d}`).sort((a, b) => int(a.d) - int(b.d)).slice(-60);
    // the Hall of Fame ceremony is still due only if this season's Champion isn't in it yet
    const due = cur.hofPending || (sx === sy && other.hofPending);
    out.hofPending = Boolean(due && !out.hofList.some((h) => int(h.season) === int(out.season)));
    return out;
  };
  // My teams (app.js): both lists, the latest edit of each team; a deleted team stays deleted.
  const teams = (x, y) => {
    const gone = { ...obj(x.gone) };
    for (const [id, t] of Object.entries(obj(y.gone) || {})) gone[id] = Math.max(int(t), int(gone[id]));
    const cutoff = Date.now() - 120 * 86400000;
    for (const [id, t] of Object.entries(gone)) if (t < cutoff) delete gone[id];
    const byId = new Map();
    for (const t of [...(x.teams || []), ...(y.teams || [])]) {
      if (!t || typeof t.id !== "string") continue;
      const had = byId.get(t.id);
      if (!had || int(t.t) > int(had.t)) byId.set(t.id, t);
    }
    const list = [...byId.values()].filter((t) => !(int(gone[t.id]) >= int(t.t))).sort((a, b) => int(a.c) - int(b.c));
    return { v: 1, teams: list, gone };
  };
  // The builder's shiny choices (app.js: { v, plain: { pool: { t, ids } } }, the players each pool's lineup shows not
  // shiny): both lists of pools, the newer choice for a pool in both.
  const shinyChoices = (x, y) => {
    const plain = { ...obj(y.plain) };
    for (const [pool, e] of Object.entries(obj(x.plain) || {})) if (obj(e) && (!obj(plain[pool]) || int(e.t) > int(plain[pool].t))) plain[pool] = e;
    return { v: 1, plain };
  };
  // Fantasy Draft seats ({ code: { seat, token, at } }): both lists, the newer seat for a league in both.
  const seats = (x, y) => {
    const out = { ...y, ...x };
    for (const [c, s] of Object.entries(y)) if (s && x[c] && int(s.at) > int(x[c].at)) out[c] = s;
    return out;
  };
  // A merge takes this device's stored string and the account's and returns the string to keep (one of the two,
  // unchanged, when there's nothing to join).
  const joining = (fn) => (a, b) => {
    const x = obj(parse(a));
    const y = obj(parse(b));
    if (!x) return b;
    if (!y) return a;
    const out = JSON.stringify(fn(x, y));
    return out === JSON.stringify(y) ? b : out === JSON.stringify(x) ? a : out;
  };
  // always: also joined with the account's last copy before every push, because the game keeps its progress in
  // memory from when the page loaded and may write it back over what came in since.
  const KINDS = [
    [/^pokemon-all22-(draft|151)-stats-v1$/, { merge: joining(stats), always: true }],
    [/^all22bowl-gyms(-(johto|hoenn|sinnoh))?-v1$/, { merge: joining(gyms), always: true }],
    [/^all22pro-league(-(johto|hoenn|sinnoh))?-v1$/, { merge: joining(league), always: true }],
    [/^pokemon-all22-teams-([1-9]|all)-v1$/, { merge: joining(teams) }],
    [/^fd-seats-v1$/, { merge: joining(seats) }],
    [/^pokemon-all22-shiny-v1$/, { merge: joining(shinyChoices) }],
  ];
  const NEWEST = {};
  const kindOf = (k) => (KINDS.find(([re]) => re.test(k)) || [null, NEWEST])[1];
  // Works like a password: a Fantasy Draft seat's token lets whoever holds it play that seat. These follow their own
  // account only, never joining another one's saves (not even when the device's last account was deleted).
  const PRIVATE = [/^fd-seats-v1$/];
  const personal = (k) => PRIVATE.some((re) => re.test(k));

  // ---------- What this device knows ----------
  // all22-sync-v1: { o: the account that last synced this device, v: its saves version then, k: { key: [changed
  // here, the account's copy's time, hash of that copy, hash of a copy the account refused (too big or not
  // allowed: not sent again until it changes)] }, from: the account that synced it before it was deleted }. all22-sync-base-v1: the account's last copy of each progress
  // key. all22-sync-stash-v1: { account: { at, k: { key: { v, t } } } }, what changed here that belongs to another
  // account than the one this device syncs with now (see stashFor). None of them syncs.
  const META = "all22-sync-v1";
  const BASE = "all22-sync-base-v1";
  const STASH = "all22-sync-stash-v1";
  const STASH_MAX = 6; // accounts with something put aside (the oldest goes first)
  const S = Storage.prototype;
  const rawGet = S.getItem;
  const rawSet = S.setItem;
  const rawRemove = S.removeItem;
  const rawKey = S.key;
  const get = (k) => rawGet.call(store, k);
  const put = (k, v) => {
    try {
      if (v === null) rawRemove.call(store, k);
      else rawSet.call(store, k, v);
      return true;
    } catch (_) {
      return false; // storage full
    }
  };
  const readJson = (k, fallback) => obj(parse(get(k))) || fallback;
  function meta() {
    const m = readJson(META, null);
    return m && typeof m.k === "object" ? m : { o: "", v: 0, k: {} };
  }
  const saveMeta = (m) => put(META, JSON.stringify(m));
  const base = () => readJson(BASE, {});
  const saveBase = (b) => put(BASE, JSON.stringify(b));
  function hash(s) {
    if (s === null || s === undefined) return 0;
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0 || 1;
  }
  function localKeys() {
    const out = [];
    for (let i = 0; i < store.length; i++) {
      const k = rawKey.call(store, i);
      if (savable(k)) out.push(k);
    }
    return out;
  }
  const dirty = (e) => e[0] > e[1];

  // ---------- Noticing changes ----------
  function changed(k) {
    const m = meta();
    const e = m.k[k] || [0, 0, 0];
    e[0] = Math.max(Date.now(), e[0] + 1, e[1] + 1); // newer than the copy it was made from, whatever the clock says
    m.k[k] = e;
    saveMeta(m);
    soon();
  }
  S.setItem = function setItem(k, v) {
    if (this !== store || !savable(k)) return rawSet.call(this, k, v);
    const before = rawGet.call(this, k);
    rawSet.call(this, k, v);
    if (before !== String(v)) changed(k);
  };
  S.removeItem = function removeItem(k) {
    if (this !== store || !savable(k)) return rawRemove.call(this, k);
    const before = rawGet.call(this, k);
    rawRemove.call(this, k);
    if (before !== null) changed(k);
  };
  // Changes made where this file didn't run (another page, or before it existed): anything that differs from the
  // account's last copy, or that was never synced, counts as changed. Never-synced values count as old (time 1),
  // so the account's copy wins where it has one (and a team that loses is kept in My teams).
  function scan() {
    const m = meta();
    const here = new Set(localKeys());
    for (const k of here) {
      const e = m.k[k];
      if (!e) m.k[k] = [1, 0, hash(get(k))];
      else if (!dirty(e) && e[2] !== hash(get(k))) e[0] = Math.max(Date.now(), e[1] + 1);
    }
    for (const [k, e] of Object.entries(m.k)) {
      if (!here.has(k) && !dirty(e) && e[2] !== 0) e[0] = Math.max(Date.now(), e[1] + 1); // removed
    }
    saveMeta(m);
  }

  // ---------- Keeping teams ----------
  // A team this device is about to lose to a newer copy from the account (the builder's lineup for a pool, ALL-22
  // BOWL's drafted team, the picks of a BOWL draft in progress) goes into My teams first, as "From this device" (in
  // the pool's teams for a lineup, the region's generation for BOWL), unless My teams has that lineup already.
  const FORMATION = "pokemon-all22-formation-v1";
  const REGION_GEN = { "": "1", johto: "2", hoenn: "3", sinnoh: "4" };
  let formationHere = null; // the builder's formation here before the account's copy came in
  let kept = []; // the teams kept this time (for the pages to say so)
  function spots(o) {
    const out = {};
    for (const [spot, id] of Object.entries(obj(o) || {})) if (/^[A-Z]{1,3}\d?$/.test(spot) && Number.isInteger(id) && id > 0) out[spot] = id;
    return Object.keys(out).length ? out : null;
  }
  const schemeOf = (s, k) => ({ def: s && s.def === "43" ? "43" : "34", off: s && s.off === "slot" ? "slot" : "fb", k });
  function teamOf(k, value) {
    const o = obj(parse(value));
    if (!o) return null;
    let m = /^pokemon-all22-lineup-(gen([2-9])-|(all)-)?(legends-)?v1$/.exec(k);
    if (m) {
      const f = obj(parse(formationHere));
      const lineup = spots(o);
      return lineup && { gen: m[2] || m[3] || "1", lineup, scheme: schemeOf(f, Boolean(f && f.k === true)), legends: Boolean(m[4]), name: "From this device" };
    }
    m = /^all22bowl-(drafted|draft-run)(-(johto|hoenn|sinnoh))?-v1$/.exec(k);
    if (m) {
      const lineup = spots(m[1] === "drafted" ? o.lineup : o.picks);
      return lineup && { gen: REGION_GEN[m[3] || ""], lineup, scheme: schemeOf(obj(o.scheme), true), legends: true, name: m[1] === "drafted" ? "From this device (BOWL)" : "From this device (BOWL draft)" };
    }
    return null;
  }
  const sameLineup = (a, b) => {
    const x = obj(a) || {};
    const y = obj(b) || {};
    return [...Object.keys(x), ...Object.keys(y)].every((s) => (x[s] || 0) === (y[s] || 0));
  };
  // k's value here (`value`) is losing to `winner`: keep its team in My teams (marked changed, so it syncs).
  function keepTeam(k, value, winner, m, keys) {
    const team = teamOf(k, value);
    if (!team) return;
    const other = teamOf(k, winner);
    if (other && sameLineup(other.lineup, team.lineup)) return;
    const tk = `pokemon-all22-teams-${team.gen}-v1`;
    const cur = readJson(tk, {});
    const list = Array.isArray(cur.teams) ? cur.teams.filter((t) => obj(t)) : [];
    if (list.some((t) => sameLineup(t.lineup, team.lineup))) return;
    const names = new Set(list.map((t) => String(t.name).toLowerCase()));
    let name = team.name;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${team.name} ${n}`;
    const now = Date.now();
    const id = `${Math.random().toString(36).slice(2, 9)}${now.toString(36)}`;
    const next = { v: 1, teams: [...list, { id, name, lineup: team.lineup, scheme: team.scheme, legends: team.legends, c: now, t: now }], gone: obj(cur.gone) || {} };
    if (!put(tk, JSON.stringify(next))) return;
    keys.push(tk);
    kept.push(name);
    const e = m.k[tk] || (m.k[tk] = [0, 0, 0]);
    e[0] = Math.max(now, e[0] + 1, e[1] + 1);
  }

  // ---------- Another account's saves ----------
  // Puts aside, for `owner` (the account this device's things belong to), what changed here since its copy (played
  // signed out, say; only the keys `which` picks), before another account's saves take their place. False when it
  // can't be kept (storage full).
  function stashFor(owner, m, which = () => true) {
    const changes = {};
    for (const [k, e] of Object.entries(m.k)) if (savable(k) && which(k) && dirty(e)) changes[k] = { v: get(k), t: e[0] };
    if (!Object.keys(changes).length) return true;
    const all = readJson(STASH, {});
    const had = obj(all[owner]) && obj(all[owner].k) ? all[owner].k : {};
    all[owner] = { at: Date.now(), k: { ...had, ...changes } };
    for (const o of Object.keys(all).sort((x, y) => int(all[y] && all[y].at) - int(all[x] && all[x].at)).slice(STASH_MAX)) delete all[o];
    return put(STASH, JSON.stringify(all));
  }
  // What was put aside for this account joins its saves, now that it's signed in here again: progress joins, anything
  // else goes to the newer copy (and a team that loses is kept in My teams).
  function fold(aid, m, keys) {
    const all = readJson(STASH, {});
    const mine = obj(all[aid]) && obj(all[aid].k);
    if (!mine) return;
    for (const [k, st] of Object.entries(mine)) {
      if (!savable(k) || !obj(st)) continue;
      const v = typeof st.v === "string" ? st.v : null;
      const cur = get(k);
      if (v === cur) continue;
      const e = m.k[k] || (m.k[k] = [cur === null ? 0 : 1, 0, hash(cur)]);
      const kind = kindOf(k);
      if (kind.merge) {
        if (v === null) continue; // progress isn't taken away
        const joined = cur === null ? v : kind.merge(v, cur);
        if (joined !== cur && put(k, joined)) {
          keys.push(k);
          e[0] = Math.max(Date.now(), e[0] + 1, e[1] + 1);
        }
      } else if (int(st.t) > Math.max(e[0], e[1])) {
        if (cur !== null && dirty(e)) keepTeam(k, cur, v, m, keys); // this device's own unsent copy loses
        if (put(k, v)) {
          keys.push(k);
          e[0] = Math.max(int(st.t), e[1] + 1);
        }
      } else {
        keepTeam(k, v, cur, m, keys);
      }
    }
    delete all[aid];
    put(STASH, Object.keys(all).length ? JSON.stringify(all) : null);
  }
  // A device whose account was deleted (here, or on another device): what's on it counts as never synced, like a
  // device's first sign-in, except that what changed since that account's copy keeps its time, and it remembers
  // whose it was (from), so what works like a password isn't handed to the next account.
  function unowned(m) {
    const out = { o: "", v: 0, k: {}, from: m.o || m.from || "" };
    for (const k of localKeys()) {
      const e = m.k[k];
      out.k[k] = [e && dirty(e) ? e[0] : 1, 0, hash(get(k))];
    }
    return out;
  }

  // ---------- The account ----------
  const signedIn = () => document.cookie.split(";").some((c) => c.trim() === "a22in=1");
  let account = null; // the account this page synced with (null: not yet, or signed out)
  let state = "off"; // off | syncing | synced | age | error | full
  let lastPull = 0;
  const setState = (s) => {
    if (s === state) return;
    state = s;
    window.dispatchEvent(new CustomEvent("all22:sync-state", { detail: { state } }));
  };
  async function call(action, body, keepalive = false) {
    try {
      const res = await fetch(`/api/app?a=${action}`, body
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive }
        : { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        // signed out (here or elsewhere): stop until the next sign-in
        account = null;
        document.cookie = "a22in=; Path=/; Max-Age=0; SameSite=Lax; Secure";
        setState("off");
        return null;
      }
      if (res.status === 403 && data.age === false) {
        setState("age"); // the account page asks the age question first
        return null;
      }
      if (res.status === 409 && data.aid) {
        account = null; // another tab signed in as someone else: read it all again
        want.pull = true;
        return null;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (_) {
      setState("error");
      return null;
    }
  }

  // Applies the account's copy of a key here.
  function take(k, sv, m, b, keys) {
    if (get(k) !== sv.v && put(k, sv.v)) keys.push(k);
    m.k[k] = [sv.t, sv.t, hash(sv.v)];
    if (kindOf(k).merge) b[k] = sv.v;
  }
  // The account's copy of a key against this device's: keep, take or join. Returns whether ours needs sending.
  function settle(k, sv, m, b, keys) {
    const local = get(k);
    const e = m.k[k] || (m.k[k] = [local === null ? 0 : 1, 0, hash(local)]);
    if (!sv) return dirty(e);
    if (sv.t === e[1]) return dirty(e); // the account's copy hasn't changed since this device last synced
    if (!dirty(e) || local === sv.v) {
      take(k, sv, m, b, keys);
      return false;
    }
    const kind = kindOf(k);
    if (kind.merge) {
      const joined = local === null ? sv.v : sv.v === null ? local : kind.merge(local, sv.v);
      b[k] = sv.v;
      if (joined === sv.v) {
        take(k, sv, m, b, keys);
        return false;
      }
      if (joined !== local && put(k, joined)) keys.push(k);
      m.k[k] = [Math.max(Date.now(), sv.t + 1), sv.t, hash(sv.v)];
      return true;
    }
    if (e[0] > sv.t) return true; // ours is newer
    if (local !== null) keepTeam(k, local, sv.v, m, keys); // a team that loses is kept in My teams first
    take(k, sv, m, b, keys);
    return false;
  }

  function announce(keys, replaced) {
    const teamsKept = kept;
    kept = [];
    if (!keys.length) return;
    if (reloadPage && (!touched || replaced)) {
      let recent = false;
      try {
        recent = Date.now() - Number(sessionStorage.getItem("all22-sync-reload") || 0) < 15000;
        if (!recent) sessionStorage.setItem("all22-sync-reload", String(Date.now()));
      } catch (_) { /* no session storage: reload anyway */ }
      if (!recent) {
        location.reload();
        return;
      }
    }
    window.dispatchEvent(new CustomEvent("all22:saves", { detail: { keys, replaced, kept: teamsKept } }));
  }

  async function pull() {
    if (!signedIn()) return setState("off");
    setState("syncing");
    scan();
    const m0 = meta();
    const res = await call(`saves${m0.o ? `&o=${encodeURIComponent(m0.o)}&v=${m0.v}` : ""}`);
    if (!res) return;
    if (res.age === false) return setState("age"); // the account page asks the age question first
    lastPull = Date.now();
    let m = meta();
    let b = base();
    const keys = [];
    let replaced = false;
    formationHere = get(FORMATION);
    if (res.same && m.o === res.aid) {
      account = res.aid;
    } else {
      if (m.o && m.o !== res.aid && !res.ownerGone) {
        // Another account's device: that account's saves replace this one's, nothing mixes (what changed here since
        // the last account's copy is put aside for it first; if that can't be kept, nothing changes here).
        if (!stashFor(m.o, m)) return stuck();
        const fresh = { o: res.aid, v: res.v, k: {} };
        const nb = {};
        for (const k of localKeys()) if (!res.items[k] || res.items[k].v === null) if (put(k, null)) keys.push(k);
        for (const [k, sv] of Object.entries(res.items)) if (savable(k)) take(k, sv, fresh, nb, keys);
        m = fresh;
        b = nb;
        replaced = true;
      } else {
        // This account's device, or one that never synced, or one whose last account was deleted: its progress joins
        // the account's. What works like a password and belonged to that deleted account is put aside for it instead
        // (if that can't be kept, nothing changes here), and this account's own copy comes in.
        if (m.o && m.o !== res.aid) {
          m = unowned(m);
          b = {};
        }
        if (m.from && m.from !== res.aid) {
          if (!stashFor(m.from, m, personal)) return stuck();
          for (const k of localKeys()) {
            if (!personal(k)) continue;
            const sv = res.items[k];
            if (sv) take(k, sv, m, b, keys);
            else {
              if (put(k, null)) keys.push(k);
              delete m.k[k];
            }
          }
          replaced = true;
        }
        for (const k of new Set([...Object.keys(res.items), ...localKeys(), ...Object.keys(m.k)])) {
          if (savable(k)) settle(k, res.items[k], m, b, keys);
        }
      }
      fold(res.aid, m, keys); // anything put aside for this account
      delete m.from;
      m.o = res.aid;
      m.v = res.v;
      saveMeta(m);
      saveBase(b);
      account = res.aid;
    }
    if (Object.values(meta().k).some(dirty)) want.push = true;
    else setState("synced");
    announce(keys, replaced);
  }

  // What's on this device couldn't be put aside for the account it belongs to (the browser's storage is full): it
  // stays exactly as it is, nothing of this account's comes in or goes out on this page, and the account page says
  // why (state "full"). Reloading tries again.
  let blocked = false;
  function stuck() {
    blocked = true;
    account = null;
    setState("full");
  }

  const full = new Map(); // keys the account had no room for, and the copy that didn't fit (tried again next page)
  async function push(keepalive = false) {
    if (!account || !signedIn()) return;
    const m = meta();
    if (m.o !== account) {
      want.pull = true; // another tab switched accounts: catch up first
      return;
    }
    const b = base();
    const items = [];
    let bytes = 0;
    let skipped = false;
    for (const [k, e] of Object.entries(m.k)) {
      if (!dirty(e) || !savable(k)) continue;
      let v = get(k);
      const kind = kindOf(k);
      if (kind.always && v !== null && typeof b[k] === "string") {
        const joined = kind.merge(v, b[k]);
        if (joined !== v && put(k, joined)) v = joined;
      }
      const h = hash(v);
      if (e[3] === h || full.get(k) === h) continue; // refused as it is: it stays on this device
      const size = v === null ? 0 : byteLength(v);
      if (size > MAX_VALUE) {
        e[3] = h; // too big for the account: never sent
        skipped = true;
        continue;
      }
      bytes += size + 120;
      if (keepalive && bytes > 60000) break; // a page on its way out can send 64 KB at most
      items.push({ k, v, t: e[0], ...(kind.merge ? { b: e[1] } : {}) });
      if (items.length >= 80) {
        want.push = true; // the rest next
        break;
      }
    }
    if (skipped) saveMeta(m);
    if (!items.length) {
      setState("synced");
      return;
    }
    setState("syncing");
    const res = await call("saves", { aid: account, v: m.v, items }, keepalive);
    if (!res) return;
    const m2 = meta();
    const b2 = base();
    const keys = [];
    const bad = new Set(res.bad || []);
    const noRoom = new Set(res.full || []);
    let again = false;
    formationHere = get(FORMATION);
    for (const it of items) {
      const e = m2.k[it.k];
      if (!e) continue;
      if (bad.has(it.k)) {
        e[3] = hash(it.v); // refused as it is: not sent again until it changes
        continue;
      }
      if (noRoom.has(it.k)) {
        full.set(it.k, hash(it.v));
        continue;
      }
      const keptCopy = res.items[it.k];
      if (keptCopy) {
        if (settle(it.k, keptCopy, m2, b2, keys)) again = true;
        continue;
      }
      e[1] = it.t; // the account has it now (still changed here if it changed again meanwhile)
      e[2] = hash(it.v);
      if (kindOf(it.k).merge) b2[it.k] = it.v;
    }
    if (res.stale) want.pull = true;
    else m2.v = res.v;
    saveMeta(m2);
    saveBase(b2);
    if (again) want.push = true; // joined with what came back: send the joined copy
    if (!want.push && !want.pull) setState("synced");
    announce(keys, false);
  }

  // One thing at a time: a pull, then any pushes. work() returns the run in progress (anything asked for
  // meanwhile is done in it), so every caller can wait for the same one.
  const want = { pull: false, push: false };
  let running = null;
  function work() {
    if (running) return running;
    running = (async () => {
      try {
        for (let n = 0; n < 8 && (want.pull || want.push); n++) {
          if (want.pull) {
            want.pull = false;
            await pull();
          } else {
            want.push = false;
            await push();
          }
        }
      } finally {
        running = null;
      }
    })();
    return running;
  }
  let timer = 0;
  function soon() {
    clearTimeout(timer);
    if (!signedIn() || blocked) return;
    timer = setTimeout(() => {
      want.push = true;
      if (!account) want.pull = true;
      work();
    }, 2000);
  }
  // The page is going away (or out of sight, which on a phone can be the last chance): send what's left now,
  // with a request that outlives the page.
  function flushNow() {
    clearTimeout(timer);
    if (running || !account || !signedIn()) return;
    running = push(true).finally(() => { running = null; });
  }

  // Has anyone used the page yet (a game that's still on its title screen can simply reload)?
  let touched = false;
  for (const type of ["pointerdown", "keydown"]) addEventListener(type, () => { touched = true; }, { capture: true, once: true });
  addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
    else if (signedIn() && !blocked && Date.now() - lastPull > 30000) {
      want.pull = true;
      work();
    }
  });
  // Another tab signed in with a different account and took this device's saves: catch up.
  addEventListener("storage", (e) => {
    if (e.key !== META || !account) return;
    const m = meta();
    if (m.o && m.o !== account) {
      account = null;
      if (reloadPage) location.reload();
      else announce(localKeys(), true);
    }
  });

  window.ALL22_SAVES = {
    // Reads the account's saves now (after signing in, or the age question); resolves when done.
    async sync() {
      want.pull = true;
      await work();
      return state;
    },
    // Sends anything not sent yet (before signing out).
    async flush() {
      clearTimeout(timer);
      if (!account) return;
      want.push = true;
      await work();
    },
    // After deleting the account: this device belongs to nobody, and what's on it joins the next account's saves
    // (as on a device that never synced).
    forget() {
      saveMeta(unowned(meta()));
      saveBase({});
      account = null;
      setState("off");
    },
    state: () => state,
    savable,
  };

  if (signedIn()) {
    want.pull = true;
    work();
  } else {
    scan();
  }
})();
