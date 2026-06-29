// Video-state avatar — the post-pivot premium pipeline.
//
// Renders one <video> per OrbState (idle / listening / thinking / speaking)
// and crossfades between them on state change. Mute, playsinline, looped —
// the exact subset of HTMLVideoElement that iPhone Safari supports without
// WebGL, KTX2, or any 3D decoder. This is intentionally boring tech.
//
// Audio-reactive jaw: while in `speaking` state we subscribe to the existing
// `companion:audio-level` events from speak.ts and drive a subtle SVG mouth
// overlay synced to the actual TTS playback — not baked into the clip.
//
// If no clips exist for the selected avatar, the parent renders the 2D
// portrait instead. AvatarVideo never paints an empty shell.

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { OrbState } from "@/components/PilotOrb";
import { useAvatar } from "@/lib/companion/use-avatar";
import { videoClipsFor } from "@/lib/companion/avatar-states";

type Props = {
  state: OrbState;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Called when no clips exist for the current avatar so the parent can fall back. */
  onUnavailable?: () => void;
};

const SIZE_PX = { sm: 40, md: 80, lg: 224 } as const;
const CROSSFADE_MS = 220;

export default function AvatarVideo({ state, size = "lg", className, onUnavailable }: Props) {
  const px = SIZE_PX[size];
  const { id } = useAvatar();
  const clips = useMemo(() => videoClipsFor(id), [id]);

  useEffect(() => {
    if (!clips) onUnavailable?.();
  }, [clips, onUnavailable]);

  // Pick the active clip URL, falling back to idle when a state has no clip.
  const url = useMemo<string | null>(() => {
    if (!clips) return null;
    return clips[state] || clips.idle || clips.listening || clips.thinking || clips.speaking || null;
  }, [clips, state]);

  // Two stacked <video>s: `a` is currently visible, `b` preloads the next URL
  // then we swap which is opaque. Keeps decode work off the visible frame.
  const [layers, setLayers] = useState<{ a: string | null; b: string | null; showB: boolean }>(
    () => ({ a: url, b: null, showB: false }),
  );

  useEffect(() => {
    if (!url) return;
    setLayers((prev) => {
      const visible = prev.showB ? prev.b : prev.a;
      if (visible === url) return prev;
      // Load the new URL into the hidden layer and flip opacity.
      return prev.showB
        ? { a: url, b: prev.b, showB: false }
        : { b: url, a: prev.a, showB: true };
    });
  }, [url]);

  // Speaking jaw overlay: amplitude from speak.ts dispatches.
  const liveLevelRef = useRef(0);
  const [jaw, setJaw] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onLvl = (e: Event) => {
      const d = (e as CustomEvent<{ rms: number }>).detail;
      const raw = Math.max(0, Math.min(1, d?.rms ?? 0));
      liveLevelRef.current = liveLevelRef.current * 0.55 + raw * 0.45;
    };
    window.addEventListener("companion:audio-level", onLvl as EventListener);
    return () => window.removeEventListener("companion:audio-level", onLvl as EventListener);
  }, []);

  useEffect(() => {
    if (state !== "speaking") {
      setJaw(0);
      return;
    }
    let raf = 0;
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      const target = Math.min(1, Math.pow(liveLevelRef.current * 4.2, 0.6));
      setJaw((prev) => prev + (target - prev) * 0.25);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { mounted = false; cancelAnimationFrame(raf); };
  }, [state]);

  if (!clips || !url) return null;

  const poster = clips.poster;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-full bg-gradient-to-b from-indigo-950/40 to-slate-900/40",
        className,
      )}
      style={{ width: px, height: px }}
      data-renderer="video"
      data-state={state}
    >
      {layers.a && (
        <VideoLayer
          src={layers.a}
          poster={poster}
          visible={!layers.showB}
        />
      )}
      {layers.b && (
        <VideoLayer
          src={layers.b}
          poster={poster}
          visible={layers.showB}
        />
      )}
      {state === "speaking" && jaw > 0.04 && (
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <ellipse
            cx="50"
            cy="62"
            rx={6 + jaw * 4}
            ry={1.6 + jaw * 4.5}
            fill="rgba(20, 8, 8, 0.55)"
            style={{ transition: `all ${Math.round(1000 / 60)}ms linear` }}
          />
        </svg>
      )}
      <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/8" />
    </div>
  );
}

function VideoLayer({ src, poster, visible }: { src: string; poster?: string; visible: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // iOS Safari requires an explicit play() after src changes even with
    // autoPlay + muted; swallow errors (autoplay blocked is fine, poster shows).
    v.play().catch(() => undefined);
  }, [src]);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      className={cn(
        "absolute inset-0 h-full w-full object-cover",
        "transition-opacity",
      )}
      style={{
        opacity: visible ? 1 : 0,
        transitionDuration: `${CROSSFADE_MS}ms`,
      }}
    />
  );
}
