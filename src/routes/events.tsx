import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "@/lib/require-session";
import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EventsList } from "@/components/EventsList";

export const Route = createFileRoute("/events")({
  ssr: false,
  beforeLoad: requireSession,
  head: () => ({
    meta: [
      { title: "Events — RestPilot AI" },
      {
        name: "description",
        content:
          "Manage calendar events and commute reminders around your circadian window.",
      },
    ],
  }),
  component: EventsPage,
});

function EventsPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(!!data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (active) setSignedIn(!!s);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const is = signedIn === true;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-12">
      <header className="mb-5 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Events</h1>
          <p className="text-xs text-muted-foreground">
            Schedule what matters — RestPilot times reminders around your circadian window.
          </p>
        </div>
      </header>

      <div className="space-y-4">
        <EventsList signedIn={is} />
      </div>
    </main>
  );
}
