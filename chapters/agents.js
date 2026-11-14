import { h, s, esc } from "../lib/core.js";
import { predict, code, dilemma, callout, section, prose, button, stats } from "../lib/widgets.js";

// A scripted model with real message shapes (Anthropic Messages API style).
// You play "your code": you decide what each tool returns.
const USER = "Find me a flight from Berlin to Lisbon next Friday, and book it if the weather there looks nice.";
const TOOLS = [
  { name: "get_weather", description: "Forecast for a city on a date.", input_schema: { type: "object", properties: { city: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD" } }, required: ["city", "date"] } },
  { name: "search_flights", description: "Search flights between two airports.", input_schema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, date: { type: "string" } }, required: ["from", "to", "date"] } },
  { name: "book_flight", description: "Book a flight. Charges the user's card. Requires user approval.", input_schema: { type: "object", properties: { flight_id: { type: "string" } }, required: ["flight_id"] } },
];
const OUTCOMES = {
  get_weather: [
    { label: "Sunny, 22°C", content: { forecast: "sunny", high_c: 22 } },
    { label: "Rain, 14°C", content: { forecast: "rain", high_c: 14 } },
    { label: "Error: timeout", error: "weather service timed out" },
  ],
  search_flights: [
    { label: "2 flights found", content: [{ id: "TP541", dep: "07:10", price_eur: 129 }, { id: "FR1442", dep: "13:45", price_eur: 74 }] },
    { label: "Error: 503", error: "flight search unavailable (503)" },
  ],
  book_flight: [
    { label: "Approve and book", content: { booking_ref: "XK7Q2P", status: "confirmed" } },
    { label: "Deny", error: "The user declined this booking." },
  ],
};
let uid = 0;
const toolId = () => `toolu_${String(++uid).padStart(2, "0")}`;

// The "model": decides its next assistant message from the conversation so far.
function modelTurn(results) {
  const r = Object.fromEntries(results.map((x) => [x.name, x]));
  if (!results.length) return { stop: "tool_use", content: [{ type: "text", text: "I'll check Friday's weather in Lisbon and search flights at the same time." }, call("get_weather", { city: "Lisbon", date: "2026-11-20" }), call("search_flights", { from: "BER", to: "LIS", date: "2026-11-20" })] };
  if (r.book_flight) return r.book_flight.error
    ? { stop: "end_turn", content: [{ type: "text", text: "No problem, I haven't booked anything. The cheaper option is FR1442 at 13:45 for €74 if you change your mind." }] }
    : { stop: "end_turn", content: [{ type: "text", text: "Booked! TP541 departs Berlin at 07:10 on Friday 20 November. Booking reference XK7Q2P. Expect sunshine and 22°C in Lisbon." }] };
  if (r.get_weather?.error && !r.get_weather.retried) return { stop: "tool_use", content: [{ type: "text", text: "The weather service timed out. Let me try once more." }, call("get_weather", { city: "Lisbon", date: "2026-11-20" })], retry: true };
  if (r.search_flights?.error) return { stop: "end_turn", content: [{ type: "text", text: "Flight search is unavailable right now, so I couldn't find or book anything. Want me to try again in a few minutes?" }] };
  if (r.get_weather?.error) return { stop: "end_turn", content: [{ type: "text", text: "I still can't get a forecast, so I won't book without knowing the weather. Here are the options: TP541 at 07:10 (€129) and FR1442 at 13:45 (€74)." }] };
  if (r.get_weather?.content?.forecast === "rain") return { stop: "end_turn", content: [{ type: "text", text: "Friday in Lisbon looks rainy (14°C). You asked me to book only if the weather is nice, so I haven't. Flights: TP541 at 07:10 (€129) or FR1442 at 13:45 (€74). Book one anyway?" }] };
  return { stop: "tool_use", content: [{ type: "text", text: "Sunny and 22°C. I'll book the morning flight so you get the full day there." }, call("book_flight", { flight_id: "TP541" })] };
}
function call(name, input) { return { type: "tool_use", id: toolId(), name, input }; }

function loopDiagram(stage) {
  const nodes = [["model", "Model decides", 140, 40], ["tool_use", "tool_use blocks", 300, 110], ["run", "Your code runs tools", 140, 180], ["result", "tool_result blocks", -20, 110]];
  const svg = s("svg", { viewBox: "-110 0 520 220", role: "img", "aria-label": `Agent loop, current step: ${stage}` });
  svg.append(s("circle", { cx: 140, cy: 110, r: 72, style: "fill:none;stroke:var(--line);stroke-width:2;stroke-dasharray:4 5" }));
  for (const [id, label, x, y] of nodes) {
    const on = id === stage;
    svg.append(s("rect", { x: x - 72, y: y - 17, width: 144, height: 34, rx: 17, class: `node-box${on ? " hot" : ""}`, style: on ? "fill:var(--accent);stroke:var(--accent)" : "" }));
    svg.append(s("text", { x, y: y + 5, "text-anchor": "middle", class: "node-label", style: on ? "fill:var(--accent-ink)" : "", text: label }));
  }
  svg.append(s("text", { x: 140, y: 214, "text-anchor": "middle", class: "node-sub", text: "repeat until stop_reason is end_turn" }));
  return svg;
}

export default function (root, { id }) {
  let messages, pending, stage, calls, done;
  const transcript = h("div", { style: { display: "grid", gap: "8px", maxHeight: "460px", overflow: "auto" } });
  const controls = h("div", { style: { display: "grid", gap: "10px" } });
  const dia = h("div");
  const st = stats([{ label: "Model calls" }, { label: "Messages in history" }, { label: "History size (≈ tokens)" }, { label: "Status" }]);

  function reset() {
    uid = 0;
    messages = [{ role: "user", content: USER }];
    pending = []; calls = 0; done = false; stage = "model";
    step();
  }
  function step() {
    const results = messages.filter((m) => m.role === "user" && Array.isArray(m.content)).flatMap((m) => m.content).map((b) => {
      const use = messages.flatMap((m) => (m.role === "assistant" ? m.content : [])).find((u) => u.id === b.tool_use_id);
      return { name: use.name, error: b.is_error ? b.content : null, content: b.is_error ? null : JSON.parse(b.content) };
    });
    // collapse to the latest result per tool, and remember if weather was retried
    const latest = {};
    for (const r of results) latest[r.name] = r;
    const retried = results.filter((r) => r.name === "get_weather").length > 1;
    const turn = modelTurn(Object.values(latest).map((r) => ({ ...r, retried: r.name === "get_weather" && retried })));
    calls++;
    messages.push({ role: "assistant", content: turn.content, stop_reason: turn.stop });
    pending = turn.content.filter((b) => b.type === "tool_use").map((b) => ({ use: b, choice: null }));
    done = turn.stop === "end_turn";
    stage = done ? "model" : "tool_use";
    render();
  }
  function sendResults() {
    stage = "result";
    messages.push({ role: "user", content: pending.map(({ use, choice }) => {
      const o = OUTCOMES[use.name][choice];
      return o.error ? { type: "tool_result", tool_use_id: use.id, is_error: true, content: o.error } : { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(o.content) };
    }) });
    pending = [];
    render();
    setTimeout(() => { stage = "model"; render(); setTimeout(step, 450); }, 450);
  }

  function render() {
    dia.replaceChildren(loopDiagram(stage));
    const size = JSON.stringify(messages).length;
    st.set(0, String(calls)); st.set(1, String(messages.length)); st.set(2, String(Math.round((JSON.stringify(TOOLS).length + size) / 4)));
    st.set(3, done ? "end_turn" : pending.length ? "waiting for tools" : "thinking…", done ? "good" : "warn");
    transcript.replaceChildren(...messages.map((m, i) => {
      const last = i === messages.length - 1;
      const shown = { role: m.role, content: m.content };
      return h("div", { style: { border: `1px solid ${last ? "var(--accent)" : "var(--line)"}`, borderRadius: "10px", background: "var(--surface)", padding: "8px 10px" } },
        h("div.row", { style: { justifyContent: "space-between" } }, h("b", m.role === "user" ? (Array.isArray(m.content) ? "user (tool results from your code)" : "user") : "assistant"), m.stop_reason ? h("span.pill" + (m.stop_reason === "end_turn" ? ".good" : ".warn"), `stop_reason: ${m.stop_reason}`) : null),
        h("pre", { style: { margin: "6px 0 0", font: "12px/1.5 var(--mono)", whiteSpace: "pre-wrap", wordBreak: "break-word" } }, JSON.stringify(shown.content, null, 1)));
    }));
    queueMicrotask(() => (transcript.scrollTop = transcript.scrollHeight));
    if (done) controls.replaceChildren(callout("tip", "The loop ended", "<p>The model answered without asking for a tool, so <code>stop_reason</code> is <code>end_turn</code> and your code shows the text to the user. Run it again and make different choices.</p>"), button("Start over", reset, "primary"));
    else if (pending.length) controls.replaceChildren(h("div.eyebrow", "You are the tool runtime: what does each tool return?"),
      ...pending.map((p) => h("div", { style: { border: "1px solid var(--line)", borderRadius: "10px", padding: "8px 10px", background: "var(--bg)" } },
        h("div", { style: { font: "600 13px var(--mono)" } }, `${p.use.name}(${JSON.stringify(p.use.input)})`, p.use.name === "book_flight" ? h("span.pill.warn", { style: { marginLeft: "8px" } }, "needs approval") : null),
        h("div.row", { style: { marginTop: "6px" } }, OUTCOMES[p.use.name].map((o, k) => h(`button.btn.small${p.choice === k ? ".primary" : ""}`, { type: "button", onclick: () => { p.choice = k; render(); } }, o.label))))),
      button(`Send ${pending.length} tool result${pending.length > 1 ? "s" : ""} to the model`, sendResults, "primary"));
    if (pending.length) controls.lastChild.disabled = pending.some((p) => p.choice === null);
    else if (!done) controls.replaceChildren(h("p.muted", "Model is working…"));
  }

  root.append(
    section(null, prose(`<p>An <b>agent</b> is a model in a loop with tools. You describe tools (name, description, JSON schema). The model answers either with text, or with <code>tool_use</code> blocks saying which tool to call with which arguments. <b>Your code</b> runs the tool and sends back <code>tool_result</code> blocks. Repeat until the model stops asking. The model never executes anything itself, which is exactly what makes approvals and limits possible.</p>`)),
    section("Run the loop yourself",
      h("div.stage",
        h("div.stage-body",
          st.el,
          h("div.split", h("div", dia, h("div", { style: { marginTop: "8px" } }, controls)), h("div", h("div.eyebrow", "messages[] sent on the next call"), transcript)),
        ),
      ),
      callout("tip", "Try these paths", "<ul style='margin:0;padding-left:18px'><li>Sunny + flights found → approve the booking.</li><li>Rain: the agent follows your condition and doesn't book.</li><li>Weather timeout: watch it retry once, then give up gracefully.</li><li>Deny the booking: the refusal goes back as an error result, and the agent adapts.</li></ul>"),
      predict({
        chapter: id,
        question: "The model returns a tool_use block for book_flight. Who actually charges the card?",
        options: ["The model, inside the API", "Your code, if and when it decides to run the tool", "The user's browser", "Nobody: tool_use is just a log entry"],
        answer: 1,
        explain: "<p>A tool call is a request, not an action. Your code chooses whether to execute it, which is where you put approvals for anything with side effects, permission checks, rate limits and sandboxing. Errors go back as <code>tool_result</code> with <code>is_error</code> so the model can recover instead of the loop crashing.</p>",
      }),
    ),
    section("Designing agents that behave",
      prose(`<ul>
<li><b>Tool descriptions are prompts.</b> Say what the tool does, when to use it, and what the arguments mean. Most “the agent did something dumb” bugs are vague tool docs.</li>
<li><b>Parallel calls.</b> The first turn above asked for weather and flights at once. Run them concurrently and return all results in one message.</li>
<li><b>Guardrails in code, not prose.</b> Approvals for money, deletes and emails; a maximum number of loop iterations; timeouts; validate tool inputs against the schema before running them.</li>
<li><b>History grows every turn.</b> Each call re-sends everything (see the token stat). Long agents need caching, trimming or summarising.</li>
</ul>`),
      dilemma("Should this be an agent at all?", [
        { name: "Workflow (your code decides the steps)", pros: ["Predictable, testable, cheap", "Easy to explain failures"], cons: ["Breaks on cases you didn't foresee"] },
        { name: "Agent (the model decides the steps)", pros: ["Handles open-ended tasks", "Recovers from surprises"], cons: ["Less predictable", "More tokens and latency", "Needs evaluation to trust"] },
      ], "Start with the simplest thing: one call, then a fixed workflow. Reach for a loop when the steps genuinely can't be known in advance."),
    ),
    section("In code",
      code({
        "Python (manual loop)": `import anthropic, json

client = anthropic.Anthropic()
tools = [{
    "name": "get_weather",
    "description": "Forecast for a city on a date. Use before planning outdoor activities.",
    "input_schema": {"type": "object",
                     "properties": {"city": {"type": "string"}, "date": {"type": "string"}},
                     "required": ["city", "date"]},
}]
messages = [{"role": "user", "content": "Is Friday good for a beach day in Lisbon?"}]

for _ in range(10):                                   # hard cap on iterations
    resp = client.messages.create(model="claude-opus-5-5", max_tokens=4000,
                                  tools=tools, messages=messages)
    messages.append({"role": "assistant", "content": resp.content})
    if resp.stop_reason != "tool_use":
        break                                         # end_turn, max_tokens, refusal…
    results = []
    for block in resp.content:
        if block.type == "tool_use":
            try:
                out = run_tool(block.name, block.input)   # YOUR code: approvals live here
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(out)})
            except Exception as e:
                results.append({"type": "tool_result", "tool_use_id": block.id, "is_error": True, "content": str(e)})
    messages.append({"role": "user", "content": results})   # all results in ONE message

print("".join(b.text for b in resp.content if b.type == "text"))`,
        "Tool definitions (JSON)": JSON.stringify(TOOLS, null, 2),
      }),
    ),
  );
  reset();
}
