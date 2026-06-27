import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

const DOC = findLegalDoc("acceptable-use")!;

export const Route = createFileRoute("/legal/acceptable-use")({
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
        This Acceptable Use Policy ("AUP") applies to all use of the RestPilot
        AI Service and is incorporated into our{" "}
        <Link to="/legal/terms">Terms of Service</Link>.
      </p>

      <h2>1. You may not</h2>
      <ul>
        <li>Use the Service to harm yourself or others.</li>
        <li>
          Reverse-engineer, decompile, scrape, or attempt to extract the
          source code, models, prompts, or training data of the Service.
        </li>
        <li>
          Access the Service through automated means (bots, crawlers,
          scrapers) without our prior written consent.
        </li>
        <li>
          Resell, sublicense, or redistribute access to the Service or its AI
          output.
        </li>
        <li>
          Probe, scan, or test the vulnerability of the Service except as
          permitted under our{" "}
          <Link to="/legal/security">Responsible Disclosure</Link> policy.
        </li>
        <li>
          Submit content that is unlawful, defamatory, infringing, or that
          contains malware.
        </li>
        <li>
          Use the Service to make medical diagnoses, prescribe treatment, or
          provide professional health advice to third parties.
        </li>
        <li>
          Use AI output in safety-critical environments (medical care,
          transportation, industrial control, etc.) without independent
          professional verification.
        </li>
      </ul>

      <h2>2. Enforcement</h2>
      <p>
        We may investigate and respond to suspected violations, including
        suspending or terminating access, removing content, and cooperating
        with law enforcement.
      </p>

      <h2>3. Reporting abuse</h2>
      <p>
        Report violations to{" "}
        <a href="mailto:abuse@restpilot.ai">abuse@restpilot.ai</a>.
      </p>
    </LegalLayout>
  ),
});
