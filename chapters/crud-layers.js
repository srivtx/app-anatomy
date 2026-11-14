import { h, esc } from "../lib/core.js";
import { toggle, predict, code, dilemma, callout, section, prose, button } from "../lib/widgets.js";

// A real (in-memory) three-layer backend. Every call records a trace so the
// learner can watch one click travel down to SQL and back.
const USERS = [{ id: 1, name: "Ada" }, { id: 2, name: "Grace" }, { id: 3, name: "Linus" }];
const SEED = ["Write the onboarding email", "Fix the login redirect", "Review Grace's pull request", "Plan the Q3 roadmap", "Rotate the API keys", "Book the team offsite"];

class ValidationError extends Error { status = 422; }
class RuleError extends Error { status = 409; }
class NotFound extends Error { status = 404; }

function makeBackend(flags, trace) {
  let nextId = 1;
  const db = { tasks: SEED.map((title, i) => ({ id: nextId++, title, done: i === 1, assignee_id: (i % 3) + 1 })), users: USERS };
  const sql = (q, params = []) => trace.push({ layer: "Database", text: q + (params.length ? `   -- ${JSON.stringify(params)}` : ""), ms: 2 });

  // ---- Repository: the only layer that knows SQL ----
  const repo = {
    list() {
      if (flags.nPlusOne) {
        sql("SELECT id, title, done, assignee_id FROM tasks ORDER BY id");
        return db.tasks.map((t) => {
          sql("SELECT name FROM users WHERE id = ?", [t.assignee_id]);
          return { ...t, assignee: db.users.find((u) => u.id === t.assignee_id).name };
        });
      }
      sql("SELECT t.id, t.title, t.done, u.name AS assignee FROM tasks t JOIN users u ON u.id = t.assignee_id ORDER BY t.id");
      return db.tasks.map((t) => ({ ...t, assignee: db.users.find((u) => u.id === t.assignee_id).name }));
    },
    countOpen() { sql("SELECT count(*) FROM tasks WHERE done = false"); return db.tasks.filter((t) => !t.done).length; },
    insert(title, assignee) { sql("INSERT INTO tasks (title, done, assignee_id) VALUES (?, false, ?) RETURNING id", [title, assignee]); const t = { id: nextId++, title, done: false, assignee_id: assignee }; db.tasks.push(t); return t; },
    update(id, done) { sql("UPDATE tasks SET done = ? WHERE id = ?", [done, id]); const t = db.tasks.find((x) => x.id === id); if (!t) throw new NotFound("task not found"); t.done = done; return t; },
    remove(id) { sql("DELETE FROM tasks WHERE id = ?", [id]); db.tasks = db.tasks.filter((t) => t.id !== id); },
  };

  // ---- Service: business rules, no HTTP, no SQL ----
  const service = {
    list() { trace.push({ layer: "Service", text: "listTasks(): no rules for reading", ms: 0.2 }); return repo.list(); },
    create(title) {
      trace.push({ layer: "Service", text: "createTask(): rule: at most 8 open tasks per team", ms: 0.2 });
      if (repo.countOpen() >= 8) throw new RuleError("Too many open tasks. Finish one first.");
      const assignee = (title.length % 3) + 1;
      return repo.insert(title, assignee);
    },
    setDone(id, done) { trace.push({ layer: "Service", text: `setDone(${id}, ${done})`, ms: 0.2 }); return repo.update(id, done); },
    remove(id) { trace.push({ layer: "Service", text: `deleteTask(${id})`, ms: 0.2 }); repo.remove(id); },
  };

  // ---- Controller: HTTP in, HTTP out. Validates the shape of input. ----
  return async function http(method, path, body) {
    trace.push({ layer: "Network", text: `${method} ${path}${body ? " " + JSON.stringify(body) : ""}`, ms: 40 });
    trace.push({ layer: "Router", text: `matched ${method} ${path.replace(/\d+/, ":id")}`, ms: 0.1 });
    try {
      let status = 200, out;
      if (method === "GET" && path === "/tasks") {
        trace.push({ layer: "Controller", text: "parse query, call service", ms: 0.1 });
        out = service.list();
      } else if (method === "POST" && path === "/tasks") {
        const title = typeof body?.title === "string" ? body.title.trim() : "";
        if (!flags.skipValidation) {
          trace.push({ layer: "Controller", text: "validate body: title is 1–80 chars", ms: 0.1 });
          if (title.length < 1 || title.length > 80) throw new ValidationError("title must be 1–80 characters");
        } else trace.push({ layer: "Controller", text: "validation skipped!", ms: 0.1, bad: true });
        out = service.create(title);
        status = 201;
      } else if (method === "PATCH") {
        trace.push({ layer: "Controller", text: "validate body: done is a boolean", ms: 0.1 });
        out = service.setDone(+path.split("/")[2], !!body.done);
      } else if (method === "DELETE") {
        trace.push({ layer: "Controller", text: "check id, call service", ms: 0.1 });
        service.remove(+path.split("/")[2]);
        status = 204;
      }
      trace.push({ layer: "Network", text: `${status} ${status === 201 ? "Created" : status === 204 ? "No Content" : "OK"}${out && !Array.isArray(out) ? " " + JSON.stringify(out) : Array.isArray(out) ? ` [${out.length} tasks]` : ""}`, ms: 40 });
      return { status, body: out };
    } catch (e) {
      trace.push({ layer: "Network", text: `${e.status ?? 500} ${esc(e.message)}`, ms: 40, bad: true });
      return { status: e.status ?? 500, error: e.message };
    }
  };
}

const LAYER_COLOR = { Network: "var(--c4)", Router: "var(--c5)", Controller: "var(--c1)", Service: "var(--c6)", Database: "var(--c3)" };

export default function (root, { id }) {
  const flags = { nPlusOne: false, skipValidation: false };
  let trace = [];
  let http = makeBackend(flags, trace);
  const list = h("ul", { style: { listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: "6px" } });
  const input = h("input", { type: "text", placeholder: "New task", "aria-label": "New task title", style: { flex: 1, minWidth: 0, padding: "7px 10px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" } });
  const flash = h("div", { role: "status", style: { minHeight: "22px", fontSize: "13.5px" } });
  const traceEl = h("ol", { style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "4px", font: "12.5px/1.45 var(--mono)" } });
  const summary = h("div.row", { style: { fontSize: "13.5px" } });
  let timers = [];

  function showTrace(label) {
    timers.forEach(clearTimeout); timers = [];
    traceEl.replaceChildren();
    const queries = trace.filter((t) => t.layer === "Database").length;
    const total = trace.reduce((a, t) => a + t.ms, 0);
    summary.replaceChildren(h("b", label), h("span.pill", `${trace.length} steps`), h("span.pill" + (queries > 3 ? ".bad" : ".good"), `${queries} SQL ${queries === 1 ? "query" : "queries"}`), h("span.pill", `~${Math.round(total)} ms`));
    trace.forEach((t, i) => timers.push(setTimeout(() => {
      traceEl.append(h("li", { style: { display: "grid", gridTemplateColumns: "88px 1fr", gap: "8px", padding: "4px 8px", borderRadius: "6px", background: t.bad ? "var(--bad-bg)" : "var(--bg)", borderLeft: `3px solid ${LAYER_COLOR[t.layer]}` } },
        h("b", { style: { color: LAYER_COLOR[t.layer], fontWeight: 600 } }, t.layer), h("span", { style: { overflowWrap: "anywhere" } }, t.text)));
    }, Math.min(i, 30) * 70)));
  }

  async function call(label, method, path, body) {
    trace.length = 0;
    const res = await http(method, path, body);
    showTrace(label);
    if (res.error) flash.replaceChildren(h("span", { style: { color: "var(--bad)" } }, `${res.status}: ${res.error}`));
    else flash.replaceChildren();
    return res;
  }
  async function refresh(label = "Load the list") {
    const res = await call(label, "GET", "/tasks");
    list.replaceChildren(...res.body.map((t) =>
      h("li", { style: { display: "flex", gap: "8px", alignItems: "center", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" } },
        h("input", { type: "checkbox", checked: t.done || null, "aria-label": `Mark ${t.title} done`, onchange: async (e) => { await call(`Toggle task ${t.id}`, "PATCH", `/tasks/${t.id}`, { done: e.target.checked }); } }),
        h("span", { style: { flex: 1, minWidth: 0, textDecoration: t.done ? "line-through" : "none", color: t.title ? "inherit" : "var(--bad)" } }, t.title || "(empty title)"),
        h("span.pill", t.assignee),
        h("button.btn.small", { type: "button", "aria-label": `Delete ${t.title}`, onclick: async () => { await call(`Delete task ${t.id}`, "DELETE", `/tasks/${t.id}`); await reloadQuietly(); } }, "×"))));
  }
  async function reloadQuietly() { const saved = [...trace]; await refresh(); trace.length = 0; trace.push(...saved); showTrace(summary.firstChild?.textContent || ""); }
  async function add() {
    const res = await call("Create a task", "POST", "/tasks", { title: input.value });
    if (!res.error) { input.value = ""; await reloadQuietly(); }
  }
  input.addEventListener("keydown", (e) => e.key === "Enter" && add());

  root.append(
    section(null, prose(`<p>Almost every product, from a todo list to a bank, starts as <b>CRUD</b>: create, read, update, delete. The code is usually split into layers so each one has one job. Below is a real, tiny backend running in your browser. Use the app on the left and watch each request travel through the layers on the right.</p>`)),
    section("Click, then follow the request",
      h("div.stage",
        h("div.stage-controls",
          toggle({ label: "Naive repository (N+1 queries)", onChange: (v) => { flags.nPlusOne = v; refresh("Load the list"); } }),
          toggle({ label: "Skip input validation", onChange: (v) => { flags.skipValidation = v; } }),
          button("Reset data", () => { trace = []; http = makeBackend(flags, trace); refresh(); }),
        ),
        h("div.stage-body",
          h("div.split",
            h("div", h("div.eyebrow", "The app"), h("div.row", input, button("Add", add, "primary")), flash, list),
            h("div", h("div.eyebrow", "The request, layer by layer"), summary, h("div", { style: { marginTop: "8px", maxHeight: "420px", overflow: "auto" } }, traceEl)),
          ),
        ),
      ),
      callout("tip", "Try these", "<ul style='margin:0;padding-left:18px'><li>Add a task with an empty title. The controller rejects it with 422 before any SQL runs.</li><li>Turn on “skip validation” and add it again. Bad data is now in your database forever.</li><li>Add tasks until you have 8 open. The service enforces a business rule and answers 409.</li><li>Turn on the naive repository and count the queries.</li></ul>"),
      predict({
        chapter: id,
        question: "The list shows 50 tasks, each with its assignee's name. With the naive repository, how many SQL queries does one page load run?",
        options: ["1", "2", "51", "100"],
        answer: 2,
        explain: "<p>One query for the tasks, then one more per task for its assignee: 1 + N. At 2 ms per query that's 100 ms of pure database chatter, and it grows with your data. A <code>JOIN</code> (or an ORM's eager loading, like <code>select_related</code> or <code>include</code>) gets it back to one query. N+1 is the most common performance bug in CRUD apps.</p>",
      }),
    ),
    section("What each layer owns",
      h("div.tbl-wrap", h("table.t", h("thead", h("tr", h("th", "Layer"), h("th", "Owns"), h("th", "Never does"))), h("tbody", [
        ["Router", "Mapping method + path to a handler", "Business logic"],
        ["Controller", "HTTP: parse and validate input, pick status codes", "SQL, business rules"],
        ["Service", "Business rules and use cases (“max 8 open tasks”)", "Know about HTTP or SQL"],
        ["Repository", "Queries and persistence", "Decide what is allowed"],
        ["Database", "Durable storage, constraints, transactions", "Trust input blindly: add NOT NULL, CHECK and foreign keys too"],
      ].map(([a, b, c]) => h("tr", h("td", h("b", a)), h("td", b), h("td.muted", c)))))),
      prose("<p style='margin-top:12px'>Why bother? The service can be tested without a web server or database, the repository can switch from SQLite to Postgres, and a second entry point (a CLI, a queue worker, a GraphQL resolver) can reuse the same rules.</p>"),
      dilemma("Do you need all these layers on day one?", [
        { name: "Everything in the route handler", pros: ["Fastest to write", "Easy to read for tiny apps"], cons: ["Rules get duplicated across endpoints", "Hard to test without HTTP"] },
        { name: "Controller / service / repository", pros: ["Rules live in one place", "Each layer testable alone"], cons: ["More files and indirection", "Over-engineering for a weekend project"] },
      ], "Start simple, and extract a service the second time you copy a rule. Validation at the edge and constraints in the database are worth having from day one."),
    ),
    section("The same app in real code",
      code({
        "Python (FastAPI)": `# routes.py: controller
@router.post("/tasks", status_code=201)
def create_task(body: TaskIn, svc: TaskService = Depends()):   # TaskIn validates: 1–80 chars
    return svc.create(body.title)

# service.py: business rules
class TaskService:
    def __init__(self, repo: TaskRepo = Depends()):
        self.repo = repo
    def create(self, title: str):
        if self.repo.count_open() >= 8:
            raise HTTPException(409, "Too many open tasks")
        return self.repo.insert(title)

# repo.py: SQL lives here and only here
class TaskRepo:
    def list(self):
        return db.execute("""
            SELECT t.id, t.title, t.done, u.name AS assignee
            FROM tasks t JOIN users u ON u.id = t.assignee_id     -- one query, not N+1
        """).fetchall()`,
        "TypeScript (Express)": `// controller
app.post("/tasks", async (req, res) => {
  const parsed = TaskIn.safeParse(req.body);            // zod schema
  if (!parsed.success) return res.status(422).json(parsed.error.flatten());
  try {
    res.status(201).json(await tasks.create(parsed.data.title));
  } catch (e) {
    if (e instanceof RuleError) return res.status(409).json({ error: e.message });
    throw e;
  }
});

// repository
export const taskRepo = {
  list: () => sql\`SELECT t.*, u.name AS assignee FROM tasks t JOIN users u ON u.id = t.assignee_id\`,
};`,
        "SQL schema": `CREATE TABLE users (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE tasks (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),  -- last line of defence
  done        BOOLEAN NOT NULL DEFAULT false,
  assignee_id INT NOT NULL REFERENCES users(id)
);
CREATE INDEX tasks_assignee_idx ON tasks(assignee_id);`,
      }),
    ),
  );
  refresh();
}
