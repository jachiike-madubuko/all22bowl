// Keyboard + touch + gamepad → intents {mx, my, a, b, aPressed, bPressed, num, tapX/tapY (CSS px), pause}.
// The app passes the state to world.update(dt, input) (read-only for the world) and calls
// endTick() once the world has consumed the edge presses (aPressed/bPressed/num/tap).
// Touch: a floating virtual joystick on the left (appears where the thumb lands), A (big) and B on
// the right with pressed states and context labels (SNAP / JUKE / TACKLE / SWITCH ...); while the QB
// can throw, a row of receiver buttons (1-5, like ALL-22 PRO's) takes their place: tap one to throw.
// A mouse click on a receiver throws to him too (desktop).
// Gamepad (standard mapping): stick / D-pad move, A = A, B = B, X / Y / LB / RB / RT = receivers 1–5,
// Start = pause. While the game controls are off (menus, play call, pause...) the pad drives the
// menus by synthesizing keys: D-pad/stick = arrows (auto-repeat), A = Enter, B = Escape, LB/RB = Q/E,
// Start = whatever the UI says (menuKeyFor). The FLIP button (R3 by default) goes to the UI (onPadAction "flip": the play
// call's mirror toggle).
// The keys and buttons of the game controls are the player's (bindings.js B: movement, A, B, the receivers, pause);
// the menus' keys and buttons never change, but SWAP A AND B swaps the menus' A and B as well. While the remap screen
// waits for a key or button (capture set), the next press goes to it and nowhere else.
// `device` is the last input used ('kb' | 'touch' | 'pad'): hints and labels follow it; padStyle ('xbox' | 'ps') is
// the controller's look (PlayStation symbols for a PlayStation pad).
import { touchSkins, crispScale } from "./ui-art.js";
import { B, keyId, padStyleOf } from "./bindings.js";

const PAD_MENU_DEFAULT = { a: "Enter", b: "Escape", start: "Enter", lb: "KeyQ", rb: "KeyE" };
const PAD_BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };
const MENU_BTNS = [["a", 0], ["b", 1], ["start", 9], ["lb", 4], ["rb", 5]]; // the buttons that drive the menus
// Floating stick tuning, in units of R (the knob's travel = 0.42 × the base sprite ≈ 45 CSS px on a phone; ALL-22 PRO
// uses R 40 / follow 64 / dead 6 / full 44 px). The base FOLLOWS the thumb once it is more than FOLLOW·R away, so a
// cut-back reverses after ~FOLLOW+DEAD of travel however far the thumb drifted. Output: radial dead zone, then
// MIN → 1 linearly up to FULL·R (top speed before the knob hits the rim; leaving the dead zone always reads as a
// real push, |v| ≥ 0.2 is what the world calls "active"), a soft ±SNAP° pull onto the 4 axes (straight runs stay
// straight, a vertical run doesn't wobble the sprite's facing; still fully analog in between, no 8-way steps), and
// light adaptive smoothing (thumb tremble is eased, any deliberate change passes the same frame).
const STICK = { DEAD: 0.14, FULL: 0.85, FOLLOW: 1.2, MIN: 0.22, SNAP: (6 * Math.PI) / 180 };
// soft axis snap: deviation δ from the nearest axis → 0 inside ±SNAP, stretched back to 45° at the diagonals (continuous)
function snapAxes(a) {
  const q = Math.PI / 2, h = Math.PI / 4, ax = Math.round(a / q) * q, off = a - ax, ao = Math.abs(off);
  return ax + Math.sign(off) * (ao <= STICK.SNAP ? 0 : ((ao - STICK.SNAP) / (h - STICK.SNAP)) * h);
}


// Which listed gamepad to read. A desktop can list other devices as gamepads ahead of the controller in use (a wheel
// or joystick, a virtual pad from controller software, even some keyboards and mice), and reading only the first one
// left that controller dead ("it detects that it is plugged in but no buttons work"). So the pad that last had a
// button pressed or a stick pushed is the one read; until one has, a standard-mapping pad (an Xbox or PlayStation
// controller as the browser knows it) comes before others. A stuck axis or button (a pedal, a throttle) never
// changes, so it never takes over. S: { sig: {}, active: null }, kept by the caller.
function pickPad(list, S) {
  let first = null, std = null;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || p.connected === false || !p.buttons || !p.buttons.length) continue;
    if (!first) first = p;
    if (!std && p.mapping === "standard") std = p;
    let sig = 0;
    for (let b = 0; b < p.buttons.length && b < 17; b++) { const x = p.buttons[b]; if (x && (x.pressed || x.value > 0.5)) sig |= 1 << b; }
    const axes = p.axes || [];
    for (let a = 0; a < 4 && a < axes.length; a++) { if (axes[a] > 0.6) sig |= 1 << (17 + 2 * a); else if (axes[a] < -0.6) sig |= 1 << (18 + 2 * a); }
    const was = S.sig[p.index];
    S.sig[p.index] = sig;
    if (was !== undefined && sig !== was && sig !== 0) S.active = p.index; // something new pressed or pushed on it
  }
  const act = S.active != null ? list[S.active] : null;
  return act && act.connected !== false && act.buttons && act.buttons.length ? act : std || first;
}

export class Input {
  constructor(root) {
    this.down = new Set();
    this._enabled = true;
    this.state = { mx: 0, my: 0, a: false, b: false, aPressed: false, bPressed: false, num: 0, tapX: null, tapY: null, tapPending: false, pause: false };
    // floating stick: base centre (ox, oy) and thumb (x, y) in layer px; lx/ly = layer origin (client px, cached at
    // touch-down); vx/vy = the smoothed output; cap = the layer holds pointer capture for it
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0, R: 46, lx: 0, ly: 0, vx: 0, vy: 0, cap: false };
    this.stickBase = 108;
    this.stickArt = 3;
    this.btn = { a: null, b: null };
    this.lastKey = "";
    this.touchMode = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
    this._device = this.touchMode ? "touch" : "kb";
    Input.markDevice(this._device);
    this.onDevice = null;
    this.onAny = null;
    this.menuKeyFor = null;
    this.pad = { mx: 0, my: 0, a: false, b: false, prev: new Array(17).fill(false), now: new Array(17).fill(false), dir: null, repeatAt: 0, raf: 0, seen: false, id: "", pick: { sig: {}, active: null } };
    this.padStyle = "xbox";
    this.capture = null; // the remap screen's handler for the next press ({dev: "k", id} | {dev: "p", i}), or null
    this.capKey = null;
    this.onPadAction = null; // the UI's handler for a button bound to SOUND ON / OFF ("mute") or FLIP PLAY ("flip")
    this.uiLabels = false;
    this.labels = ["", ""];
    window.addEventListener("keydown", (e) => this.key(e, true));
    window.addEventListener("keyup", (e) => this.key(e, false));
    window.addEventListener("blur", () => {
      this.down.clear();
      this.capKey = null;
      this.state.a = this.state.b = false;
    });
    window.addEventListener("pointerdown", (e) => {
      if (e.isTrusted) this.device = e.pointerType === "touch" || e.pointerType === "pen" ? "touch" : "kb";
    }, true);
    if (this.touchMode) document.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("gamepadconnected", () => this.startPads());
    try {
      if (navigator.getGamepads && [...navigator.getGamepads()].some((g) => g && g.connected)) this.startPads();
    } catch (_) {}
    this.buildTouch(root);
  }
  // Last input device used: 'kb' | 'touch' | 'pad' (hints, labels and "PRESS START" follow it).
  get device() {
    return this._device;
  }
  set device(v) {
    if (v === this._device) return;
    this._device = v;
    Input.markDevice(v);
    if (this.onDevice) try { this.onDevice(v); } catch (_) {}
  }
  // <html class="dev-touch"> while touch is the last device: CSS (and other modules' hints) hide key glyphs
  static markDevice(v) {
    try { document.documentElement.classList.toggle("dev-touch", v === "touch"); } catch (_) {}
  }
  // Game controls on/off (menus, play call, pause turn them off; the touch buttons hide with them).
  get enabled() {
    return this._enabled;
  }
  set enabled(v) {
    this._enabled = !!v;
    if (this.layer) this.layer.classList.toggle("off", !v);
    if (!v) {
      this.btn.a = this.btn.b = null;
      if (this.aEl) this.aEl.classList.remove("on");
      if (this.bEl) this.bEl.classList.remove("on");
    }
  }
  key(e, isDown) {
    // raw: the physical key (held keys are tracked by it: both Shift keys stay separate, as before); code: its id in
    // the bindings (both Shift keys are "Shift")
    const raw = e.code || (e.key === " " ? "Space" : e.key), code = keyId(e);
    const mod = e.metaKey || e.ctrlKey || e.altKey;
    if (isDown && e.isTrusted) this.device = "kb";
    // the remap screen is waiting for a key: this one is the answer (Esc: it cancels), and nothing else sees it (a
    // browser shortcut, Cmd / Ctrl + a key, still goes to the browser)
    if (this.capture && isDown && !mod) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) { this.capKey = code; const f = this.capture; f({ dev: "k", id: code }); }
      return;
    }
    if (!isDown && this.capKey === code) { this.capKey = null; e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (this.onAny && isDown) this.onAny(e);
    // PAUSE and SOUND work in menus too: their keys never reach the browser's own uses (Firefox's quick find on / ')
    if (!mod && (B.pauseKeys.has(code) || B.muteKeys.has(code))) e.preventDefault();
    if (!this.enabled) {
      if (!isDown) this.down.delete(raw); // let go during a menu, the play call or pause: up all the same
      return;
    }
    if (B.move.has(code) || B.aKeys.has(code) || B.bKeys.has(code) || B.rec.has(code)) e.preventDefault();
    if (isDown) {
      if (this.down.has(raw)) return;
      this.down.add(raw);
      // a key repeat here is a key still held from a menu (Space that picked the play or hit RESUME): held, not pressed
      if (e.repeat) return;
      if (B.aKeys.has(code)) this.state.aPressed = true;
      if (B.bKeys.has(code)) this.state.bPressed = true;
      const n = B.rec.get(code);
      if (n) this.state.num = n;
      if (code === "Escape" || B.pauseKeys.has(code)) this.state.pause = true;
    } else this.down.delete(raw);
  }
  // Called once per frame: refresh held axes (keyboard, joystick, gamepad).
  poll() {
    const s = this.state;
    let x = 0, y = 0, aK = false, bK = false;
    for (const k of this.down) {
      const c = k === "ShiftLeft" || k === "ShiftRight" ? "Shift" : k;
      const m = B.move.get(c);
      if (m) {
        x += m[0];
        y += m[1];
      }
      if (B.aKeys.has(c)) aK = true;
      if (B.bKeys.has(c)) bK = true;
    }
    if (this.joy.id != null) {
      this.stickVec();
      x = this.joy.vx;
      y = this.joy.vy;
    } else if (!x && !y && (this.pad.mx || this.pad.my)) {
      x = this.pad.mx;
      y = this.pad.my;
    }
    const l = Math.hypot(x, y);
    s.mx = l > 1 ? x / l : x;
    s.my = l > 1 ? y / l : y;
    const a = this.btn.a != null || this.pad.a || aK, b = this.btn.b != null || this.pad.b || bK;
    s.a = a;
    s.b = b;
    return s;
  }
  // Floating stick → joy.vx/vy (screen axes, |v| ≤ 1), once per frame from the newest thumb position (see STICK).
  stickVec() {
    const j = this.joy, R = j.R;
    const dx = j.x - j.ox, dy = j.y - j.oy, d = Math.hypot(dx, dy);
    const dead = R * STICK.DEAD, full = R * STICK.FULL;
    let tx = 0, ty = 0;
    if (d > dead) {
      const m = STICK.MIN + (1 - STICK.MIN) * Math.min(1, (d - dead) / (full - dead));
      const a = snapAxes(Math.atan2(dy, dx));
      tx = Math.cos(a) * m;
      ty = Math.sin(a) * m;
      if (Math.abs(tx) < 1e-9) tx = 0;
      if (Math.abs(ty) < 1e-9) ty = 0;
    }
    // ease only small changes (tremble); a stop or any change ≥ ~0.25 lands this frame
    const ex = tx - j.vx, ey = ty - j.vy;
    const k = !tx && !ty ? 1 : Math.min(1, 0.45 + 2.2 * Math.hypot(ex, ey));
    j.vx += ex * k;
    j.vy += ey * k;
  }
  // Edge presses are one-shot: cleared after the world step that used them.
  endTick() {
    const s = this.state;
    s.aPressed = s.bPressed = false;
    s.num = 0;
    s.tapX = s.tapY = null;
  }
  clearPresses() {
    this.endTick();
  }

  // ---------- gamepad ----------
  startPads() {
    if (this.pad.raf) return;
    const loop = () => {
      this.pad.raf = requestAnimationFrame(loop);
      try {
        this.pollPads();
      } catch (_) {}
    };
    this.pad.raf = requestAnimationFrame(loop);
  }
  pollPads() {
    const P = this.pad;
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pickPad(list, P.pick);
    this.lastPad = gp;
    if (!gp) {
      P.mx = P.my = 0;
      P.a = P.b = false;
      P.prev.fill(false);
      P.dir = null;
      return;
    }
    if (gp.id !== P.id) {
      P.id = gp.id;
      const st = padStyleOf(gp.id);
      if (st !== this.padStyle) { this.padStyle = st; if (this.onDevice) try { this.onDevice(this.device); } catch (_) {} }
    }
    const pressed = (i) => {
      const b = gp.buttons[i];
      return !!(b && (b.pressed || b.value > 0.5));
    };
    let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
    const mag = Math.hypot(x, y);
    if (mag < 0.24) x = y = 0;
    else {
      const k = Math.min(1, (mag - 0.24) / 0.6) / mag;
      x *= k;
      y *= k;
    }
    if (pressed(PAD_BTN.up)) y = -1;
    if (pressed(PAD_BTN.down)) y = 1;
    if (pressed(PAD_BTN.left)) x = -1;
    if (pressed(PAD_BTN.right)) x = 1;
    const now = P.now, prev = P.prev;
    for (let i = 0; i < 17; i++) now[i] = pressed(i);
    const edge = (i) => this.padEdge(i), any = (l) => this.padAny(l), anyEdge = (l) => this.padAnyEdge(l);
    // the remap screen is waiting for a button: the next one pressed is the answer (START / the D-pad cancel)
    if (this.capture) {
      let hit = -1;
      for (let i = 0; i < 17 && hit < 0; i++) if (edge(i)) hit = i;
      for (let i = 0; i < 17; i++) prev[i] = now[i];
      P.mx = P.my = 0; P.a = P.b = false; P.dir = null;
      if (hit >= 0) { this.device = "pad"; P.seen = true; const f = this.capture; f({ dev: "p", i: hit }); }
      return;
    }
    // the buttons in play make the controller the device in use (as the stick and the D-pad do)
    let active = mag > 0.5 || x !== 0 || y !== 0 || now[9] || any(B.active);
    if (active) {
      this.device = "pad";
      P.seen = true;
    }
    if (this.enabled) {
      P.mx = x;
      P.my = y;
      P.a = any(B.aPad);
      P.b = any(B.bPad);
      if (anyEdge(B.aPad)) this.state.aPressed = true;
      if (anyEdge(B.bPad)) this.state.bPressed = true;
      for (let r = 0; r < 5; r++) if (anyEdge(B.recPad[r])) this.state.num = r + 1;
      if (edge(9) || anyEdge(B.pausePad)) this.state.pause = true;
      if (anyEdge(B.mutePad) && this.onPadAction) this.onPadAction("mute");
      P.dir = null;
    } else {
      P.mx = P.my = 0;
      P.a = P.b = false;
      // SWAP A AND B: the menus' A and B swap too (bindings.js B.ok / B.back)
      for (let j = 0; j < MENU_BTNS.length; j++) {
        const k = MENU_BTNS[j][0], i = MENU_BTNS[j][1];
        if (!edge(i === 0 ? B.ok : i === 1 ? B.back : i)) continue;
        const code = this.menuKeyFor ? this.menuKeyFor(k) : PAD_MENU_DEFAULT[k];
        this.synth(code === undefined ? PAD_MENU_DEFAULT[k] : code);
      }
      if (anyEdge(B.mutePad) && this.onPadAction) this.onPadAction("mute");
      if (anyEdge(B.flipPad) && this.onPadAction) this.onPadAction("flip"); // (the play call: game controls are off)
      let dir = null;
      if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) dir = Math.abs(x) > Math.abs(y) ? (x > 0 ? "ArrowRight" : "ArrowLeft") : y > 0 ? "ArrowDown" : "ArrowUp";
      const now = performance.now();
      if (dir !== P.dir) {
        P.dir = dir;
        if (dir) {
          this.synth(dir);
          P.repeatAt = now + 380;
        }
      } else if (dir && now >= P.repeatAt) {
        this.synth(dir, true);
        P.repeatAt = now + 110;
      }
    }
    for (let i = 0; i < 17; i++) prev[i] = now[i];
  }
  // this poll's buttons (pad.now) against the last one's (pad.prev): pressed just now, any of a list held / just pressed
  padEdge(i) { const P = this.pad; return P.now[i] && !P.prev[i]; }
  padAny(l) { const now = this.pad.now; for (let i = 0; i < l.length; i++) if (now[l[i]]) return true; return false; }
  padAnyEdge(l) { for (let i = 0; i < l.length; i++) if (this.padEdge(l[i])) return true; return false; }
  // dual-rumble where the browser supports it (Chrome / Edge); silently nothing elsewhere
  rumble(strong = 0.5, weak = 0.5, ms = 150) {
    const a = this.lastPad && this.lastPad.vibrationActuator;
    if (!a || !a.playEffect) return;
    try {
      const r = a.playEffect("dual-rumble", { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
      if (r && r.catch) r.catch(() => {});
    } catch (_) {}
  }
  synth(code, repeat = false) {
    if (!code) return;
    const key = code.startsWith("Key") ? code.slice(3).toLowerCase() : code === "Space" ? " " : code;
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : window;
    const init = { code, key, bubbles: true, cancelable: true, repeat };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  // ---------- touch ----------
  buildTouch(root) {
    const layer = document.createElement("div");
    layer.className = "touch-layer";
    layer.setAttribute("aria-hidden", "true");
    const skins = touchSkins();
    const css = layer.style;
    css.setProperty("--sk-base", `url("${skins.base}")`);
    css.setProperty("--sk-knob", `url("${skins.knob}")`);
    css.setProperty("--sk-a", `url("${skins.a}")`);
    css.setProperty("--sk-a-on", `url("${skins.aOn}")`);
    css.setProperty("--sk-b", `url("${skins.b}")`);
    css.setProperty("--sk-b-on", `url("${skins.bOn}")`);
    const base = document.createElement("div");
    base.className = "joy-base";
    const knob = document.createElement("div");
    knob.className = "joy-knob";
    base.appendChild(knob);
    const mk = (cls, label) => {
      const b = document.createElement("div");
      b.className = "tbtn " + cls;
      const t = document.createElement("span");
      t.className = "tb-letter";
      t.textContent = label;
      b.appendChild(t);
      return b;
    };
    const A = mk("tbtn-a", "A");
    const B = mk("tbtn-b", "B");
    for (const n of [A, B]) {
      n.dataset.label = "";
      n.classList.add("idle");
    }
    const hint = document.createElement("div");
    hint.className = "joy-hint";
    hint.textContent = "DRAG HERE TO MOVE";
    // the pocket: a button per receiver (1-5, the numbers over them on the field), coloured by how open he is
    const recRow = document.createElement("div");
    recRow.className = "rec-row";
    const recs = [];
    for (let k = 1; k <= 5; k++) {
      const r = document.createElement("div");
      r.className = "rec-btn off";
      const n = document.createElement("b");
      n.textContent = String(k);
      r.append(n, document.createElement("span"));
      r.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.enabled || r.classList.contains("off")) return;
        this.state.num = k;
        r.classList.add("on");
        if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
      });
      for (const t of ["pointerup", "pointercancel", "pointerleave"]) r.addEventListener(t, () => r.classList.remove("on"));
      recs.push(r);
      recRow.appendChild(r);
    }
    layer.append(hint, base, A, B, recRow);
    this.recRow = recRow;
    this.recEls = recs;
    this.recKey = "";
    this.recRowCss = 0;
    this.recRowW = 0;
    root.appendChild(layer);
    this.layer = layer;
    this.joyEl = base;
    this.knobEl = knob;
    this.aEl = A;
    this.bEl = B;
    this.hintEl = hint;
    this.sizeTouch();
    window.addEventListener("resize", () => this.sizeTouch());
    const press = (which, e) => {
      this.btn[which] = e.pointerId;
      if (which === "a") this.state.aPressed = true;
      else this.state.bPressed = true;
      (which === "a" ? A : B).classList.add("on");
      if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) {}
    };
    const release = (id) => {
      for (const w of ["a", "b"]) if (this.btn[w] === id) {
        this.btn[w] = null;
        (w === "a" ? A : B).classList.remove("on");
      }
      if (this.joy.id === id) this.dropStick();
    };
    for (const [which, node] of [["a", A], ["b", B]]) {
      node.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.enabled) return;
        try { node.setPointerCapture(e.pointerId); } catch (_) {}
        press(which, e);
      });
      node.addEventListener("pointerup", (e) => release(e.pointerId));
      node.addEventListener("pointercancel", (e) => release(e.pointerId));
      node.addEventListener("lostpointercapture", (e) => release(e.pointerId));
    }
    layer.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const r = layer.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const j = this.joy;
      // a stick whose finger the browser dropped without an up/cancel (capture gone) gives way to the new touch
      if (j.id != null && j.cap) {
        let held = true;
        try { held = layer.hasPointerCapture(j.id); } catch (_) {}
        if (!held) this.dropStick();
      }
      let cap = false;
      try { layer.setPointerCapture(e.pointerId); cap = layer.hasPointerCapture(e.pointerId); } catch (_) {}
      if (x < r.width * 0.45 && e.pointerType !== "mouse" && j.id == null) {
        // the base lands centred under the thumb (dead zone: nothing moves until the thumb does)
        j.id = e.pointerId;
        j.cap = cap;
        j.lx = r.left;
        j.ly = r.top;
        j.ox = j.x = x;
        j.oy = j.y = y;
        j.vx = j.vy = 0;
        this.placeStick();
        base.classList.add("on");
        layer.classList.add("used");
      } else if (e.pointerType === "mouse") {
        // desktop: a click on a receiver throws to him (the world resolves it); touches use the buttons
        this.state.tapX = e.clientX;
        this.state.tapY = e.clientY;
        this.state.tapPending = true;
      }
    });
    layer.addEventListener("pointermove", (e) => {
      const j = this.joy;
      if (e.pointerId !== j.id) return;
      j.x = e.clientX - j.lx;
      j.y = e.clientY - j.ly;
      // past the follow radius the base slides after the thumb (PRO's floating stick), so reversing never needs
      // more than ~FOLLOW·R of travel
      const dx = j.x - j.ox, dy = j.y - j.oy, d = Math.hypot(dx, dy), F = j.R * STICK.FOLLOW;
      if (d > F) {
        j.ox = j.x - (dx / d) * F;
        j.oy = j.y - (dy / d) * F;
      }
      this.placeStick();
    });
    const up = (e) => release(e.pointerId);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
    layer.addEventListener("lostpointercapture", up);
    layer.addEventListener("contextmenu", (e) => e.preventDefault());
    this.setTouchVisible(false);
  }
  // Draw the stick: the base centred on (ox, oy) with its top-left on the device-pixel grid; the knob at the
  // thumb's offset (clamped to R) in whole art pixels of the stick sprite, so it stays on the base's pixel grid.
  placeStick() {
    const j = this.joy, dp = Math.min(3, Math.max(1, window.devicePixelRatio || 1)), half = this.stickBase / 2, art = this.stickArt;
    const bx = Math.round((j.ox - half) * dp) / dp, by = Math.round((j.oy - half) * dp) / dp;
    this.joyEl.style.transform = `translate(${bx}px, ${by}px)`;
    const dx = j.x - j.ox, dy = j.y - j.oy, d = Math.hypot(dx, dy), k = d > j.R ? j.R / d : 1;
    const kx = Math.round((dx * k) / art) * art, ky = Math.round((dy * k) / art) * art;
    this.knobEl.style.transform = kx || ky ? `translate(${kx}px, ${ky}px)` : "";
  }
  // let go of the stick: no output, the base fades back to its home spot
  dropStick() {
    const j = this.joy;
    j.id = null;
    j.cap = false;
    j.vx = j.vy = 0;
    if (!this.joyEl) return;
    this.joyEl.classList.remove("on");
    this.joyEl.style.transform = "";
    this.knobEl.style.transform = "";
  }
  // pixel skins at whole device pixels per art pixel
  sizeTouch() {
    const short = Math.min(window.innerWidth, window.innerHeight);
    const big = short < 430 ? 84 : 100;
    const set = (node, artW, artH, cssTarget) => {
      const k = crispScale(artW, cssTarget);
      node.style.width = artW * k + "px";
      node.style.height = artH * k + "px";
      return artW * k;
    };
    const baseW = set(this.joyEl, 36, 36, big * 1.25);
    // the knob uses the base's art scale (same pixel grid; its 18 px sit 9 art px in from the base's edge)
    this.stickArt = baseW / 36;
    this.knobEl.style.width = this.knobEl.style.height = 18 * this.stickArt + "px";
    set(this.aEl, 29, 30, big);
    set(this.bEl, 29, 30, big * 0.76);
    this.stickBase = baseW;
    this.joy.R = baseW * 0.42;
    if (this.joy.id != null) this.placeStick();
  }
  setTouchVisible(on) {
    this.layer.classList.toggle("show-touch", !!on && this.touchMode);
    this.layer.classList.toggle("active", !!on);
    if (!on) {
      this.btn.a = this.btn.b = null;
      this.aEl.classList.remove("on");
      this.bEl.classList.remove("on");
      this.dropStick();
    }
  }
  applyLabels(a, b) {
    if (this.labels[0] !== a) {
      this.labels[0] = a;
      this.aEl.dataset.label = a;
      this.aEl.classList.toggle("idle", !a);
    }
    if (this.labels[1] !== b) {
      this.labels[1] = b;
      this.bEl.dataset.label = b;
      this.bEl.classList.toggle("idle", !b);
    }
  }
  // The pocket's receiver buttons: [{label, open: 0 covered | 1 | 2 open}] (up to 5) while the human QB can throw,
  // else null (A and B come back). Touches the DOM only when something changes.
  setReceivers(list) {
    const key = list ? list.map((r) => r.label + r.open).join("|") : "";
    if (key === this.recKey) return;
    this.recKey = key;
    this.layer.classList.toggle("pocket", !!list);
    this.recEls.forEach((el, i) => {
      const r = list && list[i];
      el.classList.toggle("off", !r);
      if (!r) return el.classList.remove("on");
      el.lastChild.textContent = r.label;
      el.classList.toggle("open", r.open === 2);
      el.classList.toggle("mid", r.open === 1);
      el.classList.toggle("cov", r.open === 0);
    });
    // the corner the row takes while it shows: CSS px up from the bottom of the screen and in from its right edge (0
    // when it doesn't show); the camera keeps the receivers in those columns above it
    const rr = list ? this.recRow.getBoundingClientRect() : null;
    const on = rr && rr.height > 0;
    this.recRowCss = on ? Math.max(0, Math.ceil(window.innerHeight - rr.top)) : 0;
    this.recRowW = on ? Math.max(0, Math.ceil(window.innerWidth - rr.left)) : 0;
  }
  // The app's coarse labels; the UI's context labels (setContextLabels) take over once it sets them.
  setLabels(a, b) {
    if (this.uiLabels) return;
    this.applyLabels(a === "A" ? "" : a, b === "B" ? "" : b);
  }
  setContextLabels(a, b) {
    this.uiLabels = true;
    this.applyLabels(a, b);
  }
}
