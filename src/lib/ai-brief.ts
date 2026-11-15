// /api/insights returns whatever JSON the model produced. Normalise it before
// it reaches the dashboard card so a reply with missing or mistyped fields
// shows what it has (or a calm "unavailable" message) instead of throwing
// during render.

export type AIBrief = {
  greeting: string;
  headline: string;
  fatigue_note: string;
  top_actions: { icon: string; title: string; detail: string }[];
  coach_note: string;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Returns a safe brief, or null when the reply has nothing worth showing. */
export function normalizeBrief(raw: unknown): AIBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const actions = (Array.isArray(r.top_actions) ? r.top_actions : [])
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({ icon: str(a.icon), title: str(a.title), detail: str(a.detail) }))
    .filter((a) => a.title || a.detail);
  const brief: AIBrief = {
    greeting: str(r.greeting),
    headline: str(r.headline),
    fatigue_note: str(r.fatigue_note),
    top_actions: actions,
    coach_note: str(r.coach_note),
  };
  if (!brief.headline && !brief.fatigue_note && brief.top_actions.length === 0) return null;
  return brief;
}
