// The course map as an explorer: levels grouped into acts on the left, one level's chapters on the right.
// Keeps every chapter one click away without a page that scrolls forever. /#<level-id> opens that level.
import { h } from "./core.js";
import { flower, stageOf } from "./pixel.js";

const lcOf = (i) => `var(--c${(i % 6) + 1})`;

export function explorer(el, { levels, done, acts, title }) {
  const liveOf = (lv) => lv.chapters.filter((c) => c.live);
  const openedOf = (lv) => liveOf(lv).filter((c) => done[c.id]?.visited).length;
  const levelStage = (lv) => { const l = liveOf(lv), o = openedOf(lv), p = l.filter((c) => done[c.id]?.predicted).length; return !o ? 0 : o === l.length && p ? 3 : o / l.length >= 0.5 ? 2 : 1; };
  const actOf = (i) => acts.find((a) => a.levels.includes(i));
  const fromHash = () => levels.findIndex((lv) => `#${lv.id}` === location.hash);
  let cur = fromHash();
  if (cur < 0) { cur = levels.findIndex((lv) => openedOf(lv) < liveOf(lv).length); if (cur < 0) cur = 0; }

  const rows = levels.map((lv, i) => h("a.ex-lv", { href: `#${lv.id}`, style: { "--lc": lcOf(i) }, onclick: (e) => { e.preventDefault(); select(i, true); } },
    h("span.ex-fl", { html: flower(levelStage(lv), lv.id) }),
    h("span.ex-b", String(i)),
    h("span.ex-name", h("b", lv.name.split(":")[0]), h("small", `${liveOf(lv).length} chapters${openedOf(lv) ? ` · ${openedOf(lv)} opened` : ""}`)),
    h("span.ex-bar", h("i", { style: { width: `${(openedOf(lv) / Math.max(1, liveOf(lv).length)) * 100}%` } }))));
  const list = h("nav.ex-list", { "aria-label": "Levels" }, acts.map((a) => [h("div.ex-act", h("span", a.name), h("small", a.blurb)), a.levels.map((i) => rows[i])]));
  const panel = h("div.ex-panel", { "aria-live": "polite" });
  const total = levels.reduce((n, lv) => n + liveOf(lv).length, 0);
  el.replaceChildren(
    h("div.ex-h", h("div", h("div.eyebrow", "The course map"), h("h2", title || `${levels.length} levels, ${total} chapters`)),
      h("p.muted", "Pick a level to see its chapters. Each one grows a flower as you open its chapters and make predictions.")),
    h("div.ex-body", list, panel));

  function select(i, user) {
    cur = i;
    rows.forEach((r, k) => { r.classList.toggle("on", k === i); r.setAttribute("aria-current", k === i ? "true" : "false"); });
    const lv = levels[i], live = liveOf(lv), o = openedOf(lv), a = actOf(i);
    const next = live.find((c) => !done[c.id]?.visited) || live[0];
    panel.style.setProperty("--lc", lcOf(i));
    panel.replaceChildren(
      h("div.ex-ph",
        h("div.ex-ph-t",
          h("div.eyebrow", `Level ${i}${a ? ` · ${a.name}` : ""}`),
          h("h3", lv.name),
          h("p", lv.tagline),
          h("div.ex-prog", h("span.ex-bar.big", h("i", { style: { width: `${(o / Math.max(1, live.length)) * 100}%` } })), h("small", `${o} of ${live.length} opened`)),
          next ? h("a.btn.primary", { href: `/learn?c=${next.id}` }, o ? `Continue: ${next.title} →` : `Start level ${i} →`) : null),
        h("div.ex-ph-fl", { html: flower(Math.max(1, levelStage(lv)), lv.id) })),
      h("div.ex-cards", lv.chapters.map((c, j) => {
        const st = stageOf(done[c.id]);
        const inner = [
          h("div.ex-ct", h("span.ex-n", `${i}.${j + 1}`), h("span.ex-cfl", { html: flower(c.live ? st : 0, c.id) })),
          h("b", c.title), h("p", c.blurb),
          h("span.ex-st", !c.live ? "coming soon" : st === 3 ? "✓ done" : st === 2 ? "opened" : "start →")];
        return c.live ? h(`a.ex-card${st === 3 ? ".done" : st === 2 ? ".seen" : ""}`, { href: `/learn?c=${c.id}` }, ...inner) : h("div.ex-card.soon", ...inner);
      })));
    if (user) {
      history.replaceState(null, "", `#${lv.id}`);
      if (matchMedia("(max-width: 900px)").matches) panel.scrollIntoView({ behavior: "smooth", block: "start" });
      rows[i].scrollIntoView({ block: "nearest", inline: "center" });
    }
  }
  select(cur, false);
  addEventListener("hashchange", () => { const i = fromHash(); if (i >= 0) { select(i, false); el.scrollIntoView({ block: "start" }); } });
  if (fromHash() >= 0) requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
  return { select };
}
