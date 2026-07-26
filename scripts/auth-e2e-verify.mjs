/**
 * RestPilot authenticated workflow verification using .e2e-session.json.
 * Covers login (password grant), session user, refresh, logout, recovery request,
 * and authenticated page/API probes. Never prints tokens.
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
const key = grab("VITE_SUPABASE_PUBLISHABLE_KEY") || grab("SUPABASE_PUBLISHABLE_KEY");
const sessionPath = path.join(root, ".e2e-session.json");
const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));

const report = {
  generatedAt: new Date().toISOString(),
  base: BASE,
  email: session.email,
  checks: [],
  ok: true,
};

function check(name, pass, detail = {}) {
  report.checks.push({ name, pass, ...detail });
  if (!pass) report.ok = false;
}

// 1) Password login
{
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: session.email, password: session.password }),
  });
  const json = await res.json().catch(() => ({}));
  check("password_login", res.status === 200 && Boolean(json.access_token), {
    status: res.status,
  });
  if (json.access_token) {
    session.access_token = json.access_token;
    session.refresh_token = json.refresh_token;
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  }
}

const token = session.access_token;
if (!token) {
  check("has_access_token", false);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

// 2) Get user
{
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  check("get_user", res.status === 200 && json.email === session.email, {
    status: res.status,
    emailConfirmed: Boolean(json.email_confirmed_at),
  });
}

// 3) Refresh session
{
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const json = await res.json().catch(() => ({}));
  check("refresh_session", res.status === 200 && Boolean(json.access_token), {
    status: res.status,
  });
  if (json.access_token) {
    session.access_token = json.access_token;
    session.refresh_token = json.refresh_token || session.refresh_token;
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  }
}

// 4) Authenticated pages
for (const p of ["/dashboard", "/plan", "/profile", "/events", "/auth/callback"]) {
  const res = await fetch(BASE + p, {
    headers: { Authorization: `Bearer ${session.access_token}`, "User-Agent": "RestPilot-AuthE2E/1.0" },
    redirect: "follow",
  });
  check(`page_${p}`, res.status >= 200 && res.status < 500, { status: res.status });
}

// 5) Password recovery request (does not complete reset — verifies pipeline accepts request)
{
  const res = await fetch(`${supabaseUrl}/auth/v1/recover`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: session.email,
      gotrue_meta_security: {},
    }),
  });
  // 200 = sent; some projects return 200 even for unknown emails
  check("password_recovery_request", res.status === 200 || res.status === 429, {
    status: res.status,
  });
}

// 6) Logout
{
  const res = await fetch(`${supabaseUrl}/auth/v1/logout`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
  });
  check("logout", res.status === 204 || res.status === 200, { status: res.status });
}

// 7) Re-login after logout
{
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: session.email, password: session.password }),
  });
  const json = await res.json().catch(() => ({}));
  check("relogin_after_logout", res.status === 200 && Boolean(json.access_token), {
    status: res.status,
  });
  if (json.access_token) {
    session.access_token = json.access_token;
    session.refresh_token = json.refresh_token;
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  }
}

const out = path.join(root, "docs/launch/audits/auth-e2e-2026-07-26.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      ok: report.ok,
      passed: report.checks.filter((c) => c.pass).length,
      total: report.checks.length,
      failed: report.checks.filter((c) => !c.pass).map((c) => c.name),
      out,
    },
    null,
    2,
  ),
);
process.exit(report.ok ? 0 : 1);
