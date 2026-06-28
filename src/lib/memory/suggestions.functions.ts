/**
 * Phase 6 — Server functions for routine suggestions.
 *
 * `scanForRoutines` lets a signed-in user manually trigger the cross-skill
 * suggester (the nightly cron also runs it). Strictly respects memory
 * consent, learning pause, and per-category consents.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const scanForRoutines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runCrossSkillSuggester } = await import("@/lib/memory/cross-skill-suggester.server");
    const count = await runCrossSkillSuggester(supabaseAdmin, context.userId);
    return { ok: true, suggestions_created: count };
  });
