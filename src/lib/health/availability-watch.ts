// Bounded retry for the Apple Health availability probe, inside the iPhone app only.
//
// The probe (appleHealthAvailable) answers false when the injected Capacitor plugin
// is not ready yet or the first native call throws. Run once, that hid the Connect
// Apple Health card until the page remounted. This re-probes a few times with a
// growing delay, stops at the first true, never retries on the web, and is fully
// cancelled by the returned function. It only probes availability: it never asks
// for Health authorization.
//
// Dependency-free on purpose (tests load this file on its own).

/** Delays after probe 1, 2, 3, 4 (so at most 5 probes, about 10 s in total). */
export const AVAILABILITY_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 3000, 4000];

export type AvailabilityWatch = {
  probe: () => Promise<boolean>;
  /** True inside the iPhone app. Anywhere else the probe runs once. */
  native: boolean;
  onChange: (available: boolean) => void;
  delays?: readonly number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Starts probing. Returns a cancel function (call it on unmount). */
export function watchAppleHealthAvailability(opts: AvailabilityWatch): () => void {
  const delays = opts.delays ?? AVAILABILITY_RETRY_DELAYS_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let cancelled = false;
  let timer: unknown = null;

  const attempt = (index: number): void => {
    let result: Promise<boolean>;
    try {
      result = Promise.resolve(opts.probe());
    } catch {
      result = Promise.resolve(false);
    }
    void result
      .catch(() => false)
      .then((available) => {
        if (cancelled) return;
        if (available === true) {
          opts.onChange(true);
          return;
        }
        if (!opts.native || index >= delays.length) return; // settle on false
        timer = setTimer(() => {
          timer = null;
          if (!cancelled) attempt(index + 1);
        }, delays[index]);
      });
  };
  attempt(0);

  return () => {
    cancelled = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
}
