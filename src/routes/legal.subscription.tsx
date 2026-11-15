import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalLayout } from "@/components/legal/LegalLayout";
import { findLegalDoc } from "@/lib/legal/meta";
import { useIsNativeApp } from "@/lib/native-app";

export const DOC = findLegalDoc("subscription")!;

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
  component: SubscriptionTerms,
});

function SubscriptionTerms() {
  // Inside the iPhone app no website purchase link or wording may appear
  // (App Store Guideline 3.1.1); the website shows the same terms with links.
  const inApp = useIsNativeApp();
  return (
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
      </ul>
      <p>
        The one-time Lifetime plan has been permanently discontinued and is
        no longer available for purchase. Customers who already bought
        Lifetime keep their access as described in "Lifetime access" below.
      </p>
      <p>
        {inApp ? (
          <>The price is shown in the app before you subscribe. </>
        ) : (
          <>
            Current pricing is shown on the <Link to="/pricing">pricing page</Link>.{" "}
          </>
        )}
        Taxes, where applicable, are added at checkout or by Apple.
      </p>

      <h2>2. Billing and payment processor</h2>
      <p>
        <strong>Subscriptions bought in the RestPilot iPhone app</strong> are
        billed by Apple through the App Store. Payment is charged to your
        Apple Account at confirmation of purchase, or when an eligible free
        trial ends. We do not receive or store your payment details for these
        subscriptions.
      </p>
      <p>
        <strong>Subscriptions started earlier on our website</strong> are
        processed by our payment provider (currently Stripe). By subscribing,
        you authorized us and our payment processor to charge your selected
        payment method.
      </p>

      <h2>3. Automatic renewal</h2>
      <p>
        Monthly and annual plans renew automatically at the price shown
        unless cancelled. For App Store subscriptions, the subscription
        renews unless it is cancelled at least 24 hours before the end of the
        current period. For website subscriptions, we will email a renewal reminder for annual
        plans in advance of the renewal date where required by law.
      </p>

      <h2>4. Cancellation</h2>
      <p>
        <strong>App Store subscriptions:</strong> manage or cancel any time on
        your iPhone in Settings → your name → Subscriptions. We cannot cancel
        an App Store subscription for you. Deleting the app or your RestPilot
        account does not cancel it.
      </p>
      <p>
        <strong>Website subscriptions:</strong>{" "}
        {inApp
          ? "these are managed from your RestPilot account on the web, or by contacting support."
          : "you can cancel any time from your account settings."}
      </p>
      <p>
        Cancellation stops future renewals; you retain access through the end
        of the period you already paid for. No partial-month refunds for
        monthly plans.
      </p>

      <h2>5. Refunds</h2>
      <p>
        <strong>App Store subscriptions:</strong> Apple handles payment, so
        refunds are requested from Apple at{" "}
        <a href="https://reportaproblem.apple.com" target="_blank" rel="noopener noreferrer">
          reportaproblem.apple.com
        </a>
        . We cannot issue refunds for App Store purchases.
      </p>
      <p>
        <strong>Website subscriptions:</strong> except where required by law
        (for example, the EU 14-day right of withdrawal for digital services
        where you have not waived it), subscription fees are non-refundable.
        If you believe you were charged in error, contact{" "}
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

      <h2>9. Lifetime access (existing purchasers)</h2>
      <p>
        Lifetime is no longer sold. For customers who purchased it,
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
        downgrade your account until payment succeeds. For App Store
        subscriptions, Apple controls payment retries and any billing grace
        period.
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
  );
}
