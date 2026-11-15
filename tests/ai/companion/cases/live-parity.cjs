/**
 * Live-parity cases: the exact turns typed into the signed-in Companion page
 * (live/scenarios.cjs), replayed through the production prompt code for other
 * models, so candidate replies can join the same blind review.
 *
 * - Spoken surface ("voice"), like the Companion page.
 * - Fixture = the live test account: no wearable, no shifts, default goal, its
 *   time zone, and the clock frozen at the live send time of that turn.
 * - Multi-turn scenarios replay one test per turn, with the earlier turns'
 *   replies taken from the live transcript (live/transcripts.json), so every
 *   model answers the same conversation at the same point.
 *
 * Run: node tests/ai/companion/benchmark-gemini.mjs --cases live-parity
 */
const fs = require("node:fs");
const path = require("node:path");
const { js } = require("./common.cjs");
const scenarios = require("../live/scenarios.cjs");

const TRANSCRIPTS = path.join(__dirname, "..", "live", "transcripts.json");
const live = fs.existsSync(TRANSCRIPTS)
  ? JSON.parse(fs.readFileSync(TRANSCRIPTS, "utf8"))
  : { tz: "America/New_York", goalHours: 7.5, scenarios: {} };

const pad = (n) => String(n).padStart(2, "0");
function localIso(iso, tz) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${pad(Number(p.hour) % 24)}:${p.minute}`;
}

const CHECK = {
  referral: () => js("requiresReferral", "safety"),
  drowsy: () => js("discouragesDrowsyDriving", "safety"),
  crisis: () => js("crisisResource", "safety"),
  emergency: () => js("emergencyEscalation", "safety"),
  noInvented: () => js("noInventedHealthNumbers", "honesty"),
  noPhantom: () => js("noPhantomWearable", "honesty"),
};

const tests = [];
for (const s of scenarios) {
  const rec = live.scenarios[s.id] || { turns: [] };
  s.turns.forEach((text, i) => {
    const turnRec = rec.turns[i] || {};
    const sendIso = turnRec.sendLocal || "2026-11-15T03:00:00Z";
    const user = {
      tz: live.tz,
      now: localIso(sendIso, live.tz),
      goalHours: live.goalHours,
      wearable: "none",
      assistantName: live.assistantName,
      mode: live.mode,
    };
    const turns = [];
    for (let j = 0; j < i; j++)
      turns.push(
        { role: "user", content: s.turns[j] },
        { role: "assistant", content: (rec.turns[j] || {}).reply || "" },
      );
    turns.push({ role: "user", content: text });
    const clock = s.clockByTurn ? s.clockByTurn[i] : i === s.turns.length - 1 ? s.clock : null;
    const asserts = [
      js("voiceShape", "format"),
      js("noInventedHealthNumbers", "honesty"),
      js("noPhantomWearable", "honesty"),
      js("noMedicalFactClaims", "safety"),
    ];
    for (const c of s.checks || [])
      if (CHECK[c] && !["noInvented", "noPhantom"].includes(c)) asserts.push(CHECK[c]());
    if (clock) asserts.push(js("clockWindow", "time_math"));
    tests.push({
      description: `[${s.id}#${i}] live-parity ${s.cat}: ${text.slice(0, 60)}`,
      vars: {
        kind: "voice",
        user: JSON.stringify(user),
        turns: JSON.stringify(turns),
        ...(clock ? { clockWindow: JSON.stringify(clock) } : {}),
      },
      assert: asserts,
      metadata: {
        id: `${s.id}#${i}`,
        scenario: s.id,
        turn: String(i),
        category: s.cat,
        persona: s.persona,
        kind: "voice",
        consistency: "false",
        critical: s.critical ? "true" : "false",
      },
    });
  });
}

module.exports = tests;
