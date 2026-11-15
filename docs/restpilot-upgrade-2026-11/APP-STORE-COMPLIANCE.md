# RestPilot iPhone app: App Store compliance verdict

_Nov 15 2026. This is an engineering reading of Apple's published rules, not legal advice. Apple's reviewers have the final say._
_Source: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), page header "Last Updated: October 16, 2026" (fetched Nov 15 2026). The quotes below are copied word for word from that page._

## Verdict

**Can RestPilot ship without Apple In-App Purchase (IAP) and still unlock Premium in the app for website (Stripe) subscribers? No, not compliantly.**

- RestPilot Premium is a digital subscription that unlocks features inside the app. Guideline 3.1.1 says that requires IAP.
- The exception that lets web purchases work in the app is 3.1.3(b), "Multiplatform Services". It applies only "provided those items are also available as in-app purchases within the app."
- RestPilot is not a "Reader" app (3.1.3(a) covers magazines, newspapers, books, audio, music and video). None of the other 3.1.3 exceptions fit either. The closest is 3.1.3(f), "Free Stand-alone Apps", but it covers only companions to a paid web tool "for VoIP, Cloud Storage, Email Services, or Web Hosting".
- The 2025 United States change does **not** remove the IAP requirement. It only lifts the ban on buttons, external links and other calls to action that point to other ways to pay.

**Simplest compliant path: sell the same two plans through IAP in the app, next to the existing website Stripe plans.**

| Item | What it means |
|---|---|
| Plans | Monthly $7.99 and Annual $49.99, each with a 14-day free trial (an App Store Connect introductory offer) |
| Web subscribers | Keep Premium in the app (3.1.3(b)) |
| Stripe in the app | Never shown |
| Lifetime | Not sold anywhere. Existing lifetime members stay entitled |

This was already prepared, with flags off, on the Railway branch (#16: RevenueCat, entitlement merge, app-aware paywall). It is not on `main`, the code the app shell loads today.

**Today's production `main`** (`e8742a9`, with #40 and #50), once published:
- **The website is fine.** Guidelines don't apply to the website.
- **The app** shows no purchase at all, which is the right interim state for internal TestFlight. **Do not submit it for App Review or external TestFlight as is**, because web subscribers still unlock Premium in the app with no IAP offered.

Interim fallback, if the owner wants the app in the store before IAP is ready: ship it as a free-features-only app. Inside the app, nobody gets Premium unlocked, including web subscribers. This complies with 3.1.1, because nothing is unlocked without IAP. But paying customers lose Premium in the app and the 4.2 risk goes up. Not recommended except as a stopgap.

## Architecture reviewed

- A Capacitor shell (`ios-app/`, bundle `com.restpilotai.app`) loads **`https://restpilotai.com/`** via `server.url` and adds `RestPilotApp/1.0.0` to the User-Agent. Its source lives on the Railway branch line.
- Native features: reminders, an offline screen and deep links (#13, merged into the Railway branch). Apple Health is read-only, on the phone, behind Connect (#17, open).
- IAP via RevenueCat is prepared with flags off (#16, merged into the Railway branch, not `main`).
- Production `main` (Lovable) has:
  - Stripe Embedded Checkout on the website, with Monthly $7.99 / Annual $49.99 / 14-day trial and no lifetime (#19);
  - the in-app purchase block (#40: no prices, purchase calls to action, checkout or portal in the app; the server refuses checkout and portal for app requests);
  - in-app account deletion.

## The rules and how RestPilot measures up

### 3.1.1 In-App Purchase: requires IAP
> "If you want to unlock features or functionality within your app, (by way of example: subscriptions, in-game currencies, game levels, access to premium content, or unlocking a full version), you must use in-app purchase. Apps may not use their own mechanisms to unlock content or functionality, such as license keys, augmented reality markers, QR codes, cryptocurrencies and cryptocurrency wallets, etc."

RestPilot Premium (unlimited AI coach, voice briefings, recovery plans) is exactly this. Inside the app it must be sold with IAP.

### 3.1.1(a) and the United States storefront: links allowed, IAP still required
> "Developers may apply for entitlements to provide a link in their app to a permitted destination in order to purchase digital content or services. These entitlements are not required for developers to include buttons, external links, or other calls to action in their United States storefront apps."

> "In all other storefronts, except for the United States storefront, where this prohibition does not apply, apps and their metadata may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase."

- **US storefront:** a "Subscribe on restpilotai.com" button or link is allowed.
- **Every other storefront:** no buttons, links or calls to action that point to buying anywhere else.
- **In every storefront**, 3.1.1 and 3.1.3(b) still require IAP when the app unlocks paid features.
- The US terms (commission, placement) are still in litigation (see the Railway branch's `SUBSCRIPTIONS.md` §2.2). **Recommendation:** leave the US link off. It adds review risk and a second purchase path, and saves nothing while IAP must be offered anyway.

### 3.1.3 Other Purchase Methods: intro
> "The following apps may use purchase methods other than in-app purchase. Apps in this section cannot, within the app, encourage users to use a purchasing method other than in-app purchase, except for apps on the United States storefront and as set forth in 3.1.1(a) and 3.1.3(a). Developers can send communications outside of the app to their user base about purchasing methods other than in-app purchase."

Emails to existing users about the website are fine. Inside the app outside the US, nothing may nudge users toward buying on the website.

### 3.1.3(a) "Reader" apps, and the account-management wording
> "Apps may allow a user to access previously purchased content or content subscriptions (specifically: magazines, newspapers, books, audio, music, and video). Reader apps may offer account creation for free tiers, and account management functionality for existing customers. Reader app developers may apply for the External Link Account Entitlement to provide an informational link in their app to a web site the developer owns or maintains responsibility for in order to create or manage an account. This entitlement is not required for developers to include buttons, external links, or other calls to action in their United States storefront apps."

- This is the only place the guidelines expressly allow pointing customers to the website to **manage an account**, and it is limited to Reader apps. RestPilot is not one.
- So for RestPilot, inside the app:
  - **Allowed:** show a website subscriber their plan status, and a plain-text note (no link, no price, no "buy") that billing is managed on the website.
  - **US storefront only:** a link is allowed.
  - **Not allowed outside the US:** a tappable link to the Stripe portal or the pricing page.

#### What #40 does
- **Website subscribers in the app:**
  - Monthly and annual subscribers see their plan ("Premium · Monthly" / "Premium · Annual") and "Billing changes aren't available in the app."
  - Lifetime members see their plan; on `/paywall` and `/pricing` that reads "Your plan: Lifetime access". They don't get the billing line, because there is nothing to bill.
  - There is no portal button and no link. This is neutral and compliant.
- **Free users in the app** see "Subscriptions aren't available in the app yet." with no prices and no link. Also compliant.
- **No copy change is needed for this Publish.** When IAP ships, use the Railway branch's decision table:
  - Apple subscribers get Apple's Manage Subscriptions;
  - Stripe subscribers get their status plus the plain text "Your subscription is billed through your RestPilot web account." (no link outside the US).

### 3.1.3(b) Multiplatform Services: the key condition
> "Apps that operate across multiple platforms may allow users to access content, subscriptions, or features they have acquired in your app on other platforms or your web site, including consumable items in multi-platform games, provided those items are also available as in-app purchases within the app."

- This is what lets existing Stripe monthly, annual and lifetime subscribers keep Premium in the app. **But only if** the same subscription is also offered as IAP in the app.
- Lifetime is no longer sold anywhere, so it never needs an IAP equivalent. Existing lifetime members are "previously acquired" customers.
- By analogy, 3.1.2(a) points the same way: "If you are changing your existing app to a subscription-based business model, you should not take away the primary functionality existing users have already paid for." Strictly, that sentence is about an existing App Store app, which RestPilot doesn't have yet. The firmer basis is 3.1.3(b) itself: the Premium entitlement that lifetime members hold *is* offered as IAP.

### 4.2 Minimum Functionality: moderate risk, lowered by native features
> "Your app should include features, content, and UI that elevate it beyond a repackaged website. If your app is not particularly useful, unique, or “app-like,” it doesn't belong on the App Store."

- A Capacitor shell that loads restpilotai.com is the classic 4.2 risk.
- These lower it, so mention them in the review notes:
  - native reminders (local notifications);
  - the offline screen;
  - universal links / deep links (#13);
  - read-only Apple Health (#17);
  - the iPhone-specific layout (#22).
- 4.2.6 ("Apps created from a commercialized template or app generation service will be rejected unless they are submitted directly by the provider of the app's content") is satisfied as long as the owner submits from their own developer account. The app is built with Lovable.

### 5.1.1(v) Account Sign-In: met; check on a device
> "If your app supports account creation, you must also offer account deletion within the app."

- **Met.** Profile → Delete Account (type DELETE) deletes the account. It first tries to cancel any Stripe subscription (`src/lib/account.functions.ts`); a failed cancel is logged and the deletion still goes ahead.
- **When IAP ships:** deletion cannot cancel an Apple subscription. The confirmation must tell Apple subscribers to cancel in Settings → Apple ID → Subscriptions.
- **Check on a device:** Google sign-in inside the WKWebView shell. Google refuses OAuth in embedded web views. If it fails there, hide it in the app or open it in the system browser, so the reviewer doesn't hit a broken login (2.1).

### 4.8 Login Services: gap to close before submission
> "Apps that use a third-party or social login service (such as Facebook Login, Google Sign-In, …) to set up or authenticate the user's primary account with the app must also offer as an equivalent option another login service with the following features: the login service limits data collection to the user's name and email address; the login service allows users to keep their email address private as part of setting up their account; and the login service does not collect interactions with your app for advertising purposes without consent."

- **Gap:** `/auth` offers Google sign-in. The Sign in with Apple button is hidden ("hidden until Apple OAuth is configured in the backend", `src/routes/auth.tsx`).
- **Fix:** in the app, either enable Sign in with Apple, which needs Apple OAuth configured in the backend (an owner step), or hide Google sign-in and keep email/password only.

### 5.1.2 Data Use and Sharing: one gap to close before submission
> "(i) … You must clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission before doing so. …"

> "(vi) Data gathered from the HomeKit API, HealthKit, … may not be used for marketing, advertising or use-based data mining, including by third parties."

- **Gap:** coach messages and context go to third-party AI: the Lovable AI Gateway (Google Gemini) and OpenAI, as listed in `/legal/third-parties`. Onboarding asks users to acknowledge that AI may be inaccurate. It does **not** ask explicit permission to share their data with named third-party AI providers.
- **Fix:** add a short consent step in the app before the first AI use, naming the providers, with a way to withdraw.
- **Apple Health:** if Health data is ever included in AI prompts, it needs its own explicit permission, and must never be used for marketing (5.1.2(vi), 5.1.3).

### 2.1 App Completeness: submission checklist
> "(a) … include demo account info (and turn on your back-end service!) if your app includes a login. …"

> "(b) If you offer in-app purchases in your app, make sure they are complete, up-to-date, visible to the reviewer and functional. If any configured in-app purchase items cannot be found or reviewed in your app, explain the reason in your review notes."

- Provide a demo account. It should be free, so the reviewer can see the IAP paywall.
- Make sure the IAP products are approved together with the build.
- Test on a real iPhone: login, reminders, offline, deep links, purchase, restore and account deletion.

## Recommended path, in order

1. **Now:** publish `main` (`e8742a9`, which includes #40 and #50).
   - The website is unchanged for buyers.
   - The app shell shows no purchase at all.
   - Use internal TestFlight only. No App Review and no external TestFlight yet.
2. **Owner setup** (owner-only):
   - Paid Apps Agreement, banking and tax in App Store Connect.
   - One subscription group with two auto-renewable products: Monthly $7.99 and Annual $49.99, each with a 2-week free introductory offer.
   - A RevenueCat project and its public iOS API key.
   - App Store Server Notifications pointed at RevenueCat.
   - A sandbox tester.
3. **Engineering:**
   - Turn on the #16 IAP path for the host the app loads. Either port the flag-gated IAP pieces to `main`, or point the shell at a host that runs the Railway branch. This is the cutover owner's call.
   - Keep Stripe out of the app.
   - Close the 5.1.2 AI-consent gap and the 4.8 login gap, and check Google sign-in in the shell.
4. **Submit** with review notes that cover:
   - the demo account;
   - that web subscribers are recognized under 3.1.3(b), and the same plans are available as IAP;
   - the native features list (for 4.2).
5. **Optional, later:** a US-only "Subscribe on the web" link, alongside IAP. Re-check the guidelines and the court case first.
