import { writeFile } from "node:fs/promises";
import type { Frame, Page, Request, Response } from "@playwright/test";
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


// Evidence only: observe the two failing sign-in cases without changing their actions or assertions.
type AuthFormFacts = {
  emailNonempty: boolean;
  passwordNonempty: boolean;
  emailValid: boolean;
  passwordValid: boolean;
};
type AuthObservation =
  | ({
      kind: "form-event";
      event: "submit" | "invalid";
      phase: "capture" | "bubble";
      target: "form" | "email" | "password";
      defaultPrevented: boolean;
    } & AuthFormFacts)
  | { kind: "password-request" | "password-request-failed" }
  | { kind: "password-response"; status: number }
  | { kind: "route"; path: "/auth" | "/dashboard" }
  | ({
      kind: "final-state";
      path: "/auth" | "/dashboard" | "other";
      formPresent: boolean;
      submitDisabled: boolean | null;
    } & AuthFormFacts)
  | { kind: "capture-unavailable"; stage: "setup" | "final" };

/** Fresh finite projection: no browser object, request data, arbitrary text, or input value leaves. */
function recordAuthObservation(entries: AuthObservation[], entry: unknown) {
  if (entries.length >= 128 || !entry || typeof entry !== "object") return;
  const e = entry as Record<string, unknown>;
  if (e.kind === "password-request" || e.kind === "password-request-failed") {
    entries.push({ kind: e.kind });
    return;
  }
  if (e.kind === "password-response") {
    if (
      typeof e.status === "number" &&
      Number.isInteger(e.status) &&
      e.status >= 100 &&
      e.status <= 599
    ) {
      entries.push({ kind: e.kind, status: e.status });
    }
    return;
  }
  if (e.kind === "route") {
    if (e.path === "/auth" || e.path === "/dashboard") entries.push({ kind: e.kind, path: e.path });
    return;
  }
  if (e.kind === "capture-unavailable") {
    if (e.stage === "setup" || e.stage === "final") entries.push({ kind: e.kind, stage: e.stage });
    return;
  }
  if (
    typeof e.emailNonempty !== "boolean" ||
    typeof e.passwordNonempty !== "boolean" ||
    typeof e.emailValid !== "boolean" ||
    typeof e.passwordValid !== "boolean"
  )
    return;
  const fields: AuthFormFacts = {
    emailNonempty: e.emailNonempty,
    passwordNonempty: e.passwordNonempty,
    emailValid: e.emailValid,
    passwordValid: e.passwordValid,
  };
  if (
    e.kind === "form-event" &&
    (e.event === "submit" || e.event === "invalid") &&
    (e.phase === "capture" || e.phase === "bubble") &&
    (e.target === "form" || e.target === "email" || e.target === "password") &&
    typeof e.defaultPrevented === "boolean"
  ) {
    entries.push({
      kind: e.kind,
      event: e.event,
      phase: e.phase,
      target: e.target,
      defaultPrevented: e.defaultPrevented,
      ...fields,
    });
  } else if (
    e.kind === "final-state" &&
    (e.path === "/auth" || e.path === "/dashboard" || e.path === "other") &&
    typeof e.formPresent === "boolean" &&
    (e.submitDisabled === null || typeof e.submitDisabled === "boolean")
  ) {
    entries.push({
      kind: e.kind,
      path: e.path,
      formPresent: e.formPresent,
      submitDisabled: e.submitDisabled,
      ...fields,
    });
  }
}

const AUTH_DIAGNOSTIC_TESTS = new Set([
  "existing account signs in and lands on the dashboard @smoke",
  "wrong password is rejected with a clear message",
]);
const authDiagnostics = new WeakMap<
  Page,
  {
    entries: AuthObservation[];
    record: (entry: unknown) => void;
    dispose: () => void;
  }
>();

test.beforeEach(async ({ page, baseURL }, testInfo) => {
  if (!AUTH_DIAGNOSTIC_TESTS.has(testInfo.title)) return;
  const entries: AuthObservation[] = [];
  let active = true;
  const record = (entry: unknown) => {
    if (active) recordAuthObservation(entries, entry);
  };
  const passwordRequests = new WeakSet<Request>();
  let lastPath = "";
  const isPasswordGrant = (request: Request) => {
    try {
      const url = new URL(request.url());
      return (
        Boolean(baseURL) &&
        url.origin === new URL(baseURL!).origin &&
        request.method() === "POST" &&
        url.pathname === "/auth/v1/token" &&
        url.searchParams.get("grant_type") === "password"
      );
    } catch {
      return false;
    }
  };
  const onRequest = (request: Request) => {
    if (!isPasswordGrant(request)) return;
    passwordRequests.add(request);
    record({ kind: "password-request" });
  };
  const onResponse = (response: Response) => {
    if (passwordRequests.has(response.request()))
      record({ kind: "password-response", status: response.status() });
  };
  const onRequestFailed = (request: Request) => {
    if (passwordRequests.has(request)) record({ kind: "password-request-failed" });
  };
  const onFrame = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    try {
      const path = new URL(frame.url()).pathname;
      if (path === lastPath) return;
      lastPath = path;
      record({ kind: "route", path });
    } catch {
      /* No raw URL or error is recorded. */
    }
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("requestfailed", onRequestFailed);
  page.on("framenavigated", onFrame);
  authDiagnostics.set(page, {
    entries,
    record,
    dispose: () => {
      active = false;
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);
      page.off("framenavigated", onFrame);
    },
  });

  try {
    await page.exposeBinding("__restpilotAuthDiagnostic", (source, entry: unknown) => {
      if (source.frame === page.mainFrame()) record(entry);
    });
    await page.addInitScript(() => {
      if (window !== window.top) return;
      const publish = (
        window as unknown as {
          __restpilotAuthDiagnostic: (entry: unknown) => Promise<void>;
        }
      ).__restpilotAuthDiagnostic;
      if (typeof publish !== "function") return;
      for (const eventKind of ["submit", "invalid"] as const) {
        for (const phase of ["capture", "bubble"] as const) {
          const observer = phase === "capture" ? document : window;
          observer.addEventListener(
            eventKind,
            (event) => {
              if (window.location.pathname !== "/auth") return;
              const form =
                event.target instanceof HTMLFormElement
                  ? event.target
                  : event.target instanceof HTMLInputElement
                    ? event.target.form
                    : null;
              const emailInput = form?.querySelector<HTMLInputElement>(
                'input[aria-label="Email address"]',
              );
              const passwordInput = form?.querySelector<HTMLInputElement>(
                'input[aria-label="Password"]',
              );
              if (!form || !emailInput || !passwordInput) return;
              const target =
                event.target === form
                  ? "form"
                  : event.target === emailInput
                    ? "email"
                    : event.target === passwordInput
                      ? "password"
                      : null;
              if (!target) return;
              void publish({
                kind: "form-event",
                event: eventKind,
                phase,
                target,
                defaultPrevented: event.defaultPrevented,
                emailNonempty: emailInput.value.length > 0,
                passwordNonempty: passwordInput.value.length > 0,
                emailValid: emailInput.validity.valid,
                passwordValid: passwordInput.validity.valid,
              }).catch(() => undefined);
            },
            { capture: phase === "capture", passive: true },
          );
        }
      }
    });
  } catch {
    record({ kind: "capture-unavailable", stage: "setup" });
  }
});

test.afterEach(async ({ page }, testInfo) => {
  const diagnostic = authDiagnostics.get(page);
  if (!diagnostic) return;
  try {
    diagnostic.record(
      await page.evaluate(() => {
        const emailInput = document.querySelector<HTMLInputElement>(
          'input[aria-label="Email address"]',
        );
        const passwordInput = document.querySelector<HTMLInputElement>(
          'input[aria-label="Password"]',
        );
        const form = emailInput?.form;
        const formPresent = Boolean(form && passwordInput?.form === form);
        const submit = formPresent
          ? form?.querySelector<HTMLButtonElement>('button[type="submit"]')
          : null;
        const path =
          window.location.pathname === "/auth"
            ? "/auth"
            : window.location.pathname === "/dashboard"
              ? "/dashboard"
              : "other";
        return {
          kind: "final-state",
          path,
          formPresent,
          submitDisabled: submit?.disabled ?? null,
          emailNonempty: Boolean(emailInput?.value.length),
          passwordNonempty: Boolean(passwordInput?.value.length),
          emailValid: emailInput?.validity.valid ?? false,
          passwordValid: passwordInput?.validity.valid ?? false,
        };
      }),
    );
  } catch {
    diagnostic.record({ kind: "capture-unavailable", stage: "final" });
  } finally {
    diagnostic.dispose();
    authDiagnostics.delete(page);
  }
  try {
    const file = testInfo.outputPath("auth-diagnostic.json");
    await writeFile(file, JSON.stringify(diagnostic.entries, null, 2) + "\n");
    await testInfo.attach("auth-diagnostic", { path: file, contentType: "application/json" });
  } catch {
    console.warn("Auth diagnostic artifact unavailable.");
  }
});
