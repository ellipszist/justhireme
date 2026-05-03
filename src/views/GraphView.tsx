import Icon from "../components/Icon";
import type { GraphStats } from "../types";

function PentagonGraph({ stats }: { stats: any[] }) {
  const cx = 130, cy = 125, R = 80;
  const max = Math.max(...stats.map(s => s.count), 1);
  const pts = stats.map((s, i) => {
    const angle = -Math.PI/2 + (i * 2 * Math.PI / 5);
    const r = R * (0.25 + 0.75 * (s.count / max));
    return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, label: s.key, count: s.count, tone: s.tone, fullX: cx + Math.cos(angle) * R, fullY: cy + Math.sin(angle) * R };
  });
  const polyPts = pts.map(p => `${p.x},${p.y}`).join(" ");
  return (
    <svg viewBox="0 0 260 260" style={{ width: "100%", maxWidth: 260, height: "auto" }}>
      <defs>
        <radialGradient id="penta-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#C96442" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#C96442" stopOpacity="0.12" />
        </radialGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map(s => (
        <polygon key={s} points={pts.map((_p,i) => {
          const angle = -Math.PI/2 + (i * 2 * Math.PI / 5);
          return `${cx + Math.cos(angle) * R * s},${cy + Math.sin(angle) * R * s}`;
        }).join(" ")} fill="none" stroke="var(--line)" strokeWidth="1" />
      ))}
      {pts.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.fullX} y2={p.fullY} stroke="var(--line)" strokeWidth="1" />
      ))}
      <polygon points={polyPts} fill="url(#penta-fill)" stroke="var(--accent)" strokeWidth="1.5" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="6" fill={`var(--${p.tone})`} stroke={`var(--${p.tone}-ink)`} strokeWidth="1.5" />
        </g>
      ))}
      {pts.map((p, i) => {
        const angle = -Math.PI/2 + (i * 2 * Math.PI / 5);
        const lx = cx + Math.cos(angle) * (R + 28);
        const ly = cy + Math.sin(angle) * (R + 28);
        return (
          <g key={"lbl"+i}>
            <text x={lx} y={ly - 2} textAnchor="middle" style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, fill: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600 }}>{p.label}</text>
            <text x={lx} y={ly + 11} textAnchor="middle" style={{ fontFamily: "var(--font-display)", fontSize: 16, fill: "var(--ink)", fontWeight: 400 }}>{p.count}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ══════════════════════════════════════
   GRAPH VIEW
══════════════════════════════════════ */

export function GraphView({ stats }: { stats: GraphStats }) {
  const mappedStats = [
    { key: "JobLead",    count: stats.joblead ?? 0,    tone: "blue" },
    { key: "Candidate",  count: stats.candidate ?? 0,  tone: "purple" },
    { key: "Skill",      count: stats.skill ?? 0,      tone: "orange" },
    { key: "Experience", count: stats.experience ?? 0, tone: "green" },
    { key: "Project",    count: stats.project ?? 0,    tone: "pink" },
  ];
  const total = mappedStats.reduce((s, x) => s + x.count, 0);
  const evidence = (stats.skill ?? 0) + (stats.experience ?? 0) + (stats.project ?? 0);
  const nodeCopy: Record<string, { label: string; detail: string; icon: string }> = {
    Candidate:  { label: "Candidate", detail: "Root profile", icon: "user" },
    Skill:      { label: "Skills", detail: "Tools and capabilities", icon: "spark" },
    Experience: { label: "Experience", detail: "Roles and companies", icon: "brief" },
    Project:    { label: "Projects", detail: "Proof of work", icon: "layers" },
    JobLead:    { label: "Job Leads", detail: "Openings in scope", icon: "search" },
  };
  return (
    <div className="scroll graph-page">
      <div className="graph-shell">
        <div className="card graph-overview">
          <div className="graph-overview-copy">
            <span className="eyebrow">Local kuzu graph</span>
            <h1 style={{ fontSize: 34 }}>Knowledge Map</h1>
            <p>Candidate evidence, job leads, and project proof in one local graph.</p>
          </div>
          <div className="graph-overview-stats">
            <div>
              <span className="eyebrow">Total nodes</span>
              <div className="display tabular graph-total">{total}</div>
            </div>
            <div className="graph-mini-stats">
              <div><span>{evidence}</span><small>Evidence nodes</small></div>
              <div><span>{stats.joblead ?? 0}</span><small>Job leads</small></div>
            </div>
          </div>
        </div>

        <div className="graph-layout">
          <div className="card graph-topology-card">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", width: "100%" }}>
              <div>
                <h3 style={{ marginBottom: 4 }}>Topology</h3>
                <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>5-vertex schema</div>
              </div>
              <span className="pill mono" style={{ background: "var(--green-soft)", color: "var(--green-ink)", border: "1px solid var(--green)" }}>live</span>
            </div>
            <PentagonGraph stats={mappedStats} />
          </div>

          <div className="graph-node-list">
            {mappedStats.map(s => {
              const copy = nodeCopy[s.key];
              const pct = total ? Math.round((s.count / total) * 100) : 0;
              return (
                <div key={s.key} className="card-flat graph-node-card">
                  <div className="graph-node-icon" style={{ background: `var(--${s.tone}-soft)`, color: `var(--${s.tone}-ink)` }}>
                    <Icon name={copy.icon} size={16} />
                  </div>
                  <div className="graph-node-main">
                    <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{copy.label}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{copy.detail}</div>
                      </div>
                      <div className="display tabular" style={{ fontSize: 34, color: `var(--${s.tone}-ink)` }}>{s.count}</div>
                    </div>
                    <div className="graph-node-meter"><span style={{ width: `${pct}%`, background: `var(--${s.tone})` }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   ACTIVITY VIEW
══════════════════════════════════════ */
