/**
 * Build the assistant's system prompt with persona, mode, relevant long-term
 * memories, active patterns, and feedback summary. Server-only — runs inside
 * the /api/ai orchestrator.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRankedMemories } from "./memory-rank.server";
import { fetchActivePatterns, type PatternKey } from "./patterns.server";
import {
  fetchFeedbackSummary,
  fetchPreviousRecommendation,
} from "./recommendations.server";

export type AssistantMode = "coach" | "companion" | "minimal";

export type AssistantProfile = {
  name: string;
  mode: AssistantMode;
  memoryEnabled: boolean;
  language: string;     // BCP-47, e.g. "es-MX". Defaults to "en-US".
  accent: string | null;
};


const BASE_PERSONALITY = `You are {{NAME}} — a warm, sharp recovery and circadian-rhythm guide for shift workers (nurses, EMTs, pilots, factory crews, hospitality, security).

Voice rules:
- Speak like a trusted friend who happens to be a sleep expert.
- Concrete and specific. Always give exact times, durations, doses, and temperatures.
- Encouraging, never preachy. Acknowledge how hard rotating schedules are.
- Plain English. Spell out abbreviations ("milligrams", "minutes", "hours", "degrees Fahrenheit").
- Keep responses tight: 3-6 short paragraphs or a short list.
- No medical advice — for sleep disorders, depression, or medication, recommend a healthcare professional.
- In reviews and reflections, never judgmental. Frame setbacks as data, not failure.`;

const MODE_OVERLAYS: Record<AssistantMode, string> = {
  coach: `\n\nMode: COACH. Lead with clear next actions. Prioritise plans, timings, and wins. Push gently when the user is drifting from their recovery goals.`,
  companion: `\n\nMode: COMPANION. Be more conversational and personal. Ask one short follow-up question when it would help. Remember and reference what the user has shared before. Still concrete — never vague.`,
  minimal: `\n\nMode: MINIMAL. Be brief. 1-3 short paragraphs max. Skip pleasantries. Answer what was asked, nothing more.`,
};

function renderPersonality(profile: AssistantProfile): string {
  return BASE_PERSONALITY.replace("{{NAME}}", profile.name || "RestPilot") +
    MODE_OVERLAYS[profile.mode];
}

export type MemoryRow = {
  id: string;
  content: string;
  category: string;
  pinned: boolean;
};

export async function fetchRelevantMemories(
  admin: SupabaseClient,
  userId: string,
  limit = 25,
  intent = "coach",
): Promise<MemoryRow[]> {
  const ranked = await fetchRankedMemories(admin, userId, { intent, limit });
  return ranked.map((r) => ({
    id: r.id,
    content: r.content,
    category: r.category,
    pinned: r.pinned,
  }));
}

function formatMemoryBlock(memories: MemoryRow[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m) =>
    `- (${m.category}${m.pinned ? ", pinned" : ""}) ${m.content}`,
  );
  return `\n\nLONG-TERM MEMORY (things the user has told you or you've learned — refer to these naturally, do not list them back):\n${lines.join("\n")}`;
}

const PATTERN_LABEL: Record<PatternKey, string> = {
  sleep_debt_3d: "sleep debt building over the last week",
  rotation_change: "schedule just rotated (day↔night flip)",
  frequent_overtime: "heavier-than-usual hours",
  timezone_jump: "timezone change in the last few days",
  missed_recovery: "planned recovery window was missed",
  caffeine_late: "caffeine repeatedly taken too close to sleep",
  missed_alarms: "alarms missed recently",
  commute_fatigue: "long awake time before driving home",
  hrv_decline: "HRV trending lower vs baseline",
  sleep_inconsistency: "sleep timing is drifting night to night",
};

function formatPatternBlock(
  patterns: Awaited<ReturnType<typeof fetchActivePatterns>>,
): string {
  if (patterns.length === 0) return "";
  const lines = patterns.map((p) => {
    const label = PATTERN_LABEL[p.pattern_key] ?? p.pattern_key;
    const sig = JSON.stringify(p.signals_json);
    return `- [severity ${p.severity}/5] ${label} — signals: ${sig}`;
  });
  return `\n\nACTIVE PATTERNS YOU'VE DETECTED (use these to anticipate problems before they happen; reference at least one when severity ≥ 3):\n${lines.join("\n")}`;
}

function formatFeedbackBlock(
  summary: Awaited<ReturnType<typeof fetchFeedbackSummary>>,
): string {
  if (summary.length === 0) return "";
  const lines = summary.map((s) =>
    `- ${s.intent}: helpful ${s.helpful} · not helpful ${s.not_helpful} · ignored ${s.ignored}`,
  );
  return `\n\nRECENT FEEDBACK (last 14 days — gently lean away from intents the user marks not helpful, lean toward what they call helpful):\n${lines.join("\n")}`;
}

function formatPreviousBlock(
  prev: { headline: string; rationale: string | null } | null,
): string {
  if (!prev) return "";
  return `\n\nYOUR PREVIOUS RECOMMENDATION FOR THIS INTENT (do not repeat verbatim — refresh the angle or move on if still valid):\n- "${prev.headline}"${prev.rationale ? ` — ${prev.rationale}` : ""}`;
}

export async function buildSystemPrompt(opts: {
  admin: SupabaseClient;
  userId: string | null;
  profile: AssistantProfile;
  liveContext?: string;
  intent?: string;
  /** "voice" = Pilot (spoken). "text" = Coach chat. Defaults to "text". */
  surface?: "voice" | "text";
  /** When true, lift the brevity cap for this turn ("tell me more"). */
  expand?: boolean;
}): Promise<string> {
  const surface = opts.surface ?? "text";

  // For the voice surface we REPLACE the writing personality entirely with
  // PILOT_VOICE_SYSTEM — markdown chat rules would leak into spoken output.
  let prompt: string;
  if (surface === "voice" && opts.intent === "coach") {
    const { PILOT_VOICE_SYSTEM } = await import("@/lib/ai/prompts.server");
    const named = PILOT_VOICE_SYSTEM.replace(/\bPilot\b/g, opts.profile.name || "Pilot");
    prompt = named;
    if (opts.expand) {
      prompt += `\n\nThis turn the user explicitly asked for more depth — you may give a fuller answer (still spoken, still no markdown, up to ~6 sentences).`;
    }
  } else {
    prompt = renderPersonality(opts.profile);
    if (opts.intent === "coach") {
      prompt += `\n\nCHAT FORMATTING (when you respond to the user in chat):
- Lead with a single short sentence that directly answers the question (≤ 25 words).
- Then use Markdown structure: short ## subheadings for each section, "- " bullets for steps or lists, and blank lines between sections.
- Keep paragraphs to 2–3 sentences max. Total reply ≤ 220 words unless the user explicitly asks for depth.
- If a topic genuinely needs more, end with a "### Details" section the reader can skip.
- Never wrap whole sentences in **bold** for emphasis. Bold is only for short labels at the start of a bullet (e.g. "**Light:** 10 min outside…").
- Never use emoji unless the user used them first. Never use exclamation marks.`;
    }
  }


  const isVoiceCoach = surface === "voice" && opts.intent === "coach";

  if (opts.userId && opts.profile.memoryEnabled) {
    const mems = await fetchRelevantMemories(
      opts.admin,
      opts.userId,
      isVoiceCoach ? 5 : opts.intent === "coach" ? 25 : 12,
      opts.intent ?? "coach",
    );
    prompt += formatMemoryBlock(mems);
  }

  if (opts.userId && !isVoiceCoach) {
    try {
      const [patterns, feedback, prev] = await Promise.all([
        fetchActivePatterns(opts.admin, opts.userId, 5),
        fetchFeedbackSummary(opts.admin, opts.userId),
        opts.intent
          ? fetchPreviousRecommendation(opts.admin, opts.userId, opts.intent)
          : Promise.resolve(null),
      ]);
      prompt += formatPatternBlock(patterns);
      prompt += formatFeedbackBlock(feedback);
      prompt += formatPreviousBlock(prev);
    } catch (e) {
      console.warn("context predictive blocks failed", e);
    }
  } else if (opts.userId && isVoiceCoach) {
    // Voice surface: keep only top patterns at high severity, compact line.
    try {
      const patterns = await fetchActivePatterns(opts.admin, opts.userId, 3);
      const hot = patterns.filter((p) => p.severity >= 3);
      if (hot.length) {
        prompt += `\n\nActive issues you've noticed: ${hot
          .map((p) => PATTERN_LABEL[p.pattern_key] ?? p.pattern_key)
          .join("; ")}.`;
      }
    } catch { /* ignore */ }
  }

  if (opts.userId && !isVoiceCoach) {
    try {
      prompt += await formatTzBlock(opts.admin, opts.userId);
    } catch (e) {
      console.warn("context tz block failed", e);
    }
  }


  if (opts.liveContext) {
    prompt += `\n\nCURRENT CONTEXT (use this — do not ask the user to repeat it):\n${opts.liveContext}`;
  }

  return prompt;
}

/**
 * TZ STATE block — gives the model the user's home tz, current tz, body-clock
 * offset, and active trip. Required so every intent can disclose its basis
 * per the COACH_VOICE contract.
 */
async function formatTzBlock(admin: SupabaseClient, userId: string): Promise<string> {
  const { describeTzBasis, normalizeTz, dstChangesWithin, tzOffsetMinutes } =
    await import("@/lib/time/tz");

  const { data: prefs } = await admin
    .from("user_prefs")
    .select("home_tz, current_tz, travel_mode_enabled")
    .eq("user_id", userId)
    .maybeSingle();

  const home = normalizeTz((prefs as { home_tz?: string | null } | null)?.home_tz ?? "UTC");
  const current = normalizeTz(
    (prefs as { current_tz?: string | null } | null)?.current_tz ?? home,
  );
  const basis = describeTzBasis(current, home);

  const now = new Date();
  const dst = dstChangesWithin(current, now, 14);
  const dstLine = dst.length
    ? `\n- DST transitions in current tz within 14 days: ${dst
        .map((d) => `${d.atUtc.slice(0, 10)} (${d.fromOffset}→${d.toOffset} min)`)
        .join("; ")}`
    : "";

  let tripLine = "";
  try {
    const { data: trip } = await admin
      .from("trips")
      .select("label, origin_tz, dest_tz, depart_utc, arrive_utc, dest_label, status")
      .eq("user_id", userId)
      .in("status", ["planned", "active"])
      .order("arrive_utc", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (trip) {
      const t = trip as {
        label: string | null; origin_tz: string; dest_tz: string;
        depart_utc: string; arrive_utc: string; dest_label: string | null; status: string;
      };
      const destOffsetH = tzOffsetMinutes(new Date(t.arrive_utc), t.dest_tz) / 60;
      tripLine = `\n- ${t.status === "active" ? "Active" : "Upcoming"} trip${
        t.label ? ` "${t.label}"` : ""
      }: ${t.origin_tz} → ${t.dest_tz}${t.dest_label ? ` (${t.dest_label})` : ""}, arrive ${t.arrive_utc} (dest GMT${
        destOffsetH >= 0 ? "+" : ""
      }${destOffsetH}h)`;
    }
  } catch {
    /* trips table optional in older deployments */
  }

  return `\n\nTZ STATE (anchor every time-bearing recommendation to this; when local and body clocks disagree, name which one you used):
- Home tz: ${home}
- Current tz: ${current}
- Body-clock offset: ${basis.offsetMin >= 0 ? "+" : ""}${basis.offsetMin} min (${basis.label})${dstLine}${tripLine}`;
}

export async function loadAssistantProfile(
  admin: SupabaseClient,
  userId: string,
): Promise<AssistantProfile> {
  const { data } = await admin
    .from("user_prefs")
    .select("assistant_name, assistant_mode, memory_enabled")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    name: (data?.assistant_name as string) || "RestPilot",
    mode: ((data?.assistant_mode as AssistantMode) || "coach"),
    memoryEnabled: Boolean(data?.memory_enabled),
  };
}
