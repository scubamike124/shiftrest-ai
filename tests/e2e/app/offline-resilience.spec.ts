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
    // Let the AI cards finish loading first; cards that fail while offline are R6 (below).
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    try {
      await expect(page.getByText(/offline/i).first()).toBeVisible();
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
    await expect(page.getByText(/You're offline|offline/i)).toHaveCount(0, { timeout: 15_000 });
  });

  // KNOWN DEFECT (QA-REPORT R6): an AI card whose request fails while offline
  // keeps "You're offline…" after the connection returns, until "Try again".
  // Flips to an unexpected pass once the cards retry on reconnect.
  test("AI cards that failed offline recover when the connection returns", async ({
    authedPage: page,
    context,
  }) => {
    test.fail(true, "R6: AI cards do not retry on reconnect");
    // Hold the cards' AI requests, drop the connection, then let them fail.
    let held!: () => void;
    const firstHeld = new Promise<void>((r) => (held = r));
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    await page.route("**/api/ai", async (route) => {
      held();
      await released;
      await route.abort("internetdisconnected");
    });
    await page.goto("/dashboard");
    await firstHeld;
    await context.setOffline(true);
    release();
    const stuck = page.getByText(/You're offline and I don't have a cached version/);
    try {
      await expect(stuck.first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await page.unroute("**/api/ai");
      await context.setOffline(false);
    }
    await expect(stuck).toHaveCount(0, { timeout: 20_000 });
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

    // R1 regression guard: valid model JSON that omits fields or uses an unknown
    // enum (urgency "critical") used to crash the whole dashboard. Fixed by #36
    // (server-side intent schema validation + per-card error boundaries).
    test("dashboard survives model JSON that omits fields", async ({ authedPage: page }) => {
      // Wait until the AI JSON card request has completed (the server may now
      // reject the drifted JSON with an error status; either way: no crash).
      const aiJson = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/ai") && r.request().postData()?.includes('"right_now"') === true,
      );
      await page.goto("/dashboard");
      await aiJson;
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1_000);
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0, { timeout: 1_000 });
    });
  });
});
