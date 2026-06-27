
ALTER TABLE public.ai_memory
  ADD COLUMN IF NOT EXISTS importance smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS use_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_referenced_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.ai_memory(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS embedding_hash text;

CREATE INDEX IF NOT EXISTS ai_memory_active_idx
  ON public.ai_memory (user_id, pinned DESC, updated_at DESC)
  WHERE superseded_by IS NULL;

CREATE INDEX IF NOT EXISTS ai_memory_hash_idx
  ON public.ai_memory (user_id, category, embedding_hash)
  WHERE embedding_hash IS NOT NULL AND superseded_by IS NULL;
