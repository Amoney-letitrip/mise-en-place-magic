-- AI-generated daily shift briefings, one per user per session.
-- Generated on demand by the generate-daily-briefing Edge Function.
-- The app shows the latest entry instantly; regenerates when > 8 hours old.

CREATE TABLE IF NOT EXISTS public.daily_summaries (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary_text TEXT      NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own summaries"
  ON public.daily_summaries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own summaries"
  ON public.daily_summaries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own summaries"
  ON public.daily_summaries FOR DELETE
  USING (auth.uid() = user_id);

-- Fast lookup of the latest summary per user
CREATE INDEX IF NOT EXISTS daily_summaries_user_created_idx
  ON public.daily_summaries (user_id, created_at DESC);
