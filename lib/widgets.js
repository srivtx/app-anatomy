// Reusable interactive pieces. Every chapter is built from these.
import { h, s, esc, progress } from "./core.js";

let uid = 0;
const id = (p) => `${p}-${++uid}`;

/** Labelled range input. Returns the wrapper; read .value via the getter. */
export function slider({ label, min, max, step = 1, value, fmt = (v) => v, onInput, hint }) {
  const iid = id("sl");
  const out = h("output.sl-val", { for: iid }, fmt(value));
  const input = h("input", { type: "range", id: iid, min, max, step, value });
  input.addEventListener("input", () => {
    out.textContent = fmt(+input.value);
    onInput?.(+input.value);
  });
  const el = h("div.slider", h("label", { for: iid }, h("span", label), out), input, hint && h("small.hint", hint));
  Object.defineProperty(el, "value", { get: () => +input.value, set: (v) => { input.value = v; out.textContent = fmt(+v); } });
  return el;
}

/** Segmented control. options: [{value, label}] */
export function segmented({ label, options, value, onChange }) {
  let cur = value;
  const btns = options.map((o) =>
    h("button", { type: "button", "aria-pressed": o.value === value ? "true" : "false", onclick: () => set(o.value, true) }, o.label),
  );
  function set(v, fire) {
    cur = v;
    btns.forEach((b, i) => b.setAttribute("aria-pressed", options[i].value === v ? "true" : "false"));
    if (fire) onChange?.(v);
  }
  const el = h("div.seg-wrap", label && h("span.seg-label", label), h("div.seg", { role: "group", "aria-label": label || "Options" }, btns));
  Object.defineProperty(el, "value", { get: () => cur, set: (v) => set(v, false) });
  return el;
}

export function toggle({ label, checked = false, onChange, hint }) {
  const iid = id("tg");
  const input = h("input", { type: "checkbox", id: iid, role: "switch", checked: checked || null });
  input.addEventListener("change", () => onChange?.(input.checked));
  const el = h("label.toggle", { for: iid }, input, h("span.track", h("span.knob")), h("span", label, hint && h("small.hint", hint)));
  Object.defineProperty(el, "value", { get: () => input.checked, set: (v) => (input.checked = v) });
  return el;
}

export function button(label, onclick, kind = "") {
  return h(`button.btn${kind ? "." + kind : ""}`, { type: "button", onclick }, label);
}

/** Stat tile row: [{label, value, tone?}] -> returns {el, set(index, value, tone)} */
export function stats(items) {
  const vals = items.map((it) => h("div.stat-v", it.value ?? "–"));
  const tiles = items.map((it, i) => h("div.stat", { "data-tone": it.tone || "" }, h("div.stat-l", it.label), vals[i]));
  return {
    el: h("div.stats", tiles),
    set(i, v, tone) {
      vals[i].textContent = v;
      if (tone !== undefined) tiles[i].dataset.tone = tone;
    },
  };
}

/**
 * Predict-then-reveal. The learner commits to an answer before the sim tells them.
 * options: [string]; answer: index; explain: html
 */
export function predict({ chapter, question, options, answer, explain }) {
  const body = h("div.predict-body");
  const opts = options.map((o, i) =>
    h("button.opt", { type: "button", onclick: () => choose(i) }, h("span.opt-k", String.fromCharCode(65 + i)), h("span", o)),
  );
  function choose(i) {
    opts.forEach((b, j) => {
      b.disabled = true;
      b.classList.toggle("right", j === answer);
      b.classList.toggle("wrong", j === i && i !== answer);
    });
    body.replaceChildren(
      h("p.verdict", i === answer ? "Right." : `Not quite. The answer is ${String.fromCharCode(65 + answer)}.`),
      h("div", { html: explain }),
    );
    if (chapter) progress.mark(chapter, "predicted");
  }
  return h("div.predict", h("div.eyebrow", "Predict first"), h("p.q", question), h("div.opts", opts), body);
}

/** Step-through flow: steps [{title, html, onEnter?}] with prev/next. */
export function stepper(steps, { onStep } = {}) {
  let i = 0;
  const title = h("div.step-title");
  const body = h("div.step-body");
  const count = h("span.step-count");
  const prev = button("Back", () => go(i - 1));
  const next = button("Next", () => go(i + 1), "primary");
  const dots = h("div.step-dots", steps.map((_, k) => h("button", { type: "button", "aria-label": `Step ${k + 1}`, onclick: () => go(k) })));
  function go(k) {
    i = Math.max(0, Math.min(steps.length - 1, k));
    title.textContent = steps[i].title;
    body.innerHTML = steps[i].html;
    count.textContent = `${i + 1} / ${steps.length}`;
    prev.disabled = i === 0;
    next.disabled = i === steps.length - 1;
    [...dots.children].forEach((d, k2) => d.classList.toggle("on", k2 <= i));
    steps[i].onEnter?.();
    onStep?.(i);
  }
  const el = h("div.stepper", h("div.step-head", title, count), body, h("div.step-nav", prev, dots, next));
  queueMicrotask(() => go(0));
  el.go = go;
  return el;
}

/** Code tabs: {Python: "...", TypeScript: "..."} */
export function code(tabs, note) {
  const names = Object.keys(tabs);
  const pre = h("pre.code");
  const set = (n) => {
    pre.innerHTML = highlight(tabs[n]);
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.textContent === n ? "true" : "false"));
  };
  const seg = h("div.seg", names.map((n) => h("button", { type: "button", onclick: () => set(n) }, n)));
  const copy = h("button.btn.small", {
    type: "button",
    onclick: async () => {
      try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = "Copied"; } catch { copy.textContent = "Select and copy"; }
      setTimeout(() => (copy.textContent = "Copy"), 1500);
    },
  }, "Copy");
  const el = h("div.codebox", h("div.code-head", names.length > 1 ? seg : h("span.code-name", names[0]), copy), pre, note && h("p.code-note", note));
  set(names[0]);
  return el;
}

// Tiny highlighter: comments, strings, keywords. Enough for teaching snippets.
const KW = /\b(def|class|return|if|else|elif|for|while|in|import|from|as|with|async|await|const|let|var|function|new|export|try|except|catch|finally|raise|throw|yield|lambda|None|True|False|null|true|false|self|this|SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|CREATE|INDEX|ON|JOIN|ORDER|BY|LIMIT|EXPLAIN|BEGIN|COMMIT|interface|type|struct|func|go|package)\b/g;
function highlight(src) {
  return esc(src)
    .split("\n")
    .map((line) => {
      const cm = line.match(/^(.*?)(#(?![\w{]).*|\/\/.*|--\s.*)$/);
      const head = cm ? cm[1] : line, tail = cm ? cm[2] : "";
      const body = head
        .replace(/(&quot;.*?&quot;|&#39;.*?&#39;|`.*?`)/g, "\u0001$1\u0002")
        .split(/(\u0001.*?\u0002)/)
        .map((part) => (part.startsWith("\u0001") ? `<span class="st">${part.slice(1, -1)}</span>` : part.replace(KW, '<span class="kw">$1</span>')))
        .join("");
      return body + (tail ? `<span class="cm">${tail}</span>` : "");
    })
    .join("\n");
}

export function callout(kind, title, html) {
  return h(`aside.callout.${kind}`, h("b", title), h("div", { html }));
}

/** Dilemma card: a real trade-off with no free answer. sides: [{name, pros:[], cons:[]}] */
export function dilemma(question, sides, verdict) {
  return h(
    "div.dilemma",
    h("div.eyebrow", "The dilemma"),
    h("p.q", question),
    h("div.sides", sides.map((sd) => h("div.side", h("h4", sd.name), h("ul.pros", sd.pros.map((p) => h("li", p))), h("ul.cons", sd.cons.map((c) => h("li", c)))))),
    verdict && h("p.verdict", { html: verdict }),
  );
}

/**
 * Rolling line chart in SVG. series: [{name, color}] ; push(values[]) appends a point.
 * Fixed y-max (or auto) so the scale stays honest while data streams in.
 */
export function liveChart({ series, height = 140, points = 120, yMax = null, fmt = (v) => v, label }) {
  const W = 600, H = height, P = { l: 44, r: 8, t: 8, b: 18 };
  const data = series.map(() => []);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": label || "chart" });
  const grid = s("g"), lines = series.map((se) => s("path", { class: "ln", style: `stroke:${se.color}` }));
  svg.append(grid, ...lines);
  const legend = h("div.legend", series.map((se) => h("span", h("i", { style: { background: se.color } }), se.name)));
  function draw() {
    const all = data.flat();
    const top = yMax ?? Math.max(1, ...all) * 1.15;
    grid.replaceChildren();
    for (const t of [0, 0.5, 1]) {
      const y = P.t + (H - P.t - P.b) * (1 - t);
      grid.append(s("line", { x1: P.l, x2: W - P.r, y1: y, y2: y, class: "gl" }), s("text", { x: P.l - 6, y: y + 4, "text-anchor": "end", class: "tk", text: fmt(top * t) }));
    }
    data.forEach((d, i) => {
      const dx = (W - P.l - P.r) / (points - 1);
      lines[i].setAttribute("d", d.map((v, k) => `${k ? "L" : "M"}${P.l + k * dx},${P.t + (H - P.t - P.b) * (1 - Math.min(v, top) / top)}`).join(" "));
    });
  }
  draw();
  return {
    el: h("div.chartbox", legend, svg),
    push(values) {
      values.forEach((v, i) => { data[i].push(v); if (data[i].length > points) data[i].shift(); });
      draw();
    },
    reset() { data.forEach((d) => (d.length = 0)); draw(); },
  };
}

/** Horizontal bar list: [{label, value, color}] with a fixed max. */
export function bars(items, { max, fmt = (v) => v } = {}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return h("div.bars", items.map((it) => h("div.bar-row", h("span.bar-l", it.label), h("span.bar-t", h("span.bar-f", { style: { width: `${Math.min(100, (it.value / top) * 100)}%`, background: it.color || "var(--accent)" } })), h("span.bar-v", fmt(it.value)))));
}

export function section(title, ...kids) {
  return h("section.block", title && h("h2", title), kids);
}
export function prose(html) {
  return h("div.prose", { html });
}
