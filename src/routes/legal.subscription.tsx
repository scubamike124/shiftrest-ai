import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";

const DOC = findLegalDoc("subscription")!;

export const Route = createFileRoute("/legal/subscription")({
  head: () => ({
    meta: [
      { title: `${DOC.title} — RestPilot AI` },
      { name: "description", content: DOC.summary },
      { property: "og:title", content: `${DOC.title} — RestPilot AI` },
      { property: "og:description", content: DOC.summary },
      { property: "og:url", content: DOC.path },
    ],
    links: [{ rel: "canonical", href: DOC.path }],
  }),
  component: () => (
    <LegalLayout doc={DOC}>
      <p>
        These Subscription Terms describe how billing, renewals, cancellation,
        and refunds work for paid RestPilot AI plans. They are part of our{" "}
        <Link to="/legal/terms">Terms of Service</Link>.
      </p>

      <h2>1. Plans</h2>
      <ul>
        <li>
          <strong>Monthly — USD 7.99/month</strong>, billed monthly and
          renewing each month until cancelled.
        </li>
        <li>
          <strong>Annual — USD 49.99/year</strong>, billed once per year and
          renewing each year until cancelled.
        </li>
        <li>
          <strong>Lifetime — USD 99 one-time</strong>, single charge granting
          access to Lifetime features for as long as the Service is
          commercially available (see "Lifetime access" below).
        </li>
      </ul>
      <p>
        Current pricing is shown on the{" "}
        <Link to="/pricing">pricing page</Link>. Taxes, where applicable, are
        added at checkout.
      </p>

      <h2>2. Billing and payment processor</h2>
      <p>
        Subscriptions are processed by our payment provider (currently
        Stripe). By subscribing, you authorize us and our payment processor
        to charge your selected payment method.
      </p>

      <h2>3. Automatic renewal</h2>
      <p>
        Monthly and annual plans renew automatically at the then-current
        price until you cancel. We will email a renewal reminder for annual
        plans in advance of the renewal date where required by law.
      </p>

      <h2>4. Cancellation</h2>
      <p>
        You can cancel any time from your account settings. Cancellation
        stops future renewals; you retain access through the end of the
        period you already paid for. No partial-month refunds for monthly
        plans.
      </p>

      <h2>5. Refunds</h2>
      <p>
        Except where required by law (for example, the EU 14-day right of
        withdrawal for digital services where you have not waived it),
        subscription fees are non-refundable. If you believe you were charged
        in error, contact{" "}
        <a href="mailto:support@restpilotai.com">support@restpilotai.com</a> within
        30 days.
      </p>

      <h2>6. Free trials</h2>
      <p>
        If we offer a free trial, you may use the Service at no charge for
        the trial period. At the end of the trial, your plan will auto-renew
        at the listed price unless you cancel before the trial ends. Only one
        trial per user.
      </p>

      <h2>7. Promotional pricing</h2>
      <p>
        Promotional discounts apply only for the introductory period stated
        at sign-up. After the introductory period, the standard renewal price
        applies.
      </p>

      <h2>8. Price changes</h2>
      <p>
        We may change prices for future renewals. We will notify you in
        advance and you may cancel before the change takes effect.
      </p>

      <h2>9. Lifetime access</h2>
      <p>
        "Lifetime" means a one-time purchase that grants access to the
        Lifetime features included with your purchase for as long as
        RestPilot AI is actively operated and commercially available.
        Lifetime access refers to the lifetime of the Service, not of the
        purchaser. If the Service is permanently discontinued, Lifetime
        access ends when the Service ends. Lifetime access does not
        automatically include separate future products unless stated.
      </p>

      <h2>10. Failed payments</h2>
      <p>
        If a payment fails, we may retry, suspend premium features, or
        downgrade your account until payment succeeds.
      </p>

      <h2>11. Taxes</h2>
      <p>
        You are responsible for any sales, use, VAT, or similar taxes
        associated with your purchase, except for taxes based on our income.
      </p>

      <h2>12. Contact</h2>
      <p>
        Email <a href="mailto:support@restpilotai.com">support@restpilotai.com</a>{" "}
        for billing questions.
      </p>
    </LegalLayout>
  ),
});
