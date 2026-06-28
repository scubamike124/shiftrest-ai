import { Link } from "@tanstack/react-router";
import { Waves, Play } from "lucide-react";
import { HomeCard, HomeCardHeader } from "./HomeCard";

export function SleepSoundsCard() {
  return (
    <HomeCard className="flex h-full flex-col">
      <HomeCardHeader
        eyebrow="Sleep Sounds"
        title="Soundscape Mixer"
        action={
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-indigo-glow">
            <Waves className="h-4 w-4" />
          </span>
        }
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Rain, ocean, brown noise — layered for the perfect drift-off.
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
        {["Rain", "Ocean", "Storm"].map((label) => (
          <span
            key={label}
            className="rounded-xl border border-white/10 bg-white/5 px-2 py-2 text-center font-medium text-foreground/80"
          >
            {label}
          </span>
        ))}
      </div>

      <Link
        to="/sleep"
        className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary/15 px-4 text-xs font-semibold text-foreground transition hover:bg-primary/25"
      >
        <Play className="h-3.5 w-3.5 text-indigo-glow" />
        Open mixer
      </Link>
    </HomeCard>
  );
}
