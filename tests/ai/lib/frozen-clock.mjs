// Runs prompt assembly with a fixed "now" so every scenario renders the same
// system prompt on every run. That is what makes responses cacheable and lets
// assertions check exact clock times ("stop caffeine by 1 p.m.").
//
// The app code calls `new Date()` / `Date.now()` directly, so the global Date is
// swapped for the duration of the callback. Calls are serialised with a simple
// mutex because assembly is async and promptfoo runs tests concurrently. Only
// prompt assembly runs inside the lock; the model call happens outside it.

const RealDate = globalThis.Date;
let chain = Promise.resolve();

function frozenDateClass(fixedMs) {
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixedMs);
      else super(...args);
    }
    static now() {
      return fixedMs;
    }
  }
  return FrozenDate;
}

export function withFrozenClock(nowIso, fn) {
  const fixedMs = new RealDate(nowIso).getTime();
  if (Number.isNaN(fixedMs)) throw new Error(`Invalid frozen clock value: ${nowIso}`);
  const run = chain.then(async () => {
    globalThis.Date = frozenDateClass(fixedMs);
    try {
      return await fn(new RealDate(fixedMs));
    } finally {
      globalThis.Date = RealDate;
    }
  });
  chain = run.catch(() => {});
  return run;
}
