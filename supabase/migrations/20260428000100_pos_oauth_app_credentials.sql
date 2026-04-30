-- Allow POS OAuth credentials to be supplied from the app for one connection.
-- provider_client_secret is short-lived and cleared by the callback after state
-- consumption so it is not kept as a long-term app setting.

ALTER TABLE public.pos_oauth_states
  ADD COLUMN IF NOT EXISTS provider_client_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_client_secret TEXT;
