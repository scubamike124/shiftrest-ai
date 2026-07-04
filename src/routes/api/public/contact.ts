// Public contact form endpoint. Validates input, records the message,
// sends the user a branded confirmation, and pages the owner.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const ContactSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().max(255),
  subject: z.string().max(200).optional(),
  message: z.string().min(4).max(4000),
  // Simple honeypot — bots fill hidden fields; humans don't.
  hp: z.string().max(0).optional(),
  // Cloudflare Turnstile token. Required only when the server is
  // configured with TURNSTILE_SECRET_KEY (see verifyTurnstile below).
  turnstileToken: z.string().min(10).max(4096).optional(),
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface TurnstileVerifyResult {
  success: boolean;
  "error-codes"?: string[];
}

async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  // Not configured — skip enforcement (fail-open until keys are provisioned).
  if (!secret) return { ok: true };
  if (!token) return { ok: false, reason: "missing_captcha" };

  try {
    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", token);
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
    );
    if (!res.ok) return { ok: false, reason: "captcha_service_error" };
    const data = (await res.json()) as TurnstileVerifyResult;
    if (!data.success) return { ok: false, reason: "invalid_captcha" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "captcha_service_error" };
  }
}

export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return jsonError(400, "invalid_json");
        }

        const parsed = ContactSchema.safeParse(payload);
        if (!parsed.success) return jsonError(400, "invalid_input");

        // Honeypot triggered — respond OK to avoid tipping off the bot.
        if (parsed.data.hp) return Response.json({ ok: true });

        const remoteIp =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          null;

        const captcha = await verifyTurnstile(parsed.data.turnstileToken, remoteIp);
        if (!captcha.ok) return jsonError(400, captcha.reason);

        const { name, email, subject, message } = parsed.data;

        try {
          const [{ sendTransactionalEmailServer }, { notifyOwner }] = await Promise.all([
            import("@/lib/email/send.server"),
            import("@/lib/ops/alert.server"),
          ]);

          // Confirmation to user
          await sendTransactionalEmailServer({
            templateName: "contact-received",
            recipientEmail: email,
            idempotencyKey: `contact-${email}-${Date.now()}`,
            templateData: { name, message },
          });

          // Owner alert (uses ops-alert template — routes to OWNER_ALERT_EMAIL).
          // This is a real notification, not an error, so use "warning" so it
          // still passes dedupe distinct from other messages.
          await notifyOwner({
            severity: "warning",
            service: "contact-form",
            message: `New contact from ${name || email}: ${subject || "(no subject)"}`,
            meta: { from: email, name, subject, body: message },
          });
        } catch (e) {
          console.error("contact form processing failed", e);
          return jsonError(500, "processing_failed");
        }

        return Response.json({ ok: true });
      },
    },
  },
});
