import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

const DOC = findLegalDoc("electronic-consent")!;

export const Route = createFileRoute("/legal/electronic-consent")({
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
        This Electronic Consent &amp; E-SIGN Disclosure describes how
        RestPilot AI uses electronic communications, records, and signatures.
        It supports the U.S. Electronic Signatures in Global and National
        Commerce Act ("E-SIGN"), the Uniform Electronic Transactions Act
        ("UETA"), and equivalent laws in other jurisdictions where permitted.
      </p>

      <h2>1. Your consent</h2>
      <p>
        By creating an account, ticking a consent checkbox, clicking a
        button labeled "I agree" / "Continue" / "Subscribe," or otherwise
        using the Service after being shown a legal notice, you consent to:
      </p>
      <ul>
        <li>
          Conduct business with RestPilot AI electronically, including
          entering binding agreements such as our{" "}
          <Link to="/legal/terms">Terms of Service</Link>,{" "}
          <Link to="/legal/subscription">Subscription Terms</Link>, and{" "}
          <Link to="/legal/privacy">Privacy Policy</Link>;
        </li>
        <li>
          Receive disclosures, notices, receipts, and other communications
          electronically, including by in-product notification, email,
          push, or by us posting them on our website; and
        </li>
        <li>
          Treat electronic records (including timestamped acceptance logs)
          as the equivalent of paper records and electronic signatures as
          the equivalent of handwritten signatures, to the maximum extent
          permitted by law.
        </li>
      </ul>

      <h2>2. Hardware &amp; software you need</h2>
      <p>
        To access and retain electronic records you need: a current web
        browser, an active internet connection, a working email address on
        file with us, sufficient storage to save or print records, and the
        ability to view PDFs.
      </p>

      <h2>3. Keeping copies</h2>
      <p>
        We make legal documents available at{" "}
        <Link to="/legal">/legal</Link> and a copy of your acceptance is
        kept in our records. You can print or save any document at any
        time using your browser. We recommend you keep a copy of any
        document you accept.
      </p>

      <h2>4. Updating your information</h2>
      <p>
        Keep your email address current in your{" "}
        <Link to="/profile">Profile</Link> so that we can deliver legally
        required notices. We are not responsible for notices that fail to
        reach you because of out-of-date contact information.
      </p>

      <h2>5. Withdrawing consent</h2>
      <p>
        You can withdraw your consent to electronic communications at any
        time by emailing{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a>.
        Withdrawing consent means we may be unable to continue providing
        the Service to you, because the Service is delivered electronically.
      </p>

      <h2>6. Questions</h2>
      <p>
        Contact{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a> for any
        questions about this disclosure.
      </p>
    </LegalLayout>
  ),
});
