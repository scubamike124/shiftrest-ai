/**
 * Validation for model JSON before it reaches the UI.
 *
 * A model can return valid JSON with missing fields, wrong types or enum
 * values the cards don't know (urgency "critical"). Passing that through
 * crashed whole screens. Each schema coerces what it can, substitutes safe
 * defaults for the rest, drops malformed list items and unknown keys, and
 * reports `ok: false` only when the card's primary text is missing, so the
 * route can answer 502 and the card shows its normal error state.
 */
import { z } from "zod";

const text = (fallback = "") =>
  z.preprocess((v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : v), z.string().trim()).catch(fallback);

const optText = () =>
  z.preprocess((v) => (typeof v === "number" ? String(v) : v), z.string().trim().min(1).optional()).catch(undefined);

function oneOf<const T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) {
  return z
    .preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(values))
    .catch(fallback);
}

const optOneOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() : v), z.enum(values).optional()).catch(undefined);

const confidence = optOneOf(["low", "medium", "high"] as const);

/** Objects only, capped; anything else in the list is dropped. */
function listOf<S extends z.ZodTypeAny>(item: S, max: number) {
  return z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => x !== null && typeof x === "object" && !Array.isArray(x)).slice(0, max) : []),
    z.array(item),
  );
}

const textList = (max: number) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x: string) => x.trim()).slice(0, max) : []),
    z.array(z.string()),
  );

const isoOr = (fallback: () => string) =>
  z.preprocess((v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : fallback()), z.string());

const optIso = z.preprocess((v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined), z.string().optional());

const numOrNull = z.preprocess((v) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}, z.number().nullable());

const impact = z
  .object({ today: text(), tomorrow: text(), week: text() })
  .optional()
  .catch(undefined);

export type IntentFallbacks = { nowIso: string; targetWakeIso?: string; phase?: "pre" | "arrival" | "post" };

function intentSchemas(fb: IntentFallbacks) {
  const now = () => fb.nowIso;
  return {
    daily_plan: z.object({
      headline: text(),
      riskLevel: oneOf(["low", "medium", "high"] as const, "medium"),
      actions: listOf(
        z.object({
          id: text(),
          title: text(),
          detail: text(),
          category: oneOf(["sleep", "light", "caffeine", "movement", "recovery", "nutrition"] as const, "recovery"),
          priority: z.preprocess((v) => Math.min(3, Math.max(1, Math.round(Number(v) || 2))), z.number()),
          when: text(),
        }),
        5,
      ),
      impact,
    }),
    smart_alarm: z.object({
      wakeAt: isoOr(() => fb.targetWakeIso ?? fb.nowIso),
      reason: text(),
      cyclePosition: oneOf(["rem_end", "light_sleep", "deep_avoid", "natural"] as const, "natural"),
      confidence,
      confidenceReason: optText(),
      message: text("Good morning."),
      impact,
    }),
    commute: z.object({ leaveAt: isoOr(now), prepStartAt: isoOr(now), advice: text(), impact }),
    coach_tip: z.object({ tip: text(), generatedAt: isoOr(now), impact }),
    right_now: z.object({
      action: text(),
      why: text(),
      followBenefit: optText(),
      ignoreCost: text(),
      confidence,
      confidenceReason: optText(),
      urgency: oneOf(["now", "soon", "later"] as const, "soon"),
      timeWindow: z.object({ startIso: optIso, endIso: optIso }).optional().catch(undefined),
      ctaLabel: text("See full plan"),
      ctaRoute: oneOf(["/plan", "/events", "/coach", "/dashboard"] as const, "/dashboard"),
      impact,
    }),
    adjust_plan: z.object({
      summary: text(),
      confidence,
      ifIgnored: optText(),
      changes: listOf(z.object({ label: text(), from: text(), to: text(), reason: text() }), 5),
      impact,
    }),
    tomorrow_preview: z.object({
      headline: text(),
      summary: text(),
      confidence,
      blocks: listOf(
        z.object({
          kind: oneOf(["sleep", "alarm", "light", "caffeine", "commute", "winddown", "recovery"] as const, "recovery"),
          title: text(),
          when: text(),
          detail: text(),
        }),
        8,
      ),
      impact,
    }),
    daily_review: z.object({
      headline: text(),
      wins: textList(3),
      drains: textList(3),
      metrics: z
        .object({ sleepRecoveredMin: numOrNull, recoveryTrend: oneOf(["up", "flat", "down", "unknown"] as const, "unknown") })
        .catch({ sleepRecoveredMin: null, recoveryTrend: "unknown" }),
      tomorrowFocus: text(),
      impact,
    }),
    pattern_alert: z.object({ headline: text(), why: text(), action: text(), confidence: oneOf(["low", "medium", "high"] as const, "low"), impact }),
    jetlag_plan: z.object({
      headline: text(),
      summary: text(),
      phase: oneOf(["pre", "arrival", "post"] as const, fb.phase ?? "pre"),
      directionEast: z.preprocess((v) => v === true || v === "true", z.boolean()),
      clockBasis: oneOf(["destination_local", "home", "mixed"] as const, "mixed"),
      confidence,
      blocks: listOf(
        z.object({
          day: text(),
          kind: oneOf(["light", "sleep", "caffeine", "meal", "melatonin", "movement", "hydration"] as const, "sleep"),
          title: text(),
          when: text(),
          detail: text(),
        }),
        8,
      ),
      ifIgnored: optText(),
      impact,
    }),
  } as const;
}

/** The field a card cannot render without. */
const PRIMARY: Record<string, string> = {
  daily_plan: "headline",
  smart_alarm: "wakeAt",
  commute: "leaveAt",
  coach_tip: "tip",
  right_now: "action",
  adjust_plan: "summary",
  tomorrow_preview: "headline",
  daily_review: "headline",
  pattern_alert: "headline",
  jetlag_plan: "headline",
};

export type Normalized = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };

export function normalizeIntentOutput(intent: string, raw: unknown, fb: IntentFallbacks): Normalized {
  const schemas = intentSchemas(fb) as Record<string, z.ZodTypeAny>;
  const schema = schemas[intent];
  if (!schema) return { ok: false, reason: `no schema for ${intent}` };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, reason: "invalid shape" };
  const value = result.data as Record<string, unknown>;
  const key = PRIMARY[intent];
  if (key && !(typeof value[key] === "string" && (value[key] as string).length > 0)) return { ok: false, reason: `missing ${key}` };
  return { ok: true, value };
}

const insightsSchema = z.object({
  greeting: text(),
  headline: text(),
  fatigue_note: text(),
  top_actions: listOf(z.object({ icon: text("sun"), title: text(), detail: text() }), 3),
  coach_note: text(),
});

export function normalizeInsights(raw: unknown): Normalized {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
  const r = insightsSchema.safeParse(raw);
  if (!r.success || !r.data.headline) return { ok: false, reason: "missing headline" };
  return { ok: true, value: r.data };
}

const VERDICT_LABEL = { take_it: "Take it", take_with_caveats: "Take it — with caveats", skip_it: "Skip it" } as const;
const swapSchema = z.object({
  verdict: oneOf(["take_it", "take_with_caveats", "skip_it"] as const, "take_with_caveats"),
  verdict_label: optText(),
  cost: oneOf(["low", "medium", "high"] as const, "medium"),
  cost_reason: text(),
  risks: textList(3),
  naps: listOf(
    z.object({
      time: z.preprocess((v) => (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v.trim()) ? v.trim().padStart(5, "0") : ""), z.string()),
      duration_min: z.preprocess((v) => Math.min(120, Math.max(5, Math.round(Number(v) || 20))), z.number()),
      why: text(),
    }),
    2,
  ),
  summary: text(),
});

export function normalizeSwap(raw: unknown): Normalized {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not an object" };
  const r = swapSchema.safeParse(raw);
  if (!r.success || !r.data.summary) return { ok: false, reason: "missing summary" };
  const value = { ...r.data, verdict_label: r.data.verdict_label ?? VERDICT_LABEL[r.data.verdict], naps: r.data.naps.filter((n) => n.time) };
  return { ok: true, value };
}
