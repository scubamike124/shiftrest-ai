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

  test("bottom navigation first enabled tap survives delayed bootstrap @smoke", async ({
    authedPage: page,
  }) => {
    let release!: () => void;
    const bootstrap = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/assets/*.js", async (route) => {
      await bootstrap;
      await route.continue();
    });
    try {
      await page.goto("/dashboard", { waitUntil: "commit" });
      const nav = page.getByRole("navigation", { name: "App", exact: true });
      const plan = nav.getByRole("link", { name: "Plan", exact: true });
      await expect(nav).toBeVisible();
      await expect(nav).toHaveAttribute("aria-busy", "true");
      await expect(plan).toBeDisabled();
      await expect(plan).not.toHaveAttribute("href");
      await expect(plan).toHaveAttribute("tabindex", "-1");
      await page.evaluate(() => {
        (window as Window & { navigationDocument?: boolean }).navigationDocument = true;
      });
      release();
      // No dashboard-heading/data wait: the first enabled tap is the contract.
      await plan.click();
      await expect(page).toHaveURL(/\/plan$/);
      await expect(page.getByRole("heading", { name: "Today's light plan." })).toBeVisible();
      await expect(plan).toHaveAttribute("aria-current", "page");
      expect(
        await page.evaluate(
          () => (window as Window & { navigationDocument?: boolean }).navigationDocument,
        ),
      ).toBe(true);
    } finally {
      release();
      await page.unroute("**/assets/*.js");
    }
  });

  test("bottom navigation reaches the main tabs @smoke", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "App", exact: true });
    for (const [name, url, heading] of [
      ["Plan", /\/plan$/, "Today's light plan."],
      ["Events", /\/events$/, "Events"],
      ["Profile", /\/profile$/, "Your preferences"],
    ] as const) {
      const link = nav.getByRole("link", { name, exact: true });
      await link.click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "page");
    }
    const home = nav.getByRole("link", { name: "Home", exact: true });
    await home.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("button", { name: /Log today.s shift/i })).toBeVisible();
    await expect(home).toHaveAttribute("aria-current", "page");
  });
});
