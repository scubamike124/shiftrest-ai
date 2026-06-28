// Phase 7 — Natural-language routine builder.
//
// Pure helper that converts a free-text description into an Automation draft
// (trigger + steps) the user can preview before saving. The parser never
// commits anything on its own — the UI displays a confirmation sheet built
// from `planAutomation()` first.
//
// Strategy:
//   1. Split the input into clauses on " and ", ", ", "; ", " then ".
//   2. Try a small set of strict patterns per clause (quiet mode, play X,
//      timer, wait, say, stop sounds, wake at HH:MM).
//   3. Detect an "at HH(:MM) (am|pm)" anywhere in the original text and
//      promote it to a time trigger.
//
// Anything we can't parse becomes a `warnings` entry instead of silently
// dropping. The UI surfaces warnings so the user can edit the text.

import type { AutomationStep, AutomationTrigger, AutomationKind } from "./types";
import { TRACKS } from "@/lib/sounds/catalog";

export interface NLRoutineDraft {
  name: string;
  kind: AutomationKind;
  trigger: AutomationTrigger;
  steps: AutomationStep[];
  warnings: string[];
  /** Plain-English explanation used in the confirmation sheet. */
  rationale: string;
}

const TRACK_ALIASES: Record<string, string> = {
  rain: "rain",
  ocean: "ocean",
  waves: "ocean",
  forest: "forest",
  fire: "fireplace",
  fireplace: "fireplace",
  fan: "fan",
  thunder: "thunder",
  storm: "thunder",
  "white noise": "white_noise",
  "pink noise": "pink_noise",
  "brown noise": "brown_noise",
  river: "river",
  stream: "river",
  cabin: "cabin",
  crickets: "crickets",
  wind: "wind",
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{Letter}\p{Number}\s:]/gu, " ").replace(/\s+/g, " ").trim();
}

function findTrackSlug(phrase: string): string | null {
  const n = normalize(phrase);
  const keys = Object.keys(TRACK_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const re = new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`);
    if (re.test(n)) return TRACK_ALIASES[k];
  }
  for (const t of TRACKS) {
    if (n.includes(t.label.toLowerCase())) return t.slug;
  }
  return null;
}

function parseTimeOfDay(text: string): { hhmm: string; matched: string } | null {
  const m = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toLowerCase();
  if (ampm?.startsWith("p") && hour < 12) hour += 12;
  if (ampm?.startsWith("a") && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return {
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    matched: m[0],
  };
}

function inferKind(text: string): AutomationKind {
  const n = text.toLowerCase();
  if (/\bgood\s*night|tuck\s+me\s+in\b/.test(n)) return "goodnight";
  if (/\bbedtime|wind[-\s]?down|before\s+bed|sleep\s+mode\b/.test(n)) return "bedtime";
  if (/\bwake|morning|alarm|sunrise\b/.test(n)) return "wake_up";
  if (/\bmorning\b/.test(n)) return "morning";
  return "custom";
}

function splitClauses(text: string): string[] {
  return text
    .split(/\s*(?:,|;|\bthen\b|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseClause(clause: string, warnings: string[]): AutomationStep | null {
  const n = normalize(clause);
  if (!n) return null;

  if (/^(?:turn\s+on|enable|start|activate)\s+quiet\s+mode$/.test(n)) {
    return { type: "quiet_mode", on: true };
  }
  if (/^(?:turn\s+off|disable|stop|deactivate|end)\s+quiet\s+mode$/.test(n)) {
    return { type: "quiet_mode", on: false };
  }

  // Stop sounds
  if (/^(?:stop|silence|mute)\s+(?:all\s+)?(?:sounds?|music|noise)$/.test(n)) {
    return { type: "sound_stop" };
  }

  // Wait N (seconds|minutes)
  const mWait = n.match(/^wait\s+(\d{1,3})\s*(s|sec|seconds?|m|min|minutes?)$/);
  if (mWait) {
    const v = parseInt(mWait[1], 10);
    const isMin = /^m/.test(mWait[2]);
    const seconds = Math.min(600, Math.max(1, isMin ? v * 60 : v));
    return { type: "wait", seconds };
  }

  // Say "..."
  const mSay = clause.match(/^(?:say|announce|tell\s+me)\s+(.+)$/i);
  if (mSay) {
    const txt = mSay[1].replace(/^["']|["']$/g, "").trim();
    if (txt) return { type: "say", text: txt.slice(0, 200) };
  }

  // Play <track> [for N minutes]
  const mPlay = n.match(/^(?:play|start)\s+(.+?)(?:\s+for\s+(\d{1,3})\s*(?:min|minutes?|m))?$/);
  if (mPlay) {
    const slug = findTrackSlug(mPlay[1]);
    if (!slug) {
      warnings.push(`Couldn't find a sound named "${mPlay[1].trim()}".`);
      return null;
    }
    const step: AutomationStep = { type: "sound_play", preset: slug, volume: 60 };
    return step;
  }

  // Timer (no play): "set sleep timer for N minutes"
  const mTimer = n.match(/(?:set\s+(?:a\s+|the\s+)?(?:sleep\s+)?timer\s+for|timer)\s+(\d{1,3})\s*(?:min|minutes?|m)/);
  if (mTimer) {
    const minutes = Math.min(720, Math.max(1, parseInt(mTimer[1], 10)));
    return { type: "sound_timer", minutes };
  }

  if (!/^at\s+\d/.test(n)) {
    warnings.push(`I couldn't translate "${clause.trim()}" into a step.`);
  }
  return null;
}

/**
 * Detect "play X for N minutes" patterns — if found, append a sound_timer
 * step after the sound_play step.
 */
function expandTimers(clauses: string[], steps: AutomationStep[]): AutomationStep[] {
  const out: AutomationStep[] = [];
  for (let i = 0; i < clauses.length && i < steps.length; i++) {
    out.push(steps[i]);
    const m = normalize(clauses[i]).match(/^(?:play|start)\s+.+?\s+for\s+(\d{1,3})\s*(?:min|minutes?|m)$/);
    if (m && steps[i]?.type === "sound_play") {
      const minutes = Math.min(720, Math.max(1, parseInt(m[1], 10)));
      out.push({ type: "sound_timer", minutes });
    }
  }
  // Carry over any extras the loop missed (defensive — shouldn't happen).
  for (let i = clauses.length; i < steps.length; i++) out.push(steps[i]);
  return out;
}

export function parseNaturalLanguageRoutine(input: string): NLRoutineDraft {
  const raw = (input ?? "").trim();
  const warnings: string[] = [];

  // Extract a leading time trigger, then strip it from the body.
  let body = raw;
  const t = parseTimeOfDay(raw);
  const trigger: AutomationTrigger = t ? { type: "time", hhmm: t.hhmm } : { type: "manual" };
  if (t) body = body.replace(t.matched, " ").replace(/\s+/g, " ").trim();

  // Strip a leading colon or "do the following:" lead-in.
  body = body.replace(/^.*?:\s*/, (m) => (/(do|then)\s*:\s*$/i.test(m) ? "" : m));

  const clauses = splitClauses(body);
  const rawSteps = clauses.map((c) => parseClause(c, warnings)).filter((s): s is AutomationStep => s !== null);
  const steps = expandTimers(clauses, rawSteps);

  const kind = inferKind(raw);
  const name = defaultNameFor(kind, t?.hhmm ?? null, steps);
  const rationale = buildRationale(trigger, steps);

  return { name, kind, trigger, steps, warnings, rationale };
}

function defaultNameFor(kind: AutomationKind, hhmm: string | null, steps: AutomationStep[]): string {
  const verb =
    kind === "bedtime" ? "Bedtime"
      : kind === "goodnight" ? "Goodnight"
        : kind === "wake_up" ? "Wake-up"
          : kind === "morning" ? "Morning"
            : "Routine";
  if (hhmm) return `${verb} at ${hhmm}`;
  if (steps.some((s) => s.type === "quiet_mode")) return `${verb} (Quiet Mode)`;
  return verb;
}

function buildRationale(trigger: AutomationTrigger, steps: AutomationStep[]): string {
  const parts: string[] = [];
  if (trigger.type === "time") {
    parts.push(`Triggers every day at ${trigger.hhmm}.`);
  } else {
    parts.push("Runs only when you ask.");
  }
  if (steps.some((s) => s.type === "quiet_mode" && s.on)) {
    parts.push("Quiet Mode mutes voice replies and pauses non-urgent notifications (it never overrides iOS Focus or Android DND).");
  }
  if (steps.some((s) => s.type === "sound_play")) {
    parts.push("Sleep sounds are local to this device.");
  }
  parts.push("Nothing runs until you confirm.");
  return parts.join(" ");
}
