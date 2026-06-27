// Single source of truth for the legal document set.
// Consumed by /legal index, footer, and (future) sitemap.

export type LegalDoc = {
  slug: string; // e.g. "terms"
  path: string; // e.g. "/legal/terms"
  title: string; // page title
  summary: string; // one-line summary for the index + footer hover
  effective: string; // ISO date
  category: "core" | "policy" | "disclosure" | "ip" | "billing";
};

// Update `effective` whenever a doc is materially revised.
export const LEGAL_EFFECTIVE = "2026-06-27";

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: "terms",
    path: "/legal/terms",
    title: "Terms of Service",
    summary: "The agreement that governs your use of RestPilot AI.",
    effective: LEGAL_EFFECTIVE,
    category: "core",
  },
  {
    slug: "privacy",
    path: "/legal/privacy",
    title: "Privacy Policy",
    summary: "What data we collect, why, how long we keep it, and your rights.",
    effective: LEGAL_EFFECTIVE,
    category: "core",
  },
  {
    slug: "cookies",
    path: "/legal/cookies",
    title: "Cookie Policy",
    summary: "Storage we set in your browser and how to control it.",
    effective: LEGAL_EFFECTIVE,
    category: "policy",
  },
  {
    slug: "acceptable-use",
    path: "/legal/acceptable-use",
    title: "Acceptable Use Policy",
    summary: "What you may and may not do with RestPilot AI.",
    effective: LEGAL_EFFECTIVE,
    category: "policy",
  },
  {
    slug: "accessibility",
    path: "/legal/accessibility",
    title: "Accessibility Statement",
    summary: "Our commitment to WCAG 2.1 AA and how to report barriers.",
    effective: LEGAL_EFFECTIVE,
    category: "policy",
  },
  {
    slug: "disclaimers",
    path: "/legal/disclaimers",
    title: "AI & Health Disclaimers",
    summary:
      "AI, health, medical, emergency, and safety-sensitive activity disclaimers.",
    effective: LEGAL_EFFECTIVE,
    category: "disclosure",
  },
  {
    slug: "subscription",
    path: "/legal/subscription",
    title: "Subscription Terms",
    summary:
      "Billing, auto-renewal, cancellation, refunds, free trials, and lifetime access.",
    effective: LEGAL_EFFECTIVE,
    category: "billing",
  },
  {
    slug: "third-parties",
    path: "/legal/third-parties",
    title: "Subprocessors & Integrations",
    summary: "Third parties we share data with and what they receive.",
    effective: LEGAL_EFFECTIVE,
    category: "disclosure",
  },
  {
    slug: "security",
    path: "/legal/security",
    title: "Security & Responsible Disclosure",
    summary: "Our security practices and how to report a vulnerability.",
    effective: LEGAL_EFFECTIVE,
    category: "policy",
  },
  {
    slug: "license",
    path: "/legal/license",
    title: "Software License Agreement",
    summary: "Your limited personal license to use the RestPilot AI software.",
    effective: LEGAL_EFFECTIVE,
    category: "ip",
  },
  {
    slug: "copyright",
    path: "/legal/copyright",
    title: "Copyright & DMCA Policy",
    summary: "How to submit a copyright complaint or counter-notice.",
    effective: LEGAL_EFFECTIVE,
    category: "ip",
  },
  {
    slug: "trademark",
    path: "/legal/trademark",
    title: "Trademark Notice",
    summary: "Use of the RestPilot AI name, logo, and brand marks.",
    effective: LEGAL_EFFECTIVE,
    category: "ip",
  },
];

export function findLegalDoc(slug: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.slug === slug);
}
