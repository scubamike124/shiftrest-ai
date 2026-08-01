// Bare /settings had no route and returned a 404. It now redirects to the
// companion settings hub, which links out to the other settings pages.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/settings/companion", replace: true });
  },
});
