import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

// PUBLISHING NOTE: several statements here describe the iPhone app only
// (Apple Health in section 5, "Purchases (iPhone app)" in sections 1/2/9, the
// iPhone paragraph in section 4 and the web-view storage sentence in section
// 1, the Apple Health retention row, and the Apple Health mention in section
// 3). They are false on the website alone: publish this page only when the
// iOS app ships. The matching Apple and RevenueCat rows are in
// legal.third-parties.tsx. Also WearableCard.tsx says "Coming in a future
// update - Apple Health ..." on main; that copy contradicts section 5.
export const DOC = findLegalDoc("privacy")!;

export const Route = createFileRoute("/legal/privacy")({
  head: () => ({
    meta: [
      { title: `${DOC.title} — RestPilot AI` },
      { name: "description", content: DOC.summary },
      { property: "og:title", content: `${DOC.title} — RestPilot AI` },
      { property: "og:description", content: DOC.summary },
      { property: "og:url", content: DOC.path },
    ],
    links: [{ rel: "canonical", href: DOC.path }],
  }),
  component: () => (
    <LegalLayout doc={DOC}>
      <p>
        This Privacy Policy explains how RestPilot AI ("we," "us," or "our")
        collects, uses, and protects information when you use our website,
        applications, and related services (the "Service"). For an overview of
        the companies we share data with, see{" "}
        <Link to="/legal/third-parties">Subprocessors &amp; Integrations</Link>.
      </p>

      <h2>1. Information we collect</h2>
      <h3>Information you provide</h3>
      <ul>
        <li>
          <strong>Account:</strong> email address, display name, password hash
          (or OAuth identifier if you sign in with Google or Apple; with
          Apple you can choose to share a private relay email address
          instead of your own).
        </li>
        <li>
          <strong>Profile &amp; preferences:</strong> target sleep hours,
          wind-down preferences, employers, role, notification preferences.
        </li>
        <li>
          <strong>Places &amp; addresses:</strong> the home, work and other
          destination addresses and labels you save for travel-time estimates,
          and the city or location name you choose for weather.
        </li>
        <li>
          <strong>Calendars:</strong> the calendar feed (.ics) web addresses
          you add and the events imported from them.
        </li>
        <li>
          <strong>Coach messages &amp; voice:</strong> the messages you send to
          the AI coach and, if you use voice, your voice recordings. See{" "}
          <a href="#ai-providers">AI providers and your permission</a> for
          who processes them. Any health or sleep details you choose to
          share in a message are stored with your coach conversation and
          processed like your other messages, including by the AI providers
          listed there.
        </li>
        <li>
          <strong>Contact form:</strong> if you write to us through the contact
          form, the name, email address and message you enter.
        </li>
        <li>
          <strong>Shifts &amp; planning data:</strong> shifts you log, trips,
          time-zone events, manual feedback you give the AI coach.
        </li>
        <li>
          <strong>Wearable data (optional, existing connections only):</strong>{" "}
          Fitbit and Oura can no longer be newly connected from the app at the
          moment. If you connected one earlier, we receive the sleep,
          readiness, and activity metrics that service shares with us.
        </li>
        <li>
          <strong>Purchases (iPhone app):</strong> if you subscribe in the
          iPhone app, the purchase is made through Apple, and we (with our
          subscription provider RevenueCat) receive your subscription status
          and purchase history for your account. We do not receive your Apple
          payment card details.
        </li>
        <li>
          <strong>Apple Health (iPhone app, optional):</strong> read on your
          device only if you connect it, and kept on your iPhone. See{" "}
          <a href="#apple-health">Apple Health</a> below.
        </li>
      </ul>

      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Device &amp; usage:</strong> browser type, operating system,
          coarse approximate timezone, and basic diagnostic info.
        </li>
        <li>
          <strong>Location (only on request):</strong> in the iPhone app or in
          your browser, when you tap "Detect" or "Use current location", your
          device location is read (only while the app is open and only at that
          moment). The latitude and longitude are then{" "}
          <strong>stored in your account</strong>. In some places (weather
          location and saved destinations) we round them to four decimal
          places, about 11 metres, before saving; elsewhere in Profile they
          are saved as your device reports them. We use the stored coordinates
          for weather (Open-Meteo), sunrise and sunset for your light plan, a
          city name for display (BigDataCloud receives the coordinates to look
          it up) and travel time (the OSRM routing service receives your
          starting point and destination coordinates). We do not track your
          location in the background or continuously. You can change the saved
          location in Profile, and turn location permission off in your device
          settings.
        </li>
        <li>
          <strong>Storage on your device:</strong> we use{" "}
          <Link to="/legal/cookies">browser storage</Link> (cookies,
          localStorage, IndexedDB, service-worker cache) to keep you signed in
          and to enable offline mode. In the iPhone app the same storage lives
          in the app's own web view (see section 4).
        </li>
      </ul>

      <h3>Information generated by the Service</h3>
      <ul>
        <li>
          <strong>AI memory:</strong> short structured facts the AI extracts
          from your interactions, with your control. See "AI memory" below.
        </li>
        <li>
          <strong>AI logs &amp; recommendations:</strong> records of AI
          decisions and the inputs used to make them.
        </li>
      </ul>

      <h2>2. How we use information</h2>
      <ul>
        <li>To operate, secure, and improve the Service.</li>
        <li>To generate your circadian schedule, alarms, and recovery plan.</li>
        <li>To send notifications you opt into.</li>
        <li>To process payments: on the website through Stripe, and in the iPhone app through Apple (with RevenueCat managing subscription status).</li>
        <li>To comply with law and enforce our agreements.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal information and we do
        not use it for third-party advertising.
      </p>

      <h2>3. Legal bases (EEA/UK users)</h2>
      <p>
        Where the GDPR applies, we process personal data under the following
        bases: performance of a contract (operating the Service), legitimate
        interests (security, product improvement, fraud prevention), consent
        (location, Apple Health in the iPhone app, push notifications, wearables, optional AI
        memory, and sharing your data with AI providers), and
        compliance with legal obligations.
      </p>

      <h2 id="local-storage">4. Local &amp; offline storage</h2>
      <p>
        RestPilot AI is designed to work offline. We cache a copy of your
        current plan and recent recommendations on your device using your
        browser's storage so the app remains useful without a connection. You
        can clear this data at any time by signing out, clearing site data in
        your browser, or uninstalling the installed app.
      </p>
      <p>
        In the RestPilot iPhone app this storage is the app's own web view
        storage on your phone; it holds your signed-in session and cached
        data, and if you connect Apple Health, the Apple Health summaries
        described in section 5. Signing out removes the cached plan data and
        the Apple Health summaries from the app. Like other app data, the
        app's local storage may be included in your iPhone backup (iCloud or
        computer backup) if you have device backups turned on; RestPilot does
        not itself upload it to iCloud.
      </p>

      <h2 id="apple-health">5. Apple Health (iPhone app)</h2>
      <p>
        In the RestPilot iPhone app you can choose to connect Apple Health.
        RestPilot asks Apple Health for access only after you tap "Connect
        Apple Health" and approve Apple's permission sheet. If you connect:
      </p>
      <ul>
        <li>
          <strong>What we read:</strong> sleep analysis, heart rate
          variability (SDNN) and resting heart rate. Nothing else.
        </li>
        <li>
          <strong>Read only:</strong> RestPilot never writes anything to Apple
          Health.
        </li>
        <li>
          <strong>What we keep, and where:</strong> nightly summaries for the
          last 14 days, stored in the RestPilot app's local storage on your
          iPhone. They are used on your phone to tailor your sleep plan and
          recommendations.
        </li>
        <li>
          <strong>Not sent anywhere:</strong> Apple Health data is not sent to
          RestPilot's servers and is not included in what we send to AI
          providers.
        </li>
        <li>
          <strong>Not for advertising:</strong> we do not use Apple Health
          data for advertising or marketing, and we do not sell it.
        </li>
        <li>
          <strong>Removal:</strong> tapping Disconnect in Profile, signing
          out, or signing in as a different account deletes RestPilot's copy.
          To withdraw RestPilot's permission in Apple Health too, use
          Settings → Health → Data Access &amp; Devices → RestPilot.
        </li>
        <li>
          <strong>Backups:</strong> RestPilot does not upload this data to
          iCloud itself. However, like other app data, it may be included in
          your iPhone backup if you have iCloud or computer backup turned on.
        </li>
      </ul>

      <h2>6. AI memory</h2>
      <p>
        With your permission, the AI maintains a small set of structured
        memories about you (such as "prefers caffeine cutoff at 14:00") to
        personalize recommendations. You can view, edit, delete, export, and
        disable AI memory entirely from the{" "}
        <Link to="/memory">Memory page</Link>. The AI does not generate
        AI memories about your health or other sensitive categories (this
        concerns AI memories only; messages you send to the coach are handled
        as described in section 1).
      </p>

      <h2 id="ai-providers">7. AI providers and your permission</h2>
      <p>
        RestPilot's AI features (the coach, voice conversations, spoken
        briefings, insights, plans and shift-swap advice) are powered by
        third-party AI providers. We send your personal data to them only
        after you allow it in the app, and only when you use an AI feature:
      </p>
      <ul>
        <li>
          <strong>Google Gemini, through the Lovable AI Gateway:</strong> your
          coach messages and the context RestPilot adds to them, such as your
          shifts and schedule, sleep and fatigue estimates, preferences,
          preferred name, AI memories (only if you turned AI memory on), and
          summaries from a wearable you connected earlier (Fitbit or Oura). Used to write
          coach replies, briefings, plans, insights and shift-swap advice.
        </li>
        <li>
          <strong>OpenAI</strong> (directly, and through the Lovable AI
          Gateway): your voice recordings, the text read aloud to you, your
          preferred name and your voice settings. Used for speech-to-text,
          spoken replies and briefings, and live voice conversations.
        </li>
        <li>
          <strong>ElevenLabs:</strong> the text of companion replies being read
          aloud. Used to read them in a natural voice.
        </li>
      </ul>
      <p>
        We ask for this permission once, before your first use of an AI
        feature. If you choose "Not now", nothing is sent and the rest of
        RestPilot keeps working. You can withdraw your permission at any time
        in Profile → Privacy &amp; AI data sharing; new
        AI requests stop immediately, and a live voice conversation on that
        device ends (one already running on another device continues until it
        ends). Withdrawing does not recall data already sent for earlier
        requests. We do not sell this data or use it for
        advertising. Each provider is listed, with a link to its privacy
        policy, in{" "}
        <Link to="/legal/third-parties">Subprocessors &amp; Integrations</Link>.
      </p>

      <h2>8. Retention</h2>
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            <th className="py-2">Category</th>
            <th className="py-2">Retention</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Account</td>
            <td>Until you delete your account</td>
          </tr>
          <tr>
            <td>Shifts, trips, preferences</td>
            <td>Until you delete them or delete your account</td>
          </tr>
          <tr>
            <td>Saved location, addresses and calendar feeds</td>
            <td>Until you change or delete them or delete your account</td>
          </tr>
          <tr>
            <td>Apple Health summaries (iPhone only)</td>
            <td>
              Last 14 days, on your iPhone only; deleted on Disconnect, sign-out
              or account switch; may be included in your device backup
            </td>
          </tr>
          <tr>
            <td>Wearable readings</td>
            <td>Rolling 365 days; deleted on disconnect</td>
          </tr>
          <tr>
            <td>AI logs</td>
            <td>90 days for diagnostics</td>
          </tr>
          <tr>
            <td>AI recommendations &amp; feedback</td>
            <td>365 days, then aggregated/anonymized</td>
          </tr>
          <tr>
            <td>Billing records</td>
            <td>As required by tax law (typically 7 years)</td>
          </tr>
          <tr>
            <td>Backups</td>
            <td>Rolling 30 days</td>
          </tr>
        </tbody>
      </table>

      <h2>9. Sharing</h2>
      <p>
        We share data with the third-party providers listed in our{" "}
        <Link to="/legal/third-parties">Subprocessors &amp; Integrations</Link>{" "}
        registry only as needed to operate the Service, and with authorities
        when required by law. Payments: on the website, payments are handled by
        Stripe; in the iPhone app, purchases are made through Apple, and
        RevenueCat receives your user ID and purchase history to tell us
        whether your subscription is active. Apple Health data is not shared
        with anyone (see section 5).
      </p>

      <h2>10. International transfers</h2>
      <p>
        Our infrastructure may process data in the United States and the
        European Union. Where required, we rely on Standard Contractual
        Clauses or equivalent safeguards.
      </p>

      <h2>11. Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access,
        correct, port, delete, restrict, or object to processing of your
        personal data, and to withdraw consent at any time. You can exercise
        most of these rights directly from{" "}
        <Link to="/profile">Profile</Link>: download your data, manage AI
        memory, or delete your account. Account deletion is permanent and
        removes associated personal data within 30 days, except where we are
        required to retain it.
      </p>
      <p>
        California residents: under the CCPA/CPRA, you have rights to know,
        delete, correct, and limit use of sensitive personal information. We
        do not "sell" or "share" personal information as defined by the
        CCPA/CPRA.
      </p>

      <h2>12. Security</h2>
      <p>
        Data is transmitted over HTTPS and stored on encrypted servers
        operated by our infrastructure provider. See our{" "}
        <Link to="/legal/security">Security &amp; Responsible Disclosure</Link>
        {" "}page for our security practices and how to report a
        vulnerability.
      </p>

      <h2>13. Children</h2>
      <p>
        The Service is not directed to children under 16, and we do not
        knowingly collect personal information from them. If you believe a
        child has provided us personal information, contact{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a>.
      </p>

      <h2>14. Changes</h2>
      <p>
        We will post any changes to this Policy here with an updated
        "Effective" date. Material changes will be highlighted in the app.
      </p>

      <h2>15. Contact</h2>
      <p>
        Email{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a> for
        questions or to exercise your rights.
      </p>
    </LegalLayout>
  ),
});
