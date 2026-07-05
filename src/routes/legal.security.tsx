import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

export const DOC = findLegalDoc("security")!;

export const Route = createFileRoute("/legal/security")({
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
      <h2>Security practices</h2>
      <ul>
        <li>
          <strong>Transport:</strong> all traffic is served over HTTPS with
          modern TLS.
        </li>
        <li>
          <strong>Storage:</strong> account and application data is stored
          in encrypted, access-controlled databases operated by our
          infrastructure provider.
        </li>
        <li>
          <strong>Authentication:</strong> sessions use industry-standard
          token authentication. Optional social sign-in via Google.
        </li>
        <li>
          <strong>Row-level security:</strong> per-user database isolation is
          enforced at the database layer, not just the application layer.
        </li>
        <li>
          <strong>Secrets:</strong> server-side secrets (API keys, webhook
          secrets) are never shipped to the browser.
        </li>
        <li>
          <strong>Backups:</strong> automated backups are retained for a
          rolling 30-day window.
        </li>
      </ul>

      <h2>Responsible disclosure</h2>
      <p>
        We welcome security research conducted in good faith. If you discover
        a vulnerability:
      </p>
      <ul>
        <li>
          Email{" "}
          <a href="mailto:security@restpilotai.com">security@restpilotai.com</a>{" "}
          with a clear description and steps to reproduce.
        </li>
        <li>
          Do not access, modify, or delete data that does not belong to you.
        </li>
        <li>
          Do not perform denial-of-service testing or social-engineering
          attacks against our staff or users.
        </li>
        <li>
          Give us a reasonable time to investigate and remediate before
          public disclosure.
        </li>
      </ul>
      <p>
        We will acknowledge reports within 5 business days and will not pursue
        legal action against researchers acting in good faith and within this
        policy.
      </p>

      <h2>Breach notification</h2>
      <p>
        In the event of a security incident affecting your personal data, we
        will notify affected users and applicable regulators in accordance
        with applicable law.
      </p>
    </LegalLayout>
  ),
});
