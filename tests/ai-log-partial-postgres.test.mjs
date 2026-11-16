// A 'partial' ai_log row (the client left after part of an answer) counts toward
// has_ai_budget on a real PostgreSQL database with every migration applied.
// Skips where no PostgreSQL server is available (CI sets RESTPILOT_TEST_DATABASE_URL).
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { quoteLiteral, startMigratedDatabase } from "./_pg-supabase.mjs";

const db = startMigratedDatabase();
const skip = db.skip ? `PostgreSQL unavailable: ${db.skip}` : false;
after(() => db.stop?.());

test(
  "a 'partial' ai_log row counts toward the allowance; an error row with no tokens does not",
  { skip },
  () => {
    const P = "0e0e0e0e-0000-4000-8000-00000000000e";
    db.sql(`INSERT INTO auth.users (id, email) VALUES (${quoteLiteral(P)}, 'e@example.invalid');
          INSERT INTO public.user_prefs (user_id, ai_daily_token_cap) VALUES (${quoteLiteral(P)}, 15000)
          ON CONFLICT (user_id) DO UPDATE SET ai_daily_token_cap = 15000;`);
    const ok = () => db.json(`SELECT public.has_ai_budget(${quoteLiteral(P)}::uuid) AS ok`)[0].ok;
    assert.equal(ok(), true, "under the cap to begin with");
    db.sql(`INSERT INTO public.ai_log (user_id, intent, model, prompt_tokens, completion_tokens, status)
          VALUES (${quoteLiteral(P)}, 'coach', 'm', 0, 0, 'error');`);
    assert.equal(ok(), true, "a failed request with no tokens costs nothing");
    db.sql(`INSERT INTO public.ai_log (user_id, intent, model, prompt_tokens, completion_tokens, status)
          VALUES (${quoteLiteral(P)}, 'coach', 'm', 14000, 2000, 'partial');`);
    assert.equal(ok(), false, "16000 tokens in a 'partial' row exceed the 15000 cap");
  },
);
