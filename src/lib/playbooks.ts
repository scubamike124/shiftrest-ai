import type { Shift } from "./shifts";

export type Playbook = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Generates 7 days of shifts starting Monday. Empty days are skipped. */
  generate: () => Shift[];
  tips: string[];
};

const uid = () => Math.random().toString(36).slice(2, 10);

function shift(day: number, start: number, end: number): Shift {
  return { id: uid(), day, start, end };
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: "4-on-3-off-nights",
    name: "4 on / 3 off — Nights",
    tagline: "Classic nursing & EMS block",
    description:
      "Four 12-hour night shifts (7p–7a) followed by three days off. Anchors daytime sleep 8a–4p.",
    tips: [
      "Treat days off like a 'mini-jetlag recovery' — bright morning light on day 1 off.",
      "Anchor your sleep window even on the first day off (sleep until at least noon).",
      "Caffeine cutoff at 2 a.m. on shift days.",
    ],
    generate: () => [
      shift(0, 19 * 60, 7 * 60),
      shift(1, 19 * 60, 7 * 60),
      shift(2, 19 * 60, 7 * 60),
      shift(3, 19 * 60, 7 * 60),
    ],
  },
  {
    id: "2-2-3-pitman",
    name: "Pitman (2-2-3) — Days",
    tagline: "Every other weekend off",
    description:
      "12-hour days, 7a–7p, on a 2-2-3 cadence. Predictable but the 3-day stretch is the killer.",
    tips: [
      "On the 3-day block, protect a fixed 10:30 p.m. lights-out — every night.",
      "Light exposure right at wake (6 a.m.) keeps your rhythm locked in.",
    ],
    generate: () => [
      shift(0, 7 * 60, 19 * 60),
      shift(1, 7 * 60, 19 * 60),
      shift(3, 7 * 60, 19 * 60),
      shift(4, 7 * 60, 19 * 60),
      shift(5, 7 * 60, 19 * 60),
    ],
  },
  {
    id: "coming-off-nights",
    name: "Coming off 4 nights",
    tagline: "Re-entry plan for days off",
    description:
      "After your last night, sleep a short 4–5h block, then force yourself awake by 2 p.m. to reset.",
    tips: [
      "First sleep: 9 a.m. – 1:30 p.m. only. Set an alarm.",
      "Bright light at 2 p.m., outdoor walk if possible.",
      "Normal bedtime that night — you'll crash hard and wake on schedule.",
    ],
    generate: () => [],
  },
  {
    id: "swing-rotation",
    name: "Forward swing rotation",
    tagline: "Days → Evenings → Nights",
    description:
      "Forward (clockwise) rotation. Easier on your body than backward — each shift starts later than the last.",
    tips: [
      "Push bedtime 2–3 hours later each transition day.",
      "Use bright light at the END of each shift to delay your clock.",
    ],
    generate: () => [
      shift(0, 7 * 60, 15 * 60),
      shift(1, 7 * 60, 15 * 60),
      shift(2, 15 * 60, 23 * 60),
      shift(3, 15 * 60, 23 * 60),
      shift(4, 23 * 60, 7 * 60),
      shift(5, 23 * 60, 7 * 60),
    ],
  },
  {
    id: "first-responder-24",
    name: "24/48 — First responder",
    tagline: "24 on, 48 off",
    description:
      "One 24-hour on-shift, two days recovery. Nap discipline during shift is everything.",
    tips: [
      "Strategic 20-min naps every 4h on shift — short enough to avoid grogginess.",
      "Off-day 1: catch-up sleep (up to 10h). Off-day 2: normal schedule to reset.",
    ],
    generate: () => [shift(0, 8 * 60, 8 * 60)],
  },
];
