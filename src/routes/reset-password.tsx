import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Moon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — RestPilot AI" },
      { name: "description", content: "Choose a new password for your RestPilot AI account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  // Recovery links now flow through /auth/callback which calls verifyOtp and
  // then navigates here with an active session. Legacy hash-based recovery
  // links (type=recovery) still work.
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const search = typeof window !== "undefined" ? window.location.search : "";
    const hasTypeRecovery = hash.includes("type=recovery") || search.includes("fromRecovery=1");

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setHasRecovery(true);
        setReady(true);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session && hasTypeRecovery) setHasRecovery(true);
      setReady(true);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. You're signed in.");
      navigate({ to: "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col px-5 pt-16 pb-10">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-[var(--shadow-glow)]">
        <Moon className="h-7 w-7" />
      </div>
      <h1 className="mt-5 text-center font-serif text-3xl italic">Reset password</h1>

      {!ready ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : !hasRecovery ? (
        <div className="mt-8 flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">
            This reset link is invalid or has expired. Request a new one from the sign-in screen.
          </p>
          <Link
            to="/auth"
            className="h-12 rounded-2xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
          <label className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-input px-3">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="New password (min. 6 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <label className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-input px-3">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="h-12 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Update password"}
          </button>
        </form>
      )}
    </main>
  );
}
