// Phase 5 — Smart Home device registry route.
// Mobile-first list + add/edit/delete. RLS-scoped via server fns.

import { createFileRoute, Link } from "@tanstack/react-router";
import { requireSession } from "@/lib/require-session";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Lamp, Lock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  listSmartDevices,
  upsertSmartDevice,
  deleteSmartDevice,
} from "@/lib/smart-home/devices.functions";
import {
  DEVICE_KIND_LABELS,
  DEVICE_VENDOR_LABELS,
  SENSITIVE_KINDS,
  type DeviceKind,
  type DeviceVendor,
  type SmartDevice,
} from "@/lib/smart-home/types";
import { track } from "@/lib/companion/analytics";

export const Route = createFileRoute("/smart-home")({
  ssr: false,
  beforeLoad: requireSession,
  head: () => ({
    meta: [
      { title: "Smart Home | RestPilot AI" },
      {
        name: "description",
        content:
          "Register lights, plugs, thermostats, speakers, coffee makers, and bedroom devices so Reelo can include them in your routines.",
      },
    ],
  }),
  component: SmartHomePage,
  errorComponent: () => (
    <main className="mx-auto max-w-md p-6 text-sm">Smart Home is unavailable right now.</main>
  ),
  notFoundComponent: () => <main className="mx-auto max-w-md p-6 text-sm">Not found.</main>,
});

const KINDS = Object.keys(DEVICE_KIND_LABELS) as DeviceKind[];
const VENDORS = Object.keys(DEVICE_VENDOR_LABELS) as DeviceVendor[];

function SmartHomePage() {
  const list = useServerFn(listSmartDevices);
  const upsert = useServerFn(upsertSmartDevice);
  const del = useServerFn(deleteSmartDevice);
  const qc = useQueryClient();

  const devicesQ = useQuery({
    queryKey: ["smart-devices"],
    queryFn: () => list(),
  });

  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<DeviceKind>("light");
  const [room, setRoom] = useState("");
  const [vendor, setVendor] = useState<DeviceVendor>("manual");

  const addMut = useMutation({
    mutationFn: async () => {
      if (!label.trim()) throw new Error("Add a label");
      return upsert({
        data: {
          label: label.trim(),
          kind,
          room: room.trim() || null,
          vendor,
          sensitive: SENSITIVE_KINDS.has(kind),
        },
      });
    },
    onSuccess: () => {
      track({ event: "skill_invoked", skill: "smart_home", action: "device_added" });
      setLabel("");
      setRoom("");
      void qc.invalidateQueries({ queryKey: ["smart-devices"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add device"),
  });

  const toggleMut = useMutation({
    mutationFn: async (d: SmartDevice) =>
      upsert({
        data: {
          id: d.id,
          label: d.label,
          kind: d.kind,
          room: d.room,
          vendor: d.vendor,
          enabled: !d.enabled,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["smart-devices"] }),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => del({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["smart-devices"] }),
  });

  const devices = devicesQ.data ?? [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-5 pb-24 pt-6">
      <header className="flex items-center gap-2">
        <Link
          to="/settings/skills"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border/60"
          aria-label="Back to Companion Skills"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Smart Home</h1>
          <p className="text-xs text-muted-foreground">
            Permission-based. Devices added here are private and used only by routines you build.
          </p>
        </div>
      </header>

      <Card className="flex flex-col gap-3 p-4" aria-label="Add device">
        <p className="text-sm font-semibold">Add a device</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="dev-label">Label</Label>
            <Input
              id="dev-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Bedroom lamp"
              maxLength={80}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="dev-room">Room</Label>
            <Input
              id="dev-room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Bedroom"
              maxLength={60}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as DeviceKind)}>
              <SelectTrigger aria-label="Device kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {DEVICE_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Platform</Label>
            <Select value={vendor} onValueChange={(v) => setVendor(v as DeviceVendor)}>
              <SelectTrigger aria-label="Device platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VENDORS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {DEVICE_VENDOR_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {SENSITIVE_KINDS.has(kind) && (
          <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-300">
            <Lock className="h-3 w-3" aria-hidden />
            Sensitive device — routines will always ask before running this.
          </p>
        )}
        <Button
          type="button"
          onClick={() => addMut.mutate()}
          disabled={addMut.isPending}
          className="min-h-11 self-end"
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Add device
        </Button>
      </Card>

      <section aria-label="Your devices" className="flex flex-col gap-2">
        <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your devices
        </p>
        {devicesQ.isLoading ? (
          <Card className="p-4 text-sm text-muted-foreground">Loading…</Card>
        ) : devices.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            No devices yet. Add one above to use it in a routine.
          </Card>
        ) : (
          devices.map((d) => (
            <Card key={d.id} className="flex items-start justify-between gap-3 p-3">
              <div className="flex flex-1 items-start gap-3">
                <div
                  className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary"
                  aria-hidden
                >
                  {SENSITIVE_KINDS.has(d.kind) ? <Lock className="h-4 w-4" /> : <Lamp className="h-4 w-4" />}
                </div>
                <div className="flex flex-1 flex-col">
                  <p className="text-sm font-medium leading-tight">{d.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {DEVICE_KIND_LABELS[d.kind]} · {DEVICE_VENDOR_LABELS[d.vendor]}
                    {d.room ? ` · ${d.room}` : ""}
                  </p>
                  <div className="mt-1 flex gap-1">
                    {d.sensitive && (
                      <Badge variant="destructive" className="text-[10px]">
                        Sensitive
                      </Badge>
                    )}
                    {!d.enabled && (
                      <Badge variant="outline" className="text-[10px]">
                        Disabled
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Switch
                  checked={d.enabled}
                  onCheckedChange={() => toggleMut.mutate(d)}
                  aria-label={`Enable ${d.label}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => delMut.mutate(d.id)}
                  className="min-h-11 text-destructive"
                  aria-label={`Delete ${d.label}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Reelo never controls a device without your permission. Vendor labels are for organization —
        actually issuing commands to Alexa, Google Home, HomeKit, or SmartThings requires connecting
        your account in each respective app. Sensitive devices (locks, garage) always require an
        extra confirmation tap inside RestPilot before any routine runs.
      </p>
    </main>
  );
}
