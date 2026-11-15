import { h, rng } from "../lib/core.js";
import { segmented, slider, stats, predict, code, callout, section, prose, button, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// ---------------------------------------------------------------------------
// Renaming users.name to users.full_name while 1,000 requests a minute keep
// coming. 10 app servers, 2,000 rows, 80% reads and 20% writes.
// ---------------------------------------------------------------------------
export const VERSIONS = {
  v1: { label: "v1: reads name, writes name", read: "name", write: ["name"], color: "ink-3" },
  v2: { label: "v2: reads name, writes both", read: "name", write: ["name", "full_name"], color: "c1" },
  v3: { label: "v3: reads full_name, writes both", read: "full_name", write: ["name", "full_name"], color: "c5" },
  v4: { label: "v4: reads and writes full_name", read: "full_name", write: ["full_name"], color: "c6" },
  vN: { label: "new code: reads and writes full_name", read: "full_name", write: ["full_name"], color: "c2" },
};
const OPS = {
  add: "Add column full_name (nullable)",
  backfill: "Backfill full_name from name, in batches",
  drop: "Drop column name",
  rename: "Rename column name to full_name",
};
export const PLANS = {
  ec: { label: "Expand and contract", steps: [[3, "add"], [5, "deploy", "v2"], [11, "backfill"], [17, "deploy", "v3"], [23, "deploy", "v4"], [30, "drop"]] },
  rename: { label: "Rename, then deploy", steps: [[5, "rename"], [6, "deploy", "vN"]] },
  codefirst: { label: "Deploy, then rename", steps: [[5, "deploy", "vN"], [11, "rename"]] },
  early: { label: "Backfill during the deploy", steps: [[3, "add"], [5, "deploy", "v2"], [5, "backfill"], [17, "deploy", "v3"], [23, "deploy", "v4"], [30, "drop"]] },
  skip: { label: "Skip the backfill", steps: [[3, "add"], [5, "deploy", "v2"], [11, "deploy", "v3"], [23, "deploy", "v4"], [30, "drop"]] },
  dropsoon: { label: "Drop the old column early", steps: [[3, "add"], [5, "deploy", "v2"], [11, "backfill"], [17, "deploy", "v3"], [18, "drop"], [23, "deploy", "v4"]] },
};
const T = 36, N = 2000, SERVERS = 10, RPM = 1000, WRITES = 0.1, PER_MIN = 2;

export function simulateMigration(planId, seed = 4) {
  const r = rng(seed), plan = PLANS[planId];
  const truth = new Int32Array(N), col = { name: new Int32Array(N), full_name: new Int32Array(N).fill(-1) };
  const has = { name: true, full_name: false };
  let fleet = Array(SERVERS).fill("v1"), target = null, backfillAt = 0, backfilling = false;
  const rows = [], stepInfo = [];
  const prevVersion = [];                               // code versions in deploy order, for rollback checks
  for (let t = 0; t < T; t++) {
    for (const [at, op, v] of plan.steps) if (at === t) {
      if (op === "deploy") { prevVersion.push(fleet[SERVERS - 1]); target = v; }
      if (op === "add") { has.full_name = true; }
      if (op === "backfill") { backfilling = true; backfillAt = 0; }
      if (op === "drop") { has.name = false; col.name.fill(-1); }
      if (op === "rename") { has.full_name = true; col.full_name.set(col.name); has.name = false; col.name.fill(-1); }
    }
    // rolling deploy: PER_MIN servers a minute
    if (target) { let k = 0; for (let i = 0; i < SERVERS && k < PER_MIN; i++) if (fleet[i] !== target) { fleet[i] = target; k++; } if (fleet.every((v) => v === target)) target = null; }
    let failed = 0, wrong = 0, blank = 0;
    for (let q = 0; q < RPM; q++) {
      const v = VERSIONS[fleet[q % SERVERS]], i = (r() * N) | 0;
      if (r() < WRITES) {
        if (v.write.some((c) => !has[c])) { failed++; continue; }
        truth[i]++;
        for (const c of v.write) col[c][i] = truth[i];
      } else {
        if (!has[v.read]) { failed++; continue; }
        const val = col[v.read][i];
        if (val < 0) { blank++; wrong++; } else if (val < truth[i]) wrong++;
      }
    }
    // backfill a quarter of the table each minute, after this minute's traffic
    if (backfilling && has.full_name && has.name) {
      const end = Math.min(N, backfillAt + N / 4);
      for (let i = backfillAt; i < end; i++) col.full_name[i] = col.name[i];
      backfillAt = end; if (backfillAt >= N) backfilling = false;
    }
    const mix = {}; for (const f of fleet) mix[f] = (mix[f] || 0) + 1 / SERVERS;
    let filled = 0; if (has.full_name) for (let i = 0; i < N; i++) if (col.full_name[i] >= 0) filled++;
    rows.push({ t, mix, failed, wrong, blank, hasName: has.name, hasFull: has.full_name, filled: filled / N });
    // at the end of each step's minute: could you roll the code back right now?
    for (const [at, op, v] of plan.steps) if (at + (op === "deploy" ? SERVERS / PER_MIN - 1 : op === "backfill" ? 3 : 0) === t) {
      const back = prevVersion.at(-1) || "v1", bv = VERSIONS[back];
      let why = null;
      if (bv.write.some((c) => !has[c]) || !has[bv.read]) why = `${back} needs a column that's gone`;
      else { let stale = 0; for (let i = 0; i < N; i++) if (col[bv.read][i] < truth[i]) stale++; if (stale) why = `${back} would read ${stale} out-of-date rows`; }
      stepInfo.push({ at, op, v, rollback: why, back });
    }
  }
  const finalV = VERSIONS[rows.at(-1) && Object.keys(rows.at(-1).mix).sort((a, b) => rows.at(-1).mix[b] - rows.at(-1).mix[a])[0]];
  let corrupt = 0;
  if (has[finalV.read]) for (let i = 0; i < N; i++) if (col[finalV.read][i] !== truth[i]) corrupt++;
  return { rows, stepInfo, corrupt, failed: rows.reduce((a, x) => a + x.failed, 0), wrong: rows.reduce((a, x) => a + x.wrong, 0) };
}

// ---------------------------------------------------------------------------
// The lock queue: an ALTER waits behind a long query, and every query after it waits behind the ALTER.
// ---------------------------------------------------------------------------
export function lockQueue({ longQuery = 20, timeout = 0, qps = 40, pool = 100, retryEvery = 5 }) {
  const dt = 0.05, T2 = 40, longStart = 2, longEnd = longStart + longQuery, alterAt = 5, alterRun = 0.05;
  let waiting = 0, failed = 0, acc = 0, tw = null, maxWait = 0, nextTry = alterAt, attempts = 0, doneAt = null, runningUntil = null;
  const series = [];
  for (let i = 0; i <= T2 / dt; i++) {
    const t = i * dt;
    if (doneAt == null && runningUntil == null && tw == null && t >= nextTry - 1e-9) { tw = t; attempts++; }
    if (tw != null && runningUntil == null) {
      if (t >= longEnd) runningUntil = t + alterRun;                    // the long query finished: ALTER gets its lock
      else if (timeout && t - tw >= timeout) { maxWait = Math.max(maxWait, t - tw); tw = null; waiting = 0; nextTry = t + retryEvery; }
    }
    if (runningUntil != null && t >= runningUntil) { maxWait = Math.max(maxWait, t - tw); doneAt = t; tw = null; runningUntil = null; waiting = 0; }
    acc += qps * dt; const arrive = Math.floor(acc); acc -= arrive;
    if (tw != null) { for (let k = 0; k < arrive; k++) if (waiting < pool) waiting++; else failed++; }
    series.push([t, tw != null ? waiting : Math.min(pool, Math.round(qps * 0.01) + (t >= longStart && t < longEnd ? 1 : 0))]);
  }
  return { series, failed, maxWait, doneAt, attempts, pool, longStart, longEnd, alterAt, T2 };
}

export default function (root, { id }) {
  let plan = "ec", shown = T, timer = 0;
  const fc = flowCanvas({ width: 720, height: 330, label: "Code versions, schema and errors over a migration" });
  const st = stats([{ label: "Requests that failed" }, { label: "Wrong or blank names shown" }, { label: "Rows left wrong at the end" }]);
  const steps = h("ol.mg-steps");

  function draw() {
    const sim = simulateMigration(plan), c = fc.colors, ctx = fc.ctx; fc.clear();
    const L = 92, R = 706, X = (t) => L + ((R - L) * t) / T, w = (R - L) / T;
    const rows = sim.rows.slice(0, shown);
    // lane 1: code
    fc.text("Code running", 8, 46, { size: 11.5 });
    rows.forEach((x) => { let y = 28; for (const v of Object.keys(VERSIONS)) if (x.mix[v]) { const hh = 36 * x.mix[v]; fc.box(X(x.t) + 1, y, w - 2, hh, { fill: c[VERSIONS[v].color], stroke: "transparent", r: 2 }); y += hh; } });
    // lane 2: schema
    fc.text("name", 8, 92, { size: 11, mono: true }); fc.text("full_name", 8, 112, { size: 11, mono: true });
    rows.forEach((x) => {
      if (x.hasName) fc.box(X(x.t) + 1, 85, w - 2, 14, { fill: c["ink-3"], stroke: "transparent", r: 2 });
      if (x.hasFull) { fc.box(X(x.t) + 1, 105, w - 2, 14, { fill: c.sunken, stroke: c.line, lw: 1, r: 2 }); fc.box(X(x.t) + 1, 105 + 14 * (1 - x.filled), w - 2, 14 * x.filled, { fill: c.c3, stroke: "transparent", r: 2 }); }
    });
    // lane 3: damage
    const P = [150, 296], yMax = Math.max(50, ...sim.rows.map((x) => x.failed + x.wrong)) * 1.08, Y = (v) => P[1] - ((P[1] - P[0]) * v) / yMax;
    fc.text("Per minute", 8, P[0] + 8, { size: 11.5 });
    for (const v of [0, Math.round(yMax / 2), Math.round(yMax * 0.95)]) { fc.line(L, Y(v), R, Y(v), { color: c.line, lw: 1 }); fc.text(String(v), L - 8, Y(v), { align: "right", size: 10, color: c["ink-2"], mono: true }); }
    rows.forEach((x) => {
      if (x.failed) fc.box(X(x.t) + 2, Y(x.failed), w - 4, P[1] - Y(x.failed), { fill: c.bad, stroke: "transparent", r: 2 });
      if (x.wrong) fc.box(X(x.t) + 2, Y(x.failed + x.wrong), w - 4, Y(x.failed) - Y(x.failed + x.wrong) - (x.failed ? 1 : 0), { fill: c.warn, stroke: "transparent", r: 2 });
    });
    for (let t = 0; t <= T; t += 6) fc.text(`${t}m`, X(t), P[1] + 14, { align: "center", size: 10, color: c["ink-2"], mono: true });
    const seenAt = {};
    PLANS[plan].steps.forEach(([at], i) => { if (at < shown) { const k = (seenAt[at] = (seenAt[at] ?? -1) + 1); if (!k) fc.line(X(at), 20, X(at), P[1], { color: c.ink, lw: 1, dash: [2, 4] }); fc.text(String(i + 1), X(at) + 3 + 10 * k, 14, { size: 10.5, color: c.ink, mono: true }); } });
    // legend
    let lx = L; for (const [txt, col] of [["failed", c.bad], ["wrong or blank name", c.warn], ["backfilled", c.c3]]) { fc.box(lx, 318, 10, 10, { fill: col, stroke: "transparent", r: 2 }); fc.text(txt, lx + 15, 323, { size: 10.5, color: c["ink-2"], weight: 500 }); lx += 30 + fc.ctx.measureText(txt).width; }
    const done = shown >= T;
    st.set(0, done ? sim.failed.toLocaleString() : "…", done ? (sim.failed ? "bad" : "good") : "");
    st.set(1, done ? sim.wrong.toLocaleString() : "…", done ? (sim.wrong ? "bad" : "good") : "");
    st.set(2, done ? (sim.corrupt ? `${sim.corrupt.toLocaleString()} rows` : "none") : "…", done ? (sim.corrupt ? "bad" : "good") : "");
    steps.replaceChildren(...PLANS[plan].steps.map(([at, op, v], i) => {
      const info = sim.stepInfo.find((s) => s.at === at && s.op === op);
      const what = op === "deploy" ? `Deploy ${VERSIONS[v].label}` : OPS[op];
      return h("li", h("span.mg-t", `${at}m`), h("span.mg-what", h("i", { style: { background: op === "deploy" ? `var(--${VERSIONS[v].color})` : "var(--line)" } }), what),
        info && done ? h(`span.mg-rb.${info.rollback ? "no" : "ok"}`, info.rollback ? `Roll back now? No: ${info.rollback}` : `Roll back to ${info.back} now? Safe`) : h("span.mg-rb", ""));
    }));
  }
  function play() { clearInterval(timer); shown = 0; draw(); timer = setInterval(() => { shown += 1; draw(); if (shown >= T) clearInterval(timer); }, 45); }

  // lock queue
  const lq = { longQuery: 20, timeout: 0 };
  const lfc = flowCanvas({ width: 720, height: 250, label: "Connections waiting on the users table over 40 seconds" });
  const lst = stats([{ label: "Requests failed" }, { label: "Longest wait" }, { label: "Migration finished" }]);
  function drawLock() {
    const o = lockQueue(lq), c = lfc.colors, ctx = lfc.ctx; lfc.clear();
    const L = 52, R = 706, P = [24, 210], X = (t) => L + ((R - L) * t) / o.T2, Y = (v) => P[1] - ((P[1] - P[0]) * v) / (o.pool * 1.15);
    for (const v of [0, 50, 100]) { lfc.line(L, Y(v), R, Y(v), { color: c.line, lw: 1 }); lfc.text(String(v), L - 8, Y(v), { align: "right", size: 10, color: c["ink-2"], mono: true }); }
    lfc.line(L, Y(o.pool), R, Y(o.pool), { color: c.bad, lw: 1.2, dash: [6, 5] }); lfc.text("connection pool full: new requests fail", R - 4, Y(o.pool) - 9, { align: "right", size: 10, color: c.bad });
    lfc.box(X(o.longStart), P[1] + 4, X(Math.min(o.T2, o.longEnd)) - X(o.longStart), 8, { fill: c.c4, stroke: "transparent", r: 3 });
    lfc.text(`report query holds a read lock (${lq.longQuery}s)`, X(o.longStart) + 4, P[1] + 22, { size: 10.5, color: c["ink-2"], weight: 500 });
    lfc.line(X(o.alterAt), P[0], X(o.alterAt), P[1], { color: c.ink, lw: 1, dash: [3, 4] }); lfc.text("ALTER TABLE asks for its lock", X(o.alterAt) + 5, P[0] + 2, { size: 10.5 });
    ctx.beginPath(); o.series.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v)))); ctx.lineTo(X(o.T2), P[1]); ctx.lineTo(X(0), P[1]); ctx.closePath();
    ctx.globalAlpha = 0.2; ctx.fillStyle = c.c1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); o.series.forEach(([t, v], i) => (i ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v)))); ctx.strokeStyle = c.c1; ctx.lineWidth = 2; ctx.stroke();
    for (let t = 0; t <= o.T2; t += 10) lfc.text(`${t}s`, X(t), 244, { align: "center", size: 10, color: c["ink-2"], mono: true });
    lst.set(0, o.failed.toLocaleString(), o.failed ? "bad" : "good");
    lst.set(1, `${o.maxWait.toFixed(1)} s`, o.maxWait > 3 ? "bad" : "good");
    lst.set(2, o.doneAt != null ? `at ${o.doneAt.toFixed(0)} s (${o.attempts} ${o.attempts === 1 ? "try" : "tries"})` : "not yet");
  }

  root.append(
    section(null, prose(`<p>Renaming a column is one line of SQL. Doing it while the app is serving traffic is a small project, because of a fact that's easy to forget: <b>during a deploy, the old code and the new code run at the same time</b>, against one database. Every schema change has to work with both, and every step has to be undoable until you're sure.</p>
<p>Below, an app with ${SERVERS} servers serves ${RPM.toLocaleString()} requests a minute (${WRITES * 100}% writes) against a ${N.toLocaleString()}-row <code>users</code> table. A deploy replaces ${PER_MIN} servers a minute. Pick a plan and watch what users see.</p>`)),
    section("Rename a column under live traffic",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Plan", options: Object.entries(PLANS).map(([value, p]) => ({ value, label: p.label })), value: plan, onChange: (v) => { plan = v; play(); } }),
          button("Replay", play, "primary"),
        ),
        h("div.stage-body", st.el, fc.el, steps),
      ),
      callout("tip", "Things to try", "<p>Expand and contract takes 30 minutes and six steps, and no user notices anything. Now <b>rename, then deploy</b>: every old server breaks the moment the column changes name, until the deploy finishes. <b>Deploy, then rename</b> breaks the new servers instead. <b>Backfill during the deploy</b> looks fine at first, but old servers keep writing only <code>name</code> after their rows were copied, and those rows are wrong in <code>full_name</code> for good: nothing failed, the data just quietly went bad. <b>Skip the backfill</b> shows blank names for every row nobody happened to edit. <b>Drop the old column early</b> kills the servers that haven't been updated yet. Also read the rollback notes: in the safe plan every step can be undone except the last. Dropping a column is the one irreversible step, which is why it waits for a later release.</p>"),
      predict({
        chapter: id,
        question: "You add full_name, deploy code that writes both columns, and start the backfill as soon as the deploy begins. No errors. What's wrong?",
        options: ["Nothing: no errors means it worked", "Old servers still running write only name, so rows they edit after being backfilled have a stale full_name", "The backfill locks the table", "Writing two columns doubles the load"],
        answer: 1,
        explain: "<p>The backfill copied each row once. Any row an old server edited afterwards changed in <code>name</code> but not in <code>full_name</code>. Once the code switches to reading <code>full_name</code>, those users see their old name, and nothing will ever fix it. The rule: start the backfill only after <i>every</i> server writes both columns. This is the dangerous kind of migration bug, because it raises no error.</p>",
      }),
    ),
    section("The 50-millisecond ALTER that took the site down",
      prose(`<p>Some schema changes are instant in principle and still cause outages. In PostgreSQL, <code>ALTER TABLE</code> needs an exclusive lock for a moment. If a long query is reading the table, the ALTER waits. And while it waits, <b>every new query on that table queues behind the ALTER</b>, even plain reads that wouldn't conflict with the long query. Lock requests are served in order. A report that runs for 20 seconds plus a 50-millisecond migration means 20 seconds of nothing working.</p>`),
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "A report query already running for", min: 0, max: 30, step: 1, value: lq.longQuery, fmt: (v) => `${v} s`, onInput: (v) => { lq.longQuery = v; drawLock(); } }),
          segmented({ label: "lock_timeout on the migration", options: [{ value: 0, label: "none (the default)" }, { value: 5, label: "5 s" }, { value: 2, label: "2 s" }, { value: 0.5, label: "500 ms" }], value: lq.timeout, onChange: (v) => { lq.timeout = +v; drawLock(); } }),
        ),
        h("div.stage-body", lst.el, lfc.el),
      ),
      callout("note", "The fix", "<p>Set <code>lock_timeout</code> on every migration. If the ALTER can't get its lock within a second or two, it gives up, the queue behind it drains, and you retry a few seconds later. You trade a slower migration for an app that keeps serving. With 40 requests a second and a 100-connection pool, anything over 2.5 seconds of waiting exhausts the pool, so 500 ms or 1 s is a sensible value. Retry with a little random delay.</p>"),
    ),
    section("Schema changes that look harmless",
      table(["Change", "What actually happens (PostgreSQL)", "Do this instead"], [
        ["ADD COLUMN … DEFAULT x", "Instant since PostgreSQL 11 for a constant default; before 11, rewrites the whole table under an exclusive lock", "On old versions: add the column, then set the default, then backfill"],
        ["CREATE INDEX", "Blocks all writes to the table until it's built", "CREATE INDEX CONCURRENTLY (slower, can't run inside a transaction; check for an INVALID index if it fails)"],
        ["ADD CONSTRAINT … NOT NULL / FOREIGN KEY / CHECK", "Scans the whole table while holding a lock", "Add it NOT VALID, then VALIDATE CONSTRAINT separately, which needs only a weak lock"],
        ["ALTER COLUMN TYPE", "Usually rewrites the table and every index", "New column, dual writes, backfill, switch: expand and contract again"],
        ["One big UPDATE for a backfill", "One huge transaction: long locks, replication lag, bloat", "Batches of a few thousand rows by primary key, with a pause between"],
        ["DROP COLUMN", "Instant, but old servers or a rollback that still reads it will fail", "Stop reading it in code first; drop it in a later release"],
        ["Rename table or column", "Instant, and breaks every running server that uses the old name", "Expand and contract, or a view with the old name during the switch"],
      ]),
      callout("warn", "MySQL is different", "<p>MySQL's InnoDB can do many changes in place (<code>ALGORITHM=INPLACE</code> or <code>INSTANT</code>), but not all of them, and a long change replicates as one long event, so replicas fall behind. Large MySQL shops use online schema-change tools like <b>gh-ost</b> or <b>pt-online-schema-change</b>, which build a copy of the table, keep it in sync, and swap it in.</p>"),
    ),
    section("In code",
      code({
        "Safe migration (PostgreSQL)": `-- 1. expand
SET lock_timeout = '1s';
ALTER TABLE users ADD COLUMN full_name text;           -- nullable, no default: instant

-- 2. after EVERY server writes both columns: backfill in batches
UPDATE users SET full_name = name
WHERE id IN (SELECT id FROM users WHERE full_name IS NULL ORDER BY id LIMIT 5000);
-- repeat until 0 rows; sleep ~100 ms between batches to spare replicas

-- 3. after every server reads full_name: enforce it, cheaply
ALTER TABLE users ADD CONSTRAINT full_name_nn CHECK (full_name IS NOT NULL) NOT VALID;
ALTER TABLE users VALIDATE CONSTRAINT full_name_nn;   -- scans, but only a weak lock

-- 4. contract, in a later release
ALTER TABLE users DROP COLUMN name;`,
        "Retry on lock timeout (Python)": `import random, time, psycopg

def run_ddl(conn, sql, tries=10):
    for attempt in range(tries):
        try:
            with conn.transaction():
                conn.execute("SET LOCAL lock_timeout = '1s'")
                conn.execute(sql)
            return
        except psycopg.errors.LockNotAvailable:
            time.sleep(2 + random.random() * 3)          # let the queue drain, then try again
    raise RuntimeError(f"gave up after {tries} tries: {sql}")`,
        "Dual write in the app (TypeScript)": `// v2: write both, read the old column
await db.query("UPDATE users SET name = $1, full_name = $1 WHERE id = $2", [name, id]);
const user = await db.query("SELECT id, name AS display_name FROM users WHERE id = $1", [id]);

// v3: same writes, read the new column
const user3 = await db.query("SELECT id, full_name AS display_name FROM users WHERE id = $1", [id]);`,
        "Find what blocks a migration": `-- who is waiting on whom, right now
SELECT pid, wait_event_type, state, now() - query_start AS running_for,
       pg_blocking_pids(pid) AS blocked_by, left(query, 60) AS query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0 OR pid IN (SELECT unnest(pg_blocking_pids(pid)) FROM pg_stat_activity)
ORDER BY query_start;`,
      }, "Tools such as strong_migrations (Rails), django-pg-zero-downtime-migrations and squawk (a linter for SQL migrations) catch most of these before they ship."),
    ),
  );
  fc.redraw = draw; lfc.redraw = drawLock;
  draw(); drawLock();
}
