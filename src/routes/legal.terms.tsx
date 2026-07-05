import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

export const DOC = findLegalDoc("terms")!;

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
        <a href="mailto:security@restpilotai.com">security@restpilotai.com</a> if
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
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a>. If we
        cannot resolve it within 60 days, any dispute will be resolved by
        binding individual arbitration administered by [<em>arbitration body
        to be selected by counsel</em>] under its then-current rules, except
        you may bring qualifying claims in small-claims court. YOU AND
        RESTPILOT AGREE THAT EACH MAY BRING CLAIMS AGAINST THE OTHER ONLY IN
        AN INDIVIDUAL CAPACITY, AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY
        CLASS OR REPRESENTATIVE PROCEEDING. Jurisdictions that do not permit
        such waivers are excluded.
      </p>

      <h2 id="ugc">18. User-generated content</h2>
      <p>
        "User Content" means anything you submit to the Service, including
        shifts, preferences, notes, trip details, voluntary feedback, and any
        photos, video, voice recordings, documents, or AI-generated artifacts
        you may upload through current or future features. You represent and
        warrant that you own, or have all necessary rights and permissions
        to submit, your User Content, and that submitting it does not
        violate any third party's rights or any law. You remain legally
        responsible for your User Content. You retain ownership of your
        User Content. You grant RestPilot AI a worldwide, non-exclusive,
        royalty-free license — for the limited purpose of operating,
        securing, improving, and providing the Service to you — to host,
        store, reproduce, process, transmit, display, and create derivative
        works of your User Content (for example, generating an AI summary
        of your shifts). We do not claim ownership of your User Content and
        we do not sell it.
      </p>

      <h2 id="service-availability">19. Service availability &amp; changes</h2>
      <p>
        We work to keep the Service available, but we do not guarantee
        uninterrupted, error-free, or always-current operation. Temporary
        outages may occur for maintenance, security, or technical reasons.
        We may, with or without notice where permitted by law: modify,
        add, or discontinue features; change, upgrade, or replace AI
        models, text-to-speech providers, hosting providers, wearable
        integrations, or other subprocessors; update pricing or subscription
        offerings (subject to our{" "}
        <Link to="/legal/subscription">Subscription Terms</Link>); and
        retire legacy functionality. For material changes that
        disadvantage paying users we will provide reasonable advance notice
        and an opportunity to cancel before the change takes effect.
      </p>

      <h2 id="account-security">20. Account security</h2>
      <p>
        You are responsible for: (a) creating and maintaining a strong,
        unique password; (b) protecting the devices, browsers, and email
        accounts used to access the Service; (c) keeping recovery
        information current; and (d) notifying us immediately at{" "}
        <a href="mailto:security@restpilotai.com">security@restpilotai.com</a> if
        you believe your account has been accessed without authorization.
        You are responsible for all activity that occurs under your account
        until you have reported the unauthorized access and we have had a
        reasonable opportunity to act.
      </p>

      <h2 id="feedback">21. Feedback license</h2>
      <p>
        Feature requests, suggestions, ideas, and other feedback you send
        us are voluntary. By submitting feedback you grant RestPilot AI a
        perpetual, irrevocable, worldwide, royalty-free, sublicensable
        license to use, reproduce, modify, and incorporate that feedback
        into the Service and our other products without restriction or
        attribution. You are not entitled to compensation, attribution, or
        any other consideration solely because we implement, are inspired
        by, or independently develop something similar to your feedback.
      </p>

      <h2 id="esign">22. Electronic consent &amp; records</h2>
      <p>
        By creating an account, clicking a checkbox or button to accept
        these Terms, or otherwise using the Service, you consent to
        transact with RestPilot AI electronically. You agree that
        electronic acceptance is legally binding where permitted by law
        and that electronic records (including emails, in-product
        notifications, and timestamped acceptance logs) satisfy any legal
        requirement that such communications be in writing. Full details
        appear in our{" "}
        <Link to="/legal/electronic-consent">
          Electronic Consent &amp; E-SIGN Disclosure
        </Link>
        .
      </p>

      <h2 id="age">23. Age &amp; minor consent</h2>
      <p>
        The Service is intended for adults. You must be at least 16 years
        old to use the Service, and at least 18 (or the applicable age of
        majority in your jurisdiction) to enter a paid subscription. If
        local law sets a higher age of digital consent, that age applies.
        Where permitted, a parent or legal guardian may consent on behalf
        of a minor who meets the minimum age and may bind that minor to
        these Terms. People who are not legally able to enter binding
        agreements in their jurisdiction may not use the Service.
      </p>

      <h2 id="changes">24. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. We will post the
        updated version and update the "Effective" date. Continued use
        after a change constitutes acceptance.
      </p>

      <h2 id="contact">25. Contact</h2>
      <p>
        Email <a href="mailto:support@restpilotai.com">support@restpilotai.com</a> for
        any questions about these Terms.
      </p>
    </LegalLayout>
  ),
});

