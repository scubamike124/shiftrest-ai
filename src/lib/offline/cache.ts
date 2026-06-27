/**
 * Offline cache — tiny privacy-first localStorage layer.
 *
 * Design contract
 * ───────────────
 * - Keys are namespaced `rpai:offline:v1:<scope>:<userId|anon>` so a sign-out
 *   never bleeds one user's plan into another's view. Bump `V` to invalidate.
 * - Values are wrapped with `{ savedAt, value }` so callers can show "cached
 *   <time> ago" instead of pretending stale data is fresh.
 * - All access is wrapped in try/catch: a Safari private-mode quota error,
 *   a disabled-storage browser, or SSR (no `window`) must never crash the
 *   dashboard. The contract is "best-effort cache", not "durable store".
 * - We deliberately do NOT serialize secrets, tokens, or auth state — just
 *   plan-shaped data the AI already returned to the user.
 */
const V = "v1";
const NS = `rpai:offline:${V}`;

export type Wrapped<T> = { savedAt: number; value: T };

function safeWindow(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function fullKey(scope: string, userId: string | null | undefined): string {
  return `${NS}:${scope}:${userId ?? "anon"}`;
}

export function lsGet<T>(scope: string, userId: string | null | undefined): Wrapped<T> | null {
  const ls = safeWindow();
  if (!ls) return null;
  try {
    const raw = ls.getItem(fullKey(scope, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Wrapped<T>;
    if (typeof parsed?.savedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function lsSet<T>(scope: string, userId: string | null | undefined, value: T): void {
  const ls = safeWindow();
  if (!ls) return;
  try {
    const wrapped: Wrapped<T> = { savedAt: Date.now(), value };
    ls.setItem(fullKey(scope, userId), JSON.stringify(wrapped));
  } catch {
    // Quota / private-mode / disabled storage — silent. Offline cache is
    // a comfort, not a contract; failing loudly here would be worse UX.
  }
}

export function lsRemove(scope: string, userId: string | null | undefined): void {
  const ls = safeWindow();
  if (!ls) return;
  try {
    ls.removeItem(fullKey(scope, userId));
  } catch {
    /* ignore */
  }
}

/**
 * Clear every offline key for a user — call on sign-out so the next user
 * (or signed-out visitor) never sees a previous account's plan.
 */
export function clearAllForUser(userId: string | null | undefined): void {
  const ls = safeWindow();
  if (!ls) return;
  try {
    const suffix = `:${userId ?? "anon"}`;
    const drop: string[] = [];
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k && k.startsWith(`${NS}:`) && k.endsWith(suffix)) drop.push(k);
    }
    drop.forEach((k) => ls.removeItem(k));
  } catch {
    /* ignore */
  }
}

/**
 * Best-effort sync read of the Supabase user id from localStorage.
 *
 * Why this exists
 * ───────────────
 * The dashboard needs to hydrate its React Query cache from the per-user
 * offline snapshot *before* `useQuery` fires its first fetch — otherwise
 * a cold airplane-mode load lands in an error state before the async
 * `supabase.auth.getSession()` resolves. The Supabase JS client persists
 * the session synchronously at a key matching `sb-<project>-auth-token`,
 * so we can read the user id without an async round-trip.
 *
 * Returns `null` if storage is unavailable, the key is missing, the JSON
 * is malformed, or the session is expired — every caller already handles
 * the no-cache case gracefully.
 */
export function getCachedUserIdSync(): string | null {
  const ls = safeWindow();
  if (!ls) return null;
  try {
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (!k || !k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
      const raw = ls.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as {
        user?: { id?: string };
        currentSession?: { user?: { id?: string }; expires_at?: number };
        expires_at?: number;
      };
      const expires = parsed.currentSession?.expires_at ?? parsed.expires_at;
      if (typeof expires === "number" && expires * 1000 < Date.now()) continue;
      const id = parsed.user?.id ?? parsed.currentSession?.user?.id;
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    /* ignore */
  }
  return null;
}
