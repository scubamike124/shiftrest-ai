// Public contact form endpoint. Validates input, applies layered spam
// protection (honeypot + min-time-to-submit + per-IP rate limit + light
// content heuristics), records the message, sends the user a branded
// confirmation, and pages the owner.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/api/ratelimit.server";

const ContactSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().max(255),
  subject: z.string().max(200).optional(),
  message: z.string().min(4).max(4000),
  // Honeypot — bots fill hidden fields; humans don't.
  hp: z.string().max(0).optional(),
  // Milliseconds between form render and submit. Bots typically post in <1s.
  elapsedMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).optional(),
});

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MIN_ELAPSED_MS = 3000;

// Light heuristic content filter. Intentionally conservative to avoid
// blocking legitimate operator messages that happen to include a URL.
function looksLikeSpam(input: { subject?: string; message: string; name?: string }): boolean {
  const haystack = `${input.subject ?? ""}\n${input.message}\n${input.name ?? ""}`;
  const lower = haystack.toLowerCase();

  // Too many links — real support messages rarely need more than 2.
  const urlMatches = haystack.match(/\bhttps?:\/\/|www\./gi) ?? [];
  if (urlMatches.length > 3) return true;

  // BBCode / raw HTML anchors — classic forum-spam signature.
  if (/\[url=|<a\s+href=/i.test(haystack)) return true;

  // Payload with mostly links (link density > 30% of message chars).
  const linkChars = (haystack.match(/https?:\/\/\S+/gi) ?? []).join("").length;
  if (haystack.length > 40 && linkChars / haystack.length > 0.3) return true;

  // Small keyword blocklist for the most common promotional spam.
  const banned = [
    "viagra",
    "cialis",
    "porn",
    "xxx sex",
    "casino",
    "crypto giveaway",
    "forex signals",
    "buy followers",
    "seo backlinks",
    "cheap loans",
    "make money fast",
    "work from home earn",
  ];
  if (banned.some((w) => lower.includes(w))) return true;

  // Repeated identical character runs (e.g. "aaaaaaaaaaaaaaa") — bot filler.
  if (/(.)\1{15,}/.test(input.message)) return true;

  return false;
}

export const Route = createFileRoute("/api/public/contact")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const remoteIp =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown";

        // Per-IP rate limit: at most 5 successful *attempts* every 15 min.
        // Applied before parse so garbage floods also count.
        const limited = await enforceRateLimit(remoteIp, {
          bucket: "contact",
          limit: 5,
          windowSec: 15 * 60,
        });
        if (limited) return limited;

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

        // Min-time-to-submit. If the client didn't send elapsedMs we allow it
        // (older clients, JS timing quirks) — the other layers still apply.
        if (
          typeof parsed.data.elapsedMs === "number" &&
          parsed.data.elapsedMs < MIN_ELAPSED_MS
        ) {
          return jsonError(400, "too_fast");
        }

        const { name, email, subject, message } = parsed.data;

        if (looksLikeSpam({ name, subject, message })) {
          return jsonError(400, "spam_detected");
        }

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
            meta: { from: email, name, subject, body: message, ip: remoteIp },
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
