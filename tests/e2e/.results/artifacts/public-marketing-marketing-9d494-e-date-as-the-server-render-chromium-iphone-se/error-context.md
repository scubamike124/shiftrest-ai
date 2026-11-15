# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: public/marketing.spec.ts >> marketing pages @readonly >> legal index shows the same effective date as the server render
- Location: tests/e2e/public/marketing.spec.ts:65:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Effective June 27, 2026')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Effective June 27, 2026') with timeout 5000ms
  - waiting for getByText('Effective June 27, 2026')

```

```yaml
- banner:
  - link "RestPilot AI":
    - /url: /
  - button "Open menu"
- main:
  - region "Legal documents":
    - paragraph: Legal
    - heading "RestPilot AI legal documents" [level=1]
    - paragraph: The full set of agreements, disclaimers, and disclosures that apply to your use of RestPilot AI. Effective June 26, 2026. Documents are draft templates and will be finalized by qualified counsel before launch.
    - heading "Core legal" [level=2]
    - list:
      - listitem:
        - link "Terms of Service The agreement that governs your use of RestPilot AI.":
          - /url: /legal/terms
          - paragraph: Terms of Service
          - paragraph: The agreement that governs your use of RestPilot AI.
      - listitem:
        - link "Privacy Policy What data we collect, why, how long we keep it, and your rights.":
          - /url: /legal/privacy
          - paragraph: Privacy Policy
          - paragraph: What data we collect, why, how long we keep it, and your rights.
    - heading "Disclosures" [level=2]
    - list:
      - listitem:
        - link "AI & Health Disclaimers AI, health, medical, emergency, and safety-sensitive activity disclaimers.":
          - /url: /legal/disclaimers
          - paragraph: AI & Health Disclaimers
          - paragraph: AI, health, medical, emergency, and safety-sensitive activity disclaimers.
      - listitem:
        - link "Subprocessors & Integrations Third parties we share data with and what they receive.":
          - /url: /legal/third-parties
          - paragraph: Subprocessors & Integrations
          - paragraph: Third parties we share data with and what they receive.
      - listitem:
        - link "Regional Disclosures Additional rights and disclosures for the EU, UK, California, Canada, Australia, and Brazil.":
          - /url: /legal/regional
          - paragraph: Regional Disclosures
          - paragraph: Additional rights and disclosures for the EU, UK, California, Canada, Australia, and Brazil.
    - heading "Billing" [level=2]
    - list:
      - listitem:
        - link "Subscription Terms Billing, auto-renewal, cancellation, refunds, free trials, and lifetime access.":
          - /url: /legal/subscription
          - paragraph: Subscription Terms
          - paragraph: Billing, auto-renewal, cancellation, refunds, free trials, and lifetime access.
    - heading "Policies" [level=2]
    - list:
      - listitem:
        - link "Cookie Policy Storage we set in your browser and how to control it.":
          - /url: /legal/cookies
          - paragraph: Cookie Policy
          - paragraph: Storage we set in your browser and how to control it.
      - listitem:
        - link "Acceptable Use Policy What you may and may not do with RestPilot AI.":
          - /url: /legal/acceptable-use
          - paragraph: Acceptable Use Policy
          - paragraph: What you may and may not do with RestPilot AI.
      - listitem:
        - link "Accessibility Statement Our commitment to WCAG 2.1 AA and how to report barriers.":
          - /url: /legal/accessibility
          - paragraph: Accessibility Statement
          - paragraph: Our commitment to WCAG 2.1 AA and how to report barriers.
      - listitem:
        - link "Security & Responsible Disclosure Our security practices and how to report a vulnerability.":
          - /url: /legal/security
          - paragraph: Security & Responsible Disclosure
          - paragraph: Our security practices and how to report a vulnerability.
      - listitem:
        - link "Electronic Consent & E-SIGN Disclosure How electronic signatures, acceptance, and records work in RestPilot AI.":
          - /url: /legal/electronic-consent
          - paragraph: Electronic Consent & E-SIGN Disclosure
          - paragraph: How electronic signatures, acceptance, and records work in RestPilot AI.
    - heading "Intellectual property" [level=2]
    - list:
      - listitem:
        - link "Software License Agreement Your limited personal license to use the RestPilot AI software.":
          - /url: /legal/license
          - paragraph: Software License Agreement
          - paragraph: Your limited personal license to use the RestPilot AI software.
      - listitem:
        - link "Copyright & DMCA Policy How to submit a copyright complaint or counter-notice.":
          - /url: /legal/copyright
          - paragraph: Copyright & DMCA Policy
          - paragraph: How to submit a copyright complaint or counter-notice.
      - listitem:
        - link "Trademark Notice Use of the RestPilot AI name, logo, and brand marks.":
          - /url: /legal/trademark
          - paragraph: Trademark Notice
          - paragraph: Use of the RestPilot AI name, logo, and brand marks.
      - listitem:
        - link "Open-Source Notices Third-party open-source software used in RestPilot AI and their licenses.":
          - /url: /legal/open-source
          - paragraph: Open-Source Notices
          - paragraph: Third-party open-source software used in RestPilot AI and their licenses.
    - text: Questions? Email
    - link "support@restpilotai.com":
      - /url: mailto:support@restpilotai.com
    - text: . Security reports go to
    - link "security@restpilotai.com":
      - /url: mailto:security@restpilotai.com
    - text: .
- contentinfo:
  - text: RestPilot AI
  - paragraph: The AI rest platform for shift workers. Plan sleep, light, and recovery around a schedule that never stops moving.
  - paragraph: Product
  - list:
    - listitem:
      - link "Features":
        - /url: /features
    - listitem:
      - link "App preview":
        - /url: /pricing
    - listitem:
      - link "The Science":
        - /url: /science
    - listitem:
      - link "Dashboard":
        - /url: /dashboard
    - listitem:
      - link "Safety Center":
        - /url: /safety
  - paragraph: Account
  - list:
    - listitem:
      - link "Sign in":
        - /url: /auth
    - listitem:
      - link "Get started":
        - /url: /auth
    - listitem:
      - link "Profile":
        - /url: /profile
  - paragraph: Legal
  - list:
    - listitem:
      - link "Terms of Service":
        - /url: /legal/terms
    - listitem:
      - link "Privacy Policy":
        - /url: /legal/privacy
    - listitem:
      - link "Cookie Policy":
        - /url: /legal/cookies
    - listitem:
      - link "Acceptable Use Policy":
        - /url: /legal/acceptable-use
    - listitem:
      - link "Accessibility Statement":
        - /url: /legal/accessibility
    - listitem:
      - link "AI & Health Disclaimers":
        - /url: /legal/disclaimers
    - listitem:
      - link "Subscription Terms":
        - /url: /legal/subscription
    - listitem:
      - link "Subprocessors & Integrations":
        - /url: /legal/third-parties
    - listitem:
      - link "Security & Responsible Disclosure":
        - /url: /legal/security
    - listitem:
      - link "Software License Agreement":
        - /url: /legal/license
    - listitem:
      - link "Copyright & DMCA Policy":
        - /url: /legal/copyright
    - listitem:
      - link "Trademark Notice":
        - /url: /legal/trademark
    - listitem:
      - link "Open-Source Notices":
        - /url: /legal/open-source
    - listitem:
      - link "Electronic Consent & E-SIGN Disclosure":
        - /url: /legal/electronic-consent
    - listitem:
      - link "Regional Disclosures":
        - /url: /legal/regional
  - paragraph: © 2026 RestPilot AI. All rights reserved.
  - paragraph:
    - link "For sale":
      - /url: /for-sale
- region "Notifications alt+T"
```

# Test source

```ts
  1   | import { collectErrors, expect, test } from "../support/fixtures";
  2   | 
  3   | // Marketing, legal and other public pages. GET-only, so they also run as the
  4   | // read-only smoke against staging/production (E2E_BASE_URL).
  5   | 
  6   | const MARKETING = [
  7   |   { path: "/", h1: /AI companion that helps you sleep better/i },
  8   |   { path: "/features", h1: /./ },
  9   |   { path: "/science", h1: /./ },
  10  |   { path: "/contact", h1: /./ },
  11  |   { path: "/legal", h1: /Legal/i },
  12  |   { path: "/sleep", h1: /Build your soundscape/i },
  13  | ] as const;
  14  | 
  15  | const LEGAL = [
  16  |   "terms",
  17  |   "privacy",
  18  |   "cookies",
  19  |   "disclaimers",
  20  |   "subscription",
  21  |   "acceptable-use",
  22  |   "accessibility",
  23  |   "copyright",
  24  |   "electronic-consent",
  25  |   "license",
  26  |   "open-source",
  27  |   "regional",
  28  |   "security",
  29  |   "third-parties",
  30  |   "trademark",
  31  | ];
  32  | 
  33  | // Known, already-reported defects whose console noise is tolerated (and
  34  | // annotated) on the page-render check; each has its own deterministic test below.
  35  | const KNOWN_CONSOLE_DEFECTS: Record<string, { pattern: RegExp; id: string }> = {
  36  |   "/legal": {
  37  |     pattern: /Minified React error #418/,
  38  |     id: "R3 legal effective-date hydration mismatch",
  39  |   },
  40  | };
  41  | 
  42  | test.describe("marketing pages @readonly", () => {
  43  |   for (const { path, h1 } of MARKETING) {
  44  |     test(`${path} renders without errors @smoke`, async ({ page }) => {
  45  |       const known = KNOWN_CONSOLE_DEFECTS[path];
  46  |       const all = collectErrors(page);
  47  |       const res = await page.goto(path);
  48  |       expect(res?.status(), `${path} status`).toBeLessThan(400);
  49  |       await expect(page.locator("h1").first()).toBeVisible();
  50  |       await expect(page.locator("h1").first()).toHaveText(h1);
  51  |       await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  52  |       const errors = known ? all.filter((e) => !known.pattern.test(e)) : all;
  53  |       if (known && errors.length < all.length) {
  54  |         test.info().annotations.push({ type: "known-defect", description: known.id });
  55  |       }
  56  |       expect(errors, `${path} console errors`).toEqual([]);
  57  |     });
  58  |   }
  59  | 
  60  |   // KNOWN DEFECT (QA-REPORT R3): legal.index.tsx formats the effective date
  61  |   // with toLocaleDateString() and no timeZone, so in US time zones the client
  62  |   // renders the previous day ("June 26" for 2026-06-27) and React throws
  63  |   // hydration error #418. Fixed on fix/legal-date-hydration (not yet merged
  64  |   // here). Expected to fail until then; Playwright flags the fix as a pass.
  65  |   test("legal index shows the same effective date as the server render", async ({
  66  |     page,
  67  |     request,
  68  |   }) => {
  69  |     test.fail(true, "R3: effective date is off by one day in US time zones");
  70  |     const html = await (await request.get("/legal")).text();
  71  |     const server = /Effective (?:<!-- -->)?([A-Z][a-z]+ \d{1,2}, \d{4})/.exec(html)?.[1];
  72  |     expect(server, "server-rendered effective date").toBeTruthy();
  73  |     await page.goto("/legal");
> 74  |     await expect(page.getByText(`Effective ${server}`)).toBeVisible({ timeout: 5_000 });
      |                                                         ^ Error: expect(locator).toBeVisible() failed
  75  |   });
  76  | 
  77  |   test("home: primary calls to action lead to sign-up and the app preview @smoke", async ({
  78  |     page,
  79  |   }) => {
  80  |     await page.goto("/");
  81  |     await expect(page).toHaveTitle(/RestPilot/);
  82  |     const getStarted = page.getByRole("link", { name: /Get started/i }).first();
  83  |     await expect(getStarted).toBeVisible();
  84  |     await expect(getStarted).toHaveAttribute("href", /\/auth/);
  85  |     await expect(page.getByRole("link", { name: /Sign in/i }).first()).toHaveAttribute(
  86  |       "href",
  87  |       /\/auth/,
  88  |     );
  89  |     await expect(page.getByRole("link", { name: /app preview/i }).first()).toHaveAttribute(
  90  |       "href",
  91  |       /\/(pricing|paywall|auth)/,
  92  |     );
  93  |   });
  94  | 
  95  |   test("footer links to every policy the sign-up form references", async ({ page }) => {
  96  |     await page.goto("/");
  97  |     for (const name of [/Terms of Service/i, /Privacy Policy/i, /Cookie Policy/i]) {
  98  |       await expect(page.getByRole("link", { name }).first()).toBeVisible();
  99  |     }
  100 |   });
  101 | 
  102 |   for (const slug of LEGAL) {
  103 |     test(`legal/${slug} is published`, async ({ page }) => {
  104 |       const res = await page.goto(`/legal/${slug}`);
  105 |       expect(res?.status()).toBeLessThan(400);
  106 |       await expect(page.locator("h1").first()).toBeVisible();
  107 |       await expect(page.locator("main, article, body").first()).toContainText(/RestPilot/i);
  108 |     });
  109 |   }
  110 | 
  111 |   test("/privacy and /terms redirect to the legal pages", async ({ page }) => {
  112 |     await page.goto("/privacy");
  113 |     await expect(page).toHaveURL(/\/legal\/privacy/);
  114 |     await page.goto("/terms");
  115 |     await expect(page).toHaveURL(/\/legal\/terms/);
  116 |   });
  117 | 
  118 |   test("unknown routes show a not-found page, not a crash", async ({ page }) => {
  119 |     const res = await page.goto("/this-page-does-not-exist-qa");
  120 |     expect([200, 404]).toContain(res?.status());
  121 |     await expect(page.getByText(/not found|404|doesn.t exist|can.t find/i).first()).toBeVisible();
  122 |   });
  123 | });
  124 | 
  125 | test.describe("platform basics @readonly", () => {
  126 |   test("security headers, manifest and service worker are served @smoke", async ({ request }) => {
  127 |     const home = await request.get("/");
  128 |     expect(home.status()).toBe(200);
  129 |     const csp = home.headers()["content-security-policy"] ?? "";
  130 |     expect(csp, "CSP header").toContain("default-src 'self'");
  131 |     expect(csp).toContain("frame-ancestors");
  132 |     const manifest = await request.get("/manifest.webmanifest");
  133 |     expect(manifest.status()).toBe(200);
  134 |     expect((await manifest.json()).name).toMatch(/RestPilot/);
  135 |     const sw = await request.get("/sw.js");
  136 |     expect(sw.status()).toBe(200);
  137 |     expect(await sw.text()).not.toContain("__WB_MANIFEST");
  138 |     const health = await request.get("/api/public/health");
  139 |     expect(health.status()).toBe(200);
  140 |   });
  141 | 
  142 |   test("robots.txt and sitemap point at the owned domain", async ({ request }) => {
  143 |     const robots = await request.get("/robots.txt");
  144 |     expect(robots.status()).toBe(200);
  145 |     expect(await robots.text()).toMatch(/Sitemap:\s*https:\/\/restpilotai\.com\//);
  146 |     const sitemap = await request.get("/sitemap.xml");
  147 |     expect(sitemap.status()).toBe(200);
  148 |     expect(await sitemap.text()).toContain("<urlset");
  149 |   });
  150 | });
  151 | 
  152 | // Not @readonly: sends (rejected) POSTs, so it never runs against a live site.
  153 | test.describe("API guards", () => {
  154 |   test("AI and account APIs refuse anonymous callers", async ({ request }) => {
  155 |     const ai = await request.post("/api/ai", {
  156 |       data: { intent: "coach", messages: [{ role: "user", content: "hi" }] },
  157 |     });
  158 |     expect([401, 403]).toContain(ai.status());
  159 |     const insights = await request.post("/api/insights", { data: { context: "x" } });
  160 |     expect([401, 403]).toContain(insights.status());
  161 |   });
  162 | });
  163 | 
```