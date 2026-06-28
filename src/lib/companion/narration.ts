// Slice 9 — Natural-language narration for action results.
// Returns a short, assistant-style sentence the Companion can speak after a
// confirmed action finishes. Falls back to the raw result message so we never
// say something empty out loud.

import type { CompanionAction } from "./actions";
import type { ActionResult } from "./actions";

function time12(hour: number, minute: number): string {
  const h = ((hour + 11) % 12) + 1;
  const mm = String(minute).padStart(2, "0");
  const ap = hour < 12 ? "AM" : "PM";
  return `${h}:${mm} ${ap}`;
}

export function narrate(action: CompanionAction, result: ActionResult): string {
  if (!result.ok) return result.message;
  switch (action.kind) {
    case "play_track":
      return action.minutes
        ? `${action.label} is playing — I'll fade it out in ${action.minutes} minutes.`
        : `${action.label} is now playing.`;
    case "stop_track":
      return `${action.label} stopped.`;
    case "stop_all":
      return "All sounds stopped.";
    case "set_timer":
      return `Sleep timer set for ${action.minutes} minutes.`;
    case "clear_timer":
      return "Sleep timer cleared.";
    case "set_volume":
      return `${action.label} volume set to ${Math.round(action.level * 100)} percent.`;
    case "wind_down":
    case "start_bedtime_routine":
      return "Wind-down is on. I'll fade everything out in 45 minutes.";
    case "start_breathing":
      return "Starting your breathing exercise.";
    case "create_alarm":
      return `Your alarm is set for ${time12(action.hour, action.minute)}.`;
    case "delete_alarm":
      return `Alarm at ${action.label} removed.`;
    case "snooze_alarm":
      return `Snoozed for ${action.minutes} minutes.`;
    case "refresh_brief":
      return "Refreshed your brief.";
    case "remember_this":
      return "Saved. I'll remember that.";
    case "forget_memory":
      return "Forgotten.";
    case "toggle_notifications":
      return action.on ? "Notifications are on." : "Notifications are off.";
    case "toggle_memory":
      return action.on ? "Memory is on." : "Memory is off.";
    case "toggle_voice":
      return action.on ? "Voice replies are on." : "Voice replies are off.";
    case "toggle_confirmations":
      return action.on ? "Always Confirm is on." : "Always Confirm is off.";
    case "hide_card":
      return `Hid ${action.label} from your ${action.period} brief.`;
    case "show_card":
      return `${action.label} is back in your ${action.period} brief.`;
    case "open_route":
    case "recommend_smart_alarm":
    case "prepare_tomorrow_summary":
    case "begin_sleep_session":
    case "review_tomorrow":
    case "summarize_today":
      return result.message;
    default:
      return result.message;
  }
}
