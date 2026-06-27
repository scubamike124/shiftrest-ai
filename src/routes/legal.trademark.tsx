import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

const DOC = findLegalDoc("trademark")!;

export const Route = createFileRoute("/legal/trademark")({
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
        "RestPilot," "RestPilot AI," the RestPilot logo, "Long Clock,"
        "Smart Alarm," "AI Decision Center," and "Companion AI" are
        trademarks of RestPilot AI. All other marks are the property of their
        respective owners.
      </p>

      <h2>Permitted use</h2>
      <ul>
        <li>
          Editorial and news references to our products that do not imply
          endorsement.
        </li>
        <li>
          Use of unmodified screenshots in articles or reviews with attribution.
        </li>
      </ul>

      <h2>Prohibited use</h2>
      <ul>
        <li>
          Using our marks in a way that suggests partnership, sponsorship, or
          endorsement we have not granted.
        </li>
        <li>Incorporating our marks into product names, domains, or logos.</li>
        <li>Modifying our logos, including color, proportions, or wording.</li>
      </ul>

      <h2>Requests</h2>
      <p>
        Email{" "}
        <a href="mailto:brand@restpilot.ai">brand@restpilot.ai</a> to request
        permission or report misuse.
      </p>
    </LegalLayout>
  ),
});
