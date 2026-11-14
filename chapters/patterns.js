import { h } from "../lib/core.js";
import { slider, segmented, toggle, predict, code, dilemma, callout, section, prose, button } from "../lib/widgets.js";

// ---- Adapter: one interface, provider-specific requests (simplified real endpoints) ----
const GATEWAYS = {
  stripe: { name: "Stripe", toRequest: (o) => `POST https://api.stripe.com/v1/payment_intents\nContent-Type: application/x-www-form-urlencoded\n\namount=${Math.round(o.total * 100)}&currency=usd&metadata[order_id]=${o.id}` },
  paypal: { name: "PayPal", toRequest: (o) => `POST https://api-m.paypal.com/v2/checkout/orders\nContent-Type: application/json\n\n${JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: o.id, amount: { currency_code: "USD", value: o.total.toFixed(2) } }] }, null, 2)}` },
  razorpay: { name: "Razorpay", toRequest: (o) => `POST https://api.razorpay.com/v1/orders\nContent-Type: application/json\n\n${JSON.stringify({ amount: Math.round(o.total * 83 * 100), currency: "INR", receipt: o.id }, null, 2)}\n// amount in paise, converted at a sample rate` },
};
// ---- Strategy: interchangeable shipping cost rules ----
const SHIPPING = {
  standard: { name: "Standard", cost: (sub) => 4.99 },
  express: { name: "Express", cost: (sub) => 14.99 },
  freeOver50: { name: "Free over $50", cost: (sub) => (sub >= 50 ? 0 : 6.99) },
};
// ---- Observer: subscribers react to OrderPaid without checkout knowing them ----
const SUBSCRIBERS = {
  email: { name: "Email receipt", react: (o) => `send receipt to ada@example.com for ${o.id}` },
  inventory: { name: "Inventory", react: (o) => `reserve ${o.qty} × SKU-42 in the warehouse` },
  analytics: { name: "Analytics", react: (o) => `track "purchase" value=$${o.total.toFixed(2)}` },
  loyalty: { name: "Loyalty points", react: (o) => `award ${Math.floor(o.total)} points` },
};

function naiveCode(gw, ship, subs) {
  const lines = ["function checkout(order, provider, shipping) {", "  let shippingCost;"];
  Object.keys(SHIPPING).forEach((k, i) => lines.push(`  ${i ? "} else " : ""}if (shipping === "${k}") {`, `    shippingCost = ${k === "freeOver50" ? "order.subtotal >= 50 ? 0 : 6.99" : SHIPPING[k].cost(0)};`));
  lines.push("  }", "  const total = order.subtotal + shippingCost;");
  Object.keys(GATEWAYS).forEach((k, i) => lines.push(`  ${i ? "} else " : ""}if (provider === "${k}") {`, `    // ${GATEWAYS[k].name}-specific request building, auth, error codes…`, `    await ${k}Client.${k === "stripe" ? "paymentIntents.create" : k === "paypal" ? "orders.create" : "orders.create"}({ /* ${k} shape */ });`));
  lines.push("  }");
  for (const k of Object.keys(SUBSCRIBERS)) if (subs[k]) lines.push(`  await ${k}Service.${k === "email" ? "sendReceipt" : k === "inventory" ? "reserve" : k === "analytics" ? "track" : "award"}(order);   // checkout must know about ${SUBSCRIBERS[k].name}`);
  lines.push("}");
  return lines.join("\n");
}
const patternCode = `function checkout(order, gateway: PaymentGateway, shipping: ShippingStrategy) {
  const total = order.subtotal + shipping.cost(order);
  await gateway.charge(order.id, total);
  events.publish("OrderPaid", { ...order, total });
}`;

export default function (root, { id }) {
  const o = { gw: "stripe", ship: "standard", qty: 2, subs: { email: true, inventory: true, analytics: false, loyalty: false } };
  const req = h("pre.log"), events = h("pre.log"), totals = h("div.row", { style: { fontSize: "14.5px" } });
  const naive = h("pre.log", { style: { maxHeight: "300px" } }), naiveCount = h("span.pill.bad"), patternCount = h("span.pill.good");

  function order() {
    const subtotal = 21.25 * o.qty, shipping = SHIPPING[o.ship].cost(subtotal);
    return { id: "ord_1042", qty: o.qty, subtotal, shipping, total: subtotal + shipping };
  }
  function render() {
    const ord = order();
    totals.replaceChildren(h("span", `Subtotal $${ord.subtotal.toFixed(2)}`), h("span.muted", "+"), h("span", `${SHIPPING[o.ship].name} shipping $${ord.shipping.toFixed(2)}`), h("span.muted", "="), h("b", `$${ord.total.toFixed(2)}`));
    req.textContent = `gateway.charge("${ord.id}", ${ord.total.toFixed(2)})   // what checkout calls\n\n// what the ${GATEWAYS[o.gw].name} adapter sends:\n${GATEWAYS[o.gw].toRequest(ord)}`;
    const n = naiveCode(o.gw, o.ship, o.subs);
    naive.textContent = n;
    naiveCount.textContent = `${n.split("\n").length} lines, and growing`;
    patternCount.textContent = `${patternCode.split("\n").length} lines, forever`;
  }
  function pay() {
    const ord = order();
    events.replaceChildren(h("div", { style: { color: "var(--accent)" } }, `publish OrderPaid { id: "${ord.id}", total: ${ord.total.toFixed(2)} }`));
    const active = Object.entries(o.subs).filter(([, on]) => on);
    if (!active.length) events.append(h("div.muted", "  (no subscribers: the event goes nowhere, and checkout doesn't care)"));
    for (const [k] of active) events.append(h("div", `  → ${SUBSCRIBERS[k].name}: ${SUBSCRIBERS[k].react(ord)}`));
  }

  root.append(
    section(null, prose(`<p>Design patterns are names for shapes of code that keep showing up because they solve a recurring problem. Three earn their keep in almost every product: <b>Adapter</b> (wrap someone else's API in your interface), <b>Strategy</b> (swap a rule without touching the code that uses it) and <b>Observer</b> (announce that something happened; let others react). Here they are inside one checkout.</p>`)),
    section("Build a checkout",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Payment provider (Adapter)", options: Object.entries(GATEWAYS).map(([value, g]) => ({ value, label: g.name })), value: o.gw, onChange: (v) => { o.gw = v; render(); } }),
          segmented({ label: "Shipping rule (Strategy)", options: Object.entries(SHIPPING).map(([value, g]) => ({ value, label: g.name })), value: o.ship, onChange: (v) => { o.ship = v; render(); } }),
          slider({ label: "Quantity", min: 1, max: 5, value: o.qty, fmt: (v) => `${v} × $21.25`, onInput: (v) => { o.qty = v; render(); } }),
        ),
        h("div.stage-body",
          totals,
          h("div.row", h("span", { style: { fontSize: "13px", color: "var(--ink-2)" } }, "Subscribers to OrderPaid (Observer):"), ...Object.entries(SUBSCRIBERS).map(([k, sub]) => toggle({ label: sub.name, checked: o.subs[k], onChange: (v) => { o.subs[k] = v; render(); } }))),
          h("div.row", button("Pay", pay, "primary")),
          h("div.split", h("div", h("div.eyebrow", "Adapter output"), req), h("div", h("div.eyebrow", "Observer: who reacted"), events)),
        ),
      ),
    ),
    section("What the code looks like",
      h("div.split",
        h("div", h("div.row", h("b", "Without patterns"), naiveCount), naive),
        h("div", h("div.row", h("b", "With them"), patternCount), h("pre.log", patternCode),
          prose("<p style='margin-top:10px;font-size:14.5px'>New provider: add one adapter class. New shipping rule: add one strategy. New reaction to a payment: add one subscriber. <code>checkout</code> never changes. That's the <b>open/closed principle</b>: open for extension, closed for modification.</p>")),
      ),
      predict({
        chapter: id,
        question: "Marketing wants loyalty points awarded whenever an order is paid. With the observer setup, what changes?",
        options: ["checkout() gets a new line", "A new subscriber is added and registered; checkout() is untouched", "Every payment adapter changes", "The OrderPaid event has to be renamed"],
        answer: 1,
        explain: "<p>Checkout publishes a fact (“this order was paid”) and doesn't know who listens. Loyalty becomes one more subscriber. The catch: with many subscribers it gets harder to see everything that happens after a payment, so name events clearly and keep a list of subscribers.</p>",
      }),
    ),
    section("When patterns hurt",
      dilemma("You have exactly one payment provider. Do you write an adapter interface anyway?", [
        { name: "Yes, interface first", pros: ["Switching later is cheap", "Easy to fake in tests"], cons: ["Abstraction designed around one example is often wrong", "More files to read"] },
        { name: "No, call the SDK directly", pros: ["Less code, obvious behaviour"], cons: ["Provider details leak everywhere", "A later switch touches many files"] },
      ], "A good rule: wrap third-party SDKs at the edge (one module owns all Stripe calls) even without a formal interface. Extract the interface when the second provider actually arrives."),
      callout("tip", "The rest of the toolbox, briefly", "<ul style='margin:0;padding-left:18px'><li><b>Factory</b>: one place decides which class to build (pick the adapter from config).</li><li><b>Decorator</b>: wrap an object to add behaviour (a gateway that adds retries or logging).</li><li><b>Repository</b>: hide persistence behind an interface (chapter 1.1).</li><li><b>State</b>: the state machine from chapter 3.1, as objects.</li><li><b>Dependency injection</b>: pass collaborators in instead of creating them inside, so tests can swap them.</li></ul>"),
    ),
    section("In code",
      code({
        TypeScript: `// Adapter: our interface, their API
interface PaymentGateway { charge(orderId: string, amount: number): Promise<string>; }

class StripeGateway implements PaymentGateway {
  constructor(private stripe: Stripe) {}
  async charge(orderId: string, amount: number) {
    const pi = await this.stripe.paymentIntents.create({
      amount: Math.round(amount * 100), currency: "usd", metadata: { order_id: orderId },
    });
    return pi.id;
  }
}

// Strategy: interchangeable rules
interface ShippingStrategy { cost(order: Order): number; }
const freeOver50: ShippingStrategy = { cost: (o) => (o.subtotal >= 50 ? 0 : 6.99) };

// Observer: a tiny event bus
type Handler<T> = (payload: T) => void | Promise<void>;
class EventBus {
  private handlers = new Map<string, Handler<any>[]>();
  on<T>(name: string, h: Handler<T>) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), h]); }
  async publish<T>(name: string, payload: T) { await Promise.all((this.handlers.get(name) ?? []).map((h) => h(payload))); }
}
events.on("OrderPaid", (o) => loyalty.award(o.customerId, Math.floor(o.total)));`,
        Python: `from typing import Protocol, Callable
from collections import defaultdict

class PaymentGateway(Protocol):
    def charge(self, order_id: str, amount: float) -> str: ...

class RazorpayGateway:
    def __init__(self, client): self.client = client
    def charge(self, order_id, amount):
        order = self.client.order.create({"amount": round(amount * 100), "currency": "INR", "receipt": order_id})
        return order["id"]

class ShippingStrategy(Protocol):
    def cost(self, subtotal: float) -> float: ...

class FreeOver50:
    def cost(self, subtotal): return 0 if subtotal >= 50 else 6.99

subscribers: dict[str, list[Callable]] = defaultdict(list)
def on(event): return lambda fn: subscribers[event].append(fn) or fn
def publish(event, payload):
    for fn in subscribers[event]: fn(payload)

@on("OrderPaid")
def award_points(order): loyalty.award(order["customer_id"], int(order["total"]))`,
      }),
    ),
  );
  render();
  pay();
}
