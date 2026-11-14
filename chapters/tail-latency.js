import { h, rng, pct } from "../lib/core.js";
import { slider, toggle, segmented, stats, predict, code, callout, section, prose, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// One user request fans out to K backend calls and waits for all of them.
// Each backend call is usually fast (lognormal around 8 ms), but with a small
// probability it hits a hiccup (GC pause, noisy neighbour, retransmit) and takes
// 100-400 ms. Optional hedging: if a call hasn't answered after d ms, send a
// copy to another replica and take whichever answers first.
const USERS = 4000;

function backend(r, slowP) {
  const fast = Math.exp(Math.log(8) + 0.35 * gaussian(r));
  return r() < slowP ? 100 + r() * 300 : fast;
}
function gaussian(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }

function simulate({ K, slowP, hedge, hedgeAt }) {
  const r = rng(11), lat = [];
  let calls = 0, extra = 0, hitSlow = 0;
  for (let u = 0; u < USERS; u++) {
    let worst = 0, slow = false;
    for (let k = 0; k < K; k++) {
      let L = backend(r, slowP); calls++;
      if (hedge && L > hedgeAt) { extra++; L = Math.min(L, hedgeAt + backend(r, slowP)); }
      if (L > 60) slow = true;
      if (L > worst) worst = L;
    }
    if (slow) hitSlow++;
    lat.push(worst + 2);
  }
  return { lat, extra: extra / calls, hitSlow: hitSlow / USERS };
}

export default function (root, { id }) {
  let K = 1, slowP = 0.01, hedge = false, hedgeAt = 14, res;
  const fc = flowCanvas({ width: 720, height: 270, label: "Histogram of user-facing latency and the chance of hitting a slow backend" });
  const st = stats([{ label: "Median (p50)" }, { label: "p99" }, { label: "Users who still waited on a hiccup" }, { label: "Extra backend load" }]);

  function run() {
    res = simulate({ K, slowP, hedge, hedgeAt });
    const p50 = pct(res.lat, 50), p99 = pct(res.lat, 99);
    st.set(0, `${Math.round(p50)} ms`);
    st.set(1, `${Math.round(p99)} ms`, p99 > 100 ? "bad" : p99 > 40 ? "warn" : "good");
    st.set(2, `${(res.hitSlow * 100).toFixed(res.hitSlow < 0.1 ? 1 : 0)}%`, res.hitSlow > 0.2 ? "bad" : res.hitSlow > 0.03 ? "warn" : "good");
    st.set(3, hedge ? `+${(res.extra * 100).toFixed(1)}%` : "0%", res.extra > 0.1 ? "warn" : "");
    draw(p50, p99);
  }

  function draw(p50, p99) {
    const c = fc.colors; fc.clear();
    // histogram, log x from 2 to 1000 ms
    const X0 = 40, X1 = 410, Y0 = 34, Y1 = 220, lo = Math.log(2), hi = Math.log(1000);
    const xs = (ms) => X0 + ((Math.log(Math.max(2, ms)) - lo) / (hi - lo)) * (X1 - X0);
    const B = 46, bins = new Array(B).fill(0);
    for (const v of res.lat) bins[Math.min(B - 1, Math.max(0, Math.floor(((Math.log(Math.max(2, v)) - lo) / (hi - lo)) * B)))]++;
    const top = Math.max(...bins);
    fc.text("User-facing latency (log scale)", X0, 16, { size: 12.5 });
    const bw = (X1 - X0) / B;
    bins.forEach((n, i) => {
      if (!n) return;
      const hgt = Math.max(2, Math.sqrt(n / top) * (Y1 - Y0));
      const mid = Math.exp(lo + ((i + 0.5) / B) * (hi - lo));
      fc.box(X0 + i * bw + 1, Y1 - hgt, bw - 2, hgt, { fill: mid > 60 ? c.bad : c.c1, stroke: "transparent", r: 2 });
    });
    fc.line(X0, Y1, X1, Y1, { color: c.line });
    for (const ms of [2, 10, 50, 100, 500, 1000]) fc.text(ms >= 1000 ? "1 s" : `${ms} ms`, xs(ms), Y1 + 14, { align: "center", size: 10, weight: 500, mono: true, color: c["ink-3"] });
    for (const [v, name] of [[p50, "p50"], [p99, "p99"]]) {
      fc.line(xs(v), Y0 + 4, xs(v), Y1, { color: c.ink, dash: [3, 4], lw: 1.2 });
      fc.text(name, xs(v) + 4, Y0 + 10, { size: 10.5, mono: true, color: c.ink });
    }
    fc.text("bar height is √count so rare slow requests stay visible", X0, 258, { size: 10, weight: 500, color: c["ink-3"] });
    // P(at least one slow call) vs fan-out
    const A0 = 470, A1 = 700, B0 = 40, B1 = 220, maxK = 100;
    fc.text("Chance a request hits a hiccup (no hedging)", A0 - 10, 16, { size: 12.5 });
    fc.line(A0, B1, A1, B1, { color: c.line }); fc.line(A0, B0, A0, B1, { color: c.line });
    for (const y of [0, 0.5, 1]) fc.text(`${y * 100}%`, A0 - 6, B1 - y * (B1 - B0), { align: "right", size: 10, weight: 500, mono: true, color: c["ink-3"] });
    for (const k of [1, 25, 50, 100]) fc.text(String(k), A0 + (k / maxK) * (A1 - A0), B1 + 14, { align: "center", size: 10, weight: 500, mono: true, color: c["ink-3"] });
    fc.text("backends per request", (A0 + A1) / 2, 258, { align: "center", size: 10, weight: 500, color: c["ink-3"] });
    const ctx = fc.ctx; ctx.beginPath();
    for (let k = 1; k <= maxK; k++) { const p = 1 - Math.pow(1 - slowP, k), x = A0 + (k / maxK) * (A1 - A0), y = B1 - p * (B1 - B0); k === 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.strokeStyle = c.bad; ctx.lineWidth = 2; ctx.stroke();
    const p = 1 - Math.pow(1 - slowP, K);
    fc.dot(A0 + (K / maxK) * (A1 - A0), B1 - p * (B1 - B0), 5.5, c.bad);
    fc.text(`${Math.round(p * 100)}%`, A0 + (K / maxK) * (A1 - A0) + (K > 80 ? -10 : 10), B1 - p * (B1 - B0) - 12, { align: K > 80 ? "right" : "left", size: 11, mono: true, color: c.ink });
  }

  const hedgeSeg = segmented({ label: "Hedge after", options: [{ value: 12, label: "12 ms (≈p90)" }, { value: 14, label: "14 ms (≈p95)" }, { value: 18, label: "18 ms (≈p99)" }], value: hedgeAt, onChange: (v) => { hedgeAt = v; run(); } });
  root.append(
    section(null, prose(`<p>Your average latency is not what users feel. A page that calls one backend is slow only when that backend is slow. A search that asks 100 index shards and waits for all of them is slow when <i>any</i> of them is. Rare hiccups (a garbage-collection pause, a noisy neighbour, a dropped packet) become the common case. Here each backend usually answers in about 8 ms but has a small chance of a 100 to 400 ms hiccup, and ${USERS.toLocaleString()} simulated users each wait for their slowest call.</p>`)),
    section("Fan out, then fight the tail",
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "Backends per request", min: 1, max: 100, value: K, onInput: (v) => { K = v; run(); } }),
          slider({ label: "Chance a backend call hiccups", min: 0.001, max: 0.05, step: 0.001, value: slowP, fmt: (v) => `${(v * 100).toFixed(1)}%`, onInput: (v) => { slowP = v; run(); } }),
          toggle({ label: "Hedged requests", onChange: (v) => { hedge = v; run(); } }),
          hedgeSeg,
        ),
        h("div.stage-body", st.el, fc.el),
      ),
      callout("tip", "Things to try", "<p>Drag “Backends per request” from 1 to 100 and watch p50 itself climb into the red: with 100 backends at 1% each, the slow case is now the typical case. Then turn on hedged requests: p99 drops from hundreds of milliseconds to tens, for a few percent of extra load. Hedging earlier cuts more tail but costs more load.</p>"),
      predict({
        chapter: id,
        question: "Each backend is slow 1% of the time. A request waits for 100 of them. How often is the request slow?",
        options: ["1%", "About 10%", "About 63%", "100%"],
        answer: 2,
        explain: "<p>The request is fast only if all 100 calls are fast: 0.99<sup>100</sup> ≈ 0.37. So 63% of requests hit at least one slow call. This is why Google's “The Tail at Scale” (Dean &amp; Barroso, 2013) says to measure and fix p99 and p99.9 of the components, not their averages.</p>",
      }),
    ),
    section("Ways to cut the tail",
      table(["Technique", "Idea", "Cost"], [
        ["Hedged requests", "After ~p95, send a copy to another replica; use the first answer", "A few % extra load"],
        ["Tied requests", "Send to two replicas at once; each cancels the other when it starts work", "Tiny extra load, needs cancellation"],
        ["Fewer fan-out hops", "Bigger shards, fewer of them; precompute joins", "Less parallelism"],
        ["Good enough answers", "Return after 95% of shards answer (search, recommendations)", "Slightly incomplete results"],
        ["Remove the hiccups", "Tune GC, pin CPUs, isolate noisy neighbours, avoid synchronous logging", "Engineering time"],
        ["Deadlines everywhere", "Pass a deadline down; backends drop work nobody will wait for", "Plumbing in every service"],
      ]),
      callout("warn", "Averages lie, and percentiles don't add up", "<p>Never average percentiles across servers or minutes: the p99 of the whole is not the mean of each part's p99. Keep histograms (HDR histograms, Prometheus histograms, t-digests) and compute percentiles from the merged data. And watch the coordinated-omission trap: a load tester that waits for each response before sending the next under-reports exactly the slow requests you care about.</p>"),
    ),
    section("In code",
      code({
        "Python (asyncio hedge)": `import asyncio

async def hedged(call, replicas, hedge_after=0.015):
    """Ask one replica; if it hasn't answered in hedge_after seconds, ask another too."""
    first = asyncio.create_task(call(replicas[0]))
    done, _ = await asyncio.wait({first}, timeout=hedge_after)
    if done:
        return first.result()
    second = asyncio.create_task(call(replicas[1]))
    done, pending = await asyncio.wait({first, second}, return_when=asyncio.FIRST_COMPLETED)
    for p in pending:
        p.cancel()                      # don't leave the loser running
    return done.pop().result()`,
        "Go (deadline propagation)": `func handler(w http.ResponseWriter, r *http.Request) {
    // the whole user request gets 200 ms; every downstream call inherits it
    ctx, cancel := context.WithTimeout(r.Context(), 200*time.Millisecond)
    defer cancel()

    g, ctx := errgroup.WithContext(ctx)
    results := make([]Result, len(shards))
    for i, s := range shards {
        g.Go(func() error {
            res, err := s.Search(ctx, query) // gRPC sends the deadline along
            results[i] = res
            return err
        })
    }
    if err := g.Wait(); err != nil { /* serve partial results */ }
}`,
        "Prometheus (p99 from histograms)": `# right: merge buckets across pods first, then take the quantile
histogram_quantile(0.99,
  sum by (le) (rate(http_request_duration_seconds_bucket{job="api"}[5m])))

# wrong: averaging each pod's p99
avg(histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])))`,
      }),
    ),
  );
  run();
}
