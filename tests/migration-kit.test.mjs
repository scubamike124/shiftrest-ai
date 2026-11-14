// Unit tests for the Lovable Cloud -> Supabase migration kit's pure helpers.
// The end-to-end rehearsal (real PostgreSQL) is scripts/migration/rehearsal/run.sh.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertSafeTarget,
  classifyEntry,
  columnProblems,
  createCopyParser,
  extensionPrologue,
  parseTocLine,
  planFromToc,
  redactUrl,
  splitColumns,
  splitQualified,
  summariseCronCommand,
} from "../scripts/migration/lib.mjs";
import { buildAuthPatch, describeChanges } from "../scripts/migration/auth-config.mjs";

const toc = (s) => parseTocLine(s);

test("parses pg_restore list lines, including multi-word descs and tags", () => {
  assert.deepEqual(
    (({ desc, namespace, tag, owner }) => ({ desc, namespace, tag, owner }))(
      toc("4300; 0 16400 TABLE DATA auth users postgres"),
    ),
    { desc: "TABLE DATA", namespace: "auth", tag: "users", owner: "postgres" },
  );
  const pol = toc("4600; 3256 16900 POLICY public profiles Users can view own profile postgres");
  assert.equal(pol.desc, "POLICY");
  assert.equal(pol.tag, "profiles Users can view own profile");
  const ext = toc("3; 3079 16390 EXTENSION - pgcrypto ");
  assert.equal(ext.desc, "EXTENSION");
  assert.equal(ext.tag, "pgcrypto");
  assert.equal(ext.owner, "");
  assert.equal(
    toc("12; 0 0 FK CONSTRAINT public shifts shifts_user_id_fkey postgres").desc,
    "FK CONSTRAINT",
  );
  assert.equal(toc("; comment"), null);
});

test("restores app schema and data, account rows, never GoTrue internals", () => {
  const c = (s) => classifyEntry(toc(s)).section;
  assert.equal(c("1; 1259 1 TABLE public profiles postgres"), "schema");
  assert.equal(c("2; 0 1 TABLE DATA public profiles postgres"), "data");
  assert.equal(c("3; 0 1 ACL public TABLE profiles postgres"), "schema");
  assert.equal(c("4; 0 1 TABLE DATA auth users supabase_auth_admin"), "data");
  assert.equal(c("5; 0 1 TABLE DATA auth identities supabase_auth_admin"), "data");
  assert.equal(c("6; 0 1 TABLE DATA auth sessions supabase_auth_admin"), "skip");
  assert.equal(c("7; 0 1 TABLE DATA auth refresh_tokens supabase_auth_admin"), "skip");
  assert.equal(c("8; 0 1 TABLE DATA auth schema_migrations supabase_auth_admin"), "skip");
  assert.equal(c("9; 1259 1 TABLE auth users supabase_auth_admin"), "skip");
  assert.equal(c("10; 2620 1 TRIGGER auth users on_auth_user_created postgres"), "schema");
  assert.equal(c("11; 2615 1 SCHEMA - public pg_database_owner"), "skip");
  assert.equal(c("12; 0 1 TABLE DATA cron job postgres"), "skip");
  assert.equal(c("13; 0 1 TABLE DATA vault secrets supabase_admin"), "skip");
  assert.equal(c("14; 1259 1 TABLE pgmq q_auth_emails postgres"), "skip");
  assert.equal(c("15; 0 1 TABLE DATA supabase_migrations schema_migrations postgres"), "data");
  assert.equal(
    c("16; 1259 1 TABLE supabase_migrations schema_migrations postgres"),
    "migrations-schema",
  );
  assert.equal(
    c("17; 0 1 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES supabase_admin"),
    "skip",
  );
  assert.equal(c("18; 0 1 TABLE DATA storage buckets supabase_storage_admin"), "data");
  assert.equal(c("19; 1259 1 TABLE app_private things postgres"), "schema");
});

test("plan collects extensions, queues and keeps list order", () => {
  const entries = [
    "1; 0 0 ENCODING - ENCODING ",
    "2; 3079 1 EXTENSION - pgmq ",
    "3; 1259 1 TABLE pgmq q_auth_emails postgres",
    "4; 1259 1 TABLE public profiles postgres",
    "5; 0 1 TABLE DATA public profiles postgres",
  ].map(toc);
  const { lists, info } = planFromToc(entries);
  assert.deepEqual(info.extensions, ["pgmq"]);
  assert.deepEqual(info.queues, ["auth_emails"]);
  assert.equal(lists.schema.length, 2); // ENCODING + TABLE
  assert.equal(lists.data.length, 2); // ENCODING + DATA
  assert.match(
    extensionPrologue(["pgcrypto", "pgmq", "plpgsql"]),
    /"pgcrypto" with schema extensions;\ncreate extension if not exists "pgmq";/,
  );
});

test("COPY manifest is order independent and detects changes", () => {
  const run = (lines) => {
    const p = createCopyParser(createHash);
    lines.forEach((l) => p.line(l));
    return p.result();
  };
  const a = run(['COPY public.t (id, "trigger") FROM stdin;', "1\tx", "2\ty", "\\."]);
  const b = run(['COPY public.t (id, "trigger") FROM stdin;', "2\ty", "1\tx", "\\."]);
  const c = run(['COPY public.t (id, "trigger") FROM stdin;', "2\ty", "1\tz", "\\."]);
  assert.equal(a["public.t"].rows, 2);
  assert.equal(a["public.t"].sha256, b["public.t"].sha256);
  assert.notEqual(a["public.t"].sha256, c["public.t"].sha256);
  assert.deepEqual(splitColumns(a["public.t"].columns), ["id", "trigger"]);
  assert.throws(() => run(["COPY public.t (id) FROM stdin;", "1"]), /unterminated/);
});

test("column compatibility flags missing and newly-required columns", () => {
  const target = [
    { name: "id", notNull: true, hasDefault: false, generated: false },
    { name: "email", notNull: false, hasDefault: false, generated: false },
    { name: "confirmed_at", notNull: false, hasDefault: false, generated: true },
    { name: "new_required", notNull: true, hasDefault: false, generated: false },
  ];
  assert.deepEqual(columnProblems(["id", "email", "old_col"], target), [
    "target lacks column old_col",
    "target requires column new_required that the archive does not provide",
  ]);
  assert.deepEqual(splitQualified('auth."users"'), { schema: "auth", table: "users" });
});

test("never targets the live Lovable backend; requires explicit confirmation", () => {
  assert.throws(
    () =>
      assertSafeTarget(
        "postgresql://postgres.czsgjqfcjiuqirvmdlps:p@h:5432/postgres",
        "czsgjqfcjiuqirvmdlps",
      ),
    /live Lovable/,
  );
  assert.throws(
    () => assertSafeTarget("postgresql://postgres.abcdefghijklmnopqrst:p@h:5432/postgres"),
    /confirm-target/,
  );
  assert.throws(
    () => assertSafeTarget("postgresql://postgres.abcdefghijklmnopqrst:p@h:5432/postgres", "zzzz"),
    /does not match/,
  );
  assert.doesNotThrow(() =>
    assertSafeTarget(
      "postgresql://postgres.abcdefghijklmnopqrst:p@h:5432/postgres",
      "abcdefghijklmnopqrst",
    ),
  );
  assert.equal(redactUrl("postgresql://u:secret@h:5432/db").includes("secret"), false);
});

test("cron command summary keeps host/path/header names, never values", () => {
  const s = summariseCronCommand(
    "select net.http_post(url := 'https://restpilotai.com/api/public/hooks/notify', headers := jsonb_build_object('x-cron-secret', 'abc123SECRET', 'Content-Type', 'application/json'))",
  );
  assert.deepEqual(s.target, { host: "restpilotai.com", path: "/api/public/hooks/notify" });
  assert.equal(JSON.stringify(s).includes("abc123SECRET"), false);
  assert.ok(s.headerNames.includes("x-cron-secret"));
});

test("auth settings: allow-list per origin, Google and hook only with credentials", () => {
  const p = buildAuthPatch({
    siteUrl: "https://restpilotai.com/",
    appOrigins: [
      "https://www.restpilotai.com",
      "https://restpilot-web-staging.up.railway.app/auth",
    ],
  });
  assert.equal(p.site_url, "https://restpilotai.com");
  assert.equal(
    p.uri_allow_list,
    "https://restpilotai.com/**,https://www.restpilotai.com/**,https://restpilot-web-staging.up.railway.app/**",
  );
  assert.equal(p.external_google_enabled, undefined);
  assert.throws(() => buildAuthPatch({ siteUrl: "http://example.com", appOrigins: [] }), /https/);
  const secret = "v1,whsec_" + Buffer.alloc(32, 7).toString("base64");
  const q = buildAuthPatch({
    siteUrl: "https://restpilotai.com",
    appOrigins: [],
    google: { clientId: "id", secret: "gs" },
    sendEmailHookSecret: secret,
    hookBaseUrl: "https://restpilot-web-staging.up.railway.app",
  });
  assert.equal(
    q.hook_send_email_uri,
    "https://restpilot-web-staging.up.railway.app/lovable/email/auth/webhook",
  );
  const described = JSON.stringify(describeChanges({ external_google_secret: "old" }, q));
  assert.equal(described.includes("gs"), false);
  assert.equal(described.includes(secret), false);
});
