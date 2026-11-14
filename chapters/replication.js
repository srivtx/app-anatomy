import { h, loop, rng } from "../lib/core.js";
import { slider, segmented, toggle, stats, predict, code, dilemma, callout, section, prose, table } from "../lib/widgets.js";
import { flowCanvas } from "../lib/flow.js";

// N replicas of one value. A client writes version v, waits for W acks, then
// immediately reads from R replicas and keeps the newest answer. Messages take
// random network time, so slow replicas lag behind. A read is stale if it
// returns an older version than the write the client just saw succeed.
const SPEED = 0.35; // simulated ms per real ms

const PRESETS = {
  async: { label: "Async: W = 1, R = 1", N: 3, W: 1, R: 1 },
  overlap: { label: "Quorum: W + R > N", N: 3, W: 2, R: 2 },
  allw: { label: "Write all, read one", N: 3, W: 3, R: 1 },
};

export default function (root, { id }) {
  let N = 3, W = 1, R = 1, lag = 60, partition = false;
  let t = 0, version = 0, msgs = [], arrivals = [], ops = [], nextOp = 50, r = rng(7);
  const fc = flowCanvas({ width: 720, height: 290, label: "A client writing to and reading from replicas" });
  const st = stats([{ label: "Reads that were stale" }, { label: "Write latency (median)" }, { label: "Read latency (median)" }, { label: "Requests that failed" }]);
  const down = (i) => partition && i >= N - 2; // the last two replicas are cut off

  const delay = () => 4 + r.exp(lag);
  function versionAt(i, at) { let v = 0; for (const [ta, va] of arrivals[i]) if (ta <= at && va > v) v = va; return v; }

  function reset() {
    t = 0; version = 0; msgs = []; ops = []; nextOp = 50; r = rng(7);
    arrivals = Array.from({ length: N }, () => []);
  }
  function startOp() {
    const v = ++version, op = { v, t0: t, kind: "write" };
    const acks = [];
    for (let i = 0; i < N; i++) {
      if (down(i)) continue;
      const a = t + delay(), back = a + delay();
      arrivals[i].push([a, v]);
      msgs.push({ i, from: t, to: a, kind: "w" }, { i, from: a, to: back, kind: "ack", back: true });
      acks.push(back);
    }
    acks.sort((x, y) => x - y);
    if (acks.length < W) { op.failed = true; op.done = t + 400; ops.push(op); return; }
    op.done = acks[W - 1];
    // as soon as the write is acknowledged, the same client reads it back
    const rd = { kind: "read", t0: op.done, want: v }, resp = [];
    for (let i = 0; i < N; i++) {
      if (down(i)) continue;
      const a = op.done + delay(), back = a + delay();
      msgs.push({ i, from: op.done, to: a, kind: "r" }, { i, from: a, to: back, kind: "rr", back: true, v: versionAt(i, a) });
      resp.push([back, i, a]);
    }
    resp.sort((x, y) => x[0] - y[0]);
    if (resp.length < R) { rd.failed = true; rd.done = op.done + 400; }
    else {
      rd.done = resp[R - 1][0];
      rd.got = Math.max(...resp.slice(0, R).map(([, i, a]) => versionAt(i, a)));
      rd.stale = rd.got < v;
    }
    ops.push(op, rd);
  }

  function med(a) { if (!a.length) return "–"; const s = [...a].sort((x, y) => x - y); return `${Math.round(s[s.length >> 1])} ms`; }
  function refresh() {
    const done = ops.filter((o) => o.done <= t).slice(-120);
    const reads = done.filter((o) => o.kind === "read" && !o.failed), writes = done.filter((o) => o.kind === "write" && !o.failed);
    const stale = reads.filter((o) => o.stale).length;
    st.set(0, reads.length ? `${Math.round((stale / reads.length) * 100)}%` : "–", reads.length ? (stale ? "bad" : "good") : "");
    st.set(1, med(writes.map((o) => o.done - o.t0)));
    st.set(2, med(reads.map((o) => o.done - o.t0)));
    const failed = done.filter((o) => o.failed).length;
    st.set(3, done.length ? `${Math.round((failed / done.length) * 100)}%` : "–", failed ? "bad" : "good");
  }

  function draw() {
    const c = fc.colors; fc.clear();
    const CX = 70, RX = 520, rowY = (i) => 30 + (i + 0.5) * (230 / N);
    fc.box(CX - 50, 115, 100, 54, { fill: c.surface, stroke: c.accent, lw: 2 });
    fc.text("Client", CX, 133, { align: "center", size: 12.5 });
    fc.text(`writing v${version}`, CX, 152, { align: "center", size: 10.5, mono: true, weight: 500, color: c["ink-2"] });
    fc.text(`W = ${W}   R = ${R}   N = ${N}`, CX, 196, { align: "center", size: 11, mono: true, weight: 500, color: c["ink-3"] });
    for (let i = 0; i < N; i++) {
      const y = rowY(i), v = versionAt(i, t), behind = version - v, off = down(i);
      fc.line(CX + 50, 142, RX - 70, y, { color: off ? c.bad : c.line, dash: off ? [3, 5] : null, lw: 1 });
      fc.box(RX - 70, y - 20, 180, 40, { fill: off ? c.sunken : c.surface, stroke: off ? c.bad : behind > 0 ? c.warn : c.line, lw: 1.5 });
      fc.text(`Replica ${i + 1}`, RX - 58, y - 5, { size: 11.5 });
      fc.text(off ? "unreachable" : behind > 0 ? `v${v}  (${behind} behind)` : `v${v}  up to date`, RX - 58, y + 10, { size: 10.5, mono: true, weight: 500, color: off ? c.bad : behind > 0 ? c.warn : c.good });
    }
    for (const m of msgs) {
      if (t < m.from || t > m.to) continue;
      const p = (t - m.from) / (m.to - m.from), y = rowY(m.i);
      const [x0, y0, x1, y1] = m.back ? [RX - 70, y, CX + 50, 142] : [CX + 50, 142, RX - 70, y];
      const col = m.kind === "w" || m.kind === "ack" ? c.c1 : c.c6;
      fc.dot(x0 + (x1 - x0) * p, y0 + (y1 - y0) * p, m.back ? 3 : 4.5, col);
    }
    // recent op strip
    const recent = ops.filter((o) => o.kind === "read" && o.done <= t).slice(-24);
    fc.text("Last reads:", 160, 274, { size: 10.5, color: c["ink-3"], weight: 500 });
    recent.forEach((o, k) => fc.box(232 + k * 12, 268, 9, 12, { fill: o.failed ? c["ink-3"] : o.stale ? c.bad : c.good, stroke: "transparent", r: 2 }));
    fc.dot(560, 274, 4, c.c1); fc.text("write / ack", 568, 274, { size: 10, weight: 500, color: c["ink-3"] });
    fc.dot(640, 274, 4, c.c6); fc.text("read", 648, 274, { size: 10, weight: 500, color: c["ink-3"] });
  }

  let PRESET = "async", acc = 0;
  const lp = loop((dt) => {
    t += dt * 1000 * SPEED;
    if (t >= nextOp) { startOp(); nextOp = t + 260 + r() * 140; }
    msgs = msgs.filter((m) => m.to > t - 5);
    draw();
    acc += dt; if (acc > 0.25) { acc = 0; refresh(); }
  }, fc.el);

  const sN = slider({ label: "Replicas N", min: 3, max: 5, value: N, onInput: (v) => { N = v; W = Math.min(W, N); R = Math.min(R, N); sW.value = W; sR.value = R; reset(); } });
  const sW = slider({ label: "Write waits for W acks", min: 1, max: 5, value: W, onInput: (v) => { W = Math.min(v, N); sW.value = W; reset(); } });
  const sR = slider({ label: "Read asks R replicas", min: 1, max: 5, value: R, onInput: (v) => { R = Math.min(v, N); sR.value = R; reset(); } });
  const seg = segmented({ label: "Preset", options: Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label })), value: PRESET,
    onChange: (p) => { PRESET = p; ({ N, W, R } = PRESETS[p]); sN.value = N; sW.value = W; sR.value = R; reset(); } });

  root.append(
    section(null, prose(`<p>Keeping one copy of your data means one disk failure loses it and one server limits your reads. So databases keep <b>replicas</b>. Copying takes time, though, and while a copy is in flight different replicas hold different answers. Here a client writes a new version, waits until <b>W</b> replicas confirm, then immediately reads from <b>R</b> replicas and keeps the newest answer it gets. Blue dots are writes and acknowledgements; purple are reads.</p>`)),
    section("Write, then read it back",
      h("div.stage",
        h("div.stage-controls", seg, sN, sW, sR,
          slider({ label: "Network delay (mean)", min: 10, max: 200, step: 10, value: lag, fmt: (v) => `${v} ms`, onInput: (v) => (lag = v) }),
          toggle({ label: "Partition: cut off 2 replicas", onChange: (v) => { partition = v; } }),
        ),
        h("div.stage-body", st.el, fc.el),
      ),
      callout("tip", "Things to try", "<p>Start with the async preset (W = 1, R = 1, like a leader with async followers): the client often reads its own write back as missing. Switch to W + R &gt; N and the stale reads stop, at the cost of slower writes. Now turn on the partition: with W = 2 of 3, writes fail; with W = 1 they keep working but reads get stale. That trade is the CAP theorem, live.</p>"),
      predict({
        chapter: id,
        question: "With N = 3, which setting guarantees a read sees the latest acknowledged write?",
        options: ["W = 1, R = 1", "W = 1, R = 2", "W = 2, R = 2", "Nothing short of W = 3"],
        answer: 2,
        explain: "<p>If W + R &gt; N, every set of R replicas overlaps every set of W replicas in at least one node, and that node has the new value. W = 2, R = 2 overlaps (4 &gt; 3). W = 3, R = 1 also works but makes every write wait for the slowest replica and fail if any one is down.</p>",
      }),
    ),
    section("What ‘consistent’ can mean",
      prose(`<p>“Eventually consistent” and “strongly consistent” are the two ends of a ladder. Most bugs live in the rungs between: the user who posts a comment and can't see it, or who sees a reply before the message it replies to.</p>`),
      table(["Guarantee", "Promise", "Typical way to get it"], [
        ["Linearizable", "Behaves like one copy; every read sees the latest completed write", "Single leader + consensus (Raft, Paxos), Spanner"],
        ["Sequential", "Everyone sees writes in the same order, maybe late", "Total-order log (Kafka partition, ZooKeeper)"],
        ["Causal", "If B depends on A, nobody sees B without A", "Version vectors, causal metadata"],
        ["Read your writes", "You always see your own writes", "Read from the leader for a few seconds after writing, or track the write's log position"],
        ["Monotonic reads", "You never see time go backwards", "Pin each user to one replica"],
        ["Eventual", "If writes stop, replicas converge", "Async replication, gossip, anti-entropy"],
      ]),
      dilemma("A partition splits your database in two. What does the minority side do with writes?", [
        { name: "Refuse them (CP)", pros: ["No conflicting histories", "Reads stay correct"], cons: ["Users on that side see errors"] },
        { name: "Accept them (AP)", pros: ["Everyone keeps working"], cons: ["Two histories to merge later", "Some writes may be lost or need a CRDT"] },
      ], "Bank balances and inventory pick CP. Shopping carts, likes and presence pick AP. PACELC adds the everyday half: even with no partition, you trade latency for consistency on every request (that's the W slider above)."),
      callout("note", "Replication lag in practice", "<p>A Postgres or MySQL async replica is usually milliseconds behind, but a long query, a vacuum or a burst of writes can push it to seconds or minutes. Any feature that writes and then reads (sign up → profile page, post → feed) should read from the leader, or wait until the replica has reached the write's log position.</p>"),
    ),
    section("In code",
      code({
        "Read your writes": `# after a write, remember where the leader's log was
lsn = db_leader.execute("INSERT ... RETURNING pg_current_wal_lsn()").scalar()
session["min_lsn"] = lsn

def db_for_read(session):
    want = session.get("min_lsn")
    for replica in replicas:
        if want is None or replica.scalar("SELECT pg_last_wal_replay_lsn()") >= want:
            return replica
    return db_leader          # nobody has caught up yet: read from the leader`,
        "Cassandra (tunable N/R/W)": `-- replication_factor = N
CREATE KEYSPACE shop WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 3};

CONSISTENCY QUORUM;      -- W = 2 of 3 for this session's writes
INSERT INTO carts (user_id, items) VALUES (42, ['book']);
CONSISTENCY QUORUM;      -- R = 2: overlaps every write quorum
SELECT items FROM carts WHERE user_id = 42;`,
        "Postgres (sync replica)": `# postgresql.conf on the leader: a commit waits until one
# of the named standbys has flushed it (W = 2 counting the leader)
synchronous_standby_names = 'FIRST 1 (replica_a, replica_b)'
synchronous_commit = on        # remote_apply also waits until it's visible`,
      }),
    ),
  );
  reset();
  lp.start();
}
