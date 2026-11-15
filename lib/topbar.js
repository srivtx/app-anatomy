import { h } from "./core.js";
import { logo, flower } from "./pixel.js";

const GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

/** Questions in the review deck that are due now, read straight from storage. */
function dueCount() {
  try { const d = JSON.parse(localStorage.getItem("app-anatomy:quiz") || "{}").deck || {}; const now = Date.now(); return Object.values(d).filter((c) => c.due <= now).length; } catch { return 0; }
}

export function topbar(el) {
  const due = dueCount(), here = location.pathname;
  const SHORT = { "Course map": "Map", "Colab roadmap": "Colab", "App atlas": "Atlas" };
  const link = (href, text, extra) => h("a", { href, "aria-current": here === href ? "page" : null },
    SHORT[text] ? [h("span.l-long", text), h("span.l-short", { "aria-hidden": "true" }, SHORT[text])] : text, extra);
  el.replaceChildren(
    h("a.brand", { href: "/", html: `${logo("servo")}<span>App Anatomy</span>` }),
    h("nav.topnav", { "aria-label": "Site" }, link("/#ladder", "Course map"), link("/learn?c=app-types", "App atlas"),
      link("/quiz", "Quiz", due ? h("span.nav-badge", { title: `${due} due for review` }, String(due)) : null),
      h("a.nav-icon", { href: "/settings", title: "Settings", "aria-label": "Settings", "aria-current": here === "/settings" ? "page" : null, html: GEAR })),
  );
  garnishFooter(el);
  reveal();
}

/** The footer: a strip of pixel garden, the site's links again, and the original note. */
function garnishFooter(top) {
  const foot = document.querySelector("footer.site .wrap");
  if (!foot || foot.dataset.done) return;
  foot.dataset.done = "1";
  const note = foot.textContent.trim();
  const links = [...top.querySelectorAll(".topnav a")].map((a) => h("a", { href: a.getAttribute("href") }, a.getAttribute("aria-label") || (a.querySelector(".l-long") || a).textContent.replace(/\d+$/, "").trim()));
  const seeds = ["a", "bb", "ccc", "dd", "e", "fff", "gg", "h", "ii", "jjj", "k", "ll"];
  foot.replaceChildren(
    h("div.foot-garden", { "aria-hidden": "true" }, seeds.map((sd, i) => h("span", { style: { "--lc": `var(--c${(i % 6) + 1})` }, html: flower(i % 4 === 3 ? 2 : 3, sd) }))),
    h("div.foot-row",
      h("a.brand", { href: "/", html: top.querySelector(".brand")?.innerHTML || "" }),
      h("nav.foot-links", { "aria-label": "Footer" }, links)),
    h("p.foot-note", note));
}

/** Sections and cards below the fold rise in gently as they scroll into view. Off with reduced motion. */
function reveal() {
  if (!("IntersectionObserver" in window) || document.documentElement.dataset.motion === "reduce" || matchMedia("(prefers-reduced-motion: reduce)").matches && document.documentElement.dataset.motion !== "full") return;
  const SEL = "section.block, .ex-card, .rm-card, .rm-step, .bench, .finish, .ck-q, .qz-kinds > *, .set-card";
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -6% 0px" });
  const seen = new WeakSet();
  const scan = (root) => root.querySelectorAll?.(SEL).forEach((el) => {
    if (seen.has(el)) return; seen.add(el);
    if (el.getBoundingClientRect().top < innerHeight) return;           // already on screen: leave it be
    el.classList.add("rv"); io.observe(el);
  });
  scan(document);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && !(n instanceof SVGElement) && n.tagName !== "CANVAS") { if (n.matches?.(SEL)) scan(n.parentElement || document); else scan(n); } }))).observe(document.body, { childList: true, subtree: true });
}
