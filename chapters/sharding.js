import { h, loop } from "../lib/core.js";
import { segmented, stats, predict, code, dilemma, callout, section, prose, button, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// 600 keys, a handful of servers, three ways to decide which server owns a key.
// Changing the server list shows how many keys have to move.
const KEYS = 600;
const mix = (x) => { x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; return (x ^ (x >>> 16)) >>> 0; };
const fnv = (str) => { let x = 0x811c9dc5; for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; } return mix(x); };
const unit = (str) => fnv(str) / 4294967296;
const keyPos = Array.from({ length: KEYS }, (_, i) => unit(`user:${i}`));
const NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];

const SCHEMES = {
  mod: { label: "hash mod N", vnodes: 0 },
  ring: { label: "Ring, 1 point each", vnodes: 1 },
  vnodes: { label: "Ring, 64 points each", vnodes: 64 },
};

function owners(scheme, nodes) {
  if (scheme === "mod") return keyPos.map((p) => nodes[fnv(String(p)) % nodes.length]);
  const v = SCHEMES[scheme].vnodes;
  const pts = nodes.flatMap((n) => Array.from({ length: v }, (_, k) => [unit(`${n}#${k}`), n])).sort((a, b) => a[0] - b[0]);
  return keyPos.map((p) => { let lo = 0, hi = pts.length; while (lo < hi) { const m = (lo + hi) >> 1; pts[m][0] < p ? (lo = m + 1) : (hi = m); } return pts[lo % pts.length][1]; });
}
const points = (scheme, nodes) => (scheme === "mod" ? [] : nodes.flatMap((n) => Array.from({ length: SCHEMES[scheme].vnodes }, (_, k) => [unit(`${n}#${k}`), n])));

export default function (root, { id }) {
  let scheme = "mod", nodes = ["A", "B", "C", "D"], own = owners(scheme, nodes), moved = new Set(), flash = 0, lastMoved = null;
  const fc = flowCanvas({ width: 720, height: 300, label: "Keys on a hash ring coloured by the server that owns them" });
  const st = stats([{ label: "Servers" }, { label: "Keys moved by last change" }, { label: "Busiest server vs fair share" }, { label: "Ideal move" }]);
  const color = (n) => fc.colors[`c${(NAMES.indexOf(n) % 6) + 1}`] || fc.colors.ink;

  function change(next) {
    const before = own;
    nodes = next; own = owners(scheme, nodes);
    moved = new Set(); own.forEach((o, i) => o !== before[i] && moved.add(i));
    lastMoved = moved.size; flash = 1.6; refresh();
  }
  function setScheme(s) { scheme = s; own = owners(s, nodes); moved = new Set(); lastMoved = null; refresh(); }
  function refresh() {
    const load = nodes.map((n) => own.filter((o) => o === n).length), fair = KEYS / nodes.length;
    st.set(0, String(nodes.length));
    st.set(1, lastMoved == null ? "–" : `${lastMoved} (${Math.round((lastMoved / KEYS) * 100)}%)`, lastMoved == null ? "" : lastMoved / KEYS > 0.4 ? "bad" : "good");
    const r = Math.max(...load) / fair;
    st.set(2, `${r.toFixed(2)}×`, r > 1.6 ? "bad" : r > 1.25 ? "warn" : "good");
    st.set(3, `≈ ${Math.round(100 / nodes.length)}%`);
    draw();
  }

  function draw() {
    const c = fc.colors; fc.clear();
    const cx = 170, cy = 150, R = 118, ctx = fc.ctx;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.strokeStyle = c.line; ctx.lineWidth = 10; ctx.stroke();
    const at = (p, r) => [cx + Math.cos(p * 2 * Math.PI - Math.PI / 2) * r, cy + Math.sin(p * 2 * Math.PI - Math.PI / 2) * r];
    // ring arcs: who owns each stretch
    if (scheme !== "mod") {
      const pts = points(scheme, nodes).sort((a, b) => a[0] - b[0]);
      pts.forEach(([p, n], i) => {
        const prev = i ? pts[i - 1][0] : pts[pts.length - 1][0] - 1;
        ctx.beginPath(); ctx.arc(cx, cy, R, prev * 2 * Math.PI - Math.PI / 2, p * 2 * Math.PI - Math.PI / 2);
        ctx.strokeStyle = color(n); ctx.globalAlpha = 0.45; ctx.lineWidth = 10; ctx.stroke(); ctx.globalAlpha = 1;
      });
      if (SCHEMES[scheme].vnodes === 1) for (const [p, n] of pts) { const [x, y] = at(p, R); fc.dot(x, y, 9, color(n)); fc.text(n, x, y + 0.5, { align: "center", size: 10.5, color: "#fff" }); }
    }
    keyPos.forEach((p, i) => {
      const jitter = ((i * 7919) % 23) / 23;
      const [x, y] = at(p, R - 16 - jitter * 34);
      const m = moved.has(i) && flash > 0;
      if (m) fc.dot(x, y, 4.2, c.ink);
      fc.dot(x, y, m ? 2.8 : 2.2, color(own[i]));
    });
    fc.text(scheme === "mod" ? "server = hash(key) mod N" : "a key belongs to the next server point clockwise", cx, 290, { align: "center", size: 11, weight: 500, color: c["ink-3"] });
    // load bars
    const X = 360, load = nodes.map((n) => own.filter((o) => o === n).length), top = Math.max(KEYS / nodes.length * 2, ...load);
    fc.text("Keys per server", X, 22, { size: 12.5 });
    fc.text(`dashed line = fair share (${Math.round(KEYS / nodes.length)})`, X + 120, 22, { size: 10.5, weight: 500, color: c["ink-3"] });
    const rowH = Math.min(30, 240 / nodes.length);
    nodes.forEach((n, i) => {
      const y = 44 + i * rowH;
      fc.dot(X + 8, y + 7, 7, color(n)); fc.text(n, X + 8, y + 7.5, { align: "center", size: 10, color: "#fff" });
      fc.bar(X + 24, y + 2, 280, 10, load[i] / top, color(n));
      fc.text(String(load[i]), X + 312, y + 7, { size: 11, mono: true, weight: 500, color: c["ink-2"] });
    });
    const fx = X + 24 + 280 * (KEYS / nodes.length / top);
    fc.line(fx, 38, fx, 44 + nodes.length * rowH, { color: c["ink-3"], dash: [4, 4], lw: 1 });
  }

  const lp = loop((dt) => { if (flash > 0) { flash -= dt; draw(); } }, fc.el);
  const add = () => nodes.length < NAMES.length && change([...nodes, NAMES.find((n) => !nodes.includes(n))]);
  const remove = () => nodes.length > 2 && change(nodes.filter((n) => n !== nodes[1]));

  root.append(
    section(null, prose(`<p>One database server holds maybe a few terabytes and serves maybe 50,000 queries a second. Past that you split the data across machines: <b>sharding</b>. Every request then needs one cheap answer: <i>which server holds this key?</i> The obvious answer, <code>hash(key) mod N</code>, works perfectly until N changes. Below, ${KEYS} user IDs are spread over the servers; each dot is a key, coloured by its owner.</p>`)),
    section("Add a server, count what moves",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Placement", options: Object.entries(SCHEMES).map(([value, s]) => ({ value, label: s.label })), value: scheme, onChange: setScheme }),
          button("Add a server", add, "primary"),
          button("Remove a server", remove),
          button("Reset", () => { nodes = ["A", "B", "C", "D"]; own = owners(scheme, nodes); moved = new Set(); lastMoved = null; refresh(); }),
        ),
        h("div.stage-body", st.el, fc.el),
      ),
      callout("tip", "Things to try", "<p>With “hash mod N”, add a fifth server and watch the outlined dots: about 80% of keys change owner, so 80% of your cache misses at once or 80% of your data copies across the network. Switch to the ring and add again: only the keys in the new server's arc move. Then compare “1 point each” with “64 points each” in the bar chart.</p>"),
      predict({
        chapter: id,
        question: "You grow from 4 to 5 servers with hash mod N. Roughly what share of keys has to move?",
        options: ["20%", "50%", "80%", "100%"],
        answer: 2,
        explain: "<p>A key stays put only if <code>h mod 4 == h mod 5</code>, which holds for 4 out of every 20 hash values: 20%. So 80% move. A consistent-hash ring moves only the keys the new server takes over: about 1/5 = 20%, the minimum possible.</p>",
      }),
    ),
    section("Why virtual nodes",
      prose(`<p>With one point per server, arcs on the ring have random lengths, and one server can easily own twice its fair share. Giving each server many points (<b>virtual nodes</b>) averages the arcs out: with 64 points the busiest server is usually within about 20% of fair (the leftover wobble here is mostly just having only 600 keys). Virtual nodes also let a bigger machine take more points, and when a server dies its keys scatter across all survivors instead of landing on one neighbour.</p>`),
      table(["Scheme", "Lookup", "Keys moved when N changes", "Balance", "Used by"], [
        ["hash mod N", "O(1)", "≈ (N−1)/N, nearly all", "Excellent", "Fixed-size caches, partitioned Kafka topics"],
        ["Consistent hashing", "O(log points)", "≈ 1/N, the minimum", "Poor without virtual nodes", "Dynamo, Cassandra, memcached clients"],
        ["Rendezvous (HRW)", "O(N)", "≈ 1/N", "Good", "Some CDNs and load balancers"],
        ["Jump hash", "O(log N)", "≈ 1/N, but only add/remove at the end", "Perfect", "Google storage systems"],
        ["Range sharding", "Lookup table", "Split one range", "Needs rebalancing", "Spanner, CockroachDB, HBase, MongoDB"],
      ]),
    ),
    section("Choosing a shard key",
      prose(`<p>Hashing spreads keys evenly, but only the keys you have. If one key is very hot (a celebrity's profile, a single giant tenant), its server is hot no matter how you hash. And if a query needs data from many keys, it now needs many servers.</p>`),
      dilemma("A chat app: shard messages by user_id or by conversation_id?", [
        { name: "By user_id", pros: ["“My inbox” is one shard"], cons: ["A message in a 500-person group is written to 500 shards", "Reading a conversation touches every member's shard"] },
        { name: "By conversation_id", pros: ["A conversation is one shard: one write, one read"], cons: ["“All my conversations” is a scatter-gather", "One huge group becomes a hot shard"] },
      ], "Most chat systems shard messages by conversation and keep a small per-user index (conversation list, unread counts) sharded by user. Pick the key that keeps your hottest query on one shard."),
      callout("warn", "Cross-shard work is the real cost", "<p>Joins, unique constraints and transactions that span shards stop being free: you either avoid them in the data model, accept a slower two-phase commit, or move to a database that does it for you (Spanner, CockroachDB, Vitess with care).</p>"),
    ),
    section("In code",
      code({
        "Python (ring with virtual nodes)": `import bisect, hashlib

def h(s: str) -> int:
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")

class Ring:
    def __init__(self, nodes, vnodes=64):
        self.vnodes, self.points = vnodes, []          # sorted [(hash, node)]
        for n in nodes: self.add(n)

    def add(self, node):
        for i in range(self.vnodes):
            bisect.insort(self.points, (h(f"{node}#{i}"), node))

    def remove(self, node):
        self.points = [p for p in self.points if p[1] != node]

    def owner(self, key: str) -> str:
        i = bisect.bisect(self.points, (h(key), ""))
        return self.points[i % len(self.points)][1]    # next point clockwise

ring = Ring(["db-a", "db-b", "db-c"])
ring.owner("user:42")   # -> 'db-b'`,
        "Rendezvous hashing": `def owner(key: str, nodes: list[str]) -> str:
    # every node gets a score for this key; the highest wins.
    # Removing a node only moves the keys it was winning.
    return max(nodes, key=lambda n: h(f"{n}:{key}"))`,
        "Jump hash": `def jump(key: int, buckets: int) -> int:
    # Lamping & Veach (2014): no memory, perfectly balanced, ~1/N moves on growth
    b, j = -1, 0
    while j < buckets:
        b = j
        key = (key * 2862933555777941757 + 1) & 0xFFFFFFFFFFFFFFFF
        j = int((b + 1) * (1 << 31) / ((key >> 33) + 1))
    return b`,
      }),
    ),
  );
  refresh();
  lp.start();
}
