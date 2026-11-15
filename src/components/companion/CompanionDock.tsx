// Persistent corner avatar on desktop-width app screens (lg and up).
// Tap → opens the full Companion experience.
import { Link, useRouterState } from "@tanstack/react-router";
import { OrbBadge } from "@/components/PilotOrb";
import { cn } from "@/lib/utils";

const HIDE_ON = new Set<string>([
  "/companion",
  "/auth",
  "/reset-password",
  "/share",
  "/onboarding",
]);

const HIDE_PREFIXES = ["/legal", "/share/"];

function shouldHide(pathname: string): boolean {
  if (HIDE_ON.has(pathname)) return true;
  if (HIDE_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // hide on marketing root
  if (pathname === "/") return true;
  return false;
}

export function CompanionDock() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (shouldHide(pathname)) return null;

  return (
    <Link
      to="/companion"
      aria-label="Open AI Companion"
      className={cn(
        // Phones reach the companion from the bottom navigation's centre tab;
        // a floating corner button there covered page titles and card controls.
        "fixed z-40 hidden h-14 w-14 items-center justify-center rounded-full lg:flex",
        "border border-white/15 bg-card/70 backdrop-blur-xl dock-glow",
        "transition-transform active:scale-95",
      )}
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 12px)",
        right: "calc(env(safe-area-inset-right, 0px) + 12px)",
      }}
    >
      <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-primary/25 via-transparent to-transparent" />
      <OrbBadge state="idle" size="sm" />
      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-400" />
    </Link>
  );
}
