import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — ShiftRest AI" },
      {
        name: "description",
        content:
          "How ShiftRest AI collects, uses, stores, and protects your data.",
      },
      { property: "og:title", content: "Privacy Policy — ShiftRest AI" },
      {
        property: "og:description",
        content: "How ShiftRest AI handles your data.",
      },
      { property: "og:url", content: "/privacy" },
    ],
    links: [{ rel: "canonical", href: "/privacy" }],
  }),
  component: Privacy,
});

function Privacy() {
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
        <h1 className="mt-2 text-3xl font-bold">Privacy Policy</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Effective: June 1, 2026
        </p>
      </header>

      <section className="prose prose-invert max-w-none space-y-4 text-sm text-muted-foreground">
        <p>
          ShiftRest AI ("we", "us") respects your privacy. This policy explains
          what we collect, why, and your choices.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          1. Information we collect
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Account info</strong> — email and display name when you
            create an account.
          </li>
          <li>
            <strong>Shift &amp; sleep data</strong> — shifts you log, sleep
            windows, wind-down preferences, and target sleep hours.
          </li>
          <li>
            <strong>Location</strong> — approximate latitude/longitude (only if
            you tap "Detect") to calculate sunrise/sunset for your light plan.
            Stored on your device.
          </li>
          <li>
            <strong>Device data</strong> — notification permission state and
            basic diagnostic info.
          </li>
        </ul>

        <h2 className="text-base font-semibold text-foreground">
          2. How we use it
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Generate your circadian schedule and recovery plan.</li>
          <li>Send wind-down notifications you opt into.</li>
          <li>Improve the product (aggregated, non-identifying).</li>
        </ul>
        <p>
          We do <strong>not</strong> sell your personal data. We do not use it
          for third-party advertising.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          3. Health data disclaimer
        </h2>
        <p>
          ShiftRest is not a medical device and does not provide medical
          advice. Recommendations are educational. Consult a healthcare
          professional for sleep or health concerns.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          4. Storage &amp; security
        </h2>
        <p>
          Preferences and local data live on your device. Account data is
          stored on encrypted servers and transmitted over HTTPS.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          5. Your rights
        </h2>
        <p>
          You can request a copy of your data, correct it, or delete your
          account at any time from <strong>Profile → Delete account</strong>.
          Account deletion is permanent and removes all associated data within
          30 days.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          6. Children
        </h2>
        <p>
          ShiftRest is not directed to children under 13. We do not knowingly
          collect data from children.
        </p>

        <h2 className="text-base font-semibold text-foreground">
          7. Contact
        </h2>
        <p>
          Questions? Email{" "}
          <a
            href="mailto:privacy@shiftrest.app"
            className="text-primary underline"
          >
            privacy@shiftrest.app
          </a>
          .
        </p>
      </section>
    </main>
  );
}
