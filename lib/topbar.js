import { h } from "./core.js";
import { logo } from "./pixel.js";

const GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

/** Questions in the review deck that are due now, read straight from storage. */
function dueCount() {
  try { const d = JSON.parse(localStorage.getItem("app-anatomy:quiz") || "{}").deck || {}; const now = Date.now(); return Object.values(d).filter((c) => c.due <= now).length; } catch { return 0; }
}

export function topbar(el) {
  const due = dueCount(), here = location.pathname;
  const link = (href, text, extra) => h("a", { href, "aria-current": here === href ? "page" : null }, text, extra);
  el.replaceChildren(
    h("a.brand", { href: "/", html: `${logo("servo")}<span>App Anatomy</span>` }),
    h("nav.topnav", { "aria-label": "Site" }, link("/#ladder", "Course map"), h("a", { href: "/learn?c=app-types" }, "App atlas"),
      link("/quiz", "Quiz", due ? h("span.nav-badge", { title: `${due} due for review` }, String(due)) : null),
      h("a.nav-icon", { href: "/settings", title: "Settings", "aria-label": "Settings", "aria-current": here === "/settings" ? "page" : null, html: GEAR })),
  );
}
