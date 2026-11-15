// Which "Continue with …" buttons the sign-in page shows, and where.
//
// App Store Review Guideline 4.8: an app that offers a third-party login
// (Google) must also offer an equivalent privacy-focused one (Sign in with
// Apple). Guideline 2.1: reviewers must not hit a broken button.
//
// Website (any browser):
//   - Google: shown (Lovable-managed OAuth, unchanged).
//   - Apple:  shown when the backend has the Apple provider enabled.
//
// iPhone app shell (Capacitor WKWebView loading restpilotai.com):
//   - Google: never. Google refuses OAuth in embedded web views
//     (`disallowed_useragent`), and the shell sends other hosts to Safari, so
//     the session would never come back to the app.
//   - Apple:  only in a shell build that keeps the Apple sign-in pages inside
//     the web view (`server.allowNavigation` in ios-app/capacitor.config.json:
//     oauth.lovable.app for Lovable's broker, *.supabase.co for Supabase's own
//     OAuth on Railway hosting, appleid.apple.com, and idmsa.apple.com, which
//     Apple uses for two-factor and account recovery). Such a build adds
//     NATIVE_WEB_OAUTH_UA_TOKEN to its
//     User-Agent. Older builds open those pages in Safari, where the session
//     would be lost, so they get email and password only. With neither
//     third-party button in the app, 4.8 does not apply there.

/** Kill switch. Set to false to hide Sign in with Apple everywhere. */
export const APPLE_SIGNIN_ENABLED = true;

/** Added to the User-Agent by app shells that keep OAuth inside the web view. */
export const NATIVE_WEB_OAUTH_UA_TOKEN = "RestPilotWebOAuth/1";

export type OAuthContext = {
  /** Running inside the iPhone/Android app shell. */
  native: boolean;
  /** The shell keeps the OAuth pages in the web view (see NATIVE_WEB_OAUTH_UA_TOKEN). */
  nativeWebOAuth: boolean;
  /** The backend reports the Apple provider as enabled; null while unknown. */
  appleConfigured: boolean | null;
};

export function visibleOAuthProviders(ctx: OAuthContext): { apple: boolean; google: boolean } {
  const apple =
    APPLE_SIGNIN_ENABLED && ctx.appleConfigured === true && (!ctx.native || ctx.nativeWebOAuth);
  const google = !ctx.native;
  return { apple, google };
}

export function hasNativeWebOAuth(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && userAgent.includes(NATIVE_WEB_OAUTH_UA_TOKEN);
}

/** Reads `external.apple` from the public auth settings document. */
export function appleEnabledInSettings(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  const external = (settings as { external?: unknown }).external;
  if (!external || typeof external !== "object") return false;
  return (external as Record<string, unknown>).apple === true;
}

let appleProbe: Promise<boolean> | null = null;

/**
 * Whether the backend has Sign in with Apple enabled, from the public
 * `/auth/v1/settings` endpoint (no user data; the publishable key only).
 * Fails closed: any error hides the button rather than showing one that
 * can't work.
 */
export function probeAppleProvider(
  supabaseUrl: string | undefined,
  publishableKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (appleProbe) return appleProbe;
  if (!supabaseUrl || !publishableKey) return Promise.resolve(false);
  appleProbe = (async () => {
    try {
      const res = await fetchImpl(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, {
        headers: { apikey: publishableKey },
      });
      if (!res.ok) return false;
      return appleEnabledInSettings(await res.json());
    } catch {
      return false;
    }
  })();
  // Let a failed probe be retried on the next page visit.
  appleProbe.then((ok) => {
    if (!ok) appleProbe = null;
  });
  return appleProbe;
}
