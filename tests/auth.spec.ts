import { expect, test } from "../playwright-fixture";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test.describe("public authentication", () => {
  test("is labeled, keyboard-accessible, and fits the viewport", async ({ page }, testInfo) => {
    await page.goto("/auth");

    await expect(page.getByRole("heading", { name: "Mise en Place" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
    await expect(page.getByRole("button", { name: "Log in", pressed: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign up", pressed: false })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);

    if (process.env.CAPTURE_REVIEW_SCREENSHOTS === "1") {
      const screenshotDirectory = resolve("docs/review-screenshots");
      mkdirSync(screenshotDirectory, { recursive: true });
      await page.screenshot({
        path: resolve(screenshotDirectory, `authentication-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }

    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();

    await page.getByRole("button", { name: "Log in" }).click();
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset Password" })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
  });
});
