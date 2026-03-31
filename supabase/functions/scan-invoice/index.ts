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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

function extractJson(response: string): unknown {
  let cleaned = response
    .replace(/```json\s*/gi, "").replace(/```\s*/g, "")
    .replace(/'''json\s*/gi, "").replace(/'''\s*/g, "")
    .trim();
  const jsonStart = cleaned.search(/[\{\[]/);
  if (jsonStart === -1) throw new Error("No JSON found");
  const endChar = cleaned[jsonStart] === '[' ? ']' : '}';
  const jsonEnd = cleaned.lastIndexOf(endChar);
  if (jsonEnd === -1) throw new Error("No closing bracket");
  cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  try { return JSON.parse(cleaned); } catch { /* continue */ }
  cleaned = cleaned
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, " ");
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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

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

    // Build content array with all files plus the instruction
    const userContent: unknown[] = fileSlice.map(f => ({
      type: "image_url",
      image_url: { url: `data:${f.mediaType};base64,${f.base64}` },
    }));

    userContent.push({
      type: "text",
      text: `Extract all ingredient line items from ${fileSlice.length > 1 ? 'these invoices/receipts' : 'this invoice/receipt'}. Return JSON only.`,
    });

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
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
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits in workspace settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error(`AI gateway returned ${response.status}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || "";

    let parsed: { ingredients: unknown[] };
    try {
      parsed = extractJson(raw) as { ingredients: unknown[] };
      if (!parsed?.ingredients || !Array.isArray(parsed.ingredients)) {
        throw new Error("Missing ingredients array");
      }
    } catch (e) {
      console.error("Failed to parse AI response:", raw.slice(0, 500));
      return new Response(
        JSON.stringify({ error: "AI returned invalid format. Try scanning again or use a clearer image." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sanitise and coerce numeric fields
    const sanitised = parsed.ingredients.map((item: unknown) => {
      const i = item as Record<string, unknown>;
      return {
        name: String(i.name || "Unknown"),
        quantity: parseFloat(String(i.quantity || 1)) || 1,
        unit: String(i.unit || "each"),
        cost_per_unit: parseFloat(String(i.cost_per_unit || 0)) || 0,
        total_cost: parseFloat(String(i.total_cost || 0)) || 0,
        ...(i.vendor_name ? { vendor_name: String(i.vendor_name) } : {}),
        ...(i.purchase_date ? { purchase_date: String(i.purchase_date) } : {}),
        ...(i.category ? { category: String(i.category) } : {}),
        ...(i.notes ? { notes: String(i.notes) } : {}),
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
