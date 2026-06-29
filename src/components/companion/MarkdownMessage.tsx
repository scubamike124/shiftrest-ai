import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Safe markdown renderer for assistant chat bubbles.
 *
 * Security:
 * - We do NOT pass rehype-raw, so raw HTML in the markdown source is
 *   stripped by react-markdown's default parser. No user-controlled HTML
 *   ever reaches the DOM.
 * - Links are forced to open in a new tab with rel="noopener noreferrer".
 *
 * Visual:
 * - Tight bedside spacing — no oversized headings inside a chat bubble.
 * - Inherits color from the parent (works on both user & assistant bubbles).
 */
export function MarkdownMessage({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={cn("markdown-msg", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            />
          ),
          p: ({ node: _n, ...props }) => <p {...props} className="my-1 first:mt-0 last:mb-0" />,
          ul: ({ node: _n, ...props }) => (
            <ul {...props} className="my-1 ml-4 list-disc space-y-0.5" />
          ),
          ol: ({ node: _n, ...props }) => (
            <ol {...props} className="my-1 ml-4 list-decimal space-y-0.5" />
          ),
          li: ({ node: _n, ...props }) => <li {...props} className="leading-relaxed" />,
          strong: ({ node: _n, ...props }) => <strong {...props} className="font-semibold" />,
          code: ({ node: _n, ...props }) => (
            <code
              {...props}
              className="rounded bg-black/20 px-1 py-0.5 text-[0.85em] dark:bg-white/10"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
