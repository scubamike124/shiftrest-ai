// Client side of the AI data-sharing permission (Guideline 5.1.2(i)).
//
// - `aiFetch()` replaces `fetch()` for every call to an AI endpoint. Before
//   the request leaves the device it makes sure the user has allowed AI
//   sharing; if they haven't, it opens the consent dialog (or, for background
//   requests after "Not now", quietly refuses) and the request is never sent.
// - `ensureAIConsent()` does the same for code that doesn't use fetch (the
//   OpenAI Realtime server function).
// - The dialog itself is <AIConsentDialog />, mounted once in __root.tsx.
//
// The server enforces the same rule (consent.server.ts); this layer exists so
// users see a clear question instead of an error, and so nothing is sent while
// the answer is unknown.

import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AI_CONSENT_HEADER,
  AI_CONSENT_REQUIRED_CODE,
  AI_CONSENT_REQUIRED_MESSAGE,
  aiConsentRefusalBody,
} from "./consent";
import type { AIConsentStatus, SetAIConsentInput } from "./consent.functions";

// The server functions are registered by <AIConsentDialog /> (mounted in
// __root.tsx) rather than imported here, so modules that only call aiFetch
// don't pull server-function code into their import graph.
type AIConsentApi = {
  get: () => Promise<AIConsentStatus>;
  set: (input: SetAIConsentInput) => Promise<AIConsentStatus>;
};
let api: AIConsentApi | null = null;
export function registerAIConsentApi(a: AIConsentApi) {
  api = a;
}

export type AIConsentState = {
  /** unknown = not loaded yet (or couldn't be loaded); signed_out = no session. */
  status: "unknown" | "granted" | "denied" | "signed_out";
  userId: string | null;
  grantedAt: string | null;
  dialogOpen: boolean;
};

let state: AIConsentState = { status: "unknown", userId: null, grantedAt: null, dialogOpen: false };
const listeners = new Set<() => void>();
let loading: Promise<AIConsentState> | null = null;
let decision: { promise: Promise<boolean>; resolve: (v: boolean) => void } | null = null;

const DISMISSED_KEY = "restpilot.aiConsent.notNow";

function set(patch: Partial<AIConsentState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribeAIConsent(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getAIConsentState(): AIConsentState {
  return state;
}

const SERVER_STATE: AIConsentState = {
  status: "unknown",
  userId: null,
  grantedAt: null,
  dialogOpen: false,
};

export function useAIConsent(): AIConsentState {
  return useSyncExternalStore(subscribeAIConsent, getAIConsentState, () => SERVER_STATE);
}

function dismissedThisSession(): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function setDismissed(v: boolean) {
  try {
    if (v) sessionStorage.setItem(DISMISSED_KEY, "1");
    else sessionStorage.removeItem(DISMISSED_KEY);
  } catch {
    /* storage blocked: the dialog may simply ask again */
  }
}

function applyStatus(userId: string, s: AIConsentStatus) {
  set({ status: s.granted ? "granted" : "denied", userId, grantedAt: s.grantedAt });
}

/** Loads (or reloads) the signed-in user's permission from the server. */
export async function loadAIConsent(force = false): Promise<AIConsentState> {
  if (typeof window === "undefined") return state;
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id ?? null;
  if (!uid) {
    set({ status: "signed_out", userId: null, grantedAt: null });
    return state;
  }
  if (!force && state.userId === uid && (state.status === "granted" || state.status === "denied")) {
    return state;
  }
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      if (!api) throw new Error("consent API not registered");
      const s = await api.get();
      applyStatus(uid, s);
    } catch (e) {
      // Can't tell: leave it unknown. The server still enforces the rule.
      console.warn("[ai-consent] status load failed", e instanceof Error ? e.message : e);
      set({ status: "unknown", userId: uid, grantedAt: null });
    } finally {
      loading = null;
    }
    return state;
  })();
  return loading;
}

/** Saves the user's choice. Throws when the server couldn't save it. */
export async function setAIConsent(allow: boolean, source: "dialog" | "settings"): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const uid = data.session?.user.id ?? null;
  if (!uid) throw new Error("Sign in to change this setting.");
  if (!api) throw new Error("Couldn't save your choice. Please reload and try again.");
  const s = await api.set({ allow, source });
  applyStatus(uid, s);
  if (allow) setDismissed(false);
}

/** Opens the dialog and resolves with the user's answer. Concurrent callers share one dialog. */
export function requestAIConsent(): Promise<boolean> {
  if (state.status === "granted") return Promise.resolve(true);
  if (decision) return decision.promise;
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  decision = { promise, resolve };
  set({ dialogOpen: true });
  return promise;
}

/** Called by the dialog. `allowed` is true only after the grant was saved. */
export function resolveAIConsentDialog(allowed: boolean) {
  if (!allowed) setDismissed(true);
  set({ dialogOpen: false });
  const d = decision;
  decision = null;
  d?.resolve(allowed);
}

export type EnsureOptions = {
  /** true for something the user just asked for (send a message, tap the mic).
   *  Those always ask. Background requests ask at most once per session. */
  interactive?: boolean;
};

/**
 * Resolves true when an AI request may be sent. Signed-out users and an
 * unknown status pass through: the server answers those (401, or its own
 * consent check), so the client never blocks on a status it couldn't load.
 */
export async function ensureAIConsent(opts: EnsureOptions = {}): Promise<boolean> {
  if (typeof window === "undefined") return true;
  const s = await loadAIConsent();
  if (s.status === "granted" || s.status === "signed_out" || s.status === "unknown") return true;
  if (!opts.interactive && dismissedThisSession()) return false;
  return requestAIConsent();
}

let lastToastAt = 0;
function notifyRefused() {
  const now = Date.now();
  if (now - lastToastAt < 10_000) return;
  lastToastAt = now;
  toast.message("AI features are off", {
    description: "Allow AI data sharing to use the coach, voice, briefings and insights.",
    action: { label: "Review", onClick: () => void requestAIConsent() },
  });
}

/** A Response identical to the server's consent refusal. */
export function aiConsentRefusalResponse(): Response {
  return new Response(JSON.stringify(aiConsentRefusalBody()), {
    status: 403,
    headers: { "Content-Type": "application/json", [AI_CONSENT_HEADER]: "required" },
  });
}

/** True when a response is a consent refusal (from the server or from aiFetch). */
export function isAIConsentRefusal(res: Response | null | undefined): boolean {
  return !!res && res.status === 403 && res.headers.get(AI_CONSENT_HEADER) === "required";
}

/** True when a thrown error is a consent refusal from a server function. */
export function isAIConsentError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return msg.includes(AI_CONSENT_REQUIRED_CODE);
}

/**
 * `fetch()` for AI endpoints, for something the user just asked for (send a
 * message, tap the mic, play a briefing). Without permission it asks first;
 * if the user says no, the request is not sent and a 403 consent refusal is
 * returned instead, so existing error handling keeps working.
 */
export function aiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return aiFetchWith(input, init, { interactive: true });
}

/** Same, for requests the app makes on its own (dashboard cards, prefetch).
 *  Those ask at most once per session; after "Not now" they are refused quietly. */
export function aiFetchBackground(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return aiFetchWith(input, init, { interactive: false });
}

async function aiFetchWith(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  opts: EnsureOptions,
): Promise<Response> {
  const allowed = await ensureAIConsent(opts);
  if (!allowed) {
    notifyRefused();
    return aiConsentRefusalResponse();
  }
  const res = await fetch(input, init);
  if (isAIConsentRefusal(res)) {
    // The server disagrees with our cached state (revoked on another device,
    // or a newer consent version): refresh it and let the user decide.
    set({ status: "denied", grantedAt: null });
    if (opts.interactive || !dismissedThisSession()) void requestAIConsent();
    else notifyRefused();
  }
  return res;
}

export { AI_CONSENT_REQUIRED_MESSAGE };

// Forget the cached answer when the signed-in user changes.
if (typeof window !== "undefined") {
  try {
    supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user.id ?? null;
      if (uid !== state.userId) {
        set({ status: uid ? "unknown" : "signed_out", userId: uid, grantedAt: null });
      }
    });
  } catch {
    /* auth not configured (tests, preview): status loads lazily */
  }
}
