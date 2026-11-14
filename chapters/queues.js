import { h, rng, loop, fmtMs } from "../lib/core.js";
import { slider, segmented, toggle, stats, predict, code, dilemma, callout, section, prose, liveChart, button, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

const SERVICE_MS = 120, MAX_RETRIES = 4;

function makeSim(o) {
  const r = rng(5);
  let now = 0, nextArrival = 0, burstUntil = -1, outageUntil = -1, nextScale = 1000;
  const queue = [], delayed = [], dlq = [], done = [];
  let workers = Array.from({ length: o.workers }, () => ({ job: null, end: 0, warmAt: 0 }));
  let targetWorkers = o.workers;
  const win = { created: 0, attempts: 0, ok: 0, failed: 0 };
  let id = 0;

  function fail(job) {
    win.failed++;
    job.attempts++;
    if (job.attempts > MAX_RETRIES) { dlq.push(job); return; }
    const delay = o.retry === "immediate" ? 0 : Math.min(10000, 500 * 2 ** (job.attempts - 1)) * (0.5 + r());
    job.availableAt = now + delay;
    job.retry = true;
    delay ? delayed.push(job) : queue.push(job);
  }

  return {
    queue, delayed, dlq, get workers() { return workers; }, get now() { return now; }, win,
    get outage() { return now < outageUntil; }, get burst() { return now < burstUntil; },
    burstFor(ms) { burstUntil = now + ms; },
    outageFor(ms) { outageUntil = now + ms; },
    oldestAge() { return queue.length ? now - queue[0].t0 : 0; },
    step(dtMs) {
      const end = now + dtMs;
      while (now < end) {
        now = Math.min(end, now + 5);
        const rate = o.rate * (now < burstUntil ? 5 : 1);
        while (nextArrival <= now) {
          nextArrival += r.exp(1000 / rate);
          queue.push({ id: id++, t0: now, attempts: 0 });
          win.created++;
        }
        for (let k = delayed.length - 1; k >= 0; k--) if (delayed[k].availableAt <= now) queue.push(...delayed.splice(k, 1));
        for (const w of workers) {
          if (w.job && w.end <= now) {
            const job = w.job; w.job = null;
            const failed = now < outageUntil || r() < o.failPct / 100;
            if (failed) fail(job); else { win.ok++; done.push(now); }
          }
          if (!w.job && w.warmAt <= now && queue.length) {
            w.job = queue.shift();
            w.end = now + r.exp(SERVICE_MS) * (now < outageUntil ? 0.3 : 1); // failing calls fail fast
            win.attempts++;
          }
        }
        if (o.autoscale && now >= nextScale) {
          nextScale = now + 1000;
          targetWorkers = Math.max(o.workers, Math.min(40, Math.ceil(queue.length / 15)));
          while (workers.length < targetWorkers) workers.push({ job: null, end: 0, warmAt: now + 3000 }); // 3 s cold start
          if (workers.length > targetWorkers) workers = workers.filter((w, i) => i < targetWorkers || w.job);
        }
      }
    },
    take() { const w = { ...win }; win.created = win.attempts = win.ok = win.failed = 0; return w; },
    setWorkers(n) { if (!o.autoscale) { while (workers.length < n) workers.push({ job: null, end: 0, warmAt: now }); workers = workers.filter((w, i) => i < n || w.job); } },
  };
}

export default function (root, { id }) {
  const o = { rate: 30, workers: 5, failPct: 2, retry: "backoff", autoscale: false };
  let sim = makeSim(o);
  const fc = flowCanvas({ width: 720, height: 230, label: "Jobs flowing through a queue to workers" });
  const st = stats([{ label: "Queue depth" }, { label: "Oldest job waiting" }, { label: "Attempts/s ÷ new jobs/s" }, { label: "Workers" }, { label: "Dead-letter queue" }]);
  const chart = liveChart({ series: [{ name: "Queue depth", color: "var(--c2)" }, { name: "Attempts/s", color: "var(--c6)" }, { name: "New jobs/s", color: "var(--c1)" }], height: 130, points: 100, fmt: (v) => Math.round(v), label: "Queue depth and attempts over time" });
  let acc = 0;

  function draw() {
    const c = fc.colors, Y = 100;
    fc.clear();
    fc.box(14, Y - 30, 90, 60, { stroke: sim.burst ? c.warm : c.line, lw: sim.burst ? 2.5 : 1.5 });
    fc.text("Web app", 59, Y - 8, { align: "center" }); fc.text(sim.burst ? "BURST ×5" : "enqueue", 59, Y + 12, { align: "center", size: 10.5, mono: true, weight: 500, color: sim.burst ? c.warm : c["ink-3"] });
    fc.box(130, Y - 26, 300, 52, { stroke: c.accent, lw: 2 });
    fc.text("queue", 136, Y - 36, { size: 10.5, mono: true, weight: 500, color: c["ink-3"] });
    const q = sim.queue, shown = Math.min(q.length, 72);
    for (let k = 0; k < shown; k++) {
      const job = q[k];
      fc.box(424 - 10 - (k % 36) * 8, Y - 18 + Math.floor(k / 36) * 20, 6, 14, { fill: job.retry ? c.warm : c.c1, stroke: "transparent", r: 2 });
    }
    if (q.length > shown) fc.text(`+${q.length - shown}`, 140, Y + 36, { size: 11, mono: true, color: c.warm });
    fc.text(`${sim.delayed.length} waiting to retry`, 280, Y + 42, { align: "center", size: 10.5, mono: true, weight: 500, color: c["ink-3"] });
    const ws = sim.workers, cols = Math.min(10, ws.length);
    fc.text("workers", 470, Y - 54, { size: 10.5, mono: true, weight: 500, color: c["ink-3"] });
    ws.slice(0, 40).forEach((w, i) => {
      const x = 480 + (i % cols) * 20, y = Y - 36 + Math.floor(i / cols) * 20;
      fc.dot(x, y, 7, w.warmAt > sim.now ? c.line : w.job ? (sim.outage ? c.bad : c.accent) : c.sunken);
    });
    fc.box(680 - 60, Y + 30, 90, 40, { stroke: sim.dlq.length ? c.bad : c.line });
    fc.text("DLQ", 665, Y + 42, { align: "center", size: 11 });
    fc.text(String(sim.dlq.length), 665, Y + 58, { align: "center", size: 11, mono: true, color: sim.dlq.length ? c.bad : c["ink-3"] });
    fc.box(620, Y - 70, 90, 40, { stroke: sim.outage ? c.bad : c.line, lw: sim.outage ? 2.5 : 1.5 });
    fc.text("Payment API", 665, Y - 58, { align: "center", size: 11 });
    fc.text(sim.outage ? "DOWN" : "ok", 665, Y - 42, { align: "center", size: 10.5, mono: true, color: sim.outage ? c.bad : c.good });
    fc.box(14, 204, 7, 13, { fill: c.c1, stroke: "transparent", r: 2 }); fc.text("new job", 27, 211, { size: 11, color: c["ink-2"] });
    fc.box(90, 204, 7, 13, { fill: c.warm, stroke: "transparent", r: 2 }); fc.text("retry", 103, 211, { size: 11, color: c["ink-2"] });
  }

  const lp = loop((dt) => {
    sim.step(dt * 1000);
    draw();
    acc += dt;
    if (acc >= 0.5) {
      const w = sim.take(), k = 1 / acc;
      acc = 0;
      const amp = w.created ? w.attempts / w.created : 0;
      st.set(0, String(sim.queue.length), sim.queue.length > 200 ? "bad" : "");
      st.set(1, fmtMs(sim.oldestAge()), sim.oldestAge() > 5000 ? "bad" : "");
      st.set(2, `${amp.toFixed(1)}×`, amp > 1.5 ? "bad" : "good");
      st.set(3, String(sim.workers.length));
      st.set(4, String(sim.dlq.length), sim.dlq.length ? "bad" : "");
      chart.push([sim.queue.length, w.attempts * k, w.created * k]);
    }
  }, fc.el);

  const workersSl = slider({ label: "Workers", min: 1, max: 20, value: o.workers, onInput: (v) => { o.workers = v; sim.setWorkers(v); } });
  root.append(
    section(null, prose(`<p>Some work shouldn't happen while the user waits: sending emails, resizing images, charging cards, generating reports. The web app puts a <b>job</b> on a <b>queue</b> and answers <code>202 Accepted</code> right away; <b>workers</b> pull jobs and do them at their own pace. The queue absorbs bursts. It also lets a failing dependency turn retries into a storm, if you're careless.</p>`)),
    section("Run a job queue",
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "New jobs", min: 5, max: 80, step: 5, value: o.rate, fmt: (v) => `${v}/s`, onInput: (v) => { o.rate = v; } }),
          workersSl,
          slider({ label: "Random failure rate", min: 0, max: 30, value: o.failPct, fmt: (v) => `${v}%`, onInput: (v) => { o.failPct = v; } }),
          segmented({ label: "Retry policy", options: [{ value: "immediate", label: "Retry immediately" }, { value: "backoff", label: "Exponential backoff + jitter" }], value: o.retry, onChange: (v) => { o.retry = v; } }),
          toggle({ label: "Autoscale workers", hint: "new workers take 3 s to start", onChange: (v) => { o.autoscale = v; } }),
          button("Traffic burst (5× for 5 s)", () => sim.burstFor(5000), "primary"),
          button("Payment API down for 6 s", () => sim.outageFor(6000)),
          button("Reset", () => { sim = makeSim(o); chart.reset(); }),
        ),
        h("div.stage-body", st.el, fc.el, chart.el),
      ),
      callout("tip", "Things to try", `<ul style="margin:0;padding-left:18px"><li>Fire a burst. The queue fills, then drains at the workers' pace: users never saw an error.</li><li>Take the payment API down with “retry immediately”: attempts per new job shoot up and the dead-letter queue fills. Reset, switch to backoff, and repeat.</li><li>Turn on autoscaling and fire a burst. Notice the 3-second cold start before new workers help.</li><li>${o.workers} workers × ~${Math.round(1000 / SERVICE_MS)} jobs/s each is the capacity. Push new jobs above it and the queue grows forever.</li></ul>`),
      predict({
        chapter: id,
        question: "The payment API goes down for 6 seconds. Workers retry every failure immediately, up to 4 times. What happens?",
        options: ["Jobs wait politely until the API is back", "Each job burns all its retries within milliseconds, the API gets hammered, and jobs land in the dead-letter queue", "Nothing, retries only happen after success", "The queue deletes the failed jobs"],
        answer: 1,
        explain: "<p>Immediate retries multiply the load on a service that's already down, and every job exhausts its attempts long before the outage ends. Exponential backoff with jitter spaces attempts out (0.5 s, 1 s, 2 s, 4 s…, randomised so they don't synchronise), so most jobs simply succeed once the API recovers.</p>",
      }),
    ),
    section("Delivery guarantees and idempotency",
      prose("<p>Queues usually promise <b>at-least-once</b> delivery: if a worker crashes after charging the card but before acknowledging the job, the job runs again. So handlers must be <b>idempotent</b>: running twice has the same effect as once. The usual trick is an idempotency key, stored with a unique constraint, checked before doing the side effect.</p>"),
      dilemma("A job charges a customer's card. Which guarantee do you want?", [
        { name: "At-most-once", pros: ["Never charges twice"], cons: ["A crash can silently drop a payment"] },
        { name: "At-least-once + idempotency key", pros: ["Never loses a payment", "Duplicates are detected and skipped"], cons: ["Every handler must be written carefully", "Needs a dedupe store"] },
      ], "“Exactly-once” is at-least-once delivery plus idempotent processing. Payment providers (Stripe, Adyen) accept an Idempotency-Key header for exactly this reason."),
      table(["Tool", "Model", "Typical use"], [
        ["Redis + BullMQ / Sidekiq / Celery", "Job queue", "Background jobs in a web app"],
        ["RabbitMQ", "Message broker with routing", "Work queues, fan-out between services"],
        ["AWS SQS", "Managed queue, DLQ built in", "Decoupling services without running a broker"],
        ["Kafka", "Durable, replayable log", "Event streams, many consumers reading the same events"],
      ]),
    ),
    section("In code",
      code({
        "Python (Celery)": `@app.task(
    bind=True,
    autoretry_for=(PaymentUnavailable,),
    retry_backoff=True,      # 1 s, 2 s, 4 s, ...
    retry_jitter=True,       # randomise to avoid synchronised retries
    max_retries=4,
    acks_late=True,          # ack after the work, so a crash re-delivers it
)
def charge(self, order_id: str):
    order = Order.get(order_id)
    if order.charged:                                   # idempotent: safe to run twice
        return
    payments.charge(order.card, order.total, idempotency_key=order_id)
    order.mark_charged()

# in the web request: enqueue and answer immediately
charge.delay(order.id)       # → 202 Accepted`,
        "Node (BullMQ)": `import { Queue, Worker } from "bullmq";

const payments = new Queue("payments", { connection });
await payments.add("charge", { orderId }, {
  attempts: 5,
  backoff: { type: "exponential", delay: 500 },
  jobId: orderId,                  // the same order can't be enqueued twice
});

new Worker("payments", async (job) => {
  await charge(job.data.orderId); // throw to retry
}, { connection, concurrency: 5 });`,
        "AWS SQS DLQ": `{
  "RedrivePolicy": {
    "deadLetterTargetArn": "arn:aws:sqs:eu-west-1:123456789012:payments-dlq",
    "maxReceiveCount": "5"
  },
  "VisibilityTimeout": "60"
}`,
      }),
    ),
  );
  draw();
  lp.start();
}
