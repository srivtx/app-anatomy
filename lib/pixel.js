// Pixel art drawn in code: a tiny grid painter that renders crisp SVG.
// Every sprite here is original and generated from simple shapes, so they stay sharp at any size,
// follow the theme (colours can be CSS variables) and cost a few hundred bytes each.

class Grid {
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
  const g = new Grid(34, 26);
  const neuro = kind === "neuro";
  const pal = neuro
    ? { B: "#7b61ff", L: "#a796ff", S: "#5640d8", E: "#17112e", C: "#ff8fb1", w: "#f6eedf", k: "#5a3412", m: "#d9c7a6", t: "#cbbfae", N: "#2b2a33", n: "#45434f", x: "#d8d6e6", A: "#ffcf4a" }
    : { B: "#19b39a", L: "#5fe0c8", S: "#0f7f6d", E: "#0d1f1c", C: "#ff9f8f", w: "#f6eedf", k: "#5a3412", m: "#d9c7a6", t: "#cbbfae", N: "#2b2a33", n: "#45434f", x: "#d8d6e6", A: "#ffd23f" };
  const cx = 16, cy = 14;
  if (neuro) {
    // a soft square blob
    for (let y = 0; y < 26; y++) for (let x = 0; x < 34; x++) {
      const u = (x - cx) / 9.5, v = (y - cy) / 8.2;
      if (Math.pow(Math.abs(u), 3) + Math.pow(Math.abs(v), 3) <= 1) g.set(x, y, u + v < -0.9 ? "L" : u + v > 0.75 ? "S" : "B");
    }
    // dendrites with glowing tips
    g.line(12, 6, 9, 2, "S").line(20, 6, 23, 2, "S").line(16, 6, 16, 3, "S");
    g.rect(8, 1, 2, 2, "A").rect(23, 1, 2, 2, "A").rect(15, 2, 2, 2, "A");
    // little legs
    g.rect(11, 22, 2, 2, "S").rect(15, 22, 2, 2, "S").rect(19, 22, 2, 2, "S");
  } else {
    g.rect(8, 6, 17, 16, "B").rect(8, 6, 17, 2, "L").rect(8, 6, 2, 16, "L").rect(23, 6, 2, 16, "S").rect(8, 20, 17, 2, "S");
    g.rect(11, 17, 11, 1, "S").rect(11, 19, 11, 1, "S").set(20, 18, "A").set(21, 18, "C");     // drive bays and LEDs
    g.rect(15, 3, 2, 3, "S").rect(14, 2, 4, 1, "A");                                             // antenna
    g.rect(10, 22, 2, 2, "S").rect(21, 22, 2, 2, "S");
  }
  // face
  const ey = neuro ? 12 : 11, lx = neuro ? 11 : 12, rx = neuro ? 19 : 19;
  const eye = (x) => {
    if (mood === "happy") g.set(x, ey + 1, "E").set(x + 1, ey, "E").set(x + 2, ey, "E").set(x + 3, ey + 1, "E");
    else if (mood === "sad") g.set(x, ey, "E").set(x + 1, ey + 1, "E").set(x + 2, ey + 1, "E").set(x + 3, ey, "E");
    else if (mood === "wow") g.rect(x + 1, ey - 1, 2, 3, "E");
    else g.rect(x, ey, 4, 1, "E");
  };
  eye(lx); eye(rx);
  g.rect(lx - 2, ey + 3, 2, 1, "C").rect(rx + 4, ey + 3, 2, 1, "C");
  if (mood === "wow") g.rect(15, ey + 4, 3, 2, "E");
  // arm and coffee on the left
  g.rect(4, 15, 4, 2, neuro ? "B" : "S");
  mug(g, 0, 12);
  // laptop in front, on the right
  g.rect(18, 22, 15, 2, "N").rect(18, 22, 15, 1, "n");
  for (let i = 0; i < 9; i++) g.rect(21 + Math.floor(i / 3), 13 + i, 10, 1, "N");
  g.set(26, 17, "x").set(27, 17, "x").set(27, 18, "x").set(28, 19, "x").set(26, 19, "x");
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
