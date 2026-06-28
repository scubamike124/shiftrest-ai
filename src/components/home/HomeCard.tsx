// Reusable premium glass card shell for the home experience.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type HomeCardProps = {
  children: ReactNode;
  className?: string;
  /** Adds extra glow + gradient wash (use on primary/AI cards). */
  accent?: boolean;
  /** Optional tap-through wrapper (visual only — wire your own <Link>). */
  asButton?: boolean;
  onClick?: () => void;
};

export function HomeCard({ children, className, accent, asButton, onClick }: HomeCardProps) {
  const cls = cn(
    "glass-card",
    accent && "glass-card-accent",
    "p-5 sm:p-6",
    asButton && "text-left active:scale-[0.99] transition-transform",
    className,
  );
  if (asButton) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {children}
      </button>
    );
  }
  return <section className={cls}>{children}</section>;
}

export function HomeCardHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="card-eyebrow">{eyebrow}</p> : null}
        <h3 className="card-title mt-1 truncate">{title}</h3>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
