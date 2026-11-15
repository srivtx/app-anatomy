import { h, progress } from "./core.js";
import { LEVELS } from "./catalog.js";
import { topbar } from "./topbar.js";

topbar(document.getElementById("top"));
const done = progress.read();

const live = LEVELS.flatMap((lv) => lv.chapters).filter((c) => c.live).length;
const seen = Object.values(done).filter((d) => d.visited).length;
document.getElementById("hero-stats")?.replaceChildren(
  ...[[live, "live chapters"], [LEVELS.length, "levels"], [13, "app types in the atlas"], [seen, seen ? "opened by you" : "sign-ups needed"]]
    .map(([n, l]) => h("div.hs", h("b", String(n)), h("span", l))));
const lc = (i) => `var(--c${(i % 6) + 1})`;
// what's inside: one bar per level, its length the number of chapters, the filled part what you've opened
const maxCh = Math.max(...LEVELS.map((lv) => lv.chapters.length));
document.getElementById("jump")?.replaceChildren(
  h("div.ix-h", h("span", "What's inside"), h("span", "bar length = chapters · filled = opened by you")),
  ...LEVELS.map((lv, i) => {
    const opened = lv.chapters.filter((c) => done[c.id]?.visited).length;
    return h("a.ix-row", { href: `#${lv.id}`, style: { "--lc": lc(i) } },
      h("span.ix-b", String(i)), h("span.ix-name", lv.name),
      h("span.ix-track", h("span.ix-bar", { style: { "--w": `${(lv.chapters.length / maxCh) * 100}%`, "--f": `${(opened / lv.chapters.length) * 100}%` } }, h("span.ix-n", String(lv.chapters.length)))),
      h("span.ix-tag", lv.tagline));
  }));
document.getElementById("ladder").replaceChildren(
  ...LEVELS.map((lv, i) =>
    h("section.level", { id: lv.id, style: { "--lc": lc(i) } },
      h("div.level-h", h("div.n", h("span.badge", String(i)), `Level ${i}`), h("h2", lv.name), h("p", lv.tagline),
        h("div.level-prog", `${lv.chapters.filter((c) => done[c.id]?.visited).length} / ${lv.chapters.length} opened`)),
      h("div.cards", lv.chapters.map((c, j) =>
        c.live
          ? h("a.card", { href: `/learn?c=${c.id}` },
              h("span.t", c.title), h("span.b", c.blurb),
              h("span.meta", h("span", `${i}.${j + 1}`), done[c.id]?.visited ? h("span.done", done[c.id]?.predicted ? "✓ done" : "visited") : h("span", "start")))
          : h("div.card.soon", { "aria-disabled": "true" }, h("span.t", c.title), h("span.b", c.blurb), h("span.meta", h("span", `${i}.${j + 1}`), h("span", "coming"))),
      )),
    ),
  ),
);

// Hero: requests flowing through a small system. Cache hits go back early; misses reach the database; some work goes to a queue.
const viz = document.getElementById("hero-viz");
if (viz) {
  const N = (x, y, w, t, sub, k = "") => `<g class="node ${k}" transform="translate(${x} ${y})"><rect x="${-w / 2}" y="-19" width="${w}" height="38" rx="9"/><text y="${sub ? -5 : 0}">${t}</text>${sub ? `<text class="sub" y="10">${sub}</text>` : ""}</g>`;
  const paths = {
    in: "M58 150 C 95 150 100 150 132 150",
    a1: "M178 150 C 205 150 205 80 238 80", a2: "M178 150 L 238 150", a3: "M178 150 C 205 150 205 220 238 220",
    c1: "M282 80 C 320 80 320 70 352 70", c2: "M282 150 C 320 150 320 70 352 70", c3: "M282 220 C 315 220 320 80 352 72",
    d1: "M282 80 C 320 80 320 160 352 160", d2: "M282 150 L 352 160", d3: "M282 220 C 320 220 320 165 352 162",
    q: "M282 220 C 310 236 330 250 352 250", w: "M398 250 L 430 250",
  };
  const wires = Object.values(paths).map((d) => `<path class="wire" d="${d}"/>`).join("");
  const pk = (cls, path, dur, begin) => `<circle class="pkt ${cls}" r="4.5"><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" path="${path}" keyPoints="0;1" keyTimes="0;1" calcMode="linear"/></circle>`;
  let pkts = "";
  [0, 0.45, 0.9, 1.35].forEach((b) => { pkts += pk("", paths.in, 1.8, b); });
  ["a1", "a2", "a3"].forEach((k, i) => { pkts += pk("", paths[k], 1.8, 0.6 * i + 0.3); });
  ["c1", "c2", "c3"].forEach((k, i) => { pkts += pk("hit", paths[k], 1.8, 0.6 * i + 0.9); });
  pkts += pk("miss", paths.d2, 2.6, 1.2) + pk("miss", paths.d3, 3.4, 2.1) + pk("job", paths.q, 2.2, 0.4) + pk("job", paths.w, 2.2, 1.5);
  viz.innerHTML = `<svg class="sysd" viewBox="0 0 480 300" role="img" aria-label="Browser to load balancer to three app servers, which read a cache and a database and push jobs to a queue">
    ${wires}
    ${N(34, 150, 58, "Browser", "1k req/s")}${N(155, 150, 50, "LB", "", "k")}
    ${N(260, 80, 46, "app 1")}${N(260, 150, 46, "app 2")}${N(260, 220, 46, "app 3")}
    ${N(375, 70, 50, "Cache", "80% hit", "k")}${N(375, 160, 50, "DB", "primary")}${N(375, 250, 50, "Queue", "")}${N(452, 250, 46, "worker")}
    ${pkts}</svg><p class="canvas-cap"><span>one request: browser → load balancer → app → cache, else database</span><span>green hit · orange miss · purple job</span></p>`;
}
