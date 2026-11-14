import { h, s } from "../lib/core.js";
import { slider, predict, code, dilemma, callout, section, prose, button } from "../lib/widgets.js";

// The order lifecycle as data. Everything else (diagram, buttons, code) is derived from it.
const STATES = {
  cart: { label: "Cart", x: 58, y: 60 },
  placed: { label: "Placed", x: 208, y: 60 },
  paid: { label: "Paid", x: 358, y: 60 },
  shipped: { label: "Shipped", x: 508, y: 60 },
  delivered: { label: "Delivered", x: 658, y: 60 },
  cancelled: { label: "Cancelled", x: 280, y: 190, terminal: true },
  returned: { label: "Returned", x: 658, y: 190 },
  refunded: { label: "Refunded", x: 508, y: 190, terminal: true },
};
const TRANSITIONS = [
  { from: "cart", event: "place", to: "placed" },
  { from: "placed", event: "pay", to: "paid", effect: "charge card, email receipt" },
  { from: "placed", event: "cancel", to: "cancelled" },
  { from: "paid", event: "cancel", to: "cancelled", effect: "refund payment" },
  { from: "paid", event: "ship", to: "shipped", effect: "notify courier, email tracking link" },
  { from: "shipped", event: "deliver", to: "delivered" },
  { from: "delivered", event: "return", to: "returned", guard: "within 30 days of delivery" },
  { from: "returned", event: "refund", to: "refunded", effect: "refund payment" },
];
const EVENTS = [...new Set(TRANSITIONS.map((t) => t.event))];

function diagram(current, lastEdge) {
  const svg = s("svg", { viewBox: "0 0 720 240", role: "img", "aria-label": `Order state machine, current state ${current}` });
  const defs = s("defs");
  for (const [id, col] of [["arr", "var(--ink-3)"], ["arr-hot", "var(--accent)"]])
    defs.append(s("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, s("path", { d: "M0,0 L10,5 L0,10 z", style: `fill:${col}` })));
  svg.append(defs);
  for (const t of TRANSITIONS) {
    const a = STATES[t.from], b = STATES[t.to];
    const hot = lastEdge === t;
    const avail = t.from === current;
    // clip the line to each box's edge (boxes are 100 × 40)
    const dx = b.x - a.x, dy = b.y - a.y;
    const edge = (gap) => Math.min(dx ? (50 + gap) / Math.abs(dx) : Infinity, dy ? (20 + gap) / Math.abs(dy) : Infinity);
    const k1 = edge(2), k2 = edge(6);
    const x1 = a.x + dx * k1, y1 = a.y + dy * k1, x2 = b.x - dx * k2, y2 = b.y - dy * k2;
    svg.append(s("line", { x1, y1, x2, y2, style: `stroke:${hot ? "var(--accent)" : avail ? "var(--ink-2)" : "var(--ink-3)"};stroke-width:${hot ? 3 : avail ? 2 : 1.2};opacity:${hot || avail ? 1 : 0.55}`, "marker-end": `url(#${hot ? "arr-hot" : "arr"})` }));
    // label: above horizontal edges, beside the others
    const len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
    const off = Math.abs(dy) < 1 ? 0 : 12;
    const lx = (x1 + x2) / 2 + (Math.abs(dy) < 1 ? 0 : nx * off * (dx < 0 ? -1 : 1)), ly = (y1 + y2) / 2 + (Math.abs(dy) < 1 ? -14 : ny * off);
    svg.append(s("text", { x: lx, y: ly + 4, "text-anchor": Math.abs(dy) < 1 ? "middle" : dx <= 0 ? "end" : "start", class: "node-sub", style: avail ? "fill:var(--ink);font-weight:600" : "", text: t.event + (t.guard ? " [guard]" : "") }));
  }
  for (const [id, st] of Object.entries(STATES)) {
    const on = id === current;
    svg.append(s("rect", { x: st.x - 50, y: st.y - 20, width: 100, height: 40, rx: st.terminal ? 4 : 20, class: `node-box${on ? " hot" : ""}`, style: on ? "fill:var(--accent);stroke:var(--accent)" : "" }));
    svg.append(s("text", { x: st.x, y: st.y + 5, "text-anchor": "middle", class: "node-label", style: on ? "fill:var(--accent-ink)" : "", text: st.label }));
  }
  return svg;
}

export default function (root, { id }) {
  let state = "cart", last = null, days = 5;
  const history = [];
  const dia = h("div"), log = h("pre.log"), btns = h("div.row"), hist = h("pre.log", { style: { maxHeight: "140px" } });

  function fire(event, replay = false) {
    const t = TRANSITIONS.find((x) => x.from === state && x.event === event);
    if (!t) {
      if (!replay) log.prepend(line(`✗ ${event} rejected: an order that is "${state}" can't ${event}`, "bad"));
      return render();
    }
    if (t.guard && days > 30) {
      if (!replay) log.prepend(line(`✗ ${event} blocked by guard: delivered ${days} days ago (limit 30)`, "bad"));
      return render();
    }
    const from = state;
    state = t.to; last = t;
    if (!replay) {
      history.push(event);
      log.prepend(line(`✓ ${from} --${event}--> ${state}${t.effect ? `   (side effect: ${t.effect})` : ""}`, "good"));
    }
    render();
  }
  const line = (txt, tone) => h("div", { style: { color: tone === "bad" ? "var(--bad)" : "var(--good)" } }, txt);
  function render() {
    dia.replaceChildren(diagram(state, last));
    btns.replaceChildren(...EVENTS.map((e) => {
      const ok = TRANSITIONS.some((t) => t.from === state && t.event === e);
      return h(`button.btn${ok ? ".primary" : ""}`, { type: "button", onclick: () => fire(e) }, e);
    }));
    hist.textContent = history.length ? history.map((e, i) => `${i + 1}. ${e}`).join("\n") : "(no events yet)";
  }
  function replay() {
    state = "cart"; last = null;
    log.prepend(line(`↻ replaying ${history.length} stored events from scratch…`, "good"));
    for (const e of history) fire(e, true);
    log.prepend(line(`↻ rebuilt state: ${state}`, "good"));
  }

  // The "boolean flags" version: no rules, any combination
  const flags = { paid: false, shipped: false, delivered: false, cancelled: false };
  const flagOut = h("div");
  const flagBtns = h("div.row", Object.keys(flags).map((f) => {
    const b = h("button.btn", { type: "button", "aria-pressed": "false", onclick: () => { flags[f] = !flags[f]; b.setAttribute("aria-pressed", String(flags[f])); b.classList.toggle("primary", flags[f]); renderFlags(); } }, `${f} = ${flags[f]}`);
    return b;
  }));
  function renderFlags() {
    flagBtns.querySelectorAll("button").forEach((b, i) => (b.textContent = `${Object.keys(flags)[i]} = ${Object.values(flags)[i]}`));
    const { paid, shipped, delivered, cancelled } = flags;
    const problems = [];
    if (shipped && !paid) problems.push("shipped but never paid");
    if (delivered && !shipped) problems.push("delivered but never shipped");
    if (cancelled && (shipped || delivered)) problems.push("cancelled and shipped at the same time");
    flagOut.replaceChildren(problems.length
      ? h("div.callout.warn", h("b", "Impossible order"), h("div", `This object is ${problems.join(", and ")}. Nothing in the code stopped it.`))
      : h("div.callout.tip", h("b", "Looks valid"), h("div", "…this time. Keep clicking.")));
  }

  const daysSl = slider({ label: "Days since delivery", min: 0, max: 60, value: days, fmt: (v) => `${v} days`, onInput: (v) => { days = v; } });

  root.append(
    section(null, prose(`<p>Low-level design is about the shape of the code <i>inside</i> a service. One of the most useful shapes is the <b>state machine</b>: an object can be in exactly one of a few named states, and only listed events move it between them. An order, a payment, a subscription, a support ticket, a document review: they are all state machines whether you write them that way or not.</p>`)),
    section("Drive an order through its life",
      h("div.stage",
        h("div.stage-controls", daysSl, button("Replay event history", replay), button("Reset", () => { state = "cart"; last = null; history.length = 0; log.replaceChildren(); render(); })),
        h("div.stage-body", dia, h("div", h("div.eyebrow", "Events (highlighted ones are legal right now)"), btns), h("div.split", h("div", h("div.eyebrow", "What happened"), log), h("div", h("div.eyebrow", "Stored event history"), hist))),
      ),
      callout("tip", "Try this", "<p>Press <b>ship</b> while the order is in the cart. Then take it all the way to delivered, set the slider past 30 days and press <b>return</b>. Finally, replay the history: the current state is rebuilt from the list of events alone, which is the core idea of <b>event sourcing</b>.</p>"),
    ),
    section("The same order as boolean flags",
      prose("<p>The common alternative is a handful of booleans on the order row. Click them in any order:</p>"),
      h("div.stage", h("div.stage-body", flagBtns, flagOut)),
      predict({
        chapter: id,
        question: "With 4 booleans (paid, shipped, delivered, cancelled), how many combinations can an order be in, and how many make business sense?",
        options: ["4 combinations, all valid", "8 combinations, 8 valid", "16 combinations, about 6 valid", "Infinite"],
        answer: 2,
        explain: "<p>2⁴ = 16 combinations, but only about 6 describe a real order. The other 10 are bugs waiting for the right sequence of API calls. A single <code>status</code> field plus a transition table makes those 10 impossible to store: “make illegal states unrepresentable”.</p>",
      }),
    ),
    section("Design notes",
      prose(`<ul>
<li><b>One field, one source of truth.</b> Store <code>status</code>, not flags. Add a database CHECK constraint on its allowed values.</li>
<li><b>Transitions are data.</b> A table of (from, event, to, guard, effect) is easy to test, draw and review with non-engineers.</li>
<li><b>Guards</b> are conditions (“within 30 days”); <b>effects</b> are side effects that run on a transition (charge, email). Run effects after the state change commits, ideally through an outbox or queue (chapter 2.3) so a crash can't charge without recording it.</li>
<li><b>Concurrency:</b> two requests may try to ship and cancel at once. Use <code>UPDATE … SET status='shipped' WHERE id=? AND status='paid'</code> and check the row count: only one wins.</li>
</ul>`),
      dilemma("Store the current state, or the events?", [
        { name: "State column (CRUD)", pros: ["Simple queries", "What every ORM expects"], cons: ["History is lost unless you add an audit table"] },
        { name: "Event sourcing", pros: ["Full history and audit for free", "Rebuild any past state, add new projections later"], cons: ["Queries need projections", "Changing event formats is hard"] },
      ], "Most systems store state plus an append-only history table. Full event sourcing pays off where the history is the product: ledgers, banking, collaborative editing."),
    ),
    section("In code",
      code({
        TypeScript: `type State = "cart" | "placed" | "paid" | "shipped" | "delivered" | "cancelled" | "returned" | "refunded";
type Event = "place" | "pay" | "cancel" | "ship" | "deliver" | "return" | "refund";

const transitions: Record<State, Partial<Record<Event, State>>> = {
  cart:      { place: "placed" },
  placed:    { pay: "paid", cancel: "cancelled" },
  paid:      { ship: "shipped", cancel: "cancelled" },
  shipped:   { deliver: "delivered" },
  delivered: { return: "returned" },
  returned:  { refund: "refunded" },
  cancelled: {}, refunded: {},
};

export function next(state: State, event: Event): State {
  const to = transitions[state][event];
  if (!to) throw new Error(\`Can't \${event} an order that is \${state}\`);
  return to;
}

// Persist with an optimistic check so concurrent requests can't both win:
// UPDATE orders SET status = $to WHERE id = $id AND status = $from`,
        Python: `from enum import Enum

class S(str, Enum):
    CART = "cart"; PLACED = "placed"; PAID = "paid"; SHIPPED = "shipped"
    DELIVERED = "delivered"; CANCELLED = "cancelled"; RETURNED = "returned"; REFUNDED = "refunded"

TRANSITIONS = {
    (S.CART, "place"): S.PLACED,
    (S.PLACED, "pay"): S.PAID,       (S.PLACED, "cancel"): S.CANCELLED,
    (S.PAID, "ship"): S.SHIPPED,     (S.PAID, "cancel"): S.CANCELLED,
    (S.SHIPPED, "deliver"): S.DELIVERED,
    (S.DELIVERED, "return"): S.RETURNED,
    (S.RETURNED, "refund"): S.REFUNDED,
}

def apply(order, event: str):
    to = TRANSITIONS.get((order.status, event))
    if to is None:
        raise ValueError(f"can't {event} an order that is {order.status}")
    if event == "return" and order.days_since_delivery() > 30:
        raise ValueError("return window closed")
    rows = db.execute("UPDATE orders SET status=%s WHERE id=%s AND status=%s",
                      (to, order.id, order.status)).rowcount
    if rows == 0:
        raise ConflictError("someone else changed this order")   # lost the race
    outbox.add(order.id, event)          # side effects run from the outbox`,
        SQL: `CREATE TABLE orders (
  id     BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'cart'
         CHECK (status IN ('cart','placed','paid','shipped','delivered','cancelled','returned','refunded'))
);
CREATE TABLE order_events (           -- append-only history
  order_id BIGINT REFERENCES orders(id),
  event    TEXT NOT NULL,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);`,
      }),
    ),
  );
  render();
  renderFlags();
}
