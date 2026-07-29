/**
 * scan-invoice Edge Function
 *
 * Accepts one or more invoice/receipt images or PDFs (as base64),
 * uses Gemini vision to extract ingredient line items, and returns
 * structured data ready to be imported into the inventory table.
 *
 * Request body:
 *   { files: Array<{ base64: string; mediaType: string; filename?: string }> }
 *
 * Response:
 *   { ingredients: Array<{
 *       name: string;
 *       quantity: number;
 *       unit: string;
 *       cost_per_unit: number;
 *       total_cost: number;
 *       vendor_name?: string;
 *       purchase_date?: string;   // ISO date string YYYY-MM-DD
 *       category?: string;
 *       notes?: string;
 *     }>
 *   }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const MAX_BASE64_CHARS = 12_000_000;
const MAX_TOTAL_BASE64_CHARS = 24_000_000;

type GeminiPart =
  | { type: "text"; text: string }
  | { inline_data: { mime_type: string; data: string } };

function buildFilePart(mediaType: string, base64: string): GeminiPart {
  if (SUPPORTED_MEDIA_TYPES.has(mediaType)) {
    return { inline_data: { mime_type: mediaType, data: base64 } };
  }

  throw new Error("Unsupported file type. Upload JPG, PNG, WebP, or PDF.");
}

function extractJson(response: string): unknown {
  let cleaned = response
    .replace(/```json\s*/gi, "").replace(/```\s*/g, "")
    .replace(/'''json\s*/gi, "").replace(/'''\s*/g, "")
    .trim();
  const firstObject = cleaned.indexOf("{");
  const firstArray = cleaned.indexOf("[");
  const jsonStart = firstObject === -1 ? firstArray : firstArray === -1 ? firstObject : Math.min(firstObject, firstArray);
  if (jsonStart === -1) throw new Error("No JSON found");
  const endChar = cleaned[jsonStart] === '[' ? ']' : '}';
  const jsonEnd = cleaned.lastIndexOf(endChar);
  if (jsonEnd === -1) throw new Error("No closing bracket");
  cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  cleaned = cleaned
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .split("")
    .map((c) => {
      const code = c.charCodeAt(0);
      return code < 32 || code === 127 ? " " : c;
    })
    .join("");
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  let braces = 0, brackets = 0;
  for (const c of cleaned) {
    if (c === '{') braces++; if (c === '}') braces--;
    if (c === '[') brackets++; if (c === ']') brackets--;
  }
  let repaired = cleaned;
  repaired = repaired.replace(/,\s*"[^"]*$/, "");
  repaired = repaired.replace(/,\s*\{[^}]*$/, "");
  while (brackets > 0) { repaired += ']'; brackets--; }
  while (braces > 0) { repaired += '}'; braces--; }
  return JSON.parse(repaired);
}

const SYSTEM_PROMPT = `You are a professional chef and restaurant operations expert.
When given invoices or receipts from food suppliers, extract every ingredient/product line item.

Return ONLY valid JSON in this exact format:
{
  "ingredients": [
    {
      "name": "Product name",
      "quantity": 10,
      "unit": "lbs",
      "cost_per_unit": 3.50,
      "total_cost": 35.00,
      "vendor_name": "Sysco Foods",
      "purchase_date": "2025-03-15",
      "category": "Produce",
      "notes": "Any relevant notes"
    }
  ]
}

Rules:
- Use standard kitchen units: lbs, oz, kg, g, ml, L, gal, qt, pint, fl oz, each, dozen, case, bag, box, bunch, head
- If unit price is not shown but total and quantity are, calculate it: cost_per_unit = total_cost / quantity
- If only a total is shown with no quantity breakdown, set quantity to 1 and cost_per_unit = total_cost
- Normalise product names to simple ingredient names (e.g. "Fresh Atlantic Salmon 6oz portions" → "Salmon")
- category should be one of: Produce, Protein, Dairy, Dry Goods, Beverages, Seafood, Bakery, Spices, Frozen, Other
- purchase_date should be YYYY-MM-DD format. If not visible, omit the field
- vendor_name should come from the invoice header (supplier name). If not visible, omit it
- Skip non-food items (packaging, cleaning supplies, equipment)
- Return ONLY the JSON, no markdown or explanation`;

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!authHeader.startsWith("Bearer ") || !supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
    const geminiModel = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;

    const { files } = await req.json() as {
      files: Array<{ base64: string; mediaType: string; filename?: string }>;
    };

    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(
        JSON.stringify({ error: "Provide files array with at least one file" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cap at 10 files per request
    const fileSlice = files.slice(0, 10);
    let totalBase64Chars = 0;
    for (const file of fileSlice) {
      if (!SUPPORTED_MEDIA_TYPES.has(file.mediaType)) {
        return new Response(
          JSON.stringify({ error: "Unsupported file type. Upload JPG, PNG, WebP, or PDF." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (typeof file.base64 !== "string" || file.base64.length > MAX_BASE64_CHARS) {
        return new Response(
          JSON.stringify({ error: "One invoice file is too large to scan. Upload a smaller image or PDF." }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      totalBase64Chars += file.base64.length;
      if (totalBase64Chars > MAX_TOTAL_BASE64_CHARS) {
        return new Response(
          JSON.stringify({ error: "The combined invoice upload is too large. Scan fewer files at a time." }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Build content array with all files plus the instruction
    const userParts: GeminiPart[] = fileSlice.map((file) => buildFilePart(file.mediaType, file.base64));

    userParts.push({
      type: "text",
      text: `Extract all ingredient line items from ${fileSlice.length > 1 ? 'these invoices/receipts' : 'this invoice/receipt'}. Return JSON only.`,
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: "user",
              parts: userParts.map((part) => "type" in part ? { text: part.text } : part),
            },
          ],
          generationConfig: {
            temperature: 0.2,
            response_mime_type: "application/json",
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return new Response(
          JSON.stringify({ error: "Gemini API access is not configured correctly. Check the Gemini API key in Supabase secrets." }),
          { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("Gemini API error:", response.status, t);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    const raw = Array.isArray(data.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts
          .map((part: { text?: string }) => part.text || "")
          .join("\n")
      : "";

    let parsed: { ingredients: unknown[] };
    try {
      parsed = extractJson(raw) as { ingredients: unknown[] };
      if (!parsed?.ingredients || !Array.isArray(parsed.ingredients)) {
        throw new Error("Missing ingredients array");
      }
    } catch {
      console.error("Failed to parse AI invoice response");
      return new Response(
        JSON.stringify({ error: "AI returned invalid format. Try scanning again or use a clearer image." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sanitise and coerce numeric fields
    const sanitised = parsed.ingredients.slice(0, 500).map((item: unknown) => {
      const i = item as Record<string, unknown>;
      const quantity = Math.max(0, Math.min(1_000_000, parseFloat(String(i.quantity || 1)) || 1));
      const unitCost = Math.max(0, Math.min(1_000_000, parseFloat(String(i.cost_per_unit || 0)) || 0));
      const totalCost = Math.max(0, Math.min(100_000_000, parseFloat(String(i.total_cost || 0)) || 0));
      return {
        name: String(i.name || "Unknown").trim().slice(0, 200),
        quantity,
        unit: String(i.unit || "each").trim().slice(0, 30),
        cost_per_unit: unitCost,
        total_cost: totalCost,
        ...(i.vendor_name ? { vendor_name: String(i.vendor_name).trim().slice(0, 200) } : {}),
        ...(i.purchase_date ? { purchase_date: String(i.purchase_date).trim().slice(0, 10) } : {}),
        ...(i.category ? { category: String(i.category).trim().slice(0, 50) } : {}),
        ...(i.notes ? { notes: String(i.notes).trim().slice(0, 500) } : {}),
      };
    });

    return new Response(JSON.stringify({ ingredients: sanitised }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scan-invoice error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
