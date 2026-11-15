import { Component, type ReactNode } from "react";

type Props = { label: string; children: ReactNode };
type State = { failed: boolean };

/**
 * Keeps one misbehaving card (typically an AI reply with missing fields) from
 * blanking the whole screen. Shows a quiet placeholder instead.
 */
export class CardBoundary extends Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State {
    return { failed: true };
  }
  componentDidCatch(err: Error): void {
    try {
      console.error(`[CardBoundary:${this.props.label}]`, err);
    } catch {
      /* noop */
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="status" className="p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{this.props.label} is unavailable right now.</p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="mt-2 text-xs font-semibold text-primary underline"
        >
          Try again
        </button>
      </div>
    );
  }
}
