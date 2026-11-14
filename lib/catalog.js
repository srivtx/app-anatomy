// The curriculum. Each level climbs from "one request" to "every kind of app".
// live: true means the chapter module exists in /chapters/<id>.js

export const LEVELS = [
  {
    id: "foundations",
    name: "Foundations",
    tagline: "What actually happens between a tap and a pixel",
    chapters: [
      { id: "request-journey", title: "What happens when you press Enter", blurb: "DNS, TCP, TLS, HTTP, server and database, timed on a waterfall you can tune.", live: true },
      { id: "rendering", title: "Where the HTML gets made", blurb: "Client rendering, server rendering, static and streaming, raced side by side.", live: true },
      { id: "apis", title: "Talking to a server", blurb: "REST, GraphQL, gRPC, WebSockets and SSE fetching the same screen.", live: true },
    ],
  },
  {
    id: "normal-app",
    name: "A normal app",
    tagline: "The layers inside every CRUD product",
    chapters: [
      { id: "crud-layers", title: "Anatomy of a CRUD app", blurb: "Click a button and trace it through controller, service, repository and SQL. Then meet N+1.", live: true },
      { id: "indexes", title: "Why some queries are instant", blurb: "Scan 100,000 rows or walk a B-tree three levels deep.", live: true },
      { id: "auth", title: "Who are you?", blurb: "Sessions versus JWTs, step by step, and the logout problem.", live: true },
    ],
  },
  {
    id: "scale",
    name: "System design",
    tagline: "What changes when a million people show up",
    chapters: [
      { id: "caching", title: "Caching and the stampede", blurb: "Hit ratios, TTLs, hot keys and the moment a popular key expires.", live: true },
      { id: "load-balancing", title: "Load balancers", blurb: "Round robin, least connections and power of two choices, with one slow server.", live: true },
      { id: "queues", title: "Queues and workers", blurb: "Absorb a burst, retry failures, and stop retries from sinking you.", live: true },
      { id: "rate-limiting", title: "Rate limiting", blurb: "Fixed windows, sliding windows and token buckets, and the boundary burst.", live: true },
    ],
  },
  {
    id: "lld",
    name: "Low-level design",
    tagline: "Shaping the code inside one service",
    chapters: [
      { id: "state-machines", title: "Model it as a state machine", blurb: "An order lifecycle where illegal moves are impossible, then the code.", live: false },
      { id: "patterns", title: "Patterns that earn their keep", blurb: "Strategy, observer and adapter on a real payment flow.", live: false },
    ],
  },
  {
    id: "realtime",
    name: "Real-time and offline",
    tagline: "Apps that update themselves",
    chapters: [
      { id: "realtime", title: "Polling, SSE or WebSockets?", blurb: "Count requests and latency for each way of hearing about new messages.", live: false },
      { id: "sync", title: "Offline edits that merge", blurb: "Two devices edit offline. Last-write-wins loses data; a CRDT doesn't.", live: false },
    ],
  },
  {
    id: "ai",
    name: "AI apps",
    tagline: "LLMs, retrieval, tools, agents and MCP",
    chapters: [
      { id: "llm-basics", title: "How an LLM writes", blurb: "Tokens, sampling, temperature and the context window budget.", live: false },
      { id: "rag", title: "Retrieval-augmented generation", blurb: "Chunk, embed, search and assemble a prompt, all in your browser.", live: false },
      { id: "agents", title: "The agent loop", blurb: "Model, tool call, tool result, repeat. Step through real message JSON.", live: false },
      { id: "mcp", title: "MCP: plugging tools into any model", blurb: "Host, client and server speaking JSON-RPC, from handshake to tool call.", live: false },
      { id: "genui", title: "Streaming generative UI", blurb: "Charts that render while the model is still writing them.", live: false },
    ],
  },
  {
    id: "app-types",
    name: "Every kind of app",
    tagline: "Same building blocks, different shapes",
    chapters: [
      { id: "app-types", title: "The app atlas", blurb: "Twelve app types, from a static blog to ride-hailing, payments and multiplayer games.", live: false },
    ],
  },
];

export const ALL = LEVELS.flatMap((lv, li) => lv.chapters.map((c, ci) => ({ ...c, level: lv, levelIndex: li, n: `${li}.${ci + 1}` })));
export const find = (id) => ALL.find((c) => c.id === id);
export function neighbours(id) {
  const live = ALL.filter((c) => c.live);
  const i = live.findIndex((c) => c.id === id);
  return { prev: live[i - 1], next: live[i + 1] };
}
