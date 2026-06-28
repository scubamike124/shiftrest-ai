// Dashboard entry-chip → /companion. Pulses gently when there's a fresh
// Morning Brief the user hasn't acknowledged yet today.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { getBriefLastSeen } from "@/components/morning/MorningBrief";

function isStale(seen: Date | null): boolean {
  if (!seen) return true;
  // Stale if last seen is before today 04:00 local.
  const cutoff = new Date();
  cutoff.setHours(4, 0, 0, 0);
  return seen.getTime() < cutoff.getTime();
}

export function CompanionAvatar() {
  const [pulse, setPulse] = useState<boolean>(() => isStale(getBriefLastSeen()));

  useEffect(() => {
    const refresh = () => setPulse(isStale(getBriefLastSeen()));
    window.addEventListener("brief:seen", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("brief:seen", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return (
    <Link
      to="/companion"
      search={{ brief: 1 } as never}
      aria-label="Open Companion morning brief"
      className={cn(
        "relative mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
        "border border-primary/40 bg-gradient-to-br from-primary/20 to-background",
        "transition-transform hover:scale-105 lg:h-12 lg:w-12",
      )}
      data-testid="companion-avatar"
    >
      <Sparkles className="h-4 w-4 text-primary lg:h-5 lg:w-5" />
      {pulse && (
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
      )}
    </Link>
  );
}
