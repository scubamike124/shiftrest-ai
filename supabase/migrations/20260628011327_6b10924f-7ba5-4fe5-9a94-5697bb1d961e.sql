ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS voice_id text NOT NULL DEFAULT 'sage',
  ADD COLUMN IF NOT EXISTS voice_provider text NOT NULL DEFAULT 'openai',
  ADD COLUMN IF NOT EXISTS voice_language text NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS voice_accent text,
  ADD COLUMN IF NOT EXISTS voice_personality text NOT NULL DEFAULT 'calm',
  ADD COLUMN IF NOT EXISTS voice_speed numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS voice_instructions text;