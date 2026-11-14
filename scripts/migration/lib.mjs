// Pure helpers for the Lovable Cloud -> owner-owned Supabase migration kit.
// No I/O here: plan/import/verify scripts do the process and file work, so
// these functions can be unit-tested (tests/migration-kit.test.mjs).

// The live Lovable Cloud backend. The kit must never write to it.
export const LIVE_SOURCE_REF = "czsgjqfcjiuqirvmdlps";

// pg_restore --list "desc" values (PostgreSQL 16 pg_backup_archiver.c).
// Longest first so "TABLE DATA" wins over "TABLE".
const DESCS = [
  "PUBLICATION TABLES IN SCHEMA",
  "TEXT SEARCH CONFIGURATION",
  "TEXT SEARCH DICTIONARY",
  "MATERIALIZED VIEW DATA",
  "TEXT SEARCH TEMPLATE",
  "FOREIGN DATA WRAPPER",
  "TEXT SEARCH PARSER",
  "DATABASE PROPERTIES",
  "PUBLICATION TABLE",
  "SEQUENCE OWNED BY",
  "MATERIALIZED VIEW",
  "OPERATOR FAMILY",
  "CHECK CONSTRAINT",
  "OPERATOR CLASS",
  "SECURITY LABEL",
  "ACCESS METHOD",
  "BLOB METADATA",
  "EVENT TRIGGER",
  "FOREIGN SERVER",
  "FK CONSTRAINT",
  "FOREIGN TABLE",
  "INDEX ATTACH",
  "LARGE OBJECT",
  "ROW SECURITY",
  "SEQUENCE SET",
  "TABLE ATTACH",
  "USER MAPPING",
  "DEFAULT ACL",
  "SEARCHPATH",
  "STDSTRINGS",
  "SUBSCRIPTION",
  "CONSTRAINT",
  "CONVERSION",
  "PUBLICATION",
  "STATISTICS",
  "TABLE DATA",
  "AGGREGATE",
  "COLLATION",
  "EXTENSION",
  "PROCEDURE",
  "TRANSFORM",
  "DATABASE",
  "ENCODING",
  "FUNCTION",
  "OPERATOR",
  "SEQUENCE",
  "DEFAULT",
  "COMMENT",
  "TRIGGER",
  "DOMAIN",
  "SCHEMA",
  "SERVER",
  "POLICY",
  "BLOBS",
  "INDEX",
  "TABLE",
  "BLOB",
  "CAST",
  "RULE",
  "TYPE",
  "VIEW",
  "ACL",
];

// Schemas a new Supabase project already owns. The kit restores DATA into a
// few of them (auth/storage/supabase_migrations) but never their DDL.
export const MANAGED_SCHEMAS = new Set([
  "auth",
  "storage",
  "extensions",
  "graphql",
  "graphql_public",
  "realtime",
  "_realtime",
  "supabase_functions",
  "supabase_migrations",
  "vault",
  "pgsodium",
  "pgsodium_masks",
  "net",
  "cron",
  "pgmq",
  "pgbouncer",
  "_analytics",
  "_supavisor",
  "pg_catalog",
  "information_schema",
  "pg_toast",
  "topology",
  "tiger",
  "tiger_data",
]);

// auth tables whose rows are the user accounts. Password hashes live in
// auth.users.encrypted_password (bcrypt), so restoring these rows preserves
// passwords and user ids. Sessions/refresh tokens are deliberately excluded:
// the new project signs with its own JWT secret, so everyone signs in again.
export const AUTH_DATA_TABLES = new Set([
  "users",
  "identities",
  "mfa_factors",
  "sso_providers",
  "sso_domains",
  "saml_providers",
]);
const AUTH_SKIP_REASONS = {
  sessions: "sessions are invalid under the new project's JWT secret; users sign in again",
  refresh_tokens: "refresh tokens are invalid under the new project's JWT secret",
  mfa_challenges: "transient MFA challenges",
  mfa_amr_claims: "session-bound MFA claims",
  flow_state: "transient OAuth/PKCE flow state",
  one_time_tokens: "transient confirmation/recovery tokens",
  audit_log_entries: "GoTrue audit log (kept in the export file, not needed to sign in)",
  schema_migrations: "GoTrue's own migration history must stay the target's",
  instances: "GoTrue legacy table",
  saml_relay_states: "transient SAML state",
};

export function parseTocLine(line) {
  const m = /^(\d+);\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line.trim());
  if (!m) return null;
  const [, dumpId, tableOid, oid, rest] = m;
  const desc = DESCS.find((d) => rest === d || rest.startsWith(d + " "));
  if (!desc)
    return {
      dumpId: Number(dumpId),
      tableOid,
      oid,
      desc: "UNKNOWN",
      namespace: "-",
      tag: rest,
      owner: "",
      raw: line,
    };
  const after = rest.slice(desc.length).trimStart();
  const sp = after.indexOf(" ");
  const namespace = sp === -1 ? after : after.slice(0, sp);
  let remainder = sp === -1 ? "" : after.slice(sp + 1);
  // The owner is the final token; extensions and some comments have none
  // (pg_restore prints a trailing space instead).
  let owner = "";
  if (!/\s$/.test(remainder)) {
    const lastSp = remainder.lastIndexOf(" ");
    if (lastSp !== -1) {
      owner = remainder.slice(lastSp + 1);
      remainder = remainder.slice(0, lastSp);
    }
  }
  return {
    dumpId: Number(dumpId),
    tableOid,
    oid,
    desc,
    namespace,
    tag: remainder.trim(),
    owner,
    raw: line,
  };
}

export function parseToc(text) {
  return text
    .split("\n")
    .filter((l) => l && !l.startsWith(";"))
    .map(parseTocLine)
    .filter(Boolean);
}

const ALWAYS = new Set(["ENCODING", "STDSTRINGS", "SEARCHPATH"]);
const DATA_DESCS = new Set(["TABLE DATA", "SEQUENCE SET", "MATERIALIZED VIEW DATA"]);

// Decide what the import does with one archive entry.
//   section: "schema" | "data" | "migrations-schema" | "skip"
//   collect: optional side information for the plan report.
export function classifyEntry(e) {
  const { desc, namespace: ns, tag } = e;
  if (ALWAYS.has(desc)) return { section: "both" };
  if (desc === "EXTENSION")
    return {
      section: "skip",
      reason: "extension enabled by prologue",
      collect: { extension: tag },
    };
  if (desc === "SCHEMA") {
    if (tag === "public") return { section: "skip", reason: "target already has schema public" };
    if (MANAGED_SCHEMAS.has(tag))
      return {
        section: tag === "supabase_migrations" ? "migrations-schema" : "skip",
        reason: "Supabase-managed schema",
      };
    return { section: "schema" };
  }
  if (ns === "-") {
    if (
      desc === "PUBLICATION" ||
      desc === "EVENT TRIGGER" ||
      desc === "DEFAULT ACL" ||
      desc === "DATABASE" ||
      desc === "DATABASE PROPERTIES"
    )
      return { section: "skip", reason: "project-level object managed by Supabase" };
    if (desc === "COMMENT" || desc === "ACL")
      return { section: "skip", reason: "comment/grant on a managed or pre-existing object" };
    return { section: "skip", reason: "global object", warn: true };
  }
  if (desc === "DEFAULT ACL")
    return { section: "skip", reason: "default privileges belong to Supabase's roles" };
  if (desc === "PUBLICATION TABLE" && !MANAGED_SCHEMAS.has(ns)) return { section: "schema" };

  if (!MANAGED_SCHEMAS.has(ns)) {
    return { section: DATA_DESCS.has(desc) ? "data" : "schema" };
  }

  const table = tag.split(" ")[0];
  if (ns === "auth") {
    if (desc === "TABLE DATA") {
      if (AUTH_DATA_TABLES.has(table)) return { section: "data" };
      return {
        section: "skip",
        reason: AUTH_SKIP_REASONS[table] || "auth table not needed for sign-in",
        warn: !AUTH_SKIP_REASONS[table],
      };
    }
    // App-defined triggers/policies on auth tables (e.g. on_auth_user_created).
    if (desc === "TRIGGER" || desc === "POLICY")
      return { section: "schema", collect: { authCustom: `${desc} auth.${tag}` } };
    if (desc === "SEQUENCE SET")
      return { section: "skip", reason: "GoTrue sequence (refresh tokens are not migrated)" };
    return { section: "skip", reason: "GoTrue-managed definition" };
  }
  if (ns === "storage") {
    if (desc === "TABLE DATA" && (table === "buckets" || table === "objects"))
      return {
        section: "data",
        collect: table === "objects" ? { storageObjects: true } : undefined,
      };
    if (desc === "POLICY") return { section: "schema" };
    return { section: "skip", reason: "storage-managed definition" };
  }
  if (ns === "supabase_migrations") {
    if (desc === "TABLE DATA") return { section: "data" };
    if (desc === "ACL" || desc === "COMMENT")
      return { section: "skip", reason: "migration-history grant/comment" };
    return { section: "migrations-schema" };
  }
  if (ns === "pgmq") {
    if (desc === "TABLE" && /^q_/.test(table))
      return {
        section: "skip",
        reason: "queue recreated by post-import step",
        collect: { queue: table.slice(2) },
      };
    if (desc === "TABLE DATA")
      return {
        section: "skip",
        reason: "queued messages are transient (pending emails are not replayed)",
        collect: { queueData: table },
      };
    return { section: "skip", reason: "pgmq-managed definition" };
  }
  if (ns === "cron") {
    if (desc === "TABLE DATA" && table === "job")
      return {
        section: "skip",
        reason: "jobs are re-created against the new host by rewire step",
        collect: { cronJobs: true },
      };
    return { section: "skip", reason: "pg_cron-managed" };
  }
  if (ns === "vault") {
    if (desc === "TABLE DATA" && table === "secrets")
      return {
        section: "skip",
        reason: "encrypted with the old project's root key; recreate from env",
        collect: { vault: true },
      };
    return { section: "skip", reason: "vault-managed" };
  }
  return { section: "skip", reason: `managed schema ${ns}` };
}

// Build the three pg_restore list files from the full archive TOC.
export function planFromToc(entries) {
  const lists = { schema: [], data: [], "migrations-schema": [] };
  const skipped = [];
  const info = {
    extensions: [],
    queues: [],
    queueData: [],
    authCustom: [],
    storageObjects: false,
    cronJobs: false,
    vault: false,
    warnings: [],
  };
  for (const e of entries) {
    const c = classifyEntry(e);
    if (c.collect?.extension) info.extensions.push(c.collect.extension);
    if (c.collect?.queue) info.queues.push(c.collect.queue);
    if (c.collect?.queueData) info.queueData.push(c.collect.queueData);
    if (c.collect?.authCustom) info.authCustom.push(c.collect.authCustom);
    if (c.collect?.storageObjects) info.storageObjects = true;
    if (c.collect?.cronJobs) info.cronJobs = true;
    if (c.collect?.vault) info.vault = true;
    if (c.warn) info.warnings.push(`review: ${e.desc} ${e.namespace} ${e.tag}`);
    if (c.section === "both") {
      lists.schema.push(e.raw);
      lists.data.push(e.raw);
      lists["migrations-schema"].push(e.raw);
      continue;
    }
    if (c.section === "skip") {
      skipped.push({ entry: `${e.desc} ${e.namespace} ${e.tag}`, reason: c.reason });
      continue;
    }
    lists[c.section].push(e.raw);
  }
  return { lists, skipped, info };
}

// Supabase installs these into the `extensions` schema.
const EXTENSIONS_SCHEMA = new Set([
  "pgcrypto",
  "uuid-ossp",
  "pgjwt",
  "pg_stat_statements",
  "pg_trgm",
  "citext",
  "btree_gin",
  "btree_gist",
  "unaccent",
  "vector",
  "hstore",
]);
export function extensionPrologue(names) {
  const lines = [
    "-- Generated by scripts/migration/plan.mjs: enable the archive's extensions before restoring schema.",
  ];
  for (const n of [...new Set(names)].filter((n) => n !== "plpgsql").sort()) {
    const ident = '"' + n.replace(/"/g, '""') + '"';
    lines.push(
      EXTENSIONS_SCHEMA.has(n)
        ? `create extension if not exists ${ident} with schema extensions;`
        : `create extension if not exists ${ident};`,
    );
  }
  return lines.join("\n") + "\n";
}

// Parse `COPY schema.table (cols) FROM stdin;` blocks emitted by pg_restore -f.
// Feed lines one at a time; returns the manifest (row count + order-independent
// sha256 of the exact COPY text lines) per table.
export function createCopyParser(createHash) {
  const tables = new Map();
  let current = null;
  let rows = [];
  return {
    line(l) {
      if (current) {
        if (l === "\\.") {
          const sorted = rows.sort();
          const h = createHash("sha256");
          for (const r of sorted) h.update(r + "\n");
          tables.set(current.key, { ...current, rows: rows.length, sha256: h.digest("hex") });
          current = null;
          rows = [];
        } else rows.push(l);
        return;
      }
      const m = /^COPY ([^ ]+) \((.*)\) FROM stdin;$/.exec(l);
      if (m) current = { key: m[1], columns: m[2] };
    },
    result() {
      if (current) throw new Error(`unterminated COPY block for ${current.key}`);
      return Object.fromEntries([...tables].sort(([a], [b]) => a.localeCompare(b)));
    },
  };
}

// Split "a, b, \"trigger\"" into identifiers (pg_dump quotes only when needed).
export function splitColumns(columns) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < columns.length; i++) {
    const ch = columns[i];
    if (ch === '"') {
      if (q && columns[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      q = !q;
      continue;
    }
    if (ch === "," && !q) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function splitQualified(key) {
  const m = /^("(?:[^"]|"")+"|[^.]+)\.("(?:[^"]|"")+"|.+)$/.exec(key);
  const unq = (s) => (s.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s);
  return m ? { schema: unq(m[1]), table: unq(m[2]) } : { schema: "public", table: unq(key) };
}

// Compare archive COPY columns with the target's columns for tables the kit
// restores into pre-existing (Supabase-managed) tables.
export function columnProblems(sourceCols, target) {
  const problems = [];
  const t = new Map(target.map((c) => [c.name, c]));
  for (const c of sourceCols) if (!t.has(c)) problems.push(`target lacks column ${c}`);
  const s = new Set(sourceCols);
  for (const c of target) {
    if (!s.has(c.name) && c.notNull && !c.hasDefault && !c.generated)
      problems.push(`target requires column ${c.name} that the archive does not provide`);
  }
  return problems;
}

// Reject any URL that points at the live Lovable backend, and require the
// operator to name the target explicitly.
export function assertSafeTarget(url, confirmRef) {
  if (!url) throw new Error("TARGET_DB_URL is not set");
  if (url.includes(LIVE_SOURCE_REF))
    throw new Error("refusing: TARGET_DB_URL points at the live Lovable Cloud backend");
  if (!confirmRef) throw new Error("pass --confirm-target <project-ref or host> naming the target");
  if (confirmRef.includes(LIVE_SOURCE_REF))
    throw new Error("refusing: confirm target is the live backend");
  if (!targetIdentities(url).includes(confirmRef))
    throw new Error("refusing: --confirm-target does not match TARGET_DB_URL");
}

// Names that identify a target exactly: the Supabase project ref (from the
// pooler user "postgres.<ref>" or host "db.<ref>.supabase.co"), the host, and
// for a local socket/localhost rehearsal the database name.
export function targetIdentities(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const ids = [];
  const user = decodeURIComponent(u.username || "");
  if (/^postgres\.[a-z0-9]{20}$/.test(user)) ids.push(user.slice("postgres.".length));
  const db = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
  if (db) ids.push(db[1]);
  if (u.hostname) ids.push(u.hostname);
  const socket = u.searchParams.get("host");
  if ((socket && socket.startsWith("/")) || ["localhost", "127.0.0.1"].includes(u.hostname))
    ids.push(decodeURIComponent(u.pathname.replace(/^\//, "")));
  return ids.filter(Boolean);
}

// Hide credentials in anything printed.
export function redactUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return "<unparseable url>";
  }
}

// Summarise a pg_cron command without leaking header values or keys.
export function summariseCronCommand(cmd) {
  const url =
    /'(https?:\/\/[^']+)'/.exec(cmd)?.[1] || /url\s*:=\s*'([^']+)'/.exec(cmd)?.[1] || null;
  const headerNames = [
    ...cmd.matchAll(/'([A-Za-z][A-Za-z0-9-]*)'\s*,\s*(?:'|\(|concat|format|\w+\.)/g),
  ]
    .map((m) => m[1])
    .filter((h) => /^(x-|authorization$|apikey$|content-type$)/i.test(h));
  let target = null;
  if (url) {
    try {
      const u = new URL(url);
      target = { host: u.host, path: u.pathname };
    } catch {
      /* ignore */
    }
  }
  return {
    target,
    headerNames: [...new Set(headerNames.map((h) => h.toLowerCase()))],
    usesVault: /vault\./.test(cmd),
  };
}
