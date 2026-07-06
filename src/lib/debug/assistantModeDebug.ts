// TEMP debug bus for the Conversation-style save bug. Remove once fixed.
export type AmDebugEntry = { t: number; label: string; value: unknown };

const entries: AmDebugEntry[] = [];
const listeners = new Set<() => void>();

export function amDebugPush(label: string, value: unknown): void {
  entries.push({ t: Date.now(), label, value });
  if (entries.length > 40) entries.splice(0, entries.length - 40);
  listeners.forEach((l) => {
    try { l(); } catch { /* noop */ }
  });
  try { console.log("[assistantMode-debug]", label, value); } catch { /* noop */ }
}

export function amDebugClear(): void {
  entries.length = 0;
  listeners.forEach((l) => {
    try { l(); } catch { /* noop */ }
  });
}

export function amDebugGet(): AmDebugEntry[] {
  return entries.slice();
}

export function amDebugSubscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
