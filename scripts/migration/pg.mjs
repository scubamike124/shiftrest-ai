// psql process helpers for the migration kit. Connection details are passed
// through libpq environment variables, never argv, so the database password
// does not appear in process listings or logs.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import readline from "node:readline";

export function pgEnv(url) {
  const u = new URL(url);
  if (!/^postgres(ql)?:$/.test(u.protocol))
    throw new Error("TARGET_DB_URL must be a postgresql:// URL");
  const env = { ...process.env };
  for (const k of [
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGPASSWORD",
    "PGDATABASE",
    "PGSSLMODE",
    "PGSERVICE",
    "PGOPTIONS",
  ])
    delete env[k];
  const q = u.searchParams;
  env.PGHOST = q.get("host") || decodeURIComponent(u.hostname);
  env.PGPORT = q.get("port") || u.port || "5432";
  env.PGUSER = decodeURIComponent(u.username || "postgres");
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  env.PGDATABASE = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  const ssl = q.get("sslmode");
  if (ssl) env.PGSSLMODE = ssl;
  else if (!env.PGHOST.startsWith("/") && !["localhost", "127.0.0.1", "::1"].includes(env.PGHOST))
    env.PGSSLMODE = "require";
  env.PGAPPNAME = "restpilot-migration-kit";
  env.PGCONNECT_TIMEOUT = "20";
  return env;
}

const PSQL = () => process.env.PSQL || "psql";
// VERBOSITY=terse keeps DETAIL/CONTEXT/LINE excerpts (row values, interpolated
// secrets) out of error messages, which end up in runner logs.
const BASE_ARGS = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=terse"];

// Run psql with arguments; throws with stderr (which never contains the
// password) on failure.
export function psql(url, args, { input } = {}) {
  const r = spawnSync(PSQL(), [...BASE_ARGS, ...args], {
    env: pgEnv(url),
    encoding: "utf8",
    input,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0)
    throw new Error(`psql exited ${r.status}: ${(r.stderr || "").trim().slice(0, 4000)}`);
  return r.stdout;
}

export function query(url, sql) {
  return psql(url, ["-At", "-F", "\t", "-c", sql])
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => l.split("\t"));
}

export function queryJson(url, sql) {
  const out = psql(url, ["-At", "-c", `select coalesce(json_agg(t), '[]') from (${sql}) t`]).trim();
  return JSON.parse(out || "[]");
}

// pg_dump renders COPY text with these settings; mirror them so the target's
// COPY output is byte-comparable with the archive.
export const COPY_SETTINGS = [
  "SET DateStyle = ISO",
  "SET IntervalStyle = postgres",
  "SET extra_float_digits = 3",
  "SET TimeZone = 'UTC'",
  "SET bytea_output = hex",
  "SET standard_conforming_strings = on",
];

// Stream `COPY (select cols from table) TO STDOUT` and return
// { rows, sha256 } with the same order-independent hash as plan.mjs.
export async function copyDigest(url, table, columns) {
  const args = [...BASE_ARGS];
  for (const s of COPY_SETTINGS) args.push("-c", s);
  args.push("-c", `COPY (SELECT ${columns} FROM ${table}) TO STDOUT`);
  const child = spawn(PSQL(), args, { env: pgEnv(url), stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  const rows = [];
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const l of rl) rows.push(l);
  const code = await new Promise((res) => child.on("close", res));
  if (code !== 0) throw new Error(`COPY from ${table} failed: ${stderr.trim().slice(0, 1000)}`);
  rows.sort();
  const h = createHash("sha256");
  for (const r of rows) h.update(r + "\n");
  return { rows: rows.length, sha256: h.digest("hex") };
}
