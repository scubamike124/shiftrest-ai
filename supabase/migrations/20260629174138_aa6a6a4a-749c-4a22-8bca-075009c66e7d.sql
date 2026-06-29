ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS companion_renderer text NOT NULL DEFAULT '3d',
  ADD COLUMN IF NOT EXISTS companion_tts_provider text NOT NULL DEFAULT 'openai';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_companion_renderer_check
  CHECK (companion_renderer IN ('2d','3d'));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_companion_tts_provider_check
  CHECK (companion_tts_provider IN ('openai','elevenlabs'));