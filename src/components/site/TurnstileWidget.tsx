import { useEffect, useRef } from "react";

// Minimal Cloudflare Turnstile widget wrapper.
// Renders nothing when VITE_TURNSTILE_SITE_KEY is not configured, so the
// contact form remains functional in dev/preview environments without keys.

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback?: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          appearance?: "always" | "execute" | "interaction-only";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    __turnstileLoading?: Promise<void>;
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (window.__turnstileLoading) return window.__turnstileLoading;
  window.__turnstileLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile_script_failed"));
    document.head.appendChild(s);
  });
  return window.__turnstileLoading;
}

export function isTurnstileEnabled(): boolean {
  return typeof SITE_KEY === "string" && SITE_KEY.length > 0;
}

interface Props {
  onToken: (token: string | null) => void;
  theme?: "light" | "dark" | "auto";
}

export function TurnstileWidget({ onToken, theme = "auto" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isTurnstileEnabled() || !ref.current) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(ref.current, {
          sitekey: SITE_KEY!,
          theme,
          callback: (token: string) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => {
        // Script failed to load — don't block the form. Server will fail-open
        // if TURNSTILE_SECRET_KEY is unset, or reject if it is set.
        onToken(null);
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* noop */
        }
      }
    };
  }, [onToken, theme]);

  if (!isTurnstileEnabled()) return null;
  return <div ref={ref} className="mt-2" />;
}
