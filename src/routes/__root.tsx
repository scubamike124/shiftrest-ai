import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { BottomNav } from "../components/BottomNav";
import { Onboarding } from "../components/Onboarding";
import { Toaster } from "../components/ui/sonner";
import { scheduleNextWindDown } from "../lib/notify";
import { migrateLocalShiftsIfNeeded } from "../lib/shifts";
import { migrateLocalPrefsIfNeeded } from "../lib/prefs";
import { supabase } from "@/integrations/supabase/client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
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
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a3091dfa-df8a-49ed-8a47-556f7be1d49f/id-preview-4c7d7f1c--8243527a-2b83-4fe2-aa6d-60b0ae194313.lovable.app-1780413817790.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a3091dfa-df8a-49ed-8a47-556f7be1d49f/id-preview-4c7d7f1c--8243527a-2b83-4fe2-aa6d-60b0ae194313.lovable.app-1780413817790.png" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-512.png" },
      { rel: "icon", type: "image/png", href: "/icon-512.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
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
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      await Promise.all([migrateLocalShiftsIfNeeded(), migrateLocalPrefsIfNeeded()]);
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      queryClient.invalidateQueries({ queryKey: ["prefs"] });
      queryClient.invalidateQueries({ queryKey: ["coach-history"] });
      await scheduleNextWindDown();
    }
    bootstrap();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        bootstrap();
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <div className="mx-auto flex min-h-screen max-w-md flex-col pb-24">
        <Outlet />
      </div>
      <BottomNav />
      <Onboarding />
      <Toaster />
    </QueryClientProvider>
  );
}
