// Core helpers shared by every chapter. No framework: plain DOM and SVG.

/** h("div.card#id", {onclick, style:{...}, ...attrs}, ...children) */
export function h(tag, attrs, ...kids) {
  const [, name = "div", rest = ""] = /^([a-z0-9-]+)?(.*)$/i.exec(tag);
  const el = document.createElement(name);
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) m[1] === "." ? el.classList.add(m[2]) : (el.id = m[2]);
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) kids.unshift(attrs), (attrs = null);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
}

const SVGNS = "http://www.w3.org/2000/svg";
/** s("rect", {x, y, ...}) creates an SVG element */
export function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
}

export const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Seeded RNG (mulberry32) so simulations are reproducible. */
export function rng(seed = 42) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.exp = (mean) => -Math.log(1 - next()) * mean; // exponential inter-arrival / service times
  next.zipf = (n, s = 1) => {
    // inverse-CDF sampling over a precomputed table, cached per (n, s)
    const key = n + ":" + s;
    let cdf = zipfCache.get(key);
    if (!cdf) {
      let sum = 0;
      const w = Array.from({ length: n }, (_, i) => (sum += 1 / Math.pow(i + 1, s)));
      cdf = w.map((x) => x / sum);
      zipfCache.set(key, cdf);
    }
    const u = next();
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      cdf[mid] < u ? (lo = mid + 1) : (hi = mid);
    }
    return lo;
  };
  return next;
}
const zipfCache = new Map();

/** Percentile of a numeric array (p in 0..100). */
export function pct(arr, p) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
}
export const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${Math.round(ms)} ms`);
export const fmtN = (n) => new Intl.NumberFormat().format(Math.round(n));
export const fmtPct = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

/**
 * A pausable animation loop. fn(dtSeconds) runs every frame while the element
 * is on screen and the tab is visible. Returns { start, stop, running }.
 */
export function loop(fn, el) {
  let raf = 0, last = 0, on = false, visible = true;
  const io = el && "IntersectionObserver" in window ? new IntersectionObserver(([e]) => (visible = e.isIntersecting)) : null;
  io?.observe(el);
  const tick = (t) => {
    if (!on) return;
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
    last = t;
    if (visible && !document.hidden) fn(dt);
    raf = requestAnimationFrame(tick);
  };
  return {
    start() { if (!on) { on = true; last = 0; raf = requestAnimationFrame(tick); } },
    stop() { on = false; cancelAnimationFrame(raf); },
    get running() { return on; },
  };
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Progress, stored per browser. Always optional: storage can be blocked. */
export const progress = {
  key: "app-anatomy:v1",
  read() {
    try { return JSON.parse(localStorage.getItem(this.key) || "{}"); } catch { return {}; }
  },
  mark(id, field, value = true) {
    const all = this.read();
    all[id] = { ...(all[id] || {}), [field]: value };
    try { localStorage.setItem(this.key, JSON.stringify(all)); } catch {}
  },
};
