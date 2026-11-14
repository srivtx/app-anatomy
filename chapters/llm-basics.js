import { h, fmtN } from "../lib/core.js";
import { slider, segmented, stats, predict, code, dilemma, callout, section, prose, button, bars } from "../lib/widgets.js";

// 1. An illustrative tokenizer: real models learn a vocabulary of ~100k+
// sub-word pieces (BPE). This mimics the effect: common short words are one
// token, long or rare words split into pieces, punctuation is its own token.
function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(/\s*[A-Za-z]+|\s*\d{1,3}|\s*[^\sA-Za-z\d]|\s+/g)) {
    const t = m[0];
    const word = t.trim();
    if (/^[A-Za-z]+$/.test(word) && word.length > 7) {
      const lead = t.slice(0, t.length - word.length);
      for (let i = 0; i < word.length; i += 5) out.push((i ? "" : lead) + word.slice(i, i + 5));
    } else out.push(t);
  }
  return out;
}

// 2. Next-token distribution for one prompt (made-up but realistic logits)
const PROMPT = "The best way to learn system design is";
const LOGITS = [[" to", 6.1], [" by", 5.6], [" practice", 4.3], [" building", 4.0], [" through", 3.7], [" reading", 3.0], [" not", 2.2], [" with", 2.0], [" probably", 1.6], [" bananas", -1.5]];

function distribution(T, topP) {
  if (T === 0) return LOGITS.map(([tok], i) => ({ tok, p: i === 0 ? 1 : 0, kept: i === 0 }));
  const ex = LOGITS.map(([, l]) => Math.exp(l / T));
  const Z = ex.reduce((a, b) => a + b, 0);
  const probs = LOGITS.map(([tok], i) => ({ tok, p: ex[i] / Z }));
  const sorted = [...probs].sort((a, b) => b.p - a.p);
  let cum = 0;
  const keep = new Set();
  for (const x of sorted) { if (cum >= topP) break; keep.add(x.tok); cum += x.p; }
  const Zk = probs.filter((x) => keep.has(x.tok)).reduce((a, b) => a + b.p, 0);
  return probs.map((x) => ({ tok: x.tok, p: keep.has(x.tok) ? x.p / Zk : 0, kept: keep.has(x.tok) }));
}

export default function (root, { id }) {
  // tokenizer
  const ta = h("textarea", { rows: 3, "aria-label": "Text to tokenize", style: { width: "100%", padding: "10px", border: "1px solid var(--line)", borderRadius: "10px", background: "var(--surface)", font: "15px var(--body)" } }, "Tokenization explains why LLMs are bad at counting letters in strawberry, and why prices are per token.");
  const tokOut = h("div", { style: { display: "flex", flexWrap: "wrap", gap: "3px", font: "14px var(--mono)" } });
  const tokStats = stats([{ label: "Characters" }, { label: "Tokens (illustrative)" }, { label: "Characters per token" }]);
  const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)"];
  function renderTokens() {
    const toks = tokenize(ta.value);
    tokOut.replaceChildren(...toks.map((t, i) => h("span", { title: JSON.stringify(t), style: { background: `color-mix(in srgb, ${COLORS[i % 6]} 22%, transparent)`, borderRadius: "4px", padding: "1px 2px", whiteSpace: "pre" } }, t.replace(/ /g, "·"))));
    tokStats.set(0, String(ta.value.length));
    tokStats.set(1, String(toks.length));
    tokStats.set(2, (ta.value.length / Math.max(1, toks.length)).toFixed(1));
  }
  ta.addEventListener("input", renderTokens);

  // sampling
  let T = 1, topP = 1;
  const r = Math.random; // fresh randomness: every visit samples differently
  const distEl = h("div"), histEl = h("div"), sentence = h("p", { style: { font: "17px var(--body)", margin: 0 } });
  const counts = new Map();
  function renderDist() {
    const d = distribution(T, topP);
    distEl.replaceChildren(bars(d.map((x) => ({ label: JSON.stringify(x.tok), value: x.p * 100, color: x.kept ? "var(--accent)" : "var(--line)" })), { max: 100, fmt: (v) => `${v.toFixed(v < 1 ? 2 : 1)}%` }));
  }
  function draw(n) {
    const d = distribution(T, topP);
    let last;
    for (let k = 0; k < n; k++) {
      let u = r(), pick = d[0].tok;
      for (const x of d) { if ((u -= x.p) <= 0) { pick = x.tok; break; } }
      counts.set(pick, (counts.get(pick) || 0) + 1);
      last = pick;
    }
    sentence.replaceChildren(PROMPT, h("b", { style: { color: "var(--accent)" } }, last));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    histEl.replaceChildren(h("div.eyebrow", `What you've drawn (${total} samples)`), bars(LOGITS.map(([tok]) => ({ label: JSON.stringify(tok), value: counts.get(tok) || 0, color: "var(--warm)" })), { fmt: (v) => String(v) }));
  }

  // context budget
  const budget = { window: 200000, system: 2000, tools: 6000, history: 30000, docs: 20000, output: 8000, price: 3 };
  const budgetEl = h("div"), budgetStats = stats([{ label: "Input tokens per call" }, { label: "Room left" }, { label: "Input cost per call" }, { label: "Cost for 1,000 calls" }]);
  function renderBudget() {
    const parts = [["System prompt", budget.system, "var(--c6)"], ["Tool definitions", budget.tools, "var(--c5)"], ["Conversation so far", budget.history, "var(--c1)"], ["Retrieved documents", budget.docs, "var(--c3)"], ["Reserved for the answer", budget.output, "var(--c4)"]];
    const used = parts.reduce((a, p) => a + p[1], 0), input = used - budget.output;
    budgetEl.replaceChildren(
      h("div", { style: { display: "flex", height: "26px", borderRadius: "8px", overflow: "hidden", background: "var(--sunken)", border: "1px solid var(--line)" }, role: "img", "aria-label": `${fmtN(used)} of ${fmtN(budget.window)} tokens used` },
        ...parts.map(([n, v, c]) => h("div", { title: `${n}: ${fmtN(v)}`, style: { width: `${Math.min(100, (v / budget.window) * 100)}%`, background: c } }))),
      h("div.legend", { style: { marginTop: "6px" } }, ...parts.map(([n, v, c]) => h("span", h("i", { style: { background: c } }), `${n} ${fmtN(v)}`))),
    );
    budgetStats.set(0, fmtN(input));
    budgetStats.set(1, used > budget.window ? `over by ${fmtN(used - budget.window)}` : fmtN(budget.window - used), used > budget.window ? "bad" : "good");
    budgetStats.set(2, `$${((input / 1e6) * budget.price).toFixed(4)}`);
    budgetStats.set(3, `$${((input / 1e6) * budget.price * 1000).toFixed(2)}`);
  }
  const bslider = (key, label, max, step = 1000) => slider({ label, min: 0, max, step, value: budget[key], fmt: fmtN, onInput: (v) => { budget[key] = v; renderBudget(); } });

  root.append(
    section(null, prose(`<p>Under every AI app is the same loop. Text is cut into <b>tokens</b>. The model reads all the tokens so far and outputs a <b>probability for every possible next token</b>. One is picked, appended, and the loop runs again until a stop token. “Streaming” is just sending each token to the user as soon as it's picked. Everything else (chat, agents, RAG) is built on top of this.</p>`)),
    section("1 · Text becomes tokens",
      h("div.stage", h("div.stage-body", ta, tokStats.el, tokOut)),
      callout("tip", "Why it matters", "<p>Models see pieces, not letters, which is why spelling puzzles trip them up. Limits and prices are counted in tokens. In English a token averages about 4 characters; code, other languages and emoji use more tokens per character. This tokenizer is a simplified stand-in; use your provider's token-counting endpoint for real numbers.</p>"),
    ),
    section("2 · Picking the next token",
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "Temperature", min: 0, max: 2, step: 0.1, value: T, fmt: (v) => (v === 0 ? "0 (greedy)" : v.toFixed(1)), onInput: (v) => { T = v; renderDist(); } }),
          slider({ label: "Top-p (nucleus)", min: 0.1, max: 1, step: 0.05, value: topP, fmt: (v) => v.toFixed(2), onInput: (v) => { topP = v; renderDist(); } }),
          button("Sample once", () => draw(1), "primary"),
          button("Sample 100×", () => draw(100)),
          button("Clear", () => { counts.clear(); histEl.replaceChildren(); sentence.replaceChildren(PROMPT, h("span.muted", " …")); }),
        ),
        h("div.stage-body", sentence, h("div.split", h("div", h("div.eyebrow", "Model's probabilities for the next token"), distEl), histEl)),
      ),
      predict({
        chapter: id,
        question: "You set temperature to 0. You ask the same question five times. What do you get?",
        options: ["Five different answers", "The most likely token every time, so (nearly) the same answer", "An error: temperature must be positive", "A random token every time"],
        answer: 1,
        explain: "<p>Temperature divides the model's scores before they become probabilities. Near 0 the top token takes almost all the probability (greedy decoding); high values flatten the distribution so unlikely tokens, like “bananas”, start to appear. Top-p cuts off the long tail: only the smallest set of tokens whose probabilities add up to p can be chosen. (Some newer models fix sampling settings server-side and steer behaviour through other parameters instead.)</p>",
      }),
    ),
    section("3 · The context window is a budget",
      prose("<p>The model has no memory between calls. Every request re-sends everything it should know: instructions, tool definitions, the whole conversation, any documents, plus room for the answer. That all has to fit in the <b>context window</b>, and you pay for the input tokens on every call.</p>"),
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Context window", options: [{ value: 32000, label: "32K" }, { value: 128000, label: "128K" }, { value: 200000, label: "200K" }, { value: 1000000, label: "1M" }], value: budget.window, onChange: (v) => { budget.window = v; renderBudget(); } }),
          bslider("system", "System prompt", 20000, 500), bslider("tools", "Tool definitions", 40000), bslider("history", "Conversation so far", 400000, 5000), bslider("docs", "Retrieved documents", 200000, 5000), bslider("output", "Answer reserve", 64000),
          slider({ label: "Input price", min: 0.1, max: 15, step: 0.1, value: budget.price, fmt: (v) => `$${v.toFixed(1)} / 1M tokens`, onInput: (v) => { budget.price = v; renderBudget(); } }),
        ),
        h("div.stage-body", budgetStats.el, budgetEl),
      ),
      dilemma("A support chat has gone on for 300 messages and is near the window limit.", [
        { name: "Truncate old messages", pros: ["Simple", "Cheap"], cons: ["Forgets early facts (the user's order number)"] },
        { name: "Summarise / compact old turns", pros: ["Keeps the important facts", "Bounded size"], cons: ["Summaries lose detail", "Extra model calls"] },
        { name: "Store facts outside, retrieve when needed", pros: ["Scales to any length"], cons: ["Retrieval can miss things", "More moving parts (that's RAG, next chapter)"] },
      ], "Real assistants combine all three, and use <b>prompt caching</b> so the unchanging start of the prompt (system prompt, tools, old turns) is billed at a fraction of the price on repeat calls."),
    ),
    section("In code",
      code({
        "Python (streaming)": `import anthropic

client = anthropic.Anthropic()          # reads ANTHROPIC_API_KEY

with client.messages.stream(
    model="claude-opus-5-5",
    max_tokens=2000,
    system="You are a concise system design tutor.",
    messages=[{"role": "user", "content": "Explain load balancing in 3 sentences."}],
) as stream:
    for text in stream.text_stream:     # tokens arrive as they are generated
        print(text, end="", flush=True)

final = stream.get_final_message()
print("\\n", final.usage.input_tokens, "in /", final.usage.output_tokens, "out")`,
        "Python (sampling by hand)": `import numpy as np

tokens = [" to", " by", " practice", " building", " bananas"]
logits = np.array([6.1, 5.6, 4.3, 4.0, -1.5])

def sample(logits, temperature=1.0, top_p=1.0, rng=np.random.default_rng()):
    if temperature == 0:
        return int(np.argmax(logits))
    p = np.exp((logits - logits.max()) / temperature)
    p /= p.sum()
    order = np.argsort(-p)
    keep = order[: np.searchsorted(np.cumsum(p[order]), top_p) + 1]   # nucleus
    q = np.zeros_like(p); q[keep] = p[keep]; q /= q.sum()
    return int(rng.choice(len(p), p=q))

print(tokens[sample(logits, temperature=0.7, top_p=0.9)])`,
      }),
    ),
  );
  renderTokens();
  renderDist();
  sentence.replaceChildren(PROMPT, h("span.muted", " …"));
  renderBudget();
}
