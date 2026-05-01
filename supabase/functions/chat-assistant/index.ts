/**
 * chat-assistant Edge Function
 *
 * Proxies live Q&A between the app and Gemini. GEMINI_API_KEY lives only here
 * as a Supabase secret — it is never exposed to the browser bundle.
 *
 * POST /functions/v1/chat-assistant
 * Headers: Authorization: Bearer <user_jwt>, apikey: <anon_key>
 * Body: {
 *   message: string,
 *   history?: Array<{ role: "user" | "model"; text: string }>,
 *   context: InventoryContext,
 * }
 * Response: { reply: string }
 *
 * The client passes `context` (already loaded in the app via React Query) so
 * this function never needs to re-query the database for a chat turn.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const MAX_HISTORY_TURNS = 10; // keep last 10 exchanges to bound token usage

const SYSTEM_PROMPT = `You are a restaurant inventory and operations assistant for a restaurant management app called Mise en Place. You have access to the restaurant's current inventory data provided in the user's first message.

Your role:
- Answer questions about stock levels, expiry, orders, recipes, costs, and sales
- Flag problems proactively when relevant (low stock, upcoming expirations, overdue orders)
- Be direct, specific, and concise — owners are busy
- Use the data provided; don't make up numbers
- When referencing an ingredient or section, be specific (names, quantities, dates)
- Keep responses under 150 words unless a detailed breakdown is explicitly requested`;

interface HistoryEntry {
  role: "user" | "model";
  text: string;
}

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
    "=== INVENTORY SNAPSHOT ===",
    `Low stock items (${ctx.lowItems.length}):`,
  ];

  if (ctx.lowItems.length === 0) {
    lines.push("  None");
  } else {
    for (const i of ctx.lowItems) {
      lines.push(`  - ${i.name}: ${i.current_stock} ${i.unit} (threshold ${i.threshold} ${i.unit})`);
    }
  }

  lines.push(`\nStockout risk (${ctx.stockoutRisk.length}):`);
  if (ctx.stockoutRisk.length === 0) {
    lines.push("  None");
  } else {
    for (const i of ctx.stockoutRisk) {
      lines.push(`  - ${i.name}: ~${i.daysLeft} day(s) of stock remaining`);
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

  lines.push(`\nOrders due (${ctx.ordersDue.length}):`);
  if (ctx.ordersDue.length === 0) {
    lines.push("  None");
  } else {
    for (const o of ctx.ordersDue) {
      lines.push(`  - ${o.vendor}: ${o.itemCount} item(s) to order`);
    }
  }

  lines.push(`\nFlagged sales needing review: ${ctx.flaggedSalesCount}`);
  lines.push(`Draft recipes (unverified): ${ctx.draftRecipesCount}`);
  lines.push(`Total sales recorded: ${ctx.totalSalesCount}`);

  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    // ── Auth check ──────────────────────────────────────────────────────────
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
        JSON.stringify({ error: "AI assistant is not configured. Add GEMINI_API_KEY to Supabase secrets." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const geminiModel = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;

    // ── Parse body ──────────────────────────────────────────────────────────
    const body = await req.json();
    const message: string = body.message?.trim();
    const history: HistoryEntry[] = Array.isArray(body.history) ? body.history : [];
    const context: InventoryContext | null = body.context ?? null;

    if (!message) {
      return new Response(
        JSON.stringify({ error: "message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Build Gemini conversation ────────────────────────────────────────────
    // First user turn includes the inventory context so Gemini has it for the
    // entire conversation without us re-sending it on every turn.
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

    const recentHistory = history.slice(-MAX_HISTORY_TURNS * 2);

    if (recentHistory.length > 0) {
      const firstUserIdx = recentHistory.findIndex(h => h.role === "user");

      if (firstUserIdx === -1) {
        // History contains only model messages (e.g. the daily summary shown as
        // the opening message before the user has typed anything). Inject context
        // into the current message instead.
        for (const entry of recentHistory) {
          contents.push({ role: entry.role, parts: [{ text: entry.text }] });
        }
        const currentMessage = context
          ? `[INVENTORY DATA]\n${buildContextBlock(context)}\n\n[MY QUESTION]\n${message}`
          : message;
        contents.push({ role: "user", parts: [{ text: currentMessage }] });
      } else {
        // Inject context into the first user message so it is available for all
        // subsequent turns without re-sending it on every request.
        const historyWithContext = recentHistory.map((h, idx) => {
          if (idx === firstUserIdx && context) {
            return {
              ...h,
              text: `[INVENTORY DATA]\n${buildContextBlock(context)}\n\n[MY QUESTION]\n${h.text}`,
            };
          }
          return h;
        });
        for (const entry of historyWithContext) {
          contents.push({ role: entry.role, parts: [{ text: entry.text }] });
        }
        // Current message — context already embedded in history
        contents.push({ role: "user", parts: [{ text: message }] });
      }
    } else {
      // First turn: include full context
      const firstMessage = context
        ? `[INVENTORY DATA]\n${buildContextBlock(context)}\n\n[MY QUESTION]\n${message}`
        : message;
      contents.push({ role: "user", parts: [{ text: firstMessage }] });
    }

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
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 512,
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
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return new Response(
          JSON.stringify({ error: "Gemini API key is invalid. Check GEMINI_API_KEY in Supabase secrets." }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("Gemini error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI assistant is temporarily unavailable. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const reply: string = Array.isArray(data.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts
          .map((p: { text?: string }) => p.text ?? "")
          .join("")
          .trim()
      : "";

    if (!reply) {
      return new Response(
        JSON.stringify({ error: "AI returned an empty response. Please try again." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat-assistant error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
