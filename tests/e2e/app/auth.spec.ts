import crypto from "node:crypto";
import { collectErrors, expect, test } from "../support/fixtures";

const email = () => `signup-${crypto.randomBytes(5).toString("hex")}@e2e.restpilot.test`;

test.describe("sign-up and sign-in", () => {
  test("new account: terms must be accepted, then the account is created @smoke", async ({
    page,
    backend,
  }) => {
    const errors = collectErrors(page);
    const address = email();
    await page.goto("/auth");
    await page.getByRole("button", { name: /New here\? Create an account/i }).click();
    await page.getByLabel("Email address").fill(address);
    await page.getByLabel("Password").fill("Nightshift-2026!");
    const create = page.getByRole("button", { name: "Create Account" });
    await expect(create, "cannot sign up before accepting the terms").toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page.getByText(/Check your email to confirm your account/i)).toBeVisible();
    const dump = await backend.dump(address);
    expect(dump.userExists).toBe(true);
    expect(dump.tables.profiles?.length, "profile row created").toBe(1);
    expect(errors).toEqual([]);
  });

  test("existing account signs in and lands on the dashboard @smoke", async ({ page, user }) => {
    await page.goto("/auth");
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("heading", { name: /Good (morning|afternoon|evening)/i }),
    ).toBeVisible();
  });

  test("wrong password is rejected with a clear message", async ({ page, user }) => {
    await page.goto("/auth");
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page.getByText(/Invalid login credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth/);
  });

  test("protected pages redirect to sign-in and return afterwards @smoke", async ({
    page,
    user,
  }) => {
    await page.goto("/events");
    await expect(page).toHaveURL(/\/auth\?return=%2Fevents/);
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/events$/);
  });

  // Guard for QA-REPORT R2 (fixed on the Railway branch): signing in from
  // /memory used to land on /dashboard because SAFE_RETURNS omitted it.
  test("return target is honoured for /memory too", async ({ page, user }) => {
    await page.goto("/memory");
    await expect(page).toHaveURL(/\/auth\?return=%2Fmemory/);
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(/\/memory$/, { timeout: 5_000 });
  });

  test("forgot password sends a reset request without revealing whether the account exists", async ({
    page,
    backend,
    user,
  }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: /Forgot Password/i }).click();
    await expect(page.getByText(/Enter your email first/i)).toBeVisible();
    await page.getByLabel("Email address").fill(user.email);
    await page.getByRole("button", { name: /Forgot Password/i }).click();
    await expect(page.getByText(/If that email exists, a reset link is on the way/i)).toBeVisible();
    // auth-email log entries are global, so match this user's address.
    await expect
      .poll(async () =>
        (await backend.dump(user.email)).log.some(
          (l) =>
            l.type === "auth-email" &&
            (l as { path?: string }).path === "/recover" &&
            (l as { body?: { email?: string } }).body?.email === user.email,
        ),
      )
      .toBe(true);
  });

  test("sign out ends the session", async ({ authedPage: page }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: /Sign Out/i }).click();
    await expect(page).toHaveURL(/\/auth/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth/);
  });

  test("Google sign-in is offered on the web", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });
});
