// Settings for this course: how it looks, how it moves, quiz defaults, and your saved progress.
import { h, progress } from "./core.js";
import { ALL } from "./catalog.js";
import { topbar } from "./topbar.js";
import { prefs, quizState, resetAll, exportAll, importAll, PREF_DEFAULTS } from "./prefs.js";
import { mascot, flower, can, cash } from "./pixel.js";
import { stickerRow } from "./badges.js";

topbar(document.getElementById("top"));
const main = document.getElementById("settings");
const SITE = document.title.split("·").pop().trim();

function choice(label, hint, key, options) {
  const cur = prefs.get()[key];
  return h("div.set-row",
    h("div.set-l", h("b", label), hint ? h("span", hint) : null),
    h("div.seg.set-seg", { role: "group", "aria-label": label }, options.map(([v, text]) =>
      h("button", { type: "button", "aria-pressed": String(cur === v), onclick: () => { prefs.set({ [key]: v }); draw(); } }, text))));
}

function draw() {
  const done = progress.read(), live = ALL.filter((c) => c.live);
  const opened = live.filter((c) => done[c.id]?.visited).length, predicted = live.filter((c) => done[c.id]?.predicted).length;
  const qs = quizState.get(), quizzes = (qs.hist || []).length, deck = Object.keys(qs.deck || {}).length;
  const file = h("input", { type: "file", accept: "application/json", hidden: true, onchange: async (e) => {
    try { importAll(JSON.parse(await e.target.files[0].text())); prefs.set({}); draw(); alert("Progress imported."); } catch { alert("That file isn't a progress export from this site."); }
  } });
  main.replaceChildren(h("div.set",
    h("header.qz-head.set-head", h("div", h("div.eyebrow", `Settings · ${SITE}`), h("h1", "Make it yours"), h("p.lede", "Everything here is saved in this browser only, for this course. Nothing is sent anywhere.")),
      h("div.mascot-wrap.set-mascot", { html: mascot(SITE.includes("App") ? "servo" : "neuro", "happy") })),
    h("section.set-card", h("h2", "Appearance"),
      choice("Theme", "System follows your device", "theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]]),
      choice("Text size", "Scales the whole page, simulations included", "size", [[0.9, "Smaller"], [1, "Default"], [1.1, "Larger"], [1.2, "Largest"]]),
      choice("Motion", "Reduced stops decorative animation; simulations still run when you press play", "motion", [["system", "System"], ["full", "Full"], ["reduce", "Reduced"]])),
    h("section.set-card", h("h2", "Quiz defaults"),
      choice("Questions per quiz", null, "quizCount", [[5, "5"], [10, "10"], [20, "20"], [40, "40"]]),
      choice("Show answers", null, "quizMarks", [["end", "At the end"], ["each", "After each one"]]),
      h("p.muted", h("a", { href: "/quiz" }, "Open the quiz →"))),
    h("section.set-card", h("h2", "Your progress"),
      h("div.set-stats", [[opened, `of ${live.length} chapters opened`], [predicted, "chapters with a prediction made"], [quizzes, quizzes === 1 ? "quiz taken" : "quizzes taken"], [deck, "questions in your review deck"]]
        .map(([n, l], k) => h("div.set-stat", h("div.set-ico", { html: [flower(2, "settings"), flower(3, "bloom"), can("#ff7eb6"), can("#7cc4ff")][k] }), h("b", String(n)), h("span", l)))),
      stickerRow(),
      h("div.set-btns",
        h("button.btn", { type: "button", onclick: () => {
          const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: "application/json" });
          const a = h("a", { href: URL.createObjectURL(blob), download: `${SITE.toLowerCase().replace(/\s+/g, "-")}-progress.json` }); document.body.append(a); a.click(); a.remove();
        } }, "Download my progress"),
        h("button.btn", { type: "button", onclick: () => file.click() }, "Import a file"), file,
        h("button.btn.danger", { type: "button", onclick: () => { if (confirm("Delete all progress, quiz history and settings for this course on this device?")) { resetAll(); prefs.set(PREF_DEFAULTS); draw(); } } }, "Reset everything"))),
  ));
}
draw();
