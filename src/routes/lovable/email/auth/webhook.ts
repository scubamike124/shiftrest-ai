import * as React from "react";
import { render } from "react-email";
import { verifyWebhookRequest } from "@/lib/email/webhook.server";
import { createFileRoute } from "@tanstack/react-router";
import { SignupEmail } from "@/lib/email-templates/signup";
import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
import { RecoveryEmail } from "@/lib/email-templates/recovery";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import { ReauthenticationEmail } from "@/lib/email-templates/reauthentication";

import { authDeliveries } from "@/lib/email/auth-payload.server";
import { sendProviderEmail } from "@/lib/email/provider.server";
const EMAIL_SUBJECTS: Record<string, string> = {
  signup: "Confirm your email",
  email: "Confirm your email",
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
  email: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
};

// Path is retained for existing webhook registrations; this handler calls no Lovable service.
export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server:{handlers:{POST:async({request})=>{
    const secret=process.env.SEND_EMAIL_HOOK_SECRET, key=process.env.RESEND_API_KEY;
    const origin=process.env.PUBLIC_APP_URL, from=process.env.EMAIL_FROM;
    if(!secret||!key||!origin||!from)return Response.json({error:"Email service is not configured"},{status:503});
    let verified;
    try {verified=await verifyWebhookRequest({req:request,secret,parser:JSON.parse});}
    catch {return Response.json({error:"Invalid webhook signature or payload"},{status:401});}
    try {
      const base=new URL(origin);
      if(base.protocol!=="https:"||base.username||base.password)throw new Error("Invalid public origin");
      for(const delivery of authDeliveries(verified.payload)) {
        const Template=EMAIL_TEMPLATES[delivery.type];
        if(!Template)throw new Error("Unsupported auth email type");
        const callback=new URL("/auth/callback",base.origin);
        if(delivery.hash)callback.searchParams.set("token_hash",delivery.hash);
        callback.searchParams.set("type",delivery.type);
        callback.searchParams.set("next",delivery.type==="recovery"?"/reset-password?fromRecovery=1":"/dashboard");
        const element=React.createElement(Template,{siteName:"RestPilot AI",siteUrl:base.origin,recipient:delivery.email,
          confirmationUrl:callback.href,token:delivery.token,email:delivery.email,oldEmail:delivery.oldEmail,newEmail:delivery.newEmail});
        const keyBytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${verified.id}:${delivery.email}`));
        const deliveryKey=Array.from(new Uint8Array(keyBytes)).map(b=>b.toString(16).padStart(2,"0")).join("");
        await sendProviderEmail({to:delivery.email,from,subject:EMAIL_SUBJECTS[delivery.type]||"RestPilot notification",
          html:await render(element),text:await render(element,{plainText:true}),
          idempotency_key:`auth-${deliveryKey}`,
        },{apiKey:key});
      }
      return Response.json({});
    } catch {return Response.json({error:"Auth email delivery failed; retry required"},{status:500});}
  }}},
});
