import { defineConfig, devices, type Project } from "@playwright/test";

/**
 * RestPilot web regression suite.
 *
 * Default (hermetic): a local production build behind tests/e2e/support/serve.mjs,
 * which fakes Supabase, the AI model and email. Nothing leaves the machine and
 * no shared or production data is touched. Build first:
 *   eval "$(node tests/e2e/support/serve.mjs --print-build-env | sed 's/^/export /')" && npm run build
 *
 * Remote read-only smoke (staging or production): E2E_BASE_URL=https://... runs
 * only tests tagged @readonly (GET-only page checks, no sign-ups, no writes).
 *
 * Tags: @smoke (fast PR subset), @readonly (safe against a live site),
 *       @stripe (checkout; TEST keys only), @offline.
 */
const remote = process.env.E2E_BASE_URL?.replace(/\/$/, "");
const baseURL = remote || "http://127.0.0.1:3000";
const CI = Boolean(process.env.CI);

const iphones = {
  "iphone-se": devices["iPhone SE (3rd gen)"],
  "iphone-15": devices["iPhone 15"],
  "iphone-15-pro-max": devices["iPhone 15 Pro Max"],
} as const;

const projects: Project[] = [
  { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
  ...Object.entries(iphones).map(([name, d]) => ({
    name: `chromium-${name}`,
    // Same viewport, touch and mobile flags as the iPhone, rendered by Chromium.
    use: { ...d, browserName: "chromium" as const, defaultBrowserType: undefined },
  })),
  { name: "webkit-desktop", use: { ...devices["Desktop Safari"] } },
  ...Object.entries(iphones).map(([name, d]) => ({ name: `webkit-${name}`, use: { ...d } })),
];

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  outputDir: "./.results/artifacts",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 3,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  grep: remote ? /@readonly/ : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./.results/html", open: "never" }],
    ["json", { outputFile: "./.results/results.json" }],
    ["junit", { outputFile: "./.results/junit.xml" }],
    ["./support/summary-reporter.ts"],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    serviceWorkers: "allow",
    locale: "en-US",
    timezoneId: "America/Chicago",
  },
  projects,
  webServer: remote
    ? undefined
    : {
        command: "node tests/e2e/support/serve.mjs",
        cwd: "../..",
        url: "http://127.0.0.1:3000/api/public/health",
        reuseExistingServer: !CI,
        timeout: 60_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
