import { collectErrors, expect, test } from "../support/fixtures";

// Marketing, legal and other public pages. GET-only, so they also run as the
// read-only smoke against staging/production (E2E_BASE_URL).

const MARKETING = [
  { path: "/", h1: /AI companion that helps you sleep better/i },
  { path: "/features", h1: /./ },
  { path: "/science", h1: /./ },
  { path: "/contact", h1: /./ },
  { path: "/legal", h1: /Legal/i },
  { path: "/sleep", h1: /Build your soundscape/i },
] as const;

const LEGAL = [
  "terms",
  "privacy",
  "cookies",
  "disclaimers",
  "subscription",
  "acceptable-use",
  "accessibility",
  "copyright",
  "electronic-consent",
  "license",
  "open-source",
  "regional",
  "security",
  "third-parties",
  "trademark",
];

test.describe("marketing pages @readonly", () => {
  for (const { path, h1 } of MARKETING) {
    test(`${path} renders without errors @smoke`, async ({ page }) => {
      const errors = collectErrors(page);
      const res = await page.goto(path);
      expect(res?.status(), `${path} status`).toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("h1").first()).toHaveText(h1);
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
      expect(errors, `${path} console errors`).toEqual([]);
    });
  }

  for (const [path, date] of [
    ["/legal", "June 27, 2026"],
    ["/legal/terms", "June 27, 2026"],
    ["/legal/privacy", "November 15, 2026"],
  ] as const) {
    test(`${path}: policy date matches SSR after hydration @smoke`, async ({ page, request }) => {
      const errors = collectErrors(page);
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      // Check the actual server response as well as the hydrated browser text.
      expect(await response.text()).toContain(date);
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("body")).toContainText(
        path === "/legal" ? `Effective ${date}.` : `Effective: ${date}`,
      );
      // Prove client navigation is active, so a static SSR page cannot hide a
      // recoverable hydration mismatch. A document reload would lose this flag.
      await page.evaluate(() => {
        (window as Window & { legalHydrationProbe?: boolean }).legalHydrationProbe = true;
      });
      const next = path === "/legal/privacy" ? "terms" : "privacy";
      const linkName = next === "terms" ? "Terms of Service" : "Privacy Policy";
      await page.getByRole("link", { name: linkName, exact: true }).last().click();
      await expect(page).toHaveURL(new RegExp(`/legal/${next}$`));
      expect(
        await page.evaluate(
          () => (window as Window & { legalHydrationProbe?: boolean }).legalHydrationProbe,
        ),
      ).toBe(true);
      expect(errors, `${path} hydration errors`).toEqual([]);
    });
  }

  test("home: primary calls to action lead to sign-up and the app preview @smoke", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/RestPilot/);
    const getStarted = page.getByRole("link", { name: /Get started/i }).first();
    await expect(getStarted).toBeVisible();
    await expect(getStarted).toHaveAttribute("href", /\/auth/);
    await expect(page.getByRole("link", { name: /Sign in/i }).first()).toHaveAttribute(
      "href",
      /\/auth/,
    );
    await expect(page.getByRole("link", { name: /app preview/i }).first()).toHaveAttribute(
      "href",
      /\/(pricing|paywall|auth)/,
    );
  });

  test("footer links to every policy the sign-up form references", async ({ page }) => {
    await page.goto("/");
    for (const name of [/Terms of Service/i, /Privacy Policy/i, /Cookie Policy/i]) {
      await expect(page.getByRole("link", { name }).first()).toBeVisible();
    }
  });

  for (const slug of LEGAL) {
    test(`legal/${slug} is published`, async ({ page }) => {
      const res = await page.goto(`/legal/${slug}`);
      expect(res?.status()).toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
      await expect(page.locator("main, article, body").first()).toContainText(/RestPilot/i);
    });
  }

  test("/privacy and /terms redirect to the legal pages", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page).toHaveURL(/\/legal\/privacy/);
    await page.goto("/terms");
    await expect(page).toHaveURL(/\/legal\/terms/);
  });

  test("unknown routes show a not-found page, not a crash", async ({ page }) => {
    const res = await page.goto("/this-page-does-not-exist-qa");
    expect([200, 404]).toContain(res?.status());
    await expect(page.getByText(/not found|404|doesn.t exist|can.t find/i).first()).toBeVisible();
  });
});

test.describe("platform basics @readonly", () => {
  test("security headers, manifest and service worker are served @smoke", async ({ request }) => {
    const home = await request.get("/");
    expect(home.status()).toBe(200);
    const csp = home.headers()["content-security-policy"] ?? "";
    expect(csp, "CSP header").toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors");
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    expect((await manifest.json()).name).toMatch(/RestPilot/);
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(await sw.text()).not.toContain("__WB_MANIFEST");
    const health = await request.get("/api/public/health");
    expect(health.status()).toBe(200);
  });

  test("robots.txt and sitemap point at the owned domain", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/Sitemap:\s*https:\/\/restpilotai\.com\//);
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain("<urlset");
  });
});

// Not @readonly: sends (rejected) POSTs, so it never runs against a live site.
test.describe("API guards", () => {
  test("AI and account APIs refuse anonymous callers", async ({ request }) => {
    const ai = await request.post("/api/ai", {
      data: { intent: "coach", messages: [{ role: "user", content: "hi" }] },
    });
    expect([401, 403]).toContain(ai.status());
    const insights = await request.post("/api/insights", { data: { context: "x" } });
    expect([401, 403]).toContain(insights.status());
  });
});
