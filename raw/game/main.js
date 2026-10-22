// Boot + app controller: preloads sprites, owns the screens flow (title with an attract-mode
// game behind it → team select → opponent select → game → results), runs the fixed 60 Hz
// simulation and renders every animation frame.
//
// ============================== MODULE MAP ==============================
// One owner per file. The sim never touches the DOM or presentation state; presentation reads the
// sim and reacts to its events, never writes sim state. Talk across the seam only via the bus.
//
// SIM (no DOM; runs headless in simulate()) — football team
//   config.js    CFG tuning constants, HIT thresholds, palette.
//   util.js      makeRng(seed) (all sim randomness), clamp/lerp/dist, shade/hexToRgb, PARAMS (URL).
//   data.js      (modes team) Pokémon ratings (ratingsFor), REGION (regions.js: Kanto, Johto ...; its
//                Pokédex, league and save keys), GYMS + champion (team.style / aggression for CPU
//                tendencies), makeTeam(kind: 'mine' | 'draft' | 'mydraft' | gym | 'champion'),
//                kitFor / resolveColors (clash-safe kits), ladderTune, lineups.
//   playbook.js  OFF_PLAYS / DEF_PLAYS / KICK_PLAYS, formations, routes, offPlay(id)/defPlay(id).
//   entities.js  Player (sim fields + p.anim slot created by anim.makeAnimState) and Ball.
//   physics.js   movement (steer/integrate/separate), blocking (engage/disengage/pancake), tackles,
//                jukes/stiff-arms/dives, throws/pitches, ball flight, catches/INTs/fumbles.
//   ai.js        alignFormation, setupPlay, think (per-step behaviour), CPU play calls
//                (cpuOffenseCall, cpuDefenseCall, cpuFourthDown, cpuOnside, cpuPatChoice).
//   football-special.js  kickoffs / punts with real returns: units, coverage, return blocking,
//                touchbacks, onside kicks, fair catches, muffs (called by world.js).
//   world.js     World: rules + game flow (phases, downs, scoring, kicks, clock, OT, stats).
//                new World({bus, seed, home, away, quarterSec, autoplay, human, headless, debug})
//                update(dt, input)  one fixed step; input = Input.state (read-only) or null;
//                                   consumedInput → caller runs input.endTick()
//                emit(type, payload) every sim event (listeners get (payload, type, world))
//                submitCall(side 'off'|'def', playId, flip)  callKey(side)  cpuOffense(team)
//                continueHalftime()  summary()  mvp()  isHuman(team)  dirOf(p)
//                choosePAT('kick'|'two') (PAT_CHOICE)  chooseKickoff('deep'|'onside') (KICKOFF)
//                actionLabels() → {a, b} | null (special-teams button labels); the round-2 rules,
//                phases and events are documented at the top of world.js.
//                state: phase phaseT time quarter clock score possession offense defense down toGo
//                los firstDownX ballY play (off, def, t, result, carrier...) players offPlayers
//                defPlayers teams.{home,away}.{data,O,D,K,all} ball userPlayer userActive human
//                autoplay overtime winner stats errors
//   events.js    createBus() / bus (live) / silentBus, NO_PAYLOAD, reportError() + errorLog.
//                Bus.emit isolates listener exceptions. THE EVENT CONTRACT (all events + payloads)
//                is documented at the top of events.js.
//
// PRESENTATION (reads the sim, never writes it) — anim/fx, render/camera and ui teams
//   anim.js      attachAnim(bus) → detach: sets p.anim pose state from sim events (call BEFORE
//                new FX/Audio so they see the new pose); makeAnimState(); poseFor(p, t, out) →
//                whole-pixel pose; makePose(); footfall(p, t, dt).
//   camera.js    ART geometry (22 px/yd, squash, ZPX, stands/apron); Camera {follow(dt, world,
//                viewW, viewH) (targeting + lookahead + spring), update(dt, tx, ty, viewW, viewH),
//                addShake(px), screenToWorld(cssX, cssY, cssPerArt), ix, iy, snapNext};
//                wx(x)/wy(y) world → art px; PX, PY, ZPX; chooseScale(devW, devH).
//   render.js    Renderer {prebuild(world), render(world, cam, fx, zoom), view(zoom) → {w, h, s},
//                resize(), s, k, S, cssPerArt}; loadSprite(id) / getSprite(id); isTouch();
//                buildField; ballFrames; pixel primitives.
//   art-stadium.js  stadium/field builder per gym mood (sky, skyline, crowd frames, ads, end
//                zones + type emblems, logo); art-kit.js kitsFor(world) (clash-safe team colors,
//                uses data.kitFor if present).
//   fx.js        FX(bus, cam): bus-driven particles, hit-stop (hitStop), shake, banners, pops,
//                confetti, weather, crowd cheer; setWorld(w, attract), update(dt, world),
//                drawSky/drawGround/drawWorld/drawWeather/drawScreen; slowmo, punch.
//   audio.js     Audio: bind(bus) (main gates it to the live game), unlock, setMuted, startMusic,
//                stopMusic, setGameAmbience(on), setPaused(on), step(), play(name) (stings + sfx,
//                SOUND_NAMES), setVolume/getVolume, resultOverride (a mode's sting replaces the
//                victory jingle). Engine in audio-synth/-bank/-sfx/-music/-crowd.js (audio-lab.js
//                is test-only, never loaded by the game).
//   pixelfont.js drawText/textCanvas/textWidth/drawTextVertical/rotate90 (5×7 + 3×5 pixel fonts,
//                per-row color ramps, outline, drop shadow, bold).
//   ui.js        UI(root, app) — DOM screens: showTitle, showHelp, showSettings, showTeamSelect,
//                showOppSelect, showPlayCall(w, onPick)/hidePlayCall/tickPlayCall(w) (pc.pick(id)),
//                setHudVisible, updateHud(w) (also the PAT / onside decision panels and the touch
//                context labels), lowerThird(w, result), showPause, showHalftime, showResults,
//                closeModal, clear, screenName(); UI kit for other modules: addMenuButton,
//                addTeamCard, screen, panel, button, navKeys, teamCard (see the top of ui.js).
//                ui-art.js pixel icons/emblems/logo; ui-diagram.js play-card diagrams.
//
// MODES (modes team) — installModes(app) hooks in after the App is built
//   modes.js     DRAFT YOUR TEAM (arena draft) + GYM CHALLENGE (ladder, badges, Hall of Fame);
//                patches ui.showTitle/showTeamSelect/showResults and app.startGame/leaveGame/
//                screen; saves all22bowl-drafted-v1 / -draft-run-v1 / -gyms-v1 (per region);
//                __game.modes hooks.
//   modes-ui.js  the screens (draft, Town Map ladder, VS, badge moment, badge case, Hall of Fame);
//                modes-art.js pixel badges / Town Map / headshots; styles in bowl-modes.css.
//
// GLUE
//   input.js     Input(root): keyboard + touch + gamepad → state {mx, my, a, b, aPressed, bPressed,
//                num, tapX, tapY, pause}; poll() per frame, endTick() after the world used the
//                presses, setTouchVisible(on), setLabels(a, b) (the UI's setContextLabels wins),
//                device ('kb' | 'touch' | 'pad'), rumble(), enabled.
//   test.js      TEST (URL params), simulate({games, seed, home, away, quarterSec}),
//                installHooks(app) → window.__game { state(), stats(), errors, simulate, setSpeed,
//                advance(ms) (?manual=1 clock), press(keys, ms), choosePlay(id), user(), bus,
//                world(), app }.
//   main.js      App: screens flow, loop (frame → tick = step(dt) + draw(w); advance(ms)), camera
//                targeting, play-call/halftime/results wiring, touch labels.
// =========================================================================
import { CFG } from "./config.js";
import { bus } from "./events.js";
import { World } from "./world.js";
import { makeTeam, GYMS, LADDER, ALL_SLOTS, exhibitionTune } from "./data.js";
import { Renderer, loadSprite, isTouch, viewBox } from "./render.js";
import { Camera, wx, wy } from "./camera.js";
import { FX } from "./fx.js";
import { Input } from "./input.js";
import { Audio } from "./audio.js";
import { UI } from "./ui.js";
import { TEST, installHooks } from "./test.js";
import { cpuOffenseCall, cpuDefenseCall } from "./ai.js";
import { OFF_PLAYS, DEF_PLAYS } from "./playbook.js";
import { footfall, attachAnim } from "./anim.js";
import { installModes } from "./modes.js"; // modes team: Draft Your Team + Gym Challenge (game/modes*.js)
import { B as BIND, keyId } from "./bindings.js"; // the player's controls (Settings → CONTROLS)

const SETTINGS_KEY = "all22bowl-settings";

class App {
  constructor() {
    this.canvas = document.getElementById("game");
    this.uiRoot = document.getElementById("ui");
    this.errors = [];
    // art: every screen defaults to the standard WIDE camera (camera.js chooseScale sizes it per
    // screen; CLOSE is one step bigger). Touch screens used to default to CLOSE and saved it with
    // any setting change: camV 2 moves them back to WIDE once.
    this.settings = { quarterMin: 2, scanlines: false, camera: "wide" };
    try {
      Object.assign(this.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"));
    } catch (_) {}
    if (this.settings.camV !== 2 && isTouch()) this.settings.camera = "wide";
    this.settings.camV = 2;
    if (![2, 3, 5].includes(this.settings.quarterMin)) this.settings.quarterMin = 2;
    this.renderer = new Renderer(this.canvas);
    this.cam = new Camera();
    attachAnim(bus); // first: poses are set before fx/audio/ui react to the same event
    this.fx = new FX(bus, this.cam);
    this.input = new Input(this.uiRoot);
    // touch: input.js asks before starting the floating stick whether a tap is on a receiver
    this.audio = new Audio(null);
    this.bindAudio();
    this.ui = new UI(this.uiRoot, this);
    this.world = null; // the live game
    this.attract = null; // title-screen AI game
    this.scr = "boot";
    this.paused = false;
    this.speedN = TEST.speed;
    this.acc = 0;
    this.last = performance.now();
    this.vnow = 0; // ?manual=1: virtual ms clock advanced by __game.advance()
    this.gymCache = new Map();
    this.draftSeed = (Date.now() % 100000) | 0;
    this.seedBase = TEST.seed != null ? TEST.seed : (Date.now() % 1e9) | 0;
    this.gamesStarted = 0;
    this.pcShownFor = -1;
    this.resultsShown = false;
    this.halftimeShown = false;
    document.body.classList.toggle("scanlines", !!this.settings.scanlines);
    this.vpW = window.innerWidth;
    this.vpH = window.innerHeight;
    window.addEventListener("resize", () => {
      this.vpW = window.innerWidth; // the size this layout was built for (frame())
      this.vpH = window.innerHeight;
      this.renderer.resize();
      this.cam.snapNext = true;
    });
    // iOS Safari can leave the reported size stale (back from another tab or app, after a rotation): the viewport box
    // changing size refits the canvas too, and so does a check a moment after the page comes back into view
    if (window.ResizeObserver) new ResizeObserver(() => this.refit()).observe(viewBox());
    const later = () => { for (const ms of [100, 500, 1500]) setTimeout(() => this.refit(), ms); };
    document.addEventListener("visibilitychange", () => { if (!document.hidden) later(); });
    window.addEventListener("pageshow", later);
    window.addEventListener("orientationchange", later);
    const unlock = () => this.audio.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("keydown", (e) => {
      if ((e.code === "Escape" || BIND.pauseKeys.has(keyId(e))) && this.scr === "game" && !this.ui.pc && !this.ui.modalEl) {
        e.preventDefault();
        this.pause();
      }
      if (this.scr === "title" && (e.code === "Enter" || e.code === "Space") && !(document.activeElement && document.activeElement.matches && document.activeElement.matches("button"))) this.goTeamSelect();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.scr === "game" && !this.paused && !TEST.autoplay && !TEST.nopause) this.pause();
    });
    // never let the page scroll / zoom while playing. A tap is still a tap when the finger wobbles a pixel or two:
    // iPhone Safari drops the click of a touch whose touchmove was prevented (menu taps that "sometimes do nothing"),
    // so one finger is held only once it has dragged past the tap slop; two fingers (a pinch) always are
    const TAP_SLOP = 16;
    const touchFrom = new Map(); // touch id → [x, y, dragging]
    const forget = (e) => { for (const t of e.changedTouches) touchFrom.delete(t.identifier); };
    document.addEventListener("touchstart", (e) => { for (const t of e.changedTouches) touchFrom.set(t.identifier, [t.clientX, t.clientY, false]); }, { passive: true, capture: true });
    document.addEventListener("touchend", forget, { passive: true, capture: true });
    document.addEventListener("touchcancel", forget, { passive: true, capture: true });
    document.addEventListener("touchmove", (e) => {
      if (e.target.closest && e.target.closest(".scroll-ok")) return;
      if (e.touches.length > 1) return e.preventDefault();
      for (const t of e.changedTouches) {
        const p = touchFrom.get(t.identifier);
        if (p && !p[2] && Math.hypot(t.clientX - p[0], t.clientY - p[1]) > TAP_SLOP) p[2] = true;
        if (!p || p[2]) return e.preventDefault();
      }
    }, { passive: false });
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("dblclick", (e) => e.preventDefault());
    // broadcast lower-third after every whistle in the live game
    bus.on("whistle", ({ result }) => {
      if (this.scr === "game" && this.world && !this.world.autoplay) this.ui.lowerThird(this.world, result);
    });
    installHooks(this);
  }
  // The screen the player actually sees (title, team, opponent, playcall, game, halftime,
  // results, pause, howto, settings); this.scr is the coarse flow state the app runs on.
  screen() {
    const u = this.ui.screenName();
    if (u) return u;
    return this.scr === "opp" ? "opponent" : this.scr;
  }
  // UI clock (play clock, diagrams): real time, or the virtual clock under ?manual=1.
  now() { return TEST.manual ? this.vnow : performance.now(); }
  currentWorld() { return this.scr === "game" ? this.world : this.world || this.attract; }
  speed() { return this.speedN; }
  setSpeed(n) { this.speedN = n; }
  setMuted(m) {
    this.audio.unlock();
    this.audio.setMuted(m);
  }
  setSetting(k, v) {
    this.settings[k] = v;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (_) {}
    document.body.classList.toggle("scanlines", !!this.settings.scanlines);
  }
  bindAudio() {
    // only the live game makes match sounds (the attract game behind the title is silent)
    const real = this.audio;
    const gate = { on: (t, fn) => bus.on(t, (p) => { if (this.scr === "game" && !this.paused) fn(p); }) };
    real.bind(gate);
  }
  gymTeam(key) {
    if (!this.gymCache.has(key)) this.gymCache.set(key, makeTeam(key));
    return this.gymCache.get(key);
  }

  async preloadTeams(...teams) {
    const ids = new Set();
    for (const t of teams) for (const s of [...ALL_SLOTS, "K"]) if (t.lineup[s]) ids.add(t.lineup[s]);
    await Promise.all([...ids].map((id) => loadSprite(id)));
  }

  // ---------- flow ----------
  async boot() {
    this.scr = "title";
    const mine = makeTeam("mine");
    if (TEST.quick) {
      // ?opp= any ladder key: the eight gyms or "champion" (default: the second gym, Cerulean in Kanto)
      const opp = TEST.opp && LADDER.find((g) => g.key === TEST.opp) ? TEST.opp : GYMS[1].key;
      const away = makeTeam(opp);
      await this.preloadTeams(mine, away);
      this.startGame(mine, away);
    } else {
      await this.startAttract();
      this.ui.showTitle();
      this.audio.startMusic();
      this.input.enabled = false;
    }
    requestAnimationFrame((t) => this.frame(t));
    document.body.classList.add("ready");
  }

  async startAttract() {
    const r = (this.seedBase % GYMS.length + GYMS.length) % GYMS.length;
    const a = makeTeam(GYMS[r].key), b = makeTeam(GYMS[(r + 3) % GYMS.length].key);
    await this.preloadTeams(a, b);
    this.attract = new World({ bus, seed: this.seedBase + 99, autoplay: true, home: a, away: b, quarterSec: 600 });
    this.renderer.prebuild(this.attract);
    this.fx.setWorld(this.attract, true); // art: attract mode = no banners/pop-ups over the menus
    this.cam.snapNext = true;
  }

  // back to the menus: the attract game plays behind them again
  leaveGame() {
    this.ui.closeModal();
    this.ui.hidePlayCall();
    this.ui.setHudVisible(false);
    this.input.setTouchVisible(false);
    this.input.enabled = false;
    this.world = null;
    this.paused = false;
    this.audio.setPaused(false);
    this.audio.setGameAmbience(false);
    this.audio.startMusic();
    if (!this.attract) this.startAttract();
    else this.fx.setWorld(this.attract, true); // art: attract mode
    this.cam.snapNext = true;
  }
  goTitle() {
    this.leaveGame();
    this.scr = "title";
    this.ui.showTitle();
  }
  goTeamSelect() {
    this.scr = "team";
    const mine = makeTeam("mine");
    const draft = makeTeam("draft", { seed: this.draftSeed });
    this.ui.showTeamSelect(
      mine, draft,
      () => this.goOppSelect(mine),
      () => this.goOppSelect(draft),
      () => { this.draftSeed++; this.goTeamSelect(); },
      () => this.goTitle(),
    );
  }
  goOppSelect(team) {
    this.scr = "opp";
    this.chosen = team;
    const visit = (this.oppVisit = {}); // this visit to the screen: one pick starts one game
    this.ui.showOppSelect(async (key) => {
      if (visit.picked) return; // a double-click lands twice while the sprites load
      visit.picked = true;
      const away = exhibitionTune(makeTeam(key));
      const home = team.key === "draft" ? makeTeam("draft", { seed: team.draftSeed }) : makeTeam(team.key);
      await this.preloadTeams(home, away);
      if (this.oppVisit !== visit || this.scr !== "opp") return; // BACK while they loaded
      this.startGame(home, away);
    }, () => this.goTeamSelect());
  }

  startGame(home, away) {
    this.ui.clear();
    this.ui.closeModal();
    this.audio.stopMusic();
    this.audio.setGameAmbience(true);
    this.gamesStarted++;
    const seed = TEST.seed != null ? TEST.seed + this.gamesStarted - 1 : (this.seedBase + this.gamesStarted * 7919) >>> 0;
    const qsec = TEST.quarter || this.settings.quarterMin * 60;
    this.lastTeams = { home, away };
    this.world = new World({ bus, seed, autoplay: TEST.autoplay, human: "home", home, away, quarterSec: qsec, debug: TEST.debug });
    this.renderer.prebuild(this.world);
    this.fx.setWorld(this.world);
    this.scr = "game";
    this.paused = false;
    this.audio.setPaused(false);
    this.pcShownFor = -1;
    this.resultsShown = false;
    this.halftimeShown = false;
    this.cam.snapNext = true;
    this.ui.setHudVisible(true);
    this.input.enabled = true;
    this.input.setTouchVisible(!TEST.autoplay);
  }

  pause() {
    // not over halftime, the results or the badge moment: PAUSED would replace them, and RESUME can't bring them back
    if (this.scr !== "game" || this.paused || this.ui.modalEl) return;
    this.paused = true;
    this.input.enabled = false;
    this.audio.setPaused(true); // stadium muffled + pause tone
    this.ui.showPause(() => this.resume(), () => this.restart(), () => this.goTitle());
  }
  pauseHelp() {
    this.ui.showHelp(() => {
      this.ui.clear();
      this.ui.showPause(() => this.resume(), () => this.restart(), () => this.goTitle());
    });
  }
  resume() {
    this.ui.closeModal();
    this.ui.clear();
    this.paused = false;
    this.audio.setPaused(false);
    this.input.enabled = true;
    this.last = performance.now();
    if (this.world && this.world.phase === "PLAY_CALL") this.pcShownFor = -1;
    // the pause menu replaced the halftime / final screen: bring it back
    if (this.world && this.world.phase === "HALFTIME" && !this.world.halftimeDone) this.halftimeShown = false;
    if (this.world && this.world.phase === "GAME_OVER") this.resultsShown = false;
  }
  restart() {
    const t = this.lastTeams;
    this.ui.closeModal();
    this.ui.clear();
    // an exhibition rematch keeps the exhibition gym (a Gym Challenge rematch is re-tuned by modes.js)
    const away = makeTeam(t.away.key);
    if (t.away.exhibition) exhibitionTune(away);
    this.startGame(makeTeam(t.home.key === "draft" ? "draft" : t.home.key, { seed: t.home.draftSeed }), away);
  }

  // ---------- loop ----------
  // the canvas doesn't cover the visible viewport any more (no resize event said so): fit everything again
  refit() {
    if (this.renderer.stale()) window.dispatchEvent(new Event("resize"));
  }
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    // a size change with no resize event after it (iOS can report a rotation or Safari's bars late), or a stale size
    // that never changes at all (render.js viewSize)
    if (window.innerWidth !== this.vpW || window.innerHeight !== this.vpH) window.dispatchEvent(new Event("resize"));
    else if (now - (this.fitT || 0) > 500) {
      this.fitT = now;
      this.refit();
    }
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (TEST.manual) return; // ?manual=1: only __game.advance(ms) moves the game
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    try {
      this.tick(dt);
    } catch (e) {
      this.reportFrameError(e);
    }
  }
  reportFrameError(e) {
    if (this.errors.length < 20) this.errors.push(String((e && e.stack) || e).slice(0, 400));
    console.error(e);
  }

  // Manual clock (?manual=1 or any time): runs `ms` of wall-clock time as 1/60 s frames (fixed-step
  // sim updates, fx, camera, UI) synchronously, then renders exactly one frame.
  advance(ms) {
    const frames = Math.max(0, Math.round((Number(ms) || 0) / (1000 / 60)));
    let w = null;
    try {
      for (let i = 0; i < frames; i++) {
        this.vnow += 1000 / 60;
        w = this.step(1 / 60) || w;
      }
      w = this.scr === "game" ? this.world : this.attract || w;
      if (w) this.draw(w);
    } catch (e) {
      this.reportFrameError(e);
    }
    return frames;
  }

  tick(dt) {
    const w = this.step(dt);
    if (w) this.draw(w);
  }

  // One frame of game logic: input → world (fixed 60 Hz steps), fx, camera. Returns the world shown.
  step(dt) {
    // ?autoplay=1 soak tests: a rematch (seed + 1) a few seconds after the final whistle
    if (TEST.autoplay && this.scr === "game" && this.world && this.world.phase === "GAME_OVER" && this.world.phaseT > 6) this.restart();
    const w = this.scr === "game" ? this.world : this.attract;
    if (!w) return null;
    const live = this.scr === "game" && !this.paused;
    // input → world
    let inp = null;
    if (this.scr === "game" && this.world) {
      const s = this.input.poll();
      if (s.pause) {
        s.pause = false;
        if (!this.ui.pc) this.pause();
      }
      if (s.tapPending) {
        s.tapPending = false;
        const r = this.canvas.getBoundingClientRect();
        const p = this.cam.screenToWorld(s.tapX - r.left, s.tapY - r.top, this.renderer.cssPerArt);
        s.tapX = p.x;
        s.tapY = p.y;
      } else {
        s.tapX = s.tapY = null;
      }
      inp = s;
      this.gameUi(w);
    }
    // simulate
    if (this.scr !== "game" || live) {
      const scale = this.fx.slowmo && !TEST.autoplay ? CFG.SLOWMO : 1;
      if (this.fx.hitStop > 0) this.fx.hitStop -= dt;
      else {
        this.acc += dt * scale;
        let n = 0;
        while (this.acc >= CFG.DT && n < 6) {
          for (let k = 0; k < this.speedN; k++) {
            w.update(CFG.DT, inp);
            // edge presses are used once: the world consumed them this step
            if (inp && w.consumedInput) this.input.endTick();
          }
          this.acc -= CFG.DT;
          n++;
          if (inp && w.phase !== "LIVE" && w.phase !== "PRE_SNAP") this.input.endTick();
        }
        if (n >= 6) this.acc = 0;
      }
      // attract mode: start over when that game ends
      if (this.scr !== "game" && w.phase === "GAME_OVER" && w.phaseT > 4) this.startAttract();
    }
    this.fx.update(live || this.scr !== "game" ? dt : 0, w);
    // footsteps patter under the ball carrier
    if (live && w.phase === "LIVE" && w.ball.state === "held" && w.ball.carrier && footfall(w.ball.carrier, w.time, dt)) this.audio.step();
    this.updateCamera(dt, w);
    return w;
  }

  draw(w) {
    // no banners / pop-up words behind the play-call panel or a full-screen menu
    this.fx.covered = this.scr === "game" && !!(this.ui.pc || this.ui.modalEl || this.paused);
    this.renderer.padLabels = this.input.device === "pad"; // receiver boxes show the controller's buttons
    this.renderer.padStyle = this.input.padStyle; // (PlayStation symbols for a PlayStation pad)
    this.renderer.render(w, this.cam, this.fx, this.zoomLevel());
    if (this.scr === "game") this.ui.updateHud(w);
  }

  // The human's play call from automation (same path as tapping a card). False if no call is open. flip: run it the other
  // way (true / false; left out: as the FLIP button shows).
  choosePlay(id, flip) {
    const w = this.world;
    if (this.scr !== "game" || !w || w.phase !== "PLAY_CALL" || !w.human || w.autoplay) return false;
    const side = w.offense === w.human ? "off" : "def";
    const ok = side === "off" ? OFF_PLAYS.some((p) => p.id === id) || ((id === "punt" || id === "fg") && w.down === 4) || (id === "fg" && !!w.lateKick()) : DEF_PLAYS.some((p) => p.id === id);
    if (!ok || w.pending[side]) return false;
    if (this.ui.pc && this.ui.pc.pick) {
      if (flip === undefined) this.ui.pc.pick(id);
      else this.ui.pc.pick(id, !!flip);
      return true;
    }
    return w.submitCall(side, id, !!flip);
  }

  gameUi(w) {
    const human = w.human;
    if (this.paused) return;
    // play calling
    if (w.phase === "PLAY_CALL" && human && !w.autoplay) {
      const side = w.offense === human ? "off" : "def";
      if (!w.pending[side] && this.pcShownFor !== w.callKey(side)) {
        this.pcShownFor = w.callKey(side);
        this.input.enabled = false;
        this.ui.showPlayCall(w, (id, flip) => {
          w.submitCall(side, id, flip);
          this.input.enabled = true;
          this.input.clearPresses();
        });
      }
      if (this.ui.pc && this.ui.tickPlayCall(w)) {
        // play clock ran out: the coach picks (run the way the FLIP button shows)
        const id = side === "off" ? (w.down === 4 ? w.cpuOffense(human) : w.lateKick() === "fg" ? "fg" : cpuOffenseCall(w, human)) : cpuDefenseCall(w, human);
        w.submitCall(side, id, this.ui.pc.flip);
        this.ui.hidePlayCall();
        this.input.enabled = true;
      }
    } else if (this.ui.pc) {
      this.ui.hidePlayCall();
      this.input.enabled = true;
    }
    if (w.phase === "HALFTIME" && !this.halftimeShown && !w.autoplay) {
      this.halftimeShown = true;
      this.input.enabled = false;
      this.ui.showHalftime(w, () => {
        this.ui.closeModal();
        this.input.enabled = true;
        w.continueHalftime();
      });
    }
    if (w.phase === "GAME_OVER" && !this.resultsShown && w.phaseT > 2.2) {
      this.resultsShown = true;
      this.input.enabled = false;
      this.input.setTouchVisible(false);
      this.ui.showResults(w, () => this.restart(), () => { this.leaveGame(); this.goOppSelect(this.lastTeams.home); }, () => { location.href = "/"; });
    }
    // touch button labels by context
    const u = w.userPlayer;
    let a = "A", b = "B";
    if (w.phase === "PRE_SNAP" && w.offense === human) a = "SNAP";
    else if (w.phase === "LIVE" && u) {
      if (w.ball.carrier === u && u.pos === "QB" && w.play.off.type === "pass" && !w.play.thrown && !w.play.qbRunner) { a = "THROW"; b = "NEXT"; }
      else if (w.ball.carrier === u) { a = "SPIN"; b = "STIFF"; }
      else { a = "DIVE"; b = "SWITCH"; }
    } else if (w.phase === "PRE_SNAP") b = "SWITCH";
    // [football round 2 wiring] special-teams buttons: KICK/ONSIDE, KICK/GO FOR 2, FAIR CATCH, KNEEL
    const st = w.actionLabels && w.actionLabels();
    if (st) { a = st.a; b = st.b; }
    this.input.setLabels(a, b);
    this.input.setReceivers(this.pocketTargets(w));
  }

  // The receivers the human QB can throw to right now (the receiver buttons), or null: up to 5, in the play's
  // progression order (1-5 as over their heads), each with how open he is (the nearest defender's distance).
  pocketTargets(w) {
    const u = w.userPlayer, play = w.play, b = w.ball;
    if (w.phase !== "LIVE" || !w.human || w.autoplay || !u || !play || !play.off || !b) return null;
    // the row stays through the QB's wind-up (taps then do nothing): hiding it brought A and B back as PASS / NEXT
    if (u.pos !== "QB" || b.state !== "held" || b.carrier !== u || play.thrown || play.qbRunner || play.off.type !== "pass") return null;
    const tg = play.progression;
    if (!tg || !tg.length) return null;
    const out = [];
    for (let i = 0; i < tg.length && i < 5; i++) {
      const r = tg[i];
      let near = 1e9;
      for (const p of w.players) {
        if (p.team === r.team || p.downUntil > w.time || p.state === "tackled") continue;
        near = Math.min(near, Math.hypot(p.x - r.x, p.y - r.y));
      }
      out.push({ label: r.pos, open: near > 4 ? 2 : near > 2 ? 1 : 0 });
    }
    return out;
  }

  // integer zoom steps: CLOSE camera setting (+1) and the TD/INT/big-hit punch-in (+1)
  zoomLevel() {
    if (this.scr !== "game") return 0;
    return (this.settings.camera === "close" ? 1 : 0) + (this.fx.punch > 0 ? 1 : 0);
  }

  updateCamera(dt, w) {
    // art: camera targeting (pre-snap framing, pocket framing, carrier lookahead, kicks) lives in
    // camera.js Camera.follow(); the renderer gives the buffer view size for this zoom level.
    const v = this.renderer.view(this.zoomLevel());
    // touch: while the receiver buttons show (the pocket) the camera keeps the routes in their columns above them
    // (buffer px: the rows they cover at the bottom, the columns at the right)
    const cpa = this.renderer.cssPerArt, live = this.scr === "game";
    this.cam.footPx = live ? Math.ceil(this.input.recRowCss / cpa) : 0;
    this.cam.footW = live ? Math.ceil(this.input.recRowW / cpa) : 0;
    this.cam.follow(dt, w, v.w, v.h);
  }
}

const app = new App();
installModes(app); // modes team: title/team-select entries, ladder games, badges (hooks in from modes.js)
app.boot().catch((e) => {
  app.errors.push(String(e && e.stack || e));
  console.error(e);
});
