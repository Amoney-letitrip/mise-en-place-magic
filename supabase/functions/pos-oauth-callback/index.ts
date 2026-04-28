/**
 * POS OAuth Callback Edge Function
 *
 * Called by the POS provider after the user authorizes the app.
 * URL pattern: /functions/v1/pos-oauth-callback?code=...&state=...
 *
 * The `state` param is an opaque, short-lived nonce created in pos_oauth_states.
 *
 * Flow:
 *   1. Validate and consume state nonce, extract userId + posType
 *   2. Exchange auth code for access_token via provider token endpoint
 *   3. Upsert into pos_connections table (encrypted at rest by Supabase)
 *   4. Redirect browser back to app with ?pos_connected=true
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || "https://mise-en-place.app";

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

function allowedOrigins(): Set<string> {
  const configured = (Deno.env.get("ALLOWED_APP_ORIGINS") || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([
    APP_URL,
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8080",
    ...configured,
  ].map((origin) => origin.replace(/\/$/, "")));
}

function redirectWith(origin: string, key: "pos_error" | "pos_connected", value: string): Response {
  return Response.redirect(`${origin}/?${key}=${encodeURIComponent(value)}`, 302);
}

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const appUrl = APP_URL.replace(/\/$/, "");

  if (!stateParam) {
    return redirectWith(appUrl, "pos_error", "missing_state");
  }

  const { data: oauthState, error: stateLookupError } = await supabase
    .from("pos_oauth_states")
    .select("state,user_id,pos_type,redirect_origin,expires_at,used_at")
    .eq("state", stateParam)
    .maybeSingle();

  if (stateLookupError || !oauthState) {
    console.error("OAuth state lookup failed:", stateLookupError);
    return redirectWith(appUrl, "pos_error", "invalid_state");
  }

  const allowed = allowedOrigins();
  const redirectOrigin = String(oauthState.redirect_origin || "").replace(/\/$/, "");
  if (!allowed.has(redirectOrigin)) {
    console.error("OAuth redirect origin is not allowed:", redirectOrigin);
    return redirectWith(appUrl, "pos_error", "invalid_redirect");
  }

  if (oauthState.used_at) {
    return redirectWith(redirectOrigin, "pos_error", "state_already_used");
  }

  if (new Date(oauthState.expires_at).getTime() <= Date.now()) {
    return redirectWith(redirectOrigin, "pos_error", "state_expired");
  }

  const userId = oauthState.user_id as string;
  const posType = oauthState.pos_type as string;

  if (!userId || !posType || !TOKEN_ENDPOINTS[posType]) {
    return redirectWith(redirectOrigin, "pos_error", "invalid_state");
  }

  if (error) {
    console.error("OAuth provider returned error:", error);
    return redirectWith(redirectOrigin, "pos_error", error);
  }

  if (!code) {
    return redirectWith(redirectOrigin, "pos_error", "missing_code");
  }

  const providerConfig = TOKEN_ENDPOINTS[posType];
  const clientId = Deno.env.get(providerConfig.clientIdEnv);
  const clientSecret = Deno.env.get(providerConfig.clientSecretEnv);

  if (!clientId || !clientSecret) {
    console.error(`Missing env vars for ${posType}: ${providerConfig.clientIdEnv}, ${providerConfig.clientSecretEnv}`);
    return redirectWith(redirectOrigin, "pos_error", "not_configured");
  }

  const redirectUri = `${SUPABASE_URL}/functions/v1/pos-oauth-callback`;

  const { error: consumeError } = await supabase
    .from("pos_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state", stateParam)
    .is("used_at", null)
    .select("state")
    .single();
  if (consumeError) {
    console.error("OAuth state consume failed:", consumeError);
    return redirectWith(redirectOrigin, "pos_error", "invalid_state");
  }

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
      return redirectWith(redirectOrigin, "pos_error", "token_exchange_failed");
    }

    tokenData = await tokenRes.json();
  } catch (e) {
    console.error("Token exchange error:", e);
    return redirectWith(redirectOrigin, "pos_error", "network_error");
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
    return redirectWith(redirectOrigin, "pos_error", "no_access_token");
  }

  // Verify the userId from the state row still exists in auth.users.
  const { data: userRecord, error: userLookupError } = await supabase.auth.admin.getUserById(userId);
  if (userLookupError || !userRecord?.user) {
    console.error("State userId not found in auth.users:", userId, userLookupError);
    return redirectWith(redirectOrigin, "pos_error", "invalid_user");
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
    return redirectWith(redirectOrigin, "pos_error", "db_error");
  }

  return redirectWith(redirectOrigin, "pos_connected", posType);
});
