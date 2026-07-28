import * as React from "react";
import { render } from "react-email";
import { parseEmailWebhookPayload } from "@lovable.dev/email-js";
import { WebhookError, verifyWebhookRequest } from "@lovable.dev/webhooks-js";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { SignupEmail } from "@/lib/email-templates/signup";
import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
import { RecoveryEmail } from "@/lib/email-templates/recovery";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import { ReauthenticationEmail } from "@/lib/email-templates/reauthentication";

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: "Confirm your email",
  invite: "You've been invited",
  magiclink: "Your login link",
  recovery: "Reset your password",
  email_change: "Confirm your new email",
  reauthentication: "Your verification code",
};

// Template mapping
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
};

// Configuration
const SITE_NAME = "RestPilot AI";
const SENDER_DOMAIN = "notify.restpilotai.com";
const ROOT_DOMAIN = "restpilotai.com";
const FROM_DOMAIN = "notify.restpilotai.com";
const REPLY_TO = "support@restpilotai.com";

function buildBrandedUrl(emailType: string, data: Record<string, unknown>): string {
  const tokenHash = data.token_hash || data.token_hash_new;
  const next =
    emailType === "recovery" ? "/reset-password?fromRecovery=1" : "/dashboard";

  // Prefer hashed-token callback (no raw supabase.co URL in the message).
  if (tokenHash) {
    const params = new URLSearchParams({
      token_hash: String(tokenHash),
      type: emailType === "email_change" ? "email_change" : emailType,
      next,
    });
    return `https://${ROOT_DOMAIN}/auth/callback?${params.toString()}`;
  }

  // Link-style tokens (data.url / data.token) must be consumed via GET
  // /auth/v1/verify, which then redirects with a session hash. Point that
  // redirect at our branded callback — do NOT put the raw OTP on /auth/callback
  // (verifyOtp with long link tokens returns "expired or invalid").
  const raw = String(data.url ?? "");
  if (raw.startsWith("http")) {
    try {
      const u = new URL(raw);
      u.searchParams.set(
        "redirect_to",
        `https://${ROOT_DOMAIN}/auth/callback?next=${encodeURIComponent(next)}`,
      );
      return u.toString();
    } catch {
      return raw;
    }
  }

  // Last resort: synthesize verify URL from token when url is absent.
  const otpToken = data.token;
  if (otpToken) {
    const u = new URL("https://czsgjqfcjiuqirvmdlps.supabase.co/auth/v1/verify");
    u.searchParams.set("token", String(otpToken));
    u.searchParams.set("type", emailType === "email_change" ? "email_change" : emailType);
    u.searchParams.set(
      "redirect_to",
      `https://${ROOT_DOMAIN}/auth/callback?next=${encodeURIComponent(next)}`,
    );
    return u.toString();
  }

  return raw;
}

function redactEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;

        if (!apiKey) {
          console.error("LOVABLE_API_KEY not configured");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        // Verify signature + timestamp, then parse payload.
        let payload: Record<string, unknown>;
        let run_id = "";
        try {
          const verified = await verifyWebhookRequest({
            req: request,
            secret: apiKey,
            parser: parseEmailWebhookPayload,
          });
          payload = verified.payload as unknown as Record<string, unknown>;
          run_id = String(payload.run_id ?? "");
        } catch (error) {
          if (error instanceof WebhookError) {
            switch (error.code) {
              case "invalid_signature":
              case "missing_timestamp":
              case "invalid_timestamp":
              case "stale_timestamp":
                console.error("Invalid webhook signature", { error: error.message });
                return Response.json({ error: "Invalid signature" }, { status: 401 });
              case "invalid_payload":
              case "invalid_json":
                console.error("Invalid webhook payload", { error: error.message });
                return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
            }
          }

          console.error("Webhook verification failed", { error });
          return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
        }

        if (!run_id) {
          console.error("Webhook payload missing run_id");
          return Response.json({ error: "Invalid webhook payload" }, { status: 400 });
        }

        if (payload.version !== "1") {
          console.error("Unsupported payload version", { version: payload.version, run_id });
          return Response.json(
            { error: `Unsupported payload version: ${payload.version}` },
            { status: 400 },
          );
        }

        // The email action type is in payload.data.action_type (e.g., "signup", "recovery")
        // payload.type is the hook event type ("auth")
        const data = (payload.data ?? {}) as Record<string, any>;
        const emailType = String(data.action_type ?? "");
        console.log("Received auth event", {
          emailType,
          email_redacted: redactEmail(data.email),
          run_id,
        });

        const EmailTemplate = EMAIL_TEMPLATES[emailType];
        if (!EmailTemplate) {
          console.error("Unknown email type", { emailType, run_id });
          return Response.json({ error: `Unknown email type: ${emailType}` }, { status: 400 });
        }

        // Build template props from payload.data (HookData structure).
        // Rewrite the confirmation URL to our branded /auth/callback handler
        // so recipients never see raw supabase.co links (Gmail flags mismatches).
        const brandedUrl = buildBrandedUrl(emailType, data);
        const templateProps = {
          siteName: SITE_NAME,
          siteUrl: `https://${ROOT_DOMAIN}`,
          recipient: data.email,
          confirmationUrl: brandedUrl,
          token: data.token,
          email: data.email,
          oldEmail: data.old_email,
          newEmail: data.new_email,
        };

        // Render React Email to HTML and plain text
        const element = React.createElement(EmailTemplate, templateProps);
        const html = await render(element);
        const text = await render(element, { plainText: true });

        // Enqueue email for async processing by the dispatcher (process-email-queue).
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error("Missing Supabase environment variables");
          return Response.json({ error: "Server configuration error" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const messageId = crypto.randomUUID();

        // Log pending BEFORE enqueue so we have a record even if enqueue crashes
        await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: emailType,
          recipient_email: data.email,
          status: "pending",
        });

        const { error: enqueueError } = await supabase.rpc("enqueue_email", {
          queue_name: "auth_emails",
          payload: {
            run_id,
            message_id: messageId,
            to: data.email,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            reply_to: REPLY_TO,
            sender_domain: SENDER_DOMAIN,
            subject: EMAIL_SUBJECTS[emailType] || "Notification",
            html,
            text,
            purpose: "transactional",
            label: emailType,
            queued_at: new Date().toISOString(),
          },
        });

        if (enqueueError) {
          console.error("Failed to enqueue auth email", { error: enqueueError, run_id, emailType });
          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: emailType,
            recipient_email: data.email,
            status: "failed",
            error_message: "Failed to enqueue email",
          });
          return Response.json({ error: "Failed to enqueue email" }, { status: 500 });
        }

        console.log("Auth email enqueued", {
          emailType,
          email_redacted: redactEmail(data.email),
          run_id,
        });

        return Response.json({ success: true, queued: true });
      },
    },
  },
});
