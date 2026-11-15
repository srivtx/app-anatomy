import { h, progress } from "./core.js";
import { LEVELS } from "./catalog.js";
import { topbar } from "./topbar.js";

topbar(document.getElementById("top"));
const done = progress.read();

const live = LEVELS.flatMap((lv) => lv.chapters).filter((c) => c.live).length;
const seen = Object.values(done).filter((d) => d.visited).length;
document.getElementById("hero-stats")?.replaceChildren(
  ...[[live, "live chapters"], [LEVELS.length, "levels"], [13, "app types"], [seen, seen ? "opened by you" : "sign-ups needed"]]
    .map(([n, l]) => h("div.hs", h("b", String(n)), h("span", l))));
const lc = (i) => `var(--c${(i % 6) + 1})`;
// the course map: levels grouped into acts, one level's chapters at a time
import("./explorer.js").then(({ explorer }) => explorer(document.getElementById("ladder"), {
  levels: LEVELS, done,
  acts: [
    { name: "Act I · One app", blurb: "a request, a CRUD app, its layers", levels: [0, 1] },
    { name: "Act II · At scale", blurb: "many users, many machines, real production", levels: [2, 3, 4] },
    { name: "Act III · Craft", blurb: "code design and live updates", levels: [5, 6] },
    { name: "Act IV · AI and every app", blurb: "LLM apps, agents and the atlas", levels: [7, 8] },
  ].map((a) => ({ ...a, levels: a.levels.filter((i) => i < LEVELS.length) })),
}));

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

// ---------- pixel layer: the mascot, and your bench (a garden per level, cans per quiz, compute earned) ----------
import("./pixel.js").then(async ({ mascot, flower, can }) => {
  const { quizState } = await import("./prefs.js");
  const { desk, cashPile } = await import("./voxel.js");
  const { stickerRow } = await import("./badges.js");
  const qs = quizState.get(), due = quizState.due(qs).length, hist = qs.hist || [];
  const liveCh = LEVELS.flatMap((lv) => lv.chapters.filter((c) => c.live));
  const nextCh = liveCh.find((c) => !done[c.id]?.visited);
  const opened = liveCh.filter((c) => done[c.id]?.visited).length, predicted = liveCh.filter((c) => done[c.id]?.predicted).length;
  const rightAnswers = hist.reduce((a, r) => a + r.right, 0);
  const flops = opened * 1e5 + predicted * 5e5 + rightAnswers * 2e4;
  const fmtF = (f) => { if (!f) return "0 requests"; const u = [["M", 1e6], ["k", 1e3]].find(([, v]) => f >= v) || ["", 1]; return `${(f / u[1]).toFixed(f / u[1] < 10 && u[1] > 1 ? 1 : 0)}${u[0]} requests`; };
  const say = due ? h("span", `${due} question${due === 1 ? " is" : "s are"} due for review. `, h("a", { href: "/quiz" }, "Let's go →"))
    : nextCh ? h("span", opened ? "Next up: " : "Start here: ", h("a", { href: `/learn?c=${nextCh.id}` }, nextCh.title), " →")
    : h("span", "You've opened every chapter. ", h("a", { href: "/quiz" }, "Sit a mock exam →"));

  // returning visitors: the main button picks up where they left off
  const cta = document.querySelector(".hero-ctas .btn.primary");
  if (cta && opened && nextCh) { cta.textContent = `Continue: ${nextCh.title} →`; cta.href = `/learn?c=${nextCh.id}`; }
  else if (cta && opened && !nextCh) { cta.textContent = "Sit a mock exam →"; cta.href = "/quiz"; }
  // the mascot peeks over the live demo
  const fig = document.getElementById("hero-viz");
  if (fig) {
    const wrap = h("div.viz-wrap"); fig.replaceWith(wrap); wrap.append(fig,
      h("div.mascot-wrap.hero-mascot", h("div.bubble", opened ? "Cache hit. Database spared!" : "Hi! I'm Servo. Watch the requests flow."), h("div", { html: mascot("servo", "happy", { label: "Servo, the course mascot" }) })));
  }

  const garden = LEVELS.map((lv, i) => {
    const live = lv.chapters.filter((c) => c.live), o = live.filter((c) => done[c.id]?.visited).length, pr = live.filter((c) => done[c.id]?.predicted).length;
    const stage = !o ? 0 : o === live.length && pr ? 3 : o / live.length >= 0.5 ? 2 : 1;
    const word = ["a seed", "a sprout", "a bud", "in bloom"][stage];
    return h("a.plot", { href: `#${lv.id}`, style: { "--lc": lc(i) }, title: `Level ${i} · ${lv.name}: ${word} (${o}/${live.length} opened)` },
      h("div", { html: flower(stage, lv.id, { label: `Level ${i}: ${word}` }) }), h("span", String(i)));
  });
  const cans = hist.slice(-6).map((r, k) => h("div.can-i", { title: `${r.right}/${r.n} on ${new Date(r.at).toLocaleDateString()}`, html: can(k % 2 ? "#7cc4ff" : "#ff7eb6") }));
  document.getElementById("ladder")?.after(h("section.bench",
    h("div.bench-h", h("div.bench-t", h("div.eyebrow", "Your bench"), h("h3", "A desk that fills up as you learn"), h("p.muted", "It grows as you learn: a flower for every level, a can for every quiz, and requests served for everything you do. Saved on this device.")),
      h("div.mascot-wrap.bench-mascot", h("div.bubble.left", say), h("div", { html: mascot("servo", due ? "wow" : "happy") }))),
    h("div.bench-body",
      h("div.scene", h("div.desk-wrap", { html: desk({ cash: Math.min(6, Math.ceil(opened / 4)), cans: Math.min(4, hist.length), books: LEVELS.filter((lv) => lv.chapters.every((c) => !c.live || done[c.id]?.visited)).length,
        plant: !opened ? 0 : opened / liveCh.length >= 0.6 ? 3 : opened / liveCh.length >= 0.2 ? 2 : 1, rack: opened >= 4 }, "Your desk: it fills up as you learn") }),),
      h("div.garden-wrap", h("div.garden", { "aria-label": "Your garden: one flower per level", style: { "--n": String(LEVELS.length) } }, garden), opened ? null : h("p.garden-hint", "Open a chapter to plant its level. Make a prediction to help it bloom.")),
      h("div.bench-side",
        h("div.bench-item", h("div.cans", cans.length ? cans : h("div.can-i.ghost", { html: can("#c9ccd6") })), h("b", String(hist.length)), h("span", hist.length === 1 ? "quiz taken" : "quizzes taken")),
        h("div.bench-item", h("div.cash-i", { html: cashPile(1) }), h("b", fmtF(flops)), h("span", "requests served")),
        h("div.bench-item", h("div.fl-i", { html: flower(opened ? 3 : 1, "bench") }), h("b", `${opened}/${liveCh.length}`), h("span", "chapters opened"))),
      stickerRow())));
});
