#!/usr/bin/env node
/**
 * Live collection for the AI quality review: types each scenario from
 * live/scenarios.cjs into the real, signed-in Companion page and records the
 * reply text and timing. One conversation at a time; a fresh page per scenario
 * (the Companion keeps the thread in page memory only) and the app's own
 * "Delete all" memory control before every scenario so scenarios don't leak.
 *
 *   node tests/ai/companion/live/collect.cjs --email-file F --password-file F \
 *     --state-file F --out DIR [--only J01,J02] [--base https://restpilotai.com]
 *
 * - Credentials are read from files and typed into the sign-in form only; they
 *   are never printed, logged or written to the output. The session is stored in
 *   --state-file (mode 600), outside the output directory.
 * - Text-to-speech and speech-to-text requests are aborted so the run spends AI
 *   credits on chat replies only.
 * - Timing is measured in the page: Send pressed -> first streamed content
 *   token (TTFT) -> stream end (total).
 * - Stops at the first 429 (daily AI budget or rate limit) and says so.
 */
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PW = process.env.PLAYWRIGHT_MODULE || "/opt/node-tools/node_modules/playwright";
const { chromium } = require(PW);
const BASE = opt("--base", "https://restpilotai.com");
const OUT = opt("--out");
const STATE = opt("--state-file");
const only = opt("--only", "") ? new Set(opt("--only").split(",")) : null;
const TZ = opt("--tz", "America/New_York");
const SKIP_MEMORY = args.includes("--no-memory-clear");
if (!OUT || !STATE) throw new Error("--out and --state-file are required");
fs.mkdirSync(OUT, { recursive: true });

const scenarios = require("./scenarios.cjs").filter((s) => !only || only.has(s.id));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Fetch wrapper installed before any app code: tees /api/ai streams and timestamps them. */
const INIT = () => {
  const orig = window.fetch.bind(window);
  window.__rp = [];
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input && input.url ? input.url : String(input);
    if (!/\/api\/ai(\?|$)/.test(url)) return orig(input, init);
    const rec = {
      t0: performance.now(),
      url,
      reqBody: init && typeof init.body === "string" ? init.body.slice(0, 40000) : null,
    };
    window.__rp.push(rec);
    let resp;
    try {
      resp = await orig(input, init);
    } catch (e) {
      rec.error = String(e);
      rec.tDone = performance.now();
      throw e;
    }
    rec.status = resp.status;
    rec.tHeaders = performance.now();
    if (!resp.body) {
      rec.tDone = performance.now();
      return resp;
    }
    const [a, b] = resp.body.tee();
    (async () => {
      const reader = b.getReader();
      const dec = new TextDecoder();
      let raw = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += dec.decode(value, { stream: true });
          if (rec.tFirst == null && /"content":"(?:[^"\\]|\\.)/.test(raw))
            rec.tFirst = performance.now();
        }
      } catch (e) {
        rec.error = String(e);
      }
      rec.raw = raw.slice(0, 200000);
      rec.tDone = performance.now();
    })();
    return new Response(a, {
      status: resp.status,
      statusText: resp.statusText,
      headers: resp.headers,
    });
  };
};

function parseSse(raw = "") {
  let text = "";
  let finish = null;
  let usage = null;
  let model = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const j = line.slice(6).trim();
    if (!j || j === "[DONE]") continue;
    try {
      const p = JSON.parse(j);
      const c = p.choices?.[0];
      if (c?.delta?.content) text += c.delta.content;
      if (c?.finish_reason) finish = c.finish_reason;
      if (p.usage) usage = p.usage;
      if (p.model) model = p.model;
    } catch {
      /* partial frame */
    }
  }
  if (!raw.includes("data: ")) {
    try {
      const p = JSON.parse(raw);
      text = p.error ? "" : JSON.stringify(p);
    } catch {
      /* not JSON */
    }
  }
  return { text, finish, usage, model };
}

async function signIn(context, page) {
  await page.goto(`${BASE}/companion`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  if (!/\/auth/.test(new URL(page.url()).pathname)) return true;
  const email = fs.readFileSync(opt("--email-file"), "utf8").trim();
  const password = fs.readFileSync(opt("--password-file"), "utf8").trim();
  for (let i = 0; i < 3; i++) {
    await page.fill("input[type=email]", email);
    await page.fill("input[type=password]", password);
    await page.waitForTimeout(500);
    const ok = await page.evaluate(
      () =>
        document.querySelector("input[type=email]")?.value.length > 0 &&
        document.querySelector("input[type=password]")?.value.length > 0,
    );
    if (ok) break;
  }
  await page.getByRole("button", { name: /^Sign In$/ }).click();
  await page.waitForTimeout(5000);
  // Clear the password field from the DOM in case the page did not navigate.
  await page
    .evaluate(() =>
      document.querySelectorAll("input[type=password]").forEach((i) => (i.value = "")),
    )
    .catch(() => {});
  if (/\/auth/.test(new URL(page.url()).pathname)) return false;
  await context.storageState({ path: STATE });
  fs.chmodSync(STATE, 0o600);
  return true;
}

async function clearMemory(page) {
  await page.goto(`${BASE}/memory`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3500);
  const del = page.getByRole("button", { name: /Delete all/i });
  if (!(await del.count()) || !(await del.first().isEnabled())) return "nothing-to-delete";
  await del.first().click();
  await page.waitForTimeout(600);
  const confirm = page.getByRole("button", { name: /^(Yes|Delete|Confirm|Delete everything)/i });
  if (await confirm.count()) await confirm.first().click();
  await page.waitForTimeout(2500);
  return "deleted";
}

async function uiTail(page) {
  return page
    .evaluate(() => (document.querySelector("main") || document.body).innerText.slice(-2500))
    .catch(() => "");
}

async function runTurn(page, text) {
  const before = await page.evaluate(() => window.__rp.length);
  const box = page
    .locator(
      'textarea[placeholder="Message your Companion"], input[placeholder="Message your Companion"]',
    )
    .first();
  await box.waitFor({ state: "visible", timeout: 30000 });
  await box.fill(text);
  const sendLocal = new Date();
  await page.evaluate(() => (window.__tSend = performance.now()));
  await box.press("Enter");
  // Did the app call the AI, or did the client intent router answer locally?
  const deadline = Date.now() + 6000;
  let called = false;
  while (Date.now() < deadline) {
    if ((await page.evaluate(() => window.__rp.length)) > before) {
      called = true;
      break;
    }
    await sleep(150);
  }
  if (!called) {
    await sleep(1500);
    return { sendLocal: sendLocal.toISOString(), intercepted: true, ui: await uiTail(page) };
  }
  const end = Date.now() + 90000;
  let rec;
  while (Date.now() < end) {
    rec = await page.evaluate((i) => {
      const r = window.__rp[i];
      return r && r.tDone != null ? { ...r, tSend: window.__tSend } : null;
    }, before);
    if (rec) break;
    await sleep(200);
  }
  await sleep(1500);
  const ui = await uiTail(page);
  if (!rec) return { sendLocal: sendLocal.toISOString(), timeout: true, ui };
  const sse = parseSse(rec.raw);
  let reqSummary = null;
  try {
    const b = JSON.parse(rec.reqBody);
    reqSummary = {
      intent: b.intent,
      surface: b.surface,
      timezone: b.timezone,
      localTime: b.localTime,
      messages: (b.messages || []).length,
      context: b.context,
    };
  } catch {
    /* no body */
  }
  return {
    sendLocal: sendLocal.toISOString(),
    status: rec.status,
    reply: sse.text,
    finish: sse.finish,
    usage: sse.usage,
    upstreamModel: sse.model,
    ttftMs: rec.tFirst != null ? Math.round(rec.tFirst - rec.tSend) : null,
    totalMs: Math.round(rec.tDone - rec.tSend),
    fetchStartMs: Math.round(rec.t0 - rec.tSend),
    request: reqSummary,
    error: rec.error || null,
    rawError: rec.status >= 400 ? (rec.raw || "").slice(0, 300) : null,
    ui,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "en-US",
    timezoneId: TZ,
    ...(fs.existsSync(STATE) ? { storageState: STATE } : {}),
  });
  await context.addInitScript(INIT);
  // No voice: spend credits on chat replies only.
  await context.route(/\/api\/(tts|stt)(\?|$)|elevenlabs\.io/, (r) => r.abort());
  const page = await context.newPage();
  const prefs = {};
  let apikey = null;
  let supaBase = null;
  page.on("request", (r) => {
    const u = r.url();
    if (/supabase\.co\/(rest|auth)\/v1/.test(u) && r.headers().apikey) {
      apikey = r.headers().apikey;
      supaBase = u.split("/rest/")[0].split("/auth/")[0];
    }
  });
  page.on("response", async (r) => {
    if (/\/rest\/v1\/user_prefs/.test(r.url()) && r.request().method() === "GET") {
      try {
        const j = await r.json();
        const row = Array.isArray(j) ? j[0] : j;
        if (row)
          for (const k of [
            "home_tz",
            "current_tz",
            "sleep_hours",
            "wind_down_min",
            "assistant_name",
            "assistant_mode",
            "memory_enabled",
            "voice_language",
          ])
            if (k in row) prefs[k] = row[k];
      } catch {
        /* ignore */
      }
    }
  });
  if (!(await signIn(context, page))) {
    log("SIGN-IN FAILED (account not confirmed or wrong credentials). No AI call was made.");
    await browser.close();
    process.exit(2);
  }
  log("signed in");
  // What the app knows about the account (synthetic data), so reviewers judge
  // replies against the real context. Read-only, the user's own rows.
  for (let i = 0; i < 40 && !apikey; i++) await page.waitForTimeout(250);
  const account = await page
    .evaluate(
      async ({ apikey, supaBase }) => {
        const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
        const tok = JSON.parse(localStorage.getItem(k)).access_token;
        const h = { apikey, Authorization: `Bearer ${tok}` };
        const get = async (q) => (await fetch(`${supaBase}/rest/v1/${q}`, { headers: h })).json();
        return {
          prefs: (
            await get(
              "user_prefs?select=home_tz,current_tz,sleep_hours,wind_down_min,assistant_name,assistant_mode,memory_enabled",
            )
          )[0],
          shifts: await get(
            `shifts?select=start_utc,end_utc,title,shift_type&end_utc=gte.${new Date().toISOString()}&order=start_utc&limit=10`,
          ),
          wearableReadings: (await get("wearable_readings?select=date&limit=1")).length,
        };
      },
      { apikey, supaBase },
    )
    .catch((e) => ({ error: String(e).slice(0, 120) }));
  fs.writeFileSync(path.join(OUT, "account-context.json"), JSON.stringify(account, null, 2));
  if (account.prefs) Object.assign(prefs, account.prefs);
  const outFile = path.join(OUT, "live-responses.jsonl");
  for (const s of scenarios) {
    const memory = SKIP_MEMORY ? "skipped" : await clearMemory(page);
    await page.goto(`${BASE}/companion`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    const turns = [];
    let stop = false;
    for (const [i, text] of s.turns.entries()) {
      const r = await runTurn(page, text);
      turns.push({ turn: i, user: text, ...r });
      log(
        s.id,
        `turn ${i}`,
        r.intercepted
          ? "INTERCEPTED by client intent router"
          : `status ${r.status} ttft ${r.ttftMs}ms total ${r.totalMs}ms finish ${r.finish} chars ${(r.reply || "").length}`,
      );
      if (r.status === 429) {
        log(
          "429 from /api/ai: daily AI budget or rate limit reached. Stopping.",
          (r.rawError || "").slice(0, 120),
        );
        stop = true;
        break;
      }
      await sleep(3000);
    }
    fs.appendFileSync(
      outFile,
      JSON.stringify({
        id: s.id,
        memoryBefore: memory,
        prefs,
        collectedAt: new Date().toISOString(),
        turns,
      }) + "\n",
    );
    if (stop) break;
  }
  fs.writeFileSync(path.join(OUT, "account-prefs.json"), JSON.stringify(prefs, null, 2));
  await context.storageState({ path: STATE });
  fs.chmodSync(STATE, 0o600);
  await browser.close();
})().catch((e) => {
  console.error("collector error:", String(e).slice(0, 400));
  process.exit(1);
});
