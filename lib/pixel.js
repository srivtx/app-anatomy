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
  // chunky pixel creature with a 3D right edge, a steaming mug and a laptop seen from behind
  const g = new Grid(44, 34);
  const neuro = kind === "neuro";
  const pal = neuro
    ? { B: "#7b61ff", L: "#9c8aff", S: "#6a50f0", D: "#4632b4", E: "#120d24", C: "#ff9cc0", A: "#ffcf4a", a: "#e0a91e" }
    : { B: "#22c0a4", L: "#62e0c8", S: "#18a68d", D: "#0e6b5b", E: "#0a1a17", C: "#ffab9c", A: "#ffd23f", a: "#d6a91a" };
  Object.assign(pal, { w: "#fbf3e2", W: "#e9dcc0", m: "#d1bf98", k: "#4a2a10", t: "#e7d6b6", N: "#262730", n: "#3a3b47", x: "#d9dae6", P: "#101016" });
  // body mask: a soft square with a bumpy outline (fixed pattern, so it never changes)
  const cx = 21, cy = 17, mask = (x, y) => {
    if (neuro) { const u = (x - cx) / 11, v = (y - cy) / 9.5, bump = 0.06 * Math.sin(x * 1.7) * Math.cos(y * 1.3); return Math.pow(Math.abs(u), 3.2) + Math.pow(Math.abs(v), 3.2) <= 1 + bump; }
    return x >= 11 && x <= 31 && y >= 8 && y <= 26 && !((x === 11 || x === 31) && (y === 8 || y === 26));
  };
  // depth: the body pushed right and down, in the dark shade
  for (let y = 0; y < 34; y++) for (let x = 0; x < 44; x++) if (mask(x, y)) { g.set(x + 2, y + 1, "D"); g.set(x + 1, y + 1, "D"); }
  // legs, with depth
  for (const lx of neuro ? [14, 20, 26] : [14, 26]) { g.rect(lx + 1, 27, 3, 4, "D"); g.rect(lx, 27, 2, 3, "S"); }
  // body with a light top-left rim and a slightly darker right rim
  for (let y = 0; y < 34; y++) for (let x = 0; x < 44; x++) if (mask(x, y)) {
    const rimL = !mask(x - 1, y) || !mask(x, y - 1), rimR = !mask(x + 1, y) || !mask(x, y + 1);
    g.set(x, y, rimL ? "L" : rimR ? "S" : "B");
  }
  if (neuro) {
    // dendrites with glowing tips
    g.line(16, 9, 13, 4, "D").line(15, 9, 12, 4, "S").line(26, 9, 29, 4, "D").line(27, 9, 30, 4, "S").rect(20, 4, 2, 5, "S").rect(22, 4, 1, 5, "D");
    for (const [x, y] of [[11, 2], [29, 2], [20, 2]]) g.rect(x, y, 3, 3, "A").rect(x + 2, y + 1, 1, 2, "a");
  } else {
    g.rect(13, 21, 14, 1, "S").rect(13, 23, 14, 1, "S").rect(25, 22, 2, 1, "A").rect(22, 22, 2, 1, "C");      // drive bays, LEDs
    g.rect(20, 3, 2, 5, "S").rect(22, 3, 1, 5, "D").rect(18, 2, 6, 2, "A");                                       // antenna
  }
  // face: eyes like little arches, blush
  const ey = neuro ? 15 : 14, lx = 14, rx = 25;
  const eye = (x) => {
    if (mood === "happy") g.rect(x, ey + 1, 1, 2, "E").rect(x + 1, ey, 2, 1, "E").rect(x + 3, ey + 1, 1, 2, "E");
    else if (mood === "sad") g.rect(x, ey, 1, 1, "E").rect(x + 1, ey + 1, 2, 1, "E").rect(x + 3, ey, 1, 1, "E");
    else if (mood === "wow") g.rect(x + 1, ey - 1, 2, 3, "E");
    else g.rect(x, ey + 1, 4, 1, "E");
  };
  eye(lx); eye(rx);
  g.rect(lx - 1, ey + 4, 2, 1, "C").rect(rx + 3, ey + 4, 2, 1, "C");
  if (mood === "wow") g.rect(20, ey + 4, 3, 2, "E");
  // arm reaching to the mug
  g.rect(6, 19, 6, 3, "B").rect(6, 19, 6, 1, "L").rect(6, 21, 6, 1, "S");
  // mug: cream with a darker right side, coffee on top, a handle, steam
  g.rect(0, 15, 7, 8, "w").rect(5, 15, 2, 8, "W").rect(0, 22, 7, 1, "m").rect(0, 15, 7, 2, "k").rect(1, 15, 5, 1, "k");
  g.rect(7, 17, 1, 1, "W").rect(8, 18, 1, 3, "W").rect(7, 21, 1, 1, "W");
  for (const [x, y] of [[2, 12], [4, 10], [2, 8], [5, 13]]) g.rect(x, y, 2, 2, "t");
  // laptop, seen from behind: a dark lid leaning back, a thin base
  for (let r = 0; r < 12; r++) g.rect(29 + Math.floor(r / 3), 18 + r, 13, 1, r === 0 ? "n" : "N");
  g.rect(27, 30, 17, 2, "P").rect(27, 30, 17, 1, "n");
  for (const [x, y] of [[35, 23], [36, 23], [36, 24], [37, 25], [35, 25]]) g.set(x, y, "x");
  return g.svg(pal, { cls: `mascot ${kind} ${mood}`, label });
}

/** A little pixel sparkle cluster for decoration. */
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
