// The quiz: a setup sentence with clickable words, one question at a time, then results with your
// weakest levels first. Every miss joins a review deck and comes back after 1, 3, 7, 16 and 35 days.
import { h, progress } from "./core.js";
import { LEVELS, ALL } from "./catalog.js";
import { topbar } from "./topbar.js";
import { prefs, quizState, INTERVALS } from "./prefs.js";
import { BANK } from "./quizbank.js";
import { mascot, trophy, can, burst } from "./pixel.js";
import { emblem } from "./voxel.js";

topbar(document.getElementById("top"));
const main = document.getElementById("quiz");
const byId = new Map(ALL.map((c) => [c.id, c]));
const lcOf = (i) => `var(--c${(i % 6) + 1})`;
const KINDS = {
  predict: ["predictions", "Predict first", "The questions from inside the chapters: what will the simulation do, and why?"],
  where: ["which chapter?", "Which chapter?", "A chapter's one-line pitch. Name the chapter."],
  settled: ["settled or open?", "Settled or open?", "A claim from the course. Did a big published run settle it, or is it still unknown?"],
  field: ["from the field", "From the field", "Something practitioners do. Does it usually work, or is it a trap?"],
};
const present = Object.keys(KINDS).filter((k) => BANK.some((q) => q.kind === k));
const MIX = { predict: 0.45, where: 0.2, settled: 0.2, field: 0.15 };
const COUNTS = [5, 10, 20, 40];
const MARKS = [["end", "at the end"], ["each", "after each one"]];
const PACES = [[0, "no clock"], [90, "90 s a question"], [60, "60 s a question"], [30, "30 s a question"]];
const MOCK = { count: 20, mode: "mixed", marks: "end", pace: 60, mock: true, pass: 0.7 };
const KIND_SITE = document.title.includes("App") ? "servo" : "neuro";

function scopes() {
  const done = progress.read();
  const opened = Object.keys(done).filter((id) => done[id]?.visited && byId.has(id));
  const list = [{ key: "all", label: "every level", ids: null }];
  if (opened.length) list.push({ key: "opened", label: "chapters you've opened", ids: new Set(opened) });
  LEVELS.forEach((lv, i) => list.push({ key: `lv${i}`, label: `level ${i}: ${lv.name.split(":")[0].toLowerCase()}`, ids: new Set(lv.chapters.map((c) => c.id)) }));
  return list;
}
const pool = (scope, mode) => BANK.filter((q) => (!scope.ids || scope.ids.has(q.ch)) && (mode === "mixed" || q.kind === mode));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Pick n questions: due reviews first, then a mix across kinds and chapters. */
function pick(scope, mode, n) {
  const st = quizState.get(), due = new Set(quizState.due(st));
  const all = pool(scope, mode), back = shuffle(all.filter((q) => due.has(q.id))).slice(0, Math.ceil(n * 0.3));
  const rest = shuffle(all.filter((q) => !due.has(q.id)));
  const out = [...back];
  if (mode === "mixed") {
    for (const k of present) { const want = Math.round((n - back.length) * MIX[k]); out.push(...rest.filter((q) => q.kind === k).slice(0, want)); }
  }
  for (const q of rest) { if (out.length >= n) break; if (!out.includes(q)) out.push(q); }
  return shuffle(out.slice(0, n));
}

// ---------------------------------------------------------------------------------------------
function pageSetup() {
  const st = quizState.get(), p = prefs.get(), sc = scopes();
  const setup = { count: p.quizCount, scope: "all", mode: "mixed", marks: p.quizMarks, pace: 0, ...(st.setup || {}) };
  delete setup.mock;
  if (!sc.some((s) => s.key === setup.scope)) setup.scope = "all";
  const cycle = (list, cur, back) => list[(list.indexOf(cur) + (back ? list.length - 1 : 1)) % list.length];
  const word = (text, onPick, title) => h("button.qz-word", { type: "button", title, onclick: (e) => onPick(e.shiftKey) }, text);
  const sentence = h("p.qz-sentence"), info = h("p.qz-info");
  const modes = ["mixed", ...present];
  const save = () => { const s = quizState.get(); s.setup = setup; quizState.save(s); draw(); };
  function draw() {
    const scope = sc.find((s) => s.key === setup.scope), have = pool(scope, setup.mode).length;
    sentence.replaceChildren(...["Give me ",
      word(String(setup.count), (b) => { setup.count = cycle(COUNTS, setup.count, b); save(); }, "How many questions (shift-click to go back)"),
      setup.mode === "mixed" ? " questions from " : " ", setup.mode === "mixed" ? null : word(KINDS[setup.mode][0], (b) => { setup.mode = cycle(modes, setup.mode, b); save(); }, "What kind of questions"),
      setup.mode === "mixed" ? null : " from ",
      word(scope.label, (b) => { setup.scope = cycle(sc.map((s) => s.key), setup.scope, b); save(); }, "Which chapters"),
      ", ", setup.mode === "mixed" ? word("mixed", (b) => { setup.mode = cycle(modes, setup.mode, b); save(); }, "What kind of questions") : null, setup.mode === "mixed" ? ", " : "",
      "marked ", word(MARKS.find((m) => m[0] === setup.marks)[1], (b) => { setup.marks = cycle(MARKS.map((m) => m[0]), setup.marks, b); save(); }, "When you see the answers"),
      ", with ", word((PACES.find((x) => x[0] === setup.pace) || PACES[0])[1], (b) => { setup.pace = cycle(PACES.map((x) => x[0]), setup.pace, b); save(); }, "A clock, or none"), "."].filter((x) => x != null && x !== ""));
    const due = quizState.due(quizState.get()).length;
    info.replaceChildren(...[
      h("span", `${have} questions in this scope`), have < setup.count ? h("b", ` · the quiz will be ${have} long`) : null,
      h("span", ` · ${due} due for review`)].filter(Boolean));
    startBtn.disabled = !have;
  }
  const startBtn = h("button.btn.primary.qz-go", { type: "button", onclick: () => run(pick(sc.find((s) => s.key === setup.scope), setup.mode, setup.count), setup) }, "Start the quiz →");
  draw();
  const s = quizState.get(), dueIds = quizState.due(s), deckN = Object.keys(s.deck).length;
  const hist = (s.hist || []).slice(-6).reverse();
  main.replaceChildren(h("div.qz",
    h("header.qz-head", h("div.eyebrow", "Quiz yourself"), h("h1", "Check what stuck"),
      h("p.lede", `${BANK.length} questions from every chapter. Misses come back for review after ${INTERVALS.join(", ")} days, until you get them right each time.`)),
    h("div.qz-setup", h("div.mascot-wrap.qz-mascot", h("div.bubble.left", "Pick the words. I'll pick the questions."), h("div", { html: mascot(KIND_SITE, "think") })),
      h("div.qz-l", "Practice · click any underlined word to change it"), sentence, info,
      h("div.qz-btns", startBtn, dueIds.length ? h("button.btn", { type: "button", onclick: () => run(shuffle(BANK.filter((q) => dueIds.includes(q.id))).slice(0, 20), { ...setup, scope: "review" }) }, `Review ${Math.min(20, dueIds.length)} due now`) : null)),
    h("div.qz-mockcard",
      h("div.qz-trophy", { html: trophy() }),
      h("div", h("div.qz-l", "Mock exam"), h("h2", "Sit it like the real thing"),
        h("p.muted", `${MOCK.count} mixed questions from every level · ${Math.round((MOCK.count * MOCK.pace) / 60)} minutes on the clock · answers only at the end · ${Math.round(MOCK.pass * 100)}% to pass.`),
        h("button.btn.primary", { type: "button", onclick: () => run(pick(sc[0], "mixed", MOCK.count), { ...MOCK, scope: "all" }) }, "Start the mock exam →"))),
    h("div.qz-cols",
      h("div.qz-kinds", h("div.qz-l", "Kinds of question"), present.map((k) => h("div.qz-kind", h("b", KINDS[k][1]), h("span", KINDS[k][2]), h("small", `${BANK.filter((q) => q.kind === k).length} in the bank`)))),
      h("div.qz-side",
        h("div.qz-deck", h("div.qz-l", "Review deck"), h("div.qz-big", h("b", String(deckN)), h("span", deckN === 1 ? "question waiting" : "questions waiting")),
          h("div.qz-steps", INTERVALS.map((d, i) => h("div", { title: `${d} days` }, h("i", { style: { height: `${8 + 40 * (Object.values(s.deck).filter((c) => c.step === i).length / Math.max(1, deckN))}px` } }), h("small", `${d}d`)))),
          h("p.muted", dueIds.length ? `${dueIds.length} due now.` : deckN ? "Nothing due right now." : "Empty. Every question you miss lands here.")),
        hist.length ? h("div.qz-hist", h("div.qz-l", "Your last quizzes"), h("table", hist.map((r) => h("tr",
          h("td", new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })), h("td", h("b", `${r.right} / ${r.n}`)), h("td.muted", r.mock ? h(`span.qz-pill.${r.passed ? "ok" : "no"}`, r.passed ? "mock · passed" : "mock") : r.scope))))) : null))));
}

// ---------------------------------------------------------------------------------------------
function run(qs, setup) {
  if (!qs.length) return;
  const answers = new Array(qs.length).fill(null), t0 = Date.now();
  let i = 0, revealed = false, over = false;
  const endAt = setup.pace ? t0 + qs.length * setup.pace * 1000 : 0;
  const clockText = () => { const left = Math.max(0, Math.round((endAt - Date.now()) / 1000)); return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`; };
  const timer = endAt ? setInterval(() => {
    const el = main.querySelector(".qz-clock"); if (el) { el.textContent = clockText(); el.classList.toggle("low", endAt - Date.now() < 60000); }
    if (Date.now() >= endAt && !over) results(true);
  }, 500) : 0;
  const each = setup.marks === "each";
  const scopeLabel = setup.scope === "review" ? "review" : (scopes().find((s) => s.key === setup.scope)?.label || "every level");
  function show() {
    const q = qs[i], c = byId.get(q.ch), done = answers[i] != null;
    const showSource = q.kind !== "where" || (each && revealed);
    const opts = q.options.map((o, k) => {
      const cls = revealed ? (k === q.answer ? "right" : k === answers[i] ? "wrong" : "") : k === answers[i] ? "sel" : "";
      return h(`button.qz-opt${cls ? "." + cls : ""}`, { type: "button", disabled: revealed || null, onclick: () => choose(k) }, h("span.qz-k", String.fromCharCode(65 + k)), h("span", o));
    });
    main.replaceChildren(h("div.qz.qz-run", { style: { "--lc": c ? lcOf(c.levelIndex) : "var(--accent)" } },
      h("div.qz-top", h("span", setup.mock ? `Mock exam · question ${i + 1} of ${qs.length}` : `Question ${i + 1} of ${qs.length}`), endAt ? h("span.qz-clock", clockText()) : null, h("button.btn.small", { type: "button", onclick: () => { if (confirm("Stop this quiz? Your answers so far won't be saved.")) { over = true; clearInterval(timer); pageSetup(); } } }, "Stop")),
      h("div.qz-meter", h("i", { style: { width: `${((i + (done ? 1 : 0)) / qs.length) * 100}%` } })),
      h("div.qz-card",
        c && LEVELS[c.levelIndex] ? h("div.qz-emb", { "aria-hidden": "true", html: emblem(LEVELS[c.levelIndex].id) }) : null,
        h("div.qz-tags", h("span.qz-tag", KINDS[q.kind][1]), showSource && c ? h("span.qz-tag.src", `${c.n} · ${c.title}`) : null),
        h("p.qz-q", q.q),
        h("div.qz-opts", opts),
        revealed ? h(`div.qz-explain.${answers[i] === q.answer ? "ok" : "no"}`, h("b", answers[i] === q.answer ? "Right." : "Not quite."), h("div", { html: q.explain })) : null),
      h("div.qz-nav",
        i > 0 && !each ? h("button.btn", { type: "button", onclick: () => { i--; show(); } }, "← Back") : h("span"),
        each && !revealed ? h("button.btn.primary", { type: "button", disabled: !done || null, onclick: () => { reveal(); } }, "Check") :
          h("button.btn.primary", { type: "button", disabled: !done || null, onclick: next }, i === qs.length - 1 ? "See results →" : "Next →"))));
  }
  function choose(k) { if (revealed) return; answers[i] = k; show(); }
  function reveal() { revealed = true; show(); if (answers[i] === qs[i].answer) burst(main.querySelector(".qz-opt.right")); }
  function next() { revealed = false; if (i < qs.length - 1) { i++; show(); } else results(); }
  function results(timeUp = false) {
    if (over) return; over = true; clearInterval(timer);
    const right = qs.filter((q, k) => answers[k] === q.answer).length, secs = Math.round((Date.now() - t0) / 1000);
    const st = quizState.get();
    qs.forEach((q, k) => quizState.grade(st, q.id, answers[k] === q.answer));
    const passed = setup.mock ? right / qs.length >= (setup.pass || 0.7) : null;
    st.hist = [...(st.hist || []), { at: Date.now(), n: qs.length, right, secs, scope: scopeLabel, mock: !!setup.mock, passed }].slice(-50);
    quizState.save(st);
    // by level, weakest first
    const lv = new Map();
    qs.forEach((q, k) => { const c = byId.get(q.ch); if (!c) return; const e = lv.get(c.levelIndex) || { n: 0, r: 0 }; e.n++; if (answers[k] === q.answer) e.r++; lv.set(c.levelIndex, e); });
    const rows = [...lv.entries()].sort((a, b) => a[1].r / a[1].n - b[1].r / b[1].n);
    const pct = right / qs.length, R = 52, C = 2 * Math.PI * R;
    main.replaceChildren(h("div.qz",
      h("div.qz-result",
        h("div.qz-art", setup.mock && passed ? h("div.qz-trophy.big", { html: trophy({ label: "Trophy: mock exam passed" }) }) : h("div.qz-res-m", { html: mascot(KIND_SITE, pct >= 0.85 ? "happy" : pct >= 0.6 ? "think" : "sad") })),
        h("div.qz-ring", { html: `<svg viewBox="0 0 120 120" width="132" height="132"><circle cx="60" cy="60" r="${R}" class="tr"/><circle cx="60" cy="60" r="${R}" class="fg" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/><text x="60" y="58">${Math.round(pct * 100)}%</text><text x="60" y="78" class="sm">${right} of ${qs.length}</text></svg>` }),
        h("div",
          h("div.eyebrow", "Results"),
          h("h1", setup.mock ? (passed ? "Passed. Here's your trophy." : `Not yet: ${Math.round((setup.pass || 0.7) * 100)}% to pass.`) : pct >= 0.85 ? "That stuck." : pct >= 0.6 ? "Most of it stuck." : "Worth another pass."),
          h("p.lede", `${timeUp ? "Time's up. " : ""}${right} right out of ${qs.length}, in ${Math.floor(secs / 60)} min ${secs % 60} s. ${qs.length - right ? `The ${qs.length - right} you missed come back for review tomorrow.` : "Nothing to review."}`),
          h("p.qz-earned", h("span.can-i", { html: can(setup.mock ? "#ffd23f" : "#ff7eb6") }), "+1 can on your bench"),
          h("div.qz-btns", h("button.btn.primary", { type: "button", onclick: () => run(pick(scopes().find((s) => s.key === setup.scope) || scopes()[0], setup.mode, setup.count), setup) }, setup.mock ? "Another mock exam" : "Another quiz like this"),
            qs.length - right ? h("button.btn", { type: "button", onclick: () => run(shuffle(qs.filter((q, k) => answers[k] !== q.answer)), { ...setup, marks: "each", scope: "review" }) }, "Retry the misses now") : null,
            h("button.btn", { type: "button", onclick: pageSetup }, "Change the settings")))),
      h("div.qz-levels", h("div.qz-l", "By level, weakest first"), rows.map(([li, e]) => h("a.qz-lvrow", { href: `/#${LEVELS[li].id}`, style: { "--lc": lcOf(li) } },
        h("span.ix-b", String(li)), h("span.qz-lvname", LEVELS[li].name.split(":")[0]), h("span.qz-lvbar", h("i", { style: { width: `${(e.r / e.n) * 100}%` } })), h("span.qz-lvn", `${e.r} / ${e.n}`)))),
      h("div.qz-review", h("div.qz-l", "Every answer"), qs.map((q, k) => {
        const c = byId.get(q.ch), ok = answers[k] === q.answer;
        return h(`details.qz-item.${ok ? "ok" : "no"}`, ok ? null : { open: true },
          h("summary", h("span.qz-mark", ok ? "✓" : "✗"), h("span", q.q)),
          h("div.qz-item-b",
            ok ? null : h("p", h("span.muted", "You said: "), q.options[answers[k]]),
            h("p", h("span.muted", "Answer: "), h("b", q.options[q.answer])),
            h("div", { html: q.explain }),
            c ? h("a.qz-open", { href: `/learn?c=${c.id}` }, `Open ${c.n} · ${c.title} →`) : null));
      }))));
    scrollTo(0, 0);
    if (pct >= 0.85) setTimeout(() => burst(main.querySelector(".qz-ring")), 250);
  }
  addEventListener("keydown", onKey);
  function onKey(e) {
    if (!main.querySelector(".qz-run")) { removeEventListener("keydown", onKey); return; }
    const k = "1234".indexOf(e.key) >= 0 ? "1234".indexOf(e.key) : "abcd".indexOf(e.key.toLowerCase());
    if (k >= 0 && k < qs[i].options.length && !e.metaKey && !e.ctrlKey) choose(k);
    if (e.key === "Enter" && answers[i] != null) { if (each && !revealed) { reveal(); } else next(); }
  }
  show();
  scrollTo(0, 0);
}

pageSetup();
