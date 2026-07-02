/**
 * Shared time-of-day directive injected into every conversational AI prompt
 * (Companion coach, Pilot voice, voice briefings, JSON intents).
 *
 * Given the user's local time + timezone, produces a system-prompt fragment
 * that pins the greeting and current clock so the model can never say
 * "Good evening" when it's actually morning.
 */

export type TimeDirectiveInput = {
  localTime?: string | null;
  timezone?: string | null;
};

export type TimeDirectiveResolved = {
  directive: string;
  hour: number | null;
  pretty: string | null;
  greeting: string | null;
};

import { DAY_PART_LABEL, getDayPart } from "@/lib/time/day-part";

export function greetingForHour(hour: number | null): string | null {
  if (hour === null || Number.isNaN(hour)) return null;
  // Build a Date whose local hour matches the provided hour so we can defer
  // to the canonical getDayPart() bucket boundaries used app-wide.
  const d = new Date();
  d.setHours(hour, 30, 0, 0);
  const part = getDayPart(d);
  // Model output space only distinguishes morning / afternoon / evening.
  // "night" collapses back to "Good evening" to match spoken openers.
  return part === "night" ? "Good evening" : DAY_PART_LABEL[part];
}

export function buildTimeDirective(input: TimeDirectiveInput): TimeDirectiveResolved {
  const empty: TimeDirectiveResolved = {
    directive: "",
    hour: null,
    pretty: null,
    greeting: null,
  };
  const localTime = input.localTime;
  if (!localTime) return empty;

  let hour: number | null = null;
  let pretty = localTime;
  try {
    const d = new Date(localTime);
    if (!isNaN(d.getTime())) {
      if (input.timezone) {
        pretty = new Intl.DateTimeFormat("en-US", {
          timeZone: input.timezone,
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        }).format(d);
        const hourStr = new Intl.DateTimeFormat("en-US", {
          timeZone: input.timezone,
          hour: "2-digit",
          hour12: false,
        }).format(d);
        const h = parseInt(hourStr, 10);
        if (!isNaN(h)) hour = h;
      } else {
        hour = d.getHours();
        pretty = d.toLocaleTimeString();
      }
    }
  } catch {
    /* best effort */
  }

  const greeting = greetingForHour(hour);
  const morningGuard =
    greeting === "Good morning"
      ? ` MORNING STRICTNESS: Because it is morning, do not say "Good evening", "tonight", "this evening", or any evening-coded greeting anywhere in this reply.`
      : greeting === "Good afternoon"
      ? ` AFTERNOON STRICTNESS: Because it is afternoon, do not open with "Good morning" or "Good evening".`
      : "";
  const directive =
    `\n\nCURRENT LOCAL TIME for the user: ${pretty}${input.timezone ? ` (${input.timezone})` : ""}.` +
    (greeting
      ? ` Time-of-day greeting MUST be "${greeting}" — never use a different time-of-day greeting ` +
        `(no "Good evening" in the morning, no "tonight" in the morning, etc.).${morningGuard}`
      : "");

  return { directive, hour, pretty, greeting };
}
