# Light mode: not supported, by design

RestPilot is a dark-only app. This is a design decision, not a gap to patch.

Evidence in the code:

- `src/styles.css` defines a single token set on `:root`, labelled "Midnight Indigo,
  premium dark mode". There is no light token set and no `.light` / `[data-theme]` variant.
- Nothing in `src/` or `public/` reads `prefers-color-scheme`. There is no theme toggle,
  no `next-themes`, and no stored theme preference.
- The `@custom-variant dark` in `styles.css` is a Tailwind helper for `dark:` utilities; no
  code ever adds a `.dark` class, because the default palette already is the dark one.
- `theme-color` is fixed at `#0b1020` in `src/routes/__root.tsx`, and the iOS status bar is
  `black-translucent`.

Behaviour when the OS is set to light mode: the app stays dark. `:root` now declares
`color-scheme: dark` so native controls (scrollbars, date/time inputs, select popups) are
rendered dark instead of light-on-dark mismatches.

If light mode is ever wanted it is a design project (new token set, contrast audit, image and
glow review, theme toggle, native shell status bar), not a bug fix. Do not add a partial light
theme.
