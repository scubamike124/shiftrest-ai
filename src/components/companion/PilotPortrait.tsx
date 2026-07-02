import portrait from "@/assets/pilot-portrait.jpg";
import { cn } from "@/lib/utils";

export type PortraitState = "idle" | "speaking" | "thinking";

/**
 * Static premium AI portrait for RestPilot's "Pilot" companion.
 * Renders the generated aurora silhouette with a soft radial glow +
 * idle breathing animation. When state="speaking", adds a pulsing
 * concentric ring — no animated avatar / lip-sync.
 */
export function PilotPortrait({
  state = "idle",
  size = "md",
  eager = false,
  className,
}: {
  state?: PortraitState;
  size?: "sm" | "md" | "lg" | "xl";
  /** Set true only when this is the LCP image on the current route. */
  eager?: boolean;
  className?: string;
}) {
  const px =
    size === "sm"
      ? "h-16 w-16"
      : size === "md"
        ? "h-24 w-24"
        : size === "lg"
          ? "h-36 w-36"
          : "h-56 w-56";

  return (
    <div className={cn("relative shrink-0", px, className)}>
      {/* soft outer aurora glow */}
      <div
        aria-hidden
        className={cn(
          "absolute -inset-3 rounded-full blur-2xl transition-opacity duration-500",
          state === "idle" && "opacity-60 bg-[radial-gradient(circle,hsl(var(--primary)/0.55),transparent_70%)]",
          state === "thinking" && "opacity-70 bg-[radial-gradient(circle,hsl(280_85%_65%/0.6),transparent_70%)]",
          state === "speaking" && "opacity-90 bg-[radial-gradient(circle,hsl(190_90%_60%/0.75),transparent_70%)]",
        )}
      />
      {/* speaking pulse ring */}
      {state === "speaking" ? (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full border border-primary/50 animate-ping"
        />
      ) : null}
      {/* portrait */}
      <div
        className={cn(
          "relative h-full w-full overflow-hidden rounded-full border border-white/15 shadow-[0_10px_40px_-10px_hsl(var(--primary)/0.5)]",
          state === "idle" && "breathe",
        )}
      >
        <img
          src={portrait}
          alt=""
          aria-hidden
          width={1024}
          height={1024}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          className="h-full w-full object-cover"
        />
      </div>
    </div>
  );
}
