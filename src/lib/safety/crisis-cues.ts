// Local crisis-cue check for what the user types (or says) to the Coach and
// the Companion. Same pattern as Dayli's src/lib/crisis.ts.
//
// Runs on the device before the AI consent gate and before any AI or network
// call, so someone who has not allowed AI features (or is offline) still gets
// the crisis line. Pure and synchronous: no fetch, no storage, no AI.
//
// Deliberately small and conservative: clear first-person statements about
// suicide, self-harm, overdose or wanting to die. Everyday tiredness slang
// ("dead tired", "killing it", "I could die for coffee", "dying for a nap",
// "I'm killing myself with these doubles") must not match. The AI's
// SAFETY_AND_CARE rules handle subtler cues.
//
// Deliberate choices on the cautious side (the card never blocks, so showing
// it once too often is the cheaper mistake): any mention of an overdose other
// than "overdosing on coffee" style slang, including questions such as "can
// you overdose on melatonin?", and "makes me want to die" even with "lol".

/** Phone-keyboard curly apostrophes become straight ones before matching. */
function normalize(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
}

export const CRISIS_PATTERNS: readonly RegExp[] = [
  // Suicide
  /\bsuicid(?!e (doors?|squad)\b)/i,
  /\bkill myself\b/i,
  // "killing myself with these doubles / working nights" is overwork talk.
  /\bkilling myself\b(?! (with|working|at|on|over|for|to (get|make|finish|keep))\b)/i,
  /\b(end|ending|take|taking) my (own )?life\b(?! back)/i,
  /\bend it all\b/i,
  /\bunalive myself\b/i,
  /\bbetter off dead\b/i,
  /\bno reason to (live|go on)\b/i,
  // Wanting to die
  /\b(want to|wanted to|wanna) (die|be dead)\b/i,
  /\bwish (i was|i were|i'd) dead\b/i,
  /\bwish i (could|would) die\b/i,
  /\bwish i (wasn't|weren't|wasnt|werent) alive\b/i,
  /\bwish i'?d never been born\b/i,
  /\bdon'?t (want to|wanna) (be alive|exist)\b/i,
  // "I don't want to live (anymore / like this)", but not "...live in this city".
  /\bdon'?t (want to|wanna) live\b(?! (in|near|with|on|at|by|there|here|so|too|close|far|together|without)\b)/i,
  // Self-harm ("I hurt myself at the gym", "I cut myself shaving" are injuries)
  /\bself[-\s]?harm/i,
  /\bharm(ing)? myself\b/i,
  /\b(want|wanna|going|gonna|urge|tempted|thinking about|think about|thought about|feel like)( to)? (hurt|hurting) myself\b/i,
  /(?<!accidentally )\bcut(ting)? myself\b(?! (shaving|while|cooking|chopping|by accident|accidentally|on (a|an|the|my|some)|with (a|an|the|my)|at (work|the)|in the)\b)/i,
  // Overdose ("overdosing on coffee" is tiredness slang; anything else counts)
  /\boverdos(e|ed|es|ing)\b(?! on (coffee|caffeine|espresso|lattes?|tea|energy drinks?|sugar|chocolate)\b)/i,
  /\b(took|take|taking|swallow(ed)?|swallowing) (all|a whole bottle of|the whole bottle of|a bunch of) (of )?(my |the )?(sleeping )?(pills|meds|medication|tablets)\b/i,
  /\b(took|swallowed|have taken|i've taken|i just took) (way )?(too many|a handful of|a lot of|loads of) (of )?(my |the )?(sleeping )?(pills|meds|medication|tablets)\b/i,
];

/** True when the message clearly mentions suicide, self-harm, overdose or wanting to die. */
export function hasCrisisCue(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = normalize(text);
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

/**
 * First step of every Coach/Companion send: checks the text and, on a match,
 * calls `showCard` synchronously, before any await, the `sending` guard, the
 * consent gate or the AI request. Returns whether it matched.
 */
export function showCardOnCrisis(text: string, showCard: () => void): boolean {
  const crisis = hasCrisisCue(text);
  if (crisis) showCard();
  return crisis;
}

/**
 * Whether the message should go on to the AI. Only a crisis message from a user
 * who hasn't allowed AI sharing stops here: they already have the card, so they
 * get no data-sharing prompt and nothing is sent. Everything else carries on
 * (the AI has the SAFETY_AND_CARE rules). If the consent check itself fails,
 * the message carries on and the normal consent gate decides.
 */
export async function shouldSendToAI(
  crisis: boolean,
  consentWouldAsk: () => Promise<boolean>,
): Promise<boolean> {
  if (!crisis) return true;
  try {
    return !(await consentWouldAsk());
  } catch {
    return true;
  }
}

/** Static resources shown by <CrisisSupportCard />. No network needed to read them. */
export const CRISIS_RESOURCES = {
  usLine: "988",
  usLineName: "988 Suicide & Crisis Lifeline",
  usEmergency: "911",
  findAHelplineUrl: "https://findahelpline.com",
  findAHelplineLabel: "findahelpline.com",
} as const;
