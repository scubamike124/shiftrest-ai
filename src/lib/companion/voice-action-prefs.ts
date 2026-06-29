// Slice 8 — Companion voice + action local prefs.
// Stored in localStorage (per-device) so we don't need a DB migration for
// foundation settings. Server-persisted prefs already cover the AI-side
// personalization (voice, language). These toggles are about *this device*.

import type { QuietHours } from "./quiet-hours";

export type CompanionMode = "normal" | "sleep";

export type CompanionLocalPrefs = {
  voiceInputEnabled: boolean;
  voiceRepliesEnabled: boolean;
  actionSuggestionsEnabled: boolean;
  requireActionConfirmation: boolean;
  quietHours: QuietHours;
  /** Pass 6 — Sleep Companion Mode (warmer aura, slower breath, hushed voice). */
  companionMode: CompanionMode;
};

export const DEFAULT_LOCAL_PREFS: CompanionLocalPrefs = {
  voiceInputEnabled: true,
  voiceRepliesEnabled: true, // ON by default — Aura is a voice-first companion.
  actionSuggestionsEnabled: true,
  requireActionConfirmation: true,
  quietHours: null,
  companionMode: "normal",
};

const KEY = "restpilot.companion.localprefs.v1";

export function loadLocalPrefs(): CompanionLocalPrefs {
  if (typeof window === "undefined") return DEFAULT_LOCAL_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LOCAL_PREFS;
    const parsed = JSON.parse(raw) as Partial<CompanionLocalPrefs>;
    return { ...DEFAULT_LOCAL_PREFS, ...parsed };
  } catch {
    return DEFAULT_LOCAL_PREFS;
  }
}

export function saveLocalPrefs(next: Partial<CompanionLocalPrefs>): CompanionLocalPrefs {
  const merged: CompanionLocalPrefs = { ...loadLocalPrefs(), ...next };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(merged));
      window.dispatchEvent(new CustomEvent("companion-local-prefs:changed"));
    } catch {
      /* noop */
    }
  }
  return merged;
}
