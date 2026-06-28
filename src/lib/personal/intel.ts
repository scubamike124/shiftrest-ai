// Phase 4 — Personal Intelligence. Pure logic, no IO.
// Detects priority, builds daily plan, suggests follow-ups, and composes
// cross-skill sentences combining calendar + weather + traffic + items.

export type ItemKind = "task" | "reminder" | "email_note" | "followup";
export type ItemStatus = "open" | "snoozed" | "done" | "dismissed";

export interface PersonalItem {
  id: string;
  kind: ItemKind;
  title: string;
  notes: string | null;
  source: string | null;
  dueAt: string | null;
  remindAt: string | null;
  priority: 1 | 2 | 3 | 4; // 1 = highest
  status: ItemStatus;
  followupOf: string | null;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
  updatedAt: string;
}

const URGENT_PATTERNS =
  /\b(urgent|asap|today|tonight|deadline|by\s+(?:eod|cob|noon|tomorrow)|due|overdue|important|need(?:ed)?\s+(?:now|today)|critical|final\s+notice)\b/i;
const SOFT_PATTERNS =
  /\b(this\s+week|when\s+you\s+can|fyi|update|reminder|follow[- ]?up|next\s+week|sometime)\b/i;

/** Heuristic priority detection from title + notes. 1=highest, 4=lowest. */
export function detectPriority(title: string, notes?: string | null, dueAt?: string | null): 1 | 2 | 3 | 4 {
  const blob = `${title} ${notes ?? ""}`;
  const now = Date.now();
  if (dueAt) {
    const ms = new Date(dueAt).getTime() - now;
    if (Number.isFinite(ms)) {
      if (ms < 0) return 1;                       // overdue
      if (ms < 6 * 3600_000) return 1;            // < 6h
      if (ms < 24 * 3600_000) return 2;           // today-ish
      if (ms < 72 * 3600_000) return 3;           // < 3d
    }
  }
  if (URGENT_PATTERNS.test(blob)) return 1;
  if (SOFT_PATTERNS.test(blob)) return 3;
  return 2;
}

export interface DailyPlanInputs {
  /** Local now (epoch ms). */
  now: number;
  items: PersonalItem[];
  /** Up to ~5 today/tomorrow events with start ISO. */
  agenda?: Array<{ summary: string; startISO: string; allDay?: boolean }>;
  /** Optional weather alert headline (e.g. "Rain expected 7–10am"). */
  weatherHint?: string | null;
  /** Optional traffic delta in minutes for first commute. */
  trafficDeltaMin?: number | null;
  /** Optional first-event time of day, "HH:MM" 24h, local. */
  earliestMeetingHHMM?: string | null;
}

export interface DailyPlanOutput {
  /** Top 3 items, priority-sorted, due-soon first. */
  top: PersonalItem[];
  /** One-line cross-skill suggestion or null. */
  composedHint: string | null;
  /** Practical bullet suggestions (max 3) based on inputs. */
  suggestions: string[];
  /** Count of open items not in `top`. */
  moreCount: number;
}

function dueRank(item: PersonalItem, now: number): number {
  if (!item.dueAt) return 9_999_999_999;
  const t = new Date(item.dueAt).getTime();
  if (!Number.isFinite(t)) return 9_999_999_999;
  return Math.max(0, t - now);
}

/** Compose a daily plan slice from inputs. Pure. */
export function buildDailyPlan(input: DailyPlanInputs): DailyPlanOutput {
  const open = input.items.filter((i) => i.status === "open");
  const sorted = [...open].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return dueRank(a, input.now) - dueRank(b, input.now);
  });
  const top = sorted.slice(0, 3);
  const moreCount = Math.max(0, open.length - top.length);

  const suggestions: string[] = [];
  const composed = composeCrossSkillHint(input);
  if (composed) suggestions.push(composed);

  const overdue = open.filter((i) => i.dueAt && new Date(i.dueAt).getTime() < input.now);
  if (overdue.length > 0) {
    suggestions.push(
      overdue.length === 1
        ? `1 item is overdue — start with "${overdue[0].title}".`
        : `${overdue.length} items are overdue. Knock out the top one first.`,
    );
  }

  const followups = suggestFollowups(open, input.now);
  for (const f of followups.slice(0, Math.max(0, 3 - suggestions.length))) {
    suggestions.push(f);
  }

  return { top, composedHint: composed, suggestions: suggestions.slice(0, 3), moreCount };
}

/** Cross-skill sentence combining calendar + weather + traffic. */
export function composeCrossSkillHint(input: DailyPlanInputs): string | null {
  const parts: string[] = [];
  if (input.earliestMeetingHHMM) parts.push(`You have an early meeting at ${input.earliestMeetingHHMM}`);
  if (input.weatherHint) parts.push(input.weatherHint.toLowerCase().includes("rain") ? "rain is expected" : input.weatherHint);
  if (typeof input.trafficDeltaMin === "number" && input.trafficDeltaMin >= 5) {
    parts.push(`traffic is about ${Math.round(input.trafficDeltaMin)} min heavier than usual`);
  }
  if (parts.length < 2) return null;
  const head = parts.join(", ");
  const tail =
    input.earliestMeetingHHMM
      ? "Leave earlier and start winding down sooner tonight."
      : "Plan a few extra minutes today.";
  return `${head}. ${tail}`;
}

/**
 * Suggest follow-ups for stale open items (>3 days old, no due date or due passed).
 * Returns short user-facing sentences.
 */
export function suggestFollowups(open: PersonalItem[], now: number): string[] {
  const out: string[] = [];
  for (const it of open) {
    if (it.kind === "followup") continue;
    const ageDays = (now - new Date(it.createdAt).getTime()) / 86_400_000;
    const isStale = ageDays >= 3 && (!it.dueAt || new Date(it.dueAt).getTime() < now);
    if (isStale) {
      const verb = it.kind === "email_note" ? "Reply to" : "Follow up on";
      out.push(`${verb} "${truncate(it.title, 48)}" — open for ${Math.round(ageDays)} day${ageDays >= 2 ? "s" : ""}.`);
    }
    if (out.length >= 3) break;
  }
  return out;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

/** Label for priority chip. */
export function priorityLabel(p: 1 | 2 | 3 | 4): string {
  return p === 1 ? "High" : p === 2 ? "Normal" : p === 3 ? "Low" : "Someday";
}
