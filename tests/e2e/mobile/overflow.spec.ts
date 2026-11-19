import { writeFile } from "node:fs/promises";
import type { Frame } from "@playwright/test";
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

// Evidence only: compare the existing mouse-click failure with scoped mouse
// and native touch input. Keep the original navigation test above unchanged.
test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe("navigation diagnostic", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile viewports only");

  for (const activation of ["mouse click", "native tap"] as const) {
    test("App navigation: " + activation, async ({ authedPage: page }, testInfo) => {
      const destinations = [
        ["Plan", "/plan", /\/plan/],
        ["Events", "/events", /\/events/],
        ["Profile", "/profile", /\/profile/],
        ["Home", "/dashboard", /\/dashboard/],
      ] as const;
      const paths: string[] = destinations.map(([, path]) => path);
      const eventKinds = [
        "pointerdown",
        "pointerup",
        "pointercancel",
        "touchstart",
        "touchend",
        "touchcancel",
        "click",
      ];
      const evidence: Array<{
        kind: string;
        path: string;
        phase?: "capture" | "bubble";
        defaultPrevented?: boolean;
      }> = [];
      const record = (entry: unknown) => {
        if (evidence.length >= 128 || !entry || typeof entry !== "object") return;
        const { kind, path, phase, defaultPrevented } = entry as Record<string, unknown>;
        if (typeof kind !== "string" || typeof path !== "string" || !paths.includes(path)) return;
        if (kind === "url-path") {
          evidence.push({ kind, path });
          return;
        }
        if (!eventKinds.includes(kind) || (phase !== "capture" && phase !== "bubble")) return;
        if (typeof defaultPrevented !== "boolean") return;
        evidence.push({ kind, path, phase, defaultPrevented });
      };
      let lastPath = "";
      const recordPath = (frame: Frame) => {
        if (frame !== page.mainFrame()) return;
        const path = new URL(frame.url()).pathname;
        if (path === lastPath) return;
        lastPath = path;
        record({ kind: "url-path", path });
      };

      await page.exposeBinding("__restpilotNavigationDiagnostic", (_source, entry: unknown) =>
        record(entry),
      );
      await page.addInitScript(
        ({ paths, eventKinds }) => {
          const publish = (
            window as unknown as {
              __restpilotNavigationDiagnostic: (entry: {
                kind: string;
                path: string;
                phase: "capture" | "bubble";
                defaultPrevented: boolean;
              }) => Promise<void>;
            }
          ).__restpilotNavigationDiagnostic;
          for (const kind of eventKinds) {
            for (const phase of ["capture", "bubble"] as const) {
              // Observe bubbling after root/document application handlers.
              const observer = phase === "capture" ? document : window;
              observer.addEventListener(
                kind,
                (event) => {
                  const link =
                    event.target instanceof Element
                      ? event.target.closest('nav[aria-label="App"] a[href]')
                      : null;
                  const path = link?.getAttribute("href");
                  if (path && paths.includes(path)) {
                    void publish({
                      kind: event.type,
                      path,
                      phase,
                      defaultPrevented: event.defaultPrevented,
                    }).catch(() => undefined);
                  }
                },
                { capture: phase === "capture", passive: true },
              );
            }
          }
        },
        { paths, eventKinds },
      );
      page.on("framenavigated", recordPath);

      try {
        await page.goto("/dashboard");
        const navigation = page.getByRole("navigation", { name: "App", exact: true });
        await expect(navigation).toHaveCount(1);
        await expect(navigation).toBeVisible();
        for (const [name, path, url] of destinations) {
          const link = navigation.getByRole("link", { name, exact: true });
          await expect(link).toHaveAttribute("href", path);
          if (activation === "mouse click") await link.click();
          else await link.tap();
          await expect(page).toHaveURL(url);
        }
      } finally {
        page.off("framenavigated", recordPath);
        const file = testInfo.outputPath("navigation-diagnostic.json");
        await writeFile(file, JSON.stringify(evidence, null, 2) + "\n");
        await testInfo.attach("navigation-diagnostic", {
          path: file,
          contentType: "application/json",
        });
      }
    });
  }
});
