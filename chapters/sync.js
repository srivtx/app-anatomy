import { h } from "../lib/core.js";
import { segmented, toggle, predict, code, dilemma, callout, section, prose, button } from "../lib/widgets.js";

// Two replicas of a shopping list. Each can be edited offline.
// "lww": the whole document carries one timestamp; newest document wins.
// "crdt": items are an observed-remove set (OR-Set), the title is a
//         last-writer-wins register. Merging is a union, so nothing is lost.
let clock = 0;
const tick = () => ++clock; // a shared logical clock (stands in for hybrid timestamps)
let tagN = 0;

function freshReplica(name) {
  return {
    name,
    online: true,
    lww: { title: "Weekend shopping", items: ["bread", "coffee"], ts: 0, base: ["bread", "coffee"], baseTitle: "Weekend shopping" },
    crdt: { title: { v: "Weekend shopping", ts: 0, by: "" }, adds: new Map([["t0", "bread"], ["t1", "coffee"]]), removes: new Set() },
  };
}

const view = (rep, mode) =>
  mode === "lww" ? { title: rep.lww.title, items: rep.lww.items } : { title: rep.crdt.title.v, items: [...rep.crdt.adds].filter(([tag]) => !rep.crdt.removes.has(tag)).map(([, v]) => v) };

function edit(rep, mode, op) {
  if (mode === "lww") {
    const d = rep.lww;
    if (op.type === "add") d.items = [...d.items, op.value];
    if (op.type === "remove") d.items = d.items.filter((x, i) => i !== d.items.indexOf(op.value));
    if (op.type === "title") d.title = op.value;
    d.ts = tick();
  } else {
    const d = rep.crdt;
    if (op.type === "add") d.adds.set(`${rep.name}-${++tagN}`, op.value);
    if (op.type === "remove") for (const [tag, v] of d.adds) if (v === op.value && !d.removes.has(tag)) d.removes.add(tag); // remove what this replica has *seen*
    if (op.type === "title") d.title = { v: op.value, ts: tick(), by: rep.name };
  }
}

function merge(a, b, mode) {
  if (mode === "lww") {
    const winner = a.lww.ts >= b.lww.ts ? a : b, loser = winner === a ? b : a;
    // the loser's own edits since the last sync are what gets thrown away
    const base = loser.lww.base;
    const added = loser.lww.items.filter((x) => !base.includes(x) && !winner.lww.items.includes(x));
    const removed = base.filter((x) => !loser.lww.items.includes(x) && winner.lww.items.includes(x));
    const lost = [...added.map((x) => `added “${x}”`), ...removed.map((x) => `removed “${x}”`)];
    const lostTitle = loser.lww.title !== loser.lww.baseTitle && loser.lww.title !== winner.lww.title ? loser.lww.title : null;
    const synced = { ...winner.lww, items: [...winner.lww.items], base: [...winner.lww.items], baseTitle: winner.lww.title };
    a.lww = synced; b.lww = { ...synced, items: [...synced.items], base: [...synced.base] };
    return { lost: [...lost, ...(lostTitle ? [`renamed to “${lostTitle}”`] : [])], note: `${winner.name}'s copy was newer, so it replaced ${loser.name}'s entirely.` };
  }
  const adds = new Map([...a.crdt.adds, ...b.crdt.adds]);
  const removes = new Set([...a.crdt.removes, ...b.crdt.removes]);
  const ta = a.crdt.title, tb = b.crdt.title;
  const title = ta.ts > tb.ts || (ta.ts === tb.ts && ta.by > tb.by) ? ta : tb;
  const losing = title === ta ? tb : ta;
  for (const r of [a, b]) r.crdt = { title: { ...title }, adds: new Map(adds), removes: new Set(removes) };
  return { lost: [], note: `Items merged as a union of adds minus removes.${losing.v !== title.v ? ` Both renamed the list; the later rename (“${title.v}”) wins, by design.` : ""}` };
}

export default function (root, { id }) {
  let mode = "lww";
  let A = freshReplica("Phone"), B = freshReplica("Laptop");
  const out = h("div");
  const panels = h("div.split");

  function syncIfPossible(force) {
    if (!(A.online && B.online) && !force) return;
    const res = merge(A, B, mode);
    out.replaceChildren(res.lost.length
      ? h("div.callout.warn", h("b", `Synced, and lost ${res.lost.length} change${res.lost.length > 1 ? "s" : ""}: ${res.lost.join(", ")}`), h("div", res.note))
      : h("div.callout.tip", h("b", "Synced, nothing lost"), h("div", res.note)));
  }
  function panel(rep) {
    const v = view(rep, mode);
    const input = h("input", { type: "text", placeholder: "Add item", "aria-label": `Add item on ${rep.name}`, style: { flex: 1, minWidth: 0, padding: "6px 10px", border: "1px solid var(--line)", borderRadius: "8px", background: "var(--surface)" } });
    const add = () => { if (input.value.trim()) { edit(rep, mode, { type: "add", value: input.value.trim() }); syncIfPossible(); render(); } };
    input.addEventListener("keydown", (e) => e.key === "Enter" && add());
    const title = h("input", { type: "text", value: v.title, "aria-label": `List title on ${rep.name}`, style: { width: "100%", font: "600 16px var(--display)", border: "1px dashed var(--line)", borderRadius: "8px", padding: "4px 8px", background: "transparent" } });
    title.addEventListener("change", () => { edit(rep, mode, { type: "title", value: title.value }); syncIfPossible(); render(); });
    return h("div", { style: { border: "1px solid var(--line)", borderRadius: "14px", padding: "12px", background: "var(--surface)", display: "grid", gap: "8px", minWidth: 0 } },
      h("div.row", { style: { justifyContent: "space-between" } }, h("b", rep.name), toggle({ label: rep.online ? "online" : "offline", checked: rep.online, onChange: (on) => { rep.online = on; if (on) syncIfPossible(); render(); } })),
      title,
      h("ul", { style: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "4px" } }, v.items.map((it) => h("li.row", { style: { justifyContent: "space-between", padding: "4px 8px", background: "var(--bg)", borderRadius: "8px" } }, it, h("button.btn.small", { type: "button", "aria-label": `Remove ${it}`, onclick: () => { edit(rep, mode, { type: "remove", value: it }); syncIfPossible(); render(); } }, "×")))),
      h("div.row", input, button("Add", add, "primary")));
  }
  function render() { panels.replaceChildren(panel(A), panel(B)); }
  function reset() { A = freshReplica("Phone"); B = freshReplica("Laptop"); out.replaceChildren(); render(); }
  function scenario() {
    reset();
    A.online = B.online = false;
    edit(A, mode, { type: "add", value: "milk" });
    edit(B, mode, { type: "add", value: "eggs" });
    edit(B, mode, { type: "remove", value: "coffee" });
    out.replaceChildren(h("div.callout", h("b", "Both devices are offline."), h("div", "The phone added milk. The laptop added eggs and removed coffee. Now switch both back online.")));
    render();
  }

  root.append(
    section(null, prose(`<p>Notes apps, to-do lists, Figma, Google Docs and Linear all let you keep working with a bad connection, or with someone else editing at the same time. The hard part isn't storing changes offline. It's <b>merging</b> two histories that grew apart without losing anyone's work.</p>`)),
    section("Two devices, one list",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "Merge strategy", options: [{ value: "lww", label: "Last write wins (whole list)" }, { value: "crdt", label: "CRDT" }], value: mode, onChange: (v) => { mode = v; reset(); } }),
          button("Set up the offline scenario", scenario, "primary"),
          button("Reset", reset),
        ),
        h("div.stage-body", panels, out),
      ),
      callout("tip", "Try it", "<p>Press “Set up the offline scenario”, turn both devices online, and read the result. Switch to CRDT and do it again. Then try your own conflicts: rename the list on both devices while offline.</p>"),
      predict({
        chapter: id,
        question: "Offline, the phone adds “milk” and the laptop adds “eggs”. They reconnect, and the list is synced by keeping whichever copy was saved last. What's on the list?",
        options: ["Both milk and eggs", "Only the item from the device that saved last", "Neither", "It depends on which device has better signal"],
        answer: 1,
        explain: "<p>Whole-document last-write-wins treats the list as one value, so the newer copy replaces the older one and the other device's edit silently disappears. A CRDT stores the list as operations that merge mathematically: adds and removes from both sides survive, in any order, on every device.</p>",
      }),
    ),
    section("How the CRDT version works",
      prose(`<ul>
<li>Every added item gets a unique tag (<code>Phone-1</code>, <code>Laptop-2</code>), so “milk added on the phone” and “milk added on the laptop” are different facts.</li>
<li>Removing an item records the tags you could see when you removed it. A concurrent add elsewhere has a new tag, so it survives. This is an <b>observed-remove set</b>.</li>
<li>Merging is a set union of adds and of removes. Union is commutative, associative and idempotent, so replicas can sync in any order, any number of times, and still end up identical.</li>
<li>Single values like the title use a <b>last-writer-wins register</b>: a real conflict, resolved by timestamp. CRDTs don't make conflicts disappear; they make the resolution automatic and the same everywhere.</li>
</ul>`),
      dilemma("You're adding offline support to a notes app.", [
        { name: "Server is the source of truth, reject stale writes", pros: ["Simple to reason about", "Easy to add permissions and validation"], cons: ["Offline edits fail or need manual conflict screens"] },
        { name: "Local-first with CRDTs (Yjs, Automerge)", pros: ["Instant UI, works offline, real-time collaboration for free"], cons: ["Documents grow with history", "Server-side validation and permissions are harder"] },
      ], "Text editors and whiteboards lean on CRDTs. Business records (orders, payments, inventory) stay server-authoritative: you can't merge two people spending the same money."),
    ),
    section("In code",
      code({
        "Yjs (JavaScript)": `import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";

const doc = new Y.Doc();
new IndexeddbPersistence("shopping-list", doc);                  // offline storage
new WebsocketProvider("wss://sync.example.com", "list-42", doc);   // syncs when online

const items = doc.getArray("items");
const meta = doc.getMap("meta");

items.push(["milk"]);                    // works offline, merges later
meta.set("title", "Weekend shopping");
items.observe(() => render(items.toArray()));`,
        "Python (OR-Set)": `import uuid

class ORSet:
    def __init__(self):
        self.adds: dict[str, str] = {}      # tag -> value
        self.removes: set[str] = set()

    def add(self, value):
        self.adds[uuid.uuid4().hex] = value

    def remove(self, value):              # remove only what we've observed
        self.removes |= {t for t, v in self.adds.items() if v == value}

    def merge(self, other: "ORSet"):
        self.adds |= other.adds
        self.removes |= other.removes

    def values(self):
        return sorted({v for t, v in self.adds.items() if t not in self.removes})`,
      }),
    ),
  );
  render();
}
