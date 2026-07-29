import { expect, test, type Page } from "../playwright-fixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const userId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-07-28T12:00:00.000Z");
const expiredAt = new Date("2026-07-20T12:00:00.000Z").toISOString();

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const accessToken = [
  encode({ alg: "HS256", typ: "JWT" }),
  encode({
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "local-review@example.invalid",
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
  "local-review-signature",
].join(".");

const user = {
  id: userId,
  aud: "authenticated",
  role: "authenticated",
  email: "local-review@example.invalid",
  email_confirmed_at: now.toISOString(),
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
};

const ingredients = Array.from({ length: 8 }, (_, index) => ({
  id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  user_id: userId,
  name: index === 0 ? "Tomatoes" : `Expired ingredient ${index + 1}`,
  unit: "lbs",
  current_stock: 1,
  threshold: 5,
  reorder_qty: 10,
  vendor: "Local Produce",
  cost_per_unit: 2.5,
  is_perishable: true,
  shelf_life_days: 5,
  storage_type: "fridge",
  calib_factor: 1,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
}));

const lots = ingredients.map((ingredient, index) => ({
  id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  user_id: userId,
  ingredient_id: ingredient.id,
  lot_label: `Expired-${index + 1}`,
  received_at: "2026-07-10T12:00:00.000Z",
  expires_at: expiredAt,
  quantity_received: 5,
  quantity_remaining: 1,
  created_at: now.toISOString(),
  updated_at: now.toISOString(),
}));

const tableData: Record<string, unknown[]> = {
  ingredients,
  lots,
  recipes: [],
  recipe_ingredients: [],
  sales: [],
  vendors: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      user_id: userId,
      name: "Local Produce",
      email: "orders@example.invalid",
      phone: null,
      lead_time_days: 1,
      notes: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
  ],
};

async function mockSupabase(page: Page) {
  await page.route("**/auth/v1/token**", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: accessToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "local-review-refresh-token",
        user,
      }),
    });
  });

  await page.route("**/auth/v1/user", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(user),
    });
  });

  await page.route("**/rest/v1/**", async route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split("/rest/v1/")[1];
    const accept = route.request().headers().accept ?? "";

    if (table === "profiles") {
      const profile = {
        id: userId,
        restaurant_name: "Local Review Diner",
        onboarding_completed: true,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          accept.includes("application/vnd.pgrst.object+json") ? profile : [profile],
        ),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/*" },
      body: JSON.stringify(tableData[table] ?? []),
    });
  });
}

test.describe("authenticated workspace", () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.goto("/auth");
    await page.getByLabel("Email").fill("local-review@example.invalid");
    await page.getByLabel("Password").fill("local-review-password");
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("heading", { name: "Local Review Diner" })).toBeVisible();
  });

  test("keeps inventory usable on narrow screens and labels repeated actions", async ({ page }, testInfo) => {
    await page.getByRole("button", { name: /Open Inventory/ }).click();
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Tomatoes" })).toBeVisible();
    await expect(page.getByLabel("Search inventory")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    await page.getByLabel("Search inventory").fill("tomato");
    await expect(page.getByRole("button", { name: "Delete Tomatoes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Expired ingredient 2" })).toHaveCount(0);

    if (process.env.CAPTURE_REVIEW_SCREENSHOTS === "1") {
      const screenshotDirectory = resolve("docs/review-screenshots");
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: resolve(screenshotDirectory, `inventory-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }
  });

  test("hides the closed Shift Assistant from the accessibility tree", async ({ page }) => {
    await expect(page.getByRole("dialog", { name: "Shift Assistant" })).toHaveCount(0);
  });
});
