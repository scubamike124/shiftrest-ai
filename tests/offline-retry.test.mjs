// QA-REPORT R6: AI cards that failed while offline retry ONCE when the connection returns,
// debounced, never on a timer, never for provider errors.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { makeLoader, read } from "./_ai-route-harness.mjs";

const { createReconnectRetry } = makeLoader()("src/lib/offline-retry.ts");

test("AIBrief reconnect makes only one request when the provider fails", async () => {
  // Read the actual component's options, then exercise React Query's real retry
  // behavior. Testing the reconnect controller alone cannot see query retries.
  const source = ts.createSourceFile(
    "AIBriefCard.tsx",
    read("src/components/AIBriefCard.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let optionsSource;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useQuery") {
      optionsSource = node.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(optionsSource, "the component's query options must be exercised");
  for (const status of [401, 429, 503]) {
    let calls = 0;
    const options = vm.runInNewContext(`(${optionsSource})`, {
      queryKey: ["ai-brief", `provider-${status}`],
      context: "test schedule",
      hasSession: false,
      fetchBrief: async () => {
        calls++;
        throw new Error(`provider ${status}`);
      },
    });
    const client = new QueryClient();
    const observer = new QueryObserver(client, { ...options, retryDelay: 0 });
    let pending;
    let fire;
    const controller = createReconnectRetry({
      debounceMs: 1500,
      isOnline: () => true,
      shouldRetry: () => true,
      retry: () => {
        pending = observer.refetch();
      },
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      clearTimer: () => {},
    });
    try {
      controller.onOnline();
      fire();
      await pending;
      assert.equal(calls, 1, `provider ${status} must not trigger a hidden second attempt`);
      assert.equal(observer.getCurrentResult().status, "error");
      controller.onStateChange();
      assert.equal(calls, 1, "failure cannot re-arm the same reconnect cycle");
    } finally {
      controller.dispose();
      observer.destroy();
      client.clear();
    }
  }
});

/** A fake clock and connection so the tests are exact. */
function rig({ failed = true, online = false, debounceMs = 1500 } = {}) {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const st = { failed, online, retries: 0 };
  const ctl = createReconnectRetry({
    debounceMs,
    isOnline: () => st.online,
    shouldRetry: () => st.failed,
    retry: () => {
      st.retries++;
    },
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const advance = (ms) => {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  const goOnline = () => {
    st.online = true;
    ctl.onOnline();
  };
  const goOffline = () => {
    st.online = false;
    ctl.onOffline();
  };
  return { st, ctl, advance, goOnline, goOffline, timers };
}

test("one retry per reconnect, after the debounce, not before", () => {
  const r = rig();
  r.goOnline();
  r.advance(1499);
  assert.equal(r.st.retries, 0, "not before the debounce window");
  r.advance(1);
  assert.equal(r.st.retries, 1);
  r.advance(60_000);
  assert.equal(r.st.retries, 1, "no polling: nothing more without another reconnect");
});

test("a flapping connection fires at most one request: each drop cancels, each return restarts the window", () => {
  const r = rig();
  for (let i = 0; i < 20; i++) {
    r.goOnline();
    r.advance(400);
    r.goOffline();
  }
  assert.equal(r.st.retries, 0, "never stable long enough: no request at all");
  assert.equal(r.timers.size, 0, "nothing left pending");
  r.goOnline();
  r.advance(1500);
  assert.equal(r.st.retries, 1, "one request once the connection holds");
  // 'online' events repeated without an offline in between do not restart a second request.
  r.goOnline();
  r.goOnline();
  r.advance(5000);
  assert.equal(r.st.retries, 1);
});

test("only the offline failure retries: a card that is not in that state never fires", () => {
  const r = rig({ failed: false });
  r.goOnline();
  r.advance(10_000);
  assert.equal(r.st.retries, 0, "provider errors, loaded cards and idle cards are left alone");
  // The state is re-checked when the timer fires (the card recovered meanwhile).
  const q = rig({ failed: true });
  q.goOnline();
  q.st.failed = false;
  q.advance(1500);
  assert.equal(q.st.retries, 0);
});

test("a second offline period gets its own single retry", () => {
  const r = rig();
  r.goOnline();
  r.advance(1500);
  assert.equal(r.st.retries, 1);
  r.goOffline();
  r.goOnline();
  r.advance(1500);
  assert.equal(r.st.retries, 2);
});

test("a card that fails offline after the connection already returned retries once, and only once", () => {
  const r = rig({ failed: false, online: true });
  r.st.failed = true;
  r.ctl.onStateChange();
  r.advance(1500);
  assert.equal(r.st.retries, 1);
  // If that retry fails the same way, it is not retried again until offline -> online.
  r.ctl.onStateChange();
  r.advance(10_000);
  assert.equal(r.st.retries, 1);
});

test("a state change while offline schedules nothing; dispose cancels a pending retry", () => {
  const r = rig();
  r.ctl.onStateChange();
  assert.equal(r.timers.size, 0);
  r.goOnline();
  assert.equal(r.timers.size, 1);
  r.ctl.dispose();
  r.advance(5000);
  assert.equal(r.st.retries, 0);
});

test("the cards use it only for the offline failure; the hook polls nothing", () => {
  for (const f of ["RightNowCard", "TomorrowPreviewCard", "DailyReviewCard"]) {
    const s = read(`src/components/${f}.tsx`);
    assert.match(
      s,
      /useRetryOnReconnect\(!data && error === OFFLINE_AI_MESSAGE, \(\) => void load\(true\)\)/,
      f,
    );
  }
  const brief = read("src/components/AIBriefCard.tsx");
  assert.match(
    brief,
    /useRetryOnReconnect\(\s*isError && error instanceof Error && error\.message === OFFLINE_AI_MESSAGE/,
  );
  assert.match(brief, /refetchOnReconnect: false/, "one request per reconnect, not two");
  const hook = read("src/hooks/use-online.ts");
  assert.doesNotMatch(hook, /setInterval/);
  assert.match(read("src/lib/ai-client.ts"), /export const OFFLINE_AI_MESSAGE = /);
});
