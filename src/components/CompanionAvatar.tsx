// Dashboard entry-chip → /companion. Pulses gently when there's a fresh
// briefing (morning / afternoon / evening) the user hasn't acknowledged yet
// for the current period.

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { currentBriefPeriod, lastSeenKey, periodAnchor } from "@/lib/companion/brief-window";
import { track } from "@/lib/companion/analytics";

function isPeriodFresh(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const period = currentBriefPeriod();
    const raw = window.localStorage.getItem(lastSeenKey(period));
    const seen = raw ? new Date(raw) : null;
    const anchor = periodAnchor(period);
    if (!seen) return true;
    return seen.getTime() < anchor.getTime();
  } catch {
    return false;
  }
}

export function CompanionAvatar() {
  const [pulse, setPulse] = useState<boolean>(() => isPeriodFresh());

  useEffect(() => {
    const refresh = () => setPulse(isPeriodFresh());
    window.addEventListener("brief:seen", refresh);
    window.addEventListener("focus", refresh);
    const t = window.setInterval(refresh, 5 * 60_000);
    return () => {
      window.removeEventListener("brief:seen", refresh);
      window.removeEventListener("focus", refresh);
      window.clearInterval(t);
    };
  }, []);

  return (
    <Link
      to="/companion"
      onClick={() => {
        track({ event: "avatar_tapped", surface: "dashboard-header" });
        track({ event: "companion_opened_from_dashboard", via: "header-chip" });
      }}
      aria-label={pulse ? "Open Companion — new briefing ready" : "Open Companion"}
      className={cn(
        "relative mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
        "border border-primary/40 bg-gradient-to-br from-primary/20 to-background",
        "transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "lg:h-12 lg:w-12",
      )}
      data-testid="companion-avatar"
    >
      <Sparkles className="h-4 w-4 text-primary lg:h-5 lg:w-5" aria-hidden />
      {pulse && (
        <span aria-hidden className="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75 motion-reduce:animate-none" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
      )}
    </Link>
  );
}
