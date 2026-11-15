import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** True when running against a deployed site (read-only smoke). */
export const REMOTE = Boolean(process.env.E2E_BASE_URL);

const COOKIE_VERSION = (() => {
  try {
    const src = fs.readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../src/lib/legal/cookies.ts",
      ),
      "utf8",
    );
    return /const VERSION = "([^"]+)"/.exec(src)?.[1] ?? null;
  } catch {
    return null;
  }
})();

export type SeedTables = Record<string, Record<string, unknown>[]>;
export type TestUser = { id: string; email: string; password: string };

/** Talks to the hermetic backend's /__test endpoints. */
export class Backend {
  constructor(private readonly request: APIRequestContext) {}

  async seed(users: { email: string; password: string }[], tables: SeedTables = {}) {
    const res = await this.request.post("/__test/seed", { data: { users, tables } });
    expect(res.ok(), "seed the E2E backend").toBeTruthy();
    return (await res.json()) as { users: { id: string; email: string }[] };
  }

  /** Rows owned by a user. Pass the TestUser to keep seeing its rows after account deletion. */
  async dump(who: string | TestUser) {
    const q =
      typeof who === "string"
        ? `email=${encodeURIComponent(who)}`
        : `email=${encodeURIComponent(who.email)}&userId=${who.id}`;
    const res = await this.request.get(`/__test/dump?${q}`);
    expect(res.ok()).toBeTruthy();
    return (await res.json()) as {
      userExists: boolean;
      userId: string | null;
      tables: SeedTables;
      log: { type: string; table?: string; fn?: string }[];
    };
  }

  async session(email: string, password: string) {
    const res = await this.request.post("/auth/v1/token?grant_type=password", {
      data: { email, password },
    });
    expect(res.ok(), `sign in ${email}`).toBeTruthy();
    return res.json();
  }
}

function storageKey(baseURL: string) {
  return `sb-${new URL(baseURL).hostname.split(".")[0]}-auth-token`;
}

export async function signInViaStorage(page: Page, baseURL: string, session: unknown) {
  const key = storageKey(baseURL);
  // Write the session exactly once, from a same-origin page that runs no app
  // code. (An init script would re-inject it on every load: the app clears
  // sessionStorage on sign-out, so any once-per-tab flag there is unreliable.)
  await page.goto("/robots.txt");
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [
    key,
    JSON.stringify(session),
  ] as const);
}

/** Default profile for seeded users: onboarding done, memory on, a 7 h goal. */
export const DEFAULT_PREFS = {
  onboarded_at: "2026-11-01T12:00:00.000Z",
  memory_enabled: true,
  assistant_name: "Lisa",
  sleep_hours: 7,
  home_tz: "America/Chicago",
  current_tz: "America/Chicago",
};

type Fixtures = {
  backend: Backend;
  /** Extra rows seeded for this test's user (user_id is filled in). */
  seedTables: SeedTables;
  user: TestUser;
  /** A page already signed in as `user`. */
  authedPage: Page;
  /** Accept-necessary cookie consent before any page script runs. */
  cookieConsent: boolean;
  /** Mark the once-per-device Companion intro sheet as seen. */
  companionIntroSeen: boolean;
};

export const test = base.extend<Fixtures>({
  cookieConsent: [true, { option: true }],
  companionIntroSeen: [true, { option: true }],
  seedTables: [{}, { option: true }],

  page: async ({ page, cookieConsent, companionIntroSeen }, provide) => {
    if (companionIntroSeen) {
      await page.addInitScript(() => {
        if (!window.sessionStorage.getItem("e2e.intro-flag")) {
          window.sessionStorage.setItem("e2e.intro-flag", "1");
          window.localStorage.setItem("restpilot.companion.introSeen.v1", "1");
        }
      });
    }
    if (cookieConsent && COOKIE_VERSION) {
      await page.addInitScript((version) => {
        const key = "restpilot.cookie-consent.v1";
        if (!window.sessionStorage.getItem("e2e.consent-flag")) {
          window.sessionStorage.setItem("e2e.consent-flag", "1");
          window.localStorage.setItem(
            key,
            JSON.stringify({
              necessary: true,
              preferences: false,
              analytics: false,
              ai_logs: false,
              decidedAt: new Date().toISOString(),
              version,
            }),
          );
        }
      }, COOKIE_VERSION);
    }
    await provide(page);
  },

  backend: async ({ request }, provide) => {
    test.skip(REMOTE, "Needs the hermetic E2E backend; never writes to a deployed site.");
    await provide(new Backend(request));
  },

  user: async ({ backend, seedTables }, provide, testInfo) => {
    const email = `qa-${testInfo.workerIndex}-${crypto.randomBytes(5).toString("hex")}@e2e.restpilot.test`;
    const password = `Rp-${crypto.randomBytes(6).toString("hex")}!`;
    const tables: SeedTables = { user_prefs: [{ user_email: email, ...DEFAULT_PREFS }] };
    for (const [name, rows] of Object.entries(seedTables)) {
      tables[name] = [...(tables[name] ?? []), ...rows.map((r) => ({ user_email: email, ...r }))];
      if (name === "user_prefs")
        tables[name] = [{ user_email: email, ...DEFAULT_PREFS, ...rows[0] }];
    }
    const { users } = await backend.seed([{ email, password }], tables);
    await provide({ id: users[0].id, email, password });
  },

  authedPage: async ({ page, backend, user, baseURL }, provide) => {
    const session = await backend.session(user.email, user.password);
    await signInViaStorage(page, baseURL!, session);
    await provide(page);
  },
});

export { expect };

/** Every console error and uncaught exception on a page, for "renders cleanly" checks. */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Network failures are asserted separately; ignore known third-party noise.
    if (/Failed to load resource|favicon|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

/** No horizontal scrolling: the page must fit the viewport width. */
export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) {
      for (const el of Array.from(document.body.querySelectorAll("*"))) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (
          r.right > doc.clientWidth + 1 &&
          r.width > 0 &&
          getComputedStyle(el).position !== "fixed"
        ) {
          offenders.push(
            `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${String(
              (el as HTMLElement).className,
            )
              .split(" ")
              .slice(0, 2)
              .join(".")} right=${Math.round(r.right)}`,
          );
          if (offenders.length >= 5) break;
        }
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offenders };
  });
  expect(
    m.scrollWidth,
    `${label}: horizontal overflow (${m.scrollWidth} > ${m.clientWidth}). Widest: ${m.offenders.join("; ")}`,
  ).toBeLessThanOrEqual(m.clientWidth + 1);
}

/** Record a blocked area so the summary reporter can list it, then skip. */
export function blocked(reason: string) {
  test.info().annotations.push({ type: "blocked", description: reason });
  test.skip(true, `blocked: ${reason}`);
}

/**
 * Type into a chat box and send. The companion page re-renders while prefs and
 * session hydrate, which can reset a controlled input; retry until the Send
 * button is enabled with our text still in place.
 */
export async function sendChat(page: Page, placeholder: RegExp, text: string) {
  const box = page.getByPlaceholder(placeholder).first();
  const send = page.getByRole("button", { name: /^Send$/ }).last();
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await box.fill(text);
    await expect(send).toBeEnabled({ timeout: 1_000 });
    await expect(box).toHaveValue(text, { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await box.press("Enter");
}
