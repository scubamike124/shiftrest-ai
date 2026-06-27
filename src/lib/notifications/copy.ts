// Notification copy per kind. Keep short — push UI truncates aggressively on mobile.

export type ReminderKind =
  | "wind-down"
  | "caffeine-cutoff"
  | "bright-light"
  | "shift-start"
  | "shift-end-recovery"
  | "smart-alarm"
  | "calendar-prep"
  | "commute-leave";

export const REMINDER_LABEL: Record<ReminderKind, string> = {
  "wind-down": "Wind-down reminder",
  "caffeine-cutoff": "Caffeine cutoff",
  "bright-light": "Bright-light reminder",
  "shift-start": "Shift-start reminder",
  "shift-end-recovery": "Shift-end recovery",
  "smart-alarm": "Smart alarm",
  "calendar-prep": "Calendar prep",
  "commute-leave": "Commute leave-by",
};

export const REMINDER_DESC: Record<ReminderKind, string> = {
  "wind-down": "Fires when your wind-down window starts after a shift.",
  "caffeine-cutoff": "10 min before your last safe coffee of the day.",
  "bright-light": "On wake — 10–20 min bright light to lock in alertness.",
  "shift-start": "15 min before clock-in so you're ready, not rushing.",
  "shift-end-recovery": "On clock-out — hydration, light protein, wind-down.",
  "smart-alarm": "Wakes you at the lightest sleep moment inside your window.",
  "calendar-prep": "Heads-up before a calendar event so you're not blindsided.",
  "commute-leave": "Leave-by ping based on your travel + prep buffer.",
};

type Copy = { title: string; body: string };

export function copyFor(kind: ReminderKind, ctx?: { title?: string }): Copy {
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
    case "smart-alarm":
      return {
        title: "Time to wake 🌅",
        body: "Lightest moment in your window — sit up, lights on, water.",
      };
    case "calendar-prep":
      return {
        title: ctx?.title ? `Up next: ${ctx.title}` : "Calendar reminder 📅",
        body: "Heads up — your event is coming up shortly.",
      };
    case "commute-leave":
      return {
        title: "Leave now 🚗",
        body: ctx?.title
          ? `Time to head out for ${ctx.title}.`
          : "Time to head out — your travel buffer starts now.",
      };
  }
}
