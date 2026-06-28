/**
 * Inline 4-7-8 breathing overlay. Self-contained — no audio, no nav.
 * Closes on Escape, backdrop click, or "Done".
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const PHASES = [
  { label: "Inhale", seconds: 4, scale: 1.4 },
  { label: "Hold",   seconds: 7, scale: 1.4 },
  { label: "Exhale", seconds: 8, scale: 0.85 },
] as const;

export function BreathingOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [remaining, setRemaining] = useState(PHASES[0].seconds);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (!open) return;
    setPhaseIdx(0);
    setRemaining(PHASES[0].seconds);
    setCycle(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r > 1) return r - 1;
        setPhaseIdx((p) => {
          const next = (p + 1) % PHASES.length;
          if (next === 0) setCycle((c) => c + 1);
          return next;
        });
        return 0;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setRemaining(PHASES[phaseIdx].seconds);
  }, [phaseIdx, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const phase = PHASES[phaseIdx];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-label="Breathing exercise"
    >
      <div
        className="flex flex-col items-center gap-6 px-6 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          4-7-8 breathing · cycle {cycle + 1}
        </p>
        <div
          className="flex h-56 w-56 items-center justify-center rounded-full border border-primary/40 bg-primary/10 transition-transform duration-1000 ease-in-out"
          style={{ transform: `scale(${phase.scale})` }}
        >
          <div className="text-center">
            <p className="text-2xl font-semibold tracking-tight">{phase.label}</p>
            <p className="mt-1 text-5xl font-light tabular-nums text-primary">{Math.max(remaining, 1)}</p>
          </div>
        </div>
        <Button variant="outline" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
