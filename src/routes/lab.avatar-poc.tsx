import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/lab/avatar-poc")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => <Outlet />,
});
