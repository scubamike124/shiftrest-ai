import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Moon, Mail, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { recordAcceptanceFn } from "@/lib/legal/consent.functions";

const SIGNUP_DOCS = ["terms", "privacy", "disclaimers", "safety", "electronic-consent"];

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    return: typeof search.return === "string" ? search.return : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign In — RestPilot AI" },
      { name: "description", content: "Sign in or create your RestPilot AI account." },
    ],
  }),
  component: AuthPage,
});

// Only allow same-origin, in-app return targets.
const SAFE_RETURNS = new Set([
  "/",
  "/dashboard",
  "/paywall",
  "/profile",
  "/plan",
  "/coach",
  "/playbooks",
  "/swap",
  "/share",
  "/events",
]);

function resolveReturn(raw: string | undefined): string {
  // Signed-in users belong on the dashboard, not the marketing homepage.
  if (!raw) return "/dashboard";
  if (!raw.startsWith("/")) return "/dashboard";
  const path = raw.split("?")[0].split("#")[0];
  return SAFE_RETURNS.has(path) ? raw : "/dashboard";
}

function AuthPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const returnTo = resolveReturn(search.return);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);

  useEffect(() => {
    setIsInIframe(typeof window !== "undefined" && window.self !== window.top);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: returnTo as never });
    });
  }, [navigate, returnTo]);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !accepted) {
      toast.error("Please accept the Terms, Privacy, and disclaimers to continue.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        // Record acceptance once the session exists. If email confirmation is on,
        // this runs after the user confirms and lands back on /auth.
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session) {
            await recordAcceptanceFn({
              data: { documents: SIGNUP_DOCS, source: "signup" },
            });
          }
        } catch (logErr) {
          console.error("acceptance log failed", logErr);
        }
        toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back.");
        navigate({ to: returnTo as never });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "We couldn't sign you in. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: "google" | "apple") {
    setLoading(true);
    try {
      // Bring the OAuth user back to the auth page with the same `return` param;
      // the useEffect above will forward them to the intended destination once
      // the Supabase session has hydrated.
      const callback = `${window.location.origin}/auth${
        returnTo !== "/" ? `?return=${encodeURIComponent(returnTo)}` : ""
      }`;
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: callback,
      });
      if (result.error) {
        toast.error(result.error.message ?? "We couldn't sign you in. Please try again.");
        return;
      }
      if (result.redirected) return;
      navigate({ to: returnTo as never });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't sign you in. Please try again.");
    } finally {
      setLoading(false);
    }
  }


  return (
    <main className="flex min-h-[100dvh] flex-col px-5 pt-16 pb-10">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-[var(--shadow-glow)]">
        <Moon className="h-7 w-7" />
      </div>
      <h1 className="mt-5 text-center font-serif text-3xl italic">
        {mode === "signin" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">
        {mode === "signin"
          ? "Sign in to keep your rhythm in sync."
          : "Start your circadian plan in seconds."}
      </p>

      <div className="mt-8 flex flex-col gap-3">
        {/* Apple sign-in is hidden until Apple OAuth is configured in the backend. */}
        <button
          onClick={() => handleOAuth("google")}
          disabled={loading}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-card text-sm font-semibold active:scale-[0.99] disabled:opacity-60"
        >
          <GoogleGlyph /> Continue with Google
        </button>
      </div>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          or email
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
        <label className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-input px-3">
          <Mail className="h-4 w-4 text-muted-foreground" />
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <label className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-input px-3">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            placeholder="Password (min. 6 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        {mode === "signup" && (
          <label className="flex items-start gap-2 rounded-xl border border-border bg-card/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <Checkbox
              checked={accepted}
              onCheckedChange={(v) => setAccepted(v === true)}
              className="mt-0.5"
            />
            <span>
              I am 16 or older and agree to the{" "}
              <Link to="/legal/terms" className="text-primary underline">Terms</Link>,{" "}
              <Link to="/legal/privacy" className="text-primary underline">Privacy</Link>,{" "}
              <Link to="/legal/disclaimers" className="text-primary underline">AI &amp; Health Disclaimers</Link>,{" "}
              <Link to="/safety" className="text-primary underline">Safety Center</Link>, and{" "}
              <Link to="/legal/electronic-consent" className="text-primary underline">Electronic Consent</Link>. RestPilot AI is not medical advice or an emergency service.
            </span>
          </label>
        )}
        <button
          type="submit"
          disabled={loading || (mode === "signup" && !accepted)}
          className="h-12 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-60"
        >
          {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>
      </form>

      {mode === "signin" && (
        <button
          type="button"
          onClick={async () => {
            if (!email) {
              toast.error("Enter your email first, then tap Forgot Password.");
              return;
            }
            try {
              await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
              });
              toast.success("If that email exists, a reset link is on the way.");
            } catch (err) {
              toast.error(
                err instanceof Error ? err.message : "We couldn't send the reset email. Please try again.",
              );
            }
          }}
          className="mt-3 text-center text-xs text-primary underline-offset-4 hover:underline"
        >
          Forgot Password?
        </button>
      )}

      <button
        onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
        className="mt-5 text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        {mode === "signin"
          ? "New here? Create an account"
          : "Already have an account? Sign In"}
      </button>



      <p className="mt-auto pt-8 text-center text-[10px] text-muted-foreground/70">
        By continuing, you agree to our{" "}
        <Link to="/legal/terms" className="text-primary underline">Terms</Link>,{" "}
        <Link to="/legal/privacy" className="text-primary underline">Privacy</Link>, and{" "}
        <Link to="/legal/disclaimers" className="text-primary underline">Disclaimers</Link>.
      </p>
    </main>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
