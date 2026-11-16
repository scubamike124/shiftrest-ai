import fs from "node:fs";
import { expect, test } from "../support/fixtures";

// Settings, appearance, privacy controls, data export, AI memory deletion and
// account deletion. Every destructive action runs on a throwaway user in the
// hermetic backend and is verified there.

const MEMORY = (content: string, extra: Record<string, unknown> = {}) => ({
  content,
  category: "schedule",
  source: "user",
  pinned: false,
  importance: 4,
  confidence: 0.9,
  use_count: 0,
  superseded_by: null,
  expires_at: null,
  updated_at: new Date().toISOString(),
  ...extra,
});

test.describe("settings pages", () => {
  for (const [path, heading] of [
    ["/settings/companion", /Daily Companion/i],
    ["/settings/avatar", /Choose your Companion/i],
    ["/settings/morning", /Morning Brief/i],
    ["/settings/skills", /Companion Skills/i],
    ["/profile", /Your preferences/i],
  ] as const) {
    test(`${path} renders`, async ({ authedPage: page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    });
  }

  test("/settings redirects to the companion settings hub", async ({ authedPage: page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/companion/);
  });

  test("assistant name and personality are saved @smoke", async ({
    authedPage: page,
    backend,
    user,
  }) => {
    await page.goto("/profile");
    await page
      .getByRole("button", { name: /^Companion/ })
      .first()
      .click();
    await expect
      .poll(async () => (await backend.dump(user.email)).tables.user_prefs?.[0]?.assistant_mode, {
        message: "assistant_mode saved",
      })
      .toBe("companion");
  });

  test("morning brief settings save", async ({ authedPage: page, backend, user }) => {
    await page.goto("/settings/morning");
    await page.getByRole("button", { name: "Hide Weather" }).click();
    await page.getByRole("button", { name: /Save changes/i }).click();
    // The saved layout must record the change (weather hidden), not just exist.
    await expect
      .poll(async () =>
        JSON.stringify(
          (await backend.dump(user.email)).tables.user_prefs?.[0]?.brief_layout ?? null,
        ),
      )
      .toMatch(/"morning":\{[^}]*"hidden":\[[^\]]*"weather"/);
    // And it survives a reload: the card now offers "Show Weather".
    await page.reload();
    await expect(page.getByRole("button", { name: "Show Weather" })).toBeVisible();
  });

  test("appearance: theme changes and survives reload @smoke", async ({
    authedPage: page,
    user,
  }) => {
    await page.goto("/profile");
    // Wait for the signed-in profile and its per-user appearance scope. An
    // immediate count during hydration used to turn this journey into a skip.
    await expect(page.getByText(user.email, { exact: true })).toBeVisible();
    const appearance = page.getByRole("region", { name: "Appearance", exact: true });
    await expect(appearance).toBeVisible();
    const light = appearance.getByRole("radio", { name: "Soft Light", exact: true });
    await expect(light).not.toBeChecked();
    await light.locator("xpath=ancestor::label[1]").click();
    await expect(light).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(page.getByText(user.email, { exact: true })).toBeVisible();
    await expect(light).toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

test.describe("privacy and data", () => {
  test.use({
    seedTables: {
      ai_memory: [
        MEMORY("Works nights at County General"),
        MEMORY("Prefers ocean sounds", { category: "preferences" }),
      ],
    },
  });

  test("privacy policy and memory controls are reachable from the profile", async ({
    authedPage: page,
  }) => {
    await page.goto("/profile");
    await expect(page.getByRole("link", { name: /Privacy Policy/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Export my data/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Erase AI memory/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Delete Account/i })).toBeVisible();
  });

  test("data export downloads the user's own data as JSON @smoke", async ({
    authedPage: page,
    backend,
    user,
  }) => {
    // A second account with its own memory: none of it may appear in this export.
    const other = `qa-other-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@e2e.restpilot.test`;
    await backend.seed([{ email: other, password: "Rp-other-2026!" }], {
      ai_memory: [{ user_email: other, ...MEMORY("Other user's secret night roster") }],
    });
    await page.goto("/profile");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export my data/i }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^restpilot-export-\d{4}-\d{2}-\d{2}\.json$/);
    const json = JSON.parse(fs.readFileSync((await file.path())!, "utf8"));
    expect(JSON.stringify(json)).toContain(user.email);
    expect(JSON.stringify(json)).toContain("Works nights at County General");
    expect(JSON.stringify(json)).not.toContain("Other user's secret night roster");
    expect(JSON.stringify(json)).not.toContain(other);
    await expect(page.getByText(/Your data export was downloaded/i)).toBeVisible();
  });

  test("a single AI memory can be deleted on the memory page", async ({
    authedPage: page,
    backend,
    user,
  }) => {
    await page.goto("/memory");
    await expect(page.getByText("Prefers ocean sounds")).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Prefers ocean sounds" });
    page.once("dialog", (d) => d.accept());
    await row.getByRole("button", { name: /Forget this/i }).click();
    await expect(page.getByText("Prefers ocean sounds")).toHaveCount(0);
    const mem = (await backend.dump(user.email)).tables.ai_memory ?? [];
    expect(mem.map((m) => m.content)).toEqual(["Works nights at County General"]);
  });

  test("erase all AI memory clears memories, patterns and recommendations @smoke", async ({
    authedPage: page,
    backend,
    user,
  }) => {
    await page.goto("/profile");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /Erase AI memory/i }).click();
    await expect(page.getByText(/AI memory cleared/i)).toBeVisible();
    const t = (await backend.dump(user.email)).tables;
    for (const name of [
      "ai_memory",
      "ai_memory_proposals",
      "ai_recommendations",
      "ai_patterns",
      "ai_feedback",
    ]) {
      expect(t[name] ?? [], `${name} cleared`).toHaveLength(0);
    }
  });

  test("account deletion requires typing DELETE, removes data and signs out @smoke", async ({
    authedPage: page,
    backend,
    user,
  }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: /Delete Account/i }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("heading", { name: /Delete your account\?/i })).toBeVisible();
    const confirm = dialog.getByRole("button", { name: /^Delete account$/i });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Type DELETE to confirm/i).fill("delete");
    await expect(confirm, "confirmation is case-sensitive").toBeDisabled();
    await dialog.getByLabel(/Type DELETE to confirm/i).fill("DELETE");
    await confirm.click();
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.getByText(/Account deleted/i)).toBeVisible();
    const after = await backend.dump(user);
    expect(after.userExists, "auth user removed").toBe(false);
    expect(after.tables.ai_memory ?? []).toHaveLength(0);
    expect(after.tables.user_prefs ?? []).toHaveLength(0);
  });

  test("keep account cancels deletion", async ({ authedPage: page, backend, user }) => {
    await page.goto("/profile");
    await page.getByRole("button", { name: /Delete Account/i }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /Keep account/i })
      .click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect((await backend.dump(user.email)).userExists).toBe(true);
  });
});

test.describe("cookie consent", () => {
  test.use({ cookieConsent: false });

  test("banner offers reject-non-essential and remembers the choice", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Reject non-essential/i }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: /Reject non-essential/i })).toHaveCount(0);
  });
});

test.describe("AI data-sharing permission (#62)", () => {
  test.use({ seedTables: { user_prefs: [{ consent_json: {} }] } });

  // Requests that would carry the user's data to an AI provider.
  const AI_ROUTES = /\/api\/(ai|brief|insights|swap|stt|tts|tts-elevenlabs)(\?|$)/;

  test("first AI use asks for permission; Allow is saved and AI then works", async ({
    authedPage: page,
    backend,
    user,
  }) => {
    await page.goto("/coach");
    const dialog = page.getByRole("alertdialog", { name: /Allow AI features\?/ });
    // The dialog opens before the first AI request; send one if the page did not.
    if (!(await dialog.isVisible().catch(() => false))) {
      const box = page.getByRole("textbox").first();
      await box.fill("When should I stop caffeine?");
      await box.press("Enter");
    }
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Allow" }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(
        async () =>
          ((await backend.dump(user.email)).tables.user_prefs?.[0]?.consent_json ?? {}) as Record<
            string,
            unknown
          >,
      )
      .toHaveProperty("ai_data_sharing");
    // After Allow, a coach message reaches /api/ai and is answered.
    const answered = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/ai" && r.request().method() === "POST",
      { timeout: 20_000 },
    );
    const box = page.getByRole("textbox").first();
    await box.fill("When should I take caffeine before a night shift?");
    await box.press("Enter");
    expect((await answered).status()).toBe(200);
  });

  test("Not now keeps AI off and sends nothing", async ({ authedPage: page, backend, user }) => {
    const sent: string[] = [];
    page.on("request", (r) => {
      if (AI_ROUTES.test(new URL(r.url()).pathname)) sent.push(`${r.method()} ${r.url()}`);
    });
    await page.goto("/coach");
    const dialog = page.getByRole("alertdialog", { name: /Allow AI features\?/ });
    if (!(await dialog.isVisible().catch(() => false))) {
      const box = page.getByRole("textbox").first();
      await box.fill("When should I stop caffeine?");
      await box.press("Enter");
    }
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Not now" }).click();
    await expect(dialog).toBeHidden();
    await page.waitForLoadState("networkidle");
    expect(sent, "no request may reach an AI route after Not now").toEqual([]);
    const prefs = (await backend.dump(user.email)).tables.user_prefs?.[0] ?? {};
    expect((prefs.consent_json ?? {}) as Record<string, unknown>).not.toHaveProperty(
      "ai_data_sharing",
      expect.any(String),
    );
  });
});
