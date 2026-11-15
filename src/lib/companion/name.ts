/**
 * One rule for the companion's name, used by the app UI and every AI prompt.
 *
 * - Aura is the default companion (the default look and name).
 * - Picking another look (Nova, Atlas, Sage) without naming it uses that look's name.
 * - A name the customer chooses (for example "Lisa") always wins, everywhere.
 *
 * The database stores "RestPilot" as the default assistant_name (column default
 * and the value the app writes for "no name"), so it means "not personalised".
 * Nothing is rewritten in the database: this is a read-time rule, and customer
 * names are never changed.
 */
export const DEFAULT_COMPANION_NAME = "Aura";

/** Keep in sync with AVATAR_PRESETS ids/names (asserted by tests). */
export const PRESET_COMPANION_NAMES: Record<string, string> = {
  aura: "Aura",
  nova: "Nova",
  atlas: "Atlas",
  sage: "Sage",
};

/** Value persisted when the customer has not chosen a name. */
export const UNNAMED_SENTINEL = "RestPilot";

/** The customer's own name for the companion, or "" when they haven't chosen one. */
export function customCompanionName(assistantName: string | null | undefined): string {
  const name = (assistantName ?? "").trim();
  return name && name.toLowerCase() !== UNNAMED_SENTINEL.toLowerCase() ? name : "";
}

/** Default name for a look: the preset's own name, else Aura (custom photos included). */
export function defaultCompanionName(avatarId?: string | null): string {
  return (avatarId && PRESET_COMPANION_NAMES[avatarId]) || DEFAULT_COMPANION_NAME;
}

/** The name shown in the app and used by the AI. */
export function companionName(assistantName: string | null | undefined, avatarId?: string | null): string {
  return customCompanionName(assistantName) || defaultCompanionName(avatarId);
}
