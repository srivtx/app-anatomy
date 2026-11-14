import { h } from "./core.js";

export function topbar(el) {
  el.replaceChildren(
    h("a.brand", { href: "/" , html: '<svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)"/><path d="M9 22V10h5l4 6 4-6v12" fill="none" stroke="var(--accent-ink)" stroke-width="2.4" stroke-linejoin="round"/></svg><span>App Anatomy</span>' }),
    h("nav.topnav", { "aria-label": "Site" }, h("a", { href: "/#ladder" }, "Course map"), h("a", { href: "/learn?c=app-types" }, "App atlas")),
  );
}
