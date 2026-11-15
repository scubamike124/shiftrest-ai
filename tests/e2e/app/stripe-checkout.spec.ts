import { blocked, expect, test } from "../support/fixtures";

// Stripe checkout: TEST MODE ONLY, against RestPilot's own Stripe account.
// Needs the owner-provided GitHub secret E2E_STRIPE_TEST_SECRET_KEY (sk_test_...)
// and a build with checkout enabled. Without them every test here reports
// "blocked: needs Stripe TEST key" - it never fakes a successful payment.

const key = process.env.E2E_STRIPE_TEST_SECRET_KEY ?? "";

test.describe("Stripe checkout @stripe", () => {
  test.beforeAll(() => {
    if (
      /^(sk|rk)_live_/.test(key) ||
      /^pk_live_/.test(process.env.E2E_STRIPE_TEST_PUBLISHABLE_KEY ?? "")
    ) {
      throw new Error(
        "Refusing to run: a LIVE Stripe key was supplied. Only sk_test_/pk_test_ keys are allowed.",
      );
    }
  });

  test.beforeEach(() => {
    if (!key.startsWith("sk_test_"))
      blocked("needs Stripe TEST key (GitHub secret E2E_STRIPE_TEST_SECRET_KEY, sk_test_...)");
  });

  test("monthly plan opens a Stripe test-mode checkout for $7.99", async ({ authedPage: page }) => {
    await page.goto("/pricing");
    const choose = page
      .getByRole("button", { name: /monthly/i })
      .or(page.getByRole("link", { name: /monthly/i }))
      .first();
    if ((await choose.count()) === 0)
      blocked(
        "checkout is disabled on this build (App Preview mode); needs the subscriptions build with Stripe test mode enabled",
      );
    await choose.click();
    const frame = page.frameLocator('iframe[src*="stripe.com"]').first();
    await expect(frame.getByText(/\$7\.99/).first()).toBeVisible({ timeout: 30_000 });
    await expect(frame.getByText(/test mode|TEST MODE/i).first()).toBeVisible();
  });

  test("annual plan shows $49.99 with the 14-day trial", async ({ authedPage: page }) => {
    await page.goto("/pricing");
    const choose = page
      .getByRole("button", { name: /annual/i })
      .or(page.getByRole("link", { name: /annual/i }))
      .first();
    if ((await choose.count()) === 0)
      blocked(
        "checkout is disabled on this build (App Preview mode); needs the subscriptions build with Stripe test mode enabled",
      );
    await choose.click();
    const frame = page.frameLocator('iframe[src*="stripe.com"]').first();
    await expect(frame.getByText(/\$49\.99/).first()).toBeVisible({ timeout: 30_000 });
    await expect(frame.getByText(/14 days? free|14-day/i).first()).toBeVisible();
  });

  test("test card 4242 completes and the subscription becomes active", async ({
    authedPage: page,
  }) => {
    await page.goto("/pricing");
    const choose = page
      .getByRole("button", { name: /monthly/i })
      .or(page.getByRole("link", { name: /monthly/i }))
      .first();
    if ((await choose.count()) === 0)
      blocked(
        "checkout is disabled on this build (App Preview mode); needs the subscriptions build with Stripe test mode enabled",
      );
    await choose.click();
    const frame = page.frameLocator('iframe[src*="stripe.com"]').first();
    await frame.getByPlaceholder(/1234 1234 1234 1234/).fill("4242 4242 4242 4242");
    await frame.getByPlaceholder(/MM \/ YY/).fill("12 / 34");
    await frame.getByPlaceholder(/CVC/).fill("123");
    await frame.getByRole("button", { name: /Subscribe|Start trial|Pay/i }).click();
    await expect(page.getByText(/active|welcome|thank you/i).first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
