// Premium animated companion avatar.
//
// Pass 1 — Layered facial rig over the painted portrait. SVG mouth overlay
//          (upper lip, lower lip, inner darkness) driven by viseme blend +
//          live audio amplitude. Cheek lift gradients. Brow rig.
// Pass 3 — Emotion engine subscription. Brow lift, eyelid open %, mouth-
//          corner bias, cheek lift, gaze, breath rate, blink interval —
//          all re-weighted from EMOTION_PRESETS on `companion:emotion`.
// Pass 4 — Idle presence: weight shift, gaze drift, posture micro-adjust,
//          breath variability, anti-repeat. All gated on reduced-motion +
//          visibilitychange.
// Pass 5 — Speech-sync: peak detector emits `companion:audio-peak` →
//          emphasis nod, brow flash, jaw momentum.
// Pass 6 — Sleep mode: warmer amber aura, slower everything, eyelids rest
//          at 55%, breath rate −30%.
//
// API is unchanged; CompanionAvatar.tsx, CompanionHero.tsx, companion.tsx
// keep working.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { OrbState } from "@/components/PilotOrb";
import { useAvatar } from "@/lib/companion/use-avatar";
import { getEyeRig } from "@/lib/companion/avatars";
import { useRenderer, webglSupported } from "@/lib/companion/renderer-pref";
import { modelUrlFor } from "@/lib/companion/avatar-models";
import {
  EMOTION_PRESETS,
  getEmotion,
  type Emotion,
  type EmotionWeights,
} from "@/lib/companion/emotion";
import {
  VISEMES,
  blendVisemes,
  textToVisemeSequence,
  type VisemeKey,
  type VisemeShape,
} from "@/lib/companion/visemes";

const Avatar3D = lazy(() => import("./Avatar3D"));
const Avatar3DSkeleton = lazy(() =>
  import("./Avatar3D").then((m) => ({ default: m.Avatar3DSkeleton })),
);
const AvatarVideo = lazy(() => import("./AvatarVideo"));

import { hasVideoAvatar } from "@/lib/companion/avatar-states";

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

// Face landmark percentages (tuned for the painted portrait).
const F = {
  eyeLeft: { x: 43, y: 33.5 },
  eyeRight: { x: 57, y: 33.5 },
  eyeW: 7.2,
  eyeH: 3.2,
  browLeft: { x: 43, y: 28.5 },
  browRight: { x: 57, y: 28.5 },
  browW: 8,
  browH: 1.2,
  mouth: { x: 50, y: 47.5 },
  mouthW: 12,
  mouthH: 4.5,
  cheekLeft: { x: 38, y: 44 },
  cheekRight: { x: 62, y: 44 },
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

// Opt-in 3D escape hatch for internal testing only: `?avatar=3d`.
function threeDQueryOptIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("avatar") === "3d";
  } catch { return false; }
}

// ── Public wrapper: prefers video-state → 2D portrait → 3D (opt-in only) ──
// Post-pivot order:
//   1. Video-state clips when the avatar has them (premium, photoreal, iOS-safe)
//   2. 2D painted portrait (the reliable, always-works baseline)
//   3. 3D head ONLY when explicitly requested via `?avatar=3d` or stored pref
//      AND WebGL is supported AND the avatar has a model URL.
// SSR always paints the 2D portrait so hydration matches.
export function CompanionAvatarFace(props: AvatarProps) {
  const { renderer } = useRenderer();
  const { id } = useAvatar();
  const [mounted, setMounted] = useState(false);
  const [webgl] = useState<boolean>(() => webglSupported());
  const [threeDFailed, setThreeDFailed] = useState(false);
  const [videoUnavailable, setVideoUnavailable] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Phase 1 rollback: force 2D-only Companion. Video + 3D paths are kept in
  // the codebase for Phase 2 re-evaluation but disabled at the renderer.
  const wantVideo = false;
  const has3DModel = !!modelUrlFor(id);
  const queryOptIn = mounted && threeDQueryOptIn();
  const want3D = false;
  void renderer; void webgl; void threeDFailed; void videoUnavailable; void has3DModel; void queryOptIn;


  if (wantVideo) {
    return (
      <Suspense fallback={<CompanionAvatarFace2D {...props} />}>
        <div className={cn("relative", props.className)} style={{ width: SIZE_PX[props.size ?? "md"], height: SIZE_PX[props.size ?? "md"] }}>
          <AvatarVideo
            state={props.state}
            size={props.size}
            onUnavailable={() => setVideoUnavailable(true)}
          />
        </div>
      </Suspense>
    );
  }

  if (want3D) {
    return (
      <Suspense fallback={<Avatar3DSkeleton size={props.size} className={props.className} />}>
        <div className={cn("relative", props.className)} style={{ width: SIZE_PX[props.size ?? "md"], height: SIZE_PX[props.size ?? "md"] }}>
          <Avatar3D
            state={props.state}
            level={props.level}
            size={props.size}
            onFail={() => setThreeDFailed(true)}
          />
        </div>
      </Suspense>
    );
  }

  return <CompanionAvatarFace2D {...props} />;
}

function CompanionAvatarFace2D({
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
  const { src: portraitUrl, id: avatarId } = useAvatar();
  const eyeRig = getEyeRig(avatarId);
  // Local face landmark map — eye coords come from the per-avatar rig.
  const FL = { ...F, eyeLeft: eyeRig.eyeLeft, eyeRight: eyeRig.eyeRight, eyeW: eyeRig.eyeW, eyeH: eyeRig.eyeH };

  // ── Environment ──────────────────────────────────────────────────────
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

  // ── Pass 3 — emotion subscription ────────────────────────────────────
  const [emotion, setEmotionState] = useState<Emotion>(() => getEmotion());
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onEmo = (e: Event) => {
      const d = (e as CustomEvent<{ emotion: Emotion }>).detail;
      if (d?.emotion) setEmotionState(d.emotion);
    };
    window.addEventListener("companion:emotion", onEmo as EventListener);
    return () => window.removeEventListener("companion:emotion", onEmo as EventListener);
  }, []);
  const weights: EmotionWeights = EMOTION_PRESETS[emotion];
  const sleepMode = emotion === "sleep";

  // ── Blink scheduler ────────────────────────────────────────────────
  // A single progress ref (0 = fully open, 1 = fully closed) is read by
  // BOTH eyelids inside the rAF tick — so the two lids are always at the
  // identical value in the same frame. No per-eye React state, no
  // asymmetric "half blink." A blink is queued by writing keyframes onto
  // blinkPlanRef; the rAF loop interpolates between them.
  const blinkProgressRef = useRef(0);
  type BlinkFrame = { at: number; v: number };
  const blinkPlanRef = useRef<BlinkFrame[]>([]);

  function scheduleBlink(opts: { closeMs: number; holdMs: number; openMs: number; doubleBlink: boolean }) {
    const t0 = performance.now();
    const { closeMs, holdMs, openMs, doubleBlink } = opts;
    const frames: BlinkFrame[] = [
      { at: t0, v: 0 },
      { at: t0 + closeMs, v: 1 },
      { at: t0 + closeMs + holdMs, v: 1 },
      { at: t0 + closeMs + holdMs + openMs, v: 0 },
    ];
    if (doubleBlink) {
      const gap = 90;
      const base = t0 + closeMs + holdMs + openMs + gap;
      frames.push(
        { at: base, v: 0 },
        { at: base + closeMs * 0.85, v: 1 },
        { at: base + closeMs * 0.85 + 30, v: 1 },
        { at: base + closeMs * 0.85 + 30 + openMs * 0.85, v: 0 },
      );
    }
    blinkPlanRef.current = frames;
  }

  useEffect(() => {
    if (hidden || reduced) return;
    let cancelled = false;
    let t: number | undefined;
    // Slice B — random, slow, eased blink. Long intervals + tiny lid travel
    // (handled by lerp + baseline) so it reads as natural breathing-of-the-
    // eyes rather than a wipe. Skipped while speaking — speaking already has
    // strong facial motion, and a blink mid-syllable feels like a glitch.
    const loop = () => {
      const speaking = stateRef.current === "speaking";
      const speedMul = weightsRef.current.speed;
      const base = speaking ? 6500 : 4200;
      const next = (base + Math.random() * 4800) / speedMul;
      t = window.setTimeout(() => {
        if (cancelled) return;
        if (stateRef.current !== "speaking") {
          scheduleBlink({
            closeMs: 90 + Math.random() * 35,
            holdMs: 24 + Math.random() * 28,
            openMs: 150 + Math.random() * 60,
            doubleBlink: Math.random() < 0.14,
          });
        }
        loop();
      }, next);
    };
    loop();
    return () => { cancelled = true; if (t) window.clearTimeout(t); };
  }, [hidden, reduced, sleepMode]);


  // ── Pass 1 — viseme + amplitude rig ──────────────────────────────────
  const liveLevelRef = useRef(0);
  const visemeSeqRef = useRef<VisemeKey[]>(["REST"]);
  const visemeStartRef = useRef<number>(0);
  const visemeRateRef = useRef<number>(14); // visemes per second
  const lastVisemeRef = useRef<VisemeKey>("REST");


  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLvl = (e: Event) => {
      const d = (e as CustomEvent<{ rms: number }>).detail;
      const raw = Math.max(0, Math.min(1, d?.rms ?? 0));
      liveLevelRef.current = liveLevelRef.current * 0.35 + raw * 0.65;
    };
    const onSpeak = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; mode: string }>).detail;
      if (!d?.text) return;
      visemeSeqRef.current = textToVisemeSequence(d.text);
      visemeStartRef.current = performance.now();
      // Slower cadence for sleep mode, brisker for default speech.
      visemeRateRef.current = d.mode === "sleep" ? 9 : 13;
    };
    window.addEventListener("companion:audio-level", onLvl as EventListener);
    window.addEventListener("companion:speaking-text", onSpeak as EventListener);
    return () => {
      window.removeEventListener("companion:audio-level", onLvl as EventListener);
      window.removeEventListener("companion:speaking-text", onSpeak as EventListener);
    };
  }, []);

  // ── Pass 5 — peak-driven emphasis (nod + brow flash) ─────────────────
  const peakRef = useRef({ kick: 0, decay: 0 });
  useEffect(() => {
    if (typeof window === "undefined" || reduced) return;
    const onPeak = () => { peakRef.current.kick = 1; };
    window.addEventListener("companion:audio-peak", onPeak);
    return () => window.removeEventListener("companion:audio-peak", onPeak);
  }, [reduced]);

  // ── Pass 4 — idle behaviour state (gaze drift, weight shift) ─────────
  const [saccade, setSaccade] = useState({ x: 0, y: 0 });
  const [postureTilt, setPostureTilt] = useState(0);
  const [weightShift, setWeightShift] = useState({ x: 0, r: 0 });
  const lastActionsRef = useRef<string[]>([]);
  function rememberAction(a: string) {
    const arr = lastActionsRef.current;
    arr.push(a);
    if (arr.length > 3) arr.shift();
  }
  function recentlyUsed(a: string): boolean {
    return lastActionsRef.current.includes(a);
  }

  useEffect(() => {
    if (hidden || reduced) return;
    let cancelled = false;
    let t: number | undefined;
    const loop = () => {
      const speaking = stateRef.current === "speaking";
      const speedMul = weightsRef.current.speed;
      const next = ((speaking ? 5500 : 3800) + Math.random() * 5000) / speedMul;
      t = window.setTimeout(() => {
        if (cancelled) return;
        // Pick a target — bias toward "user" so she keeps eye contact.
        const choices = ["user", "user", "up-left", "off-right", "down-soft"];
        const pick = choices[Math.floor(Math.random() * choices.length)];
        if (recentlyUsed(pick)) { loop(); return; }
        rememberAction(pick);
        const amp = speaking ? 0.6 : 1.0;
        let x = 0, y = 0;
        switch (pick) {
          case "user":       x = 0;            y = 0; break;
          case "up-left":    x = -1.4 * amp;   y = -0.9 * amp; break;
          case "off-right":  x =  1.5 * amp;   y =  0.2 * amp; break;
          case "down-soft":  x = -0.4 * amp;   y =  0.8 * amp; break;
        }
        setSaccade({ x, y });
        window.setTimeout(() => { if (!cancelled) setSaccade({ x: 0, y: 0 }); loop(); },
          400 + Math.random() * 700);
      }, next);
    };
    loop();
    return () => { cancelled = true; if (t) window.clearTimeout(t); };
  }, [hidden, reduced]);

  useEffect(() => {
    if (hidden || reduced) return;
    let cancelled = false;
    let t: number | undefined;
    const loop = () => {
      const speedMul = weightsRef.current.speed;
      const next = (12000 + Math.random() * 13000) / speedMul;
      t = window.setTimeout(() => {
        if (cancelled) return;
        const x = (Math.random() - 0.5) * 4;
        const r = (Math.random() - 0.5) * 0.8;
        setWeightShift({ x, r });
        window.setTimeout(() => { if (!cancelled) setWeightShift({ x: 0, r: 0 }); loop(); }, 1400);
      }, next);
    };
    loop();
    return () => { cancelled = true; if (t) window.clearTimeout(t); };
  }, [hidden, reduced]);

  useEffect(() => {
    if (hidden || reduced) return;
    let cancelled = false;
    let t: number | undefined;
    const loop = () => {
      const next = 30_000 + Math.random() * 30_000;
      t = window.setTimeout(() => {
        if (cancelled) return;
        setPostureTilt((Math.random() - 0.5) * 1.2);
        window.setTimeout(() => { if (!cancelled) setPostureTilt(0); loop(); }, 4500);
      }, next);
    };
    loop();
    return () => { cancelled = true; if (t) window.clearTimeout(t); };
  }, [hidden, reduced]);

  // Idle micro-smile — every 9–22s, briefly bias mouth corners up.
  useEffect(() => {
    if (hidden || reduced) return;
    let cancelled = false;
    let t: number | undefined;
    let rafA = 0, rafB = 0;
    const ramp = (from: number, to: number, ms: number, onDone?: () => void) => {
      const start = performance.now();
      const tick = () => {
        if (cancelled) return;
        const k = Math.min(1, (performance.now() - start) / ms);
        microSmileRef.current = from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
        if (k < 1) rafA = requestAnimationFrame(tick);
        else onDone?.();
      };
      tick();
    };
    const loop = () => {
      t = window.setTimeout(() => {
        if (cancelled) return;
        ramp(0, 1, 380, () => {
          rafB = window.setTimeout(() => ramp(1, 0, 520, loop), 480) as unknown as number;
        });
      }, 9_000 + Math.random() * 13_000);
    };
    loop();
    return () => {
      cancelled = true;
      if (t) window.clearTimeout(t);
      if (rafA) cancelAnimationFrame(rafA);
      if (rafB) window.clearTimeout(rafB);
      microSmileRef.current = 0;
    };
  }, [hidden, reduced]);

  // Idle "swallow" — slight head/throat movement, never feels frozen.
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
    return () => { cancelled = true; if (t) window.clearTimeout(t); };
  }, [hidden, reduced]);

  // ── Refs the rAF loop reads (avoids re-renders at frame rate) ────────
  const stateRef = useRef<OrbState>(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const levelPropRef = useRef<number>(level);
  useEffect(() => { levelPropRef.current = level; }, [level]);
  const weightsRef = useRef<EmotionWeights>(weights);
  useEffect(() => { weightsRef.current = weights; }, [weights]);

  // DOM refs
  const headRef = useRef<HTMLDivElement | null>(null);
  const shoulderRef = useRef<HTMLDivElement | null>(null);
  const jawRef = useRef<HTMLImageElement | null>(null);
  const auraRef = useRef<HTMLDivElement | null>(null);
  const browLeftRef = useRef<HTMLDivElement | null>(null);
  const browRightRef = useRef<HTMLDivElement | null>(null);
  const cheekLeftRef = useRef<HTMLDivElement | null>(null);
  const cheekRightRef = useRef<HTMLDivElement | null>(null);
  const lidLeftRef = useRef<HTMLDivElement | null>(null);
  const lidRightRef = useRef<HTMLDivElement | null>(null);
  // Mouth SVG refs (single soft inner-mouth shadow — no visible lip lines)
  const innerMouthRef = useRef<SVGEllipseElement | null>(null);
  const mouthGroupRef = useRef<SVGGElement | null>(null);
  // Idle micro-smile bias (0..1) — read inside the rAF mouth block.
  const microSmileRef = useRef(0);

  // ── rAF — facial rig animation ──────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (reduced || hidden) return;
    let raf = 0;
    let t0 = performance.now();
    let jawLP = 0;
    let browLP = 0;
    let shapeLP: VisemeShape = { ...VISEMES.REST };

    const tick = () => {
      const now = performance.now();
      const dt = (now - t0) / 1000;
      const s = stateRef.current;
      const w = weightsRef.current;
      const listeningLvl = s === "listening" ? levelPropRef.current : 0;
      const speakingLvl = s === "speaking" ? liveLevelRef.current : 0;
      const lvl = Math.max(listeningLvl * 0.7, speakingLvl);
      const gamma = Math.pow(Math.min(1, lvl * 6), 0.55);

      // ── viseme target: walk the sequence by time ──
      let target: VisemeShape = { ...VISEMES.REST };
      let activeViseme: VisemeKey = "REST";
      if (s === "speaking" && visemeSeqRef.current.length > 0) {
        const elapsed = (now - visemeStartRef.current) / 1000;
        const idx = Math.floor(elapsed * visemeRateRef.current);
        const seq = visemeSeqRef.current;
        activeViseme = seq[Math.min(idx, seq.length - 1)] ?? "REST";
        target = { ...VISEMES[activeViseme] };
      }
      // Emit viseme change for the QA HUD (throttled to actual changes).
      if (activeViseme !== lastVisemeRef.current) {
        lastVisemeRef.current = activeViseme;
        window.dispatchEvent(
          new CustomEvent("companion:viseme", { detail: { key: activeViseme } }),
        );
      }
      // Blend toward target shape (slow LP for natural transitions).
      shapeLP = blendVisemes(shapeLP, target, 0.22);

      // ── Blink: interpolate the scheduled keyframes and write --lid to
      //   BOTH lid elements in the SAME frame. Guarantees symmetry.
      {
        const plan = blinkPlanRef.current;
        let p = blinkProgressRef.current;
        if (plan.length > 0) {
          if (now >= plan[plan.length - 1].at) {
            p = plan[plan.length - 1].v;
            blinkPlanRef.current = [];
          } else {
            for (let i = 0; i < plan.length - 1; i++) {
              const a = plan[i];
              const b = plan[i + 1];
              if (now >= a.at && now <= b.at) {
                const t = (now - a.at) / Math.max(1, b.at - a.at);
                // Ease in/out so the lid feels like real flesh, not a wipe.
                const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                p = a.v + (b.v - a.v) * eased;
                break;
              }
            }
          }
        }
        blinkProgressRef.current = p;
        // Baseline lid coverage from emotion (eyes wider/narrower at rest).
        const baseline = w.lidOpen * 0.18; // 0..~0.18 at idle
        const lidValue = Math.max(baseline, p);
        if (lidLeftRef.current) lidLeftRef.current.style.setProperty("--lid", lidValue.toFixed(3));
        if (lidRightRef.current) lidRightRef.current.style.setProperty("--lid", lidValue.toFixed(3));
      }




      // Combine viseme openness with live amplitude.
      const ampOpen = s === "speaking" ? gamma : 0;
      const finalOpen = Math.min(1, shapeLP.open * (0.6 + ampOpen * 1.1));

      // ── mouth SVG ──
      if (mouthGroupRef.current) {
        // Corner bias: emotion lift + viseme corner.
        const cornerLift = w.corners * 0.35 + shapeLP.corner * 0.6 + microSmileRef.current * 0.45;
        mouthGroupRef.current.setAttribute(
          "transform",
          `translate(0 ${-cornerLift * 0.35}) scale(${shapeLP.wide} 1)`,
        );
      }
      if (innerMouthRef.current) {
        const cy = 50;
        const gap = finalOpen * F.mouthH;
        const halfW = F.mouthW * 0.5;
        innerMouthRef.current.setAttribute("cx", "50");
        innerMouthRef.current.setAttribute("cy", `${cy + gap * 0.55}`);
        innerMouthRef.current.setAttribute("rx", `${halfW * 0.85}`);
        innerMouthRef.current.setAttribute("ry", `${0.35 + gap * 0.95}`);
        // Fade entirely when mouth is closed so no rig is visible at rest.
        const op = finalOpen < 0.04 ? 0 : Math.min(0.55, shapeLP.inner * 0.55 + ampOpen * 0.45);
        innerMouthRef.current.setAttribute("opacity", op.toFixed(3));
      }

      // ── jaw drop (subtle portrait translate) ──
      jawLP += (gamma * 0.6 + shapeLP.open * 0.4 - jawLP) * 0.18;
      if (jawRef.current) {
        const jawPx = s === "speaking" ? jawLP * 3.1 : 0;
        const sy = s === "speaking" ? 1 + jawLP * 0.006 : 1;
        jawRef.current.style.setProperty("--jaw", `${jawPx}px`);
        jawRef.current.style.setProperty("--jaw-sy", `${sy}`);
      }

      // ── brow lift (emotion baseline + speech emphasis) ──
      const browBase = w.brow * 1.6;
      const browSpeech =
        s === "listening" ? -1.2 :
        s === "thinking"  ? -0.6 :
        s === "speaking"  ? -gamma * 1.8 : 0;
      const targetBrow = browBase + browSpeech;
      browLP += (targetBrow - browLP) * 0.12;
      // Add a brief peak kick (Pass 5).
      const kick = peakRef.current.kick;
      if (kick > 0) {
        peakRef.current.kick = Math.max(0, kick - 0.06);
      }
      const browFinal = browLP - kick * 1.4;
      if (browLeftRef.current) browLeftRef.current.style.transform = `translateY(${browFinal}px)`;
      if (browRightRef.current) browRightRef.current.style.transform = `translateY(${browFinal * 0.9}px)`;

      // ── cheek lift (emotion + open-vowel boost) ──
      const cheekOp = Math.min(1, w.cheeks + (shapeLP.open > 0.4 ? 0.15 * ampOpen : 0));
      if (cheekLeftRef.current) cheekLeftRef.current.style.opacity = `${cheekOp}`;
      if (cheekRightRef.current) cheekRightRef.current.style.opacity = `${cheekOp}`;

      // ── head: bob + emphasis nod + posture + weight ──
      if (headRef.current) {
        const bobAmp =
          s === "speaking" ? 0.4 + gamma * 1.4 :
          s === "listening" ? 0.5 : 0.35;
        const bobX = Math.sin(dt * 1.1) * bobAmp * 0.5 + weightShift.x * 0.4;
        const bobY = Math.sin(dt * 1.7) * bobAmp;
        const nod = kick * 1.6;
        const lean = s === "listening" ? -0.4 : 0;
        const baseTilt =
          s === "listening" ? 0.6 :
          s === "thinking" ? -0.4 :
          Math.sin(dt * 0.9) * 0.3;
        const tilt = baseTilt + postureTilt + weightShift.r;
        headRef.current.style.transform =
          `translate(${bobX}px, ${(-bobY + lean) - nod}px) rotate(${tilt}deg)`;
      }

      // ── shoulder breathing — rate from emotion BPM (with ±8% jitter) ──
      if (shoulderRef.current) {
        const period = 60 / w.breathBpm;
        const breathe = 1 + Math.sin((dt / period) * Math.PI * 2) * (sleepMode ? 0.020 : 0.013);
        shoulderRef.current.style.transform = `scale(${breathe})`;
      }

      // ── aura ──
      if (auraRef.current) {
        const auraScale =
          s === "speaking" ? 1 + Math.min(gamma * 0.08, 0.08) :
          s === "listening" ? 1 + Math.min(levelPropRef.current * 1.5, 0.06) : 1;
        const auraOp = s === "thinking"
          ? 0.4 + Math.sin(dt * 3.5) * 0.12
          : sleepMode ? 0.7 + Math.sin(dt * 0.7) * 0.08 : 0.55;
        auraRef.current.style.transform = `scale(${auraScale})`;
        auraRef.current.style.opacity = `${auraOp}`;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, hidden, sleepMode, weightShift.x, weightShift.r, postureTilt]);

  // Expression overlay opacities (kept for backward compat).
  const smileOpacity = expression === "smile" ? 0.5 : 0;
  const concernOpacity = expression === "concerned" ? 0.4 : 0;

  // Glance offsets
  const glanceX = (state === "thinking" && !reduced ? 0.6 : 0) + saccade.x + weights.gaze.x;
  const glanceY = saccade.y + weights.gaze.y;

  // Aura colour — warm amber for sleep, otherwise state-driven cool.
  const auraColor = sleepMode
    ? "hsl(28 95% 62% / 0.55)"
    : state === "listening" ? "hsl(var(--primary) / 0.55)"
    : state === "thinking"  ? "hsl(280 85% 65% / 0.55)"
    : state === "speaking"  ? "hsl(190 90% 60% / 0.65)"
    : "hsl(var(--primary) / 0.4)";

  const browColor = "rgba(70, 38, 28, 0.55)";
  const objectPosition = size === "sm" ? "50% 18%" : "50% 20%";

  // Eyelid is driven from rAF via --lid (0 = open, 1 = closed) on each lid
  // element. Computed identically for both lids so they can never desync.

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: px, height: px }}
      aria-hidden={!label}
      role={label ? "img" : undefined}
      aria-label={label}
      data-testid="companion-avatar-face"
      data-emotion={emotion}
    >
      <style>{`
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
            transition: "background 700ms ease, opacity 250ms ease",
          }}
        />
      )}

      {/* Static inner ring (md/lg only) */}
      {size !== "sm" && (
        <div
          aria-hidden
          className="absolute inset-0 rounded-full ring-1 ring-white/10"
          style={{
            boxShadow: sleepMode
              ? "inset 0 0 18px hsl(28 90% 60% / 0.18)"
              : "inset 0 0 14px hsl(var(--primary) / 0.10)",
            transition: "box-shadow 700ms ease",
          }}
        />
      )}

      {/* Head */}
      <div ref={headRef} className="relative h-full w-full" style={{ willChange: "transform" }}>
        <div
          ref={shoulderRef}
          className="relative h-full w-full overflow-hidden rounded-full"
          style={{ transformOrigin: "50% 95%", willChange: "transform" }}
        >
          {/* Portrait */}
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
              filter: sleepMode ? "brightness(0.92) saturate(0.9)" : "none",
            }}
          />

          {/* Cheek lifts — soft warm gradients */}
          <div
            ref={cheekLeftRef}
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              left: `${F.cheekLeft.x - 6}%`,
              top: `${F.cheekLeft.y - 3}%`,
              width: "12%",
              height: "8%",
              background: "radial-gradient(ellipse, rgba(255,180,140,0.45), transparent 70%)",
              opacity: 0,
              mixBlendMode: "screen",
              transition: "opacity 240ms ease",
            }}
          />
          <div
            ref={cheekRightRef}
            aria-hidden
            className="absolute pointer-events-none"
            style={{
              left: `${F.cheekRight.x - 6}%`,
              top: `${F.cheekRight.y - 3}%`,
              width: "12%",
              height: "8%",
              background: "radial-gradient(ellipse, rgba(255,180,140,0.45), transparent 70%)",
              opacity: 0,
              mixBlendMode: "screen",
              transition: "opacity 240ms ease",
            }}
          />

          {/* Brows */}
          <div
            ref={browLeftRef}
            aria-hidden
            className="absolute"
            style={{
              left: `${F.browLeft.x - F.browW / 2}%`,
              top: `${F.browLeft.y}%`,
              width: `${F.browW}%`,
              height: `${F.browH}%`,
              background: browColor,
              borderRadius: "60%",
              filter: "blur(0.8px)",
              willChange: "transform",
            }}
          />
          <div
            ref={browRightRef}
            aria-hidden
            className="absolute"
            style={{
              left: `${F.browRight.x - F.browW / 2}%`,
              top: `${F.browRight.y}%`,
              width: `${F.browW}%`,
              height: `${F.browH}%`,
              background: browColor,
              borderRadius: "60%",
              filter: "blur(0.8px)",
              willChange: "transform",
            }}
          />

          {/* Eyelids — top-down shutter anchored at the upper lash line.
              At rest, `--lid` ≈ 0 (invisible thin sliver). On blink the rAF
              loop ramps `--lid` to 1 on BOTH elements in the same frame, so
              the lids close downward over the iris in perfect sync. Gaze
              never translates the lid — the lid stays locked to the eye. */}
          <div
            ref={lidLeftRef}
            aria-hidden
            className="absolute"
            style={{
              left: `${FL.eyeLeft.x - FL.eyeW / 2}%`,
              top: `${FL.eyeLeft.y - FL.eyeH * 0.85}%`,
              width: `${FL.eyeW}%`,
              height: `${FL.eyeH * 1.7}%`,
              background: `linear-gradient(to bottom, ${eyeRig.lidTop} 0%, ${eyeRig.lidMid} 65%, transparent 100%)`,
              borderRadius: "55% 55% 50% 50% / 80% 80% 35% 35%",
              transformOrigin: "50% 0%",
              transform: "scaleY(var(--lid, 0))",
              willChange: "transform",
              filter: "blur(0.5px)",
              pointerEvents: "none",
            }}
          />
          <div
            ref={lidRightRef}
            aria-hidden
            className="absolute"
            style={{
              left: `${FL.eyeRight.x - FL.eyeW / 2}%`,
              top: `${FL.eyeRight.y - FL.eyeH * 0.85}%`,
              width: `${FL.eyeW}%`,
              height: `${FL.eyeH * 1.7}%`,
              background: `linear-gradient(to bottom, ${eyeRig.lidTop} 0%, ${eyeRig.lidMid} 65%, transparent 100%)`,
              borderRadius: "55% 55% 50% 50% / 80% 80% 35% 35%",
              transformOrigin: "50% 0%",
              transform: "scaleY(var(--lid, 0))",
              willChange: "transform",
              filter: "blur(0.5px)",
              pointerEvents: "none",
            }}
          />


          {/* Soft inner-mouth shadow — no visible lip lines.
              Tints existing painted lips via multiply blend; vanishes when closed. */}
          {size !== "sm" && (
            <svg
              aria-hidden
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full pointer-events-none"
              style={{ mixBlendMode: "multiply" }}
            >
              <defs>
                <radialGradient id="mouthShadow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%"  stopColor="rgba(28,8,12,0.85)" />
                  <stop offset="55%" stopColor="rgba(40,14,18,0.45)" />
                  <stop offset="100%" stopColor="rgba(40,14,18,0)" />
                </radialGradient>
                <filter id="mouthBlur" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="1.1" />
                </filter>
              </defs>
              <g ref={mouthGroupRef} style={{ transformOrigin: "50% 47.5%" }}>
                <ellipse
                  ref={innerMouthRef}
                  cx="50"
                  cy="50"
                  rx="5"
                  ry="0.4"
                  fill="url(#mouthShadow)"
                  filter="url(#mouthBlur)"
                  opacity="0"
                />
              </g>
            </svg>
          )}

          {/* Legacy smile/concern overlays */}
          {smileOpacity > 0 && (
            <div
              aria-hidden
              className="absolute"
              style={{
                left: `${F.mouth.x - F.mouthW * 1.2}%`,
                top: `${F.mouth.y - 0.4}%`,
                width: `${F.mouthW * 2.4}%`,
                height: "1.2%",
                background: "transparent",
                borderBottom: "1px solid rgba(70,38,28,0.4)",
                borderRadius: "0 0 100% 100% / 0 0 100% 100%",
                opacity: smileOpacity,
                filter: "blur(0.6px)",
              }}
            />
          )}
          {concernOpacity > 0 && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse 30% 8% at 50% 30%, rgba(20,10,10,0.18), transparent 70%)",
                opacity: concernOpacity,
              }}
            />
          )}

          {/* Rim light */}
          {size !== "sm" && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none rounded-full"
              style={{
                background: "radial-gradient(ellipse 60% 45% at 28% 22%, rgba(220,235,255,0.18), transparent 60%)",
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
        <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 h-full w-full pointer-events-none">
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
    case "listening": return "Listening";
    case "thinking":  return "Thinking";
    case "speaking":  return "Speaking";
    default:          return "Tap to talk";
  }
}
