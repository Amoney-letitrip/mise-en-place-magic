import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_BASE64_CHARS = 12_000_000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

type GeminiPart =
  | { type: "text"; text: string }
  | { inline_data: { mime_type: string; data: string } };

function buildFilePart(mime: string, base64: string): GeminiPart {
  if (SUPPORTED_MEDIA_TYPES.has(mime)) {
    return { inline_data: { mime_type: mime, data: base64 } };
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

    const { type, base64, mediaType, url } = await req.json();

    let userParts: GeminiPart[];
    let validatedUrl: string | null = null;

    const extractionPrompt = `Extract every dish/menu item from this menu. For each dish, estimate the ingredients and quantities needed for one serving. Return JSON only.`;

    if (type === "photo" && base64) {
      const mime = mediaType || "image/jpeg";
      if (!SUPPORTED_MEDIA_TYPES.has(mime)) {
        return new Response(
          JSON.stringify({ error: "Unsupported file type. Upload JPG, PNG, WebP, or PDF." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (typeof base64 !== "string" || base64.length > MAX_BASE64_CHARS) {
        return new Response(
          JSON.stringify({ error: "File is too large to scan. Upload a smaller image or PDF." }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      userParts = [
        buildFilePart(mime, base64),
        {
          type: "text",
          text: extractionPrompt,
        },
      ];
    } else if (type === "url" && typeof url === "string") {
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "https:" || url.length > 2_048) throw new Error("Invalid URL");
        validatedUrl = parsedUrl.toString();
      } catch {
        return new Response(
          JSON.stringify({ error: "Enter a valid public HTTPS menu URL." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userParts = [
        {
          type: "text",
          text: `Analyze the restaurant menu at this URL: ${validatedUrl}\n\n${extractionPrompt}`,
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
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": GEMINI_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: "user",
              parts: userParts.map((part) => "type" in part ? { text: part.text } : part),
            },
          ],
          ...(validatedUrl ? { tools: [{ url_context: {} }] } : {}),
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
      return new Response(
        JSON.stringify({ error: `Menu scan service returned ${response.status}. Try a clearer or smaller image.` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    if (validatedUrl) {
      const urlMetadata = data.candidates?.[0]?.url_context_metadata?.url_metadata;
      const retrieved = Array.isArray(urlMetadata) && urlMetadata.some(
        (item: { retrieved_url?: string; url_retrieval_status?: string }) =>
          item.url_retrieval_status === "URL_RETRIEVAL_STATUS_SUCCESS"
      );
      if (!retrieved) {
        return new Response(
          JSON.stringify({ error: "That menu page could not be retrieved. Upload a photo or PDF instead." }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
    const raw = Array.isArray(data.candidates?.[0]?.content?.parts)
      ? data.candidates[0].content.parts
          .map((part: { text?: string }) => part.text || "")
          .join("\n")
      : "";

    // Robust JSON extraction and repair
    let parsed: { recipes: any[] };
    try {
      parsed = extractJson(raw) as { recipes: any[] };
      if (!parsed?.recipes || !Array.isArray(parsed.recipes)) {
        throw new Error("Missing recipes array");
      }
    } catch {
      console.error("Failed to parse AI menu response");
      return new Response(
        JSON.stringify({ error: "AI returned invalid format. Try scanning again or use a clearer image." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const recipes = parsed.recipes.slice(0, 250).map((recipe: unknown) => {
      const r = recipe as Record<string, unknown>;
      const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
      return {
        name: String(r.name || "Untitled recipe").trim().slice(0, 200),
        ...(r.menu_price != null
          ? { menu_price: Math.max(0, Math.min(100_000, Number(r.menu_price) || 0)) }
          : {}),
        ingredients: ingredients.slice(0, 100).map((ingredient: unknown) => {
          const i = ingredient as Record<string, unknown>;
          return {
            name: String(i.name || "Unknown ingredient").trim().slice(0, 200),
            qty: Math.max(0, Math.min(1_000_000, Number(i.qty) || 0)),
            unit: String(i.unit || "each").trim().slice(0, 30),
          };
        }),
      };
    });

    return new Response(JSON.stringify({ recipes }), {
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
