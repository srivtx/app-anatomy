import { h, rng, pct, fmtMs, loop } from "../lib/core.js";
import { slider, segmented, toggle, stats, predict, code, dilemma, callout, section, prose, liveChart, button } from "../lib/widgets.js";
import { flowCanvas, window_ } from "../lib/flow.js";

// Discrete-event-ish simulation, advanced every animation frame.
// Each server has 2 workers and a queue. Service time ~ exponential(40 ms) × slowness.
const WORKERS = 2, SERVICE_MS = 40, TRAVEL_MS = 140, QUEUE_CAP = 60, TIMEOUT_MS = 1500;

function makeSim(o) {
  const r = rng(7);
  const servers = Array.from({ length: 8 }, (_, i) => ({ i, queue: [], busy: [], slow: 1, alive: true, inflight: 0, detectedDown: false, downSince: 0, served: 0 }));
  let now = 0, nextArrival = 0, rr = 0;
  const travelling = [], lat = window_(3000), errs = window_(3000), done = window_(3000);

  const pool = () => servers.slice(0, o.n).filter((s) => !(o.health && s.detectedDown));
  function pick() {
    const p = pool();
    if (!p.length) return null;
    switch (o.algo) {
      case "rr": return p[rr++ % p.length];
      case "random": return r.pick(p);
      case "least": return p.reduce((a, b) => (b.inflight < a.inflight ? b : a));
      case "p2c": { const a = r.pick(p), b = r.pick(p); return a.inflight <= b.inflight ? a : b; }
    }
  }
  function startWork(s) {
    while (s.busy.length < WORKERS && s.queue.length) {
      const req = s.queue.shift();
      req.end = now + r.exp(SERVICE_MS) * s.slow;
      s.busy.push(req);
    }
  }
  function finish(req, ok) {
    req.server.inflight--;
    (ok ? lat : errs).add(now, now - req.t0);
    if (ok) { done.add(now, 1); req.server.served++; }
    req.back = { t: now, ok };
  }
  const returning = [];

  return {
    servers, travelling, returning,
    get now() { return now; },
    step(dtMs) {
      const end = now + dtMs;
      while (now < end) {
        const step = Math.min(5, end - now);
        now += step;
        // arrivals (Poisson)
        while (nextArrival <= now) {
          nextArrival += r.exp(1000 / o.rate);
          const s = pick();
          if (!s) { errs.add(now, TIMEOUT_MS); continue; }
          s.inflight++;
          travelling.push({ t0: now, server: s, arrive: now + TRAVEL_MS });
        }
        // arrivals at servers
        for (let k = travelling.length - 1; k >= 0; k--) {
          const req = travelling[k];
          if (req.arrive > now) continue;
          travelling.splice(k, 1);
          const s = req.server;
          if (!s.alive) { req.deadline = now + TIMEOUT_MS; s.queue.push(req); continue; } // hangs until timeout
          if (s.queue.length >= QUEUE_CAP) { finish(req, false); returning.push(req); continue; }
          s.queue.push(req);
          startWork(s);
        }
        for (const s of servers) {
          if (!s.alive) {
            for (let k = s.queue.length - 1; k >= 0; k--) if (s.queue[k].deadline <= now) { const [req] = s.queue.splice(k, 1); finish(req, false); returning.push(req); }
            if (now - s.downSince > 1000) s.detectedDown = true; // health check notices after ~1 s
            continue;
          }
          for (let k = s.busy.length - 1; k >= 0; k--) if (s.busy[k].end <= now) { const [req] = s.busy.splice(k, 1); finish(req, true); returning.push(req); }
          startWork(s);
        }
        for (let k = returning.length - 1; k >= 0; k--) if (now - returning[k].back.t > TRAVEL_MS) returning.splice(k, 1);
      }
    },
    metrics() {
      const v = lat.values(now);
      const e = errs.count(now), ok = v.length;
      return { p50: pct(v, 50), p99: pct(v, 99), rps: done.count(now) / 3, errRate: e / Math.max(1, e + ok) };
    },
    kill(i) { const s = servers[i]; s.alive = false; s.downSince = now; s.detectedDown = false; for (const req of s.busy.splice(0)) { req.deadline = now + TIMEOUT_MS; s.queue.push(req); } },
    revive(i) { const s = servers[i]; s.alive = true; s.detectedDown = false; for (const req of s.queue) delete req.deadline; startWork(s); },
  };
}

export default function (root, { id }) {
  const o = { algo: "rr", n: 4, rate: 100, slowOne: false, health: true, speed: 1 };
  let sim = makeSim(o);
  const fc = flowCanvas({ width: 720, height: 340, label: "Load balancer sending requests to servers" });
  const st = stats([{ label: "Throughput" }, { label: "p50 latency" }, { label: "p99 latency" }, { label: "Errors" }]);
  const chart = liveChart({ series: [{ name: "p99", color: "var(--c2)" }, { name: "p50", color: "var(--c1)" }], height: 130, points: 90, fmt: (v) => `${Math.round(v)} ms`, label: "Latency over time" });
  let acc = 0;

  const LBX = 110, SX = 560;
  const sy = (i) => 30 + (i + 0.5) * ((340 - 40) / o.n);
  function draw() {
    const c = fc.colors;
    fc.clear();
    fc.text("clients →", 6, 170, { color: c["ink-3"], size: 11, weight: 500, mono: true });
    fc.box(LBX - 30, 140, 90, 60, { stroke: c.accent, lw: 2 });
    fc.text("Load", LBX + 15, 162, { align: "center" });
    fc.text("balancer", LBX + 15, 178, { align: "center" });
    for (let i = 0; i < o.n; i++) {
      const s = sim.servers[i], y = sy(i);
      fc.line(LBX + 60, 170, SX, y, { color: s.alive ? c.line : c.bad, dash: o.health && s.detectedDown ? [4, 4] : null });
      const stroke = !s.alive ? c.bad : s.slow > 1 ? c.warn : c.line;
      fc.box(SX, y - 22, 140, 44, { stroke, lw: 2 });
      fc.text(`Server ${i + 1}${s.slow > 1 ? " (slow)" : ""}${!s.alive ? " DOWN" : ""}`, SX + 10, y - 9, { size: 12, color: !s.alive ? c.bad : c.ink });
      fc.text(`${s.inflight} in flight`, SX + 10, y + 9, { size: 10.5, weight: 500, mono: true, color: c["ink-3"] });
      for (let w = 0; w < WORKERS; w++) fc.dot(SX + 118 + w * 0, y - 8 + w * 16, 5, s.busy[w] ? c.accent : c.sunken);
      const q = s.queue.length;
      for (let k = 0; k < Math.min(q, 24); k++) fc.dot(SX - 10 - (k % 12) * 8, y - 5 + Math.floor(k / 12) * 10, 3, s.alive ? c.warm : c.bad);
      if (q > 24) fc.text(`+${q - 24}`, SX - 110, y + 16, { size: 10, mono: true, color: c.warm, weight: 600 });
    }
    for (const req of sim.travelling) {
      const t = 1 - (req.arrive - sim.now) / TRAVEL_MS, y = sy(req.server.i);
      fc.dot(LBX + 60 + (SX - LBX - 60) * t, 170 + (y - 170) * t, 3.5, c.accent);
    }
    for (const req of sim.returning) {
      const t = (sim.now - req.back.t) / TRAVEL_MS, y = sy(req.server.i);
      fc.dot(SX - (SX - LBX - 60) * t, y + (170 - y) * t, 2.5, req.back.ok ? c.good : c.bad);
    }
  }

  const lp = loop((dt) => {
    sim.step(dt * 1000 * o.speed);
    draw();
    acc += dt;
    if (acc > 0.25) {
      acc = 0;
      const m = sim.metrics();
      st.set(0, `${Math.round(m.rps)} req/s`);
      st.set(1, fmtMs(m.p50));
      st.set(2, fmtMs(m.p99), m.p99 > 600 ? "bad" : m.p99 < 250 ? "good" : "warn");
      st.set(3, `${(m.errRate * 100).toFixed(1)}%`, m.errRate > 0.01 ? "bad" : "good");
      chart.push([m.p99, m.p50]);
    }
  }, fc.el);

  const applySlow = () => sim.servers.forEach((s, i) => (s.slow = o.slowOne && i === 2 ? 5 : 1));
  const restart = () => { sim = makeSim(o); applySlow(); chart.reset(); };
  const killBtn = button("Crash server 2", () => {
    const s = sim.servers[1];
    if (s.alive) { sim.kill(1); killBtn.textContent = "Restart server 2"; } else { sim.revive(1); killBtn.textContent = "Crash server 2"; }
  });

  root.append(
    section(null, prose(`<p>One server can only do so much. Put several behind a <b>load balancer</b> and it decides, for every request, which server gets it. That decision sounds trivial until one server gets slow or dies. Below, requests (teal dots) flow from the balancer to servers, wait in a queue (orange) and come back green, or red if they failed.</p>`)),
    section("Run the cluster",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Algorithm", options: [{ value: "rr", label: "Round robin" }, { value: "random", label: "Random" }, { value: "least", label: "Least connections" }, { value: "p2c", label: "Power of two" }], value: o.algo, onChange: (v) => { o.algo = v; restart(); } }),
          slider({ label: "Traffic", min: 20, max: 220, step: 10, value: o.rate, fmt: (v) => `${v} req/s`, onInput: (v) => { o.rate = v; } }),
          slider({ label: "Servers", min: 2, max: 8, value: o.n, onInput: (v) => { o.n = v; restart(); } }),
          toggle({ label: "Server 3 gets 5× slower", onChange: (v) => { o.slowOne = v; applySlow(); } }),
          toggle({ label: "Health checks", checked: true, onChange: (v) => { o.health = v; } }),
          killBtn,
        ),
        h("div.stage-body", st.el, fc.el, chart.el),
      ),
      callout("tip", "Things to try", `<ul style="margin:0;padding-left:18px"><li>Turn on the slow server with round robin, then switch to least connections and watch p99.</li><li>Crash server 2 with health checks off: requests hang until they time out.</li><li>Push traffic to 220 req/s with 4 servers. Capacity is ~${Math.round((4 * WORKERS * 1000) / SERVICE_MS)} req/s, so queues explode no matter the algorithm.</li></ul>`),
      predict({
        chapter: id,
        question: "With round robin, server 3 becomes 5× slower. Three of four servers are healthy. What happens to p99 latency?",
        options: ["Barely moves: 75% of servers are fine", "Rises about 25%", "Explodes: every 4th request lands in a queue that keeps growing", "Drops, because the slow server takes fewer requests"],
        answer: 2,
        explain: "<p>Round robin is blind: it keeps giving the slow server a quarter of the traffic even though it can only handle a fraction of that. Its queue grows without limit, and p99 is set by exactly those requests. Algorithms that look at in-flight counts (least connections, power of two choices) route around it automatically.</p>",
      }),
    ),
    section("The algorithms",
      h("div.tbl-wrap", h("table.t", h("thead", h("tr", h("th", "Algorithm"), h("th", "How it picks"), h("th", "Good"), h("th", "Bad"))), h("tbody", [
        ["Round robin", "Next server in turn", "Simple, even when servers are identical", "Blind to slow servers and long requests"],
        ["Random", "Any server", "Stateless, works across many balancers", "Same blindness, plus bad luck streaks"],
        ["Least connections", "Fewest in-flight requests", "Adapts to slow servers", "Needs a global view; many balancers each see only their own traffic"],
        ["Power of two choices", "Sample two at random, take the less busy", "Nearly as good as least connections with almost no coordination", "Slightly worse than a perfect global view"],
        ["Consistent hashing", "Hash a key (user, session) onto a ring", "Same user hits the same server (caches, sticky state)", "Hot keys overload one server"],
      ].map((r) => h("tr", r.map((x, i) => (i ? h("td", x) : h("td", h("b", x))))))))),
      dilemma("Your app keeps user sessions in server memory, and you add a second server.", [
        { name: "Sticky sessions", pros: ["No code change", "Session reads stay local and fast"], cons: ["A crash logs those users out", "Uneven load when heavy users stick"] },
        { name: "Stateless servers + shared store", pros: ["Any server can take any request", "Scale up and down freely"], cons: ["A Redis hop per request", "One more system to run"] },
      ], "Make servers stateless (sessions in Redis or a signed cookie) so the balancer can use any algorithm and servers can come and go."),
    ),
    section("Layer 4 vs layer 7, and health checks",
      prose(`<ul><li><b>Layer 4</b> balancers (AWS NLB, IPVS) move TCP connections without reading HTTP. Very fast, but they can't route by path or header.</li><li><b>Layer 7</b> balancers (nginx, Envoy, HAProxy, AWS ALB) read each HTTP request, so they can route <code>/api</code> and <code>/static</code> differently, retry, terminate TLS and add headers.</li><li><b>Health checks</b> poll each server (<code>GET /healthz</code>) and pull failing ones out. Without them a dead server keeps receiving traffic until each request times out, which is what you saw above.</li></ul>`),
    ),
    section("Configure it for real",
      code({
        nginx: `upstream app {
    least_conn;                       # or: random two least_conn;  (power of two choices)
    server 10.0.0.11:8080 max_fails=3 fail_timeout=10s;
    server 10.0.0.12:8080 max_fails=3 fail_timeout=10s;
    server 10.0.0.13:8080 max_fails=3 fail_timeout=10s;
    keepalive 64;                     # reuse connections to the backends
}
server {
    listen 443 ssl;
    location / {
        proxy_pass http://app;
        proxy_next_upstream error timeout;   # retry another server on failure
    }
}`,
        "Python (power of two)": `import random

class Server:
    def __init__(self, name):
        self.name, self.inflight = name, 0

def pick(servers: list[Server]) -> Server:
    a, b = random.sample(servers, 2)          # two random candidates
    return a if a.inflight <= b.inflight else b

async def handle(request, servers):
    s = pick([x for x in servers if x.healthy])
    s.inflight += 1
    try:
        return await forward(s, request)
    finally:
        s.inflight -= 1`,
      }),
    ),
  );
  draw();
  lp.start();
}
