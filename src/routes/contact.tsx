import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact — RestPilot AI" },
      {
        name: "description",
        content:
          "Get in touch with the RestPilot AI team. We usually respond within one business day.",
      },
      { property: "og:title", content: "Contact — RestPilot AI" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setErrorMsg(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: (fd.get("name") as string) || undefined,
      email: (fd.get("email") as string) || "",
      subject: (fd.get("subject") as string) || undefined,
      message: (fd.get("message") as string) || "",
      hp: (fd.get("company") as string) || "",
    };
    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Something went wrong.");
      }
      setState("sent");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight">Contact us</h1>
      <p className="mt-3 text-muted-foreground">
        Questions, feedback, or billing help? Send us a note — we usually reply within one
        business day.
      </p>

      {state === "sent" ? (
        <div className="mt-8 rounded-xl border border-primary/30 bg-primary/5 p-6">
          <p className="font-medium">Thanks — we got your message.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            A confirmation is on the way to your inbox.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {/* Honeypot — hidden from humans */}
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
            aria-hidden="true"
          />
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              maxLength={120}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">
              Email <span className="text-destructive">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              maxLength={255}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="subject">
              Subject
            </label>
            <input
              id="subject"
              name="subject"
              type="text"
              maxLength={200}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="message">
              Message <span className="text-destructive">*</span>
            </label>
            <textarea
              id="message"
              name="message"
              required
              minLength={4}
              maxLength={4000}
              rows={6}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {state === "error" && errorMsg ? (
            <p className="text-sm text-destructive">{errorMsg}</p>
          ) : null}

          <button
            type="submit"
            disabled={state === "sending"}
            className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {state === "sending" ? "Sending…" : "Send message"}
          </button>

          <p className="pt-2 text-xs text-muted-foreground">
            Prefer email? Reach us at{" "}
            <a href="mailto:support@restpilotai.com" className="underline">
              support@restpilotai.com
            </a>
            .
          </p>
        </form>
      )}
    </main>
  );
}
