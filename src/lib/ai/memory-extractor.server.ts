/**
 * Background fact extraction. Called after a coach turn completes when the
 * user has memory enabled. Extracts at most a handful of durable, factual
 * statements about the user and upserts them into ai_memory.
 *
 * Privacy: only runs when memory_enabled = true. Never stores transient
 * complaints, emotions, or short-term state.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJSON, FAST_MODEL } from "./gateway.server";
import { logAIRequest } from "./log.server";

const EXTRACT_SYSTEM = `You extract durable, factual long-term memories about a shift worker from chat snippets, for an AI sleep/recovery coach.

ONLY extract statements that are:
- Durable (true for weeks or months, not "I'm tired today")
- Concrete (a habit, preference, role, schedule pattern, family detail, goal)
- About the USER, not the assistant

NEVER extract: emotions, transient symptoms, today's plan, medical diagnoses, anything you're guessing at.

Return JSON: { "memories": [ { "content": "...", "category": "schedule|health|preferences|employer|recovery|caffeine|family|goals|general" } ] }

Return { "memories": [] } if nothing qualifies. Keep each content under 140 chars. Max 4 memories per call.`;

const categories = new Set([
  "general","schedule","health","preferences","employer","recovery","caffeine","family","goals",
]);

type Extracted = { content: string; category: string };

export async function extractAndStoreMemories(opts: {
  admin: SupabaseClient;
  userId: string;
  userTurn: string;
  assistantTurn: string;
}): Promise<number> {
  const start = Date.now();
  const snippet = `USER: ${opts.userTurn}\nASSISTANT: ${opts.assistantTurn}`.slice(0, 4000);

  let result;
  try {
    result = await chatJSON({
      model: FAST_MODEL,
      jsonMode: true,
      temperature: 0.1,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: snippet },
      ],
    });
  } catch (e) {
    await logAIRequest(opts.admin, {
      user_id: opts.userId,
      intent: "memory_extract",
      model: FAST_MODEL,
      prompt_tokens: 0,
      completion_tokens: 0,
      latency_ms: Date.now() - start,
      status: "error",
      error: e instanceof Error ? e.message : "unknown",
    });
    return 0;
  }

  await logAIRequest(opts.admin, {
    user_id: opts.userId,
    intent: "memory_extract",
    model: FAST_MODEL,
    prompt_tokens: result.promptTokens,
    completion_tokens: result.completionTokens,
    latency_ms: Date.now() - start,
    status: "ok",
  });

  let parsed: { memories?: Extracted[] };
  try {
    parsed = JSON.parse(result.text || "{}");
  } catch {
    return 0;
  }
  const candidates = (parsed.memories ?? []).filter(
    (m) => m && typeof m.content === "string" && m.content.trim().length >= 4,
  );
  if (candidates.length === 0) return 0;

  const rows = candidates.slice(0, 4).map((m) => ({
    user_id: opts.userId,
    content: m.content.trim().slice(0, 280),
    category: categories.has(m.category) ? m.category : "general",
    confidence: 0.7,
    source: "chat" as const,
  }));

  const { error } = await opts.admin.from("ai_memory").insert(rows);
  if (error) {
    console.error("ai_memory insert failed", error);
    return 0;
  }
  return rows.length;
}
