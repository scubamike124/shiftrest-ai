/**
 * Phase 6 — Cross-Skill Suggester.
 *
 * Combines Weather + Traffic + Calendar + Personal Intelligence + Sleep
 * Automation memories into helpful routine suggestions.
 *
 * Strict rules:
 *  - Only runs when memory_enabled = true and learning is not paused.
 *  - Each detection requires the matching per-category consent
 *    (learning_consents[*]) before it may be proposed.
 *  - Every suggestion ships with a plain-English `reason`.
 *  - Nothing is auto-applied; users accept or dismiss in /memory.
 *  - No medical content. No private data is invented.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type AdminClient = SupabaseClient<any, any, any>;

type Step =
  | { type: "quiet_mode_on" }
  | { type: "quiet_mode_off" }
  | { type: "play_sound"; track: string }
  | { type: "stop_sound" }
  | { type: "set_alarm"; time: string }
  | { type: "set_timer"; minutes: number }
  | { type: "start_sleep_mode" }
  | { type: "departure_reminder"; minutes_before: number }
  | { type: "note"; text: string };

type Suggestion = {
  kind: string;
  title: string;
  reason: string;
  signals: Record<string, unknown>;
  proposed_steps: Step[];
  dedupe_key: string;
};

function parseClock(text: string): { mins: number; label: string } | null {
  const m = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = (m[3] || "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return { mins: h * 60 + min, label: m[0] };
}

function minsToHHMM(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Consents = Record<string, boolean>;

async function detectBedtimeRoutine(
  admin: AdminClient,
  userId: string,
  consents: Consents,
): Promise<Suggestion | null> {
  if (!consents.bedtime) return null;

  const { data: mems } = await admin
    .from("ai_memory")
    .select("content, category")
    .eq("user_id", userId)
    .is("superseded_by", null)
    .in("category", ["sleep_habits", "favorite_sounds"]);

  const rows = (mems as Array<{ content: string; category: string }> | null) ?? [];
  const bedRow = rows.find(
    (r) => r.category === "sleep_habits" && /bed/i.test(r.content),
  );
  if (!bedRow) return null;
  const bedClock = parseClock(bedRow.content);
  if (!bedClock) return null;

  const steps: Step[] = [];
  const reasons: string[] = [`You usually go to bed around ${bedClock.label}.`];

  if (consents.quiet_mode) {
    steps.push({ type: "quiet_mode_on" });
    reasons.push("Quiet Mode keeps notifications from waking you.");
  }

  if (consents.sounds) {
    const fav = rows.find((r) => r.category === "favorite_sounds");
    if (fav) {
      const w = fav.content.match(/listens to ([\w ]+?)(?:$|\.)/i);
      const track = w ? w[1].trim().toLowerCase().replace(/\s+/g, "_") : "rain";
      steps.push({ type: "play_sound", track });
      steps.push({ type: "set_timer", minutes: 45 });
      reasons.push(`I'll start your usual ${w ? w[1] : "sleep"} mix and stop it after 45 minutes.`);
    }
  }

  // If calendar feeds exist and there's an early-morning item tomorrow, mention it.
  if (consents.calendar) {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const dayStart = new Date(tomorrow.toDateString()).toISOString();
    const dayEnd = new Date(new Date(tomorrow.toDateString()).getTime() + 86_400_000).toISOString();
    const { data: early } = await admin
      .from("personal_items")
      .select("title, due_at")
      .eq("user_id", userId)
      .gte("due_at", dayStart)
      .lt("due_at", dayEnd)
      .limit(5);
    const items = (early as Array<{ title: string; due_at: string }> | null) ?? [];
    const earliest = items
      .map((i) => ({ ...i, t: new Date(i.due_at).getHours() * 60 + new Date(i.due_at).getMinutes() }))
      .sort((a, b) => a.t - b.t)[0];
    if (earliest && earliest.t < 9 * 60) {
      reasons.push(`Tomorrow has an early item: ${earliest.title}.`);
    }
  }

  if (steps.length === 0) return null;

  return {
    kind: "bedtime",
    title: `Bedtime routine at ${bedClock.label}`,
    reason: reasons.join(" "),
    signals: { bedtime_mins: bedClock.mins },
    proposed_steps: steps,
    dedupe_key: `routine:bedtime:${bedClock.mins}`,
  };
}

async function detectDepartureRoutine(
  admin: AdminClient,
  userId: string,
  consents: Consents,
): Promise<Suggestion | null> {
  if (!consents.traffic) return null;

  const { data: dests } = await admin
    .from("traffic_destinations")
    .select("label, baseline_minutes")
    .eq("user_id", userId)
    .limit(3);
  const rows = (dests as Array<{ label: string; baseline_minutes: number | null }> | null) ?? [];
  if (rows.length === 0) return null;
  const top = rows[0];

  const steps: Step[] = [
    { type: "departure_reminder", minutes_before: Math.max(10, (top.baseline_minutes ?? 20) + 5) },
  ];

  const reasons = [
    `You drive to ${top.label} regularly (~${top.baseline_minutes ?? "unknown"} min baseline).`,
    "I'll nudge you a few minutes before you usually need to leave.",
  ];

  return {
    kind: "departure",
    title: `Leave-on-time reminder for ${top.label}`,
    reason: reasons.join(" "),
    signals: { destination: top.label, baseline: top.baseline_minutes },
    proposed_steps: steps,
    dedupe_key: `routine:departure:${top.label.toLowerCase()}`,
  };
}

async function detectQuietHoursRoutine(
  admin: AdminClient,
  userId: string,
  consents: Consents,
): Promise<Suggestion | null> {
  if (!consents.quiet_mode || !consents.bedtime) return null;

  const { data: prefs } = await admin
    .from("user_prefs")
    .select("wind_down_min")
    .eq("user_id", userId)
    .maybeSingle();
  const wd = (prefs as { wind_down_min?: number } | null)?.wind_down_min ?? 120;

  const { data: bed } = await admin
    .from("ai_memory")
    .select("content")
    .eq("user_id", userId)
    .eq("category", "sleep_habits")
    .is("superseded_by", null)
    .ilike("content", "%bed%")
    .maybeSingle();
  const bedRow = bed as { content: string } | null;
  if (!bedRow) return null;
  const clk = parseClock(bedRow.content);
  if (!clk) return null;
  const startMins = (clk.mins - Math.min(wd, 60) + 1440) % 1440;

  return {
    kind: "quiet_mode",
    title: `Quiet Mode at ${minsToHHMM(startMins)}`,
    reason: `You usually go to bed around ${clk.label}. Turning on Quiet Mode an hour before keeps notifications from interrupting wind-down.`,
    signals: { bedtime_mins: clk.mins, start_mins: startMins },
    proposed_steps: [{ type: "quiet_mode_on" }],
    dedupe_key: `routine:quiet:${startMins}`,
  };
}

async function persistSuggestions(
  admin: AdminClient,
  userId: string,
  suggestions: Suggestion[],
): Promise<number> {
  if (suggestions.length === 0) return 0;
  // Skip ones the user already dismissed or accepted.
  const { data: existing } = await admin
    .from("routine_suggestions")
    .select("dedupe_key, status")
    .eq("user_id", userId);
  const seen = new Map<string, string>();
  for (const r of (existing as Array<{ dedupe_key: string; status: string }> | null) ?? []) {
    seen.set(r.dedupe_key, r.status);
  }

  let written = 0;
  const nowIso = new Date().toISOString();
  for (const s of suggestions) {
    const status = seen.get(s.dedupe_key);
    if (status === "accepted" || status === "dismissed") continue;
    if (status === "pending" || status === "snoozed") {
      await admin
        .from("routine_suggestions")
        .update({
          last_seen_at: nowIso,
          reason: s.reason,
          title: s.title,
          signals: s.signals,
          proposed_steps: s.proposed_steps,
        } as never)
        .eq("user_id", userId)
        .eq("dedupe_key", s.dedupe_key);
      continue;
    }
    const { error } = await admin.from("routine_suggestions").insert({
      user_id: userId,
      kind: s.kind,
      title: s.title,
      reason: s.reason,
      signals: s.signals,
      proposed_steps: s.proposed_steps,
      dedupe_key: s.dedupe_key,
      status: "pending",
    } as never);
    if (!error) written++;
  }
  return written;
}

export async function runCrossSkillSuggester(
  admin: AdminClient,
  userId: string,
): Promise<number> {
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
  const consents: Consents = { ...(p.learning_consents ?? {}) };
  if (!Object.values(consents).some(Boolean)) return 0;

  const found: Suggestion[] = [];
  const bedtime = await detectBedtimeRoutine(admin, userId, consents);
  if (bedtime) found.push(bedtime);
  const departure = await detectDepartureRoutine(admin, userId, consents);
  if (departure) found.push(departure);
  const quiet = await detectQuietHoursRoutine(admin, userId, consents);
  if (quiet) found.push(quiet);

  return persistSuggestions(admin, userId, found);
}
