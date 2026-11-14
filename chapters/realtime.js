import { h, rng, loop, fmtMs } from "../lib/core.js";
import { slider, stats, predict, code, dilemma, section, prose, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// Same message stream, four transports. Times in seconds.
const SPAN = 20, HTTP_OVERHEAD = 700, FRAME_OVERHEAD = { sse: 12, ws: 6 };
const LANES = [
  { id: "poll", name: "Short polling", sub: "ask every N s" },
  { id: "long", name: "Long polling", sub: "hold until news" },
  { id: "sse", name: "Server-Sent Events", sub: "server → client" },
  { id: "ws", name: "WebSocket", sub: "one socket, both ways" },
];

function makeSim(o) {
  const r = rng(3);
  let t = 0, nextMsg = r.exp(60 / o.rate), nextPoll = o.poll;
  const msgs = []; // {t}
  const ev = { poll: [], long: [], sse: [], ws: [] }; // {kind:'req'|'deliver', t, from?}
  const totals = Object.fromEntries(LANES.map((l) => [l.id, { req: 0, bytes: 0, delays: [] }]));
  const pendingPoll = [];
  let longOpenAt = 0, longReady = 0, longQueue = [];
  const oneWay = () => o.rtt / 2000;
  const add = (lane, e) => { ev[lane].push(e); if (e.kind === "req") { totals[lane].req++; totals[lane].bytes += HTTP_OVERHEAD; } };
  const deliver = (lane, m, at) => { ev[lane].push({ kind: "deliver", t: at, from: m.t }); totals[lane].delays.push(at - m.t); if (FRAME_OVERHEAD[lane]) totals[lane].bytes += FRAME_OVERHEAD[lane]; };
  ev.sse.push({ kind: "req", t: 0 }); ev.ws.push({ kind: "req", t: 0 }); totals.sse.req = totals.ws.req = 1;
  add("long", { kind: "req", t: 0 });

  return {
    msgs, ev, totals, get t() { return t; },
    step(dt) {
      const end = t + dt;
      while (t < end) {
        t = Math.min(end, t + 0.01);
        while (nextMsg <= t) {
          const m = { t: nextMsg };
          msgs.push(m);
          pendingPoll.push(m);
          deliver("sse", m, m.t + oneWay());
          deliver("ws", m, m.t + oneWay());
          longQueue.push(m);
          nextMsg += r.exp(60 / o.rate);
        }
        // short polling: request every o.poll seconds, response brings anything that arrived before it
        while (nextPoll <= t) {
          add("poll", { kind: "req", t: nextPoll });
          for (const m of pendingPoll.splice(0)) deliver("poll", m, nextPoll + oneWay());
          nextPoll += o.poll;
        }
        // long polling: an open request is answered as soon as something arrives (or after 30 s)
        if (longReady <= t && longQueue.length && longQueue[0].t >= longOpenAt - 1e-9) {
          const batch = longQueue.splice(0);
          for (const m of batch) deliver("long", m, Math.max(t, m.t) + oneWay());
          longReady = t + o.rtt / 1000; // client needs a round trip to open the next request
          longOpenAt = longReady;
          add("long", { kind: "req", t: longReady });
        } else if (t - longOpenAt > 30) { longOpenAt = t; add("long", { kind: "req", t }); }
      }
      const cut = t - SPAN - 2;
      for (const k in ev) ev[k] = ev[k].filter((e) => e.t > cut || (e.from && e.from > cut));
      while (msgs.length && msgs[0].t < cut) msgs.shift();
    },
  };
}

export default function (root, { id }) {
  const o = { rate: 20, poll: 5, rtt: 120 };
  let sim = makeSim(o);
  const fc = flowCanvas({ width: 720, height: 300, label: "Message delivery over four transports" });
  const st = stats(LANES.map((l) => ({ label: l.name })));
  const bytes = h("div");

  function draw() {
    const c = fc.colors, t = sim.t, X0 = 170, X1 = 708, tx = (x) => X0 + ((x - (t - SPAN)) / SPAN) * (X1 - X0);
    fc.clear();
    fc.text("new messages on the server", 8, 16, { size: 11, weight: 500, color: c.warm });
    fc.line(X0, 16, X1, 16, { color: c.line });
    for (const m of sim.msgs) if (m.t > t - SPAN) fc.dot(tx(m.t), 16, 4, c.warm);
    LANES.forEach((l, i) => {
      const y = 40 + i * 64;
      fc.text(l.name, 8, y + 18, { size: 12.5 });
      fc.text(l.sub, 8, y + 36, { size: 10.5, weight: 500, mono: true, color: c["ink-3"] });
      fc.box(X0, y, X1 - X0, 50, { fill: c.bg, stroke: c.line, r: 6 });
      if (l.id === "sse" || l.id === "ws") fc.line(X0, y + 25, X1, y + 25, { color: c.accent, lw: 3 }); // the open connection
      for (const e of sim.ev[l.id]) {
        if (e.kind === "req" && e.t > t - SPAN && l.id !== "sse" && l.id !== "ws") fc.line(tx(e.t), y + 6, tx(e.t), y + 44, { color: c["ink-3"], lw: 1.5 });
        if (e.kind === "deliver" && e.t <= t && e.t > t - SPAN) {
          fc.line(tx(Math.max(e.from, t - SPAN)), y + 4, tx(e.t), y + 25, { color: c.warm, lw: 1, dash: [3, 3] });
          fc.dot(tx(e.t), y + 25, 4, c.good);
        }
      }
    });
  }
  let acc = 0;
  const lp = loop((dt) => {
    sim.step(dt);
    draw();
    acc += dt;
    if (acc > 0.5) {
      acc = 0;
      const mins = Math.max(sim.t, 1) / 60;
      LANES.forEach((l, i) => {
        const T = sim.totals[l.id];
        const avg = T.delays.length ? T.delays.reduce((a, b) => a + b, 0) / T.delays.length : 0;
        const reqs = l.id === "sse" || l.id === "ws" ? "1 connection" : `${Math.round(T.req / mins)} req/min`;
        st.set(i, `${fmtMs(avg * 1000)} delay · ${reqs}`, avg > 1 ? "bad" : avg < 0.2 ? "good" : "");
      });
      bytes.replaceChildren(table(["Transport", "Overhead per minute", "Why"], LANES.map((l) => {
        const T = sim.totals[l.id];
        return [l.name, `${(T.bytes / mins / 1024).toFixed(1)} KB`, l.id === "poll" ? "full HTTP headers on every poll, even empty ones" : l.id === "long" ? "full headers once per delivery" : l.id === "sse" ? "a few bytes per event" : "2–14 byte frame header per message"];
      })));
    }
  }, fc.el);

  root.append(
    section(null, prose(`<p>Chat, notifications, live scores, collaborative cursors, an LLM streaming its answer: the server learns something and the user should see it <i>now</i>. HTTP is request–response, so the client has to ask. There are four classic ways to hear about news. Orange dots are messages arriving on the server; green dots are when the client actually gets them.</p>`)),
    section("Four ways to hear about new messages",
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "Messages per minute", min: 2, max: 120, value: o.rate, onInput: (v) => { o.rate = v; sim = makeSim(o); } }),
          slider({ label: "Short-poll interval", min: 1, max: 15, value: o.poll, fmt: (v) => `${v} s`, onInput: (v) => { o.poll = v; sim = makeSim(o); } }),
          slider({ label: "Network round trip", min: 20, max: 500, step: 10, value: o.rtt, fmt: (v) => `${v} ms`, onInput: (v) => { o.rtt = v; } }),
        ),
        h("div.stage-body", st.el, fc.el, bytes),
      ),
      predict({
        chapter: id,
        question: "Messages arrive about once every 3 seconds and you short-poll every 5 seconds. What's the average delay before the user sees a message?",
        options: ["Under 100 ms", "About 2.5 seconds", "About 5 seconds", "About 15 seconds"],
        answer: 1,
        explain: "<p>A message lands at a random point between two polls, so it waits half the interval on average: 2.5 s, plus a bit of network. Polling faster cuts the delay but multiplies requests, most of which come back empty. SSE and WebSockets deliver in about half a round trip with one connection.</p>",
      }),
    ),
    section("Choosing a transport",
      table(["Transport", "Direction", "Good for", "Watch out for"], [
        ["Short polling", "client asks", "Rare updates, simplest possible infra", "Delay vs wasted requests"],
        ["Long polling", "server answers when ready", "Fallback where streaming is blocked", "Reconnect gap after every message"],
        ["Server-Sent Events", "server → client", "Notifications, feeds, LLM token streaming", "One-way; text only; plain HTTP so proxies and auth just work"],
        ["WebSocket", "both ways", "Chat, multiplayer, collaborative editing", "Stateful connections: load balancing, reconnects and fan-out need care"],
      ]),
      dilemma("A chat app grows from one server to ten. Ada is connected to server 3, Grace to server 7. Grace sends Ada a message.", [
        { name: "Pub/sub between servers (Redis, NATS)", pros: ["Any server can reach any user", "Simple to add"], cons: ["Every message crosses the bus", "The bus becomes critical infrastructure"] },
        { name: "Route users to fixed servers (consistent hashing)", pros: ["Messages within a group stay on one server"], cons: ["Rebalancing on scale-up disconnects people", "Hot rooms overload one server"] },
      ], "Most products start with Redis pub/sub fan-out and move to sharded rooms or a managed service (Ably, Pusher, Cloudflare Durable Objects) when it hurts."),
    ),
    section("In code",
      code({
        "Browser": `// Short polling
setInterval(async () => render(await (await fetch("/messages?since=" + last)).json()), 5000);

// Server-Sent Events: the browser reconnects automatically
const es = new EventSource("/stream");
es.onmessage = (e) => render(JSON.parse(e.data));

// WebSocket: both directions
const ws = new WebSocket("wss://chat.example.com/room/42");
ws.onmessage = (e) => render(JSON.parse(e.data));
ws.send(JSON.stringify({ text: "hi" }));`,
        "Node (SSE server)": `app.get("/stream", (req, res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (msg) => res.write(\`data: \${JSON.stringify(msg)}\\n\\n\`);
  bus.on("message", send);
  const ping = setInterval(() => res.write(": ping\\n\\n"), 15000);   // keep proxies from closing it
  req.on("close", () => { bus.off("message", send); clearInterval(ping); });
});`,
        "Python (WebSocket server)": `import asyncio, json, websockets

clients: set = set()

async def handler(ws):
    clients.add(ws)
    try:
        async for raw in ws:                      # messages from this client
            msg = json.loads(raw)
            websockets.broadcast(clients, json.dumps(msg))
    finally:
        clients.discard(ws)

async def main():
    async with websockets.serve(handler, "0.0.0.0", 8765):
        await asyncio.Future()                    # run forever

asyncio.run(main())`,
      }),
    ),
  );
  draw();
  lp.start();
}
