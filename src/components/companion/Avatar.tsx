// Portrait-based animated avatar for the RestPilot AI Companion.
//
// Visual: painterly portrait (src/assets/companion-portrait.png) with a
// lightweight overlay rig for blink, breath, head sway, eye saccades,
// mouth amplitude, brow lift, jaw drop, shoulder breathing, and aura.
//
// Lip-sync engine:
//   `companion:audio-level` CustomEvent → ref + rAF (NOT React state) so we
//   never re-render at audio-frame rate. Mouth/jaw/brow are written via
//   inline-style mutation on a ref-held element. Works for every size,
//   including the small dashboard chip.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { OrbState } from "@/components/PilotOrb";
import portraitUrl from "@/assets/companion-portrait.png";

export type AvatarExpression = "neutral" | "smile" | "concerned" | "sleepy";

export type AvatarProps = {
  state: OrbState;
  level?: number;
  size?: "sm" | "md" | "lg";
  expression?: AvatarExpression;
  className?: string;
  aura?: boolean;
  label?: string;
};

const SIZE_PX: Record<NonNullable<AvatarProps["size"]>, number> = {
  sm: 40,
  md: 80,
  lg: 224,
};

const FEATURES = {
  eyeLeft: { x: 43, y: 33.5 },
  eyeRight: { x: 57, y: 33.5 },
  eyeW: 7.2,
  eyeH: 3.2,
  browLeft: { x: 43, y: 28.5 },
  browRight: { x: 57, y: 28.5 },
  browW: 8,
  browH: 1.2,
  mouth: { x: 50, y: 47.5 },
  mouthW: 7,
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

  // ── Reduced motion + tab visibility ──────────────────────────────────
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

  // ── Blink loop (3–8s with ~1-in-5 double, occasional slow blink) ────
  const [blink, setBlink] = useState(false);
  const [halfBlinkRight, setHalfBlinkRight] = useState(false);
  useEffect(() => {
    if (hidden) return;
    let cancelled = false;
    let t: number | undefined;
    const closeOpen = (after: number, holdMs: number, cb: () => void) => {
      setBlink(true);
      window.setTimeout(() => {
        if (cancelled) return;
        setBlink(false);
        window.setTimeout(() => { if (!cancelled) cb(); }, after);
      }, holdMs);
    };
    const loop = () => {
      const next = 3000 + Math.random() * 5000;
      t = window.setTimeout(() => {
        if (cancelled) return;
        const doubleBlink = Math.random() < 0.2;
        const slowBlink = Math.random() < 0.05;
        const asymmetric = Math.random() < 0.15;
        if (asymmetric) {
          setHalfBlinkRight(true);
          window.setTimeout(() => setHalfBlinkRight(false), 110);
        }
        closeOpen(140, slowBlink ? 260 : 130, () => {
          if (doubleBlink) closeOpen(80, 120, loop);
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

  // ── Lip-sync via rAF + refs (no React state churn) ──────────────────
  const liveLevelRef = useRef(0);
  const lipShadowRef = useRef<HTMLDivElement | null>(null);
  const jawRef = useRef<HTMLImageElement | null>(null);
  const browLeftRef = useRef<HTMLDivElement | null>(null);
  const browRightRef = useRef<HTMLDivElement | null>(null);
  const shoulderRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const auraRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLvl = (e: Event) => {
      const detail = (e as CustomEvent<{ rms: number }>).detail;
      const raw = Math.max(0, Math.min(1, detail?.rms ?? 0));
      // Mild smoothing — analyser already smooths at 0.25.
      liveLevelRef.current = liveLevelRef.current * 0.35 + raw * 0.65;
    };
    window.addEventListener("companion:audio-level", onLvl as EventListener);
    return () => window.removeEventListener("companion:audio-level", onLvl as EventListener);
  }, []);

  // rAF tick: mutates inline styles directly. Drives mouth/jaw/brow/sway.
  const stateRef = useRef<OrbState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const levelPropRef = useRef<number>(level);
  useEffect(() => { levelPropRef.current = level; }, [level]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (reduced || hidden) return;
    let raf = 0;
    let t0 = performance.now();
    let jawLP = 0;     // jaw low-pass (slower than mouth)
    let browLP = 0;
    const tick = () => {
      const now = performance.now();
      const dt = (now - t0) / 1000;
      const s = stateRef.current;
      const listeningLvl = s === "listening" ? levelPropRef.current : 0;
      const speakingLvl = s === "speaking" ? liveLevelRef.current : 0;
      const lvl = Math.max(listeningLvl * 0.7, speakingLvl);

      // Non-linear gamma so quiet syllables register visibly.
      const gamma = Math.pow(Math.min(1, lvl * 6), 0.55);

      // Lip shadow opacity tracks amplitude — gives a clear "mouth moving" cue
      // without ever painting a black overlay shape on the face.
      if (lipShadowRef.current) {
        const op = s === "speaking" ? 0.12 + gamma * 0.38 : 0;
        lipShadowRef.current.style.opacity = `${op}`;
      }

      // Jaw drop (slow LPF on lvl) — translate portrait down 0..3px + tiny scaleY
      jawLP += (gamma - jawLP) * 0.18;
      if (jawRef.current) {
        const jawPx = s === "speaking" ? jawLP * 3.0 : 0;
        const sy = s === "speaking" ? 1 + jawLP * 0.006 : 1;
        jawRef.current.style.setProperty("--jaw", `${jawPx}px`);
        jawRef.current.style.setProperty("--jaw-sy", `${sy}`);
      }

      // Brow lift: listening = small lift; speaking = peaks on emphasis
      const targetBrow =
        s === "listening" ? -1.2 :
        s === "thinking" ? -0.6 :
        s === "speaking" ? -gamma * 1.8 : 0;
      browLP += (targetBrow - browLP) * 0.12;
      if (browLeftRef.current) browLeftRef.current.style.transform = `translateY(${browLP}px)`;
      if (browRightRef.current) browRightRef.current.style.transform = `translateY(${browLP * 0.9}px)`;

      // Speaking head bob — sine driven by audio amplitude
      if (headRef.current) {
        const bobAmp =
          s === "speaking" ? 0.4 + gamma * 1.6 :
          s === "listening" ? 0.6 : 0.4;
        const bobX = Math.sin(dt * 1.1) * bobAmp * 0.5;
        const bobY = Math.sin(dt * 1.7) * bobAmp;
        const tilt = s === "listening" ? 0.6 : s === "thinking" ? -0.4 : Math.sin(dt * 0.9) * 0.3;
        headRef.current.style.transform = `translate(${bobX}px, ${-bobY}px) rotate(${tilt}deg)`;
      }

      // Shoulder breathing — slower sine, gentle scale-Y
      if (shoulderRef.current) {
        const breathe = 1 + Math.sin(dt * 1.05) * 0.012;
        shoulderRef.current.style.transform = `scale(${breathe})`;
      }

      // Aura pulse — calmer, never bigger than 1.08
      if (auraRef.current) {
        const auraScale =
          s === "speaking" ? 1 + Math.min(gamma * 0.08, 0.08) :
          s === "listening" ? 1 + Math.min(levelPropRef.current * 1.5, 0.06) : 1;
        const auraOp = s === "thinking" ? 0.4 + Math.sin(dt * 3.5) * 0.12 : 0.55;
        auraRef.current.style.transform = `scale(${auraScale})`;
        auraRef.current.style.opacity = `${auraOp}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, hidden]);

  // ── Eye saccades — also during speech (lower amplitude) ─────────────
  const [saccade, setSaccade] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (hidden || reduced) return;
    let cancelled = false;
    let t: number | undefined;
    const loop = () => {
      const speaking = stateRef.current === "speaking";
      const next = (speaking ? 6000 : 4000) + Math.random() * 5000;
      t = window.setTimeout(() => {
        if (cancelled) return;
        const amp = speaking ? 0.6 : 1.0;
        const x = (Math.random() - 0.5) * 1.6 * amp;
        const y = (Math.random() - 0.5) * 0.8 * amp;
        setSaccade({ x, y });
        window.setTimeout(() => {
          if (cancelled) return;
          setSaccade({ x: 0, y: 0 });
          loop();
        }, 350 + Math.random() * 600);
      }, next);
    };
    loop();
    return () => {
      cancelled = true;
      if (t) window.clearTimeout(t);
    };
  }, [hidden, reduced]);

  // Idle "swallow" micro-movement so she never feels frozen.
  const [swallow, setSwallow] = useState(false);
  useEffect(() => {
    if (hidden || reduced) return;
    let cancelled = false;
    let t: number | undefined;
    const loop = () => {
      t = window.setTimeout(() => {
        if (cancelled) return;
        setSwallow(true);
        window.setTimeout(() => setSwallow(false), 250);
        loop();
      }, 25_000 + Math.random() * 35_000);
    };
    loop();
    return () => {
      cancelled = true;
      if (t) window.clearTimeout(t);
    };
  }, [hidden, reduced]);

  // Expression bias (subtle) — applied via opacity overlays.
  const smileOpacity = expression === "smile" ? 0.5 : 0;
  const concernOpacity = expression === "concerned" ? 0.4 : 0;

  // Reduced-motion fallback values
  const reducedMouthOpen = reduced && state === "speaking" ? 1.8 : 0;

  // Glance offsets
  const glanceX = (state === "thinking" && !reduced ? 0.6 : 0) + saccade.x;
  const glanceY = saccade.y;

  const auraColor =
    state === "listening"
      ? "hsl(var(--primary) / 0.55)"
      : state === "thinking"
        ? "hsl(280 85% 65% / 0.55)"
        : state === "speaking"
          ? "hsl(190 90% 60% / 0.65)"
          : "hsl(var(--primary) / 0.4)";

  const eyelidColor = "rgb(212, 168, 140)";
  const browColor = "rgba(70, 38, 28, 0.55)";
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
        @keyframes companion-breath { 0%,100% { transform: scale(1) } 50% { transform: scale(1.014) } }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="companion-avatar-face"] * { animation: none !important; }
        }
      `}</style>

      {/* Aura */}
      {showAura && (
        <div
          ref={auraRef}
          aria-hidden
          className="absolute inset-0 rounded-full blur-2xl"
          style={{
            background: `radial-gradient(circle, ${auraColor}, transparent 70%)`,
            transition: "background 500ms ease, opacity 250ms ease",
          }}
        />
      )}

      {/* Soft inner ring */}
      {size !== "sm" && (
        <div
          aria-hidden
          className="absolute inset-0 rounded-full ring-1 ring-white/10"
          style={{
            boxShadow:
              state === "speaking"
                ? "inset 0 0 18px hsl(190 70% 60% / 0.20)"
                : state === "listening"
                  ? "inset 0 0 14px hsl(var(--primary) / 0.16)"
                  : "inset 0 0 14px hsl(var(--primary) / 0.10)",
            transition: "box-shadow 500ms ease",
          }}
        />
      )}

      {/* Head — driven by rAF for speaking sway */}
      <div ref={headRef} className="relative h-full w-full" style={{ willChange: "transform" }}>
        {/* Shoulder breathing wrapper (origin near chest) */}
        <div
          ref={shoulderRef}
          className="relative h-full w-full overflow-hidden rounded-full"
          style={{ transformOrigin: "50% 95%", willChange: "transform" }}
        >
          <img
            ref={jawRef}
            src={portraitUrl}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none"
            style={{
              objectFit: "cover",
              objectPosition,
              transform: `translate(${glanceX * 0.4}px, calc(${glanceY * 0.3}px + var(--jaw, 0px) + ${swallow ? 0.5 : 0}px)) scaleY(var(--jaw-sy, 1))`,
              transformOrigin: "50% 70%",
              transition: "transform 240ms ease",
            }}
          />

          {/* Brow overlays */}
          <div
            ref={browLeftRef}
            aria-hidden
            className="absolute"
            style={{
              left: `${FEATURES.browLeft.x - FEATURES.browW / 2}%`,
              top: `${FEATURES.browLeft.y}%`,
              width: `${FEATURES.browW}%`,
              height: `${FEATURES.browH}%`,
              background: browColor,
              borderRadius: "60%",
              filter: "blur(0.8px)",
              opacity: 0,
              willChange: "transform",
            }}
          />
          <div
            ref={browRightRef}
            aria-hidden
            className="absolute"
            style={{
              left: `${FEATURES.browRight.x - FEATURES.browW / 2}%`,
              top: `${FEATURES.browRight.y}%`,
              width: `${FEATURES.browW}%`,
              height: `${FEATURES.browH}%`,
              background: browColor,
              borderRadius: "60%",
              filter: "blur(0.8px)",
              opacity: 0,
              willChange: "transform",
            }}
          />

          {/* Eyelids */}
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
              transform: `scaleY(${blink ? 1 : 0.04}) translate(${glanceX}px, ${glanceY}px)`,
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
              transform: `scaleY(${blink || halfBlinkRight ? 1 : 0.04}) translate(${glanceX}px, ${glanceY}px)`,
              transition: "transform 90ms ease",
              opacity: 0.95,
              filter: "blur(0.4px)",
            }}
          />

          {/* Lip shadow — a subtle warm darkening UNDER the lip line.
              No black overlay shape; opacity is driven by audio amplitude. */}
          <div
            ref={lipShadowRef}
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              left: `${FEATURES.mouth.x - 9}%`,
              top: `${FEATURES.mouth.y + 0.8}%`,
              width: "18%",
              height: "5%",
              background:
                "radial-gradient(ellipse 50% 60% at 50% 35%, rgba(60,20,28,0.55), transparent 70%)",
              mixBlendMode: "multiply",
              filter: "blur(1.6px)",
              opacity: reduced && state === "speaking" ? 0.35 : 0,
              willChange: "opacity",
            }}
          />


          {/* Smile overlay (subtle mouth-corner lift) */}
          {smileOpacity > 0 && (
            <div
              aria-hidden
              className="absolute"
              style={{
                left: `${FEATURES.mouth.x - FEATURES.mouthW * 1.2}%`,
                top: `${FEATURES.mouth.y - 0.4}%`,
                width: `${FEATURES.mouthW * 2.4}%`,
                height: "1.2%",
                background: "transparent",
                borderBottom: "1px solid rgba(70,38,28,0.4)",
                borderRadius: "0 0 100% 100% / 0 0 100% 100%",
                opacity: smileOpacity,
                filter: "blur(0.6px)",
              }}
            />
          )}
          {/* Concerned overlay (brow-down bias) */}
          {concernOpacity > 0 && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse 30% 8% at 50% 30%, rgba(20,10,10,0.18), transparent 70%)",
                opacity: concernOpacity,
              }}
            />
          )}

          {/* Listening warmth on the jaw/chin */}
          {state === "listening" && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(ellipse 55% 35% at 50% 72%, hsl(var(--primary) / 0.10), transparent 70%)",
              }}
            />
          )}

          {/* Rim light */}
          {size !== "sm" && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none rounded-full"
              style={{
                background:
                  "radial-gradient(ellipse 60% 45% at 28% 22%, rgba(220,235,255,0.18), transparent 60%)",
                mixBlendMode: "screen",
              }}
            />
          )}

          {/* Vignette */}
          {size !== "sm" && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none rounded-full"
              style={{ boxShadow: "inset 0 0 40px rgba(8,10,20,0.45)" }}
            />
          )}
        </div>
      </div>

      {/* Thinking dots */}
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
