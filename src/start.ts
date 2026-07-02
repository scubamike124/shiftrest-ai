import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
// Use hardened attacher; the auto-generated one is single-shot and races
// session hydration on iOS Safari (see auth-attacher.custom.ts).
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher.custom";

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

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));
