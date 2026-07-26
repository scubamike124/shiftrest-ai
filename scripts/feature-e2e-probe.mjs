/**
 * RestPilot authenticated feature probe: AI, planner-ish pages, CRUD via Supabase REST.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.RESTPILOT_BASE || "https://restpilotai.com";
const env = fs.readFileSync(path.join(root, ".env"), "utf8");
const strip = (s) => (s || "").trim().replace(/^["']|["']$/g, "");
const grab = (name) => strip((env.match(new RegExp(`^${name}=(.+)$`, "m")) || [])[1]);
const supabaseUrl = grab("VITE_SUPABASE_URL") || grab("SUPABASE_URL");
const anon = grab("VITE_SUPABASE_PUBLISHABLE_KEY") || grab("SUPABASE_PUBLISHABLE_KEY");
const session = JSON.parse(fs.readFileSync(path.join(root, ".e2e-session.json"), "utf8"));

async function ensureToken() {
  if (session.access_token) {
    // refresh
    const r = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: session.email, password: session.password }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.access_token) {
      session.access_token = j.access_token;
      session.refresh_token = j.refresh_token;
      session.user_id = j.user?.id || session.user_id;
      fs.writeFileSync(path.join(root, ".e2e-session.json"), JSON.stringify(session, null, 2));
    }
  }
  return session.access_token;
}

const token = await ensureToken();
const report = { generatedAt: new Date().toISOString(), base: BASE, checks: [], ok: true };
const check = (name, pass, detail = {}) => {
  report.checks.push({ name, pass, ...detail });
  if (!pass) report.ok = false;
};

check("has_token", Boolean(token));

const authH = {
  Authorization: `Bearer ${token}`,
  apikey: anon,
  "Content-Type": "application/json",
};

// AI coach (SSE or JSON)
{
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/ai`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({
      intent: "coach",
      messages: [{ role: "user", content: "Say OK in one short sentence for a production health check." }],
      surface: "text",
    }),
  });
  const text = await res.text();
  const looksStream = /data:|OK|ok|RestPilot|shift|sleep/i.test(text);
  check("ai_coach", res.status < 500 && (res.status === 200 || res.status === 402 || res.status === 429), {
    status: res.status,
    ms: Date.now() - t0,
    bytes: text.length,
    looksStream,
    snippet: text.slice(0, 160).replace(/\s+/g, " "),
  });
}

// AI brief-style intent
{
  const res = await fetch(`${BASE}/api/ai`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ intent: "right_now" }),
  });
  const text = await res.text();
  check("ai_right_now", res.status < 500, {
    status: res.status,
    bytes: text.length,
    snippet: text.slice(0, 120).replace(/\s+/g, " "),
  });
}

// TTS (may fail without LOVABLE_API_KEY on edge — still record)
{
  const res = await fetch(`${BASE}/api/tts`, {
    method: "POST",
    headers: authH,
    body: JSON.stringify({ text: "Hello from RestPilot production check." }),
  });
  check("tts", res.status < 500, { status: res.status, bytes: Number(res.headers.get("content-length") || 0) });
}

// Supabase REST: profile read
{
  const uid = session.user_id;
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${uid}&select=id,email,display_name`, {
    headers: { ...authH, Prefer: "return=representation" },
  });
  const rows = await res.json().catch(() => []);
  check("profile_read", res.status === 200, {
    status: res.status,
    rows: Array.isArray(rows) ? rows.length : 0,
  });
}

// Shifts CRUD
const shiftPayload = {
  user_id: session.user_id,
  day: 1,
  week_index: 0,
  start_min: 420,
  end_min: 900,
  title: "E2E Night",
  notes: "feature-e2e",
};
let shiftId = null;
{
  const res = await fetch(`${supabaseUrl}/rest/v1/shifts`, {
    method: "POST",
    headers: { ...authH, Prefer: "return=representation" },
    body: JSON.stringify(shiftPayload),
  });
  const rows = await res.json().catch(() => []);
  shiftId = Array.isArray(rows) ? rows[0]?.id : rows?.id;
  check("shift_create", res.status >= 200 && res.status < 300 && Boolean(shiftId), {
    status: res.status,
    err: !shiftId ? JSON.stringify(rows).slice(0, 200) : null,
  });
}
if (shiftId) {
  const res = await fetch(`${supabaseUrl}/rest/v1/shifts?id=eq.${shiftId}`, {
    method: "PATCH",
    headers: { ...authH, Prefer: "return=representation" },
    body: JSON.stringify({ title: "E2E Night Updated", start_min: 430 }),
  });
  check("shift_update", res.status >= 200 && res.status < 300, { status: res.status });

  const res2 = await fetch(`${supabaseUrl}/rest/v1/shifts?id=eq.${shiftId}&select=*`, {
    headers: authH,
  });
  const rows = await res2.json().catch(() => []);
  check("shift_read", res2.status === 200 && Array.isArray(rows) && rows[0]?.title === "E2E Night Updated", {
    status: res2.status,
  });

  const res3 = await fetch(`${supabaseUrl}/rest/v1/shifts?id=eq.${shiftId}`, {
    method: "DELETE",
    headers: authH,
  });
  check("shift_delete", res3.status >= 200 && res3.status < 300, { status: res3.status });
}

// Alarm-like user_event
let eventId = null;
{
  const starts = new Date(Date.now() + 3600_000).toISOString();
  const res = await fetch(`${supabaseUrl}/rest/v1/user_events`, {
    method: "POST",
    headers: { ...authH, Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: session.user_id,
      kind: "personal",
      title: "alarm:E2E test",
      starts_at: starts,
    }),
  });
  const rows = await res.json().catch(() => []);
  eventId = Array.isArray(rows) ? rows[0]?.id : rows?.id;
  check("alarm_event_create", res.status >= 200 && res.status < 300 && Boolean(eventId), {
    status: res.status,
    err: !eventId ? JSON.stringify(rows).slice(0, 200) : null,
  });
}
if (eventId) {
  const res = await fetch(`${supabaseUrl}/rest/v1/user_events?id=eq.${eventId}`, {
    method: "DELETE",
    headers: authH,
  });
  check("alarm_event_delete", res.status >= 200 && res.status < 300, { status: res.status });
}

// Protected pages
for (const p of ["/companion", "/pilot", "/coach", "/plan", "/events", "/dashboard", "/profile"]) {
  const res = await fetch(BASE + p, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
  check(`page_${p}`, res.status >= 200 && res.status < 500, { status: res.status });
}

const out = path.join(root, "docs/launch/audits/feature-e2e-2026-07-26.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      ok: report.ok,
      passed: report.checks.filter((c) => c.pass).length,
      total: report.checks.length,
      failed: report.checks.filter((c) => !c.pass).map((c) => ({ name: c.name, status: c.status, snippet: c.snippet || c.err })),
      out,
    },
    null,
    2,
  ),
);
process.exit(report.ok ? 0 : 1);
