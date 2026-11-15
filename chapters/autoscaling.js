import { h } from "../lib/core.js";
import { segmented, slider, toggle, stats, predict, code, callout, section, prose, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

const CAP = 100, MINUTES = 120, DT = 10 / 60, EVAL_EVERY = 3, DOWN_WINDOW = 5;   // 100 req/s per server; 10-second ticks; decide every 30 s
export const TRAFFIC = {
  ramp: { label: "Morning ramp (×6 over an hour)", f: (m) => 300 + 1500 / (1 + Math.exp(-(m - 45) / 7)) },
  spike: { label: "Launch email at 0:30 (×5 in a minute)", f: (m) => 400 + (m >= 30 ? 1600 * Math.min(1, (m - 30) / 1) * Math.exp(-Math.max(0, m - 31) / 30) : 0) },
  wave: { label: "Noisy, steady-ish", f: (m) => 900 + 250 * Math.sin((2 * Math.PI * m) / 40) + 160 * Math.sin(m * 3.1) * Math.cos(m * 1.7) },
};

/** One autoscaled fleet over two hours. */
export function autoscale({ traffic = "spike", target = 0.7, boot = 2, window = 1, min = 4, metric = "cpu", prewarm = false, warmup = false }) {
  const f = TRAFFIC[traffic].f, ticks = Math.round(MINUTES / DT);
  let servers = Array.from({ length: Math.max(min, Math.ceil(f(0) / (CAP * target))) }, () => ({ readyAt: -99 }));
  const hist = [], recs = [], rows = [];
  let served = 0, total = 0, serverMin = 0, idealMin = 0, launches = 0, lastDir = 0, flips = 0;
  for (let k = 0; k < ticks; k++) {
    const m = k * DT, load = f(m);
    const floor = prewarm && traffic === "spike" && m >= 25 && m < 60 ? Math.ceil(2000 / (CAP * target)) : min;
    // capacity: a server is useful after it boots; with warm-up it serves half for its first 2 minutes
    let cap = 0, booting = 0;
    for (const s of servers) { if (m >= s.readyAt) cap += warmup && m < s.readyAt + 2 ? CAP / 2 : CAP; else booting++; }
    const ok = Math.min(load, cap);
    served += ok * DT * 60; total += load * DT * 60; serverMin += servers.length * DT; idealMin += Math.ceil(load / CAP) * DT;
    const ready = servers.length - booting;
    const cpu = ready ? Math.min(1, load / (ready * CAP)) : 1;                       // CPU can't show more than 100%
    hist.push({ cpu, load });
    if (k % EVAL_EVERY === 0) {
      const w = hist.slice(-Math.max(1, Math.round(window / DT)));
      const avgCpu = w.reduce((a, x) => a + x.cpu, 0) / w.length, avgLoad = w.reduce((a, x) => a + x.load, 0) / w.length;
      const want = Math.max(floor, Math.min(80, metric === "cpu" ? Math.ceil((ready || 1) * avgCpu / target) : Math.ceil(avgLoad / (CAP * target))));
      recs.push({ m, want }); while (recs.length && recs[0].m < m - DOWN_WINDOW) recs.shift();
      if (want > servers.length) { const n = want - servers.length; for (let i = 0; i < n; i++) servers.push({ readyAt: m + boot }); launches += n; if (lastDir < 0) flips++; lastDir = 1; }
      else {
        const down = Math.max(floor, ...recs.map((r) => r.want));                     // scale down only to the highest recommendation of the last 5 min
        if (down < servers.length) { servers.sort((a, b) => b.readyAt - a.readyAt); servers = servers.slice(servers.length - down); if (lastDir > 0) flips++; lastDir = -1; }
      }
    }
    rows.push({ m, load, cap, all: cap + booting * CAP, failed: load - ok, servers: servers.length });
  }
  return { rows, failedPct: 1 - served / total, serverHours: serverMin / 60, idealHours: idealMin / 60, launches, flips, peakFail: Math.max(...rows.map((r) => r.failed)) };
}

export default function (root, { id }) {
  const p = { traffic: "spike", target: 0.7, boot: 2, window: 1, min: 4, metric: "cpu", prewarm: false, warmup: false };
  const fc = flowCanvas({ width: 720, height: 340, label: "Traffic, serving capacity and failed requests over two hours" });
  const st = stats([{ label: "Requests failed" }, { label: "Worst moment" }, { label: "Server-hours" }, { label: "Direction changes" }]);
  let pending = 0;

  function draw() {
    const o = autoscale(p), c = fc.colors, ctx = fc.ctx; fc.clear();
    const L = 58, R = 706, X = (m) => L + ((R - L) * m) / MINUTES;
    const P1 = [26, 196], P2 = [238, 306];
    const yMax = Math.max(...o.rows.map((r) => Math.max(r.load, r.all))) * 1.08, Y = (v) => P1[1] - ((P1[1] - P1[0]) * v) / yMax;
    const fMax = Math.max(50, o.peakFail) * 1.1, Yf = (v) => P2[1] - ((P2[1] - P2[0]) * v) / fMax;
    fc.text("Requests per second", L, 12, { size: 11.5 });
    fc.text("Failing per second", L, P2[0] - 14, { size: 11.5 });
    const step = Math.ceil(yMax / 4 / 500) * 500;
    for (let v = 0; v < yMax; v += step) { fc.line(L, Y(v), R, Y(v), { color: c.line, lw: 1 }); fc.text(v.toLocaleString(), L - 8, Y(v), { align: "right", size: 10, color: c["ink-2"], mono: true }); }
    for (const v of [0, Math.round(fMax / 200) * 100]) { fc.line(L, Yf(v), R, Yf(v), { color: c.line, lw: 1 }); fc.text(v.toLocaleString(), L - 8, Yf(v), { align: "right", size: 10, color: c["ink-2"], mono: true }); }
    // ready capacity as a filled step area, booting capacity dashed above it
    ctx.beginPath(); ctx.moveTo(X(0), P1[1]); o.rows.forEach((r) => ctx.lineTo(X(r.m), Y(r.cap))); ctx.lineTo(X(MINUTES), P1[1]); ctx.closePath();
    ctx.globalAlpha = 0.16; ctx.fillStyle = c.c1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); o.rows.forEach((r, i) => (i ? ctx.lineTo(X(r.m), Y(r.cap)) : ctx.moveTo(X(r.m), Y(r.cap)))); ctx.strokeStyle = c.c1; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.setLineDash([4, 4]); o.rows.forEach((r, i) => (i ? ctx.lineTo(X(r.m), Y(r.all)) : ctx.moveTo(X(r.m), Y(r.all)))); ctx.strokeStyle = c.c1; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.beginPath(); o.rows.forEach((r, i) => (i ? ctx.lineTo(X(r.m), Y(r.load)) : ctx.moveTo(X(r.m), Y(r.load)))); ctx.strokeStyle = c.ink; ctx.lineWidth = 2; ctx.stroke();
    // failures
    ctx.beginPath(); ctx.moveTo(X(0), P2[1]); o.rows.forEach((r) => ctx.lineTo(X(r.m), Yf(r.failed))); ctx.lineTo(X(MINUTES), P2[1]); ctx.closePath(); ctx.fillStyle = c.bad; ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;
    for (let m = 0; m <= MINUTES; m += 20) fc.text(`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`, X(m), P2[1] + 14, { align: "center", size: 10, color: c["ink-2"], mono: true });
    let lx = L; for (const [txt, col, dash] of [["traffic", c.ink], ["ready capacity", c.c1], ["incl. servers still booting", c.c1, true]]) { fc.line(lx, 333, lx + 16, 333, { color: col, lw: 2, dash: dash ? [4, 3] : null }); fc.text(txt, lx + 21, 333, { size: 10.5, color: c["ink-2"], weight: 500 }); lx += 36 + fc.ctx.measureText(txt).width; }
    st.set(0, `${(o.failedPct * 100).toFixed(o.failedPct < 0.01 ? 2 : 1)}%`, o.failedPct > 0.01 ? "bad" : o.failedPct > 0.001 ? "" : "good");
    st.set(1, `${Math.round(o.peakFail).toLocaleString()} failing/s`);
    st.set(2, `${o.serverHours.toFixed(0)} (bare minimum ${o.idealHours.toFixed(0)})`);
    st.set(3, String(o.flips), o.flips > 6 ? "warn" : "");
  }
  const later = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(draw); };

  root.append(
    section(null, prose(`<p>Autoscaling sounds like a solved problem: when servers are busy, add more. In practice it's a control loop with a <b>delay</b> in it. The autoscaler sees load only after it has happened, averaged over a window, and a new server takes minutes to boot. Everything interesting comes from that delay.</p>
<p>Below, each server handles ${CAP} requests a second. Every 30 seconds the autoscaler compares the average load over its window with your target and adds servers if needed, like Kubernetes' Horizontal Pod Autoscaler. It removes servers only when it has wanted fewer for ${DOWN_WINDOW} minutes straight. Requests beyond what ready servers can handle fail.</p>`)),
    section("Scale a fleet through a traffic spike",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Traffic", options: Object.entries(TRAFFIC).map(([value, t]) => ({ value, label: t.label })), value: p.traffic, onChange: (v) => { p.traffic = v; draw(); } }),
          segmented({ label: "Scale on", options: [{ value: "cpu", label: "CPU utilisation" }, { value: "rps", label: "Requests per second" }], value: p.metric, onChange: (v) => { p.metric = v; draw(); } }),
          slider({ label: "Target utilisation", min: 0.3, max: 0.95, step: 0.05, value: p.target, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { p.target = v; later(); } }),
          slider({ label: "Time for a new server to boot", min: 0.25, max: 6, step: 0.25, value: p.boot, fmt: (v) => (v < 1 ? `${v * 60} s` : `${v} min`), onInput: (v) => { p.boot = v; later(); } }),
          slider({ label: "Averaging window", min: 0.5, max: 10, step: 0.5, value: p.window, fmt: (v) => `${v} min`, onInput: (v) => { p.window = v; later(); } }),
          slider({ label: "Minimum servers", min: 1, max: 30, step: 1, value: p.min, fmt: String, onInput: (v) => { p.min = v; later(); } }),
          toggle({ label: "Pre-warm for the launch", hint: "scheduled: raise the minimum 5 minutes before the email goes out", checked: p.prewarm, onChange: (v) => { p.prewarm = v; draw(); } }),
          toggle({ label: "New servers start cold", hint: "half speed for 2 minutes: JIT, caches, connection pools", checked: p.warmup, onChange: (v) => { p.warmup = v; draw(); } }),
        ),
        h("div.stage-body", st.el, fc.el),
      ),
      callout("tip", "Things to try", "<p>With the launch email and CPU scaling, capacity climbs in steps and requests fail for about 6 minutes. Switch to <b>requests per second</b> and the failures last under 3: the autoscaler asks for the right number of servers in one step. The reason is the most useful thing on this page: <b>CPU can't go above 100%</b>, so an overloaded fleet looks only ‘100% busy’, and the autoscaler can grow it by at most 1 ÷ target per decision, waiting for a boot each time. Then shorten the boot time to 15 seconds (containers on warm nodes) and the outage shrinks again. Turn on pre-warming: for a launch you know about, nothing beats scheduling the capacity. Turn on cold starts to see why a booted server isn't a ready one. Finally, pick the noisy traffic and raise the target to 95%: it saves a quarter of the servers, and the random peaks start to fail because there's no room left for noise.</p>"),
      predict({
        chapter: id,
        question: "A fleet of 10 servers is hit by 5× its normal traffic. The autoscaler scales on CPU with a 70% target. How many servers does it ask for on its first decision?",
        options: ["50 (enough for 5× the traffic)", "About 15: CPU shows 100%, and 10 × 100% ÷ 70% ≈ 15", "72, to keep 70% utilisation at 5×", "10: it waits for the average to settle"],
        answer: 1,
        explain: "<p>Utilisation is capped at 100%, so it says ‘busy’ but not ‘5× too busy’. The autoscaler computes 10 × 1.0 ÷ 0.7 and asks for 15. Thirty seconds and a boot later it sees 100% again and asks for 22, then 31… Each step waits for servers to boot. Scaling on a metric that measures demand rather than busyness (requests per second, queue length, concurrent connections) asks for 72 at once.</p>",
      }),
    ),
    section("How much headroom do you need?",
      prose(`<p>Between the moment traffic rises and the moment new servers take load, the existing ones must absorb the growth. Call that delay the <b>reaction time</b>: averaging window + decision interval + boot time + warm-up. If traffic grows at rate g per minute, the fleet must have spare room for that much growth:</p>
<p style="text-align:center;font-family:var(--mono)">target utilisation ≤ 1 ÷ (1 + g × reaction time)</p>
<p>Traffic growing 3% a minute with a 4-minute reaction time needs a target of 1 ÷ 1.12 ≈ 89%. A 5× spike in one minute needs a target of 20%, which nobody pays for. That's why sudden spikes are handled with other tools: pre-warming for events you know about, queues that absorb the burst, and shedding low-priority work.</p>`),
    ),
    section("What operators know that docs don't say",
      prose(`<p>These are lessons from incident reviews and on-call experience. Most are written up somewhere, but scattered, and seldom in the documentation of the autoscaler itself. I'm confident about the first six; the last two are my own rules of thumb.</p>`),
      table(["Lesson", "Why"], [
        ["Scale on demand, not busyness", "CPU and memory saturate; requests per second, queue depth and in-flight requests keep growing with the overload, so the autoscaler sees its true size"],
        ["Scale up fast, down slowly", "Being too small costs failed requests now; being too big costs a few minutes of money. Kubernetes' default stabilisation window for scaling down is 5 minutes for this reason"],
        ["A booted server isn't a warm one", "JIT compilation, empty caches and new connection pools make it slow for its first minutes. Load balancers have ‘slow start’ modes to ramp traffic onto it"],
        ["Your database doesn't autoscale", "Five times the app servers means five times the database connections. Many ‘autoscaling worked’ incidents end with a connection limit; put a pooler like PgBouncer in between"],
        ["Retries are load too", "During an overload, clients retry, so measured demand includes requests that already failed. The autoscaler chases a number the overload is inflating; retry budgets break the loop"],
        ["Test the scale-up path", "The code that launches servers runs only in emergencies, so it's the code most likely to hit a quota, an expired image or an exhausted IP range. Scale up on purpose regularly"],
        ["Minimum servers is a reliability setting, not a cost setting", "My rule of thumb: keep enough to survive losing a zone plus one boot time of normal growth"],
        ["Autoscale on the bottleneck's queue", "My rule of thumb: if requests wait in a queue anywhere, its length is the best scaling signal; it rises before latency does and falls only when the backlog is gone"],
      ]),
    ),
    section("In code",
      code({
        "Kubernetes HPA on requests per second": `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: web }
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: web }
  minReplicas: 4
  maxReplicas: 80
  metrics:
    - type: Pods
      pods:
        metric: { name: http_requests_per_second }     # from Prometheus Adapter or KEDA
        target: { type: AverageValue, averageValue: "70" }   # 70% of the 100 req/s a pod can do
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies: [{ type: Percent, value: 200, periodSeconds: 30 }]   # allow tripling every 30 s
    scaleDown:
      stabilizationWindowSeconds: 300
      policies: [{ type: Percent, value: 20, periodSeconds: 60 }]`,
        "The HPA's formula": `// what Kubernetes computes every 15 s (simplified)
desired = Math.ceil(current * (currentMetric / targetMetric));
// with CPU, currentMetric ≤ 100%, so desired ≤ current / target per step:
// at a 70% target, an overloaded fleet grows by at most ×1.43 per decision`,
        "Scheduled pre-warming (KEDA cron)": `apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata: { name: web-launch }
spec:
  scaleTargetRef: { name: web }
  triggers:
    - type: cron
      metadata: { timezone: Europe/London, start: "25 9 * * 2", end: "0 11 * * 2", desiredReplicas: "30" }
    - type: prometheus
      metadata: { query: sum(rate(http_requests_total[1m])), threshold: "70" }`,
      }),
    ),
  );
  fc.redraw = draw;
  draw();
}
