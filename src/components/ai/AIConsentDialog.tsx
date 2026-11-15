// One-time, explicit permission to share personal data with third-party AI
// providers (App Store Review Guideline 5.1.2(i)). Opened by aiFetch() /
// ensureAIConsent() before the first AI request, and from Profile → Privacy.
// Mounted once in __root.tsx.

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AI_CONSENT_PROVIDERS } from "@/lib/ai/consent";
import {
  registerAIConsentApi,
  resolveAIConsentDialog,
  setAIConsent,
  useAIConsent,
} from "@/lib/ai/consent-client";
import { getAIConsentFn, setAIConsentFn } from "@/lib/ai/consent.functions";

registerAIConsentApi({
  get: () => getAIConsentFn(),
  set: (data) => setAIConsentFn({ data }),
});

export function AIConsentProviderList({ compact = false }: { compact?: boolean }) {
  return (
    <ul className="flex flex-col gap-3">
      {AI_CONSENT_PROVIDERS.map((p) => (
        <li key={p.name} className="rounded-xl border border-border bg-card/60 p-3 text-left">
          <p className="text-sm font-semibold text-foreground">{p.name}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/80">What is sent: </span>
            {p.what}
          </p>
          {!compact && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">Why: </span>
              {p.why}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AIConsentDialog() {
  const { dialogOpen, status } = useAIConsent();
  const [saving, setSaving] = useState(false);
  const open = dialogOpen && status !== "signed_out";

  async function allow() {
    setSaving(true);
    try {
      await setAIConsent(true, "dialog");
      resolveAIConsentDialog(true);
      toast.success("AI features are on. You can turn them off in Profile → Privacy.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your choice. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function notNow() {
    resolveAIConsentDialog(false);
  }

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        // While "Allow" is saving, ignore Escape / outside clicks so the
        // request that opened the dialog isn't dropped after consent is given.
        if (!o && open && !saving) notNow();
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-[70] bg-black/80" />
        <AlertDialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[70] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-background p-5 shadow-lg"
          aria-describedby="ai-consent-description"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <AlertDialogPrimitive.Title className="text-lg font-semibold">
              Allow AI features?
            </AlertDialogPrimitive.Title>
          </div>
          <AlertDialogPrimitive.Description
            id="ai-consent-description"
            className="text-sm leading-relaxed text-muted-foreground"
          >
            RestPilot's coach, voice, briefings and insights are powered by third-party AI services.
            To use them, RestPilot sends some of your personal data to these providers each time you
            use an AI feature:
          </AlertDialogPrimitive.Description>

          <AIConsentProviderList />

          <p className="text-xs leading-relaxed text-muted-foreground">
            RestPilot sends only what the feature you're using needs. A typed message that looks like a
            crisis is never sent to AI: you'll see support on your device instead. Voice is
            different: your audio goes to the voice provider as you speak. We don't sell your data or use
            it for advertising. Without AI, your schedule, sleep plan and reminders still work. You
            can change this anytime in Profile → Privacy. Read our{" "}
            <Link
              to="/legal/privacy"
              hash="ai-providers"
              className="text-primary underline"
              onClick={notNow}
            >
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link to="/legal/third-parties" className="text-primary underline" onClick={notNow}>
              list of providers
            </Link>
            .
          </p>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel
              className="h-11 rounded-xl border border-border px-4 text-sm font-semibold"
              disabled={saving}
            >
              Not now
            </AlertDialogPrimitive.Cancel>
            <button
              type="button"
              className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              disabled={saving}
              onClick={allow}
            >
              {saving ? "Saving…" : "Allow"}
            </button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
