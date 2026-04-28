import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260427000300_harden_pos_oauth_state.sql",
  "utf8",
);

const callback = readFileSync(
  "supabase/functions/pos-oauth-callback/index.ts",
  "utf8",
);

const inventoryHook = readFileSync(
  "src/hooks/use-inventory-data.ts",
  "utf8",
);

describe("POS OAuth hardening", () => {
  it("stores short-lived OAuth nonce state rows", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.pos_oauth_states");
    expect(migration).toContain("expires_at TIMESTAMPTZ NOT NULL");
    expect(migration).toContain("used_at TIMESTAMPTZ");
    expect(migration).toContain("Users can create own pos oauth states");
  });

  it("client sends only an opaque nonce as OAuth state", () => {
    expect(inventoryHook).toContain("const state = crypto.randomUUID()");
    expect(inventoryHook).toContain(".from('pos_oauth_states')");
    expect(inventoryHook).not.toContain("btoa(JSON.stringify");
  });

  it("callback validates origin, expiry, and one-time state consumption", () => {
    expect(callback).toContain(".from(\"pos_oauth_states\")");
    expect(callback).toContain("invalid_redirect");
    expect(callback).toContain("state_already_used");
    expect(callback).toContain("state_expired");
    expect(callback).toContain(".is(\"used_at\", null)");
  });
});
