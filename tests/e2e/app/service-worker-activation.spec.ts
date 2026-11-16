import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";

type ActivationProbe = Window & { releaseFirstWorker?: () => void; draftDocument?: boolean };

async function deferFirstRegistration(page: Page) {
  await page.addInitScript(() => {
    const worker = navigator.serviceWorker;
    const register = worker.register.bind(worker);
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    (window as ActivationProbe).releaseFirstWorker = release;
    // Delay only registration. The browser still downloads and activates the
    // real application worker, then dispatches its real controllerchange event.
    worker.register = async (...args) => {
      await ready;
      return register(...args);
    };
  });
}

async function activateFirstWorker(page: Page) {
  await page.evaluate(async () => {
    const probe = window as ActivationProbe;
    if (!probe.releaseFirstWorker) throw new Error("Registration gate was not installed");
    if (navigator.serviceWorker.controller) throw new Error("Expected a fresh uncontrolled page");
    probe.draftDocument = true;
    const controlled = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("First worker never claimed the page")),
        20_000,
      );
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (navigator.serviceWorker.controller) {
          window.clearTimeout(timeout);
          resolve();
        }
      });
    });
    probe.releaseFirstWorker();
    await controlled;
  });
  expect(await page.evaluate(() => (window as ActivationProbe).draftDocument)).toBe(true);
}

test("first worker claim preserves an unsaved shift @smoke", async ({
  authedPage: page,
  backend,
  user,
}) => {
  await deferFirstRegistration(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /Log today.s shift/i }).click();
  const title = page.getByPlaceholder("e.g. Night Shift, ER Coverage, Overtime");
  await title.fill("First-visit recovery shift");
  await activateFirstWorker(page);
  await expect(title).toHaveValue("First-visit recovery shift");
  await page.getByRole("button", { name: "Save shift", exact: true }).click();
  await expect
    .poll(async () => (await backend.dump(user)).tables.shifts?.map((s) => s.title) ?? [])
    .toContain("First-visit recovery shift");
});

test("first worker claim preserves an active sound mix @smoke", async ({
  authedPage: page,
  backend,
  user,
}) => {
  await deferFirstRegistration(page);
  await page.goto("/sleep");
  await page.getByRole("button", { name: "Play Ocean", exact: true }).click();
  const playing = page.getByRole("button", { name: /(Pause|Stop) Ocean/i });
  await expect(playing).toBeVisible();
  const name = page.getByPlaceholder(/name/i).first();
  await name.fill("First-visit ocean");
  await activateFirstWorker(page);
  await expect(playing).toBeVisible();
  await expect(name).toHaveValue("First-visit ocean");
  await page
    .getByRole("button", { name: /^Save( mix)?$/i })
    .first()
    .click();
  await expect
    .poll(async () => (await backend.dump(user)).tables.sound_mixes?.map((mix) => mix.name) ?? [])
    .toContain("First-visit ocean");
});
