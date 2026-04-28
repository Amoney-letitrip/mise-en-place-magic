-- Short-lived OAuth state nonces for POS connections.
-- The browser creates a nonce before redirecting to a POS provider; the callback
-- consumes it exactly once before storing provider tokens.

CREATE TABLE IF NOT EXISTS public.pos_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pos_type TEXT NOT NULL CHECK (pos_type IN ('square', 'clover', 'toast', 'lightspeed')),
  redirect_origin TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create own pos oauth states"
  ON public.pos_oauth_states FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own pos oauth states"
  ON public.pos_oauth_states FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS pos_oauth_states_user_id_idx
  ON public.pos_oauth_states(user_id);

CREATE INDEX IF NOT EXISTS pos_oauth_states_expires_at_idx
  ON public.pos_oauth_states(expires_at);
