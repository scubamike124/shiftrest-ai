import { useEffect, useState } from "react";
import { Droplets, Plus, Minus } from "lucide-react";
import { HomeCard, HomeCardHeader } from "./HomeCard";

const GOAL = 8;
const KEY_PREFIX = "rp.hydration.";

function todayKey() {
  const d = new Date();
  return `${KEY_PREFIX}${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function HydrationCard() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(todayKey());
      setCount(raw ? Math.max(0, Math.min(GOAL * 2, parseInt(raw, 10) || 0)) : 0);
    } catch {
      /* noop */
    }
  }, []);

  function save(next: number) {
    setCount(next);
    try {
      localStorage.setItem(todayKey(), String(next));
    } catch {
      /* noop */
    }
  }

  const pct = Math.min(100, Math.round((count / GOAL) * 100));

  return (
    <HomeCard className="flex h-full flex-col">
      <HomeCardHeader
        eyebrow="Hydration"
        title={`${count} of ${GOAL} glasses`}
        action={
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-400/20 text-sky-300">
            <Droplets className="h-4 w-4" />
          </span>
        }
      />

      <div className="mt-3 grid grid-cols-8 gap-1.5">
        {Array.from({ length: GOAL }, (_, i) => (
          <span
            key={i}
            className={`h-7 rounded-md transition-colors ${
              i < count ? "bg-gradient-to-b from-sky-300 to-sky-500" : "bg-white/8 border border-white/10"
            }`}
          />
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">{pct}% of today's goal</p>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => save(Math.max(0, count - 1))}
          className="flex h-9 flex-1 items-center justify-center rounded-full border border-white/10 bg-white/5 text-foreground/80 transition-transform active:scale-95"
          aria-label="Remove a glass of water"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={() => save(Math.min(GOAL * 2, count + 1))}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-sky-500/20 text-sky-100 transition-transform active:scale-95"
          aria-label="Add a glass of water"
        >
          <Plus className="h-4 w-4" />
          <span className="text-xs font-semibold">Glass</span>
        </button>
      </div>
    </HomeCard>
  );
}
