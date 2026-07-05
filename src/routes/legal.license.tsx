import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

export const DOC = findLegalDoc("license")!;

export const Route = createFileRoute("/legal/license")({
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
      <h2>1. License grant</h2>
      <p>
        Subject to your compliance with our{" "}
        <Link to="/legal/terms">Terms of Service</Link> and{" "}
        <Link to="/legal/acceptable-use">Acceptable Use Policy</Link>, we
        grant you a personal, limited, non-exclusive, non-transferable,
        non-sublicensable, revocable license to access and use the RestPilot
        AI software (the "Software") for your individual, non-commercial
        purposes.
      </p>

      <h2>2. Reservation of rights</h2>
      <p>
        The Software, including all source code, models, prompts, algorithms,
        AI systems, designs, content, and branding, is owned by RestPilot AI
        and its licensors and is protected by copyright, trademark, trade
        secret, and other laws. All rights not expressly granted are reserved.
      </p>

      <h2>3. Restrictions</h2>
      <ul>
        <li>No reverse engineering, decompiling, or disassembly.</li>
        <li>
          No copying, modifying, distributing, sublicensing, leasing, renting,
          or selling the Software.
        </li>
        <li>
          No use of the Software or its AI output to train, evaluate, or
          improve any competing model or product.
        </li>
        <li>
          No removal or alteration of copyright, trademark, or other
          proprietary notices.
        </li>
      </ul>

      <h2>4. Open-source notices</h2>
      <p>
        The Software incorporates open-source components distributed under
        their respective licenses. A list of components and their licenses is
        available on request from{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a>.
      </p>

      <h2>5. Termination</h2>
      <p>
        This license terminates automatically upon any breach of the Terms or
        this Agreement, or when you stop using the Service.
      </p>

      <h2>6. Disclaimer</h2>
      <p>
        THE SOFTWARE IS PROVIDED "AS IS." SEE THE WARRANTY DISCLAIMER AND
        LIMITATION OF LIABILITY SECTIONS OF THE{" "}
        <Link to="/legal/terms">TERMS OF SERVICE</Link>.
      </p>
    </LegalLayout>
  ),
});
