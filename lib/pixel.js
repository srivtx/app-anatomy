// Pixel art drawn in code: a tiny grid painter that renders crisp SVG.
// Every sprite here is original and generated from simple shapes, so they stay sharp at any size,
// follow the theme (colours can be CSS variables) and cost a few hundred bytes each.

export class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.px = Array.from({ length: h }, () => Array(w).fill(null)); }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y][x] = c; return this; }
  get(x, y) { return this.px[y]?.[x] ?? null; }
  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); return this; }
  each(fn) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(x, y); return this; }
  line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c); return this; }
  /** outline every empty pixel that touches a filled one */
  outline(c, only = null) {
    const add = [];
    this.each((x, y) => { if (this.get(x, y)) return; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = this.get(x + dx, y + dy); if (n && (!only || only.includes(n))) { add.push([x, y]); break; } } });
    for (const [x, y] of add) this.set(x, y, c);
    return this;
  }
  /** SVG with horizontal runs merged; colours are CSS colours or variables */
  svg(pal, { cls = "", label = "" } = {}) {
    let out = "";
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; ) {
      const c = this.px[y][x]; if (!c) { x++; continue; }
      let e = x; while (e + 1 < this.w && this.px[y][e + 1] === c) e++;
      out += `<rect x="${x}" y="${y}" width="${e - x + 1}" height="1" fill="${pal[c] || c}"/>`; x = e + 1;
    }
    return `<svg class="px ${cls}" viewBox="0 0 ${this.w} ${this.h}" shape-rendering="crispEdges" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${out}</svg>`;
  }
}

const hashOf = (s) => { let x = 2166136261; for (const ch of String(s)) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); return x >>> 0; };
const mixVar = (pct, other) => `color-mix(in srgb, var(--lc, var(--accent)) ${pct}%, ${other})`;

/**
 * A flower that grows with progress. stage 0 seed, 1 sprout, 2 bud, 3 bloom.
 * Petal count and shape come from the seed text, so every chapter's flower is a little different.
 */
export function flower(stage = 3, seedText = "x", { label } = {}) {
  const g = new Grid(16, 20), r = hashOf(seedText);
  const petals = 5 + (r % 3), twist = (r >> 3) % 10 / 10, round = 0.55 + ((r >> 7) % 4) * 0.1;
  const pal = { P: "var(--lc, var(--accent))", L: mixVar(40, "#fff"), M: mixVar(70, "#fff"), D: mixVar(65, "#000"), Y: "#ffb41f", y: "#ffd77a", G: "#5f9a34", g: "#9fd05a", S: "#8a5a3b", s: "#b07a50", O: "rgba(0,0,0,.28)" };
  // soil
  g.rect(3, 18, 10, 2, "S").rect(4, 17, 8, 1, "s");
  if (stage === 0) { g.rect(7, 16, 2, 1, "s").set(7, 15, "g").set(8, 15, "G"); return g.svg(pal, { cls: "flower s0", label }); }
  const top = stage === 1 ? 12 : stage === 2 ? 8 : 9;
  g.rect(7, top, 2, 17 - top, "G");
  g.rect(8, top, 1, 17 - top, "g");
  // leaves
  const ly = stage === 1 ? 13 : 13;
  g.rect(4, ly, 3, 1, "G").rect(3, ly - 1, 2, 1, "g").rect(9, ly + 1, 3, 1, "G").rect(11, ly, 2, 1, "g");
  if (stage === 1) { g.rect(6, top - 1, 1, 1, "g").rect(9, top - 1, 1, 1, "g"); return g.svg(pal, { cls: "flower s1", label }); }
  if (stage === 2) {
    g.rect(6, 4, 4, 4, "P").rect(7, 3, 2, 1, "P").rect(6, 4, 1, 3, "M").rect(9, 5, 1, 3, "D").rect(7, 7, 2, 1, "G").set(5, 6, "G").set(10, 6, "G");
    return g.svg(pal, { cls: "flower s2", label });
  }
  // bloom: petals from a polar function, shaded by radius
  const cx = 7.5, cy = 5.5;
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const edge = 3.2 + 2.6 * Math.pow(Math.abs(Math.cos((petals * (a + twist)) / 2)), round);
    if (d < 1.3) g.set(x, y, "Y");
    else if (d < 2.1) g.set(x, y, d < 1.8 && dx < 0 ? "y" : "D");
    else if (d < edge) g.set(x, y, d > edge - 1.1 ? "L" : d > edge - 2.3 ? "M" : "P");
  }
  g.set(7, 5, "y");
  return g.svg(pal, { cls: "flower s3", label });
}

/** A generic pixel energy can. hue: a CSS colour for the body. */
export function can(body = "#ff7eb6", { label } = {}) {
  const g = new Grid(10, 18);
  const pal = { K: "#1d1b22", R: "#c9ccd6", r: "#9a9eab", B: body, b: `color-mix(in srgb, ${body} 70%, #000)`, H: `color-mix(in srgb, ${body} 45%, #fff)`, W: "#ffffff", Y: "#ffd23f" };
  g.rect(2, 1, 6, 1, "R").rect(1, 2, 8, 1, "r");
  g.rect(1, 3, 8, 13, "B").rect(1, 3, 1, 13, "H").rect(7, 3, 1, 13, "b").rect(8, 3, 1, 13, "b");
  g.rect(2, 16, 6, 1, "r");
  // a lightning bolt
  for (const [x, y] of [[5, 5], [4, 6], [5, 6], [3, 7], [4, 7], [3, 8], [4, 8], [5, 8], [6, 8], [5, 9], [6, 9], [4, 10], [5, 10], [4, 11]]) g.set(x, y, "Y");
  g.rect(2, 13, 6, 1, "W");
  g.outline("K");
  return g.svg(pal, { cls: "can", label });
}

/** A stack of banknotes: compute you've earned. */
export function cash({ label } = {}) {
  const g = new Grid(20, 12);
  const pal = { K: "#123322", G: "#2f8f5b", g: "#5fd38d", D: "#1f6b43", W: "#f3f6f4", w: "#c7d3cc" };
  for (let k = 0; k < 3; k++) { const y = 7 - k * 3, x = 1 + (k % 2) * 2; g.rect(x, y, 15, 3, "G").rect(x, y, 15, 1, "g").rect(x, y + 2, 15, 1, "D").rect(x + 6, y, 3, 3, "W").rect(x + 6, y + 2, 3, 1, "w").set(x + 2, y + 1, "g").set(x + 12, y + 1, "g"); }
  g.outline("K");
  return g.svg(pal, { cls: "cash", label });
}

/** A trophy for passing a mock exam. */
export function trophy({ label } = {}) {
  const g = new Grid(16, 16);
  const pal = { K: "#3a2a00", Y: "#ffc93c", y: "#ffe38a", D: "#d99a00", B: "#7a5a2a", b: "#a37a3c" };
  g.rect(4, 1, 8, 6, "Y").rect(4, 1, 2, 6, "y").rect(10, 1, 2, 6, "D").rect(5, 7, 6, 1, "Y").rect(6, 8, 4, 1, "D").rect(7, 9, 2, 2, "D");
  g.rect(2, 2, 2, 1, "Y").rect(1, 2, 1, 3, "Y").rect(2, 5, 2, 1, "Y").rect(12, 2, 2, 1, "Y").rect(14, 2, 1, 3, "Y").rect(12, 5, 2, 1, "Y");
  g.rect(5, 11, 6, 1, "b").rect(4, 12, 8, 2, "B").rect(5, 12, 6, 1, "b");
  g.set(7, 3, "y").set(8, 3, "y");
  g.outline("K");
  return g.svg(pal, { cls: "trophy", label });
}

/** A coffee mug. */
function mug(g, x, y) {
  g.rect(x, y + 2, 5, 5, "w").rect(x, y + 2, 5, 1, "k").rect(x + 4, y + 3, 1, 4, "m").rect(x + 5, y + 3, 1, 1, "w").rect(x + 6, y + 4, 1, 2, "w").rect(x + 5, y + 6, 1, 1, "w");
  g.set(x + 1, y, "t").set(x + 2, y - 1, "t").set(x + 3, y, "t");
}

/**
 * The mascots. "neuro" for AI Anatomy: a neuron with dendrite antennae. "servo" for App Anatomy: a little server.
 * mood: "happy" | "think" | "wow" | "sad". Both hold a coffee and sit at a laptop.
 */
export function mascot(kind = "neuro", mood = "happy", { label } = {}) {
  // A chunky pixel creature: flat body, a darker left side for depth, ^ ^ eyes,
  // a steaming mug in one hand and a laptop seen from behind. 36 x 26 pixels.
  const g = new Grid(36, 26);
  const neuro = kind === "neuro";
  const pal = neuro
    ? { B: "#8f74ff", S: "#6d52e6", D: "#5139bf", A: "#ffcf4a", a: "#e6ad1f" }
    : { B: "#2fc7a9", S: "#1fa08a", D: "#16806d", A: "#ffcf4a", a: "#e6ad1f" };
  Object.assign(pal, { E: "#0d0b14", w: "#fff6ea", m: "#e9cfae", c: "#4a2d1b", C: "#7a4a2a", t: "#f2cf9a", N: "#2a2830", n: "#4c4852", x: "#eeeef2", P: "#121116" });
  // body, row by row: [y, side from, body from, body to] (side = the darker left face)
  const rows = [[3, 10, 11, 26], [4, 9, 11, 27]];
  for (let y = 5; y <= 13; y++) rows.push([y, 8, 11, 27]);
  rows.push([14, 9, 11, 29], [15, 8, 10, 30], [16, 7, 11, 30], [17, 8, 11, 30], [18, 8, 11, 22], [19, 8, 11, 21], [20, 8, 12, 21], [21, 10, 13, 20]);
  for (const [y, s, b, e] of rows) g.rect(s, y, b - s, 1, "S").rect(b, y, e - b + 1, 1, "B");
  g.set(10, 3, "D").rect(8, 18, 1, 3, "D").set(9, 19, "D");                      // the deepest shade on the corners
  g.rect(11, 22, 2, 2, "S").rect(13, 22, 2, 2, "B").rect(16, 22, 1, 2, "S").rect(17, 22, 2, 2, "B");   // stubby legs
  // a tuft on top: dendrites for Neuro, an antenna for Servo
  if (neuro) g.set(14, 2, "S").set(13, 1, "A").set(14, 1, "a").set(23, 2, "S").set(24, 1, "A").set(23, 1, "a");
  else g.rect(18, 1, 1, 2, "S").rect(17, 0, 3, 1, "A").set(19, 0, "a");
  // eyes
  const eye = (x) => {
    if (mood === "happy") g.rect(x + 1, 8, 2, 1, "E").set(x, 9, "E").set(x + 3, 9, "E");
    else if (mood === "sad") g.set(x, 8, "E").rect(x + 1, 9, 2, 1, "E").set(x + 3, 8, "E");
    else if (mood === "wow") g.rect(x + 1, 8, 2, 2, "E");
    else g.rect(x, 9, 4, 1, "E");
  };
  eye(12); eye(21);
  if (mood === "wow") g.rect(17, 12, 2, 2, "E");
  // the mug, held in the left hand, with steam
  g.rect(0, 14, 8, 7, "w").rect(0, 14, 1, 7, "m").rect(1, 21, 6, 1, "m");
  g.rect(1, 14, 6, 1, "c").rect(2, 15, 4, 1, "C");
  g.rect(7, 16, 2, 3, "B").set(7, 19, "S");                                      // the hand around the mug
  for (const [x, y] of [[2, 9], [4, 10], [2, 11], [3, 12]]) g.set(x, y, "t");
  // the laptop, lid leaning towards us, seen from behind; a thin base
  const lid = [[18, 22, 33], [19, 21, 33], [20, 21, 32], [21, 21, 32], [22, 20, 32], [23, 19, 31], [24, 19, 31]];
  for (const [y, a, b] of lid) g.rect(a, y, b - a + 1, 1, y === 18 ? "n" : "N").set(b, y, "n");
  g.rect(18, 25, 13, 1, "P");
  for (const [x, y] of [[25, 20], [26, 20], [26, 21], [27, 22], [25, 22]]) g.set(x, y, "x");
  return g.svg(pal, { cls: `mascot ${kind} ${mood}`, label });
}

export function sparkle(color = "var(--accent)") {
  const g = new Grid(5, 5); g.set(2, 0, "a").rect(1, 1, 3, 3, "a").set(0, 2, "a").set(4, 2, "a").set(2, 4, "a").set(2, 2, "w");
  return g.svg({ a: color, w: "#fff" }, { cls: "sparkle" });
}

/** The stage a chapter's flower is at, from saved progress. */
export const stageOf = (rec) => (rec?.predicted ? 3 : rec?.visited ? 2 : 0);

/** The site logo as pixel art: a neuron for AI Anatomy, a server for App Anatomy. */
export function logo(kind = "neuro") {
  const g = new Grid(14, 14);
  g.rect(1, 0, 12, 14, "A").rect(0, 1, 14, 12, "A").rect(1, 1, 12, 1, "a");
  if (kind === "neuro") {
    for (const [x, y] of [[3, 3], [10, 3], [3, 10], [10, 10]]) g.rect(x, y, 2, 2, "W");
    g.rect(6, 6, 3, 3, "W");
    for (let i = 0; i < 2; i++) { g.set(5 + i, 5 + i, "w").set(8 - i, 5 + i, "w").set(5 + i, 8 - i, "w").set(8 - i, 8 - i, "w"); }
  } else {
    g.rect(3, 3, 8, 2, "W").rect(3, 6, 8, 2, "W").rect(3, 9, 8, 2, "W").set(9, 4, "Y").set(9, 7, "Y").set(9, 10, "Y");
  }
  return g.svg({ A: "var(--accent)", a: "color-mix(in srgb, var(--accent) 70%, #fff)", W: "var(--accent-ink)", w: "color-mix(in srgb, var(--accent-ink) 70%, var(--accent))", Y: "#ffd23f" }, { cls: "logo" });
}

/** Tiny one-colour pixel glyphs for step labels, drawn in currentColor. */
const GLYPHS = {
  sim: [".X....", ".XXX..", ".XXXXX", ".XXX..", ".X...."],
  code: ["..X.X..", ".X...X.", "X.....X", ".X...X.", "..X.X.."],
  table: ["XXXXXXX", "X..X..X", "XXXXXXX", "X..X..X", "XXXXXXX"],
  predict: [".XXX.", "X...X", "...X.", "..X..", ".....", "..X.."],
  check: ["......X", ".....X.", "X...X..", ".X.X...", "..X...."],
  build: [".XXX.", "..X..", "..X..", ".X.X.", "X...X", "XXXXX"],
  field: ["XXXX.", "XXXXX", "XXXX.", "X....", "X...."],
  cuts: [".XXX.", "X.X.X", "XXXXX", ".X.X.", "..X.."],
  read: ["XXXXX", ".....", "XXXX.", ".....", "XXXXX"],
};
export function glyph(kind) {
  const g = GLYPHS[kind] || GLYPHS.read, w = g[0].length, hh = g.length;
  let r = "";
  g.forEach((row, y) => [...row].forEach((c, x) => { if (c === "X") r += `<rect x="${x}" y="${y}" width="1" height="1"/>`; }));
  return `<svg class="glyph" viewBox="0 0 ${w} ${hh}" width="${w * 1.6}" height="${hh * 1.6}" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

/** A small burst of pixel squares from an element: a right answer. Nothing with reduced motion. */
export function burst(el) {
  const r = document.documentElement;
  if (!el?.getBoundingClientRect || r.dataset.motion === "reduce" || (matchMedia("(prefers-reduced-motion: reduce)").matches && r.dataset.motion !== "full")) return;
  const b = el.getBoundingClientRect(), box = document.createElement("div");
  box.className = "burst"; box.setAttribute("aria-hidden", "true");
  box.style.left = `${b.left + Math.min(b.width, 260) / 2}px`; box.style.top = `${b.top + b.height / 2}px`;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + Math.random() * .4, d = 34 + Math.random() * 34, s = document.createElement("i");
    s.style.setProperty("--x", `${Math.cos(a) * d}px`); s.style.setProperty("--y", `${Math.sin(a) * d - 10}px`);
    s.style.background = `var(--c${1 + (i % 6)})`; s.style.animationDelay = `${Math.random() * 60}ms`;
    box.append(s);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 900);
}
