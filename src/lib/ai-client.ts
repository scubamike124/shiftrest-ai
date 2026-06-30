// Typed client for the /api/ai orchestrator (non-streaming intents).
// The streaming "coach" intent is consumed directly by routes/coach.tsx
// because it needs SSE handling; everything else lives here.

import { supabase } from "@/integrations/supabase/client";
import type { Recommendation } from "@/lib/recommendations";
import { lsGet, lsSet } from "@/lib/offline/cache";

async function authHeaders(): Promise<{ headers: HeadersInit; userId: string | null }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    userId: data.session?.user.id ?? null,
  };
}

/**
 * Stable cache key for an AI response. We hash only the *intent-defining*
 * fields (intent name + any ID-like inputs) — never the free-form `context`
 * string, which would explode the cache and never hit. This means two
 * "right_now" requests from the same user collapse onto one cached
 * recommendation, which is exactly what we want for the offline replay.
 */
function aiCacheScope(payload: Record<string, unknown>): string {
  const intent = String(payload.intent ?? "unknown");
  const keyFields: Record<string, unknown> = {};
  for (const k of ["patternKey", "horizon", "phase", "tripId", "targetWakeIso", "windowMin"]) {
    if (payload[k] !== undefined) keyFields[k] = payload[k];
  }
  const tail = Object.keys(keyFields).length ? `:${JSON.stringify(keyFields)}` : "";
  return `ai:${intent}${tail}`;
}

class OfflineAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflineAiError";
  }
}

function localTimePayload(): { localTime?: string; timezone?: string } {
  if (typeof window === "undefined") return {};
  try {
    return {
      localTime: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  } catch {
    return { localTime: new Date().toISOString() };
  }
}

async function postIntent<T>(payload: Record<string, unknown>): Promise<T> {
  const { headers, userId } = await authHeaders();
  const scope = aiCacheScope(payload);

  // Hard offline → skip the doomed fetch and replay the last good answer.
  // Coach voice contract still holds because the cached JSON was produced
  // by the same model/system prompt; the wrapper just adds a "cached" pill.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const cached = lsGet<T>(scope, userId);
    if (cached) return cached.value;
    throw new OfflineAiError("You're offline and I don't have a cached version of this yet.");
  }

  try {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...localTimePayload(), ...payload }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `AI request failed (${res.status})`);
    }
    const json = (await res.json()) as T;
    // Persist on success so the next offline open has something to show.
    lsSet(scope, userId, json);
    return json;
  } catch (e) {
    // Network errors (DNS failure, fetch aborted by offline) — try cache.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const cached = lsGet<T>(scope, userId);
      if (cached) return cached.value;
      throw new OfflineAiError("You're offline and I don't have a cached version of this yet.");
    }
    throw e;
  }
}

export { OfflineAiError };


export type DailyPlanResponse = {
  headline: string;
  riskLevel: "low" | "medium" | "high";
  actions: Recommendation[];
};

export function aiDailyPlan(input: { horizon?: "24h" | "72h"; context?: string } = {}) {
  return postIntent<DailyPlanResponse>({
    intent: "daily_plan",
    horizon: input.horizon ?? "24h",
    context: input.context,
  });
}

export type SmartAlarmResponse = {
  wakeAt: string; // ISO
  reason: string;
  cyclePosition?: "rem_end" | "light_sleep" | "deep_avoid" | "natural";
  confidence?: "low" | "medium" | "high";
  confidenceReason?: string;
  message: string;
  recommendationId?: string | null;
};

export function aiSmartAlarm(input: {
  targetWakeIso: string;
  windowMin: number;
  context?: string;
}) {
  return postIntent<SmartAlarmResponse>({ intent: "smart_alarm", ...input });
}

export type RightNowResponse = {
  action: string;
  why: string;
  followBenefit?: string;
  ignoreCost: string;
  confidence?: "low" | "medium" | "high";
  confidenceReason?: string;
  urgency: "now" | "soon" | "later";
  timeWindow?: { startIso: string; endIso: string };
  ctaLabel: string;
  ctaRoute: "/plan" | "/events" | "/coach" | "/dashboard";
  recommendationId?: string | null;
};

export function aiRightNow(input: { context?: string } = {}) {
  return postIntent<RightNowResponse>({ intent: "right_now", context: input.context });
}

export type AdjustPlanResponse = {
  summary: string;
  confidence?: "low" | "medium" | "high";
  ifIgnored?: string;
  changes: { label: string; from: string; to: string; reason: string }[];
  recommendationId?: string | null;
};

export function aiAdjustPlan(input: { observation: string; context?: string }) {
  return postIntent<AdjustPlanResponse>({ intent: "adjust_plan", ...input });
}

export type CommuteResponse = {
  leaveAt: string;
  prepStartAt: string;
  advice: string;
  recommendationId?: string | null;
};

export function aiCommute(input: {
  shiftStartIso: string;
  travelMin: number;
  prepMin?: number;
  context?: string;
}) {
  return postIntent<CommuteResponse>({ intent: "commute", ...input });
}

export type CoachTipResponse = { tip: string; generatedAt: string; recommendationId?: string | null };

export function aiCoachTip(input: { context?: string } = {}) {
  return postIntent<CoachTipResponse>({ intent: "coach_tip", context: input.context });
}

// --- Step 3: Predictive intents ---

export type TomorrowPreviewBlock = {
  kind: "sleep" | "alarm" | "light" | "caffeine" | "commute" | "winddown" | "recovery";
  title: string;
  when: string;
  detail: string;
};
export type TomorrowPreviewResponse = {
  headline: string;
  summary: string;
  confidence?: "low" | "medium" | "high";
  blocks: TomorrowPreviewBlock[];
  recommendationId?: string | null;
};
export function aiTomorrowPreview(input: { context?: string } = {}) {
  return postIntent<TomorrowPreviewResponse>({ intent: "tomorrow_preview", context: input.context });
}

export type DailyReviewResponse = {
  headline: string;
  wins: string[];
  drains: string[];
  metrics: {
    sleepRecoveredMin: number | null;
    readinessDelta: number | null;
    recoveryTrend: "up" | "flat" | "down" | "unknown";
  };
  tomorrowFocus: string;
  recommendationId?: string | null;
};
export function aiDailyReview(input: { context?: string } = {}) {
  return postIntent<DailyReviewResponse>({ intent: "daily_review", context: input.context });
}

export type PatternAlertResponse = {
  headline: string;
  why: string;
  action: string;
  confidence: "low" | "medium" | "high";
  recommendationId?: string | null;
};
export function aiPatternAlert(input: {
  patternKey: string;
  severity: number;
  signals: Record<string, unknown>;
  context?: string;
}) {
  return postIntent<PatternAlertResponse>({ intent: "pattern_alert", ...input });
}

