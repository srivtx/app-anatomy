import { h, s, fmtMs } from "../lib/core.js";
import { slider, predict, code, callout, dilemma, section, prose, button } from "../lib/widgets.js";

// A simple timing model for four ways of producing HTML.
// R: round trip to the origin, E: round trip to a CDN edge.
function model({ rtt: R, api, kb, cpu }) {
  const E = 15, dl = (x) => x * 0.4, exec = kb * 0.5 * cpu, render = 25 * cpu;
  const conn = (rt) => 2 * rt; // TCP + TLS 1.3
  const out = {};

  { // Client-side rendering (SPA)
    const shell = conn(R) + R + 5;
    const jsDone = shell + R + dl(kb) + exec;
    const data = jsDone + R + api;
    out.csr = { name: "Client-side (SPA)", fcp: shell + 15, lcp: data + render, tti: data + render,
      segs: [["connect + shell", 0, shell, "var(--c4)"], ["download JS", shell, shell + R + dl(kb), "var(--c2)"], ["run JS", shell + R + dl(kb), jsDone, "var(--c5)"], ["fetch data", jsDone, data, "var(--c1)"], ["render", data, data + render, "var(--c3)"]] };
  }
  { // Server-side rendering
    const ttfb = conn(R) + R + api + 20;
    const lcp = ttfb + dl(60) + 15;
    const tti = lcp + R + dl(kb) + exec;
    out.ssr = { name: "Server-side (SSR)", fcp: lcp, lcp, tti,
      segs: [["connect + server fetches data", 0, ttfb, "var(--c1)"], ["HTML arrives", ttfb, lcp, "var(--c3)"], ["download JS", lcp, lcp + R + dl(kb), "var(--c2)"], ["hydrate", lcp + R + dl(kb), tti, "var(--c5)"]] };
  }
  { // Static (built at deploy, served from a CDN)
    const ttfb = conn(E) + E + 2;
    const lcp = ttfb + dl(60) + 15;
    const tti = lcp + E + dl(kb) + exec;
    out.ssg = { name: "Static (SSG + CDN)", fcp: lcp, lcp, tti, stale: true,
      segs: [["edge serves prebuilt HTML", 0, ttfb, "var(--c4)"], ["HTML arrives", ttfb, lcp, "var(--c3)"], ["download JS", lcp, lcp + E + dl(kb), "var(--c2)"], ["hydrate", lcp + E + dl(kb), tti, "var(--c5)"]] };
  }
  { // Streaming SSR: flush the shell now, stream the data part later
    const shell = conn(R) + R + 5;
    const lcp = conn(R) + R + api + 20 + 15;
    const jsDone = shell + R + dl(kb) + exec;
    const tti = Math.max(lcp, jsDone) + 10;
    out.stream = { name: "Streaming SSR", fcp: shell + 15, lcp, tti,
      segs: [["connect + shell flushed", 0, shell, "var(--c4)"], ["server fetches data (streaming)", shell, lcp, "var(--c1)"], ["JS loads in parallel", shell, jsDone, "var(--c2)"], ["hydrate", Math.max(lcp, jsDone), tti, "var(--c5)"]] };
  }
  return out;
}

const KEYS = ["csr", "ssr", "ssg", "stream"];

function phone(state, label) {
  // state: blank | shell | content | live
  const W = 120, H = 200;
  const g = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${label}: ${state}`, style: "max-width:120px;margin:0 auto" });
  g.append(s("rect", { x: 1, y: 1, width: W - 2, height: H - 2, rx: 14, class: "node-box" }));
  if (state !== "blank") {
    g.append(s("rect", { x: 10, y: 12, width: 100, height: 14, rx: 3, style: "fill:var(--sunken)" }));
    if (state === "shell") {
      for (let i = 0; i < 3; i++) g.append(s("rect", { x: 10, y: 40 + i * 24, width: 100 - i * 18, height: 12, rx: 3, style: "fill:var(--sunken)" }));
      g.append(s("text", { x: 60, y: 150, "text-anchor": "middle", class: "node-sub", text: "loading…" }));
    } else {
      g.append(s("rect", { x: 10, y: 36, width: 100, height: 60, rx: 6, style: "fill:var(--c1);opacity:.75" }));
      g.append(s("rect", { x: 10, y: 104, width: 80, height: 9, rx: 2, style: "fill:var(--ink-2)" }), s("rect", { x: 10, y: 119, width: 60, height: 9, rx: 2, style: "fill:var(--ink-3)" }));
      g.append(s("rect", { x: 10, y: 150, width: 100, height: 26, rx: 7, style: state === "live" ? "fill:var(--accent)" : "fill:var(--line)" }));
      g.append(s("text", { x: 60, y: 167, "text-anchor": "middle", style: `fill:${state === "live" ? "var(--accent-ink)" : "var(--ink-3)"};font:600 11px var(--body)`, text: state === "live" ? "Add to cart" : "not clickable yet" }));
    }
  }
  return g;
}

export default function (root, { id }) {
  const o = { rtt: 80, api: 150, kb: 400, cpu: 2 };
  let t = 0, playing = 0;
  const lanes = h("div"), frames = h("div.split", { style: { gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" } }), table = h("div.tbl-wrap");
  const scrub = slider({ label: "Time since Enter", min: 0, max: 3000, step: 10, value: 0, fmt: fmtMs, onInput: (v) => { t = v; drawFrames(); drawLanes(); } });

  let res;
  function drawLanes() {
    const max = Math.max(...KEYS.map((k) => res[k].tti)) * 1.08;
    const W = 720, L = 150, rowH = 44;
    const x = (ms) => L + (ms / max) * (W - L - 10);
    const svg = s("svg", { viewBox: `0 0 ${W} ${KEYS.length * rowH + 24}`, role: "img", "aria-label": "Rendering timelines" });
    KEYS.forEach((k, i) => {
      const r = res[k], y = i * rowH + 6;
      svg.append(s("text", { x: 0, y: y + 20, class: "node-label", text: r.name }));
      r.segs.forEach(([lbl, a, b, col], j) => {
        const parallel = lbl.includes("parallel");
        svg.append(s("rect", { x: x(a), y: y + (parallel ? 22 : 8), width: Math.max(2, x(b) - x(a)), height: parallel ? 8 : 14, rx: 3, style: `fill:${col}` }, s("title", { text: `${lbl}: ${fmtMs(b - a)}` })));
      });
      for (const [m, lbl] of [["fcp", "first paint"], ["lcp", "content"], ["tti", "clickable"]]) {
        svg.append(s("line", { x1: x(r[m]), x2: x(r[m]), y1: y + 2, y2: y + 34, style: `stroke:var(--ink);stroke-width:${m === "tti" ? 2 : 1}`, "stroke-dasharray": m === "fcp" ? "2 2" : null }, s("title", { text: `${lbl}: ${fmtMs(r[m])}` })));
      }
    });
    svg.append(s("line", { x1: x(t), x2: x(t), y1: 0, y2: KEYS.length * rowH, style: "stroke:var(--warm);stroke-width:2" }));
    scrub.querySelector("input").max = Math.ceil(max / 10) * 10;
    lanes.replaceChildren(svg, h("div.legend", { style: { marginTop: "6px" } }, ...[["connect / shell", "--c4"], ["data", "--c1"], ["HTML", "--c3"], ["download JS", "--c2"], ["run / hydrate", "--c5"]].map(([n, c]) => h("span", h("i", { style: { background: `var(${c})` } }), n)), h("span", "│ dashed: first paint · thin: content · thick: clickable")));
  }
  function drawFrames() {
    frames.replaceChildren(...KEYS.map((k) => {
      const r = res[k];
      const st = t >= r.tti ? "live" : t >= r.lcp ? "content" : t >= r.fcp ? "shell" : "blank";
      return h("div", { style: { textAlign: "center" } }, phone(st, r.name), h("div", { style: { fontSize: "13px", fontWeight: 600 } }, r.name));
    }));
  }
  function render() {
    res = model(o);
    const best = (m) => Math.min(...KEYS.map((k) => res[k][m]));
    table.replaceChildren(h("table.t", h("thead", h("tr", h("th", "Strategy"), h("th.num", "First paint"), h("th.num", "Content visible"), h("th.num", "Clickable"), h("th", "Catch"))),
      h("tbody", KEYS.map((k) => {
        const r = res[k];
        const cell = (m) => h("td.num", r[m] === best(m) ? h("b", { style: { color: "var(--good)" } }, fmtMs(r[m])) : fmtMs(r[m]));
        const catchTxt = { csr: "Blank until JS + data", ssr: "Looks ready before it works", ssg: "Data frozen at build time", stream: "More moving parts" }[k];
        return h("tr", h("td", r.name), cell("fcp"), cell("lcp"), cell("tti"), h("td.muted", catchTxt));
      }))));
    drawLanes();
    drawFrames();
  }
  function play() {
    cancelAnimationFrame(playing);
    const max = +scrub.querySelector("input").max, t0 = performance.now(), speed = max / 4000;
    const tick = (now) => {
      t = Math.min(max, (now - t0) * speed);
      scrub.value = Math.round(t);
      drawFrames(); drawLanes();
      if (t < max) playing = requestAnimationFrame(tick);
    };
    playing = requestAnimationFrame(tick);
  }

  root.append(
    section(null, prose(`<p>Every web page is HTML in the end. The question is <b>who builds it and when</b>: the browser after downloading JavaScript, your server on every request, a build step once at deploy time, or the server in pieces as data arrives. Each choice moves work around, and users feel exactly where it lands.</p>
<p>Three moments matter: <b>first paint</b> (something appears), <b>content visible</b> (the thing they came for) and <b>clickable</b> (JavaScript has attached event handlers, often called hydration).</p>`)),
    section("Race the four strategies",
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "Network round trip", min: 10, max: 300, step: 10, value: o.rtt, fmt: (v) => `${v} ms`, onInput: (v) => { o.rtt = v; render(); } }),
          slider({ label: "Data API latency", min: 10, max: 1000, step: 10, value: o.api, fmt: (v) => `${v} ms`, onInput: (v) => { o.api = v; render(); } }),
          slider({ label: "JavaScript bundle", min: 50, max: 1500, step: 50, value: o.kb, fmt: (v) => `${v} KB`, onInput: (v) => { o.kb = v; render(); } }),
          slider({ label: "Device CPU", min: 1, max: 6, step: 0.5, value: o.cpu, fmt: (v) => (v === 1 ? "fast laptop" : v >= 4 ? `budget phone (${v}×)` : `${v}× slower`), onInput: (v) => { o.cpu = v; render(); } }),
        ),
        h("div.stage-body", lanes, h("div.row", scrub, button("Play", play, "primary")), frames, table),
      ),
      predict({
        chapter: id,
        question: "With server-side rendering the product page appears quickly on a budget phone. When can the user tap “Add to cart”?",
        options: ["As soon as they can see it", "Only after the JavaScript has downloaded and hydrated the page", "Never, SSR pages are not interactive", "Only after a full reload"],
        answer: 1,
        explain: "<p>SSR sends finished HTML, so the button is visible early, but no click handler exists until the JS bundle arrives and runs. On a slow phone with a big bundle that gap can be seconds. Drag the CPU slider to 6× and watch the space between the thin and thick lines on the SSR row.</p>",
      }),
    ),
    section("How each one works",
      prose(`<ul>
<li><b>Client-side rendering (SPA)</b>: the server sends an almost empty HTML file and a JS bundle. The browser runs the JS, which fetches data from an API and builds the page. Great for app-like tools behind a login; weak for first load and SEO.</li>
<li><b>Server-side rendering</b>: the server fetches data and returns full HTML on every request, then JS hydrates it. Fast to show, always fresh, costs server time per request.</li>
<li><b>Static generation</b>: pages are built once at deploy and cached on a CDN. Fastest possible, but the data is as old as the last build. Incremental regeneration refreshes pages in the background.</li>
<li><b>Streaming SSR</b>: the server flushes the layout immediately and streams slow sections as their data resolves. The JS bundle starts downloading in parallel.</li>
<li><b>Islands / server components</b>: send HTML for everything, and JS only for the few interactive pieces. Less JS means earlier “clickable”.</li>
</ul>`),
      dilemma("You're building an e-commerce product page. Which do you choose?", [
        { name: "Static + CDN", pros: ["Instant from anywhere", "Survives traffic spikes"], cons: ["Price and stock go stale", "Rebuilds for 1M products are slow"] },
        { name: "SSR / streaming", pros: ["Always-fresh price and stock", "Good SEO"], cons: ["Server cost per view", "Slow data means slow pages"] },
        { name: "SPA", pros: ["Simple hosting", "Smooth after the first load"], cons: ["Blank first visit", "Weak SEO without extra work"] },
      ], "Most stores mix them: a static or cached product shell, with price and stock fetched or streamed fresh. The real answer is usually <b>per section</b>, not per site."),
    ),
    section("The code behind each",
      code({
        "Streaming SSR (Node)": `// Send the layout now, stream the slow part when its data is ready
app.get("/product/:id", async (req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.write(\`<html><body><header>Shop</header><main id="p">Loading…</main>\`);

  const product = await db.products.find(req.params.id);   // slow
  res.write(\`<template id="t">\${renderProduct(product)}</template>
<script>document.getElementById("p").replaceWith(document.getElementById("t").content)</script>\`);

  res.end(\`<script src="/app.js" defer></script></body></html>\`);
});`,
        "SSR (Node)": `app.get("/product/:id", async (req, res) => {
  const product = await db.products.find(req.params.id);   // user waits here
  res.send(\`<html><body>\${renderProduct(product)}
<script src="/app.js" defer></script></body></html>\`);      // JS hydrates later
});`,
        "CSR (browser)": `// index.html is just <div id="app"></div><script src="/app.js"></script>
const res = await fetch(\`/api/products/\${id}\`);           // after JS has loaded
const product = await res.json();
document.getElementById("app").innerHTML = renderProduct(product);`,
      }),
      callout("tip", "In frameworks", "<p>Next.js, Remix, Nuxt, SvelteKit and Astro all let you pick per route: static, server-rendered, streamed with <code>&lt;Suspense&gt;</code>, or client-only. Knowing the timeline above is how you choose.</p>"),
    ),
  );
  render();
}
