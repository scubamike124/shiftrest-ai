# Aura / Lisa: companion naming

Issue 7 of the November 14, 2026 upgrade authorization.

## Finding

**Aura is the default companion. "Lisa" is a personalised name.** The code supports no other explanation:

- **Aura** is built into the product:
  - the default look (`AVATAR_PRESETS[0]`, "Calm and grounded — the default companion"; `DEFAULT_AVATAR_ID = "aura"`);
  - the marketing site ("Meet Aura");
  - several hard-coded companion-page messages ("Aura's voice is on", "Tap Aura once…", "Aura is staying silent").
- **The name the AI uses** comes from `user_prefs.assistant_name`. Customers set it in the companion settings sheet ("Your AI's name"), in Profile → Assistant, and in Profile → Voice ("Pilot name").
  - "Lisa" appears nowhere in the source code or history. It can only be a value a customer typed into one of those fields. The owner's account is the one where the companion is called Lisa.
  - To confirm, read `assistant_name` for the owner's user in `user_prefs` (read-only).
- Before this fix, four different names could appear for the same companion:

| Where | Before | Shown to the owner (named Lisa) |
|---|---|---|
| Companion page header, AI chat replies | `assistant_name`, else "RestPilot" | Lisa |
| Voice-state messages on the companion page | hard-coded "Aura" | **Aura** |
| Pilot voice screen | `assistant_name`, else "Pilot" | Lisa |
| Realtime voice (lab) | hard-coded "RestPilot" | **RestPilot** |
| Avatar picker, marketing site | "Aura" (the look) | Aura |
| Customer who never named the companion | "RestPilot" in chat; "Aura" in UI messages and marketing | mixed |

The database default for `assistant_name` is the literal `'RestPilot'`, and the app writes `"RestPilot"` when the field is cleared. So "RestPilot" in that column means "not personalised", not a name anyone chose.

## Fix (PR into `codex/restpilot-railway-migration`)

One rule, `src/lib/companion/name.ts`, used by the app and by the companion's AI prompts (text coach, spoken companion, JSON intents via the personality block, Realtime):

1. A name the customer chose (for example **Lisa**) always wins, everywhere.
2. Otherwise the name of the chosen look: **Aura** by default; Nova, Atlas or Sage if the customer picked that look.
3. A custom photo, or no information, falls back to **Aura**.

Applied to:
- the companion page (header, voice-state messages, screen-reader label, name field);
- the Pilot voice screen greeting;
- the text coach, spoken companion and JSON-intent prompts (`loadAssistantProfile`);
- the Realtime voice instructions;
- both Profile name fields. They now show only the customer's own name, with the default as a placeholder; "Leave blank to keep Aura".

Onboarding now explains it:
- **First-run onboarding**, slide 2: "Meet Aura, your companion… You can rename your companion (for example, Lisa) anytime, and that name is used in chat and voice."
- **Companion introduction sheet**, step 1:
  - for an unnamed companion: "Meet Aura, your Companion… Aura is the default companion; you can give yours your own name (for example, Lisa) or a different look anytime."
  - for a named one: "Meet Lisa, your Companion. Lisa is the name you chose for your companion (the default companion is Aura)."

## What is preserved

- **No database writes, no migration.** Names are resolved when read. `assistant_name` values, chosen voices, voice speed and personality, language and accent, look, memory and history are unchanged.
- A customer who named the companion keeps that name exactly ("Lisa" stays "Lisa", including a deliberate "Pilot").
- Clearing the name field still stores the same `"RestPilot"` sentinel as before, so rolling the code back reverts behaviour without touching data.

## Behaviour change to note

Customers who never named their companion are now greeted by **Aura** (or Nova, Atlas or Sage if they picked that look) instead of "RestPilot" in chat and "Pilot" on the voice screen. This matches the marketing site and the default look.

A customer who deliberately typed "RestPilot" as the name cannot be told apart from one who never chose a name, and will also see Aura. They can type it again; if that matters, a follow-up could store an explicit "unnamed" flag.

## Known limits

- Briefing narration, insights and shift-swap prompts describe the product ("RestPilot AI…") and don't receive the companion's name. They don't introduce themselves by name, so no conflicting name is spoken, but the copy says "chat and voice" rather than "everywhere".
- For an *unnamed* companion, the app takes the look from this device first (then syncs from the profile), while the AI reads the look saved in the profile. If someone picked a look while signed out, the app could briefly say Nova while the AI says Aura. Customer-chosen names are not affected.

## Not changed (other owners or owner decision)

- Navigation labels "Pilot", "Talk to Pilot" and "Voice Pilot", and the ArrivalHero "Pilot" label, name the voice *screen*, not the companion. They belong to the mobile UI work. Recommendation: label the screen "Voice" or "Talk to {name}" so customers see one name.
- The marketing site's "Meet Aura" copy is correct as the default and is unchanged.

## Verification

- `tests/companion-naming.test.mjs` covers:
  - the rule;
  - preset names matching the avatar catalog;
  - `loadAssistantProfile` returning Lisa / Aura / Atlas, falling back to Aura when the profile read fails, and keeping mode and memory settings unchanged;
  - no hard-coded "Aura" left in customer-name positions.
- `npm run test:repair` and `tsc --noEmit` pass.
- Browser check on staging after merge: the companion page loads with no console errors.
