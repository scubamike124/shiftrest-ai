import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldCheck, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

export type ConsentModalProps = {
  open: boolean;
  title: string;
  description: string;
  bullets: string[];
  /** Document slugs to record + show as links. */
  documents: { slug: string; label: string; path: string }[];
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function ConsentModal({
  open,
  title,
  description,
  bullets,
  documents,
  confirmLabel = "I understand and agree",
  onCancel,
  onConfirm,
}: ConsentModalProps) {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-modal-title"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-background/80 backdrop-blur-xl sm:items-center"
    >
      <div className="relative w-full max-w-md rounded-t-3xl border border-border bg-card p-6 shadow-2xl sm:rounded-3xl">
        <button
          aria-label="Close"
          onClick={onCancel}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="h-5 w-5" />
          <h2 id="consent-modal-title" className="text-lg font-semibold">
            {title}
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>

        <ul className="mt-4 space-y-2 text-xs text-muted-foreground">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {documents.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {documents.map((d) => (
              <Link
                key={d.slug}
                to={d.path as never}
                className="text-primary underline-offset-4 hover:underline"
                target="_blank"
              >
                {d.label}
              </Link>
            ))}
          </div>
        )}

        <label className="mt-5 flex items-start gap-2 text-xs">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5"
          />
          <span>I have read and agree to the items above.</span>
        </label>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            className="h-11 flex-1 rounded-xl border border-border text-sm font-medium"
          >
            Cancel
          </button>
          <button
            disabled={!agreed || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
            className="h-11 flex-[1.5] rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
