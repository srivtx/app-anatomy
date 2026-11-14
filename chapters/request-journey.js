import { h, s, fmtMs } from "../lib/core.js";
import { slider, segmented, toggle, stats, predict, code, callout, section, prose } from "../lib/widgets.js";

// A page load, phase by phase. Numbers are a simple model, not a benchmark:
// every handshake costs round trips, and round trips cost distance.
const ASSETS = 12, ASSET_KB = 75, MBPS = 40;
const transferMs = (kb) => (kb * 8) / (MBPS * 1000) * 1000; // KB over MBPS megabits/s

function model(o) {
  const R = o.rtt, E = o.cdn ? 12 : R; // E: round trip to whoever terminates the connection
  const rows = [];
  let t = 0;
  const add = (label, dur, color, note) => { rows.push({ label, start: t, dur, color, note }); t += dur; };

  if (!o.warm) {
    add("DNS lookup", o.dnsCached ? 0 : 35, "var(--c5)", o.dnsCached ? "cached by the OS" : "ask a resolver for the IP");
    add("TCP handshake", E, "var(--c4)", "SYN, SYN-ACK: 1 round trip");
    add("TLS handshake", E * (o.tls === "1.2" ? 2 : 1), "var(--c6)", o.tls === "1.2" ? "TLS 1.2: 2 round trips" : "TLS 1.3: 1 round trip");
  }
  const server = 12 + o.queries * 4;
  const reqStart = t;
  const toOrigin = o.cdn ? E + R : R; // the HTML is dynamic: the edge must still ask the origin
  rows.push({ label: "Request → first byte", start: t, dur: toOrigin + server, color: "var(--c1)", note: `${o.cdn ? "edge + origin" : "1 round trip"} + server ${server} ms`, server: { start: t + toOrigin / 2, dur: server } });
  t += toOrigin + server;
  const ttfb = t;
  add("HTML download", 8 + transferMs(60), "var(--c3)", "60 KB");
  const htmlDone = t;

  // Sub-resources: CSS, JS, images
  const A = o.cdn ? 12 : R;
  if (o.http === "2") {
    rows.push({ label: `${ASSETS} assets, one connection`, start: t, dur: A + transferMs(ASSETS * ASSET_KB), color: "var(--c2)", note: "multiplexed over HTTP/2" });
    t += A + transferMs(ASSETS * ASSET_KB);
  } else {
    // 6 connections per origin; 5 new ones pay their own handshakes
    const setup = A * (o.tls === "1.2" ? 3 : 2);
    const batches = Math.ceil(ASSETS / 6);
    let bt = t;
    for (let b = 0; b < batches; b++) {
      const n = Math.min(6, ASSETS - b * 6);
      const dur = (b === 0 ? setup : 0) + A + transferMs(n * ASSET_KB);
      rows.push({ label: `Assets ${b * 6 + 1}–${b * 6 + n} (6 connections)`, start: bt, dur, color: "var(--c2)", note: b === 0 ? "new connections pay handshakes" : "wait for a free connection" });
      bt += dur;
    }
    t = bt;
  }
  return { rows, ttfb, htmlDone, total: t, reqStart };
}

function waterfall(res) {
  const W = 720, rowH = 30, L = 210, top = 22;
  const H = top + res.rows.length * rowH + 10;
  const max = Math.max(400, res.total * 1.05);
  const x = (ms) => L + (ms / max) * (W - L - 70);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Waterfall, page loads in ${Math.round(res.total)} ms` });
  const step = max > 1500 ? 500 : max > 700 ? 200 : 100;
  for (let ms = 0; ms <= max; ms += step) {
    svg.append(s("line", { x1: x(ms), x2: x(ms), y1: top - 6, y2: H - 6, class: "wire", "stroke-dasharray": "2 4" }), s("text", { x: x(ms), y: 12, "text-anchor": "middle", class: "node-sub", text: `${ms}` }));
  }
  res.rows.forEach((r, i) => {
    const y = top + i * rowH;
    svg.append(s("text", { x: 0, y: y + 17, class: "node-label", text: r.label }));
    if (r.dur > 0) svg.append(s("rect", { x: x(r.start), y: y + 5, width: Math.max(2, x(r.start + r.dur) - x(r.start)), height: 16, rx: 4, style: `fill:${r.color}` }));
    if (r.server) svg.append(s("rect", { x: x(r.server.start), y: y + 5, width: Math.max(2, x(r.server.start + r.server.dur) - x(r.server.start)), height: 16, rx: 2, style: "fill:var(--ink);opacity:.35" }));
    svg.append(s("text", { x: x(r.start + r.dur) + 6, y: y + 17, class: "node-sub", text: r.dur ? fmtMs(r.dur) : "0 ms" }));
  });
  return svg;
}

export default function (root, { id }) {
  const o = { rtt: 120, dnsCached: false, tls: "1.3", http: "2", cdn: false, warm: false, queries: 5 };
  const chart = h("div");
  const st = stats([{ label: "Time to first byte" }, { label: "HTML done" }, { label: "Page loaded" }, { label: "Round trips paid" }]);
  const note = h("p.muted", { style: { margin: 0, fontSize: "14px" } });

  function render() {
    const r = model(o);
    chart.replaceChildren(waterfall(r));
    st.set(0, fmtMs(r.ttfb));
    st.set(1, fmtMs(r.htmlDone));
    st.set(2, fmtMs(r.total), r.total > 1500 ? "bad" : r.total < 600 ? "good" : "");
    const rtts = (o.warm ? 0 : 1 + (o.tls === "1.2" ? 2 : 1)) + (o.cdn ? 2 : 1) + (o.http === "2" ? 1 : 2 + (o.tls === "1.2" ? 3 : 2));
    st.set(3, String(rtts));
    const share = Math.round(((r.ttfb - (12 + o.queries * 4)) / r.total) * 100);
    note.textContent = `Waiting on the network is ${Math.max(0, share)}% of the time before the first byte arrives; the server itself (dark segment) works for ${12 + o.queries * 4} ms.`;
  }

  const controls = [
    slider({ label: "Distance to server (round trip)", min: 10, max: 300, step: 5, value: o.rtt, fmt: (v) => `${v} ms`, hint: "~10 same city, ~80 cross-country, ~250 other side of the world", onInput: (v) => { o.rtt = v; render(); } }),
    slider({ label: "Database queries per page", min: 1, max: 40, value: o.queries, fmt: (v) => `${v} × 4 ms`, onInput: (v) => { o.queries = v; render(); } }),
    segmented({ label: "TLS", options: [{ value: "1.2", label: "1.2" }, { value: "1.3", label: "1.3" }], value: o.tls, onChange: (v) => { o.tls = v; render(); } }),
    segmented({ label: "HTTP", options: [{ value: "1.1", label: "1.1" }, { value: "2", label: "2" }], value: o.http, onChange: (v) => { o.http = v; render(); } }),
    toggle({ label: "CDN edge nearby", onChange: (v) => { o.cdn = v; render(); } }),
    toggle({ label: "DNS cached", onChange: (v) => { o.dnsCached = v; render(); } }),
    toggle({ label: "Reuse an open connection", onChange: (v) => { o.warm = v; render(); } }),
  ];

  root.append(
    section(null, prose(`<p>You type a URL and press Enter. Before a single pixel appears, your browser finds the server, opens a connection, agrees on encryption, asks for the page, waits while the server talks to its database, downloads the HTML, and then fetches a dozen more files. Each of those steps costs <b>round trips</b>, and a round trip costs <b>distance</b>.</p>`)),
    section("Tune a page load",
      h("div.stage", h("div.stage-controls", controls), h("div.stage-body", st.el, chart, note)),
      predict({
        chapter: id,
        question: "The server is 250 ms away and the page is dynamic. You put a CDN edge 12 ms from the user. What happens to time to first byte?",
        options: ["It drops to about 12 ms", "It gets a little faster: the handshakes are shorter, but the HTML still comes from far away", "It doesn't change at all", "It gets slower, because there is an extra hop"],
        answer: 1,
        explain: "<p>The edge finishes TCP and TLS close to the user, which saves those round trips. But dynamic HTML is still built at the origin, so the edge has to ask it, over a connection it keeps warm. Static files (CSS, JS, images) are where a CDN shines: they're served straight from the edge. Try it with the slider at 250 ms.</p>",
      }),
    ),
    section("The seven steps",
      prose(`<ol>
<li><b>DNS</b> turns <code>example.com</code> into an IP address. Usually cached by your OS or router; a cold lookup asks a resolver, which may ask other servers.</li>
<li><b>TCP handshake</b>: SYN, SYN-ACK, ACK. One round trip before any data can flow.</li>
<li><b>TLS handshake</b> agrees on keys and checks the certificate. TLS 1.3 needs one round trip, TLS 1.2 needed two. QUIC (HTTP/3) folds TCP and TLS together.</li>
<li><b>Request</b>: the browser sends <code>GET /</code> with headers and cookies.</li>
<li><b>Server work</b>: routing, auth, business logic and database queries. This is the only part your backend code controls.</li>
<li><b>Response</b>: status, headers, then the HTML body, often compressed.</li>
<li><b>Sub-resources</b>: the HTML names CSS, JS, fonts and images, and each one is another request. HTTP/1.1 allows about six connections per host; HTTP/2 sends everything over one.</li>
</ol>`),
      callout("tip", "Rule of thumb", "<p>Far-away users are slow because of round trips, not because your server is slow. Cut round trips (TLS 1.3, HTTP/2, connection reuse), move bytes closer (CDN), and only then optimise code.</p>"),
    ),
    section("Latency numbers worth knowing",
      h("div.tbl-wrap", h("table.t",
        h("thead", h("tr", h("th", "Operation"), h("th.num", "Rough time"))),
        h("tbody", [
          ["Read from CPU L1 cache", "1 ns"], ["Read from main memory", "100 ns"], ["Read 4 KB from an SSD", "~20–100 µs"],
          ["Round trip inside a data center", "~0.5 ms"], ["Simple indexed database query", "~1–5 ms"], ["Round trip across a continent", "~40–80 ms"], ["Round trip across the world", "~150–300 ms"],
        ].map(([a, b]) => h("tr", h("td", a), h("td.num", b)))))),
      prose("<p style='margin-top:12px'>Memory is about a million times faster than a cross-world round trip. That ratio explains caching, CDNs, connection pooling and why chatty APIs feel slow.</p>"),
    ),
    section("Measure it yourself",
      code({
        curl: `curl -o /dev/null -s -w '
dns   %{time_namelookup}s
tcp   %{time_connect}s
tls   %{time_appconnect}s
ttfb  %{time_starttransfer}s
total %{time_total}s
' https://example.com`,
        Python: `import socket, ssl, time

host = "example.com"
t0 = time.perf_counter()
ip = socket.gethostbyname(host)                      # DNS
t1 = time.perf_counter()
sock = socket.create_connection((ip, 443))          # TCP handshake
t2 = time.perf_counter()
tls = ssl.create_default_context().wrap_socket(sock, server_hostname=host)  # TLS
t3 = time.perf_counter()
tls.sendall(f"GET / HTTP/1.1\\r\\nHost: {host}\\r\\nConnection: close\\r\\n\\r\\n".encode())
tls.recv(1)                                          # first byte
t4 = time.perf_counter()

for name, a, b in [("dns", t0, t1), ("tcp", t1, t2), ("tls", t2, t3), ("ttfb", t3, t4)]:
    print(f"{name:5} {(b - a) * 1000:6.1f} ms")`,
        "Browser JS": `// Paste into DevTools on any page
const n = performance.getEntriesByType("navigation")[0];
console.table({
  dns:  n.domainLookupEnd - n.domainLookupStart,
  tcp:  n.connectEnd - n.connectStart,
  tls:  n.secureConnectionStart ? n.connectEnd - n.secureConnectionStart : 0,
  ttfb: n.responseStart - n.requestStart,
  html: n.responseEnd - n.responseStart,
  load: n.loadEventEnd - n.startTime,
});`,
      }, "The curl numbers are cumulative from the start; the Python and browser ones are per phase."),
    ),
  );
  render();
}
