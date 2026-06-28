CREATE TABLE public.personal_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('task','reminder','email_note','followup')),
  title TEXT NOT NULL,
  notes TEXT,
  source TEXT,
  due_at TIMESTAMPTZ,
  remind_at TIMESTAMPTZ,
  priority SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','snoozed','done','dismissed')),
  followup_of UUID REFERENCES public.personal_items(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_items TO authenticated;
GRANT ALL ON public.personal_items TO service_role;

ALTER TABLE public.personal_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own personal items"
  ON public.personal_items
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX personal_items_user_status_idx
  ON public.personal_items (user_id, status, due_at NULLS LAST);
CREATE INDEX personal_items_user_kind_idx
  ON public.personal_items (user_id, kind);

CREATE TRIGGER personal_items_set_updated_at
  BEFORE UPDATE ON public.personal_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();