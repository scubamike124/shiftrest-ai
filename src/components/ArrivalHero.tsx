/**
 * ArrivalHero — personalized greeting shown on the dashboard.
 * Step 1 of the "One Trusted Companion" phase.
 *
 * Pulls display_name from the user's profile and surfaces the latest
 * RightNow action (cached in sessionStorage by RightNowCard) so the
 * dashboard greets the user with something the AI has *already done*.
 *
 * No extra LLM calls — reuses the right_now intent's existing cache.
 */
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useDecisionsSinceLastVisit, useNextDecision } from "@/lib/ai/decisions";

const RIGHT_NOW_CACHE_KEY = "rp_right_now_v1";

type CachedRightNow = {
  action?: string;
  urgency?: "now" | "soon" | "later";
  cachedAt?: number;
};

function readCachedAction(): CachedRightNow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(RIGHT_NOW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRightNow;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function timeOfDayGreeting(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Late night";
}

function firstName(preferred: string | null | undefined): string {
  const raw = (preferred ?? "").trim();
  if (!raw) return "";
  return raw.split(/\s+/)[0].replace(/^./, (c) => c.toUpperCase());
}

export function ArrivalHero({ dateLabel }: { dateLabel: string }) {
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState<string>("");
  const [cached, setCached] = useState<CachedRightNow | null>(null);

  useEffect(() => {
    setMounted(true);
    setCached(readCachedAction());

    let cancelled = false;
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data.user;
      if (!user || cancelled) return;
      const { data: prefsRow } = await supabase
        .from("user_prefs")
        .select("preferred_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setName(firstName(prefsRow?.preferred_name ?? null));
    });

    // Listen for RightNowCard updates so the hero refreshes when the AI acts.
    function onStorage(e: StorageEvent) {
      if (e.key === RIGHT_NOW_CACHE_KEY) setCached(readCachedAction());
    }
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const hour = mounted ? new Date().getHours() : 12;
  const greeting = timeOfDayGreeting(hour);
  const headline = name ? `${greeting}, ${name}.` : `${greeting}.`;

  const hasAdjusted = !!cached?.action;
  const subline = hasAdjusted
    ? cached!.urgency === "now"
      ? `I've lined up your next move — ${cached!.action!.toLowerCase()}.`
      : `I've already adjusted today's plan. Here's what I'd like you to do next.`
    : `Welcome back. Here's where you stand today.`;

  const { total, sinceLastVisit } = useDecisionsSinceLastVisit();
  const nextDecision = useNextDecision();
  const adjustments = sinceLastVisit > 0 ? sinceLastVisit : total;

  let nextNudge: string | null = null;
  if (nextDecision) {
    const ev = nextDecision.evidence as { timeWindow?: { startIso?: string } } | null;
    const start = ev?.timeWindow?.startIso ? Date.parse(ev.timeWindow.startIso) : NaN;
    if (!Number.isNaN(start)) {
      const mins = Math.max(1, Math.round((start - Date.now()) / 60_000));
      nextNudge = mins < 60 ? `Next nudge in ~${mins} min.` : `Next nudge in ~${Math.round(mins / 60)}h.`;
    }
  }

  return (
    <header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 lg:mb-8">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-indigo-glow">
          <Sparkles className="h-3 w-3" />
          Pilot
        </p>
        <h1 className="mt-1 truncate text-[28px] leading-none sm:text-[34px] lg:text-[52px]">
          {headline}
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground lg:text-base">
          {subline}{" "}
          <span className="text-foreground/60">{dateLabel}</span>
        </p>
        {adjustments > 0 && (
          <p className="mt-1.5 max-w-xl text-xs text-indigo-glow/90 lg:text-sm">
            While you were away, I made{" "}
            <span className="font-semibold text-foreground">{adjustments}</span>{" "}
            adjustment{adjustments === 1 ? "" : "s"} to today's plan.
            {nextNudge ? ` ${nextNudge}` : ""}
          </p>
        )}
      </div>
    </header>
  );
}
