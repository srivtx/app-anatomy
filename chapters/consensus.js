import { h, loop, rng } from "../lib/core.js";
import { toggle, stats, predict, code, callout, section, prose, button, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// A small but honest Raft: randomised election timeouts, RequestVote with the
// log up-to-date check, heartbeats that carry the log, and commit only once a
// majority holds an entry from the leader's own term. Simplification: a
// follower copies the leader's whole log instead of doing the per-index
// consistency check, which gives the same logs for this demo.
const N = 5, SPEED = 0.22, HEARTBEAT = 50;

export default function (root, { id }) {
  let r, t, nodes, msgs, elections, randomTimeouts = true, groups = null;
  const fc = flowCanvas({ width: 720, height: 320, label: "Five Raft servers electing a leader and replicating a log" });
  const st = stats([{ label: "Leader" }, { label: "Term" }, { label: "Committed entries" }, { label: "Times someone stood for election" }]);
  const timeout = () => (randomTimeouts ? 150 + r() * 150 : 200);
  const majority = Math.floor(N / 2) + 1;
  const canTalk = (a, b) => nodes[a].alive && nodes[b].alive && (!groups || groups[a] === groups[b]);

  function reset() {
    r = rng(3); t = 0; msgs = []; elections = 0;
    nodes = Array.from({ length: N }, () => ({ state: "follower", term: 0, votedFor: null, log: [], commit: 0, deadline: timeout(), alive: true, votes: 0, lastBeat: 0, match: [] }));
  }
  const lastTerm = (n) => (n.log.length ? n.log[n.log.length - 1].term : 0);
  function send(from, to, type, body) {
    if (!canTalk(from, to)) { msgs.push({ from, to, type, body, t0: t, t1: t + 12 + r() * 10, lost: true }); return; }
    msgs.push({ from, to, type, body, t0: t, t1: t + 12 + r() * 14 });
  }
  function stepDown(n, term) { n.term = term; n.state = "follower"; n.votedFor = null; n.deadline = t + timeout(); }

  function startElection(i) {
    const n = nodes[i];
    n.state = "candidate"; n.term++; n.votedFor = i; n.votes = 1; n.deadline = t + timeout(); elections++;
    for (let j = 0; j < N; j++) if (j !== i) send(i, j, "vote?", { term: n.term, lastIdx: n.log.length, lastTerm: lastTerm(n) });
  }
  function heartbeat(i) {
    const n = nodes[i]; n.lastBeat = t;
    for (let j = 0; j < N; j++) if (j !== i) send(i, j, "append", { term: n.term, log: n.log.map((e) => ({ ...e })), commit: n.commit });
  }
  function deliver(m) {
    const n = nodes[m.to], b = m.body;
    if (!n.alive) return;
    if (b.term > n.term) stepDown(n, b.term);
    if (m.type === "vote?") {
      const upToDate = b.lastTerm > lastTerm(n) || (b.lastTerm === lastTerm(n) && b.lastIdx >= n.log.length);
      const grant = b.term === n.term && (n.votedFor === null || n.votedFor === m.from) && upToDate;
      if (grant) { n.votedFor = m.from; n.deadline = t + timeout(); }
      send(m.to, m.from, grant ? "yes" : "no", { term: n.term });
    } else if (m.type === "yes") {
      if (n.state === "candidate" && b.term === n.term && ++n.votes >= majority) {
        n.state = "leader"; n.match = nodes.map(() => 0); n.match[m.to] = n.log.length; heartbeat(m.to);
      }
    } else if (m.type === "append") {
      if (b.term < n.term) { send(m.to, m.from, "ack", { term: n.term, ok: false }); return; }
      n.state = "follower"; n.deadline = t + timeout();
      n.log = b.log; n.commit = Math.min(b.commit, n.log.length);
      send(m.to, m.from, "ack", { term: n.term, ok: true, match: n.log.length });
    } else if (m.type === "ack") {
      if (n.state !== "leader" || !b.ok) return;
      n.match[m.from] = b.match; n.match[m.to] = n.log.length;
      for (let k = n.log.length; k > n.commit; k--) {
        if (n.log[k - 1].term !== n.term) break;      // only commit entries from my own term by counting
        if (n.match.filter((x) => x >= k).length >= majority) { n.commit = k; break; }
      }
    }
  }
  function tick(dt) {
    t += dt;
    const due = msgs.filter((m) => m.t1 <= t);
    msgs = msgs.filter((m) => m.t1 > t);
    for (const m of due) if (!m.lost) deliver(m);
    nodes.forEach((n, i) => {
      if (!n.alive) return;
      if (n.state === "leader") { if (t - n.lastBeat >= HEARTBEAT) heartbeat(i); }
      else if (t >= n.deadline) startElection(i);
    });
  }

  const leaders = () => nodes.map((n, i) => [n, i]).filter(([n]) => n.alive && n.state === "leader");
  function clientWrite() { for (const [n] of leaders()) n.log.push({ term: n.term, k: Math.round(t) }); }
  function crashLeader() {
    const L = leaders().sort((a, b) => b[0].term - a[0].term)[0];
    if (L) { L[0].alive = false; L[0].state = "follower"; }
  }
  function revive() {
    groups = null; partTg.value = false;
    nodes.forEach((n) => { if (!n.alive) { n.alive = true; n.deadline = t + timeout(); } });
  }

  function refresh() {
    const L = leaders().sort((a, b) => b[0].term - a[0].term);
    st.set(0, L.length ? L.map(([, i]) => `S${i + 1}`).join(" and ") : "none", L.length === 1 ? "good" : L.length ? "warn" : "bad");
    st.set(1, String(Math.max(...nodes.map((n) => n.term))));
    st.set(2, String(Math.max(...nodes.map((n) => n.commit))));
    st.set(3, String(elections), elections > 6 ? "warn" : "");
  }

  function draw() {
    const c = fc.colors; fc.clear();
    const cx = 175, cy = 158, R = 112, pos = (i) => [cx + Math.cos((i / N) * 2 * Math.PI - Math.PI / 2) * R, cy + Math.sin((i / N) * 2 * Math.PI - Math.PI / 2) * R];
    if (groups) fc.line(90, 30, 340, 200, { color: c.bad, dash: [6, 6], lw: 2 });
    for (const m of msgs) {
      const [x0, y0] = pos(m.from), [x1, y1] = pos(m.to), p = Math.min(1, (t - m.t0) / (m.t1 - m.t0));
      const col = { "vote?": c.warn, yes: c.c5, no: c["ink-3"], append: c.c1, ack: c.c1 }[m.type];
      if (m.lost && p > 0.5) continue;
      fc.dot(x0 + (x1 - x0) * p, y0 + (y1 - y0) * p, m.type === "ack" || m.type === "no" ? 2.5 : 4, col);
    }
    nodes.forEach((n, i) => {
      const [x, y] = pos(i), ctx = fc.ctx;
      const fill = !n.alive ? c.sunken : n.state === "leader" ? c.good : n.state === "candidate" ? c.warn : c.surface;
      ctx.beginPath(); ctx.arc(x, y, 27, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = n.alive ? c.line : c.bad; ctx.stroke();
      if (n.alive && n.state !== "leader") {      // election timer ring
        const left = Math.max(0, Math.min(1, (n.deadline - t) / 300));
        ctx.beginPath(); ctx.arc(x, y, 31, -Math.PI / 2, -Math.PI / 2 + left * 2 * Math.PI); ctx.strokeStyle = c.accent; ctx.lineWidth = 2.5; ctx.stroke();
      }
      const onFill = /^#[0-3]/.test(c.bg) ? c.bg : "#fff";
      const ink = n.alive && n.state !== "follower" ? onFill : n.alive ? c.ink : c["ink-3"];
      fc.text(`S${i + 1}`, x, y - 6, { align: "center", size: 13, color: ink });
      fc.text(n.alive ? `term ${n.term}` : "crashed", x, y + 9, { align: "center", size: 9.5, weight: 500, mono: true, color: ink });
    });
    // logs
    const X = 365;
    fc.text("Logs (filled = committed; colour = term it was written in)", X, 26, { size: 11.5 });
    nodes.forEach((n, i) => {
      const y = 50 + i * 46;
      fc.text(`S${i + 1}`, X, y + 8, { size: 11, color: n.alive ? c.ink : c["ink-3"] });
      const show = n.log.slice(-18), off = n.log.length - show.length;
      show.forEach((e, k) => {
        const col = c[`c${(e.term % 6) + 1}`], done = off + k < n.commit;
        fc.box(X + 28 + k * 18, y, 14, 16, { fill: done ? col : c.surface, stroke: col, lw: 1.5, r: 3 });
      });
      if (!n.log.length) fc.text("empty", X + 28, y + 8, { size: 10, weight: 500, color: c["ink-3"] });
    });
    [["vote request", c.warn], ["vote granted", c.c5], ["heartbeat / append", c.c1]].forEach(([l, col], k) => {
      fc.dot(X + 6 + k * 118, 300, 4, col); fc.text(l, X + 14 + k * 118, 300, { size: 10, weight: 500, color: c["ink-3"] });
    });
  }

  let acc = 0;
  const lp = loop((dt) => {
    const ms = dt * 1000 * SPEED;
    for (let k = 0; k < 4; k++) tick(ms / 4);
    draw();
    acc += dt; if (acc > 0.2) { acc = 0; refresh(); }
  }, fc.el);

  const partTg = toggle({ label: "Partition {S1,S2} | {S3,S4,S5}", onChange: (v) => { groups = v ? [0, 0, 1, 1, 1] : null; } });
  root.append(
    section(null, prose(`<p>Replicas need to agree on <b>one</b> order of writes, even while machines crash and networks split. That's <b>consensus</b>, and the algorithm most systems use today is <b>Raft</b>. Five servers below run it for real: one becomes leader, sends heartbeats, and copies every write to the others. An entry is <b>committed</b> once a majority (3 of 5) holds it. The teal ring around a follower is its election timer: if no heartbeat arrives before it runs out, the follower stands for election.</p>`)),
    section("Elect, replicate, crash, repeat",
      h("div.stage",
        h("div.stage-controls",
          button("Client write", clientWrite, "primary"),
          button("Crash the leader", crashLeader),
          partTg,
          toggle({ label: "Randomised election timeouts", checked: true, onChange: (v) => { randomTimeouts = v; reset(); } }),
          button("Revive and heal", revive),
          button("Reset", reset),
        ),
        h("div.stage-body", st.el, fc.el),
      ),
      callout("tip", "Things to try", "<p>Write a few entries, then crash the leader: within a few hundred milliseconds someone's timer runs out and a new term starts. Turn on the partition while S1 or S2 is leader and write again: the old leader accepts the writes but can never commit them (it can't reach 3 servers), while the majority side elects its own leader. Heal it and watch the uncommitted entries get replaced. Finally, switch off randomised timeouts: every server times out together, votes for itself, and nobody ever wins.</p>"),
      predict({
        chapter: id,
        question: "A Raft cluster of 5 servers. How many can crash with the cluster still accepting writes?",
        options: ["1", "2", "3", "4"],
        answer: 1,
        explain: "<p>A write needs a majority, 3 of 5, so 2 can fail. That's why clusters have odd sizes: 4 servers also tolerate only 1 failure (a majority of 4 is 3), so the fourth machine buys nothing. 2f + 1 servers tolerate f failures.</p>",
      }),
    ),
    section("The rules that make it safe",
      table(["Rule", "What it prevents"], [
        ["One vote per server per term", "Two leaders in the same term"],
        ["A server only votes for a candidate whose log is at least as up to date", "Electing a leader that's missing committed entries"],
        ["Commit by counting only entries from the leader's current term", "The subtle case where an old entry looks replicated but could still be overwritten (Raft paper, figure 8)"],
        ["Higher term always wins; a stale leader steps down on sight", "A partitioned old leader carrying on after the heal"],
        ["Randomised election timeouts", "Endless split votes"],
      ]),
      callout("warn", "Don't write this yourself", "<p>Raft fits on a page, but production implementations took years to harden: log compaction, membership changes, pre-vote, leases for fast reads, fsync ordering. Use etcd, ZooKeeper or Consul for coordination (leader election, locks, config), or a database built on consensus (CockroachDB, TiDB, Spanner, FoundationDB, Kafka's KRaft). Even then, read Jepsen's reports for your database before trusting it with money.</p>"),
    ),
    section("Where you meet consensus",
      table(["System", "Algorithm", "What it agrees on"], [
        ["etcd (Kubernetes' brain)", "Raft", "Every object in your cluster"],
        ["ZooKeeper", "ZAB", "Kafka's old controller, HBase, locks"],
        ["Kafka (KRaft)", "Raft", "Topic and partition metadata"],
        ["CockroachDB, TiKV", "Raft per range", "Each slice of rows"],
        ["Spanner", "Paxos per split + TrueTime", "Global, linearizable transactions"],
      ]),
    ),
    section("In code",
      code({
        "Leader election with etcd (Python)": `import etcd3, socket

client = etcd3.client(host="etcd", port=2379)
me = socket.gethostname()

# a lease expires 10 s after we stop refreshing it, so a crashed leader
# loses the role automatically
lease = client.lease(ttl=10)
won, _ = client.transaction(
    compare=[client.transactions.create("/jobs/leader") == 0],   # key absent
    success=[client.transactions.put("/jobs/leader", me, lease)],
    failure=[],
)
if won:
    while True:
        do_one_batch_of_leader_only_work()
        lease.refresh()`,
        "Raft core (pseudo)": `on election timeout:
    term += 1; state = CANDIDATE; voted_for = self; votes = 1
    send RequestVote(term, last_log_index, last_log_term) to all

on RequestVote(t, idx, lt) from c:
    if t > term: become follower in term t
    up_to_date = lt > my_last_term or (lt == my_last_term and idx >= len(log))
    grant = t == term and voted_for in (None, c) and up_to_date
    if grant: voted_for = c; reset election timer
    reply(term, grant)

on majority of votes: state = LEADER; send heartbeats every 50 ms

leader: commit_index = max N where a majority has log[N]
        and log[N].term == current term`,
        "Fencing tokens": `# A paused leader (GC, VM stall) can wake up still believing it leads.
# Give every leadership a strictly increasing number (Raft term, etcd revision)
# and have storage reject writes with an older one.
def write(key, value, token):
    with db.transaction():
        last = db.get("fence:" + key) or 0
        if token < last:
            raise StaleLeader(token)
        db.put("fence:" + key, token)
        db.put(key, value)`,
      }),
    ),
  );
  reset();
  lp.start();
}
