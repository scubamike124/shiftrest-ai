#!/usr/bin/env node
// Hermetic backend for RestPilot end-to-end tests.
//
// Staging shares its Supabase project with production, so E2E journeys that
// sign up, write settings or delete accounts must never point at it. This
// process stands in for every backend the browser and the Node server talk to:
//
//   http://127.0.0.1:<port>/auth/v1/*      GoTrue-compatible auth (HS256 JWTs)
//   http://127.0.0.1:<port>/rest/v1/*      PostgREST-compatible tables + RPC,
//                                          with per-user row isolation (RLS-like)
//   http://127.0.0.1:<port>/__test/*       seed / reset / dump for assertions
//   http://127.0.0.1:<port>/<anything>     reverse-proxied to the app server
//   https://127.0.0.1:<aiPort>/v1/chat/completions
//                                          deterministic OpenAI-compatible model
//
// Serving Supabase and the app from one origin keeps the app's real CSP
// (connect-src 'self' + https Supabase origin) enforced during tests.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const JWT_SECRET = "restpilot-e2e-only-secret-not-used-anywhere-else-000";
const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function signJwt(payload, expiresIn = 3600, issuedAt = Math.floor(Date.now() / 1000)) {
  const body = { iat: issuedAt, exp: issuedAt + expiresIn, iss: "restpilot-e2e", ...payload };
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${head}.${b64u(JSON.stringify(body))}`;
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const sig = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${parts[0]}.${parts[1]}`)
    .digest("base64url");
  if (sig !== parts[2]) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (claims.exp && claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

// Fixed timestamps keep these keys stable, so a build baked with ANON_KEY keeps working.
export const ANON_KEY = signJwt({ role: "anon" }, 400_000_000, 1_700_000_000);
export const SERVICE_ROLE_KEY = signJwt({ role: "service_role" }, 400_000_000, 1_700_000_000);

// ------------------------------------------------------------------ state
const state = { users: new Map(), refresh: new Map(), tables: new Map(), log: [] };

function table(name) {
  if (!state.tables.has(name)) state.tables.set(name, []);
  return state.tables.get(name);
}

function reset() {
  state.users.clear();
  state.refresh.clear();
  state.tables.clear();
  state.log.length = 0;
}

function publicUser(u) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.confirmed_at,
    confirmed_at: u.confirmed_at,
    phone: "",
    last_sign_in_at: u.last_sign_in_at,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: u.user_metadata ?? {},
    identities: [],
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

function createUser({ email, password, user_metadata = {}, id }) {
  const lower = String(email).toLowerCase();
  for (const u of state.users.values())
    if (u.email === lower) return { error: "User already registered" };
  const now = new Date().toISOString();
  const u = {
    id: id || crypto.randomUUID(),
    email: lower,
    password,
    user_metadata,
    confirmed_at: now,
    created_at: now,
    updated_at: now,
    last_sign_in_at: null,
  };
  state.users.set(u.id, u);
  // Mirror the handle_new_user trigger: a profile row and default prefs.
  table("profiles").push({
    id: u.id,
    email: lower,
    display_name: user_metadata.display_name ?? null,
    created_at: now,
    updated_at: now,
  });
  table("user_prefs").push({ user_id: u.id, created_at: now, updated_at: now });
  return { user: u };
}

function session(u) {
  u.last_sign_in_at = new Date().toISOString();
  const access = signJwt({
    sub: u.id,
    email: u.email,
    role: "authenticated",
    aud: "authenticated",
    session_id: crypto.randomUUID(),
  });
  const refresh = crypto.randomBytes(24).toString("hex");
  state.refresh.set(refresh, u.id);
  return {
    access_token: access,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refresh,
    user: publicUser(u),
  };
}

// ------------------------------------------------------------------ helpers
function send(res, status, body, headers = {}) {
  const isStr = typeof body === "string";
  res.writeHead(status, {
    "content-type": isStr ? "text/plain" : "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
    "access-control-expose-headers": "content-range, x-total-count",
    ...headers,
  });
  res.end(body === undefined ? "" : isStr ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : req.headers.apikey || "";
}

function authContext(req) {
  const claims = verifyJwt(bearer(req));
  if (!claims) return { role: "anon" };
  return { role: claims.role || "anon", uid: claims.sub || null };
}

// ------------------------------------------------------------------ auth/v1
async function handleAuth(req, res, url) {
  const p = url.pathname.replace(/^\/auth\/v1/, "");
  const body = req.method === "GET" || req.method === "HEAD" ? null : await readBody(req);
  if (p === "/health" || p === "/settings") {
    return send(res, 200, {
      external: { email: true, google: false, apple: false },
      disable_signup: false,
      mailer_autoconfirm: true,
    });
  }
  if (p === "/signup" && req.method === "POST") {
    const { user, error } = createUser({
      email: body?.email,
      password: body?.password,
      user_metadata: body?.data,
    });
    if (error) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: error });
    return send(res, 200, session(user));
  }
  if (p === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const u = [...state.users.values()].find(
        (x) => x.email === String(body?.email).toLowerCase(),
      );
      if (!u || u.password !== body?.password) {
        return send(res, 400, {
          code: 400,
          error_code: "invalid_credentials",
          msg: "Invalid login credentials",
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        });
      }
      return send(res, 200, session(u));
    }
    if (grant === "refresh_token") {
      const uid = state.refresh.get(body?.refresh_token);
      const u = uid && state.users.get(uid);
      if (!u)
        return send(res, 400, {
          code: 400,
          error_code: "refresh_token_not_found",
          msg: "Invalid Refresh Token",
        });
      state.refresh.delete(body.refresh_token);
      return send(res, 200, session(u));
    }
    return send(res, 400, { msg: "unsupported grant" });
  }
  if (p === "/user") {
    const ctx = authContext(req);
    const u = ctx.uid && state.users.get(ctx.uid);
    if (!u) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    if (req.method === "PUT") {
      if (body?.email) u.email = String(body.email).toLowerCase();
      if (body?.password) u.password = body.password;
      if (body?.data) u.user_metadata = { ...u.user_metadata, ...body.data };
      u.updated_at = new Date().toISOString();
    }
    return send(res, 200, publicUser(u));
  }
  if (p === "/logout") return send(res, 204);
  if (["/recover", "/resend", "/otp", "/verify", "/magiclink"].includes(p)) {
    state.log.push({ type: "auth-email", path: p, body });
    return send(res, 200, {});
  }
  if (p === "/.well-known/jwks.json") return send(res, 200, { keys: [] });
  const admin = /^\/admin\/users(?:\/([^/]+))?$/.exec(p);
  if (admin) {
    if (authContext(req).role !== "service_role")
      return send(res, 403, { msg: "service role required" });
    const id = admin[1];
    if (!id && req.method === "POST") {
      const { user, error } = createUser({
        email: body?.email,
        password: body?.password,
        user_metadata: body?.user_metadata,
      });
      return error ? send(res, 422, { msg: error }) : send(res, 200, publicUser(user));
    }
    if (!id && req.method === "GET")
      return send(res, 200, {
        users: [...state.users.values()].map(publicUser),
        aud: "authenticated",
      });
    const u = state.users.get(id);
    if (!u)
      return send(res, 404, { code: 404, error_code: "user_not_found", msg: "User not found" });
    if (req.method === "GET") return send(res, 200, publicUser(u));
    if (req.method === "DELETE") {
      state.users.delete(id);
      state.log.push({ type: "auth-delete", id });
      return send(res, 200, {});
    }
    if (req.method === "PUT") {
      Object.assign(u, { user_metadata: { ...u.user_metadata, ...(body?.user_metadata ?? {}) } });
      return send(res, 200, publicUser(u));
    }
  }
  if (p.startsWith("/authorize"))
    return send(res, 400, { msg: "OAuth providers are not available in the E2E backend" });
  return send(res, 404, { msg: `auth endpoint not emulated: ${req.method} ${p}` });
}

// ------------------------------------------------------------------ rest/v1
const ISO = /^\d{4}-\d{2}-\d{2}/;
function coerce(raw, sample) {
  if (raw === "null") return null;
  if (typeof sample === "number") return Number(raw);
  if (typeof sample === "boolean") return raw === "true";
  if (sample === undefined || sample === null) {
    if (raw === "true" || raw === "false") return raw === "true";
  }
  return raw;
}
function compare(a, b) {
  if (typeof a === "string" && typeof b === "string" && ISO.test(a) && ISO.test(b)) {
    return Date.parse(a) - Date.parse(b);
  }
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
function splitList(s) {
  // "a,b,(c,d)" respecting parentheses and double quotes.
  const out = [];
  let depth = 0;
  let q = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim().replace(/^"|"$/g, ""));
}
function predicate(col, expr) {
  let negate = false;
  if (expr.startsWith("not.")) {
    negate = true;
    expr = expr.slice(4);
  }
  const dot = expr.indexOf(".");
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  const fn = (row) => {
    const v = row[col];
    switch (op) {
      case "eq":
        return v !== null && v !== undefined && compare(v, coerce(raw, v)) === 0;
      case "neq":
        return v !== null && v !== undefined && compare(v, coerce(raw, v)) !== 0;
      case "gt":
        return v != null && compare(v, coerce(raw, v)) > 0;
      case "gte":
        return v != null && compare(v, coerce(raw, v)) >= 0;
      case "lt":
        return v != null && compare(v, coerce(raw, v)) < 0;
      case "lte":
        return v != null && compare(v, coerce(raw, v)) <= 0;
      case "is":
        return raw === "null" ? v === null || v === undefined : String(v) === raw;
      case "in": {
        const list = splitList(raw.replace(/^\(|\)$/g, ""));
        return list.some((x) => v !== null && v !== undefined && String(v) === x);
      }
      case "like":
      case "ilike": {
        const re = new RegExp(
          "^" + raw.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*") + "$",
          op === "ilike" ? "i" : "",
        );
        return v != null && re.test(String(v));
      }
      case "cs": {
        const want = raw.startsWith("{") ? splitList(raw.slice(1, -1)) : JSON.parse(raw);
        return Array.isArray(v) && want.every((w) => v.map(String).includes(String(w)));
      }
      default:
        return true;
    }
  };
  return negate ? (row) => !fn(row) : fn;
}
function orPredicate(expr) {
  const parts = splitList(expr.replace(/^\(|\)$/g, ""));
  const preds = parts.map((part) => {
    const i = part.indexOf(".");
    return predicate(part.slice(0, i), part.slice(i + 1));
  });
  return (row) => preds.some((p) => p(row));
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);
function rowsFor(name, ctx) {
  const rows = table(name);
  if (ctx.role === "service_role") return rows;
  if (!ctx.uid) return rows.filter((r) => !("user_id" in r) && name !== "profiles");
  return rows.filter((r) =>
    name === "profiles" ? r.id === ctx.uid : !("user_id" in r) || r.user_id === ctx.uid,
  );
}
function applyFilters(rows, url) {
  let out = rows;
  for (const [k, v] of url.searchParams) {
    if (RESERVED.has(k)) continue;
    if (k === "or") out = out.filter(orPredicate(v));
    else if (k === "and") {
      for (const part of splitList(v.replace(/^\(|\)$/g, ""))) {
        const i = part.indexOf(".");
        out = out.filter(predicate(part.slice(0, i), part.slice(i + 1)));
      }
    } else out = out.filter(predicate(k.replace(/^.*\./, ""), v));
  }
  return out;
}
function applyOrder(rows, url) {
  const order = url.searchParams.get("order");
  if (!order) return rows;
  const keys = order.split(",").map((s) => {
    const [col, dir = "asc", nulls] = s.split(".");
    return { col, desc: dir === "desc", nullsFirst: nulls === "nullsfirst" };
  });
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const av = a[k.col];
      const bv = b[k.col];
      if (av == null && bv == null) continue;
      if (av == null) return k.nullsFirst ? -1 : 1;
      if (bv == null) return k.nullsFirst ? 1 : -1;
      const c = compare(av, bv);
      if (c) return k.desc ? -c : c;
    }
    return 0;
  });
}
function conflictKeys(name, url) {
  const oc = url.searchParams.get("on_conflict");
  if (oc) return oc.split(",");
  if (["user_prefs", "notification_prefs"].includes(name)) return ["user_id"];
  return ["id"];
}

const RPC = {
  has_ai_budget: () => true,
  has_role: () => false,
  consume_ai_request: () => ({ allowed: true, retry_after_seconds: null }),
  rate_limit_hit: () => 1,
  increment_trial_voice_usage: () => 0,
  apply_subscription_snapshot: () => null,
};

async function handleRest(req, res, url) {
  const name = decodeURIComponent(url.pathname.replace(/^\/rest\/v1\/?/, ""));
  const ctx = authContext(req);
  const prefer = String(req.headers.prefer || "");
  if (name.startsWith("rpc/")) {
    const fn = name.slice(4);
    const body = await readBody(req);
    state.log.push({ type: "rpc", fn, body, uid: ctx.uid });
    return send(res, 200, RPC[fn] ? RPC[fn](body, ctx) : null);
  }
  if (!name) return send(res, 200, {});
  const wantsObject = String(req.headers.accept || "").includes("vnd.pgrst.object");
  const returnRep = prefer.includes("return=representation");

  const single = (rows) => {
    if (rows.length !== 1) {
      return send(res, 406, {
        code: "PGRST116",
        details: `The result contains ${rows.length} rows`,
        hint: null,
        message: "JSON object requested, multiple (or no) rows returned",
      });
    }
    return send(res, 200, rows[0]);
  };

  if (req.method === "GET" || req.method === "HEAD") {
    let rows = applyOrder(applyFilters(rowsFor(name, ctx), url), url);
    const total = rows.length;
    let offset = Number(url.searchParams.get("offset") || 0);
    let limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const range = /^(\d+)-(\d+)$/.exec(String(req.headers.range || ""));
    if (range) {
      offset = Number(range[1]);
      limit = Number(range[2]) - offset + 1;
    }
    rows = rows.slice(offset, limit === undefined ? undefined : offset + limit);
    const headers = {
      "content-range": `${rows.length ? `${offset}-${offset + rows.length - 1}` : "*"}/${prefer.includes("count=") ? total : "*"}`,
    };
    if (req.method === "HEAD") return send(res, 200, undefined, headers);
    if (wantsObject) return single(rows);
    return send(res, 200, rows, headers);
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const items = (Array.isArray(body) ? body : [body]).filter(Boolean);
    const rows = table(name);
    const upsert =
      prefer.includes("resolution=merge-duplicates") ||
      prefer.includes("resolution=ignore-duplicates");
    const keys = conflictKeys(name, url);
    const now = new Date().toISOString();
    const written = [];
    for (const item of items) {
      const row = { ...item };
      if (ctx.role !== "service_role") {
        if (name === "profiles") row.id ??= ctx.uid;
        else if (!("user_id" in row) && ctx.uid) row.user_id = ctx.uid;
        if (row.user_id && row.user_id !== ctx.uid)
          return send(res, 403, {
            code: "42501",
            message: "new row violates row-level security policy",
          });
      }
      const existing = upsert
        ? rows.find((r) => keys.every((k) => r[k] !== undefined && r[k] === row[k]))
        : undefined;
      if (existing) {
        if (prefer.includes("resolution=merge-duplicates"))
          Object.assign(existing, row, { updated_at: now });
        written.push(existing);
      } else {
        const created = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...row };
        if (["user_prefs", "notification_prefs"].includes(name) && !item.id) delete created.id;
        rows.push(created);
        written.push(created);
      }
    }
    state.log.push({ type: "insert", table: name, count: written.length, uid: ctx.uid });
    if (!returnRep) return send(res, 201, undefined);
    return wantsObject ? single(written) : send(res, 201, written);
  }

  if (req.method === "PATCH") {
    const body = await readBody(req);
    const target = applyFilters(rowsFor(name, ctx), url);
    const now = new Date().toISOString();
    for (const r of target) Object.assign(r, body, { updated_at: now });
    state.log.push({ type: "update", table: name, count: target.length, uid: ctx.uid });
    if (!returnRep) return send(res, 204);
    return wantsObject ? single(target) : send(res, 200, target);
  }

  if (req.method === "DELETE") {
    const target = new Set(applyFilters(rowsFor(name, ctx), url));
    const rows = table(name);
    const removed = rows.filter((r) => target.has(r));
    state.tables.set(
      name,
      rows.filter((r) => !target.has(r)),
    );
    state.log.push({ type: "delete", table: name, count: removed.length, uid: ctx.uid });
    if (!returnRep) return send(res, 204);
    return send(res, 200, removed);
  }
  return send(res, 405, { message: "method not allowed" });
}

// ------------------------------------------------------------------ test control
async function handleTest(req, res, url) {
  const p = url.pathname.replace(/^\/__test/, "");
  if (p === "/reset" && req.method === "POST") {
    reset();
    return send(res, 200, { ok: true });
  }
  if (p === "/seed" && req.method === "POST") {
    const body = (await readBody(req)) || {};
    const users = [];
    for (const u of body.users ?? []) {
      const existing = [...state.users.values()].find(
        (x) => x.email === String(u.email).toLowerCase(),
      );
      users.push(
        existing
          ? { id: existing.id, email: existing.email }
          : (() => {
              const { user } = createUser(u);
              return { id: user.id, email: user.email };
            })(),
      );
    }
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u.id]));
    for (const [name, rows] of Object.entries(body.tables ?? {})) {
      for (const r of rows) {
        const row = { ...r };
        if (row.user_email) {
          row[name === "profiles" ? "id" : "user_id"] =
            byEmail[String(row.user_email).toLowerCase()];
          delete row.user_email;
        }
        const t = table(name);
        const key = name === "user_prefs" ? "user_id" : name === "profiles" ? "id" : null;
        const existing = key ? t.find((x) => x[key] === row[key]) : null;
        if (existing) Object.assign(existing, row);
        else t.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row });
      }
    }
    return send(res, 200, { ok: true, users });
  }
  if (p === "/dump" && req.method === "GET") {
    const email = url.searchParams.get("email");
    const byEmail = email
      ? [...state.users.values()].find((x) => x.email === email.toLowerCase())
      : null;
    const id = url.searchParams.get("userId") || byEmail?.id || null;
    const tables = {};
    for (const [name, rows] of state.tables) {
      // A lookup that matches nobody returns no rows, never everyone's rows.
      tables[name] = id
        ? rows.filter((r) => r.user_id === id || (name === "profiles" && r.id === id))
        : email
          ? []
          : rows;
    }
    const log = id ? state.log.filter((l) => !l.uid || l.uid === id) : state.log;
    return send(res, 200, {
      userExists: id ? state.users.has(id) : false,
      userId: id,
      tables,
      log,
    });
  }
  if (p === "/ai-calls" && req.method === "GET") return send(res, 200, aiCalls);

  return send(res, 404, { msg: "unknown test endpoint" });
}

// ------------------------------------------------------------------ fake model
const aiCalls = [];
// Failure modes are chosen per user, not globally, so parallel tests never
// interfere: a user whose assistant is named E2EMalformedJson gets valid JSON
// that omits fields and breaks enums (model drift); E2EUpstreamError gets 500s.
function aiModeFor(body) {
  const text = (body.messages ?? []).map((m) => String(m.content ?? "")).join("\n");
  if (text.includes("E2EMalformedJson")) return "minimal-json";
  if (text.includes("E2EUpstreamError")) return "error";
  return "normal";
}
export const FAKE_REPLY =
  "Have your last coffee by 1 a.m. so it clears before your 8 a.m. sleep. Then switch to water and keep the lights low on the drive home.";

async function handleAi(req, res) {
  const body = (await readBody(req)) || {};
  aiCalls.push({
    model: body.model,
    stream: Boolean(body.stream),
    messages: body.messages?.length ?? 0,
    at: Date.now(),
  });
  const aiMode = aiModeFor(body);
  if (aiMode === "error") return send(res, 500, { error: { message: "upstream failure (E2E)" } });
  if (!body.stream && aiMode === "minimal-json") {
    return send(res, 200, {
      id: "chatcmpl-e2e",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({ headline: "Only a headline", urgency: "critical" }),
          },
          finish_reason: "stop",
        },
      ],
    });
  }
  if (!body.stream) {
    // JSON intents (plans, briefs, insights): one object carrying the fields
    // every intent schema asks for, so each widget renders deterministically.
    const now = Date.now();
    const iso = (h) => new Date(now + h * 3600_000).toISOString();
    const content = JSON.stringify({
      // shared
      headline: "Protect tonight's sleep window",
      summary: "Short sleep after nights; keep the next window protected.",
      confidence: "medium",
      confidenceReason: "Medium confidence: working from your schedule alone",
      impact: {
        today: "Steadier energy on shift",
        tomorrow: "Deeper day sleep",
        week: "Less sleep debt",
      },
      // daily_plan
      riskLevel: "low",
      actions: [
        {
          id: "a1",
          title: "Last caffeine by 1 a.m.",
          detail: "Clears before your 8 a.m. sleep so it is deeper.",
          category: "caffeine",
          priority: 1,
          when: "1:00 AM",
        },
        {
          id: "a2",
          title: "Dark glasses on the drive home",
          detail: "Morning light would push your body clock later.",
          category: "light",
          priority: 2,
          when: "7:15 AM",
        },
      ],
      // smart_alarm / commute / coach_tip
      wakeAt: iso(8),
      reason: "Lands near the end of a sleep cycle.",
      cyclePosition: "light_sleep",
      message: "Morning. Easy start.",
      leaveAt: iso(1),
      prepStartAt: iso(0.5),
      advice: "Leave ten minutes early and skip the coffee stop.",
      tip: "Keep the room cold and dark.",
      generatedAt: iso(0),
      // right_now
      action: "Get 10 minutes of daylight now",
      why: "Your next shift starts in five hours.",
      followBenefit: "Keeps tonight's alertness steady.",
      ignoreCost: "Energy dips mid-shift.",
      urgency: "soon",
      timeWindow: { startIso: iso(0), endIso: iso(1) },
      ctaLabel: "See full plan",
      ctaRoute: "/plan",
      // adjust_plan / tomorrow_preview / jetlag_plan
      ifIgnored: "Sleep debt keeps building.",
      changes: [
        { label: "Bedtime", from: "9:00 AM", to: "8:30 AM", reason: "More recovery after nights." },
      ],
      blocks: [
        {
          kind: "sleep",
          day: "Today",
          title: "Main sleep",
          when: "8:30 AM",
          detail: "Seven hours in a dark room.",
        },
        {
          kind: "light",
          day: "Today",
          title: "Daylight walk",
          when: "4:00 PM",
          detail: "Anchors your body clock.",
        },
      ],
      phase: "pre",
      directionEast: true,
      clockBasis: "home",
      // daily_review
      wins: ["Caffeine stopped on time"],
      drains: ["Short sleep after the late shift"],
      metrics: { sleepRecoveredMin: 30, readinessDelta: 2, recoveryTrend: "flat" },
      tomorrowFocus: "Start wind-down 20 minutes earlier.",
      // insights (dashboard briefing)
      greeting: "Good afternoon",
      fatigue_note: "Fatigue is moderate after two short sleeps.",
      top_actions: [
        { icon: "coffee", title: "Caffeine cut-off", detail: "Last cup by 1 a.m." },
        { icon: "light", title: "Morning light", detail: "Dark glasses on the drive home." },
        { icon: "moon", title: "Protect sleep", detail: "Lights out by 8:30 a.m." },
      ],
      coach_note: "One steady night at a time.",
    });
    return send(res, 200, {
      id: "chatcmpl-e2e",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
    });
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const word of FAKE_REPLY.split(/(?<= )/)) {
    res.write(
      `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: word } }] })}\n\n`,
    );
  }
  res.write(
    `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
  );
  res.end("data: [DONE]\n\n");
}

// ------------------------------------------------------------------ proxy
const noKeepAlive = new http.Agent({ keepAlive: false });

function proxy(req, res, appUrl) {
  const target = new URL(req.url, appUrl);
  const up = http.request(
    target,
    {
      method: req.method,
      // Node's default agent keeps sockets alive; reusing one the app server
      // already closed surfaces as ECONNRESET. A fresh socket per request is fine here.
      agent: noKeepAlive,
      headers: {
        ...req.headers,
        host: target.host,
        "x-forwarded-host": req.headers.host,
        "x-forwarded-proto": "http",
      },
    },
    (r) => {
      // Diagnostic knob for the iOS simulator runs (ios-maestro.yml): drop the
      // app's Cross-Origin-Opener-Policy header so the WebView does not swap
      // web processes on the first navigation. Off by default.
      if (process.env.E2E_STRIP_COOP === "1") delete r.headers["cross-origin-opener-policy"];
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    },
  );
  up.on("error", (e) => send(res, 502, `app server unavailable: ${e.message}`));
  req.pipe(up);
}

// ------------------------------------------------------------------ TLS for the fake model
export function ensureCert(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "30",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1,DNS:localhost",
      ],
      { stdio: "ignore" },
    );
  }
  return { key, cert };
}

export function startFakeBackend({
  port = 3000,
  appUrl = "http://127.0.0.1:3001",
  aiPort = 0,
  certDir,
} = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
      if (req.method === "OPTIONS" && /^\/(auth|rest|storage|functions)\/v1/.test(url.pathname))
        return send(res, 204);
      if (url.pathname.startsWith("/auth/v1")) return await handleAuth(req, res, url);
      if (url.pathname.startsWith("/rest/v1")) return await handleRest(req, res, url);
      if (url.pathname.startsWith("/storage/v1") || url.pathname.startsWith("/functions/v1"))
        return send(res, 200, {});
      if (url.pathname.startsWith("/__test")) return await handleTest(req, res, url);
      return proxy(req, res, appUrl);
    } catch (e) {
      send(res, 500, { message: String(e?.stack || e) });
    }
  });
  server.listen(port, "127.0.0.1");
  let aiServer = null;
  let tls = null;
  if (aiPort && certDir) {
    try {
      tls = ensureCert(certDir);
    } catch (e) {
      console.warn(
        `[fake-backend] no TLS certificate (openssl failed: ${e.message}); fake model disabled`,
      );
    }
  }
  if (tls) {
    const { key, cert } = tls;
    aiServer = https.createServer(
      { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
      async (req, res) => {
        if (req.url.endsWith("/chat/completions") && req.method === "POST")
          return handleAi(req, res);
        return send(res, 404, { error: { message: "not emulated" } });
      },
    );
    aiServer.listen(aiPort, "127.0.0.1");
  }
  return { server, aiServer };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.E2E_PORT || 3000);
  const appUrl = process.env.E2E_APP_URL || "http://127.0.0.1:3001";
  const aiPort = Number(process.env.E2E_AI_PORT || 3443);
  const certDir = process.env.E2E_CERT_DIR || path.resolve("tests/e2e/.results/certs");
  startFakeBackend({ port, appUrl, aiPort, certDir });
  console.log(
    `[fake-backend] supabase+proxy http://127.0.0.1:${port} -> ${appUrl}; model https://127.0.0.1:${aiPort}/v1`,
  );
}
