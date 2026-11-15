import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("spoken and text coach prompts carry the safety-and-care rules and never ask for doses", async () => {
  const { buildMessages } = require("./ai/companion/lib/production-prompt.cjs");
  for (const kind of ["voice", "coach"]) {
    const [sys] = await buildMessages({
      vars: {
        kind,
        user: JSON.stringify({ tz: "America/New_York", now: "2026-11-15T22:00", wearable: "none" }),
        turns: JSON.stringify([{ role: "user", content: "hi" }]),
      },
    });
    assert.match(sys.content, /SAFETY AND CARE/, kind);
    assert.match(sys.content, /988/, kind);
    assert.doesNotMatch(sys.content, /give exact times, durations, doses/i, kind);
    assert.ok(
      sys.content.indexOf("SAFETY AND CARE") > sys.content.indexOf("DATA HONESTY"),
      `${kind}: safety rules come after the honesty rules`,
    );
  }
});

test("JSON dashboard intents do not get the conversational safety block", async () => {
  const { buildMessages } = require("./ai/companion/lib/production-prompt.cjs");
  for (const intent of ["daily_plan", "right_now", "tomorrow_preview", "daily_review"]) {
    const [sys] = await buildMessages({
      vars: {
        kind: "intent",
        intent,
        payload: "{}",
        user: JSON.stringify({ tz: "America/New_York", now: "2026-11-15T22:00", wearable: "none" }),
      },
    });
    assert.doesNotMatch(sys.content, /SAFETY AND CARE/, intent);
    assert.match(sys.content, /DATA HONESTY/, intent);
  }
});
