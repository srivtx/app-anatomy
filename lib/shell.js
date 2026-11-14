// Loads /chapters/<id>.js for /learn?c=<id> and frames it with header and footer.
import { h, progress } from "./core.js";
import { find, neighbours } from "./catalog.js";
import { topbar } from "./topbar.js";

topbar(document.getElementById("top"));
const root = document.getElementById("chapter");
const id = new URLSearchParams(location.search).get("c") || "";
const meta = find(id);

if (!meta || !meta.live || !/^[a-z0-9-]+$/.test(id)) {
  root.replaceChildren(h("div.ch-head", h("h1", "Chapter not found"), h("p.lede", h("a", { href: "/" }, "Back to the course map"))));
} else {
  document.title = `${meta.title} · App Anatomy`;
  root.replaceChildren(
    h("header.ch-head",
      h("div.crumbs", h("a", { href: `/#${meta.level.id}` }, `Level ${meta.levelIndex} · ${meta.level.name}`), h("span", "/"), h("span", meta.n)),
      h("h1", meta.title),
      h("p.lede", meta.blurb)),
  );
  try {
    const mod = await import(`../chapters/${id}.js`);
    const body = h("div.ch-body");
    root.append(body);
    mod.default(body, { id });
    progress.mark(id, "visited");
  } catch (e) {
    console.error(e);
    root.append(h("p.callout.warn", "This chapter failed to load. Try reloading the page."));
  }
  const { prev, next } = neighbours(id);
  root.append(h("nav.ch-foot", { "aria-label": "Chapters" },
    prev ? h("a", { href: `/learn?c=${prev.id}` }, h("small", "Previous"), prev.title) : h("span"),
    next ? h("a.next", { href: `/learn?c=${next.id}` }, h("small", "Next"), next.title) : h("a.next", { href: "/" }, h("small", "Finished"), "Back to the course map")));
}
