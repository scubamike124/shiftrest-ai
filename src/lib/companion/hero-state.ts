// Slice 11 — Pure resolver for the dashboard CompanionHero state machine.
// Inputs: signals from brief-window, local prefs, online flag, period freshness.
// Output: a single state + copy + cta + dismiss key. No DOM, no storage.

import type { BriefPeriod } from "@/lib/companion/brief-window";

export type HeroState =
  | "idle"
  | "greeting"
  | "morning_brief"
  | "afternoon_check"
  | "evening_wind"
  | "action_pending"
  | "voice_muted"
  | "quiet_hours"
  | "offline";

export type HeroView = {
  state: HeroState;
  /** Short, calm headline shown next to the orb. */
  title: string;
  /** Optional supporting line. */
  subtitle: string;
  /** Primary CTA label. */
  ctaLabel: string;
  /** Stable key used for the dismiss cooldown. */
  dismissKey: string;
  /** Tailwind class for the orb halo tint. */
  halo: string;
};

export type HeroSignals = {
  period: BriefPeriod;
  /** True when the current period's brief is unseen since its anchor. */
  periodFresh: boolean;
  /** A pending action awaiting user confirmation. */
  actionPending: boolean;
  /** User is offline (navigator.onLine === false). */
  offline: boolean;
  /** Quiet hours window active. */
  quiet: boolean;
  /** Voice replies enabled for this device. */
  voiceMuted: boolean;
  /** Display name (falls back to "there"). */
  name: string;
  /** Local hour 0–23, used to choose greeting word. */
  hour: number;
};

function partOfDay(hour: number): "morning" | "afternoon" | "evening" {
  if (hour >= 4 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

export function resolveHero(signals: HeroSignals): HeroView {
  // Hard signals first — they override period-based copy.
  if (signals.offline) {
    return {
      state: "offline",
      title: "Offline mode",
      subtitle: "I'll have limited help until you're back online.",
      ctaLabel: "Open Companion",
      dismissKey: "offline",
      halo: "from-muted-foreground/30 to-transparent",
    };
  }
  if (signals.actionPending) {
    return {
      state: "action_pending",
      title: "An action needs your confirmation",
      subtitle: "Review and approve when you're ready.",
      ctaLabel: "Review",
      dismissKey: "action_pending",
      halo: "from-primary/40 to-transparent",
    };
  }

  // Period-based prompt (only if fresh).
  if (signals.periodFresh) {
    if (signals.period === "morning") {
      return {
        state: "morning_brief",
        title: "Your morning brief is ready",
        subtitle: "A calm look at sleep, weather, and your day.",
        ctaLabel: "Open brief",
        dismissKey: "morning_brief",
        halo: "from-amber-400/40 to-transparent",
      };
    }
    if (signals.period === "afternoon") {
      return {
        state: "afternoon_check",
        title: "Quick afternoon check-in?",
        subtitle: "Energy, hydration, and what's next.",
        ctaLabel: "Check in",
        dismissKey: "afternoon_check",
        halo: "from-sky-400/40 to-transparent",
      };
    }
    return {
      state: "evening_wind",
      title: "Want to start your wind-down?",
      subtitle: "I can dim things, set sounds, and prep tomorrow.",
      ctaLabel: "Start wind-down",
      dismissKey: "evening_wind",
      halo: "from-violet-400/40 to-transparent",
    };
  }

  // Quiet hours — surface but stay silent.
  if (signals.quiet) {
    return {
      state: "quiet_hours",
      title: "Quiet hours — I'll stay quiet",
      subtitle: "Tap if you need me.",
      ctaLabel: "Open Companion",
      dismissKey: "quiet_hours",
      halo: "from-muted-foreground/20 to-transparent",
    };
  }

  // Greeting fallback — first surface in a period when nothing else applies.
  const part = partOfDay(signals.hour);
  const greet = part === "morning" ? "Good morning" : part === "afternoon" ? "Good afternoon" : "Good evening";
  const name = signals.name?.trim() || "there";
  return {
    state: signals.voiceMuted ? "voice_muted" : "idle",
    title: `${greet}, ${name}.`,
    subtitle: "I'm here when you need me.",
    ctaLabel: "Open Companion",
    dismissKey: "idle",
    halo: "from-primary/25 to-transparent",
  };
}
