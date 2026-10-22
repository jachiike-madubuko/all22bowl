// DOM screens in a retro sports-broadcast style (UI team): title, team select, opponent select,
// play calling (paged playbook with animated pixel diagrams + octagonal play clock), PAT / kickoff
// decisions, the HUD (scorebug + play-result ticker + context hints), pause, halftime, results,
// how-to-play and settings. Built with createElement (CSP: no inline styles/scripts in HTML).
//
// ============================ UI KIT (for other modules, e.g. modes-ui.js) ============================
//   ui.addMenuButton(screen, {label, onClick, primary?, id?}) → remove()   screen: 'title' | 'pause' |
//       'results' | 'halftime' | 'team' | 'opponent'. Buttons appear in that screen's menu (the title
//       re-renders if it is showing).
//   ui.addTeamCard({id, label, note, make: () => team | null, onPick?(team)}) → remove()   an extra card
//       on team select (e.g. 'YOUR DRAFT'); default pick → app.goOppSelect(team).
//   ui.screen(cls) → a full-screen container (.screen.<cls>) that replaces the current menu screen.
//   ui.panel(title, cls) → a .panel with a header bar inside the current screen.
//   ui.button(label, cls, fn) → a .pbtn ('primary', 'small', 'on', 'big').
//   ui.navKeys(container, onBack, extraKeyFn) → arrow/WASD spatial focus, Enter/Space/J = click,
//       Esc/Backspace = onBack; gamepad D-pad/A/B arrive as the same keys.
//   ui.clear() / ui.modal(cls) / ui.closeModal() / ui.sfx('move' | 'sel' | 'back')
//   Pixel icons: ui-art.js (iconImg, typeIcon, spriteEl, crispScale ...). CSS classes: top of bowl.css.
// ======================================================================================================
import { CFG } from "./config.js";
import { bus } from "./events.js";
import { OFF_PLAYS, DEF_PLAYS, asCalled } from "./playbook.js";
import { GYMS, CHAMPION, REGION, starPlayers, monName } from "./data.js";
import { cpuFourthDown } from "./ai.js";
import { Logo, iconImg, typeIcon, spriteEl, drawRing, RING_SIZE, crispScale, installCssIcons, padArt, touchArt, TYPE_COLORS, dpr } from "./ui-art.js";
import { drawDiagram, DIAG_W, DIAG_H, LEGEND, LEGEND_DEF } from "./ui-diagram.js";
import { B as BIND, PAD_GLYPH, caps, glyphs, keyId, keyWord, recCap, onChange as onBindings } from "./bindings.js";
import { showControls } from "./ui-controls.js";

// One-line play descriptions (cards + details). Falls back to the play's own `desc`.
export const DESCRIPTIONS = {
  dive: "Power run up the middle",
  sweep: "Pitch it wide and turn the corner",
  counter: "Fake left, guard pulls, cut back right",
  hbDraw: "Show pass, then hand it up the gut",
  reverse: "End around: the receiver takes it back the other way",
  qbSneak: "QB pushes behind the center for a yard",
  slants: "Quick slants: get it out fast",
  curlflat: "Curls sit in the holes, flats stretch wide",
  verts: "Four deep: air it out",
  papost: "Fake the dive, hit the post",
  screen: "Let them rush, dump it to the back",
  wrScreen: "Quick throw out wide behind a wall",
  teSeam: "Tight end splits the safeties",
  hailMary: "Everybody deep. Throw it up and pray",
  punt: "Flip the field",
  fg: "Three points",
  base: "Man underneath, two safeties deep",
  blitz: "Six rushers: get home fast",
  cover2: "Corners squat, safeties split the deep halves",
  runstop: "Eight in the box, attack the run",
  prevent: "Three rush, everyone else drops deep",
  zoneBlitz: "Bring a backer, drop a lineman into zone",
  cover3: "Three deep zones, four underneath",
  goalLine: "Heavy front: stuff the short run",
};
// ...a FLIPped play's, where the line names a side
const DESCRIPTIONS_FLIP = {
  counter: "Fake right, guard pulls, cut back left",
};
const STYLE_NAMES = { air: "AIR RAID", ground: "GROUND & POUND", balanced: "BALANCED", blitz: "BLITZ HAPPY", trick: "TRICK PLAYS" };
// box-score rows that step aside on short phones (html.mini), so the halftime / results / stats buttons stay on screen
const MINOR_STATS = new Set(["3RD DOWNS", "RETURN YARDS", "LONGEST PLAY", "TIME OF POSS"]);

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const ORD = ["", "1ST", "2ND", "3RD", "4TH"];
const ord = (n) => ORD[n] || `${n}TH`;
const SIDES = ["home", "away"];
const NO_PLAY = {};
// touch labels [A, B] by context code (see UI.ctxCode)
const CTX_LABELS = [["", ""], ["SNAP", ""], ["", "SWITCH"], ["PASS", "NEXT"], ["JUKE", "STIFF"], ["DIVE", "SWITCH"], ["TACKLE", "SWITCH"], ["", "FAIR C"]];
export const fmtClock = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export function spotText(w) {
  const los = Math.round(w.los);
  if (los === 50) return "MIDFIELD";
  const own = w.teams[w.offense].data.abbr, opp = w.teams[w.defense].data.abbr;
  return los < 50 ? `${own} ${los}` : `${opp} ${100 - los}`;
}
export function downText(w) {
  const tg = w.firstDownX >= 100 ? "GOAL" : String(Math.max(1, Math.round(w.toGo)));
  return `${ord(w.down)} & ${w.toGo < 0.9 && w.firstDownX < 100 ? "INCHES" : tg}`;
}
const teamColor = (d) => d.color || d.primary || "#888";
// readable text on a team color
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#f6f6f2";
  const n = parseInt(m[1], 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? "#0b0d14" : "#f6f6f2";
}
const descOf = (p) => (p.flip && DESCRIPTIONS_FLIP[p.id]) || DESCRIPTIONS[p.id] || p.desc || "";
function kindOf(p) {
  if (p.type === "run") return { label: "RUN", cls: "run" };
  if (p.type === "pass") return { label: "PASS", cls: "pass" };
  if (p.type) return { label: "TRICK", cls: "trick" };
  if (p.blitz) return { label: "BLITZ", cls: "blitz" };
  if (p.id === "prevent") return { label: "PREVENT", cls: "prevent" };
  if (p.cover === "zone") return { label: "ZONE", cls: "zone" };
  if (p.box) return { label: "RUN D", cls: "rund" };
  return { label: "MAN", cls: "man" };
}
const DIRS = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
const OK_KEYS = new Set(["Enter", "NumpadEnter", "Space", "KeyJ", "KeyZ"]);
const visible = (e) => e.offsetParent !== null || e.getClientRects().length > 0;
// Spatial navigation: the nearest item in that direction (falls back to DOM-order cycling).
function spatial(items, cur, dir) {
  const r0 = cur.getBoundingClientRect();
  const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bs = Infinity;
  for (const it of items) {
    if (it === cur) continue;
    const r = it.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const dx = x - cx, dy = y - cy;
    let main, cross;
    if (dir === "right") { if (dx < 6) continue; main = dx; cross = Math.abs(dy); }
    else if (dir === "left") { if (dx > -6) continue; main = -dx; cross = Math.abs(dy); }
    else if (dir === "down") { if (dy < 6) continue; main = dy; cross = Math.abs(dx); }
    else { if (dy > -6) continue; main = -dy; cross = Math.abs(dx); }
    const s = main + cross * 2.4;
    if (s < bs) { bs = s; best = it; }
  }
  if (best) return best;
  const i = items.indexOf(cur);
  const step = dir === "right" || dir === "down" ? 1 : -1;
  return items[(i + step + items.length) % items.length];
}

// The player's keys and buttons (bindings.js) as keycaps: [label, class] pairs for keySpan(). A label starting
// with "@" is a pixel icon (the arrows, a PlayStation pad's face buttons); padStyle "ps" names a PlayStation pad's
// buttons as PlayStation does.
const PS_FACE = { A: "@psX", B: "@psO", X: "@psSq", Y: "@psTri" };
const PS_WORD = { A: "CROSS", B: "CIRCLE", X: "SQUARE", Y: "TRIANGLE", LB: "L1", RB: "R1", LT: "L2", RT: "R2", BACK: "SHARE" }; // (in a sentence)
const PS_NAME = { LB: "L1", RB: "R1", LT: "L2", RT: "R2", BACK: "SHARE", START: "OPTIONS" };
const XB_CLS = { A: "pad-a", B: "pad-b", X: "pad-x", Y: "pad-y" };
export function padKey(name, style) {
  if (!name) return null;
  if (style === "ps") return PS_FACE[name] ? [PS_FACE[name], "pad-ps"] : [PS_NAME[name] || name, name.length > 1 ? "wide" : ""];
  return [name, XB_CLS[name] || (name.length > 1 ? "wide" : "")];
}
export const keyKey = (cap) => (cap ? [cap, cap.length > 1 && !cap.startsWith("@") ? "wide" : cap.startsWith("@") ? "sq" : ""] : null);
// the first key / button of an action, as a keycap pair (null when it has none)
export const actKey = (id) => keyKey(caps(id)[0]);
export const actPad = (id, style) => padKey(glyphs(id)[0], style);
export function keySpan(k, extra = "") {
  const sp = document.createElement("span");
  sp.className = `key ${k[1] || ""} ${extra}`.trim();
  if (k[0].startsWith("@")) sp.append(iconImg(k[0].slice(1), 9, "pxi"));
  else sp.textContent = k[0];
  return sp;
}

// Font sizes that stay crisp: Press Start 2P is drawn on an 8-px em, so every size is a whole number
// of device pixels per font pixel. Layout scale (--ui) and border width (--bw) follow the viewport.
function applyScale() {
  const d = dpr();
  const vw = Math.max(320, window.innerWidth), vh = Math.max(240, window.innerHeight);
  const f = Math.max(0.8, Math.min(1.7, Math.min(vw / 1280, vh / 720)));
  // whole device px per font px; never below the role's minimum CSS size (legibility on phones)
  const crisp = (t, min) => {
    const m = Math.max(1, Math.round((t * f * d) / 8), Math.ceil((min * d) / 8 - 0.01));
    return (m * 8) / d;
  };
  const root = document.documentElement.style;
  const sizes = { fx: [8, 8], fs: [10, 8], fm: [13, 10], fl: [18, 12], fh: [26, 16], fxl: [42, 24] };
  for (const k in sizes) root.setProperty(`--${k}`, crisp(sizes[k][0], sizes[k][1]) + "px");
  root.setProperty("--fb", Math.max(11, Math.round(12.5 * f)) + "px");
  root.setProperty("--ui", String(Math.round(f * 100) / 100));
  root.setProperty("--bw", Math.max(1, Math.round(4 * Math.min(f, 1.25) * d)) / d + "px");
  root.setProperty("--bw2", Math.max(1, Math.round(2 * Math.min(f, 1.25) * d)) / d + "px");
  document.documentElement.classList.toggle("short", vh < 520);
  document.documentElement.classList.toggle("tiny", vh < 400);
  // landscape phones under 380 px (Safari's bars leave ~320-340, Androids 360): screens and windows drop extras so
  // their buttons fit without a scroll (bowl.css html.mini; bowl-modes.css uses the same line)
  document.documentElement.classList.toggle("mini", vh < 380);
  document.documentElement.classList.toggle("narrow", vw < 760);
}

export class UI {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    applyScale();
    installCssIcons();
    this.layer = el("div", "screens");
    root.appendChild(this.layer);
    this.hud = this.buildHud();
    root.appendChild(this.hud.el);
    this.current = null;
    this.keyHandler = null;
    this.pc = null;
    this.modalEl = null;
    this.flow = null;
    this.flowDirty = false;
    this.hooks = { title: [], pause: [], results: [], halftime: [], team: [], opponent: [] };
    this.teamCards = [];
    this.lastPick = { off: null, def: null };
    this.top = { world: null, clock: 0, q: 0, home: 0, away: 0 };
    this.tick = { world: null };
    this.diagT0 = 0;
    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("resize", () => {
      applyScale();
      this.onResize();
    });
    // The entry wipes (scrIn / winIn / pcIn) animate clip-path, and iPhone Safari can leave one frozen on an in-between
    // step: a play-call panel stuck two-thirds revealed, its second row of plays cut off. Once a wipe has had time to
    // finish, .settled drops the clip with an !important rule (which outranks the animation), whatever the browser did.
    const WIPES = new Set(["scrIn", "winIn", "pcIn"]);
    root.addEventListener("animationstart", (e) => {
      if (!WIPES.has(e.animationName)) return;
      const node = e.target;
      setTimeout(() => node.classList.add("settled"), 450);
    });
    // portrait on a phone: the rotate overlay shows (CSS, the same query); pause a live game underneath
    try {
      const mq = matchMedia("(orientation: portrait) and (pointer: coarse) and (max-width: 519px)");
      const onRot = () => {
        if (mq.matches && this.app.scr === "game" && this.app.world && !this.app.world.autoplay && !this.app.paused) this.app.pause();
      };
      mq.addEventListener ? mq.addEventListener("change", onRot) : mq.addListener(onRot);
    } catch (_) {}
    // the play-result ticker listens to the live game's events
    const live = (fn) => (p, type, w) => {
      if (w && w === this.app.world && this.app.scr === "game") fn(p, w, type);
    };
    bus.on("firstDown", live((p, w) => this.tickerExtra(w, "FIRST DOWN!", "hot")));
    bus.on("turnover", live((p, w) => { if (p && p.kind === "downs") this.tickerExtra(w, "TURNOVER ON DOWNS", "bad"); }));
    bus.on("pat", live((p, w) => this.tickerExtra(w, p && p.good ? "EXTRA POINT IS GOOD" : "EXTRA POINT NO GOOD", p && p.good ? "hot" : "bad")));
    bus.on("twoPoint", live((p, w) => this.tickerExtra(w, p && p.good ? "TWO-POINT TRY IS GOOD!" : "TWO-POINT TRY FAILS", p && p.good ? "hot" : "bad")));
    bus.on("fairCatch", live((p, w) => this.tickerExtra(w, "FAIR CATCH", "")));
    bus.on("onside", live((p, w) => this.tickerExtra(w, p && p.recovered === true ? "ONSIDE KICK RECOVERED!" : p && p.recovered === false ? "ONSIDE KICK · THE RETURN TEAM HAS IT" : "ONSIDE KICK!", "hot")));
    bus.on("kickoff", live((p, w) => this.tickerKick(w)));
    bus.on("onsideRecovered", live((p, w) => {
      const who = p && p.player ? ` · ${monName(p.player.id)}` : "";
      this.tickerExtra(w, p && p.success ? `ONSIDE KICK RECOVERED!${who}` : `RETURN TEAM RECOVERS${who}`, p && p.success ? "hot" : "bad");
    }));
    bus.on("patChoice", live((p, w) => { if (p && p.choice === "two") this.tickerExtra(w, "GOING FOR TWO!", "hot"); }));
    bus.on("scoop", live((p, w) => { if (p && p.player) this.tickerExtra(w, `SCOOPED UP BY ${monName(p.player.id)}!`, "hot"); }));
    // the first segment already reads HALFTIME (and the score): clear the result segment
    bus.on("halftime", live((p, w) => this.setTicker(w, "", "", 0)));
    bus.on("quarterEnd", live((p, w) => this.tickerExtra(w, `END OF THE ${ord(p.q)} QUARTER`, "")));
    bus.on("overtime", live((p, w) => this.tickerExtra(w, "OVERTIME · A TOUCHDOWN WINS IT", "hot")));
    bus.on("scoreChange", live((p, w) => this.flashScore(p && p.team)));
    // gamepad rumble on the big moments (only when a pad is the active device)
    const rumble = (strong, weak, ms) => {
      const inp = this.app.input;
      if (inp && inp.device === "pad" && inp.rumble) inp.rumble(strong, weak, ms);
    };
    bus.on("tackle", live((p) => { if (p && p.power >= 95) rumble(Math.min(1, p.power / 180), 0.35, 110); }));
    bus.on("sack", live(() => rumble(0.8, 0.4, 160)));
    bus.on("touchdown", live(() => rumble(0.45, 0.9, 420)));
    bus.on("interception", live(() => rumble(0.6, 0.6, 220)));
    bus.on("fumble", live(() => rumble(0.7, 0.5, 200)));
    bus.on("touchdown", live((p, w) => {
      const d = w.drive;
      if (d && d.plays > 1 && !(p && p.defensive)) this.queueTicker(w, `SCORING DRIVE · ${d.plays} PLAYS · ${Math.max(0, Math.round(100 - d.start))} YDS`, "", 2600);
    }));
    bus.on("fieldGoal", live((p, w) => {
      const d = w.drive;
      if (p && p.good && d && d.plays > 1) this.queueTicker(w, `FIELD GOAL DRIVE · ${d.plays} PLAYS · ${Math.max(0, Math.round(w.los - d.start))} YDS`, "", 2400);
    }));
    // gamepad: Start pauses/resumes, menus get arrow/Enter/Escape (input.js asks us what Start means)
    if (this.app.input) {
      this.app.input.menuKeyFor = (btn) => this.padMenuKey(btn);
      this.app.input.onDevice = () => {
        const p = this.current && this.current.querySelector(".press-start");
        if (p) p.textContent = this.pressText();
        if (this.hud) this.hud.cache.hintKey = -1;
        // a PlayStation pad came in (or went): the screen showing redraws its keycaps in its symbols
        const st = this.app.input.padStyle;
        if (st !== this.padStyleShown) { this.padStyleShown = st; if (this.restyle) this.restyle(); }
        this.paintFlip(); // the play call's FLIP button shows the key or button of the device in hand
      };
      onBindings(() => this.paintFlip());
      this.padStyleShown = this.app.input.padStyle;
      // a controller button bound to SOUND ON / OFF or FLIP PLAY (bindings.js)
      this.app.input.onPadAction = (n) => {
        if (n === "mute") { this.app.setMuted(!this.app.audio.muted); this.syncMute(); }
        else if (n === "flip") this.flipCall();
      };
    }
    this.scan = { cv: document.querySelector("canvas.crt"), P: -1, w: 0, h: 0, raf: 0 };
    this.syncScanlines();
    // the pixel font arrives after first paint: re-measure layouts that depend on text size
    try {
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.onResize());
    } catch (_) {}
  }

  // ---------- kit ----------
  sfx(kind) {
    const a = this.app.audio;
    if (!a) return;
    try {
      a.unlock();
      if (kind === "sel") a.select();
      else if (kind === "back") a.blip(false);
      else a.blip(kind === "hi");
    } catch (_) {}
  }
  onKey(e) {
    if (this.keyHandler) {
      let r = false;
      try {
        r = this.keyHandler(e);
      } catch (err) {
        console.error(err);
      }
      if (r === true) {
        // handled here: the app's own Esc/P/Enter listeners must not see it again (Esc while
        // paused used to resume and immediately re-pause)
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }
    if (BIND.muteKeys.has(keyId(e)) && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
      this.app.setMuted(!this.app.audio.muted);
      this.syncMute();
    }
  }
  padMenuKey(btn) {
    // what a gamepad button means while the game controls are off (menus, play call, pause...)
    if (btn === "start") return this.screenName() === "pause" ? "Escape" : this.screenName() === "playcall" ? null : "Enter";
    if (btn === "a") return "Enter";
    if (btn === "b") return "Escape";
    if (btn === "lb") return "KeyQ";
    if (btn === "rb") return "KeyE";
    return null;
  }
  // What is on screen, for __game.state().screen (null = no menu/overlay: the field).
  screenName() {
    const cur = this.current, m = this.modalEl;
    if (m) for (const k of ["results", "halftime", "pause"]) if (m.classList.contains(k)) return k;
    if (cur && cur.classList.contains("help")) return "howto";
    if (cur && cur.classList.contains("settings")) return "settings";
    if (cur && cur.classList.contains("controls")) return "controls";
    if (this.pc) return "playcall";
    if (this.flow) return this.flow.kind === "pat" ? "patchoice" : "kickchoice";
    return null;
  }
  clear() {
    this.layer.replaceChildren();
    this.current = null;
    this.keyHandler = null;
    this.restyle = null; // (a screen that shows controller buttons redraws itself for a PlayStation pad)
    if (this.app.input) this.app.input.capture = null; // (never leave the remap screen's key capture behind)
    this.flowDirty = true;
  }
  screen(cls) {
    // re-rendering the same screen (a settings change, a help tab, a reroll) skips the entry wipe
    const same = this.current && this.current.className.split(" ")[1] === cls.split(" ")[0];
    this.clear();
    const s = el("div", "screen " + cls + (same ? " still" : ""));
    this.layer.appendChild(s);
    this.current = s;
    return s;
  }
  panel(title, cls = "") {
    const p = el("div", "panel " + cls);
    if (title) {
      const h = el("div", "panel-head");
      h.append(el("h2", "ptitle", title));
      p.append(h);
    }
    return p;
  }
  button(label, cls, fn) {
    const b = el("button", "pbtn " + (cls || ""));
    b.type = "button";
    if (typeof label === "string") b.textContent = label;
    else b.append(label);
    b.addEventListener("click", () => {
      this.sfx("sel");
      fn();
    });
    b.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse" && this.selEl !== b) this.select(b);
    });
    b.addEventListener("focus", () => {
      if (this.selEl !== b) this.select(b, true);
    });
    return b;
  }
  // The highlighted item. Tracked explicitly (class .sel) so the highlight never depends on the
  // window having system focus; real DOM focus follows it for screen readers / Tab.
  select(node, quiet) {
    if (!node) return;
    if (this.selEl && this.selEl !== node) this.selEl.classList.remove("sel");
    this.selEl = node;
    node.classList.add("sel");
    if (this.pc && node.classList.contains("pcard")) {
      const i = this.pc.cards.indexOf(node);
      if (i >= 0 && i !== this.pc.focus) {
        this.pc.focus = i;
        this.pc.diagFocusT = this.app.now();
      } else if (i >= 0 && this.pc.diagFocusT == null) this.pc.diagFocusT = this.app.now();
    }
    if (document.activeElement !== node) node.focus({ preventScroll: true });
    if (!quiet) this.sfx();
  }
  navItems(container) {
    return [...container.querySelectorAll("button:not([disabled]), a[href], [data-nav]")].filter(visible);
  }
  // Arrow-key spatial focus navigation inside a container.
  navKeys(container, onBack, extra) {
    this.keyHandler = (e) => {
      if (extra) {
        const r = extra(e);
        if (r === true) return true;
      }
      const items = this.navItems(container);
      const cur = items.includes(this.selEl) ? this.selEl : items.includes(document.activeElement) ? document.activeElement : null;
      const dir = DIRS[e.code];
      if (dir && items.length) {
        if (e.repeat && !cur) return true;
        const nx = cur ? spatial(items, cur, dir) : items[0];
        if (nx) {
          this.select(nx);
          if (nx.scrollIntoView) nx.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
        return true;
      }
      if (OK_KEYS.has(e.code) && items.length) {
        if (e.repeat) return true;
        (cur || items[0]).click();
        return true;
      }
      if ((e.code === "Escape" || e.code === "Backspace") && onBack) {
        if (e.repeat) return true;
        this.sfx("back");
        onBack();
        return true;
      }
      return false;
    };
  }
  focusLater(node) {
    if (!node) return;
    this.select(node, true);
    setTimeout(() => node.isConnected && this.selEl === node && document.activeElement !== node && node.focus({ preventScroll: true }), 30);
  }
  addMenuButton(screen, def) {
    const list = this.hooks[screen] || (this.hooks[screen] = []);
    const h = { ...def };
    list.push(h);
    if (screen === "title" && this.current && this.current.classList.contains("title")) this.showTitle();
    return () => {
      const i = list.indexOf(h);
      if (i >= 0) list.splice(i, 1);
    };
  }
  hookButtons(screen) {
    return (this.hooks[screen] || []).map((h) => {
      const b = this.button(h.label, (h.primary ? "primary " : "") + (h.cls || ""), () => h.onClick && h.onClick(this.app.world));
      if (h.id) b.dataset.hook = h.id;
      return b;
    });
  }
  addTeamCard(def) {
    this.teamCards.push(def);
    return () => {
      const i = this.teamCards.indexOf(def);
      if (i >= 0) this.teamCards.splice(i, 1);
    };
  }
  onResize() {
    if (this.logo && this.logo.canvas.isConnected && this.current) this.layoutTitle(this.current);
    if (this.pc) this.layoutPlayCall();
    this.syncScanlines();
    this.publishHudBottom();
  }
  // renderer.hudBottomCss: bottom of the lowest visible top-HUD element (scorebug, ticker when it
  // shows) in CSS px from the canvas top, pixel-frame outline included; 0 while the HUD is hidden.
  // The art group keeps the camera focus and banners below it. Recomputed on resize, HUD show, a
  // new game and the live / play-call toggles (never per frame).
  publishHudBottom() {
    const r = this.app.renderer, h = this.hud;
    if (!r || !h) return;
    if (h.el.classList.contains("hidden")) {
      r.hudBottomCss = 0;
      return;
    }
    let bottom = 0;
    for (const node of [h.sb, h.tk]) {
      if (!node || !node.isConnected) continue;
      const cs = getComputedStyle(node);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const b = node.getBoundingClientRect();
      if (b.height > 0) bottom = Math.max(bottom, b.bottom + 2 * (parseFloat(cs.getPropertyValue("--bw")) || 0));
    }
    const cv = this.app.canvas;
    const top = cv && cv.getBoundingClientRect ? cv.getBoundingClientRect().top : 0;
    r.hudBottomCss = bottom > 0 ? Math.max(0, Math.ceil(bottom - top)) : 0;
  }

  // ---------- title ----------
  fitLogo() {
    const row = window.innerHeight < 520 || !!(this.current && this.current.classList.contains("tight"));
    this.logo.fit(row ? Math.min(window.innerWidth * 0.44, 560) : Math.min(window.innerWidth * 0.62, 620));
  }
  // side-by-side title (logo | menu) when the column layout does not fit the screen
  layoutTitle(s) {
    s.classList.remove("tight");
    this.fitLogo();
    if (window.innerHeight >= 520 && s.scrollHeight > s.clientHeight + 2) {
      s.classList.add("tight");
      this.fitLogo();
    }
  }
  pressText() {
    const dev = this.app.input && this.app.input.device;
    return dev === "pad" ? "PRESS START" : dev === "touch" ? "TAP PLAY" : "PRESS ENTER";
  }
  showTitle() {
    const s = this.screen("title");
    if (!this.logo) this.logo = new Logo();
    this.fitLogo();
    this.logo.start();
    const left = el("div", "title-left");
    const lw = el("div", "title-logo");
    lw.append(this.logo.canvas);
    const sub = el("div", "subtitle");
    sub.append(el("span", "sub-a", "POKéMON FOOTBALL"), el("span", "sub-dot", " · "), el("span", "sub-b", `${REGION.name.toUpperCase()} EDITION`));
    left.append(lw, sub);
    const right = el("div", "title-right");
    const menu = el("div", "menu title-menu");
    const play = this.button("PLAY", "primary big", () => this.app.goTeamSelect());
    menu.append(play, ...this.hookButtons("title"));
    menu.append(this.button("HOW TO PLAY", "", () => this.showHelp(() => this.showTitle())), this.button("SETTINGS", "", () => this.showSettings(() => this.showTitle())));
    const region = this.regionPicker();
    if (region) {
      menu.append(region);
      s.classList.add("regions");
    }
    const press = el("div", "press-start", this.pressText());
    right.append(menu, press);
    // the attract game behind the title, as a tiny live scorebug
    const live = el("div", "title-live");
    const liveTxt = el("span", "tl-txt", "");
    live.append(iconImg("live", 8, "pxi tl-dot"), el("span", "tl-tag", "LIVE"), liveTxt);
    const updLive = () => {
      if (!live.isConnected) return clearInterval(liveTimer);
      const w = this.app.attract;
      if (!w || !w.teams) return;
      const H = w.teams.home.data, A = w.teams.away.data;
      const q = w.phase === "GAME_OVER" ? "FINAL" : w.phase === "HALFTIME" ? "HALF" : `${ord(Math.min(4, w.quarter))} ${fmtClock(w.clock)}`;
      const t = `${H.abbr} ${w.score.home} · ${A.abbr} ${w.score.away} · ${q}`;
      if (liveTxt.textContent !== t) liveTxt.textContent = t;
    };
    const liveTimer = setInterval(updLive, 500);
    setTimeout(updLive, 0);
    const foot = el("div", "title-foot");
    const back = el("a", "backlink");
    back.href = "/";
    back.append(iconImg("arrowL", 10), el("span", "", " BACK TO THE ALL-22 BUILDER"));
    // the account page (signed in, gym progress, drafts and settings follow the player to their other devices), once
    // the new account features are on (saves.js)
    let links = back;
    if (globalThis.ALL22_ACCOUNTS === true) {
      const acct = el("a", "backlink acct-link", document.cookie.split(";").some((c) => c.trim() === "a22in=1") ? "YOUR ACCOUNT" : "SIGN IN TO SAVE PROGRESS");
      acct.href = `/account?return=${encodeURIComponent(location.pathname + location.search)}`;
      links = el("div", "title-links");
      links.append(acct, back);
    }
    foot.append(links, el("span", "fanmade", "FREE FAN PROJECT. NOT AFFILIATED WITH OR ENDORSED BY NINTENDO, GAME FREAK, CREATURES OR THE POKÉMON COMPANY. POKÉMON NAMES AND ARTWORK BELONG TO THEIR RESPECTIVE OWNERS."));
    s.append(live, left, right, foot);
    this.layoutTitle(s);
    this.navKeys(menu, null, (e) => {
      // on the region switch, left / right (keys, D-pad) step through the regions
      const d = e.code === "ArrowLeft" || e.code === "KeyA" ? -1 : e.code === "ArrowRight" || e.code === "KeyD" ? 1 : 0;
      if (!d || !region || this.selEl !== region) return false;
      if (!e.repeat) region.step(d);
      return true;
    });
    this.focusLater(play);
  }
  // ◀ KANTO ▶ on the title: the region switch (regions.js). A step (an arrow tap, ← →, the D-pad; A / Enter / a tap
  // in the middle = the next region) saves the choice and reloads the page into that region, without ?region=.
  // Hidden while only one region is ready.
  regionPicker() {
    const R = globalThis.ALL22_REGIONS;
    const list = R ? R.ready() : [];
    const at = list.findIndex((r) => r.key === REGION.key);
    if (list.length < 2 || at < 0) return null;
    const b = el("button", "pbtn region-pick");
    b.type = "button";
    const name = el("span", "rp-name", REGION.name.toUpperCase());
    const mid = el("span", "rp-mid");
    mid.append(el("span", "rp-label", "REGION"), name);
    b.append(iconImg("arrowL", 14, "pxi rp-arrow"), mid, iconImg("arrowR", 14, "pxi rp-arrow"));
    b.setAttribute("aria-label", `Region: ${REGION.name}. Left and right switch regions.`);
    b.step = (d) => {
      if (b.classList.contains("going")) return;
      const r = list[(at + d + list.length) % list.length];
      this.sfx("sel");
      b.classList.add("going");
      name.textContent = r.name.toUpperCase();
      R.set(r.key);
      const u = new URL(location.href);
      u.searchParams.delete("region");
      // storage blocked (Safari's Block All Cookies): the choice can't be saved, so the address carries it
      let kept = false;
      try { kept = localStorage.getItem(R.KEY) === r.key; } catch (_) {}
      if (!kept) u.searchParams.set("region", r.key);
      location.replace(u.href);
    };
    b.addEventListener("click", (e) => {
      // a tap or click on the left third steps back; keys and the pad press it with no pointer (detail 0)
      const box = b.getBoundingClientRect();
      b.step(e.detail && e.clientX < box.left + box.width / 3 ? -1 : 1);
    });
    b.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse" && this.selEl !== b) this.select(b);
    });
    b.addEventListener("focus", () => {
      if (this.selEl !== b) this.select(b, true);
    });
    return b;
  }

  // ---------- how to play ----------
  showHelp(onBack, tab) {
    const s = this.screen("help scroll-ok");
    const p = this.panel("HOW TO PLAY", "wide help-panel");
    const tabs = el("div", "tabs");
    const body = el("div", "help-body");
    const dev = this.app.input && this.app.input.device;
    const names = [["keys", "KEYBOARD"], ["touch", "TOUCH"], ["pad", "GAMEPAD"], ["play", "THE GAME"]];
    const cur = tab || (dev === "touch" ? "touch" : dev === "pad" ? "pad" : "keys");
    for (const [id, label] of names) {
      const b = this.button(label, "tab" + (id === cur ? " on" : ""), () => this.showHelp(onBack, id));
      b.dataset.tab = id;
      tabs.append(b);
    }
    const key = (t, cls = "") => keySpan([t, cls]);
    const row = (keys, what) => {
      const r = el("div", "hrow");
      const k = el("div", "hkeys");
      for (const x of keys) k.append(typeof x === "string" ? el("span", "hor", x) : x);
      r.append(k, el("div", "hwhat", what));
      return r;
    };
    // an action's keys (bindings.js), up to two, "/" between them; [] when it has none
    const keysOf = (id, n = 2) => caps(id).slice(0, n).flatMap((c, i) => (i ? ["/", keySpan(keyKey(c))] : [keySpan(keyKey(c))]));
    const style = this.app.input ? this.app.input.padStyle : "xbox";
    const padOf = (id) => glyphs(id).slice(0, 1).map((g) => keySpan(padKey(g, style)));
    const dflt = (id, list) => { const c = BIND.kb[id]; return c.length === list.length && c.every((x, i) => x === list[i]); };
    if (cur === "keys") {
      const grid = el("div", "help-cols");
      const c1 = el("div", "hcol");
      const mv = el("div", "hrow move");
      const mk = el("div", "hkeys");
      if (["up", "down", "left", "right"].every((d, i) => dflt(d, [["ArrowUp", "KeyW"], ["ArrowDown", "KeyS"], ["ArrowLeft", "KeyA"], ["ArrowRight", "KeyD"]][i]))) {
        const arrows = el("div", "arrows");
        arrows.append(el("i"), key("@keyU", "sq"), el("i"), key("@keyL", "sq"), key("@keyD", "sq"), key("@keyR", "sq"));
        const wasd = el("div", "arrows");
        wasd.append(el("i"), key("W", "sq"), el("i"), key("A", "sq"), key("S", "sq"), key("D", "sq"));
        mk.append(arrows, el("span", "hor", "OR"), wasd);
      } else {
        // the player's own movement keys, in the same cross (the first key of each direction)
        const cross = el("div", "arrows");
        const k1 = (d) => { const c = caps(d)[0]; return c ? keySpan(keyKey(c), "sq") : el("i"); };
        cross.append(el("i"), k1("up"), el("i"), k1("left"), k1("down"), k1("right"));
        mk.append(cross);
      }
      mv.append(mk, el("div", "hwhat", "MOVE YOUR PLAYER"));
      const recs = [1, 2, 3, 4, 5].flatMap((n) => caps(`rec${n}`).slice(0, 1).map((c) => keySpan(keyKey(c))));
      c1.append(mv);
      if (recs.length) c1.append(row(recs, recCap() === "1-5" ? "THROW TO THAT RECEIVER (THE NUMBERS ON THE FIELD AND ON THE PLAY CARDS)" : "THROW TO THAT RECEIVER (THE KEYS SHOW OVER THEM ON THE FIELD)"));
      const c2 = el("div", "hcol");
      if (caps("a").length) c2.append(row(keysOf("a"), "A · SNAP · THROW · JUKE · DIVE TACKLE · KICK"));
      if (caps("b").length) c2.append(row(keysOf("b"), "B · NEXT TARGET · STIFF-ARM · SWITCH · FAIR CATCH · ONSIDE"));
      c2.append(row([key("ESC"), ...(caps("pause").length ? ["/", ...keysOf("pause", 1)] : [])], "PAUSE"));
      if (caps("mute").length) c2.append(row(keysOf("mute", 1), "SOUND ON / OFF"));
      if (caps("flip").length) c2.append(row(keysOf("flip", 1), "FLIP THE PLAY"));
      c2.append(row([key("ENTER", "wide")], "PICK · CONFIRM IN MENUS"));
      grid.append(c1, c2);
      body.append(grid);
    } else if (cur === "touch") {
      const grid = el("div", "help-cols");
      const art = el("div", "help-art");
      const cv = touchArt();
      const k = crispScale(cv.width, Math.min(320, window.innerWidth * 0.36));
      cv.style.width = cv.width * k + "px";
      cv.style.height = cv.height * k + "px";
      cv.className = "art-cv";
      art.append(cv);
      const c2 = el("div", "hcol");
      c2.append(
        row([key("LEFT THUMB", "wide")], "JOYSTICK · IT APPEARS WHERE YOU TOUCH"),
        row([key("A", "btn-a")], "SNAP · JUKE · TACKLE · KICK (THE LABEL SAYS WHAT IT DOES)"),
        row([key("B", "btn-b")], "STIFF-ARM · SWITCH · FAIR CATCH · ONSIDE"),
        row([key("1-5", "wide")], "RECEIVER BUTTONS REPLACE A AND B IN THE POCKET · TAP ONE TO THROW TO HIM"),
        row([key("FLIP", "wide")], "RUN THE PLAY THE OTHER WAY"),
        row([key("II")], "PAUSE (TOP RIGHT) · PLAY IN LANDSCAPE"),
      );
      grid.append(art, c2);
      body.append(grid);
    } else if (cur === "pad") {
      const grid = el("div", "help-cols");
      const art = el("div", "help-art");
      const cv = padArt();
      const k = crispScale(cv.width, Math.min(320, window.innerWidth * 0.36));
      cv.style.width = cv.width * k + "px";
      cv.style.height = cv.height * k + "px";
      cv.className = "art-cv";
      art.append(cv);
      const c2 = el("div", "hcol");
      const ok = PAD_GLYPH[BIND.ok], bk = PAD_GLYPH[BIND.back], nm = (g) => (style === "ps" ? { A: "CROSS", B: "CIRCLE" }[g] || g : g);
      c2.append(row([key("STICK", "wide"), "/", key("D-PAD", "wide")], "MOVE"));
      if (glyphs("a").length) c2.append(row(padOf("a"), "SNAP · THROW · JUKE · DIVE TACKLE · KICK"));
      if (glyphs("b").length) c2.append(row(padOf("b"), "NEXT TARGET · STIFF-ARM · SWITCH · FAIR CATCH · ONSIDE"));
      const recs = [1, 2, 3, 4, 5].flatMap((n) => padOf(`rec${n}`));
      if (recs.length) c2.append(row(recs, "THROW TO THAT RECEIVER (THE BUTTONS SHOW OVER THEM ON THE FIELD)"));
      // FLIP: its own row, or on a short screen (where another row would need a scroll) a line in the menus' row
      const fg = glyphs("flip")[0], flipLine = fg && window.innerHeight < 520;
      c2.append(row([keySpan(padKey("START", style), "wide")], `PAUSE · IN MENUS: D-PAD + ${nm(ok)}, ${nm(bk)} = BACK, ${style === "ps" ? "L1 / R1" : "LB / RB"} = PAGE${flipLine ? ` · PLAY CALL: ${style === "ps" ? PS_WORD[fg] || fg : fg} = FLIP` : ""}`));
      if (glyphs("mute").length) c2.append(row(padOf("mute"), "SOUND ON / OFF"));
      if (fg && !flipLine) c2.append(row(padOf("flip"), "FLIP THE PLAY"));
      grid.append(art, c2);
      body.append(grid);
    } else {
      const grid = el("div", "help-cols tips");
      const tip = (t, txt) => {
        const b = el("div", "tip");
        b.append(el("div", "tip-t", t), el("p", "", txt));
        return b;
      };
      // A and B are the game's two buttons; a keyboard player whose A isn't SPACE / J / Z (or B SHIFT / K / X) reads
      // the key next to its name ("A (L)")
      const btn = (id, d) => (dev === "kb" && !dflt(id, d) && BIND.kb[id].length ? `${id.toUpperCase()} (${keyWord(BIND.kb[id][0])})` : id.toUpperCase());
      const A = btn("a", ["Space", "KeyJ", "KeyZ"]), Bb = btn("b", ["Shift", "KeyK", "KeyX"]);
      // FLIP's key or button by the device in hand (touch: the button on the play call)
      const fg = glyphs("flip")[0], fkey = BIND.kb.flip[0];
      const flipBy = dev === "pad" ? (fg ? ` (${this.app.input.padStyle === "ps" ? PS_WORD[fg] || fg : fg})` : "") : dev === "touch" ? "" : fkey ? ` (${keyWord(fkey)})` : "";
      grid.append(
        tip("OFFENSE", `Pick a play, then snap with ${A}. On runs the back takes the handoff and you steer him through the holes. On passes the ${recCap() === "1-5" ? "numbers" : "keys"} over your receivers are the keys that throw to them. Cross the line and you can't throw.`),
        tip("DEFENSE", `You play the defender with the ring. ${Bb} switches to whoever is closest to the ball. Close in and press ${A} to dive. Miss and you're on the turf.`),
        tip("SPECIAL TEAMS", `4th down: go for it, punt, or kick a field goal from inside their 38. After a touchdown: ${A} kicks the extra point, ${Bb} goes for two. Kicking off: ${A} kicks deep, ${Bb} tries an onside kick. Returning a punt: ${Bb} signals a fair catch.`),
        tip("THE PLAY CARDS", `Red = run path, blue = routes, yellow = first read, pink = QB, tan = blocks. On defense: red rush, yellow man coverage, cyan zones. Q / E turn the pages. FLIP${flipBy} runs the play the other way.`),
      );
      body.append(grid);
    }
    p.append(tabs, body);
    const rowb = el("div", "row");
    const b = this.button("BACK", "", onBack);
    rowb.append(b);
    if (cur === "keys" || cur === "pad") rowb.append(this.button("CUSTOMIZE", "", () => showControls(this, () => this.showHelp(onBack, cur))));
    p.append(rowb);
    s.append(p);
    this.restyle = () => this.showHelp(onBack, cur);
    this.navKeys(p, onBack, (e) => {
      if (e.code === "KeyQ" || e.code === "KeyE") {
        const i = names.findIndex((n) => n[0] === cur);
        const j = (i + (e.code === "KeyE" ? 1 : names.length - 1)) % names.length;
        this.showHelp(onBack, names[j][0]);
        return true;
      }
      return false;
    });
    this.focusLater(tab ? tabs.querySelector(`[data-tab="${cur}"]`) : b);
  }

  // ---------- settings ----------
  volume(kind) {
    const a = this.app.audio;
    try {
      if (a && typeof a.getVolume === "function") {
        const v = a.getVolume(kind);
        if (Number.isFinite(v)) return v;
      }
      if (a && a.volume && Number.isFinite(a.volume[kind])) return a.volume[kind];
      const raw = localStorage.getItem(`all22bowl-volume-${kind}`);
      if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
    } catch (_) {}
    return kind === "music" ? 0.6 : 0.8;
  }
  setVolume(kind, v) {
    const a = this.app.audio;
    v = Math.max(0, Math.min(1, Math.round(v * 10) / 10));
    try {
      a.unlock();
      if (typeof a.setVolume === "function") a.setVolume(kind, v);
      else localStorage.setItem(`all22bowl-volume-${kind}`, String(v));
    } catch (_) {}
    if (kind === "sfx") this.sfx();
  }
  weatherOn() {
    try {
      return localStorage.getItem("all22bowl-weather") !== "off";
    } catch (_) {
      return true;
    }
  }
  showSettings(onBack, focusKey) {
    const s = this.screen("settings scroll-ok");
    const p = this.panel("SETTINGS", "settings-panel");
    const cur = this.app.settings;
    const list = el("div", "set-list");
    const re = (k) => this.showSettings(onBack, k);
    const seg = (key, label, opts, value, set) => {
      const r = el("div", "set-row");
      r.append(el("span", "set-label", label));
      const g = el("div", "seg");
      for (const [v, text] of opts) {
        const b = this.button(text, v === value ? "on" : "", () => {
          set(v);
          re(`${key}:${v}`);
        });
        b.dataset.key = `${key}:${v}`;
        g.append(b);
      }
      r.append(g);
      list.append(r);
    };
    const vol = (kind, label) => {
      const r = el("div", "set-row");
      r.append(el("span", "set-label", label));
      const bar = el("button", "vol");
      bar.type = "button";
      bar.dataset.key = `vol:${kind}`;
      bar.dataset.vol = kind;
      const v = this.volume(kind);
      for (let i = 1; i <= 10; i++) {
        const seg2 = el("i", i <= Math.round(v * 10) ? "on" : "");
        seg2.addEventListener("click", (e) => {
          e.stopPropagation();
          this.setVolume(kind, i / 10 === v && i === 1 ? 0 : i / 10);
          re(`vol:${kind}`);
        });
        bar.append(seg2);
      }
      bar.append(el("b", "vol-n", String(Math.round(v * 10))));
      bar.addEventListener("click", () => {});
      bar.addEventListener("focus", () => this.selEl !== bar && this.select(bar, true));
      bar.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && this.selEl !== bar && this.select(bar));
      r.append(bar);
      list.append(r);
    };
    seg("len", "QUARTER LENGTH", [[2, "2 MIN"], [3, "3 MIN"], [5, "5 MIN"]], cur.quarterMin, (v) => this.app.setSetting("quarterMin", v));
    seg("cam", "CAMERA", [["wide", "WIDE"], ["close", "CLOSE"]], cur.camera === "close" ? "close" : "wide", (v) => this.app.setSetting("camera", v));
    const hasVol = this.app.audio && typeof this.app.audio.setVolume === "function";
    if (hasVol) {
      vol("music", "MUSIC");
      vol("sfx", "SOUND FX");
    }
    seg("snd", "SOUND", [[true, "ON"], [false, "OFF"]], !this.app.audio.muted, (v) => this.app.setMuted(!v));
    seg("wx", "WEATHER", [[true, "ON"], [false, "OFF"]], this.weatherOn(), (v) => {
      try {
        localStorage.setItem("all22bowl-weather", v ? "on" : "off");
      } catch (_) {}
      try {
        window.dispatchEvent(new CustomEvent("all22bowl-settings", { detail: { weather: v } }));
      } catch (_) {}
    });
    seg("scan", "SCANLINES", [[true, "ON"], [false, "OFF"]], !!cur.scanlines, (v) => {
      this.app.setSetting("scanlines", v);
      this.syncScanlines();
    });
    list.lastChild.classList.add("scan-row");
    // CONTROLS: the remap screen (ui-controls.js). In the two-column layout of short screens it takes the left
    // column's last cell (bowl.css), straight down from QUARTER LENGTH, MUSIC and SOUND
    const cr = el("div", "set-row set-ctl");
    cr.append(el("span", "set-label", "CONTROLS"));
    const cg = el("div", "seg");
    const cb = this.button(BIND.custom ? "CUSTOM · CHANGE" : "CUSTOMIZE", "", () => showControls(this, () => this.showSettings(onBack, "controls")));
    cb.dataset.key = "controls";
    cg.append(cb);
    cr.append(cg);
    list.append(cr);
    p.append(list);
    const note = el("div", "set-note", this.scan.P >= 0 && this.scan.P < 2 && cur.scanlines ? "SCANLINES NEED A BIGGER SCREEN" : "SAVED ON THIS DEVICE");
    p.append(note);
    const rowb = el("div", "row");
    const b = this.button("BACK", "", onBack);
    rowb.append(b);
    p.append(rowb);
    s.append(p);
    this.navKeys(p, onBack, (e) => {
      const f = this.selEl;
      if (f && f.dataset && f.dataset.vol && (e.code === "ArrowLeft" || e.code === "ArrowRight" || e.code === "KeyA" || e.code === "KeyD")) {
        const kind = f.dataset.vol;
        const v = this.volume(kind) + (e.code === "ArrowRight" || e.code === "KeyD" ? 0.1 : -0.1);
        this.setVolume(kind, v);
        re(`vol:${kind}`);
        return true;
      }
      return false;
    });
    const want = focusKey && p.querySelector(`[data-key="${focusKey}"]`);
    this.focusLater(want || p.querySelector(".pbtn.on") || b);
  }

  // ---------- team select ----------
  formation(team) {
    const f = el("div", "formation");
    const rows = [
      ["d", ["CB1", "S1", "S2", "CB2"]],
      ["d", ["OLB1", "ILB1", "ILB2", "OLB2"]],
      ["d", ["DE1", "NT", "DE2"]],
      ["los", null],
      ["o", ["WR1", "LT", "LG", "C", "RG", "RT", "TE", "WR2"]],
      ["o", ["FB", "QB", "HB"]],
    ];
    const short = window.innerHeight < 520;
    const size = short ? 24 : window.innerWidth >= 1700 && window.innerHeight >= 950 ? 64 : 34;
    for (const [kind, slots] of rows) {
      if (!slots) {
        f.append(el("div", "f-los"));
        continue;
      }
      const r = el("div", "f-row " + kind);
      for (const slot of slots) {
        const id = team.lineup[slot];
        const c = el("div", "f-cell");
        const sp = spriteEl(id, size, "f-spr", monName(id));
        sp.title = `${slot} · ${monName(id)}`;
        c.append(sp, el("span", "f-pos", slot.replace(/1|2/, "")));
        r.append(c);
      }
      f.append(r);
    }
    return f;
  }
  // extra: an optional node appended at the bottom of the card (e.g. a modes-team footer)
  teamCard(team, label, note, onPick, extra) {
    const card = el("div", "card team-card");
    card.tabIndex = 0;
    card.dataset.nav = "1";
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${label}: ${team.name}`);
    card.style.setProperty("--tc", team.primary);
    card.style.setProperty("--tc2", team.secondary);
    card.style.setProperty("--tci", inkOn(team.primary));
    const head = el("div", "tc-head");
    const ovr = el("div", "tc-ovr");
    ovr.append(el("b", "", String(team.overall.ovr)), el("i", "", "OVR"));
    head.append(el("span", "tc-label", label), ovr);
    const rate = el("div", "tc-rate");
    const bar = (name, v) => {
      const r = el("span", "tc-bar");
      const fill = el("i");
      fill.style.width = Math.max(0, Math.min(100, ((v - 40) / 59) * 100)) + "%";
      const track = el("span", "track");
      track.append(fill);
      r.append(el("em", "", name), track, el("b", "", String(v)));
      return r;
    };
    rate.append(bar("OFF", team.overall.off), bar("DEF", team.overall.def));
    const scheme = team.scheme || {};
    const short = window.innerHeight < 520;
    const meta = el("div", "tc-meta", short ? `${scheme.def === "43" ? "4-3" : "3-4"} D · ${scheme.off === "slot" ? "SLOT" : "FULLBACK"} O` : `${scheme.def === "43" ? "4-3" : "3-4"} DEFENSE · ${scheme.off === "slot" ? "SLOT" : "FULLBACK"} OFFENSE`);
    card.append(head, rate, this.formation(team), meta, el("div", "tc-note", note));
    if (extra) card.append(extra);
    const go = () => {
      this.sfx("sel");
      onPick();
    };
    card.addEventListener("click", go);
    card.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse" && this.selEl !== card) this.select(card);
    });
    card.addEventListener("focus", () => this.selEl !== card && this.select(card, true));
    return card;
  }
  showTeamSelect(mine, draft, onMine, onDraft, onReroll, onBack) {
    const s = this.screen("teamsel scroll-ok");
    s.append(this.stitle("CHOOSE YOUR TEAM"));
    const row = el("div", "cards teams");
    const c1 = this.teamCard(mine, "YOUR ALL-22", mine.fromBuilder ? "Your lineup from the All-22 builder." : `No saved lineup yet: the classic ${REGION.name} All-22. Build yours on the main page!`, onMine);
    const w2 = el("div", "card-wrap");
    const c2 = this.teamCard(draft, "QUICK DRAFT", `A strong random team of ${REGION.league ? `the ${REGION.name} Pokédex` : "the original 151"}, drafted by fit.`, onDraft);
    const rr = this.button(this.app.input && this.app.input.device === "touch" ? "REROLL" : "REROLL (R)", "small reroll", () => onReroll());
    w2.append(c2, rr);
    row.append(c1, w2);
    for (const def of this.teamCards) {
      let team = null;
      try {
        team = def.make ? def.make() : null;
      } catch (e) {
        console.error(e);
      }
      if (!team) continue;
      row.append(this.teamCard(team, def.label || team.name, def.note || "", () => (def.onPick ? def.onPick(team) : this.app.goOppSelect(team))));
    }
    s.append(row);
    const nav = el("div", "row");
    nav.append(this.button("BACK", "small", onBack), ...this.hookButtons("team"));
    s.append(nav);
    this.navKeys(s, onBack, (e) => {
      if (e.code === "KeyR" && !e.repeat) {
        this.sfx("sel");
        onReroll();
        return true;
      }
      return false;
    });
    this.focusLater(this.lastTeamFocus === "draft" ? c2 : c1);
    c2.addEventListener("focus", () => (this.lastTeamFocus = "draft"));
    c1.addEventListener("focus", () => (this.lastTeamFocus = "mine"));
    c1.addEventListener("pointerenter", () => (this.lastTeamFocus = "mine"));
    c2.addEventListener("pointerenter", () => (this.lastTeamFocus = "draft"));
  }
  stitle(text) {
    const h = el("div", "stitle-wrap");
    h.append(el("h2", "stitle", text));
    return h;
  }

  showOppSelect(onPick, onBack) {
    const s = this.screen("oppsel scroll-ok");
    s.append(this.stitle("CHOOSE YOUR OPPONENT"));
    const grid = el("div", "cards gyms");
    let first = null;
    GYMS.forEach((g) => {
      const team = this.app.gymTeam(g.key);
      const card = el("button", "card gym-card");
      card.type = "button";
      card.style.setProperty("--tc", g.primary);
      card.style.setProperty("--tc2", g.secondary);
      card.style.setProperty("--tci", inkOn(g.primary));
      card.style.setProperty("--typec", TYPE_COLORS[g.type] || "#888");
      const head = el("div", "gc-head");
      const city = el("span", "gc-city", (g.city || g.name.split(" ")[0]).toUpperCase());
      head.append(typeIcon(g.type, window.innerHeight < 520 ? 16 : 22), city);
      const stars = el("div", "gc-stars");
      for (let k = 0; k < 5; k++) stars.append(iconImg(k < (g.stars || 0) ? "star" : "starOff", window.innerHeight < 520 ? 9 : 12, "pxi star"));
      const name = el("div", "gc-name", (g.short || g.name).toUpperCase());
      const spr = el("div", "gc-sprites");
      const sz = window.innerHeight < 520 ? 44 : window.innerWidth >= 1700 ? 72 : 56;
      for (const id of starPlayers(team, 3)) spr.append(spriteEl(id, sz, "gc-spr", monName(id)));
      const lead = el("div", "gc-leader");
      lead.append(el("span", "gc-lt", "LEADER "), el("b", "", (g.leader || "").toUpperCase()));
      const foot = el("div", "gc-foot");
      const style = team.style || g.style;
      foot.append(el("span", "gc-ovr", `OVR ${team.overall.ovr}`), el("span", "gc-type", (STYLE_NAMES[style] || g.type || "").toUpperCase()));
      card.append(head, name, spr, lead, stars, foot);
      card.setAttribute("aria-label", `${g.name}, leader ${g.leader}, ${g.stars} stars`);
      card.addEventListener("click", () => {
        this.sfx("sel");
        onPick(g.key);
      });
      card.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse" && this.selEl !== card) this.select(card);
      });
      card.addEventListener("focus", () => this.selEl !== card && this.select(card, true));
      grid.append(card);
      if (!first) first = card;
    });
    s.append(grid);
    const nav = el("div", "row");
    nav.append(this.button("BACK", "small", onBack), ...this.hookButtons("opponent"));
    s.append(nav);
    this.navKeys(s, onBack);
    this.focusLater(first);
  }

  // ---------- play calling ----------
  pagesFor(onOff) {
    const pages = [];
    const chunk = (name, list, cls) => {
      for (let i = 0; i < list.length; i += 8) pages.push({ name: list.length > 8 ? `${name} ${i / 8 + 1}` : name, plays: list.slice(i, i + 8), cls });
    };
    if (onOff) {
      const runs = OFF_PLAYS.filter((p) => p.type === "run");
      const pass = OFF_PLAYS.filter((p) => p.type === "pass");
      const other = OFF_PLAYS.filter((p) => p.type !== "run" && p.type !== "pass");
      if (runs.length) chunk("RUN", runs, "run");
      if (pass.length) chunk("PASS", pass, "pass");
      if (other.length) chunk("TRICK", other, "trick");
    } else chunk("DEFENSE", DEF_PLAYS, "def");
    return pages;
  }
  showPlayCall(w, onPick) {
    this.hidePlayCall(true);
    const human = w.human;
    const onOff = w.offense === human;
    const side = onOff ? "off" : "def";
    const team = w.teams[human].data;
    const scheme = team.scheme || { def: "34", off: "fb" };
    const box = el("div", "playcall " + side);
    box.style.setProperty("--tc", teamColor(team));
    const panel = el("div", "pc-panel");
    // header: side tag, down & distance, spot + game clock, the octagonal play clock
    const head = el("div", "pc-head");
    const sideTag = el("div", "pc-side " + side, onOff ? "OFFENSE" : "DEFENSE");
    const sit = el("div", "pc-sit");
    sit.append(el("div", "pc-dd", w.tryMode ? "2-POINT TRY" : downText(w)), el("div", "pc-spot", `BALL ON ${spotText(w)} · ${w.overtime ? "OT" : `Q${Math.min(4, w.quarter)} ${fmtClock(w.clock)}`}`));
    const clock = el("div", "pc-clock");
    const ring = document.createElement("canvas");
    ring.width = ring.height = RING_SIZE;
    ring.className = "pc-ring";
    const k = crispScale(RING_SIZE, window.innerHeight < 400 ? 26 : window.innerHeight < 520 ? 34 : 46);
    ring.style.width = ring.style.height = RING_SIZE * k + "px";
    const num = el("b", "pc-num", String(CFG.PLAYCLOCK));
    clock.append(ring, num);
    drawRing(ring, 1, false);
    // FLIP: run the play the other way (flipCall). Never a stop for the arrows: the cards keep the selection (Enter picks
    // the card); a click or tap, its key (F) or its controller button (R3) toggles it, for this call only
    const flipBtn = el("button", "pbtn small pc-flip");
    flipBtn.type = "button";
    flipBtn.tabIndex = -1;
    flipBtn.addEventListener("pointerdown", (e) => e.preventDefault()); // (the focus stays on the selected card)
    flipBtn.addEventListener("click", () => this.flipCall());
    head.append(sideTag, sit, flipBtn, clock);
    panel.append(head);
    const pages = this.pagesFor(onOff);
    const tabs = el("div", "pc-tabs");
    const grid = el("div", "pc-grid");
    const detail = el("div", "pc-foot");
    // (the same call shown again, after a pause: still flipped if it was)
    const callKey = w.callKey(side), kept = this.flipKept, flipped = !!(kept && kept.w === w && kept.key === callKey && kept.flip);
    const pcState = { el: box, panel, grid, tabs, cards: [], pages, page: 0, focus: 0, t0: this.app.now(), num, ring, lastN: -1, done: false, onOff, side, w, scheme, fourth: false, diag: [], flip: flipped, flipBtn, callKey };
    box.classList.toggle("flipped", flipped);
    // the pick runs flipped while FLIP is on (onPick(id, flip); kicks never flip)
    const pick = (id, flip = pcState.flip) => {
      if (!this.pc || this.pc !== pcState || pcState.done) return;
      pcState.done = true;
      this.lastPick[side] = id;
      this.sfx("sel");
      onPick(id, !!flip);
      this.hidePlayCall();
    };
    pcState.pick = pick;
    this.pc = pcState;
    this.paintFlip();
    // a FIRST DOWN! (or any) banner still sliding would show at the screen edges behind the panel
    if (this.app && this.app.fx && this.app.fx.clearWords) this.app.fx.clearWords();
    // tabs (pages)
    const tabBtns = [];
    if (pages.length > 1) {
      const touch = !!(this.app.input && this.app.input.device === "touch");
      const prev = el("span", "pc-pg", "");
      prev.append(iconImg("arrowL", 10));
      if (!touch) prev.append(el("span", "", " Q"));
      tabs.append(prev);
      pages.forEach((pg, i) => {
        const t = el("button", "pc-tab " + pg.cls, `${pg.name} · ${pg.plays.length}`);
        t.type = "button";
        t.tabIndex = -1;
        t.addEventListener("click", () => {
          this.sfx();
          this.setPage(i, 0);
        });
        tabs.append(t);
        tabBtns.push(t);
      });
      const nxt = el("span", "pc-pg", "");
      if (!touch) nxt.append(el("span", "", "E "));
      nxt.append(iconImg("arrowR", 10));
      tabs.append(nxt);
    } else {
      const t = el("div", "pc-tab solo " + pages[0].cls, onOff ? "PLAYBOOK" : "DEFENSIVE CALLS");
      tabs.append(t);
    }
    pcState.tabBtns = tabBtns;
    panel.append(tabs, grid);
    // legend + keys
    const leg = el("div", "legend");
    for (const [, col, label] of onOff ? LEGEND : LEGEND_DEF) {
      const i = el("span", "lg");
      const sw = el("i");
      sw.style.background = col;
      i.append(sw, el("span", "", label));
      leg.append(i);
    }
    const pdev = this.app.input ? this.app.input.device : "kb";
    const paged = pages.length > 1;
    const okName = this.app.input && this.app.input.padStyle === "ps" ? (BIND.ok ? "CIRCLE" : "CROSS") : PAD_GLYPH[BIND.ok], pages2 = this.app.input && this.app.input.padStyle === "ps" ? "L1 / R1" : "LB / RB";
    const keys = el("div", "pc-keys", pdev === "pad" ? (paged ? `D-PAD + ${okName} · ${pages2} PAGE` : `D-PAD + ${okName}`) : pdev === "touch" ? "TAP A PLAY" : paged ? "ARROWS + ENTER · 1-8 · Q / E PAGE" : "ARROWS + ENTER · 1-8");
    detail.append(leg, keys);
    panel.append(detail);
    // 4th down: the decision first (GO FOR IT reveals the playbook); the last seconds of a half (or a kick
    // that wins it in overtime) offer the field goal on 1st-3rd down the same way (RUN A PLAY)
    const late = onOff ? w.lateKick() : null;
    if (onOff && (w.down === 4 || late)) {
      pcState.fourth = true;
      const f = el("div", "fourth");
      f.append(el("div", "fourth-title", late ? (w.overtime ? "GAME-WINNING KICK?" : "LAST-SECOND KICK?") : "4TH DOWN DECISION"));
      const fgOk = w.los >= CFG.FG_RANGE_LOS;
      const dist = Math.round(100 - w.los + 17);
      const opts = el("div", "fourth-opts");
      const go = this.button(late ? "RUN A PLAY" : "GO FOR IT", "big primary", () => {
        f.remove();
        panel.classList.remove("decide");
        pcState.fourth = false;
        this.setPage(pcState.page, pcState.focus);
        this.bindPlayKeys();
      });
      const punt = late ? null : this.button("PUNT", "big", () => pick("punt"));
      const fg = this.button(fgOk ? `FIELD GOAL · ${dist} YD` : "FG · OUT OF RANGE", "big", () => pick("fg"));
      if (!fgOk) fg.disabled = true;
      if (punt) opts.append(go, punt, fg);
      else opts.append(go, fg);
      const ai = late || cpuFourthDown(w, human);
      const tip = el("div", "coach");
      tip.append(el("span", "coach-t", "COACH SAYS"), el("span", "coach-v", ai === "go" ? (late ? "RUN A PLAY" : "GO FOR IT") : ai === "fg" ? "KICK THE FIELD GOAL" : "PUNT IT AWAY"));
      f.append(opts, tip);
      panel.insertBefore(f, tabs);
      panel.classList.add("decide");
      this.navKeys(f, null, (e) => {
        if (e.code === "Digit1") { go.click(); return true; }
        if (e.code === "Digit2" && punt) { punt.click(); return true; }
        if (e.code === (punt ? "Digit3" : "Digit2") && fgOk) { fg.click(); return true; }
        return false;
      });
      this.focusLater(ai === "punt" ? punt : ai === "fg" && fgOk ? fg : go);
    }
    box.append(panel);
    this.root.appendChild(box);
    // start on the page / card of the last call on this side
    const last = this.lastPick[side];
    let pg = 0, fi = 0;
    pages.forEach((p, i) => {
      const j = p.plays.findIndex((q) => q.id === last);
      if (j >= 0) { pg = i; fi = j; }
    });
    pcState.page = pg;
    pcState.focus = fi;
    this.setPage(pg, fi, !pcState.fourth);
    if (!pcState.fourth) this.bindPlayKeys();
  }
  bindPlayKeys() {
    const pc = this.pc;
    if (!pc) return;
    this.keyHandler = (e) => {
      if (!this.pc || this.pc.done || this.pc.fourth) return false;
      const cards = this.pc.cards;
      if (BIND.flipKeys.has(keyId(e)) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (!e.repeat) this.flipCall();
        return true;
      }
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) {
        const i = Number(m[1]) - 1;
        if (cards[i]) cards[i].click();
        return true;
      }
      if (e.code === "KeyQ" || e.code === "PageUp" || (e.code === "Tab" && e.shiftKey)) {
        this.flipPage(-1);
        return true;
      }
      if (e.code === "KeyE" || e.code === "PageDown" || e.code === "Tab") {
        this.flipPage(1);
        return true;
      }
      const dir = DIRS[e.code];
      if (dir) {
        const cols = this.pc.cols || 4;
        const n = cards.length;
        let i = Math.max(0, cards.indexOf(this.selEl));
        if (dir === "right") {
          if (i % cols === cols - 1 || i === n - 1) { this.flipPage(1, "first"); return true; }
          i++;
        } else if (dir === "left") {
          if (i % cols === 0) { this.flipPage(-1, "last"); return true; }
          i--;
        } else if (dir === "down") i = i + cols < n ? i + cols : i;
        else i = i - cols >= 0 ? i - cols : i;
        this.focusCard(i, false);
        return true;
      }
      if (OK_KEYS.has(e.code)) {
        if (e.repeat) return true;
        const i = Math.max(0, cards.indexOf(this.selEl));
        if (cards[i]) cards[i].click();
        return true;
      }
      return false;
    };
  }
  // FLIP: every card on the play call mirrored (playbook.js mirrorPlay) and the pick run that way; again: back. Each
  // call opens unflipped. False when there's no call to flip (none open, or the 4th-down decision is up).
  flipCall() {
    const pc = this.pc;
    if (!pc || pc.done || pc.fourth) return false;
    pc.flip = !pc.flip;
    this.flipKept = { w: pc.w, key: pc.callKey, flip: pc.flip };
    this.sfx();
    pc.el.classList.toggle("flipped", pc.flip);
    for (const d of pc.diag) {
      d.play = asCalled(d.base, pc.flip);
      drawDiagram(d.cv, d.play, pc.scheme, 1, 0, false);
      d.desc.textContent = descOf(d.play);
      d.card.title = `${d.play.name}: ${descOf(d.play)}`;
    }
    pc.lastAnimated = null;
    pc.diagFocusT = this.app.now(); // the selected card draws its paths in again, the other way
    this.paintFlip();
    if (pc.cards[pc.focus]) this.select(pc.cards[pc.focus], true);
    return true;
  }
  // The FLIP button: the key or controller button that flips (the device in hand; touch: the button alone), lit while
  // the call is flipped.
  paintFlip() {
    const pc = this.pc, b = pc && pc.flipBtn;
    if (!b) return;
    const inp = this.app.input, dev = inp ? inp.device : "kb";
    const k = dev === "pad" ? padKey(glyphs("flip")[0], inp.padStyle) : dev === "kb" ? keyKey(caps("flip")[0]) : null;
    b.replaceChildren();
    if (k) b.append(keySpan(k));
    b.append(el("span", "pc-flip-t", pc.flip ? "FLIPPED" : "FLIP"));
    b.classList.toggle("on", pc.flip);
    b.classList.toggle("keyed", !!k);
    b.setAttribute("aria-pressed", String(pc.flip));
    b.setAttribute("aria-label", pc.flip ? "Flipped: the play runs the other way. Flip back" : "Flip the play: run it the other way");
  }
  flipPage(d, where) {
    const pc = this.pc;
    if (!pc || pc.pages.length < 2) return;
    const n = pc.pages.length;
    const p = (pc.page + d + n) % n;
    this.sfx();
    const cnt = pc.pages[p].plays.length;
    const cols = cnt <= 5 ? cnt : Math.ceil(cnt / 2);
    this.setPage(p, where === "last" ? Math.min(cnt - 1, cols - 1) : 0);
  }
  focusCard(i, quiet = true) {
    const pc = this.pc;
    if (!pc || !pc.cards[i]) return;
    this.select(pc.cards[i], quiet);
  }
  setPage(pi, fi = 0, focus = true) {
    const pc = this.pc;
    if (!pc) return;
    pc.page = pi;
    const page = pc.pages[pi];
    pc.tabBtns.forEach((t, i) => t.classList.toggle("on", i === pi));
    pc.grid.replaceChildren();
    pc.cards = [];
    pc.diag = [];
    page.plays.forEach((p, i) => {
      const shown = asCalled(p, pc.flip); // (FLIP on: the cards show the plays mirrored)
      const c = el("button", "pcard");
      c.type = "button";
      c.dataset.id = p.id;
      const kind = kindOf(p);
      const top = el("div", "pc-top");
      top.append(el("span", "pc-n", String(i + 1)), el("span", "chip " + kind.cls, kind.label));
      if (p.tag) top.append(el("span", "pc-tag", p.tag));
      const cv = document.createElement("canvas");
      cv.width = DIAG_W;
      cv.height = DIAG_H;
      cv.className = "diagram";
      const name = el("div", "pc-name", p.name);
      const desc = el("div", "pc-desc", descOf(shown));
      c.append(top, cv, name, desc);
      c.title = `${p.name}: ${descOf(shown)}`;
      c.addEventListener("click", () => pc.pick(p.id));
      c.addEventListener("focus", () => {
        if (this.selEl !== c) this.select(c, true);
      });
      c.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse" && this.selEl !== c && !pc.fourth) this.select(c);
      });
      pc.grid.append(c);
      pc.cards.push(c);
      pc.diag.push({ cv, play: shown, base: p, desc, card: c });
      drawDiagram(cv, shown, pc.scheme, 1, 0, false);
    });
    this.layoutPlayCall();
    if (focus && !pc.fourth) this.focusCard(Math.min(fi, pc.cards.length - 1));
    pc.focus = Math.min(fi, pc.cards.length - 1);
    pc.diagFocusT = this.app.now();
  }
  // Fixed card size for the whole playbook (pages never resize the panel); each page centers its
  // own columns. Diagrams get a whole number of device px per diagram px, as big as the budget allows.
  layoutPlayCall() {
    const pc = this.pc;
    if (!pc) return;
    const d = dpr();
    const vw = window.innerWidth, vh = window.innerHeight;
    const short = vh < 520;
    const ui = Math.max(0.8, Math.min(1.7, Math.min(vw / 1280, vh / 720)));
    const colsFor = (n) => (n <= 5 ? n : Math.ceil(n / 2));
    let maxCols = 1, maxRows = 1;
    for (const pg of pc.pages) {
      const c = colsFor(pg.plays.length);
      maxCols = Math.max(maxCols, c);
      maxRows = Math.max(maxRows, Math.ceil(pg.plays.length / c));
    }
    const n = pc.cards.length;
    const cols = colsFor(n);
    pc.cols = cols;
    const gap = short ? 8 : Math.round(14 * ui);
    const panelW = Math.min(vw - 24, Math.round((short ? 220 : 270) * ui * maxCols + 64));
    pc.panel.style.width = panelW + "px";
    const cardW = Math.floor((panelW - 40 - gap * (maxCols - 1)) / maxCols);
    pc.grid.style.gridTemplateColumns = `repeat(${cols}, ${cardW}px)`;
    pc.grid.style.justifyContent = "center";
    // the tag line only when the card is wide enough to show it whole
    const fx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--fx")) || 8;
    pc.grid.classList.toggle("no-tags", cardW < fx * 26);
    const topPad = short ? 54 : 78 * ui;
    const panelMax = vh - topPad - (short ? 14 : 26);
    const chrome = short ? 96 : 150 * ui;
    const cardChrome = short ? 44 : 100 * ui;
    const budgetH = (panelMax - chrome) / maxRows - cardChrome;
    const cardInner = cardW - 26;
    let m = Math.floor(Math.min((cardInner * d) / DIAG_W, (budgetH * d) / DIAG_H));
    m = Math.max(1, Math.min(m, Math.round(4 * d)));
    const size = (k) => {
      const cw = (DIAG_W * k) / d, ch = (DIAG_H * k) / d;
      for (const { cv } of pc.diag) {
        cv.style.width = cw + "px";
        cv.style.height = ch + "px";
      }
    };
    size(m);
    // The budget above is an estimate (no safe areas, nominal font metrics): on iPhones in landscape with Safari's bar
    // the tallest page came out ~10 px taller than the panel's box, its last row over the frame. So measure the real
    // box and this page, project to the tallest page, and step the diagrams down until it fits; a screen too short even
    // for the smallest diagrams lets the panel scroll.
    const bs = getComputedStyle(pc.el), gs = getComputedStyle(pc.grid);
    const frame = 2 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bw")) || 4);
    const avail = pc.el.clientHeight - parseFloat(bs.paddingTop) - Math.max(parseFloat(bs.paddingBottom), frame);
    const rows = Math.ceil(pc.cards.length / cols) || 1;
    const gridIn = pc.grid.scrollHeight - parseFloat(gs.paddingTop) - parseFloat(gs.paddingBottom);
    const rowH = (gridIn + (parseFloat(gs.rowGap) || 0)) / rows;
    let tallest = pc.panel.scrollHeight + (maxRows - rows) * rowH;
    if (tallest > avail + 0.5 && m > 1) {
      const k = Math.max(1, Math.floor(m - ((tallest - avail) * d) / (maxRows * DIAG_H) + 1e-6));
      tallest -= (maxRows * DIAG_H * (m - k)) / d;
      m = k;
      size(m);
    }
    pc.panel.classList.toggle("scroll-ok", tallest > avail + 0.5);
  }
  hidePlayCall(instant) {
    const pc = this.pc;
    if (!pc) return;
    this.pc = null;
    if (this.keyHandler) this.keyHandler = null;
    const node = pc.el;
    if (instant || !node.isConnected) node.remove();
    else {
      node.classList.add("closing");
      setTimeout(() => node.remove(), 140);
    }
  }
  // play clock + the focused card's animated diagram; returns true when the clock ran out
  tickPlayCall(w) {
    const pc = this.pc;
    if (!pc) return false;
    const now = this.app.now();
    const el2 = (now - pc.t0) / 1000;
    const left = Math.max(0, CFG.PLAYCLOCK - el2);
    const n = Math.ceil(left);
    if (n !== pc.lastN) {
      pc.lastN = n;
      pc.num.textContent = String(n);
      drawRing(pc.ring, left / CFG.PLAYCLOCK, left <= 5);
      pc.el.classList.toggle("hurry", left <= 5);
    }
    if (!pc.fourth) {
      const f = pc.diag[pc.focus];
      if (f) {
        const t = (now - (pc.diagFocusT || 0)) / 1000;
        const u = Math.min(1, t / 0.9);
        drawDiagram(f.cv, f.play, pc.scheme, u, t, true);
        // the previously focused card goes back to its still frame
        if (pc.lastAnimated && pc.lastAnimated !== f) drawDiagram(pc.lastAnimated.cv, pc.lastAnimated.play, pc.scheme, 1, 0, false);
        pc.lastAnimated = f;
      }
    }
    return left <= 0;
  }

  // ---------- flow decisions: PAT / 2-point, onside kick (football team's world API) ----------
  // Which decision panel the live game wants now: 'pat' | 'kick' | null (no allocation per frame).
  //   PAT:  phase PAT_CHOICE, w.patTeam is the human, w.patChoice not made → w.choosePAT('kick'|'two').
  //   Kick: phase KICKOFF, the human kicks (w.defense), w.kickChoice not made → w.chooseKickoff(kind);
  //         the panel only when trailing (otherwise the A = KICK / B = ONSIDE hint is enough).
  //   (Older variants: phase KICKOFF_CHOICE / KICK_CHOICE with chooseKickoff / chooseKick.)
  flowWanted(w) {
    if (!w || !w.human || w.autoplay) return null;
    const ph = w.phase;
    if (ph === "PAT_CHOICE" && typeof w.choosePAT === "function") {
      const team = w.patTeam || w.possession;
      if (team === w.human && !w.patChoice) return "pat";
      return null;
    }
    if (ph === "KICKOFF" && typeof w.chooseKickoff === "function" && w.defense === w.human && !w.kickChoice) {
      return w.score[w.human] < w.score[w.offense] ? "kick" : null;
    }
    if ((ph === "KICKOFF_CHOICE" || ph === "KICK_CHOICE") && (typeof w.chooseKickoff === "function" || typeof w.chooseKick === "function")) {
      const kicker = w.kickTeam || w.kicking || w.defense;
      if (kicker === w.human) return "kick";
    }
    return null;
  }
  // seconds left before the world decides on its own (its auto-timers), else our own soft clock
  flowLimit(w, kind) {
    if (kind === "pat") return Number(CFG.PAT_CHOICE_AUTO) || 12;
    // the world waits KICKOFF_CHOICE_AUTO when the human trails (football group), else the short auto-kick
    if (w.phase === "KICKOFF") return Number(CFG.KICKOFF_CHOICE_AUTO) || Number(CFG.KICKOFF_HUMAN_AUTO) || 3;
    return 12;
  }
  syncFlow(w) {
    if (this.app.paused || this.modalEl) return;
    const kind = this.flowWanted(w);
    if (!kind) {
      if (this.flow) this.closeFlow();
      return;
    }
    const f = this.flow;
    if (f && f.kind === kind && f.world === w && !this.flowDirty) {
      const left = f.limit - w.phaseT;
      const n = Math.max(0, Math.ceil(left));
      if (n !== f.lastN) {
        f.lastN = n;
        f.num.textContent = String(n);
      }
      // the world's own auto-timer decides for PAT_CHOICE / KICKOFF; ours only for the old variants
      if (left <= 0 && w.phase !== "PAT_CHOICE" && w.phase !== "KICKOFF") f.auto();
      return;
    }
    this.openFlow(w, kind);
  }
  twoPointAdvice(w, team) {
    const diff = w.score[team] - w.score[w.other(team)];
    const late = w.quarter >= 4 || w.overtime || (w.quarter === 3 && w.clock < 60);
    if (!late) return "kick";
    return [-2, -5, -9, -10, -13, -16, -17, 1, 4, 5, 12, 15, 19].includes(diff) ? "two" : "kick";
  }
  onsideAdvice(w, team) {
    const diff = w.score[team] - w.score[w.other(team)];
    return w.quarter >= 4 && w.clock < 150 && diff < 0 && diff >= -16 ? "onside" : "deep";
  }
  openFlow(w, kind) {
    this.closeFlow(true);
    const want = { kind };
    const box = el("div", "flowpanel " + kind);
    const p = el("div", "flow-panel");
    const human = w.human;
    let opts, advice, title, sub;
    if (want.kind === "pat") {
      title = "TOUCHDOWN! POINT AFTER";
      sub = "KICK THE EXTRA POINT OR GO FOR TWO FROM THE 2";
      advice = this.twoPointAdvice(w, human);
      opts = [["kick", "KICK THE PAT", "1 POINT · ALMOST AUTOMATIC"], ["two", "GO FOR TWO", "2 POINTS · ONE PLAY FROM THE 2"]];
    } else {
      title = "KICKOFF · YOU'RE BEHIND";
      sub = "KICK IT DEEP OR TRY TO STEAL THE BALL BACK";
      advice = this.onsideAdvice(w, human);
      opts = [["deep", "DEEP KICK", "PIN THEM BACK"], ["onside", "ONSIDE KICK", "RISKY · RECOVER IT AND IT'S YOURS"]];
    }
    const choose = (v) => {
      if (!this.flow || this.flow.box !== box || this.flow.done) return;
      this.flow.done = true;
      this.sfx("sel");
      try {
        if (want.kind === "pat") w.choosePAT(v);
        else if (typeof w.chooseKickoff === "function") w.chooseKickoff(v);
        else w.chooseKick(v);
      } catch (e) {
        console.error(e);
      }
      this.closeFlow();
    };
    const limit = this.flowLimit(w, kind);
    const head = el("div", "flow-head");
    const clock = el("b", "flow-clock", String(Math.max(0, Math.ceil(limit - w.phaseT))));
    head.append(el("div", "flow-title", title), clock);
    p.append(head, el("div", "flow-sub", sub));
    const row = el("div", "flow-opts");
    const btns = opts.map(([v, label, note], i) => {
      const b = this.button("", "big flow-opt" + (v === advice ? " advised" : ""), () => choose(v));
      b.dataset.v = v;
      b.append(el("span", "fo-k", String(i + 1)), el("span", "fo-l", label), el("span", "fo-n", note));
      row.append(b);
      return b;
    });
    p.append(row);
    const tip = el("div", "coach");
    tip.append(el("span", "coach-t", "COACH SAYS"), el("span", "coach-v", opts.find((o) => o[0] === advice)[1]));
    p.append(tip);
    box.append(p);
    this.root.appendChild(box);
    this.flow = { kind, world: w, box, done: false, limit, num: clock, lastN: -1, auto: () => choose(advice) };
    this.flowDirty = false;
    if (this.app.input) this.app.input.enabled = false;
    this.navKeys(row, null, (e) => {
      const m = /^Digit([12])$/.exec(e.code);
      if (m) {
        btns[Number(m[1]) - 1].click();
        return true;
      }
      return false;
    });
    this.focusLater(btns.find((b) => b.dataset.v === advice) || btns[0]);
  }
  closeFlow(silent) {
    const f = this.flow;
    if (!f) return;
    this.flow = null;
    f.box.remove();
    if (this.keyHandler && !this.pc && !this.modalEl) this.keyHandler = null;
    // give the game controls back, unless another overlay (play call, modal) has them off now
    if (!silent && this.app.input && this.app.scr === "game" && !this.app.paused && !this.pc && !this.modalEl) {
      this.app.input.enabled = true;
      this.app.input.clearPresses();
    }
  }

  // ---------- HUD ----------
  buildHud() {
    const h = el("div", "hud hidden");
    const sb = el("div", "sb");
    const mk = (side) => {
      const t = el("div", "sb-team " + side);
      const chip = el("i", "sb-chip");
      const ab = el("span", "sb-abbr");
      const sc = el("span", "sb-score", "0");
      const ball = iconImg("ball", 10, "pxi sb-ball");
      const bw = el("span", "sb-poss");
      bw.append(ball);
      const ty = el("span", "sb-type");
      ab.append(ty, el("span", "sb-ab"));
      t.append(chip, ab, bw, sc);
      return { t, chip, ab, abText: ab.lastChild, ty, sc, ball };
    };
    const home = mk("home"), away = mk("away");
    const time = el("div", "sb-time");
    const q = el("span", "sb-q", "1ST");
    const clock = el("span", "sb-clock", "2:00");
    time.append(q, clock);
    sb.append(home.t, away.t, time);
    const tk = el("div", "ticker");
    const tkDD = el("span", "tk-dd");
    const tkSpot = el("span", "tk-spot");
    const tkRes = el("span", "tk-res");
    tkRes.setAttribute("role", "status");
    tkRes.setAttribute("aria-live", "polite");
    tk.append(tkDD, el("i", "tk-sep"), tkSpot, el("i", "tk-sep s2"), tkRes);
    const btns = el("div", "hud-btns");
    const mute = el("button", "hbtn");
    mute.type = "button";
    // (the tooltip names the player's SOUND key: bindings.js)
    const muteTip = () => { const k = BIND.kb.mute[0]; mute.title = k ? `Sound on/off (${keyWord(k)})` : "Sound on/off"; };
    muteTip();
    onBindings(muteTip);
    mute.setAttribute("aria-label", "Sound on/off");
    const pause = el("button", "hbtn");
    pause.type = "button";
    pause.title = "Pause (Esc)";
    pause.setAttribute("aria-label", "Pause");
    pause.append(iconImg("pause", 16));
    btns.append(mute, pause);
    const hint = el("div", "hint");
    const big = el("div", "bigplay");
    h.append(sb, tk, btns, hint, big);
    // never focusable: Space/Enter are game buttons, not "click the pause button again"
    mute.tabIndex = -1;
    pause.tabIndex = -1;
    mute.addEventListener("click", (e) => {
      e.currentTarget.blur();
      this.app.setMuted(!this.app.audio.muted);
      this.syncMute();
    });
    pause.addEventListener("click", (e) => {
      e.currentTarget.blur();
      this.app.pause();
    });
    const ref = { el: h, sb, home, away, q, clock, tk, tkDD, tkSpot, tkRes, hint, mute, big, cache: {}, muteState: null };
    this.hud = ref;
    this.syncMute();
    return ref;
  }
  syncMute() {
    const h = this.hud;
    if (!h) return;
    const m = !!(this.app.audio && this.app.audio.muted);
    if (h.muteState === m) return;
    h.muteState = m;
    h.mute.replaceChildren(iconImg(m ? "mute" : "sound", 18));
    h.mute.classList.toggle("off", m);
  }
  setHudVisible(on) {
    this.hud.el.classList.toggle("hidden", !on);
    if (!on) {
      this.closeFlow(true);
      this.hud.big.classList.remove("show");
      const splash = this.root.querySelector(".matchup-wrap");
      if (splash) splash.remove();
    }
    this.publishHudBottom();
  }
  flashScore(team) {
    const ref = team && this.hud[team];
    if (!ref) return;
    ref.sc.classList.remove("flash");
    void ref.sc.offsetWidth;
    ref.sc.classList.add("flash");
  }
  updateHud(w) {
    const h = this.hud, c = h.cache;
    if (c.world !== w) {
      h.cache = {};
      h.cache.world = w;
      this.tick = { world: w, res: "", cls: "", until: 0, queue: [] };
      this.top = { world: w, clock: w.clock, q: w.quarter, home: 0, away: 0 };
      if (!w.autoplay && (w.phase === "PREGAME" || w.phase === "KICKOFF") && w.quarter === 1 && w.time < 1) this.matchup(w);
      return this.updateHud(w);
    }
    for (let si = 0; si < 2; si++) {
      const side = SIDES[si];
      const d = w.teams[side].data;
      const ref = h[side];
      if (c[side + "ab"] !== d.abbr) {
        c[side + "ab"] = d.abbr;
        ref.abText.textContent = d.abbr;
        // the gym's type emblem next to its abbreviation
        ref.ty.replaceChildren();
        if (d.type && d.type !== "normal") ref.ty.append(typeIcon(d.type, window.innerHeight < 520 ? 12 : 16));
      }
      const sc = w.score[side];
      if (c[side + "sc"] !== sc) {
        c[side + "sc"] = sc;
        ref.sc.textContent = String(sc);
      }
      const col = teamColor(d);
      if (c[side + "col"] !== col) {
        c[side + "col"] = col;
        ref.t.style.setProperty("--tc", col);
        ref.t.style.setProperty("--tci", inkOn(col));
      }
      const poss = w.offense === side && w.phase !== "GAME_OVER" && w.phase !== "HALFTIME";
      if (c[side + "poss"] !== poss) {
        c[side + "poss"] = poss;
        ref.t.classList.toggle("poss", poss);
      }
    }
    const qv = w.phase === "GAME_OVER" ? "FINAL" : w.overtime ? "OT" : w.phase === "HALFTIME" ? "HALF" : ord(Math.min(4, w.quarter));
    if (c.q !== qv) {
      c.q = qv;
      h.q.textContent = qv;
    }
    const cs = w.overtime ? -1 : Math.ceil(Math.max(0, w.clock));
    if (c.clock !== cs) {
      c.clock = cs;
      h.clock.textContent = cs < 0 ? "--:--" : fmtClock(cs);
      h.clock.classList.toggle("low", cs >= 0 && cs <= 30 && (w.quarter === 2 || w.quarter === 4));
    }
    this.trackTop(w);
    this.updateTicker(w);
    const covered = !!(this.pc || this.modalEl || this.flow || this.current);
    if (c.covered !== covered) {
      c.covered = covered;
      h.el.classList.toggle("covered", covered);
    }
    const pcOpen = !!this.pc;
    if (c.pcOpen !== pcOpen) {
      c.pcOpen = pcOpen;
      h.el.classList.toggle("pc-open", pcOpen);
    }
    const flowOpen = !!this.flow;
    if (c.flowOpen !== flowOpen) {
      c.flowOpen = flowOpen;
      h.el.classList.toggle("flow-open", flowOpen);
    }
    // ball in play (scrimmage, kickoff and punt returns): the ticker steps aside so it never sits
    // on players or shows the pre-snap down & distance through the play; back after the whistle
    const liveOn = w.phase === "LIVE";
    if (c.live !== liveOn) {
      c.live = liveOn;
      h.el.classList.toggle("live", liveOn);
      this.publishHudBottom();
    } else if (c.pcHud !== pcOpen) this.publishHudBottom(); // phones hide the ticker under the play call
    c.pcHud = pcOpen;
    this.updateContext(w);
    this.syncFlow(w);
    this.syncMute();
    this.updateMatchup(w);
  }
  // time of possession: the sim's stats.top when it keeps it, else measured here from the clock
  trackTop(w) {
    const t = this.top;
    if (t.world !== w) return;
    if (w.quarter === t.q && w.clock < t.clock && !w.overtime) {
      const d = t.clock - w.clock;
      if (d < 30) t[w.offense] += d;
    }
    t.clock = w.clock;
    t.q = w.quarter;
  }
  topOf(w, side) {
    const s = w.stats[side];
    const both = (w.stats.home.top || 0) + (w.stats.away.top || 0);
    if (both > 0) return s.top || 0;
    return this.top.world === w ? this.top[side] : 0;
  }

  // ---------- matchup splash (broadcast "VS" open while the opening kickoff flies) ----------
  matchup(w) {
    for (const old of this.root.querySelectorAll(".matchup-wrap")) old.remove();
    this.mu = null;
    const m = el("div", "matchup");
    const side = (key) => {
      const d = w.teams[key].data;
      const t = el("div", "mu-team " + key);
      t.style.setProperty("--tc", teamColor(d));
      t.style.setProperty("--tci", inkOn(teamColor(d)));
      t.style.setProperty("--tc2", d.secondary || d.color2 || "#f6f6f2");
      const head = el("div", "mu-head");
      if (d.type && d.type !== "normal") head.append(typeIcon(d.type, window.innerHeight < 520 ? 14 : 20));
      head.append(el("span", "mu-name", d.name || d.abbr));
      const spr = el("div", "mu-sprites");
      const sz = window.innerHeight < 520 ? 40 : window.innerWidth >= 1700 ? 72 : 56;
      try {
        for (const id of starPlayers(d, 3)) spr.append(spriteEl(id, sz, "mu-spr", monName(id)));
      } catch (_) {}
      const sub = d.leader && d.key !== "mine" && d.key !== "draft" ? `LEADER ${String(d.leader).toUpperCase()}` : key === w.human ? "YOUR TEAM" : "";
      const ovr = d.overall && d.overall.ovr ? `OVR ${d.overall.ovr}` : "";
      t.append(head, spr, el("div", "mu-sub", [sub, ovr].filter(Boolean).join(" · ")));
      return t;
    };
    const vs = el("div", "mu-vs", "VS");
    m.append(side("home"), vs, side("away"));
    const venue = w.teams.home.data.key === "mine" || w.teams.home.data.key === "draft" ? w.teams.away.data : w.teams.home.data;
    const where = el("div", "mu-venue", `${(venue.city || REGION.name).toUpperCase()} · ${Math.round(w.quarterSec / 60)}-MIN QUARTERS`);
    const wrap = el("div", "matchup-wrap");
    wrap.append(m, where);
    // upper third, just under the scorebug + ticker: never on the kicker, the ball's lane or the hints
    const hb = this.app.renderer && this.app.renderer.hudBottomCss > 0 ? this.app.renderer.hudBottomCss : 64;
    wrap.style.top = Math.round(hb + 4) + "px";
    this.root.appendChild(wrap);
    // removal is driven by the game loop (updateMatchup): gone by the kick or after ~3.3 s of game time
    this.mu = { el: wrap, world: w, t0: w.time, out: 0 };
  }
  updateMatchup(w) {
    const mu = this.mu;
    if (!mu) return;
    if (!mu.el.isConnected) {
      this.mu = null;
      return;
    }
    const now = this.app.now();
    if (!mu.out) {
      const kicked = mu.world !== w || (w.phase !== "KICKOFF" && w.phase !== "PREGAME") || !!(w.play && w.phase === "LIVE");
      if (kicked || w.time - mu.t0 >= 3.3) {
        mu.out = now;
        mu.el.classList.add("out");
      }
    } else if (now - mu.out >= 250) {
      mu.el.remove();
      this.mu = null;
    }
  }

  // ---------- ticker: DOWN & DIST · BALL ON X · last result / current call ----------
  updateTicker(w) {
    const h = this.hud, c = h.cache;
    const ph = w.phase;
    // first two segments: rebuilt only when what they show changes (no per-frame strings)
    const kickoffPlay = !!(w.play && w.play.kick === "kickoff" && (ph === "LIVE" || ph === "DEAD"));
    const kind = kickoffPlay || ph === "KICKOFF" || ph === "KICKOFF_CHOICE" || ph === "KICK_CHOICE" ? 1 : ph === "PAT" ? 2 : ph === "PAT_CHOICE" || ph === "TWO_POINT" ? 3 : ph === "HALFTIME" ? 4 : ph === "GAME_OVER" ? 5 : 0;
    const toGo2 = Math.round(w.toGo * 2), los = Math.round(w.los), sum = w.score.home * 1000 + w.score.away;
    const tryM = !!w.tryMode;
    if (c.tkKind !== kind || c.tkDown !== w.down || c.tkToGo !== toGo2 || c.tkFd !== (w.firstDownX >= 100) || c.tkLos !== los || c.tkOff !== w.offense || c.tkSum !== sum || c.tkTry !== tryM) {
      c.tkTry = tryM;
      c.tkKind = kind;
      c.tkDown = w.down;
      c.tkToGo = toGo2;
      c.tkFd = w.firstDownX >= 100;
      c.tkLos = los;
      c.tkOff = w.offense;
      c.tkSum = sum;
      let dd, spot;
      if (kind === 1) {
        dd = "KICKOFF";
        spot = `${w.teams[w.offense].data.abbr} TO RECEIVE`;
      } else if (kind === 2 || kind === 3) {
        dd = kind === 2 ? "EXTRA POINT" : "POINT AFTER";
        spot = `${w.teams[w.offense].data.abbr} BALL`;
      } else if (kind === 4 || kind === 5) {
        dd = kind === 4 ? "HALFTIME" : "FINAL";
        spot = `${w.teams.home.data.abbr} ${w.score.home} · ${w.teams.away.data.abbr} ${w.score.away}`;
      } else {
        dd = tryM ? "2-POINT TRY" : downText(w);
        spot = `BALL ON ${spotText(w)}`;
      }
      if (c.tkDD !== dd) {
        c.tkDD = dd;
        h.tkDD.textContent = dd;
      }
      if (c.tkSp !== spot) {
        c.tkSp = spot;
        h.tkSpot.textContent = spot;
      }
    }
    // third segment: the call in play (pre-snap / live) or the last result
    const tk = this.tick;
    if (tk.queue && tk.queue.length && this.app.now() > tk.until) {
      const q = tk.queue.shift();
      tk.res = q.text;
      tk.cls = q.cls || "";
      tk.until = this.app.now() + q.holdMs;
    }
    let res = tk.res, cls = tk.cls;
    if ((ph === "PRE_SNAP" || ph === "LIVE") && w.play && w.play.off && !w.play.kick && !w.autoplay && w.human && this.app.now() > tk.until) {
      const mine = w.offense === w.human ? w.play.off : w.play.def;
      if (mine && mine.name) {
        res = mine.name;
        cls = "call";
      }
    }
    if (c.tkRes !== res || c.tkCls !== cls) {
      c.tkRes = res;
      c.tkCls = cls;
      h.tkRes.textContent = res;
      h.tkRes.className = "tk-res " + cls;
      h.tk.classList.toggle("has-res", !!res);
      if (cls !== "call" && res) {
        h.tkRes.classList.remove("in");
        void h.tkRes.offsetWidth;
        h.tkRes.classList.add("in");
      }
    }
  }
  setTicker(w, text, cls, holdMs = 2600) {
    if (!w || this.tick.world !== w) this.tick = { world: w, res: "", cls: "", until: 0, queue: [] };
    this.tick.res = text;
    this.tick.cls = cls || "";
    this.tick.until = this.app.now() + holdMs;
  }
  // a follow-up message that replaces the current one once it has been up for its hold time
  queueTicker(w, text, cls, holdMs = 2600) {
    if (!w || this.tick.world !== w) return this.setTicker(w, text, cls, holdMs);
    this.tick.queue.push({ text, cls, holdMs });
  }
  tickerExtra(w, text, cls) {
    this.setTicker(w, text, cls, 2400);
  }
  // kickoffs: the first two segments already say KICKOFF · XXX TO RECEIVE; clear the third
  tickerKick(w) {
    this.setTicker(w, "", "", 0);
  }
  // Called by the app on every whistle of the live game: the result goes to the ticker, and big
  // plays get a broadcast lower third with the player's sprite and his game line.
  lowerThird(w, result) {
    if (!result || !w.play) return;
    const play = w.play;
    const yds = Math.round((result.spot != null ? result.spot : w.los) - w.los);
    const gain = (n) => (n > 0 ? `GAIN OF ${n}` : n < 0 ? `LOSS OF ${-n}` : "NO GAIN");
    const nm = (p) => (p ? monName(p.id) : "");
    let text = "", cls = "", star = null, big = "";
    // the sim's own broadcast text for kick plays, returns and 2-point tries (football team)
    const label = result.label ? String(result.label).toUpperCase() : "";
    const ret = play.ret || null;
    const returner = (ret && ret.player) || play.returner || null;
    if (label && (w.tryMode || play.tryMode || result.type !== "td" || ret)) {
      text = label;
      const good = /GOOD|RECOVERED!|TOUCHDOWN/.test(label);
      cls = good ? "hot" : /FAIL|NO GOOD|MUFF|FUMBLE/.test(label) ? "bad" : "";
      if (result.type === "td") {
        star = result.scorer || returner;
        if (star) text = `${label} · ${nm(star)}`;
        big = ret ? `${ret.kind === "punt" ? "PUNT" : "KICKOFF"} RETURN TD` : label.length < 22 ? label : "TOUCHDOWN";
      } else if (returner && /RETURN/.test(label)) {
        text = `${label} · ${nm(returner)}`;
        const ry = result.returnYds != null ? result.returnYds : 0;
        if (ry >= 30) {
          star = returner;
          big = `${Math.round(ry)}-YARD RETURN`;
          cls = "hot";
        }
      } else if (result.type === "kickRecovery" && result.recoveredBy) {
        text = `${label} · ${nm(result.recoveredBy)}`;
        if (play.onside && result.recoveredBy.team === w.defense) {
          star = result.recoveredBy;
          big = "ONSIDE RECOVERY";
        }
      }
      this.setTicker(w, text, cls, 2600);
      if (star && big) this.bigPlay(w, star, big, null);
      return;
    }
    switch (result.type) {
      case "td":
        star = result.scorer || play.carrier;
        text = `TOUCHDOWN ${nm(star)}!`;
        cls = "hot";
        big = result.defensive || play.turnover ? "DEFENSIVE TOUCHDOWN" : "TOUCHDOWN";
        break;
      case "touchback":
        text = "TOUCHBACK";
        break;
      case "fairCatch":
        text = returner ? `FAIR CATCH · ${nm(returner)}` : "FAIR CATCH";
        break;
      case "downed":
        text = "PUNT DOWNED";
        break;
      case "kickOob":
        text = "KICK OUT OF BOUNDS";
        break;
      case "kickRecovery":
        text = "LOOSE BALL RECOVERED";
        cls = "hot";
        break;
      case "incomplete":
        text = result.why === "breakup" ? "PASS BROKEN UP" : result.why === "drop" ? "DROPPED!" : "INCOMPLETE";
        break;
      case "fg":
        text = result.good ? `${result.distance || ""} YD FIELD GOAL IS GOOD` : `${result.distance || ""} YD FIELD GOAL NO GOOD`;
        cls = result.good ? "hot" : "bad";
        break;
      case "punt":
        text = `PUNT · ${Math.max(0, Math.round(result.spot - w.los))} YDS`;
        break;
      case "safety":
        text = "SAFETY!";
        cls = "hot";
        break;
      case "recovery": {
        const lost = result.recoveredBy && result.recoveredBy.team !== w.offense;
        text = lost ? `FUMBLE! RECOVERED BY ${nm(result.recoveredBy)}` : "FUMBLE · OFFENSE RECOVERS";
        cls = lost ? "bad" : "";
        if (lost) { star = result.recoveredBy; big = "FUMBLE RECOVERY"; }
        break;
      }
      default:
        if (play.turnover) {
          star = play.intBy || play.carrier;
          text = `INTERCEPTED BY ${nm(star)}`;
          cls = "bad";
          big = "INTERCEPTION";
        } else if (result.sack) {
          star = result.tackler || null;
          text = star ? `SACKED BY ${nm(star)} · LOSS OF ${Math.max(0, -yds)}` : `SACK · LOSS OF ${Math.max(0, -yds)}`;
          cls = "bad";
          if (star) big = "SACK";
        } else {
          const by = result.carrier || play.carrier;
          text = (result.type === "oob" ? "OUT OF BOUNDS · " : "") + gain(yds) + (by ? ` · ${nm(by)}` : "");
          if (yds >= 15 && by) {
            star = by;
            big = `${yds}-YARD ${play.completed ? "CATCH" : "RUN"}`;
            cls = "hot";
          }
        }
    }
    this.setTicker(w, text, cls, 2600);
    if (star && big) {
      let pend = null;
      if (!play.turnover && star === play.carrier && result.type !== "incomplete") {
        const spot = result.type === "td" ? (result.defensive ? 0 : 100) : result.spot != null ? result.spot : w.los;
        const yds = Math.round(spot - w.los);
        pend = play.rushPlay ? { rush: yds } : play.completed ? { rec: yds } : null;
      }
      this.bigPlay(w, star, big, pend);
    }
  }
  // pend: yards of the play that just ended, which the sim books only after the dead-ball pause
  statLine(p, pend) {
    const s = p.stats || {};
    const out = [];
    const rush = (s.rushYds || 0) + (pend && pend.rush ? pend.rush : 0);
    const rec = (s.recYds || 0) + (pend && pend.rec ? pend.rec : 0);
    if (s.att) out.push(`${s.comp}/${s.att} ${Math.round(s.passYds)} YDS`);
    if (s.carries) out.push(`${s.carries} CAR ${Math.round(rush)} YDS`);
    if (s.rec) out.push(`${s.rec} REC ${Math.round(rec)} YDS`);
    if (s.td) out.push(`${s.td} TD`);
    if (s.tackles) out.push(`${s.tackles} TKL`);
    if (s.sacks) out.push(`${s.sacks} SACK${s.sacks > 1 ? "S" : ""}`);
    if (s.ints) out.push(`${s.ints} INT`);
    return out.slice(0, 3).join(" · ");
  }
  bigPlay(w, p, title, pend) {
    const b = this.hud.big;
    const d = w.teams[p.team].data;
    b.style.setProperty("--tc", teamColor(d));
    b.replaceChildren();
    const spr = spriteEl(p.id, window.innerHeight < 520 ? 40 : 56, "bp-spr", monName(p.id));
    const txt = el("div", "bp-txt");
    txt.append(el("div", "bp-title", title), el("div", "bp-name", `${monName(p.id)} · ${d.abbr} ${p.slot}`), el("div", "bp-line", this.statLine(p, pend) || "WHAT A PLAY"));
    b.append(el("i", "bp-bar"), spr, txt);
    b.classList.remove("show");
    void b.offsetWidth;
    b.classList.add("show");
    clearTimeout(this.bigTimer);
    this.bigTimer = setTimeout(() => b.classList.remove("show"), 3400);
  }

  // ---------- context: hints (keyboard / gamepad) and the touch button labels ----------
  ctxCode(w) {
    const human = w.human;
    if (!human || w.autoplay || this.flow) return 0;
    const ph = w.phase;
    const u = w.userPlayer;
    if (ph === "PRE_SNAP") {
      if (w.offense === human) return w.play && w.play.kick ? 0 : 1;
      return 2;
    }
    if ((ph !== "LIVE" && ph !== "RETURN") || !u) return 0;
    const b = w.ball;
    const play = w.play || NO_PLAY;
    // a punt in the air and we are receiving: fair-catch window
    if (typeof w.canFairCatch === "function" ? w.canFairCatch(human) : play.kick === "punt" && b.state === "air" && w.defense === human && b.kind === "punt") return 7;
    if (b.state === "held" && b.carrier === u) {
      if (u.pos === "QB" && play.off && play.off.type === "pass" && !play.thrown && !play.qbRunner) return 3;
      return 4;
    }
    const carrier = b.state === "held" ? b.carrier : null;
    const defending = u.team !== (carrier ? carrier.team : w.offense) || (b.state === "air" && u.team !== w.offense);
    if (defending) {
      if (carrier && Math.hypot(carrier.x - u.x, carrier.y - u.y) < CFG.DIVE_RANGE) return 6;
      return 5;
    }
    return 0;
  }
  // Special-teams button labels from the world (kickoff call, PAT call, punt return), or null.
  worldLabels(w) {
    if (typeof w.actionLabels !== "function" || w.autoplay || !w.human || this.flow) return null;
    const ph = w.phase;
    if (ph !== "KICKOFF" && ph !== "PAT_CHOICE" && !(ph === "LIVE" && w.play && w.play.kick)) return null;
    let al = null;
    try {
      al = w.actionLabels();
    } catch (_) {}
    if (!al || (!al.a && !al.b)) return null;
    const c = this.hud.cache;
    if (c.alRawA !== al.a || c.alRawB !== al.b) {
      c.alRawA = al.a;
      c.alRawB = al.b;
      const clean = (t) => (!t || t === "A" || t === "B" ? "" : String(t).replace("✓", "OK").toUpperCase());
      c.alA = clean(al.a);
      c.alB = clean(al.b);
    }
    return c;
  }
  updateContext(w) {
    const inp = this.app.input;
    const dev = inp ? inp.device : "kb";
    const c = this.hud.cache;
    const wl = this.worldLabels(w);
    let code = 0, la, lb;
    if (wl) {
      la = wl.alA;
      lb = wl.alB;
      code = 100;
    } else {
      code = this.ctxCode(w);
      la = CTX_LABELS[code][0];
      lb = CTX_LABELS[code][1];
    }
    // touch labels: [A, B]
    if (inp && inp.setContextLabels) inp.setContextLabels(la, lb);
    // what else the hint shows: the receiver count (1-4 / 1-5 keys) while the QB can throw, and the
    // punt-return direction (returns run toward x = 0, screen left) while the ball is in the air for
    // the human and while he carries it back
    const play = w.play || NO_PLAY;
    let extra = 0;
    if (code === 3) extra = Math.max(1, Math.min(5, (play.progression && play.progression.length) || 4));
    else extra = this.puntReturnHint(w, code, lb);
    const key = ((code * 10 + (dev === "pad" ? 1 : dev === "touch" ? 2 : 0)) * 100 + extra) * 4096 + (BIND.ver % 2048) * 2 + (inp && inp.padStyle === "ps" ? 1 : 0);
    if (c.hintKey === key && (code !== 100 || (c.hintA === la && c.hintB === lb))) return;
    c.hintKey = key;
    c.hintA = la;
    c.hintB = lb;
    const h = this.hud.hint;
    h.replaceChildren();
    if (code === 100) {
      if (dev === "touch") {
        h.classList.add("empty");
        return;
      }
      h.classList.remove("empty");
      const style = inp ? inp.padStyle : "xbox";
      const A = dev === "pad" ? actPad("a", style) : actKey("a");
      const B = dev === "pad" ? actPad("b", style) : actKey("b");
      const item = (k, what) => {
        if (!k) return;
        const sp = el("span", "hi");
        sp.append(keySpan(k), el("span", "ht", what));
        h.append(sp);
      };
      if (la) item(A, la);
      if (lb) item(B, lb);
      if (extra === 90) this.dirHint(h, "THEN RUN");
      if (!la && !lb) h.classList.add("empty");
      return;
    }
    if (dev === "touch" || !code) {
      h.classList.add("empty"); // touch: the receiver buttons (bottom right) say how to throw
      return;
    }
    h.classList.remove("empty");
    // the player's keys and buttons (bindings.js): A's and B's first, the receivers'
    const style = inp ? inp.padStyle : "xbox";
    const A = dev === "pad" ? actPad("a", style) : actKey("a");
    const B = dev === "pad" ? actPad("b", style) : actKey("b");
    const item = (k, what) => {
      if (!k) return;
      const s = el("span", "hi");
      s.append(keySpan(k), el("span", "ht", what));
      h.append(s);
    };
    if (code === 1) item(A, "SNAP");
    else if (code === 2) item(B, "SWITCH DEFENDER");
    else if (code === 3) {
      item(A, "THROW");
      item(B, "NEXT TARGET");
      if (dev === "pad") {
        // the receivers' buttons (as their boxes on the field show them): one keycap of names, or a PlayStation
        // pad's symbols one keycap each
        const pads = [1, 2, 3, 4, 5].slice(0, extra).map((n) => glyphs(`rec${n}`)[0]).filter(Boolean);
        if (pads.length && style === "ps") {
          const s = el("span", "hi");
          for (const g of pads) s.append(keySpan(padKey(g, style)));
          s.append(el("span", "ht", "PICK A RECEIVER"));
          h.append(s);
        } else if (pads.length) item([pads.join(" "), "wide"], "PICK A RECEIVER");
      } else item([recCap(extra), "wide"], "PICK A RECEIVER");
    } else if (code === 4) {
      item(A, "JUKE");
      item(B, "STIFF-ARM");
      if (extra === 91) this.dirHint(h, "RETURN THIS WAY");
    } else if (code === 5 || code === 6) {
      item(A, code === 6 ? "TACKLE!" : "DIVE");
      item(B, "SWITCH");
    } else if (code === 7) {
      item(B, "FAIR CATCH");
      if (extra === 90) this.dirHint(h, "THEN RUN");
    }
  }
  // Punt returns (keyboard / pad hints; touch gets the art group's canvas chevron): 90 while the punt
  // is in the air for the human (fair-catch window), 91 while the human carries it back; else 0.
  puntReturnHint(w, code, lb) {
    const play = w.play;
    if (!play || w.phase !== "LIVE" || !w.human || w.autoplay) return 0;
    const b = w.ball, u = w.userPlayer;
    if (code === 4 && play.ret && play.ret.kind === "punt" && b && b.carrier === u) return 91;
    if (play.kick === "punt" && b && b.state === "air" && (code === 7 || (code === 100 && /FAIR/.test(lb || "")))) return 90;
    return 0;
  }
  // a pixel ◀ arrow + text hint item (the field direction to run)
  dirHint(h, what) {
    const s = el("span", "hi dir");
    s.append(iconImg("arrowL", 10, "pxi"), el("span", "ht", what));
    h.append(s);
  }

  // ---------- scanlines: an overlay canvas whose period is exactly one art pixel ----------
  syncScanlines() {
    const sc = this.scan;
    if (!sc.cv) return;
    const on = !!(this.app.settings && this.app.settings.scanlines);
    sc.cv.classList.toggle("on", on);
    if (!on) {
      if (sc.raf) cancelAnimationFrame(sc.raf);
      sc.raf = 0;
      sc.P = -1;
      return;
    }
    const step = () => {
      sc.raf = 0;
      if (!(this.app.settings && this.app.settings.scanlines)) return;
      const r = this.app.renderer;
      const d = Math.min(3, window.devicePixelRatio || 1);
      let P = 0;
      if (r && r.k > 0) {
        const zoom = typeof this.app.zoomLevel === "function" ? this.app.zoomLevel() : 0;
        P = (r.s + zoom * r.k) / r.k; // device px per art px
      }
      const W = Math.round(window.innerWidth * d), H = Math.round(window.innerHeight * d);
      if (P !== sc.P || W !== sc.w || H !== sc.h) {
        sc.P = P;
        sc.w = W;
        sc.h = H;
        const cv = sc.cv;
        cv.width = W;
        cv.height = H;
        cv.style.width = window.innerWidth + "px";
        cv.style.height = window.innerHeight + "px";
        const g = cv.getContext("2d");
        g.clearRect(0, 0, W, H);
        if (Number.isInteger(P) && P >= 2) {
          g.fillStyle = P >= 4 ? "rgba(0,0,0,0.26)" : "rgba(0,0,0,0.16)";
          for (let y = P - 1; y < H; y += P) g.fillRect(0, y, W, 1);
        }
      }
      sc.raf = requestAnimationFrame(step);
    };
    if (!sc.raf) {
      step();
      if (!sc.raf) sc.raf = requestAnimationFrame(step);
    }
  }

  // ---------- overlays ----------
  modal(cls, title) {
    this.closeModal();
    const m = el("div", "modal scroll-ok " + cls);
    const p = title ? this.panel(title, "") : el("div", "panel");
    m.append(p);
    this.root.appendChild(m);
    this.modalEl = m;
    return p;
  }
  closeModal() {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
      this.keyHandler = null;
      this.flowDirty = true;
    }
  }
  scoreLine(w) {
    const line = el("div", "score-line");
    const team = (side) => {
      const d = w.teams[side].data;
      const t = el("div", "sl-team " + side);
      t.style.setProperty("--tc", teamColor(d));
      t.style.setProperty("--tci", inkOn(teamColor(d)));
      t.append(el("span", "sl-abbr", d.abbr), el("span", "sl-score", String(w.score[side])));
      return t;
    };
    line.append(team("home"), el("span", "sl-dash", "-"), team("away"));
    return line;
  }
  showPause(onResume, onRestart, onQuit) {
    this.pauseCbs = [onResume, onRestart, onQuit];
    const p = this.modal("pause", "PAUSED");
    const w = this.app.world;
    if (w) {
      p.append(this.scoreLine(w));
      p.append(el("div", "pause-sub", w.overtime ? "OVERTIME" : `${ord(Math.min(4, w.quarter))} QUARTER · ${fmtClock(w.clock)}`));
    }
    const col = el("div", "menu");
    const r = this.button("RESUME", "primary", onResume);
    const reopen = () => this.showPause(...this.pauseCbs);
    col.append(
      r,
      this.button("STATS", "", () => this.showPauseStats()),
      this.button("SETTINGS", "", () => {
        this.closeModal();
        this.showSettings(() => {
          this.clear();
          reopen();
        });
      }),
      this.button("HOW TO PLAY", "", () => {
        this.closeModal();
        this.showHelp(() => {
          this.clear();
          reopen();
        });
      }),
      ...this.hookButtons("pause"),
      this.button("RESTART", "", onRestart),
      this.button("QUIT TO TITLE", "", onQuit),
    );
    p.append(col);
    this.navKeys(col, onResume, (e) => {
      if (BIND.pauseKeys.has(keyId(e)) && !e.repeat) {
        onResume();
        return true;
      }
      return false;
    });
    this.focusLater(r);
  }
  // pause → STATS: the box score and leaders so far
  showPauseStats() {
    const w = this.app.world;
    if (!w) return;
    const cbs = this.pauseCbs;
    const p = this.modal("pause pstats", "GAME STATS");
    p.classList.add("wide");
    p.append(this.scoreLine(w), this.statTabs(w, "box"));
    const row = el("div", "row");
    const back = () => this.showPause(...cbs);
    const b = this.button("BACK", "", back);
    row.append(b);
    p.append(row);
    this.navKeys(p, back);
    this.focusLater(b);
  }
  statRows(w) {
    const sh = w.stats.home, sa = w.stats.away;
    const rows = [];
    const r = (label, a, b) => rows.push([label, a, b]);
    r("TOTAL YARDS", Math.round(sh.totalYds), Math.round(sa.totalYds));
    r("PASSING", `${sh.comp}/${sh.att} · ${Math.round(sh.passYds)}`, `${sa.comp}/${sa.att} · ${Math.round(sa.passYds)}`);
    r("RUSHING", `${sh.rushes} · ${Math.round(sh.rushYds)}`, `${sa.rushes} · ${Math.round(sa.rushYds)}`);
    r("FIRST DOWNS", sh.firstDowns, sa.firstDowns);
    if (sh.thirdAtt != null) r("3RD DOWNS", `${sh.thirdConv}/${sh.thirdAtt}`, `${sa.thirdConv}/${sa.thirdAtt}`);
    const ret = (s) => (s.krYds != null || s.prYds != null ? (s.krYds || 0) + (s.prYds || 0) : s.retYds != null ? s.retYds : s.returnYds != null ? s.returnYds : s.kickRetYds != null || s.puntRetYds != null ? (s.kickRetYds || 0) + (s.puntRetYds || 0) : null);
    if (ret(sh) != null || ret(sa) != null) r("RETURN YARDS", Math.round(ret(sh) || 0), Math.round(ret(sa) || 0));
    if ((sh.twoPtAtt || 0) + (sa.twoPtAtt || 0) > 0) r("2-PT TRIES", `${sh.twoPtMade || 0}/${sh.twoPtAtt || 0}`, `${sa.twoPtMade || 0}/${sa.twoPtAtt || 0}`);
    r("SACKS", sh.sacks, sa.sacks);
    r("TURNOVERS", sh.ints + sh.fumblesLost, sa.ints + sa.fumblesLost);
    const lp = (s) => (s.longest != null ? s.longest : s.longPlay != null ? s.longPlay : null);
    if (lp(sh) != null || lp(sa) != null) r("LONGEST PLAY", Math.round(lp(sh) || 0), Math.round(lp(sa) || 0));
    r("TIME OF POSS", fmtClock(this.topOf(w, "home")), fmtClock(this.topOf(w, "away")));
    return rows;
  }
  statTable(w) {
    const t = el("div", "stat-table");
    const H = w.teams.home.data, A = w.teams.away.data;
    const hdr = el("div", "st-row st-head");
    const ha = el("span", "st-a", H.abbr), hb = el("span", "st-b", A.abbr);
    ha.style.setProperty("--tc", teamColor(H));
    hb.style.setProperty("--tc", teamColor(A));
    hdr.append(ha, el("span", "st-l", "TEAM STATS"), hb);
    t.append(hdr);
    for (const [label, a, b] of this.statRows(w)) {
      const r = el("div", "st-row" + (MINOR_STATS.has(label) ? " minor" : ""));
      const na = Number(String(a).split(/[ /]/).pop()), nb = Number(String(b).split(/[ /]/).pop());
      const better = label === "TURNOVERS" || label === "SACKS" ? (na < nb ? "a" : nb < na ? "b" : "") : na > nb ? "a" : nb > na ? "b" : "";
      r.append(el("span", "st-a" + (better === "a" ? " up" : ""), String(a)), el("span", "st-l", label), el("span", "st-b" + (better === "b" ? " up" : ""), String(b)));
      t.append(r);
    }
    return t;
  }
  leaders(w) {
    const box = el("div", "leaders");
    const pick = (side, score) => {
      let b = null, bv = 0;
      for (const p of w.teams[side].all) {
        const v = score(p.stats || {});
        if (v > bv) { bv = v; b = p; }
      }
      return b;
    };
    const cats = [
      ["PASSING", (s) => (s.att ? 1000 + s.passYds : 0), (s) => `${s.comp}/${s.att} · ${Math.round(s.passYds)} YDS`],
      ["RUSHING", (s) => (s.carries ? 1000 + s.rushYds : 0), (s) => `${s.carries} CAR · ${Math.round(s.rushYds)} YDS`],
      ["RECEIVING", (s) => (s.rec ? 1000 + s.recYds : 0), (s) => `${s.rec} REC · ${Math.round(s.recYds)} YDS`],
      ["DEFENSE", (s) => s.tackles + s.sacks * 2 + s.ints * 3, (s) => [`${s.tackles} TKL`, s.sacks ? `${s.sacks} SK` : "", s.ints ? `${s.ints} INT` : ""].filter(Boolean).join(" · ")],
    ];
    const hdr = el("div", "ld-row ld-head");
    hdr.append(el("span", "ld-c", w.teams.home.data.abbr), el("span", "ld-l", "LEADERS"), el("span", "ld-c", w.teams.away.data.abbr));
    box.append(hdr);
    const small = window.innerHeight < 520 ? 22 : 30;
    for (const [label, score, line] of cats) {
      const r = el("div", "ld-row");
      const cell = (side) => {
        const c = el("div", "ld-c");
        const p = pick(side, score);
        if (!p) {
          c.append(el("span", "ld-none", "-"));
          return c;
        }
        c.append(spriteEl(p.id, small, "ld-spr", monName(p.id)));
        const t = el("div", "ld-t");
        t.append(el("b", "", monName(p.id)), el("span", "", line(p.stats) + (p.stats.td ? ` · ${p.stats.td} TD` : "")));
        c.append(t);
        return c;
      };
      r.append(cell("home"), el("span", "ld-l", label), cell("away"));
      box.append(r);
    }
    return box;
  }
  statTabs(w, which) {
    const wrap = el("div", "stat-tabs");
    const tabs = el("div", "tabs small");
    const body = el("div", "stat-body");
    const show = (k) => {
      body.replaceChildren(k === "lead" ? this.leaders(w) : this.statTable(w));
      for (const b of tabs.children) b.classList.toggle("on", b.dataset.k === k);
    };
    for (const [k, label] of [["box", "BOX SCORE"], ["lead", "LEADERS"]]) {
      const b = this.button(label, "tab", () => show(k));
      b.dataset.k = k;
      tabs.append(b);
    }
    wrap.append(tabs, body);
    show(which || "box");
    return wrap;
  }
  showHalftime(w, onContinue) {
    const p = this.modal("halftime", "HALFTIME");
    p.classList.add("wide");
    p.append(this.scoreLine(w), this.statTabs(w, "box"));
    const r = this.button("START 2ND HALF", "primary", onContinue);
    const col = el("div", "row");
    col.append(r, ...this.hookButtons("halftime"));
    p.append(col);
    this.navKeys(p, null);
    this.focusLater(r);
  }
  showResults(w, onRematch, onNewOpp, onQuit) {
    const p = this.modal("results", w.overtime ? "FINAL · OVERTIME" : "FINAL");
    p.classList.add("wide");
    const human = w.human || "home";
    const won = w.winner === human, tie = w.winner === "tie";
    const banner = el("div", "result-banner " + (tie ? "tie" : won ? "win" : "loss"));
    if (won) banner.append(iconImg("trophy", window.innerHeight < 520 ? 22 : 40, "pxi trophy"));
    banner.append(el("span", "", tie ? "TIE GAME" : won ? "VICTORY!" : "DEFEAT"));
    if (won) banner.append(iconImg("trophy", window.innerHeight < 520 ? 22 : 40, "pxi trophy"));
    p.append(banner);
    p.append(this.scoreLine(w));
    const body = el("div", "results-body");
    const mvp = w.mvp();
    if (mvp) {
      const card = el("div", "mvp");
      const d = w.teams[mvp.team].data;
      card.style.setProperty("--tc", teamColor(d));
      card.append(el("div", "mvp-label", "PLAYER OF THE GAME"));
      const stage = el("div", "mvp-stage");
      stage.append(spriteEl(mvp.id, window.innerHeight < 520 ? 64 : 128, "mvp-spr", monName(mvp.id)));
      card.append(stage, el("div", "mvp-name", monName(mvp.id)), el("div", "mvp-team", `${d.abbr} · ${mvp.slot}`), el("div", "mvp-line", this.statLine(mvp) || "A MONSTER GAME"));
      body.append(card);
    }
    body.append(this.statTabs(w, "box"));
    p.append(body);
    const row = el("div", "row");
    const r = this.button("REMATCH", "primary", onRematch);
    row.append(r, ...this.hookButtons("results"), this.button("NEW OPPONENT", "", onNewOpp), this.button("BACK TO ALL-22", "", onQuit));
    p.append(row);
    this.navKeys(p, null);
    this.focusLater(r);
  }
}
