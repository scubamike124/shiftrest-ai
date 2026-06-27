/**
 * Build the assistant's system prompt with persona, mode, and relevant
 * long-term memories. Server-only — runs inside the /api/ai orchestrator.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type AssistantMode = "coach" | "companion" | "minimal";

export type AssistantProfile = {
  name: string;
  mode: AssistantMode;
  memoryEnabled: boolean;
};

const BASE_PERSONALITY = `You are {{NAME}} — a warm, sharp recovery and circadian-rhythm guide for shift workers (nurses, EMTs, pilots, factory crews, hospitality, security).

Voice rules:
- Speak like a trusted friend who happens to be a sleep expert.
- Concrete and specific. Always give exact times, durations, doses, and temperatures.
- Encouraging, never preachy. Acknowledge how hard rotating schedules are.
- Plain English. Spell out abbreviations ("milligrams", "minutes", "hours", "degrees Fahrenheit").
- Keep responses tight: 3-6 short paragraphs or a short list.
- No medical advice — for sleep disorders, depression, or medication, recommend a healthcare professional.`;

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

/** Fetch the most relevant long-term memories for this user. */
export async function fetchRelevantMemories(
  admin: SupabaseClient,
  userId: string,
  limit = 25,
): Promise<MemoryRow[]> {
  const { data, error } = await admin
    .from("ai_memory")
    .select("id, content, category, pinned")
    .eq("user_id", userId)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as MemoryRow[];
}

function formatMemoryBlock(memories: MemoryRow[]): string {
  if (memories.length === 0) return "";
  const lines = memories.map((m) =>
    `- (${m.category}${m.pinned ? ", pinned" : ""}) ${m.content}`,
  );
  return `\n\nLONG-TERM MEMORY (things the user has told you or you've learned — refer to these naturally, do not list them back):\n${lines.join("\n")}`;
}

/**
 * Compose the full system prompt. The "context" string is the live plan /
 * fatigue / shift context built by the existing coach.tsx; we keep it as a
 * caller-supplied opaque blob for now.
 */
export async function buildSystemPrompt(opts: {
  admin: SupabaseClient;
  userId: string | null;
  profile: AssistantProfile;
  liveContext?: string;
}): Promise<string> {
  let prompt = renderPersonality(opts.profile);

  if (opts.userId && opts.profile.memoryEnabled) {
    const mems = await fetchRelevantMemories(opts.admin, opts.userId);
    prompt += formatMemoryBlock(mems);
  }

  if (opts.liveContext) {
    prompt += `\n\nCURRENT CONTEXT (use this — do not ask the user to repeat it):\n${opts.liveContext}`;
  }

  return prompt;
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
