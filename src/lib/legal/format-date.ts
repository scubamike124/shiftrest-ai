/**
 * Format a legal effective date identically everywhere.
 *
 * Two bugs lived in one line of `LegalLayout`, which read:
 *
 *     new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { … })
 *
 * The first was a hydration mismatch. `undefined` as the locale means "use
 * whatever locale this runtime defaults to" — the server's during SSR and the
 * browser's during hydration. When those differ the rendered text differs, and
 * React discards the server markup and reports it. Every legal page renders
 * this twice ("Effective" and "Last updated"), which is why
 * restpilotai.com/legal/privacy threw exactly two uncaught React #418 errors on
 * every visit.
 *
 * The second was quieter and worse. The value was parsed as UTC midnight and
 * then formatted in the *runtime's* timezone, so every reader west of UTC saw
 * the day before the one the document actually took effect on — measured: a
 * document dated 2026-03-14 displayed "March 13, 2026" in Los Angeles. On a
 * document whose entire purpose is to state when its terms took effect, that is
 * a wrong legal fact rather than a cosmetic slip.
 *
 * Pinning both the locale and the timezone fixes both: the output is one fixed
 * string, identical on the server, in the browser, and in every timezone. These
 * documents are written in English, so an English rendering of their date is
 * the consistent choice.
 *
 * It lives here rather than in the component so it can be tested. A pure
 * formatter in a `.tsx` file cannot be loaded by the test runner, which strips
 * types but does not transform JSX — and this is exactly the kind of quiet,
 * locale-dependent logic that needs a test more than the markup around it does.
 */
export function formatLegalDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
