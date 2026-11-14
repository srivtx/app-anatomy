import { h, s, fmtMs, esc } from "../lib/core.js";
import { slider, segmented, stats, predict, code, dilemma, section, prose } from "../lib/widgets.js";

// One screen: a profile with the 3 latest posts and a comment count for each.
const USER = { id: 1, name: "Ada Lovelace", handle: "ada", avatar_url: "https://cdn.example.com/a/1.png", bio: "Writing the first programs, one note at a time.", email: "ada@example.com", created_at: "2024-02-11T09:12:00Z", followers: 1820, following: 91, location: "London", website: "https://ada.example.com", verified: true, settings: { theme: "dark", lang: "en", notifications: true } };
const BODY = "Notes on the analytical engine: it weaves algebraic patterns just as the Jacquard loom weaves flowers and leaves. ".repeat(3);
const POSTS = [
  { id: 41, title: "Note G", body: BODY, created_at: "2026-10-02T10:00:00Z", likes: 312, tags: ["engines", "math"], author_id: 1 },
  { id: 40, title: "On Bernoulli numbers", body: BODY, created_at: "2026-09-21T08:30:00Z", likes: 190, tags: ["math"], author_id: 1 },
  { id: 39, title: "Poetical science", body: BODY, created_at: "2026-09-02T17:45:00Z", likes: 88, tags: ["essays"], author_id: 1 },
];
const comment = (i, post) => ({ id: post * 100 + i, post_id: post, author: { id: 7 + i, name: `Reader ${i + 1}`, avatar_url: `https://cdn.example.com/a/${7 + i}.png` }, body: "Fascinating. Could the engine compose music too?", created_at: "2026-10-03T12:00:00Z", likes: i * 3 });
const COMMENTS = { 41: Array.from({ length: 4 }, (_, i) => comment(i, 41)), 40: Array.from({ length: 2 }, (_, i) => comment(i, 40)), 39: Array.from({ length: 7 }, (_, i) => comment(i, 39)) };
const NEEDED = { user: ["name", "handle", "avatar_url"], post: ["title", "likes"] };

const exact = { name: USER.name, handle: USER.handle, avatar_url: USER.avatar_url, posts: POSTS.map((p) => ({ title: p.title, likes: p.likes, comment_count: COMMENTS[p.id].length })) };

const STYLES = {
  rest: {
    label: "REST (resource per URL)",
    rounds: [
      [{ m: "GET", path: "/users/1", body: USER }, { m: "GET", path: "/users/1/posts?limit=3", body: POSTS }],
      POSTS.map((p) => ({ m: "GET", path: `/posts/${p.id}/comments`, body: COMMENTS[p.id] })),
    ],
    note: "Comments can't be requested until the posts arrive, because you need their ids. That dependency costs a second round trip, and every response carries fields the screen never shows.",
  },
  bff: {
    label: "REST, screen endpoint (BFF)",
    rounds: [[{ m: "GET", path: "/screens/profile/1", body: exact }]],
    note: "A backend-for-frontend endpoint returns exactly what one screen needs. One round trip, no waste, but every new screen needs a new endpoint on the server.",
  },
  graphql: {
    label: "GraphQL",
    rounds: [[{ m: "POST", path: "/graphql", req: `query Profile {
  user(id: 1) {
    name handle avatar_url
    posts(last: 3) { title likes commentCount }
  }
}`, body: { data: { user: { ...exact, posts: exact.posts.map((p) => ({ title: p.title, likes: p.likes, commentCount: p.comment_count })) } } } }]],
    note: "The client describes the shape it wants and gets exactly that in one round trip. The cost moves to the server: resolvers can fan out into N+1 database queries unless you batch them (DataLoader).",
  },
  grpc: {
    label: "gRPC (binary over HTTP/2)",
    rounds: [[{ m: "RPC", path: "ProfileService/GetProfile", req: "GetProfileRequest { user_id: 1 }", body: exact, binary: true }]],
    note: "A typed contract (.proto) generates client and server code. Messages are compact protobuf, not JSON. Ideal between your own services; browsers need a proxy (gRPC-Web or Connect).",
  },
};

const size = (x) => new TextEncoder().encode(typeof x === "string" ? x : JSON.stringify(x)).length;
const usedBytes = () => size(exact);

function seqDiagram(rounds, rtt) {
  const n = rounds.flat().length;
  const W = 380, H = 34 + rounds.length * 24 + n * 32;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${n} requests in ${rounds.length} round trips` });
  svg.append(s("text", { x: 24, y: 16, "text-anchor": "middle", class: "node-label", text: "App" }), s("text", { x: W - 30, y: 16, "text-anchor": "middle", class: "node-label", text: "Server" }));
  svg.append(s("line", { x1: 24, x2: 24, y1: 24, y2: H, class: "wire" }), s("line", { x1: W - 30, x2: W - 30, y1: 24, y2: H, class: "wire" }));
  let y = 30;
  rounds.forEach((round, ri) => {
    svg.append(s("text", { x: W / 2, y: y + 12, "text-anchor": "middle", style: "fill:var(--warm);font:600 11px var(--mono)", text: `round trip ${ri + 1} · ${fmtMs(rtt)}${round.length > 1 ? ` · ${round.length} parallel` : ""}` }));
    y += 24;
    round.forEach((r) => {
      svg.append(s("text", { x: 32, y: y + 10, class: "node-sub", text: `${r.m} ${r.path}` }));
      svg.append(s("line", { x1: 28, x2: W - 34, y1: y + 16, y2: y + 24, style: "stroke:var(--accent);stroke-width:1.5" }));
      y += 32;
    });
  });
  return svg;
}

export default function (root, { id }) {
  let style = "rest", rtt = 150;
  const st = stats([{ label: "Requests" }, { label: "Round trips" }, { label: "Bytes received" }, { label: "Bytes actually used" }, { label: "Network wait" }]);
  const diagram = h("div"), payloads = h("div"), note = h("p.muted", { style: { margin: 0 } });

  function render() {
    const S = STYLES[style];
    const all = S.rounds.flat();
    const bytes = all.reduce((a, r) => a + (r.binary ? Math.round(size(r.body) * 0.45) : size(r.body)), 0);
    st.set(0, String(all.length));
    st.set(1, String(S.rounds.length), S.rounds.length > 1 ? "bad" : "good");
    st.set(2, `${bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`}${S.rounds[0][0].binary ? " (est.)" : ""}`);
    st.set(3, `${Math.round((Math.min(usedBytes(), bytes) / bytes) * 100)}%`, bytes > usedBytes() * 2 ? "bad" : "good");
    st.set(4, fmtMs(S.rounds.length * rtt));
    diagram.replaceChildren(seqDiagram(S.rounds, rtt));
    note.textContent = S.note;
    payloads.replaceChildren(...all.map((r) => {
      const body = JSON.stringify(r.body, null, 1);
      const lines = body.split("\n").slice(0, 40);
      const used = (line) => [...NEEDED.user, ...NEEDED.post, "comment_count", "commentCount", "posts", "data", "user"].some((k) => line.includes(`"${k}"`));
      const html = lines.map((l) => (style === "rest" && l.includes('":') && !used(l) ? `<span style="opacity:.4">${esc(l)}</span>` : esc(l))).join("\n") + (body.split("\n").length > 40 ? "\n…" : "");
      return h("details", { open: r === all[0] ? true : null, style: { marginTop: "6px" } },
        h("summary", { style: { cursor: "pointer", font: "500 13px var(--mono)" } }, `${r.m} ${r.path}`, h("span.muted", `  ·  ${size(r.body)} bytes${r.binary ? " as JSON, ~45% as protobuf" : ""}`)),
        r.req ? h("pre.log", r.req) : null,
        h("pre.log", { html }));
    }));
  }

  root.append(
    section(null, prose(`<p>Every app screen is a shape of data: here, a profile with three recent posts and how many comments each has. An <b>API style</b> is a decision about who decides that shape and how many trips it takes to get it. Pick a style and look at what actually crosses the network. Greyed-out JSON is data the screen downloads but never shows.</p>`)),
    section("Fetch the same screen four ways",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "API style", options: Object.entries(STYLES).map(([value, v]) => ({ value, label: v.label.split(" (")[0].replace("REST, screen endpoint", "BFF") })), value: style, onChange: (v) => { style = v; render(); } }),
          slider({ label: "Round trip (mobile network)", min: 20, max: 400, step: 10, value: rtt, fmt: (v) => `${v} ms`, onInput: (v) => { rtt = v; render(); } }),
        ),
        h("div.stage-body", st.el, h("div.split", diagram, h("div", note, payloads))),
      ),
      predict({
        chapter: id,
        question: "With plain REST, why can't the app ask for all the comments in the first round trip?",
        options: ["Browsers limit parallel requests", "It doesn't know the post ids until the posts response arrives", "REST forbids more than two requests at once", "The server must authenticate first"],
        answer: 1,
        explain: "<p>Data dependencies create sequential round trips: posts → ids → comments. On a 300 ms mobile link that's 600 ms of pure waiting. BFF endpoints, GraphQL and gRPC all fix it the same way: let the <b>server</b>, which sits next to the database, do the chaining.</p>",
      }),
    ),
    section("When to use what",
      h("div.tbl-wrap", h("table.t",
        h("thead", h("tr", h("th", "Style"), h("th", "Shape decided by"), h("th", "Great for"), h("th", "Watch out for"))),
        h("tbody", [
          ["REST", "Server, per resource", "Public APIs, caching with HTTP, simple CRUD", "Over-fetching, chatty screens"],
          ["BFF endpoint", "Server, per screen", "Mobile apps you control end to end", "Endpoint sprawl"],
          ["GraphQL", "Client, per query", "Many clients with different needs", "N+1 resolvers, caching is harder, query cost limits"],
          ["gRPC", "Shared .proto contract", "Service-to-service, streaming RPCs", "Needs a proxy for browsers, binary is hard to eyeball"],
          ["WebSocket / SSE", "Server pushes", "Live updates (chapter 4.1)", "Connection state, scaling sticky connections"],
        ].map((r) => h("tr", r.map((c, i) => (i === 0 ? h("td", h("b", c)) : h("td", c))))))),
      ),
      dilemma("You're launching a public API for third-party developers.", [
        { name: "REST + OpenAPI", pros: ["Everyone knows it", "HTTP caching and tooling for free"], cons: ["Clients over-fetch", "Versioning is manual"] },
        { name: "GraphQL", pros: ["Clients get exactly what they need", "One evolving schema"], cons: ["Rate limiting by query cost is hard", "Harder to cache at the CDN"] },
      ], "Most public APIs pick REST for reach and predictability, then add GraphQL or BFFs for their own apps."),
    ),
    section("Same screen, in code",
      code({
        REST: `const [user, posts] = await Promise.all([
  fetch("/users/1").then((r) => r.json()),
  fetch("/users/1/posts?limit=3").then((r) => r.json()),
]);
// second round trip: needs the post ids
const counts = await Promise.all(
  posts.map((p) => fetch(\`/posts/\${p.id}/comments\`).then((r) => r.json()).then((c) => c.length)),
);`,
        GraphQL: `const res = await fetch("/graphql", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ query: \`{
    user(id: 1) { name handle avatar_url
      posts(last: 3) { title likes commentCount } } }\` }),
});
const { data } = await res.json();`,
        "gRPC (.proto)": `syntax = "proto3";

service ProfileService {
  rpc GetProfile (GetProfileRequest) returns (Profile);
}
message GetProfileRequest { int64 user_id = 1; }
message Profile {
  string name = 1;
  string handle = 2;
  string avatar_url = 3;
  repeated PostSummary posts = 4;
}
message PostSummary { string title = 1; int32 likes = 2; int32 comment_count = 3; }`,
        "Python server (FastAPI BFF)": `from fastapi import FastAPI
app = FastAPI()

@app.get("/screens/profile/{user_id}")
async def profile_screen(user_id: int):
    user = await db.users.get(user_id)
    posts = await db.posts.latest(user_id, limit=3)
    counts = await db.comments.count_by_post([p.id for p in posts])  # one query, not three
    return {
        "name": user.name, "handle": user.handle, "avatar_url": user.avatar_url,
        "posts": [{"title": p.title, "likes": p.likes, "comment_count": counts[p.id]} for p in posts],
    }`,
      }),
    ),
  );
  render();
}
