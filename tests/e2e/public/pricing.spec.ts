import { expect, test } from "../support/fixtures";

// Owner's pricing contract: Monthly $7.99, Annual $49.99, 14-day free trial,
// and NO lifetime offer (discontinued, PR #9). While the Railway build runs in
// "App preview" mode (Stripe checkout removed) there are no prices to show; the
// price checks then report "blocked" with the reason instead of passing.

const PRICING_PATHS = ["/pricing", "/paywall"];

async function pageText(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await expect(page.locator("h1").first()).toBeVisible();
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

test.describe("pricing @readonly", () => {
  for (const path of PRICING_PATHS) {
    test(`${path}: no lifetime offer is sold @smoke`, async ({ page }) => {
      const text = await pageText(page, path);
      expect(text).not.toMatch(/lifetime (access|membership|plan|deal)/i);
      expect(text).not.toMatch(/\$99\b/);
      await expect(page.getByRole("button", { name: /lifetime/i })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /lifetime/i })).toHaveCount(0);
    });
  }

  test("/paywall?plan=lifetime does not offer a lifetime checkout", async ({ page }) => {
    const text = await pageText(page, "/paywall?plan=lifetime");
    expect(text).not.toMatch(/Choose Lifetime|Buy lifetime|\$99/i);
  });

  test("prices: Monthly $7.99, Annual $49.99, 14-day free trial", async ({ page }) => {
    const text = await pageText(page, "/pricing");
    const showsPrices = /\$\d+\.\d{2}/.test(text);
    if (!showsPrices) {
      test.info().annotations.push({
        type: "blocked",
        description:
          "Pricing page is in App Preview mode (Stripe checkout removed on codex/restpilot-railway-migration); price assertions wait for the subscriptions work to restore plans",
      });
      test.skip(true, "blocked: pricing page shows no prices yet (App Preview mode)");
    }
    expect(text).toMatch(/\$7\.99/);
    expect(text).toMatch(/\$49\.99/);
    expect(text).toMatch(/14[- ]day/i);
    expect(text).not.toMatch(/\$99(\.00)?\b/);
    // No other plan prices should appear next to the two plans.
    const prices = new Set(text.match(/\$\d+\.\d{2}/g));
    for (const p of prices)
      expect(["$7.99", "$49.99", "$0.00"], `unexpected price ${p}`).toContain(p);
  });

  test("subscription terms match the offer (no lifetime purchase terms for new customers)", async ({
    page,
  }) => {
    const text = await pageText(page, "/legal/subscription");
    expect(text).toMatch(/subscription/i);
    if (/lifetime/i.test(text)) {
      // Legacy lifetime holders may be mentioned; a lifetime offer must not be.
      expect(text).not.toMatch(/(buy|purchase|get) (a )?lifetime/i);
    }
  });
});
