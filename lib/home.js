import { h, progress } from "./core.js";
import { LEVELS } from "./catalog.js";
import { topbar } from "./topbar.js";

topbar(document.getElementById("top"));
const done = progress.read();

document.getElementById("ladder").replaceChildren(
  ...LEVELS.map((lv, i) =>
    h("section.level", { id: lv.id },
      h("div.level-h", h("div.n", `Level ${i}`), h("h2", lv.name), h("p", lv.tagline)),
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
