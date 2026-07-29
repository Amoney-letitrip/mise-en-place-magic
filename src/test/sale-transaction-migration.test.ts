import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const saleMigration = readFileSync(
  "supabase/migrations/20260427000200_record_sale_transaction.sql",
  "utf8",
);

const invoiceMigration = readFileSync(
  "supabase/migrations/20260427000100_invoice_lot_purchase_metadata.sql",
  "utf8",
);
const countMigration = readFileSync(
  "supabase/migrations/20260728000200_reconcile_inventory_counts.sql",
  "utf8",
);
const wasteMigration = readFileSync(
  "supabase/migrations/20260728000300_record_waste_transaction.sql",
  "utf8",
);

describe("sale transaction migration", () => {
  it("records sales through a dedicated RPC", () => {
    expect(saleMigration).toContain("CREATE OR REPLACE FUNCTION public.record_sale_transaction");
    expect(saleMigration).toContain("GRANT EXECUTE ON FUNCTION public.record_sale_transaction");
  });

  it("flags sales instead of overdrawing inventory", () => {
    expect(saleMigration).toContain("v_line.deduct_qty > v_line.current_stock");
    expect(saleMigration).toContain("Inventory check failed:");
    expect(saleMigration).toContain("RETURN QUERY SELECT 'flagged'::TEXT");
  });

  it("deducts ingredient and lot stock only after validation passes", () => {
    const validationIndex = saleMigration.indexOf("IF v_issue IS NOT NULL THEN");
    const saleInsertIndex = saleMigration.indexOf("VALUES (v_recipe.name, v_qty, 'processed'");
    const stockUpdateIndex = saleMigration.indexOf("SET current_stock = current_stock - v_line.deduct_qty");
    const lotUpdateIndex = saleMigration.indexOf("SET quantity_remaining = round(quantity_remaining - v_take, 3)");

    expect(validationIndex).toBeGreaterThan(-1);
    expect(saleInsertIndex).toBeGreaterThan(validationIndex);
    expect(stockUpdateIndex).toBeGreaterThan(saleInsertIndex);
    expect(lotUpdateIndex).toBeGreaterThan(stockUpdateIndex);
  });
});

describe("invoice lot metadata migration", () => {
  it("adds purchase metadata needed by invoice import", () => {
    expect(invoiceMigration).toContain("ADD COLUMN IF NOT EXISTS cost_per_unit");
    expect(invoiceMigration).toContain("ADD COLUMN IF NOT EXISTS vendor");
    expect(invoiceMigration).toContain("ADD COLUMN IF NOT EXISTS notes");
  });
});

describe("cycle count reconciliation migration", () => {
  it("updates ingredient and lot stock in one authenticated transaction", () => {
    expect(countMigration).toContain("CREATE OR REPLACE FUNCTION public.reconcile_inventory_counts");
    expect(countMigration).toContain("SECURITY DEFINER");
    expect(countMigration).toContain("auth.uid()");
    expect(countMigration).toContain("UPDATE public.lots");
    expect(countMigration).toContain("UPDATE public.ingredients");
    expect(countMigration).toContain("GRANT EXECUTE ON FUNCTION public.reconcile_inventory_counts");
  });

  it("creates an adjustment lot when a physical count exceeds lot totals", () => {
    expect(countMigration).toContain("Cycle count adjustment");
    expect(countMigration).toContain("ELSIF v_lot_total < v_target");
  });
});

describe("waste transaction migration", () => {
  it("records waste and updates stock atomically", () => {
    expect(wasteMigration).toContain("CREATE TABLE IF NOT EXISTS public.waste_events");
    expect(wasteMigration).toContain("CREATE OR REPLACE FUNCTION public.record_waste_transaction");
    expect(wasteMigration).toContain("UPDATE public.lots");
    expect(wasteMigration).toContain("UPDATE public.ingredients");
    expect(wasteMigration).toContain("INSERT INTO public.waste_events");
    expect(wasteMigration).toContain("GRANT EXECUTE ON FUNCTION public.record_waste_transaction");
  });
});
