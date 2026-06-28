// Slice 12 — Step 1 (Foundation). Skill identifiers + catalog metadata.
// Pure module: client- and server-safe, no side effects, no DB calls.

export type SkillId =
  | "weather_alerts"
  | "calendar_read"
  | "calendar_write"
  | "travel"
  | "smart_home"
  | "comms_email"
  | "comms_sms"
  | "routines"
  | "personal_intel"
  | "sleep_sounds"
  | "automations"
  | "quiet_mode";

export type SkillStatus = "connected" | "disabled" | "disconnected" | "coming_soon";

export type SkillRiskLevel = "safe" | "sensitive" | "destructive";

export interface SkillDescriptor {
  id: SkillId;
  name: string;
  /** Short tagline shown on the settings card. */
  summary: string;
  /** One paragraph describing what the skill will do once enabled. */
  details: string;
  /** True when this skill is built-in and needs no external auth. */
  builtin: boolean;
  /** Default availability — true once Step N for this skill ships. */
  available: boolean;
  /** Privacy/security risk class for UI badging. */
  risk: SkillRiskLevel;
  /** Bucket the skill belongs to in /settings/skills. */
  group: "intelligence" | "productivity" | "home" | "communication";
}

/**
 * Canonical, ordered catalog. Foundation step ships the catalog only;
 * individual skills flip `available` to true as later steps land.
 */
export const SKILL_CATALOG: readonly SkillDescriptor[] = [
  {
    id: "weather_alerts",
    name: "Weather Intelligence",
    summary: "Rain, heat, wind, and air-quality alerts before they affect your day.",
    details:
      "Reelo watches your local forecast and air quality and surfaces a clothing suggestion plus heads-up alerts. Pure read-only; no account needed.",
    builtin: true,
    available: true,
    risk: "safe",
    group: "intelligence",
  },
  {
    id: "calendar_read",
    name: "Calendar Agenda",
    summary: "See today's schedule, upcoming events, and tomorrow's preview inline.",
    details:
      "Connects a read-only ICS feed (Apple, Google 'secret address', Outlook). Reelo shows today's agenda, what's coming up, and tomorrow — and warns when an early meeting means an earlier bedtime. Read-only: never adds, moves, or deletes events.",
    builtin: true,
    available: true,
    risk: "safe",
    group: "productivity",
  },
  {
    id: "calendar_write",
    name: "Calendar Actions",
    summary: "Create, move, and delete events with a single tap of confirm.",
    details:
      "Requires connecting your Google Calendar. Delete is treated as destructive and always asks before running.",
    builtin: false,
    available: false,
    risk: "destructive",
    group: "productivity",
  },
  {
    id: "travel",
    name: "Traffic Intelligence",
    summary: "Drive times, unusual delays, and 'leave earlier' warnings for Home and Work.",
    details:
      "Saves Home, Work, and custom destinations. Estimates current drive time, learns your normal baseline, and surfaces unusual delays plus alternative routes. Read-only — Reelo never starts navigation for you.",
    builtin: true,
    available: true,
    risk: "safe",
    group: "intelligence",
  },
  {
    id: "smart_home",
    name: "Smart Home",
    summary: "Register lights, plugs, thermostats, speakers, coffee makers, and bedroom devices.",
    details:
      "A private registry of your devices, organized by room and vendor (Alexa, Google Home, HomeKit, Matter, SmartThings, Home Assistant, or manual). Routines reference these devices safely. Sensitive devices (locks, garage) always require an extra confirmation tap. Device control is permission-based — no integration runs until you explicitly authorize it.",
    builtin: true,
    available: true,
    risk: "sensitive",
    group: "home",
  },
  {
    id: "comms_email",
    name: "Email Drafts",
    summary: "Draft emails from chat — sending always asks first.",
    details:
      "Drafts stay on this device until you tap Send. Outgoing messages go through Reelo Mail.",
    builtin: true,
    available: false,
    risk: "destructive",
    group: "communication",
  },
  {
    id: "comms_sms",
    name: "SMS & Calls",
    summary: "Send a text or place a call to a verified contact.",
    details:
      "Powered by Twilio. Recipients must be on your verified contact list. Rate-limited to prevent runaway sends.",
    builtin: false,
    available: false,
    risk: "destructive",
    group: "communication",
  },
  {
    id: "routines",
    name: "Learned Routines",
    summary: "Approve multi-step routines Reelo notices in your day.",
    details:
      "Reelo only proposes routines after spotting a repeated pattern. Nothing runs until you Approve, and you can pause or delete at any time.",
    builtin: true,
    available: false,
    risk: "safe",
    group: "intelligence",
  },
  {
    id: "personal_intel",
    name: "Personal Intelligence",
    summary: "Tasks, reminders, email notes, and follow-ups — woven into your daily plan.",
    details:
      "A private inbox for tasks, reminders, and email follow-ups. Reelo detects priority, surfaces overdue items, suggests follow-ups for things sitting too long, and combines Calendar, Weather, and Traffic so you know when to leave earlier or wind down sooner. Read-only — Reelo never sends or deletes anything for you.",
    builtin: true,
    available: true,
    risk: "safe",
    group: "productivity",
  },
  {
    id: "sleep_sounds",
    name: "Sleep Sounds",
    summary: "White noise, rain, ocean, forest, fireplace, fan, ambient music, and timers.",
    details:
      "A built-in mixer with synthesizer-based and curated soundscapes plus a sleep timer. Plays locally on this device — no streaming, no account, no data leaves the app. Voice commands like 'Play rain' and 'Sleep timer 30' route here.",
    builtin: true,
    available: true,
    risk: "safe",
    group: "home",
  },
  {
    id: "automations",
    name: "Routines & Automations",
    summary: "Bedtime, wake-up, goodnight, and morning multi-step routines you control.",
    details:
      "Build and run multi-step routines that combine smart devices, sleep sounds, Quiet Mode, and short spoken cues. Every routine asks before running by default, respects Quiet Hours, and is logged to your Automation History. Sensitive devices always require an extra confirmation tap.",
    builtin: true,
    available: true,
    risk: "sensitive",
    group: "home",
  },
  {
    id: "quiet_mode",
    name: "Quiet Mode",
    summary: "Mute the Companion voice and pause non-urgent nudges with one tap.",
    details:
      "Turns off Companion voice replies and skips non-urgent notifications until you turn it off. Defers to your operating system's Do Not Disturb / Focus — Reelo never overrides OS privacy restrictions.",
    builtin: true,
    available: true,
    risk: "safe",
    group: "home",
  },
] as const;

export function getSkill(id: SkillId): SkillDescriptor | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}
