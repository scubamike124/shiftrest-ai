import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { BottomNav } from "../components/BottomNav";
import { SiteHeader } from "../components/site/SiteHeader";
import { SiteFooter } from "../components/site/SiteFooter";
import { AppSidebar } from "../components/site/AppSidebar";
import { CompanionDock } from "../components/companion/CompanionDock";
import { DebugHUD } from "../components/companion/DebugHUD";
import { Onboarding } from "../components/Onboarding";
import { Toaster } from "../components/ui/sonner";
import { CookieBanner } from "../components/legal/CookieBanner";
import { UpdateBanner } from "../components/pwa/UpdateBanner";
import { PreviewWarningBanner } from "../components/pwa/PreviewWarningBanner";
import { scheduleNextWindDown } from "../lib/notify";
import { migrateLocalShiftsIfNeeded } from "../lib/shifts";
import { migrateLocalPrefsIfNeeded } from "../lib/prefs";
import { ensureDefaultEmployer } from "../lib/employers";
import { installDebugNetworkProbe } from "@/lib/companion/debug-bus";
import { useSession } from "@/hooks/use-session";

const LOVABLE_PUBLISH_MARKER = "publish-verify-marker-2026-07-06-alpha7q3";
if (typeof window !== "undefined") (window as unknown as Record<string, string>).__LOVABLE_PUBLISH_MARKER = LOVABLE_PUBLISH_MARKER;
const MARKETING_ROUTES = new Set(["/", "/pricing", "/features", "/privacy", "/terms"]);
const MARKETING_PREFIXES = ["/legal"];
const BARE_ROUTES = ["/auth", "/reset-password", "/share"];
const BARE_PREFIXES = ["/lab"];

function surfaceFor(pathname: string): "marketing" | "app" | "bare" {
  if (BARE_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return "bare";
  if (BARE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return "bare";
  if (MARKETING_ROUTES.has(pathname)) return "marketing";
  if (MARKETING_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return "marketing";
  return "app";
}



function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. Try refreshing.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0b1020" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "RestPilot" },
      { name: "mobile-web-app-capable", content: "yes" },
      { title: "RestPilot AI — Sleep Optimizer for Shift Workers" },
      { name: "description", content: "Plan your shifts and unlock restful sleep with AI-guided wind-down and sleep windows tailored to your schedule." },
      { property: "og:title", content: "RestPilot AI — Sleep Optimizer for Shift Workers" },
      { property: "og:description", content: "Plan your shifts and unlock restful sleep with AI-guided wind-down and sleep windows tailored to your schedule." },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "RestPilot AI — Sleep Optimizer for Shift Workers" },
      { name: "twitter:description", content: "Plan your shifts and unlock restful sleep with AI-guided wind-down and sleep windows tailored to your schedule." },
      // og:image / twitter:image live on leaf routes only — root head() concatenates
      // into every match and would override every page's share preview.
      { name: "twitter:card", content: "summary_large_image" },
    ],
    styles: [
      {
        children:
          '#lovable-badge,[id="lovable-badge"],a[href*="lovable.dev"]{display:none!important;visibility:hidden!important;pointer-events:none!important}',
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16.png" },
      // Fonts are self-hosted via @fontsource imports in src/router.tsx —
      // no external stylesheet, no render-blocking round-trip.
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const surface = surfaceFor(pathname);
  const { ready: authReady, hasSession, hasAccessToken } = useSession();
  const signedIn = authReady && hasSession && hasAccessToken;

  installDebugNetworkProbe();

  useEffect(() => {
    let cancelled = false;
    async function registerPwa() {
      // Single guarded registrar; refuses in dev/preview/iframe and
      // unregisters stale workers in those contexts. On production
      // origins this activates BOTH app-shell caching and push handlers
      // from the same /sw.js file.
      const { registerAppShell } = await import("@/lib/pwa/register");
      await registerAppShell();
    }
    registerPwa();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrapAuthed() {
      if (!signedIn) return;
      await Promise.all([migrateLocalShiftsIfNeeded(), migrateLocalPrefsIfNeeded()]);
      if (cancelled) return;
      await ensureDefaultEmployer();
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      queryClient.invalidateQueries({ queryKey: ["prefs"] });
      queryClient.invalidateQueries({ queryKey: ["employers"] });
      queryClient.invalidateQueries({ queryKey: ["coach-history"] });
      // Trial/verification chrome reads from this key — invalidate so a fresh
      // sign-in / just-verified session refreshes across every screen.
      queryClient.invalidateQueries({ queryKey: ["subscription-state"] });
      await scheduleNextWindDown();
    }
    bootstrapAuthed();
    return () => {
      cancelled = true;
    };
  }, [queryClient, signedIn]);

  // Signed-in users belong on the dashboard, not the marketing homepage.
  // Soft client-side redirect — keeps SSR/marketing intact for logged-out visitors.
  useEffect(() => {
    if (signedIn && pathname === "/") {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [signedIn, pathname, navigate]);

  // Cross-tab session sync: if another tab verifies / signs in / signs out,
  // the Supabase SDK writes the new session to localStorage under a
  // sb-<project>-auth-token key. We invalidate the trial/billing cache so
  // every tab reflects the fresh state without a manual refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (!event.key || !event.key.startsWith("sb-") || !event.key.endsWith("-auth-token")) return;
      queryClient.invalidateQueries({ queryKey: ["subscription-state"] });
      queryClient.invalidateQueries({ queryKey: ["prefs"] });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [queryClient]);


  return (
    <QueryClientProvider client={queryClient}>
      <PreviewWarningBanner />
      {surface === "marketing" && (
        <div className="flex min-h-dvh flex-col">
          <SiteHeader signedIn={signedIn} />
          <main className="flex-1">
            <Outlet />
          </main>
          <SiteFooter />
        </div>
      )}

      {surface === "app" && (
        <div className="flex min-h-dvh w-full overflow-x-clip">
          <AppSidebar />
          <div className="flex min-h-dvh min-w-0 flex-1 flex-col overflow-x-clip pb-24 lg:pb-0">
            <div className="mx-auto w-full max-w-[480px] px-4 sm:max-w-2xl sm:px-6 lg:max-w-5xl lg:px-8">
              <Outlet />
            </div>
          </div>
          <BottomNav />
          <CompanionDock />
        </div>
      )}

      {surface === "bare" && (
        <div className="min-h-dvh">
          <Outlet />
        </div>
      )}

      {surface === "app" && authReady && signedIn && <Onboarding />}
      <DebugHUD
        signedIn={authReady ? signedIn : null}
        companionOn={false}
        prefsLoaded={false}
        micState="root"
        voiceStatus="root"
        orbState={pathname}
        greetShown={false}
      />
      <CookieBanner />
      <UpdateBanner />
      <Toaster />
    </QueryClientProvider>
  );
}

