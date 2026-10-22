// Play-call card diagrams (UI team): pixel playbook art drawn 1:1 into a small canvas (fillRect only,
// Bresenham lines) and shown at a whole number of device pixels per diagram pixel.
// Offense moves RIGHT, like the game camera. One color legend everywhere (see LEGEND):
//   red run path · blue routes · yellow primary read · pink QB · tan line with block T's;
//   defense: red rush arrows · yellow man coverage (dashed) · cyan dithered zone clouds.
// Receiver numbers next to the routes are the keys/buttons that throw to them (1–4).
// Reads the play data through playbook.js playDiagram() (football team), tolerating new line kinds. A FLIPped play
// (playbook.js mirrorPlay) draws as the mirror image, the reference offense behind a defensive call included.
// The projected geometry is cached per canvas, so the animated (focused) card redraws every frame
// without allocating.
import { playDiagram, offenseAlignment } from "./playbook.js";

export const DIAG_W = 100;
export const DIAG_H = 60;
export const LEGEND = [
  ["run", "#ff4f4f", "RUN"],
  ["route", "#4aa3ff", "ROUTE"],
  ["read", "#ffd23f", "1ST READ"],
  ["qb", "#ff6fb5", "QB"],
  ["ol", "#d9b98a", "BLOCK"],
];
export const LEGEND_DEF = [
  ["rush", "#ff4f4f", "RUSH"],
  ["man", "#ffd23f", "MAN"],
  ["zone", "#4cc9f0", "ZONE"],
];
const C = {
  turf: "#1d5a27", stripe: "#21652c", los: "#4aa3ff", ink: "#0b0d14",
  run: "#ff4f4f", route: "#4aa3ff", read: "#ffd23f", qb: "#ff6fb5", ol: "#d9b98a", olHi: "#f3dcb6", white: "#f6f6f2",
  ghost: "#3d7f49", rush: "#ff4f4f", man: "#ffd23f", zone: "#4cc9f0", zoneDim: "#2f8fb0", ball: "#9a5524", drop: "#ff6fb5",
};
const OL = new Set(["LT", "LG", "C", "RG", "RT"]);
const DIGITS = {
  1: [".#.", "##.", ".#.", ".#.", "###"],
  2: ["##.", "..#", ".#.", "#..", "###"],
  3: ["##.", "..#", ".#.", "..#", "##."],
  4: ["#.#", "#.#", "###", "..#", "..#"],
  5: ["###", "#..", "##.", "..#", "##."],
};

// ---------- pixel primitives ----------
let G = null;
function dot(x, y, c) {
  G.fillStyle = c;
  G.fillRect(x, y, 1, 1);
}
function box(x, y, w, h, c) {
  G.fillStyle = c;
  G.fillRect(x, y, w, h);
}
// Bresenham from (x0,y0) to (x1,y1); dash: 0 solid, n = on/off every n px
function line(x0, y0, x1, y1, c, dash = 0, dy0 = 0) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, n = 0;
  G.fillStyle = c;
  for (let i = 0; i < 600; i++) {
    if (!dash || ((n / dash) | 0) % 2 === 0) G.fillRect(x0, y0 + dy0, 1, 1);
    n++;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
// polyline (flat [x0,y0,x1,y1,...] with its total length) drawn up to fraction u; the result lives
// in END (reused). shadow: a 1-px ink drop shadow, drawn in its own pass first.
const END = { x: 0, y: 0, dx: 1, dy: 0, done: false };
function poly(P, total, u, c, dash, shadow) {
  for (let pass = shadow ? 0 : 1; pass < 2; pass++) {
    let left = total * u;
    let ex = P[0], ey = P[1], dirx = 1, diry = 0;
    for (let i = 2; i < P.length && left > 0; i += 2) {
      const ax = P[i - 2], ay = P[i - 1], bx = P[i], by = P[i + 1];
      const seg = Math.hypot(bx - ax, by - ay);
      if (seg < 0.01) continue;
      const f = Math.min(1, left / seg);
      ex = ax + (bx - ax) * f;
      ey = ay + (by - ay) * f;
      if (pass === 0) line(ax, ay, ex, ey, shadow, dash, 1);
      else line(ax, ay, ex, ey, c, dash, 0);
      dirx = bx - ax;
      diry = by - ay;
      left -= seg;
    }
    END.x = Math.round(ex);
    END.y = Math.round(ey);
    END.dx = dirx;
    END.dy = diry;
    END.done = left >= -0.01;
  }
  return END;
}
function lengthOf(P) {
  let t = 0;
  for (let i = 2; i < P.length; i += 2) t += Math.hypot(P[i] - P[i - 2], P[i + 1] - P[i - 1]);
  return t;
}
function arrow(x, y, dx, dy, c) {
  const L = Math.hypot(dx, dy) || 1;
  // snap the direction to 8 ways so the head is a clean pixel chevron
  let sx = Math.round(dx / L), sy = Math.round(dy / L);
  if (!sx && !sy) sx = 1;
  const px = -sy, py = sx;
  for (let k = 1; k <= 2; k++) {
    dot(x - sx * k + px * k, y - sy * k + py * k, c);
    dot(x - sx * k - px * k, y - sy * k - py * k, c);
  }
}
function tee(x, y, dx, dy, c) {
  const L = Math.hypot(dx, dy) || 1;
  let px = -Math.round(dy / L), py = Math.round(dx / L);
  if (!px && !py) py = 1;
  for (let k = -2; k <= 2; k++) dot(x + px * k, y + py * k, c);
}
function digit(n, x, y, c) {
  const g = DIGITS[n];
  if (!g) return;
  box(x - 1, y - 1, 5, 7, C.ink);
  G.fillStyle = c;
  for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r][q] === "#") G.fillRect(x + q, y + r, 1, 1);
}
function oMark(x, y, c) {
  box(x - 1, y - 1, 3, 3, c);
  dot(x, y, C.ink);
}
function xMark(x, y, c) {
  G.fillStyle = c;
  G.fillRect(x - 1, y - 1, 1, 1); G.fillRect(x + 1, y - 1, 1, 1); G.fillRect(x, y, 1, 1); G.fillRect(x - 1, y + 1, 1, 1); G.fillRect(x + 1, y + 1, 1, 1);
}

// ---------- geometry (built once per canvas + play) ----------
const plans = new WeakMap();
const GHOST = offenseAlignment({ off: "fb" }, "I");
const GHOST_FLIP = offenseAlignment({ off: "fb" }, "I", true);
const SKILL = ["WR1", "WR2", "TE", "FB", "HB"];
function buildPlan(play, scheme, W, H) {
  let data = null;
  try {
    data = playDiagram(play, scheme || { def: "34", off: "fb" });
  } catch (_) {}
  if (!data || !data.players) data = { players: [], lines: [] };
  const def = !play.type;
  const losX = Math.round(W * (def ? 0.28 : 0.38));
  const kx = (W - losX - 4) / 28;
  const ky = (H - 8) / 36;
  const X = (dx) => Math.round(losX + dx * kx);
  const Y = (dy) => Math.round(H / 2 + dy * ky);
  const plan = { play, W, H, def, losX, ballY: Y(0), stripes: [], ticks: [], lines: [], players: [], numbers: [], ghosts: [], clouds: [], runner: null };
  for (let yd = -20; yd <= 40; yd += 10) {
    const x = X(yd);
    if (x >= 0 && x < W) plan.stripes.push(x);
  }
  for (let yd = -20; yd <= 40; yd++) {
    const x = X(yd);
    if (x >= 0 && x < W) plan.ticks.push(x);
  }
  plan.tickY0 = Y(-6.2);
  plan.tickY1 = Y(6.2);
  const flat = (pts) => {
    const P = [];
    for (const [dx, dy] of pts) P.push(X(dx), Y(dy));
    return P;
  };
  if (!def) {
    // route numbering: the order the QB reads them in-game (= the 1–4 keys)
    const reads = data.lines.filter((l) => l.kind !== "run" && l.kind !== "block" && l.kind !== "drop" && l.read != null && l.read >= 0).sort((a, b) => a.read - b.read);
    const primary = reads[0] || null;
    for (const l of data.lines) {
      if (!l.pts || l.pts.length < 2) continue;
      const P = flat(l.pts);
      const isRun = l.kind === "run";
      const item = { kind: l.kind, P, total: lengthOf(P), isRun, primary: l === primary };
      if (l.kind === "block") { item.col = C.ol; item.order = 0; }
      else if (l.kind === "drop") { item.col = C.drop; item.dash = 1; item.order = 1; }
      else { item.col = isRun ? C.run : l === primary ? C.read : C.route; item.dash = l.kind === "screen" ? 2 : 0; item.shadow = C.ink; item.arrow = true; item.order = 2; }
      plan.lines.push(item);
      if (isRun || (l === primary && !plan.runner)) plan.runner = item;
    }
    plan.lines.sort((a, b) => a.order - b.order);
    reads.forEach((l, i) => {
      if (i >= 4 || !l.pts || !l.pts.length) return;
      const x0 = X(l.pts[0][0]), y0 = Y(l.pts[0][1]);
      const up = l.pts[0][1] <= 0;
      plan.numbers.push({ n: i + 1, x: x0 - 5, y: up ? y0 - 8 : y0 + 3, col: l === primary ? C.read : C.white });
    });
    for (const p of data.players) {
      const x = X(p.dx), y = Y(p.dy);
      const hl = primary && primary.pts && Math.abs(primary.pts[0][0] - p.dx) < 0.01 && Math.abs(primary.pts[0][1] - p.dy) < 0.01;
      plan.players.push({ x, y, kind: OL.has(p.slot) ? "ol" : p.slot === "QB" ? "qb" : hl ? "read" : "o" });
    }
  } else {
    const ghost = play.flip ? GHOST_FLIP : GHOST;
    for (const s in ghost) {
      if (s === "K") continue;
      plan.ghosts.push(X(ghost[s][0]), Y(ghost[s][1]));
    }
    // man assignments: each man defender takes the nearest free skill player
    const free = SKILL.filter((s) => ghost[s]).map((s) => ({ x: ghost[s][0], y: ghost[s][1] }));
    for (const l of data.lines) {
      if (!l.pts || !l.pts.length) continue;
      const [sx, sy] = l.pts[0];
      const [tx, ty] = l.pts[l.pts.length - 1];
      let P, item;
      if (l.kind === "rush") {
        // short, nearly parallel arrows into the backfield (long ones pile into a blob at the line)
        P = [X(sx), Y(sy), X(Math.max(tx, sx - 2.4)), Y(sy + (ty - sy) * 0.35)];
        item = { kind: "rush", col: C.rush, shadow: C.ink, arrow: true };
      } else if (l.kind === "zone") {
        P = [X(sx), Y(sy), X(tx), Y(ty)];
        item = { kind: "zone", col: C.zone };
        const r = l.r || 6;
        plan.clouds.push({ cx: X(tx), cy: Y(ty), rx: Math.max(3, Math.round(r * 0.62 * kx)), ry: Math.max(2, Math.round(r * 0.62 * ky)) });
      } else if (l.kind === "man") {
        let best = null, bd = 1e9;
        for (const f of free) {
          const d = Math.hypot(f.x - sx, (f.y - sy) * 1.3);
          if (d < bd) { bd = d; best = f; }
        }
        if (best) free.splice(free.indexOf(best), 1);
        P = best ? [X(sx), Y(sy), X(best.x + 1), Y(best.y)] : [X(sx), Y(sy), X(tx), Y(ty)];
        item = { kind: "man", col: C.man, dash: 1 };
      } else {
        P = [X(sx), Y(sy), X(tx), Y(ty)];
        item = { kind: l.kind, col: C.white, dash: 1 };
      }
      item.P = P;
      item.total = lengthOf(P);
      plan.lines.push(item);
    }
    for (const p of data.players) plan.players.push({ x: X(p.dx), y: Y(p.dy), kind: "x" });
  }
  return plan;
}

// ---------- the diagram ----------
// u: 0..1 how far the paths have drawn out; t: seconds (zone dither + runner loop); focus: animate.
export function drawDiagram(cv, play, scheme, u = 1, t = 0, focus = false) {
  const W = cv.width, H = cv.height;
  let plan = plans.get(cv);
  if (!plan || plan.play !== play || plan.W !== W || plan.H !== H) {
    plan = buildPlan(play, scheme, W, H);
    plans.set(cv, plan);
  }
  G = cv.getContext("2d");
  box(0, 0, W, H, C.turf);
  for (let i = 0; i < plan.stripes.length; i++) box(plan.stripes[i], 0, 1, H, C.stripe);
  G.fillStyle = C.stripe;
  for (let i = 0; i < plan.ticks.length; i++) {
    G.fillRect(plan.ticks[i], plan.tickY0, 1, 1);
    G.fillRect(plan.ticks[i], plan.tickY1, 1, 1);
  }
  box(plan.losX, 0, 1, H, C.los);
  if (plan.def) drawDefense(plan, u, t, focus);
  else drawOffense(plan, u, t, focus);
}

function drawOffense(plan, u, t, focus) {
  for (let i = 0; i < plan.lines.length; i++) {
    const l = plan.lines[i];
    if (l.kind === "block") {
      const e = poly(l.P, l.total, Math.min(1, u * 1.6), l.col, 0, null);
      if (e.done) tee(e.x, e.y, e.dx, e.dy, l.col);
      continue;
    }
    const e = poly(l.P, l.total, u, l.col, l.dash || 0, l.shadow || null);
    if (l.arrow && e.done) arrow(e.x, e.y, e.dx, e.dy, l.col);
  }
  for (let i = 0; i < plan.players.length; i++) {
    const p = plan.players[i];
    if (p.kind === "ol") {
      box(p.x - 1, p.y - 1, 3, 2, C.ol);
      dot(p.x, p.y - 1, C.olHi);
    } else oMark(p.x, p.y, p.kind === "qb" ? C.qb : p.kind === "read" ? C.read : C.white);
  }
  box(plan.losX + 1, plan.ballY, 2, 1, C.ball);
  if (u >= 1) for (let i = 0; i < plan.numbers.length; i++) {
    const n = plan.numbers[i];
    digit(n.n, n.x, n.y, n.col);
  }
  // the play runs: a white dot travels the run path / primary route
  const r = plan.runner;
  if (focus && u >= 1 && r && r.P.length >= 4) {
    let d = r.total * ((t % 1.6) / 1.6);
    const P = r.P;
    for (let i = 2; i < P.length; i += 2) {
      const ax = P[i - 2], ay = P[i - 1], bx = P[i], by = P[i + 1];
      const s = Math.hypot(bx - ax, by - ay);
      if (d <= s || i === P.length - 2) {
        const k = s ? Math.min(1, d / s) : 0;
        const x = Math.round(ax + (bx - ax) * k), y = Math.round(ay + (by - ay) * k);
        box(x - 1, y - 1, 3, 3, C.ink);
        dot(x, y, C.white);
        break;
      }
      d -= s;
    }
  }
}

function drawDefense(plan, u, t, focus) {
  G.fillStyle = C.ghost;
  for (let i = 0; i < plan.ghosts.length; i += 2) G.fillRect(plan.ghosts[i], plan.ghosts[i + 1], 2, 2);
  const zonePhase = focus ? ((t * 2.5) | 0) & 1 : 0;
  const grow = Math.min(1, u * 1.25);
  for (let c = 0; c < plan.clouds.length; c++) {
    const z = plan.clouds[c];
    const gx = Math.max(1, Math.round(z.rx * grow)), gy = Math.max(1, Math.round(z.ry * grow));
    for (let yy = -gy; yy <= gy; yy++) for (let xx = -gx; xx <= gx; xx++) {
      const e = (xx * xx) / (gx * gx) + (yy * yy) / (gy * gy);
      if (e > 1) continue;
      const edge = e > 0.62;
      if (edge || ((xx + yy + zonePhase) & 1) === 0) dot(z.cx + xx, z.cy + yy, edge && (xx + yy) & 1 ? C.zone : C.zoneDim);
    }
  }
  for (let i = 0; i < plan.lines.length; i++) {
    const l = plan.lines[i];
    const e = poly(l.P, l.total, u, l.col, l.dash || 0, l.shadow || null);
    if (l.arrow && e.done) arrow(e.x, e.y, e.dx, e.dy, l.col);
  }
  for (let i = 0; i < plan.players.length; i++) xMark(plan.players[i].x, plan.players[i].y, C.white);
}
