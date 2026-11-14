import { h, rng } from "../lib/core.js";
import { segmented, stats, predict, code, callout, section, prose, button, table } from "../lib/widgets.js";

// Build a trace for GET /checkout. Each span: { name, svc, start, dur, depth, culprit?, err? }
const PROBLEMS = {
  none: { label: "Healthy", hint: "Nothing is wrong. This is what normal looks like: learn its shape." },
  nplus1: { label: "Slow: mystery A", hint: "Many tiny database calls one after another: the N+1 query pattern.", fix: "Load the cart's items in one query (a JOIN or WHERE id IN (…)), or batch with a DataLoader." },
  lock: { label: "Slow: mystery B", hint: "One query waited 900 ms for a row lock held by another transaction.", fix: "Find who holds the lock (pg_locks / pg_stat_activity), shorten that transaction, or avoid locking the hot row." },
  dep: { label: "Slow: mystery C", hint: "The external tax API is slow today; everything waits for it.", fix: "Set a timeout, cache tax rates, and degrade gracefully (estimate the tax, finalise it later)." },
  retry: { label: "Slow: mystery D", hint: "Inventory calls fail and are retried three times, with backoff.", fix: "Look at why inventory fails (its own trace), cap the retries, and add a circuit breaker." },
  serial: { label: "Slow: mystery E", hint: "Pricing, inventory and recommendations are called one after another, but none depends on the others.", fix: "Call independent services in parallel (Promise.all), so the request takes as long as the slowest one, not the sum." },
};

export function buildTrace(kind, seed = 1) {
  const r = rng(seed), J = (ms) => ms * (0.85 + 0.3 * r());
  const spans = [];
  const add = (name, svc, start, dur, depth, extra = {}) => { const s = { name, svc, start, dur, depth, ...extra }; spans.push(s); return s; };
  let t = 0;
  const root = add("GET /checkout", "gateway", 0, 0, 0);
  const co = add("checkout.handle", "checkout", 2, 0, 1);
  t = 4;
  const auth = add("auth.verifyToken", "auth", t, J(6), 2); t += auth.dur + 1;
  // cart
  const cart = add("cart.load", "cart", t, 0, 2); let ct = t + 1;
  if (kind === "nplus1") {
    const q0 = add("SELECT * FROM carts WHERE user_id = $1", "db", ct, J(3), 3); ct += q0.dur + 0.4;
    for (let i = 0; i < 38; i++) { const q = add(`SELECT * FROM items WHERE id = $1   (item ${i + 1})`, "db", ct, J(5.5), 3, { culprit: true, group: "n1" }); ct += q.dur + 0.6; }
  } else {
    const q0 = add("SELECT * FROM carts WHERE user_id = $1", "db", ct, J(3), 3); ct += q0.dur + 0.4;
    const q1 = add("SELECT * FROM items WHERE id = ANY($1)", "db", ct, J(kind === "lock" ? 4 : 6), 3); ct += q1.dur + 0.4;
    if (kind === "lock") { const q2 = add("UPDATE carts SET touched_at = now() …  (waiting for lock)", "db", ct, J(900), 3, { culprit: true }); ct += q2.dur; }
  }
  cart.dur = ct - cart.start + 1; t = ct + 2;
  // pricing / inventory / recommendations
  const calls = [["pricing.quote", "pricing", 30], ["inventory.reserve", "inventory", 25], ["recs.forCart", "recs", 40]];
  const parallel = kind !== "serial";
  let maxEnd = t;
  for (const [name, svc, base] of calls) {
    const st = parallel ? t : maxEnd;
    let d = J(base);
    if (kind === "serial") d = J(base * 1.0);
    const s = add(name, svc, st, d, 2, kind === "serial" ? { culprit: true } : {});
    if (svc === "pricing") {
      const tax = add("POST api.taxservice.example/v2/rate", "tax (external)", st + 3, J(kind === "dep" ? 1400 : 45), 3, kind === "dep" ? { culprit: true } : {});
      s.dur = tax.start + tax.dur - st + 3;
    }
    if (svc === "inventory" && kind === "retry") {
      let it = st + 1;
      for (let k = 0; k < 4; k++) {
        const a = add(`inventory.reserve attempt ${k + 1}`, "inventory", it, J(k < 3 ? 120 : 30), 3, k < 3 ? { culprit: true, err: true } : {});
        it += a.dur + (k < 3 ? 100 * 2 ** k : 0);
      }
      s.dur = it - st + 2;
    }
    maxEnd = Math.max(maxEnd, st + s.dur);
  }
  t = maxEnd + 2;
  const w = add("orders.createDraft", "orders", t, J(12), 2); t += w.dur + 2;
  co.dur = t - co.start; root.dur = t + 2;
  return spans;
}

function msLabel(s, total) {
  const a = s.start / total, b = (s.start + s.dur) / total, txt = `${s.dur < 10 ? s.dur.toFixed(1) : Math.round(s.dur)} ms`;
  if (b < 0.86) return h("span.ob-ms", { style: { left: `${b * 100 + 0.6}%` } }, txt);
  if (a > 0.14) return h("span.ob-ms", { style: { right: `${(1 - a) * 100 + 0.6}%` } }, txt);
  return h("span.ob-ms.in", { style: { right: "1%" } }, txt);
}
const COLORS = { gateway: 6, checkout: 1, auth: 5, cart: 3, db: 4, pricing: 2, "tax (external)": 2, inventory: 3, recs: 5, orders: 1 };

export default function (root, { id }) {
  let kind = "none", answered = false;
  const box = h("div.ob-trace"), feedback = h("div.ob-feedback");
  const st = stats([{ label: "Request took" }, { label: "Spans" }, { label: "Time inside the database" }]);
  const metricsEl = h("div.ob-pillars");

  function render() {
    const spans = buildTrace(kind), total = spans[0].dur;
    answered = false;
    feedback.className = "ob-feedback"; feedback.textContent = kind === "none" ? PROBLEMS.none.hint : "Click the span you think is responsible.";
    st.set(0, `${Math.round(total)} ms`, total > 130 ? "bad" : "good");
    st.set(1, String(spans.length));
    st.set(2, `${Math.round(spans.filter((s) => s.svc === "db").reduce((a, s) => a + s.dur, 0))} ms`);
    const shownSpans = spans.length > 60 ? spans.slice(0, 60) : spans;
    box.replaceChildren(
      h("div.ob-axis", ...[0, 0.25, 0.5, 0.75, 1].map((f) => h("span", { style: { left: `${f * 100}%` } }, `${Math.round(total * f)} ms`))),
      ...shownSpans.map((s) => {
        const row = h("button.ob-row", { type: "button", title: `${s.name}: ${s.dur.toFixed(1)} ms`, onclick: () => pick(s, row) },
          h("span.ob-name", { style: { paddingLeft: `${s.depth * 12}px` } }, h("span.ob-svc", { style: { "--pc": `var(--c${COLORS[s.svc] || 1})` } }, s.svc), s.name),
          h("span.ob-lane", h(`span.ob-bar${s.err ? ".err" : ""}`, { style: { left: `${(s.start / total) * 100}%`, width: `${Math.max(0.4, (s.dur / total) * 100)}%`, "--pc": `var(--c${COLORS[s.svc] || 1})` } }), msLabel(s, total)));
        return row;
      }),
    );
    const slowMetric = total > 130;
    metricsEl.replaceChildren(
      h("div.ob-pillar", h("b", "Metrics say"), h("p", slowMetric ? `p99 latency of /checkout jumped from ~90 ms to ~${Math.round(total)} ms. ${kind === "retry" ? "Inventory 5xx rate is up." : "Error rate is flat."}` : "p99 latency ~90 ms, error rate 0.3%. All normal."), h("small", "Tells you that something is wrong, and roughly where.")),
      h("div.ob-pillar", h("b", "Logs say"), h("p.mono", kind === "retry" ? "WARN inventory.reserve failed (503), retrying in 100ms\nWARN … retrying in 200ms\nWARN … retrying in 400ms" : kind === "lock" ? "INFO checkout ok user=4821 duration=1083ms" : kind === "dep" ? "INFO checkout ok user=4821 duration=1561ms" : `INFO checkout ok user=4821 duration=${Math.round(total)}ms`), h("small", "Tells you what one process saw. Often silent about why it was slow.")),
      h("div.ob-pillar", h("b", "The trace says"), h("p", "Exactly which call, in which service, took the time, and what ran in parallel."), h("small", "Tells you why. That's what you're looking at.")),
    );
  }
  function pick(s, row) {
    if (kind === "none" || answered) return;
    const p = PROBLEMS[kind];
    if (s.culprit) {
      answered = true; row.classList.add("hit");
      feedback.className = "ob-feedback good";
      feedback.innerHTML = `<b>Found it.</b> ${p.hint} <br><b>Fix:</b> ${p.fix}`;
    } else {
      row.classList.add("miss");
      feedback.className = "ob-feedback bad";
      feedback.textContent = s.depth <= 1 ? "That span is slow because something inside it is slow. Look at its children." : "Not this one: it's taking its normal time. Look for the widest bars, or for many small bars in a row.";
    }
  }

  root.append(
    section(null, prose(`<p>“The checkout page is slow.” That's how most performance problems arrive. The request touched an API gateway, six services, a database and a third-party API. Which one is slow? <b>Metrics</b> tell you something is wrong. <b>Logs</b> tell you what each process saw. A <b>trace</b> follows one request through every service, with a timed span for each piece of work, so you can see where the time went.</p>
<p>Below is a trace of one checkout request as a waterfall: each row is a span, its bar shows when it started and how long it took. Pick a mystery and click the span you think is responsible.</p>`)),
    section("Find the slow span",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Pick a trace", options: Object.entries(PROBLEMS).map(([value, p]) => ({ value, label: p.label })), value: kind, onChange: (v) => { kind = v; render(); } }),
          button("Show me the answer", () => { if (kind === "none") return; const p = PROBLEMS[kind]; feedback.className = "ob-feedback good"; feedback.innerHTML = `${p.hint}<br><b>Fix:</b> ${p.fix}`; box.querySelectorAll(".ob-row").forEach((r, i) => { if (buildTrace(kind)[i]?.culprit) r.classList.add("hit"); }); }),
        ),
        h("div.stage-body", st.el, feedback, box),
      ),
      callout("tip", "How to read a waterfall", "<p>Look at the healthy trace first and learn its shape. Then, in a slow one: a single very wide bar means one slow call (a lock, a slow dependency). A staircase of many tiny bars means a loop making calls one at a time (N+1). Bars that could overlap but sit end to end mean work that could run in parallel. Red bars are errors, and repeating red bars with gaps are retries with backoff.</p>"),
      metricsEl,
    ),
    section("Three signals, three jobs",
      table(["Signal", "Answers", "Cost", "Typical tools"], [
        ["Metrics", "Is something wrong? How often, how much? (rates, p99, saturation)", "Cheap: numbers aggregated over time", "Prometheus, Datadog, CloudWatch"],
        ["Logs", "What exactly happened in this process at this moment?", "Grows with traffic; structure them (JSON) and sample", "Loki, Elasticsearch, Cloud Logging"],
        ["Traces", "Where did the time go across services, for this request?", "Usually sampled (1–10%), plus all errors and slow requests", "OpenTelemetry → Jaeger, Tempo, Honeycomb"],
      ]),
      predict({
        chapter: id,
        question: "You sample 1% of traces to save money. A bug makes 0.1% of checkouts take 10 seconds. What should your sampling do?",
        options: ["Nothing: 1% is enough", "Keep 100% of traces that are slow or have errors (tail-based sampling)", "Sample more of the fast traces", "Turn tracing off for checkout"],
        answer: 1,
        explain: "<p>At 1% random sampling you'd keep one in a hundred of an already rare event, and maybe never see it. Tail-based sampling decides after the request finishes: keep everything slow or failed, and a small random share of the rest. The OpenTelemetry Collector's tail-sampling processor does exactly this.</p>",
      }),
    ),
    section("In code",
      code({
        "OpenTelemetry (Node)": `import { trace } from "@opentelemetry/api";
const tracer = trace.getTracer("checkout");

async function loadCart(userId) {
  return tracer.startActiveSpan("cart.load", async (span) => {
    span.setAttribute("user.id", userId);
    try {
      const cart = await db.query("SELECT * FROM carts WHERE user_id = $1", [userId]);   // auto-instrumented: a child span
      span.setAttribute("cart.items", cart.items.length);
      return cart;
    } catch (e) { span.recordException(e); span.setStatus({ code: 2 }); throw e; }
    finally { span.end(); }
  });
}`,
        "Fix the N+1": `// before: one query per item, in a loop (38 round trips)
for (const id of cart.itemIds) items.push(await db.query("SELECT * FROM items WHERE id = $1", [id]));
// after: one round trip
const items = await db.query("SELECT * FROM items WHERE id = ANY($1)", [cart.itemIds]);`,
        "Run independent calls in parallel": `// before: 30 + 25 + 40 ms, one after another
const price = await pricing.quote(cart); const stock = await inventory.reserve(cart); const recs = await recs.forCart(cart);
// after: max(30, 25, 40) ms
const [price, stock, recs] = await Promise.all([pricing.quote(cart), inventory.reserve(cart), recs.forCart(cart)]);`,
        "Tail sampling (OTel Collector)": `processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - { name: errors, type: status_code, status_code: { status_codes: [ERROR] } }
      - { name: slow,   type: latency,     latency: { threshold_ms: 1000 } }
      - { name: rest,   type: probabilistic, probabilistic: { sampling_percentage: 1 } }`,
      }),
    ),
  );
  render();
}
