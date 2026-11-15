// Stickers: small voxel badges earned from what you've done. Computed from local progress; nothing is stored.
import { h, progress } from "./core.js";
import * as catalog from "./catalog.js";
import { quizState } from "./prefs.js";
import { voxIcon } from "./voxel.js";

export function badges() {
  const done = progress.read(), qs = quizState.get(), hist = qs.hist || [];
  const LEVELS = catalog.LEVELS;
  const live = LEVELS.flatMap((lv) => lv.chapters.filter((c) => c.live));
  const opened = live.filter((c) => done[c.id]?.visited).length, predicted = live.filter((c) => done[c.id]?.predicted).length;
  const levelsDone = LEVELS.filter((lv) => lv.chapters.some((c) => c.live) && lv.chapters.every((c) => !c.live || done[c.id]?.visited)).length;
  const projects = Object.keys(done).filter((k) => k.startsWith("proj:") && done[k]?.done).length;
  const hasProjects = (catalog.PROJECTS || []).length > 0;
  const list = [
    ["laptop", "First step", "Open your first chapter", opened >= 1],
    ["bars", "Predictor", "Make 5 predictions before running a simulation", predicted >= 5],
    ["chat", "Quizzed", "Finish a quiz or a quick check", hist.length >= 1],
    ["die", "Sharp", "Score 100% on a quiz of 5 or more", hist.some((r) => r.n >= 5 && r.right === r.n)],
    ["trophy", "Passed the mock", "Pass a mock exam", hist.some((r) => r.mock && r.passed)],
    ["books", "Level cleared", "Open every chapter in one level", levelsDone >= 1],
    ["hill", "Halfway", "Open half of all chapters", opened >= live.length / 2],
    hasProjects ? ["gpu", "Builder", "Finish a Colab project", projects >= 1] : ["db", "Regular", "Take 5 quizzes", hist.length >= 5],
    ["rocket", "Whole course", "Open every chapter", opened === live.length && live.length > 0],
  ];
  return list.map(([icon, name, how, got]) => ({ icon, name, how, got: !!got }));
}

/** A row of stickers; locked ones are grey shapes with how to earn them. */
export function stickerRow({ title = true } = {}) {
  const b = badges(), got = b.filter((x) => x.got).length;
  return h("div.stickers",
    title ? h("div.stk-h", h("span", "Stickers"), h("b", `${got} of ${b.length}`)) : null,
    h("div.stk-row", b.map((x) => h(`div.stk${x.got ? ".got" : ""}`, { title: `${x.name}: ${x.got ? "earned" : x.how}`, tabindex: "0" },
      h("div.stk-i", { html: voxIcon(x.icon, x.name) }), h("small", x.name)))));
}
