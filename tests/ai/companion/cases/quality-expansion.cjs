/**
 * Coverage expansion for the owner's quality review (2026-11-15): emotionally
 * distressed responders, rude or frustrated users, ambiguous schedules,
 * conflicting constraints, out-of-scope requests, factual accuracy, health
 * safety, professional communication and multi-turn consistency.
 *
 * The scenario text and expectations are shared with the live review
 * (live/scenarios.cjs, src: "new"), so the benchmark and the signed-in review
 * test the same behaviour. Here each runs on the text coach with the closest
 * synthetic persona; live/ runs them on the signed-in Companion page.
 */
const { t, js, withUser } = require("./common.cjs");
const live = require("../live/scenarios.cjs");

const PERSONA = {
  "ER nurse": "dana",
  "ICU nurse": "jen",
  "Volunteer firefighter": "ray",
  "Plant technician": "luis",
  "Security officer": "ken",
  Firefighter: "marcus",
  "Police officer": "tom",
  Paramedic: "priya",
  "Hospitality worker": "sofia",
  "Flight attendant": "aisha",
  "Account profile": "ken",
  "911 dispatcher": "ken",
};
const CHECK = {
  referral: () => js("requiresReferral", "safety"),
  drowsy: () => js("discouragesDrowsyDriving", "safety"),
  crisis: () => js("crisisResource", "safety"),
  emergency: () => js("emergencyEscalation", "safety"),
};
// Scripted earlier assistant turns for the multi-turn cases: plausible, correct,
// and neutral, so only the final reply is graded.
const PRIOR = {
  M01: [
    "Got it: 6 PM to 6 AM, Friday to Sunday, and light sleep. I'll keep that in mind.",
    "Aim to stop caffeine around midnight to 1 AM so it has about six hours to wear off before you sleep around 7 AM.",
    "Make your main sleep about 7 AM to 2:30 PM in a dark, cool room, with earplugs or white noise since you wake easily.",
  ],
  M02: [
    "Understood: no naps at work, and naps leave you feeling worse, so we'll work without them.",
    "Around 4 AM, get bright light, move for a few minutes, have cold water or a small protein snack, and keep caffeine to the first half of the shift.",
  ],
  M03: [
    "Noted: 11 PM to 7 AM tomorrow, coffee planned at 1 AM and 4 AM.",
    "If you want to sleep at 8 AM, make your last caffeine around 2 AM, about six hours before.",
  ],
};

module.exports = live
  .filter((s) => s.src === "new")
  .map((s) => {
    const persona = PERSONA[s.persona] ?? "ken";
    const turns =
      s.turns.length === 1
        ? undefined
        : s.turns.flatMap((u, i) =>
            i < s.turns.length - 1
              ? [
                  { role: "user", content: u },
                  { role: "assistant", content: PRIOR[s.id][i] },
                ]
              : [{ role: "user", content: u }],
          );
    const clock = s.clockByTurn ? s.clockByTurn[s.turns.length - 1] : s.clock;
    return t({
      id: s.id,
      cat: s.cat,
      persona,
      user:
        s.persona === "Account profile"
          ? withUser("ken", { wearable: "none", shifts: [] })
          : undefined,
      ...(turns ? { turns } : { ask: s.turns[0] }),
      expect: s.expect,
      reference: s.reference,
      sources: s.sources.length ? s.sources : undefined,
      ...(clock ? { vars: { clockWindow: clock } } : {}),
      asserts: [
        ...(s.checks || []).filter((c) => CHECK[c]).map((c) => CHECK[c]()),
        ...(clock ? [js("clockWindow", "time_math")] : []),
      ],
    });
  });
