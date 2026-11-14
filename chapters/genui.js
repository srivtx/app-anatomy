import { h, s, esc } from "../lib/core.js";
import { slider, segmented, predict, code, dilemma, callout, section, prose, button, table } from "../lib/widgets.js";

// Same two pieces as the genui-stream project: a tolerant partial-JSON parser
// and a chunk-safe parser that splits <ui> tags out of a token stream.
export function parsePartialJson(input) {
  let i = 0; const n = input.length; const EOF = Symbol("eof");
  const ws = () => { while (i < n && " \n\r\t".includes(input[i])) i++; };
  function str() {
    i++; let out = "";
    while (i < n) {
      const c = input[i];
      if (c === '"') { i++; return { v: out, done: true }; }
      if (c === "\\") { if (i + 1 >= n) { i = n; break; } const e = input[i + 1]; out += { n: "\n", t: "\t", '"': '"', "\\": "\\", "/": "/" }[e] ?? e; i += 2; continue; }
      out += c; i++;
    }
    return { v: out, done: false };
  }
  function num() { const st = i; while (i < n && /[-+0-9.eE]/.test(input[i])) i++; const t = input.slice(st, i).replace(/[-+eE.]+$/, ""); if (i >= n && (!t || t === "-")) return EOF; return Number(t); }
  function lit() { for (const [w, v] of [["true", true], ["false", false], ["null", null]]) { const a = input.slice(i, i + w.length); if (a === w) { i += w.length; return v; } if (i + a.length >= n && w.startsWith(a)) { i = n; return EOF; } } throw new Error("bad token"); }
  function val() { ws(); if (i >= n) return EOF; const c = input[i]; if (c === "{") return obj(); if (c === "[") return arr(); if (c === '"') return str().v; if (c === "-" || (c >= "0" && c <= "9")) return num(); return lit(); }
  function obj() { i++; const o = {}; for (;;) { ws(); if (i >= n) return o; if (input[i] === "}") { i++; return o; } if (input[i] === ",") { i++; continue; } const k = str(); if (!k.done) return o; ws(); if (i >= n) return o; i++; const v = val(); if (v === EOF) return o; o[k.v] = v; } }
  function arr() { i++; const a = []; for (;;) { ws(); if (i >= n) return a; if (input[i] === "]") { i++; return a; } if (input[i] === ",") { i++; continue; } const v = val(); if (v === EOF) return a; a.push(v); } }
  const v = val(); return v === EOF ? undefined : v;
}

const PROPS = { kind: "bar", title: "Requests per second by region", categories: ["us-east", "eu-west", "ap-south", "sa-east"], series: [{ name: "req/s", values: [1840, 1320, 960, 410] }] };
const STREAM = [
  { text: "Most traffic comes from us-east, so that's where the extra capacity should go.\n\n" },
  { comp: "chart", props: PROPS },
  { text: "\neu-west is close behind; ap-south is growing fastest." },
];

function chartSvg(p) {
  const cats = Array.isArray(p?.categories) ? p.categories.filter((c) => typeof c === "string") : [];
  const vals = (p?.series?.[0]?.values || []).filter((v) => typeof v === "number");
  const W = 420, H = 180, L = 70, B = 8, max = 2000;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": p?.title || "chart", style: "max-width:460px" });
  const band = (H - B - 10) / Math.max(1, cats.length);
  cats.forEach((c, i) => {
    const y = 10 + i * band;
    svg.append(s("text", { x: L - 8, y: y + band / 2 + 4, "text-anchor": "end", class: "node-sub", text: c }));
    if (i < vals.length) {
      svg.append(s("rect", { x: L, y: y + band * 0.18, width: ((W - L - 50) * vals[i]) / max, height: band * 0.64, rx: 4, style: "fill:var(--c1)" }));
      svg.append(s("text", { x: L + ((W - L - 50) * vals[i]) / max + 6, y: y + band / 2 + 4, class: "node-sub", text: String(vals[i]) }));
    }
  });
  return h("div", { style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "10px 12px", background: "var(--surface)" } }, h("b", p?.title || " "), cats.length ? svg : h("div", { style: { height: "120px", background: "var(--sunken)", borderRadius: "8px", marginTop: "8px" } }));
}

export default function (root, { id }) {
  let speed = 40, run = 0;
  const raw = h("pre.log", { style: { minHeight: "220px", maxHeight: "260px" } }), view = h("div", { style: { display: "grid", gap: "8px", fontSize: "15px" } }), events = h("pre.log", { style: { minHeight: "220px", maxHeight: "260px" } });

  function play() {
    const me = ++run;
    const text = STREAM.map((x) => (x.text ?? `<ui component="${x.comp}">\n${JSON.stringify(x.props)}\n</ui>\n`)).join("");
    const chunks = [];
    for (let i = 0; i < text.length; ) { const k = 2 + Math.floor(Math.random() * 7); chunks.push(text.slice(i, i + k)); i += k; }
    raw.textContent = ""; events.textContent = ""; view.replaceChildren();
    let buf = "", state = "text", body = "", textEl = null, comp = null, k = 0, nEv = 0;
    const ev = (t, d) => { nEv++; events.textContent += `${t.padEnd(9)} ${d}\n`; events.scrollTop = events.scrollHeight; };
    const step = () => {
      if (me !== run) return;
      if (k >= chunks.length) { ev("done", "end_turn"); return; }
      const c = chunks[k++];
      raw.textContent += c; raw.scrollTop = raw.scrollHeight;
      buf += c;
      for (;;) {
        if (state === "text") {
          const at = buf.indexOf("<ui ");
          // hold back anything that could be the start of a tag
          let hold = 0; for (let j = Math.min(3, buf.length); j > 0; j--) if ("<ui ".startsWith(buf.slice(-j))) { hold = j; break; }
          const emit = at === -1 ? buf.slice(0, buf.length - hold) : buf.slice(0, at);
          if (emit) { if (!textEl) { textEl = h("p", { style: { margin: 0 } }); view.append(textEl); } textEl.textContent += emit; ev("text", JSON.stringify(emit)); }
          if (at === -1) { buf = buf.slice(buf.length - hold); break; }
          buf = buf.slice(at); state = "tag";
        }
        if (state === "tag") {
          const end = buf.indexOf(">"); if (end === -1) break;
          ev("ui.start", "chart"); buf = buf.slice(end + 1); state = "body"; body = ""; textEl = null;
          comp = h("div"); view.append(comp);
        }
        if (state === "body") {
          const at = buf.indexOf("</ui>");
          // hold back a possible partial "</ui>" so it never leaks into the JSON
          let hold = 0; if (at === -1) for (let j = Math.min(4, buf.length); j > 0; j--) if ("</ui>".startsWith(buf.slice(-j))) { hold = j; break; }
          const take = at === -1 ? buf.slice(0, buf.length - hold) : buf.slice(0, at);
          body += take; buf = at === -1 ? buf.slice(buf.length - hold) : buf.slice(at + 5);
          const snap = parsePartialJson(body);
          if (snap !== undefined) { comp.replaceChildren(chartSvg(snap)); if (take) ev(at === -1 ? "ui.patch" : "ui.done", JSON.stringify(snap).slice(0, 60)); }
          if (at === -1) break;
          state = "text";
        }
      }
      setTimeout(step, speed * (0.5 + Math.random()));
    };
    step();
  }

  // partial JSON slider
  const full = JSON.stringify(PROPS);
  const pjOut = h("pre.log"), pjView = h("div"), pjPrefix = h("pre.log", { style: { wordBreak: "break-all" } });
  const pj = slider({ label: "Characters received", min: 0, max: full.length, value: Math.round(full.length * 0.55), fmt: (v) => `${v} / ${full.length}`, onInput: (v) => renderPj(v) });
  function renderPj(n) {
    pjPrefix.innerHTML = `${esc(full.slice(0, n))}<span style="opacity:.3">${esc(full.slice(n))}</span>`;
    const v = parsePartialJson(full.slice(0, n));
    pjOut.textContent = v === undefined ? "undefined (nothing usable yet)" : JSON.stringify(v, null, 1);
    pjView.replaceChildren(chartSvg(v));
  }

  root.append(
    section(null, prose(`<p>Chat UIs used to stream plain text. Newer AI apps stream <b>interface</b>: charts, tables and cards that appear while the model is still writing. The model never writes HTML. It names a component from a catalog you own and writes its props as JSON; your code parses that JSON <i>before it's finished</i> and renders whatever is valid so far. The full production version, with a server, both prompting strategies, validation and tests, is the companion project <a href="https://github.com/srivtx/genui-stream" target="_blank" rel="noopener">genui-stream</a>.</p>`)),
    section("Watch an answer build its own chart",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Speed", options: [{ value: 110, label: "Slow" }, { value: 40, label: "Normal" }, { value: 12, label: "Fast" }], value: speed, onChange: (v) => (speed = v) }),
          button("Play", play, "primary"),
        ),
        h("div.stage-body", h("div.split", h("div", h("div.eyebrow", "Raw tokens from the model"), raw), h("div", h("div.eyebrow", "Events your server sends"), events)), h("div", h("div.eyebrow", "What the user sees"), view)),
      ),
    ),
    section("Reading JSON that isn't finished",
      h("div.stage", h("div.stage-controls", pj), h("div.stage-body", h("div.split", h("div", h("div.eyebrow", "Received so far"), pjPrefix), h("div", h("div.eyebrow", "parsePartialJson(prefix)"), pjOut)), pjView)),
      predict({
        chapter: id,
        question: "The model has written {\"title\":\"Requests per sec — the string isn't closed yet. What should the UI do?",
        options: ["Wait for the whole JSON before showing anything", "Show the chart card with the title typed so far, and fill in bars as they arrive", "Show an error", "Render the raw JSON text"],
        answer: 1,
        explain: "<p>A tolerant parser closes the open string and objects, so the renderer gets <code>{title: \"Requests per sec\"}</code> and can draw the frame now. Only when the component's closing tag arrives is the full JSON validated against the schema; if it fails, the user sees an error card, never a broken page.</p>",
      }),
    ),
    section("Design choices",
      table(["Question", "Option A", "Option B"], [
        ["How does the model emit UI?", "Inline tags in the text (one request, lowest latency)", "One tool per component (schemas travel with tools, the model sees validation errors)"],
        ["Who validates?", "The server, before the client sees “done”", "The client only (simpler, but trusts model output)"],
        ["How much freedom?", "A fixed catalog of components", "Generated code in a sandboxed iframe (anything, but renders only when complete)"],
      ]),
      dilemma("Should the model generate React code instead of picking components?", [
        { name: "Component catalog", pros: ["On-brand, accessible, safe", "Streams and renders progressively"], cons: ["Only what you've built"] },
        { name: "Generated code", pros: ["Any interface at all"], cons: ["Must run sandboxed", "Can't render until it compiles", "Inconsistent design"] },
      ], "Products use catalogs for answers inside a chat and generated code for “build me an app” features."),
      callout("tip", "Go deeper", "<p>The genui-stream repo has the server-side state machine, the throttled patch protocol, Zod validation, Claude streaming with tool calls, and a browser test that drives both strategies.</p>"),
    ),
    section("In code",
      code({
        "Client (React reducer)": `function apply(msg, e) {
  switch (e.t) {
    case "text":     return appendText(msg, e.partId, e.delta);
    case "ui.start": return addPart(msg, { kind: "ui", id: e.partId, component: e.component, status: "streaming" });
    case "ui.patch": return updatePart(msg, e.partId, { props: e.props });            // partial, unvalidated
    case "ui.done":  return updatePart(msg, e.partId, { props: e.props, status: "done" });
    case "ui.error": return updatePart(msg, e.partId, { status: "error", error: e.error });
  }
}`,
        "Server (decode + validate)": `for await (const chunk of modelStream) {
  for (const ev of parser.push(chunk)) {               // splits text from <ui> bodies
    if (ev.type === "text")  send({ t: "text", partId, delta: ev.text });
    if (ev.type === "open")  partId = start(ev.component);
    if (ev.type === "json")  throttle(() => send({ t: "ui.patch", partId, props: parsePartialJson(ev.buffer) }));
    if (ev.type === "close") {
      const r = schemas[component].safeParse(JSON.parse(ev.buffer));
      send(r.success ? { t: "ui.done", partId, props: r.data } : { t: "ui.error", partId, error: r.error.message });
    }
  }
}`,
      }),
    ),
  );
  renderPj(pj.value);
  play();
}
