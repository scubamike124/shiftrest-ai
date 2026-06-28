// Slice 12 — Step 4. Calendar Intelligence connect surface.
// Permission-first: nothing happens until the user pastes an ICS feed URL
// and saves it. Test button validates the feed before the row is created.

import { useCallback, useEffect, useState } from "react";
import { Calendar as CalendarIcon, Check, Loader2, Plus, Trash2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { track } from "@/lib/companion/analytics";
import {
  deleteCalendarFeed,
  listCalendarFeeds,
  testCalendarFeed,
  upsertCalendarFeed,
  type CalendarFeedDTO,
} from "@/lib/calendar/calendar.functions";

export function CalendarFeedsCard({
  flagOn,
  onSaved,
}: {
  flagOn: boolean;
  onSaved?: () => void;
}) {
  const list = useServerFn(listCalendarFeeds);
  const upsert = useServerFn(upsertCalendarFeed);
  const remove = useServerFn(deleteCalendarFeed);
  const test = useServerFn(testCalendarFeed);

  const [feeds, setFeeds] = useState<CalendarFeedDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await list();
      setFeeds(rows);
    } catch {
      setFeeds([]);
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onAdd = useCallback(async () => {
    const url = icsUrl.trim();
    const lbl = label.trim() || "My calendar";
    if (!url) {
      toast.error("Paste an ICS feed URL.");
      return;
    }
    setBusy(true);
    track({ event: "skill_connect_started", skill: "calendar_read" });
    try {
      const t = await test({ data: { icsUrl: url } });
      if (!t.ok) {
        track({ event: "skill_connect_failed", skill: "calendar_read", reason: t.error });
        toast.error(`Couldn't load that feed: ${t.error}`);
        return;
      }
      await upsert({ data: { label: lbl, icsUrl: url } });
      track({ event: "skill_connect_completed", skill: "calendar_read" });
      toast.success(
        t.sampleCount > 0
          ? `Connected — ${t.sampleCount} upcoming events visible.`
          : "Connected. No events in the next two weeks.",
      );
      setLabel("");
      setIcsUrl("");
      setShowForm(false);
      await refresh();
      onSaved?.();
    } catch (e) {
      const reason = e instanceof Error ? e.message : "Save failed";
      track({ event: "skill_connect_failed", skill: "calendar_read", reason });
      toast.error(reason);
    } finally {
      setBusy(false);
    }
  }, [icsUrl, label, onSaved, refresh, test, upsert]);

  const onRemove = useCallback(
    async (feed: CalendarFeedDTO) => {
      setBusy(true);
      try {
        await remove({ data: { id: feed.id } });
        track({ event: "skill_invoked", skill: "calendar_read", action: "feed_removed" });
        await refresh();
        onSaved?.();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not remove feed");
      } finally {
        setBusy(false);
      }
    },
    [onSaved, refresh, remove],
  );

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <CalendarIcon className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
          <div>
            <p className="text-sm font-semibold">Calendar feeds</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Paste a read-only ICS link (Apple, Google "secret address", Outlook). Reelo never
              creates, moves, or deletes events.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading calendars…
        </div>
      ) : feeds.length === 0 ? (
        <p className="text-xs text-muted-foreground">No calendars connected yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {feeds.map((f) => (
            <li
              key={f.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{f.label}</p>
                  {f.lastError ? (
                    <Badge variant="destructive" className="gap-1 text-[10px]">
                      <AlertCircle className="h-3 w-3" />
                      Sync error
                    </Badge>
                  ) : f.lastSyncAt ? (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <Check className="h-3 w-3" /> Synced
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{f.icsUrl}</p>
                {f.lastError && (
                  <p className="mt-1 text-[11px] text-destructive">{f.lastError}</p>
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void onRemove(f)}
                disabled={busy}
                className="min-h-11 min-w-11 text-destructive hover:text-destructive"
                aria-label={`Remove ${f.label}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <div className="mt-3 flex flex-col gap-2">
          <div>
            <Label htmlFor="cal-label" className="text-xs">
              Calendar name
            </Label>
            <Input
              id="cal-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Work, Family, Shifts…"
              className="mt-1 min-h-11"
              disabled={busy}
            />
          </div>
          <div>
            <Label htmlFor="cal-url" className="text-xs">
              ICS feed URL
            </Label>
            <Input
              id="cal-url"
              value={icsUrl}
              onChange={(e) => setIcsUrl(e.target.value)}
              placeholder="https://… or webcal://…"
              className="mt-1 min-h-11"
              inputMode="url"
              autoComplete="off"
              disabled={busy}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setLabel("");
                setIcsUrl("");
              }}
              disabled={busy}
              className="min-h-11"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void onAdd()}
              disabled={busy || !flagOn}
              className="min-h-11"
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Test & save
            </Button>
          </div>
          {!flagOn && (
            <p className="text-[11px] text-muted-foreground">
              Turn on Companion Skills (top of this page) to save a calendar.
            </p>
          )}
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowForm(true)}
          className="mt-3 min-h-11"
          disabled={!flagOn}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add calendar
        </Button>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground">
        Tip: in Google Calendar, open the calendar's settings and copy the "Secret address in
        iCal format". In Apple Calendar, share the calendar publicly and copy the link.
      </p>
    </Card>
  );
}
