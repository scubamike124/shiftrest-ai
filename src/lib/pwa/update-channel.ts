/**
 * Tiny pub/sub the SW registrar publishes to and the UpdateBanner
 * subscribes to. Keeps the registrar free of React imports and avoids a
 * window-event-string contract that's easy to typo.
 */

export type UpdateEvent =
  | { type: "available"; reg: ServiceWorkerRegistration }
  | { type: "activated" };

type Listener = (e: UpdateEvent) => void;

const listeners = new Set<Listener>();
let lastAvailable: ServiceWorkerRegistration | null = null;

export function onUpdate(fn: Listener): () => void {
  listeners.add(fn);
  // Replay the latest "available" event so late mounts still see it.
  if (lastAvailable) fn({ type: "available", reg: lastAvailable });
  return () => listeners.delete(fn);
}

export function emitUpdate(e: UpdateEvent): void {
  if (e.type === "available") lastAvailable = e.reg;
  if (e.type === "activated") lastAvailable = null;
  for (const fn of listeners) {
    try { fn(e); } catch { /* listener should not break the bus */ }
  }
}
