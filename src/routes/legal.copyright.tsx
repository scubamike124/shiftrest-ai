import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

export const DOC = findLegalDoc("copyright")!;

export const Route = createFileRoute("/legal/copyright")({
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
        RestPilot AI respects the intellectual-property rights of others and
        expects users to do the same.
      </p>

      <h2>Submitting a notice (DMCA)</h2>
      <p>
        If you believe content on the Service infringes your copyright, send a
        written notice to our designated agent that includes:
      </p>
      <ul>
        <li>Identification of the copyrighted work claimed to be infringed.</li>
        <li>Identification of the material and its URL on the Service.</li>
        <li>Your contact information.</li>
        <li>
          A statement that you have a good-faith belief the use is not
          authorized.
        </li>
        <li>
          A statement, under penalty of perjury, that the information is
          accurate and that you are authorized to act on behalf of the rights
          holder.
        </li>
        <li>Your physical or electronic signature.</li>
      </ul>

      <h2>Designated agent</h2>
      <p>
        Email{" "}
        <a href="mailto:security@restpilotai.com">security@restpilotai.com</a>.
        Physical-address designation will be added at launch.
      </p>

      <h2>Counter-notice</h2>
      <p>
        If you believe content was removed by mistake, you may submit a
        counter-notice to the same address with the elements required by 17
        U.S.C. § 512(g).
      </p>

      <h2>Repeat infringers</h2>
      <p>
        We terminate, in appropriate circumstances, the accounts of users who
        are repeat infringers.
      </p>
    </LegalLayout>
  ),
});
