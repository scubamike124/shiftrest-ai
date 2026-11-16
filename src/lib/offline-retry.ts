// Retry-once-on-reconnect for AI cards that failed while offline (QA-REPORT R6).
//
// A card whose request failed because the device was offline keeps "You're offline…"
// after the connection returns, until the user taps "Try again". This retries ONCE
// per offline→online cycle, and only for the offline failure (never a provider error,
// never on a timer):
//   - the retry waits `debounceMs` after the 'online' event, and is cancelled if the
//     connection drops again, so a flapping connection cannot fire a burst of requests
//     (each AI request counts against the per-minute request limit);
//   - after one attempt the card is not retried again until the connection has gone
//     offline and come back.
// Pure logic with injected timers so it is unit tested without a browser.

export type ReconnectRetryOptions = {
  debounceMs: number;
  isOnline: () => boolean;
  /** True while the card shows the offline failure (and only that). */
  shouldRetry: () => boolean;
  retry: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
};

export function createReconnectRetry(o: ReconnectRetryOptions) {
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let attempted = false;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const schedule = () => {
    if (attempted || timer !== null || !o.isOnline() || !o.shouldRetry()) return;
    timer = setTimer(() => {
      timer = null;
      // Re-check at fire time: still online, still showing the offline failure.
      if (attempted || !o.isOnline() || !o.shouldRetry()) return;
      attempted = true;
      o.retry();
    }, o.debounceMs);
  };

  return {
    /** The 'online' event (also call on mount and whenever the card's state changes). */
    onOnline() {
      cancel(); // restart the debounce window
      schedule();
    },
    /** The 'offline' event: cancel anything pending and re-arm for the next reconnect. */
    onOffline() {
      cancel();
      attempted = false;
    },
    /** The card's state changed (e.g. it just failed offline): maybe schedule. */
    onStateChange() {
      schedule();
    },
    dispose() {
      cancel();
    },
  };
}
