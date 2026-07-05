// Companion avatar selector. Persists choice to localStorage and (when
// authenticated) to profiles.companion_avatar_id so it follows the user
// across devices. Also supports "custom:" data-URL uploads.

import { createFileRoute, Link } from "@tanstack/react-router";
import { requireSession } from "@/lib/require-session";
import { useRef, useState } from "react";
import { ArrowLeft, Check, Upload } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAvatar } from "@/lib/companion/use-avatar";
import { AVATAR_PRESETS } from "@/lib/companion/avatars";

export const Route = createFileRoute("/settings/avatar")({
  ssr: false,
  beforeLoad: requireSession,
  head: () => ({
    meta: [
      { title: "Choose your Companion avatar | RestPilot AI" },
      {
        name: "description",
        content: "Pick the face of your AI sleep companion, or upload your own portrait.",
      },
    ],
  }),
  component: AvatarSettings,
});

function AvatarSettings() {
  const { id, src, setAvatar } = useAvatar();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const isCustom = id.startsWith("custom:");

  async function choose(nextId: string) {
    setSaving(true);
    try {
      await setAvatar(nextId);
      toast.success("Avatar updated");
    } finally {
      setSaving(false);
    }
  }

  function onUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 2_500_000) {
      toast.error("Image is too large (max 2.5 MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      await choose(`custom:${dataUrl}`);
    };
    reader.readAsDataURL(file);
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <Link
          to="/settings/companion"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Settings
        </Link>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Choose your Companion</h1>
        <p className="text-sm text-muted-foreground">
          Pick the face you want your AI companion to wear. Your choice is saved on this
          device and synced to your account when you're signed in.
        </p>
      </header>

      {/* Current */}
      <Card className="p-4 flex items-center gap-4">
        <img
          src={src}
          alt="Current companion avatar"
          width={64}
          height={64}
          loading="lazy"
          className="h-16 w-16 rounded-full object-cover ring-2 ring-primary/40"
        />
        <div className="flex-1">
          <div className="text-sm text-muted-foreground">Currently using</div>
          <div className="font-medium">
            {isCustom ? "Your custom image" : AVATAR_PRESETS.find((a) => a.id === id)?.name ?? "Aura"}
          </div>
        </div>
      </Card>

      {/* Presets */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Presets
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {AVATAR_PRESETS.map((a) => {
            const selected = a.id === id;
            return (
              <button
                key={a.id}
                type="button"
                disabled={saving}
                onClick={() => choose(a.id)}
                className={`group relative overflow-hidden rounded-2xl border transition ${
                  selected
                    ? "border-primary ring-2 ring-primary/50"
                    : "border-border hover:border-primary/50"
                }`}
                aria-pressed={selected}
                aria-label={`Use ${a.name}`}
              >
                <img
                  src={a.src}
                  alt={a.name}
                  width={512}
                  height={512}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">{a.name}</span>
                    {selected && (
                      <span className="rounded-full bg-primary p-1 text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-white/70">
                    {a.gender}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Custom */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Custom
        </h2>
        <Card className="p-4 flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">Upload your own portrait</div>
            <div className="text-muted-foreground">
              Square images work best. Max 2.5 MB. Stored on this device.
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => fileRef.current?.click()}
            disabled={saving}
          >
            <Upload className="h-4 w-4 mr-1" /> Upload
          </Button>
        </Card>
      </section>
    </main>
  );
}
