import Icon from "./Icon";
import type { View } from "../types";

const NAV = [
  { id: "apply",     label: "Customize",     icon: "spark",  tone: "green"  },
  { id: "dashboard", label: "Dashboard",     icon: "home",   tone: "blue"   },
  { id: "inbox",     label: "Leads",         icon: "plus",   tone: "orange" },
  { id: "pipeline",  label: "Job Pipeline",  icon: "layers", tone: "purple" },
  { id: "graph",     label: "Knowledge",     icon: "graph",  tone: "green"  },
  { id: "activity",  label: "Activity",      icon: "pulse",  tone: "orange" },
  { id: "profile",   label: "Profile",       icon: "user",   tone: "pink"   },
  { id: "ingestion", label: "Add Context",   icon: "plus",   tone: "teal"   },
];

export function Sidebar({ view, setView, leadCounts, online, port, beat, onSettings, onSetup }: {
  view: View; setView: (v: View) => void;
  leadCounts: any; online: boolean; port: number | null; beat: number;
  onSettings: () => void;
  onSetup?: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="row gap-3" style={{ padding: "4px 8px 18px 8px" }}>
        <Icon name="logo" size={32} />
        <div className="col" style={{ lineHeight: 1.1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>JustHireMe</div>
          <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: "0.14em", textTransform: "uppercase" }}>v0.1-alpha</div>
        </div>
      </div>

      <div className="eyebrow" style={{ padding: "0 12px", marginBottom: 4 }}>Workspace</div>
      <div className="col gap-1">
        {NAV.map(n => {
          const active = view === n.id;
          const count = n.id === "pipeline" ? leadCounts.total : null;
          return (
            <div key={n.id} className={"nav-item " + (active ? "active" : "")} onClick={() => setView(n.id as View)}>
              <div className="nav-icon" style={{
                background: active ? `var(--${n.tone})` : "var(--paper-3)",
                color: active ? `var(--${n.tone}-ink)` : "var(--ink-2)",
              }}>
                <Icon name={n.icon} size={14} stroke={1.8} />
              </div>
              <span style={{ flex: 1 }}>{n.label}</span>
              {count != null && (
                <span className="mono tabular" style={{
                  fontSize: 10.5, fontWeight: 600,
                  color: active ? `var(--${n.tone}-ink)` : "var(--ink-3)",
                  background: active ? `var(--${n.tone})` : "var(--paper-3)",
                  padding: "2px 7px", borderRadius: 999,
                }}>{count}</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="eyebrow" style={{ padding: "16px 12px 4px 12px" }}>Status breakdown</div>
      <div className="col gap-1">
        {[
          ["evaluating",   "Evaluating",   "yellow",  leadCounts.evaluating],
          ["approved",     "Approved",     "green",   leadCounts.approved],
          ["applied",      "Applied",      "orange",  leadCounts.applied],
          ["interviewing", "Interviewing", "pink",    leadCounts.interviewing],
          ["accepted",     "Accepted",     "teal",    leadCounts.accepted],
          ["rejected",     "Rejected",     "red",     leadCounts.rejected],
        ].map(([k, label, tone, n]) => (
          <div key={k} className="row" style={{
            padding: "7px 12px", fontSize: 12, color: "var(--ink-2)", justifyContent: "space-between",
            borderRadius: 8,
          }}>
            <div className="row gap-2">
              <span style={{ width: 8, height: 8, borderRadius: 3, background: `var(--${tone})`, border: `1px solid var(--${tone}-ink)`, opacity: 0.85 }} />
              <span>{label}</span>
            </div>
            <span className="mono tabular" style={{ color: "var(--ink-3)", fontSize: 11 }}>{n || 0}</span>
          </div>
        ))}
      </div>

      <div className="grow" />

      <button className="profile-add-context" onClick={onSetup} style={{ marginBottom: 10, minHeight: 44 }}>
        <Icon name="spark" size={14} /> Setup Guide
      </button>

      <div className="card-flat" style={{ padding: 10, background: "var(--card)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="col" style={{ gap: 2 }}>
            <div className="row gap-2">
              <span style={{
                width: 7, height: 7, borderRadius: "50%",
                background: online ? "var(--ok)" : "var(--bad)",
                boxShadow: `0 0 0 3px ${online ? 'rgba(91,140,68,0.18)' : 'rgba(180,69,44,0.18)'}`,
                animation: online ? "blink 2s ease-in-out infinite" : "none",
              }} />
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>{online ? `Online · :${port}` : "Offline"}</span>
            </div>
            <span className="mono tabular" style={{ fontSize: 10, color: "var(--ink-3)" }}>♥ {beat}</span>
          </div>
          <button className="btn btn-icon" onClick={onSettings} aria-label="Settings"><Icon name="settings" size={15} /></button>
        </div>
      </div>
    </aside>
  );
}

/* ══════════════════════════════════════
   TOPBAR
══════════════════════════════════════ */
