-- POS integration connections table
-- Stores OAuth tokens and connection state for each POS provider per user

CREATE TABLE IF NOT EXISTS public.pos_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pos_type TEXT NOT NULL CHECK (pos_type IN ('square', 'clover', 'toast', 'lightspeed')),
  access_token TEXT,
  refresh_token TEXT,
  merchant_id TEXT,
  location_id TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  error_message TEXT,
  connected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, pos_type)
);

-- Enable RLS
ALTER TABLE public.pos_connections ENABLE ROW LEVEL SECURITY;

-- Users can only see and modify their own connections
CREATE POLICY "Users can view own pos_connections"
  ON public.pos_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pos_connections"
  ON public.pos_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pos_connections"
  ON public.pos_connections FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own pos_connections"
  ON public.pos_connections FOR DELETE
  USING (auth.uid() = user_id);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.handle_pos_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pos_connections_updated_at
  BEFORE UPDATE ON public.pos_connections
  FOR EACH ROW EXECUTE FUNCTION public.handle_pos_connections_updated_at();

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS pos_connections_user_id_idx ON public.pos_connections(user_id);
