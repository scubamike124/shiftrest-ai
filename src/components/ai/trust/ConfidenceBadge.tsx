import { ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { confidenceLabel, normalizeConfidence, type ConfidenceInput } from "@/lib/trust";

const TONE: Record<"high" | "medium" | "low", { ring: string; text: string; bg: string; Icon: typeof Shield; label: string }> = {
  high:   { ring: "ring-emerald-400/30", text: "text-emerald-300", bg: "bg-emerald-500/12", Icon: ShieldCheck, label: "High confidence" },
  medium: { ring: "ring-amber-400/30",   text: "text-amber-300",   bg: "bg-amber-500/12",   Icon: Shield,      label: "Medium confidence" },
  low:    { ring: "ring-rose-400/30",    text: "text-rose-300",    bg: "bg-rose-500/12",    Icon: ShieldAlert, label: "Low confidence" },
};

export function ConfidenceBadge({
  value,
  showPercent = false,
  className,
}: {
  value: ConfidenceInput;
  showPercent?: boolean;
  className?: string;
}) {
  const score = normalizeConfidence(value);
  const level = confidenceLabel(score);
  if (!level) return null;
  const t = TONE[level];
  const pct = score != null ? Math.round(score * 100) : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ring-1",
        t.bg, t.text, t.ring,
        className,
      )}
      aria-label={t.label}
      title={pct != null ? `${pct}% confidence` : t.label}
    >
      <t.Icon className="h-3 w-3" aria-hidden />
      {level}
      {showPercent && pct != null && <span className="ml-0.5 opacity-80">· {pct}%</span>}
    </span>
  );
}
