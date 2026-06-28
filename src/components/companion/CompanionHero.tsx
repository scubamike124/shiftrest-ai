// Slice 11 — CompanionHero. A calm, prominent dashboard entry for the AI
// Companion. Backward compatible: header avatar chip stays in place; this
// renders as a wide card directly under the greeting and above RightNowCard.

import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X, Settings2, BellOff, WifiOff } from "lucide-react";
import { CompanionAvatarFace } from "@/components/companion/Avatar";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { currentBriefPeriod, lastSeenKey, periodAnchor } from "@/lib/companion/brief-window";
import { resolveHero, type HeroSignals } from "@/lib/companion/hero-state";
import { loadLocalPrefs } from "@/lib/companion/voice-action-prefs";
import { inQuietHours } from "@/lib/companion/quiet-hours";
import { useOnline } from "@/hooks/use-online";
import { dismissPrompt, isPromptFresh } from "@/lib/companion/intro-flag";
import { track } from "@/lib/companion/analytics";

function isPeriodFresh(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const period = currentBriefPeriod();
    const raw = window.localStorage.getItem(lastSeenKey(period));
    const seen = raw ? new Date(raw) : null;
    const anchor = periodAnchor(period);
    return !seen || seen.getTime() < anchor.getTime();
  } catch {
    return false;
  }
}

function firstNameFromEmail(email: string | null | undefined): string {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  const part = local.split(/[._-]/)[0] ?? "";
  if (!part) return "";
  return part.charAt(0).toUpperCase() + part.slice(1);
}

export function CompanionHero() {
  const online = useOnline();
  const [tick, setTick] = useState(0);
  const [actionPending, setActionPending] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [hidden, setHidden] = useState(false);

  // Refresh on brief seen / focus / 5-minute heartbeat so the state can age in.
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener("brief:seen", bump);
    window.addEventListener("focus", bump);
    window.addEventListener("companion-local-prefs:changed", bump);
    const onPending = (e: Event) => {
      const detail = (e as CustomEvent<{ pending: boolean }>).detail;
      setActionPending(Boolean(detail?.pending));
    };
    window.addEventListener("companion:action-pending", onPending as EventListener);
    const t = window.setInterval(bump, 5 * 60_000);
    return () => {
      window.removeEventListener("brief:seen", bump);
      window.removeEventListener("focus", bump);
      window.removeEventListener("companion-local-prefs:changed", bump);
      window.removeEventListener("companion:action-pending", onPending as EventListener);
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
      const full = (meta.full_name as string | undefined) ?? (meta.name as string | undefined);
      const first = full ? full.split(" ")[0] : firstNameFromEmail(data.user?.email);
      setDisplayName(first || "");
    }).catch(() => { /* noop */ });
    return () => {
      cancelled = true;
    };
  }, []);

  const view = useMemo(() => {
    const prefs = loadLocalPrefs();
    const period = currentBriefPeriod();
    const fresh = isPeriodFresh();
    const quiet = inQuietHours(prefs.quietHours);
    const signals: HeroSignals = {
      period,
      periodFresh: fresh,
      actionPending,
      offline: !online,
      quiet,
      voiceMuted: !prefs.voiceRepliesEnabled,
      name: displayName,
      hour: new Date().getHours(),
    };
    return resolveHero(signals);
    // tick is the freshness/heartbeat trigger; intentionally in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionPending, online, displayName, tick]);

  // Respect the per-state 6h dismissal window.
  const shouldRender = !hidden && isPromptFresh(view.dismissKey);

  // Analytics: avatar viewed once per state per session.
  useEffect(() => {
    if (!shouldRender) return;
    track({ event: "avatar_viewed", surface: "dashboard-hero" });
  }, [shouldRender, view.state]);

  if (!shouldRender) return null;

  const onCta = () => {
    track({ event: "avatar_tapped", surface: "dashboard-hero" });
    track({ event: "companion_opened_from_dashboard", via: "hero-cta" });
    if (view.state === "morning_brief" || view.state === "afternoon_check" || view.state === "evening_wind") {
      track({ event: "prompt_accepted", key: view.dismissKey });
    }
  };

  const onDismiss = () => {
    dismissPrompt(view.dismissKey);
    track({ event: "prompt_dismissed", key: view.dismissKey });
    setHidden(true);
  };

  return (
    <section
      aria-labelledby="companion-hero-title"
      className="mt-4 overflow-hidden rounded-3xl border border-border bg-card/80 backdrop-blur-sm"
      data-testid="companion-hero"
    >
      <div className="flex items-stretch gap-4 p-4 sm:p-5">
        {/* Avatar */}
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl sm:h-20 sm:w-20">
          <CompanionAvatarFace state="idle" size="md" />
          {(view.state === "morning_brief" || view.state === "afternoon_check" || view.state === "evening_wind") && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <div className="flex items-center gap-2">
            <h2
              id="companion-hero-title"
              className="truncate text-base font-semibold text-foreground sm:text-lg"
              aria-live="polite"
            >
              {view.title}
            </h2>
            {view.state === "voice_muted" && (
              <BellOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Voice muted" />
            )}
            {view.state === "offline" && (
              <WifiOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Offline" />
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{view.subtitle}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/companion"
              onClick={onCta}
              className={cn(
                "inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground",
                "transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              {view.ctaLabel}
            </Link>
            <button
              type="button"
              onClick={onDismiss}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-sm text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Dismiss this prompt"
            >
              <X className="h-4 w-4 sm:hidden" aria-hidden />
              <span className="hidden sm:inline">Not now</span>
            </button>
            <Link
              to="/settings/companion"
              onClick={() => track({ event: "companion_settings_opened", from: "hero" })}
              className="ml-auto hidden items-center gap-1 rounded-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:inline-flex"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
              Companion settings
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
