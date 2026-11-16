/**
 * JSON intents (plans, smart alarm, commute, jet lag) with deterministic math,
 * and tool-use probes. The probes measure each model's function-calling
 * ability against the companion's real action set (sounds, timers, events,
 * alarms); production currently routes these through a client-side intent
 * router, so they are a capability check, not a regression test.
 */
const { t, js, withUser, P } = require("./common.cjs");
const { isoAt } = require("../lib/time.cjs");

const json = (keys) => ({ requiredKeys: keys });
const local = (persona, clock, d = 0) => isoAt(P[persona].user.now, P[persona].user.tz, clock, d);

const intent = (spec) =>
  t({ ...spec, kind: "intent", turns: [{ role: "user", content: spec.ask }], vars: { intent: spec.intent, payload: spec.payload, ...json(spec.keys), ...(spec.vars ?? {}) }, asserts: [js("intentJson", "format"), ...(spec.asserts ?? [])] });

const TOOLS = [
  { type: "function", function: { name: "play_sound", description: "Play a sleep sound from the RestPilot library.", parameters: { type: "object", properties: { slug: { type: "string", enum: ["rain", "ocean", "river", "wind", "thunder", "white_noise", "pink_noise", "brown_noise", "fan", "fireplace", "forest", "crickets", "soft_music"] }, minutes: { type: "number", description: "Optional sleep timer in minutes" } }, required: ["slug"] } } },
  { type: "function", function: { name: "stop_sounds", description: "Stop every sound that is playing.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "set_timer", description: "Start a countdown timer, e.g. for a nap.", parameters: { type: "object", properties: { minutes: { type: "number" } }, required: ["minutes"] } } },
  { type: "function", function: { name: "set_alarm", description: "Set an alarm. smartWindowMin > 0 lets RestPilot move it within that many minutes.", parameters: { type: "object", properties: { timeIso: { type: "string" }, smartWindowMin: { type: "number" } }, required: ["timeIso"] } } },
  { type: "function", function: { name: "create_event", description: "Add a shift or event to the user's RestPilot calendar.", parameters: { type: "object", properties: { title: { type: "string" }, startIso: { type: "string" }, durationMin: { type: "number" } }, required: ["title", "startIso", "durationMin"] } } },
];
const tool = (spec) =>
  t({ ...spec, kind: "tool", noDefaults: true, turns: [{ role: "user", content: spec.ask }], vars: { tools: TOOLS, expectTool: spec.tool, expectArgs: spec.args ?? {} }, asserts: [js("toolCall", "tool_use")] });

module.exports = [
  // ---- K. JSON intents
  intent({ id: "K01", cat: "structured", persona: "dana", intent: "commute", consistency: true, ask: "commute",
    payload: { shiftStartIso: local("dana", "19:00"), travelMin: 35, prepMin: 20 }, keys: ["leaveAt", "prepStartAt", "advice"],
    asserts: [js("commuteMath", "time_math")], expect: "Exact leaveAt 6:25 PM and prepStartAt 6:05 PM local, with a concrete pre-shift tip tied to her short sleep." }),
  intent({ id: "K02", cat: "structured", persona: "ken", intent: "commute", ask: "commute",
    payload: { shiftStartIso: local("ken", "23:00"), travelMin: 25 }, keys: ["leaveAt", "prepStartAt", "advice"],
    asserts: [js("commuteMath", "time_math")], expect: "leaveAt 10:35 PM, prepStartAt 10:10 PM (default 25 min prep)." }),
  intent({ id: "K03", cat: "structured", persona: "marcus", intent: "commute", ask: "commute",
    payload: { shiftStartIso: local("marcus", "07:00", 2), travelMin: 40, prepMin: 30 }, keys: ["leaveAt", "prepStartAt", "advice"],
    asserts: [js("commuteMath", "time_math")], expect: "leaveAt 6:20 AM, prepStartAt 5:50 AM two days from now." }),
  intent({ id: "K04", cat: "structured", persona: "dana", intent: "smart_alarm", consistency: true, ask: "smart alarm",
    payload: { targetWakeIso: local("dana", "15:00", 1), windowMin: 20, maxAdjustmentMin: 20 }, keys: ["wakeAt", "reason", "cyclePosition", "confidence", "confidenceReason", "message"],
    asserts: [js("alarmWindow", "time_math")], expect: "Moves the wake time within ±20 minutes of 3:00 PM tomorrow, and phrases cycle position as an estimate." }),
  intent({ id: "K05", cat: "structured", persona: "tom", intent: "smart_alarm", ask: "smart alarm",
    payload: { targetWakeIso: local("tom", "10:00", 1), windowMin: 15, maxAdjustmentMin: 15 }, keys: ["wakeAt", "reason", "confidence", "message"],
    asserts: [js("alarmWindow", "time_math")], expect: "Wake time within ±15 min of 10:00 AM, not exactly 10:00; confidence reflects Fitbit data." }),
  intent({ id: "K06", cat: "structured", persona: "ken", intent: "smart_alarm", ask: "smart alarm",
    payload: { targetWakeIso: local("ken", "15:00", 1), windowMin: 0, maxAdjustmentMin: 0 }, keys: ["wakeAt", "reason", "confidence", "message"],
    asserts: [js("alarmWindow", "time_math")], expect: "windowMin is 0, so wakeAt must equal the target exactly; low confidence given no wearable data." }),
  intent({ id: "K07", cat: "structured", persona: "luis", intent: "daily_plan", ask: "daily plan",
    payload: { horizon: "24h" }, keys: ["headline", "riskLevel", "actions"],
    expect: "3-5 prioritised actions for the first night after a days-to-nights switch with specific times (afternoon nap, caffeine at shift start, light, sunglasses home)." }),
  intent({ id: "K08", cat: "structured", persona: "jen", intent: "right_now", ask: "right now",
    payload: {}, keys: ["action", "why", "followBenefit", "ignoreCost", "confidence", "confidenceReason", "urgency", "timeWindow"],
    expect: "Single highest-leverage action now (2 PM): protect sleep or nap before 3:15 pickup / 6:45 PM shift; why cites Oura data; benefits phrased as likely." }),
  intent({ id: "K09", cat: "structured", persona: "priya", intent: "tomorrow_preview", ask: "tomorrow preview",
    payload: {}, keys: ["headline", "summary", "confidence", "blocks"],
    expect: "4-6 chronological blocks for tomorrow (second night shift): sleep after shift, light, caffeine cutoff, nap, commute." }),
  intent({ id: "K10", cat: "structured", persona: "ray", intent: "daily_review", ask: "daily review",
    payload: {}, keys: ["headline", "wins", "drains", "metrics", "tomorrowFocus"],
    expect: "Encouraging recap; drains mention the short on-call night from Fitbit; metrics only use given data, null otherwise." }),
  intent({ id: "K11", cat: "structured", persona: "marcus", intent: "daily_review", ask: "daily review",
    payload: {}, keys: ["headline", "wins", "drains", "metrics", "tomorrowFocus"],
    expect: "No wearable data, so sleepRecoveredMin must be null and recoveryTrend 'unknown'; no invented numbers, and no readiness figure (none is requested)." }),
  intent({ id: "K12", cat: "structured", persona: "aisha", intent: "jetlag_plan", ask: "jet lag plan",
    user: withUser("aisha", { trip: { id: "trip-1", label: "LHR-JFK", origin_tz: "Europe/London", dest_tz: "America/New_York", dest_label: "New York", depart_utc: local("aisha", "09:00", 3), arrive_utc: local("aisha", "17:00", 3), status: "planned" } }),
    payload: { phase: "pre", tripId: "trip-1" }, keys: ["headline", "summary", "phase", "directionEast", "clockBasis", "blocks", "ifIgnored"],
    expect: "Westbound (directionEast false), 5-hour offset, pre-trip phase; every time names its clock basis." }),
  intent({ id: "K13", cat: "structured", persona: "dana", intent: "adjust_plan", ask: "adjust plan",
    payload: { observation: "Only slept about 4 hours and I feel foggy" }, keys: ["summary", "confidence", "ifIgnored", "changes"],
    expect: "2-3 concrete adjustments (pre-shift nap, caffeine timing, earlier sleep after the shift) in coach voice; no invented measurements beyond the user's own 4 hours and Oura data." }),
  t({ id: "K14", cat: "structured", persona: "priya", kind: "brief",
    ask: "voice briefing",
    vars: { plan: "Tonight: Medic 7 night shift 7:00 PM-7:00 AM. Nap 3:30-5:00 PM. Caffeine at 7 PM and 11 PM, none after 1 AM. Bright light first half of shift. Sunglasses on the drive home. Sleep 8:00 AM-3:00 PM." },
    asserts: [js("voiceShape", "format", 0.5)],
    expect: "A short spoken script that narrates the given plan faithfully (same times), no added measurements." }),

  // ---- L. Tool-use probes
  tool({ id: "L01", cat: "tool_use", persona: "dana", ask: "Play rain for 45 minutes.", tool: "play_sound", args: { slug: "rain", minutes: 45 } }),
  tool({ id: "L02", cat: "tool_use", persona: "luis", ask: "Start a 20 minute nap timer.", tool: "set_timer", args: { minutes: 20 } }),
  tool({ id: "L03", cat: "tool_use", persona: "jen", ask: "Add my overtime shift Saturday 7pm to 7am to my calendar.", tool: "create_event", args: { durationMin: 720 } }),
  tool({ id: "L04", cat: "tool_use", persona: "dana", ask: "Wake me at 3pm tomorrow, and you can move it up to 20 minutes for a lighter moment.", tool: "set_alarm", args: { smartWindowMin: 20 } }),
  tool({ id: "L05", cat: "tool_use", persona: "tom", ask: "Why do I feel groggy after naps?", tool: "none" }),
  tool({ id: "L06", cat: "tool_use", persona: "ken", ask: "Stop all the sounds please.", tool: "stop_sounds" }),
];
