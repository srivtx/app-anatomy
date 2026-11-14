import { h, rng } from "../lib/core.js";
import { segmented, stats, predict, code, dilemma, callout, section, prose, button, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

const STRATS = { bigbang: "All at once", rolling: "Rolling (10% every 3 min)", bluegreen: "Blue/green", canary: "Canary with automatic analysis" };
const BUGS = { crash: ["Obvious: 30% of requests fail", 0.3, 1], subtle: ["Subtle: 1% more requests fail", 0.01, 1], segment: ["Only one customer group (4% of traffic) breaks", 0.6, 0.04] };
const T = 60, RPM = 1000, BASE = 0.005, ALERT = 0.02, PEOPLE = 5;

function binom(r, n, p) { if (n < 60) { let k = 0; for (let i = 0; i < n; i++) if (r() < p) k++; return k; } const m = n * p, sd = Math.sqrt(n * p * (1 - p)); const u = Math.max(1e-12, r()), v = r(); return Math.max(0, Math.round(m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v))); }

/** Simulate one hour of a deploy starting at minute 10. */
export function simulate(strategy, bug, seed = 3) {
  const r = rng(seed), [, rate, seg] = BUGS[bug];
  let share = 0, rollbackAt = null, detectAt = null, back = false;
  const rows = [], win = [];
  let cN = 0, cE = 0, bN = 0, bE = 0, bugFails = 0;
  for (let t = 0; t < T; t++) {
    // where traffic goes this minute
    if (!back) {
      if (strategy === "bigbang" || strategy === "bluegreen") share = t >= 10 ? 1 : 0;
      if (strategy === "rolling") share = t >= 10 ? Math.min(1, 0.1 * (1 + Math.floor((t - 10) / 3))) : 0;
      if (strategy === "canary") share = t < 10 ? 0 : t < 20 ? 0.05 : t < 30 ? 0.25 : 1;
    }
    if (rollbackAt != null && t >= rollbackAt) {
      back = true;
      if (strategy === "bigbang") share = t >= rollbackAt + 8 ? 0 : share;            // rebuild and redeploy the old version
      else if (strategy === "rolling") share = Math.max(0, share - 0.1);                // roll back node by node
      else share = 0;                                                                   // switch back / drain the canary
    }
    const n2 = Math.round(RPM * share), n1 = RPM - n2;
    const bf = binom(r, n2, rate * seg);
    const e1 = binom(r, n1, BASE), e2 = binom(r, n2, BASE) + bf;
    bugFails += bf;
    const errRate = (e1 + e2) / RPM;
    win.push(errRate); if (win.length > 5) win.shift();
    const fleet = win.reduce((a, b) => a + b, 0) / win.length;
    // detection
    if (detectAt == null && share > 0) {
      if (strategy === "canary" && share < 1) {
        cN += n2; cE += e2; bN += n1; bE += e1;
        const p1 = cE / Math.max(1, cN), p0 = bE / Math.max(1, bN), pp = (cE + bE) / (cN + bN);
        const z = (p1 - p0) / Math.sqrt(pp * (1 - pp) * (1 / Math.max(1, cN) + 1 / Math.max(1, bN)) + 1e-12);
        if (cN > 100 && z > 3) { detectAt = t; rollbackAt = t + 1; }
      } else if (fleet > ALERT) { detectAt = t; rollbackAt = t + PEOPLE; }
    }
    rows.push({ t, share, errRate, fleet });
  }
  return { rows, detectAt, bugFails, shipped: !back && share === 1 };
}

export default function (root, { id }) {
  let strategy = "bigbang", bug = "crash", shown = T, timer = 0;
  const fc = flowCanvas({ width: 720, height: 300 + 0, label: "Traffic on the new version and error rate over an hour" });
  const st = stats([{ label: "Requests broken by the bug" }, { label: "Noticed after" }, { label: "End state" }]);

  function draw() {
    const sim = simulate(strategy, bug), c = fc.colors; fc.clear();
    const L = 52, R = 700, X = (t) => L + ((R - L) * t) / T, ctx = fc.ctx;
    const P1 = [26, 116], P2 = [168, 280];                       // two panels, one axis each
    const yMax = Math.max(0.04, ...sim.rows.map((x) => x.errRate)) * 1.1;
    const Ys = (v) => P1[1] - (P1[1] - P1[0]) * v, Ye = (v) => P2[1] - ((P2[1] - P2[0]) * v) / yMax;
    fc.text("Traffic on the new version", L, 10, { size: 11.5, color: c.ink });
    fc.text("Error rate", L, P2[0] - 16, { size: 11.5, color: c.ink });
    for (const v of [0, 0.5, 1]) { fc.line(L, Ys(v), R, Ys(v), { color: c.line, lw: 1 }); fc.text(`${v * 100}%`, L - 8, Ys(v), { align: "right", size: 10, color: c["ink-2"], mono: true }); }
    for (let k = 0; k <= 2; k++) { const v = (yMax * k) / 2; fc.line(L, Ye(v), R, Ye(v), { color: c.line, lw: 1 }); fc.text(`${(v * 100).toFixed(1)}%`, L - 8, Ye(v), { align: "right", size: 10, color: c["ink-2"], mono: true }); }
    for (let t = 0; t <= T; t += 10) fc.text(`${t}m`, X(t), P2[1] + 14, { align: "center", size: 10, color: c["ink-2"], mono: true });
    const rows = sim.rows.slice(0, shown);
    ctx.beginPath(); ctx.moveTo(X(0), P1[1]);
    rows.forEach((x) => { ctx.lineTo(X(x.t), Ys(x.share)); ctx.lineTo(X(x.t + 1), Ys(x.share)); });
    ctx.lineTo(X(rows.length), P1[1]); ctx.closePath(); ctx.globalAlpha = 0.18; ctx.fillStyle = c.c1; ctx.fill(); ctx.globalAlpha = 1;
    ctx.beginPath(); rows.forEach((x, i) => { i ? ctx.lineTo(X(x.t), Ys(x.share)) : ctx.moveTo(X(x.t), Ys(x.share)); ctx.lineTo(X(x.t + 1), Ys(x.share)); }); ctx.strokeStyle = c.c1; ctx.lineWidth = 2; ctx.stroke();
    if (ALERT < yMax) { fc.line(L, Ye(ALERT), R, Ye(ALERT), { color: c.warn, dash: [6, 5], lw: 1.2 }); fc.text(`alert at ${ALERT * 100}% (5-minute average)`, R - 4, Ye(ALERT) - 9, { align: "right", size: 10, color: c.warn }); }
    ctx.beginPath(); rows.forEach((x, i) => (i ? ctx.lineTo(X(x.t + 0.5), Ye(x.errRate)) : ctx.moveTo(X(x.t + 0.5), Ye(x.errRate)))); ctx.strokeStyle = c.bad; ctx.lineWidth = 2; ctx.stroke();
    if (sim.detectAt != null && sim.detectAt < shown) { fc.line(X(sim.detectAt + 1), P1[0], X(sim.detectAt + 1), P2[1], { color: c.ink, dash: [3, 4], lw: 1 }); fc.text(strategy === "canary" ? "analysis fails the canary" : "alert fires", X(sim.detectAt + 1) + 5, P1[0] + 4, { size: 10.5 }); }
    const done = shown >= T;
    st.set(0, done ? sim.bugFails.toLocaleString() : "…", done ? (sim.bugFails > 2000 ? "bad" : sim.bugFails > 200 ? "" : "good") : "");
    st.set(1, done ? (sim.detectAt == null ? "never" : `${sim.detectAt - 10 + 1} min`) : "…", done && sim.detectAt == null ? "bad" : "");
    st.set(2, done ? (sim.shipped ? "bug shipped to everyone" : "rolled back") : "…", done ? (sim.shipped ? "bad" : "good") : "");
  }
  function play() { clearInterval(timer); shown = 0; draw(); timer = setInterval(() => { shown += 1; draw(); if (shown >= T) clearInterval(timer); }, 40); }

  root.append(
    section(null, prose(`<p>Most outages are caused by changes: a deploy, a config edit, a migration. You can't stop shipping, so the question is how much damage a bad change can do before you notice and undo it. That depends on two things: <b>how many users see the new version before you know it's bad</b>, and <b>how fast you can get back</b>.</p>
<p>Below, a new version with a bug goes out at minute 10 to a service handling ${RPM.toLocaleString()} requests a minute. The normal error rate is ${BASE * 100}%. Alerts fire when the 5-minute error rate passes ${ALERT * 100}%, and then people take ${PEOPLE} minutes to react. A canary is judged automatically by comparing its error rate with the old version's, every minute.</p>`)),
    section("Ship a bad version four ways",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "How you deploy", options: Object.entries(STRATS).map(([value, label]) => ({ value, label })), value: strategy, onChange: (v) => { strategy = v; play(); } }),
          segmented({ label: "The bug", options: Object.entries(BUGS).map(([value, [label]]) => ({ value, label })), value: bug, onChange: (v) => { bug = v; play(); } }),
          button("Replay", play, "primary"),
        ),
        h("div.stage-body", st.el, fc.el),
      ),
      callout("tip", "Things to try", "<p>With the obvious bug, all-at-once breaks thousands of requests before the alert fires and the old version is rebuilt. Blue/green fails just as fast but switches back in a minute. A canary breaks a few dozen requests and rolls itself back. Now pick the subtle bug: the fleet error rate never crosses the alert threshold, so every strategy except the canary ships it to everyone. The canary catches it because it compares the new version against the old one, not against a fixed threshold. The one-customer-group bug breaks 60% of that group's requests, but averaged over everyone it barely crosses the alert line: a rolling deploy takes over 20 minutes to notice, while the canary catches it in two. (Each run is one random draw; the counts are what matter, not the exact numbers.)</p>"),
      predict({
        chapter: id,
        question: "Why does a canary catch a bug that a fleet-wide alert misses?",
        options: ["Canaries get more traffic", "It compares the new version's error rate with the old version's at the same time, so small differences stand out", "Canaries run more tests before deploying", "Alerts are always configured wrong"],
        answer: 1,
        explain: "<p>A threshold on the whole fleet has to sit above normal noise, so it can't see a 1-point increase. A canary analysis compares two groups under identical conditions (same time, same traffic mix), so the baseline cancels out and a small difference becomes statistically clear. That's what tools like Argo Rollouts, Spinnaker's Kayenta and Flagger automate.</p>",
      }),
    ),
    section("The toolkit",
      table(["Technique", "Blast radius", "Undo time", "Cost"], [
        ["All at once", "Everyone", "A full redeploy (minutes)", "Cheapest; fine for internal tools"],
        ["Rolling", "Grows with time", "Roll back node by node", "Kubernetes' default; mixed versions run side by side"],
        ["Blue/green", "Everyone", "Seconds: switch the load balancer back", "Two full environments during the switch"],
        ["Canary + analysis", "A small slice", "Seconds, automatically", "Metrics good enough to compare; enough traffic for statistics"],
        ["Feature flag", "Whoever you turn it on for", "Instant: flip the flag", "Flag debt: old flags must be removed"],
      ]),
      dilemma("You need to rename a database column that the running code reads. How do you deploy it without downtime?", [
        { name: "Rename in one migration", pros: ["One step, simple"], cons: ["Old code still running during the deploy breaks instantly", "Rollback of the code no longer matches the schema"] },
        { name: "Expand, migrate, contract", pros: ["Old and new code both work at every step", "Each step can be rolled back"], cons: ["Three or four deploys", "Dual writes for a while"] },
      ], "Expand and contract: add the new column, deploy code that writes both and reads the old, backfill, deploy code that reads the new, then drop the old column in a later release. During a deploy, two versions of your code always run at once, so every schema change must work with both."),
      callout("warn", "Rollback isn't always possible", "<p>A deploy that changes stored data (a migration that drops a column, a new message format already written to a queue) can't be undone by redeploying the old code. Separate data changes from code changes, make them backward-compatible, and treat any irreversible step as its own, slower release.</p>"),
    ),
    section("In code",
      code({
        "Canary analysis (Argo Rollouts)": `apiVersion: argoproj.io/v1alpha1
kind: Rollout
spec:
  strategy:
    canary:
      steps:
        - setWeight: 5
        - analysis: { templates: [{ templateName: error-rate }] }
        - setWeight: 25
        - pause: { duration: 10m }
        - setWeight: 100
---
kind: AnalysisTemplate
metadata: { name: error-rate }
spec:
  metrics:
    - name: error-rate
      interval: 1m
      failureLimit: 1
      successCondition: result[0] < 0.01
      provider:
        prometheus:
          query: sum(rate(http_requests_total{version="canary",code=~"5.."}[2m])) / sum(rate(http_requests_total{version="canary"}[2m]))`,
        "Feature flag (TypeScript)": `// ship the code dark, turn it on for 1%, then 10%, then everyone
const useNewCheckout = flags.isEnabled("new-checkout", { userId: user.id, country: user.country });
return useNewCheckout ? newCheckout(cart) : oldCheckout(cart);
// bucket users deterministically so each one sees a consistent version:
const bucket = (hash(\`new-checkout:\${user.id}\`) % 10000) / 100;   // 0–100
const enabled = bucket < rolloutPercent;`,
        "Compare canary vs baseline": `function canaryFails(c, b, z = 3) {           // c, b: { requests, errors } since the canary started
  const p1 = c.errors / c.requests, p0 = b.errors / b.requests;
  const p = (c.errors + b.errors) / (c.requests + b.requests);
  const se = Math.sqrt(p * (1 - p) * (1 / c.requests + 1 / b.requests));
  return c.requests > 100 && (p1 - p0) / se > z;
}`,
      }),
    ),
  );
  play();
}
