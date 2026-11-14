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
document.getElementById("jump")?.replaceChildren(...LEVELS.map((lv, i) =>
  h("a.jump-chip", { href: `#${lv.id}`, style: { "--lc": lc(i) } }, h("i"), h("span", `${i} · ${lv.name}`))));
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
