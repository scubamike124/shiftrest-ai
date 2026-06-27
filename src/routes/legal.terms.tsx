import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

const DOC = findLegalDoc("terms")!;

export const Route = createFileRoute("/legal/terms")({
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
      <h2>1. Acceptance of these terms</h2>
      <p>
        These Terms of Service ("Terms") form a binding agreement between you
        and RestPilot AI ("RestPilot," "we," "us," or "our") governing your
        access to and use of the RestPilot AI website, applications, and
        related services (collectively, the "Service"). By creating an account
        or using the Service you agree to these Terms, our{" "}
        <Link to="/legal/privacy">Privacy Policy</Link>, our{" "}
        <Link to="/legal/acceptable-use">Acceptable Use Policy</Link>, and our{" "}
        <Link to="/legal/disclaimers">AI &amp; Health Disclaimers</Link>. If
        you do not agree, do not use the Service.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 16 years old (or the age of digital consent in
        your jurisdiction) to use RestPilot AI. By using the Service you
        represent that you meet this requirement and that you have the
        authority to enter into these Terms.
      </p>

      <h2>3. Accounts and security</h2>
      <p>
        You are responsible for safeguarding your credentials and for all
        activity under your account. Notify us immediately at{" "}
        <a href="mailto:security@restpilot.ai">security@restpilot.ai</a> if
        you suspect unauthorized use.
      </p>

      <h2>4. The Service</h2>
      <p>
        RestPilot AI is a software platform that helps shift workers plan
        sleep windows, wind-down routines, light exposure, and recovery
        schedules using algorithmic recommendations and AI-assisted features.
        It is an informational tool only and is described in detail in our{" "}
        <Link to="/legal/disclaimers">disclaimers</Link>.
      </p>

      <h2>5. AI features</h2>
      <p>
        Portions of the Service use third-party large language models and
        text-to-speech providers (see{" "}
        <Link to="/legal/third-parties">Subprocessors &amp; Integrations</Link>
        ). AI output may be incomplete, inaccurate, or out of date. You are
        responsible for reviewing AI suggestions before acting on them. See
        the AI Disclaimer in <Link to="/legal/disclaimers">our disclaimers</Link>.
      </p>

      <h2>6. Subscriptions and payment</h2>
      <p>
        Paid features are offered through monthly, annual, and lifetime plans
        as described on our <Link to="/pricing">pricing page</Link> and in our{" "}
        <Link to="/legal/subscription">Subscription Terms</Link>, which are
        incorporated by reference. Recurring subscriptions automatically renew
        at the listed price until cancelled.
      </p>

      <h2>7. Acceptable use</h2>
      <p>
        You agree to comply with our{" "}
        <Link to="/legal/acceptable-use">Acceptable Use Policy</Link>. We may
        suspend or terminate accounts that violate it.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        The Service, including the RestPilot AI software, source code,
        algorithms, models, AI systems, Long Clock, Smart Alarm, AI Decision
        Center, Companion AI, design, branding, logos, and website content,
        is owned by RestPilot AI and protected by intellectual-property laws.
        Subject to your compliance with these Terms, we grant you a limited,
        revocable, non-exclusive, non-transferable license to access and use
        the Service for personal, non-commercial purposes, as further
        described in our <Link to="/legal/license">Software License Agreement</Link>.
      </p>

      <h2>9. User content</h2>
      <p>
        You retain ownership of the content you submit (such as shifts,
        preferences, and notes). You grant us a worldwide, royalty-free
        license to host, process, and display that content solely to operate
        and improve the Service. We do not sell your personal data.
      </p>

      <h2>10. Feedback</h2>
      <p>
        If you send us feedback or suggestions, we may use them without
        restriction or compensation.
      </p>

      <h2>11. Termination</h2>
      <p>
        You can delete your account at any time from{" "}
        <Link to="/profile">Profile</Link>. We may suspend or terminate access
        for material breach, fraud, abuse, or as required by law. Provisions
        that by their nature should survive termination (e.g. IP, disclaimers,
        liability) survive.
      </p>

      <h2>12. Warranty disclaimer</h2>
      <p>
        THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES
        OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION
        WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
        NON-INFRINGEMENT, OR ACCURACY OF AI OUTPUT. WE DO NOT GUARANTEE ANY
        PARTICULAR HEALTH, SLEEP, OR PERFORMANCE OUTCOME.
      </p>

      <h2>13. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, RESTPILOT AI WILL NOT BE
        LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
        EXEMPLARY, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUES,
        DATA, OR GOODWILL, ARISING OUT OF OR RELATED TO THE SERVICE. OUR
        AGGREGATE LIABILITY WILL NOT EXCEED THE GREATER OF (A) AMOUNTS YOU
        PAID US IN THE TWELVE MONTHS PRECEDING THE CLAIM AND (B) USD 100.
      </p>

      <h2>14. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless RestPilot AI, its officers,
        directors, employees, and agents from any claims, damages, and
        expenses (including reasonable attorneys' fees) arising out of your
        use of the Service, your content, or your violation of these Terms.
      </p>

      <h2>15. Force majeure</h2>
      <p>
        Neither party will be liable for delays or failures caused by events
        beyond reasonable control, including acts of God, war, terrorism,
        labor disputes, network or power failures, or governmental action.
      </p>

      <h2>16. Governing law and venue</h2>
      <p>
        These Terms are governed by the laws of the State of [<em>to be
        finalized by counsel</em>], excluding its conflict-of-laws rules. The
        state and federal courts located in [<em>to be finalized by counsel</em>]
        will have exclusive jurisdiction, except as set forth in Section 17.
      </p>

      <h2>17. Dispute resolution &amp; arbitration</h2>
      <p>
        We will first try to resolve any dispute informally by contacting{" "}
        <a href="mailto:legal@restpilot.ai">legal@restpilot.ai</a>. If we
        cannot resolve it within 60 days, any dispute will be resolved by
        binding individual arbitration administered by [<em>arbitration body
        to be selected by counsel</em>] under its then-current rules, except
        you may bring qualifying claims in small-claims court. YOU AND
        RESTPILOT AGREE THAT EACH MAY BRING CLAIMS AGAINST THE OTHER ONLY IN
        AN INDIVIDUAL CAPACITY, AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY
        CLASS OR REPRESENTATIVE PROCEEDING. Jurisdictions that do not permit
        such waivers are excluded.
      </p>

      <h2>18. Changes</h2>
      <p>
        We may update these Terms from time to time. We will post the updated
        version and update the "Effective" date. Continued use after a change
        constitutes acceptance.
      </p>

      <h2>19. Contact</h2>
      <p>
        Email <a href="mailto:legal@restpilot.ai">legal@restpilot.ai</a> for
        any questions about these Terms.
      </p>
    </LegalLayout>
  ),
});
