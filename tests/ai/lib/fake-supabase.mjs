// In-memory stand-in for the Supabase admin client, seeded per scenario.
// It implements only the read-side query-builder surface the AI context code
// uses (select/eq/gte/.../order/limit/maybeSingle). Writes are accepted and
// discarded so the eval never touches a real database.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

/**
 * Resolve relative timestamps in fixtures against the frozen eval clock:
 *   "@now", "@now+14h", "@now-1d", "@now+90m"  -> ISO timestamp
 *   "@date-1d"                                 -> YYYY-MM-DD (UTC date)
 */
export function resolveFixtureValue(value, now) {
  if (typeof value !== "string" || !value.startsWith("@")) return value;
  const m = /^@(now|date)(?:([+-])(\d+(?:\.\d+)?)([dhm]))?$/.exec(value);
  if (!m) return value;
  const [, kind, sign, amount, unit] = m;
  let t = now.getTime();
  if (sign) {
    const ms = Number(amount) * (unit === "d" ? DAY : unit === "h" ? HOUR : MIN);
    t += sign === "+" ? ms : -ms;
  }
  const iso = new Date(t).toISOString();
  return kind === "date" ? iso.slice(0, 10) : iso;
}

function resolveRows(rows, now) {
  return (rows ?? []).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, resolveFixtureValue(v, now)])),
  );
}

function cmp(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a < b ? -1 : 1;
}

class Query {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
    this.orders = [];
    this.max = undefined;
    this.mode = "many";
  }
  select() {
    return this;
  }
  eq(c, v) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c, v) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  gt(c, v) {
    this.filters.push((r) => r[c] != null && r[c] > v);
    return this;
  }
  gte(c, v) {
    this.filters.push((r) => r[c] != null && r[c] >= v);
    return this;
  }
  lt(c, v) {
    this.filters.push((r) => r[c] != null && r[c] < v);
    return this;
  }
  lte(c, v) {
    this.filters.push((r) => r[c] != null && r[c] <= v);
    return this;
  }
  in(c, vs) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c, v) {
    this.filters.push((r) => (v === null ? r[c] == null : r[c] === v));
    return this;
  }
  not(c, op, v) {
    if (op === "is") this.filters.push((r) => (v === null ? r[c] != null : r[c] !== v));
    else if (op === "eq") this.filters.push((r) => r[c] !== v);
    return this;
  }
  // PostgREST string filters (or/filter/contains) are accepted but not
  // evaluated; fixtures should only contain rows meant to be visible.
  or() {
    return this;
  }
  filter() {
    return this;
  }
  contains() {
    return this;
  }
  match(obj) {
    for (const [k, v] of Object.entries(obj)) this.eq(k, v);
    return this;
  }
  order(c, opts = {}) {
    this.orders.push([c, opts.ascending !== false]);
    return this;
  }
  limit(n) {
    this.max = n;
    return this;
  }
  range(from, to) {
    this.offset = from;
    this.max = to - from + 1;
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  // Writes: no-ops.
  insert() {
    this.mode = "write";
    return this;
  }
  upsert() {
    this.mode = "write";
    return this;
  }
  update() {
    this.mode = "write";
    return this;
  }
  delete() {
    this.mode = "write";
    return this;
  }

  run() {
    if (this.mode === "write") return { data: null, error: null };
    let out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    for (const [c, asc] of [...this.orders].reverse()) {
      out = [...out].sort((a, b) => (asc ? cmp(a[c], b[c]) : cmp(b[c], a[c])));
    }
    if (this.offset) out = out.slice(this.offset);
    if (this.max !== undefined) out = out.slice(0, this.max);
    if (this.mode === "maybe") return { data: out[0] ?? null, error: null };
    if (this.mode === "single") {
      return out.length === 1
        ? { data: out[0], error: null }
        : { data: null, error: { message: `expected 1 row, got ${out.length}` } };
    }
    return { data: out, error: null, count: out.length };
  }
  then(resolve, reject) {
    try {
      resolve(this.run());
    } catch (e) {
      reject(e);
    }
  }
}

/**
 * @param {Record<string, object[]>} fixtures table name -> rows
 * @param {Date} now frozen clock used to resolve "@now+..." values
 * @param {string} userId rows without user_id get this one
 */
export function createFakeSupabase(fixtures = {}, now = new Date(), userId = "eval-user") {
  const tables = {};
  for (const [name, rows] of Object.entries(fixtures)) {
    tables[name] = resolveRows(rows, now).map((r) => ({ user_id: userId, ...r }));
  }
  return {
    from: (table) => new Query(tables[table] ?? []),
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  };
}
