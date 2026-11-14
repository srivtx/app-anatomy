import { h } from "../lib/core.js";
import { segmented, stats, predict, code, dilemma, callout, section, prose, button, table } from "../lib/widgets.js";

// A tiny multi-version database that runs two interleaved transactions under four isolation levels.
const LEVELS = {
  ru: "Read uncommitted",
  rc: "Read committed",
  si: "Repeatable read (snapshot)",
  ser: "Serializable",
};

export const SCEN = {
  lost: {
    label: "Lost update",
    story: "Two withdrawals from one account at the same moment: $30 and $50 from $100.",
    init: { balance: 100 },
    steps: [
      [1, "begin"], [2, "begin"],
      [1, "read", "balance"], [2, "read", "balance"],
      [1, "write", "balance", (v) => v.balance - 30, "balance − 30"], [1, "commit"],
      [2, "write", "balance", (v) => v.balance - 50, "balance − 50"], [2, "commit"],
    ],
    check: (db) => (db.balance === 20 ? [true, "balance is $20, as it should be"] : [false, `balance is $${db.balance}, but $80 was withdrawn: one update was lost`]),
  },
  dirty: {
    label: "Dirty read",
    story: "A transfer debits the account, then fails and rolls back. Meanwhile a report reads the balance.",
    init: { balance: 100 },
    steps: [
      [1, "begin"], [2, "begin"],
      [1, "write", "balance", () => 0, "balance = 0 (move it all)"],
      [2, "read", "balance"],
      [1, "rollback"], [2, "commit"],
    ],
    check: (db, reads) => (reads[2].some((r) => r.v === 0) ? [false, "the report saw $0, money that never actually left"] : [true, "the report only saw committed data"]),
  },
  nonrep: {
    label: "Non-repeatable read",
    story: "An order page reads the stock twice while someone else buys the last items.",
    init: { stock: 5 },
    steps: [
      [1, "begin"], [1, "read", "stock"],
      [2, "begin"], [2, "write", "stock", () => 0, "stock = 0 (sold out)"], [2, "commit"],
      [1, "read", "stock"], [1, "commit"],
    ],
    check: (db, reads) => { const r = reads[1].map((x) => x.v); return r[0] === r[1] ? [true, "both reads agree inside the transaction"] : [false, `the same query returned ${r[0]} then ${r[1]} inside one transaction`]; },
  },
  skew: {
    label: "Write skew",
    story: "Rule: at least one doctor must stay on call. Alice and Bob both ask to go off call at the same moment.",
    init: { alice: 1, bob: 1 },
    steps: [
      [1, "begin"], [2, "begin"],
      [1, "read", "alice"], [1, "read", "bob"],
      [2, "read", "alice"], [2, "read", "bob"],
      [1, "write", "alice", (v) => (v.alice + v.bob >= 2 ? 0 : 1), "alice off, if 2 are on call"],
      [2, "write", "bob", (v) => (v.alice + v.bob >= 2 ? 0 : 1), "bob off, if 2 are on call"],
      [1, "commit"], [2, "commit"],
    ],
    check: (db) => (db.alice + db.bob >= 1 ? [true, `${db.alice + db.bob} doctor(s) on call`] : [false, "nobody is on call: each saw two doctors, each changed a different row"]),
  },
};

/** Run a schedule. Returns per-step results, final committed state, reads per txn, aborted txns. */
export function run(sc, level) {
  const versions = {}; for (const [k, v] of Object.entries(sc.init)) versions[k] = [{ v, ts: 0, by: 0 }];
  let clock = 0;
  const tx = {}, pending = {}, out = [], reads = { 1: [], 2: [] };
  const latest = (k) => versions[k].at(-1);
  const asOf = (k, ts) => [...versions[k]].reverse().find((x) => x.ts <= ts);
  for (const [t, op, key, fn, label] of sc.steps) {
    const T = tx[t];
    if (op === "begin") { tx[t] = { start: clock, vals: {}, writes: {}, readKeys: new Set(), dead: false }; out.push({ t, text: "BEGIN" }); continue; }
    if (T.dead) { out.push({ t, text: "(already aborted)", kind: "skip" }); continue; }
    if (op === "read") {
      let v, note = "";
      if (key in T.writes) v = T.writes[key];
      else if (level === "ru" && pending[key] && pending[key].by !== t) { v = pending[key].v; note = "uncommitted!"; }
      else if (level === "ru" || level === "rc") v = latest(key).v;
      else v = asOf(key, T.start).v;
      T.vals[key] = v; T.readKeys.add(key); reads[t].push({ key, v });
      out.push({ t, text: `SELECT ${key} → ${v}`, note, kind: note ? "bad" : "" });
    } else if (op === "write") {
      const v = fn({ ...sc.init, ...Object.fromEntries(Object.keys(sc.init).map((k) => [k, T.vals[k] ?? asOf(k, T.start).v])) });
      T.writes[key] = v; T.vals[key] = v; pending[key] = { v, by: t };
      out.push({ t, text: `UPDATE ${key} = ${v}`, note: label });
    } else if (op === "commit") {
      let conflict = null;
      if (level === "si" || level === "ser") for (const k of Object.keys(T.writes)) if (latest(k).ts > T.start && latest(k).by !== t) conflict = `${k} changed since my snapshot`;
      if (!conflict && level === "ser" && Object.keys(T.writes).length) for (const k of T.readKeys) if (latest(k).ts > T.start && latest(k).by !== t) conflict = `${k}, which I read, was changed by a concurrent commit`;
      if (conflict) { T.dead = true; for (const k of Object.keys(T.writes)) if (pending[k]?.by === t) delete pending[k]; out.push({ t, text: "COMMIT → ERROR, rolled back", note: `could not serialize: ${conflict}`, kind: "abort" }); continue; }
      clock++;
      for (const [k, v] of Object.entries(T.writes)) { versions[k].push({ v, ts: clock, by: t }); if (pending[k]?.by === t) delete pending[k]; }
      out.push({ t, text: "COMMIT", kind: "ok" });
    } else if (op === "rollback") {
      T.dead = true; for (const k of Object.keys(T.writes)) if (pending[k]?.by === t) delete pending[k];
      out.push({ t, text: "ROLLBACK", kind: "abort" });
    }
  }
  const db = Object.fromEntries(Object.keys(versions).map((k) => [k, latest(k).v]));
  const aborted = [1, 2].filter((t) => tx[t]?.dead && sc.steps.some(([tt, op]) => tt === t && op === "commit") && !sc.steps.some(([tt, op]) => tt === t && op === "rollback"));
  return { out, db, reads, aborted };
}

export function verdict(sc, level) {
  const r = run(sc, level);
  const [ok, msg] = sc.check(r.db, r.reads);
  if (r.aborted.length && ok) return { r, state: "abort", msg: `Transaction ${r.aborted.join(" and ")} was refused. The app retries it, and the retry sees the new data. ${msg}.` };
  if (r.aborted.length) return { r, state: "abort", msg: `Transaction ${r.aborted.join(" and ")} was refused; after a retry the anomaly is gone.` };
  return { r, state: ok ? "ok" : "bad", msg: ok ? msg[0].toUpperCase() + msg.slice(1) + "." : msg[0].toUpperCase() + msg.slice(1) + "." };
}

export default function (root, { id }) {
  let scen = "lost", level = "rc", shown = 0, timer = 0;
  const grid = h("div.tx-grid");
  const st = stats([{ label: "Final data" }, { label: "Refused transactions" }, { label: "Outcome" }]);
  const storyEl = h("p.tx-story");
  const verdictEl = h("div.tx-verdict");

  function draw() {
    const sc = SCEN[scen], v = verdict(sc, level);
    storyEl.textContent = sc.story;
    const rows = v.r.out.map((o, i) => h(`div.tx-row${i < shown ? "" : ".tx-hidden"}`,
      h("span.tx-n", String(i + 1)),
      h(`span.tx-cell.t1${o.t === 1 ? "" : ".empty"}`, o.t === 1 ? h(`span.tx-op.${o.kind || "n"}`, o.text, o.note && h("small", o.note)) : ""),
      h(`span.tx-cell.t2${o.t === 2 ? "" : ".empty"}`, o.t === 2 ? h(`span.tx-op.${o.kind || "n"}`, o.text, o.note && h("small", o.note)) : "")));
    grid.replaceChildren(h("div.tx-row.tx-head", h("span.tx-n", "#"), h("span.tx-cell", "Transaction 1"), h("span.tx-cell", "Transaction 2")), ...rows);
    const done = shown >= v.r.out.length;
    st.set(0, done ? Object.entries(v.r.db).map(([k, x]) => `${k} = ${x}`).join(", ") : "…");
    st.set(1, done ? String(v.r.aborted.length) : "…");
    st.set(2, done ? (v.state === "ok" ? "correct" : v.state === "abort" ? "refused, retry" : "anomaly") : "…", done ? (v.state === "bad" ? "bad" : "good") : "");
    verdictEl.className = `tx-verdict ${done ? v.state : ""}`;
    verdictEl.textContent = done ? v.msg : "Step through the schedule, or press Play.";
  }
  function play() { clearInterval(timer); shown = 0; draw(); const n = verdict(SCEN[scen], level).r.out.length; timer = setInterval(() => { shown++; draw(); if (shown >= n) clearInterval(timer); }, 450); }
  function step() { clearInterval(timer); const n = verdict(SCEN[scen], level).r.out.length; shown = Math.min(n, shown + 1); draw(); }

  const matrix = table(["Anomaly", ...Object.values(LEVELS)], Object.entries(SCEN).map(([k, sc]) => [sc.label, ...Object.keys(LEVELS).map((lv) => {
    const s = verdict(sc, lv).state; return h(`span.tx-pill.${s}`, s === "bad" ? "happens" : s === "abort" ? "refused" : "prevented");
  })]));

  root.append(
    section(null, prose(`<p>A database transaction promises that a group of changes happens all together or not at all. That's the easy part. The hard part is what happens when <b>two transactions run at the same time</b>. Full isolation (every transaction behaves as if it ran alone) is expensive, so databases offer weaker <b>isolation levels</b>, and the default in Postgres, MySQL and most others is not the strongest one. Each weaker level allows specific bugs, called anomalies, that only appear under concurrency. They don't show up in tests, and they cost real money in production.</p>
<p>Below is a small multi-version database. Pick a race and an isolation level, then step through the two transactions exactly as the database interleaves them.</p>`)),
    section("Run two transactions at once",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "The race", options: Object.entries(SCEN).map(([value, s]) => ({ value, label: s.label })), value: scen, onChange: (v) => { scen = v; shown = 0; play(); } }),
          segmented({ label: "Isolation level", options: Object.entries(LEVELS).map(([value, label]) => ({ value, label })), value: level, onChange: (v) => { level = v; play(); } }),
          h("div.row", button("Play", play, "primary"), button("Step", step)),
        ),
        h("div.stage-body", storyEl, st.el, grid, verdictEl),
      ),
      callout("tip", "Things to try", "<p>Start with the lost update under read committed (the default in Postgres): both withdrawals read $100, and the second one overwrites the first. Switch to repeatable read: the database refuses the second commit, and the app retries. Now try write skew under repeatable read: each transaction changes a <i>different</i> row, so snapshot isolation sees no conflict and both commit. Nobody is on call. Only serializable catches it, because it also checks what each transaction <i>read</i>.</p>"),
    ),
    section("Which level prevents what",
      prose(`<p>This table is computed by running every race above under every level in the same little database.</p>`),
      matrix,
      predict({
        chapter: id,
        question: "Your app runs on Postgres with the default isolation level. Two requests do “read the balance, subtract in code, write it back” at the same time. What can happen?",
        options: ["Nothing: Postgres transactions are fully isolated by default", "A lost update: one subtraction disappears", "A deadlock every time", "The second request reads a dirty value"],
        answer: 1,
        explain: "<p>The default is read committed. Both requests read the same committed balance, both compute a new value in application code, and the second write wins. Fix it with an atomic statement (<code>UPDATE … SET balance = balance − 30</code>), a row lock (<code>SELECT … FOR UPDATE</code>), a version check, or a stronger isolation level plus a retry loop.</p>",
      }),
    ),
    section("Fixing races in practice",
      table(["Fix", "How it works", "Good for", "Cost"], [
        ["Atomic update", "UPDATE accounts SET balance = balance − 30 WHERE id = 1 AND balance >= 30", "Counters, balances, stock", "Only works when the change fits in one statement"],
        ["Row lock", "SELECT … FOR UPDATE makes the second transaction wait", "Read-modify-write on a few rows", "Waiting, and deadlocks if you lock in different orders"],
        ["Optimistic version column", "UPDATE … WHERE id = 1 AND version = 7; zero rows updated means retry", "Web forms, low contention", "Retries under contention"],
        ["Serializable + retry", "The database detects dangerous patterns and aborts one transaction", "Complex invariants across rows (write skew)", "Retry code everywhere; some throughput loss"],
        ["A constraint", "UNIQUE, CHECK or an exclusion constraint makes the bad state impossible", "Double bookings, duplicate signups", "Only for invariants the schema can express"],
      ]),
      dilemma("A booking system must never double-book a room. Which do you reach for?", [
        { name: "Serializable isolation", pros: ["Catches every interleaving, including ones you didn't think of"], cons: ["Every transaction needs a retry loop", "More aborts under load"] },
        { name: "An exclusion constraint", pros: ["The database makes overlap impossible, whatever the code does", "No retries in the normal case"], cons: ["Only for rules the schema can express", "Postgres-specific (EXCLUDE USING gist)"] },
      ], "If the rule fits a constraint, use the constraint: it protects you from every code path, including ones written next year. Reach for serializable when the invariant spans rows in ways a constraint can't express."),
      callout("warn", "Names lie", "<p>“Repeatable read” means snapshot isolation in Postgres, but in MySQL InnoDB it behaves differently (plain reads use a snapshot; locking reads and updates see the latest data). Oracle's “serializable” is snapshot isolation and allows write skew. Read your database's documentation for what each level actually does.</p>"),
    ),
    section("In code",
      code({
        "Atomic update (SQL)": `-- no read-modify-write in the app: the database does it in one step
UPDATE accounts SET balance = balance - 30
WHERE id = 1 AND balance >= 30
RETURNING balance;            -- zero rows back = insufficient funds`,
        "Row lock (SQL)": `BEGIN;
SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;   -- the second transaction waits here
UPDATE accounts SET balance = 70 WHERE id = 1;
COMMIT;`,
        "Serializable + retry (Node, pg)": `async function withSerializable(pool, fn, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      if (e.code !== "40001") throw e;                    // serialization_failure: retry
      await new Promise((r) => setTimeout(r, 2 ** i * 10 + Math.random() * 10));
    } finally { c.release(); }
  }
  throw new Error("too much contention");
}`,
        "Exclusion constraint (Postgres)": `CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE bookings (
  room_id int,
  during  tstzrange,
  EXCLUDE USING gist (room_id WITH =, during WITH &&)    -- no two bookings overlap
);`,
      }),
    ),
  );
  play();
}
