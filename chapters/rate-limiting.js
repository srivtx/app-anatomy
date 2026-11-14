import { h, loop } from "../lib/core.js";
import { segmented, stats, predict, code, dilemma, callout, section, prose, button, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// Limit: L requests per W seconds. The same request stream is judged by three
// limiters at once, so their verdicts can be compared request by request.
const L = 5, W = 4, SPAN = 16;

function limiters() {
  const fixed = { counts: new Map(), allow(t) { const w = Math.floor(t / W); const n = this.counts.get(w) || 0; if (n >= L) return false; this.counts.set(w, n + 1); return true; } };
  const sliding = { log: [], allow(t) { this.log = this.log.filter((x) => x > t - W); if (this.log.length >= L) return false; this.log.push(t); return true; } };
  const bucket = { tokens: L, last: 0, rate: L / W, history: [], level(t) { return Math.min(L, this.tokens + (t - this.last) * this.rate); },
    allow(t) { this.tokens = this.level(t); this.last = t; const ok = this.tokens >= 1; if (ok) this.tokens -= 1; this.history.push([t, this.tokens]); return ok; } };
  return { fixed, sliding, bucket };
}

const PATTERNS = {
  manual: { label: "Manual", next: () => Infinity },
  steady: { label: "Steady 1.5/s", next: (t) => t + 1 / 1.5 },
  bursty: { label: "Bursts of 8", gen: function* (t0) { let t = t0; for (;;) { t = Math.ceil((t + 0.01) / 6) * 6 + 1; for (let i = 0; i < 8; i++) yield t + i * 0.05; } } },
  boundary: { label: "Boundary attack", gen: function* (t0) { let w = Math.ceil(t0 / W) + 1; for (;;) { for (let i = 0; i < L; i++) yield w * W - 0.4 + i * 0.06; for (let i = 0; i < L; i++) yield w * W + 0.05 + i * 0.06; w += 3; } } },
};

const maxInAny = (ts, span) => { let best = 0, j = 0; for (let i = 0; i < ts.length; i++) { while (ts[i] - ts[j] >= span) j++; best = Math.max(best, i - j + 1); } return best; };

export default function (root, { id }) {
  let lim = limiters(), reqs = [], t = 0, pattern = "steady", nextAt = 0.5, gen = null;
  const fc = flowCanvas({ width: 720, height: 250, label: "Three rate limiters judging the same requests" });
  const lanes = [["fixed", "Fixed window"], ["sliding", "Sliding log"], ["bucket", "Token bucket"]];
  const st = stats(lanes.map(([, n]) => ({ label: `${n}: allowed / blocked` })).concat([{ label: "Most allowed in any 1 s (fixed)" }]));

  function send(at = t) {
    const r = { t: at };
    for (const [k] of lanes) r[k] = lim[k].allow(at);
    reqs.push(r);
  }
  function setPattern(p) {
    pattern = p;
    const P = PATTERNS[p];
    gen = P.gen ? P.gen(t) : null;
    nextAt = gen ? gen.next().value : P.next(t);
  }

  function draw() {
    const c = fc.colors;
    fc.clear();
    const X0 = 130, X1 = 708, tx = (x) => X0 + ((x - (t - SPAN)) / SPAN) * (X1 - X0);
    lanes.forEach(([k, name], i) => {
      const y = 20 + i * 72;
      fc.text(name, 8, y + 22, { size: 12.5 });
      fc.text(k === "fixed" ? `${L} per ${W}s block` : k === "sliding" ? `${L} in any ${W}s` : `${L} tokens, +${(L / W).toFixed(2)}/s`, 8, y + 40, { size: 10.5, weight: 500, mono: true, color: c["ink-3"] });
      fc.box(X0, y, X1 - X0, 56, { fill: c.bg, stroke: c.line, r: 6 });
      if (k === "fixed") {
        for (let w = Math.floor((t - SPAN) / W); w * W < t; w++) if (w % 2 === 0) { const a = Math.max(X0, tx(w * W)), b = Math.min(X1, tx((w + 1) * W)); if (b > a) fc.box(a, y + 1, b - a, 54, { fill: c.sunken, stroke: "transparent", r: 0 }); }
      }
      if (k === "sliding") { const a = Math.max(X0, tx(t - W)); fc.box(a, y + 1, X1 - a, 54, { fill: c["accent-soft"] || c.sunken, stroke: "transparent", r: 0 }); }
      if (k === "bucket") {
        const ctx = fc.ctx; ctx.beginPath();
        for (let s = t - SPAN; s <= t; s += 0.05) {
          const lv = levelAt(s);
          const x = tx(s), yy = y + 52 - (lv / L) * 46;
          s === t - SPAN ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.strokeStyle = c.c4; ctx.lineWidth = 1.5; ctx.stroke();
      }
      for (const r of reqs) if (r.t > t - SPAN) {
        const x = tx(r.t);
        fc.line(x, y + 8, x, y + 48, { color: r[k] ? c.good : c.bad, lw: 2.5 });
      }
    });
    for (let s = Math.ceil(t - SPAN); s <= t; s++) if (s % 2 === 0) fc.text(`${s}s`, tx(s), 240, { align: "center", size: 10, weight: 500, mono: true, color: c["ink-3"] });
  }
  // reconstruct bucket level at time s from its decision history
  function levelAt(s) {
    const hist = lim.bucket.history;
    let lv = L, last = 0;
    for (const [ht, after] of hist) { if (ht > s) break; lv = after; last = ht; }
    return Math.min(L, lv + (s - last) * (L / W));
  }

  let acc = 0;
  const lp = loop((dt) => {
    t += dt;
    while (nextAt <= t) { send(nextAt); nextAt = gen ? gen.next().value : PATTERNS[pattern].next(nextAt); }
    reqs = reqs.filter((r) => r.t > t - SPAN - 1);
    lim.bucket.history = lim.bucket.history.filter(([ht]) => ht > t - SPAN - W * 2);
    draw();
    acc += dt;
    if (acc > 0.2) {
      acc = 0;
      lanes.forEach(([k], i) => { const ok = reqs.filter((r) => r[k]).length; st.set(i, `${ok} / ${reqs.length - ok}`); });
      const m = maxInAny(reqs.filter((r) => r.fixed).map((r) => r.t), 1);
      st.set(3, String(m), m > L ? "bad" : "");
    }
  }, fc.el);

  root.append(
    section(null, prose(`<p>Without limits, one buggy script or one attacker can use all your capacity. A <b>rate limiter</b> decides, per user, API key or IP, whether this request fits the budget, and if not answers <code>429 Too Many Requests</code>. Here the budget is <b>${L} requests per ${W} seconds</b>, and the same stream of requests goes through three different algorithms. Green got through, red was blocked.</p>`)),
    section("Three limiters, one stream",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Client behaviour", options: Object.entries(PATTERNS).map(([value, p]) => ({ value, label: p.label })), value: pattern, onChange: setPattern }),
          button("Send 1 request", () => send(), "primary"),
          button("Send 8 at once", () => { for (let i = 0; i < 8; i++) send(t + i * 0.01); }),
          button("Reset", () => { lim = limiters(); lim.bucket.last = t; reqs = []; }),
        ),
        h("div.stage-body", st.el, fc.el),
      ),
      callout("tip", "Things to try", "<p>Pick “Boundary attack”: the client sends 5 requests just before a fixed window ends and 5 right after. Compare the three lanes, and read the last stat. Then try “Bursts of 8” and see who lets the first few through.</p>"),
      predict({
        chapter: id,
        question: `A fixed window allows ${L} requests per ${W}-second block. What's the most a client can squeeze through within a single second?`,
        options: [`${L}`, `${Math.ceil(L / W)}`, `${2 * L}`, "Unlimited"],
        answer: 2,
        explain: `<p>${L} at the very end of one block and ${L} at the very start of the next: ${2 * L} requests in a fraction of a second, twice the intended rate. Sliding windows and token buckets don't have this edge because they always look back over the last ${W} seconds or track a continuously refilling budget.</p>`,
      }),
    ),
    section("Picking an algorithm",
      table(["Algorithm", "State per client", "Bursts", "Notes"], [
        ["Fixed window", "1 counter", "2× at window edges", "Simplest: INCR + EXPIRE in Redis"],
        ["Sliding log", "Every timestamp", "Exact", "Precise but memory grows with the limit"],
        ["Sliding window counter", "2 counters", "Close to exact", "Weights the previous window; the common compromise"],
        ["Token bucket", "Tokens + last time", "Allows bursts up to bucket size", "Most APIs (Stripe, AWS); separates burst size from rate"],
        ["Leaky bucket", "Queue", "Smooths to a constant rate", "nginx limit_req; delays instead of rejecting"],
      ]),
      dilemma("You run 20 API servers behind a load balancer. Where does the counter live?", [
        { name: "In each server's memory", pros: ["No network hop", "Nothing to run"], cons: ["The real limit becomes 20× what you set", "Uneven when traffic is uneven"] },
        { name: "In Redis", pros: ["One accurate limit for everyone"], cons: ["A Redis call on every request", "Redis outage: fail open or fail closed?"] },
      ], "Most teams use Redis with an atomic Lua script, plus a generous local limit as a fallback if Redis is down (fail open for most endpoints, fail closed for login)."),
    ),
    section("In code",
      code({
        "Python (token bucket)": `import time

class TokenBucket:
    def __init__(self, capacity: float, refill_per_sec: float):
        self.capacity, self.rate = capacity, refill_per_sec
        self.tokens, self.last = capacity, time.monotonic()

    def allow(self, cost: float = 1) -> bool:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= cost:
            self.tokens -= cost
            return True
        return False

buckets: dict[str, TokenBucket] = {}
def check(api_key: str) -> bool:
    b = buckets.setdefault(api_key, TokenBucket(capacity=20, refill_per_sec=5))
    return b.allow()`,
        "Redis (fixed window)": `-- KEYS[1] = "rl:{user}:{window}", ARGV[1] = limit, ARGV[2] = window seconds
local n = redis.call("INCR", KEYS[1])
if n == 1 then redis.call("EXPIRE", KEYS[1], ARGV[2]) end
return n <= tonumber(ARGV[1])`,
        nginx: `# leaky bucket: 10 req/s per IP, absorb bursts of 20 without delay
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

server {
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        limit_req_status 429;
    }
}`,
        "HTTP response": `HTTP/1.1 429 Too Many Requests
Retry-After: 3
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: 3`,
      }),
    ),
  );
  setPattern("steady");
  draw();
  lp.start();
}
