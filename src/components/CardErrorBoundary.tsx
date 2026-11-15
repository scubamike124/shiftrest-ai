// Keeps one failing card from taking down the whole screen. A card that throws
// while rendering (for example on unexpected AI output) shows a small inline
// notice with a retry instead; every other card keeps working.
import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; label?: string };
type State = { failed: boolean };

export class CardErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(err: Error): void {
    try {
      console.error(`[CardErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, err);
    } catch {
      /* logging must never throw */
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="status" className="flex items-center justify-between gap-3 p-4 text-xs text-muted-foreground">
        <span>This card couldn&apos;t load right now.</span>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="rounded-full border border-border px-3 py-1 text-foreground/80 hover:text-foreground"
        >
          Try again
        </button>
      </div>
    );
  }
}
