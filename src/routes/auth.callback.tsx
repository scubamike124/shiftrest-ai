import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Moon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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

    const isRecovery = rawType === "recovery";

    (async () => {
      try {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: rawType as any,
        });
        if (error) {
          setStatus("error");
          setMessage(
            error.message.includes("expired") || error.message.includes("invalid")
              ? "This link has expired or was already used. Request a new one."
              : error.message,
          );
          return;
        }

        // Force the SDK to re-fetch the confirmed user + refresh the access
        // token BEFORE we hand off to the destination route. Without this the
        // dashboard can boot with a pre-verify session on iOS PWAs and keep
        // showing "please verify" chrome until the next hard reload.
        try {
          await supabase.auth.getUser();
          await supabase.auth.refreshSession();
        } catch {
          /* non-fatal — auth event listener will still fire */
        }

        // Drop cached "trial / please verify" reads so every screen picks up
        // the freshly-confirmed profile on first paint.
        queryClient.invalidateQueries({ queryKey: ["subscription-state"] });
        queryClient.invalidateQueries({ queryKey: ["prefs"] });
        queryClient.invalidateQueries({ queryKey: ["employers"] });

        toast.success(
          isRecovery ? "Verified — set a new password." : "You're signed in.",
        );

        if (isRecovery) {
          navigate({
            to: "/reset-password",
            search: { fromRecovery: "1" } as any,
            replace: true,
          });
        } else if (next.startsWith("/") && !next.startsWith("//")) {
          navigate({ to: next as any, replace: true });
        } else {
          navigate({ to: "/dashboard", replace: true });
        }
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Verification failed.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              const email = window.prompt("Enter your email to receive a new verification link:");
              if (!email) return;
              const { error } = await supabase.auth.resend({
                type: "signup",
                email: email.trim(),
                options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
              });
              if (error) toast.error(error.message);
              else toast.success("New link sent — check your inbox.");
            }}
            className="h-11 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]"
          >
            Resend verification email
          </button>
          <a
            href="/auth"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            Back to sign in
          </a>
        </div>
      ) : null}

    </main>
  );
}
