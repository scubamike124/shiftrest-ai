import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type VerifyType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change"
  | "email";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({
    meta: [
      { title: "Verifying — RestPilot AI" },
      { name: "description", content: "Completing your RestPilot AI sign-in." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  
  const [status, setStatus] = useState<"working" | "error">("working");
  const [message, setMessage] = useState("Verifying your link…");

  useEffect(() => {
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get("token_hash");
    const rawType = url.searchParams.get("type") as VerifyType | null;
    const next = url.searchParams.get("next") || "/dashboard";

    if (!tokenHash || !rawType) {
      setStatus("error");
      setMessage("This link is missing required information.");
      return;
    }

    // Recovery flow → send user to reset-password screen after session is set.
    const target =
      rawType === "recovery" ? "/reset-password?fromRecovery=1" : next;

    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: rawType as any })
      .then(({ error }) => {
        if (error) {
          setStatus("error");
          setMessage(
            error.message.includes("expired") || error.message.includes("invalid")
              ? "This link has expired or was already used. Request a new one."
              : error.message,
          );
          return;
        }
        toast.success(
          rawType === "recovery" ? "Verified — set a new password." : "You're signed in.",
        );
        // Use full navigation for the query-string target so TanStack's typed
        // router doesn't reject the raw path.
        window.location.assign(target);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Verification failed.");
      });
  }, [navigate]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-[var(--shadow-glow)]">
        <Moon className="h-7 w-7" />
      </div>
      <h1 className="mt-5 font-serif text-2xl italic">
        {status === "working" ? "Verifying" : "Link problem"}
      </h1>
      <p className="mt-3 max-w-sm text-sm text-muted-foreground">{message}</p>
      {status === "error" ? (
        <a
          href="/auth"
          className="mt-6 h-11 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]"
        >
          Back to sign in
        </a>
      ) : null}
    </main>
  );
}
