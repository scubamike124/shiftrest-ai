import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — RestPilot AI" },
      {
        name: "description",
        content:
          "Terms governing your use of RestPilot AI and Premium subscriptions.",
      },
      { property: "og:title", content: "Terms of Service — RestPilot AI" },
      {
        property: "og:description",
        content: "Terms governing your use of RestPilot AI.",
      },
      { property: "og:url", content: "/terms" },
    ],
    links: [{ rel: "canonical", href: "/terms" }],
  }),
  component: Terms,
});

function Terms() {
  return (
    <main className="flex flex-col gap-4 px-5 pt-12 pb-12">
      <Link
        to="/profile"
        className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </Link>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          Legal
        </p>
        <h1 className="mt-2 text-3xl font-bold">Terms of Service</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Effective: June 1, 2026
        </p>
      </header>

      <section className="space-y-4 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">
          1. Acceptance
        </h2>
        <p>
          By using RestPilot AI you agree to these terms. If you do not
          agree, please do not use the service.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          2. The service
        </h2>
        <p>
          RestPilot AI helps shift workers plan sleep windows, wind-down
          routines, and recovery schedules. It is an informational tool, not
          a medical device, and does not provide medical advice.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          3. Subscriptions &amp; auto-renewal
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Pricing:</strong> Monthly $7.99 / Annual $49.99 / Lifetime
            $99 (one-time).
          </li>
          <li>
            Paid subscriptions renew automatically at the listed price until
            cancelled.
          </li>
          <li>
            You can manage or cancel your plan anytime from your account
            settings.
          </li>
          <li>
            Any unused portion of a free trial is forfeited when a paid plan
            begins.
          </li>
        </ul>

        <h2 className="text-base font-semibold text-foreground">
          4. Lifetime Membership
        </h2>
        <p>
          Lifetime Membership means a one-time purchase that grants access to
          the Lifetime features included with your purchase for as long as
          RestPilot AI is actively operated and commercially available.
          Lifetime access refers to the lifetime of the RestPilot AI service,
          not the lifetime of the purchaser. If the service is permanently
          discontinued, Lifetime access will end when the service is no
          longer available. Lifetime access does not automatically include
          future premium products or separate services unless explicitly
          stated.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          5. Acceptable use
        </h2>
        <p>
          Don't reverse-engineer the service, abuse the API, or use it in ways
          that violate the law or harm others.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          6. Medical disclaimer
        </h2>
        <p>
          Recommendations are educational. Always consult a qualified
          healthcare professional for medical decisions.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          7. Limitation of liability
        </h2>
        <p>
          The service is provided "as is" without warranties. To the maximum
          extent allowed by law, we are not liable for indirect, incidental,
          or consequential damages.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          8. Termination
        </h2>
        <p>
          You can delete your account anytime from{" "}
          <Link to="/profile" className="text-primary underline">
            Profile
          </Link>
          . We may suspend accounts that violate these terms.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          9. Changes
        </h2>
        <p>
          We may update these terms. Continued use after changes constitutes
          acceptance.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          10. Contact
        </h2>
        <p>
          Email{" "}
          <a
            href="mailto:support@restpilot.ai"
            className="text-primary underline"
          >
            support@restpilot.ai
          </a>
          .
        </p>
      </section>
    </main>
  );
}
