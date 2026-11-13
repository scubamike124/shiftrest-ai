import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { type StripeEnv, verifyWebhook, createStripeClient } from "@/lib/stripe.server";
import { sendTransactionalEmailServer } from "@/lib/email/send.server";
import { notifyOwner } from "@/lib/ops/alert.server";

async function getUserEmail(userId: string): Promise<string | null> {
  try {
    const { data } = await getSupabase().auth.admin.getUserById(userId);
    return data.user?.email ?? null;
  } catch (e) {
    console.error("getUserEmail failed", e);
    return null;
  }
}

function formatAmount(cents?: number | null, currency?: string | null): string | undefined {
  if (cents == null) return undefined;
  const cur = (currency || "usd").toUpperCase();
  return `${(cents / 100).toFixed(2)} ${cur}`;
}


let _supabase: SupabaseClient<Database> | null = null;
function getSupabase(): SupabaseClient<Database> {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

function priceLookup(price: any): string {
  return price?.lookup_key || price?.metadata?.lovable_external_id || price?.id || "";
}

async function handleSubscriptionUpsert(sub: any, env: StripeEnv) {
  const userId = sub.metadata?.userId;
  if (!userId) {
    throw new Error("Subscription is missing required userId metadata; reconcile ownership before retrying");
  }
  const item = sub.items?.data?.[0];
  const priceId = priceLookup(item?.price);
  const productId =
    typeof item?.price?.product === "string" ? item.price.product : item?.price?.product?.id;
  const periodStart = item?.current_period_start ?? sub.current_period_start;
  const periodEnd = item?.current_period_end ?? sub.current_period_end;

  const { error } = await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        stripe_subscription_id: sub.id,
        stripe_customer_id: sub.customer,
        product_id: productId ?? "",
        price_id: priceId,
        status: sub.status,
        current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancel_at_period_end: sub.cancel_at_period_end ?? false,
        environment: env,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    );
  if (error) throw new Error("Subscription persistence failed");
}

async function handleSubscriptionDeleted(sub: any, env: StripeEnv) {
  const { data, error } = await getSupabase()
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", sub.id)
    .eq("environment", env)
    .select("id");
  // A deletion may arrive before creation. Do not acknowledge an update that
  // changed no row; let Stripe retry after the missing subscription is synced.
  if (error || !data?.length) throw new Error("Subscription cancellation persistence failed");
}

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  // Only one-time payments (lifetime) need handling here — subscriptions come
  // through customer.subscription.created.
  if (session.mode !== "payment") return;
  const userId = session.metadata?.userId;
  if (!userId) throw new Error("Checkout is missing required userId metadata; reconcile ownership before retrying");
  if (session.payment_status !== "paid") throw new Error("Lifetime checkout payment is not confirmed");

  // Fetch line items to find the price/product
  const stripe = createStripeClient(env);
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
  const li: any = lineItems.data[0];
  if (!li) throw new Error("Paid checkout has no line item; retry after Stripe recovery");
  const priceId = priceLookup(li.price);
  if (priceId !== "restpilot_lifetime") throw new Error("Paid checkout does not match the lifetime product");
  const productId =
    typeof li.price?.product === "string" ? li.price.product : li.price?.product?.id;

  const { error } = await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        // Use the payment_intent or session id as a stable unique key for the lifetime row.
        stripe_subscription_id: `lifetime_${session.id}`,
        stripe_customer_id: session.customer,
        product_id: productId ?? "",
        price_id: priceId,
        status: "lifetime",
        current_period_start: new Date().toISOString(),
        current_period_end: null,
        cancel_at_period_end: false,
        environment: env,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    );
  if (error) throw new Error("Lifetime purchase persistence failed");
}

async function handleEvent(event: { type: string; data: { object: any } }, env: StripeEnv) {
  switch (event.type) {
    case "customer.subscription.created": {
      await handleSubscriptionUpsert(event.data.object, env);
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (userId) {
        const email = await getUserEmail(userId);
        if (email) {
          const item = sub.items?.data?.[0];
          await sendTransactionalEmailServer({
            templateName: "subscription-confirmation",
            recipientEmail: email,
            idempotencyKey: `sub-conf-${sub.id}`,
            templateData: {
              planName: item?.price?.nickname || "RestPilot AI",
              amount: formatAmount(item?.price?.unit_amount, item?.price?.currency),
              renewsOn: item?.current_period_end
                ? new Date(item.current_period_end * 1000).toLocaleDateString()
                : undefined,
            },
          });
        }
      }
      break;
    }
    case "customer.subscription.updated":
      await handleSubscriptionUpsert(event.data.object, env);
      break;
    case "customer.subscription.deleted": {
      await handleSubscriptionDeleted(event.data.object, env);
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (userId) {
        const email = await getUserEmail(userId);
        if (email) {
          await sendTransactionalEmailServer({
            templateName: "subscription-canceled",
            recipientEmail: email,
            idempotencyKey: `sub-cancel-${sub.id}`,
            templateData: {
              endsOn: sub.current_period_end
                ? new Date(sub.current_period_end * 1000).toLocaleDateString()
                : undefined,
            },
          });
        }
      }
      break;
    }
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      if (!userId) throw new Error("Checkout is missing required userId metadata; reconcile ownership before retrying");
      // Checkout completion is not proof of payment for delayed methods. Stripe
      // sends async_payment_succeeded when payment settles; only that confirmed
      // state may grant lifetime access or generate a payment receipt.
      if (session.payment_status !== "paid") {
        if (event.type === "checkout.session.async_payment_succeeded"
          || !["unpaid", "no_payment_required"].includes(session.payment_status)
          || (session.mode === "payment" && session.payment_status === "no_payment_required")) {
          throw new Error("Checkout payment status requires reconciliation before access can be granted");
        }
        break;
      }
      await handleCheckoutCompleted(session, env);
      if (userId) {
        const email = session.customer_details?.email || (await getUserEmail(userId));
        if (email) {
          await sendTransactionalEmailServer({
            templateName: "payment-receipt",
            recipientEmail: email,
            idempotencyKey: `receipt-${session.id}`,
            templateData: {
              amount: formatAmount(session.amount_total, session.currency),
              date: new Date().toLocaleDateString(),
              planName: "RestPilot AI",
            },
          });
        }
      }
      break;
    }
    case "invoice.payment_failed": {
      console.log("invoice.payment_failed", event.data.object?.id);
      const invoice = event.data.object;
      const customerEmail = invoice.customer_email;
      if (customerEmail) {
        await sendTransactionalEmailServer({
          templateName: "payment-failed",
          recipientEmail: customerEmail,
          idempotencyKey: `pay-fail-${invoice.id}`,
          templateData: {
            amount: formatAmount(invoice.amount_due, invoice.currency),
            retryOn: invoice.next_payment_attempt
              ? new Date(invoice.next_payment_attempt * 1000).toLocaleDateString()
              : undefined,
          },
        });
      }
      await notifyOwner({
        severity: "warning",
        service: "stripe.invoice.payment_failed",
        message: `Payment failed for invoice ${invoice.id}`,
        meta: { invoiceId: invoice.id, customerEmail, amount: invoice.amount_due, env },
      });
      break;
    }
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return new Response("Missing ?env=live or ?env=sandbox on the webhook URL", { status: 400 });
        }
        const env: StripeEnv = rawEnv;
        let verified = false;
        try {
          const event = await verifyWebhook(request, env);
          verified = true;
          await handleEvent(event, env);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          try {
            await notifyOwner({
              severity: "critical",
              service: "stripe.webhook",
              message: e instanceof Error ? e.message : String(e),
              meta: { env },
            });
          } catch {
            console.error("Webhook failure notification could not be delivered");
          }
          return new Response("Webhook error", { status: verified ? 500 : 400 });
        }
      },
    },
  },
});

