import { h } from "../lib/core.js";
import { segmented, predict, code, dilemma, callout, stepper, section, prose, button } from "../lib/widgets.js";

// Real HMAC-SHA256 JWTs, signed and verified with WebCrypto in your browser.
const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (str) => Uint8Array.from(atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4)), (c) => c.charCodeAt(0));
const SECRET = "server-side-secret-never-sent-to-clients";
let keyP;
const key = () => (keyP ??= crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));

async function signJwt(payload) {
  const head = b64u(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await key(), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}
async function verifyJwt(token, now) {
  const [head, body, sig] = token.split(".");
  if (!sig) return { ok: false, why: "malformed token" };
  const valid = await crypto.subtle.verify("HMAC", await key(), fromB64u(sig), enc.encode(`${head}.${body}`));
  if (!valid) return { ok: false, why: "signature does not match: the token was changed" };
  const p = JSON.parse(new TextDecoder().decode(fromB64u(body)));
  if (p.exp < now) return { ok: false, why: "token expired" };
  return { ok: true, payload: p };
}
const randomId = () => b64u(crypto.getRandomValues(new Uint8Array(18)));

export default function (root, { id }) {
  let mode = "session";
  let clock = Math.floor(Date.UTC(2026, 10, 14, 9, 0) / 1000);
  const state = { sessions: new Map(), browser: null, attacker: null, denylist: new Set() };
  const browserEl = h("pre.log"), serverEl = h("pre.log"), attackerEl = h("pre.log"), logEl = h("pre.log", { style: { maxHeight: "260px" } });
  const clockEl = h("span.pill");
  const log = (line, tone = "") => {
    logEl.append(Object.assign(document.createElement("div"), { textContent: line, style: tone === "bad" ? "color:var(--bad)" : tone === "good" ? "color:var(--good)" : "" }));
    logEl.scrollTop = logEl.scrollHeight;
  };
  const fmtClock = () => new Date(clock * 1000).toISOString().slice(11, 16) + " UTC";

  function paint() {
    clockEl.textContent = `clock ${fmtClock()}`;
    if (mode === "session") {
      browserEl.textContent = state.browser ? `Cookie: sid=${state.browser}\n  HttpOnly; Secure; SameSite=Lax\n  (JavaScript can't read it)` : "(no cookie)";
      serverEl.textContent = state.sessions.size ? [...state.sessions].map(([sid, v]) => `sessions["${sid.slice(0, 10)}…"] = ${JSON.stringify(v)}`).join("\n") : "sessions = {}  (empty)";
    } else {
      if (state.browser) {
        const [hh, bb, ss] = state.browser.split(".");
        browserEl.replaceChildren(h("span", { style: { color: "var(--c2)" } }, hh), ".", h("span", { style: { color: "var(--c6)" } }, bb), ".", h("span", { style: { color: "var(--c3)" } }, ss), `\n\npayload = ${new TextDecoder().decode(fromB64u(bb))}`);
      } else browserEl.textContent = "(no token)";
      serverEl.textContent = `secret key: ${SECRET.slice(0, 12)}…\nstored sessions: none (stateless)\n${state.denylist.size ? `denylist: ${state.denylist.size} token id(s)` : "denylist: off"}`;
    }
    attackerEl.textContent = state.attacker ? `stolen ${mode === "session" ? "cookie" : "token"}:\n${state.attacker.slice(0, 48)}…` : "(nothing stolen yet)";
  }

  async function login() {
    log(`POST /login {"user":"ada","password":"••••••"}`);
    log(`  server checks password with argon2id hash`);
    if (mode === "session") {
      const sid = randomId();
      state.sessions.set(sid, { user: "ada", role: "user", expires: fmtFor(clock + 7 * 86400) });
      state.browser = sid;
      log(`← 200  Set-Cookie: sid=${sid.slice(0, 10)}…; HttpOnly; Secure`, "good");
    } else {
      const token = await signJwt({ sub: "ada", role: "user", jti: randomId().slice(0, 8), iat: clock, exp: clock + 15 * 60 });
      state.browser = token;
      log(`← 200  {"access_token":"${token.slice(0, 24)}…"} (valid 15 min)`, "good");
    }
    paint();
  }
  const fmtFor = (t) => new Date(t * 1000).toISOString().slice(0, 16);

  async function me(who = "browser") {
    const cred = who === "browser" ? state.browser : state.attacker;
    const label = who === "browser" ? "Ada's browser" : "Attacker";
    if (!cred) { log(`${label}: GET /me  (no credentials)`); log("← 401 Unauthorized", "bad"); return; }
    log(`${label}: GET /me  ${mode === "session" ? "Cookie: sid=…" : "Authorization: Bearer …"}`);
    if (mode === "session") {
      const sess = state.sessions.get(cred);
      log(`  server: look up session in store (Redis/DB)`);
      sess ? log(`← 200 {"user":"${sess.user}"}`, "good") : log("← 401 session not found", "bad");
    } else {
      const v = await verifyJwt(cred, clock);
      log(`  server: verify HMAC signature + exp (no lookup)`);
      if (v.ok && state.denylist.has(v.payload.jti)) return log("← 401 token revoked (found in denylist)", "bad");
      v.ok ? log(`← 200 {"user":"${v.payload.sub}","role":"${v.payload.role}"}`, "good") : log(`← 401 ${v.why}`, "bad");
    }
  }
  function steal() {
    if (!state.browser) return log("Nothing to steal: log in first.");
    state.attacker = state.browser;
    log(`⚠ an attacker copies the ${mode === "session" ? "session cookie" : "token"} (malware, a leaked log, XSS)`, "bad");
    paint();
  }
  async function logout() {
    if (!state.browser) return;
    log("POST /logout");
    if (mode === "session") {
      state.sessions.delete(state.browser);
      log("  server deletes the session row: every copy is dead now", "good");
    } else {
      const p = JSON.parse(new TextDecoder().decode(fromB64u(state.browser.split(".")[1])));
      if (deny.value) { state.denylist.add(p.jti); log(`  server adds jti ${p.jti} to a denylist (state is back!)`, "good"); }
      else log("  browser forgets its token. The server has nothing to delete.");
    }
    state.browser = null;
    paint();
  }
  async function tamper() {
    const tok = state.browser || state.attacker;
    if (!tok || mode !== "jwt") return log("Switch to JWT and log in first.");
    const [hh, bb, ss] = tok.split(".");
    const p = JSON.parse(new TextDecoder().decode(fromB64u(bb)));
    p.role = "admin";
    const forged = `${hh}.${b64u(enc.encode(JSON.stringify(p)))}.${ss}`;
    log(`Attacker edits the payload to "role":"admin" and keeps the old signature`);
    const v = await verifyJwt(forged, clock);
    log(`  server verify → ${v.ok ? "accepted?!" : v.why}`, v.ok ? "bad" : "good");
    log(`← 401`, "bad");
  }
  function advance() {
    clock += 20 * 60;
    log(`… 20 minutes pass (${fmtClock()})`);
    paint();
  }
  const deny = segmented({ label: "On logout", options: [{ value: false, label: "Just forget token" }, { value: true, label: "Denylist its id" }], value: false });

  function reset(m) {
    mode = m;
    state.sessions.clear(); state.browser = null; state.attacker = null; state.denylist.clear();
    logEl.replaceChildren();
    log(mode === "session" ? "Mode: server sessions. The server remembers who is logged in." : "Mode: JWT. The token itself says who you are, signed by the server.");
    deny.style.display = mode === "jwt" ? "" : "none";
    paint();
  }

  root.append(
    section(null, prose(`<p>HTTP forgets you after every request. Authentication is how the server recognises you on the next one. There are two families: the server <b>remembers</b> you (a session stored server-side, referenced by a cookie), or you carry a <b>signed note</b> that proves who you are (a token like a JWT). Both work; they fail differently.</p>`)),
    section("Log in, get robbed, log out",
      h("div.stage",
        h("div.stage-controls",
          segmented({ label: "How the server remembers you", options: [{ value: "session", label: "Server sessions" }, { value: "jwt", label: "JWT (stateless)" }], value: mode, onChange: reset }),
          deny,
          clockEl,
        ),
        h("div.stage-body",
          h("div.row", button("Log in", login, "primary"), button("GET /me", () => me()), button("Attacker steals it", steal), button("Log out", logout), button("Attacker: GET /me", () => me("attacker")), button("Forge admin role", tamper), button("+20 minutes", advance)),
          h("div.split", h("div", h("div.eyebrow", "Ada's browser"), browserEl), h("div", h("div.eyebrow", "Server state"), serverEl), h("div", h("div.eyebrow", "Attacker"), attackerEl)),
          h("div", h("div.eyebrow", "Requests"), logEl),
        ),
      ),
      callout("tip", "Try this order in both modes", "<p>Log in → Attacker steals it → Log out → Attacker: GET /me. Then in JWT mode press +20 minutes and try again, and try forging the admin role.</p>"),
      predict({
        chapter: id,
        question: "In JWT mode with no denylist, Ada logs out after an attacker copied her token. The attacker calls the API a minute later. What happens?",
        options: ["401: logging out invalidates the token", "200: the token is still valid until it expires", "403: the server notices a second device", "The server asks Ada to confirm"],
        answer: 1,
        explain: "<p>A JWT is valid because of its signature and expiry, not because the server remembers it. Logging out just deletes Ada's copy. That's why access tokens are short-lived (5–15 minutes) and paired with a refresh token the server <i>can</i> revoke, or checked against a denylist, which quietly brings back server state.</p>",
      }),
    ),
    section("Choosing",
      dilemma("Sessions or JWTs for your web app?", [
        { name: "Server sessions + cookie", pros: ["Logout and bans take effect instantly", "HttpOnly cookie: JavaScript can't steal it"], cons: ["A lookup on every request", "Shared store needed across servers (Redis)"] },
        { name: "JWT access tokens", pros: ["No lookup: any server can verify", "Easy across services and APIs"], cons: ["Can't revoke before expiry without extra state", "Tokens in localStorage are readable by XSS"] },
      ], "For a first-party web app, sessions in HttpOnly cookies are the simpler, safer default. JWTs shine between services and for third-party API access, with short expiry and refresh tokens."),
      callout("warn", "Non-negotiables either way", "<p>Hash passwords with argon2id or bcrypt (never plain SHA). Use HTTPS. Set <code>HttpOnly</code>, <code>Secure</code> and <code>SameSite</code> on cookies. Rate-limit login. Rotate secrets. Never put secrets in a JWT payload: it's only encoded, anyone can read it.</p>"),
    ),
    section("“Sign in with Google”: OAuth 2.0 + PKCE",
      prose("<p>When you log in with another provider, your app never sees the password. It receives a short-lived code and swaps it for tokens. Step through it:</p>"),
      stepper([
        { title: "1. App creates a secret, sends you to Google", html: "<p>The app makes a random <code>code_verifier</code>, hashes it into a <code>code_challenge</code>, and redirects you:</p><pre>GET https://accounts.google.com/o/oauth2/v2/auth\n  ?client_id=app123&response_type=code\n  &redirect_uri=https://app.example/callback\n  &scope=openid%20email&state=xyz\n  &code_challenge=E9Mel…&code_challenge_method=S256</pre>" },
        { title: "2. You log in at Google and consent", html: "<p>Your password goes to Google only. Google asks: “App wants your email address. Allow?”</p>" },
        { title: "3. Google redirects back with a code", html: "<pre>GET https://app.example/callback?code=4/0Adeu5B…&state=xyz</pre><p>The app checks <code>state</code> matches what it sent (stops CSRF). The code is single-use and expires in minutes.</p>" },
        { title: "4. App's server swaps code for tokens", html: "<pre>POST https://oauth2.googleapis.com/token\n  code=4/0Adeu5B…&code_verifier=dBjftJeZ…\n  &client_id=app123&grant_type=authorization_code</pre><p>Google hashes the verifier and checks it matches the challenge from step 1, so a stolen code alone is useless.</p>" },
        { title: "5. Tokens come back", html: "<pre>{ \"id_token\": \"eyJhbGciOiJSUzI1NiIs…\",   // who the user is (a JWT)\n  \"access_token\": \"ya29.a0Af…\",           // call Google APIs\n  \"expires_in\": 3599 }</pre><p>The app verifies the ID token's signature with Google's public keys and reads <code>sub</code> and <code>email</code>.</p>" },
        { title: "6. App starts its own session", html: "<p>Now the app creates <b>its own</b> session cookie (the left mode above). OAuth proved who you are; your app still decides how to remember you.</p>" },
      ]),
    ),
    section("In code",
      code({
        "Express (sessions)": `import session from "express-session";
import RedisStore from "connect-redis";

app.use(session({
  store: new RedisStore({ client: redis }),       // shared by every server
  secret: process.env.SESSION_SECRET,
  cookie: { httpOnly: true, secure: true, sameSite: "lax", maxAge: 7 * 864e5 },
  resave: false, saveUninitialized: false,
}));

app.post("/login", async (req, res) => {
  const user = await users.findByEmail(req.body.email);
  if (!user || !(await argon2.verify(user.hash, req.body.password))) return res.sendStatus(401);
  req.session.regenerate(() => { req.session.userId = user.id; res.sendStatus(204); });
});
app.post("/logout", (req, res) => req.session.destroy(() => res.sendStatus(204)));`,
        "Python (JWT)": `import jwt, time   # PyJWT

SECRET = os.environ["JWT_SECRET"]

def issue(user_id: str) -> str:
    now = int(time.time())
    return jwt.encode({"sub": user_id, "iat": now, "exp": now + 15 * 60}, SECRET, algorithm="HS256")

def current_user(token: str) -> str:
    try:
        claims = jwt.decode(token, SECRET, algorithms=["HS256"])   # checks signature and exp
    except jwt.InvalidTokenError:
        raise HTTPException(401)
    return claims["sub"]`,
      }),
    ),
  );
  reset("session");
}
