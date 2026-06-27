import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { WhyButton, type WhyButtonProps } from "./WhyButton";

/**
 * Standard horizontal trust bar mounted at the top of every AI recommendation
 * card. Renders the confidence badge + Why? button using the same evidence
 * payload, so every surface across the app feels identical.
 */
export function TrustBar({
  className,
  align = "between",
  ...why
}: WhyButtonProps & {
  className?: string;
  align?: "start" | "end" | "between";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        align === "end" && "justify-end",
        align === "between" && "justify-between",
        className,
      )}
    >
      {why.confidence != null && <ConfidenceBadge value={why.confidence} />}
      <WhyButton {...why} />
    </div>
  );
}

export { ConfidenceBadge } from "./ConfidenceBadge";
export { WhyButton } from "./WhyButton";
export { WhatChanged } from "./WhatChanged";
export { RecommendationDetailSheet } from "./RecommendationDetailSheet";
