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

/** Phone-keyboard curly apostrophes and "my self" (autocorrect) are normalised before matching. */
function normalize(text: string): string {
  return (
    text
      .replace(/[‘’ʼ]/g, "'")
      .replace(/\s+/g, " ")
      // Not "my self-esteem" / "my self confidence".
      .replace(
        /\bmy self\b(?!-| ?(esteem|confidence|care|doubt|worth|image|respect|control|belief)\b)/gi,
        "myself",
      )
  );
}

// Sleep aids and common over-the-counter or prescription drugs people name
// instead of saying "pills".
const DRUGS =
  "(sleeping |sleep )?(pills|meds|medications?|tablets|melatonin|ambien|zolpidem|benadryl|diphenhydramine|zzzquil|unisom|doxylamine|trazodone|nyquil|zquil|tylenol|acetaminophen|paracetamol|ibuprofen|advil|motrin|aspirin|xanax|valium|klonopin|ativan|seroquel|oxys?|oxycodone|oxycontin|percocet|vicodin|opioids|insulin|antidepressants)";
// "All my ..." without the daily-routine words ("I took all my meds this morning").
const DRUGS_ALL =
  "(sleeping |sleep )?(pills|tablets|melatonin|ambien|zolpidem|benadryl|zzzquil|unisom|trazodone|nyquil|zquil|tylenol|acetaminophen|paracetamol|ibuprofen|advil|xanax|valium|klonopin|ativan|seroquel|oxys?|oxycodone|percocet|vicodin|opioids|insulin|antidepressants)";
const TOOK_PAST = "(took|swallowed|downed|have taken|i've taken|just took)";
// A stated plan. "will / I'll / could / may take all my pills" are also how
// people describe a routine, so those skip specific routine phrases ("with
// breakfast", "before my shift").
const TOOK_INTENT =
  "((going to|gonna|want to|wanna|about to|planning to) (take|swallow)|(thinking (of|about)|considering) (taking|swallowing))";
// First person only, so not "the pharmacy will take all my pills back".
const TOOK_MAYBE = "((i'll|i will|i could|i may|i might) (take|swallow))";
const TOOK = `(${TOOK_PAST}|${TOOK_INTENT}|${TOOK_MAYBE})`;
// Specific daily-routine phrases only, so "at once", "with vodka" or "before
// anyone wakes up" still count.
const ROUTINE =
  "(with (my )?(breakfast|lunch|dinner|food|water|a meal|meals|my meal)|(before|after) (my |the )?(shift|work|bed|breakfast|lunch|dinner|meal)|as prescribed|on time|(every|each) (day|morning|night|evening)|(in the|this) (morning|afternoon|evening)|at \\d|with me|on (the |my )?(trip|flight|holiday|vacation|plane))";
const CONTAINER = "((a|the|my) )?(whole |entire )?(bottle|pack|packet|box|strip|blister pack)";
const END = "\\s*([.!?,;]|$)";

export const CRISIS_PATTERNS: readonly RegExp[] = [
  // Suicide
  // Not "career suicide", "suicide prevention training" or "my patient
  // attempted suicide" (clinicians talking about work).
  /(?<!(career|social|political|patient attempted|patient committed|patient tried|patients attempting|someone attempted|someone committed) )\bsuicid(?!e (doors?|squad|prevention|rates?|awareness|risk assessments?)\b)/i,
  /\b(want to|wanna|going to|gonna|thinking of|thinking about|ready to|about to) end it( all| tonight| now| today)?\s*([.!?,;]|$)/i,
  /\b(thinking of|thinking about|considering) ending it( all| tonight)?\s*([.!?,;]|$)/i,
  /\b(slit|slitting|slice|slicing|cut|cutting|slash|slashing) (open )?(my|both) wrists?\b/i,
  /\bkill myself\b/i,
  // "killing myself with these doubles / working nights" is overwork talk;
  // "killing myself with pills" or "on purpose" is not.
  /\bkilling myself\b(?! (working|laughing|with (these|this|my|all (these|this|the|my)|the|all|extra|back-to-back) (double|doubles|shifts?|hours|nights?|job|work|overtime|rota|schedule|commute|deadlines)|over (this|the|my|these|a|an)|at (work|the gym|my job|the office)|for (this|the|my|a) (job|company|boss|team|exam|promotion)|to (get|make|finish|keep|meet|pass))\b)/i,
  /\b(going to|gonna|want to|wanna|might|will|i'll|could) off myself\b/i,
  /\b(going to|gonna|want to|wanna|about to|i'll|ima|i'm gonna) kms\b/i,
  // A stated method is the highest risk.
  /\b(hang|hanging|drown|drowning|stab|stabbing|poison|poisoning) myself\b/i,
  // Not "I'll shoot myself an email / a reminder".
  /\b(shoot|shooting) myself\b(?! (a|an|another|some) (quick )?(text|email|e-mail|message|note|reminder|dm|msg|line|pic|photo)\b)/i,
  /\bjump(ing)? (off|from) (a|the|that) (bridge|building|roof|cliff|balcony|tower)\b/i,
  /\b(jump|jumping|step|stepping|throw myself|throwing myself) in front of (a|the) (train|bus|car|truck|lorry)\b/i,
  /\b(end|ending|take|taking) my (own )?life\b(?! back)/i,
  /\bend it all\b/i,
  /\bunalive myself\b/i,
  /\b(better off|rather be|i'd rather be) dead\b/i,
  /\b(everyone|everybody|they|my family|my kids|the world|people) (would be|'d be|would all be|are) better off without me\b/i,
  /\bdone with (life|living)\b/i,
  // Not "done living here / with my parents / paycheck to paycheck".
  /\b(i'?m|i am) (so |just |really |honestly )?done living( like this| anymore| any more)?\s*([.!?;]|$)/i,
  /\bi (really |just |honestly |probably )?(deserve|deserved) to die\b/i,
  /\b(keep|been|always|can't stop|cannot stop|constantly) thinking about (dying|death|ending it all)\b/i,
  /\b(life|living) (isn't|is not|isnt|ain't|is no longer|isn't even) worth (it|living)\b/i,
  /\bno reason to (live|go on)\b/i,
  // At the end of a sentence, so not "any point in living closer to work?".
  /\b(no|zero|isn'?t any|is not any) point (in |to )?(living|being alive)( anymore| any more| like this)?\s*([.!?,;]|$)/i,
  /\bwhat'?s (even )?the point (of|in) (living|being alive|life)( anymore| any more| like this)?\s*([.!?,;]|$)/i,
  /\b(no|any) point (in )?going on\s*([.!?;]|$)/i,
  /\bwhat'?s the point (of|in) going on\s*([.!?;]|$)/i,
  /\b(want|need|wish) (it|this|everything) all to (end|stop)( now| forever)?\s*([.!?;]|$)/i,
  /\b(want|wish) (it|everything) to (end|be over)( now| forever)?\s*([.!?;]|$)/i,
  /\b(want to|wanna|going to|gonna|ready to|about to|thinking of|thinking about) end things( tonight| now| today)?\s*([.!?;]|$)/i,
  // Wanting to die
  /\b(want to|wanted to|wanna) (die|be dead|stop living|stop existing)\b/i,
  /\bready to die\b/i,
  /\bwish (i was|i were|i'd) dead\b/i,
  /\bwish i (could|would) (just )?die\b/i,
  // Not wanting to wake up at all (not "don't want to wake up at 5").
  /\bdon'?t (want to|wanna) (ever )?wake up( ever)? (ever again|again|at all|anymore|any more)\s*([.!?,;]|$)/i,
  /\bwish i('d| could| would)? ?(just )?(not|never) wake up( again| ever again)?\s*([.!?,;]|$)/i,
  /\b(sleep|asleep) (and|&) never wake (up|back up)\b/i,
  /\b(sleep|asleep) (and|&) not wake (up|back up)( again| ever again)?\s*([.!?,;]|$)/i,
  /\b(hope|wish|want to|wanna|pray|praying)( that)? (i )?(would |could |just |will |'d )?(die|pass away) in my sleep\b/i,
  /\bhope i (never|don'?t|do not|won'?t) wake up( again| ever again)?( tomorrow( morning)?)?\s*([.!?,;]|$)/i,
  /\bwish i (wasn't|weren't|wasnt|werent) alive\b/i,
  /\bwish i'?d never been born\b/i,
  /\bdon'?t (want to|wanna) (be alive|exist)\b/i,
  // "I don't want to live (anymore / like this)", but not "...live in this city".
  /\bdon'?t (want to|wanna) live\b(?! (in|near|with|on|at|by|there|here|so|too|close|far|together|without)\b)/i,
  // Self-harm ("I hurt myself at the gym", "I cut myself shaving" are injuries)
  /\bself[-\s]?harm/i,
  /\bharm(ing)? myself\b(?! by (sleeping|staying|drinking|skipping|working|not|having|taking)\b)/i,
  /\b(want|wanna|going|gonna|urge|tempted|thinking about|think about|thought about|feel like)( to)? (hurt|hurting) myself\b/i,
  /\b(been|keep|keeps|kept|started|start) (hurting|cutting|burning|harming) myself\b/i,
  /\b(hurt|hurting|cut|cutting|burn|burning|burned|burnt) myself on purpose\b/i,
  /\b(i'?m|i am|been|started) cutting( myself)? again\s*([.!?;]|$)/i,
  // Not "saving my sleeping pills for the flight" / "meds stored away".
  /\b(pills|meds|tablets) (saved up|stockpiled)( (to end it|to take (them )?all|to overdose|for when i)\b|\s*([.!?;]|$))/i,
  /\b(stockpiling|hoarding)( up)? (my |the )?(sleeping )?(pills|meds|tablets)\s*([.!?;]|$)/i,
  /\b(saving|stashing|stockpiling|hoarding)( up)? (my |the )?(sleeping )?(pills|meds|tablets) (to end it|for when i|in case i|to take (them )?all|to overdose)\b/i,
  /(?<!accidentally )\bcut(ting)? myself\b(?! (shaving|while|cooking|chopping|by accident|accidentally|on (a|an|the|my|some)|with (a|an|the|my)|at (work|the)|in the|some slack|a break|off|short|loose|free|out|in on|a deal|a piece|a slice|back)\b)/i,
  // Overdose ("overdosing on coffee" is tiredness slang; "my patient
  // overdosed" / "treating overdoses" is clinicians talking about work).
  /(?<!(patient|patients|someone|somebody|client|resident|we had an|we had a|treating|treated|treat) )\boverdos(e|ed|es|ing)\b(?! on (coffee|caffeine|espresso|lattes?|tea|energy drinks?|sugar|chocolate)\b)/i,
  // Past "took all my ..." skips daily-routine words; a stated plan never does.
  new RegExp(`\\b${TOOK_PAST} all (of )?(my |the )?${DRUGS_ALL}\\b(?! ${ROUTINE})`, "i"),
  new RegExp(`\\b${TOOK_INTENT} all (of )?(my |the )?${DRUGS_ALL}\\b`, "i"),
  new RegExp(`\\b${TOOK_MAYBE} all (of )?(my |the )?${DRUGS_ALL}\\b(?! ${ROUTINE})`, "i"),
  new RegExp(`\\b${TOOK} ${CONTAINER} of (my |the )?${DRUGS}\\b`, "i"),
  new RegExp(`\\b${TOOK} (my|the) (whole|entire) (prescription|supply|stash)\\b`, "i"),
  new RegExp(`\\b${TOOK} a bunch of (my |the )?${DRUGS}\\b`, "i"),
  new RegExp(`\\b${TOOK} (the|a|my) (whole|entire) (bottle|pack|packet|box)${END}`, "i"),
  // Two or more digits, so "took 2 pills" stays quiet.
  new RegExp(
    `\\b${TOOK} (like |about |around |maybe |over |almost )?\\d{2,} (of )?(my |the )?${DRUGS}\\b`,
    "i",
  ),
  new RegExp(
    `\\b${TOOK} (way )?(too many|a handful of|a lot of|loads of) (of )?(my |the )?${DRUGS}\\b`,
    "i",
  ),
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

/** Shown as the assistant's turn when a crisis message is not sent to the AI (no AI permission). */
export const CRISIS_LOCAL_REPLY =
  "I'm really glad you told me. You matter, and you don't have to carry this alone. The support options just below are there for you right now, any time of day or night.";

/** Static resources shown by <CrisisSupportCard />. No network needed to read them. */
export const CRISIS_RESOURCES = {
  usLine: "988",
  usLineName: "988 Suicide & Crisis Lifeline",
  usEmergency: "911",
  findAHelplineUrl: "https://findahelpline.com",
  findAHelplineLabel: "findahelpline.com",
} as const;
