
-- Step 3: Predictive AI + Continuous Learning foundation

-- ai_recommendations
CREATE TABLE public.ai_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  intent TEXT NOT NULL,
  headline TEXT NOT NULL,
  rationale TEXT,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  predicted_impact_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  pattern_id UUID,
  feedback_score NUMERIC(4,2),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until TIMESTAMPTZ,
  superseded_by UUID REFERENCES public.ai_recommendations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_recommendations TO authenticated;
GRANT ALL ON public.ai_recommendations TO service_role;
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own recs" ON public.ai_recommendations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX ai_recommendations_user_created_idx ON public.ai_recommendations (user_id, created_at DESC);
CREATE INDEX ai_recommendations_user_intent_idx ON public.ai_recommendations (user_id, intent, created_at DESC);

-- ai_patterns
CREATE TABLE public.ai_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  pattern_key TEXT NOT NULL,
  severity SMALLINT NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  signals_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrences INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  muted_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, pattern_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_patterns TO authenticated;
GRANT ALL ON public.ai_patterns TO service_role;
ALTER TABLE public.ai_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own patterns" ON public.ai_patterns
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX ai_patterns_user_active_idx ON public.ai_patterns (user_id, active, severity DESC);
CREATE TRIGGER ai_patterns_set_updated_at
  BEFORE UPDATE ON public.ai_patterns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Now add FK from recommendations -> patterns (after patterns exists)
ALTER TABLE public.ai_recommendations
  ADD CONSTRAINT ai_recommendations_pattern_fk
  FOREIGN KEY (pattern_id) REFERENCES public.ai_patterns(id) ON DELETE SET NULL;

-- ai_feedback
CREATE TYPE public.ai_feedback_reaction AS ENUM (
  'helpful', 'not_helpful', 'already_did', 'ignored_today', 'dismissed_forever'
);

CREATE TABLE public.ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  recommendation_id UUID NOT NULL REFERENCES public.ai_recommendations(id) ON DELETE CASCADE,
  reaction public.ai_feedback_reaction NOT NULL,
  note TEXT,
  outcome_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_feedback TO authenticated;
GRANT ALL ON public.ai_feedback TO service_role;
ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own feedback" ON public.ai_feedback
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX ai_feedback_user_created_idx ON public.ai_feedback (user_id, created_at DESC);
CREATE INDEX ai_feedback_rec_idx ON public.ai_feedback (recommendation_id);

-- user_prefs new toggles (default true; users can opt out)
ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS predictive_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_review_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tomorrow_preview_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS feedback_learning_enabled BOOLEAN NOT NULL DEFAULT true;
