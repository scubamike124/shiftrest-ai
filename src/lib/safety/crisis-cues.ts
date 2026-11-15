// Local crisis-cue check for what the user types (or says) to the Coach and
// the Companion. Same pattern as Dayli's src/lib/crisis.ts.
//
// Runs on the device before the AI consent gate and before any AI or network
// call, so someone who has not allowed AI features (or is offline) still gets
// the crisis line. Pure and synchronous: no fetch, no storage, no AI.
//
// Deliberately small and conservative: clear first-person statements about
// suicide, self-harm, overdose or wanting to die. Everyday tiredness slang
// ("dead tired", "killing it", "I could die for coffee", "dying for a nap")
// must not match. The AI's SAFETY_AND_CARE rules handle subtler cues.

/** Phone-keyboard curly apostrophes become straight ones before matching. */
function normalize(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
}

export const CRISIS_PATTERNS: readonly RegExp[] = [
  // Suicide
  /\bsuicid/i,
  /\bkill(ing)? myself\b/i,
  /\b(end|ending|take|taking) my (own )?life\b(?! back)/i,
  /\bend it all\b/i,
  /\bunalive myself\b/i,
  /\bbetter off dead\b/i,
  /\bno reason to (live|go on)\b/i,
  // Wanting to die
  /\b(want|wanted) to die\b/i,
  /\bwanna die\b/i,
  /\bwish (i was|i were|i'd) dead\b/i,
  /\bwish i (could|would) die\b/i,
  /\bdon'?t want to (be alive|live anymore|exist)\b/i,
  // Self-harm ("I hurt myself at the gym" is an injury, not a cue)
  /\bself[-\s]?harm/i,
  /\bharm(ing)? myself\b/i,
  /\b(want|wanna|going|gonna|urge|tempted|thinking about|think about|thought about|feel like)( to)? (hurt|hurting) myself\b/i,
  // Overdose ("overdosing on coffee" is tiredness slang; anything else counts)
  /\boverdos(e|ed|es|ing)\b(?! on (coffee|caffeine|espresso|lattes?|tea|energy drinks?|sugar|chocolate)\b)/i,
  /\b(took|take|taking|swallow(ed)?|swallowing) (all|a whole bottle of|the whole bottle of|a bunch of) (my |the |of my )?(pills|meds|medication|tablets|sleeping pills)\b/i,
];

/** True when the message clearly mentions suicide, self-harm, overdose or wanting to die. */
export function hasCrisisCue(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = normalize(text);
  return CRISIS_PATTERNS.some((re) => re.test(t));
}

/** Static resources shown by <CrisisSupportCard />. No network needed to read them. */
export const CRISIS_RESOURCES = {
  usLine: "988",
  usLineName: "988 Suicide & Crisis Lifeline",
  usEmergency: "911",
  findAHelplineUrl: "https://findahelpline.com",
  findAHelplineLabel: "findahelpline.com",
} as const;
