import { h, esc } from "../lib/core.js";
import { slider, segmented, stats, predict, code, dilemma, callout, section, prose, button } from "../lib/widgets.js";

// A small, made-up company handbook. Retrieval runs on it entirely in the browser.
const DOCS = [
  { title: "Vacation policy", text: "Full-time employees receive 25 vacation days per year, plus public holidays. Vacation days accrue monthly from your start date, so in your first month you have about two days available. Up to 5 unused vacation days carry over into the next year. Request vacation in the HR portal at least two weeks ahead; your manager approves it." },
  { title: "Sick leave", text: "If you are ill, tell your manager before 10am and record a sick day in the HR portal. There is no fixed limit on sick days. For absences longer than three days we ask for a doctor's note. Sick days never reduce your vacation balance." },
  { title: "Expenses", text: "You can claim expenses for work travel, conference tickets, books and courses. Submit receipts in the finance app within 30 days. Conference tickets up to 800 euros are pre-approved; anything above needs your manager's approval first. Reimbursement arrives with the next monthly salary payment." },
  { title: "Equipment", text: "Every engineer gets a laptop of their choice from the approved list, a monitor and a 500 euro home office budget. Hardware is replaced every three years. Lost or broken equipment should be reported to IT within 24 hours so devices can be locked remotely." },
  { title: "On-call", text: "Engineers join the on-call rotation after three months. Each shift lasts one week. When production is down, the pager alerts the primary on-call engineer, who has 15 minutes to acknowledge. If they do not, the alert escalates to the secondary and then to the engineering manager. On-call weeks are compensated with one extra day off." },
  { title: "Deploys", text: "We deploy to production many times a day through the CI pipeline. Every change needs one approving code review and green tests. Deploys are frozen on Friday after 3pm and during company holidays. Use feature flags for risky changes so they can be turned off without a rollback." },
  { title: "Security", text: "Use the password manager for every work account and enable two-factor authentication. Never paste customer data into external tools. Report phishing emails with the report button in your mail client. Production database access requires a ticket and expires after eight hours." },
  { title: "Learning budget", text: "Each employee has a yearly learning budget of 1,000 euros for courses, books and certifications. Unused budget does not carry over. You can also spend up to five working days per year on learning, such as attending workshops." },
];

// Simulated "semantic" embedding: map synonyms onto shared concepts.
// Real embedding models learn this from data; this table only imitates the effect.
const SYNONYMS = { "time off": "vacation", "pto": "vacation", "leave": "vacation", "holiday": "vacation", "days off": "vacation", "annual": "vacation", "reimbursed": "reimbursement", "refund": "reimbursement", "money back": "reimbursement", "pay back": "reimbursement", "claim": "expenses", "computer": "laptop", "macbook": "laptop", "pc": "laptop", "outage": "production down", "incident": "production down", "paged": "pager", "release": "deploy", "ship": "deploy", "push to prod": "deploy", "training": "learning", "course": "courses", "ill": "sick", "unwell": "sick", "conference": "conference", "first month": "first month start date" };
const STOP = new Set("a an the of to in and or for is are be you your we our i it on at with as by can do does how what when who much many my me get any per have has from up if this that than there their they not".split(" "));

const words = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => w.replace(/(ies)$/, "y").replace(/s$/, ""));
function expand(text) {
  let t = " " + text.toLowerCase() + " ";
  for (const [k, v] of Object.entries(SYNONYMS)) if (t.includes(" " + k + " ") || t.includes(" " + k + "?") || t.includes(" " + k + ",")) t += " " + v;
  return t;
}

function chunk(size, overlap) {
  const out = [];
  DOCS.forEach((d, di) => {
    const w = d.text.split(" ");
    for (let i = 0; i < w.length; i += Math.max(1, size - overlap)) {
      out.push({ doc: di, title: d.title, text: w.slice(i, i + size).join(" ") });
      if (i + size >= w.length) break;
    }
  });
  return out;
}

function index(chunks, semantic) {
  const tf = chunks.map((c) => { const m = new Map(); for (const w of words(semantic ? expand(`${c.title} ${c.text}`) : `${c.title} ${c.text}`)) m.set(w, (m.get(w) || 0) + 1); return m; });
  const df = new Map();
  for (const m of tf) for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w) => Math.log((chunks.length + 1) / ((df.get(w) || 0) + 1)) + 1;
  const vec = (m) => { const v = new Map(); let n = 0; for (const [w, c] of m) { const x = (1 + Math.log(c)) * idf(w); v.set(w, x); n += x * x; } return { v, n: Math.sqrt(n) || 1 }; };
  const vecs = tf.map(vec);
  return {
    search(q, k) {
      const m = new Map(); for (const w of words(semantic ? expand(q) : q)) m.set(w, (m.get(w) || 0) + 1);
      const qv = vec(m);
      return vecs.map((dv, i) => { let dot = 0; for (const [w, x] of qv.v) dot += x * (dv.v.get(w) || 0); return { i, score: dot / (qv.n * dv.n), terms: [...qv.v.keys()].filter((w) => dv.v.has(w)) }; })
        .sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}

const QUERIES = ["How many vacation days do I get?", "Can I take time off in my first month?", "Who gets paged when there's an outage at night?", "How do I get my money back for a conference?", "What is the CEO's salary?"];

export default function (root, { id }) {
  const o = { size: 40, overlap: 10, k: 3, semantic: false, minScore: 0.12, q: QUERIES[1] };
  const input = h("input", { type: "text", value: o.q, "aria-label": "Question", style: { flex: 1, minWidth: 0, padding: "8px 12px", border: "1px solid var(--line)", borderRadius: "10px", background: "var(--surface)", font: "15px var(--body)" } });
  const results = h("div", { style: { display: "grid", gap: "8px" } }), prompt = h("pre.log", { style: { maxHeight: "320px" } });
  const st = stats([{ label: "Chunks in the index" }, { label: "Retrieved" }, { label: "Best match score" }, { label: "Prompt size (≈ tokens)" }]);

  function run() {
    o.q = input.value;
    const chunks = chunk(o.size, o.overlap);
    const hits = index(chunks, o.semantic).search(o.q, o.k);
    const kept = hits.filter((x) => x.score >= o.minScore);
    st.set(0, String(chunks.length));
    st.set(1, `${kept.length} of top ${o.k}`);
    st.set(2, hits[0] ? hits[0].score.toFixed(2) : "–", hits[0]?.score >= 0.25 ? "good" : hits[0]?.score < o.minScore ? "bad" : "warn");
    results.replaceChildren(...hits.map((x, n) => {
      const c = chunks[x.i];
      let txt = esc(c.text);
      for (const t of x.terms) txt = txt.replace(new RegExp(`\\b(${t}[a-z]*)`, "gi"), "<mark>$1</mark>");
      const ok = x.score >= o.minScore;
      return h("div", { style: { border: "1px solid var(--line)", borderLeft: `4px solid ${ok ? "var(--accent)" : "var(--line)"}`, borderRadius: "10px", padding: "8px 12px", background: "var(--surface)", opacity: ok ? 1 : 0.5 } },
        h("div.row", { style: { justifyContent: "space-between" } }, h("b", `[${n + 1}] ${c.title}`), h("span.pill" + (ok ? ".acc" : ""), `score ${x.score.toFixed(2)}${ok ? "" : " · below threshold"}`)),
        h("div", { style: { fontSize: "14px", marginTop: "4px" }, html: txt }));
    }));
    const ctx = kept.map((x, n) => `[${n + 1}] (${chunks[x.i].title}) ${chunks[x.i].text}`).join("\n\n");
    const full = `SYSTEM: Answer the employee's question using only the context below. Cite sources like [1]. If the context doesn't contain the answer, say you don't know and suggest asking HR.\n\nCONTEXT:\n${ctx || "(nothing relevant was found)"}\n\nQUESTION: ${o.q}`;
    prompt.textContent = full;
    st.set(3, String(Math.round(full.length / 4)));
  }
  input.addEventListener("input", run);

  root.append(
    section(null, prose(`<p>A model only knows what was in its training data, plus whatever you put in the prompt. <b>Retrieval-augmented generation</b> (RAG) fetches the few passages relevant to a question from your own documents and puts them in the prompt, so the model answers from <i>your</i> facts and can cite them. The steps: split documents into <b>chunks</b>, turn each chunk into a <b>vector</b>, find the vectors closest to the question's vector, and assemble a prompt.</p>`)),
    section("Ask the company handbook",
      h("div.stage",
        h("div.stage-controls",
          slider({ label: "Chunk size", min: 15, max: 80, step: 5, value: o.size, fmt: (v) => `${v} words`, onInput: (v) => { o.size = v; run(); } }),
          slider({ label: "Overlap", min: 0, max: 30, step: 5, value: o.overlap, fmt: (v) => `${v} words`, onInput: (v) => { o.overlap = v; run(); } }),
          slider({ label: "Top-k", min: 1, max: 6, value: o.k, onInput: (v) => { o.k = v; run(); } }),
          slider({ label: "Minimum score", min: 0, max: 0.4, step: 0.02, value: o.minScore, fmt: (v) => v.toFixed(2), onInput: (v) => { o.minScore = v; run(); } }),
          segmented({ label: "Vectors", options: [{ value: false, label: "Keyword (TF-IDF)" }, { value: true, label: "Semantic (simulated)" }], value: o.semantic, onChange: (v) => { o.semantic = v; run(); } }),
        ),
        h("div.stage-body",
          h("div.row", input),
          h("div.row", ...QUERIES.map((q) => h("button.btn.small", { type: "button", onclick: () => { input.value = q; run(); } }, q))),
          st.el,
          h("div.split", h("div", h("div.eyebrow", "Retrieved chunks"), results), h("div", h("div.eyebrow", "The prompt the model actually receives"), prompt)),
        ),
      ),
      callout("tip", "Things to try", "<ul style='margin:0;padding-left:18px'><li>“Can I take time off in my first month?” with keyword vectors: the handbook says <i>vacation</i>, not <i>time off</i>, so the right passage only scrapes in through “first month”, and “off” drags in irrelevant chunks. Switch to semantic and compare the scores.</li><li>Ask about the CEO's salary. Nothing scores well, so the threshold keeps junk out of the prompt and the model can say it doesn't know.</li><li>Shrink chunks to 15 words: answers get cut in half. Grow them to 80: each chunk drags in unrelated text.</li></ul>"),
      predict({
        chapter: id,
        question: "Keyword search can't connect “time off” to a handbook that only says “vacation”. What fixes that in real systems?",
        options: ["A bigger LLM", "Embedding models that map text with similar meaning to nearby vectors", "Longer chunks", "Raising the temperature"],
        answer: 1,
        explain: "<p>Embedding models are trained so that “time off” and “vacation days” land close together in vector space, which keyword matching can't do. In practice most teams use <b>hybrid search</b> (keywords for exact terms like error codes and names, embeddings for meaning), then a <b>re-ranker</b> model to order the final few.</p>",
      }),
    ),
    section("Where RAG goes wrong",
      prose(`<ul>
<li><b>Bad chunks</b>: a table split in half, a heading separated from its paragraph. Chunk along document structure, and keep the title with each chunk (as above).</li>
<li><b>Retrieval misses</b>: the right passage exists but isn't in the top-k. Measure retrieval separately from answers, with a set of questions and their known source passages.</li>
<li><b>Irrelevant context</b>: weak matches confuse the model. Use a score threshold and tell the model it may say “I don't know”.</li>
<li><b>Stale index</b>: the document changed, the vectors didn't. Re-embed on update.</li>
<li><b>Permissions</b>: retrieval must respect who is asking. Filter by access <i>before</i> ranking, never after the model has seen the text.</li>
</ul>`),
      dilemma("Your documents total 300,000 tokens and the model's window is 1,000,000. Do you still need RAG?", [
        { name: "Put everything in the prompt", pros: ["No retrieval to get wrong", "Simple"], cons: ["Every question pays for 300K input tokens", "Slower responses", "Accuracy drops when the answer is buried in lots of text"] },
        { name: "Retrieve the top passages", pros: ["Cheap and fast per question", "Citations are precise"], cons: ["Retrieval can miss the answer", "An indexing pipeline to maintain"] },
      ], "Long context with prompt caching is great for a few large, stable documents. RAG wins as the corpus grows, changes often, or needs per-user permissions."),
    ),
    section("In code",
      code({
        "Python": `import numpy as np, anthropic
from sentence_transformers import SentenceTransformer

embedder = SentenceTransformer("all-MiniLM-L6-v2")

# 1. index: chunk + embed once
chunks = [c for doc in docs for c in split_by_paragraph(doc)]
vectors = embedder.encode([c.text for c in chunks], normalize_embeddings=True)

# 2. retrieve: cosine similarity = dot product of normalised vectors
def retrieve(question, k=4, min_score=0.3):
    q = embedder.encode([question], normalize_embeddings=True)[0]
    scores = vectors @ q
    best = np.argsort(-scores)[:k]
    return [(chunks[i], float(scores[i])) for i in best if scores[i] >= min_score]

# 3. generate with the retrieved context
def answer(question):
    context = "\\n\\n".join(f"[{n}] {c.text}" for n, (c, _) in enumerate(retrieve(question), 1))
    msg = anthropic.Anthropic().messages.create(
        model="claude-opus-5-5", max_tokens=1000,
        system="Answer only from the context. Cite like [1]. If it isn't there, say you don't know.",
        messages=[{"role": "user", "content": f"Context:\\n{context}\\n\\nQuestion: {question}"}],
    )
    return msg.content[0].text`,
        "PostgreSQL + pgvector": `CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE chunks (
  id        BIGSERIAL PRIMARY KEY,
  doc_id    BIGINT NOT NULL,
  team_id   BIGINT NOT NULL,          -- for permission filtering
  body      TEXT NOT NULL,
  embedding vector(384) NOT NULL
);
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);

-- <=> is cosine distance; filter by permission first
SELECT body, 1 - (embedding <=> $1) AS score
FROM chunks
WHERE team_id = ANY($2)
ORDER BY embedding <=> $1
LIMIT 5;`,
      }, "The Python answer() reads content[0] for brevity; production code should check stop_reason first."),
    ),
  );
  run();
}
