/**
 * Soft "thinking" indicator shown in place of an empty assistant bubble
 * while the model is streaming its first token. Three dots breathe in
 * sequence — calm, premium, not chatbot-y.
 */
export function ThinkingShimmer({ label = "Thinking" }: { label?: string }) {
  return (
    <div
      className="flex items-center gap-1.5 py-0.5"
      role="status"
      aria-label={`${label}…`}
    >
      <span className="thinking-dot" style={{ animationDelay: "0ms" }} />
      <span className="thinking-dot" style={{ animationDelay: "160ms" }} />
      <span className="thinking-dot" style={{ animationDelay: "320ms" }} />
      <span className="sr-only">{label}…</span>
    </div>
  );
}
