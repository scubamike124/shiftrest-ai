import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  getEntitlementStatus,
  syncMyStoreEntitlement,
  type EntitlementStatus,
} from "@/lib/entitlements/entitlement.functions";
import { decidePaywall, type ManagePath } from "@/lib/entitlements/paywall-policy";
import type { Entitlement, EntitlementSource } from "@/lib/entitlements/merge";
import type { AppStorePlan, RevenueCatPackage } from "@/lib/entitlements/revenuecat";
import {
  currentSurface,
  getStorefront,
  iapAvailable,
  identify,
  loadPackages,
  purchase,
  restore,
  usExternalLinkFlagEnabled,
} from "@/lib/entitlements/iap-bridge";

// In-app subscription screen for the iOS app shell (only rendered when
// VITE_IAP_ENABLED is on and the page runs inside the native app; see
// AppAwarePaywall). It never renders Stripe checkout. A link to the website is
// rendered only where decidePaywall() allows it (US storefront + its own flag).

const WEBSITE = "https://restpilotai.com";
const PLAN_LABEL: Record<AppStorePlan, string> = { monthly: "Monthly", annual: "Annual" };
const CADENCE: Record<AppStorePlan, string> = { monthly: "month", annual: "year" };

type Packages = Partial<Record<AppStorePlan, RevenueCatPackage>>;

function formatDate(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toLocaleDateString();
}

function StatusCard({ entitlement }: { entitlement: Entitlement }) {
  const plan =
    entitlement.plan === "lifetime"
      ? "Lifetime"
      : entitlement.plan
        ? PLAN_LABEL[entitlement.plan]
        : "Premium";
  const until = formatDate(entitlement.expiresAt);
  const detail =
    entitlement.state === "lifetime"
      ? "Lifetime access — thank you for being a Founding Member."
      : entitlement.willRenew && until
        ? `${entitlement.state === "trialing" ? "Free trial · first charge" : "Renews"} on ${until}`
        : until
          ? `Access continues until ${until}. It will not renew.`
          : "Active";
  return (
    <section className="rounded-2xl border border-primary/30 bg-primary/10 p-5" aria-live="polite">
      <p className="text-sm font-semibold">
        RestPilot Premium · {plan}
        {entitlement.state === "trialing" ? " (free trial)" : ""}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </section>
  );
}

function ManageRow({
  source,
  path,
  appleUrl,
}: {
  source: EntitlementSource;
  path: ManagePath;
  appleUrl: string | null;
}) {
  if (source === "apple") {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold">Billed by Apple</p>
        <p className="mt-1 text-muted-foreground">
          Change or cancel in Settings → your name → Subscriptions, or below. Cancel at least 24
          hours before renewal to avoid the next charge.
        </p>
        <a
          href={appleUrl ?? "https://apps.apple.com/account/subscriptions"}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border border-border px-5 font-semibold"
        >
          Manage subscription
        </a>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border bg-card p-4 text-sm">
      <p className="font-semibold">Billed through the RestPilot website</p>
      {path === "stripe_portal" ? (
        <>
          <p className="mt-1 text-muted-foreground">
            Your website subscription works here too. Change or cancel it in your account on the
            website.
          </p>
          <a
            href={`${WEBSITE}/profile`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-full border border-border px-5 font-semibold"
          >
            Manage on restpilotai.com
          </a>
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">
          Your website subscription works here too. To change or cancel it, sign in to your account
          on the RestPilot website.
        </p>
      )}
    </div>
  );
}

function PurchaseTerms() {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4 text-[11px] leading-relaxed text-muted-foreground">
      <p className="font-semibold text-foreground">Billing &amp; renewal</p>
      <ul className="mt-2 list-disc space-y-1 pl-4">
        <li>
          Payment is charged to your Apple Account at confirmation of purchase, or when an eligible
          free trial ends.
        </li>
        <li>
          The subscription renews automatically at the price shown unless it is canceled at least 24
          hours before the end of the current period.
        </li>
        <li>
          Manage or cancel any time in Settings → your name → Subscriptions. Access continues to the
          end of the paid period.
        </li>
        <li>
          See the{" "}
          <Link to="/legal/terms" className="text-primary underline">
            Terms of Use
          </Link>
          ,{" "}
          <Link to="/legal/subscription" className="text-primary underline">
            Subscription Terms
          </Link>{" "}
          and{" "}
          <Link to="/legal/privacy" className="text-primary underline">
            Privacy Policy
          </Link>
          .
        </li>
      </ul>
    </div>
  );
}

export function NativeSubscription() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<EntitlementStatus | null>(null);
  const [storefront, setStorefront] = useState<string | null>(null);
  const [packages, setPackages] = useState<Packages>({});
  // The App Store SDK must be identified as THIS user before Buy or Restore,
  // or a purchase could attach to a previously signed-in account.
  const [storeUser, setStoreUser] = useState<string | null>(null);
  const [plansState, setPlansState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState<null | "purchase" | "restore">(null);
  const [message, setMessage] = useState<string | null>(null);
  const canIap = iapAvailable();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, session) =>
      setUserId(session?.user.id ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  const [plansAttempt, setPlansAttempt] = useState(0);
  const refresh = useCallback(async () => {
    setStatus(null);
    try {
      setStatus(await getEntitlementStatus());
    } catch {
      setStatus({ error: "Subscription status is unavailable. Please try again." });
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    void refresh();
    setStoreUser(null);
    setPackages({});
    setPlansState("loading");
    if (!canIap) return;
    let current = true;
    (async () => {
      try {
        await identify(userId);
        if (!current) return;
        setStoreUser(userId);
        setStorefront(await getStorefront());
        const loaded = await loadPackages();
        if (!current) return;
        setPackages(loaded);
        setPlansState("ready");
      } catch {
        if (current) setPlansState("error");
      }
    })();
    return () => {
      current = false;
    };
  }, [userId, canIap, refresh, plansAttempt]);

  if (userId === undefined)
    return <p className="px-5 py-16 text-center text-muted-foreground">Loading…</p>;
  if (userId === null) {
    return (
      <section className="mx-auto w-full max-w-xl px-5 py-16">
        <h1 className="text-3xl font-semibold">RestPilot Premium</h1>
        <p className="mt-4 text-muted-foreground">
          Sign in first so your subscription is linked to your RestPilot account on every device.
        </p>
        <Link
          to="/auth"
          search={{ return: "/paywall" }}
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-primary px-6 font-semibold text-primary-foreground"
        >
          Sign in
        </Link>
      </section>
    );
  }

  const entitlement = status && "entitlement" in status ? status.entitlement : null;
  const decision = decidePaywall({
    surface: currentSurface(),
    iapAvailable: canIap,
    storefront,
    usExternalLinkEnabled: usExternalLinkFlagEnabled(),
    webCheckoutEnabled: false,
    entitlement,
  });

  async function afterStoreChange(note: string) {
    try {
      const next = await syncMyStoreEntitlement();
      if ("error" in next) {
        // Keep showing the plan (e.g. a throttled sync); re-read status without syncing.
        setMessage(next.error);
        setStatus(await getEntitlementStatus());
        return;
      }
      setStatus(next);
      setMessage(note);
    } catch {
      setMessage("Couldn't confirm with the App Store yet. Tap Restore purchases in a minute.");
    }
  }

  async function onBuy(plan: AppStorePlan) {
    const pkg = packages[plan];
    if (!pkg || busy || !userId || storeUser !== userId) return;
    setBusy("purchase");
    setMessage(null);
    try {
      // Double-billing guard: re-check right before opening the App Store sheet.
      const latest = await getEntitlementStatus();
      if (!("entitlement" in latest) || latest.entitlement.active) {
        setStatus(latest);
        setMessage("error" in latest ? latest.error : "You already have RestPilot Premium.");
        return;
      }
      await identify(userId); // no-op when already this user; never buy as someone else
      const result = await purchase(pkg);
      if (result === "cancelled") return;
      await afterStoreChange("Thank you — RestPilot Premium is active.");
    } catch {
      setMessage(
        "The purchase didn't complete. You have not been charged by RestPilot for this attempt.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function onRestore() {
    if (busy || !userId || storeUser !== userId) return;
    setBusy("restore");
    setMessage(null);
    try {
      await identify(userId);
      await restore();
      await afterStoreChange("Purchases restored.");
    } catch {
      setMessage("Restore didn't complete. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const appleUrl = status && "entitlement" in status ? status.appleManagementUrl : null;
  const plans = (["monthly", "annual"] as const).filter((p) => packages[p]);

  return (
    <section
      aria-label="RestPilot Premium"
      className="mx-auto flex w-full max-w-xl flex-col gap-5 px-5 py-12"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          RestPilot Premium
        </p>
        <h1 className="mt-3 text-3xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
          Your plan
        </h1>
      </header>

      {status && "error" in status && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm">
          <p>{status.error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 min-h-11 rounded-full border border-border px-5 font-semibold"
          >
            Try again
          </button>
        </div>
      )}

      {decision.view === "loading" && !(status && "error" in status) && (
        <p className="text-muted-foreground" aria-live="polite">
          Checking your subscription…
        </p>
      )}

      {decision.view === "status" && entitlement && (
        <>
          <StatusCard entitlement={entitlement} />
          {decision.duplicateBillingWarning && (
            <p
              role="alert"
              className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm"
            >
              You have more than one renewing RestPilot subscription. Cancel one of them below so
              you are not charged twice.
            </p>
          )}
          {decision.manage.map((m) => (
            <ManageRow key={m.source} source={m.source} path={m.path} appleUrl={appleUrl} />
          ))}
        </>
      )}

      {decision.view === "purchase" &&
        (plansState === "loading" ? (
          <p className="text-muted-foreground" aria-live="polite">
            Loading plans…
          </p>
        ) : plansState === "error" || plans.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            <p>Subscriptions are not available right now.</p>
            <button
              type="button"
              onClick={() => setPlansAttempt((n) => n + 1)}
              className="mt-3 min-h-11 rounded-full border border-border px-5 font-semibold text-foreground"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="grid gap-3">
              {plans.map((plan) => {
                const product = packages[plan]!.product;
                const freeTrial = product.introPrice?.price === 0;
                return (
                  <button
                    key={plan}
                    type="button"
                    disabled={busy !== null || storeUser !== userId}
                    onClick={() => void onBuy(plan)}
                    className="flex min-h-16 flex-col items-start rounded-2xl border border-border bg-card p-4 text-left disabled:opacity-60"
                  >
                    <span className="font-semibold">
                      {PLAN_LABEL[plan]} · {product.priceString ?? ""} / {CADENCE[plan]}
                    </span>
                    {freeTrial && (
                      <span className="text-xs text-primary">
                        14-day free trial for eligible new subscribers, then {product.priceString} /{" "}
                        {CADENCE[plan]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <PurchaseTerms />
            {decision.externalPurchaseLink && (
              <a
                href={`${WEBSITE}/pricing`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary underline"
              >
                Subscribe on restpilotai.com instead
              </a>
            )}
          </>
        ))}

      {decision.view === "unavailable" && (
        <p className="text-muted-foreground">
          Purchases are not available in this version of the app.
        </p>
      )}

      {decision.restore && decision.view !== "loading" && storeUser === userId && (
        <button
          type="button"
          onClick={() => void onRestore()}
          disabled={busy !== null}
          className="min-h-11 self-start text-sm font-semibold text-primary underline disabled:opacity-60"
        >
          {busy === "restore" ? "Restoring…" : "Restore purchases"}
        </button>
      )}

      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
