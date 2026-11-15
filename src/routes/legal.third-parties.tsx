import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

export const DOC = findLegalDoc("third-parties")!;

type Row = {
  name: string;
  purpose: string;
  shared: string;
  policy: string;
};

const ACTIVE: Row[] = [
  {
    name: "Lovable Cloud (managed Supabase)",
    purpose: "Hosting, authentication, database, file storage",
    shared: "Account, profile, shifts, preferences, AI memory & logs",
    policy: "https://lovable.dev/privacy",
  },
  {
    name: "Stripe (website payments)",
    purpose: "Subscription billing and payment processing on the website",
    shared: "Email, billing details you enter at checkout",
    policy: "https://stripe.com/privacy",
  },
  {
    name: "Apple (iPhone app)",
    purpose:
      "In-app purchases and subscriptions in the iPhone app (purchases are made through Apple, not Stripe); Sign in with Apple if you choose it",
    shared:
      "Purchases are processed by Apple under its own terms; we receive subscription status and transaction information, not your payment card. With Sign in with Apple: the identifier, name and email (or private relay email) you choose to share",
    policy: "https://www.apple.com/legal/privacy/",
  },
  {
    name: "RevenueCat",
    purpose:
      "Managing in-app purchases and subscription status in the iPhone app",
    shared:
      "Your RestPilot user ID (used as the RevenueCat app user ID) and your purchase and subscription history",
    policy: "https://www.revenuecat.com/privacy/",
  },
  {
    name: "Lovable AI Gateway (Google Gemini)",
    purpose:
      "AI text generation for the coach, briefings, plans, insights and shift-swap advice. Only after you allow AI features.",
    shared:
      "Your coach messages and the context added to them: shifts and schedule, sleep and fatigue estimates, preferences, preferred name, AI memories (if on), wearable summaries (if connected)",
    policy: "https://lovable.dev/privacy",
  },
  {
    name: "OpenAI (directly and via the Lovable AI Gateway)",
    purpose:
      "Speech-to-text, text-to-speech and live voice conversations. Only after you allow AI features.",
    shared: "Your voice recordings, the text read aloud to you, your preferred name, your voice settings",
    policy: "https://openai.com/policies/privacy-policy",
  },
  {
    name: "ElevenLabs",
    purpose: "Text-to-speech for companion replies. Only after you allow AI features.",
    shared: "The text of companion replies being read aloud",
    policy: "https://elevenlabs.io/privacy-policy",
  },
  {
    name: "Fitbit (existing connections only)",
    purpose:
      "Wearable sleep & activity sync for accounts connected earlier. New connections are not currently offered in the app.",
    shared:
      "OAuth tokens; sleep, readiness, activity, heart-rate readings shared by Fitbit",
    policy: "https://www.fitbit.com/global/us/legal/privacy-policy",
  },
  {
    name: "Oura (existing connections only)",
    purpose:
      "Wearable sleep & readiness sync for accounts connected earlier. New connections are not currently offered in the app.",
    shared:
      "OAuth tokens; sleep, readiness, HRV, activity readings shared by Oura",
    policy: "https://ouraring.com/privacy-policy",
  },
  {
    name: "Open-Meteo",
    purpose:
      "Weather, air quality and sunrise/sunset for the light plan, and looking up a city name you type",
    shared:
      "Your saved latitude/longitude (to about 11 m precision, or as your device reports it) for weather; the city name you type when searching",
    policy: "https://open-meteo.com/en/terms",
  },
  {
    name: "BigDataCloud",
    purpose: "Reverse geocoding (turning coordinates into a city name)",
    shared:
      "The latitude/longitude your device reports when you tap Detect, sent from your device",
    policy: "https://www.bigdatacloud.com/privacy-and-cookie-policy",
  },
  {
    name: "OSRM (public routing service)",
    purpose: "Driving route and travel-time estimates between your places",
    shared:
      "Start and destination coordinates (your current location or saved places), sent from our servers; no name or account details",
    policy: "https://project-osrm.org/",
  },
  {
    name: "Web Push (Mozilla/Apple/Google push services)",
    purpose: "Delivering opt-in browser notifications",
    shared: "Browser-issued push subscription endpoint",
    policy: "https://www.w3.org/TR/push-api/",
  },
];

const PLANNED = ["Google Health Connect", "Garmin", "WHOOP"];

export const Route = createFileRoute("/legal/third-parties")({
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
        We share data with the third parties listed below to operate the
        Service. We do not sell your personal information. For broader
        context, see our <Link to="/legal/privacy">Privacy Policy</Link>.
      </p>

      <h2>Active subprocessors &amp; integrations</h2>
      <div className="not-prose overflow-x-auto">
        <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-xs">
          <thead className="text-foreground">
            <tr>
              <th className="border-b border-border/60 py-2 pr-3">Provider</th>
              <th className="border-b border-border/60 py-2 pr-3">Purpose</th>
              <th className="border-b border-border/60 py-2 pr-3">
                Data shared
              </th>
              <th className="border-b border-border/60 py-2">Policy</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {ACTIVE.map((r) => (
              <tr key={r.name}>
                <td className="border-b border-border/40 py-3 pr-3 font-medium text-foreground">
                  {r.name}
                </td>
                <td className="border-b border-border/40 py-3 pr-3">
                  {r.purpose}
                </td>
                <td className="border-b border-border/40 py-3 pr-3">
                  {r.shared}
                </td>
                <td className="border-b border-border/40 py-3">
                  <a
                    href={r.policy}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline"
                  >
                    Link
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Apple Health (on your iPhone only)</h2>
      <p>
        If you connect Apple Health in the iPhone app, RestPilot reads sleep
        analysis, heart rate variability and resting heart rate on your device.
        This data stays on your iPhone: it is not sent to RestPilot's servers,
        to any provider listed above, or to AI providers, and it is not used
        for advertising or sold. Details are in the{" "}
        <Link to="/legal/privacy" hash="apple-health">
          Privacy Policy
        </Link>
        .
      </p>

      <h2>Calendar feeds</h2>
      <p>
        If you add a calendar (.ics) link, our servers fetch it from the host
        that link points to, so that host (for example your calendar provider)
        sees the request. Only the link you provide is requested.
      </p>

      <h2>Planned integrations (not yet active)</h2>
      <p>
        The following integrations are on our roadmap but are not enabled
        today. We will update this page and request the appropriate
        permissions before any of them collect or share data.
      </p>
      <ul>
        {PLANNED.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>

      <h2>Changes</h2>
      <p>
        We will update this page when we add or remove a subprocessor. Email{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a> to
        receive notice of new subprocessors.
      </p>
    </LegalLayout>
  ),
});
