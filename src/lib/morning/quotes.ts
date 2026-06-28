// CC0 / public-domain quotes. Deterministic rotation by local date so the
// quote feels fresh but never flickers on re-render.

const QUOTES: { text: string; author?: string }[] = [
  { text: "Every morning we are born again. What we do today matters most.", author: "Buddha" },
  { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
  { text: "Small steps every day." },
  { text: "Rest is not idleness — it is the foundation of every great day." },
  { text: "How we spend our days is how we spend our lives.", author: "Annie Dillard" },
  { text: "You don't have to be great to start, but you have to start to be great." },
  { text: "Calm mind brings inner strength and self-confidence.", author: "Dalai Lama" },
  { text: "A well-rested body answers questions a tired one can't even ask." },
  { text: "Energy flows where attention goes." },
  { text: "Begin gently. The day will rise to meet you." },
];

export function quoteForToday(date = new Date()): { text: string; author?: string } {
  const ymd = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  let h = 0;
  for (let i = 0; i < ymd.length; i++) h = (h * 31 + ymd.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % QUOTES.length;
  return QUOTES[idx];
}
