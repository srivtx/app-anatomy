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
  buildToc();
  const { prev, next } = neighbours(id);
  root.append(h("nav.ch-foot", { "aria-label": "Chapters" },
    prev ? h("a", { href: `/learn?c=${prev.id}` }, h("small", "Previous"), prev.title) : h("span"),
    next ? h("a.next", { href: `/learn?c=${next.id}` }, h("small", "Next"), next.title) : h("a.next", { href: "/" }, h("small", "Finished"), "Back to the course map")));
}

// A thin reading-progress bar and an "on this page" row of chips that tracks the section in view.
function buildToc() {
  const heads = [...root.querySelectorAll("section.block > h2")];
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  const words = (root.textContent || "").split(/\s+/).length;
  const crumbs = root.querySelector(".crumbs");
  if (crumbs) crumbs.append(h("span.read-time", `${Math.max(3, Math.round(words / 220))} min read`));
  if (heads.length >= 3) {
    const chips = heads.map((hd) => {
      hd.id ||= slug(hd.textContent);
      return h("a.toc-chip", { href: `#${hd.id}` }, hd.textContent);
    });
    const bar = h("nav.toc", { "aria-label": "On this page" }, h("span.toc-l", "On this page"), chips);
    root.querySelector(".ch-head")?.after(bar);
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => {
        for (const e of es) if (e.isIntersecting) chips.forEach((c) => c.classList.toggle("on", c.getAttribute("href") === `#${e.target.id}`));
      }, { rootMargin: "-20% 0px -70% 0px" });
      heads.forEach((hd) => io.observe(hd));
    }
  }
  const prog = h("div.read-progress", { "aria-hidden": "true" });
  document.body.append(prog);
  let ticking = false;
  const upd = () => { ticking = false; const max = document.documentElement.scrollHeight - innerHeight; prog.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`; };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(upd); } }, { passive: true });
  upd();
}
