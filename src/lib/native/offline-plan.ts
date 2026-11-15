// Offline plan for the iPhone app shell.
//
// The app loads restpilotai.com over the network. When that fails (no signal,
// airplane mode), Capacitor shows the shell's own local page
// (ios-app/www/offline.html, `server.errorPath`). That page cannot read this
// site's localStorage (a different origin), so the site also writes a small,
// pre-computed plan into the app's native key-value store (Capacitor
// Preferences, i.e. iOS UserDefaults inside the app sandbox). The offline
// page renders it: "your next shifts and sleep windows", with no network.
//
// Pure: no I/O. Only schedule data: no notes, no health data, no tokens.

import type { Employer } from "@/lib/employers";
import type { Prefs } from "@/lib/prefs";
import type { Shift } from "@/lib/shifts";
import { endAbsolute } from "@/lib/shifts";
import { buildMultiDayPlan } from "@/lib/schedule";

export const OFFLINE_PLAN_KEY = "rp.offlinePlan.v1";
export const APP_URL_KEY = "rp.appUrl";
export const OFFLINE_PLAN_DAYS = 14;

export type OfflinePlanDay = {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  shifts: Array<{
    start: string;
    end: string;
    overnight: boolean;
    title: string | null;
    employer: string | null;
  }>;
  /** Planned sleep window for the day's main shift, local HH:MM. */
  sleep: { start: string; end: string } | null;
};

export type OfflinePlan = {
  v: 1;
  /** ISO timestamp of when the plan was computed. */
  savedAt: string;
  days: OfflinePlanDay[];
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const minToHHMM = (m: number) => {
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`;
};
const dateToHHMM = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, n) : null;
};

export function buildOfflinePlan(args: {
  shifts: Shift[];
  prefs: Prefs;
  employers?: Employer[];
  now: Date;
  days?: number;
}): OfflinePlan {
  const employerName = new Map((args.employers ?? []).map((e) => [e.id, e.name]));
  const plan = buildMultiDayPlan(args.shifts, args.prefs, args.now, args.days ?? OFFLINE_PLAN_DAYS);
  return {
    v: 1,
    savedAt: args.now.toISOString(),
    days: plan.map((d) => ({
      date: ymd(d.date),
      shifts: d.shifts.map((s) => ({
        start: minToHHMM(s.start),
        end: minToHHMM(endAbsolute(s)),
        overnight: endAbsolute(s) >= 1440,
        title: clip(s.title, 60),
        employer: s.employerId ? clip(employerName.get(s.employerId), 60) : null,
      })),
      sleep: d.sleep ? { start: dateToHHMM(d.sleep.start), end: dateToHHMM(d.sleep.end) } : null,
    })),
  };
}
