// Slice 8 — Companion action framework.
//
// One typed registry of actions the Companion can propose. The chat surface
// renders an <ActionCard /> for any non-navigation action and only calls
// executeAction() after the user taps Confirm. Placeholder kinds return a
// safe "coming soon" message instead of pretending the action ran.

import { mixer } from "@/lib/sounds/mixer";
import { TRACK_BY_SLUG, PRESETS } from "@/lib/sounds/catalog";
import type { Intent } from "@/lib/voice/intent-router";

export type CompanionAction =
  | { kind: "play_track"; slug: string; label: string; minutes?: number }
  | { kind: "stop_all" }
  | { kind: "set_timer"; minutes: number }
  | { kind: "start_breathing" }
  | { kind: "start_meditation" }
  | { kind: "wind_down" }
  | { kind: "open_route"; to: "/events" | "/sleep" | "/companion" | "/plan" | "/memory" | "/settings/companion"; label: string; search?: Record<string, string> }
  | { kind: "recommend_smart_alarm"; hour: number; minute: number }
  | { kind: "prepare_tomorrow_summary" }
  | { kind: "create_reminder"; text: string; whenISO: string }
  | { kind: "text_contact"; contactLabel: string; message: string }
  | { kind: "calendar_event"; title: string; whenISO: string };

export type ActionContext = {
  navigate: (to: string, search?: Record<string, string>) => void;
  openBreathing: () => void;
};

export type ActionResult = { ok: boolean; message: string };

export type ActionDescription = {
  title: string;
  body: string;
  confirmLabel: string;
  /** When true, the action is unavailable and Confirm should be disabled. */
  unavailable?: boolean;
  unavailableReason?: string;
  /** Navigation actions can run without confirmation when user preference allows. */
  isNavigation?: boolean;
};

const WIND_DOWN_PRESET = PRESETS.find((p) => p.slug === "deep_sleep") ?? PRESETS[0];

export function describeAction(a: CompanionAction): ActionDescription {
  switch (a.kind) {
    case "play_track": {
      const track = TRACK_BY_SLUG[a.slug];
      const available = track && (track.kind === "synth" || (track.kind === "file" && track.src));
      const dur = a.minutes ? ` for ${a.minutes} minute${a.minutes === 1 ? "" : "s"}` : "";
      return {
        title: `Start ${a.label}${dur}?`,
        body: available
          ? `I'll play ${a.label}${dur} through the sound mixer.`
          : `${a.label} isn't available yet.`,
        confirmLabel: "Start",
        unavailable: !available,
        unavailableReason: available ? undefined : "This sound is coming soon.",
      };
    }
    case "stop_all":
      return { title: "Stop all sounds?", body: "Everything currently playing will fade out.", confirmLabel: "Stop" };
    case "set_timer":
      return {
        title: `Set a ${a.minutes}-minute sleep timer?`,
        body: "Sounds will fade out when the timer ends.",
        confirmLabel: "Set timer",
      };
    case "start_breathing":
      return { title: "Start a 4-7-8 breathing exercise?", body: "Two minutes, on-screen guide.", confirmLabel: "Start" };
    case "start_meditation":
      return {
        title: "Start a meditation?",
        body: "Guided meditations are coming soon.",
        confirmLabel: "Start",
        unavailable: true,
        unavailableReason: "Meditation packs aren't connected yet.",
      };
    case "wind_down":
      return {
        title: "Begin your wind-down?",
        body: "I'll start your wind-down mix and fade it out in 45 minutes.",
        confirmLabel: "Begin",
      };
    case "open_route":
      return {
        title: `Open ${a.label}?`,
        body: "I'll take you there now.",
        confirmLabel: "Open",
        isNavigation: true,
      };
    case "recommend_smart_alarm": {
      const hh = String(a.hour).padStart(2, "0");
      const mm = String(a.minute).padStart(2, "0");
      return {
        title: `Recommend ${hh}:${mm} as your alarm?`,
        body: "I'll open Smart Alarm with this time pre-filled — you confirm the save.",
        confirmLabel: "Open Smart Alarm",
      };
    }
    case "prepare_tomorrow_summary":
      return {
        title: "Prepare your tomorrow summary?",
        body: "I'll pull together calendar, weather, and a suggested bedtime.",
        confirmLabel: "Prepare",
      };
    case "create_reminder":
      return {
        title: "Create a reminder?",
        body: `"${a.text}" — local reminders aren't wired up yet, but I'll save your intent for later.`,
        confirmLabel: "Create",
        unavailable: true,
        unavailableReason: "Reminder integration is coming soon.",
      };
    case "text_contact":
      return {
        title: `Text ${a.contactLabel}?`,
        body: "Texting contacts isn't connected yet. Nothing will be sent.",
        confirmLabel: "Send",
        unavailable: true,
        unavailableReason: "SMS isn't connected.",
      };
    case "calendar_event":
      return {
        title: `Add "${a.title}" to your calendar?`,
        body: "Calendar write access isn't connected yet.",
        confirmLabel: "Add",
        unavailable: true,
        unavailableReason: "Calendar write isn't connected.",
      };
  }
}

export async function executeAction(a: CompanionAction, ctx: ActionContext): Promise<ActionResult> {
  const d = describeAction(a);
  if (d.unavailable) {
    return { ok: false, message: d.unavailableReason ?? "That action isn't available yet." };
  }
  switch (a.kind) {
    case "play_track": {
      const track = TRACK_BY_SLUG[a.slug];
      if (!track) return { ok: false, message: `I don't know ${a.label}.` };
      await mixer.play(track.slug);
      if (a.minutes) mixer.setSleepTimer(a.minutes);
      return {
        ok: true,
        message: a.minutes
          ? `${track.label} playing — I'll fade it in ${a.minutes} min.`
          : `${track.label} playing.`,
      };
    }
    case "stop_all": {
      await mixer.stopAll();
      return { ok: true, message: "Stopped all sounds." };
    }
    case "set_timer": {
      mixer.setSleepTimer(a.minutes);
      return { ok: true, message: `Sleep timer set for ${a.minutes} min.` };
    }
    case "start_breathing": {
      ctx.openBreathing();
      return { ok: true, message: "Starting 4-7-8 breathing." };
    }
    case "wind_down": {
      await mixer.applyMix(WIND_DOWN_PRESET.tracks);
      mixer.setSleepTimer(45);
      return { ok: true, message: "Wind-down on — fading in 45 min." };
    }
    case "open_route": {
      ctx.navigate(a.to, a.search);
      return { ok: true, message: `Opening ${a.label}.` };
    }
    case "recommend_smart_alarm": {
      const hh = String(a.hour).padStart(2, "0");
      const mm = String(a.minute).padStart(2, "0");
      ctx.navigate("/events", { wake: `${hh}:${mm}` });
      return { ok: true, message: `Opening Smart Alarm for ${hh}:${mm}.` };
    }
    case "prepare_tomorrow_summary": {
      ctx.navigate("/companion", { period: "evening" });
      return { ok: true, message: "Opening your evening brief." };
    }
    // Placeholder kinds short-circuit at the unavailable gate above; this
    // exhaustive switch keeps TypeScript honest as we add real backings.
    case "start_meditation":
    case "create_reminder":
    case "text_contact":
    case "calendar_event":
      return { ok: false, message: "Coming soon." };
  }
}

/**
 * Map a parsed voice Intent (from /sleep voice router) into a CompanionAction
 * so the chat UI can render a single ActionCard for everything.
 */
export function intentToAction(intent: Intent): CompanionAction | null {
  switch (intent.kind) {
    case "play_track":
      return { kind: "play_track", slug: intent.slug, label: intent.label };
    case "stop_all":
      return { kind: "stop_all" };
    case "set_timer":
      return { kind: "set_timer", minutes: intent.minutes };
    case "sleep_mode":
    case "goodnight":
      return { kind: "wind_down" };
    case "breathing":
      return { kind: "start_breathing" };
    case "wake_at":
      return { kind: "recommend_smart_alarm", hour: intent.hour, minute: intent.minute };
    default:
      return null;
  }
}
