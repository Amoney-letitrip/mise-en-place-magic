import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const invoiceScanner = readFileSync(
  "supabase/functions/scan-invoice/index.ts",
  "utf8",
);
const menuScanner = readFileSync(
  "supabase/functions/scan-menu/index.ts",
  "utf8",
);
const posWebhook = readFileSync(
  "supabase/functions/pos-webhook/index.ts",
  "utf8",
);
const posCallback = readFileSync(
  "supabase/functions/pos-oauth-callback/index.ts",
  "utf8",
);
const securityMigration = readFileSync(
  "supabase/migrations/20260728000100_secure_pos_tokens_and_webhook_idempotency.sql",
  "utf8",
);
const inventoryHook = readFileSync(
  "src/hooks/use-inventory-data.ts",
  "utf8",
);
const vercelConfig = readFileSync("vercel.json", "utf8");
const wasteImpactCard = readFileSync(
  "src/components/inventory/WasteImpactCard.tsx",
  "utf8",
);
const inventoryTab = readFileSync(
  "src/components/inventory/InventoryTab.tsx",
  "utf8",
);
const onboardingWizard = readFileSync(
  "src/components/inventory/OnboardingWizard.tsx",
  "utf8",
);
const aiChatDrawer = readFileSync(
  "src/components/inventory/AIChatDrawer.tsx",
  "utf8",
);

describe("AI scanner authorization", () => {
  it.each([
    ["invoice", invoiceScanner],
    ["menu", menuScanner],
  ])("requires an authenticated user for %s scanning", (_name, scanner) => {
    expect(scanner).toContain('req.headers.get("Authorization")');
    expect(scanner).toContain("supabase.auth.getUser()");
    expect(scanner).toContain('status: 401');
  });

  it("caps combined invoice payload size", () => {
    expect(invoiceScanner).toContain("MAX_TOTAL_BASE64_CHARS");
    expect(invoiceScanner).toContain("combined invoice upload is too large");
  });

  it("grounds URL menu scans in a successfully retrieved page", () => {
    expect(menuScanner).toContain("url_context");
    expect(menuScanner).toContain("URL_RETRIEVAL_STATUS_SUCCESS");
    expect(menuScanner).toContain("Enter a valid public HTTPS menu URL");
  });
});

describe("POS credential and webhook hardening", () => {
  it("does not expose provider tokens through browser queries", () => {
    expect(securityMigration).toContain(
      "REVOKE SELECT ON TABLE public.pos_connections FROM anon, authenticated",
    );
    expect(securityMigration).toContain(
      "REVOKE SELECT ON TABLE public.pos_integrations FROM anon, authenticated",
    );
    expect(securityMigration).toContain(
      "REVOKE SELECT ON TABLE public.pos_oauth_states FROM anon, authenticated",
    );
    expect(inventoryHook).toContain(
      ".select('id,user_id,provider,status,external_location_id,last_synced_at,created_at,updated_at')",
    );
  });

  it("does not persist or log a raw OAuth token response", () => {
    expect(posCallback).not.toContain("metadata: { raw: tokenData }");
    expect(posCallback).not.toContain('posType, tokenData');
    expect(posCallback).not.toContain("tokenRes.status, body");
  });

  it("verifies Clover and Toast webhook authenticity", () => {
    expect(posWebhook).toContain('req.headers.get("x-clover-auth")');
    expect(posWebhook).toContain('req.headers.get("toast-signature")');
    expect(posWebhook).toContain('Deno.env.get("TOAST_WEBHOOK_SECRET")');
    expect(posWebhook).toContain("constantTimeEqual");
  });

  it("deduplicates provider webhook retries", () => {
    expect(securityMigration).toContain("external_sale_id TEXT");
    expect(securityMigration).toContain("UNIQUE (user_id, external_sale_id)");
    expect(posWebhook).toContain('onConflict: "user_id,external_sale_id"');
    expect(posWebhook).toContain("ignoreDuplicates: true");
  });
});

describe("browser security headers", () => {
  it("prevents framing and limits browser capabilities", () => {
    expect(vercelConfig).toContain("Content-Security-Policy");
    expect(vercelConfig).toContain("frame-ancestors 'none'");
    expect(vercelConfig).toContain("Permissions-Policy");
    expect(vercelConfig).toContain("X-Content-Type-Options");
  });
});

describe("customer-facing data integrity", () => {
  it("does not present demo waste savings as measured account data", () => {
    expect(wasteImpactCard).not.toContain("DEMO_WASTE_IMPACT_INPUT");
    expect(wasteImpactCard).toContain("No measured waste impact yet");
  });

  it("does not mark onboarding complete after a failed data insert", () => {
    expect(onboardingWizard).toContain("if (error) throw error");
    expect(onboardingWizard).toContain(
      "if (ingredientsError) throw ingredientsError",
    );
  });
});

describe("mobile and assistive-technology regressions", () => {
  it("wraps expired-lot actions instead of overflowing narrow screens", () => {
    expect(inventoryTab).toContain("flex flex-wrap gap-1.5");
    expect(inventoryTab).toContain('aria-label="Search inventory"');
  });

  it("removes the closed assistant from the accessibility tree", () => {
    expect(aiChatDrawer).toContain("aria-hidden={!open}");
    expect(aiChatDrawer).toContain("inert={open ? undefined : true}");
    expect(aiChatDrawer).toContain("role={open ? 'dialog' : undefined}");
  });
});
