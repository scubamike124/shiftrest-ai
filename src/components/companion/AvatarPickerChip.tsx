// Small floating chip rendered on top of the companion avatar that opens
// a bottom-sheet picker. Surfaces avatar choice directly on /companion so
// users don't have to discover /settings/avatar.

import { useState } from "react";
import { UserCircle2, Check } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useAvatar } from "@/lib/companion/use-avatar";
import { cn } from "@/lib/utils";

export function AvatarPickerChip({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { id, presets, setAvatar } = useAvatar();

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "absolute right-1 top-1 z-10 inline-flex items-center gap-1 rounded-full",
          "border border-white/20 bg-black/50 px-2.5 py-1 text-[11px] font-medium text-white",
          "shadow backdrop-blur active:scale-95 transition",
          className,
        )}
        aria-label="Change companion avatar"
      >
        <UserCircle2 className="h-3.5 w-3.5" />
        Change
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle>Pick your companion</SheetTitle>
            <SheetDescription>Choose the face and voice you want to talk to.</SheetDescription>
          </SheetHeader>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {presets.map((p) => {
              const selected = p.id === id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    void setAvatar(p.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border bg-card text-left transition",
                    "active:scale-[0.98]",
                    selected ? "border-primary ring-2 ring-primary/60" : "border-border hover:border-primary/40",
                  )}
                >
                  <div className="aspect-square w-full overflow-hidden">
                    <img
                      src={p.src}
                      alt={p.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 p-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{p.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {p.gender === "female" ? "Female" : "Male"} · {p.description}
                      </div>
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <Link
              to="/settings/avatar"
              onClick={() => setOpen(false)}
              className="rounded-xl border border-border bg-card px-4 py-3 text-center text-sm font-medium hover:border-primary/40"
            >
              More options & custom photo
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
