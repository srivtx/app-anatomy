// Loads /chapters/<id>.js for /learn?c=<id> and frames it as a lesson:
// a course sidebar (this level's chapters), a chapter cover, numbered steps,
// an "at a glance" strip and a sticky outline rail.
import { h, progress, rng } from "./core.js";
import { find, neighbours, LEVELS } from "./catalog.js";
import { topbar } from "./topbar.js";

topbar(document.getElementById("top"));
const main = document.getElementById("chapter");
document.body.classList.add("is-lesson");
const id = new URLSearchParams(location.search).get("c") || "";
const meta = find(id);
const lcOf = (i) => `var(--c${(i % 6) + 1})`;

if (!meta || !meta.live || !/^[a-z0-9-]+$/.test(id)) {
  main.replaceChildren(h("div.ch-head", h("h1", "Chapter not found"), h("p.lede", h("a", { href: "/" }, "Back to the course map"))));
} else {
  document.title = `${meta.title} · App Anatomy`;
  const done = progress.read();
  const lc = lcOf(meta.levelIndex);
  main.classList.replace("wrap", "lesson");
  main.style.setProperty("--lc", lc);
  const root = h("div.lesson-col");
  const rail = h("aside.lesson-rail", { "aria-label": "Chapter outline" });
  main.replaceChildren(sidebar(meta, done), root, rail);

  const chIndex = meta.level.chapters.findIndex((c) => c.id === id);
  root.append(
    h("header.ch-head.ch-cover",
      h("div.cover-text",
        h("div.crumbs", h("a", { href: `/#${meta.level.id}` }, `Level ${meta.levelIndex} · ${meta.level.name.split(":")[0]}`), h("span", `Chapter ${meta.n}`)),
        h("h1", meta.title),
        h("p.lede", meta.blurb),
        h("div.cover-chips", { id: "cover-chips" },
          h("span.cchip", `${chIndex + 1} of ${meta.level.chapters.length} in this level`),
          done[id]?.predicted ? h("span.cchip.ok", "✓ done before") : done[id]?.visited ? h("span.cchip", "opened before") : h("span.cchip.new", "new to you"))),
      h("div.cover-art", { "aria-hidden": "true", html: motif(id) })),
  );
  const loading = h("div.ch-loading", { role: "status" }, h("span.spinner"), "Loading the simulation…");
  root.append(loading);
  try {
    const mod = await import(`../chapters/${id}.js`);
    // let the header and spinner paint before a chapter does heavy setup work
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const body = h("div.ch-body");
    root.append(body);
    mod.default(body, { id });
    loading.remove();
    progress.mark(id, "visited");
  } catch (e) {
    console.error(e);
    loading.remove();
    root.append(h("p.callout.warn", "This chapter failed to load. Try reloading the page."));
  }
  const { prev, next } = neighbours(id);
  structure(root, rail, next);
  root.append(h("nav.ch-foot", { "aria-label": "Chapters" },
    prev ? h("a", { href: `/learn?c=${prev.id}` }, h("small", "Previous"), prev.title) : h("span"),
    next ? h("a.next", { href: `/learn?c=${next.id}` }, h("small", "Next"), next.title) : h("a.next", { href: "/" }, h("small", "Finished"), "Back to the course map")));
}

/** The course sidebar: a level switcher and this level's chapters with your progress. */
function sidebar(meta, done) {
  const lv = meta.level;
  const first = (l) => l.chapters.find((c) => c.live)?.id;
  const menu = h("details.side-switch",
    h("summary", h("span.badge", { style: { "--lc": lcOf(meta.levelIndex) } }, String(meta.levelIndex)), h("span.side-lv", lv.name.split(":")[0]), h("span.side-sw", "switch")),
    h("div.side-menu", LEVELS.map((l, i) => first(l) ? h("a", { href: `/learn?c=${first(l)}`, class: i === meta.levelIndex ? "on" : "", style: { "--lc": lcOf(i) } }, h("i"), `${i} · ${l.name.split(":")[0]}`) : null)));
  const seen = lv.chapters.filter((c) => done[c.id]?.visited || c.id === meta.id).length;
  return h("aside.lesson-side", { "aria-label": "Chapters in this level" },
    menu,
    h("div.side-l", `Chapters · ${seen} of ${lv.chapters.length} opened`),
    h("ol.side-list", lv.chapters.map((c, j) => {
      const st = done[c.id]?.predicted ? "done" : done[c.id]?.visited || c.id === meta.id ? "seen" : "";
      const inner = [h("span.side-n", `${meta.levelIndex}.${j + 1}`), h("span.side-t", c.title), h(`span.side-st.${st || "none"}`, { "aria-label": st || "not started" })];
      return h("li", c.live ? h("a", { href: `/learn?c=${c.id}`, class: c.id === meta.id ? "on" : "", "aria-current": c.id === meta.id ? "page" : null }, ...inner) : h("span.soon", ...inner));
    })),
    h("div.side-links", h("a", { href: "/#ladder" }, "All levels"), h("a", { href: "/learn?c=app-types" }, "App atlas"), h("a", { href: "/quiz" }, "Quiz yourself")));
}

/** Number the sections as steps, add an at-a-glance strip, the outline rail and reading progress. */
function structure(root, rail, next) {
  const blocks = [...root.querySelectorAll("section.block")].filter((s) => s.querySelector(":scope > h2"));
  const heads = blocks.map((s) => s.querySelector(":scope > h2"));
  const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  heads.forEach((hd, i) => {
    hd.id ||= slug(hd.textContent);
    hd.before(h("div.step-l", h("span", `Step ${i + 1}`), ` of ${heads.length}`));
  });
  const words = (root.textContent || "").split(/\s+/).length;
  const mins = Math.max(3, Math.round(words / 220));
  root.querySelector("#cover-chips")?.prepend(h("span.cchip", `≈ ${mins} min`), h("span.cchip", `${heads.length} steps`));
  // what's in this chapter, counted from the page itself
  const count = (sel) => root.querySelectorAll(sel).length;
  const glance = [
    [count(".stage"), "simulation", "simulations to poke"],
    [count(".predict"), "prediction", "predictions to make"],
    [count("pre.code"), "code panel", "code panels"],
    [count("table"), "table", "tables"],
    [count(".dilemma"), "design trade-off", "design trade-offs"],
  ].filter(([n]) => n > 0);
  if (glance.length) root.querySelector(".ch-cover")?.after(h("div.glance", h("div.glance-l", "In this chapter"),
    h("div.glance-row", glance.map(([n, one, many]) => h("div.glance-i", h("b", String(n)), h("span", n === 1 ? one : many))))));
  // horizontal chips for narrow screens, the rail for wide ones
  if (heads.length >= 3) {
    const chips = heads.map((hd) => h("a.toc-chip", { href: `#${hd.id}` }, hd.textContent));
    (root.querySelector(".glance") || root.querySelector(".ch-cover"))?.after(h("nav.toc", { "aria-label": "On this page" }, h("span.toc-l", "On this page"), chips));
    const items = heads.map((hd, i) => h("li", h("a", { href: `#${hd.id}` }, h("span.rail-dot"), h("span", hd.textContent))));
    const meter = h("div.rail-meter", h("i"));
    const readout = h("div.rail-read", `0 of ${heads.length} read`);
    rail.append(h("div.rail-in",
      h("div.side-l", "Outline"),
      h("ol.rail-list", items), meter, readout,
      next ? h("a.rail-next", { href: `/learn?c=${next.id}` }, h("small", "Up next"), next.title) : null));
    if ("IntersectionObserver" in window) {
      let active = -1;
      const setActive = (i) => {
        active = i;
        items.forEach((li, j) => { li.classList.toggle("on", j === i); li.classList.toggle("past", j < i); });
        chips.forEach((c, j) => c.classList.toggle("on", j === i));
        meter.firstChild.style.width = `${((i + 1) / heads.length) * 100}%`;
        readout.textContent = `${i + 1} of ${heads.length} steps`;
      };
      const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) setActive(heads.indexOf(e.target)); }, { rootMargin: "-20% 0px -70% 0px" });
      heads.forEach((hd) => io.observe(hd));
      if (active < 0) setActive(0);
    }
  }
  const prog = h("div.read-progress", { "aria-hidden": "true" });
  document.body.append(prog);
  let ticking = false;
  const upd = () => { ticking = false; const max = document.documentElement.scrollHeight - innerHeight; prog.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`; };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(upd); } }, { passive: true });
  upd();
}

/** A small system diagram, different for every chapter: its cover art. */
function motif(seedText) {
  let s = 0; for (const ch of seedText) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  const r = rng(s || 1), W = 260, H = 190;
  const cols = 3 + Math.floor(r() * 2), boxes = [];
  for (let c = 0; c < cols; c++) {
    const n = c === 0 ? 1 : 1 + Math.floor(r() * 3), x = 14 + (c * (W - 62)) / (cols - 1);
    for (let i = 0; i < n; i++) boxes.push({ c, x, y: H / 2 + (i - (n - 1) / 2) * 52 - 15, w: 48, hh: 30, on: r() < 0.4, db: c === cols - 1 && r() < 0.6 });
  }
  let wires = "", shapes = "", dots = "";
  for (const a of boxes) for (const b of boxes) if (b.c === a.c + 1 && r() < 0.75) {
    const x1 = a.x + a.w, y1 = a.y + a.hh / 2, x2 = b.x, y2 = b.y + b.hh / 2, mx = (x1 + x2) / 2;
    wires += `<path d="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/>`;
    if (r() < 0.5) dots += `<circle r="3"><animateMotion dur="${(2 + r() * 2).toFixed(1)}s" repeatCount="indefinite" path="M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}"/></circle>`;
  }
  for (const b of boxes) shapes += b.db
    ? `<g class="${b.on ? "on" : ""}"><path d="M${b.x} ${b.y + 5} v${b.hh - 10} a${b.w / 2} 5 0 0 0 ${b.w} 0 v-${b.hh - 10}"/><ellipse cx="${b.x + b.w / 2}" cy="${b.y + 5}" rx="${b.w / 2}" ry="5"/></g>`
    : `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.hh}" rx="7" class="${b.on ? "on" : ""}"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%"><g class="m-edges" fill="none" stroke-width="1.6" opacity=".7">${wires}</g><g class="m-boxes">${shapes}</g><g class="m-dots">${dots}</g></svg>`;
}
