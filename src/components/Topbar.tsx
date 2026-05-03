import Icon from "./Icon";
import type { View } from "../types";

export function Topbar({ view }: { view: View }) {
  const titles: Record<View, string> = {
    apply:     "Apply to This Job",
    dashboard: "Command Center",
    inbox:     "Lead Inbox",
    pipeline:  "Job Pipeline",
    graph:     "Knowledge Graph",
    activity:  "Live Activity",
    profile:   "Identity Graph",
    ingestion: "Add Context",
  };
  return (
    <header className="topbar">
      <div className="row gap-3" style={{ flex: 1 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>{titles[view]}</h2>
        <span className="pill mono" style={{ fontSize: 9.5, background: "var(--paper-3)", color: "var(--ink-3)" }}>
          {view.toUpperCase()}
        </span>
      </div>
      {view === "profile" && (
        <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent("profile-export"))}>
          <Icon name="download" size={13} /> Export Graph
        </button>
      )}
    </header>
  );
}

/* ══════════════════════════════════════
   DASHBOARD VIEW
══════════════════════════════════════ */

export const StatCard = ({ tone, label, value, sub, icon }: any) => (
  <div style={{
    background: `var(--${tone}-soft)`,
    border: `1px solid var(--${tone})`,
    borderRadius: 16, padding: 18,
    display: "flex", flexDirection: "column", gap: 12,
    minHeight: 132,
  }}>
    <div style={{
      width: 32, height: 32, borderRadius: 9,
      background: `var(--${tone})`, color: `var(--${tone}-ink)`,
      display: "grid", placeItems: "center",
    }}>
      <Icon name={icon} size={15} />
    </div>
    <div className="col" style={{ gap: 4 }}>
      <div className="display tabular" style={{ fontSize: 40, color: `var(--${tone}-ink)`, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{sub}</div>
    </div>
  </div>
);
