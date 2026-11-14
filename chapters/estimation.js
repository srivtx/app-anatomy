import { h } from "../lib/core.js";
import { slider, segmented, stats, stepper, predict, code, callout, section, prose, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// Back-of-the-envelope capacity planning. Every input is on a log scale because
// in estimation only the order of magnitude matters.
const DAY = 86400;
const PRESETS = {
  shortener: { label: "URL shortener", dau: 1e8, writes: 1, reads: 100, bytes: 500, years: 5, peak: 3 },
  chat: { label: "Chat app", dau: 5e7, writes: 40, reads: 5, bytes: 300, years: 5, peak: 4 },
  photos: { label: "Photo sharing", dau: 2e8, writes: 0.1, reads: 300, bytes: 2e6, years: 10, peak: 3 },
  rides: { label: "Ride hailing (driver GPS)", dau: 1e6, writes: 7200, reads: 3, bytes: 100, years: 1, peak: 3 },
};
// What one ordinary machine can do (rough, 2020s hardware, simple operations)
const ONE = { app: 5000, dbWrites: 10000, cacheGB: 256, diskTB: 4, egressGbps: 10 };

const human = (x, unit = "") => {
  const u = [[1e15, "P"], [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"]];
  for (const [v, s] of u) if (x >= v) return `${(x / v).toFixed(x / v < 10 ? 1 : 0)} ${s}${unit}`;
  return `${x < 10 ? x.toFixed(x < 1 ? 2 : 1) : Math.round(x)} ${unit}`.trim();
};
const bytesH = (b) => human(b, "B");

export default function (root, { id }) {
  let v = { ...PRESETS.shortener };
  const fc = flowCanvas({ width: 720, height: 230, label: "How many machines each resource needs, on a log scale" });
  const st = stats([{ label: "Writes per second (avg)" }, { label: "Reads per second (peak)" }, { label: "Storage incl. 3 replicas" }, { label: "Peak egress" }, { label: "Cache for hot 20% of a day" }, { label: "App servers / DB shards for writes" }]);

  function compute() {
    const writes = (v.dau * v.writes) / DAY, reads = writes * v.reads;
    const peakR = reads * v.peak, peakW = writes * v.peak;
    const storage = writes * DAY * 365 * v.years * v.bytes * 3;
    const egress = peakR * v.bytes * 8;                     // bits/s
    const cache = Math.min(writes * DAY * v.bytes, 0.2 * writes * DAY * v.reads * v.bytes);
    const app = Math.max(1, Math.ceil((peakR + peakW) / ONE.app));
    const shards = Math.max(1, Math.ceil(peakW / ONE.dbWrites));   // big blobs live in object storage, not the database
    return { writes, reads, peakR, peakW, storage, egress, cache, app, shards };
  }
  function refresh() {
    const r = compute();
    st.set(0, `${human(r.writes)}/s`);
    st.set(1, `${human(r.peakR)}/s`);
    st.set(2, bytesH(r.storage));
    st.set(3, `${human(r.egress, "b")}/s`);
    st.set(4, bytesH(r.cache));
    st.set(5, `${r.app} / ${r.shards}`, r.shards > 50 ? "warn" : "");
    draw(r);
  }

  function draw(r) {
    const c = fc.colors; fc.clear();
    const rows = [
      ["App servers (requests)", (r.peakR + r.peakW) / ONE.app, `${human(ONE.app)} req/s each`],
      ["Database writes", r.peakW / ONE.dbWrites, `${human(ONE.dbWrites)} writes/s each`],
      ["Disk", r.storage / (ONE.diskTB * 1e12), `${ONE.diskTB} TB each`],
      ["Cache memory", r.cache / (ONE.cacheGB * 1e9), `${ONE.cacheGB} GB each`],
      ["Network out", r.egress / (ONE.egressGbps * 1e9), `${ONE.egressGbps} Gb/s each`],
    ];
    const X0 = 200, X1 = 640, lo = -4, hi = 4, xs = (m) => X0 + ((Math.log10(Math.max(1e-4, Math.min(1e4, m))) - lo) / (hi - lo)) * (X1 - X0);
    fc.text("How many machines does each resource need?", 8, 14, { size: 12.5 });
    for (let e = lo; e <= hi; e += 2) {
      fc.line(xs(10 ** e), 30, xs(10 ** e), 196, { color: c.line, lw: 1, dash: e === 0 ? null : [2, 4] });
      fc.text(e === 0 ? "1 machine" : e > 0 ? `${human(10 ** e)}` : `1/${human(10 ** -e)}`, xs(10 ** e), 210, { align: "center", size: 10, weight: e === 0 ? 700 : 500, mono: true, color: e === 0 ? c.ink : c["ink-3"] });
    }
    rows.forEach(([name, m, note], i) => {
      const y = 38 + i * 32;
      fc.text(name, 8, y + 6, { size: 11.5 });
      fc.text(note, 8, y + 20, { size: 9.5, weight: 500, color: c["ink-3"] });
      const col = m > 10 ? c.bad : m > 1 ? c.warn : c.good;
      const a = xs(1e-4), b = xs(m);
      fc.box(a, y + 2, Math.max(4, b - a), 16, { fill: col, stroke: "transparent", r: 4 });
      fc.text(m >= 1 ? `×${human(Math.ceil(m))}` : `${(m * 100).toFixed(m < 0.01 ? 2 : 0)}% of one`, Math.min(b + 6, 650), y + 10, { size: 10.5, mono: true, color: c.ink });
    });
  }

  const log = (key, label, min, max, fmt) => slider({ label, min: Math.log10(min), max: Math.log10(max), step: 0.05, value: Math.log10(v[key]), fmt: (x) => fmt(10 ** x), onInput: (x) => { v[key] = 10 ** x; refresh(); } });
  const controls = () => [
    log("dau", "Daily active users", 1e3, 1e9, (x) => human(x)),
    log("writes", "Writes per user per day", 0.01, 1e4, (x) => human(x)),
    log("reads", "Reads per write", 1, 1e3, (x) => human(x)),
    log("bytes", "Bytes per write", 50, 1e7, bytesH),
    slider({ label: "Keep data for", min: 1, max: 10, value: v.years, fmt: (x) => `${x} yr`, onInput: (x) => { v.years = x; refresh(); } }),
    slider({ label: "Peak ÷ average", min: 1, max: 10, value: v.peak, fmt: (x) => `${x}×`, onInput: (x) => { v.peak = x; refresh(); } }),
  ];
  const ctl = h("div.stage-controls");
  function setPreset(p) { v = { ...PRESETS[p] }; ctl.replaceChildren(seg, ...controls()); refresh(); }
  const seg = segmented({ label: "Start from", options: Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label })), value: "shortener", onChange: setPreset });

  // latency numbers, log bars
  const LAT = [
    ["L1 cache reference", 1e-9], ["Main memory reference", 1e-7], ["Read 1 MB from RAM", 5e-5], ["NVMe SSD random 4 KB read", 1e-4],
    ["Round trip in one datacenter", 5e-4], ["Redis GET over the network", 5e-4], ["Simple indexed Postgres query", 1e-3], ["Read 1 MB from NVMe", 2e-4],
    ["Spinning disk seek", 5e-3], ["Round trip US east ↔ west", 7e-2], ["Round trip Europe ↔ US west", 1.5e-1], ["LLM first token (typical API)", 5e-1],
  ].sort((a, b) => a[1] - b[1]);
  const lat = flowCanvas({ width: 720, height: 32 + LAT.length * 22, label: "Latency numbers on a log scale" });
  function drawLat() {
    const c = lat.colors; lat.clear();
    const X0 = 230, X1 = 640, xs = (s) => X0 + ((Math.log10(s) + 9) / 9) * (X1 - X0);
    for (const [s, l] of [[1e-9, "1 ns"], [1e-6, "1 µs"], [1e-3, "1 ms"], [1, "1 s"]]) { lat.line(xs(s), 6, xs(s), 18 + LAT.length * 22, { color: c.line, lw: 1, dash: [2, 4] }); lat.text(l, xs(s), 26 + LAT.length * 22, { align: "center", size: 10, mono: true, weight: 500, color: c["ink-3"] }); }
    LAT.forEach(([name, s], i) => {
      const y = 10 + i * 22, col = s < 1e-6 ? c.c3 : s < 1e-3 ? c.c1 : s < 0.05 ? c.c4 : c.c2;
      lat.text(name, 8, y + 6, { size: 11 });
      lat.box(X0, y, Math.max(3, xs(s) - X0), 12, { fill: col, stroke: "transparent", r: 3 });
      const f = s >= 1e-3 ? `${+(s * 1e3).toPrecision(2)} ms` : s >= 1e-6 ? `${+(s * 1e6).toPrecision(2)} µs` : `${+(s * 1e9).toPrecision(2)} ns`;
      lat.text(f, xs(s) + 6, y + 6, { size: 10.5, mono: true, color: c.ink });
    });
  }
  new ResizeObserver(drawLat).observe(lat.el);

  root.append(
    section(null, prose(`<p>Before drawing boxes, find out how big the problem is. Ten minutes of arithmetic tells you whether you need one Postgres server or a hundred shards, whether the data fits in memory, and which resource will run out first. Only orders of magnitude matter, so every slider here moves on a log scale. Useful constants: a day is about 10<sup>5</sup> seconds, so <b>1 million per day ≈ 12 per second</b>.</p>`)),
    section("The envelope",
      h("div.stage", ctl, h("div.stage-body", st.el, fc.el)),
      callout("tip", "Things to try", "<p>Flip through the presets and see which bar goes red first: the URL shortener's writes are modest (about a thousand a second: one database could take them) while its reads need a cache, photo sharing is a bandwidth and storage problem: hundreds of petabytes and terabits per second, which is why the bytes go to object storage behind a CDN while the database only holds metadata, chat is a write and fan-out problem, and driver GPS is a write firehose you keep only briefly.</p>"),
      predict({
        chapter: id,
        question: "100 million new short URLs a day. Roughly how many writes per second is that, on average?",
        options: ["About 100", "About 1,200", "About 12,000", "About 100,000"],
        answer: 1,
        explain: "<p>10<sup>8</sup> ÷ 10<sup>5</sup> seconds ≈ 1,000 (exactly 1,157). At a 3× peak that's ~3,500 writes/s: one well-tuned database can take it, though you'd still replicate it for safety. Most system-design “scale” questions are smaller than they sound.</p>",
      }),
    ),
    section("Latency numbers to keep in your head",
      h("div.stage", h("div.stage-body", lat.el)),
      prose(`<p>Each step down is roughly 10–1000× slower. Memory is ~1000× faster than an SSD read; a datacenter round trip costs about as much as a few SSD reads; crossing an ocean costs more than a hundred of them. That's why caches sit in memory, why services talk within one region, and why “just call another service” in a loop adds up fast. Numbers are rough, for typical 2020s hardware.</p>`),
    ),
    section("A design interview, step by step: URL shortener",
      stepper([
        { title: "1. Requirements", html: "<p><b>Functional:</b> shorten a long URL; redirect a short code to it; optional custom alias and expiry; click counts.</p><p><b>Non-functional:</b> redirects fast (p99 &lt; 50 ms) and always up; codes not guessable in sequence; 100 M new URLs/day; reads ≫ writes.</p><p>Ask, don't assume. The numbers you agree on here drive everything else.</p>" },
        { title: "2. Estimate", html: "<p>Writes: 10<sup>8</sup>/day ≈ 1,200/s, peak ~4,000/s. Reads at 100:1: ~120,000/s average, ~400,000/s peak.</p><p>Storage: 500 B × 10<sup>8</sup> × 365 × 5 ≈ 90 TB, ×3 replicas ≈ 270 TB. Hot set: most clicks go to recent links, so a few hundred GB of cache covers the bulk of reads.</p><p>Conclusion: the read path is the hard part; the write path is modest.</p>" },
        { title: "3. API", html: "<pre>POST /api/urls        {url, alias?, expires_at?}  → {code}\nGET  /{code}          → 301/302 Location: url\nGET  /api/urls/{code}/stats</pre><p>301 lets browsers cache the redirect forever (fewer hits, but you lose click counting); 302 sends every click through you. Most shorteners use 302 for analytics.</p>" },
        { title: "4. Data model", html: "<pre>urls(code PRIMARY KEY, long_url, owner_id, created_at, expires_at)\nclicks: append-only events → stream → aggregated counts</pre><p>Lookups are by exact key only: any key-value store works (DynamoDB, Cassandra, or sharded Postgres). Never put click counting in the redirect's write path; send events to a queue.</p>" },
        { title: "5. Generating codes", html: "<p>7 base-62 characters = 62<sup>7</sup> ≈ 3.5 trillion codes: enough for 95 years at 10<sup>8</sup>/day.</p><p><b>Options:</b> hash the URL and take 7 chars (collisions to handle); a counter encoded in base 62 (needs a coordinated counter, and sequential codes are guessable, so shuffle with a bijective cipher); or random 7 chars with an insert-if-absent retry (simple, collisions rare until the space fills).</p>" },
        { title: "6. High-level design", html: "<p>CDN / edge → load balancer → stateless redirect service → cache (Redis, ~95% hit rate) → key-value store, sharded by code. Writes go through an API service that generates the code and inserts it. Clicks go to Kafka → stream processor → analytics store.</p><p>Reads at 400k/s split across ~20 cache nodes and ~80 small app servers; the database sees only cache misses.</p>" },
        { title: "7. Deep dives and trade-offs", html: "<p><b>Hot links</b> (a viral tweet): cache at the edge with a short TTL, and request coalescing so one miss doesn't stampede the database. <b>Abuse:</b> rate limit creation per user and IP, scan URLs for malware. <b>Expiry:</b> lazy check on read plus a background sweeper. <b>Multi-region:</b> replicate the read path everywhere; writes can go to one home region since they're rare.</p><p>Every chapter of this course is one of these deep dives.</p>" },
      ]),
    ),
    section("Rules of thumb",
      table(["Quantity", "Rough number"], [
        ["Seconds in a day", "86,400 ≈ 10⁵"],
        ["1 million requests/day", "≈ 12 per second"],
        ["One app server (simple JSON API)", "1k–10k requests/s"],
        ["One Postgres/MySQL primary", "~10k simple writes/s; ~50k+ indexed reads/s"],
        ["One Redis node", "~100k+ operations/s"],
        ["One Kafka partition", "~10 MB/s; a cluster: GB/s"],
        ["Peak vs average traffic", "2–10×, worse for events (sales, matches, launches)"],
        ["Cache rule", "20% of objects usually get ~80% of the reads"],
      ]),
      callout("note", "Estimate to choose, not to predict", "<p>The point isn't the exact number. It's finding which resource dominates (requests? writes? bytes? fan-out?) and whether you're 10× under one machine or 100× over. Then design for that resource and leave headroom: plan for 2–3× your estimated peak.</p>"),
    ),
    section("In code",
      code({
        "Python (the same envelope)": `DAY = 86_400

def envelope(dau, writes_per_user, reads_per_write, bytes_per_write, years, peak=3):
    w = dau * writes_per_user / DAY
    r = w * reads_per_write
    storage = w * DAY * 365 * years * bytes_per_write * 3          # 3 replicas
    return {
        "writes/s": round(w), "peak reads/s": round(r * peak),
        "storage TB": round(storage / 1e12, 1),
        "egress Gb/s": round(r * peak * bytes_per_write * 8 / 1e9, 2),
    }

envelope(dau=1e8, writes_per_user=1, reads_per_write=100, bytes_per_write=500, years=5)
# {'writes/s': 1157, 'peak reads/s': 347222, 'storage TB': 273.8, 'egress Gb/s': 1.39}`,
        "Base-62 codes": `ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

def encode(n: int, width=7) -> str:
    s = []
    while n:
        n, r = divmod(n, 62)
        s.append(ALPHABET[r])
    return "".join(reversed(s)).rjust(width, "0")

# make a counter non-guessable with any bijection on [0, 62**7), e.g. an affine map
M = 62 ** 7
def code_for(counter: int) -> str:
    return encode((counter * 2_654_435_761 + 12_345) % M)   # multiplier coprime with M`,
      }),
    ),
  );
  setPreset("shortener");
}
