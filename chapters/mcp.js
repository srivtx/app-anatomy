import { h, s } from "../lib/core.js";
import { slider, segmented, stats, predict, code, dilemma, callout, section, prose, button, table } from "../lib/widgets.js";

const PROTOCOL = "2025-06-18"; // a published MCP spec revision; newer ones exist, check the spec

// ---------- A real (tiny) MCP server: a JSON-RPC 2.0 handler ----------
function makeServer() {
  const notes = [{ id: 1, title: "Standup", body: "Ship the rate limiter on Thursday." }];
  let state = "new"; // new -> initializing -> ready
  const tools = [
    { name: "get_weather", title: "Weather", description: "Current weather for a city.", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } },
    { name: "add_note", title: "Add note", description: "Save a note for the user.", inputSchema: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"] } },
  ];
  const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  const ok = (id, result) => ({ jsonrpc: "2.0", id, result });

  return {
    get state() { return state; },
    handle(msg) {
      if (msg.id === undefined) { // notification: no response
        if (msg.method === "notifications/initialized" && state === "initializing") state = "ready";
        return null;
      }
      const { id, method, params = {} } = msg;
      if (method === "ping") return ok(id, {});
      if (method === "initialize") {
        state = "initializing";
        return ok(id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} }, serverInfo: { name: "notes-and-weather", version: "1.0.0" }, instructions: "Use add_note to save notes. Notes are also readable as resources." });
      }
      if (state !== "ready") return err(id, -32002, "Server not initialized: send initialize, then notifications/initialized");
      switch (method) {
        case "tools/list": return ok(id, { tools });
        case "tools/call": {
          const t = tools.find((x) => x.name === params.name);
          if (!t) return err(id, -32602, `Unknown tool: ${params.name}`);
          const a = params.arguments || {};
          const missing = t.inputSchema.required.filter((k) => typeof a[k] !== "string" || !a[k]);
          if (missing.length) return ok(id, { content: [{ type: "text", text: `Missing argument(s): ${missing.join(", ")}` }], isError: true });
          if (t.name === "get_weather") {
            if (a.city.toLowerCase() === "atlantis") return ok(id, { content: [{ type: "text", text: "No weather station found for Atlantis." }], isError: true });
            return ok(id, { content: [{ type: "text", text: `${a.city}: 18°C, light clouds, wind 12 km/h` }], isError: false });
          }
          notes.push({ id: notes.length + 1, title: a.title, body: a.body });
          return ok(id, { content: [{ type: "text", text: `Saved note #${notes.length} “${a.title}”.` }], isError: false });
        }
        case "resources/list": return ok(id, { resources: notes.map((n) => ({ uri: `notes://${n.id}`, name: n.title, mimeType: "text/plain" })) });
        case "resources/read": {
          const n = notes.find((x) => `notes://${x.id}` === params.uri);
          return n ? ok(id, { contents: [{ uri: params.uri, mimeType: "text/plain", text: n.body }] }) : err(id, -32002, `Resource not found: ${params.uri}`);
        }
        case "prompts/list": return ok(id, { prompts: [{ name: "summarize_notes", description: "Summarise all notes as a bulleted list", arguments: [] }] });
        case "prompts/get": return ok(id, { messages: [{ role: "user", content: { type: "text", text: `Summarise these notes:\n${notes.map((n) => `- ${n.title}: ${n.body}`).join("\n")}` } }] });
        default: return err(id, -32601, `Method not found: ${method}`);
      }
    },
  };
}

function nxm(n, m) {
  const W = 640, H = 220;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${n} apps and ${m} tools` });
  const ay = (i) => 20 + (i + 0.5) * ((H - 40) / n), ty = (j) => 20 + (j + 0.5) * ((H - 40) / m);
  const half = (x, label) => { svg.append(s("text", { x, y: 12, "text-anchor": "middle", class: "node-sub", text: label })); };
  half(70, "Without MCP"); half(250, ""); half(400, "With MCP");
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) svg.append(s("line", { x1: 50, y1: ay(i), x2: 230, y2: ty(j), class: "wire", style: "stroke:var(--warm);opacity:.5" }));
  for (let i = 0; i < n; i++) { svg.append(s("line", { x1: 380, y1: ay(i), x2: 470, y2: H / 2, class: "wire", style: "stroke:var(--accent)" })); }
  for (let j = 0; j < m; j++) { svg.append(s("line", { x1: 490, y1: H / 2, x2: 590, y2: ty(j), class: "wire", style: "stroke:var(--accent)" })); }
  for (let i = 0; i < n; i++) { svg.append(s("circle", { cx: 40, cy: ay(i), r: 9, style: "fill:var(--c1)" }), s("circle", { cx: 370, cy: ay(i), r: 9, style: "fill:var(--c1)" })); }
  for (let j = 0; j < m; j++) { svg.append(s("rect", { x: 232, y: ty(j) - 8, width: 16, height: 16, rx: 3, style: "fill:var(--c3)" }), s("rect", { x: 592, y: ty(j) - 8, width: 16, height: 16, rx: 3, style: "fill:var(--c3)" })); }
  svg.append(s("rect", { x: 462, y: H / 2 - 14, width: 36, height: 28, rx: 6, style: "fill:var(--accent)" }), s("text", { x: 480, y: H / 2 + 4, "text-anchor": "middle", style: "fill:var(--accent-ink);font:700 11px var(--mono)", text: "MCP" }));
  return svg;
}

export default function (root, { id }) {
  // N x M
  let N = 4, M = 6;
  const nxmEl = h("div"), nxmSt = stats([{ label: "Integrations without MCP (N × M)" }, { label: "With MCP (N + M)" }]);
  const renderNxm = () => { nxmEl.replaceChildren(nxm(N, M)); nxmSt.set(0, String(N * M), "bad"); nxmSt.set(1, String(N + M), "good"); };

  // console
  let server = makeServer(), nextId = 1, transport = "stdio", sessionId = null;
  const log = h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", maxHeight: "460px", overflow: "auto" } });
  const stateEl = h("span.pill");
  const cityIn = h("input", { type: "text", value: "Lisbon", "aria-label": "City", style: { width: "110px", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" } });
  const noteIn = h("input", { type: "text", value: "Read the MCP spec", "aria-label": "Note title", style: { width: "150px", padding: "4px 8px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" } });

  function wire(msg, dir) {
    const body = JSON.stringify(msg);
    if (transport === "stdio") return `${dir === "out" ? "→ stdin " : "← stdout"}  ${body}\\n`;
    if (dir === "out") return `POST /mcp HTTP/1.1\nContent-Type: application/json\nAccept: application/json, text/event-stream${sessionId ? `\nMcp-Session-Id: ${sessionId}\nMCP-Protocol-Version: ${PROTOCOL}` : ""}\n\n${JSON.stringify(msg, null, 1)}`;
    return `HTTP/1.1 ${msg ? 200 : 202} ${msg ? "OK" : "Accepted"}\nContent-Type: application/json${msg?.result?.serverInfo ? `\nMcp-Session-Id: ${sessionId}` : ""}\n\n${msg ? JSON.stringify(msg, null, 1) : ""}`;
  }
  function send(method, params, notification = false) {
    const msg = notification ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) };
    const res = server.handle(msg);
    if (method === "initialize" && transport === "http") sessionId = "3f9c1a7e";
    const isErr = res?.error || res?.result?.isError;
    log.append(h("div", { style: { flex: "none", border: "1px solid var(--line)", borderRadius: "10px", overflow: "hidden", background: "var(--surface)" } },
      h("div.row", { style: { justifyContent: "space-between", padding: "6px 10px", background: "var(--sunken)" } }, h("b", { style: { font: "600 13px var(--mono)" } }, method), notification ? h("span.pill", "notification: no reply") : res?.error ? h("span.pill.bad", `JSON-RPC error ${res.error.code}`) : res?.result?.isError ? h("span.pill.warn", "tool error (isError)") : h("span.pill.good", "ok")),
      h("pre", { style: { margin: 0, padding: "8px 10px", font: "12px/1.5 var(--mono)", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--ink-2)" } }, wire(msg, "out")),
      res || transport === "http" ? h("pre", { style: { margin: 0, padding: "8px 10px", font: "12px/1.5 var(--mono)", whiteSpace: "pre-wrap", wordBreak: "break-word", borderTop: "1px dashed var(--line)", color: isErr ? "var(--bad)" : "var(--ink)" } }, wire(res, "in")) : null));
    log.scrollTop = log.scrollHeight;
    stateEl.textContent = `server state: ${server.state}`;
    stateEl.className = `pill ${server.state === "ready" ? "good" : "warn"}`;
  }
  const reset = () => { server = makeServer(); nextId = 1; sessionId = null; log.replaceChildren(); stateEl.textContent = "server state: new"; stateEl.className = "pill warn"; };

  root.append(
    section(null, prose(`<p>Every AI app wants to connect its model to tools and data: files, databases, GitHub, Slack, your internal APIs. Without a standard, every app writes its own integration for every tool. The <b>Model Context Protocol</b> (MCP) is that standard: a tool provider writes one <b>MCP server</b>, and any MCP-capable app (a <b>host</b> such as a chat app or IDE, which runs one <b>client</b> per server) can use it. It's JSON-RPC 2.0 over either stdio or HTTP.</p>`)),
    section("The problem it solves",
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "AI apps (hosts)", min: 1, max: 8, value: N, onInput: (v) => { N = v; renderNxm(); } }),
          slider({ label: "Tools and data sources", min: 1, max: 10, value: M, onInput: (v) => { M = v; renderNxm(); } }),
        ),
        h("div.stage-body", nxmSt.el, nxmEl),
      ),
    ),
    section("Talk to a real MCP server",
      prose("<p>This console sends JSON-RPC messages to a small MCP server running in your page. Follow the lifecycle in order, or break the rules and see the errors.</p>"),
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Transport", options: [{ value: "stdio", label: "stdio (local process)" }, { value: "http", label: "Streamable HTTP (remote)" }], value: transport, onChange: (v) => { transport = v; reset(); } }),
          stateEl,
          button("Reset", reset),
        ),
        h("div.stage-body",
          h("div.row",
            h("span.muted", { style: { fontSize: "13px" } }, "1. Lifecycle"),
            button("initialize", () => send("initialize", { protocolVersion: PROTOCOL, capabilities: { roots: { listChanged: true }, sampling: {}, elicitation: {} }, clientInfo: { name: "app-anatomy-client", version: "1.0.0" } }), "primary"),
            button("notifications/initialized", () => send("notifications/initialized", null, true)),
            button("ping", () => send("ping")),
          ),
          h("div.row",
            h("span.muted", { style: { fontSize: "13px" } }, "2. Tools"),
            button("tools/list", () => send("tools/list")),
            button("tools/call get_weather", () => send("tools/call", { name: "get_weather", arguments: { city: cityIn.value } })), cityIn,
            button("tools/call add_note", () => send("tools/call", { name: "add_note", arguments: { title: noteIn.value, body: "Added from the console." } })), noteIn,
          ),
          h("div.row",
            h("span.muted", { style: { fontSize: "13px" } }, "3. Resources & prompts"),
            button("resources/list", () => send("resources/list")),
            button("resources/read notes://1", () => send("resources/read", { uri: "notes://1" })),
            button("prompts/get summarize_notes", () => send("prompts/get", { name: "summarize_notes" })),
            button("unknown/method", () => send("unknown/method")),
          ),
          log,
        ),
      ),
      callout("tip", "Things to try", "<ul style='margin:0;padding-left:18px'><li>Call <code>tools/list</code> before initializing: the server refuses.</li><li>Ask for the weather in Atlantis: the call succeeds at the protocol level but returns <code>isError: true</code>, so the <i>model</i> sees the failure and can react. Protocol errors (bad method, unknown tool) are for the client instead.</li><li>Switch to Streamable HTTP: the same JSON, now in POST requests, with a session id after <code>initialize</code>.</li></ul>"),
      predict({
        chapter: id,
        question: "A chat app connects to your MCP server. Who decides when get_weather is called?",
        options: ["The MCP server, on a schedule", "The model proposes the call; the host app runs it through its MCP client, often after asking the user", "The user must type the JSON-RPC by hand", "The protocol calls every tool once at startup"],
        answer: 1,
        explain: "<p>MCP doesn't replace the agent loop from the previous chapter, it plugs into it. The host lists the server's tools, passes them to the model as tool definitions, and when the model emits a tool_use, the host sends <code>tools/call</code> to the right server and returns the result as a tool_result. Tools are model-controlled; resources are attached by the app; prompts are picked by the user.</p>",
      }),
    ),
    section("The three primitives (and the other direction)",
      table(["Primitive", "Who controls it", "Example"], [
        ["Tools", "The model decides to call them", "create_issue, run_query, send_message"],
        ["Resources", "The app chooses what to attach", "A file, a database schema, a ticket as read-only context"],
        ["Prompts", "The user picks them (like slash commands)", "/summarize_notes, /review-pr"],
        ["Sampling (client feature)", "The server asks the host's model to generate", "A server that needs an LLM without its own API key"],
        ["Elicitation (client feature)", "The server asks the user for input", "“Which repository did you mean?”"],
      ]),
      dilemma("You're exposing your company's internal API to AI assistants.", [
        { name: "Local stdio server", pros: ["Runs on the user's machine with their credentials", "No hosting"], cons: ["Every user installs and updates it", "Hard to audit"] },
        { name: "Remote HTTP server with OAuth", pros: ["One deployment, central logs and permissions", "Works from web and mobile hosts"], cons: ["You run and secure a public endpoint", "OAuth setup"] },
      ], "Remote servers with OAuth are where most company integrations are heading; local servers remain great for developer tools that touch local files."),
      callout("warn", "Security", "<p>Tool descriptions and tool results go straight into the model's context, so a malicious server or a poisoned document can carry prompt injections. Only install servers you trust, give them least-privilege credentials, and keep a human confirmation on anything destructive.</p>"),
    ),
    section("Build one",
      code({
        "Python (official SDK)": `# pip install "mcp[cli]"
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("notes")
notes: list[dict] = []

@mcp.tool()
def add_note(title: str, body: str) -> str:
    """Save a note for the user."""          # the docstring becomes the tool description
    notes.append({"title": title, "body": body})
    return f"Saved note #{len(notes)}"

@mcp.resource("notes://{index}")
def read_note(index: int) -> str:
    return notes[int(index) - 1]["body"]

@mcp.prompt()
def summarize_notes() -> str:
    return "Summarise these notes:\\n" + "\\n".join(f"- {n['title']}: {n['body']}" for n in notes)

if __name__ == "__main__":
    mcp.run()          # stdio by default; mcp.run(transport="streamable-http") for remote`,
        "TypeScript (official SDK)": `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "weather", version: "1.0.0" });

server.registerTool(
  "get_weather",
  { title: "Weather", description: "Current weather for a city.", inputSchema: { city: z.string() } },
  async ({ city }) => ({ content: [{ type: "text", text: await forecast(city) }] }),
);

await server.connect(new StdioServerTransport());`,
        "Connect it": `# Claude Code
claude mcp add notes -- python server.py

# Desktop apps usually take a JSON config like:
{
  "mcpServers": {
    "notes": { "command": "python", "args": ["server.py"] }
  }
}`,
      }, "SDK APIs evolve; check the official MCP documentation for the version you install."),
    ),
  );
  renderNxm();
  reset();
}
