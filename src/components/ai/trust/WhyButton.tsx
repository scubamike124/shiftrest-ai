import { useState } from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { RecommendationDetailSheet, type RecommendationDetailSheetProps } from "./RecommendationDetailSheet";

export type WhyButtonProps = Omit<RecommendationDetailSheetProps, "open" | "onOpenChange"> & {
  label?: string;
  className?: string;
  variant?: "pill" | "inline" | "icon";
};

export function WhyButton({
  label = "Why?",
  className,
  variant = "pill",
  ...sheet
}: WhyButtonProps) {
  const [open, setOpen] = useState(false);

  const base =
    variant === "icon"
      ? "flex h-8 w-8 items-center justify-center rounded-full bg-secondary/60 text-muted-foreground transition hover:text-foreground"
      : variant === "inline"
      ? "inline-flex items-center gap-1 text-xs font-semibold text-indigo-glow underline-offset-2 hover:underline"
      : "inline-flex items-center gap-1 rounded-full border border-indigo-glow/30 bg-indigo-glow/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-indigo-glow transition hover:bg-indigo-glow/20";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(base, className)}
        aria-label="Explain this recommendation"
      >
        <Info className={variant === "icon" ? "h-4 w-4" : "h-3 w-3"} aria-hidden />
        {variant !== "icon" && <span>{label}</span>}
      </button>
      <RecommendationDetailSheet open={open} onOpenChange={setOpen} {...sheet} />
    </>
  );
}
