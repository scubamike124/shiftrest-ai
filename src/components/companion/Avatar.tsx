// Phase 1 — Portrait-based animated avatar for the RestPilot AI Companion.
//
// Visual: premium painterly-realistic portrait (src/assets/companion-portrait.png)
// with a lightweight overlay rig for blink, breath, head sway, eye-glance,
// mouth amplitude, and aura. All animation contracts are preserved from the
// previous SVG implementation so every call site continues to work unchanged.
//
// Engine unchanged:
//   - `companion:audio-level` CustomEvent from src/lib/companion/speak.ts drives
//     speaking mouth amplitude (RMS 0..1).
//   - Idle blink loop, reduced-motion guard, visibility pause.
//   - State machine, intent router, action layer untouched.
//
// Lightweight: one PNG + absolute-positioned overlays, no canvas/three/lottie.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { OrbState } from "@/components/PilotOrb";
import portraitUrl from "@/assets/companion-portrait.png";

export type AvatarExpression = "neutral" | "smile" | "concerned" | "sleepy";

export type AvatarProps = {
  state: OrbState;
  /** 0..~0.5 — used directly while listening; used as fallback for speaking. */
  level?: number;
  /** sm = dashboard chip (~40px), md = hero (~80), lg = full Companion (~224). */
  size?: "sm" | "md" | "lg";
  expression?: AvatarExpression;
  className?: string;
  /** Show the soft outer aura (default true for md/lg, false for sm). */
  aura?: boolean;
  /** Label under the avatar (lg only). */
  label?: string;
};

const SIZE_PX: Record<NonNullable<AvatarProps["size"]>, number> = {
  sm: 40,
  md: 80,
  lg: 224,
};

// Approximate facial-feature positions on the portrait image, expressed as %
// of the rendered avatar box (square). Calibrated against the generated PNG.
const FEATURES = {
  eyeLeft: { x: 43, y: 33.5 },
  eyeRight: { x: 57, y: 33.5 },
  eyeW: 7.2, // eyelid width %
  eyeH: 3.2, // eyelid closed height %
  mouth: { x: 50, y: 47.5 },
  mouthW: 7, // base mouth width %
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function CompanionAvatarFace({
  state,
  level = 0,
  size = "md",
  expression = "neutral",
  className,
  aura,
  label,
}: AvatarProps) {
  const px = SIZE_PX[size];
  const showAura = aura ?? size !== "sm";

  // ── Reduced motion + tab visibility ──────────────────────────────────────
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotion());
  const [hidden, setHidden] = useState<boolean>(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onMq);
    const onVis = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mq.removeEventListener?.("change", onMq);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // ── Blink loop (3–8s with ~1-in-5 double blink) ──────────────────────────
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    let t: number | undefined;
    const closeOpen = (after: number, cb: () => void) => {
      setBlink(true);
      window.setTimeout(() => {
        if (cancelled) return;
        setBlink(false);
        window.setTimeout(() => { if (!cancelled) cb(); }, after);
      }, 130);
    };
    const loop = () => {
      const next = 3000 + Math.random() * 5000;
      t = window.setTimeout(() => {
        if (cancelled) return;
        const doubleBlink = Math.random() < 0.2;
        closeOpen(140, () => {
          if (doubleBlink) closeOpen(80, loop);
          else loop();
        });
      }, next);
    };
    loop();
    return () => {
      cancelled = true;
      if (t) window.clearTimeout(t);
    };
  }, [hidden]);

  // ── Speaking amplitude via companion:audio-level event ───────────────────
  const [audioLevel, setAudioLevel] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLvl = (e: Event) => {
      const detail = (e as CustomEvent<{ rms: number }>).detail;
      const rms = Math.max(0, Math.min(1, detail?.rms ?? 0));
      setAudioLevel((prev) => prev + (rms - prev) * 0.55);
    };
    window.addEventListener("companion:audio-level", onLvl as EventListener);
    return () => window.removeEventListener("companion:audio-level", onLvl as EventListener);
  }, []);

  const liveLevel =
    state === "speaking" ? Math.max(audioLevel, level) : state === "listening" ? level : 0;

  // Mouth-open % (height of the dark mouth ellipse, in % of avatar box)
  const mouthOpen = reduced
    ? state === "speaking"
      ? 1.4
      : 0
    : state === "speaking"
      ? Math.max(0.5, Math.min(4.5, liveLevel * 10))
      : 0;

  // Eye glance (small horizontal shift on thinking)
  const glanceX = state === "thinking" && !reduced ? 0.6 : 0;

  // Aura color per state
  const auraColor =
    state === "listening"
      ? "hsl(var(--primary) / 0.55)"
      : state === "thinking"
        ? "hsl(280 85% 65% / 0.55)"
        : state === "speaking"
          ? "hsl(190 90% 60% / 0.65)"
          : "hsl(var(--primary) / 0.4)";

  const auraScale = reduced
    ? 1
    : state === "listening"
      ? 1 + Math.min(level * 3, 0.25)
      : state === "speaking"
        ? 1 + Math.min(liveLevel * 1.5, 0.18)
        : 1;

  const idleAnim =
    !reduced && !hidden
      ? "[animation:companion-bob_5.5s_ease-in-out_infinite]"
      : "";
  const breath =
    !reduced && !hidden
      ? "[animation:companion-breath_4.6s_ease-in-out_infinite]"
      : "";

  // Skin-tone matched eyelid color (matches portrait warm skin)
  const eyelidColor = "rgb(212, 168, 140)";

  // For sm chip, zoom in tighter on the face via object-position.
  const objectPosition = size === "sm" ? "50% 18%" : "50% 20%";

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: px, height: px }}
      aria-hidden={!label}
      role={label ? "img" : undefined}
      aria-label={label}
      data-testid="companion-avatar-face"
    >
      <style>{`
        @keyframes companion-bob { 0%,100% { transform: translate(0,0) } 50% { transform: translate(0.4px,-1.6px) } }
        @keyframes companion-breath { 0%,100% { transform: scale(1) } 50% { transform: scale(1.012) } }
        @keyframes companion-aura-pulse { 0%,100% { opacity:.55 } 50% { opacity:.95 } }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="companion-avatar-face"] * { animation: none !important; }
        }
      `}</style>

      {/* Aura */}
      {showAura && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-full blur-2xl transition-opacity duration-500",
            state === "thinking" && !reduced && "[animation:companion-aura-pulse_1.8s_ease-in-out_infinite]",
            state === "idle" && "opacity-60",
          )}
          style={{
            background: `radial-gradient(circle, ${auraColor}, transparent 70%)`,
            transform: `scale(${auraScale})`,
          }}
        />
      )}

      {/* Soft inner ring (md/lg only) — gentle warmth, never bright. */}
      {size !== "sm" && (
        <div
          aria-hidden
          className="absolute inset-0 rounded-full ring-1 ring-white/10"
          style={{
            boxShadow:
              state === "speaking"
                ? "inset 0 0 18px hsl(190 70% 60% / 0.18)"
                : state === "listening"
                  ? "inset 0 0 14px hsl(var(--primary) / 0.14)"
                  : "inset 0 0 14px hsl(var(--primary) / 0.10)",
            transition: "box-shadow 500ms ease",
          }}
        />
      )}

      {/* Portrait + overlay rig */}
      <div className={cn("relative h-full w-full overflow-hidden rounded-full", idleAnim)}>
        <div className={cn("relative h-full w-full", breath)} style={{ transformOrigin: "50% 65%" }}>
          <img
            src={portraitUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none"
            style={{
              objectFit: "cover",
              objectPosition,
              transform: `translateX(${glanceX * 0.4}px)`,
              transition: "transform 400ms ease",
            }}
          />

          {/* Eyelids — overlay rectangles that "close" on blink */}
          <div
            aria-hidden
            className="absolute"
            style={{
              left: `${FEATURES.eyeLeft.x - FEATURES.eyeW / 2}%`,
              top: `${FEATURES.eyeLeft.y - FEATURES.eyeH / 2}%`,
              width: `${FEATURES.eyeW}%`,
              height: `${FEATURES.eyeH}%`,
              background: eyelidColor,
              borderRadius: "40%",
              transformOrigin: "50% 100%",
              transform: `scaleY(${blink ? 1 : 0.04}) translateX(${glanceX}px)`,
              transition: "transform 90ms ease",
              opacity: 0.95,
              filter: "blur(0.4px)",
            }}
          />
          <div
            aria-hidden
            className="absolute"
            style={{
              left: `${FEATURES.eyeRight.x - FEATURES.eyeW / 2}%`,
              top: `${FEATURES.eyeRight.y - FEATURES.eyeH / 2}%`,
              width: `${FEATURES.eyeW}%`,
              height: `${FEATURES.eyeH}%`,
              background: eyelidColor,
              borderRadius: "40%",
              transformOrigin: "50% 100%",
              transform: `scaleY(${blink ? 1 : 0.04}) translateX(${glanceX}px)`,
              transition: "transform 90ms ease",
              opacity: 0.95,
              filter: "blur(0.4px)",
            }}
          />

          {/* Mouth opening overlay — only when speaking */}
          {state === "speaking" && size !== "sm" && (
            <div
              aria-hidden
              className="absolute"
              style={{
                left: `${FEATURES.mouth.x - FEATURES.mouthW / 2}%`,
                top: `${FEATURES.mouth.y - mouthOpen / 2}%`,
                width: `${FEATURES.mouthW}%`,
                height: `${mouthOpen}%`,
                background: "rgba(40, 18, 22, 0.78)",
                borderRadius: "50%",
                filter: "blur(1.2px)",
                transition: "height 70ms linear, top 70ms linear",
              }}
            />
          )}

          {/* Listening: soft warmth on the jaw/chin, NEVER on the eyes. */}
          {state === "listening" && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse 55% 35% at 50% 72%, hsl(var(--primary) / 0.08), transparent 70%)",
              }}
            />
          )}
        </div>
      </div>

      {/* Thinking dots — kept outside clip so they appear above head */}
      {state === "thinking" && size !== "sm" && (
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          className="absolute inset-0 h-full w-full pointer-events-none"
        >
          <g fill="hsl(280 85% 75%)">
            <circle cx="78" cy="14" r="1.8">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="85" cy="9" r="2">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="0.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="92" cy="5" r="2.2">
              <animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
            </circle>
          </g>
        </svg>
      )}

      {label && size === "lg" && (
        <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-medium uppercase tracking-[0.3em] text-foreground/70">
          {label}
        </span>
      )}

      {/* expression is reserved for future micro-adjustments (e.g. brow tilt overlays) */}
      {void expression}
    </div>
  );
}

/** Convenience: derives a small label from state for the lg Companion view. */
export function avatarStateLabel(state: OrbState): string {
  switch (state) {
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    default:
      return "Tap to talk";
  }
}
