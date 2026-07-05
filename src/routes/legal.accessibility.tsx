import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

export const DOC = findLegalDoc("accessibility")!;

export const Route = createFileRoute("/legal/accessibility")({
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
      <h2>Our commitment</h2>
      <p>
        RestPilot AI is committed to providing an accessible experience to
        everyone. Our target is conformance with the Web Content Accessibility
        Guidelines (WCAG) 2.1 Level AA.
      </p>

      <h2>Steps we take</h2>
      <ul>
        <li>Semantic HTML and ARIA landmarks throughout the app.</li>
        <li>
          Keyboard support for primary navigation, dialogs, and form
          controls.
        </li>
        <li>
          Color contrast and typography sized for legibility, with respect
          for OS-level reduced-motion preferences.
        </li>
        <li>
          A text-to-speech briefing for users who prefer audio
          presentations.
        </li>
      </ul>

      <h2>Known limitations</h2>
      <p>
        Some advanced data-visualizations (the Long Clock dial) currently
        rely on visual presentation. We expose the same data textually on the
        same screen and continue to improve screen-reader coverage.
      </p>

      <h2>Feedback</h2>
      <p>
        If you encounter an accessibility barrier, email{" "}
        <a href="mailto:support@restpilotai.com">
          support@restpilotai.com
        </a>{" "}
        and we will respond within 10 business days.
      </p>
    </LegalLayout>
  ),
});
