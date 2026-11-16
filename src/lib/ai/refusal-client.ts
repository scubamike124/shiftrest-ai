// Client side of AI refusals: read a refused response, and tell the user the
// TRUE reason. One helper for every AI surface (Companion, Pilot, Coach, swap,
// dashboard cards, voice commands) so the copy cannot drift apart again.
//
// The reason comes from the server's `code` (src/lib/ai/refusal.ts), never from
// the HTTP status alone: a provider rate limit and a per-minute pause are not
// the user's allowance and never get an upgrade prompt.

import { toast } from "sonner";
import { isNativeApp } from "@/lib/native-app";
import { describeAIRefusal, type AIRefusal } from "./refusal";

export type { AIRefusal } from "./refusal";

/** Read a non-OK AI response. Consumes the body. */
export async function readAIRefusal(resp: Response): Promise<AIRefusal> {
  const body = await resp.json().catch(() => null);
  return describeAIRefusal(resp.status, body, {
    native: isNativeApp(),
    retryAfterHeader: resp.headers.get("retry-after"),
  });
}

/** The one-line text for places that show an error string instead of a toast. */
export function aiRefusalText(refusal: AIRefusal, fallback: string): string {
  if (refusal.kind === "other") return refusal.serverMessage || fallback;
  return refusal.description ? `${refusal.title} ${refusal.description}` : refusal.title;
}

/**
 * Show the refusal as a toast. The Upgrade action appears only for the user's
 * own allowance and never inside the native app (App Store Guideline 3.1.1).
 */
export function toastAIRefusal(refusal: AIRefusal, fallback: string): void {
  if (refusal.kind === "other") {
    toast.error(refusal.serverMessage || fallback);
    return;
  }
  const description = refusal.description ?? undefined;
  toast.error(
    refusal.title,
    !refusal.offerUpgrade || isNativeApp()
      ? { description }
      : {
          description,
          action: {
            label: "Upgrade",
            onClick: () => {
              window.location.href = "/paywall";
            },
          },
        },
  );
}
