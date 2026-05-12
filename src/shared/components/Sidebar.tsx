import Icon from "./Icon";
import type { View } from "../../types";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "home", tone: "blue" },
  { id: "apply", label: "Customize Job", icon: "spark", tone: "green" },
  { id: "pipeline", label: "Job Pipeline", icon: "layers", tone: "purple" },
  { id: "graph", label: "Knowledge", icon: "graph", tone: "green" },
  { id: "activity", label: "Activity", icon: "pulse", tone: "orange" },
  { id: "profile", label: "Profile", icon: "user", tone: "pink" },
  { id: "ingestion", label: "Add Context", icon: "plus", tone: "teal" },
];

export function Sidebar({
  view,
  setView,
  leadCounts,
  online,
  port,
  beat,
  collapsed,
  onToggleCollapsed,
  onSettings,
  onSetup,
}: {
  view: View;
  setView: (v: View) => void;
  leadCounts: any;
  online: boolean;
  port: number | null;
  beat: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSettings: () => void;
  onSetup?: () => void;
}) {
  return (
    <aside className={"sidebar " + (collapsed ? "collapsed" : "")}>
      <div className="sidebar-brand">
        <div className="row gap-3 sidebar-brand-main">
          <Icon name="logo" size={32} />
          <div className="col sidebar-label" style={{ lineHeight: 1.1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>JustHireMe</div>
            <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: "0.14em", textTransform: "uppercase" }}>v0.1-alpha</div>
          </div>
        </div>
        <button
          className="btn btn-icon sidebar-collapse-btn"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name="arrow-right" size={14} style={{ transform: collapsed ? "none" : "rotate(180deg)" }} />
        </button>
      </div>

      <div className="eyebrow sidebar-section-label">Workspace</div>
      <div className="col gap-1">
        {NAV.map(n => {
          const active = view === n.id;
          const count = n.id === "pipeline" ? leadCounts.total : null;
          return (
            <button
              key={n.id}
              className={"nav-item " + (active ? "active" : "")}
              onClick={() => setView(n.id as View)}
              title={collapsed ? n.label : undefined}
              aria-label={n.label}
            >
              <div
                className="nav-icon"
                style={{
                  background: active ? `var(--${n.tone})` : "var(--paper-3)",
                  color: active ? `var(--${n.tone}-ink)` : "var(--ink-2)",
                }}
              >
                <Icon name={n.icon} size={14} stroke={1.8} />
              </div>
              <span className="nav-label">{n.label}</span>
              {count != null && (
                <span
                  className="mono tabular nav-count"
                  style={{
                    color: active ? `var(--${n.tone}-ink)` : "var(--ink-3)",
                    background: active ? `var(--${n.tone})` : "var(--paper-3)",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="eyebrow sidebar-section-label snapshot-label">Snapshot</div>
      <div className="sidebar-snapshot">
        {[
          ["Ready", "green", leadCounts.approved],
          ["Applied", "orange", leadCounts.applied],
          ["Interview", "pink", leadCounts.interviewing],
        ].map(([label, tone, n]) => (
          <div key={label as string} className="sidebar-snapshot-item" title={`${label}: ${n || 0}`}>
            <div className="mono tabular" style={{ fontSize: 15, fontWeight: 800, color: `var(--${tone}-ink)`, lineHeight: 1 }}>{n || 0}</div>
            <div className="sidebar-snapshot-label">{label}</div>
          </div>
        ))}
      </div>

      <div className="grow" />

      <button className="profile-add-context sidebar-setup" onClick={onSetup} title={collapsed ? "Setup Guide" : undefined} aria-label="Setup Guide">
        <Icon name="spark" size={14} />
        <span className="sidebar-label">Setup Guide</span>
      </button>

      <div className="card-flat sidebar-status">
        <div className="row sidebar-status-row">
          <div className="col sidebar-label" style={{ gap: 2 }}>
            <div className="row gap-2" title={online ? `Online on port ${port}` : "Offline"}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: online ? "var(--ok)" : "var(--bad)",
                  boxShadow: `0 0 0 3px ${online ? "rgba(91,140,68,0.18)" : "rgba(180,69,44,0.18)"}`,
                  animation: online ? "blink 2s ease-in-out infinite" : "none",
                }}
              />
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>{online ? `Online :${port}` : "Offline"}</span>
            </div>
            <span className="mono tabular" style={{ fontSize: 10, color: "var(--ink-3)" }}>beat {beat}</span>
          </div>
          <button className="btn btn-icon" onClick={onSettings} aria-label="Settings" title="Settings"><Icon name="settings" size={15} /></button>
        </div>
      </div>
    </aside>
  );
}
