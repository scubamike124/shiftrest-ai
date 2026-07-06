ALTER TABLE public.user_prefs DROP CONSTRAINT user_prefs_assistant_mode_check;
ALTER TABLE public.user_prefs ADD CONSTRAINT user_prefs_assistant_mode_check
  CHECK (assistant_mode = ANY (ARRAY[
    'coach','companion','minimal','friend','professional',
    'warm','encouraging','motivational','supportive'
  ]));