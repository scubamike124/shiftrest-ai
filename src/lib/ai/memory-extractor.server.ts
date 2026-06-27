/**
 * Background fact extraction. Runs after a coach turn when the user has
 * memory enabled. Extracts a few durable, factual statements and upserts
 * them into ai_memory with dedupe + supersede logic.
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

Return JSON: { "memories": [ { "content": "...", "category": "schedule|health|preferences|employer|recovery|caffeine|family|goals|general", "importance": 1-5, "ttl_days": number|null } ] }

importance scale:
  5 = identity/role/long-running schedule ("works nights at Mercy", "has two kids under 5")
  4 = strong recurring preference or constraint ("hates caffeine after 2pm", "morning workouts")
  3 = useful habit/pattern (default)
  2 = mild preference
  1 = barely worth keeping

ttl_days: set to 7-30 for temporary facts ("on call this week"); null for durable.

Return { "memories": [] } if nothing qualifies. Each content < 140 chars. Max 4 memories per call.`;

const categories = new Set([
  "general","schedule","health","preferences","employer","recovery","caffeine","family","goals",
]);

type Extracted = {
  content: string;
  category: string;
  importance?: number;
  ttl_days?: number | null;
};

/** Normalize for dedupe: lowercased, alphanumerics + single spaces. */
function normalizeHash(content: string): string {
  return content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlapKey(content: string): string {
  return normalizeHash(content).split(" ").slice(0, 6).join(" ");
}

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
  const candidates = (parsed.memories ?? [])
    .filter((m) => m && typeof m.content === "string" && m.content.trim().length >= 4)
    .slice(0, 4);
  if (candidates.length === 0) return 0;

  // Pull existing active memories once for dedupe.
  const { data: existingRows } = await opts.admin
    .from("ai_memory")
    .select("id, content, category, use_count, confidence, embedding_hash")
    .eq("user_id", opts.userId)
    .is("superseded_by", null);
  const existing = (existingRows ?? []) as {
    id: string;
    content: string;
    category: string;
    use_count: number;
    confidence: number;
    embedding_hash: string | null;
  }[];

  let inserted = 0;
  for (const m of candidates) {
    const content = m.content.trim().slice(0, 280);
    const category = categories.has(m.category) ? m.category : "general";
    const importance = Math.max(1, Math.min(5, Math.round(m.importance ?? 3)));
    const hash = normalizeHash(content);
    const overlap = tokenOverlapKey(content);
    const ttlDays = typeof m.ttl_days === "number" && m.ttl_days > 0 ? m.ttl_days : null;
    const expiresAt = ttlDays
      ? new Date(Date.now() + ttlDays * 86_400_000).toISOString()
      : null;

    // Exact duplicate? bump and move on.
    const dup = existing.find(
      (e) => e.category === category && e.embedding_hash === hash,
    );
    if (dup) {
      await opts.admin
        .from("ai_memory")
        .update({
          use_count: (dup.use_count ?? 0) + 1,
          confidence: Math.min(1, (dup.confidence ?? 0.7) + 0.1),
          updated_at: new Date().toISOString(),
        })
        .eq("id", dup.id);
      continue;
    }

    // Soft supersede: same category + 6-token overlap counts as a refinement.
    const near = existing.find(
      (e) =>
        e.category === category &&
        e.embedding_hash !== hash &&
        tokenOverlapKey(e.content) === overlap,
    );

    const { data: insertRow, error: insertErr } = await opts.admin
      .from("ai_memory")
      .insert({
        user_id: opts.userId,
        content,
        category,
        confidence: 0.75,
        source: "chat",
        importance,
        embedding_hash: hash,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (insertErr || !insertRow) {
      console.error("ai_memory insert failed", insertErr);
      continue;
    }
    inserted += 1;

    if (near) {
      await opts.admin
        .from("ai_memory")
        .update({ superseded_by: insertRow.id })
        .eq("id", near.id);
    }
  }

  return inserted;
}
