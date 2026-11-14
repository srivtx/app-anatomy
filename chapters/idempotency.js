import { h, loop, rng } from "../lib/core.js";
import { segmented, toggle, stats, predict, code, dilemma, callout, section, prose, button, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// A checkout charges a card. Something goes wrong in the network, the client
// retries, and we count how many times the customer was charged.
// Steps: [from, to, label, kind] where from/to are lane indexes 0 client, 1 API, 2 database;
// from === to is a note on that lane. kind: "lost", "charge", "dedupe", "crash", "ok".
const LANES = ["Client (app)", "Payments API", "Database"];

const SCENARIOS = {
  reqLost: {
    label: "Request lost",
    plain: [[0, 1, "POST /charge $40", "lost"], [0, 0, "no answer after 2 s"], [0, 1, "retry POST /charge $40"], [1, 2, "INSERT charge", "charge"], [1, 0, "200 OK", "ok"]],
    keyed: [[0, 1, "POST /charge $40  key=k7", "lost"], [0, 0, "no answer after 2 s"], [0, 1, "retry, same key k7"], [1, 2, "INSERT key k7 + charge (one txn)", "charge"], [1, 0, "200 OK", "ok"]],
  },
  respLost: {
    label: "Response lost",
    plain: [[0, 1, "POST /charge $40"], [1, 2, "INSERT charge", "charge"], [1, 0, "200 OK", "lost"], [0, 0, "no answer after 2 s"], [0, 1, "retry POST /charge $40"], [1, 2, "INSERT charge", "charge"], [1, 0, "200 OK", "ok"]],
    keyed: [[0, 1, "POST /charge $40  key=k7"], [1, 2, "INSERT key k7 + charge (one txn)", "charge"], [1, 0, "200 OK", "lost"], [0, 0, "no answer after 2 s"], [0, 1, "retry, same key k7"], [1, 2, "key k7 exists → stored response", "dedupe"], [1, 0, "200 OK (replayed)", "ok"]],
  },
  crash: {
    label: "Server crashes mid-request",
    plain: [[0, 1, "POST /charge $40"], [1, 2, "INSERT charge", "charge"], [1, 1, "process crashes before replying", "crash"], [0, 0, "connection reset"], [0, 1, "retry POST /charge $40"], [1, 2, "INSERT charge", "charge"], [1, 0, "200 OK", "ok"]],
    keyed: [[0, 1, "POST /charge $40  key=k7"], [1, 2, "INSERT key k7 + charge (one txn)", "charge"], [1, 1, "process crashes before replying", "crash"], [0, 0, "connection reset"], [0, 1, "retry, same key k7"], [1, 2, "key k7 exists → stored response", "dedupe"], [1, 0, "200 OK (replayed)", "ok"]],
  },
  double: {
    label: "Double tap on Pay",
    plain: [[0, 1, "POST /charge $40"], [0, 1, "POST /charge $40 (second tap)"], [1, 2, "INSERT charge", "charge"], [1, 2, "INSERT charge", "charge"], [1, 0, "200 OK", "ok"], [1, 0, "200 OK", "ok"]],
    keyed: [[0, 1, "POST /charge $40  key=k7"], [0, 1, "POST, same key k7 (second tap)"], [1, 2, "INSERT key k7 + charge (one txn)", "charge"], [1, 2, "INSERT key k7 → unique violation", "dedupe"], [1, 0, "200 OK", "ok"], [1, 0, "409 in progress / replayed 200", "ok"]],
  },
};

// Many checkouts at once: each message is lost with probability p, clients retry
// up to 3 times. Returns how many customers were charged 0, 1, or 2+ times.
function batch(keyed, p, n = 2000) {
  const r = rng(9); let zero = 0, once = 0, more = 0;
  for (let i = 0; i < n; i++) {
    let charges = 0, done = false, seen = false;
    for (let a = 0; a < 4 && !done; a++) {
      if (r() < p) continue;                       // request lost
      if (!(keyed && seen)) charges++;
      seen = true;
      if (r() < p * 0.5) continue;                 // crash before replying
      if (r() < p) continue;                       // response lost
      done = true;
    }
    charges === 0 ? zero++ : charges === 1 ? once++ : more++;
  }
  return { zero, once, more, n };
}

export default function (root, { id }) {
  let scen = "respLost", keyed = false, shown = 0, clock = 0, loss = 0.05;
  const fc = flowCanvas({ width: 720, height: 340, label: "A sequence diagram of a payment and its retries" });
  const st = stats([{ label: "Times the customer was charged" }, { label: "What the client saw" }]);
  const bst = stats([{ label: "Charged exactly once" }, { label: "Charged twice or more" }, { label: "Never charged (gave up)" }]);
  const steps = () => SCENARIOS[scen][keyed ? "keyed" : "plain"];

  function draw() {
    const c = fc.colors; fc.clear();
    const xs = [90, 360, 630], s = steps();
    LANES.forEach((name, i) => {
      fc.box(xs[i] - 70, 8, 140, 30, { fill: c.sunken, stroke: c.line, r: 8 });
      fc.text(name, xs[i], 23, { align: "center", size: 12 });
      fc.line(xs[i], 40, xs[i], 330, { color: c.line, dash: [4, 5], lw: 1 });
    });
    const gap = Math.min(40, 285 / s.length);
    s.slice(0, shown).forEach(([a, b, label, kind], k) => {
      const y = 58 + k * gap, col = kind === "lost" || kind === "crash" ? c.bad : kind === "charge" ? c.warm : kind === "dedupe" ? c.good : c.c1;
      if (a === b) {
        const bx = Math.max(6, Math.min(714 - 220, xs[a] - 110));
        fc.box(bx, y - 11, 220, 22, { fill: kind === "crash" ? c.bad : c.surface, stroke: col, r: 11 });
        fc.text(label, bx + 110, y, { align: "center", size: 10.5, weight: 600, color: kind === "crash" ? "#fff" : c["ink-2"] });
        return;
      }
      const x0 = xs[a], x1 = kind === "lost" ? (xs[a] + xs[b]) / 2 : xs[b], dir = Math.sign(xs[b] - xs[a]);
      fc.line(x0, y + 6, x1, y + 6, { color: col, lw: 2, dash: kind === "lost" ? [5, 4] : null });
      if (kind === "lost") { fc.text("✕", x1, y + 6, { align: "center", size: 15, color: c.bad }); }
      else { const ctx = fc.ctx; ctx.beginPath(); ctx.moveTo(x1, y + 6); ctx.lineTo(x1 - dir * 8, y + 1.5); ctx.lineTo(x1 - dir * 8, y + 10.5); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); }
      fc.text(label, (xs[a] + xs[b]) / 2, y - 5, { align: "center", size: 10.5, weight: 600, color: kind === "charge" ? c.warm : kind === "dedupe" ? c.good : c.ink });
    });
    const done = s.slice(0, shown), charges = done.filter((x) => x[3] === "charge").length;
    st.set(0, shown ? String(charges) : "–", charges > 1 ? "bad" : charges === 1 ? "good" : "");
    const last = done.filter(([a, b, , k]) => b === 0 && a !== 0 && k !== "lost").pop();
    st.set(1, last ? last[2] : shown ? "waiting…" : "–");
  }
  function play() { shown = 0; clock = 0; }
  const lp = loop((dt) => { clock += dt; const want = Math.min(steps().length, Math.floor(clock / 0.7)); if (want !== shown) { shown = want; draw(); } }, fc.el);

  function runBatch() {
    const a = batch(keyed, loss);
    bst.set(0, `${((a.once / a.n) * 100).toFixed(1)}%`, "good");
    bst.set(1, `${((a.more / a.n) * 100).toFixed(1)}%`, a.more ? "bad" : "good");
    bst.set(2, `${((a.zero / a.n) * 100).toFixed(2)}%`, a.zero ? "warn" : "good");
  }

  root.append(
    section(null, prose(`<p>Networks fail in an annoying way: when a request times out, the client cannot tell whether it never arrived, or arrived, did its work, and only the reply got lost. If it retries, the work might happen twice. For a “like” that's harmless. For a payment it's a support ticket and a refund. The fix is to make the request <b>idempotent</b>: doing it twice has the same effect as doing it once.</p>`)),
    section("One checkout, four ways to fail",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "What goes wrong", options: Object.entries(SCENARIOS).map(([value, s]) => ({ value, label: s.label })), value: scen, onChange: (v) => { scen = v; play(); } }),
          toggle({ label: "Send an Idempotency-Key", onChange: (v) => { keyed = v; play(); runBatch(); } }),
          button("Replay", play, "primary"),
        ),
        h("div.stage-body", st.el, fc.el),
      ),
      callout("tip", "Things to try", "<p>Play each failure without a key: only “Request lost” is safe to retry. Then turn on the key and replay them all. The client generates one key per checkout (not per attempt), and the server stores the key in the same database transaction as the charge, so “did this already happen?” and “make it happen” can never disagree.</p>"),
    ),
    section("Now 2,000 checkouts",
      prose(`<p>Each message is lost with probability ${Math.round(loss * 100)}%, servers sometimes crash before replying, and clients retry up to three times. The idempotency toggle above applies here too.</p>`),
      h("div.stage", h("div.stage-controls", button("Run 2,000 checkouts", runBatch, "primary")), h("div.stage-body", bst.el)),
      predict({
        chapter: id,
        question: "A message queue promises “at-least-once delivery”. What does your consumer need to do to process each order exactly once?",
        options: ["Nothing, the queue handles it", "Acknowledge before processing", "Record processed message IDs and skip repeats", "Switch to at-most-once delivery"],
        answer: 2,
        explain: "<p>Exactly-once delivery across a network isn't possible in general; exactly-once <i>effect</i> is. Take at-least-once delivery and make the consumer idempotent: store the message ID (or a natural key like order_id) in the same transaction as the side effect, and skip IDs you've seen. Kafka's “exactly-once” works the same way inside Kafka, with transactional writes and offsets, and stops at the edge of Kafka.</p>",
      }),
    ),
    section("Delivery guarantees, honestly",
      table(["Guarantee", "Means", "Risk", "Use"], [
        ["At most once", "Send, never retry", "Lost messages", "Metrics, logs you can afford to lose"],
        ["At least once", "Retry until acknowledged", "Duplicates", "Almost everything, with idempotent handlers"],
        ["Exactly once (effect)", "At least once + dedupe in the same transaction as the effect", "Dedupe table grows; keep keys ~24 h to 30 days", "Payments, orders, emails, inventory"],
      ]),
      dilemma("A handler charges a card and then publishes “OrderPaid” to a queue. The process dies between the two. Now what?", [
        { name: "Publish first, then charge", pros: ["Never miss the event"], cons: ["Event for a charge that may never happen"] },
        { name: "Transactional outbox", pros: ["Charge row and event row commit together", "A relay publishes outbox rows, at least once"], cons: ["A relay process to run", "Consumers must dedupe"] },
      ], "The outbox pattern: write the event into an <code>outbox</code> table in the same transaction as the business change, and let a separate relay (or Debezium reading the write-ahead log) publish it. No dual writes, no lost events."),
      callout("warn", "Keys must be per operation, not per attempt", "<p>Generate the key when the user starts the checkout and reuse it on every retry. A fresh UUID per HTTP attempt dedupes nothing. Also store the request body's hash with the key: a retry with the same key but a different amount should be rejected (Stripe returns 400), not replayed.</p>"),
    ),
    section("In code",
      code({
        "Server (Postgres)": `CREATE TABLE idempotency_keys (
  key          text PRIMARY KEY,
  request_hash text NOT NULL,
  status       int,            -- NULL while in progress
  response     jsonb,
  created_at   timestamptz DEFAULT now()
);

-- in the handler, one transaction:
BEGIN;
INSERT INTO idempotency_keys (key, request_hash) VALUES ($1, $2)
  ON CONFLICT (key) DO NOTHING
  RETURNING key;                 -- no row returned = we've seen this key
-- new key: do the work
INSERT INTO charges (order_id, amount_cents) VALUES ($3, $4);
UPDATE idempotency_keys SET status = 200, response = $5 WHERE key = $1;
COMMIT;
-- seen key: if status IS NULL return 409 (in progress), else return the stored response`,
        "Client": `const key = crypto.randomUUID();          // once per checkout, kept across retries

async function pay(order) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch("/api/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(order),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status !== 409 && res.status < 500) return res.json();
    } catch { /* timeout or network error: safe to retry with the same key */ }
    await new Promise((r) => setTimeout(r, Math.random() * 250 * 2 ** attempt));
  }
  throw new Error("payment status unknown: check before charging again");
}`,
        "Idempotent consumer": `def handle(msg):
    with db.transaction() as tx:
        inserted = tx.execute(
            "INSERT INTO processed (message_id) VALUES (%s) ON CONFLICT DO NOTHING",
            [msg.id]).rowcount
        if not inserted:
            return                      # duplicate delivery: already done
        tx.execute("UPDATE stock SET qty = qty - %s WHERE sku = %s", [msg.qty, msg.sku])
    msg.ack()                           # ack after commit; a crash here means a harmless redelivery`,
        "Transactional outbox": `with db.transaction() as tx:
    tx.execute("UPDATE orders SET status = 'paid' WHERE id = %s", [order_id])
    tx.execute("INSERT INTO outbox (id, topic, payload) VALUES (%s, 'order.paid', %s)",
               [uuid4(), json.dumps({"order_id": order_id})])

# relay, running separately (or use Debezium on the WAL)
while True:
    rows = db.query("SELECT * FROM outbox WHERE sent_at IS NULL ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED")
    for row in rows:
        broker.publish(row.topic, row.payload, message_id=row.id)   # consumers dedupe on id
        db.execute("UPDATE outbox SET sent_at = now() WHERE id = %s", [row.id])`,
      }),
    ),
  );
  draw();
  runBatch();
  lp.start();
}
