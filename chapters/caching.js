import { h, rng, loop, fmtPct } from "../lib/core.js";
import { slider, toggle, stats, predict, code, dilemma, callout, section, prose, liveChart, button, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// Cache-aside with an LRU cache, TTLs, Zipf-distributed keys and optional
// request coalescing (single-flight). Time runs in simulated milliseconds.
function makeSim(o) {
  const r = rng(11);
  const cache = new Map(); // key -> expiresAt  (Map order = LRU order)
  const pending = new Map(); // key -> finishAt  (in-flight DB fetches)
  let now = 0, nextArrival = 0;
  const win = { req: 0, hit: 0, db: 0, coalesced: 0 };
  const particles = [];
  let dbInflight = 0;
  const dbDone = []; // [finishAt, key]

  return {
    particles, cache, get now() { return now; }, get dbInflight() { return dbInflight; }, win,
    step(dtMs) {
      const end = now + dtMs;
      const cap = Math.max(1, Math.round((o.keys * o.capPct) / 100));
      while (now < end) {
        now = Math.min(end, now + 2);
        while (nextArrival <= now) {
          nextArrival += r.exp(1000 / o.rate);
          const key = r() < 0.3 ? 0 : r.zipf(o.keys, o.skew); // key 0 is the home feed: 30% of all traffic
          win.req++;
          const exp = cache.get(key);
          let kind;
          if (exp !== undefined && exp > now) {
            cache.delete(key); cache.set(key, exp); // refresh LRU position
            win.hit++; kind = "hit";
          } else if (o.coalesce && pending.has(key)) {
            win.coalesced++; kind = "wait";
          } else {
            win.db++; dbInflight++; kind = "miss";
            // DB slows down when overloaded (queueing)
            const finish = now + o.dbMs * Math.max(1, dbInflight / 150);
            dbDone.push([finish, key]);
            if (!pending.has(key)) pending.set(key, finish);
          }
          if (r() < 120 / o.rate) particles.push({ t: now, kind });
        }
        for (let k = dbDone.length - 1; k >= 0; k--) {
          const [fin, key] = dbDone[k];
          if (fin > now) continue;
          dbDone.splice(k, 1); dbInflight--;
          pending.delete(key);
          cache.delete(key);
          cache.set(key, now + o.ttl * 1000 * (o.jitter ? 0.8 + r() * 0.4 : 1));
          while (cache.size > cap) cache.delete(cache.keys().next().value); // evict least recently used
        }
      }
      for (let k = particles.length - 1; k >= 0; k--) if (now - particles[k].t > 900) particles.splice(k, 1);
    },
    expireHot() { cache.delete(0); },
    flush() { cache.clear(); },
    take() { const w = { ...win }; win.req = win.hit = win.db = win.coalesced = 0; return w; },
  };
}

export default function (root, { id }) {
  const o = { keys: 10000, capPct: 10, skew: 1, ttl: 30, rate: 600, dbMs: 250, coalesce: false, jitter: false };
  let sim = makeSim(o);
  const fc = flowCanvas({ width: 720, height: 190, label: "Requests hitting a cache, misses going to the database" });
  const st = stats([{ label: "Hit ratio" }, { label: "Database queries/s" }, { label: "Coalesced waits/s" }, { label: "DB in flight" }]);
  const chart = liveChart({ series: [{ name: "DB queries/s", color: "var(--c2)" }, { name: "Hits/s", color: "var(--c3)" }], height: 130, points: 100, fmt: (v) => Math.round(v), label: "Database load over time" });
  let acc = 0;

  function draw() {
    const c = fc.colors, Y = 92;
    fc.clear();
    const A = [20, Y - 30, 110, 60], C = [300, Y - 40, 120, 80], D = [580, Y - 30, 120, 60];
    fc.line(130, Y, 300, Y); fc.line(420, Y, 580, Y);
    for (const p of sim.particles) {
      const t = (sim.now - p.t) / 900;
      let x;
      const y = Y + ((p.t * 7) % 34) - 17;
      if (p.kind === "hit") x = t < 0.5 ? 130 + 170 * (t / 0.5) : 300 - 170 * ((t - 0.5) / 0.5);
      else if (p.kind === "wait") x = t < 0.5 ? 130 + 170 * (t / 0.5) : 300;
      else x = t < 0.5 ? 130 + 450 * (t / 0.5) : 580 - 450 * ((t - 0.5) / 0.5);
      fc.dot(x, y, 3, p.kind === "hit" ? c.good : p.kind === "wait" ? c.c6 : c.warm);
    }
    fc.box(...A, {}); fc.text("App", A[0] + 55, Y, { align: "center" });
    fc.box(...C, { stroke: c.accent, lw: 2 }); fc.text("Cache", C[0] + 60, Y - 18, { align: "center" });
    fc.text(`${sim.cache.size.toLocaleString()} keys`, C[0] + 60, Y + 2, { align: "center", size: 10.5, weight: 500, mono: true, color: c["ink-3"] });
    fc.bar(C[0] + 14, Y + 18, 92, 8, sim.cache.size / Math.max(1, (o.keys * o.capPct) / 100), c.accent);
    const load = Math.min(1, sim.dbInflight / 150);
    fc.box(...D, { stroke: load > 0.5 ? c.bad : c.line, lw: load > 0.5 ? 2.5 : 1.5 });
    fc.text("Database", D[0] + 60, Y - 8, { align: "center" });
    fc.text(`${sim.dbInflight} in flight`, D[0] + 60, Y + 12, { align: "center", size: 10.5, weight: 500, mono: true, color: load > 0.5 ? c.bad : c["ink-3"] });
    fc.text("● hit", 20, 176, { color: c.good, size: 11 }); fc.text("● miss → database", 80, 176, { color: c.warm, size: 11 }); fc.text("● waits for an in-flight fetch", 220, 176, { color: c.c6, size: 11 });
  }

  const lp = loop((dt) => {
    sim.step(dt * 1000);
    draw();
    acc += dt;
    if (acc >= 0.5) {
      const w = sim.take(), k = 1 / acc;
      acc = 0;
      const ratio = w.req ? w.hit / w.req : 0;
      st.set(0, fmtPct(ratio), ratio > 0.8 ? "good" : ratio < 0.4 ? "bad" : "");
      st.set(1, String(Math.round(w.db * k)), w.db * k > 300 ? "bad" : "");
      st.set(2, String(Math.round(w.coalesced * k)));
      st.set(3, String(sim.dbInflight), sim.dbInflight > 100 ? "bad" : "");
      chart.push([w.db * k, w.hit * k]);
    }
  }, fc.el);

  const restart = () => { sim = makeSim(o); chart.reset(); };

  root.append(
    section(null, prose(`<p>A database query might take 50–250 ms; reading the same answer from memory takes well under a millisecond. A <b>cache</b> keeps recent answers close. The pattern used almost everywhere is <b>cache-aside</b>: check the cache, on a miss read the database and store the result with an expiry time (TTL). It works brilliantly because real traffic is skewed: a few keys get most of the requests.</p>`)),
    section("Put a cache in front of the database",
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "Cache size", min: 1, max: 100, value: o.capPct, fmt: (v) => `${v}% of keys`, onInput: (v) => { o.capPct = v; } }),
          slider({ label: "Popularity skew (Zipf s)", min: 0, max: 1.6, step: 0.1, value: o.skew, fmt: (v) => (v === 0 ? "uniform" : v.toFixed(1)), onInput: (v) => { o.skew = v; restart(); } }),
          slider({ label: "TTL", min: 1, max: 120, value: o.ttl, fmt: (v) => `${v} s`, onInput: (v) => { o.ttl = v; } }),
          slider({ label: "Traffic", min: 100, max: 2000, step: 100, value: o.rate, fmt: (v) => `${v} req/s`, onInput: (v) => { o.rate = v; } }),
          toggle({ label: "Request coalescing", onChange: (v) => { o.coalesce = v; } }),
          toggle({ label: "TTL jitter (±20%)", onChange: (v) => { o.jitter = v; } }),
          button("Expire the home feed key", () => sim.expireHot(), "primary"),
          button("Flush the whole cache", () => sim.flush()),
        ),
        h("div.stage-body", st.el, fc.el, chart.el),
      ),
      callout("tip", "Things to try", "<ul style='margin:0;padding-left:18px'><li>Set skew to uniform: the same 10% cache suddenly helps much less.</li><li>The home feed key gets 30% of all traffic. Expire it with coalescing off, then on, and watch the database line spike.</li><li>Flush the whole cache: that's what a deploy that restarts Redis does to your database.</li></ul>"),
      predict({
        chapter: id,
        question: "The cache holds only 10% of the 10,000 keys, and popularity has a typical skew (s = 1). Roughly what hit ratio do you get once it's warm?",
        options: ["About 10%", "About 40%", "About 75%", "About 99%"],
        answer: 2,
        explain: "<p>With Zipf-like traffic the top 1,000 keys receive about 76% of all requests (the harmonic sum up to 1,000 over the sum up to 10,000). That's why small caches pay off so well, and why caches work worse for uniform, long-tail traffic like search queries.</p>",
      }),
    ),
    section("The stampede",
      prose("<p>When a hot key expires, every request for it misses at the same moment, and all of them run the same expensive query. The database slows down, so the misses last longer, so more requests pile in. That feedback loop is a <b>cache stampede</b> (or thundering herd). Fixes:</p><ul><li><b>Request coalescing / single-flight</b>: only one request fetches; the others wait for its result.</li><li><b>TTL jitter</b>: spread expiries so keys cached together don't all expire together.</li><li><b>Stale-while-revalidate</b>: serve the old value while one worker refreshes it in the background.</li><li><b>Early refresh</b>: refresh hot keys a little before they expire.</li></ul>"),
      dilemma("A product's price changes. How long can the cached price be wrong?", [
        { name: "Long TTL", pros: ["High hit ratio", "Database stays calm"], cons: ["Users see stale prices for minutes"] },
        { name: "Short TTL", pros: ["Fresh data"], cons: ["More misses and DB load", "More frequent stampede windows"] },
        { name: "Invalidate on write", pros: ["Fresh and still cached"], cons: ["Every write path must remember to delete the key", "Races between write and re-fill"] },
      ], "“There are only two hard things in computer science: cache invalidation and naming things.” Most systems combine invalidate-on-write with a safety TTL."),
    ),
    section("Where caches live",
      table(["Layer", "Example", "Caches"], [
        ["Browser", "Cache-Control, service worker", "Static files, API responses per user"],
        ["CDN edge", "Cloudflare, CloudFront, Fastly", "Static files and public pages near users"],
        ["Application", "Redis, Memcached", "Query results, sessions, computed views"],
        ["In-process", "an LRU map in memory", "Hot config, tiny lookups (no network hop at all)"],
        ["Database", "Buffer pool, query cache", "Recently read pages"],
      ]),
    ),
    section("In code",
      code({
        "Python (Redis, cache-aside)": `import json, random, redis
r = redis.Redis()

def get_product(pid: int) -> dict:
    key = f"product:{pid}"
    if (hit := r.get(key)) is not None:
        return json.loads(hit)
    product = db.fetch_product(pid)                      # the slow part
    ttl = int(300 * random.uniform(0.8, 1.2))            # jitter
    r.set(key, json.dumps(product), ex=ttl)
    return product

def update_price(pid: int, price: int):
    db.update_price(pid, price)
    r.delete(f"product:{pid}")                           # invalidate on write`,
        "Go (single-flight)": `import "golang.org/x/sync/singleflight"

var group singleflight.Group

func GetProduct(ctx context.Context, id string) (Product, error) {
	if p, ok := cache.Get(id); ok {
		return p, nil
	}
	// Concurrent callers with the same key share ONE database call.
	v, err, _ := group.Do(id, func() (any, error) {
		p, err := db.FetchProduct(ctx, id)
		if err == nil {
			cache.Set(id, p, 5*time.Minute)
		}
		return p, err
	})
	if err != nil {
		return Product{}, err
	}
	return v.(Product), nil
}`,
        "HTTP": `# Browser and CDN caching are just headers
Cache-Control: public, max-age=60, stale-while-revalidate=300
ETag: "v42"

# next request from the browser
If-None-Match: "v42"
# → 304 Not Modified (no body sent)`,
      }),
    ),
  );
  draw();
  lp.start();
}
