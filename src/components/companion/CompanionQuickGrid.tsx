// Slice A — Premium quick-action grid for the AI Companion.
// Mobile-first 2-col grid (3-col ≥ sm). Glass tiles with subtle press animation,
// generous touch targets (min-h-[88px]), accessible button semantics, and
// light/dark mode via semantic tokens.
import { cn } from "@/lib/utils";

export type CompanionQuickActionId =
  | "fall_asleep"
  | "sleep_sounds"
  | "calm_down"
  | "smart_alarm"
  | "review_sleep"
  | "plan_morning";

type Tile = {
  id: CompanionQuickActionId;
  emoji: string;
  label: string;
  hint: string;
  /** Tailwind tint tokens — kept tonal so the grid feels cohesive. */
  tint: string;
};

const TILES: Tile[] = [
  {
    id: "fall_asleep",
    emoji: "😴",
    label: "Help Me Fall Asleep",
    hint: "Guided wind-down",
    tint: "from-indigo-500/15 to-violet-500/10 hover:from-indigo-500/25",
  },
  {
    id: "sleep_sounds",
    emoji: "🌊",
    label: "Play Sleep Sounds",
    hint: "Rain · waves · noise",
    tint: "from-sky-500/15 to-cyan-500/10 hover:from-sky-500/25",
  },
  {
    id: "calm_down",
    emoji: "🧘",
    label: "Calm Me Down",
    hint: "4-7-8 breathing",
    tint: "from-emerald-500/15 to-teal-500/10 hover:from-emerald-500/25",
  },
  {
    id: "smart_alarm",
    emoji: "⏰",
    label: "Smart Alarm",
    hint: "Wake at the right time",
    tint: "from-amber-500/15 to-orange-500/10 hover:from-amber-500/25",
  },
  {
    id: "review_sleep",
    emoji: "📈",
    label: "Review My Sleep",
    hint: "Last night's recap",
    tint: "from-fuchsia-500/15 to-pink-500/10 hover:from-fuchsia-500/25",
  },
  {
    id: "plan_morning",
    emoji: "☕",
    label: "Plan My Morning",
    hint: "Get a head start",
    tint: "from-rose-500/15 to-red-500/10 hover:from-rose-500/25",
  },
];

export function CompanionQuickGrid({
  onAction,
  disabled = false,
  compact = false,
  className,
}: {
  onAction: (id: CompanionQuickActionId) => void;
  disabled?: boolean;
  /** When true, render as a horizontal scroll strip (used once chat is active). */
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <div
        className={cn(
          "-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
        aria-label="Quick actions"
      >
        {TILES.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => onAction(t.id)}
            className={cn(
              "group snap-start shrink-0 inline-flex items-center gap-2 rounded-full border border-border/60 bg-gradient-to-br px-3.5 py-2 text-xs font-medium text-foreground/90 backdrop-blur-sm transition active:scale-[0.97] disabled:opacity-50",
              t.tint,
            )}
          >
            <span aria-hidden className="text-base leading-none">{t.emoji}</span>
            <span className="whitespace-nowrap">{t.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2.5 sm:grid-cols-3",
        className,
      )}
      role="group"
      aria-label="Quick actions"
    >
      {TILES.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={disabled}
          onClick={() => onAction(t.id)}
          aria-label={t.label}
          className={cn(
            "group relative flex min-h-[92px] flex-col items-start justify-between overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br p-3 text-left shadow-sm backdrop-blur-md transition",
            "hover:border-primary/40 hover:shadow-[0_8px_28px_-12px_hsl(var(--primary)/0.35)]",
            "active:scale-[0.97] active:transition-transform active:duration-75",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
            t.tint,
          )}
        >
          <span
            aria-hidden
            className="text-2xl leading-none transition-transform duration-300 group-hover:scale-110 group-active:scale-95"
          >
            {t.emoji}
          </span>
          <span className="space-y-0.5">
            <span className="block text-[13px] font-semibold leading-tight text-foreground">
              {t.label}
            </span>
            <span className="block text-[11px] leading-tight text-muted-foreground">
              {t.hint}
            </span>
          </span>
          {/* hairline sheen */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-60"
          />
        </button>
      ))}
    </div>
  );
}
