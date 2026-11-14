import { h, s } from "../lib/core.js";
import { predict, dilemma, callout, section, prose, button, table } from "../lib/widgets.js";

// Each app: nodes on a 5×3 grid (col, row), edges, the hot request path, and what makes it hard.
const KIND = { client: "var(--c1)", edge: "var(--c4)", service: "var(--accent)", data: "var(--c3)", queue: "var(--c2)", external: "var(--c5)", ai: "var(--c6)" };
const APPS = [
  { id: "static", name: "Static site / blog", hard: "Deploys must invalidate cached files everywhere at once.",
    nodes: [["browser", "Browser", 0, 1, "client"], ["cdn", "CDN edge", 1, 1, "edge"], ["store", "Object storage", 2, 1, "data"], ["ci", "CI build", 2, 0, "service"], ["git", "Git repo", 3, 0, "external"]],
    edges: [["browser", "cdn"], ["cdn", "store"], ["git", "ci"], ["ci", "store"]], path: ["browser", "cdn", "store"],
    techniques: ["Static generation", "CDN caching with hashed file names", "Atomic deploys"], blocks: ["CDN"], chapters: ["request-journey", "rendering"],
    dilemma: "Rebuild every page on each change, or render some pages on demand?" },
  { id: "saas", name: "CRUD SaaS", hard: "Every query must be scoped to the right tenant, and schema migrations can't take the app down.",
    nodes: [["browser", "Browser", 0, 1, "client"], ["lb", "Load balancer", 1, 1, "edge"], ["app", "App servers", 2, 1, "service"], ["db", "Postgres", 3, 1, "data"], ["cache", "Redis", 3, 0, "data"], ["queue", "Job queue", 3, 2, "queue"], ["worker", "Workers", 4, 2, "service"], ["email", "Email API", 4, 1, "external"]],
    edges: [["browser", "lb"], ["lb", "app"], ["app", "db"], ["app", "cache"], ["app", "queue"], ["queue", "worker"], ["worker", "email"]], path: ["browser", "lb", "app", "cache", "app", "db"],
    techniques: ["Layered backend", "Indexes", "Cache-aside", "Background jobs", "Sessions"], blocks: ["Load balancer", "SQL database", "Cache", "Queue"], chapters: ["crud-layers", "indexes", "auth", "caching", "queues"],
    dilemma: "One database with a tenant_id column, or a database per customer?" },
  { id: "social", name: "Social feed", hard: "A celebrity with 50M followers turns one post into 50M feed writes.",
    nodes: [["app", "Mobile app", 0, 1, "client"], ["api", "API", 1, 1, "service"], ["post", "Post service", 2, 0, "service"], ["fan", "Fan-out workers", 3, 0, "queue"], ["feed", "Feed cache", 3, 1, "data"], ["graph", "Follower graph", 4, 0, "data"], ["media", "Media CDN", 1, 2, "edge"], ["posts", "Posts DB", 2, 2, "data"]],
    edges: [["app", "api"], ["api", "post"], ["post", "posts"], ["post", "fan"], ["fan", "graph"], ["fan", "feed"], ["api", "feed"], ["app", "media"]], path: ["app", "api", "post", "fan", "feed"],
    techniques: ["Fan-out on write", "Fan-out on read for celebrities", "Feed caches per user", "CDN for media"], blocks: ["Cache", "Queue", "CDN", "Sharded storage"], chapters: ["queues", "caching"],
    dilemma: "Push posts into every follower's feed when written, or assemble feeds when read? (Most do both.)" },
  { id: "chat", name: "Chat / messaging", hard: "Ordering, delivery receipts and presence across millions of open connections.",
    nodes: [["a", "Ada's phone", 0, 0, "client"], ["b", "Grace's phone", 0, 2, "client"], ["gw1", "WS gateway 1", 1, 0, "edge"], ["gw2", "WS gateway 2", 1, 2, "edge"], ["bus", "Pub/sub", 2, 1, "queue"], ["msg", "Message store", 3, 1, "data"], ["push", "Push (APNs/FCM)", 3, 2, "external"]],
    edges: [["a", "gw1"], ["b", "gw2"], ["gw1", "bus"], ["gw2", "bus"], ["bus", "msg"], ["bus", "push"]], path: ["a", "gw1", "bus", "gw2", "b"],
    techniques: ["WebSockets", "Pub/sub fan-out between gateways", "Per-conversation ordering", "Push notifications when offline"], blocks: ["WebSockets", "Queue", "Sharded storage"], chapters: ["realtime", "sync"],
    dilemma: "Store messages forever on the server, or end-to-end encrypt and keep them only on devices?" },
  { id: "video", name: "Video streaming", hard: "Transcoding is expensive and CDN bandwidth is most of the bill.",
    nodes: [["creator", "Creator upload", 0, 0, "client"], ["raw", "Raw storage", 1, 0, "data"], ["q", "Transcode queue", 2, 0, "queue"], ["tx", "Transcoders", 3, 0, "service"], ["hls", "HLS renditions", 3, 1, "data"], ["cdn", "CDN", 2, 2, "edge"], ["player", "Player (ABR)", 0, 2, "client"]],
    edges: [["creator", "raw"], ["raw", "q"], ["q", "tx"], ["tx", "hls"], ["hls", "cdn"], ["cdn", "player"]], path: ["player", "cdn", "hls"],
    techniques: ["Transcode to many bitrates", "HLS/DASH segments", "Adaptive bitrate in the player", "Multi-CDN"], blocks: ["Queue", "CDN", "Object storage"], chapters: ["queues", "request-journey"],
    dilemma: "Transcode every upload into every quality up front, or only popular videos?" },
  { id: "rides", name: "Ride-hailing", hard: "Millions of drivers send their location every few seconds, and matching must use the freshest positions.",
    nodes: [["driver", "Driver app", 0, 0, "client"], ["rider", "Rider app", 0, 2, "client"], ["loc", "Location service", 1, 0, "service"], ["geo", "Geo index (H3)", 2, 1, "data"], ["match", "Matching", 1, 2, "service"], ["trip", "Trips DB", 3, 2, "data"], ["pay", "Payments", 4, 2, "external"], ["ws", "Push to driver", 0, 1, "edge"]],
    edges: [["driver", "loc"], ["loc", "geo"], ["rider", "match"], ["match", "geo"], ["match", "trip"], ["trip", "pay"], ["match", "ws"], ["ws", "driver"]], path: ["rider", "match", "geo", "match", "ws", "driver"],
    techniques: ["Geospatial indexing (geohash, H3)", "In-memory location store", "State machine for trips", "Surge pricing"], blocks: ["WebSockets", "In-memory store", "SQL database"], chapters: ["state-machines", "realtime"],
    dilemma: "Match each request to the nearest driver instantly, or batch requests for a second to match better overall?" },
  { id: "payments", name: "Payments", hard: "Money must move exactly once, even when networks fail halfway.",
    nodes: [["client", "Merchant", 0, 1, "client"], ["api", "Payments API", 1, 1, "service"], ["idem", "Idempotency keys", 1, 0, "data"], ["ledger", "Double-entry ledger", 2, 1, "data"], ["psp", "Card networks", 3, 0, "external"], ["hooks", "Webhook queue", 2, 2, "queue"], ["recon", "Reconciliation", 3, 2, "service"]],
    edges: [["client", "api"], ["api", "idem"], ["api", "ledger"], ["api", "psp"], ["psp", "hooks"], ["hooks", "client"], ["recon", "ledger"], ["recon", "psp"]], path: ["client", "api", "idem", "api", "psp", "api", "ledger"],
    techniques: ["Idempotency keys", "Append-only double-entry ledger", "State machines", "Retries with backoff", "Daily reconciliation"], blocks: ["SQL database", "Queue"], chapters: ["state-machines", "queues"],
    dilemma: "Authorise and capture in one step, or hold the funds and capture on shipping?" },
  { id: "shop", name: "E-commerce", hard: "Flash sales: 100,000 people trying to buy 500 items in the same second.",
    nodes: [["web", "Storefront", 0, 1, "client"], ["search", "Search index", 1, 0, "data"], ["cart", "Cart", 1, 2, "service"], ["order", "Orders (state machine)", 2, 1, "service"], ["inv", "Inventory", 3, 0, "data"], ["pay", "Payments", 3, 2, "external"], ["outbox", "Outbox → queue", 4, 1, "queue"]],
    edges: [["web", "search"], ["web", "cart"], ["cart", "order"], ["order", "inv"], ["order", "pay"], ["order", "outbox"]], path: ["web", "cart", "order", "inv", "order", "pay"],
    techniques: ["Inventory reservations with TTL", "Order state machine", "Transactional outbox", "Search index", "Rate limiting and queues for sales"], blocks: ["Search", "SQL database", "Queue", "Cache"], chapters: ["state-machines", "patterns", "rate-limiting"],
    dilemma: "Reserve stock when it goes into the cart, or only at payment?" },
  { id: "game", name: "Multiplayer game", hard: "Hiding 80 ms of latency so the game feels instant, without trusting clients.",
    nodes: [["p1", "Player 1", 0, 0, "client"], ["p2", "Player 2", 0, 2, "client"], ["mm", "Matchmaker", 1, 1, "service"], ["gs", "Game server (60 Hz)", 2, 1, "service"], ["stats", "Profiles & stats", 3, 1, "data"]],
    edges: [["p1", "mm"], ["p2", "mm"], ["mm", "gs"], ["p1", "gs"], ["p2", "gs"], ["gs", "stats"]], path: ["p1", "gs", "p2"],
    techniques: ["Authoritative server", "Client-side prediction", "Lag compensation", "UDP with delta snapshots", "Regional servers"], blocks: ["Realtime UDP", "In-memory store"], chapters: ["realtime"],
    dilemma: "Authoritative server (fair, costs money) or peer-to-peer (cheap, easy to cheat)?" },
  { id: "docs", name: "Collaborative editor", hard: "Two people edit the same sentence offline; both edits must survive.",
    nodes: [["u1", "Editor A", 0, 0, "client"], ["u2", "Editor B", 0, 2, "client"], ["sync", "Sync server", 1, 1, "edge"], ["crdt", "CRDT doc store", 2, 1, "data"], ["snap", "Snapshots", 3, 1, "data"], ["presence", "Presence", 2, 0, "data"]],
    edges: [["u1", "sync"], ["u2", "sync"], ["sync", "crdt"], ["crdt", "snap"], ["sync", "presence"]], path: ["u1", "sync", "u2"],
    techniques: ["CRDTs or operational transforms", "Local-first storage", "WebSockets", "Periodic snapshots"], blocks: ["WebSockets", "Object storage"], chapters: ["sync", "realtime"],
    dilemma: "CRDTs everywhere, or a central server that orders every operation (OT)?" },
  { id: "search", name: "Search engine", hard: "Answering from billions of documents in under 200 ms while the index keeps changing.",
    nodes: [["crawl", "Crawlers", 0, 0, "service"], ["front", "URL frontier", 1, 0, "queue"], ["idx", "Indexers", 2, 0, "service"], ["shards", "Index shards", 3, 1, "data"], ["user", "User", 0, 2, "client"], ["q", "Query service", 1, 2, "service"], ["rank", "Ranker", 2, 2, "ai"], ["cache", "Results cache", 0, 1, "data"]],
    edges: [["crawl", "front"], ["front", "crawl"], ["crawl", "idx"], ["idx", "shards"], ["user", "q"], ["q", "cache"], ["q", "shards"], ["shards", "rank"], ["rank", "q"]], path: ["user", "q", "shards", "rank", "q", "user"],
    techniques: ["Inverted index", "Sharding with scatter-gather", "Learning-to-rank", "Result caching"], blocks: ["Search", "Queue", "Cache", "Sharded storage"], chapters: ["indexes", "caching", "rag"],
    dilemma: "Rebuild the index in big batches, or update it continuously?" },
  { id: "ai", name: "AI assistant / agent", hard: "Answers are non-deterministic, slow and billed per token; quality must be measured, not assumed.",
    nodes: [["user", "Chat UI", 0, 1, "client"], ["api", "API (SSE stream)", 1, 1, "service"], ["loop", "Agent loop", 2, 1, "service"], ["llm", "LLM API", 3, 0, "ai"], ["vec", "Vector DB", 3, 1, "data"], ["mcp", "Tools / MCP servers", 3, 2, "external"], ["store", "Conversations", 2, 2, "data"], ["evals", "Evals & traces", 4, 0, "service"]],
    edges: [["user", "api"], ["api", "loop"], ["loop", "llm"], ["loop", "vec"], ["loop", "mcp"], ["loop", "store"], ["loop", "evals"]], path: ["user", "api", "loop", "vec", "loop", "llm", "loop", "mcp", "loop", "llm", "loop", "api", "user"],
    techniques: ["Streaming over SSE", "RAG", "Tool calling and MCP", "Prompt caching", "Evals and tracing", "Generative UI"], blocks: ["Vector DB", "SSE", "Queue"], chapters: ["llm-basics", "rag", "agents", "mcp", "genui"],
    dilemma: "One capable model for everything, or a cheap model for easy requests and a strong one for hard ones?" },
  { id: "short", name: "URL shortener", hard: "100 reads for every write, and IDs must never collide.",
    nodes: [["user", "Browser", 0, 1, "client"], ["edge", "Edge cache", 1, 1, "edge"], ["api", "Redirect service", 2, 1, "service"], ["kv", "Key-value store", 3, 1, "data"], ["ids", "ID generator", 2, 0, "service"], ["clicks", "Click analytics", 3, 2, "queue"]],
    edges: [["user", "edge"], ["edge", "api"], ["api", "kv"], ["api", "ids"], ["api", "clicks"]], path: ["user", "edge", "api", "kv", "api", "user"],
    techniques: ["Base62 IDs from a counter or hash", "Read-through cache at the edge", "301 vs 302 redirects", "Async click counting"], blocks: ["Cache", "Key-value store", "Queue"], chapters: ["caching", "rate-limiting"],
    dilemma: "Permanent 301 redirects (browsers cache them, fewer hits) or 302 (you see every click)?" },
];

const X = (c) => 70 + c * 145, Y = (r) => 40 + r * 82;

function diagram(app, active, dot) {
  const svg = s("svg", { viewBox: "0 0 720 250", role: "img", "aria-label": `Architecture of a ${app.name}` });
  const pos = Object.fromEntries(app.nodes.map(([id, , c, r]) => [id, [X(c), Y(r)]]));
  for (const [a, b] of app.edges) svg.append(s("line", { x1: pos[a][0], y1: pos[a][1], x2: pos[b][0], y2: pos[b][1], class: "wire" }));
  for (const [id, label, c, r, kind] of app.nodes) {
    const on = active.has(id);
    svg.append(s("rect", { x: X(c) - 60, y: Y(r) - 19, width: 120, height: 38, rx: 9, class: "node-box", style: `stroke:${KIND[kind]};stroke-width:${on ? 3 : 1.5};${on ? `fill:color-mix(in srgb, ${KIND[kind]} 16%, var(--surface))` : ""}` }));
    svg.append(s("text", { x: X(c), y: Y(r) + 4, "text-anchor": "middle", class: "node-label", style: "font-size:11.5px", text: label }));
  }
  if (dot) svg.append(s("circle", { cx: dot[0], cy: dot[1], r: 7, style: "fill:var(--warm);stroke:var(--surface);stroke-width:2" }));
  return svg;
}

export default function (root, { id }) {
  let app = APPS[0], raf = 0;
  const dia = h("div"), info = h("div");
  const picker = h("div.row", APPS.map((a) => h("button.btn.small", { type: "button", "aria-pressed": "false", onclick: () => choose(a) }, a.name)));

  function choose(a) {
    cancelAnimationFrame(raf);
    app = a;
    picker.querySelectorAll("button").forEach((b, i) => { b.classList.toggle("primary", APPS[i] === a); b.setAttribute("aria-pressed", String(APPS[i] === a)); });
    dia.replaceChildren(diagram(a, new Set()));
    info.replaceChildren(
      h("div.split",
        h("div", h("div.eyebrow", "What makes it hard"), h("p", { style: { margin: 0, fontSize: "17px" } }, a.hard)),
        h("div", h("div.eyebrow", "Key techniques"), h("div.row", a.techniques.map((t) => h("span.pill.acc", t))))),
      h("div", { style: { marginTop: "12px" } }, h("div.eyebrow", "The dilemma"), h("p", { style: { margin: 0 } }, a.dilemma)),
      h("div", { style: { marginTop: "12px" } }, h("div.eyebrow", "Learn the pieces"), h("div.row", a.chapters.map((c) => h("a.pill", { href: `/learn?c=${c}` }, c.replace(/-/g, " "))))),
    );
  }
  function trace() {
    cancelAnimationFrame(raf);
    const pos = Object.fromEntries(app.nodes.map(([nid, , c, r]) => [nid, [X(c), Y(r)]]));
    const path = app.path, legMs = 550, t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) / legMs, leg = Math.min(path.length - 2, Math.floor(t)), f = Math.min(1, t - leg);
      const [ax, ay] = pos[path[leg]], [bx, by] = pos[path[leg + 1]];
      const active = new Set(path.slice(0, leg + (f >= 1 ? 2 : 1)));
      dia.replaceChildren(diagram(app, active, [ax + (bx - ax) * f, ay + (by - ay) * f]));
      if (t < path.length - 1) raf = requestAnimationFrame(tick);
      else dia.replaceChildren(diagram(app, new Set(path)));
    };
    raf = requestAnimationFrame(tick);
  }

  const BLOCKS = [...new Set(APPS.flatMap((a) => a.blocks))];
  root.append(
    section(null, prose(`<p>Every chapter so far was a building block. Real apps are those blocks in different arrangements, chosen by what each product finds hard. Pick an app, trace its busiest request, and notice how the same handful of pieces (load balancers, caches, queues, databases, realtime connections, LLMs) keep reappearing in different proportions.</p>`)),
    section("The atlas",
      h("div.stage",
        h("div.stage-controls", picker),
        h("div.stage-body", h("div.row", button("Trace the hot path", trace, "primary"), h("div.legend", Object.entries(KIND).map(([k, c]) => h("span", h("i", { style: { background: c } }), k)))), dia, info),
      ),
      predict({
        chapter: id,
        question: "Which building block shows up in the most app types in this atlas?",
        options: ["WebSockets", "A queue for background work", "A vector database", "A CDN"],
        answer: 1,
        explain: "<p>Almost every app has work that shouldn't happen while a user waits: sending, transcoding, fanning out, indexing, reconciling. Queues (chapter 2.3) are the quiet workhorse of system design. Check the matrix below.</p>",
      }),
    ),
    section("Building blocks by app",
      table(["App", ...BLOCKS], APPS.map((a) => [a.name, ...BLOCKS.map((b) => (a.blocks.includes(b) ? "●" : ""))])),
    ),
    section("How to design any app",
      prose(`<ol>
<li><b>Requirements first.</b> What must it do, for how many users, how fast, and what must never happen (lose a message, charge twice)?</li>
<li><b>Estimate.</b> Requests per second, read/write ratio, data size per year. A 100:1 read-heavy app wants caches; a write-heavy one wants queues and partitioning.</li>
<li><b>Draw the simplest thing that works:</b> client → app → database. Then add a block only to solve a specific problem you can name.</li>
<li><b>Find the hard part</b> (the line under each app above) and spend your design time there.</li>
<li><b>Plan for failure:</b> what happens when each box is slow or down? Timeouts, retries with backoff, idempotency, health checks.</li>
</ol>`),
      dilemma("Microservices or a monolith for a new product?", [
        { name: "Monolith", pros: ["One deploy, one database, easy refactors", "Fast for small teams"], cons: ["Scaling is all-or-nothing", "Teams step on each other as it grows"] },
        { name: "Microservices", pros: ["Teams deploy independently", "Scale hot parts separately"], cons: ["Network calls, distributed failures and data consistency everywhere", "Much more infrastructure"] },
      ], "Start with a well-structured monolith (clear modules, like the layers in chapter 1.1) and split out a service when a team or a scaling problem demands it."),
      callout("tip", "Where to go next", "<p>Pick an app you use every day and sketch its atlas entry: nodes, the hot path, the hard part, the dilemma. Then try the Wind Tunnel experiments on Tulip Labs for deeper simulations of replicas, sharding and hot keys.</p>"),
    ),
  );
  choose(APPS[0]);
}
