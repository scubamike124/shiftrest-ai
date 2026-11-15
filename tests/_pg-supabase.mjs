// A real PostgreSQL database with this repository's migrations applied, for
// tests that must not be satisfied by a mock (column names, ORDER BY targets,
// triggers, RLS). Mocked Supabase clients accept any column, which is how an
// export ordered by a column that does not exist once reached a PR green.
//
// Where the database comes from, in order:
//   1. RESTPILOT_TEST_DATABASE_URL (CI starts a postgres:16 service and sets
//      it). The database must be empty and disposable: it is dropped and
//      recreated as a fresh database named restpilot_test_<pid>.
//   2. A throwaway local cluster, when PostgreSQL server binaries are
//      installed (/usr/lib/postgresql/<v>/bin or PG_BIN). Created in a temp
//      dir, on a random port, and stopped at the end of the test file.
//   3. Otherwise the caller skips. Under CI (process.env.CI) a missing
//      database is an error instead, so the check can never silently vanish.
//
// Supabase-only pieces are replaced with minimal stand-ins: the anon /
// authenticated / service_role roles, auth.users + auth.uid()/role()/jwt(),
// and no-op pgmq/cron/vault/net schemas (the email-queue migrations reference
// them; nothing under test uses them). CREATE EXTENSION for those four
// Supabase extensions is rewritten to a no-op; every other statement in every
// migration runs unchanged, in filename order.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MIGRATIONS = new URL("../supabase/migrations/", import.meta.url);
const SUPABASE_ONLY_EXTENSIONS = ["pg_cron", "pg_net", "supabase_vault", "pgmq"];

const BOOTSTRAP = `
-- Roles are cluster-wide and test files run in parallel against one server,
-- so tolerate another file creating them at the same moment.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $f$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $f$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $f$ SELECT jsonb_build_object('sub', auth.uid(), 'role', auth.role()) $f$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO service_role;

CREATE SCHEMA pgmq;
CREATE FUNCTION pgmq.create(q text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE FUNCTION pgmq.send(q text, m jsonb) RETURNS bigint LANGUAGE sql AS $f$ SELECT 0::bigint $f$;
CREATE FUNCTION pgmq.delete(q text, id bigint) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE FUNCTION pgmq.read(q text, vt integer, n integer)
  RETURNS TABLE(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
  LANGUAGE sql AS $f$ SELECT NULL::bigint, NULL::int, NULL::timestamptz, NULL::timestamptz, NULL::jsonb WHERE false $f$;
CREATE SCHEMA cron;
CREATE FUNCTION cron.schedule(a text, b text, c text) RETURNS bigint LANGUAGE sql AS $f$ SELECT 0::bigint $f$;
CREATE FUNCTION cron.unschedule(a text) RETURNS boolean LANGUAGE sql AS $f$ SELECT true $f$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, secret text);
CREATE FUNCTION vault.create_secret(s text, n text) RETURNS uuid LANGUAGE sql AS $f$ SELECT gen_random_uuid() $f$;
CREATE FUNCTION vault.update_secret(i uuid, s text) RETURNS void LANGUAGE sql AS $f$ SELECT $f$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 1000)
  RETURNS bigint LANGUAGE sql AS $f$ SELECT 0::bigint $f$;
`;

function rewriteMigration(sql) {
  let out = sql;
  for (const ext of SUPABASE_ONLY_EXTENSIONS) {
    // Top-level form → plain no-op statement.
    out = out.replace(
      new RegExp(`CREATE EXTENSION IF NOT EXISTS ${ext}\\b[^;]*;`, "gi"),
      "SELECT 1;",
    );
    // Inside a DO block (plpgsql) → PERFORM.
    out = out.replace(new RegExp(`CREATE EXTENSION ${ext}\\b[^;]*;`, "gi"), "PERFORM 1;");
  }
  return out;
}

function findPgBin() {
  const candidates = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  try {
    for (const v of fs.readdirSync("/usr/lib/postgresql").sort().reverse()) {
      candidates.push(`/usr/lib/postgresql/${v}/bin`);
    }
  } catch {
    /* not installed */
  }
  return candidates.find(
    (d) => fs.existsSync(path.join(d, "initdb")) && fs.existsSync(path.join(d, "pg_ctl")),
  );
}

function psqlAvailable() {
  return spawnSync("psql", ["--version"]).status === 0;
}

/** Run initdb/pg_ctl as the postgres OS user when we are root (initdb refuses root). */
function asPgUser(cmd, args) {
  if (process.getuid?.() === 0) {
    const quoted = [cmd, ...args].map((a) => `'${String(a).replaceAll("'", "'\\''")}'`).join(" ");
    return execFileSync("su", ["postgres", "-s", "/bin/sh", "-c", quoted], { stdio: "pipe" });
  }
  return execFileSync(cmd, args, { stdio: "pipe" });
}

function startLocalCluster(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "restpilot-pg-"));
  if (process.getuid?.() === 0) execFileSync("chown", ["postgres", dir]);
  const data = path.join(dir, "data");
  const port = 20000 + Math.floor(Math.random() * 20000);
  asPgUser(path.join(bin, "initdb"), ["-D", data, "-A", "trust", "-U", "postgres", "--no-sync"]);
  asPgUser(path.join(bin, "pg_ctl"), [
    "-D",
    data,
    "-w",
    "-l",
    path.join(dir, "log"),
    "-o",
    `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off`,
    "start",
  ]);
  return {
    url: `postgresql://postgres@localhost:${port}/postgres?host=${encodeURIComponent(dir)}`,
    stop() {
      try {
        asPgUser(path.join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "stop"]);
      } catch {
        /* already gone */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function withDb(url, db) {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/**
 * Returns { skip: reason } or a database handle:
 *   sql(text)          run statements, throw on the first error (ON_ERROR_STOP)
 *   json(query)        run one SELECT, return its rows as parsed JSON
 *   stop()             drop the database / stop the local cluster
 */
export function startMigratedDatabase() {
  if (!psqlAvailable()) {
    if (process.env.CI) throw new Error("psql is required for the PostgreSQL-backed tests in CI");
    return { skip: "psql not installed" };
  }
  let base = process.env.RESTPILOT_TEST_DATABASE_URL;
  let cluster = null;
  if (!base) {
    const bin = findPgBin();
    if (!bin) {
      if (process.env.CI) {
        throw new Error(
          "Set RESTPILOT_TEST_DATABASE_URL (CI starts a postgres service) for the PostgreSQL-backed tests",
        );
      }
      return { skip: "no RESTPILOT_TEST_DATABASE_URL and no local PostgreSQL server binaries" };
    }
    cluster = startLocalCluster(bin);
    base = cluster.url;
  }
  const dbName = `restpilot_test_${process.pid}`;
  const run = (url, args, input) =>
    execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-d", url, ...args], {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  run(base, ["-c", `DROP DATABASE IF EXISTS ${dbName}`]);
  run(base, ["-c", `CREATE DATABASE ${dbName}`]);
  const url = withDb(base, dbName);
  const sql = (text) => {
    try {
      return run(url, ["-f", "-"], text);
    } catch (err) {
      const e = new Error(String(err.stderr || err.message).trim());
      e.stderr = err.stderr;
      throw e;
    }
  };
  sql(BOOTSTRAP);
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    try {
      sql(rewriteMigration(fs.readFileSync(new URL(f, MIGRATIONS), "utf8")));
    } catch (err) {
      throw new Error(`migration ${f} failed on PostgreSQL: ${err.message}`);
    }
  }
  return {
    url,
    migrations: files,
    sql,
    json(query) {
      // jsonb_agg prints on one line (json_agg inserts newlines between rows).
      const out = sql(
        `\\pset format unaligned\n\\pset tuples_only on\nSELECT coalesce(jsonb_agg(q), '[]'::jsonb) FROM (${query}) q;`,
      );
      return JSON.parse(out.trim());
    },
    stop() {
      try {
        run(base, ["-c", `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`]);
      } catch {
        /* best effort */
      }
      cluster?.stop();
    },
  };
}

export const quoteIdent = (name) => `"${String(name).replaceAll('"', '""')}"`;
export const quoteLiteral = (v) => `'${String(v).replaceAll("'", "''")}'`;
