// Read, grant and revoke the AI data-sharing permission for the signed-in user.
// Runs with the caller's own Supabase session (RLS): a user can only read or
// change their own permission.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  AI_CONSENT_DOCUMENT_SLUG,
  AI_CONSENT_PROVIDERS,
  AI_CONSENT_VERSION,
  AI_CONSENT_WITHDRAWN_SLUG,
  aiConsentGrantPatch,
  aiConsentGrantedAt,
  aiConsentRevokePatch,
  hasAIConsent,
} from "./consent";

export type AIConsentStatus = {
  granted: boolean;
  grantedAt: string | null;
  version: string;
};

type Ctx = {
  userId: string;
  // The middleware's typed client; only the calls below are used.
  supabase: {
    from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
};

async function readConsentJson(ctx: Ctx): Promise<Record<string, unknown>> {
  const { data, error } = await ctx.supabase
    .from("user_prefs")
    .select("consent_json")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error("Couldn't read your privacy settings. Please try again.");
  const raw = (data as { consent_json?: unknown } | null)?.consent_json;
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

async function writeConsentJson(
  ctx: Ctx,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const merged = { ...(await readConsentJson(ctx)), ...patch };
  const { error } = await ctx.supabase
    .from("user_prefs")
    .upsert({ user_id: ctx.userId, consent_json: merged }, { onConflict: "user_id" });
  if (error) throw new Error("Couldn't save your privacy settings. Please try again.");
  return merged;
}

// Append-only audit record. Best effort: a failed audit insert never blocks a
// grant or (especially) a revoke.
async function audit(ctx: Ctx, slug: string, source: string): Promise<void> {
  try {
    const req = getRequest();
    const { error } = await ctx.supabase.from("legal_acceptances").insert({
      user_id: ctx.userId,
      document_slug: slug,
      document_version: AI_CONSENT_VERSION,
      source,
      user_agent: req?.headers.get("user-agent") ?? null,
      snapshot_json: {
        version: AI_CONSENT_VERSION,
        providers: AI_CONSENT_PROVIDERS.map((p) => p.name),
      },
    });
    if (error) console.error("[ai-consent] audit insert failed", error.message);
  } catch (e) {
    console.error("[ai-consent] audit insert threw", e instanceof Error ? e.message : String(e));
  }
}

function toStatus(consent: Record<string, unknown>): AIConsentStatus {
  return {
    granted: hasAIConsent(consent),
    grantedAt: aiConsentGrantedAt(consent),
    version: AI_CONSENT_VERSION,
  };
}

export const getAIConsentFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AIConsentStatus> => {
    return toStatus(await readConsentJson(context as unknown as Ctx));
  });

export type SetAIConsentInput = { allow: boolean; source?: "dialog" | "settings" };

export const setAIConsentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: SetAIConsentInput) => ({
    allow: d?.allow === true,
    source: d?.source === "settings" ? "settings" : "dialog",
  }))
  .handler(async ({ data, context }): Promise<AIConsentStatus> => {
    const ctx = context as unknown as Ctx;
    const now = new Date().toISOString();
    const source = `ai_consent_${data.source}`;
    if (data.allow) {
      const merged = await writeConsentJson(ctx, aiConsentGrantPatch(now));
      await audit(ctx, AI_CONSENT_DOCUMENT_SLUG, source);
      return toStatus(merged);
    }
    const merged = await writeConsentJson(ctx, aiConsentRevokePatch(now));
    await audit(ctx, AI_CONSENT_WITHDRAWN_SLUG, source);
    return toStatus(merged);
  });
