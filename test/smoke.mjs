// Loads the map and every live chapter in a real browser, pokes each control
// and fails on any console error or horizontal overflow.
// Usage: node test/smoke.mjs [chapterId] [--shots dir]
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { ALL } from "../lib/catalog.js";

const { chromium } = createRequire(import.meta.url)("playwright"); // preinstalled globally
const args = process.argv.slice(2);
const shots = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const only = args.find((a) => !a.startsWith("--") && a !== shots);
const PORT = 4199;
const server = spawn("node", ["serve.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));
const base = `http://localhost:${PORT}`;

const browser = await chromium.launch();
let failed = 0;

async function visit(path, name, poke) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().includes("fonts.g") && errors.push(m.text()));
  await page.goto(base + path, { waitUntil: "load" });
  await page.waitForTimeout(300);
  if (poke) await poke(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const ok = !errors.length && !overflow && !mobileOverflow;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${errors.length ? "  errors: " + errors.join(" | ") : ""}${overflow ? "  desktop overflow" : ""}${mobileOverflow ? "  mobile overflow" : ""}`);
  await page.close();
}

async function pokeAll(page) {
  // controls may re-render their own panel, so a stale handle is not a failure
  for (const t of await page.$$(".toggle")) await t.click({ timeout: 1000 }).catch(() => {});
  for (const b of await page.$$(".stage .seg button")) await b.click().catch(() => {});
  for (const r of await page.$$('input[type="range"]'))
    await r.evaluate((el) => { el.value = el.max; el.dispatchEvent(new Event("input", { bubbles: true })); });
  for (const p of await page.$$(".predict")) { const o = await p.$(".opt"); if (o) await o.click({ timeout: 1000 }).catch(() => {}); }
  for (const st of await page.$$(".stepper")) {
    const next = await st.$(".step-nav .primary");
    for (let i = 0; i < 12 && next && !(await next.isDisabled()); i++) await next.click();
  }
  for (const b of await page.$$(".stage .btn")) await b.click().catch(() => {});
  await page.waitForTimeout(1200);
}

if (!only || only === "quiz") {
  if (!only) await visit("/", "home");
  await visit("/quiz", "quiz", async (p) => { await p.click(".qz-word"); await p.click(".qz-go"); await p.click(".qz-opt"); await p.waitForTimeout(200); });
  await visit("/settings", "settings", async (p) => { for (const b of await p.$$(".set-seg button")) await b.click().catch(() => {}); });
}
for (const c of ALL.filter((c) => c.live && (!only || c.id === only))) await visit(`/learn?c=${c.id}`, c.id, pokeAll);
await browser.close();
server.kill();
console.log(failed ? `${failed} page(s) failed` : "all pages ok");
process.exit(failed ? 1 : 0);
