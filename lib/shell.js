// Loads /chapters/<id>.js for /learn?c=<id> and frames it as a lesson:
// a course sidebar (this level's chapters), a chapter cover, numbered steps,
// an "at a glance" strip and a sticky outline rail.
import { h, progress, rng } from "./core.js";
import { find, neighbours, LEVELS } from "./catalog.js";
import { topbar } from "./topbar.js";
import { flower, mascot, stageOf } from "./pixel.js";
import { chapterCheck } from "./check.js";
import { emblem } from "./voxel.js";

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
      h("div.cover-art", { "aria-hidden": "true", html: emblem(meta.level.id) }), h("div.cover-fl", { "aria-hidden": "true", html: flower(Math.max(1, stageOf(done[id])), id) }), h("i.px-deco", { style: { right: "26px", top: "22px" } })),
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
  if (!root.querySelector(".callout.warn")) root.append(chapterCheck(id, { title: meta.title, kind: "servo" }));
  const { prev, next } = neighbours(id);
  structure(root, rail, next);
  root.append(finishCard(id, next));
  root.append(h("nav.ch-foot", { "aria-label": "Chapters" },
    prev ? h("a", { href: `/learn?c=${prev.id}` }, h("small", "Previous"), prev.title) : h("span"),
    next ? h("a.next", { href: `/learn?c=${next.id}` }, h("small", "Next"), next.title) : h("a.next", { href: "/" }, h("small", "Finished"), "Back to the course map")));
}

/** The end of a chapter: your flower for it, and what to do next. */
function finishCard(id, next) {
  const card = h("section.finish");
  const draw = () => {
    const rec = progress.read()[id], stage = Math.max(2, stageOf(rec));
    card.replaceChildren(
      h("div.finish-fl", { html: flower(stage, id, { label: stage === 3 ? "This chapter's flower, in bloom" : "This chapter's flower, a bud" }) }),
      h("div.finish-t",
        h("div.eyebrow", stage === 3 ? "Chapter done · in bloom" : "Chapter opened · a bud"),
        h("h3", stage === 3 ? "Nice. This chapter's flower bloomed." : "Make a prediction above and this flower blooms."),
        h("p.muted", "Every chapter grows a flower in your garden on the course map. Questions from this chapter also turn up in the quiz."),
        h("div.finish-btns",
          next ? h("a.btn.primary", { href: `/learn?c=${next.id}` }, `Next: ${next.title} →`) : h("a.btn.primary", { href: "/" }, "Back to the course map →"),
          h("a.btn", { href: "/quiz" }, "Quiz yourself"))),
      h("div.finish-m.mascot-wrap", { html: mascot("servo", stage === 3 ? "happy" : "think") }));
  };
  draw();
  document.addEventListener("click", (e) => { if (e.target.closest?.(".predict .opt")) setTimeout(draw, 250); });
  return card;
}

/** The course sidebar: a level switcher and this level's chapters with your progress. */
function sidebar(meta, done) {
  const lv = meta.level;
  const first = (l) => l.chapters.find((c) => c.live)?.id;
  // level header with previous / next level, instead of a dropdown that a sticky sidebar would clip
  const i = meta.levelIndex, near = (k) => (LEVELS[k] && first(LEVELS[k]) ? k : null);
  const prev = near(i - 1), nxt = near(i + 1);
  const menu = h("div.side-head", { style: { "--lc": lcOf(i) } },
    h("div.side-head-t", h("span.badge", String(i)), h("div", h("small", `Level ${i}`), h("b", lv.name.split(":")[0]))),
    h("div.side-nav",
      prev !== null ? h("a", { href: `/learn?c=${first(LEVELS[prev])}`, title: LEVELS[prev].name }, `‹ Level ${prev}`) : h("span"),
      h("a", { href: `/#${lv.id}` }, "map"),
      nxt !== null ? h("a", { href: `/learn?c=${first(LEVELS[nxt])}`, title: LEVELS[nxt].name }, `Level ${nxt} ›`) : h("span")));
  const seen = lv.chapters.filter((c) => done[c.id]?.visited || c.id === meta.id).length;
  return h("aside.lesson-side", { "aria-label": "Chapters in this level" },
    menu,
    h("div.side-l", `Chapters · ${seen} of ${lv.chapters.length} opened`),
    h("ol.side-list", lv.chapters.map((c, j) => {
      const st = done[c.id]?.predicted ? "done" : done[c.id]?.visited || c.id === meta.id ? "seen" : "";
      const stage = c.id === meta.id ? Math.max(1, stageOf(done[c.id])) : stageOf(done[c.id]);
      const inner = [h("span.side-n", `${meta.levelIndex}.${j + 1}`), h("span.side-t", c.title), stage ? h("span.side-fl", { title: ["", "here", "opened", "done: prediction made"][stage], html: flower(stage, c.id) }) : h("span.side-dot", { title: "not started" })];
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

