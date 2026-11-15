// Isometric voxel pixel art: unit cubes in a 2:1 projection, painted back to front,
// with a light top, a mid left face, a dark right face and a black outline. Everything is original.
import { Grid } from "./pixel.js";

const A = 4;                                   // half-width of a cube's top diamond, in pixels; cube = 8 x 8
const shade = (hex, f) => {                    // f < 1 darkens, f > 1 lightens
  const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  const out = c.map((v) => Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1)));
  return `#${out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
};

/** A scene: add voxels (with an optional per-face colour), then render. */
export class Scene {
  constructor() { this.vox = new Map(); }
  put(x, y, z, color, faces = {}) { this.vox.set(`${x},${y},${z}`, { x, y, z, top: faces.top || shade(color, 1.18), left: faces.left || color, right: faces.right || shade(color, 0.72) }); return this; }
  box(x, y, z, w, d, h, color, fn) {
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) for (let k = 0; k < h; k++) {
      const f = fn ? fn(i, j, k) : null;
      if (f === false) continue;
      this.put(x + i, y + j, z + k, (f && f.color) || color, (f && f.faces) || {});
    }
    return this;
  }
  /** Render to an SVG string. pad leaves room for the outline. */
  svg({ cls = "", label = "", outline = "#141218" } = {}) {
    const vs = [...this.vox.values()];
    if (!vs.length) return "";
    const sx = (v) => (v.x - v.y) * A, sy = (v) => ((v.x + v.y) * A) / 2 - v.z * A;
    const minX = Math.min(...vs.map(sx)) - A, maxX = Math.max(...vs.map(sx)) + A, minY = Math.min(...vs.map(sy)), maxY = Math.max(...vs.map(sy)) + 2 * A;
    const W = maxX - minX + 2, H = maxY - minY + 2, g = new Grid(W, H), pal = {};
    let k = 0; const key = (c) => { for (const [n, v] of Object.entries(pal)) if (v === c) return n; const n = `c${k++}`; pal[n] = c; return n; };
    vs.sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z) || a.z - b.z);
    for (const v of vs) {
      const ox = sx(v) - minX + 1 - A, oy = sy(v) - minY + 1;
      const T = key(v.top), L = key(v.left), R = key(v.right);
      for (let j = 0; j < 2 * A; j++) for (let i = 0; i < 2 * A; i++) {
        const inD = (jj) => Math.abs(i + 0.5 - A) / A + Math.abs(jj + 0.5 - A / 2) / (A / 2) <= 1;
        if (inD(j)) { g.set(ox + i, oy + j, T); continue; }
        let side = false; for (let t = 1; t <= A; t++) if (inD(j - t)) { side = true; break; }
        if (side && j >= A / 2) g.set(ox + i, oy + j, i < A ? L : R);
      }
    }
    pal.K = outline; g.outline("K");
    return g.svg(pal, { cls: `vox ${cls}`, label });
  }
}

// ---------------------------------------------------------------------------------------------
// The objects
// ---------------------------------------------------------------------------------------------
const GREEN = "#2f8f5b", BILL_TOP = "#7be08f", BAND = "#eef2f6";

/** Stacks of banknotes. n stacks (1–6), arranged in a little pile. */
export function cashScene(n = 2, s = new Scene(), ox = 0, oy = 0, oz = 0) {
  const spots = [[0, 0, 0], [0, 3, 0], [0, 1, 2], [0, 4, 2], [0, 2, 4], [0, 0, 4]];
  for (let q = 0; q < Math.min(n, spots.length); q++) {
    const [x, y, z] = spots[q];
    s.box(ox + x, oy + y, oz + z, 6, 3, 2, GREEN, (i, j, k) => {
      const band = i === 2 || i === 3;
      return { faces: {
        top: k === 1 ? (band ? BAND : (i === 0 || i === 5) && j === 1 ? "#1f6b43" : BILL_TOP) : GREEN,
        left: band ? (k ? "#dfe5ea" : "#c9d3dc") : (k ? "#2f8f5b" : "#26754a"),
        right: band ? (k ? "#aab8c4" : "#94a3b0") : (k ? "#1f6b43" : "#185536"),
      } };
    });
  }
  return s;
}
export const cashPile = (n = 2, label) => cashScene(n).svg({ cls: "cash3d", label });

/** A graphics card with two fans. */
export function gpuScene(s = new Scene(), ox = 0, oy = 0, oz = 0) {
  s.box(ox, oy, oz, 8, 3, 1, "#3a3f4a", (i, j) => {
    const fan = [[1.5, 1], [5.5, 1]].some(([cx, cy]) => Math.hypot(i - cx, j - cy) < 1.3);
    return { faces: { top: fan ? (i + j) % 2 ? "#5a6170" : "#20232a" : "#4a505d", left: j === 2 ? "#2a2e36" : "#3a3f4a", right: "#262a31" } };
  });
  s.box(ox, oy + 3, oz, 8, 1, 1, "#1e7a4c", (i) => ({ faces: { top: i % 2 ? "#d4af37" : "#2f9a62", left: "#1e7a4c", right: "#155a37" } }));
  return s;
}
export const gpu = (label) => gpuScene().svg({ cls: "gpu3d", label });

/** A server rack with blinking lights. */
export function rackScene(s = new Scene(), ox = 0, oy = 0, oz = 0, h = 7) {
  s.box(ox, oy, oz, 3, 3, h, "#2c303a", (i, j, k) => ({ faces: { top: "#454b59", left: j === 2 && i >= 0 && k % 2 === 1 ? (i === 2 ? (k % 4 === 1 ? "#45e08a" : "#ffcf4a") : "#1b1e25") : "#2c303a", right: "#20232b" } }));
  return s;
}
export const rack = (label) => rackScene().svg({ cls: "rack3d", label });

/** A soda-style can (generic, no brand). */
export function canScene(color = "#ff7eb6", s = new Scene(), ox = 0, oy = 0, oz = 0) {
  s.box(ox, oy, oz, 2, 2, 4, color, (i, j, k) => ({ color: k === 3 ? "#c9ccd6" : color, faces: k === 3 ? { top: "#e6e8ee", left: "#c9ccd6", right: "#9a9eab" } : k === 1 && j === 1 ? { left: "#ffffff" } : {} }));
  return s;
}

/** A coffee mug. */
export function mugScene(s = new Scene(), ox = 0, oy = 0, oz = 0) {
  s.box(ox, oy, oz, 2, 2, 2, "#f2ead9", (i, j, k) => ({ faces: k === 1 ? { top: "#5a3412" } : {} }));
  s.put(ox + 1, oy + 2, oz + 1, "#f2ead9");
  return s;
}

/** A stack of books, n high. */
export function booksScene(n = 3, s = new Scene(), ox = 0, oy = 0, oz = 0) {
  const cols = ["#d9534f", "#2a78d6", "#eda100", "#6250d6", "#1baf7a", "#e87ba4"];
  for (let b = 0; b < n; b++) s.box(ox + (b % 2), oy, oz + b, 4, 3, 1, cols[b % cols.length], (i, j) => ({ faces: { top: j === 2 && i < 3 ? "#f4efe2" : undefined } }));
  return s;
}

/** A potted plant that grows: stage 0–3. */
export function plantScene(stage = 2, s = new Scene(), ox = 0, oy = 0, oz = 0) {
  s.box(ox, oy, oz, 3, 3, 2, "#b5653a", (i, j, k) => ({ faces: k === 1 ? { top: "#5a3a22" } : {} }));
  const leaf = "#4caf50", leaf2 = "#7bd36a";
  if (stage >= 1) s.put(ox + 1, oy + 1, oz + 2, leaf);
  if (stage >= 2) s.put(ox + 1, oy + 1, oz + 3, leaf).put(ox, oy + 1, oz + 3, leaf2).put(ox + 2, oy + 1, oz + 3, leaf2);
  if (stage >= 3) s.put(ox + 1, oy + 1, oz + 4, leaf).put(ox + 1, oy, oz + 4, leaf2).put(ox + 1, oy + 2, oz + 4, leaf2).put(ox + 1, oy + 1, oz + 5, "#ff6b9a", { top: "#ffc3d6" });
  return s;
}

/** An open laptop. */
export function laptopScene(s = new Scene(), ox = 0, oy = 0, oz = 0) {
  s.box(ox, oy, oz, 5, 4, 1, "#3b3f4a", (i, j) => ({ faces: { top: j >= 1 && j <= 2 && i >= 1 && i <= 3 ? "#2a2d35" : "#565c6a" } }));
  s.box(ox, oy, oz + 1, 5, 1, 4, "#2b2e36", (i, j, k) => ({ faces: { left: i >= 1 && i <= 3 && k >= 1 && k <= 2 ? (k === 2 && i === 2 ? "#9be7ff" : "#3e7bd6") : "#2b2e36", top: "#3b3f4a" } }));
  return s;
}

/** The whole bench: a desk whose contents grow with progress. */
export function deskScene({ cash = 0, cans = 0, books = 0, plant = 0, gpu: g = true, rack: r = false } = {}) {
  const s = new Scene();
  s.box(0, 0, 0, 24, 12, 1, "#a0703f", (i, j) => ({ faces: { top: (i + j * 3) % 7 === 0 ? "#c78a50" : "#d39a5c", left: "#a0703f", right: "#7d5530" } }));
  for (const [x, y] of [[0, 0], [23, 0], [0, 11], [23, 11]]) s.box(x, y, -3, 1, 1, 3, "#7d5530");
  plantScene(plant, s, 0, 0, 1);
  laptopScene(s, 8, 1, 1);
  if (g) gpuScene(s, 15, 0, 1);
  if (r) rackScene(s, 21, 0, 1, 5);
  if (books) booksScene(Math.min(5, books), s, 0, 5, 1);
  mugScene(s, 5, 5, 1);
  if (cash) cashScene(Math.min(6, cash), s, 16, 5, 1);
  const colors = ["#ff7eb6", "#7cc4ff", "#ffd23f", "#9bf0b4"];
  for (let c = 0; c < Math.min(cans, 4); c++) canScene(colors[c], s, 4 + c * 3, 9, 1);
  return s;
}
export const desk = (opts, label) => deskScene(opts).svg({ cls: "desk3d", label });
