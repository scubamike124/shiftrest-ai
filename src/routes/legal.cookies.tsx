import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

export const DOC = findLegalDoc("cookies")!;

export const Route = createFileRoute("/legal/cookies")({
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
        This Cookie Policy explains how RestPilot AI uses cookies and similar
        browser storage. For details on how we handle personal information,
        see our <Link to="/legal/privacy">Privacy Policy</Link>.
      </p>

      <h2>1. What we store</h2>
      <ul>
        <li>
          <strong>Authentication tokens</strong> (localStorage) — keep you
          signed in across visits.
        </li>
        <li>
          <strong>Session cookies</strong> set by our backend provider — used
          for secure session handling.
        </li>
        <li>
          <strong>Theme &amp; preference</strong> (localStorage) — your
          interface preferences.
        </li>
        <li>
          <strong>Offline cache</strong> (IndexedDB and service-worker cache)
          — your current plan and last-known recommendations so the app works
          without a connection.
        </li>
        <li>
          <strong>Last-visit timestamp</strong> (localStorage,{" "}
          <code>rp_last_visit</code>) — powers the "while you were away"
          dashboard line.
        </li>
        <li>
          <strong>Web push subscription</strong> (browser-managed) — only when
          you opt in to notifications.
        </li>
      </ul>

      <h2>2. What we do NOT use</h2>
      <p>
        We do not set advertising cookies, third-party tracking pixels,
        cross-site identifiers, or session-replay tools. We do not sell your
        data to advertisers.
      </p>

      <h2>3. Categories</h2>
      <ul>
        <li>
          <strong>Strictly necessary</strong> — authentication, session, and
          security cookies. These are always on.
        </li>
        <li>
          <strong>Functional</strong> — preferences and offline cache. You can
          clear them via browser settings.
        </li>
      </ul>

      <h2>4. Controlling storage</h2>
      <p>
        You can clear site data and remove our storage at any time from your
        browser settings. Doing so will sign you out and remove offline data.
        You can also revoke push permission directly in the browser.
      </p>

      <h2>5. Changes</h2>
      <p>We will update this page when the storage we use changes.</p>
    </LegalLayout>
  ),
});
