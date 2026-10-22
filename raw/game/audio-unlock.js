// ALL-22 BOWL audio — getting sound out of phones (iPhone Safari above all). audio.js owns the AudioContext;
// this module holds the pieces that make a phone actually play it. WHY each one exists:
//  1. The gesture. iOS only lets audio start inside touchend / click / keydown (and the pointerup that rides on a
//     touchend) — never touchstart / pointerdown. GESTURES are watched on window, capture phase, passive, so the
//     context is created / resumed (and kick()'s one-sample silent buffer, which fully opens the output on older
//     iOS, is played) synchronously inside the gesture, before any game handler runs and plays its first blip.
//     Every later gesture re-tries while the context isn't 'running' (iOS parks it in 'interrupted' after a call,
//     Siri, another app's audio or a screen lock; Chrome keeps it 'suspended' until the page is activated).
//  2. The ring/silent switch. iOS plays Web Audio in the 'ambient' audio session, which the switch mutes: the usual
//     reason a web game is silent on an iPhone. Safari 16.4+/17 has navigator.audioSession, and type 'playback'
//     ignores the switch the way a video does. Older iOS: a *playing* <audio> element moves the page's session to
//     playback, so silence.wav (0.1 s of 8-bit mono zero level at 48 kHz, 4.8 KB; same-origin because the CSP
//     allows no data:/blob: media) loops while sound is on and the page is visible. Its volume can't be turned down
//     on iOS (read-only there), so the silence is in the file itself. iPhone / iPad only: elsewhere there is no
//     switch, and on Android a playing media element would take audio focus from the player's music app.
//  3. Hidden page (tab switch, screen lock): the element pauses — no lock-screen "Now Playing", no session kept
//     alive in the background — while audio.js suspends the context; both come back on return, or at the next
//     gesture if iOS refuses without one.
//  4. Sound OFF releases the session ('auto' = mixable, so the player's own music keeps playing) and pauses the
//     element; sound ON claims it again (the settings toggle runs inside the tap, so play() is allowed).
export const GESTURES = ["touchend", "pointerup", "click", "keydown"];
export const quiet = (p) => { if (p && p.catch) p.catch(() => {}); }; // resume()/suspend()/play() may reject

// iPhone / iPod, or an iPad (iPadOS asks for the desktop site: a "Macintosh" with a touch screen)
export function appleTouch() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

// Resume a context that isn't running and play a one-sample silent buffer: call it synchronously inside a gesture.
export function kick(ctx) {
  if (!ctx || ctx.state === "closed") return;
  if (ctx.state !== "running") quiet(ctx.resume());
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.onended = () => src.disconnect();
    src.start(0);
  } catch (_) { /* a context mid-close: nothing to open */ }
}

// The page's audio session: navigator.audioSession where it exists, plus the silent <audio> loop on iPhone / iPad.
export class AudioSession {
  constructor(src) {
    this.src = src;
    this.ios = appleTouch();
    this.tag = null;
    this.want = false; // claimed (sound on, after a gesture)
    this.err = null; // last play() failure (diagnostics)
  }
  // the silent loop, built on first use (never on desktop / Android)
  element() {
    if (!this.ios || typeof document === "undefined") return null;
    if (this.tag) return this.tag;
    const a = document.createElement("audio");
    a.setAttribute("x-webkit-airplay", "deny"); // never offered to AirPlay / cast
    a.disableRemotePlayback = true;
    a.controls = false;
    a.loop = true;
    a.preload = "auto";
    a.src = this.src;
    a.addEventListener("error", () => { this.err = "load error " + (a.error ? a.error.code : "?"); });
    this.tag = a;
    return a;
  }
  setType(type) {
    try {
      const s = typeof navigator !== "undefined" ? navigator.audioSession : null;
      if (s && s.type !== type) s.type = type;
    } catch (_) { /* read-only or unknown type on some builds */ }
  }
  // sound on: 'playback' + the silent loop (inside a gesture on first use; afterwards iOS lets the element replay)
  claim() {
    this.want = true;
    this.setType("playback");
    this.play();
  }
  // sound off: hand the session back (mixable, obeys the switch) and stop the loop
  release() {
    this.want = false;
    this.setType("auto");
    if (this.tag && !this.tag.paused) this.tag.pause();
  }
  play() {
    if (!this.want || (typeof document !== "undefined" && document.hidden)) return;
    const a = this.element();
    if (!a || !a.paused) return;
    try {
      const p = a.play();
      if (p && p.then) p.then(() => { this.err = null; }, (e) => { this.err = (e && e.name) || "play failed"; });
    } catch (e) {
      this.err = (e && e.name) || "play failed";
    }
  }
  // page hidden / shown (the claim survives; the loop doesn't run in the background)
  hide() { if (this.tag && !this.tag.paused) this.tag.pause(); }
  show() { this.play(); }
  // a gesture should still re-try: the loop is wanted but not running
  get stalled() { return this.want && !!this.ios && (!this.tag || this.tag.paused); }
  stats() {
    const s = typeof navigator !== "undefined" ? navigator.audioSession : null;
    const a = this.tag;
    return {
      ios: this.ios, claimed: this.want, type: s ? s.type : "n/a",
      silent: a ? (a.paused ? "paused" : "playing") : "none", silentT: a ? Math.round(a.currentTime * 1000) / 1000 : 0, err: this.err,
    };
  }
}
