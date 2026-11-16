/**
 * Background fact extraction from coach chat. Runs after a coach turn when the
 * user has memory enabled and learning is not paused.
 *
 * CONSENT: nothing is saved as a memory here. Each candidate becomes a pending
 * row in `ai_memory_proposals`; the user must accept it on /memory before it
 * becomes a real memory (same flow as the nightly memory proposer). This keeps
 * the promise on the Memory page: "Nothing is saved until you say yes."
 *
 * PRIVACY: the AI never generates health memories (privacy policy §5). Health
 * candidates, and any candidate whose text describes a medical condition,
 * medication or symptom, are dropped. Temporary facts are not proposed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJSON, FAST_MODEL } from "./gateway.server";
import { modelForTask } from "./models.server";
import { logAIRequest } from "./log.server";

const EXTRACT_SYSTEM = `You extract durable, factual long-term memories about a shift worker from chat snippets, for an AI sleep/recovery coach.

ONLY extract statements that are:
- Durable (true for weeks or months, not "I'm tired today")
- Concrete (a habit, preference, role, schedule pattern, family detail, goal)
- About the USER, not the assistant

NEVER extract: emotions, health conditions, symptoms, medications or supplements, diagnoses, pregnancy, mental health, today's plan, anything you're guessing at.

Return JSON: { "memories": [ { "content": "...", "category": "schedule|preferences|employer|recovery|caffeine|family|goals|general", "importance": 1-5, "ttl_days": number|null } ] }

importance scale:
  5 = identity/role/long-running schedule ("works nights at Mercy", "has two kids under 5")
  4 = strong recurring preference or constraint ("hates caffeine after 2pm", "morning workouts")
  3 = useful habit/pattern (default)
  2 = mild preference
  1 = barely worth keeping

ttl_days: set to 7-30 for temporary facts ("on call this week"); null for durable.

Return { "memories": [] } if nothing qualifies. Each content < 140 chars. Max 4 memories per call.`;

/** Categories the AI may propose. "health" is deliberately absent. */
const categories = new Set([
  "general",
  "schedule",
  "preferences",
  "employer",
  "recovery",
  "caffeine",
  "family",
  "goals",
]);

/** Health/medical content is never proposed, whatever category the model chose. */
const SENSITIVE =
  /\b(health|medical|medic(?:ine|ation|ations)|meds?\b|prescri\w*|diagnos\w*|disorder|illness|sick|symptom\w*|condition|pain|injur\w*|surgery|pregnan\w*|depress\w*|anxiety|panic|bipolar|adhd|ptsd|therap(?:y|ist)|counsel\w*|insomnia|apnea|narcolepsy|diabet\w*|blood pressure|hypertension|asthma|migraine\w*|cancer|heart|seizure|epilep\w*|melatonin|ambien|zolpidem|trazodone|benadryl|antidepressant\w*|ssri\w*|supplement\w*|pill\w*)\b/i;

/** Exported for tests: is this candidate allowed to become a proposal? */
export function proposalAllowed(m: {
  content?: unknown;
  category?: unknown;
  ttl_days?: unknown;
}): boolean {
  if (typeof m.content !== "string" || m.content.trim().length < 4) return false;
  if (m.category === "health") return false;
  if (typeof m.ttl_days === "number" && m.ttl_days > 0) return false;
  return !SENSITIVE.test(m.content);
}

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

export async function proposeMemoriesFromChat(opts: {
  admin: SupabaseClient;
  userId: string;
  userTurn: string;
  assistantTurn: string;
}): Promise<number> {
  // "Pause learning" must stop ALL memory writes, not only pattern
  // proposals. Re-read consent server-side; fail closed if it can't be read.
  const { data: consent, error: consentError } = await opts.admin
    .from("user_prefs")
    .select("memory_enabled, memory_learning_paused")
    .eq("user_id", opts.userId)
    .maybeSingle();
  const c = consent as {
    memory_enabled: boolean | null;
    memory_learning_paused: boolean | null;
  } | null;
  if (consentError || !c?.memory_enabled || c.memory_learning_paused) return 0;

  const start = Date.now();
  const snippet = `USER: ${opts.userTurn}\nASSISTANT: ${opts.assistantTurn}`.slice(0, 4000);

  let result;
  try {
    result = await chatJSON({
      task: "background",
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
      model: modelForTask("background") ?? FAST_MODEL,
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
    model: result.model,
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
  const candidates = (parsed.memories ?? []).filter((m) => m && proposalAllowed(m)).slice(0, 4);
  if (candidates.length === 0) return 0;

  // Skip facts the user already keeps, and anything they declined in the last 30 days.
  const [{ data: existingRows }, { data: declinedRows }] = await Promise.all([
    opts.admin
      .from("ai_memory")
      .select("content, embedding_hash")
      .eq("user_id", opts.userId)
      .is("superseded_by", null),
    opts.admin
      .from("ai_memory_proposals")
      .select("dedupe_key")
      .eq("user_id", opts.userId)
      .eq("status", "declined")
      .gte("decided_at", new Date(Date.now() - 30 * 86_400_000).toISOString()),
  ]);
  const existing = (existingRows ?? []) as { content: string; embedding_hash: string | null }[];
  const haveText = new Set(existing.map((e) => normalizeHash(e.content)));
  const haveHash = new Set(
    existing.map((e) => e.embedding_hash).filter((h): h is string => Boolean(h)),
  );
  const declined = new Set(
    ((declinedRows ?? []) as { dedupe_key: string }[]).map((r) => r.dedupe_key),
  );

  let proposed = 0;
  for (const m of candidates) {
    const content = m.content.trim().slice(0, 280);
    const category = categories.has(m.category) ? m.category : "general";
    const importance = Math.max(1, Math.min(5, Math.round(m.importance ?? 3)));
    const hash = normalizeHash(content);
    const dedupeKey = `chat:${tokenOverlapKey(content)}`.slice(0, 120);
    if (
      haveText.has(hash) ||
      haveHash.has(hash) ||
      haveHash.has(`proposal:${dedupeKey}`) ||
      declined.has(dedupeKey)
    )
      continue;

    const { data: pending } = await opts.admin
      .from("ai_memory_proposals")
      .select("id, observed_count")
      .eq("user_id", opts.userId)
      .eq("dedupe_key", dedupeKey)
      .eq("status", "pending")
      .maybeSingle();
    const row = pending as { id: string; observed_count: number | null } | null;
    if (row) {
      await opts.admin
        .from("ai_memory_proposals")
        .update({
          last_seen_at: new Date().toISOString(),
          observed_count: (row.observed_count ?? 0) + 1,
          content,
        } as never)
        .eq("id", row.id);
      continue;
    }
    const { error } = await opts.admin.from("ai_memory_proposals").insert({
      user_id: opts.userId,
      category,
      content,
      dedupe_key: dedupeKey,
      evidence: { source: "chat", importance },
      observed_count: 1,
      confidence: 0.75,
      status: "pending",
    } as never);
    if (error) {
      console.error("ai_memory_proposals insert failed", error);
      continue;
    }
    proposed += 1;
  }
  return proposed;
}

/** Former name, kept for existing callers and tests; it now only proposes. */
export const extractAndStoreMemories = proposeMemoriesFromChat;
