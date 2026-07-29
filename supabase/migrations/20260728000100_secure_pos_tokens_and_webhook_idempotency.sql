-- Keep provider credentials server-side even when a user can read their own
-- integration status through PostgREST.
REVOKE SELECT ON TABLE public.pos_connections FROM anon, authenticated;
GRANT SELECT (
  id,
  user_id,
  pos_type,
  merchant_id,
  location_id,
  status,
  error_message,
  connected_at,
  last_sync_at,
  created_at,
  updated_at
) ON TABLE public.pos_connections TO authenticated;

REVOKE SELECT ON TABLE public.pos_integrations FROM anon, authenticated;
GRANT SELECT (
  id,
  user_id,
  provider,
  status,
  external_location_id,
  last_synced_at,
  created_at,
  updated_at
) ON TABLE public.pos_integrations TO authenticated;

-- OAuth state is visible only for troubleshooting; the short-lived provider
-- secret must never be readable from a browser client.
REVOKE SELECT ON TABLE public.pos_oauth_states FROM anon, authenticated;
GRANT SELECT (
  state,
  user_id,
  pos_type,
  redirect_origin,
  expires_at,
  used_at,
  created_at,
  provider_client_id
) ON TABLE public.pos_oauth_states TO authenticated;

-- Webhook providers retry deliveries. A stable provider event key prevents the
-- same sale from being imported and flagged more than once.
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS external_sale_id TEXT;

ALTER TABLE public.sales
  DROP CONSTRAINT IF EXISTS sales_user_external_sale_id_key;

ALTER TABLE public.sales
  ADD CONSTRAINT sales_user_external_sale_id_key
  UNIQUE (user_id, external_sale_id);
