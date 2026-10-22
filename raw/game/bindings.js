// The player's controls: each action's keyboard keys and controller buttons, remappable in Settings → CONTROLS
// (ui-controls.js). ALL-22 BOWL is a two-button game, so its actions are the buttons, as How to Play shows them: A
// (snap · throw · juke · dive · kick) and B (next target · stiff-arm · switch · fair catch · onside), the five
// receivers, movement, pause, sound and FLIP (the play call's mirror toggle: F / R3, read by ui.js). ACTIONS' defaults
// are the game's controls as they always were; B holds the live bindings, read by input.js (and ui.js's hints, the
// receiver boxes on the field). Touch controls are fixed.
// Saved on this device at once (all22bowl-controls-v1: only what differs from the defaults); signed in, cloud saves
// sync it (saves.js, newest wins).
// Rules:
//   · Locked: Esc and the controller's START always pause; the D-pad and HOME are never bound; F-keys, Ctrl / Alt /
//     Cmd and other system keys can't be used. Menus keep their own keys and buttons (arrows / WASD, Enter, Space, J,
//     Z, Esc, Backspace, digits; the D-pad, A, B, LB / RB, START), whatever the bindings.
//   · Every action is read in the same plays, so a key or button does one thing: binding one already in use swaps
//     the two (rebind()). PAUSE, SOUND and FLIP also work in menus, so they can't take the menus' Enter or the
//     arrows; FLIP works on the play call, so it can't take its other keys either (1-9 pick a play, Tab / Page Up /
//     Page Down turn the pages).
//   · SWAP A AND B (Nintendo-style players) swaps every action on A with B, the menus' A and B too.
// Key ids: KeyboardEvent.code ("KeyW", "Space", "Digit1", "ArrowUp"), both Shift keys "Shift". Pad buttons:
// standard-mapping indices (0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 8 BACK · 10 L3 · 11 R3).
export const STORE = "all22bowl-controls-v1";
export const PAD_GLYPH = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "BACK", "START", "L3", "R3", "UP", "DOWN", "LEFT", "RIGHT", "HOME"];
const PAD_OK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11];
const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
// the menus' keys (ui.js navKeys: the arrows and WASD, Enter / Space / J / Z, Backspace, Q / E pages): PAUSE and SOUND,
// which work in menus too, keep off them
const MENU_K = ["Enter", "NumpadEnter", "Space", "KeyJ", "KeyZ", "Backspace", "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", ...ARROWS];
// the play call's own keys besides those (ui.js bindPlayKeys; 1-9 pick a play): FLIP, read there, keeps off them
const CALL_K = ["Tab", "PageUp", "PageDown"];

// [id, title, column on the CONTROLS screen]
export const GROUPS = [["move", "MOVE", 0], ["ab", "BUTTONS", 0], ["call", "PLAY CALL", 0], ["pass", "RECEIVERS", 1], ["game", "GAME", 1]];
const A = (id, label, group, keys, pad, o) => ({ id, label, group, keys, pad, ...o });
export const ACTIONS = [
  A("up", "MOVE UP", "move", ["ArrowUp", "KeyW"], [], { move: [0, -1] }),
  A("down", "MOVE DOWN", "move", ["ArrowDown", "KeyS"], [], { move: [0, 1] }),
  A("left", "MOVE LEFT", "move", ["ArrowLeft", "KeyA"], [], { move: [-1, 0] }),
  A("right", "MOVE RIGHT", "move", ["ArrowRight", "KeyD"], [], { move: [1, 0] }),
  A("a", "A", "ab", ["Space", "KeyJ", "KeyZ"], [0], { note: "SNAP · THROW · JUKE · DIVE TACKLE · KICK" }),
  A("b", "B", "ab", ["Shift", "KeyK", "KeyX"], [1], { note: "NEXT TARGET · STIFF-ARM · SWITCH · FAIR CATCH · ONSIDE" }),
  A("rec1", "RECEIVER 1", "pass", ["Digit1"], [2], { rec: 1 }),
  A("rec2", "RECEIVER 2", "pass", ["Digit2"], [3], { rec: 2 }),
  A("rec3", "RECEIVER 3", "pass", ["Digit3"], [4], { rec: 3 }),
  A("rec4", "RECEIVER 4", "pass", ["Digit4"], [5], { rec: 4 }),
  A("rec5", "RECEIVER 5", "pass", ["Digit5"], [7], { rec: 5 }),
  A("pause", "PAUSE", "game", ["KeyP"], [], { menu: true, note: "ESC AND START ALWAYS PAUSE" }),
  A("mute", "SOUND ON / OFF", "game", ["KeyM"], [], { menu: true }),
  A("flip", "FLIP PLAY", "call", ["KeyF"], [11], { menu: true, call: true, note: "RUN THE PLAY THE OTHER WAY" }),
];
export const BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));

// ---------- the live bindings: rebuilt by apply(), read on every input (no allocation) ----------
export const B = {
  kb: {}, pad: {}, // action → key codes / button indices (in effect: SWAP A AND B applied)
  swapAB: false,
  move: new Map(), // key code → [dx, dy]
  aKeys: new Set(), bKeys: new Set(), pauseKeys: new Set(), muteKeys: new Set(), flipKeys: new Set(),
  rec: new Map(), // key code → 1-5
  aPad: [], bPad: [], recPad: [], pausePad: [], mutePad: [], flipPad: [], // button indices (recPad[i] = receiver i+1's)
  active: [], // every bound button (they make the controller the device in use)
  ok: 0, back: 1, // the menus' confirm and back buttons
  custom: false,
  ver: 0,
};
let user = { k: {}, p: {}, ab: false };
const listeners = [];
export const onChange = (fn) => listeners.push(fn);
const own = (o, id) => Object.prototype.hasOwnProperty.call(o, id);
const swap = (i) => (B.swapAB && (i === 0 || i === 1) ? 1 - i : i);
const dflt = (a, dev) => (dev === "k" ? a.keys : a.move ? [] : a.pad);
const stored = (a, dev) => { const o = dev === "k" ? user.k : user.p; return own(o, a.id) ? o[a.id] : dflt(a, dev); };

export function apply() {
  B.swapAB = Boolean(user.ab);
  for (const a of ACTIONS) { B.kb[a.id] = stored(a, "k").slice(); B.pad[a.id] = a.move ? [] : stored(a, "p").map(swap); }
  B.move.clear(); B.rec.clear();
  for (const a of ACTIONS) {
    if (a.move) for (const k of B.kb[a.id]) B.move.set(k, a.move);
    if (a.rec) for (const k of B.kb[a.id]) B.rec.set(k, a.rec);
  }
  const set = (s, id) => { s.clear(); for (const k of B.kb[id]) s.add(k); };
  set(B.aKeys, "a"); set(B.bKeys, "b"); set(B.pauseKeys, "pause"); set(B.muteKeys, "mute"); set(B.flipKeys, "flip");
  B.aPad = B.pad.a; B.bPad = B.pad.b; B.pausePad = B.pad.pause; B.mutePad = B.pad.mute; B.flipPad = B.pad.flip;
  B.recPad = [1, 2, 3, 4, 5].map((n) => B.pad[`rec${n}`]);
  B.active = [...new Set(ACTIONS.flatMap((a) => B.pad[a.id]))];
  B.ok = B.swapAB ? 1 : 0; B.back = B.swapAB ? 0 : 1;
  B.custom = B.swapAB || Object.keys(user.k).length > 0 || Object.keys(user.p).length > 0;
  B.ver++;
  for (const f of listeners) { try { f(B); } catch (e) { console.error(e); } }
}

// ---------- what can be bound ----------
const NAMED = new Set(["Space", "Shift", "Enter", "NumpadEnter", "Tab", "Backspace", ...ARROWS, "Semicolon", "Quote", "Comma", "Period", "Slash", "BracketLeft", "BracketRight", "Backslash",
  "Minus", "Equal", "Backquote", "IntlBackslash", "Insert", "Delete", "Home", "End", "PageUp", "PageDown", "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal"]);
export const keyOk = (k) => typeof k === "string" && (/^Key[A-Z]$/.test(k) || /^Digit[0-9]$/.test(k) || /^Numpad[0-9]$/.test(k) || NAMED.has(k));
export const padOk = (i) => PAD_OK.includes(i);
// a KeyboardEvent → its key id (both Shift keys are one)
export const keyId = (e) => { const c = e.code || (e.key === " " ? "Space" : e.key) || ""; return c === "ShiftLeft" || c === "ShiftRight" ? "Shift" : c; };

// ---------- names ----------
const CAP = { Space: "SPACE", Shift: "SHIFT", Enter: "ENTER", NumpadEnter: "NUM ENTER", Tab: "TAB", Backspace: "BKSP", Escape: "ESC", ArrowUp: "@keyU", ArrowDown: "@keyD", ArrowLeft: "@keyL", ArrowRight: "@keyR",
  Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`", IntlBackslash: "\\",
  Insert: "INS", Delete: "DEL", Home: "HOME", End: "END", PageUp: "PG UP", PageDown: "PG DN", NumpadAdd: "NUM +", NumpadSubtract: "NUM -", NumpadMultiply: "NUM *", NumpadDivide: "NUM /", NumpadDecimal: "NUM ." };
// a key's keycap text (@keyU…: the arrow icons ui.js draws); in messages, arrows are words
export const keyCap = (k) => CAP[k] || (/^Key[A-Z]$/.test(k) ? k.slice(3) : /^Digit\d$/.test(k) ? k.slice(5) : /^Numpad\d$/.test(k) ? `NUM ${k.slice(6)}` : String(k).toUpperCase());
export const keyWord = (k) => ({ ArrowUp: "UP", ArrowDown: "DOWN", ArrowLeft: "LEFT", ArrowRight: "RIGHT" })[k] || keyCap(k);
export const caps = (id) => (B.kb[id] || []).map(keyCap);
export const glyphs = (id) => (B.pad[id] || []).map((i) => PAD_GLYPH[i]);
// the receivers' keys as one label: "1-5" while they're 1 to 5 (n of them), else each one
export function recCap(n = 5) {
  const k = [1, 2, 3, 4, 5].slice(0, n).map((i) => B.kb[`rec${i}`][0]);
  if (k.every((x, i) => x === `Digit${i + 1}`)) return n > 1 ? `1-${n}` : "1";
  return k.map((x) => (x ? keyWord(x) : "-")).join(" ");
}

// ---------- loading and saving ----------
function clean(raw) {
  const out = { k: {}, p: {}, ab: false };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [dev, ok, max] of [["k", keyOk, 4], ["p", padOk, 3]]) {
    const src = raw[dev];
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    for (const [id, list] of Object.entries(src)) {
      const a = BY_ID[id];
      if (!a || !Array.isArray(list) || list.length > max || (dev === "p" && a.move)) continue;
      const l = [...new Set(list.filter(ok))];
      if (l.length !== list.length) continue;
      out[dev][id] = l;
    }
  }
  out.ab = raw.ab === true || raw.ab === 1;
  return out;
}
// one action per key / button (a saved choice beats a default); PAUSE, SOUND and FLIP keep off the menus' keys
function settle() {
  for (const dev of ["k", "p"]) {
    const o = dev === "k" ? user.k : user.p;
    for (const a of ACTIONS) {
      if (dev === "p" && a.move) continue;
      const cur = stored(a, dev), keep = cur.filter((x) => !blocked(a, dev, x));
      if (keep.length !== cur.length) o[a.id] = keep;
    }
    for (let i = 0; i < ACTIONS.length; i++) for (let j = i + 1; j < ACTIONS.length; j++) {
      const a = ACTIONS[i], b = ACTIONS[j];
      if (dev === "p" && (a.move || b.move)) continue;
      for (const x of stored(a, dev).slice()) {
        if (!stored(b, dev).includes(x)) continue;
        const loser = own(o, b.id) && !own(o, a.id) ? a : b;
        o[loser.id] = stored(loser, dev).filter((y) => y !== x);
      }
    }
  }
}
function blocked(a, dev, x) {
  if (!a.menu) return "";
  if (dev === "k" && MENU_K.includes(x)) return x.startsWith("Arrow") ? "THE ARROWS RUN THE MENUS" : `${keyWord(x)} RUNS THE MENUS`;
  if (dev === "p" && [0, 1, 4, 5].includes(x)) return "A, B, LB AND RB RUN THE MENUS";
  if (a.call && dev === "k" && /^(Digit|Numpad)[1-9]$/.test(x)) return "1-9 PICK THE PLAYS";
  if (a.call && dev === "k" && CALL_K.includes(x)) return `${keyWord(x)} TURNS THE PAGES`;
  return "";
}
let store = null;
try { store = typeof localStorage !== "undefined" ? localStorage : null; } catch (_) { /* storage blocked */ }
export function load() {
  let raw = null;
  try { raw = store ? JSON.parse(store.getItem(STORE) || "null") : null; } catch (_) { raw = null; }
  user = clean(raw);
  settle();
  apply();
}
function save() {
  if (!store) return;
  const any = user.ab || Object.keys(user.k).length || Object.keys(user.p).length;
  try { if (any) store.setItem(STORE, JSON.stringify({ v: 1, k: user.k, p: user.p, ...(user.ab ? { ab: true } : {}) })); else store.removeItem(STORE); } catch (_) { /* this session only */ }
}
function setList(a, dev, list) {
  const o = dev === "k" ? user.k : user.p, d = dflt(a, dev);
  if (list.length === d.length && list.every((x, i) => x === d[i])) delete o[a.id];
  else o[a.id] = list;
}

// ---------- rebinding ----------
// rebind(action id, "k" | "p", key code | the button pressed) → { ok, msg }. The action takes that one input; the
// action that had it takes the action's old input instead (the first one free), else is left without one.
export function rebind(id, dev, x) {
  const a = BY_ID[id];
  if (!a) return { ok: false, msg: "" };
  if (dev === "k" ? !keyOk(x) : !padOk(x)) return { ok: false, msg: dev === "k" ? "THAT KEY CAN'T BE USED" : "THAT BUTTON CAN'T BE USED" };
  if (dev === "p" && a.move) return { ok: false, msg: "THE STICK AND D-PAD MOVE" };
  const why = blocked(a, dev, x);
  if (why) return { ok: false, msg: why };
  const cur = dev === "k" ? B.kb : B.pad;
  const old = cur[id].slice();
  if (old.length === 1 && old[0] === x) return { ok: true, msg: "" };
  const next = { [id]: [x] };
  const clash = ACTIONS.filter((b) => b.id !== id && !(dev === "p" && b.move) && cur[b.id].includes(x));
  const list = (b) => next[b.id] || cur[b.id];
  const free = (b, y) => !blocked(b, dev, y) && !ACTIONS.some((c) => c.id !== b.id && !(dev === "p" && c.move) && list(c).includes(y));
  for (const b of clash) next[b.id] = cur[b.id].filter((y) => y !== x);
  const moved = [];
  for (const b of clash) {
    const give = old.find((y) => y !== x && free(b, y));
    if (give !== undefined) next[b.id].splice(Math.min(cur[b.id].indexOf(x), next[b.id].length), 0, give);
    moved.push({ id: b.id, to: next[b.id].slice() });
  }
  for (const [k, l] of Object.entries(next)) setList(BY_ID[k], dev, dev === "p" ? l.map(swap) : l);
  save();
  apply();
  const name = (y) => (dev === "k" ? keyWord(y) : `{pad:${PAD_GLYPH[y]}}`);
  const label = (b) => (b.group === "ab" ? `${b.label} BUTTON` : b.label);
  const msg = moved.map((m) => `${name(x)} WAS ${label(BY_ID[m.id])} · ${label(BY_ID[m.id])} IS NOW ${m.to.length ? m.to.map(name).join("/") : "UNSET"}`).join(" · ");
  return { ok: true, msg };
}
export function toggleSwap() { user.ab = !user.ab; save(); apply(); return B.swapAB; }
export function reset() { user = { k: {}, p: {}, ab: false }; save(); apply(); }
export const changed = (id, dev) => own(dev === "k" ? user.k : user.p, id);

// a PlayStation pad shows PlayStation symbols
export const padStyleOf = (id) => (/054c|dualshock|dualsense|playstation/i.test(String(id || "")) ? "ps" : "xbox");

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => { if (e.key === STORE || e.key === null) load(); });
  window.addEventListener("all22:saves", (e) => { const k = e.detail && e.detail.keys; if (!k || k.includes(STORE)) load(); });
}
load();
