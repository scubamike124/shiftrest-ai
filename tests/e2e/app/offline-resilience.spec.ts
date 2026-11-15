import { collectErrors, expect, sendChat, test } from "../support/fixtures";

// Offline behaviour (service worker + offline banner) and resilience when the
// AI provider misbehaves.

test.describe("offline @offline", () => {
  test("a visited page reopens offline from the service worker", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Playwright WebKit does not run service workers offline reliably; covered by Chromium and the iOS checklist",
    );
    await page.goto("/");
    await page.waitForFunction(async () => Boolean(await navigator.serviceWorker?.ready), null, {
      timeout: 20_000,
    });
    // A second visit goes through the now-controlling worker and is cached.
    const warm = await context.newPage();
    await warm.goto("/");
    await warm.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
      timeout: 20_000,
    });
    await warm.close();
    await context.setOffline(true);
    try {
      const offline = await context.newPage();
      await offline.goto("/");
      await expect(offline.locator("h1").first()).toBeVisible();
      await expect(offline).toHaveTitle(/RestPilot/);
    } finally {
      await context.setOffline(false);
    }
  });

  test("dashboard shows the offline banner instead of failing @smoke", async ({
    authedPage: page,
    context,
  }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: /Good (morning|afternoon|evening)/i }),
    ).toBeVisible();
    await context.setOffline(true);
    try {
      await expect(page.getByText(/offline/i).first()).toBeVisible();
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
    await expect(page.getByText(/You're offline|offline/i)).toHaveCount(0, { timeout: 15_000 });
  });
});

test.describe("AI provider resilience", () => {
  test.describe("upstream errors", () => {
    test.use({ seedTables: { user_prefs: [{ assistant_name: "E2EUpstreamError" }] } });

    test("companion shows a recoverable error when the model is down", async ({
      authedPage: page,
    }) => {
      await page.goto("/companion");
      await sendChat(page, /Message your Companion/i, "Can I nap before my shift?");
      await expect(
        page.getByText(/couldn.t|try again|unavailable|failed|went wrong/i).first(),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: /^Send$/ })).toBeVisible();
    });

    test("dashboard still renders when AI cards fail", async ({ authedPage: page }) => {
      const errors = collectErrors(page);
      await page.goto("/dashboard");
      await expect(
        page.getByRole("heading", { name: /Good (morning|afternoon|evening)/i }),
      ).toBeVisible();
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
      expect(errors.filter((e) => e.startsWith("pageerror"))).toEqual([]);
    });
  });

  test.describe("schema drift", () => {
    test.use({ seedTables: { user_prefs: [{ assistant_name: "E2EMalformedJson" }] } });

    // KNOWN REGRESSION RISK (QA-REPORT R1): /api/ai returns model JSON to the UI
    // unvalidated. Valid JSON that omits fields or uses an unknown enum (e.g.
    // urgency "critical") crashes the whole dashboard ("Something went wrong").
    // test.fail() keeps CI green while documenting it; once the AI routes
    // validate their JSON this starts passing, and Playwright flags it so the
    // marker can be removed.
    test.fail();
    test("dashboard survives model JSON that omits fields", async ({ authedPage: page }) => {
      // Wait until the AI JSON cards have actually received the drifted JSON.
      const aiJson = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/ai") &&
          r.request().postData()?.includes('"right_now"') === true &&
          r.status() === 200,
      );
      await page.goto("/dashboard");
      await aiJson;
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1_000);
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0, { timeout: 1_000 });
    });
  });
});
