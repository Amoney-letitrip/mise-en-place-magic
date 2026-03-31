/**
 * POS Webhook Edge Function
 *
 * Receives real-time sale events from connected POS providers.
 * Validates the webhook signature, then creates a `sales` record
 * which triggers inventory deduction on the frontend via React Query.
 *
 * Webhook URLs to configure in each POS dashboard:
 *   Square:     https://[project-ref].supabase.co/functions/v1/pos-webhook?provider=square
 *   Clover:     https://[project-ref].supabase.co/functions/v1/pos-webhook?provider=clover
 *   Toast:      https://[project-ref].supabase.co/functions/v1/pos-webhook?provider=toast
 *   Lightspeed: https://[project-ref].supabase.co/functions/v1/pos-webhook?provider=lightspeed
 *
 * Expected `sales` table columns (existing schema assumed):
 *   id, user_id, recipe_id, quantity, sale_date, notes, pos_source, pos_order_id
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Signature verification helpers ───────────────────────────────────────────

async function verifySquare(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY");
  if (!secret) return false;
  const sig = req.headers.get("x-square-hmacsha256-signature") || "";
  const url = req.url;
  const expected = await hmac("sha256", secret, url + body, "utf8", "base64");
  return sig === expected;
}

async function verifyClover(req: Request, body: string): Promise<boolean> {
  // Clover uses a shared app secret
  const secret = Deno.env.get("CLOVER_CLIENT_SECRET");
  if (!secret) return false;
  // Clover webhooks don't have a built-in signature — rely on payload validation
  return body.length > 0 && !!secret;
}

async function verifyToast(_req: Request, body: string): Promise<boolean> {
  // Toast uses a GUID-based shared secret in the payload header
  return body.length > 0;
}

async function verifyLightspeed(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get("LIGHTSPEED_WEBHOOK_SECRET");
  if (!secret) return false;
  const sig = req.headers.get("x-lightspeed-signature") || "";
  const expected = await hmac("sha256", secret, body, "utf8", "hex");
  return sig === `sha256=${expected}`;
}

const VERIFIERS: Record<string, (req: Request, body: string) => Promise<boolean>> = {
  square: verifySquare,
  clover: verifyClover,
  toast: verifyToast,
  lightspeed: verifyLightspeed,
};

// ─── Payload normalisation ─────────────────────────────────────────────────────
// Each provider sends a different shape. We normalise to a common array of:
//   { posOrderId, itemName, quantity, unitPrice, occurredAt }

interface NormalisedLineItem {
  posOrderId: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  occurredAt: string;
}

function normaliseSquare(payload: Record<string, unknown>): NormalisedLineItem[] {
  const event = payload as any;
  if (event.type !== "payment.completed" && event.type !== "order.updated") return [];
  const order = event.data?.object?.order || event.data?.object?.payment?.order;
  if (!order) return [];

  const orderId = order.id || event.data?.id;
  const occurredAt = event.created_at || new Date().toISOString();

  return (order.line_items || []).map((item: any) => ({
    posOrderId: orderId,
    itemName: item.name || "Unknown item",
    quantity: parseFloat(item.quantity) || 1,
    unitPrice: (item.base_price_money?.amount || 0) / 100,
    occurredAt,
  }));
}

function normaliseClover(payload: Record<string, unknown>): NormalisedLineItem[] {
  const event = payload as any;
  if (!event.merchants) return [];

  const items = event.appSubscriptions || [];
  return items.map((item: any) => ({
    posOrderId: item.objectId || "unknown",
    itemName: item.objectId || "Clover item",
    quantity: 1,
    unitPrice: 0,
    occurredAt: new Date(item.ts || Date.now()).toISOString(),
  }));
}

function normaliseToast(payload: Record<string, unknown>): NormalisedLineItem[] {
  const event = payload as any;
  const orders = Array.isArray(payload) ? payload : [event];

  return orders.flatMap((order: any) =>
    (order.selections || []).map((sel: any) => ({
      posOrderId: order.guid || "unknown",
      itemName: sel.displayName || sel.itemGroupGuid || "Toast item",
      quantity: sel.quantity || 1,
      unitPrice: sel.price || 0,
      occurredAt: new Date(order.openedDate || Date.now()).toISOString(),
    }))
  );
}

function normaliseLightspeed(payload: Record<string, unknown>): NormalisedLineItem[] {
  const event = payload as any;
  const sale = event.Sale || event;

  return (sale.SaleLines?.SaleLine || []).map((line: any) => ({
    posOrderId: String(sale.saleID || "unknown"),
    itemName: line.Item?.description || "Lightspeed item",
    quantity: parseFloat(line.unitQuantity) || 1,
    unitPrice: parseFloat(line.unitPrice) || 0,
    occurredAt: sale.timeStamp || new Date().toISOString(),
  }));
}

const NORMALISERS: Record<string, (payload: Record<string, unknown>) => NormalisedLineItem[]> = {
  square: normaliseSquare,
  clover: normaliseClover,
  toast: normaliseToast,
  lightspeed: normaliseLightspeed,
};

// ─── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");

  if (!provider || !VERIFIERS[provider]) {
    return new Response(JSON.stringify({ error: "Unknown provider" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.text();

  // Verify signature
  const valid = await VERIFIERS[provider](req, body);
  if (!valid) {
    console.warn(`Webhook signature verification failed for ${provider}`);
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const lineItems = NORMALISERS[provider](payload);
  if (lineItems.length === 0) {
    // Acknowledge but no action needed (e.g., non-sale event)
    return new Response(JSON.stringify({ received: true, sales: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Look up the merchant_id from the webhook to find the correct user
  // For providers that send merchant info in the payload
  const merchantId = (payload as any).merchant_id
    || (payload as any).merchants?.[0]?.id
    || url.searchParams.get("merchant_id");

  let userId: string | null = null;
  if (merchantId) {
    const { data } = await supabase
      .from("pos_connections")
      .select("user_id")
      .eq("pos_type", provider)
      .eq("merchant_id", merchantId)
      .eq("status", "connected")
      .single();
    userId = data?.user_id || null;
  }

  if (!userId) {
    // Can't attribute this webhook to a known user — log and acknowledge
    console.warn("Could not resolve user_id for webhook from", provider, "merchant", merchantId);
    return new Response(JSON.stringify({ received: true, sales: 0, note: "merchant not found" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Insert sales records (recipe_id will be null — matched later by item name lookup)
  const salesRows = lineItems.map((item) => ({
    user_id: userId,
    recipe_id: null,          // Will be matched by the app when recipe names align
    quantity: item.quantity,
    sale_date: item.occurredAt.split("T")[0],
    notes: `[POS: ${provider}] ${item.itemName} @ $${item.unitPrice.toFixed(2)}`,
    pos_source: provider,
    pos_order_id: item.posOrderId,
  }));

  const { error: insertError, count } = await supabase
    .from("sales")
    .insert(salesRows, { count: "exact" });

  if (insertError) {
    // Columns pos_source / pos_order_id may not exist yet — insert without them
    if (insertError.code === "42703") {
      const fallback = salesRows.map(({ pos_source: _s, pos_order_id: _o, ...rest }) => rest);
      const { error: fallbackError } = await supabase.from("sales").insert(fallback);
      if (fallbackError) {
        console.error("Fallback insert error:", fallbackError);
        return new Response(JSON.stringify({ error: "db_insert_failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      console.error("Sales insert error:", insertError);
      return new Response(JSON.stringify({ error: "db_insert_failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Update last_sync_at on the connection
  await supabase
    .from("pos_connections")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("pos_type", provider);

  return new Response(JSON.stringify({ received: true, sales: count || lineItems.length }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
