// "Export my data" against a real PostgreSQL database built from
// supabase/migrations (see tests/_pg-supabase.mjs).
//
// The handler under test is the real exportAccountFn from
// src/lib/account.functions.ts. Only supabaseAdmin is replaced, by a thin
// adapter that turns the exact query-builder chain the handler uses
// (.from().select().eq().order().range()) into SQL and returns PostgreSQL's
// errors the way PostgREST does ({ data: null, error }). So a table, filter
// column or ORDER BY column that does not exist fails here, as it would in
// production. The mocked suite (tests/account-failures.test.mjs) cannot see
// that: it once passed while the export ordered trial_usage and
// store_entitlements by a non-existent "id" column, which made every export
// fail.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { after, before, test } from "node:test";
import { quoteIdent, quoteLiteral, startMigratedDatabase } from "./_pg-supabase.mjs";

const db = startMigratedDatabase();
const skip = db.skip ? `PostgreSQL unavailable: ${db.skip}` : false;
after(() => db.stop?.());

// --- PostgREST-shaped adapter over psql -----------------------------------
function pgAdmin(calls) {
  return {
    from(table) {
      return {
        select(columns) {
          assert.equal(columns, "*");
          return {
            eq(column, value) {
              return {
                order(orderBy, { ascending }) {
                  return {
                    async range(from, to) {
                      calls.push({ table, column, orderBy, from });
                      try {
                        const rows = db.json(
                          `SELECT * FROM public.${quoteIdent(table)} WHERE ${quoteIdent(column)} = ${quoteLiteral(value)}` +
                            ` ORDER BY ${quoteIdent(orderBy)} ${ascending ? "ASC" : "DESC"}` +
                            ` LIMIT ${to - from + 1} OFFSET ${from}`,
                        );
                        return { data: rows, error: null };
                      } catch (err) {
                        return { data: null, error: { message: err.message } };
                      }
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    auth: {
      admin: {
        async getUserById(id) {
          const [user] = db.json(`SELECT id, email FROM auth.users WHERE id = ${quoteLiteral(id)}`);
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { message: "not found" } };
        },
      },
    },
  };
}

function loadExport(calls) {
  const source = stripTypeScriptTypes(
    readFileSync(new URL("../src/lib/account.functions.ts", import.meta.url), "utf8"),
  )
    .replace(/^import .*;\n/gm, "")
    .replaceAll("export const ", "const ")
    .replace(/import\(("[^"]+")\)/g, "deps.load($1)");
  const emails = [];
  const deps = {
    async load(p) {
      if (p.includes("client.server")) return { supabaseAdmin: pgAdmin(calls) };
      if (p.includes("email/send.server"))
        return {
          async sendTransactionalEmailServer(m) {
            emails.push(m.templateName);
          },
        };
      if (p.includes("alert.server")) return { async notifyOwner() {} };
      throw new Error(`Unexpected dependency: ${p}`);
    },
  };
  const context = vm.createContext({
    deps,
    console: { error() {}, warn() {} },
    createServerFn: () => ({ middleware: () => ({ handler: (fn) => fn }) }),
    requireSupabaseAuth: {},
  });
  const { exportAccountFn } = vm.runInContext(`${source}\n({ exportAccountFn })`, context);
  return { run: (userId) => exportAccountFn({ context: { userId } }), emails };
}

// --- fixtures ---------------------------------------------------------------
const USER_A = "0a0a0a0a-0000-4000-8000-00000000000a";
const USER_B = "0b0b0b0b-0000-4000-8000-00000000000b";
const EMPTY = "0e0e0e0e-0000-4000-8000-00000000000e";

/**
 * A minimal valid row for any table: every NOT NULL column without a default
 * gets a type-appropriate value; user_id / profiles.id get the owner. Columns
 * with CHECK lists or foreign keys get explicit values in OVERRIDES.
 */
const OVERRIDES = {
  trial_usage: (env) => ({ environment: env }),
  store_entitlements: (env) => ({ environment: env, store: "app_store", plan: "monthly" }),
  subscriptions: (env) => ({ environment: env }),
};

function columnsOf(table) {
  return db.json(`
    SELECT c.column_name AS name, c.data_type AS type, c.udt_name AS udt,
           c.is_nullable = 'NO' AND c.column_default IS NULL AND c.is_generated = 'NEVER'
             AND c.is_identity = 'NO' AS required
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = ${quoteLiteral(table)}
    ORDER BY c.ordinal_position`);
}

function enumFirst(udt) {
  const [r] = db.json(`SELECT e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                       WHERE t.typname = ${quoteLiteral(udt)} ORDER BY e.enumsortorder LIMIT 1`);
  return r?.v;
}

/** First allowed literal from a CHECK (col = ANY (ARRAY['a'::text, ...])) or col IN ('a', ...). */
function checkLiteral(table, column) {
  const defs = db.json(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
                        WHERE conrelid = ${quoteLiteral(`public.${table}`)}::regclass AND contype = 'c'`);
  for (const { d } of defs) {
    const m =
      new RegExp(`\\(?${column}\\)?(?:::text)? = ANY \\(+ARRAY\\['([^']*)'`).exec(d) ??
      new RegExp(`\\b${column}\\b[^']*?IN \\('([^']*)'`).exec(d);
    if (m) return m[1];
  }
  return undefined;
}

/** For a foreign key to another public table, a row of that table owned by `owner`. */
function parentRow(table, column, owner) {
  const [fk] = db.json(`
    SELECT cl.relname AS target, a2.attname AS target_col
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a1 ON a1.attrelid = c.conrelid AND a1.attnum = c.conkey[1]
    JOIN pg_attribute a2 ON a2.attrelid = c.confrelid AND a2.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND c.conrelid = ${quoteLiteral(`public.${table}`)}::regclass AND a1.attname = ${quoteLiteral(column)}`);
  if (!fk) return undefined;
  const [row] =
    db.json(`SELECT ${quoteIdent(fk.target_col)} AS v FROM public.${quoteIdent(fk.target)}
                         WHERE user_id = ${quoteLiteral(owner)} LIMIT 1`);
  return row ? quoteLiteral(row.v) : undefined;
}

function valueFor(col, owner, table) {
  if (col.name === "user_id" || (table === "profiles" && col.name === "id"))
    return quoteLiteral(owner);
  const parent = parentRow(table, col.name, owner);
  if (parent) return parent;
  const allowed = checkLiteral(table, col.name);
  if (allowed !== undefined) return quoteLiteral(allowed);
  if (col.type === "uuid") return "gen_random_uuid()";
  if (col.type === "USER-DEFINED") return quoteLiteral(enumFirst(col.udt));
  if (col.type === "ARRAY") return `'{}'`;
  if (/^(integer|bigint|smallint|numeric|real|double precision)$/.test(col.type)) return "1";
  if (col.type === "boolean") return "false";
  if (col.type.startsWith("timestamp")) return "now()";
  if (col.type === "date") return "current_date";
  if (col.type.startsWith("time")) return `'08:00'`;
  if (col.type === "jsonb" || col.type === "json") return `'{}'`;
  if (col.type === "interval") return `'1 hour'`;
  return quoteLiteral(
    `${table}-${col.name}-${owner.slice(0, 4)}-${Math.random().toString(36).slice(2, 8)}`,
  );
}

function insertRow(table, owner, extra = {}) {
  const cols = columnsOf(table);
  const values = {};
  for (const c of cols)
    if (c.required || c.name === "user_id") values[c.name] = valueFor(c, owner, table);
  for (const [k, v] of Object.entries(extra)) values[k] = quoteLiteral(v);
  const names = Object.keys(values);
  db.sql(`INSERT INTO public.${quoteIdent(table)} (${names.map(quoteIdent).join(", ")})
          VALUES (${names.map((n) => values[n]).join(", ")})
          ON CONFLICT DO NOTHING;`);
}

function newUser(id) {
  db.sql(
    `INSERT INTO auth.users (id, email) VALUES (${quoteLiteral(id)}, ${quoteLiteral(`${id.slice(0, 4)}@example.invalid`)});`,
  );
}

const count = (table, column, owner) =>
  db.json(
    `SELECT count(*)::int AS n FROM public.${quoteIdent(table)} WHERE ${quoteIdent(column)} = ${quoteLiteral(owner)}`,
  )[0].n;

// The tables the export reads: everything it asked for in the empty run.
let exportedTables = [];

before(async () => {
  if (skip) return;
  newUser(EMPTY);
  const calls = [];
  await loadExport(calls)
    .run(EMPTY)
    .catch(() => {});
  exportedTables = [...new Set(calls.map((c) => c.table))];
});

test("export succeeds for an account with no data, and returns every table", { skip }, async () => {
  const calls = [];
  const exp = loadExport(calls);
  const result = await exp.run(EMPTY);
  assert.ok(
    exportedTables.includes("trial_usage") && exportedTables.includes("store_entitlements"),
  );
  for (const t of exportedTables) {
    assert.ok(Array.isArray(result.data?.[t] ?? result[t]), `export is missing ${t}`);
  }
  assert.deepEqual(exp.emails, ["data-export-ready"]);
});

test("every export query uses columns that exist on that table", { skip }, async () => {
  // Independent of the handler's error handling: check each (table, filter,
  // order) the handler issued against the catalog.
  const calls = [];
  await loadExport(calls)
    .run(EMPTY)
    .catch(() => {}); // asserted by the test above
  const seen = new Map();
  for (const c of calls) seen.set(c.table, c);
  for (const [table, c] of seen) {
    const names = columnsOf(table).map((x) => x.name);
    assert.ok(names.length > 0, `${table} does not exist`);
    assert.ok(names.includes(c.column), `${table} has no filter column ${c.column}`);
    assert.ok(names.includes(c.orderBy), `${table} has no order column ${c.orderBy}`);
  }
});

test(
  "export of a populated account returns only that user's rows, across pages",
  { skip },
  async () => {
    newUser(USER_A);
    newUser(USER_B);
    const failed = [];
    for (const owner of [USER_A, USER_B]) {
      for (const t of exportedTables) {
        const envs = OVERRIDES[t] ? ["live", "sandbox"] : [null];
        for (const env of envs) {
          try {
            insertRow(t, owner, env ? OVERRIDES[t](env) : {});
          } catch (err) {
            failed.push(`${t}: ${err.message.split("\n")[0]}`);
          }
        }
      }
    }
    // Tables that matter most for this regression must be populated for real.
    for (const t of ["trial_usage", "store_entitlements", "user_prefs", "profiles", "shifts"]) {
      assert.ok(
        !failed.some((f) => f.startsWith(`${t}:`)),
        `could not seed ${t}: ${failed.join("; ")}`,
      );
    }
    // More than one export page (pageSize 500) for an id-ordered table.
    db.sql(`INSERT INTO public.coach_messages (user_id, role, content)
          SELECT ${quoteLiteral(USER_A)}, 'user', 'm' || g FROM generate_series(1, 1201) g;`);

    const calls = [];
    // JSON round-trip: the handler runs in a vm context, so its arrays come
    // from another realm and deepStrictEqual would reject them.
    const result = JSON.parse(JSON.stringify(await loadExport(calls).run(USER_A)));
    const data = result.data ?? result;
    const seeded = exportedTables.filter(
      (t) => count(t, t === "profiles" ? "id" : "user_id", USER_A) > 0,
    );
    assert.equal(
      seeded.length,
      exportedTables.length,
      `seeded only ${seeded.length}/${exportedTables.length}: ${failed.join("; ")}`,
    );
    for (const t of exportedTables) {
      const key = t === "profiles" ? "id" : "user_id";
      assert.equal(data[t].length, count(t, key, USER_A), `${t}: exported row count`);
      for (const row of data[t]) assert.equal(row[key], USER_A, `${t}: row from another user`);
    }
    assert.equal(data.trial_usage.length, 2);
    assert.equal(data.store_entitlements.length, 2);
    assert.deepEqual(
      data.trial_usage.map((r) => r.environment),
      ["live", "sandbox"],
    );
    assert.ok(data.coach_messages.length >= 1201);
    assert.ok(
      calls.some((c) => c.table === "coach_messages" && c.from >= 1000),
      "paged past 1000 rows",
    );
    assert.equal(
      new Set(data.coach_messages.map((r) => r.id)).size,
      data.coach_messages.length,
      "no duplicate rows across pages",
    );
  },
);
