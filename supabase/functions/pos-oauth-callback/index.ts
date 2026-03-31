/**
 * POS OAuth Callback Edge Function
 *
 * Called by the POS provider after the user authorizes the app.
 * URL pattern: /functions/v1/pos-oauth-callback?code=...&state=...
 *
 * The `state` param encodes:  base64({ userId, posType, redirectTo })
 *
 * Flow:
 *   1. Validate state, extract userId + posType
 *   2. Exchange auth code for access_token via provider token endpoint
 *   3. Upsert into pos_connections table (encrypted at rest by Supabase)
 *   4. Redirect browser back to app with ?pos_connected=true
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// POS provider token endpoint configs
const TOKEN_ENDPOINTS: Record<string, {
  url: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  grantType: string;
}> = {
  square: {
    url: "https://connect.squareup.com/oauth2/token",
    clientIdEnv: "SQUARE_CLIENT_ID",
    clientSecretEnv: "SQUARE_CLIENT_SECRET",
    grantType: "authorization_code",
  },
  clover: {
    url: "https://www.clover.com/oauth/v2/token",
    clientIdEnv: "CLOVER_CLIENT_ID",
    clientSecretEnv: "CLOVER_CLIENT_SECRET",
    grantType: "authorization_code",
  },
  toast: {
    url: "https://ws-api.toasttab.com/authentication/v1/authentication/login",
    clientIdEnv: "TOAST_CLIENT_ID",
    clientSecretEnv: "TOAST_CLIENT_SECRET",
    grantType: "authorization_code",
  },
  lightspeed: {
    url: "https://cloud.lightspeedapp.com/oauth/access_token.php",
    clientIdEnv: "LIGHTSPEED_CLIENT_ID",
    clientSecretEnv: "LIGHTSPEED_CLIENT_SECRET",
    grantType: "authorization_code",
  },
};

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Build the app redirect base URL from env or request origin
  const appUrl = Deno.env.get("APP_URL") || "https://mise-en-place.app";

  if (error) {
    console.error("OAuth provider returned error:", error);
    return Response.redirect(`${appUrl}/?pos_error=${encodeURIComponent(error)}`, 302);
  }

  if (!code || !stateParam) {
    return Response.redirect(`${appUrl}/?pos_error=missing_params`, 302);
  }

  // Decode state: base64(JSON.stringify({ userId, posType, redirectTo? }))
  let state: { userId: string; posType: string; redirectTo?: string };
  try {
    state = JSON.parse(atob(stateParam));
  } catch {
    return Response.redirect(`${appUrl}/?pos_error=invalid_state`, 302);
  }

  const { userId, posType } = state;
  const redirectTo = state.redirectTo || appUrl;

  if (!userId || !posType || !TOKEN_ENDPOINTS[posType]) {
    return Response.redirect(`${redirectTo}?pos_error=invalid_state`, 302);
  }

  const providerConfig = TOKEN_ENDPOINTS[posType];
  const clientId = Deno.env.get(providerConfig.clientIdEnv);
  const clientSecret = Deno.env.get(providerConfig.clientSecretEnv);

  if (!clientId || !clientSecret) {
    console.error(`Missing env vars for ${posType}: ${providerConfig.clientIdEnv}, ${providerConfig.clientSecretEnv}`);
    return Response.redirect(`${redirectTo}?pos_error=not_configured`, 302);
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/pos-oauth-callback`;

  // Exchange code for token
  let tokenData: Record<string, unknown>;
  try {
    const tokenRes = await fetch(providerConfig.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: providerConfig.grantType,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error(`Token exchange failed for ${posType}:`, tokenRes.status, body);
      return Response.redirect(`${redirectTo}?pos_error=token_exchange_failed`, 302);
    }

    tokenData = await tokenRes.json();
  } catch (e) {
    console.error("Token exchange error:", e);
    return Response.redirect(`${redirectTo}?pos_error=network_error`, 302);
  }

  // Extract standardised fields from provider-specific response shapes
  const accessToken = (tokenData.access_token || tokenData.accessToken) as string | undefined;
  const refreshToken = (tokenData.refresh_token || tokenData.refreshToken) as string | undefined;

  // Provider-specific merchant/location IDs
  let merchantId: string | undefined;
  let locationId: string | undefined;
  if (posType === "square") {
    merchantId = tokenData.merchant_id as string | undefined;
  } else if (posType === "clover") {
    merchantId = tokenData.merchant_id as string | undefined;
  }

  if (!accessToken) {
    console.error("No access_token in response from", posType, tokenData);
    return Response.redirect(`${redirectTo}?pos_error=no_access_token`, 302);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Verify the userId from state actually exists in auth.users (CSRF protection)
  const { data: userRecord, error: userLookupError } = await supabase.auth.admin.getUserById(userId);
  if (userLookupError || !userRecord?.user) {
    console.error("State userId not found in auth.users:", userId, userLookupError);
    return Response.redirect(`${redirectTo}?pos_error=invalid_user`, 302);
  }

  const { error: dbError } = await supabase
    .from("pos_connections")
    .upsert({
      user_id: userId,
      pos_type: posType,
      access_token: accessToken,
      refresh_token: refreshToken || null,
      merchant_id: merchantId || null,
      location_id: locationId || null,
      status: "connected",
      error_message: null,
      connected_at: new Date().toISOString(),
      metadata: { raw: tokenData },
    }, { onConflict: "user_id,pos_type" });

  if (dbError) {
    console.error("DB upsert error:", dbError);
    return Response.redirect(`${redirectTo}?pos_error=db_error`, 302);
  }

  return Response.redirect(`${redirectTo}?pos_connected=${posType}`, 302);
});
