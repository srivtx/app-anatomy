// A small canvas layer for traffic simulations: boxes, wires and moving dots.
// Drawn in a fixed logical coordinate space (W x H) scaled to the container,
// with colours read from the CSS theme tokens so light and dark both work.
import { h } from "./core.js";

export function flowCanvas({ width = 720, height = 320, label }) {
  const canvas = h("canvas", { role: "img", "aria-label": label || "simulation", style: { width: "100%", display: "block" } });
  const ctx = canvas.getContext("2d");
  let scale = 1, colors = {};
  function fit() {
    const cssW = canvas.clientWidth || width;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    scale = cssW / width;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(height * scale * dpr);
    canvas.style.height = `${height * scale}px`;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ["surface", "sunken", "line", "ink", "ink-2", "ink-3", "accent", "accent-ink", "warm", "good", "bad", "warn", "c1", "c2", "c3", "c4", "c5", "c6", "bg"]) colors[k] = cs.getPropertyValue(`--${k}`).trim();
    return colors;
  }
  readColors();
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  const api = {
    el: canvas, ctx, W: width, H: height, get colors() { return colors; },
    clear() {
      if (!canvas.width) fit();
      ctx.clearRect(0, 0, width, height);
    },
    box(x, y, w, hh, { fill = colors.surface, stroke = colors.line, lw = 1.5, r = 8 } = {}) {
      ctx.beginPath(); ctx.roundRect(x, y, w, hh, r);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke();
    },
    text(str, x, y, { color = colors.ink, size = 12, weight = 600, align = "left", font = "Inter, system-ui, sans-serif", mono = false } = {}) {
      ctx.font = `${weight} ${size}px ${mono ? "JetBrains Mono, ui-monospace, monospace" : font}`;
      ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle";
      ctx.fillText(str, x, y);
    },
    line(x1, y1, x2, y2, { color = colors.line, lw = 1.5, dash = null } = {}) {
      ctx.beginPath(); ctx.setLineDash(dash || []); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke(); ctx.setLineDash([]);
    },
    dot(x, y, r = 3.5, color = colors.accent) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    },
    bar(x, y, w, hh, frac, color = colors.accent) {
      api.box(x, y, w, hh, { fill: colors.sunken, stroke: "transparent", r: hh / 2 });
      if (frac > 0) api.box(x, y, Math.max(hh, w * Math.min(1, frac)), hh, { fill: color, stroke: "transparent", r: hh / 2 });
    },
  };
  return api;
}

/** Sliding window of (time, value) samples for latency percentiles. */
export function window_(spanMs) {
  const items = [];
  return {
    add(t, v) { items.push([t, v]); },
    values(now) { while (items.length && items[0][0] < now - spanMs) items.shift(); return items.map((x) => x[1]); },
    count(now) { return this.values(now).length; },
  };
}
