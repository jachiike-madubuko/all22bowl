// DOM screens for the modes (Draft + Gym Challenge), in the UI's look: Press Start 2P, hard pixel
// borders (stepped box-shadows), palette colors, stepped animations, pixel art on whole-device-pixel
// canvases. Built with createElement + CSSOM only (CSP). Styles: bowl-modes.css (classes prefixed mo-).
// Screens render into the UI's screen layer through ui.screen(cls) (so ui.clear()/showTitle() replace
// them) and take keyboard input through ui.keyHandler, like the UI's own screens.
import {
  monName, monTypes, TYPE_COLORS, STYLE_INFO, GYMS, LADDER, CHAMPION, REGION, gymByKey, makeTeam, readDraftedTeam,
  slotFit, slotRatings, slotName, slotTag, fitGrade, teamOverall, starPlayers, showcase, OFF_SLOTS, DEF_SLOTS,
} from "./data.js";
import {
  monCanvas, headshot, badgeCanvas, spinFrames, drawFrame, cardBack, townMap, mapPoint, MAP_W, MAP_H,
  pixelSize, fitScale, miniCard, badgeName,
} from "./modes-art.js";
import { DRAFT_ORDER, DRAFT_REROLLS, DRAFT_COLORS } from "./modes.js";

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const vh = () => window.innerHeight || 720;
const vw = () => window.innerWidth || 1280;
// CSS px per art px for sprites: 1 on phones (DPR 3 makes that 3 device px), 2 on laptops, 3 on big screens.
const spriteScale = () => (vh() < 560 || vw() < 700 ? 1 : vh() >= 900 && vw() >= 1500 ? 3 : 2);
const smallScale = () => (vh() < 560 || vw() < 700 ? 1 : 2);
const badgeKey = (key) => (key === "champion" ? "champion" : key);
const pad3 = (n) => String(n).padStart(3, "0");
const leaderUp = (g) => g.leader.toUpperCase();
const REGION_UP = REGION.name.toUpperCase();
const CHAMP_UP = leaderUp(CHAMPION); // BLUE in Kanto
// The spot's short label: the slot id, or the scheme's role where it renames the spot (SLOT, DT, MLB).
// A touch device shows no keyboard shortcuts. Either signal works: the input's last device, or the
// html.dev-touch class the core UI sets.
const onTouch = (app) => document.documentElement.classList.contains("dev-touch") || !!(app && app.input && app.input.device === "touch");
const spotTag = (slot, scheme) => {
  const t = slotTag(slot, scheme);
  return t === "SLOT" || t === "DT" || t === "MLB" ? t : slot;
};

function bar(value, cls = "") {
  const b = el("i", "mo-bar " + cls);
  const n = Math.max(1, Math.round(value / 10));
  const tone = value >= 70 ? "hi" : value >= 45 ? "mid" : "lo";
  for (let i = 0; i < 10; i++) {
    const s = el("b", i < n ? "on " + tone : "");
    s.style.setProperty("--j", String(i));
    b.append(s);
  }
  return b;
}
// Ink or white, whichever reads on a color (chips, card bands).
function inkOn(hex) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62;
}
function typeChip(t) {
  const col = TYPE_COLORS[t] || "#8d99ae";
  const c = el("span", "mo-type" + (inkOn(col) ? " ink" : ""), t.toUpperCase());
  c.style.setProperty("--ty", col);
  return c;
}
function stars(n) {
  const s = el("span", "mo-stars");
  for (let k = 0; k < 5; k++) s.append(el("i", k < n ? "on" : "", "★"));
  return s;
}

// Pixel confetti: n palette squares falling in steps (CSS), spread across the parent.
function confetti(n) {
  const conf = el("div", "mo-confetti");
  const cols = ["#ffd23f", "#e8352a", "#3a86ff", "#5bd15b", "#ff6fb5", "#f6f6f2"];
  for (let i = 0; i < n; i++) {
    const p = el("i", "");
    p.style.left = ((i * 37) % 100) + "%";
    p.style.setProperty("--d", ((i * 0.13) % 2.4).toFixed(2) + "s");
    p.style.setProperty("--c", cols[i % cols.length]);
    conf.append(p);
  }
  return conf;
}

// A top-down depth chart: defense on top, offense below the line, every player a framed headshot.
const FORM = {
  S1: [36, 9], S2: [64, 9], CB1: [7, 24], OLB1: [22, 24], ILB1: [41, 24], ILB2: [59, 24], OLB2: [78, 24], CB2: [93, 24],
  DE1: [33, 39], NT: [50, 39], DE2: [67, 39],
  WR1: [7, 55], LT: [30, 55], LG: [40, 55], C: [50, 55], RG: [60, 55], RT: [70, 55], TE: [80, 55], WR2: [93, 59],
  QB: [50, 70], FB: [42, 86], HB: [58, 86], K: [8, 86],
};
function formationField(team, scale, color) {
  const f = el("div", "mo-form");
  f.style.setProperty("--c", color || team.primary || "#e8352a");
  f.style.setProperty("--fsc", String(scale)); // the field's sprite scale (not the core --fs font size)
  f.append(el("i", "mo-form-los"));
  for (const sl of Object.keys(FORM)) {
    const id = team.lineup[sl];
    if (!id) continue;
    const p = el("div", "mo-form-p" + (sl === "K" ? " k" : DEF_SLOTS.includes(sl) ? " d" : " o"));
    p.style.left = FORM[sl][0] + "%";
    p.style.top = FORM[sl][1] + "%";
    p.title = `${sl}: ${monName(id)}`;
    p.append(headshot(id, 22, { scale }), el("span", "mo-form-tag", sl));
    f.append(p);
  }
  return f;
}

export class ModesUI {
  constructor(m) {
    this.m = m;
    this.app = m.app;
    this.ui = m.app.ui;
    this.timers = new Set();
    this.redraw = null;
    // re-lay out the open screen when the window really changes size (rotation, a new window size),
    // not on every resize event (they fire for no visible change too and would restart animations)
    let t = 0;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const r = this.redraw;
        if (!r || r.scr !== this.app.scr) return;
        if (Math.abs(vw() - r.w) < 48 && Math.abs(vh() - r.h) < 48 && spriteScale() === r.k) return;
        r.fn();
      }, 220);
    });
  }
  // ---------- shared bits ----------
  sfx(kind) {
    try { this.ui.sfx(kind); } catch (_) {}
  }
  // a named sound from the audio engine (audio.js SOUND_NAMES); falls back to the UI's blips
  sound(name, fallback) {
    const a = this.app && this.app.audio;
    try {
      if (a && typeof a.play === "function" && a.play(name)) return;
    } catch (_) {}
    if (fallback !== undefined) this.sfx(fallback);
  }
  button(label, cls, fn) {
    const b = el("button", "pbtn " + (cls || ""), label);
    b.type = "button";
    b.addEventListener("click", () => {
      this.sfx("sel");
      fn();
    });
    b.addEventListener("pointerenter", () => this.sfx());
    return b;
  }
  screen(cls, scr, redraw) {
    this.clearTimers();
    let s;
    if (typeof this.ui.screen === "function") s = this.ui.screen("mo-screen " + cls);
    else {
      // the UI changed shape: run our own full-screen layer the same way
      const host = this.ui.layer || this.ui.root;
      host.replaceChildren();
      s = el("div", "screen mo-screen " + cls);
      host.append(s);
      this.ui.current = s;
      this.ui.keyHandler = null;
    }
    s.classList.add("scroll-ok");
    this.redraw = redraw ? { scr, fn: redraw, w: vw(), h: vh(), k: spriteScale() } : null;
    this.cursorFollows(s);
    return s;
  }
  // The cursor. Like the core UI's select(), the highlighted control carries .sel, so the highlight
  // never depends on the window having system focus (:focus doesn't match in an unfocused window)
  // and is always the control Enter presses. DOM focus follows it for screen readers / Tab.
  mark(b) {
    if (!b || b === this.selEl) return;
    if (this.selEl) this.selEl.classList.remove("sel");
    this.selEl = b;
    b.classList.add("sel");
  }
  go(b) {
    if (!b) return;
    this.mark(b);
    b.focus({ preventScroll: true });
  }
  // .sel follows focus (Tab, taps) and the mouse inside `box`. Map nodes keep their own selection
  // (the blinking corner cursor), so they're left alone.
  cursorFollows(box) {
    const pick = (t) => {
      const b = t && t.closest ? t.closest("button") : null;
      return b && box.contains(b) && !b.disabled && !b.classList.contains("mo-node") ? b : null;
    };
    box.addEventListener("focusin", (e) => this.mark(pick(e.target)));
    box.addEventListener("pointerover", (e) => {
      if (e.pointerType !== "mouse") return;
      const b = pick(e.target);
      if (b && b !== this.selEl) this.go(b);
    });
  }
  // A modal over the field through the UI's modal() (so its closeModal() and pause rules apply).
  modal(cls) {
    if (typeof this.ui.modal === "function") return this.ui.modal(cls);
    if (typeof this.ui.closeModal === "function") this.ui.closeModal();
    const m = el("div", "modal " + cls);
    const p = el("div", "panel");
    m.append(p);
    this.ui.root.append(m);
    this.ui.modalEl = m;
    return p;
  }
  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
    return id;
  }
  every(fn, ms) {
    const id = setInterval(fn, ms);
    this.timers.add(id);
    return id;
  }
  clearTimers() {
    for (const id of this.timers) {
      clearTimeout(id);
      clearInterval(id);
    }
    this.timers.clear();
  }
  focus(b) {
    if (!b) return;
    this.mark(b);
    setTimeout(() => b.isConnected && b.focus({ preventScroll: true }), 30);
  }
  // the control the cursor is on: the .sel one in `box`, else the focused one
  curIn(box) {
    return this.selEl && this.selEl.isConnected && box.contains(this.selEl) ? this.selEl : document.activeElement;
  }
  // Arrow/WASD focus moves among the buttons of `box`; Enter/Space clicks; Esc goes back.
  keys(box, onBack, extra) {
    this.ui.keyHandler = (e) => {
      if (extra && extra(e) === true) return true;
      const btns = [...box.querySelectorAll("button:not([disabled])")].filter((b) => b.offsetParent !== null);
      if (!btns.length) return false;
      const i = btns.indexOf(this.curIn(box));
      const move = (b) => {
        this.mark(b);
        b.focus({ preventScroll: false });
        this.sfx();
        return true;
      };
      if (["ArrowDown", "ArrowRight", "KeyS", "KeyD"].includes(e.code)) return move(btns[(i + 1 + btns.length) % btns.length]);
      if (["ArrowUp", "ArrowLeft", "KeyW", "KeyA"].includes(e.code)) return move(btns[(i - 1 + btns.length) % btns.length]);
      // a held key repeats: one press, one click (a long Enter used to run from the ladder through VS into a game)
      if ((e.code === "Escape" || e.code === "Backspace") && onBack) {
        if (!e.repeat) onBack();
        return true;
      }
      if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") {
        if (!e.repeat) (i >= 0 ? btns[i] : btns[0]).click();
        return true;
      }
      return false;
    };
  }

  // ---------- title & team select decorations ----------
  decorateTitle() {
    const s = this.ui.current;
    if (!s || !s.classList.contains("title")) return;
    const st = this.m.store;
    const n = st.badgeCount();
    const gymLabel = st.s.champion ? "GYM CHALLENGE ★" : n ? `GYM CHALLENGE ${n}/8` : "GYM CHALLENGE";
    const run = this.m.run;
    const draftLabel = run && !run.done ? `DRAFT · ROUND ${run.round + 1}` : "DRAFT YOUR TEAM";
    let btns = [...s.querySelectorAll("button")];
    // a menu hook with another signature can leave junk buttons behind: drop them
    for (const b of btns) if (/^(title|\[object Object\]|undefined)$/i.test(b.textContent.trim())) b.remove();
    btns = [...s.querySelectorAll("button")];
    const hd = btns.find((b) => /DRAFT YOUR TEAM|^DRAFT ·/.test(b.textContent)), hg = btns.find((b) => /GYM CHALLENGE/.test(b.textContent));
    if (hd && hg && !hd.closest(".mo-entry")) {
      // the UI's addMenuButton hook made them: keep its buttons, show progress in the labels
      hd.textContent = draftLabel;
      hg.textContent = gymLabel;
      return;
    }
    if (s.querySelector(".mo-entry")) return;
    const menu = s.querySelector(".menu") || s;
    const row = el("div", "mo-entry");
    const b1 = this.button("", "mo-entry-btn mo-entry-draft", () => this.m.openDraft());
    b1.append(miniCard({ scale: smallScale(), cls: "mo-entry-ic" }), el("span", "", draftLabel));
    const b2 = this.button("", "mo-entry-btn mo-entry-gyms", () => this.m.openLadder());
    const next = st.nextKey();
    b2.append(badgeCanvas(next && next !== "champion" ? next : "champion", { scale: smallScale(), cls: "mo-entry-ic" }), el("span", "", gymLabel));
    row.append(b1, b2);
    const first = menu.querySelector("button");
    if (first) first.after(row);
    else menu.prepend(row);
  }

  decorateTeamSelect() {
    const s = this.ui.current;
    if (!s || !s.classList.contains("teamsel") || s.querySelector(".mo-draft-card")) return;
    const first = s.querySelector(".team-card");
    const row = first ? first.parentElement : s;
    const d = readDraftedTeam();
    let card = null;
    if (d && typeof this.ui.teamCard === "function") {
      try {
        const team = makeTeam("mydraft");
        const foot = el("div", "card-foot");
        const redo = el("span", "reroll", onTouch(this.app) ? "✎ NEW DRAFT" : "✎ NEW DRAFT (T)");
        redo.addEventListener("click", (e) => {
          e.stopPropagation();
          this.sfx("sel");
          this.m.openDraft();
        });
        foot.append(redo);
        card = this.ui.teamCard(team, "YOUR DRAFT", `${team.name} — the team you drafted${d.created ? " on " + d.created : ""}.`, () => this.app.goOppSelect(team), foot);
      } catch (_) {
        card = null;
      }
    }
    if (!card) {
      card = el("button", "card team-card mo-empty-card");
      card.type = "button";
      const head = el("div", "card-head");
      head.append(el("span", "card-label", "YOUR DRAFT"), el("span", "ovr", d ? "OVR " + teamOverall(d.lineup, d.scheme).ovr : "NEW"));
      const art = el("div", "mo-empty-art");
      for (let i = 0; i < 3; i++) {
        const cb = cardBack();
        pixelSize(cb, 48, 64, smallScale() === 1 ? 0.5 : 1);
        cb.style.setProperty("--i", String(i));
        art.append(cb);
      }
      const info = el("div", "card-info");
      info.append(el("div", "card-name", d ? d.name : "DRAFT A TEAM"), el("div", "card-note", d ? "Your drafted team." : `23 picks — one of three ${REGION.name} Pokémon each round. Then take them into a game.`));
      card.append(head, art, info, el("div", "card-foot mo-empty-go", d ? "▸ PLAY" : onTouch(this.app) ? "▸ START THE DRAFT" : "▸ START THE DRAFT (T)"));
      card.addEventListener("click", () => {
        this.sfx("sel");
        if (d) this.app.goOppSelect(makeTeam("mydraft"));
        else this.m.openDraft();
      });
      card.addEventListener("pointerenter", () => this.sfx());
    }
    card.classList.add("mo-draft-card");
    row.append(card);
    row.classList.add("mo-three");
    const prev = this.ui.keyHandler;
    // T starts the draft (D is WASD's right; Cmd / Ctrl+T is the browser's new tab)
    this.ui.keyHandler = (e) => {
      if (e.code === "KeyT" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        this.m.openDraft();
        return true;
      }
      return prev ? prev(e) : false;
    };
  }

  // ---------- DRAFT: intro ----------
  draftIntro({ resume }) {
    const s = this.screen("mo-dintro", "draft", () => this.draftIntro({ resume: this.m.run && !this.m.run.done ? this.m.run : null }));
    const p = el("div", "panel mo-panel");
    p.append(el("h2", "ptitle mo-title", "DRAFT YOUR TEAM"));
    const lead = el("div", "mo-lead");
    lead.append(el("span", "", "23 ROUNDS"), el("i", "", "·"), el("span", "", "PICK 1 OF 3"), el("i", "", "·"), el("span", "", `${DRAFT_REROLLS} REROLLS`));
    p.append(lead);
    // three steps with little pixel pictures
    const steps = el("div", "mo-steps");
    const st1 = el("div", "mo-step");
    const backs = el("div", "mo-step-art");
    for (let i = 0; i < 3; i++) {
      const cb = cardBack();
      pixelSize(cb, 48, 64, smallScale() === 1 ? 0.5 : 1);
      backs.append(cb);
    }
    st1.append(backs, el("div", "mo-step-t", "1 · THREE POKÉMON"), el("div", "mo-step-d", `Every round deals three ${REGION.name} Pokémon for one spot.`));
    const st2 = el("div", "mo-step");
    const fit = el("div", "mo-step-art mo-step-fit");
    fit.append(el("span", "", "FIT"), bar(82), el("b", "", "S"));
    st2.append(fit, el("div", "mo-step-t", "2 · CHECK THE FIT"), el("div", "mo-step-d", "The meter rates how well each one plays that spot."));
    const st3 = el("div", "mo-step");
    const heads = el("div", "mo-step-art mo-step-heads");
    for (const id of showcase()) heads.append(headshot(id, 20, { scale: smallScale() }));
    st3.append(heads, el("div", "mo-step-t", "3 · BUILD YOUR 22"), el("div", "mo-step-d", "Fill the offense, the defense and a kicker. Then play."));
    steps.append(st1, st2, st3);
    p.append(steps);
    // formation choice
    const scheme = resume ? { ...resume.scheme } : { ...(this.lastScheme || { def: "34", off: "fb" }) };
    const sch = el("div", "mo-scheme");
    const segRow = (label, opts, key) => {
      const r = el("div", "set-row mo-set");
      r.append(el("span", "set-label", label));
      const seg = el("div", "seg");
      const btns = opts.map(([v, txt]) => {
        const b = this.button(txt, scheme[key] === v ? "on" : "", () => {
          if (resume) return;
          scheme[key] = v;
          this.lastScheme = { ...scheme };
          for (const [bb, vv] of btns) bb.classList.toggle("on", vv === v);
        });
        if (resume) b.disabled = true;
        return [b, v];
      });
      for (const [b] of btns) seg.append(b);
      r.append(seg);
      return r;
    };
    sch.append(segRow("DEFENSE", [["34", "3-4"], ["43", "4-3"]], "def"), segRow("OFFENSE", [["fb", "FULLBACK"], ["slot", "SLOT WR"]], "off"));
    p.append(sch);
    const row = el("div", "row");
    let main;
    if (resume) {
      main = this.button(`RESUME · ROUND ${resume.round + 1}`, "primary", () => this.m.resumeDraft());
      row.append(main, this.button("START OVER", "", () => this.m.startDraft(scheme)));
    } else {
      main = this.button("START DRAFT ▸", "primary", () => this.m.startDraft(scheme));
      row.append(main);
    }
    p.append(row);
    const d = readDraftedTeam();
    if (d) {
      const cur = el("div", "mo-current");
      const ov = teamOverall(d.lineup, d.scheme).ovr;
      const chip = el("span", "mo-chipcolor");
      chip.style.setProperty("--c", d.primary);
      cur.append(chip, el("span", "", `YOUR DRAFT: ${d.name} · OVR ${ov}`));
      const play = this.button("PLAY IT ▸", "small", () => this.m.playDraft());
      cur.append(play);
      p.append(cur);
      if (!resume) p.append(el("div", "mo-note", "A new draft replaces it."));
    }
    const nav = el("div", "row");
    nav.append(this.button("◂ BACK", "small", () => this.m.openTitle()));
    p.append(nav);
    s.append(p);
    this.keys(p, () => this.m.openTitle());
    this.focus(main);
  }

  // ---------- DRAFT: a round ----------
  draftRound(run) {
    if (!run || run.done) return;
    const s = this.screen("mo-draft", "draft", () => this.draftRound(this.m.run));
    const S = spriteScale(), HS = smallScale();
    const slot = run.slot;
    const ov = run.overall();
    // header: round, the spot, team OVR
    const top = el("div", "mo-dtop");
    const rd = el("div", "mo-dround");
    rd.append(el("span", "", "ROUND"), el("b", "", String(run.round + 1)), el("span", "", "/" + DRAFT_ORDER.length));
    const sl = el("div", "mo-dslot");
    sl.append(el("div", "mo-dslot-tag", spotTag(slot, run.scheme)), el("div", "mo-dslot-name", slotName(slot, run.scheme)));
    const ovr = el("div", "mo-dovr");
    const ovNum = el("b", "", ov ? String(ov.ovr) : "?");
    if (run.lastDelta) ovNum.append(el("i", "mo-delta " + (run.lastDelta > 0 ? "up" : "down"), (run.lastDelta > 0 ? "+" : "") + run.lastDelta));
    ovr.append(el("span", "", "TEAM OVR"), ovNum, el("small", "", ov ? `OFF ${ov.off ?? "?"} · DEF ${ov.def ?? "?"}` : "PICK TO START"));
    top.append(rd, sl, ovr);
    s.append(top);
    // the three cards
    const cards = el("div", "mo-dcards");
    const list = [];
    let busy = false;
    const choose = (i) => {
      if (busy || !run.options[i]) return;
      busy = true;
      this.sound("lock", "sel"); // the pick locks in
      list.forEach((c, k) => c.classList.add(k === i ? "picked" : "discard"));
      // a sharp pick gets a shout
      const g = list[i].dataset.grade;
      if (g === "S" || g === "A") list[i].append(el("span", "mo-shout", g === "S" ? "STEAL!" : "GREAT FIT!"));
      const slotBox = s.querySelector(`.mo-sslot[data-slot="${slot}"]`);
      if (slotBox) {
        slotBox.classList.add("filling");
        slotBox.replaceChildren(el("span", "mo-sslot-tag", spotTag(slot, run.scheme)), headshot(run.options[i], 20, { scale: HS }));
      }
      this.later(() => {
        if (this.m.draftPick(i) && !this.m.run.done) this.draftRound(this.m.run);
      }, 430);
    };
    run.options.forEach((id, i) => {
      const c = this.draftCard(id, slot, run.scheme, i, S);
      c.addEventListener("click", () => choose(i));
      c.addEventListener("focus", () => this.sfx());
      cards.append(c);
      list.push(c);
    });
    s.append(cards);
    // a soft reveal tick as each card turns over
    for (let i = 0; i < list.length; i++) this.later(() => this.sound("reveal", null), 470 + i * 120);
    // reroll + hints
    const barRow = el("div", "mo-dbar");
    const shown = performance.now(); // a double-click's second click lands on the next round's REROLL
    const rr = this.button(`↻ REROLL · ${run.rerolls}`, "small mo-reroll", () => {
      if (busy || performance.now() - shown < 400) return;
      if (this.m.draftReroll()) this.draftRound(this.m.run);
    });
    if (run.rerolls <= 0) rr.disabled = true;
    const menu = this.button("MENU", "small", () => this.m.openDraft());
    barRow.append(rr, el("span", "mo-dhint", "1 2 3 PICK · ARROWS + ENTER · R REROLL"), menu);
    s.append(barRow);
    // the draft board: every spot, filled ones with a headshot
    const strip = el("div", "mo-strip");
    const group = (title, slots) => {
      const g = el("div", "mo-sgroup");
      g.append(el("div", "mo-sgroup-t", title));
      const r = el("div", "mo-srow");
      for (const sl2 of slots) {
        const box = el("div", "mo-sslot" + (sl2 === slot ? " now" : run.picks[sl2] ? " full" : ""));
        box.dataset.slot = sl2;
        box.append(el("span", "mo-sslot-tag", spotTag(sl2, run.scheme)));
        if (run.picks[sl2]) box.append(headshot(run.picks[sl2], 20, { scale: HS }));
        else {
          const e = el("i", "mo-sslot-empty");
          pixelSize(e, 20, 20, HS);
          box.append(e);
        }
        box.title = `${slotName(sl2, run.scheme)}${run.picks[sl2] ? ": " + monName(run.picks[sl2]) : ""}`;
        r.append(box);
      }
      g.append(r);
      return g;
    };
    strip.append(group("OFFENSE", DRAFT_ORDER.slice(0, 11)), group("DEFENSE", DRAFT_ORDER.slice(11, 22)), group("K", ["K"]));
    s.append(strip);
    this.ui.keyHandler = (e) => {
      const m = /^Digit([1-3])$/.exec(e.code) || /^Numpad([1-3])$/.exec(e.code);
      if (m) {
        if (!e.repeat) choose(Number(m[1]) - 1); // a held key picks once, not every round
        return true;
      }
      const at = this.curIn(s);
      const i = Math.max(0, list.indexOf(at));
      if (["ArrowRight", "KeyD"].includes(e.code)) {
        this.go(list[(i + 1) % list.length]);
        return true;
      }
      if (["ArrowLeft", "KeyA"].includes(e.code)) {
        this.go(list[(i - 1 + list.length) % list.length]);
        return true;
      }
      if (e.code === "Enter" || e.code === "NumpadEnter" || e.code === "Space") {
        if (e.repeat) return true;
        if (at === rr || at === menu) at.click();
        else choose(i);
        return true;
      }
      if (e.code === "KeyR") {
        if (!e.repeat) rr.click();
        return true;
      }
      if (e.code === "Escape" || e.code === "Backspace") {
        if (!e.repeat) this.m.openDraft();
        return true;
      }
      if (e.code === "ArrowDown" || e.code === "KeyS") {
        this.go(rr.disabled ? menu : at === rr ? menu : rr);
        return true;
      }
      if (e.code === "ArrowUp" || e.code === "KeyW") {
        this.go(list[0]);
        return true;
      }
      return false;
    };
    this.focus(list[0]);
  }

  draftCard(id, slot, scheme, i, S) {
    const types = monTypes(id);
    const c = el("button", "mo-card");
    c.type = "button";
    c.style.setProperty("--i", String(i));
    c.style.setProperty("--ty", TYPE_COLORS[types[0]] || "#8d99ae");
    c.style.setProperty("--ty2", TYPE_COLORS[types[1] || types[0]] || "#8d99ae");
    if (inkOn(TYPE_COLORS[types[0]] || "#8d99ae")) c.classList.add("ink-head");
    c.setAttribute("aria-label", `${i + 1}: ${monName(id)}`);
    const fitV = slotFit(id, slot, scheme);
    const grade = fitGrade(fitV, id, slot, scheme);
    c.classList.add("g-" + grade); // S and A cards get a holo / gold foil rim
    c.dataset.grade = grade;
    const inner = el("div", "mo-card-in");
    const back = el("div", "mo-cback");
    const cb = cardBack();
    cb.classList.add("mo-cback-art");
    pixelSize(cb, 48, 64, S);
    back.append(cb);
    const front = el("div", "mo-cfront");
    const head = el("div", "mo-chead");
    head.append(el("span", "mo-key", String(i + 1)), el("span", "mo-dex", "#" + pad3(id)), el("span", "mo-grade g-" + grade, grade));
    const art = el("div", "mo-cart");
    const spr = monCanvas(id, { box: [72, 70], scale: S, cls: "mo-cspr", platform: TYPE_COLORS[types[0]] || "#8d99ae" });
    art.append(spr);
    // a white silhouette that flashes as the card turns (stepped)
    const flash = monCanvas(id, { box: [72, 70], scale: S, cls: "mo-cflash", feet: 5, silhouette: "#ffffff" });
    art.append(flash);
    const name = el("div", "mo-cname", monName(id));
    const tys = el("div", "mo-ctypes");
    for (const t of types) tys.append(typeChip(t));
    const fitRow = el("div", "mo-fit");
    fitRow.append(el("span", "", "FIT"), bar(fitV, "fit"), el("b", "", String(fitV)));
    const st = el("div", "mo-stats");
    for (const r of slotRatings(id, slot, scheme)) {
      const row = el("div", "mo-stat");
      row.title = r.name;
      row.append(el("span", "", r.label), bar(r.value), el("b", "", String(r.value)));
      st.append(row);
    }
    front.append(head, art, name, tys, fitRow, st);
    inner.append(front, back);
    c.append(inner);
    return c;
  }

  // ---------- DRAFT: complete ----------
  draftDone(opts = {}) {
    const d = readDraftedTeam();
    if (!d) return this.m.openDraft();
    const s = this.screen("mo-ddone", "draft", () => this.draftDone());
    if (opts.celebrate) s.append(confetti(30));
    const team = makeTeam("mydraft");
    const ov = teamOverall(d.lineup, d.scheme);
    s.append(el("h2", "stitle mo-title mo-bounce", "DRAFT COMPLETE!"));
    const body = el("div", "mo-done-body");
    const fieldBox = el("div", "mo-done-field");
    fieldBox.append(formationField(team, smallScale(), team.primary));
    body.append(fieldBox);
    const side = el("div", "mo-done-side");
    const nameRow = el("div", "mo-tname");
    const chip = el("span", "mo-chipcolor big");
    chip.style.setProperty("--c", d.primary);
    const nm = el("span", "mo-tname-t", d.name);
    const re = this.button("↻", "small mo-mini", () => {
      this.m.restyleDraft({ place: true });
      this.draftDone();
    });
    re.title = "Another name";
    nameRow.append(chip, nm, re);
    side.append(nameRow);
    side.append(el("div", "mo-tsub", `${d.abbr} · ${d.scheme.def === "43" ? "4-3" : "3-4"} DEFENSE · ${d.scheme.off === "slot" ? "SLOT WR" : "FULLBACK"}`));
    const sw = el("div", "mo-swatches");
    DRAFT_COLORS.forEach(([p], k) => {
      const b = el("button", "mo-swatch" + (p === d.primary ? " on" : ""));
      b.type = "button";
      b.style.setProperty("--c", p);
      b.setAttribute("aria-label", "Team color " + (k + 1));
      b.addEventListener("click", () => {
        this.sfx("sel");
        this.m.restyleDraft({ color: k });
        this.draftDone();
      });
      sw.append(b);
    });
    side.append(sw);
    const ovs = el("div", "mo-ovrs");
    const big = el("div", "mo-ovr-big");
    big.append(el("b", "", String(ov.ovr)), el("small", "", "OVR"));
    const grade = ov.ovr >= 97 ? "S" : ov.ovr >= 92 ? "A" : ov.ovr >= 85 ? "B" : ov.ovr >= 76 ? "C" : "D";
    const g = el("div", "mo-ovr-grade g-" + grade, grade);
    const od = el("div", "mo-ovr-od");
    od.append(el("span", "", `OFF ${ov.off}`), el("span", "", `DEF ${ov.def}`));
    ovs.append(big, g, od);
    side.append(ovs);
    const stars3 = el("div", "mo-done-stars");
    for (const id of starPlayers(team, 3)) stars3.append(monCanvas(id, { box: 64, scale: 1, cls: "mo-done-star" }));
    side.append(stars3);
    const btns = el("div", "mo-done-btns");
    const play = this.button("PLAY A GAME ▸", "primary", () => this.m.playDraft());
    btns.append(play, this.button("GYM CHALLENGE ▸", "mo-gold", () => {
      this.m.store.setTeamKind("mydraft");
      this.m.openLadder();
    }), this.button("DRAFT AGAIN", "small", () => this.m.openDraft()), this.button("TITLE", "small", () => this.m.openTitle()));
    side.append(btns);
    body.append(side);
    s.append(body);
    this.keys(s, () => this.m.openTitle(), (e) => {
      if (e.code === "KeyN") {
        re.click();
        return true;
      }
      return false;
    });
    this.focus(play);
  }

  // ---------- GYM CHALLENGE: the ladder ----------
  ladder(sel) {
    const st = this.m.store;
    let cur = gymByKey(sel) ? sel : st.nextKey() || "champion";
    const s = this.screen("mo-ladder", "gyms", () => this.ladder(cur));
    const head = el("div", "mo-lhead");
    const ttl = el("div", "mo-lttl");
    ttl.append(el("h2", "stitle mo-title", `${REGION_UP} GYM CHALLENGE`), el("div", "mo-lsub", `BEAT THE 8 GYM LEADERS IN ORDER · THEN CHAMPION ${CHAMP_UP}`));
    head.append(ttl);
    const prog = el("div", "mo-lprog");
    for (const g of GYMS) prog.append(badgeCanvas(g.key, { scale: 1, locked: !st.has(g.key), cls: "mo-lprog-b" }));
    prog.append(el("span", "mo-lprog-n", st.s.champion ? "CHAMPION!" : `${st.badgeCount()}/8 BADGES`));
    head.append(prog);
    s.append(head);
    const body = el("div", "mo-lbody");
    // the map
    const mapBox = el("div", "mo-lmap");
    const status = {};
    for (const g of LADDER) status[g.key] = st.status(g.key);
    const cv = townMap({ status });
    const short = vh() < 560 || vw() < 700;
    const big = vh() >= 900 && vw() >= 1500;
    const mscale = fitScale(MAP_W, MAP_H, short ? Math.min(300, vw() * 0.36) : Math.min(big ? 780 : 560, vw() * 0.46), short ? vh() - 120 : Math.min(vh() - 230, big ? 640 : 440));
    pixelSize(cv, MAP_W, MAP_H, mscale);
    mapBox.append(cv);
    mapBox.style.setProperty("--mw", MAP_W * mscale + "px");
    const nodes = {};
    for (const g of LADDER) {
      const [x, y] = mapPoint(g.key);
      const b = el("button", "mo-node " + status[g.key]);
      b.type = "button";
      b.style.left = (x / MAP_W) * 100 + "%";
      b.style.top = (y / MAP_H) * 100 + "%";
      b.style.setProperty("--s", String(16 * mscale) + "px");
      b.setAttribute("aria-label", `${g.order}. ${g.name} — ${status[g.key] === "won" ? "badge earned" : status[g.key] === "next" ? "next up" : "locked"}`);
      b.append(el("span", "mo-node-n", g.key === "champion" ? "★" : String(g.order)));
      b.addEventListener("click", () => {
        this.sfx("sel");
        if (cur === g.key && st.playable(g.key)) this.m.openVs(g.key);
        else select(g.key);
      });
      b.addEventListener("pointerenter", () => this.sfx());
      mapBox.append(b);
      nodes[g.key] = b;
    }
    const cursor = el("i", "mo-cursor");
    mapBox.append(cursor);
    body.append(mapBox);
    // the selected gym's card + your team
    const side = el("div", "mo-lside");
    const card = el("div", "mo-gcard");
    side.append(card);
    const teamBox = el("div", "mo-lteam");
    side.append(teamBox);
    body.append(side);
    s.append(body);
    const nav = el("div", "row mo-lnav");
    nav.append(this.button("BADGE CASE", "small", () => this.m.openBadges(() => this.m.openLadder(cur))), this.button("HALL OF FAME", "small", () => this.m.openHall({ back: () => this.m.openLadder(cur) })), this.button("◂ BACK", "small", () => this.m.openTitle()));
    s.append(nav);
    let playBtn = null;
    const select = (key) => {
      cur = key;
      const g = gymByKey(key);
      for (const k in nodes) nodes[k].classList.toggle("sel", k === key);
      const [x, y] = mapPoint(key);
      cursor.style.left = (x / MAP_W) * 100 + "%";
      cursor.style.top = (y / MAP_H) * 100 + "%";
      cursor.style.setProperty("--s", String(20 * mscale) + "px");
      playBtn = this.gymCard(card, g, st);
      if (this.redraw) this.redraw.fn = () => this.ladder(cur);
    };
    const renderTeam = () => {
      teamBox.replaceChildren();
      teamBox.append(el("div", "mo-lteam-t", "YOUR TEAM"));
      const seg = el("div", "seg mo-lteam-seg");
      const hasDraft = !!readDraftedTeam();
      const opts = [["mine", "ALL-22"], ["mydraft", hasDraft ? "MY DRAFT" : "DRAFT +"], ["draft", "QUICK"]];
      for (const [k, label] of opts) {
        const b = this.button(label, st.teamKind === k ? "on" : "", () => {
          if (k === "mydraft" && !hasDraft) return this.m.openDraft();
          st.setTeamKind(k);
          renderTeam();
        });
        seg.append(b);
      }
      teamBox.append(seg);
      const t = st.userTeam();
      const info = el("div", "mo-lteam-info");
      const chip = el("span", "mo-chipcolor");
      chip.style.setProperty("--c", t.primary);
      info.append(chip, el("span", "mo-lteam-name", t.name), el("span", "mo-lteam-ovr", `OVR ${t.overall.ovr}`));
      if (st.teamKind === "draft") {
        const r = this.button("↻", "small mo-mini", () => {
          st.rerollQuick();
          renderTeam();
        });
        r.title = "Another quick team";
        info.append(r);
      }
      teamBox.append(info);
      const heads = el("div", "mo-lteam-heads");
      for (const sl of ["QB", "HB", "WR1", "WR2", "DE1", "ILB1", "CB1", "S1"]) heads.append(headshot(t.lineup[sl], 20, { scale: smallScale() }));
      teamBox.append(heads);
    };
    renderTeam();
    select(cur);
    const order = LADDER.map((g) => g.key);
    this.keys(s, () => this.m.openTitle(), (e) => {
      const i = order.indexOf(cur);
      const at = this.curIn(s);
      const inMap = !at || at === document.body || at.classList.contains("mo-node") || at === playBtn;
      if (inMap && (e.code === "ArrowRight" || e.code === "KeyD" || e.code === "ArrowDown" || e.code === "KeyS")) {
        select(order[Math.min(order.length - 1, i + 1)]);
        this.sfx();
        this.go(playBtn);
        return true;
      }
      if (inMap && (e.code === "ArrowLeft" || e.code === "KeyA" || e.code === "ArrowUp" || e.code === "KeyW")) {
        select(order[Math.max(0, i - 1)]);
        this.sfx();
        this.go(playBtn);
        return true;
      }
      if (e.code === "KeyB") {
        this.m.openBadges(() => this.m.openLadder(cur));
        return true;
      }
      return false;
    });
    this.focus(playBtn);
  }

  gymCard(card, g, st) {
    card.replaceChildren();
    card.style.setProperty("--tc", g.primary);
    card.style.setProperty("--tc2", g.secondary);
    const status = st.status(g.key);
    card.className = "mo-gcard " + status;
    const top = el("div", "mo-gtop");
    top.append(badgeCanvas(badgeKey(g.key), { scale: smallScale() * 2, locked: status !== "won", cls: "mo-gbadge" }));
    const ttl = el("div", "mo-gttl");
    ttl.append(
      el("div", "mo-gnum", g.key === "champion" ? `${g.venue.toUpperCase()} · FINAL` : `GYM ${g.order} · ${g.city.toUpperCase()} ${g.town ? "TOWN" : "CITY"}`),
      el("div", "mo-gname", g.name),
    );
    const lead = el("div", "mo-glead");
    lead.append(el("span", "", g.key === "champion" ? `CHAMPION ${leaderUp(g)}` : `LEADER ${leaderUp(g)}`), typeChip(g.type));
    ttl.append(lead);
    top.append(ttl);
    card.append(top);
    const team = this.app.gymTeam ? this.app.gymTeam(g.key) : makeTeam(g.key);
    const meta = el("div", "mo-gmeta");
    meta.append(stars(g.stars), el("span", "mo-govr", `OVR ${team.overall.ovr}`), el("span", "mo-gstyle", (STYLE_INFO[team.style] || STYLE_INFO.balanced).label));
    card.append(meta);
    const aces = el("div", "mo-gaces");
    for (const id of (g.aces || []).slice(0, 4)) aces.append(monCanvas(id, { box: 64, scale: 1, cls: "mo-gace" }));
    card.append(aces);
    const res = st.s.badges[g.key] || (g.key === "champion" ? st.s.champion : null);
    const tries = st.s.attempts[g.key] | 0;
    let line;
    if (status === "won") line = `BEATEN ${res.score[0]}–${res.score[1]}${res.date ? " · " + res.date : ""}`;
    else if (status === "next") line = g.key === "champion" ? `ALL 8 BADGES! BEAT ${CHAMP_UP} TO BECOME CHAMPION` : `NEXT UP · WIN THE ${badgeName(g.key)} BADGE${tries ? ` · TRY ${tries + 1}` : ""}`;
    else line = g.key === "champion" ? `EARN ALL 8 BADGES TO FACE ${CHAMP_UP}` : `LOCKED · BEAT ${gymByKey(st.nextKey() || GYMS[0].key).name} FIRST`;
    card.append(el("div", "mo-gstatus", line));
    let play = null;
    if (status !== "locked") {
      play = this.button(status === "won" ? "REPLAY ▸" : g.key === "champion" ? "FACE THE CHAMPION ▸" : "CHALLENGE ▸", status === "won" ? "" : "primary", () => this.m.openVs(g.key));
      card.append(play);
    }
    return play;
  }

  // ---------- GYM CHALLENGE: VS ----------
  vs(key, home) {
    const g = gymByKey(key);
    const s = this.screen("mo-vs", "vs", () => this.vs(key, this.m.store.userTeam()));
    const away = this.app.gymTeam ? this.app.gymTeam(key) : makeTeam(key);
    s.style.setProperty("--tc", g.primary);
    s.style.setProperty("--tc2", g.secondary);
    s.style.setProperty("--uc", home.primary);
    const S = spriteScale();
    const band = el("div", "mo-vs-band");
    const you = el("div", "mo-vs-side mo-vs-you");
    you.append(el("div", "mo-vs-label", "CHALLENGER"), el("div", "mo-vs-name", home.name), el("div", "mo-vs-sub", `OVR ${home.overall.ovr}`));
    const ym = el("div", "mo-vs-mons");
    starPlayers(home, 3).forEach((id, i) => {
      const c = monCanvas(id, { box: 64, scale: S, flip: true, cls: "mo-vs-mon" });
      c.style.setProperty("--i", String(i));
      ym.append(c);
    });
    you.append(ym);
    const mid = el("div", "mo-vs-mid");
    mid.append(el("div", "mo-vs-vs", "VS"));
    const bc = badgeCanvas(badgeKey(key), { scale: S * 2, cls: "mo-vs-badge" });
    mid.append(bc, el("div", "mo-vs-prize", key === "champion" ? "THE CHAMPIONSHIP" : `${badgeName(key)} BADGE`));
    const them = el("div", "mo-vs-side mo-vs-gym");
    them.append(el("div", "mo-vs-label", key === "champion" ? "CHAMPION" : `GYM LEADER`), el("div", "mo-vs-name", leaderUp(g)), el("div", "mo-vs-sub", `${g.name} · OVR ${away.overall.ovr}`));
    const tm = el("div", "mo-vs-mons");
    starPlayers(away, 3).forEach((id, i) => {
      const c = monCanvas(id, { box: 64, scale: S, cls: "mo-vs-mon" });
      c.style.setProperty("--i", String(i));
      tm.append(c);
    });
    them.append(tm);
    const meta = el("div", "mo-vs-meta");
    meta.append(stars(g.stars), typeChip(g.type), el("span", "mo-gstyle", (STYLE_INFO[away.style] || STYLE_INFO.balanced).label));
    them.append(meta);
    band.append(you, mid, them);
    s.append(band);
    // a Pokémon-style text box with the leader's line
    const box = el("div", "mo-textbox");
    const who = el("span", "mo-tb-name", leaderUp(g));
    const txt = el("span", "mo-tb-text", "");
    box.append(who, txt, el("i", "mo-tb-arrow", "▼"));
    s.append(box);
    const line = g.quote || "";
    let n = 0;
    const tick = this.every(() => {
      n = Math.min(line.length, n + 2);
      txt.textContent = line.slice(0, n);
      if (n >= line.length) {
        clearInterval(tick);
        this.timers.delete(tick);
        box.classList.add("done");
      }
    }, 34);
    const row = el("div", "row");
    let started = false;
    const go = this.button("KICK OFF ▸", "primary", async () => {
      if (started) return;
      started = true;
      go.textContent = "LOADING…";
      go.disabled = true;
      const ok = await this.m.playGym(key);
      if (!ok) {
        started = false;
        go.disabled = false;
        go.textContent = "KICK OFF ▸";
      }
    });
    row.append(go, this.button("◂ LADDER", "small", () => this.m.openLadder(key)));
    s.append(row);
    this.keys(row, () => this.m.openLadder(key));
    this.focus(go);
    // the gym leader's challenge sting as VS slams down
    this.later(() => { if (s.isConnected) this.sound("challenge"); }, 260);
  }

  // ---------- the badge moment (over the field, before the results) ----------
  badgeMoment(c, done) {
    const g = gymByKey(c.key);
    const champ = c.key === "champion";
    const panel = this.modal("mo-badge-modal");
    panel.classList.add("mo-bm");
    panel.style.setProperty("--tc", g.primary);
    panel.append(el("div", "mo-bm-top", champ ? "CHAMPION!" : "GYM CLEARED!"));
    const stage = el("div", "mo-bm-stage");
    const S = vh() < 560 ? 5 : 8;
    const frames = spinFrames(badgeKey(c.key));
    const white = spinFrames(badgeKey(c.key), "#ffffff")[0];
    const cv = document.createElement("canvas");
    cv.width = 16;
    cv.height = 16;
    cv.className = "mo-px mo-bm-badge";
    pixelSize(cv, 16, 16, S);
    drawFrame(cv, frames[0]);
    stage.append(cv);
    // sparkles around it: axis-aligned pixel crosses placed on a ring (no rotated pixels)
    const half = Math.round(16 * pixelSize(cv, 16, 16, S) * 0.5);
    const R = half + 18;
    stage.style.padding = `${R - half + 10}px ${R - half + 26}px`;
    for (let i = 0; i < 8; i++) {
      const sp = el("i", "mo-spark");
      const a = (i * Math.PI) / 4;
      sp.style.setProperty("--x", String(Math.round(Math.cos(a) * R) - 3) + "px");
      sp.style.setProperty("--y", String(Math.round(Math.sin(a) * R) - 3) + "px");
      sp.style.setProperty("--i", String(i));
      stage.append(sp);
    }
    panel.append(stage);
    panel.append(el("div", "mo-bm-title", champ ? `${REGION_UP} CHAMPION` : `${badgeName(c.key)} BADGE`));
    panel.append(el("div", "mo-bm-text", champ ? `YOU BEAT THE ${CHAMPION.name}!` : `YOU EARNED THE ${badgeName(c.key)} BADGE!`));
    const q = el("div", "mo-bm-quote");
    q.append(el("b", "", leaderUp(g) + ": "), el("span", "", g.beaten || ""));
    panel.append(q);
    const caseRow = el("div", "mo-bm-case");
    for (const gg of GYMS) {
      const b = badgeCanvas(gg.key, { scale: vh() < 560 ? 1 : 2, locked: !this.m.store.has(gg.key), cls: gg.key === c.key ? "mo-bm-new" : "" });
      caseRow.append(b);
    }
    panel.append(caseRow);
    const row = el("div", "row");
    const cont = this.button("CONTINUE ▸", "primary", () => {
      clearInterval(spin);
      done();
    });
    row.append(cont);
    panel.append(row);
    // two quick stepped spins, then one more every few seconds while the moment is on screen
    let t = 0;
    const spin = setInterval(() => {
      if (!cv.isConnected) {
        clearInterval(spin);
        return;
      }
      t++;
      const n = frames.length;
      if (t === 9 || t === 10) return drawFrame(cv, white); // it lands: a white hit flash
      const k = t < 2 * n ? t % n : (t - 2 * n) % 56 < n ? (t - 2 * n) % 56 : 0;
      drawFrame(cv, frames[k]);
    }, 60);
    this.ui.keyHandler = (e) => {
      if (["Enter", "NumpadEnter", "Space", "Escape"].includes(e.code)) {
        if (!e.repeat) cont.click(); // Space still held from the game doesn't skip the moment
        return true;
      }
      return false;
    };
    this.focus(cont);
  }

  // Results of a ladder game: what it meant + the next step (NEXT GYM / RETRY / LADDER / HALL OF FAME).
  decorateResults(w, c) {
    const m = this.ui.modalEl;
    if (!m) return;
    const panel = m.querySelector(".panel") || m;
    const g = gymByKey(c.key);
    const st = this.m.store;
    const won = c.result === "win";
    const champ = c.key === "champion";
    const line = el("div", "mo-res-line " + (won ? "win" : "loss"));
    m.classList.add("scroll-ok"); // let a tall results card scroll on phones
    if (won) {
      line.append(badgeCanvas(badgeKey(c.key), { scale: smallScale(), cls: "mo-res-badge" }));
      line.append(el("span", "", champ ? (c.fresh ? `YOU ARE THE ${REGION_UP} CHAMPION!` : "YOU DEFEND YOUR TITLE!") : c.fresh ? `${badgeName(c.key)} BADGE EARNED · ${st.badgeCount()}/8` : `${leaderUp(g)} BEATEN AGAIN`));
    } else {
      line.append(el("span", "", c.result === "tie" ? `A TIE WON'T EARN THE ${champ ? "TITLE" : "BADGE"} · TRY AGAIN` : `${leaderUp(g)} WINS THIS ONE · TRY AGAIN`));
    }
    const banner = panel.querySelector(".final-score") || panel.querySelector(".result-banner");
    if (banner) banner.after(line);
    else panel.prepend(line);
    const btns = [...panel.querySelectorAll("button")];
    const byText = (re) => btns.find((b) => re.test(b.textContent));
    const rematch = byText(/REMATCH/), newOpp = byText(/NEW OPPONENT/);
    if (rematch) {
      rematch.textContent = won ? "REPLAY" : "RETRY";
      if (won) rematch.classList.remove("primary");
    }
    if (newOpp) newOpp.textContent = "GYM LADDER";
    let lead = null;
    const nextKey = st.nextKey();
    if (won && champ) lead = this.button("HALL OF FAME ▸", "primary mo-gold", () => this.m.toHall());
    else if (won && nextKey) {
      const ng = gymByKey(nextKey);
      lead = this.button(nextKey === "champion" ? "FACE THE CHAMPION ▸" : `NEXT: ${leaderUp(ng)} ▸`, "primary", () => this.m.nextGym());
    }
    const row = (rematch && rematch.parentElement) || (newOpp && newOpp.parentElement);
    if (lead) {
      if (row) row.prepend(lead);
      else {
        const r = el("div", "row");
        r.append(lead);
        panel.append(r);
      }
    }
    if (!rematch && !newOpp) {
      // the results screen changed shape: add our own way back to the ladder
      const r = el("div", "row");
      r.append(this.button(won ? "REPLAY" : "RETRY", won ? "" : "primary", () => this.m.retry()), this.button("GYM LADDER", "", () => this.m.toLadder(c.key)));
      panel.append(r);
    }
    // through the UI's selection: its highlight is what Enter / a gamepad's A press (a bare focus() left them on REPLAY)
    if (lead) this.ui.focusLater(lead);
  }

  // ---------- BADGE CASE ----------
  badgeCase(back) {
    const st = this.m.store;
    const s = this.screen("mo-badges", "badges", () => this.badgeCase(back));
    s.append(el("h2", "stitle mo-title", "BADGE CASE"));
    const box = el("div", "mo-case");
    box.append(el("div", "mo-case-lid", `${REGION_UP} LEAGUE`));
    const grid = el("div", "mo-case-grid");
    const S = vh() < 560 ? 2 : vh() >= 900 && vw() >= 1500 ? 4 : 3;
    for (const g of GYMS) {
      const won = st.has(g.key);
      const sock = el("div", "mo-sock" + (won ? " won" : ""));
      sock.style.setProperty("--tc", g.primary);
      const holder = el("div", "mo-sock-art");
      holder.append(badgeCanvas(g.key, { scale: S, locked: !won }));
      sock.append(holder, el("div", "mo-sock-name", badgeName(g.key)));
      const r = st.s.badges[g.key];
      // the score (or city) never splits across lines, however long the leader's name (TATE & LIZA, CRASHER WAKE)
      const sub = el("div", "mo-sock-sub", `${leaderUp(g)} · `);
      sub.append(el("span", "", won ? `${r.score[0]}–${r.score[1]}` : g.city.toUpperCase()));
      sock.append(sub);
      grid.append(sock);
    }
    box.append(grid);
    const champ = el("div", "mo-case-champ" + (st.s.champion ? " won" : ""));
    champ.append(badgeCanvas("champion", { scale: S, locked: !st.s.champion }));
    const ct = el("div", "mo-case-champ-t");
    ct.append(el("div", "", st.s.champion ? `${REGION_UP} CHAMPION` : "THE CHAMPIONSHIP"), el("small", "", st.s.champion ? `BEAT ${CHAMP_UP} ${st.s.champion.score[0]}–${st.s.champion.score[1]} · TITLES ${st.s.titles}` : `EARN ALL 8 BADGES, THEN BEAT ${CHAMP_UP}`));
    champ.append(ct);
    box.append(champ);
    s.append(box);
    const rec = st.s.record;
    s.append(el("div", "mo-case-stats", `RECORD ${rec.w}–${rec.l}${rec.t ? "–" + rec.t : ""} · CHALLENGE ${st.s.runs}`));
    const row = el("div", "row");
    const b = this.button("◂ BACK", "", back);
    row.append(b, this.button("HALL OF FAME", "small", () => this.m.openHall({ back: () => this.m.openBadges(back) })));
    s.append(row);
    this.keys(row, back);
    this.focus(b);
  }

  // ---------- HALL OF FAME ----------
  hall(opts = {}) {
    const st = this.m.store;
    const back = opts.back || (() => this.m.openLadder());
    const s = this.screen("mo-hall", "hall", () => this.hall({ ...opts, induct: false }));
    s.append(el("h2", "stitle mo-title mo-gold-t", "HALL OF FAME"));
    const list = st.s.hall;
    let idx = Math.max(0, Math.min(list.length - 1, opts.index | 0));
    const row = el("div", "row");
    if (!list.length) {
      const e = el("div", "panel mo-panel mo-hof-empty");
      e.append(badgeCanvas("champion", { scale: smallScale() * 3, locked: true }), el("div", "mo-hof-empty-t", "NO CHAMPIONS YET"), el("div", "mo-note", `Win all 8 gym badges, then beat ${CHAMPION.foe} to put your team in the Hall of Fame.`));
      s.append(e);
      const go = this.button("GYM CHALLENGE ▸", "primary", () => this.m.openLadder());
      row.append(go, this.button("◂ BACK", "small", back));
      s.append(row);
      this.keys(row, back);
      this.focus(go);
      return;
    }
    const stage = el("div", "mo-hof");
    const draw = (induct) => {
      stage.replaceChildren();
      const h = list[idx];
      stage.style.setProperty("--tc", h.primary || "#e8352a");
      const hd = el("div", "mo-hof-head");
      const chip = el("span", "mo-chipcolor big");
      chip.style.setProperty("--c", h.primary || "#e8352a");
      const ttl = el("div", "mo-hof-ttl");
      const nameRow = el("div", "mo-hof-namerow");
      nameRow.append(chip, el("span", "mo-hof-team", h.name || "CHAMPIONS"));
      ttl.append(el("div", "mo-hof-kicker", `${REGION_UP} CHAMPIONS`), nameRow, el("div", "mo-hof-date", `${h.date || ""} · CHALLENGE ${h.run || 1} · BEAT ${CHAMP_UP} ${h.score ? h.score[0] + "–" + h.score[1] : ""}${h.record ? ` · RECORD ${h.record.w}–${h.record.l}` : ""}`));
      hd.append(badgeCanvas("champion", { scale: smallScale() * 2, cls: "mo-hof-cup" }), ttl);
      stage.append(hd);
      const grid = el("div", "mo-hof-grid" + (induct ? " induct" : ""));
      // 2× sprites on big screens (four rows of 7 fit), 1× elsewhere (two rows on a laptop)
      const S = vh() >= 940 && vw() >= 1300 ? 2 : 1;
      grid.style.setProperty("--hs", String(S));
      const order = [...OFF_SLOTS, ...DEF_SLOTS, "K"];
      order.forEach((sl, i) => {
        const id = h.lineup[sl];
        if (!id) return;
        const cell = el("div", "mo-hof-cell");
        cell.style.setProperty("--i", String(i));
        cell.append(monCanvas(id, { box: 64, scale: S, cls: "mo-hof-mon" }), el("div", "mo-hof-name", monName(id)), el("div", "mo-hof-slot", sl));
        grid.append(cell);
      });
      stage.append(grid);
      if (induct) stage.append(confetti(36));
    };
    draw(!!opts.induct);
    s.append(stage);
    if (list.length > 1) {
      const pager = el("div", "mo-hof-pager");
      const show = (d) => {
        idx = (idx + d + list.length) % list.length;
        draw(false);
        label.textContent = `${idx + 1} / ${list.length}`;
      };
      const prev = this.button("◂ OLDER", "small", () => show(1));
      const next = this.button("NEWER ▸", "small", () => show(-1));
      const label = el("span", "mo-hof-page", `${idx + 1} / ${list.length}`);
      pager.append(prev, label, next);
      s.append(pager);
    }
    const champ = !!st.s.champion;
    const main = this.button(champ ? "NEW CHALLENGE ▸" : "GYM CHALLENGE ▸", "primary", () => {
      if (champ) st.newRun();
      this.m.openLadder();
    });
    row.append(main, this.button("BADGE CASE", "small", () => this.m.openBadges(() => this.m.openHall({ back }))), this.button("TITLE", "small", () => this.m.openTitle()));
    s.append(row);
    this.keys(s, back);
    this.focus(main);
  }

  // ---------- the in-game chip: which badge is on the line ----------
  chip(c) {
    if (!this.chipEl) {
      this.chipEl = el("div", "mo-ingame hidden");
      this.ui.root.append(this.chipEl);
    }
    const e = this.chipEl;
    if (!c) {
      e.classList.add("hidden");
      return;
    }
    const g = gymByKey(c.key);
    e.replaceChildren(
      badgeCanvas(badgeKey(c.key), { scale: 1 }),
      el("span", "mo-ing-full", c.key === "champion" ? "CHAMPIONSHIP · " : `${badgeName(c.key)} BADGE · `),
      el("span", "", `VS ${leaderUp(g)}`),
    );
    e.title = c.key === "champion" ? "The championship game" : `Win to earn the ${badgeName(c.key)} Badge`;
    e.style.setProperty("--tc", g.primary);
    e.classList.remove("hidden");
  }
}
