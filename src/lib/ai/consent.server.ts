// Server-side enforcement of the AI data-sharing permission (Guideline 5.1.2(i)).
//
// Every route or server function that sends user data to a third-party AI
// provider calls requireAIConsent / assertAIConsent after authenticating the
// user and BEFORE building a prompt or calling the provider. Without a current
// grant in user_prefs.consent_json the request is refused and nothing leaves
// the server.
//
// Fails closed: if the permission can't be read (database error, missing
// config) the request is refused with 503 rather than sent.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AI_CONSENT_HEADER,
  AI_CONSENT_REQUIRED_CODE,
  AI_CONSENT_REQUIRED_MESSAGE,
  AI_CONSENT_UNAVAILABLE_MESSAGE,
  aiConsentRefusalBody,
  hasAIConsent,
} from "./consent";

export type AIConsentCheck = "granted" | "missing" | "unavailable";

// Minimal shape we need, so callers can pass any Supabase client.
type ConsentReader = Pick<SupabaseClient, "from">;

let cached: SupabaseClient | null = null;
function serviceClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Reads the user's AI permission. `client` defaults to the service-role client. */
export async function checkAIConsent(
  userId: string,
  client?: ConsentReader | null,
): Promise<AIConsentCheck> {
  if (!userId) return "missing";
  const supa = client ?? serviceClient();
  if (!supa) return "unavailable";
  try {
    const { data, error } = await supa
      .from("user_prefs")
      .select("consent_json")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[ai-consent] read failed", error.message);
      return "unavailable";
    }
    const consent = (data as { consent_json?: unknown } | null)?.consent_json;
    return hasAIConsent(consent) ? "granted" : "missing";
  } catch (e) {
    console.error("[ai-consent] read threw", e instanceof Error ? e.message : String(e));
    return "unavailable";
  }
}

/** For HTTP routes: null when allowed, otherwise the Response to return. */
export async function requireAIConsent(
  userId: string,
  client?: ConsentReader | null,
): Promise<Response | null> {
  const result = await checkAIConsent(userId, client);
  if (result === "granted") return null;
  if (result === "missing") {
    return new Response(JSON.stringify(aiConsentRefusalBody()), {
      status: 403,
      headers: { "Content-Type": "application/json", [AI_CONSENT_HEADER]: "required" },
    });
  }
  return new Response(
    JSON.stringify({ error: AI_CONSENT_UNAVAILABLE_MESSAGE, code: "ai_consent_unavailable" }),
    {
      status: 503,
      headers: { "Content-Type": "application/json", [AI_CONSENT_HEADER]: "unavailable" },
    },
  );
}

/** For server functions: throws when not allowed. The message starts with the
 *  refusal code so the client can recognise it (same pattern as
 *  `trial_limit_reached:`). */
export async function assertAIConsent(
  userId: string,
  client?: ConsentReader | null,
): Promise<void> {
  const result = await checkAIConsent(userId, client);
  if (result === "granted") return;
  if (result === "missing") {
    throw new Error(`${AI_CONSENT_REQUIRED_CODE}: ${AI_CONSENT_REQUIRED_MESSAGE}`);
  }
  throw new Error(`ai_consent_unavailable: ${AI_CONSENT_UNAVAILABLE_MESSAGE}`);
}
