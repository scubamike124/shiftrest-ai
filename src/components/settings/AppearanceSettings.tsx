// Settings → Appearance: five designed themes and "Match iPhone appearance".
// Saved on this device, per signed-in user. No custom colours.
import { useEffect, useState } from "react";
import { Check, Palette } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  APPEARANCE_EVENT,
  THEMES,
  readAppearance,
  writeAppearance,
  type Appearance,
  type ThemeId,
} from "@/lib/appearance";

export function AppearanceSettings({ userId }: { userId: string | null }) {
  const [a, setA] = useState<Appearance>(() => readAppearance(userId));

  useEffect(() => {
    setA(readAppearance(userId));
    const onChange = (e: Event) => setA((e as CustomEvent<Appearance>).detail);
    window.addEventListener(APPEARANCE_EVENT, onChange);
    return () => window.removeEventListener(APPEARANCE_EVENT, onChange);
  }, [userId]);

  const save = (next: Appearance) => {
    setA(next);
    writeAppearance(next, userId);
  };
  const pick = (theme: ThemeId) => save({ ...a, theme });

  return (
    <section
      aria-labelledby="appearance-title"
      className="rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
          <Palette className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 id="appearance-title" className="font-sans text-sm font-semibold">
            Appearance
          </h2>
          <p className="text-xs text-muted-foreground">
            Choose how RestPilot looks on this device.
          </p>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="sr-only">Theme</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {THEMES.map((t) => {
            const selected = a.theme === t.id;
            return (
              <label
                key={t.id}
                className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition focus-within:ring-2 focus-within:ring-ring ${
                  selected
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background/40 hover:border-primary/40"
                }`}
              >
                <input
                  type="radio"
                  name="appearance-theme"
                  value={t.id}
                  checked={selected}
                  onChange={() => pick(t.id)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className="relative flex h-10 w-14 shrink-0 overflow-hidden rounded-lg border border-black/10 shadow-sm"
                  style={{ background: t.swatch[0] }}
                >
                  <span
                    className="absolute inset-x-1.5 bottom-1.5 top-3 rounded-md"
                    style={{ background: t.swatch[1] }}
                  />
                  <span
                    className="absolute bottom-2.5 right-2.5 h-3 w-3 rounded-full"
                    style={{ background: t.swatch[2] }}
                  />
                </span>
                <span className="flex-1 text-sm font-medium">
                  {t.name}
                  {t.id === "midnight" && (
                    <span className="ml-1.5 text-xs text-muted-foreground">Default</span>
                  )}
                </span>
                {selected && <Check className="h-5 w-5 text-primary" aria-hidden />}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4 flex items-start justify-between gap-4 rounded-xl border border-border bg-background/40 px-3 py-3">
        <div>
          <p id="appearance-match-label" className="text-sm font-medium">
            Match iPhone appearance
          </p>
          <p id="appearance-match-desc" className="mt-0.5 text-xs text-muted-foreground">
            Soft Light when your iPhone is in Light mode
            {a.theme === "light"
              ? ", Midnight Purple"
              : `, ${THEMES.find((t) => t.id === a.theme)?.name}`}{" "}
            in Dark mode.
          </p>
        </div>
        <Switch
          checked={a.matchSystem}
          onCheckedChange={(v) => save({ ...a, matchSystem: v })}
          aria-labelledby="appearance-match-label"
          aria-describedby="appearance-match-desc"
          className="mt-0.5"
        />
      </div>
    </section>
  );
}
