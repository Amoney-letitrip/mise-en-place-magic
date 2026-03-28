import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, " ");
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

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const { type, base64, mediaType, url } = await req.json();

    let userContent: any[];

    const extractionPrompt = `Extract every dish/menu item from this menu. For each dish, estimate the ingredients and quantities needed for one serving. Return JSON only.`;

    if (type === "photo" && base64) {
      const mime = mediaType || "image/jpeg";
      
      // For PDFs, we send as application/pdf which Gemini supports natively
      userContent = [
        {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${base64}` },
        },
        {
          type: "text",
          text: extractionPrompt,
        },
      ];
    } else if (type === "url" && url) {
      userContent = [
        {
          type: "text",
          text: `I have a restaurant menu at this URL: ${url}\n\nPlease visit this URL and analyze the menu. ${extractionPrompt}`,
        },
      ];
    } else {
      return new Response(
        JSON.stringify({ error: "Provide type='photo' with base64 or type='url' with url" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a professional chef and restaurant consultant. When given a menu (image, PDF, or description), extract every dish and estimate realistic ingredient quantities per serving.

Return ONLY valid JSON in this exact format:
{
  "recipes": [
    {
      "name": "Dish Name",
      "ingredients": [
        { "name": "Ingredient", "qty": 8, "unit": "oz" }
      ]
    }
  ]
}

Rules:
- Use common kitchen units: oz, g, ml, pcs, tbsp, tsp, cups, lbs
- Estimate realistic quantities for a single restaurant serving
- Include all major ingredients (proteins, produce, dairy, grains, oils, seasonings)
- For items like "House Salad", still list main ingredients
- If the image is blurry or hard to read, do your best to extract what you can see
- If you see section headers (Appetizers, Mains, Desserts, etc.), include items from ALL sections
- Return ONLY the JSON, no markdown fences or explanation`;

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
            { role: "system", content: systemPrompt },
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

    // Robust JSON extraction and repair
    let parsed: { recipes: any[] };
    try {
      parsed = extractJson(raw) as { recipes: any[] };
      if (!parsed?.recipes || !Array.isArray(parsed.recipes)) {
        throw new Error("Missing recipes array");
      }
    } catch (e) {
      console.error("Failed to parse AI response:", raw.slice(0, 500));
      return new Response(
        JSON.stringify({ error: "AI returned invalid format. Try scanning again or use a clearer image." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scan-menu error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
