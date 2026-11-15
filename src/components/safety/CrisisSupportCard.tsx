// Static crisis-line card shown when the local crisis-cue check
// (src/lib/safety/crisis-cues.ts) matches something the user typed or said.
// No AI, no network and no AI consent needed: the text and numbers are built
// in, so it works offline. It never blocks the conversation; the user can
// close it and keep typing.

import { Heart, X } from "lucide-react";
import { CRISIS_RESOURCES as R } from "@/lib/safety/crisis-cues";

export function CrisisSupportCard({ onClose }: { onClose: () => void }) {
  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Support is available"
      data-testid="crisis-support-card"
      className="relative rounded-2xl border border-primary/40 bg-card px-4 py-3 text-sm leading-relaxed text-foreground shadow-[var(--shadow-glow)]"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:scale-95"
        aria-label="Close support card"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="flex items-center gap-2 pr-8 font-semibold">
        <Heart className="h-4 w-4 text-primary" /> You don't have to go through this alone.
      </p>
      <p className="mt-1 text-muted-foreground">
        If you're thinking about suicide or hurting yourself, or you may have taken too much of
        something, please reach out to a person right now.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        <li>
          <span className="font-medium">In the US:</span> call or text{" "}
          <a className="font-semibold text-primary underline" href={`tel:${R.usLine}`}>
            {R.usLine}
          </a>{" "}
          ({R.usLineName}), any time. In immediate danger, call{" "}
          <a className="font-semibold text-primary underline" href={`tel:${R.usEmergency}`}>
            {R.usEmergency}
          </a>
          .
        </li>
        <li>
          <span className="font-medium">Anywhere else:</span> call your local emergency number, or
          find a free, confidential helpline at{" "}
          <a
            className="font-semibold text-primary underline"
            href={R.findAHelplineUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {R.findAHelplineLabel}
          </a>
          .
        </li>
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        I'm still here, and you can keep typing below.
      </p>
    </section>
  );
}
