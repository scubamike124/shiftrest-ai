// Slice 9 — Companion action framework (real execution layer).
//
// One typed registry of actions the Companion can propose. The chat surface
// renders an <ActionCard /> for any non-navigation action and only calls
// executeAction() after the user taps Confirm (unless the action is
// non-destructive navigation and the user has Always Confirm OFF).
//
// Backward compatible with Slice 8: `describeAction`, `executeAction`,
// `intentToAction`, and the original `{ok, message}` ActionResult shape are
// all preserved; new fields (status, error, destructive) are additive.

import { mixer } from "@/lib/sounds/mixer";
import { TRACK_BY_SLUG, PRESETS } from "@/lib/sounds/catalog";
import { createEvent, deleteEvent } from "@/lib/events";
import { addMemory, deleteMemory } from "@/lib/ai-memory";
import { savePrefs, type Prefs } from "@/lib/prefs";
import { saveLocalPrefs } from "@/lib/companion/voice-action-prefs";
import { supabase } from "@/integrations/supabase/client";
import type { Intent } from "@/lib/voice/intent-router";
import type { ActionErrorKind, ActionStatus } from "./action-history";

export type BriefPeriod = "morning" | "afternoon" | "evening";

export type CompanionAction =
  // Sounds
  | { kind: "play_track"; slug: string; label: string; minutes?: number }
  | { kind: "stop_track"; slug: string; label: string }
  | { kind: "stop_all" }
  | { kind: "set_timer"; minutes: number }
  | { kind: "clear_timer" }
  | { kind: "set_volume"; slug: string; label: string; level: number }
  | { kind: "wind_down" }
  | { kind: "start_bedtime_routine" }
  | { kind: "begin_sleep_session" }
  | { kind: "start_breathing" }
  | { kind: "start_meditation" }
  // Smart Alarm
  | { kind: "create_alarm"; hour: number; minute: number }
  | { kind: "delete_alarm"; eventId: string; label: string }
  | { kind: "snooze_alarm"; minutes: number }
  | { kind: "recommend_smart_alarm"; hour: number; minute: number }
  // Briefs
  | { kind: "refresh_brief"; period?: BriefPeriod }
  | { kind: "prepare_tomorrow_summary" }
  | { kind: "review_tomorrow" }
  | { kind: "summarize_today" }
  // Companion memory
  | { kind: "remember_this"; text: string }
  | { kind: "forget_memory"; memoryId: string; label: string }
  // Prefs / Settings
  | { kind: "toggle_notifications"; on: boolean }
  | { kind: "toggle_memory"; on: boolean }
  | { kind: "toggle_voice"; on: boolean }
  | { kind: "toggle_confirmations"; on: boolean }
  // Dashboard / brief layout
  | { kind: "hide_card"; period: BriefPeriod; cardId: string; label: string }
  | { kind: "show_card"; period: BriefPeriod; cardId: string; label: string }
  // Navigation (always non-destructive)
  | {
      kind: "open_route";
      to: "/events" | "/sleep" | "/companion" | "/plan" | "/memory" | "/settings/companion" | "/dashboard";
      label: string;
      search?: Record<string, string>;
    }
  // Legacy/coming-soon stubs — kept so AI prompts can still propose them safely
  | { kind: "create_reminder"; text: string; whenISO: string }
  | { kind: "text_contact"; contactLabel: string; message: string }
  | { kind: "calendar_event"; title: string; whenISO: string };

export type ActionContext = {
  signedIn?: boolean;
  navigate: (to: string, search?: Record<string, string>) => void;
  openBreathing: () => void;
};

export type ActionError = {
  kind: ActionErrorKind;
  message: string;
  recovery?: { label: string; href?: string };
};

export type ActionResult = {
  ok: boolean;
  message: string;
  status?: ActionStatus;
  error?: ActionError;
};

export type ActionDescription = {
  title: string;
  body: string;
  confirmLabel: string;
  /** When true, the action is unavailable and Confirm should be disabled. */
  unavailable?: boolean;
  unavailableReason?: string;
  /** Navigation actions can run without confirmation when user preference allows. */
  isNavigation?: boolean;
  /** Destructive actions force a confirmation card even with Always Confirm OFF. */
  destructive?: boolean;
};

const WIND_DOWN_PRESET = PRESETS.find((p) => p.slug === "deep_sleep") ?? PRESETS[0];

function hhmm(h: number, m: number) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Compute the next occurrence (today or tomorrow) of an HH:MM alarm. */
function nextOccurrenceISO(hour: number, minute: number): string {
  const now = new Date();
  const t = new Date(now);
  t.setHours(hour, minute, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.toISOString();
}

/** Human-friendly "Tomorrow at 6:30 AM · in 9h 12m" preview for alarms. */
function nextOccurrenceLabel(hour: number, minute: number): string {
  const now = new Date();
  const t = new Date(now);
  t.setHours(hour, minute, 0, 0);
  const isTomorrow = t.getTime() <= now.getTime();
  if (isTomorrow) t.setDate(t.getDate() + 1);
  const pretty = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const diffMin = Math.max(1, Math.round((t.getTime() - now.getTime()) / 60000));
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  const inWhen = h > 0 ? `in ${h}h${m ? ` ${m}m` : ""}` : `in ${m}m`;
  return `${isTomorrow ? "Tomorrow" : "Today"} at ${pretty} · ${inWhen}`;
}

/** Returns true if an action should always require a confirmation card. */
export function isDestructive(a: CompanionAction): boolean {
  switch (a.kind) {
    // Delete / Forget — destructive by definition.
    case "delete_alarm":
    case "forget_memory":
    case "hide_card":
    // Reset / bulk-stop — surprising if executed silently.
    case "stop_all":
    case "clear_timer":
      return true;
    case "toggle_notifications":
    case "toggle_memory":
    case "toggle_voice":
    case "toggle_confirmations":
      return a.on === false;
    default:
      return false;
  }
}

/** Slice 10 — runtime allow-list for navigation. Mirrors the TS union; we
 *  enforce again at execution time to prevent a malformed action (e.g. from
 *  an older cached chat) from triggering an unexpected navigation. */
const ALLOWED_OPEN_ROUTES: ReadonlySet<string> = new Set([
  "/events",
  "/sleep",
  "/companion",
  "/plan",
  "/memory",
  "/settings/companion",
  "/settings/skills",
  "/dashboard",
]);

export function describeAction(a: CompanionAction): ActionDescription {
  const D = (d: ActionDescription): ActionDescription => ({ ...d, destructive: isDestructive(a) });
  switch (a.kind) {
    case "play_track": {
      const track = TRACK_BY_SLUG[a.slug];
      const available = track && (track.kind === "synth" || (track.kind === "file" && track.src));
      const dur = a.minutes ? ` for ${a.minutes} minute${a.minutes === 1 ? "" : "s"}` : "";
      return D({
        title: `Start ${a.label}${dur}?`,
        body: available
          ? `I'll play ${a.label}${dur} through the sound mixer.`
          : `${a.label} isn't available yet.`,
        confirmLabel: "Start",
        unavailable: !available,
        unavailableReason: available ? undefined : "This sound is coming soon.",
      });
    }
    case "stop_track":
      return D({ title: `Stop ${a.label}?`, body: "I'll fade it out.", confirmLabel: "Stop" });
    case "stop_all":
      return D({ title: "Stop all sounds?", body: "Everything currently playing will fade out.", confirmLabel: "Stop" });
    case "set_timer":
      return D({
        title: `Set a ${a.minutes}-minute sleep timer?`,
        body: "Sounds will fade out when the timer ends.",
        confirmLabel: "Set timer",
      });
    case "clear_timer":
      return D({ title: "Clear the sleep timer?", body: "Sounds will keep playing until you stop them.", confirmLabel: "Clear" });
    case "set_volume":
      return D({
        title: `Set ${a.label} volume to ${Math.round(a.level * 100)}%?`,
        body: "I'll adjust just this sound.",
        confirmLabel: "Set",
      });
    case "start_breathing":
      return D({ title: "Start a 4-7-8 breathing exercise?", body: "Two minutes, on-screen guide.", confirmLabel: "Start" });
    case "start_meditation":
      return D({
        title: "Start a meditation?",
        body: "Guided meditations are coming soon.",
        confirmLabel: "Start",
        unavailable: true,
        unavailableReason: "Meditation packs aren't connected yet.",
      });
    case "wind_down":
    case "start_bedtime_routine":
      return D({
        title: "Begin your wind-down?",
        body: "I'll start your wind-down mix and fade it out in 45 minutes.",
        confirmLabel: "Begin",
      });
    case "begin_sleep_session":
      return D({ title: "Open your sleep session?", body: "I'll take you to Sleep.", confirmLabel: "Open", isNavigation: true });
    case "open_route":
      return D({ title: `Open ${a.label}?`, body: "I'll take you there now.", confirmLabel: "Open", isNavigation: true });
    case "recommend_smart_alarm":
      return D({
        title: `Recommend ${hhmm(a.hour, a.minute)} as your alarm?`,
        body: "I'll open Smart Alarm with this time pre-filled — you confirm the save.",
        confirmLabel: "Open Smart Alarm",
      });
    case "create_alarm":
      return D({
        title: `Set an alarm for ${hhmm(a.hour, a.minute)}?`,
        body: `${nextOccurrenceLabel(a.hour, a.minute)}. I'll save it to your Smart Alarms.`,
        confirmLabel: "Set alarm",
      });
    case "delete_alarm":
      return D({
        title: `Delete the ${a.label} alarm?`,
        body: "This can't be undone, but you can set a new one anytime.",
        confirmLabel: "Delete",
      });
    case "snooze_alarm":
      return D({
        title: `Snooze for ${a.minutes} minutes?`,
        body: "I'll set a one-off alarm for then.",
        confirmLabel: "Snooze",
      });
    case "refresh_brief":
      return D({
        title: `Refresh your ${a.period ?? "current"} brief?`,
        body: "I'll pull the latest weather, schedule, and recommendations.",
        confirmLabel: "Refresh",
      });
    case "prepare_tomorrow_summary":
    case "review_tomorrow":
      return D({
        title: "Review tomorrow's plan?",
        body: "I'll open your evening brief.",
        confirmLabel: "Open",
        isNavigation: true,
      });
    case "summarize_today":
      return D({
        title: "Summarize today?",
        body: "I'll open your daily review.",
        confirmLabel: "Open",
        isNavigation: true,
      });
    case "remember_this":
      return D({
        title: "Remember this?",
        body: `I'll save: "${a.text.slice(0, 120)}".`,
        confirmLabel: "Remember",
      });
    case "forget_memory":
      return D({
        title: `Forget "${a.label}"?`,
        body: "I'll remove this memory permanently.",
        confirmLabel: "Forget",
      });
    case "toggle_notifications":
      return D({
        title: a.on ? "Turn notifications on?" : "Turn notifications off?",
        body: a.on ? "I'll send timely reminders." : "You won't receive Companion notifications.",
        confirmLabel: a.on ? "Turn on" : "Turn off",
      });
    case "toggle_memory":
      return D({
        title: a.on ? "Turn memory on?" : "Turn memory off?",
        body: a.on ? "I'll learn from confirmed patterns." : "I'll stop learning new patterns.",
        confirmLabel: a.on ? "Turn on" : "Turn off",
      });
    case "toggle_voice":
      return D({
        title: a.on ? "Turn voice replies on?" : "Turn voice replies off?",
        body: a.on ? "I'll narrate confirmations aloud." : "I'll keep replies in chat only.",
        confirmLabel: a.on ? "Turn on" : "Turn off",
      });
    case "toggle_confirmations":
      return D({
        title: a.on ? "Always confirm actions?" : "Stop always confirming?",
        body: a.on
          ? "Every action will require approval first."
          : "Low-risk actions will run immediately. Destructive ones still confirm.",
        confirmLabel: a.on ? "Turn on" : "Turn off",
      });
    case "hide_card":
      return D({
        title: `Hide ${a.label} from your ${a.period} brief?`,
        body: "You can bring it back anytime in Companion settings.",
        confirmLabel: "Hide",
      });
    case "show_card":
      return D({
        title: `Show ${a.label} in your ${a.period} brief?`,
        body: "It'll appear in your brief from now on.",
        confirmLabel: "Show",
      });
    case "create_reminder":
      return D({
        title: "Create a reminder?",
        body: `"${a.text}" — local reminders aren't wired up yet.`,
        confirmLabel: "Create",
        unavailable: true,
        unavailableReason: "Reminder integration is coming soon.",
      });
    case "text_contact":
      return D({
        title: `Text ${a.contactLabel}?`,
        body: "Texting contacts isn't connected yet. Nothing will be sent.",
        confirmLabel: "Send",
        unavailable: true,
        unavailableReason: "SMS isn't connected.",
      });
    case "calendar_event":
      return D({
        title: `Add "${a.title}" to your calendar?`,
        body: "Calendar write access isn't connected yet.",
        confirmLabel: "Add",
        unavailable: true,
        unavailableReason: "Calendar write isn't connected.",
      });
  }
}

function fail(kind: ActionErrorKind, message: string, recovery?: ActionError["recovery"]): ActionResult {
  return { ok: false, message, status: "failed", error: { kind, message, recovery } };
}

function done(message: string): ActionResult {
  return { ok: true, message, status: "completed" };
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

async function requireAuth(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function executeAction(a: CompanionAction, ctx: ActionContext): Promise<ActionResult> {
  const d = describeAction(a);
  if (d.unavailable) {
    return fail("unavailable", d.unavailableReason ?? "That action isn't available yet.");
  }

  // Quickly fail DB-touching actions when offline so we don't hang.
  const needsNetwork =
    a.kind === "create_alarm" ||
    a.kind === "delete_alarm" ||
    a.kind === "snooze_alarm" ||
    a.kind === "remember_this" ||
    a.kind === "forget_memory" ||
    a.kind === "toggle_notifications" ||
    a.kind === "toggle_memory" ||
    a.kind === "hide_card" ||
    a.kind === "show_card";
  if (needsNetwork && !isOnline()) {
    return fail("offline", "You're offline. I'll try again when you're back online.");
  }

  try {
    switch (a.kind) {
      // ───── Sounds ─────
      case "play_track": {
        const track = TRACK_BY_SLUG[a.slug];
        if (!track) return fail("not_found", `I don't know ${a.label}.`);
        await mixer.play(track.slug);
        if (a.minutes) mixer.setSleepTimer(a.minutes);
        return done(
          a.minutes
            ? `${track.label} playing — I'll fade it in ${a.minutes} min.`
            : `${track.label} playing.`,
        );
      }
      case "stop_track": {
        await mixer.stop(a.slug);
        return done(`${a.label} stopped.`);
      }
      case "stop_all": {
        await mixer.stopAll();
        return done("Stopped all sounds.");
      }
      case "set_timer": {
        mixer.setSleepTimer(a.minutes);
        return done(`Sleep timer set for ${a.minutes} min.`);
      }
      case "clear_timer": {
        mixer.clearTimer();
        return done("Sleep timer cleared.");
      }
      case "set_volume": {
        const level = Math.max(0, Math.min(1, a.level));
        mixer.setTrackVolume(a.slug, level);
        return done(`${a.label} volume set to ${Math.round(level * 100)}%.`);
      }
      case "wind_down":
      case "start_bedtime_routine": {
        await mixer.applyMix(WIND_DOWN_PRESET.tracks);
        mixer.setSleepTimer(45);
        return done("Wind-down on — fading in 45 min.");
      }
      case "begin_sleep_session": {
        ctx.navigate("/sleep");
        return done("Opening Sleep.");
      }
      case "start_breathing": {
        ctx.openBreathing();
        return done("Starting 4-7-8 breathing.");
      }

      // ───── Smart Alarm ─────
      case "create_alarm": {
        const uid = await requireAuth();
        if (!uid) return fail("unauthenticated", "Sign in to set an alarm.", { label: "Sign in", href: "/auth" });
        const iso = nextOccurrenceISO(a.hour, a.minute);
        await createEvent({
          kind: "personal",
          title: `alarm:${hhmm(a.hour, a.minute)}`,
          startsAt: iso,
          reminderMin: 0,
          travelBufferMin: 0,
        });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("companion:alarms-changed"));
        }
        return done(`Alarm set for ${hhmm(a.hour, a.minute)}.`);
      }
      case "delete_alarm": {
        const uid = await requireAuth();
        if (!uid) return fail("unauthenticated", "Sign in to manage alarms.", { label: "Sign in", href: "/auth" });
        await deleteEvent(a.eventId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("companion:alarms-changed"));
        }
        return done(`Deleted alarm ${a.label}.`);
      }
      case "snooze_alarm": {
        const uid = await requireAuth();
        if (!uid) return fail("unauthenticated", "Sign in to snooze.", { label: "Sign in", href: "/auth" });
        const t = new Date(Date.now() + a.minutes * 60_000);
        await createEvent({
          kind: "personal",
          title: `alarm:${hhmm(t.getHours(), t.getMinutes())}`,
          startsAt: t.toISOString(),
          reminderMin: 0,
          travelBufferMin: 0,
        });
        return done(`Snoozed ${a.minutes} min.`);
      }
      case "recommend_smart_alarm": {
        ctx.navigate("/events", { wake: hhmm(a.hour, a.minute) });
        return done(`Opening Smart Alarm for ${hhmm(a.hour, a.minute)}.`);
      }

      // ───── Briefs ─────
      case "refresh_brief": {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("companion:brief-refresh", { detail: { period: a.period ?? null } }),
          );
        }
        return done("Refreshed your brief.");
      }
      case "prepare_tomorrow_summary":
      case "review_tomorrow": {
        ctx.navigate("/companion", { period: "evening" });
        return done("Opening your evening brief.");
      }
      case "summarize_today": {
        ctx.navigate("/companion", { period: "afternoon" });
        return done("Opening today's summary.");
      }

      // ───── Companion memory ─────
      case "remember_this": {
        const uid = await requireAuth();
        if (!uid) return fail("unauthenticated", "Sign in to save memories.", { label: "Sign in", href: "/auth" });
        const m = await addMemory(a.text);
        if (!m) return fail("permission_denied", "Memory is paused or turned off.", { label: "Open settings", href: "/settings/companion" });
        return done("Saved to memory.");
      }
      case "forget_memory": {
        const uid = await requireAuth();
        if (!uid) return fail("unauthenticated", "Sign in to manage memory.", { label: "Sign in", href: "/auth" });
        await deleteMemory(a.memoryId);
        return done(`Forgot "${a.label}".`);
      }

      // ───── Prefs ─────
      case "toggle_notifications": {
        const uid = await requireAuth();
        if (!uid) return fail("unauthenticated", "Sign in to change settings.", { label: "Sign in", href: "/auth" });
        await savePrefs({ notifications: a.on } as Partial<Prefs>);
        return done(a.on ? "Notifications on." : "Notifications off.");
      }
      case "toggle_memory": {
        const uid = await requireAuth();
        if (!uid) return fail("unauthenticated", "Sign in to change settings.", { label: "Sign in", href: "/auth" });
        await savePrefs({ memoryEnabled: a.on } as Partial<Prefs>);
        return done(a.on ? "Memory on." : "Memory off.");
      }
      case "toggle_voice": {
        saveLocalPrefs({ voiceRepliesEnabled: a.on });
        return done(a.on ? "Voice replies on." : "Voice replies off.");
      }
      case "toggle_confirmations": {
        saveLocalPrefs({ requireActionConfirmation: a.on });
        return done(a.on ? "Always Confirm on." : "Always Confirm off.");
      }

      // ───── Layout ─────
      case "hide_card":
      case "show_card": {
        const uid = await requireAuth();
        if (!uid) return fail("unauthenticated", "Sign in to change your brief.", { label: "Sign in", href: "/auth" });
        // Read-modify-write via savePrefs which already merges brief_layout.
        const key = a.period;
        const hidden = a.kind === "hide_card";
        await savePrefs({
          brief_layout: {
            [key]: { hidden: { [a.cardId]: hidden } },
          },
        } as unknown as Partial<Prefs>);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("companion:brief-refresh", { detail: { period: key } }));
        }
        return done(hidden ? `Hid ${a.label}.` : `${a.label} restored.`);
      }

      // ───── Navigation ─────
      case "open_route": {
        if (!ALLOWED_OPEN_ROUTES.has(a.to)) {
          return fail("permission_denied", "I can't open that route.");
        }
        ctx.navigate(a.to, a.search);
        return done(`Opening ${a.label}.`);
      }

      // ───── Coming soon ─────
      case "start_meditation":
      case "create_reminder":
      case "text_contact":
      case "calendar_event":
        return fail("unavailable", "Coming soon.");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    if (/auth/i.test(msg)) return fail("unauthenticated", msg, { label: "Sign in", href: "/auth" });
    if (/network|fetch/i.test(msg)) return fail("offline", msg);
    return fail("unknown", msg);
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
      return { kind: "create_alarm", hour: intent.hour, minute: intent.minute };
    default:
      return null;
  }
}
