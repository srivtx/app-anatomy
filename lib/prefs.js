// Per-site settings and quiz state, kept in this browser only.
// Theme, text size and motion are also applied before first paint by a tiny inline script in each page.
import { progress } from "./core.js";

const KEY = `${progress.key.split(":")[0]}:prefs`;
const QKEY = `${progress.key.split(":")[0]}:quiz`;
const read = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k) || "{}") }; } catch { return { ...d }; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const PREF_DEFAULTS = { theme: "system", size: 1, motion: "system", quizCount: 10, quizMarks: "end" };
export const prefs = {
  get: () => read(KEY, PREF_DEFAULTS),
  set(patch) { const p = { ...prefs.get(), ...patch }; write(KEY, p); apply(p); return p; },
};

/** Apply theme, text size and motion to the page. */
export function apply(p = prefs.get()) {
  const r = document.documentElement;
  if (p.theme === "light" || p.theme === "dark") r.dataset.theme = p.theme; else delete r.dataset.theme;
  if (p.motion === "reduce" || p.motion === "full") r.dataset.motion = p.motion; else delete r.dataset.motion;
  r.style.zoom = p.size && p.size !== 1 ? String(p.size) : "";
}

// ---- quiz state: the setup sentence, past quizzes and the review deck -------------------------
export const INTERVALS = [1, 3, 7, 16, 35];                 // days until a missed question comes back
const DAY = 86400000;
export const quizState = {
  get: () => read(QKEY, { setup: null, hist: [], deck: {} }),
  save(s) { write(QKEY, s); },
  /** Missed: back tomorrow. Right on a review: wait longer; after the last step it leaves the deck. */
  grade(s, qid, right, now = Date.now()) {
    const card = s.deck[qid];
    if (!right) s.deck[qid] = { step: 0, due: now + INTERVALS[0] * DAY };
    else if (card) {
      const step = card.step + 1;
      if (step >= INTERVALS.length) delete s.deck[qid]; else s.deck[qid] = { step, due: now + INTERVALS[step] * DAY };
    }
  },
  due(s, now = Date.now()) { return Object.entries(s.deck).filter(([, c]) => c.due <= now).map(([id]) => id); },
};

/** Clear everything this site stores. */
export function resetAll() {
  for (const k of [progress.key, KEY, QKEY]) try { localStorage.removeItem(k); } catch {}
}
export function exportAll() {
  const out = {};
  for (const k of [progress.key, KEY, QKEY]) try { out[k] = JSON.parse(localStorage.getItem(k) || "null"); } catch {}
  return out;
}
export function importAll(data) {
  for (const k of [progress.key, KEY, QKEY]) if (data && k in data && data[k] != null) write(k, data[k]);
}
