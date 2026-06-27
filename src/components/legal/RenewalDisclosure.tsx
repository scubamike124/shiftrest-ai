import { Link } from "@tanstack/react-router";

export function RenewalDisclosure() {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4 text-[11px] leading-relaxed text-muted-foreground">
      <p className="font-semibold text-foreground">Billing &amp; renewal</p>
      <ul className="mt-2 space-y-1 list-disc pl-4">
        <li>
          Monthly and annual plans renew automatically at the listed price until you cancel. Prices and currency are shown at checkout and may change with notice.
        </li>
        <li>
          Cancel anytime from the billing portal. Cancellation stops the next renewal; access continues through the end of the current paid period.
        </li>
        <li>
          Refunds and credits are limited as described in our{" "}
          <Link to="/legal/subscription" className="text-primary underline">
            Subscription Terms
          </Link>
          . Lifetime access applies to current core features and is subject to reasonable use limits.
        </li>
        <li>
          RestPilot AI is not medical advice, an emergency service, or a guarantee of any health, safety, or work outcome. See{" "}
          <Link to="/legal/disclaimers" className="text-primary underline">
            Disclaimers
          </Link>{" "}
          and{" "}
          <Link to="/safety" className="text-primary underline">
            Safety Center
          </Link>
          .
        </li>
      </ul>
    </div>
  );
}
