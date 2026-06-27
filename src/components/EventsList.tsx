import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, MapPin, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  createEvent,
  deleteEvent,
  fetchEvents,
  parseIcs,
  type EventKind,
  type UserEvent,
} from "@/lib/events";

/**
 * EventsList — full CRUD for calendar/commute/personal events.
 * Used inside /events route; mobile-first layout.
 */
export function EventsList({ signedIn }: { signedIn: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<EventKind>("calendar");
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(defaultStart());
  const [location, setLocation] = useState("");
  const [reminderMin, setReminderMin] = useState(15);
  const [travelBufferMin, setTravelBufferMin] = useState(20);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["events", "all"],
    queryFn: () =>
      fetchEvents({
        fromIso: new Date(Date.now() - 60 * 60_000).toISOString(),
        untilIso: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
    enabled: signedIn,
  });

  const list = useMemo(
    () =>
      events
        .filter((e) => !(e.kind === "personal" && /^alarm:/i.test(e.title)))
        .sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt)),
    [events],
  );

  const add = useMutation({
    mutationFn: () =>
      createEvent({
        kind,
        title: title.trim() || (kind === "commute" ? "Commute" : "Event"),
        startsAt: new Date(startsAt).toISOString(),
        location: location || null,
        reminderMin,
        travelBufferMin,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      setTitle("");
      setLocation("");
      toast.success("Event added.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add event."),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["events"] }),
  });

  async function importIcs(file: File) {
    try {
      const text = await file.text();
      const items = parseIcs(text).filter(
        (i) => +new Date(i.startsAt) > Date.now() - 86_400_000,
      );
      if (items.length === 0) {
        toast.error("No future events found in that file.");
        return;
      }
      let added = 0;
      for (const it of items.slice(0, 50)) {
        await createEvent(it);
        added += 1;
      }
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(`Imported ${added} event${added === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed.");
    }
  }

  if (!signedIn) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Sign in to manage events, commutes, and calendar imports.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Add event</h3>
        <div className="mt-3 grid gap-3">
          <div className="flex gap-2">
            {(["calendar", "commute", "personal"] as EventKind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`flex-1 rounded-xl border px-3 py-2 text-xs font-semibold capitalize ${
                  kind === k
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            placeholder={kind === "commute" ? "Trip name (e.g. Drive to hospital)" : "Title"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
          />
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
          />
          <input
            placeholder="Location (optional)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="h-11 rounded-xl border border-border bg-background px-3 text-sm"
          />
          {kind === "commute" ? (
            <label className="block text-xs font-semibold text-muted-foreground">
              Travel buffer (min before arrival)
              <input
                type="number"
                min={0}
                max={180}
                value={travelBufferMin}
                onChange={(e) => setTravelBufferMin(Number(e.target.value))}
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
              />
            </label>
          ) : (
            <label className="block text-xs font-semibold text-muted-foreground">
              Remind me (min before)
              <input
                type="number"
                min={0}
                max={720}
                value={reminderMin}
                onChange={(e) => setReminderMin(Number(e.target.value))}
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
              />
            </label>
          )}
          <button
            onClick={() => add.mutate()}
            disabled={add.isPending}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            <CalendarPlus className="h-4 w-4" /> {add.isPending ? "Adding…" : "Add"}
          </button>
          <label className="flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs font-semibold text-muted-foreground hover:bg-secondary">
            <Upload className="h-3.5 w-3.5" /> Import .ics calendar
            <input
              type="file"
              accept=".ics,text/calendar"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importIcs(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card">
        <header className="border-b border-border p-4">
          <h3 className="text-sm font-semibold">Upcoming ({list.length})</h3>
        </header>
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : list.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No events scheduled. Add one above or import an .ics file.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((ev) => (
              <EventRow key={ev.id} event={ev} onDelete={() => del.mutate(ev.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EventRow({ event, onDelete }: { event: UserEvent; onDelete: () => void }) {
  const when = new Date(event.startsAt).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {event.kind}
          {event.source !== "manual" && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] normal-case">
              {event.source}
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold">{event.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{when}</p>
        {event.location && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" /> {event.location}
          </p>
        )}
      </div>
      <button
        onClick={onDelete}
        className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label="Delete event"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 2);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
