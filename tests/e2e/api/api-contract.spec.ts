import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REMOTE, expect, test } from "../support/fixtures";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src");

// Contract checks for every HTTP API the app serves (src/routes/api/**,
// src/routes/lovable/email/**, /email/unsubscribe, /sitemap.xml), against the
// hermetic stack: auth gates, secret-gated hooks fail closed, webhooks reject
// unsigned calls, public endpoints validate input, signed-in AI endpoints
// answer through the (fake) model, and nothing returns an unhandled 500 page.
// Browser-independent, so it runs once (Chromium desktop).

test.skip(
  ({ browserName, isMobile }) => browserName !== "chromium" || isMobile,
  "API checks run once, in chromium-desktop",
);

const SIGNED_IN_POST = [
  "/api/insights",
  "/api/swap",
  "/api/stt",
  "/api/brief",
  "/api/coach",
  "/api/tts",
  "/api/tts-elevenlabs",
];

const CRON_HOOKS = [
  "/api/public/hooks/ai-learn",
  "/api/public/hooks/notify",
  "/api/public/hooks/dispatch-alarms",
  "/api/public/hooks/subscription-lifecycle",
  "/api/public/wearables/cron",
];

test.describe("API auth gates", () => {
  test("/api/ai refuses anonymous callers @smoke", async ({ request }) => {
    const res = await request.post("/api/ai", {
      data: { intent: "coach", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.status()).toBe(401);
  });

  for (const path of SIGNED_IN_POST) {
    test(`${path} refuses anonymous callers`, async ({ request }) => {
      const res = await request.post(path, { data: {} });
      expect(res.status(), await res.text()).toBe(401);
    });
  }

  test("/api/ai rejects a forged bearer token", async ({ request }) => {
    const res = await request.post("/api/ai", {
      headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad" },
      data: { intent: "coach", messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.status()).toBe(401);
  });

  for (const path of ["/api/lab/simli/session", "/api/lab/simli/speak"]) {
    test(`${path} (lab) is closed to the public`, async ({ request }) => {
      const res = await request.post(path, { data: {} });
      expect([401, 403]).toContain(res.status());
    });
  }
});

test.describe("scheduled-job hooks fail closed without CRON_SECRET", () => {
  for (const path of CRON_HOOKS) {
    test(`${path}`, async ({ request }) => {
      expect((await request.post(path, { data: {} })).status()).toBe(401);
      const wrong = await request.post(path, { headers: { "x-cron-secret": "guess" }, data: {} });
      expect(wrong.status()).toBe(401);
    });
  }
});

test.describe("webhooks reject unsigned or unconfigured calls", () => {
  test("payments webhook needs an environment and a signature", async ({ request }) => {
    expect((await request.post("/api/public/payments/webhook", { data: {} })).status()).toBe(400);
    const sandbox = await request.post("/api/public/payments/webhook?env=sandbox", {
      data: { type: "checkout.session.completed" },
    });
    expect(sandbox.status()).toBeGreaterThanOrEqual(400);
    expect(sandbox.status()).toBeLessThan(600);
  });

  for (const path of [
    "/lovable/email/auth/webhook",
    "/lovable/email/suppression",
    "/lovable/email/queue/process",
    "/lovable/email/transactional/send",
    "/lovable/email/transactional/preview",
    "/lovable/email/auth/preview",
  ]) {
    test(`${path} never accepts an unsigned call`, async ({ request }) => {
      const res = await request.post(path, { data: { to: "attacker@example.com" } });
      expect(res.ok(), `${path} must not return 2xx without a signature/secret`).toBe(false);
    });
  }
});

test.describe("public endpoints", () => {
  test("health and version @smoke", async ({ request }) => {
    const health = await request.get("/api/public/health");
    expect(health.status()).toBe(200);
    expect((await health.json()).status).toBe("ok");
    const version = await request.get("/api/public/version");
    expect(version.status()).toBe(200);
    expect((await version.json()).buildId).toMatch(/^b-\d+$/);
  });

  test("CSP report endpoint accepts reports and preflight", async ({ request }) => {
    const r = await request.post("/api/public/csp-report", {
      headers: { "content-type": "application/csp-report" },
      data: JSON.stringify({
        "csp-report": {
          "document-uri": "https://restpilotai.com/",
          "violated-directive": "img-src",
        },
      }),
    });
    expect([200, 204]).toContain(r.status());
    const pre = await request.fetch("/api/public/csp-report", { method: "OPTIONS" });
    expect(pre.status()).toBeLessThan(400);
  });

  test("contact form validates input", async ({ request }) => {
    const res = await request.post("/api/public/contact", { data: {} });
    expect(res.status()).toBe(400);
    expect((await res.json()).ok).toBe(false);
  });

  test("unsubscribe requires a valid token", async ({ request }) => {
    expect((await request.get("/email/unsubscribe")).status()).toBe(400);
    expect((await request.get("/email/unsubscribe?token=not-a-real-token")).status()).toBe(404);
  });

  test("cron hook GET info pages do not trigger work", async ({ request }) => {
    for (const path of ["/api/public/hooks/ai-learn", "/api/public/hooks/notify"]) {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      expect(await res.text()).toMatch(/POST/);
    }
  });

  // R4: Response.redirect() + the security-headers middleware turned every
  // OAuth return into a 500 (live on staging and restpilotai.com). Fixed by
  // PR #26; until it is merged here these fail, which is the point.
  for (const provider of ["oura", "fitbit"]) {
    test(`${provider} OAuth callback redirects back to the profile (no 500)`, async ({
      request,
    }) => {
      const src = fs.readFileSync(
        `${SRC}/routes/api/public/wearables/${provider}/callback.ts`,
        "utf8",
      );
      // Known defect until PR #26 is merged on this branch; flips automatically.
      test.fail(
        !REMOTE && /return Response\.redirect\(/.test(src),
        "R4: Response.redirect + header middleware = 500",
      );
      for (const q of ["?error=access_denied", "", "?code=abc"]) {
        const res = await request.get(`/api/public/wearables/${provider}/callback${q}`, {
          maxRedirects: 0,
        });
        expect(res.status(), `${provider}${q}`).toBe(302);
        expect(res.headers()["location"]).toMatch(new RegExp(`/profile\\?error=${provider}`));
        expect(res.headers()["x-content-type-options"]).toBe("nosniff");
      }
    });
  }
});

test.describe("signed-in AI endpoints (fake model)", () => {
  async function bearer(
    backend: import("../support/fixtures").Backend,
    user: { email: string; password: string },
  ) {
    const s = await backend.session(user.email, user.password);
    return { authorization: `Bearer ${s.access_token}` };
  }

  test("coach intent streams a reply @smoke", async ({ request, backend, user }) => {
    const res = await request.post("/api/ai", {
      headers: await bearer(backend, user),
      data: {
        intent: "coach",
        messages: [{ role: "user", content: "When should I stop caffeine?" }],
        localTime: new Date().toISOString(),
        timezone: "America/Chicago",
      },
    });
    expect(res.status()).toBe(200);
    // Server-sent events: join the streamed deltas back into the reply.
    const reply = (await res.text())
      .split("\n")
      .filter((l) => l.startsWith("data:") && !l.includes("[DONE]"))
      .map((l) => JSON.parse(l.slice(5)).choices?.[0]?.delta?.content ?? "")
      .join("");
    expect(reply).toContain("Have your last coffee by 1 a.m.");
  });

  for (const intent of [
    "daily_plan",
    "coach_tip",
    "right_now",
    "tomorrow_preview",
    "daily_review",
  ]) {
    test(`/api/ai ${intent} returns JSON`, async ({ request, backend, user }) => {
      const res = await request.post("/api/ai", {
        headers: await bearer(backend, user),
        data: { intent, context: "Night shift 19:00-07:00." },
      });
      expect(res.status(), await res.text()).toBe(200);
      const json = await res.json();
      expect(typeof json).toBe("object");
    });
  }

  test("/api/ai rejects unknown intents and empty chats", async ({ request, backend, user }) => {
    const h = await bearer(backend, user);
    const unknown = await request.post("/api/ai", { headers: h, data: { intent: "make_coffee" } });
    expect(unknown.status(), await unknown.text()).toBe(400);
    const empty = await request.post("/api/ai", {
      headers: h,
      data: { intent: "coach", messages: [] },
    });
    expect(empty.status(), await empty.text()).toBe(400);
  });

  test("/api/ai rejects an oversized body", async ({ request, backend, user }) => {
    const res = await request.post("/api/ai", {
      headers: await bearer(backend, user),
      data: { intent: "coach", messages: [{ role: "user", content: "x".repeat(300_000) }] },
    });
    expect([400, 413]).toContain(res.status());
  });

  test("/api/insights returns the dashboard brief", async ({ request, backend, user }) => {
    const res = await request.post("/api/insights", {
      headers: await bearer(backend, user),
      data: { context: "Night shift tonight 19:00." },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).headline).toBeTruthy();
  });

  test("/api/brief rewrites a plan for voice", async ({ request, backend, user }) => {
    const res = await request.post("/api/brief", {
      headers: await bearer(backend, user),
      data: { plan: "Sleep 08:00-15:00. Caffeine cut-off 01:00." },
    });
    expect(res.status(), await res.text()).toBeLessThan(500);
  });

  test("/api/swap analyses an offered shift", async ({ request, backend, user }) => {
    const res = await request.post("/api/swap", {
      headers: await bearer(backend, user),
      data: { offer: "Can you cover Saturday 19:00-07:00?", context: "Works nights Mon-Wed." },
    });
    expect(res.status(), await res.text()).toBeLessThan(500);
  });

  test("/api/tts and /api/stt fail cleanly when audio is not configured", async ({
    request,
    backend,
    user,
  }) => {
    const h = await bearer(backend, user);
    for (const path of ["/api/tts", "/api/stt", "/api/tts-elevenlabs"]) {
      const res = await request.post(path, { headers: h, data: { text: "hello" } });
      const body = await res.text();
      expect(
        res.headers()["content-type"] ?? "",
        `${path} returns JSON, not the HTML error page`,
      ).toContain("json");
      // Either an error status or an explicit client fallback (browser speech).
      if (res.status() === 200) expect(JSON.parse(body).fallback, `${path}: ${body}`).toBe(true);
      else expect(res.status(), `${path}: ${body}`).toBeGreaterThanOrEqual(400);
    }
  });
});

test.describe("site endpoints @readonly", () => {
  test("sitemap lists public pages only", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain("<urlset");
    for (const p of ["/dashboard", "/profile", "/memory", "/lab"])
      expect(xml).not.toContain(`restpilotai.com${p}<`);
  });
});
