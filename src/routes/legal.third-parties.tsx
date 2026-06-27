import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

const DOC = findLegalDoc("third-parties")!;

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
    name: "Stripe",
    purpose: "Subscription billing and payment processing",
    shared: "Email, billing details you enter at checkout",
    policy: "https://stripe.com/privacy",
  },
  {
    name: "Lovable AI Gateway (Google Gemini)",
    purpose: "AI text generation for coach, plans, briefings",
    shared:
      "Prompt context the AI orchestrator assembles for the current request",
    policy: "https://lovable.dev/privacy",
  },
  {
    name: "OpenAI",
    purpose: "Text-to-speech for audio briefings",
    shared: "The briefing text being read aloud",
    policy: "https://openai.com/policies/privacy-policy",
  },
  {
    name: "Fitbit (optional)",
    purpose: "Wearable sleep & activity sync",
    shared:
      "OAuth tokens; sleep, readiness, activity, heart-rate readings shared by Fitbit",
    policy: "https://www.fitbit.com/global/us/legal/privacy-policy",
  },
  {
    name: "Oura (optional)",
    purpose: "Wearable sleep & readiness sync",
    shared:
      "OAuth tokens; sleep, readiness, HRV, activity readings shared by Oura",
    policy: "https://ouraring.com/privacy-policy",
  },
  {
    name: "Open-Meteo",
    purpose: "Sunrise/sunset and weather inputs for the light plan",
    shared: "Approximate latitude/longitude only",
    policy: "https://open-meteo.com/en/terms",
  },
  {
    name: "BigDataCloud",
    purpose: "Reverse geocoding (turning coordinates into a city name)",
    shared: "Approximate latitude/longitude only",
    policy: "https://www.bigdatacloud.com/privacy-and-cookie-policy",
  },
  {
    name: "Web Push (Mozilla/Apple/Google push services)",
    purpose: "Delivering opt-in browser notifications",
    shared: "Browser-issued push subscription endpoint",
    policy: "https://www.w3.org/TR/push-api/",
  },
];

const PLANNED = [
  "Apple Health",
  "Google Health Connect",
  "Garmin",
  "WHOOP",
  "Calendar integrations",
  "Traffic providers",
  "Maps providers",
];

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
        <a href="mailto:privacy@restpilot.ai">privacy@restpilot.ai</a> to
        receive notice of new subprocessors.
      </p>
    </LegalLayout>
  ),
});
