import { h, s, fmtN } from "../lib/core.js";
import { slider, toggle, segmented, stats, predict, code, dilemma, callout, section, prose, button } from "../lib/widgets.js";

// Rough, warm-cache costs: reading one 8 KB page from memory ~10 µs.
const ROWS_PER_PAGE = 100, FANOUT = 300, PAGE_MS = 0.01;
const depthFor = (n) => Math.max(1, Math.ceil(Math.log(n) / Math.log(FANOUT)));

function tree(depth, animate) {
  const W = 640, levelH = 64, H = depth * levelH + 40;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `B-tree with ${depth} levels; the lookup reads one node per level` });
  const labels = [["a–f", "g–m", "n–s", "t–z"], ["g–h", "i–j", "k–l", "m"], ["ka–ke", "kf–ki", "kj–kl", "km–kz"], ["kim…", "kip…", "kit…", "kix…"]];
  let prevX = W / 2;
  for (let d = 0; d < depth; d++) {
    const y = 12 + d * levelH;
    const n = d === 0 ? 1 : 4;
    const hot = d === 0 ? 0 : d === 1 ? 2 : 1; // "kim" lives under g–m → k–l → kf–ki
    for (let i = 0; i < n; i++) {
      const w = d === 0 ? 200 : 128, x = d === 0 ? W / 2 - 100 : 16 + i * (W - 32) / 4;
      const isHot = i === hot;
      const g = s("g", { style: `opacity:${isHot ? 1 : 0.45}` });
      g.append(s("rect", { x, y, width: w, height: 30, rx: 6, class: `node-box${isHot ? " hot" : ""}` }));
      const keys = d === 0 ? labels[0].join("  ") : d === depth - 1 ? (isHot ? "kim@… → row 48213" : "rows…") : labels[Math.min(d, 3)][i];
      g.append(s("text", { x: x + w / 2, y: y + 19, "text-anchor": "middle", class: "node-sub", text: keys }));
      svg.append(g);
      if (isHot && d > 0) {
        const line = s("line", { x1: prevX, y1: y - levelH + 42, x2: x + w / 2, y2: y, style: "stroke:var(--accent);stroke-width:2", class: animate ? "draw" : "" });
        svg.insertBefore(line, svg.firstChild);
      }
      if (isHot) prevX = x + w / 2;
    }
    if (d > 0) svg.append(s("text", { x: W - 8, y: y + 46, "text-anchor": "end", class: "node-sub", text: `… ${fmtN(Math.pow(FANOUT, d))} nodes at this level` }));
  }
  svg.append(s("text", { x: 8, y: H - 6, class: "node-sub", text: `${depth} index pages + 1 table page, however big the table gets` }));
  return svg;
}

const QUERIES = [
  { q: "WHERE country = 'IN'", uses: true, why: "Matches the leftmost column of the index." },
  { q: "WHERE country = 'IN' AND created_at > '2026-01-01'", uses: true, why: "Leftmost column by equality, then a range on the next column: the ideal shape." },
  { q: "WHERE created_at > '2026-01-01'", uses: false, why: "Skips the leftmost column. The index is sorted by country first, so dates are scattered across it. Full scan (or a separate index on created_at)." },
  { q: "WHERE country = 'IN' ORDER BY created_at DESC LIMIT 20", uses: true, why: "Inside one country the index is already sorted by date, so the database reads 20 entries and stops. No sort step." },
  { q: "WHERE lower(country) = 'in'", uses: false, why: "A function on the column hides it from the index. Use an expression index on lower(country), or store it normalised." },
];

export default function (root, { id }) {
  const o = { exp: 6, indexed: false, nIdx: 1 };
  const st = stats([{ label: "Rows in table" }, { label: "Rows examined" }, { label: "Pages read" }, { label: "Query time (warm cache)" }]);
  const vis = h("div"), plan = h("pre.log"), bar = h("div", { style: { height: "10px", borderRadius: "5px", background: "var(--sunken)", overflow: "hidden" } }, h("div", { style: { height: "100%", width: "0%", background: "var(--warm)" } }));
  const ins = stats([{ label: "Indexes on the table" }, { label: "Writes per INSERT" }, { label: "Insert cost (relative)" }]);

  function render(animate = false) {
    const n = Math.round(Math.pow(10, o.exp));
    const depth = depthFor(n);
    const scanPages = Math.ceil(n / ROWS_PER_PAGE);
    const pages = o.indexed ? depth + 1 : scanPages;
    const ms = pages * PAGE_MS;
    st.set(0, fmtN(n));
    st.set(1, o.indexed ? "1" : fmtN(n), o.indexed ? "good" : n > 1e5 ? "bad" : "");
    st.set(2, fmtN(pages));
    st.set(3, ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`, o.indexed ? "good" : ms > 50 ? "bad" : "");
    plan.textContent = o.indexed
      ? `EXPLAIN SELECT * FROM users WHERE email = 'kim@example.com';\n\nIndex Scan using users_email_idx on users  (rows=1)\n  Index Cond: (email = 'kim@example.com')`
      : `EXPLAIN SELECT * FROM users WHERE email = 'kim@example.com';\n\nSeq Scan on users  (rows=1)\n  Filter: (email = 'kim@example.com')\n  Rows Removed by Filter: ${fmtN(n - 1)}`;
    vis.replaceChildren(o.indexed ? tree(depth, animate) : h("div", h("p.muted", { style: { margin: "0 0 6px", fontSize: "14px" } }, `Without an index the database reads every page: ${fmtN(scanPages)} pages, checking each row.`), bar));
    if (!o.indexed && animate) {
      const fill = bar.firstChild;
      fill.style.transition = "none"; fill.style.width = "0%";
      requestAnimationFrame(() => { fill.style.transition = `width ${Math.min(2.5, 0.3 + ms / 200)}s linear`; fill.style.width = "100%"; });
    } else if (!o.indexed) bar.firstChild.style.width = "100%";
    const writes = 1 + o.nIdx;
    ins.set(0, String(o.nIdx));
    ins.set(1, `${writes} (row + ${o.nIdx} index${o.nIdx === 1 ? "" : "es"})`);
    ins.set(2, `${writes}×`, writes > 5 ? "warn" : "");
  }

  const qOut = h("div.callout");
  const showQ = (i) => {
    const q = QUERIES[i];
    qOut.className = `callout ${q.uses ? "tip" : "warn"}`;
    qOut.replaceChildren(h("b", q.uses ? "Uses the index" : "Can't use the index"), h("div", q.why));
  };

  root.append(
    section(null, prose(`<p>Your app is slow and the culprit is one query: <code>SELECT * FROM users WHERE email = ?</code>. With a thousand users it was instant; with ten million it takes seconds. The fix is usually one line, an <b>index</b>, and understanding why it works tells you when it won't.</p>`)),
    section("Find one user among millions",
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "Rows in the users table", min: 3, max: 8, step: 0.5, value: o.exp, fmt: (v) => fmtN(Math.pow(10, v)), onInput: (v) => { o.exp = v; render(); } }),
          toggle({ label: "Index on email", onChange: (v) => { o.indexed = v; render(true); } }),
          button("Run query", () => render(true), "primary"),
        ),
        h("div.stage-body", st.el, vis, plan),
      ),
      predict({
        chapter: id,
        question: "With an index, the table grows from 1 million to 100 million rows. How many more page reads does the lookup need?",
        options: ["100× more", "10× more", "About one more", "None at all"],
        answer: 2,
        explain: `<p>Each B-tree node holds hundreds of keys, so every extra level multiplies capacity by ~${FANOUT}. One million rows fits in 3 levels; 100 million needs 4. That logarithmic growth is why indexed lookups stay fast forever while scans grow linearly. Slide the table size and watch the tree gain one level at a time.</p>`,
      }),
    ),
    section("Indexes aren't free",
      prose("<p>Every index is a second sorted copy of some columns. Each <code>INSERT</code>, <code>UPDATE</code> of an indexed column, or <code>DELETE</code> has to update every index too, and each one takes disk and memory.</p>"),
      h("div.stage", h("div.stage-controls", slider({ label: "Indexes on the table", min: 0, max: 10, value: o.nIdx, onInput: (v) => { o.nIdx = v; render(); } })), h("div.stage-body", ins.el)),
      dilemma("A write-heavy events table gets a new dashboard that filters by five different columns.", [
        { name: "Index all five", pros: ["Every dashboard filter is fast"], cons: ["Every insert does 6 writes", "Ingest slows down under load"] },
        { name: "Index the hot one, copy to an analytics store", pros: ["Fast ingest", "Analytics DB (columnar) is built for filters"], cons: ["Another system to run", "Dashboard data lags a little"] },
      ], "Index what your <b>hot queries</b> need, measured with EXPLAIN, and move heavy analytics off the transactional database."),
    ),
    section("Composite indexes and the leftmost rule",
      prose("<p>An index on <code>(country, created_at)</code> is sorted by country, then by date within each country, like a phone book sorted by last name then first name. Pick a query:</p>"),
      h("div.stage", h("div.stage-controls", segmented({ label: "Query against INDEX (country, created_at)", options: QUERIES.map((q, i) => ({ value: i, label: q.q })), value: 0, onChange: showQ })), h("div.stage-body", qOut)),
      callout("tip", "Field guide", "<p>Put equality columns first and range or sort columns last. Run <code>EXPLAIN ANALYZE</code> before and after. Watch for functions on columns, leading wildcards (<code>LIKE '%kim'</code>) and implicit type casts, which all hide the index.</p>"),
    ),
    section("Try it on your machine",
      code({
        "Python (sqlite3)": `import sqlite3, time, random

db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, country TEXT)")
db.executemany("INSERT INTO users (email, country) VALUES (?, ?)",
               ((f"user{i}@example.com", random.choice(["IN", "US", "DE"])) for i in range(1_000_000)))

def timed(q, *args):
    t = time.perf_counter(); db.execute(q, args).fetchall()
    return (time.perf_counter() - t) * 1000

q = "SELECT * FROM users WHERE email = ?"
print("scan ", round(timed(q, "user777777@example.com"), 2), "ms")
db.execute("CREATE INDEX users_email ON users(email)")
print("index", round(timed(q, "user777777@example.com"), 3), "ms")
print(db.execute("EXPLAIN QUERY PLAN " + q, ("x",)).fetchall())`,
        "PostgreSQL": `CREATE INDEX CONCURRENTLY users_email_idx ON users (email);  -- doesn't lock writes

EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'kim@example.com';

-- composite: equality first, range/sort last
CREATE INDEX orders_country_created_idx ON orders (country, created_at DESC);

-- find indexes nobody uses (they still cost every write)
SELECT relname, indexrelname, idx_scan FROM pg_stat_user_indexes ORDER BY idx_scan;`,
      }),
    ),
  );
  render();
  showQ(0);
}
