/**
 * generate-daily-briefing Edge Function
 *
 * Generates an AI shift briefing from the current inventory snapshot and
 * stores it in daily_summaries. The app calls this when the chat drawer
 * opens and the cached summary is missing or > 8 hours old.
 *
 * POST /functions/v1/generate-daily-briefing
 * Headers: Authorization: Bearer <user_jwt>, apikey: <anon_key>
 * Body: { context: InventoryContext }
 * Response: { summary: string }
 *
 * After storing, summaries older than 7 days are pruned for this user.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const BRIEFING_SYSTEM_PROMPT = `You are Shift Assistant, a restaurant operations AI inside a restaurant management app called Mise en Place.

Write a concise daily shift briefing from the inventory data provided. Use plain conversational text — no markdown, no bullet points, no headers.

Structure (all in flowing prose):
1. Lead with the most urgent issue, or a positive "all clear" opener if nothing is critical
2. Name specific ingredients, vendors, or items that need attention today — include exact counts and dates
3. Close with one clear recommendation for the shift

Rules:
- Under 160 words
- Plain text only (no *, #, -, or other formatting)
- Specific, not vague — use real names from the data
- Direct and conversational, like a trusted manager briefing their team
- If there is truly nothing to flag, say so warmly and briefly`;

interface InventoryContext {
  restaurantName?: string | null;
  lowItems: Array<{ name: string; current_stock: number; threshold: number; unit: string }>;
  stockoutRisk: Array<{ name: string; unit: string; daysLeft: number }>;
  expiredLots: Array<{ ingredient_name?: string; lot_label: string; expires_at: string | null }>;
  expiringLots: Array<{ ingredient_name?: string; lot_label: string; expires_at: string | null }>;
  ordersDue: Array<{ vendor: string; itemCount: number }>;
  flaggedSalesCount: number;
  draftRecipesCount: number;
  totalSalesCount: number;
}

function buildContextBlock(ctx: InventoryContext): string {
  const lines: string[] = [
    `Restaurant: ${ctx.restaurantName || "unknown"}`,
    "",
    "=== TODAY'S INVENTORY SNAPSHOT ===",
  ];

  lines.push(`\nLow stock (${ctx.lowItems.length} items):`);
  if (ctx.lowItems.length === 0) {
    lines.push("  None");
  } else {
    for (const i of ctx.lowItems) {
      lines.push(`  - ${i.name}: ${i.current_stock} ${i.unit} (reorder at ${i.threshold} ${i.unit})`);
    }
  }

  lines.push(`\nStockout risk (${ctx.stockoutRisk.length} items):`);
  if (ctx.stockoutRisk.length === 0) {
    lines.push("  None");
  } else {
    for (const i of ctx.stockoutRisk) {
      const days = i.daysLeft >= 999 ? "unknown" : `~${i.daysLeft} day(s)`;
      lines.push(`  - ${i.name}: ${days} of stock remaining`);
    }
  }

  lines.push(`\nExpired lots (${ctx.expiredLots.length}):`);
  if (ctx.expiredLots.length === 0) {
    lines.push("  None");
  } else {
    for (const l of ctx.expiredLots) {
      lines.push(`  - ${l.ingredient_name || l.lot_label} (expired ${l.expires_at ?? "unknown date"})`);
    }
  }

  lines.push(`\nExpiring within 2 days (${ctx.expiringLots.length}):`);
  if (ctx.expiringLots.length === 0) {
    lines.push("  None");
  } else {
    for (const l of ctx.expiringLots) {
      lines.push(`  - ${l.ingredient_name || l.lot_label} (expires ${l.expires_at ?? "unknown date"})`);
    }
  }

  lines.push(`\nPurchase orders due (${ctx.ordersDue.length} vendors):`);
  if (ctx.ordersDue.length === 0) {
    lines.push("  None");
  } else {
    for (const o of ctx.ordersDue) {
      lines.push(`  - ${o.vendor}: ${o.itemCount} item(s) to order`);
    }
  }

  lines.push(`\nFlagged sales pending review: ${ctx.flaggedSalesCount}`);
  lines.push(`Draft recipes (unverified, not tracking inventory): ${ctx.draftRecipesCount}`);
  lines.push(`Total sales on record: ${ctx.totalSalesCount}`);

  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Gemini key ──────────────────────────────────────────────────────────
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI briefing is not configured. Add GEMINI_API_KEY to Supabase secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const geminiModel = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;

    // ── Parse context ───────────────────────────────────────────────────────
    const body = await req.json();
    const context: InventoryContext | null = body.context ?? null;

    if (!context) {
      return new Response(
        JSON.stringify({ error: "context is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contextBlock = buildContextBlock(context);

    // ── Call Gemini ─────────────────────────────────────────────────────────
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: BRIEFING_SYSTEM_PROMPT }] },
          contents: [
            {
              role: "user",
              parts: [{ text: contextBlock }],
            },
          ],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 300,
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI service is busy — please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("Gemini briefing error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "Could not generate briefing. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const summary: string = Array.isArray(data.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts
          .map((p: { text?: string }) => p.text ?? "")
          .join("")
          .trim()
      : "";

    if (!summary) {
      return new Response(
        JSON.stringify({ error: "AI returned an empty briefing. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Store in daily_summaries ────────────────────────────────────────────
    const { error: insertError } = await supabase
      .from("daily_summaries")
      .insert({ user_id: user.id, summary_text: summary });

    if (insertError) {
      console.error("Failed to store daily summary:", insertError);
      // Still return the summary even if storage fails
    }

    // ── Prune summaries older than 7 days ───────────────────────────────────
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("daily_summaries")
      .delete()
      .eq("user_id", user.id)
      .lt("created_at", sevenDaysAgo);

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-daily-briefing error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
