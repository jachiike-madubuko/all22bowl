// Settings → CONTROLS: the remap screen. A and B, FLIP, the five receivers, movement, pause and sound, each with its
// keyboard keys and its controller button (bindings.js); pick one (click, Enter / A on it) and press the new key or
// button — Esc (or START, the D-pad) cancels. A key or button already in use swaps with it and says so ("X WAS
// RECEIVER 3 · RECEIVER 3 IS NOW 1"); SWAP A AND B and RESET TO DEFAULTS (asked twice) sit under the list. The arrows /
// D-pad move between cells and Esc / B go back. Touch controls are fixed: a touch-only device is told so.
// showControls(ui, back): ui = the UI (ui.js screen / panel / button / navKeys), back = where BACK goes.
import { B, ACTIONS, GROUPS, BY_ID, caps, glyphs, keyWord, rebind, toggleSwap, reset, changed, PAD_GLYPH } from "./bindings.js";
import { keySpan, keyKey, padKey } from "./ui.js";

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const isDpad = (i) => i >= 12 && i <= 15;

export function showControls(ui, back) {
  const app = ui.app, input = app.input;
  let wait = null; // { id, dev } while a cell waits for its key / button
  let msg = "", msgCls = "", sureT = 0, at = null;
  // a phone with nothing plugged in (no key pressed, no controller seen): the screen says the touch controls are fixed
  const touchOnly = () => input.touchMode && input.device === "touch" && !input.pad.seen && !input.lastPad;
  const style = () => input.padStyle;
  const stop = () => { wait = null; input.capture = null; };
  const done = (text, cls = "") => { msg = text; msgCls = cls; stop(); render(); };
  const take = (ev) => {
    if (!wait) return;
    const a = BY_ID[wait.id];
    const name = a.group === "ab" ? `${a.label} BUTTON` : a.label;
    if (wait.dev === "k") {
      if (ev.dev !== "k" || ev.id === "Escape") return done("");
      const r = rebind(wait.id, "k", ev.id);
      if (!r.ok) { msg = r.msg; msgCls = "bad"; paintMsg(); ui.sfx("back"); return; } // still waiting: try another key
      ui.sfx("sel");
      return done(r.msg || `${name}: ${B.kb[a.id].map(keyWord).join(" / ")}`, r.msg ? "swap" : "ok");
    }
    if (ev.dev !== "p" || ev.i === 9 || isDpad(ev.i) || ev.i === 16) return done("");
    const r = rebind(wait.id, "p", ev.i);
    if (!r.ok) { msg = r.msg; msgCls = "bad"; paintMsg(); ui.sfx("back"); return; }
    ui.sfx("sel");
    return done(r.msg || `${name}: {pad:${PAD_GLYPH[B.pad[a.id][0]]}}`, r.msg ? "swap" : "ok");
  };
  const start = (id, dev) => {
    if (wait && wait.id === id && wait.dev === dev) return done("");
    const a = BY_ID[id], name = a.group === "ab" ? `${a.label} BUTTON` : a.label;
    wait = { id, dev }; at = `${id}:${dev}`;
    msg = dev === "k" ? `PRESS A KEY FOR ${name} · ESC CANCELS` : `PRESS A BUTTON FOR ${name} · START CANCELS`; msgCls = "wait";
    render();
  };
  const goBack = () => { stop(); back(); }; // (a click on BACK while a cell waits leaves too)
  // a message with {pad:X} glyphs as keycaps
  const fill = (node) => {
    node.replaceChildren();
    const text = msg || "SELECT A KEY OR BUTTON, THEN PRESS THE NEW ONE";
    for (const part of text.split(/(\{pad:[A-Z0-9]+\})/)) {
      const m = /^\{pad:([A-Z0-9]+)\}$/.exec(part);
      if (m) node.append(keySpan(padKey(m[1], style()), "inl"));
      else if (part) node.append(document.createTextNode(part));
    }
  };
  let msgEl = null;
  const paintMsg = () => { if (!msgEl) return; msgEl.className = `ctl-msg ${msgCls}`; fill(msgEl); };
  const render = () => {
    const keep = ui.current && ui.current.querySelector(".ctl-scroll"), top = keep ? keep.scrollTop : 0;
    const s = ui.screen("controls");
    const p = ui.panel("CONTROLS", "wide ctl-panel");
    const scroll = el("div", "ctl-scroll scroll-ok");
    const cellNodes = [];
    const cell = (a, dev) => {
      if (dev === "p" && a.move) { const f = el("span", "ctl-fix", "STICK"); f.append(el("br"), "D-PAD"); return f; }
      const w = wait && wait.id === a.id && wait.dev === dev;
      const inner = el("span", "ctl-keys");
      if (w) inner.textContent = dev === "k" ? "PRESS A KEY" : "PRESS A BUTTON";
      else {
        const list = dev === "k" ? caps(a.id).map((c) => keySpan(keyKey(c))) : glyphs(a.id).map((g) => keySpan(padKey(g, style())));
        if (list.length) inner.append(...list); else inner.textContent = "-";
      }
      const b = ui.button(inner, `small ctl-cell${w ? " wait" : ""}${changed(a.id, dev) ? " mod" : ""}`, () => start(a.id, dev));
      b.dataset.id = a.id; b.dataset.dev = dev;
      b.setAttribute("aria-label", `${a.label}: ${dev === "k" ? "keyboard" : "controller"}`);
      cellNodes.push(b);
      return b;
    };
    const cols = [el("div", "ctl-col"), el("div", "ctl-col")];
    GROUPS.forEach(([g, title, col]) => {
      const box = el("div", "ctl-grp");
      const hd = el("div", "ctl-row ctl-head");
      hd.append(el("span", "ctl-gt", title), el("span", "ctl-ch", "KEYBOARD"), el("span", "ctl-ch", "CONTROLLER"));
      box.append(hd);
      for (const a of ACTIONS.filter((x) => x.group === g)) {
        const r = el("div", "ctl-row");
        const l = el("span", "ctl-label", a.group === "ab" ? `${a.label} BUTTON` : a.label);
        if (a.note) l.append(el("small", "", a.note));
        r.append(l, cell(a, "k"), cell(a, "p"));
        box.append(r);
      }
      cols[col].append(box);
    });
    scroll.append(...cols);
    msgEl = el("div", "ctl-msg");
    const row = el("div", "row");
    const bk = ui.button("BACK", "small", goBack);
    const sw = ui.button(`SWAP A AND B: ${B.swapAB ? "ON" : "OFF"}`, `small${B.swapAB ? " on" : ""}`, () => {
      stop(); at = "swap"; const on = toggleSwap();
      msg = on ? "A AND B SWAPPED: EVERYTHING ON A IS ON B, AND B CONFIRMS IN MENUS" : "A AND B BACK AS THEY WERE"; msgCls = "ok"; render();
    });
    const rs = ui.button(performance.now() - sureT < 3000 ? "SURE? PRESS AGAIN" : "RESET TO DEFAULTS", "small", () => {
      stop(); at = "reset";
      if (performance.now() - sureT > 3000) {
        sureT = performance.now(); msg = "PRESS RESET AGAIN TO PUT EVERY CONTROL BACK"; msgCls = "wait"; render();
        setTimeout(() => { if (ui.current && ui.current.classList.contains("controls") && !wait && at === "reset" && performance.now() - sureT >= 2900) { sureT = 0; render(); } }, 3000);
        return;
      }
      sureT = 0; reset(); msg = "EVERY CONTROL IS BACK TO ITS DEFAULT"; msgCls = "ok"; render();
    });
    sw.dataset.k = "swap"; rs.dataset.k = "reset";
    row.append(bk, sw, rs);
    p.append(scroll, msgEl, row);
    if (touchOnly()) p.append(el("div", "set-note", "TOUCH CONTROLS ARE FIXED · CONNECT A KEYBOARD OR CONTROLLER TO CHANGE THESE"));
    s.append(p);
    paintMsg();
    scroll.scrollTop = top;
    ui.restyle = () => render();
    // a cell still waiting (a re-render: a PlayStation pad just came in) keeps the capture, which opening this screen
    // let go of (ui.js clear)
    input.capture = wait ? take : null;
    // keys never reach this while a cell waits (input.js takes the next one); the arrows move between cells
    ui.navKeys(p, goBack);
    const f = at === "swap" ? sw : at === "reset" ? rs : at ? cellNodes.find((b) => `${b.dataset.id}:${b.dataset.dev}` === at) : cellNodes[0];
    ui.focusLater(f || bk);
    if (f && f.scrollIntoView) f.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  render();
}
