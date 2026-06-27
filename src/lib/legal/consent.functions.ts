import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getWebRequest } from "@tanstack/react-start/server";
import { LEGAL_DOCS, LEGAL_EFFECTIVE } from "./meta";

export type ConsentSource =
  | "signup"
  | "onboarding"
  | "wearable_connect"
  | "push_enable"
  | "cookie_banner"
  | "paywall"
  | "settings";

export type RecordAcceptanceInput = {
  documents: string[]; // legal doc slugs (or symbolic keys like "cookies", "wearables", "push")
  source: ConsentSource;
  /** Optional explicit flag merge (e.g. cookie categories). */
  flags?: Record<string, unknown>;
};

function clientIp(req: Request): string | null {
  const h = req.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || null;
  return h.get("cf-connecting-ip") || h.get("x-real-ip") || null;
}

/** Append-only acceptance log + latest flags merged into user_prefs.consent_json. */
export const recordAcceptanceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: RecordAcceptanceInput) => d)
  .handler(async ({ data, context }) => {
    const req = getWebRequest();
    const ip = req ? clientIp(req) : null;
    const ua = req?.headers.get("user-agent") ?? null;

    const snapshot = {
      effective: LEGAL_EFFECTIVE,
      docs: LEGAL_DOCS.map((d) => ({ slug: d.slug, title: d.title, version: d.effective })),
    };

    const rows = data.documents.map((slug) => ({
      user_id: context.userId,
      document_slug: slug,
      document_version: LEGAL_EFFECTIVE,
      source: data.source,
      ip,
      user_agent: ua,
      snapshot_json: snapshot,
    }));

    if (rows.length) {
      const { error } = await context.supabase.from("legal_acceptances").insert(rows);
      if (error) {
        console.error("recordAcceptance failed", error);
        throw new Error(error.message);
      }
    }

    // Merge consent flags into user_prefs.consent_json
    const flagPatch: Record<string, unknown> = { ...(data.flags ?? {}) };
    for (const slug of data.documents) flagPatch[slug] = LEGAL_EFFECTIVE;
    flagPatch.last_source = data.source;
    flagPatch.last_at = new Date().toISOString();

    const { data: existing } = await context.supabase
      .from("user_prefs")
      .select("consent_json")
      .eq("user_id", context.userId)
      .maybeSingle();

    const merged = { ...((existing?.consent_json as Record<string, unknown>) ?? {}), ...flagPatch };

    const { error: upErr } = await context.supabase
      .from("user_prefs")
      .upsert({ user_id: context.userId, consent_json: merged }, { onConflict: "user_id" });
    if (upErr) console.error("consent merge failed", upErr);

    return { ok: true as const, recorded: rows.length };
  });

export const getConsentStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_prefs")
      .select("consent_json")
      .eq("user_id", context.userId)
      .maybeSingle();
    return { consent: (data?.consent_json as Record<string, unknown>) ?? {} };
  });
