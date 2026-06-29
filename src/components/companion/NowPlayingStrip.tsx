// Phase C — inline now-playing strip shown above the composer when any
// sleep sound is active. Reads from the existing mixer state only; does
// not own playback, timers, or volume.
import { useEffect, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { mixer } from "@/lib/sounds/mixer";

export function NowPlayingStrip() {
  const [, tick] = useState(0);
  useEffect(() => {
    const unsub = mixer.subscribe(() => tick((n) => n + 1));
    return () => { unsub(); };
  }, []);

  const active = mixer.listActive();
  if (active.length === 0) return null;

  const label =
    active.length === 1
      ? active[0].label
      : `${active[0].label} +${active.length - 1}`;
  const emoji = active[0].emoji;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 flex items-center gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
    >
      <span className="text-base" aria-hidden>{emoji}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Volume2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <p className="truncate text-xs font-medium">
          Now playing · <span className="text-foreground">{label}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={() => void mixer.stopAll()}
        className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
        aria-label="Stop all sounds"
      >
        <Square className="h-3 w-3" />
        Stop
      </button>
    </div>
  );
}
