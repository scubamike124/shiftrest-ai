// Phase C — premium quick-action shown in the empty conversation state.
// Launches the existing breathing/wind-down overlay; no new logic.
import { Moon, Play } from "lucide-react";

export function WindDownQuickAction({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="group relative mx-auto block w-full max-w-sm overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4 text-left shadow-sm backdrop-blur-sm transition hover:border-primary/50 hover:from-primary/15"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Moon className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">Start a 5-minute wind-down</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Guided breathing to slow your mind before bed.
          </p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition group-hover:scale-105">
          <Play className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}
