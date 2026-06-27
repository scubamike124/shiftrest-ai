import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";

export function SafetyNote({
  to = "/safety",
  label = "Safety & limits",
}: {
  to?: string;
  label?: string;
}) {
  return (
    <Link
      to={to as never}
      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/70 hover:text-primary"
    >
      <ShieldAlert className="h-3 w-3" />
      {label}
    </Link>
  );
}
