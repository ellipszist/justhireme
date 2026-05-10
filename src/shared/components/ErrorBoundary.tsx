import React from "react";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label: string; api?: (path: string, opts?: RequestInit) => Promise<Response> },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(e: Error) {
    return { error: e };
  }

  componentDidCatch(e: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label}]`, e, info);
    this.props.api?.("/api/v1/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: e.message,
        stack: e.stack,
        component: info.componentStack,
        label: this.props.label,
      }),
    }).catch(() => {});
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", height: "100%", gap: 12, opacity: 0.6,
        }}>
          <p style={{ margin: 0, fontSize: 14 }}>
            {this.props.label} failed to load.
          </p>
          <button onClick={() => this.setState({ error: null })}
            style={{ fontSize: 12 }}>
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
