// TEMP error boundary around the Conversation-style grid. Remove once fixed.
import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; fallback: (err: Error) => ReactNode };
type State = { err: Error | null };

export class ModeGridBoundary extends Component<Props, State> {
  state: State = { err: null };
  static getDerivedStateFromError(err: Error): State {
    return { err };
  }
  componentDidCatch(err: Error): void {
    try { console.error("[ModeGridBoundary]", err); } catch { /* noop */ }
  }
  render() {
    if (this.state.err) return this.props.fallback(this.state.err);
    return this.props.children;
  }
}
