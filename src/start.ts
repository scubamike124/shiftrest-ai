import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
// Use hardened attacher; the auto-generated one is single-shot and races
// session hydration on iOS Safari (see auth-attacher.custom.ts).
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher.custom";

// Content-Security-Policy in REPORT-ONLY mode. Violations are logged to the
// browser console and POSTed to /api/public/csp-report but the policy is
// NOT enforced. This lets us discover any missing origins before flipping
// to enforcing mode. Do NOT rename this header to `Content-Security-Policy`
// until we've watched a full week of report traffic and confirmed no
// unexpected origins.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  // Stripe.js + Lovable preview loader + inline hydration scripts.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.jsdelivr.net https://*.lovable.dev https://*.lovable.app",
  // Tailwind emits inline <style> tags; keep 'unsafe-inline' for now.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  // App renders user-attached images from arbitrary hosts (avatars, share previews).
  "img-src 'self' data: blob: https:",
  // TTS/STT audio + WebRTC media streams.
  "media-src 'self' blob: data: https:",
  [
    "connect-src 'self'",
    // Supabase Data API + Realtime (WSS)
    "https://czsgjqfcjiuqirvmdlps.supabase.co",
    "wss://czsgjqfcjiuqirvmdlps.supabase.co",
    // Stripe
    "https://api.stripe.com",
    "https://m.stripe.com",
    "https://m.stripe.network",
    // ElevenLabs TTS/STT
    "https://api.elevenlabs.io",
    "wss://api.elevenlabs.io",
    // Simli avatar streaming
    "https://api.simli.ai",
    "wss://api.simli.ai",
    // Lovable AI + connector gateways
    "https://ai.gateway.lovable.dev",
    "https://connector-gateway.lovable.dev",
    // ReadyPlayerMe avatar model host
    "https://models.readyplayer.me",
    // OpenAI Realtime (WebRTC + WSS)
    "https://api.openai.com",
    "wss://api.openai.com",
    // Own domains + Lovable preview/publish domains
    "https://restpilotai.com",
    "https://www.restpilotai.com",
    "https://*.lovable.app",
    "https://*.lovable.dev",
  ].join(" "),
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Allow iframing from the Lovable editor preview but nowhere else.
  "frame-ancestors 'self' https://*.lovable.dev https://*.lovable.app",
  "report-uri /api/public/csp-report",
].join("; ");

const errorMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/lovable/") || url.pathname === "/email/unsubscribe") {
    return next();
  }
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    // Page the owner on genuine server exceptions (500s). Runs fire-and-forget
    // so the error page still renders instantly.
    try {
      const { notifyOwner } = await import("@/lib/ops/alert.server");
      void notifyOwner({
        severity: "critical",
        service: "server.unhandled",
        message: error instanceof Error ? error.message : String(error),
        meta: {
          path: url.pathname,
          method: request.method,
          stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
        },
      });
    } catch {
      /* noop */
    }
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Attach CSP-Report-Only to HTML responses only. JSON, images, and other
// asset responses don't need it — the browser only evaluates CSP for the
// document it loaded the page from.
const cspReportOnlyMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const response = result.response;
  const ct = response.headers.get("content-type") ?? "";
  if (ct.includes("text/html") && !response.headers.has("content-security-policy-report-only")) {
    response.headers.set("content-security-policy-report-only", CSP_REPORT_ONLY);
  }
  return result;
});

// Baseline security headers on every response.
const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const headers = result.response.headers;
  headers.set("x-frame-options", "SAMEORIGIN");
  headers.set(
    "permissions-policy",
    "camera=(), geolocation=(), payment=(self), microphone=(self), usb=()",
  );
  headers.set("cross-origin-opener-policy", "same-origin-allow-popups");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  return result;
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, cspReportOnlyMiddleware, securityHeadersMiddleware],
}));
