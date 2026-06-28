// Slice 9 — Action history (per-device, localStorage ring buffer).
// Keeps the last 50 actions the Companion has executed or attempted so the
// user can inspect what happened and retry failures.

import type { CompanionAction } from "./actions";

export type ActionStatus = "queued" | "executing" | "completed" | "failed" | "cancelled";

export type ActionErrorKind =
  | "offline"
  | "unauthenticated"
  | "permission_denied"
  | "not_found"
  | "validation"
  | "conflict"
  | "unavailable"
  | "unknown";

export type ActionHistoryEntry = {
  id: string;
  at: number; // ms epoch
  kind: CompanionAction["kind"];
  label: string; // human-readable title from describeAction
  status: ActionStatus;
  message: string;
  errorKind?: ActionErrorKind;
  /** Serialized action so a retry can re-run it. */
  snapshot: CompanionAction;
};

const KEY = "restpilot.companion.history.v1";
const MAX = 50;
const EVENT = "companion-action-history:changed";

function read(): ActionHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActionHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries: ActionHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* quota / privacy mode → silently drop */
  }
}

export function listHistory(): ActionHistoryEntry[] {
  return read();
}

export function recordHistory(entry: Omit<ActionHistoryEntry, "id" | "at"> & { id?: string; at?: number }): ActionHistoryEntry {
  const e: ActionHistoryEntry = {
    id: entry.id ?? (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    at: entry.at ?? Date.now(),
    kind: entry.kind,
    label: entry.label,
    status: entry.status,
    message: entry.message,
    errorKind: entry.errorKind,
    snapshot: entry.snapshot,
  };
  const next = [e, ...read()].slice(0, MAX);
  write(next);
  return e;
}

export function clearHistory(): void {
  write([]);
}

export function subscribeHistory(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const fn = () => cb();
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

export function isRetryable(kind?: ActionErrorKind): boolean {
  return kind === "offline" || kind === "unknown" || kind === "conflict";
}
