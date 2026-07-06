import { cn } from "@/lib/utils";
import { useAvatar } from "@/lib/companion/use-avatar";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

/** Animated Companion orb. State drives color, glow, and pulse cadence.
 *  The avatar portrait is layered inside the ring so identity is consistent
 *  across idle / listening / thinking / speaking states. */
export function PilotOrb({
  state,
  level = 0,
  className,
}: {
  state: OrbState;
  /** RMS 0..~0.5 — used to scale the listening pulse. */
  level?: number;
  className?: string;
}) {
  const scale = state === "listening" ? 1 + Math.min(level * 4, 0.35) : 1;
  const { src: portraitUrl } = useAvatar();
  return (
    <div className={cn("relative aspect-square w-56 max-w-[60vw]", className)}>
      {/* outer aurora ring */}
      <div
        className={cn(
          "absolute inset-0 rounded-full blur-2xl transition-opacity duration-500",
          state === "idle" && "opacity-30 bg-[radial-gradient(circle,hsl(var(--primary)/0.55),transparent_65%)]",
          state === "listening" && "opacity-80 bg-[radial-gradient(circle,hsl(var(--primary)/0.85),transparent_70%)] animate-pulse motion-reduce:animate-none",
          state === "thinking" && "opacity-70 bg-[radial-gradient(circle,hsl(280_85%_65%/0.75),transparent_70%)]",
          state === "speaking" && "opacity-90 bg-[radial-gradient(circle,hsl(190_90%_60%/0.85),transparent_70%)]",
        )}
      />
      {/* conic gradient ring — the tappable affordance */}
      <div
        className="absolute inset-[8%] rounded-full p-[3px] bg-[conic-gradient(from_180deg,hsl(var(--primary)),hsl(280_85%_65%),hsl(190_90%_60%),hsl(var(--primary)))] shadow-[0_0_60px_-10px_hsl(var(--primary))] transition-transform duration-300"
        style={{ transform: `scale(${scale})` }}
      >
        {/* portrait avatar — same image used on Home + active session */}
        <div className="relative h-full w-full overflow-hidden rounded-full border border-white/15 bg-background">
          {portraitUrl && (
            <img
              src={portraitUrl}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          )}
        </div>
      </div>
      {/* subtle inner rim for depth */}
      <div className="pointer-events-none absolute inset-[8%] rounded-full ring-1 ring-inset ring-white/10" />
      {/* state label — sits over the portrait, faint until active */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[10%] flex items-center justify-center">
        <span className={cn(
          "rounded-full bg-background/55 backdrop-blur px-3 py-1 text-[10px] font-medium uppercase tracking-[0.28em] text-foreground/85",
          state === "idle" && "opacity-80",
        )}>
          {state === "idle" && "Tap to talk"}
          {state === "listening" && "Listening"}
          {state === "thinking" && "Thinking"}
          {state === "speaking" && "Speaking"}
        </span>
      </div>
    </div>
  );
}


/**
 * Compact, label-free orb badge for chips, headers, and floating docks.
 * Same visual identity as PilotOrb (conic gradient + aurora glow), sized
 * to fit a small slot. Phase 1 replacement for CompanionAvatarFace in all
 * non-conversation surfaces.
 */
export function OrbBadge({
  state = "idle",
  size = "md",
  className,
}: {
  state?: OrbState;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = size === "sm" ? "h-9 w-9" : size === "lg" ? "h-20 w-20" : "h-14 w-14";
  return (
    <div className={cn("relative", px, className)} aria-hidden>
      <div
        className={cn(
          "absolute inset-0 rounded-full blur-md",
          state === "listening" && "bg-[radial-gradient(circle,hsl(var(--primary)/0.85),transparent_70%)] animate-pulse motion-reduce:animate-none",
          state === "thinking" && "bg-[radial-gradient(circle,hsl(280_85%_65%/0.7),transparent_70%)]",
          state === "speaking" && "bg-[radial-gradient(circle,hsl(190_90%_60%/0.85),transparent_70%)]",
          state === "idle" && "bg-[radial-gradient(circle,hsl(var(--primary)/0.45),transparent_70%)]",
        )}
      />
      <div className="absolute inset-[10%] rounded-full border border-white/15 bg-[conic-gradient(from_180deg,hsl(var(--primary)),hsl(280_85%_65%),hsl(190_90%_60%),hsl(var(--primary)))] shadow-[0_0_24px_-6px_hsl(var(--primary))]" />
      <div className="absolute inset-[28%] rounded-full bg-background/60 backdrop-blur-xl border border-white/20" />
    </div>
  );
}

