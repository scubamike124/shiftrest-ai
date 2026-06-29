// Phase E — Speaking presence indicator.
//
// A small horizontal waveform shown beneath the Companion avatar while it is
// speaking. Driven by the same `companion:audio-level` CustomEvent the avatar
// uses for lip-sync, so it stays in lock-step with the audio without creating
// a second voice-state system.
//
// Visibility is owned by the parent (it passes `active`). When `active` is
// false the component renders nothing — guarantees animation stops the
// instant speech ends/fails/skips/cancels.
//
// Accessibility:
//   - Honors prefers-reduced-motion: bars become static dots, no animation.
//   - `aria-hidden` — the speaking state is also surfaced as text in the
//     trust strip and the avatar's aria-label, so screen readers don't need
//     this decorative element.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const BAR_COUNT = 5;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function SpeakingIndicator({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotion());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onMq);
    return () => mq.removeEventListener?.("change", onMq);
  }, []);

  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const phaseRef = useRef(0);
  const levelRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;
    const onLvl = (e: Event) => {
      const detail = (e as CustomEvent<{ rms: number }>).detail;
      const rms = Math.max(0, Math.min(1, detail?.rms ?? 0));
      // Light smoothing.
      levelRef.current = levelRef.current + (rms - levelRef.current) * 0.55;
    };
    window.addEventListener("companion:audio-level", onLvl as EventListener);
    return () => window.removeEventListener("companion:audio-level", onLvl as EventListener);
  }, [active]);

  useEffect(() => {
    if (!active || reduced) {
      // Reset bars to a calm baseline on stop.
      barsRef.current.forEach((el) => {
        if (el) el.style.transform = "scaleY(0.35)";
      });
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const tick = () => {
      phaseRef.current += 0.18;
      const lvl = levelRef.current;
      barsRef.current.forEach((el, i) => {
        if (!el) return;
        // Each bar gets its own sine offset for a natural waveform shimmer,
        // scaled by the live audio amplitude.
        const wave = 0.5 + 0.5 * Math.sin(phaseRef.current + i * 0.9);
        const amp = 0.25 + Math.min(1, lvl * 4.5) * wave * 0.95;
        el.style.transform = `scaleY(${Math.max(0.18, Math.min(1, amp)).toFixed(3)})`;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active, reduced]);

  if (!active) return null;

  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none flex h-4 items-end justify-center gap-[3px]",
        className,
      )}
    >
      {Array.from({ length: BAR_COUNT }).map((_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className={cn(
            "block w-[3px] origin-bottom rounded-full",
            "bg-gradient-to-t from-primary/70 to-[hsl(190_90%_60%)]",
            "shadow-[0_0_6px_hsl(190_90%_60%/0.55)]",
          )}
          style={{
            height: "100%",
            transform: reduced ? "scaleY(0.45)" : "scaleY(0.3)",
            transition: reduced ? undefined : "transform 70ms linear",
          }}
        />
      ))}
    </div>
  );
}
