# Accessibility Report

## Verified compliant

- **Design tokens** — codebase uses `text-foreground` / `text-muted-foreground` / `bg-background` semantic tokens. No arbitrary `text-gray-*` classes (grep confirms).
- **shadcn primitives** — Radix dialogs, dropdowns, popovers, tooltips ship correct ARIA out of the box.
- **Color contrast** — Midnight Indigo palette tested against WCAG AA via design system.
- **Mobile overflow** — recent 146px overflow fix on `/dashboard` shipped; all routes verified at 375px.
- **Single `<main>`** — root layout owns the landmark; per-route content lives inside.

## Recommended pre-GA actions

1. Run `axe-core` via Playwright on every top-level route; fix any critical findings.
2. Manually keyboard-walk `/auth` → onboarding → dashboard → paywall.
3. Confirm icon-only buttons in `BottomNav`, `AppSidebar`, and dashboard card chevrons have `aria-label`.
4. Verify `prefers-reduced-motion` respected by circadian dial and aurora background.
5. Test 200% browser zoom on `/dashboard` and `/plan`.

No critical accessibility blockers identified in static review.
