// TEMP on-page debug panel for the Conversation-style save bug.
// Renders the most recent savePrefs round-trip entries so the user can
// screenshot them without needing DevTools. Remove once the cause is found.
import { useEffect, useState } from "react";
import {
  amDebugClear,
  amDebugGet,
  amDebugSubscribe,
  type AmDebugEntry,
} from "@/lib/debug/assistantModeDebug";

function fmt(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ts(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function AssistantModeDebugPanel() {
  const [entries, setEntries] = useState<AmDebugEntry[]>(() => amDebugGet());
  useEffect(() => amDebugSubscribe(() => setEntries(amDebugGet())), []);

  return (
    <section className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-amber-600">
          Conversation-style debug (temporary)
        </p>
        <button
          type="button"
          onClick={amDebugClear}
          className="rounded-lg border border-amber-500/40 px-2 py-1 text-xs font-medium text-amber-700"
        >
          Clear
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Tap a Conversation style above. The exact value sent, the raw
        Supabase response, and the value in the cache after refetch will
        appear below. Screenshot and send.
      </p>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No events yet.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e, i) => (
            <li
              key={`${e.t}-${i}`}
              className="rounded-lg border border-border bg-background/60 p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">{e.label}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {ts(e.t)}
                </span>
              </div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-tight text-foreground">
                {fmt(e.value)}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
