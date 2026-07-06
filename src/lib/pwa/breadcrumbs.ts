/**
 * Tiny bounded ring buffer of PWA lifecycle events, persisted to
 * localStorage under `rpai:pwa-log`. Read by /version to prove which
 * mechanism (poll, bfcache, controllerchange) carried an update.
 *
 * Observation only — no behavior change. Failures are swallowed so
 * private mode / storage-disabled contexts never break the registrar.
 */

export type PwaBreadcrumb = {
  ts: string;
  type:
    | "registered"
    | "drift-detected"
    | "auto-skip-waiting"
    | "reload"
    | "bfcache-restore-stale";
  build: string;
  [key: string]: unknown;
};

const KEY = "rpai:pwa-log";
const MAX = 20;

export function readBreadcrumbs(): PwaBreadcrumb[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PwaBreadcrumb[]) : [];
  } catch {
    return [];
  }
}

export function logBreadcrumb(
  type: PwaBreadcrumb["type"],
  build: string,
  extra: Record<string, unknown> = {},
): void {
  try {
    const entry: PwaBreadcrumb = {
      ts: new Date().toISOString(),
      type,
      build,
      ...extra,
    };
    const next = [...readBreadcrumbs(), entry].slice(-MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function clearBreadcrumbs(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
