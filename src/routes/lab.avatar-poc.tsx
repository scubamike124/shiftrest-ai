import { createFileRoute, Outlet, Link } from "@tanstack/react-router";

function LabGate() {
  // Internal POC surface — hide from anyone visiting production.
  // Dev + preview builds still render the Outlet as usual.
  if (import.meta.env.PROD) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This area is for internal previews only.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }
  return <Outlet />;
}

export const Route = createFileRoute("/lab/avatar-poc")({
  head: () => ({
    meta: [
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: LabGate,
});
