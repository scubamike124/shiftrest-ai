import { describe, it, expect } from "vitest";
import { normalizeForSpeech } from "../speech-normalize";

describe("normalizeForSpeech", () => {
  it("converts top-of-hour times to o'clock", () => {
    expect(normalizeForSpeech("Wake me at 8:00")).toMatch(/eight o'clock/);
  });
  it("keeps am/pm naturally", () => {
    expect(normalizeForSpeech("Be ready by 8:00 AM")).toMatch(/eight o'clock a\.m\./);
    expect(normalizeForSpeech("Meeting at 3:30 pm")).toMatch(/three thirty p\.m\./);
  });
  it("handles noon and midnight", () => {
    expect(normalizeForSpeech("Lunch at 12:00 PM")).toMatch(/noon/);
    expect(normalizeForSpeech("Snack at 12:00 AM")).toMatch(/midnight/);
  });
  it("handles single-digit minutes with 'oh'", () => {
    expect(normalizeForSpeech("Leave at 7:05")).toMatch(/seven oh five/);
  });
  it("does not mangle aspect ratios", () => {
    expect(normalizeForSpeech("Use 16:9 aspect ratio")).toMatch(/16:9/);
  });
  it("rewrites half-hour decimals", () => {
    expect(normalizeForSpeech("Sleep 7.5 hours")).toMatch(/seven and a half hours/);
  });
  it("strips markdown", () => {
    expect(normalizeForSpeech("**Hi** there")).toMatch(/^Hi there/);
    expect(normalizeForSpeech("- item one")).toMatch(/^item one/);
  });
  it("expands units", () => {
    expect(normalizeForSpeech("Take 200mg")).toMatch(/milligrams/);
    expect(normalizeForSpeech("It's 72°F outside")).toMatch(/degrees Fahrenheit/);
  });
  it("collapses ellipses and em-dashes", () => {
    expect(normalizeForSpeech("Try this... it works — fast")).not.toMatch(/\.\.\.|—/);
  });
  it("never throws on weird input", () => {
    expect(() => normalizeForSpeech("")).not.toThrow();
    expect(() => normalizeForSpeech("\u0000")).not.toThrow();
  });
});
