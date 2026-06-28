// Phase 1 — Animated SVG character avatar for the AI Companion.
// Replaces the previous gradient "tap to talk" orb across all surfaces.
//
// Features:
//   - Idle: subtle head bob + chest breath + randomized blinks.
//   - Listening: aura ring pulses with mic `level` prop.
//   - Thinking: brow + eye glance, dotted aura.
//   - Speaking: mouth amplitude follows `companion:audio-level` CustomEvent
//     dispatched from `src/lib/companion/speak.ts` (or `level` prop fallback).
//   - Reduced motion: only blink, no bob/breath, mouth stays neutral.
//   - Auto-pauses on `document.visibilitychange` hidden.
//
// Lightweight: pure SVG + RAF, no canvas/three/lottie/rive runtime.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { OrbState } from "@/components/PilotOrb";

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

  // ── Blink loop (cheap setTimeout chain) ──────────────────────────────────
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    let t: number | undefined;
    const loop = () => {
      const next = 2800 + Math.random() * 3200;
      t = window.setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        window.setTimeout(() => {
          if (cancelled) return;
          setBlink(false);
          loop();
        }, 120);
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
      // Smoothing — small ease toward target.
      setAudioLevel((prev) => prev + (rms - prev) * 0.55);
    };
    window.addEventListener("companion:audio-level", onLvl as EventListener);
    return () => window.removeEventListener("companion:audio-level", onLvl as EventListener);
  }, []);

  // Choose the effective mouth-open input.
  const liveLevel =
    state === "speaking" ? Math.max(audioLevel, level) : state === "listening" ? level : 0;

  // ── Visual mapping ───────────────────────────────────────────────────────
  // Mouth height 1.6..10 based on amplitude (mobile-safe range).
  const mouthOpen = reduced
    ? state === "speaking"
      ? 4
      : 2
    : Math.max(1.6, Math.min(10, liveLevel * 28));

  // Expression tweaks
  const browTilt =
    expression === "concerned"
      ? -4
      : expression === "smile"
        ? 2
        : state === "thinking"
          ? -2
          : 0;
  const mouthCurve =
    expression === "smile" ? 2 : expression === "concerned" ? -2 : expression === "sleepy" ? 1 : 0;
  const eyeY = expression === "sleepy" ? 56 : state === "thinking" ? 52 : 54;
  const eyeShiftX = state === "thinking" ? 3 : 0;
  const eyelidY = expression === "sleepy" ? 56 : blink ? 54 : 47;

  // Aura color per state
  const auraColor =
    state === "listening"
      ? "hsl(var(--primary) / 0.55)"
      : state === "thinking"
        ? "hsl(280 85% 65% / 0.55)"
        : state === "speaking"
          ? "hsl(190 90% 60% / 0.65)"
          : "hsl(var(--primary) / 0.35)";

  const auraScale = reduced
    ? 1
    : state === "listening"
      ? 1 + Math.min(level * 3, 0.25)
      : state === "speaking"
        ? 1 + Math.min(liveLevel * 1.5, 0.18)
        : 1;

  // Idle animation classes
  const idleAnim =
    !reduced && !hidden && (state === "idle" || state === "listening")
      ? "[animation:companion-bob_5s_ease-in-out_infinite]"
      : "";
  const breath =
    !reduced && !hidden
      ? "[animation:companion-breath_4.2s_ease-in-out_infinite]"
      : "";

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: px, height: px }}
      aria-hidden={!label}
      role={label ? "img" : undefined}
      aria-label={label}
      data-testid="companion-avatar-face"
    >
      {/* Keyframes scoped via style tag so we don't need a tailwind config edit */}
      <style>{`
        @keyframes companion-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2px) } }
        @keyframes companion-breath { 0%,100% { transform: scale(1) } 50% { transform: scale(1.015) } }
        @keyframes companion-aura-pulse { 0%,100% { opacity:.55 } 50% { opacity:.9 } }
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

      <div className={cn("relative h-full w-full", idleAnim)}>
        <svg
          viewBox="0 0 100 100"
          width={px}
          height={px}
          className={cn(breath)}
          style={{ transformOrigin: "50% 60%" }}
        >
          <defs>
            <radialGradient id={`face-grad-${size}`} cx="50%" cy="40%" r="65%">
              <stop offset="0%" stopColor="hsl(var(--primary) / 0.95)" />
              <stop offset="55%" stopColor="hsl(265 70% 55% / 0.95)" />
              <stop offset="100%" stopColor="hsl(225 50% 25% / 0.95)" />
            </radialGradient>
            <radialGradient id={`face-shine-${size}`} cx="35%" cy="30%" r="35%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </radialGradient>
          </defs>

          {/* Head */}
          <circle cx="50" cy="52" r="38" fill={`url(#face-grad-${size})`} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
          <circle cx="50" cy="52" r="38" fill={`url(#face-shine-${size})`} />

          {/* Brows */}
          <g stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" strokeLinecap="round">
            <line
              x1="34"
              y1={42 + browTilt * 0.4}
              x2="44"
              y2={40 - browTilt * 0.4}
            />
            <line
              x1="56"
              y1={40 - browTilt * 0.4}
              x2="66"
              y2={42 + browTilt * 0.4}
            />
          </g>

          {/* Eyes (whites) */}
          <g fill="rgba(255,255,255,0.96)">
            <ellipse cx={38 + eyeShiftX} cy={eyeY} rx="4.2" ry="4.6" />
            <ellipse cx={62 + eyeShiftX} cy={eyeY} rx="4.2" ry="4.6" />
          </g>
          {/* Pupils */}
          <g fill="hsl(225 70% 12%)">
            <circle cx={38 + eyeShiftX} cy={eyeY + 0.5} r="2" />
            <circle cx={62 + eyeShiftX} cy={eyeY + 0.5} r="2" />
          </g>
          {/* Eyelids — closing line, animated via y */}
          <g fill={`url(#face-grad-${size})`}>
            <rect x="33" y={eyelidY - 8} width="11" height={blink ? 14 : eyelidY - (eyeY - 5)} rx="3" style={{ transition: "height 90ms ease" }} />
            <rect x="57" y={eyelidY - 8} width="11" height={blink ? 14 : eyelidY - (eyeY - 5)} rx="3" style={{ transition: "height 90ms ease" }} />
          </g>

          {/* Mouth */}
          {state === "speaking" ? (
            <ellipse
              cx="50"
              cy="70"
              rx={Math.max(5, 5 + mouthOpen * 0.25)}
              ry={mouthOpen * 0.55}
              fill="hsl(225 60% 10%)"
              style={{ transition: "rx 60ms linear, ry 60ms linear" }}
            />
          ) : (
            <path
              d={`M 42 ${70 - mouthCurve} Q 50 ${70 + mouthCurve * 1.8} 58 ${70 - mouthCurve}`}
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
            />
          )}

          {/* Thinking dots */}
          {state === "thinking" && (
            <g fill="hsl(280 85% 75%)">
              <circle cx="78" cy="22" r="1.6">
                <animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" repeatCount="indefinite" />
              </circle>
              <circle cx="84" cy="18" r="1.8">
                <animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="0.2s" repeatCount="indefinite" />
              </circle>
              <circle cx="90" cy="14" r="2">
                <animate attributeName="opacity" values="0.2;1;0.2" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
              </circle>
            </g>
          )}
        </svg>
      </div>

      {label && size === "lg" && (
        <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] font-medium uppercase tracking-[0.3em] text-foreground/70">
          {label}
        </span>
      )}
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
