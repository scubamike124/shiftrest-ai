/**
 * Slice 5 — Memory Proposer.
 *
 * Watches repeated user behaviors and proposes durable memories. Nothing
 * is ever inserted into `ai_memory` directly. Every detection writes a
 * row into `ai_memory_proposals` with status='pending'; the user must
 * accept it from /memory before it becomes a real memory.
 *
 * Runs inside the nightly /api/public/hooks/ai-learn cron, under the
 * service-role client (so RLS is bypassed for batch processing).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

type AdminClient = SupabaseClient<any, any, any>;

type Proposal = {
  category:
    | "sleep_habits"
    | "alarm_prefs"
    | "favorite_sounds"
    | "daily_routine"
    | "companion_prefs";
  content: string;
  dedupe_key: string;
  evidence: Record<string, unknown>;
  observed_count: number;
  confidence: number;
};

const DAY = 86_400_000;

function minsToClock(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? "AM" : "PM";
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2);
}

function within(values: number[], center: number, tolerance: number): number {
  return values.filter((v) => Math.abs(v - center) <= tolerance).length;
}

function modeOf<T>(values: T[]): { value: T; count: number } | null {
  if (!values.length) return null;
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of map) {
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

/** Detect repeated bedtimes/wake-times from the shifts table. */
async function detectSleepWindows(
  admin: AdminClient,
  userId: string,
  sleepHours: number,
): Promise<Proposal[]> {
  const { data } = await admin
    .from("shifts")
    .select("start_min, end_min")
    .eq("user_id", userId)
    .limit(60);

  const rows = (data as Array<{ start_min: number; end_min: number }> | null) ?? [];
  if (rows.length < 5) return [];

  // Bedtime ≈ shift_end + 60 min wind-down (mod 1440). Wake ≈ bedtime + sleep_hours.
  const bedtimes = rows
    .map((r) => (r.end_min + 60) % 1440)
    .filter((m) => Number.isFinite(m));
  const wakes = bedtimes.map((b) => (b + Math.round(sleepHours * 60)) % 1440);

  const out: Proposal[] = [];

  if (bedtimes.length >= 5) {
    const med = median(bedtimes);
    const hits = within(bedtimes, med, 45);
    if (hits >= 5) {
      out.push({
        category: "sleep_habits",
        content: `Usually goes to bed around ${minsToClock(med)}`,
        dedupe_key: `sleep:bedtime`,
        evidence: { median_min: med, observations: hits, total: bedtimes.length },
        observed_count: hits,
        confidence: Math.min(0.95, 0.55 + hits * 0.05),
      });
    }
  }
  if (wakes.length >= 5) {
    const med = median(wakes);
    const hits = within(wakes, med, 45);
    if (hits >= 5) {
      out.push({
        category: "sleep_habits",
        content: `Usually wakes around ${minsToClock(med)}`,
        dedupe_key: `sleep:wake`,
        evidence: { median_min: med, observations: hits, total: wakes.length },
        observed_count: hits,
        confidence: Math.min(0.95, 0.55 + hits * 0.05),
      });
    }
  }
  return out;
}

/**
 * Detect favorite sound + favorite timer duration + sleep-mode habit from
 * the sound_mixes table (saved mixes) and last 14 days of user_events.
 */
async function detectSoundHabits(
  admin: AdminClient,
  userId: string,
): Promise<Proposal[]> {
  const since = new Date(Date.now() - 14 * DAY).toISOString();
  const out: Proposal[] = [];

  // Saved mixes — each track they save counts as a strong preference signal.
  const { data: mixes } = await admin
    .from("sound_mixes")
    .select("tracks, is_favorite")
    .eq("user_id", userId)
    .gte("updated_at", since);

  const trackCounts = new Map<string, number>();
  for (const row of (mixes as Array<{ tracks: unknown; is_favorite: boolean }> | null) ?? []) {
    const list = Array.isArray(row.tracks) ? row.tracks : [];
    for (const t of list as Array<{ id?: string; gain?: number }>) {
      if (!t || typeof t !== "object" || !t.id) continue;
      if ((t.gain ?? 0) <= 0) continue;
      const weight = row.is_favorite ? 2 : 1;
      trackCounts.set(t.id, (trackCounts.get(t.id) ?? 0) + weight);
    }
  }

  // Also count play events if the app logs them under user_events.
  const { data: events } = await admin
    .from("user_events")
    .select("kind, title, starts_at, notes")
    .eq("user_id", userId)
    .gte("starts_at", since)
    .limit(500);

  const evRows = (events as Array<{
    kind: string;
    title: string;
    starts_at: string;
    notes: string | null;
  }> | null) ?? [];

  // Favorite track
  const trackMode = modeOf<string>(
    [...trackCounts.entries()].flatMap(([id, n]) => Array<string>(n).fill(id)),
  );
  if (trackMode && trackMode.count >= 4) {
    const label = trackMode.value.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
    out.push({
      category: "favorite_sounds",
      content: `Usually listens to ${label}`,
      dedupe_key: `sound:favorite:${trackMode.value}`,
      evidence: { track: trackMode.value, weighted_count: trackMode.count },
      observed_count: trackMode.count,
      confidence: Math.min(0.92, 0.55 + trackMode.count * 0.05),
    });
  }

  return [...out, ...detectFromEvents(evRows)];
}

function detectFromEvents(
  events: Array<{ kind: string; title: string; starts_at: string; notes: string | null }>,
): Proposal[] {
  const out: Proposal[] = [];

  // Timer durations parsed from sleep-mode / sleep-timer events.
  const timerMinutes: number[] = [];
  let sleepModeCount = 0;

  for (const e of events) {
    const title = (e.title || "").toLowerCase();
    const notes = (e.notes || "").toLowerCase();

    if (title.includes("sleep mode") || notes.includes("sleep_mode")) {
      sleepModeCount++;
    }
    const m = (title + " " + notes).match(/\b(\d{1,3})\s*(?:min|minute|m)\b/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 5 && n <= 180) timerMinutes.push(n);
    }
  }

  if (timerMinutes.length >= 4) {
    const mode = modeOf(timerMinutes);
    if (mode && mode.count >= 4) {
      out.push({
        category: "alarm_prefs",
        content: `Usually uses a ${mode.value}-minute timer`,
        dedupe_key: `alarm:timer:${mode.value}`,
        evidence: { minutes: mode.value, observations: mode.count },
        observed_count: mode.count,
        confidence: Math.min(0.9, 0.55 + mode.count * 0.05),
      });
    }
  }

  if (sleepModeCount >= 4) {
    out.push({
      category: "daily_routine",
      content: "Usually starts Sleep Mode before bed",
      dedupe_key: `routine:sleep_mode`,
      evidence: { observations: sleepModeCount },
      observed_count: sleepModeCount,
      confidence: Math.min(0.9, 0.55 + sleepModeCount * 0.05),
    });
  }

  return out;
}

/**
 * Upsert proposals, skipping anything already covered by an active memory
 * or recently declined (within 30 days).
 */
async function persistProposals(
  admin: AdminClient,
  userId: string,
  proposals: Proposal[],
): Promise<number> {
  if (proposals.length === 0) return 0;

  // Active memories that already encode the same fact (by content) — skip.
  const { data: existing } = await admin
    .from("ai_memory")
    .select("content, embedding_hash")
    .eq("user_id", userId)
    .is("superseded_by", null);
  const haveContent = new Set(
    ((existing as Array<{ content: string; embedding_hash: string | null }> | null) ?? []).map(
      (r) => r.content.toLowerCase().trim(),
    ),
  );
  const haveHash = new Set(
    ((existing as Array<{ content: string; embedding_hash: string | null }> | null) ?? [])
      .map((r) => r.embedding_hash)
      .filter((h): h is string => Boolean(h)),
  );

  // Proposals previously declined within 30d → skip.
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const { data: declined } = await admin
    .from("ai_memory_proposals")
    .select("dedupe_key")
    .eq("user_id", userId)
    .eq("status", "declined")
    .gte("decided_at", since);
  const recentlyDeclined = new Set(
    ((declined as Array<{ dedupe_key: string }> | null) ?? []).map((r) => r.dedupe_key),
  );

  let written = 0;
  for (const p of proposals) {
    if (haveContent.has(p.content.toLowerCase().trim())) continue;
    if (haveHash.has(`proposal:${p.dedupe_key}`)) continue;
    if (recentlyDeclined.has(p.dedupe_key)) continue;

    // Existing pending proposal? Bump last_seen_at + observed_count.
    const { data: pending } = await admin
      .from("ai_memory_proposals")
      .select("id, observed_count")
      .eq("user_id", userId)
      .eq("dedupe_key", p.dedupe_key)
      .eq("status", "pending")
      .maybeSingle();

    const row = pending as { id: string; observed_count: number } | null;
    if (row) {
      await admin
        .from("ai_memory_proposals")
        .update({
          last_seen_at: new Date().toISOString(),
          observed_count: Math.max(row.observed_count, p.observed_count),
          evidence: p.evidence,
          confidence: p.confidence,
          content: p.content,
        } as never)
        .eq("id", row.id);
    } else {
      await admin.from("ai_memory_proposals").insert({
        user_id: userId,
        category: p.category,
        content: p.content,
        dedupe_key: p.dedupe_key,
        evidence: p.evidence,
        observed_count: p.observed_count,
        confidence: p.confidence,
        status: "pending",
      } as never);
      written++;
    }
  }
  return written;
}

function consentKeyFor(p: Proposal): "bedtime" | "wake" | "sounds" | null {
  if (p.dedupe_key === "sleep:bedtime") return "bedtime";
  if (p.dedupe_key === "sleep:wake") return "wake";
  if (p.dedupe_key.startsWith("sound:")) return "sounds";
  if (p.dedupe_key.startsWith("alarm:")) return "sounds";
  if (p.dedupe_key === "routine:sleep_mode") return "sounds";
  return null;
}

export async function runMemoryProposer(
  admin: AdminClient,
  userId: string,
  sleepHours: number,
): Promise<number> {
  // Respect pause flag + memory consent + per-category learning consents.
  const { data: prefs } = await admin
    .from("user_prefs")
    .select("memory_enabled, memory_learning_paused, learning_consents")
    .eq("user_id", userId)
    .maybeSingle();
  const p = prefs as {
    memory_enabled: boolean | null;
    memory_learning_paused: boolean | null;
    learning_consents: Record<string, boolean> | null;
  } | null;
  if (!p?.memory_enabled || p.memory_learning_paused) return 0;
  const consents = p.learning_consents ?? {};

  const candidates = [
    ...(await detectSleepWindows(admin, userId, sleepHours)),
    ...(await detectSoundHabits(admin, userId)),
  ];
  const found = candidates.filter((c) => {
    const key = consentKeyFor(c);
    return key ? consents[key] === true : false;
  });
  return persistProposals(admin, userId, found);
}
