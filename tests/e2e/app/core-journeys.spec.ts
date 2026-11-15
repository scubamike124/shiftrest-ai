import { collectErrors, expect, sendChat, test } from "../support/fixtures";

// Signed-in product journeys against the hermetic backend: dashboard, AI
// companion ("Lisa") and coach chat, voice UI, sleep planner, calendar/events,
// shift scheduler, sound mixer and recovery tools.

const NOW = Date.now();
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

test.describe("dashboard", () => {
  test.use({
    seedTables: {
      shifts: [
        {
          day: 0,
          week_index: 0,
          start_min: 19 * 60,
          end_min: 7 * 60,
          title: "Night shift - 4W",
          start_utc: iso(5),
          end_utc: iso(17),
        },
        {
          day: 1,
          week_index: 0,
          start_min: 19 * 60,
          end_min: 7 * 60,
          title: "Night shift - 4W",
          start_utc: iso(29),
          end_utc: iso(41),
        },
      ],
    },
  });

  test("renders the brief, week and recovery widgets without errors @smoke", async ({
    authedPage: page,
  }) => {
    const errors = collectErrors(page);
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: /Good (morning|afternoon|evening)/i }),
    ).toBeVisible();
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    // AI brief rendered from the (fake) model through /api/insights.
    await expect(page.getByText("Protect tonight's sleep window").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Next 7 Days/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Soundscape Mixer/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("water tracker counts glasses", async ({ authedPage: page }) => {
    await page.goto("/dashboard");
    const add = page.getByRole("button", { name: "Add a glass of water" });
    await expect(add).toBeVisible();
    await expect(page.getByText(/0 of 8 glasses/i)).toBeVisible();
    await add.click();
    await expect(page.getByText(/1 of 8 glasses/i)).toBeVisible();
  });
});

test.describe("shift scheduler", () => {
  test("log today's shift from the dashboard and it persists @smoke", async ({
    authedPage: page,
    backend,
    user,
  }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Log today.s shift/i }).click();
    await page.getByRole("button", { name: /^Save shift$/i }).click();
    await expect
      .poll(async () => (await backend.dump(user.email)).tables.shifts?.length ?? 0, {
        message: "shift saved",
      })
      .toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByText(/Log a shift to forecast/i)).toHaveCount(0);
  });

  test("rotation length and employer settings are available in the profile", async ({
    authedPage: page,
  }) => {
    await page.goto("/profile");
    await expect(page.getByRole("button", { name: "Add employer" })).toBeVisible();
    for (const w of ["1 wk", "2 wks", "4 wks"])
      await expect(page.getByRole("button", { name: w, exact: true })).toBeVisible();
  });

  test("shift swap copilot analyses an offered shift", async ({ authedPage: page }) => {
    await page.goto("/swap");
    await expect(page.getByRole("heading", { name: /Should you take it/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Analyze swap/i })).toBeVisible();
  });
});

test.describe("AI companion", () => {
  test("Lisa answers a chat message end to end @smoke", async ({ authedPage: page }) => {
    const errors = collectErrors(page);
    await page.goto("/companion");
    await sendChat(
      page,
      /Message your Companion/i,
      "I'm on nights tonight. When should I stop caffeine?",
    );
    await expect(page.getByText(/Have your last coffee by 1 a\.m\./).first()).toBeVisible({
      timeout: 20_000,
    });
    expect(errors).toEqual([]);
  });

  test("voice conversation controls are present", async ({ authedPage: page }) => {
    await page.goto("/companion");
    await expect(page.getByRole("button", { name: /Start voice conversation/i })).toBeVisible();
    await page.goto("/pilot");
    await expect(page.getByRole("button", { name: /Talk to/i }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Transcript/i })).toBeVisible();
  });

  test("AI coach chat replies and offers starter questions", async ({ authedPage: page }) => {
    await page.goto("/coach");
    await expect(page.getByRole("heading", { name: /AI Sleep Coach/i })).toBeVisible();
    await sendChat(
      page,
      /Ask about wind-down/i,
      "When should I take caffeine before a night shift?",
    );
    await expect(page.getByText(/Have your last coffee by 1 a\.m\./).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("AI decisions can be accepted", async ({ authedPage: page }) => {
    await page.goto("/decisions");
    await expect(page.getByRole("heading", { name: /What I decided today/i })).toBeVisible();
    const accept = page.getByRole("button", { name: /^Accept$/ }).first();
    if (await accept.count()) {
      await accept.click();
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    }
  });
});

test.describe("sleep planner, calendar and recovery tools", () => {
  test("today's light plan renders with the week selector @smoke", async ({ authedPage: page }) => {
    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: /light plan/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Voice briefing/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Recovery playbooks/i })).toBeVisible();
  });

  test("calendar: add an event and see it in Upcoming", async ({
    authedPage: page,
    backend,
    user,
  }) => {
    await page.goto("/events");
    await expect(page.getByRole("heading", { name: /Upcoming \(0\)/ })).toBeVisible();
    await page.getByPlaceholder("Title").fill("Charge nurse meeting");
    const when = page.locator('input[type="datetime-local"]').first();
    const d = new Date(NOW + 2 * 86_400_000);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await when.fill(local);
    await page.getByRole("button", { name: /^Add$/ }).click();
    await expect(page.getByRole("heading", { name: /Upcoming \(1\)/ })).toBeVisible();
    await expect(page.getByText("Charge nurse meeting")).toBeVisible();
    expect((await backend.dump(user.email)).tables.user_events?.length ?? 0).toBeGreaterThan(0);
  });

  test("recovery playbooks list the rotations", async ({ authedPage: page }) => {
    await page.goto("/playbooks");
    await expect(page.getByRole("heading", { name: /Pick your rotation/i })).toBeVisible();
    await expect(page.getByText(/24 on, 48 off/i)).toBeVisible();
  });

  test("health & wearables and safety center render", async ({ authedPage: page }) => {
    await page.goto("/health");
    await expect(page.getByRole("heading", { name: /Health & Wellness/i })).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: /Connect a wearable/i })
        .or(page.getByRole("link", { name: /Connect a wearable/i }))
        .first(),
    ).toBeVisible();
    await page.goto("/safety");
    await expect(page.getByRole("heading", { name: /Emergencies/i })).toBeVisible();
  });
});

test.describe("sound mixer", () => {
  test("presets, individual sounds and the sleep timer are available @smoke", async ({ page }) => {
    await page.goto("/sleep");
    await expect(page.getByRole("heading", { name: /Build your soundscape/i })).toBeVisible();
    for (const s of ["Rain", "Ocean", "Brown Noise", "Fan"]) {
      await expect(page.getByRole("button", { name: `Play ${s}` })).toBeVisible();
    }
    for (const t of ["Off", "15m", "30m", "60m"]) {
      await expect(page.getByRole("button", { name: t, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Play Rain" }).click();
    await expect(page.getByRole("button", { name: /(Pause|Stop) Rain/i })).toBeVisible();
  });

  test("a signed-in user can save a mix", async ({ authedPage: page, backend, user }) => {
    await page.goto("/sleep");
    await page.getByRole("button", { name: "Play Ocean" }).click();
    const save = page.getByRole("heading", { name: /Save this mix/i });
    await expect(save).toBeVisible();
    const name = page.getByPlaceholder(/name/i).first();
    if (await name.count()) await name.fill("Night shift ocean");
    await page
      .getByRole("button", { name: /^Save( mix)?$/i })
      .first()
      .click();
    await expect
      .poll(async () => (await backend.dump(user.email)).tables.sound_mixes?.length ?? 0)
      .toBeGreaterThan(0);
  });
});
