import { h, loop, rng } from "../lib/core.js";
import { segmented, toggle, stats, predict, code, dilemma, callout, section, prose, button, liveChart, table } from "../lib/widgets.js";

// Clients send 200 requests/s to a server that can serve 300/s from a FIFO queue.
// A client gives up after 1 s and may retry. Press "outage" and the server
// serves nothing for 3 s. Whether it recovers afterwards depends on the clients.
const DT = 0.01, BASE = 200, CAP = 300, TIMEOUT = 1, OUTAGE = 3, MAX_TRIES = 4;

const POLICIES = {
  none: { label: "No retries" },
  immediate: { label: "Retry at once ×3" },
  backoff: { label: "Exponential backoff" },
  jitter: { label: "Backoff + jitter" },
  budget: { label: "Jitter + retry budget" },
};

export default function (root, { id }) {
  let policy = "immediate", breaker = false, skipExpired = false;
  let r, t, queue, qHead, pending, pHead, retries, outageUntil, served, events, brk;
  const st = stats([{ label: "Offered load" }, { label: "Answered in time" }, { label: "Queue wait" }, { label: "Circuit breaker" }]);
  const chart = liveChart({ series: [{ name: "Requests sent per second (incl. retries)", color: "var(--c2)" }, { name: "Answered in time per second", color: "var(--c3)" }, { name: "Server capacity", color: "var(--ink-3)" }], height: 170, points: 150, yMax: 1000, fmt: (v) => Math.round(v), label: "Load and goodput over time" });

  function reset() {
    r = rng(5); t = 0; queue = []; qHead = 0; pending = []; pHead = 0; retries = []; outageUntil = -1; served = 0;
    events = []; brk = { state: "closed", until: 0 };
    chart.reset();
  }
  const recent = (kind, span = 1) => events.filter((e) => e[0] > t - span && e[1] === kind).length;

  function send(attempt) {
    if (breaker && brk.state === "open") { events.push([t, "fastfail"]); return; }
    const req = { sent: t, deadline: t + TIMEOUT, attempt, done: false };
    queue.push(req); pending.push(req); events.push([t, attempt ? "retry" : "new"]);
  }
  function delay(attempt) {
    if (policy === "immediate") return 0;
    const base = 0.1 * 2 ** attempt;                 // 0.2, 0.4, 0.8 s
    return policy === "backoff" ? base : r() * base * 2; // full jitter
  }
  function onTimeout(req) {
    events.push([t, "fail"]);
    if (policy === "none" || req.attempt + 1 >= MAX_TRIES) return;
    if (policy === "budget" && recent("retry") > 0.1 * recent("new")) return; // retries ≤ 10% of new requests
    retries.push({ at: t + delay(req.attempt + 1), attempt: req.attempt + 1 });
  }

  function step() {
    t += DT;
    // new traffic, a smooth 200/s
    const want = Math.floor(t * BASE) - Math.floor((t - DT) * BASE);
    for (let i = 0; i < want; i++) send(0);
    // retries that are due
    const due = retries.filter((x) => x.at <= t); retries = retries.filter((x) => x.at > t);
    for (const x of due) send(x.attempt);
    // server
    let budget = t < outageUntil ? 0 : Math.floor(t * CAP) - Math.floor((t - DT) * CAP);
    while (budget > 0 && qHead < queue.length) {
      const q = queue[qHead++];
      if (q.deadline < t) { if (skipExpired) continue; budget--; events.push([t, "wasted"]); continue; } // work nobody is waiting for
      budget--; q.done = true; events.push([t, "ok"]);
    }
    if (qHead > 5000) { queue = queue.slice(qHead); qHead = 0; }
    // client timeouts (deadlines are in send order, so a FIFO works)
    while (pHead < pending.length && pending[pHead].deadline <= t) { const p = pending[pHead++]; if (!p.done) onTimeout(p); }
    if (pHead > 5000) { pending = pending.slice(pHead); pHead = 0; }
    // circuit breaker: open when over half of last second's requests failed; probe after 2 s
    if (breaker) {
      const fails = recent("fail"), oks = recent("ok");
      if (brk.state === "closed" && fails > 50 && fails > oks) brk = { state: "open", until: t + 2 };
      else if (brk.state === "open" && t >= brk.until) brk = { state: "half", until: t + 1 };
      else if (brk.state === "half" && t >= brk.until) brk = fails > oks ? { state: "open", until: t + 2 } : { state: "closed", until: 0 };
    }
    events = events.filter((e) => e[0] > t - 1.2);
  }

  let acc = 0, ui = 0;
  const lp = loop((dt) => {
    acc += dt;
    while (acc >= DT) { acc -= DT; step(); }
    ui += dt;
    if (ui >= 0.1) {
      ui = 0;
      const offered = recent("new") + recent("retry"), ok = recent("ok"), wait = qHead < queue.length ? t - queue[qHead].sent : 0;
      chart.push([offered, ok, t < outageUntil ? 0 : CAP]);
      st.set(0, `${offered}/s`, offered > CAP ? "bad" : "");
      st.set(1, `${ok}/s`, ok >= BASE * 0.9 ? "good" : ok > 0 ? "warn" : "bad");
      st.set(2, wait < 0.05 ? "none" : `${wait.toFixed(1)} s`, wait > TIMEOUT ? "bad" : wait > 0.3 ? "warn" : "good");
      st.set(3, breaker ? { closed: "closed", open: "open: failing fast", half: "half-open: probing" }[brk.state] : "off", breaker ? (brk.state === "closed" ? "good" : "warn") : "");
    }
  }, chart.el);

  root.append(
    section(null, prose(`<p>Retrying a failed request feels like pure kindness. At scale it can be the thing that keeps an outage going. Here clients send <b>${BASE} requests/s</b> to a server that can handle <b>${CAP}/s</b>, waiting in a queue. A client gives up after ${TIMEOUT} s. Press the outage button: the server stops for ${OUTAGE} seconds, then comes back at full capacity. Whether the system recovers depends entirely on how the clients retry.</p>`)),
    section("Cause an outage, watch the recovery",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Client retry policy", options: Object.entries(POLICIES).map(([value, p]) => ({ value, label: p.label })), value: policy, onChange: (v) => { policy = v; } }),
          toggle({ label: "Client circuit breaker", onChange: (v) => { breaker = v; brk = { state: "closed", until: 0 }; } }),
          toggle({ label: "Server skips requests whose client gave up", onChange: (v) => { skipExpired = v; } }),
          button(`Cause a ${OUTAGE} s outage`, () => { outageUntil = t + OUTAGE; }, "primary"),
          button("Reset", reset),
        ),
        h("div.stage-body", st.el, chart.el),
      ),
      callout("tip", "Things to try", "<p>With “Retry at once ×3”, cause an outage. When the server comes back, sent load is stuck far above capacity, the queue wait stays over a second, and almost nothing is answered in time. The outage is over, but the system stays down: a <b>metastable failure</b>. Exponential backoff alone doesn't save it, because it spreads the retries out without reducing how many there are. A retry budget, a circuit breaker, or a server that drops work nobody is waiting for does. Reset between experiments.</p>"),
      predict({
        chapter: id,
        question: "Every request times out during an overload, and each client retries up to 3 times. How much load does the server see compared with normal?",
        options: ["The same", "Up to 2×", "Up to 4×", "It depends only on the backoff delay"],
        answer: 2,
        explain: "<p>One original attempt plus three retries: up to 4× the load, arriving exactly when the server is least able to take it. Backoff changes <i>when</i> the retries arrive, not how many. And if every layer of a call chain retries 3 times, five layers can multiply one user click into 4<sup>5</sup> ≈ 1,000 requests at the bottom.</p>",
      }),
    ),
    section("A retry policy that doesn't hurt",
      table(["Rule", "Why"], [
        ["Retry only idempotent or idempotency-keyed requests", "A retried payment must not charge twice (next chapter)"],
        ["Exponential backoff with full jitter", "Spreads retries out and avoids a synchronised thundering herd when the server returns"],
        ["A retry budget (e.g. retries ≤ 10% of requests)", "Caps amplification at 1.1× instead of 4×"],
        ["Retry at one layer only, usually the edge", "Retries at every layer multiply"],
        ["Don't retry 4xx except 408/429; honour Retry-After", "The server is telling you retrying won't help or when it will"],
        ["Circuit breaker per dependency", "Fail fast while it's down, so you don't pile on and you free your own threads"],
        ["Deadlines and load shedding on the server", "Drop work whose client already gave up; reject early with 503 rather than queue forever"],
      ]),
      dilemma("The payment provider is timing out. Your checkout service should…", [
        { name: "Keep retrying", pros: ["Some payments get through"], cons: ["Piles load on a struggling provider", "Your threads block, so the whole site slows down"] },
        { name: "Open the breaker, fail fast", pros: ["Protects you and them", "Clear error, quick recovery"], cons: ["Users see “try again later” right away"] },
      ], "Fail fast, then degrade gracefully: queue the order as “payment pending” and confirm by email when the provider recovers. That's a queue plus idempotency keys, not retries in the request path."),
    ),
    section("In code",
      code({
        "Python (backoff, jitter, budget)": `import random, time

class RetryBudget:
    """Allow retries only up to ratio × recent first attempts (token bucket)."""
    def __init__(self, ratio=0.1, burst=10):
        self.ratio, self.tokens, self.burst = ratio, burst, burst
    def on_request(self): self.tokens = min(self.burst, self.tokens + self.ratio)
    def can_retry(self):
        if self.tokens >= 1: self.tokens -= 1; return True
        return False

budget = RetryBudget()

def call(fn, tries=4, base=0.1, cap=5.0):
    budget.on_request()
    for attempt in range(tries):
        try:
            return fn()
        except (TimeoutError, ServiceUnavailable):
            if attempt == tries - 1 or not budget.can_retry():
                raise
            time.sleep(random.uniform(0, min(cap, base * 2 ** attempt)))   # full jitter`,
        "Circuit breaker": `class Breaker:
    def __init__(self, fail_ratio=0.5, min_calls=20, open_for=30):
        self.state, self.opened, self.calls, self.fails = "closed", 0, 0, 0
        self.fail_ratio, self.min_calls, self.open_for = fail_ratio, min_calls, open_for

    def call(self, fn):
        if self.state == "open":
            if time.monotonic() - self.opened < self.open_for:
                raise CircuitOpen()                  # fail fast, no network call
            self.state = "half-open"                 # let a probe through
        try:
            out = fn()
        except Exception:
            self.record(False); raise
        self.record(True); return out

    def record(self, ok):
        if self.state == "half-open":
            self.state = "closed" if ok else "open"; self.opened = time.monotonic()
            self.calls = self.fails = 0; return
        self.calls += 1; self.fails += not ok
        if self.calls >= self.min_calls and self.fails / self.calls >= self.fail_ratio:
            self.state, self.opened = "open", time.monotonic()`,
        "Envoy (mesh-level)": `# retries and breakers configured once for every service in the mesh
retry_policy:
  retry_on: "5xx,reset,connect-failure"
  num_retries: 2
  retry_back_off: { base_interval: 0.1s, max_interval: 1s }
  retry_budget: { budget_percent: { value: 10.0 }, min_retry_concurrency: 3 }
circuit_breakers:
  thresholds: [{ max_connections: 1000, max_pending_requests: 100, max_retries: 3 }]
outlier_detection: { consecutive_5xx: 5, base_ejection_time: 30s }`,
      }),
    ),
  );
  reset();
  lp.start();
}
