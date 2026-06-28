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
  | "routines";

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
    summary: "See today's schedule inline in your Companion chat.",
    details:
      "Reads a calendar feed and renders an agenda card with travel buffers. Ships first with read-only ICS; Google Calendar OAuth lands with full write support.",
    builtin: true,
    available: false,
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
    summary: "Lights, thermostat, fans, TV — and optional locks and garage.",
    details:
      "Connects to Home Assistant via a per-user token. Sensitive devices (locks, garage door) are gated behind an extra toggle that defaults off.",
    builtin: false,
    available: false,
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
] as const;

export function getSkill(id: SkillId): SkillDescriptor | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}
