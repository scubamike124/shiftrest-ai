import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

export const DOC = findLegalDoc("regional")!;

export const Route = createFileRoute("/legal/regional")({
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
        This page summarizes additional rights and disclosures that apply
        to RestPilot AI users in specific regions. It supplements — but
        does not replace — our{" "}
        <Link to="/legal/privacy">Privacy Policy</Link> and{" "}
        <Link to="/legal/terms">Terms of Service</Link>. Where local law
        gives you stronger rights than the general policies, those local
        rights apply.
      </p>

      <h2 id="eu-uk">European Economic Area, United Kingdom &amp; Switzerland</h2>
      <p>
        Under the GDPR and the UK GDPR you have the right to access,
        rectify, erase, restrict processing of, port, and object to
        processing of your personal data, and to lodge a complaint with
        your local supervisory authority. Our legal bases include
        performance of a contract (operating the Service), legitimate
        interests (security, fraud prevention, improving the Service),
        consent (notifications, optional AI memory), and legal obligation.
        Our EU/UK representative and DPO contact will be listed here once
        appointed by counsel.
      </p>
      <p>
        <strong>14-day withdrawal:</strong> Consumers in the EU/EEA may have
        a 14-day right to withdraw from a paid subscription after purchase
        under the Consumer Rights Directive. By starting to use a paid
        feature within that window you may waive that right; see our{" "}
        <Link to="/legal/subscription">Subscription Terms</Link>.
      </p>

      <h2 id="california">California (CCPA / CPRA)</h2>
      <p>
        California residents have the right to know what personal
        information we collect, to delete it, to correct it, to opt out of
        sale or sharing for cross-context behavioral advertising, and to
        limit the use of sensitive personal information. We do{" "}
        <strong>not sell</strong> personal information and we do not share
        it for cross-context behavioral advertising. To exercise your
        rights, use the Delete Account control in{" "}
        <Link to="/profile">Profile</Link> or email{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a>. We
        will not discriminate against you for exercising these rights.
      </p>

      <h2 id="canada">Canada (PIPEDA)</h2>
      <p>
        Under PIPEDA you may request access to and correction of personal
        information we hold about you, and you may withdraw consent
        (subject to legal and contractual restrictions). Contact{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a>.
      </p>

      <h2 id="australia">Australia (Privacy Act / APPs)</h2>
      <p>
        Australian users have rights under the Privacy Act 1988 and the
        Australian Privacy Principles, including access and correction
        rights and the ability to make a complaint to the OAIC.
      </p>

      <h2 id="brazil">Brazil (LGPD)</h2>
      <p>
        Brazilian users have rights under the LGPD, including the right to
        confirm processing, access data, correct data, anonymize or delete
        data, port data, and revoke consent. Contact{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a>.
      </p>

      <h2 id="other">Other regions</h2>
      <p>
        If you live in another jurisdiction with specific privacy or
        consumer-protection rights, those rights apply where required by
        local law. Email{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a> to
        exercise them.
      </p>
    </LegalLayout>
  ),
});
