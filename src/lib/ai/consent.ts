// Explicit permission to share personal data with third-party AI providers
// (App Store Review Guideline 5.1.2(i)).
//
// Shared by the server gate (consent.server.ts), the server functions that
// grant and revoke it (consent.functions.ts) and the client (consent-client.ts).
// Nothing in this file touches the network or the database.
//
// Storage: `user_prefs.consent_json`, the per-user consent map that already
// holds the signup and onboarding acknowledgements. A grant writes
//   { ai_data_sharing: AI_CONSENT_VERSION, ai_data_sharing_at: <iso>, ai_data_sharing_revoked_at: null }
// and a revoke writes
//   { ai_data_sharing: null, ai_data_sharing_revoked_at: <iso> }
// Each change is also appended to `legal_acceptances` as an audit record.
//
// Bump AI_CONSENT_VERSION when the providers or the data sent change in a way
// users must agree to again: every earlier grant then stops counting and the
// app asks again.

export const AI_CONSENT_KEY = "ai_data_sharing";
export const AI_CONSENT_VERSION = "2026-11-15";
export const AI_CONSENT_DOCUMENT_SLUG = "ai-data-sharing";
export const AI_CONSENT_WITHDRAWN_SLUG = "ai-data-sharing-withdrawn";

/** Machine-readable refusal code. Returned as `code` in the JSON body. */
export const AI_CONSENT_REQUIRED_CODE = "ai_consent_required";
/** Response header set on every consent refusal, so the client can spot one without reading the body. */
export const AI_CONSENT_HEADER = "x-restpilot-ai-consent";

export const AI_CONSENT_REQUIRED_MESSAGE =
  "AI features are off until you allow RestPilot to share your data with its AI providers. You can turn them on in Profile → Privacy.";

export const AI_CONSENT_UNAVAILABLE_MESSAGE =
  "We couldn't confirm your AI permission just now. Please try again in a moment.";

export type AIConsentProvider = {
  name: string;
  what: string;
  why: string;
};

/** What the consent screen and Profile → Privacy tell the user. Keep in sync
 *  with /legal/privacy ("AI providers") and /legal/third-parties. */
export const AI_CONSENT_PROVIDERS: AIConsentProvider[] = [
  {
    name: "Google Gemini, through the Lovable AI Gateway",
    what: "Your coach messages, plus the schedule, sleep, preference and profile context RestPilot adds to them, and summaries from a wearable you connect (Fitbit or Oura).",
    why: "To write coach replies, briefings, plans, insights and shift-swap advice.",
  },
  {
    name: "OpenAI, directly and through the Lovable AI Gateway",
    what: "Your voice recordings, the text read aloud to you, your preferred name and voice settings.",
    why: "To turn speech into text, read replies and briefings aloud, and run live voice conversations.",
  },
  {
    name: "ElevenLabs",
    what: "The text of companion replies being read aloud.",
    why: "To read companion replies aloud in a natural voice.",
  },
];

type ConsentMap = Record<string, unknown>;

function asMap(consentJson: unknown): ConsentMap | null {
  if (!consentJson || typeof consentJson !== "object" || Array.isArray(consentJson)) return null;
  return consentJson as ConsentMap;
}

/** True only when the stored map holds a grant for the current version. */
export function hasAIConsent(consentJson: unknown): boolean {
  const map = asMap(consentJson);
  return map !== null && map[AI_CONSENT_KEY] === AI_CONSENT_VERSION;
}

/** When the user last allowed AI sharing, if the grant is current. */
export function aiConsentGrantedAt(consentJson: unknown): string | null {
  const map = asMap(consentJson);
  if (!map || !hasAIConsent(map)) return null;
  const at = map[`${AI_CONSENT_KEY}_at`];
  return typeof at === "string" ? at : null;
}

export function aiConsentGrantPatch(nowIso: string): Record<string, string | null> {
  return {
    [AI_CONSENT_KEY]: AI_CONSENT_VERSION,
    [`${AI_CONSENT_KEY}_at`]: nowIso,
    [`${AI_CONSENT_KEY}_revoked_at`]: null,
  };
}

export function aiConsentRevokePatch(nowIso: string): Record<string, string | null> {
  return {
    [AI_CONSENT_KEY]: null,
    [`${AI_CONSENT_KEY}_revoked_at`]: nowIso,
  };
}

/** The JSON body of every consent refusal (server and client-side). */
export function aiConsentRefusalBody(): { error: string; code: string } {
  return { error: AI_CONSENT_REQUIRED_MESSAGE, code: AI_CONSENT_REQUIRED_CODE };
}
