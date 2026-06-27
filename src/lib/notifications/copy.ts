// Notification copy per kind. Keep short — push UI truncates aggressively on mobile.

export type ReminderKind =
  | "wind-down"
  | "caffeine-cutoff"
  | "bright-light"
  | "shift-start"
  | "shift-end-recovery";

export const REMINDER_LABEL: Record<ReminderKind, string> = {
  "wind-down": "Wind-down reminder",
  "caffeine-cutoff": "Caffeine cutoff",
  "bright-light": "Bright-light reminder",
  "shift-start": "Shift-start reminder",
  "shift-end-recovery": "Shift-end recovery",
};

export const REMINDER_DESC: Record<ReminderKind, string> = {
  "wind-down": "Fires when your wind-down window starts after a shift.",
  "caffeine-cutoff": "10 min before your last safe coffee of the day.",
  "bright-light": "On wake — 10–20 min bright light to lock in alertness.",
  "shift-start": "15 min before clock-in so you're ready, not rushing.",
  "shift-end-recovery": "On clock-out — hydration, light protein, wind-down.",
};

type Copy = { title: string; body: string };

export function copyFor(kind: ReminderKind): Copy {
  switch (kind) {
    case "wind-down":
      return {
        title: "Wind-down time 🌙",
        body: "Dim the lights, screens off, warm shower. Sleep window opens soon.",
      };
    case "caffeine-cutoff":
      return {
        title: "Last call for caffeine ☕",
        body: "Cutoff in 10 min — anything later will hit your sleep.",
      };
    case "bright-light":
      return {
        title: "Bright light now ☀️",
        body: "10–20 min outside or under a bright lamp to anchor your circadian rhythm.",
      };
    case "shift-start":
      return {
        title: "Shift starts in 15 min ⏱",
        body: "Caffeine, water, a quick stretch. You've got this.",
      };
    case "shift-end-recovery":
      return {
        title: "Shift complete — recover 💧",
        body: "Hydrate, light protein, then start your wind-down window.",
      };
  }
}
