import { expect, expectNoHorizontalOverflow, test } from "../support/fixtures";

// No horizontal overflow on every route at iPhone SE / 15 / 15 Pro Max widths.
// Runs in every project; meaningful in the iphone-* projects.

export const PUBLIC_ROUTES = [
  "/",
  "/features",
  "/science",
  "/pricing",
  "/paywall",
  "/auth",
  "/contact",
  "/sleep",
  "/reset-password",
  "/legal",
  "/legal/terms",
  "/legal/privacy",
  "/legal/cookies",
  "/legal/disclaimers",
  "/legal/subscription",
  "/legal/third-parties",
];

export const APP_ROUTES = [
  "/dashboard",
  "/companion",
  "/coach",
  "/pilot",
  "/plan",
  "/events",
  "/decisions",
  "/memory",
  "/playbooks",
  "/swap",
  "/health",
  "/safety",
  "/inbox",
  "/automations",
  "/smart-home",
  "/share",
  "/profile",
  "/settings/companion",
  "/settings/avatar",
  "/settings/morning",
  "/settings/skills",
];

test.describe("mobile layout @readonly", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile viewports only");

  for (const path of PUBLIC_ROUTES) {
    test(`no horizontal overflow: ${path} @smoke`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectNoHorizontalOverflow(page, path);
    });
  }

  test("viewport meta does not block zoom", async ({ page }) => {
    await page.goto("/");
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content).toContain("width=device-width");
    expect(content ?? "").not.toMatch(/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/);
  });
});

test.describe("mobile layout (signed in)", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile viewports only");

  for (const path of APP_ROUTES) {
    test(`no horizontal overflow: ${path}`, async ({ authedPage: page }) => {
      await page.goto(path);
      await expect(page.locator("h1, h2").first()).toBeVisible();
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
      await expectNoHorizontalOverflow(page, path);
    });
  }

  test("bottom navigation reaches the main tabs", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    for (const [name, url] of [
      ["Plan", /\/plan/],
      ["Events", /\/events/],
      ["Profile", /\/profile/],
      ["Home", /\/dashboard/],
    ] as const) {
      await page.getByRole("link", { name, exact: true }).last().click();
      await expect(page).toHaveURL(url);
    }
  });
});
