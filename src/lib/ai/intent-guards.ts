/** Small deterministic guards around /api/ai model input and output. */

/**
 * Some surfaces (the companion page) send `context` as an object. It used to be
 * interpolated as "[object Object]"; serialize it instead, dropping transport-only
 * fields, and bound its size.
 */
export function normalizeLiveContext(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw || undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const { max_tokens: _maxTokens, ...rest } = raw as Record<string, unknown>;
  if (Object.keys(rest).length === 0) return undefined;
  try {
    return JSON.stringify(rest).slice(0, 4000);
  } catch {
    return undefined;
  }
}

/** Commute times are plain arithmetic: never trust the model to subtract. */
export function commuteTimes(shiftStartIso: string, travelMin: number, prepMin?: number): { leaveAt: string; prepStartAt: string } | null {
  const start = Date.parse(shiftStartIso);
  const prep = prepMin ?? 25;
  if (!Number.isFinite(start) || !Number.isFinite(travelMin) || travelMin < 0 || !Number.isFinite(prep) || prep < 0) return null;
  const leave = start - travelMin * 60_000;
  return { leaveAt: new Date(leave).toISOString(), prepStartAt: new Date(leave - prep * 60_000).toISOString() };
}
