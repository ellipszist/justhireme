import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { motion, AnimatePresence } from "framer-motion";
import SettingsModal from "./SettingsModal";
import Icon from "./components/Icon";
import "./index.css";

// Types
type ConnSt = "disconnected" | "connecting" | "connected";
type View = "dashboard" | "pipeline" | "graph" | "activity" | "profile" | "ingestion";
type PipelineTab = "found" | "evaluated" | "generated" | "applied" | "discarded";

interface Lead {
  job_id: string; title: string; company: string;
  url: string; platform: string; status: string; asset: string;
  resume_asset?: string; cover_letter_asset?: string; selected_projects?: string[];
  score: number; reason: string; match_points: string[]; gaps?: string[];
  description?: string;
  events?: { action: string; ts: string }[];
}
interface GraphStats {
  candidate: number; skill: number; project: number;
  experience: number; joblead: number;
}
interface LogLine {
  id: number; ts: string; msg: string; src: string;
  kind: "heartbeat" | "agent" | "system";
}

// Helpers
const getMark = (company: string) => company ? company.charAt(0).toUpperCase() : "?";
const getTone = (status: string) => {
  switch (status) {
    case "discovered":   return "blue";
    case "evaluating":   return "yellow";
    case "tailoring":    return "purple";
    case "approved":     return "green";
    case "applied":      return "orange";
    case "interviewing": return "pink";
    case "rejected":     return "red";
    case "accepted":     return "teal";
    case "discarded":    return "red";
    default: return "blue";
  }
};

/* ══════════════════════════════════════
   HOOKS
══════════════════════════════════════ */

function useWS() {
  const [conn, setConn] = useState<ConnSt>("disconnected");
  const [port, setPort] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [beat, setBeat] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const idRef = useRef(0);

  const addLog = useCallback((msg: string, kind: LogLine["kind"], src = "sys") => {
    setLogs(p => [
      { id: idRef.current++, ts: String(idRef.current).padStart(4, "0"), msg, src, kind },
      ...p.slice(0, 149),
    ]);
  }, []);

  const connect = useCallback((p: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setConn("connecting");
    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`);
    wsRef.current = ws;
    ws.onopen    = () => { setConn("connected"); addLog("WebSocket connected", "system", "ws"); };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "heartbeat") {
          setBeat(d.beat);
          if (d.beat % 10 === 1)
            addLog(`Heartbeat #${d.beat} — uptime ${d.uptime_seconds.toFixed(0)}s`, "heartbeat", "hb");
        } else if (d.type === "agent") {
          addLog(d.msg ?? d.event, "agent", d.event ?? "agent");
          if (d.event === "eval_done") window.dispatchEvent(new CustomEvent("scan-done"));
        } else if (d.type === "LEAD_UPDATED" && d.data) {
          window.dispatchEvent(new CustomEvent("lead-updated", { detail: d.data }));
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => { setConn("disconnected"); wsRef.current = null; setTimeout(() => connect(p), 3000); };
    ws.onerror = () => ws.close();
  }, [addLog]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try { const p = await invoke<number>("get_sidecar_port"); setPort(p); connect(p); } catch { /* not ready */ }
      unlisten = await listen<number>("sidecar-port", ev => { setPort(ev.payload); connect(ev.payload); });
    })();
    return () => { unlisten?.(); wsRef.current?.close(); };
  }, [connect]);

  return { conn, port, logs, beat, addLog };
}

function useLeads(port: number | null, addLog?: (msg: string, kind: LogLine["kind"], src?: string) => void) {
  const [leads, setLeads] = useState<Lead[]>([]);
  useEffect(() => {
    if (!port) return;
    const load = () => fetch(`http://127.0.0.1:${port}/api/v1/leads`).then(r => r.json()).then(setLeads).catch(() => {});
    load();

    // Keep leads fresh when backend broadcasts LEAD_UPDATED over WS
    const onLeadUpdated = (e: Event) => {
      const updated = (e as CustomEvent<Lead>).detail;
      setLeads(prev => {
        const idx = prev.findIndex(l => l.job_id === updated.job_id);
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = { ...next[idx], ...updated };
        return next;
      });
    };
    window.addEventListener("lead-updated", onLeadUpdated);

    fetch(`http://127.0.0.1:${port}/api/v1/events?limit=200`)
      .then(r => r.json())
      .then((evts: {job_id: string; action: string; ts: string}[]) => {
        evts.forEach(ev => {
          addLog?.(`[${ev.job_id?.slice(0,8) ?? 'sys'}] ${ev.action}`, "agent", "history");
        });
      })
      .catch(() => {});
    const t = setInterval(load, 5000);
    return () => { clearInterval(t); window.removeEventListener("lead-updated", onLeadUpdated); };
  }, [port]);
  return { leads, setLeads };
}

function useGraphStats(port: number | null) {
  const [stats, setStats] = useState<GraphStats>({ candidate: 0, skill: 0, project: 0, experience: 0, joblead: 0 });
  useEffect(() => {
    if (!port) return;
    const load = () => fetch(`http://127.0.0.1:${port}/api/v1/graph`).then(r => r.json()).then(setStats).catch(() => {});
    load(); const t = setInterval(load, 10000); return () => clearInterval(t);
  }, [port]);
  return stats;
}

/* ══════════════════════════════════════
   SIDEBAR
══════════════════════════════════════ */

const NAV = [
  { id: "dashboard", label: "Dashboard",     icon: "home",   tone: "blue"   },
  { id: "pipeline",  label: "Job Pipeline",  icon: "layers", tone: "purple" },
  { id: "graph",     label: "Knowledge",     icon: "graph",  tone: "green"  },
  { id: "activity",  label: "Activity",      icon: "pulse",  tone: "orange" },
  { id: "profile",   label: "Identity Graph",icon: "user",   tone: "pink"   },
  { id: "ingestion", label: "Add Context",   icon: "plus",   tone: "teal"   },
];

function Sidebar({ view, setView, leadCounts, online, port, beat, onSettings }: {
  view: View; setView: (v: View) => void;
  leadCounts: any; online: boolean; port: number | null; beat: number;
  onSettings: () => void;
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

function Topbar({ view }: { view: View }) {
  const titles: Record<View, string> = {
    dashboard: "Command Center",
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
    </header>
  );
}

/* ══════════════════════════════════════
   DASHBOARD VIEW
══════════════════════════════════════ */

const StatCard = ({ tone, label, value, sub, icon }: any) => (
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

function DashboardView({ leads, logs, setView, openDrawer, scanning, onScan, onStopScan, scanErr }: {
  leads: Lead[]; logs: LogLine[]; setView: (v: View) => void; openDrawer: (l: Lead) => void;
  scanning: boolean; onScan: () => void; onStopScan: () => void; scanErr: string | null;
}) {
  const counts = {
    total:      leads.length,
    discovered: leads.filter(l=>l.status==="discovered").length,
    evaluated:  leads.filter(l=>l.score > 0).length,
    tailoring:  leads.filter(l=>l.status==="tailoring").length,
    approved:   leads.filter(l=>l.status==="approved").length,
    applied:    leads.filter(l=>l.status==="applied").length,
  };
  const topMatches = [...leads].filter(l => l.score > 0).sort((a,b) => b.score - a.score).slice(0, 4);

  return (
    <div className="scroll" style={{ padding: 24, flex: 1, height: "100%", minHeight: 0 }}>
      <div className="card" style={{ padding: "26px 28px", marginBottom: 18, background: "linear-gradient(135deg, var(--orange-soft) 0%, var(--pink-soft) 60%, var(--purple-soft) 100%)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
          <div className="col gap-3" style={{ maxWidth: 560 }}>
            <span className="eyebrow">Agent Online</span>
            <h1 style={{ fontSize: 52 }}>The hunt is <span className="italic-serif" style={{ color: "var(--ink-2)" }}>on.</span></h1>
            <div style={{ fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.55, maxWidth: 480 }}>
              Scanned <b>{leads.length} leads</b>, evaluated <b>{counts.evaluated}</b> with scores, tailored <b>{counts.tailoring + counts.approved} resumes</b>.
            </div>
            <div className="row gap-2" style={{ marginTop: 6 }}>
              <button onClick={onScan} disabled={scanning} style={{
                padding: "10px 22px", borderRadius: 12, fontSize: 12, fontWeight: 700,
                letterSpacing: "0.12em", textTransform: "uppercase", cursor: scanning ? "wait" : "pointer",
                background: scanning ? "var(--ink-4)" : "var(--ink)",
                color: "var(--paper)", border: "1px solid var(--ink-3)",
                transition: "all .2s ease", display: "flex", alignItems: "center", gap: 8,
              }}>
                {scanning ? <><span className="dot pulse-soft" /> SCAN IN PROGRESS...</> : <><Icon name="spark" size={13} /> INITIATE AUTONOMOUS SCAN</>}
              </button>
              {scanning && (
                <button onClick={onStopScan} style={{
                  padding: "10px 18px", borderRadius: 12, fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer",
                  background: "var(--bad-soft)", color: "var(--bad)", border: "1px solid var(--bad)",
                  transition: "all .2s ease", display: "flex", alignItems: "center", gap: 7,
                }}>
                  <Icon name="x" size={13} color="var(--bad)" /> STOP SCAN
                </button>
              )}
              <button className="btn btn-accent" onClick={() => setView("pipeline")}>Open pipeline <Icon name="arrow-right" size={13} /></button>
              <button className="btn" onClick={() => setView("activity")}><Icon name="pulse" size={13} /> Live activity</button>
            </div>
            {scanErr && <div style={{ marginTop: 6, fontSize: 12, color: "var(--bad)", fontWeight: 500 }}>⚠ {scanErr}</div>}
          </div>
          <div className="col gap-2" style={{ width: 300 }}>
            <div className="eyebrow" style={{ marginBottom: 2 }}>Top matches awaiting review</div>
            {topMatches.length === 0 ? (
              <div className="card-flat" style={{ padding: 14, fontSize: 12, color: "var(--ink-3)" }}>Run a scan to find matches.</div>
            ) : topMatches.map(l => (
              <div key={l.job_id} onClick={() => openDrawer(l)} className="lift" style={{
                background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12,
                padding: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: `var(--${getTone(l.status)})`, color: `var(--${getTone(l.status)}-ink)`,
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500,
                  border: `1px solid var(--${getTone(l.status)}-ink)`,
                }}>{getMark(l.company)}</div>
                <div className="col" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{l.company}</div>
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                  background: l.score >= 85 ? "var(--green)" : l.score >= 50 ? "var(--yellow)" : "var(--bad-soft)",
                  color: l.score >= 85 ? "var(--green-ink)" : l.score >= 50 ? "var(--yellow-ink)" : "var(--bad)",
                }}>{l.score}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
        <StatCard tone="blue"   label="Leads found"      value={counts.discovered} sub="Awaiting eval"   icon="layers" />
        <StatCard tone="yellow" label="Evaluated"         value={counts.evaluated}  sub="Non-zero scores" icon="spark"  />
        <StatCard tone="purple" label="Resumes tailored"  value={counts.tailoring}  sub="PDFs cached"     icon="file"   />
        <StatCard tone="green"  label="Awaiting approval" value={counts.approved}   sub="Ready to fire"   icon="check"  />
        <StatCard tone="orange" label="Applications sent" value={counts.applied}    sub="Success"         icon="arrow-up" />
      </div>

      <div className="card" style={{ padding: 18, background: "var(--yellow-soft)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3>Recent agent events</h3>
          <button className="btn btn-ghost" onClick={() => setView("activity")} style={{ fontSize: 12 }}>See all <Icon name="arrow-right" size={12} /></button>
        </div>
        <div className="col gap-1" style={{ fontSize: 12 }}>
          {logs.slice(0, 6).map((ln, i) => {
            const tone = ln.kind === "heartbeat" ? "blue" : ln.kind === "agent" ? "green" : "yellow";
            return (
              <div key={ln.id} className="row gap-3" style={{ padding: "7px 10px", borderRadius: 8, background: i === 0 ? "var(--card)" : "transparent" }}>
                <span className="mono tabular" style={{ fontSize: 10, color: "var(--ink-3)", minWidth: 50 }}>{ln.ts}</span>
                <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: `var(--${tone})`, color: `var(--${tone}-ink)`, textTransform: "uppercase", letterSpacing: "0.08em" }}>{ln.kind}</span>
                <span style={{ fontSize: 12, flex: 1, color: "var(--ink-2)" }}>{ln.msg}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   JOB CARD (shared across tabs)
══════════════════════════════════════ */

function JobCard({ lead, onOpen, onDelete, showScore = false, showGenerate = false, port }: {
  lead: Lead;
  onOpen: (l: Lead) => void;
  onDelete: (id: string) => void;
  showScore?: boolean;
  showGenerate?: boolean;
  port?: number | null;
}) {
  const [generating, setGenerating] = useState(false);
  const desc = lead.description?.trim();

  const handleGenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!port) return;
    setGenerating(true);
    await fetch(`http://127.0.0.1:${port}/api/v1/leads/${lead.job_id}/generate`, { method: "POST" });
    setTimeout(() => setGenerating(false), 2000);
  };

  return (
    <div className="card lift" style={{
      padding: 16, cursor: "pointer", border: "1px solid var(--line)",
      background: "var(--card)", display: "flex", flexDirection: "column", gap: 10,
    }} onClick={() => onOpen(lead)}>
      {/* Header row */}
      <div className="row gap-3" style={{ alignItems: "flex-start" }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: `var(--${getTone(lead.status)})`, color: `var(--${getTone(lead.status)}-ink)`,
          display: "grid", placeItems: "center",
          fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 500,
          border: `1px solid var(--${getTone(lead.status)}-ink)`,
        }}>{getMark(lead.company)}</div>
        <div className="col" style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25, color: "var(--ink)" }}>{lead.title}</div>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{lead.company}</span>
            <span style={{ color: "var(--ink-4)", fontSize: 10 }}>·</span>
            <span className="pill mono" style={{ fontSize: 8.5, padding: "1px 6px" }}>{lead.platform}</span>
          </div>
        </div>
        {/* Score badge */}
        {showScore && lead.score > 0 && (
          <span style={{
            flexShrink: 0, fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
            background: lead.score >= 85 ? "var(--green)" : lead.score >= 50 ? "var(--yellow)" : "var(--bad-soft)",
            color:      lead.score >= 85 ? "var(--green-ink)" : lead.score >= 50 ? "var(--yellow-ink)" : "var(--bad)",
          }}>{lead.score}%</span>
        )}
        {/* Delete button */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(lead.job_id); }}
          title="Remove"
          style={{
            flexShrink: 0, width: 26, height: 26, borderRadius: 7,
            border: "1px solid var(--line)", background: "var(--paper)",
            color: "var(--bad)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, lineHeight: 1, padding: 0, opacity: 0.7,
            transition: "opacity 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "0.7")}
        >×</button>
      </div>

      {/* Description */}
      {desc ? (
        <div style={{
          fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55,
          display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
          overflow: "hidden",
          background: "var(--paper-3)", borderRadius: 8, padding: "8px 10px",
          border: "1px solid var(--line)",
        }}>{desc}</div>
      ) : (
        <div style={{ fontSize: 11.5, color: "var(--ink-4)", fontStyle: "italic" }}>No description extracted.</div>
      )}

      {/* Evaluator reason (for Evaluated tab) */}
      {showScore && lead.reason && (
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5, borderLeft: "2px solid var(--line)", paddingLeft: 8 }}>
          {lead.reason.slice(0, 160)}{lead.reason.length > 160 ? "…" : ""}
        </div>
      )}

      {/* Footer */}
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
        <button
          onClick={e => { e.stopPropagation(); openUrl(lead.url); }}
          title={lead.url}
          style={{ fontSize: 11, color: "var(--teal)", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          <Icon name="external-link" size={11} color="var(--teal)" />
          {lead.url.replace(/^https?:\/\//, "").slice(0, 50)}
        </button>
        <div className="row gap-2">
          {showGenerate && (
            <button
              onClick={handleGenerate}
              disabled={generating}
              style={{
                padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
                border: "1px solid var(--purple)", background: "var(--purple-soft)",
                color: "var(--purple-ink)", cursor: generating ? "wait" : "pointer",
              }}
            >{generating ? "Queued..." : "Generate Package"}</button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onOpen(lead); }}
            style={{
              padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
              border: "1px solid var(--line)", background: "var(--paper)",
              color: "var(--ink-2)", cursor: "pointer",
            }}
          >Details →</button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   PIPELINE VIEW (tabbed)
══════════════════════════════════════ */

function PipelineView({ leads, openDrawer, deleteLead, port }: {
  leads: Lead[]; openDrawer: (l: Lead) => void;
  deleteLead: (id: string) => void; port: number | null;
}) {
  const [tab, setTab] = useState<PipelineTab>("found");
  const [search, setSearch] = useState("");
  const [bulkSelecting, setBulkSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = search.toLowerCase();
  const filter = (arr: Lead[]) =>
    q ? arr.filter(l =>
      l.title.toLowerCase().includes(q) ||
      l.company.toLowerCase().includes(q) ||
      (l.description || "").toLowerCase().includes(q)
    ) : arr;

  const tabs: { id: PipelineTab; label: string; tone: string; leads: Lead[] }[] = [
    {
      id: "found",
      label: "Found",
      tone: "blue",
      leads: filter(leads.filter(l => l.status === "discovered")),
    },
    {
      id: "evaluated",
      label: "Evaluated",
      tone: "yellow",
      leads: filter([...leads.filter(l => l.score > 0)].sort((a, b) => b.score - a.score)),
    },
    {
      id: "generated",
      label: "Generated",
      tone: "purple",
      leads: filter(leads.filter(l => l.status === "tailoring" || l.status === "approved")),
    },
    {
      id: "applied",
      label: "Active",
      tone: "orange",
      leads: filter(leads.filter(l => ["applied", "interviewing", "accepted", "rejected"].includes(l.status))),
    },
    {
      id: "discarded",
      label: "Discarded",
      tone: "red",
      leads: filter(leads.filter(l => l.status === "discarded")),
    },
  ];

  const activeTab = tabs.find(t => t.id === tab)!;

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} leads?`)) return;
    for (const id of selected) await deleteLead(id);
    setSelected(new Set());
    setBulkSelecting(false);
  };

  return (
    <div className="col" style={{ flex: 1, height: "100%", minHeight: 0, overflow: "hidden" }}>
      {/* Tab bar + search */}
      <div style={{
        padding: "14px 20px 0", borderBottom: "1px solid var(--line)",
        background: "var(--paper)", flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="row gap-1">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setBulkSelecting(false); setSelected(new Set()); }}
                style={{
                  padding: "7px 14px", borderRadius: "10px 10px 0 0", fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.06em", textTransform: "uppercase", cursor: "pointer",
                  border: "1px solid var(--line)", borderBottom: tab === t.id ? "1px solid var(--paper)" : "1px solid var(--line)",
                  background: tab === t.id ? "var(--paper)" : "var(--paper-3)",
                  color: tab === t.id ? `var(--${t.tone}-ink)` : "var(--ink-3)",
                  marginBottom: tab === t.id ? -1 : 0,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {t.label}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
                  background: tab === t.id ? `var(--${t.tone})` : "var(--paper-3)",
                  color: tab === t.id ? `var(--${t.tone}-ink)` : "var(--ink-4)",
                }}>{t.leads.length}</span>
              </button>
            ))}
          </div>

          <div className="row gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search title, company, description…"
              style={{
                padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)",
                background: "var(--paper-3)", fontSize: 12, color: "var(--ink)",
                width: 240, outline: "none",
              }}
            />
            {tab === "discarded" && (
              bulkSelecting ? (
                <div className="row gap-2">
                  <button onClick={bulkDelete} disabled={selected.size === 0}
                    style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, background: "var(--bad)", color: "#fff", border: "none", cursor: "pointer" }}>
                    Delete {selected.size} selected
                  </button>
                  <button onClick={() => { setBulkSelecting(false); setSelected(new Set()); }}
                    style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, border: "1px solid var(--line)", background: "var(--paper)", cursor: "pointer", color: "var(--ink-2)" }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setBulkSelecting(true)}
                  style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "1px solid var(--bad)", background: "var(--bad-soft)", color: "var(--bad)", cursor: "pointer" }}>
                  Bulk delete
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="scroll" style={{ flex: 1, padding: 20, minHeight: 0 }}>
        {activeTab.leads.length === 0 ? (
          <div style={{
            padding: "64px 24px", textAlign: "center",
            border: "1px dashed var(--line)", borderRadius: 16,
            color: "var(--ink-4)", fontSize: 13,
          }}>
            {search ? `No results for "${search}"` : `No ${activeTab.label.toLowerCase()} jobs yet.`}
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
            gap: 14,
          }}>
            {activeTab.leads.map(lead => (
              <div key={lead.job_id} style={{ position: "relative" }}>
                {bulkSelecting && tab === "discarded" && (
                  <div
                    onClick={() => toggleSelect(lead.job_id)}
                    style={{
                      position: "absolute", top: 10, left: 10, zIndex: 5,
                      width: 18, height: 18, borderRadius: 5,
                      border: `2px solid ${selected.has(lead.job_id) ? "var(--bad)" : "var(--line)"}`,
                      background: selected.has(lead.job_id) ? "var(--bad)" : "var(--paper)",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {selected.has(lead.job_id) && <span style={{ color: "#fff", fontSize: 11, lineHeight: 1 }}>✓</span>}
                  </div>
                )}
                <JobCard
                  lead={lead}
                  onOpen={openDrawer}
                  onDelete={deleteLead}
                  showScore={tab === "evaluated" || tab === "generated" || tab === "applied"}
                  showGenerate={tab === "evaluated"}
                  port={port}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   PENTAGON GRAPH COMPONENT
══════════════════════════════════════ */

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

function GraphView({ stats }: { stats: GraphStats }) {
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

function ActivityView({ logs }: { logs: LogLine[] }) {
  const [actTab, setActTab] = useState<"all"|"scout"|"eval"|"apply"|"system">("all");
  return (
    <div className="scroll" style={{ padding: 24, flex: 1, height: "100%", minHeight: 0 }}>
      <div style={{display:"flex", gap:6, marginBottom:16, flexWrap:"wrap"}}>
        {(["all","scout","eval","apply","system"] as const).map(tab => (
          <button key={tab} onClick={() => setActTab(tab)} style={{
            padding:"5px 14px", borderRadius:999, fontSize:11, fontWeight:700,
            letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer",
            border: actTab === tab ? "none" : "1px solid var(--line)",
            background: actTab === tab ? "var(--ink)" : "var(--paper)",
            color: actTab === tab ? "var(--card)" : "var(--ink-3)",
            transition:"all 0.15s ease",
          }}>
            {tab === "all" ? "All" : tab === "scout" ? "Scout" : tab === "eval" ? "Eval" : tab === "apply" ? "Apply" : "System"}
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: "26px 28px", marginBottom: 18, background: "var(--orange-soft)" }}>
        <span className="eyebrow">Real-time stream</span>
        <h1 style={{ fontSize: 44 }}>What is the agent <span className="italic-serif">thinking?</span></h1>
      </div>
      <div className="card" style={{ padding: 18, background: "var(--purple-soft)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3>Stream</h3>
          <span className="pill" style={{ background: "var(--green)", color: "var(--green-ink)" }}>
            <span className="dot pulse-soft" /> live
          </span>
        </div>
        <div style={{ height: 440, display: "flex" }}>
          <div className="scroll terminal" style={{ background: "#1F1A14", color: "#EFE7D6", borderRadius: 12, padding: "14px 16px", flex: 1 }}>
            {logs.filter(l => {
              if (actTab === "all") return l.kind !== "heartbeat";
              if (actTab === "scout") return l.src === "scout" || (l.kind === "agent" && l.msg.toLowerCase().includes("scout"));
              if (actTab === "eval")  return l.src === "eval"  || (l.kind === "agent" && (l.msg.toLowerCase().includes("eval") || l.msg.toLowerCase().includes("scor")));
              if (actTab === "apply") return l.src === "apply" || (l.kind === "agent" && (l.msg.toLowerCase().includes("apply") || l.msg.toLowerCase().includes("fire") || l.msg.toLowerCase().includes("generat")));
              if (actTab === "system") return l.kind === "system";
              return true;
            }).map((ln) => {
              const tone = ln.kind === "heartbeat" ? "blue" : ln.kind === "agent" ? "green" : "yellow";
              return (
                <div key={ln.id} className="row gap-3" style={{ marginBottom: 5, alignItems: "baseline" }}>
                  <span className="mono tabular" style={{ color: "#7A6F62", fontSize: 10.5, minWidth: 50 }}>{ln.ts}</span>
                  <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", padding: "1px 6px", borderRadius: 4, background: `var(--${tone})`, color: `var(--${tone}-ink)`, minWidth: 42, textAlign: "center" }}>{ln.kind}</span>
                  <span style={{ color: "#B5AC9D", fontSize: 11 }}>{ln.src}</span>
                  <span style={{ flex: 1 }}>{ln.msg}</span>
                </div>
              );
            })}
            <div className="row gap-2" style={{ marginTop: 4 }}>
              <span style={{ color: "var(--accent)" }}>›</span>
              <span className="blink">▌</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   PROFILE VIEW
══════════════════════════════════════ */

const stackItems = (stack: any): string[] =>
  (Array.isArray(stack) ? stack : String(stack || "").split(","))
    .map((s: string) => s.trim())
    .filter(Boolean);

function ProfileView({ port, setView }: { port: number; setView: (v: View) => void }) {
  const [profile, setProfile] = useState<any>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [editingCandidate, setEditingCandidate] = useState(false);
  const [candForm, setCandForm] = useState({ n: "", s: "" });

  const fetchProfile = useCallback(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/profile`);
      setProfile(await r.json());
    } catch { /* ignore */ }
  }, [port]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const deleteItem = async (type: string, id: string) => {
    if (!window.confirm("Delete this item?")) return;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/profile/${type}/${id}`, { method: "DELETE" });
      if (!res.ok) console.error("Delete failed:", res.status);
    } catch (err) {
      console.error("Delete error:", err);
    }
    await fetchProfile();
  };

  const saveEdit = async (type: string, id: string) => {
    await fetch(`http://127.0.0.1:${port}/api/v1/profile/${type}/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editData),
    });
    setEditId(null); fetchProfile();
  };

  const saveCandidate = async () => {
    await fetch(`http://127.0.0.1:${port}/api/v1/profile/candidate`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candForm),
    });
    setEditingCandidate(false); fetchProfile();
  };

  const skills = profile?.skills || [];
  const exp = profile?.exp || [];
  const projects = profile?.projects || [];
  const evidenceCount = skills.length + exp.length + projects.length;
  const topStacks = Array.from(new Set<string>(projects.flatMap((p: any) => stackItems(p.stack)))).slice(0, 10);
  const visibleStacks = topStacks.slice(0, 6);

  return (
    <div className="scroll profile-page">
      <div className="profile-shell">
        <div className="profile-hero">
          <div className="card profile-identity-card">
            <div className="profile-identity-head">
              <div className="profile-avatar">{(profile?.n || "C").slice(0, 1).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="eyebrow">Identity Context</span>
                <h1 style={{ fontSize: 34, marginTop: 4, overflowWrap: "anywhere" }}>{profile?.n || "Candidate Profile"}</h1>
              </div>
              {!editingCandidate && (
                <button className="btn" onClick={() => { setEditingCandidate(true); setCandForm({ n: profile?.n || "", s: profile?.s || "" }); }}>
                  <Icon name="edit" size={13} /> Edit
                </button>
              )}
            </div>

          {editingCandidate ? (
            <div className="col gap-3" style={{ marginTop: 18 }}>
              <input className="field-input" placeholder="Your full name" value={candForm.n} onChange={e => setCandForm({ ...candForm, n: e.target.value })} style={{ fontSize: 18, fontWeight: 600 }} />
              <textarea className="field-input" placeholder="Professional summary / target role - agents use this for scoring" rows={4} value={candForm.s} onChange={e => setCandForm({ ...candForm, s: e.target.value })} style={{ fontSize: 14, lineHeight: 1.6 }} />
              <div className="row gap-2">
                <button className="btn btn-primary" style={{ padding: "10px 24px" }} onClick={saveCandidate}>Save Identity</button>
                <button className="btn btn-ghost" onClick={() => setEditingCandidate(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <p className="profile-summary">{profile?.s || "Add your name and target role summary above. This becomes the anchor for scoring and document generation."}</p>
              <div className="profile-pill-row">
                <span className="pill mono">{skills.length} SKILLS</span>
                <span className="pill mono">{exp.length} ROLES</span>
                <span className="pill mono">{projects.length} PROJECTS</span>
              </div>
            </>
          )}
          </div>

          <div className="profile-side-panel">
            <div className="card profile-signal-card">
              <span className="eyebrow">Graph Signal</span>
              <div className="display tabular" style={{ fontSize: 52, color: "var(--pink-ink)", marginTop: 8 }}>{evidenceCount}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55 }}>Evidence items available for matching and package generation.</div>
              {visibleStacks.length > 0 && (
                <div className="profile-stack-mini">
                  {visibleStacks.map(s => <span key={s} className="pill">{s}</span>)}
                </div>
              )}
            </div>
            <button className="btn btn-primary" style={{ width: "100%", padding: "11px 16px" }} onClick={() => setView("ingestion")}>
              <Icon name="plus" size={14} /> Add Context
            </button>
          </div>
        </div>

        <div className="profile-stat-grid">
          {[
            { label: "Skills", value: skills.length, tone: "blue", icon: "spark" },
            { label: "Experience", value: exp.length, tone: "orange", icon: "brief" },
            { label: "Projects", value: projects.length, tone: "pink", icon: "layers" },
            { label: "Stack Tags", value: topStacks.length, tone: "teal", icon: "key" },
          ].map(item => (
            <div key={item.label} className="card-flat profile-stat-card">
              <div className="profile-stat-icon" style={{ background: `var(--${item.tone}-soft)`, color: `var(--${item.tone}-ink)` }}>
                <Icon name={item.icon} size={15} />
              </div>
              <div>
                <div className="display tabular" style={{ fontSize: 32, color: `var(--${item.tone}-ink)` }}>{item.value}</div>
                <div className="eyebrow">{item.label}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="profile-content-grid">
          <section className="card profile-section">
            <div className="profile-section-head">
              <div>
                <span className="eyebrow">Capability Map</span>
                <h3>Verified Skills</h3>
              </div>
              <span className="pill mono">{skills.length}</span>
            </div>
            <div className="profile-skill-grid">
              {skills.length === 0 && <div className="profile-empty">No skills yet.</div>}
              {skills.map((s: any) => (
                <div key={s.id} className="profile-skill-chip">
                  <div className="row gap-2" style={{ minWidth: 0 }}>
                    <Icon name="check" size={14} color="var(--blue)" />
                    <span>{s.n}</span>
                  </div>
                  <button className="btn-icon profile-mini-action" onClick={() => deleteItem("skill", s.id)} title="Delete"><Icon name="trash" size={13} /></button>
                </div>
              ))}
            </div>
          </section>

          <section className="card profile-section profile-section-wide">
            <div className="profile-section-head">
              <div>
                <span className="eyebrow">Work Evidence</span>
                <h3>Career Timeline</h3>
              </div>
              <span className="pill mono">{exp.length}</span>
            </div>
            <div className="profile-timeline">
              {exp.length === 0 && <div className="profile-empty">No experience recorded.</div>}
              {exp.map((e: any) => (
                <div key={e.id} className="profile-timeline-item">
                  {editId === e.id ? (
                    <div className="col gap-3">
                      <div className="grid-2 gap-3">
                        <input className="field-input" value={editData.role} placeholder="Role" onChange={v => setEditData({ ...editData, role: v.target.value })} />
                        <input className="field-input" value={editData.co} placeholder="Company" onChange={v => setEditData({ ...editData, co: v.target.value })} />
                      </div>
                      <input className="field-input" value={editData.period} placeholder="Period" onChange={v => setEditData({ ...editData, period: v.target.value })} />
                      <textarea className="field-input" value={editData.d} rows={4} placeholder="Description" onChange={v => setEditData({ ...editData, d: v.target.value })} />
                      <div className="row gap-2">
                        <button className="btn btn-primary" onClick={() => saveEdit("experience", e.id)}>Save</button>
                        <button className="btn btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="col gap-1">
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div className="col">
                          <div style={{ fontSize: 16, fontWeight: 600 }}>{e.role}</div>
                          <div className="row gap-2" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>
                            <span>{e.co}</span><span style={{ color: "var(--ink-4)" }}>-</span><span className="mono" style={{ fontSize: 11 }}>{e.period}</span>
                          </div>
                        </div>
                        <div className="row gap-2">
                          <button className="btn-icon profile-mini-action" onClick={() => { setEditId(e.id); setEditData({ ...e }); }}><Icon name="edit" size={14} /></button>
                          <button className="btn-icon profile-mini-action profile-danger" onClick={() => deleteItem("experience", e.id)}><Icon name="trash" size={14} /></button>
                        </div>
                      </div>
                      {e.d && <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, marginTop: 10, whiteSpace: "pre-wrap" }}>{e.d}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="card profile-section profile-section-wide">
            <div className="profile-section-head">
              <div>
                <span className="eyebrow">Project Proof</span>
                <h3>Portfolio & Projects</h3>
              </div>
              <span className="pill mono">{projects.length}</span>
            </div>
            <div className="profile-project-grid">
              {projects.length === 0 && <div className="profile-empty">No projects mapped.</div>}
              {projects.map((p: any) => (
                <div key={p.id} className="profile-project-card">
                  {editId === p.id ? (
                    <div className="col gap-3">
                      <input className="field-input" value={editData.title} placeholder="Title" onChange={v => setEditData({ ...editData, title: v.target.value })} />
                      <input className="field-input" value={editData.stack} placeholder="Stack (comma-separated)" onChange={v => setEditData({ ...editData, stack: v.target.value })} />
                      <input className="field-input" value={editData.repo} placeholder="Repo URL" onChange={v => setEditData({ ...editData, repo: v.target.value })} />
                      <textarea className="field-input" value={editData.impact} rows={4} placeholder="Impact" onChange={v => setEditData({ ...editData, impact: v.target.value })} />
                      <div className="row gap-2">
                        <button className="btn btn-primary" onClick={() => saveEdit("project", p.id)}>Save</button>
                        <button className="btn btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="col gap-1">
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                        <div style={{ fontSize: 16, fontWeight: 600 }}>{p.title}</div>
                        <div className="row gap-2">
                          <button className="btn-icon profile-mini-action" onClick={() => { setEditId(p.id); setEditData({ ...p, stack: stackItems(p.stack).join(", ") }); }}><Icon name="edit" size={14} /></button>
                          <button className="btn-icon profile-mini-action profile-danger" onClick={() => deleteItem("project", p.id)}><Icon name="trash" size={14} /></button>
                        </div>
                      </div>
                      <div className="row gap-1" style={{ flexWrap: "wrap", margin: "8px 0 10px" }}>
                        {stackItems(p.stack).map((s: string, i: number) => (
                          <span key={i} className="pill" style={{ fontSize: 11, padding: "4px 10px", background: "var(--pink-soft)", color: "var(--pink-ink)", border: "1px solid var(--pink)" }}>{s.trim()}</span>
                        ))}
                      </div>
                      {p.impact && <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>{p.impact}</div>}
                      {p.repo && <div className="row gap-2" style={{ marginTop: 10 }}><Icon name="link" size={12} color="var(--ink-3)" /><a href={p.repo} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--ink-3)" }}>{p.repo}</a></div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   INGESTION VIEW
══════════════════════════════════════ */

function IngestionView({ port }: { port: number }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [activeTab, setActiveTab] = useState<"resume" | "manual" | "raw" | "template">("resume");

  // Forms
  const [skillForm, setSkillForm] = useState({ n: "", cat: "technical" });
  const [expForm, setExpForm]     = useState({ role: "", co: "", period: "", d: "" });
  const [projForm, setProjForm]   = useState({ title: "", stack: "", repo: "", impact: "" });
  const [rawText, setRawText]     = useState("");
  const [template, setTemplate]   = useState("");
  const [templateLoaded, setTemplateLoaded] = useState(false);

  // Load existing template on mount
  useEffect(() => {
    if (activeTab !== "template" || templateLoaded) return;
    fetch(`http://127.0.0.1:${port}/api/v1/template`)
      .then(r => r.json())
      .then(d => { setTemplate(d.template || ""); setTemplateLoaded(true); })
      .catch(() => {});
  }, [activeTab, port, templateLoaded]);

  const saveTemplate = async () => {
    setStatus("loading");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      setStatus(r.ok ? "done" : "error");
    } catch { setStatus("error"); }
  };

  const addManual = async (type: string, data: any) => {
    setStatus("loading");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/profile/${type}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      if (r.ok) {
        setStatus("done");
        if (type === "skill")   setSkillForm({ n: "", cat: "technical" });
        if (type === "exp")     setExpForm({ role: "", co: "", period: "", d: "" });
        if (type === "project") setProjForm({ title: "", stack: "", repo: "", impact: "" });
      } else { setStatus("error"); }
    } catch { setStatus("error"); }
  };

  const ingestResume = async (file: File) => {
    setStatus("loading");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/ingest`, { method: "POST", body: fd });
      setStatus(r.ok ? "done" : "error");
    } catch { setStatus("error"); }
  };

  const ingestRaw = async () => {
    setStatus("loading");
    const fd = new FormData();
    fd.append("raw", rawText);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/ingest`, { method: "POST", body: fd });
      if (r.ok) { setStatus("done"); setRawText(""); } else { setStatus("error"); }
    } catch { setStatus("error"); }
  };

  const TABS = [
    { id: "resume" as const,   label: "Resume Upload" },
    { id: "manual" as const,   label: "Manual Forms"  },
    { id: "raw" as const,      label: "Raw Text"      },
    { id: "template" as const, label: "📄 Resume Template" },
  ];

  return (
    <div className="col scroll" style={{ flex: 1, height: "100%", overflow: "auto", background: "var(--paper)", padding: "48px 32px", alignItems: "center" }}>
      <div style={{ maxWidth: 680, width: "100%" }}>
        <div style={{ marginBottom: 32 }}>
          <span className="eyebrow">Append-only Pipeline</span>
          <h2 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>Add Context</h2>
          <p style={{ color: "var(--ink-3)", marginTop: 8, fontSize: 14 }}>Everything you add is merged into your Identity Graph. Set a resume template so the generator follows your preferred format.</p>
        </div>

        <div className="row gap-2" style={{ background: "var(--paper-3)", padding: 6, borderRadius: 12, marginBottom: 32 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => { setActiveTab(t.id); setStatus("idle"); }}
              className={"btn " + (activeTab === t.id ? "btn-primary" : "btn-ghost")}
              style={{ flex: 1, border: "none", boxShadow: activeTab === t.id ? "var(--shadow-sm)" : "none", fontSize: 13, padding: "10px 0", borderRadius: 8 }}>
              {t.label}
            </button>
          ))}
        </div>

        {status === "done" && (
          <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} style={{ padding: 16, background: "var(--green-soft)", color: "var(--green-ink)", borderRadius: 12, marginBottom: 24, display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--green)" }}>
            <Icon name="check" size={18} /><div style={{fontWeight:600}}>Saved successfully!</div>
          </motion.div>
        )}
        {status === "error" && (
          <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} style={{ padding: 16, background: "var(--bad-soft)", color: "var(--bad)", borderRadius: 12, marginBottom: 24, border: "1px solid var(--bad)" }}>
            An error occurred.
          </motion.div>
        )}

        {activeTab === "resume" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="card col gap-4" style={{ padding: "64px 32px", alignItems: "center", textAlign: "center", border: "2px dashed var(--line)", background: "var(--paper-2)" }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: "var(--teal-soft)", color: "var(--teal)", display: "grid", placeItems: "center" }}><Icon name="upload" size={28} /></div>
            <div style={{ fontWeight: 600, fontSize: 18 }}>Drop a fresh Resume PDF</div>
            <div style={{ fontSize: 14, color: "var(--ink-3)", maxWidth: 360, lineHeight: 1.5 }}>Our ingestion agent discovers skills, roles, and projects and maps them into your graph.</div>
            <input type="file" accept=".pdf" onChange={e => e.target.files?.[0] && ingestResume(e.target.files[0])} style={{ display: "none" }} id="pdf-in" />
            <button className="btn btn-primary" style={{ marginTop: 16, padding: "12px 32px", fontSize: 15 }} onClick={() => document.getElementById("pdf-in")?.click()}>Select PDF File</button>
            {status === "loading" && <div className="mono pulse" style={{ fontSize: 12, marginTop: 16 }}>Agent parsing resume…</div>}
          </motion.div>
        )}

        {activeTab === "manual" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="col gap-8">
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}><Icon name="spark" size={16}/> Add Skill</h3>
              <input className="field-input" placeholder="Skill name" value={skillForm.n} onChange={v => setSkillForm({...skillForm, n: v.target.value})} />
              <select className="field-input" value={skillForm.cat} onChange={v => setSkillForm({...skillForm, cat: v.target.value})}>
                <option value="technical">Technical</option>
                <option value="soft">Soft Skill</option>
                <option value="tool">Tool / Utility</option>
                <option value="language">Language</option>
                <option value="framework">Framework</option>
              </select>
              <button className="btn btn-primary" style={{alignSelf:"flex-start",padding:"10px 24px"}} onClick={() => addManual("skill", skillForm)} disabled={status==="loading"}>Add Skill</button>
            </div>
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}><Icon name="brief" size={16}/> Add Experience</h3>
              <input className="field-input" placeholder="Role Title" value={expForm.role} onChange={v => setExpForm({...expForm, role: v.target.value})} />
              <input className="field-input" placeholder="Company" value={expForm.co} onChange={v => setExpForm({...expForm, co: v.target.value})} />
              <input className="field-input" placeholder="Period (e.g. 2022-2024)" value={expForm.period} onChange={v => setExpForm({...expForm, period: v.target.value})} />
              <textarea className="field-input" placeholder="Description" rows={3} value={expForm.d} onChange={v => setExpForm({...expForm, d: v.target.value})} />
              <button className="btn btn-primary" style={{alignSelf:"flex-start",padding:"10px 24px"}} onClick={() => addManual("exp", expForm)} disabled={status==="loading"}>Add Experience</button>
            </div>
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}><Icon name="layers" size={16}/> Add Project</h3>
              <input className="field-input" placeholder="Project Title" value={projForm.title} onChange={v => setProjForm({...projForm, title: v.target.value})} />
              <input className="field-input" placeholder="Stack (comma-separated)" value={projForm.stack} onChange={v => setProjForm({...projForm, stack: v.target.value})} />
              <input className="field-input" placeholder="Repo URL (optional)" value={projForm.repo} onChange={v => setProjForm({...projForm, repo: v.target.value})} />
              <textarea className="field-input" placeholder="Impact / Description" rows={3} value={projForm.impact} onChange={v => setProjForm({...projForm, impact: v.target.value})} />
              <button className="btn btn-primary" style={{alignSelf:"flex-start",padding:"10px 24px"}} onClick={() => addManual("project", projForm)} disabled={status==="loading"}>Add Project</button>
            </div>
          </motion.div>
        )}

        {activeTab === "raw" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="card col gap-4" style={{ padding: 24 }}>
            <div className="eyebrow">Raw Text Aggregator</div>
            <textarea className="field-input" placeholder="Paste unstructured text from LinkedIn, personal websites, or notes…" rows={16} value={rawText} onChange={v => setRawText(v.target.value)} style={{ fontSize: 14, lineHeight: 1.6 }} />
            <button className="btn btn-primary" style={{ padding: 16, fontSize: 15 }} onClick={ingestRaw} disabled={status==="loading"}>
              {status === "loading" ? "Processing…" : "Sync Raw Context"}
            </button>
          </motion.div>
        )}

        {activeTab === "template" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="col gap-4">
            <div className="card" style={{ padding: 24, background: "var(--purple-soft)", border: "1px solid var(--purple)" }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Resume Template</h3>
              <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
                Paste your preferred resume format here (plain text or Markdown). When the agent generates a tailored resume, it will follow this structure — section order, headings, and layout — and fill it in with your profile and the job's requirements.
              </p>
            </div>
            <div className="card col gap-4" style={{ padding: 24 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>Template content</span>
                {template && <span className="pill mono" style={{ fontSize: 10, background: "var(--green-soft)", color: "var(--green-ink)", border: "1px solid var(--green)" }}>Template saved</span>}
              </div>
              <textarea
                className="field-input"
                placeholder={`Paste your resume template here. For example:\n\n# [Name]\n[Contact info]\n\n## Summary\n[2-3 sentence professional summary]\n\n## Experience\n### [Role] — [Company] ([Period])\n- [Bullet points]\n\n## Projects\n### [Project Name]\n- Stack: ...\n- Impact: ...\n\n## Skills\n[Comma-separated list]`}
                rows={24}
                value={template}
                onChange={e => setTemplate(e.target.value)}
                style={{ fontSize: 13, lineHeight: 1.65, fontFamily: "var(--font-mono)" }}
              />
              <div className="row gap-3" style={{ alignItems: "center" }}>
                <button className="btn btn-primary" style={{ padding: "12px 28px", fontSize: 14 }} onClick={saveTemplate} disabled={status==="loading"}>
                  {status === "loading" ? "Saving…" : "Save Template"}
                </button>
                {template && (
                  <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setTemplate(""); }}>
                    Clear
                  </button>
                )}
                <span style={{ fontSize: 12, color: "var(--ink-4)" }}>{template.length} chars</span>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   APPROVAL DRAWER
══════════════════════════════════════ */

function ApprovalDrawer({ j, port, onClose, onFired }: {
  j: Lead; port: number; onClose: () => void; onFired: () => void;
}) {
  type DocKind = "resume" | "cover";
  const [firing, setFiring] = useState(false);
  const [done,   setDone]   = useState(false);
  const [generating, setGenerating] = useState(false);
  const [activeDoc, setActiveDoc] = useState<DocKind>("resume");
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoadErr, setPdfLoadErr] = useState<string | null>(null);
  const [generateErr, setGenerateErr] = useState<string | null>(null);
  const [fireErr, setFireErr] = useState<string | null>(null);

  const resumeReady = Boolean(j.resume_asset || j.asset);
  const coverReady = Boolean(j.cover_letter_asset);
  const activeReady = activeDoc === "resume" ? resumeReady : coverReady;
  const activeDocUrl = activeReady
    ? `http://127.0.0.1:${port}/api/v1/leads/${j.job_id}/pdf?kind=${activeDoc === "resume" ? "resume" : "cover_letter"}`
    : null;
  const selectedProjects = j.selected_projects || [];
  const canFire = resumeReady && coverReady && !firing;

  // Tauri WebView blocks <iframe src="http://..."> for localhost — fetch as blob instead
  useEffect(() => {
    if (!activeDocUrl) { setPdfBlobUrl(null); setPdfLoadErr(null); return; }
    let revoke: string | null = null;
    let alive = true;
    setPdfLoadErr(null);
    setPdfBlobUrl(null);
    fetch(activeDocUrl)
      .then(r => { if (!r.ok) throw new Error(`Server returned ${r.status}`); return r.blob(); })
      .then(blob => {
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        revoke = url;
        setPdfBlobUrl(url);
      })
      .catch(err => {
        if (!alive) return;
        setPdfLoadErr(String(err));
        setPdfBlobUrl(null);
      });
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [activeDocUrl]);

  // Clear generating flag when the lead actually receives its generated documents.
  useEffect(() => {
    if (generating && resumeReady && coverReady) setGenerating(false);
  }, [resumeReady, coverReady, generating]);

  const fire = async () => {
    if (!canFire) return;
    setFiring(true);
    setFireErr(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/fire/${j.job_id}`, { method: "POST" });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || `Server returned ${r.status}`);
      }
      setDone(true); setTimeout(onFired, 1500);
    } catch (err) {
      setFireErr(err instanceof Error ? err.message : "Fire failed");
      setFiring(false);
    }
  };

  const generatePdf = async () => {
    setGenerating(true);
    setGenerateErr(null);
    setPdfBlobUrl(null);
    setPdfLoadErr(null);
    setActiveDoc("resume");
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/leads/${j.job_id}/generate`, { method: "POST" });
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
    } catch (err) {
      setGenerateErr(String(err));
      setGenerating(false);
    }
  };

  const openPdf = () => { if (activeDocUrl) openUrl(activeDocUrl); };

  return (
    <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 100, display: "grid", placeItems: "center", padding: 16, overflow: "auto" }}>
      <motion.div className="card"
        initial={{ opacity: 0, y: 24, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 18, scale: 0.985 }}
        transition={{ type: "spring", damping: 28, stiffness: 260 }}
        onClick={e => e.stopPropagation()}
        style={{ width: "min(1240px, calc(100vw - 32px))", height: "min(900px, calc(100vh - 32px))", maxHeight: "calc(100vh - 32px)", display: "flex", flexDirection: "column", background: "var(--paper)", zIndex: 101, overflow: "hidden", borderRadius: 18 }}>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "18px 22px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0, gap: 16, background: "var(--paper)", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div className="row gap-2" style={{ marginBottom: 7, flexWrap: "wrap" }}>
              <span className="pill" style={{ background: `var(--${getTone(j.status)})`, color: `var(--${getTone(j.status)}-ink)` }}>{j.status}</span>
              <span className="pill mono" style={{ background: "var(--paper-3)", color: "var(--ink-3)" }}>{j.platform}</span>
              {j.score > 0 && <span className="pill mono" style={{ background: j.score >= 85 ? "var(--green-soft)" : j.score >= 60 ? "var(--yellow-soft)" : "var(--bad-soft)", color: j.score >= 85 ? "var(--green-ink)" : j.score >= 60 ? "var(--yellow-ink)" : "var(--bad)" }}>{j.score}/100 match</span>}
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 600, overflowWrap: "anywhere" }}>{j.title}</h2>
            <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 2 }}>{j.company} · {j.platform}</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => openUrl(j.url)}
              title="Open original job posting"
              className="btn"
              style={{ fontSize: 12, borderColor: "var(--teal)", background: "var(--teal-soft)", color: "var(--teal)" }}
            >
              <Icon name="external-link" size={12} color="var(--teal)" /> View Posting
            </button>
            <button className="btn btn-icon" onClick={onClose}><Icon name="x" size={15} /></button>
          </div>
        </div>

        <div className="approval-modal-grid" style={{ flex: 1, overflow: "hidden", display: "grid", minHeight: 0 }}>
          {/* Left: PDF */}
          <div className="approval-doc-pane" style={{ padding: 18, borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="eyebrow">Application Package</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>Resume and cover letter are generated separately for this role.</div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {pdfBlobUrl && (
                  <button onClick={openPdf} title="Open PDF in system viewer" style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                    border: "1px solid var(--teal)", background: "var(--teal-soft)", color: "var(--teal)", cursor: "pointer",
                  }}>
                    <Icon name="download" size={12} color="var(--teal)" /> Open PDF
                  </button>
                )}
                <button onClick={generatePdf} disabled={generating} style={{
                  padding: "5px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                  border: "1px solid var(--purple)", background: "var(--purple-soft)", color: "var(--purple-ink)", cursor: generating ? "wait" : "pointer",
                }}>{generating ? "Generating..." : resumeReady || coverReady ? "Regenerate Package" : "Generate Package"}</button>
              </div>
            </div>
            <div className="row gap-2" style={{ background: "var(--paper-3)", padding: 5, borderRadius: 10, flexShrink: 0 }}>
              {[
                ["resume", "Resume", resumeReady],
                ["cover", "Cover Letter", coverReady],
              ].map(([kind, label, ready]) => (
                <button key={kind as string} onClick={() => setActiveDoc(kind as DocKind)} style={{
                  flex: 1, padding: "8px 10px", borderRadius: 7, border: "none", cursor: "pointer",
                  background: activeDoc === kind ? "var(--card)" : "transparent",
                  color: activeDoc === kind ? "var(--ink)" : "var(--ink-3)",
                  fontSize: 12, fontWeight: 700, boxShadow: activeDoc === kind ? "var(--shadow-xs)" : "none",
                  display: "flex", justifyContent: "center", alignItems: "center", gap: 7,
                }}>
                  {label}
                  <span className="dot" style={{ color: ready ? "var(--ok)" : "var(--ink-4)" }} />
                </button>
              ))}
            </div>
            {selectedProjects.length > 0 && (
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                <span className="eyebrow" style={{ marginRight: 2 }}>Projects used</span>
                {selectedProjects.map((p, i) => (
                  <span key={i} className="pill" style={{ background: "var(--green-soft)", color: "var(--green-ink)", border: "1px solid var(--green)" }}>{p}</span>
                ))}
              </div>
            )}
            {generateErr && <div style={{ color: "var(--bad)", fontSize: 12, padding: "8px 10px", background: "var(--bad-soft)", border: "1px solid var(--bad)", borderRadius: 8 }}>{generateErr}</div>}
            <div style={{ flex: 1, minHeight: 0, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
              {activeReady && pdfBlobUrl && (
                <iframe
                  key={pdfBlobUrl}
                  src={pdfBlobUrl}
                  title={activeDoc === "resume" ? "Resume" : "Cover Letter"}
                  width="100%"
                  style={{ height: "100%", minHeight: 520, border: "none", display: "block" }}
                />
              )}
              {generating && !pdfBlobUrl && (
                <div style={{ height: "100%", minHeight: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--ink-3)", fontSize: 12, padding: 24, textAlign: "center" }}>
                  <div className="mono pulse">Tailoring resume and cover letter for {j.company}...</div>
                  <div style={{ maxWidth: 360, lineHeight: 1.5 }}>The generator is choosing the strongest profile projects for this job description.</div>
                </div>
              )}
              {!generating && activeReady && !pdfBlobUrl && (
                <div style={{ height: "100%", minHeight: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--ink-3)", fontSize: 12, padding: 24, textAlign: "center" }}>
                  {pdfLoadErr
                    ? <div style={{ color: "var(--bad)" }}>Failed to load PDF: {pdfLoadErr}</div>
                    : <div>Loading {activeDoc === "resume" ? "resume" : "cover letter"}...</div>
                  }
                </div>
              )}
              {!generating && !activeReady && (
                <div style={{ height: "100%", minHeight: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--ink-3)", fontSize: 12, padding: 24, textAlign: "center" }}>
                  <Icon name="file" size={26} color="var(--ink-4)" />
                  <div style={{ fontWeight: 700, color: "var(--ink-2)" }}>
                    No tailored {activeDoc === "resume" ? "resume" : "cover letter"} yet.
                  </div>
                  <div style={{ maxWidth: 380, lineHeight: 1.5 }}>
                    Generate the application package to create separate PDFs using the job description, company context, and best-matching projects.
                  </div>
                  <button onClick={generatePdf} disabled={generating} style={{ padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, border: "1px solid var(--purple)", background: "var(--purple-soft)", color: "var(--purple-ink)", cursor: generating ? "wait" : "pointer" }}>
                    Generate Package
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Score + actions */}
          <div className="approval-detail-pane" style={{ display: "flex", flexDirection: "column", minHeight: 0, background: "var(--paper)" }}>
            <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0, flex: 1 }}>
            <div className="eyebrow">Match Reasoning</div>

            {/* Description */}
            {j.description && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Job Description</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6, background: "var(--paper-3)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--line)" }}>
                  {j.description}
                </div>
              </div>
            )}

            {/* Score bar */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Match Score</span>
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  color:       j.score >= 85 ? "var(--green-ink)" : j.score >= 60 ? "var(--yellow-ink)" : "var(--bad)",
                  background:  j.score >= 85 ? "var(--green-soft)" : j.score >= 60 ? "var(--yellow-soft)" : "var(--bad-soft)",
                  padding: "2px 10px", borderRadius: 999,
                }}>{j.score ?? 0}/100</span>
              </div>
              <div style={{ height: 6, background: "var(--paper-3)", borderRadius: 999, marginBottom: 16 }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(100, j.score ?? 0)}%`, background: j.score >= 85 ? "var(--green)" : j.score >= 60 ? "var(--yellow)" : "var(--bad)", transition: "width 0.4s ease" }} />
              </div>
            </div>

            {j.reason && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Evaluator Reasoning</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6, background: "var(--paper)", borderRadius: 10, padding: "10px 12px", border: "1px solid var(--line)" }}>{j.reason}</div>
              </div>
            )}

            {j.match_points?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Match Points</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {j.match_points.map((pt, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--ink-2)" }}>
                      <span style={{ color: "var(--ok)", fontWeight: 700, flexShrink: 0 }}>✓</span>
                      <span style={{ lineHeight: 1.5 }}>{pt}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {j.gaps && j.gaps.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Skill Gaps</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {j.gaps.map((g, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--ink-2)" }}>
                      <span style={{ color: "var(--bad)", fontWeight: 700, flexShrink: 0 }}>✗</span>
                      <span style={{ lineHeight: 1.5 }}>{g}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            </div>
            <div style={{ textAlign: "center", padding: 16, borderTop: "1px solid var(--line)", background: "var(--paper)", flexShrink: 0 }}>
              {done
                ? <div style={{ fontSize: 15, color: "var(--ok)", fontWeight: 700 }}>Fired - automation running</div>
                : <>
                    <button className="btn btn-accent" onClick={fire} disabled={!canFire} style={{ fontSize: 15, padding: "12px 24px", width: "100%", cursor: canFire ? "pointer" : "not-allowed", opacity: canFire ? 1 : 0.58, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <Icon name="fire" size={15} color="#fff" /> {firing ? "Firing..." : "Fire Application"}
                    </button>
                    {fireErr ? (
                      <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--bad)", lineHeight: 1.45 }}>
                        {fireErr}
                      </div>
                    ) : null}
                    {!resumeReady || !coverReady ? (
                      <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45 }}>
                        Generate the resume and cover letter before firing the application.
                      </div>
                    ) : null}
                  </>
              }
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ══════════════════════════════════════
   APP ROOT
══════════════════════════════════════ */

export default function App() {
  const { conn, port, logs, beat, addLog: wsAddLog } = useWS();
  const { leads, setLeads } = useLeads(port, wsAddLog);
  const stats  = useGraphStats(port);
  const [view, setView]           = useState<View>("dashboard");
  const [sel, setSel]             = useState<Lead | null>(null);
  // Always pass the live version of the selected lead so the drawer reflects real-time updates
  const liveSel = sel ? (leads.find(l => l.job_id === sel.job_id) ?? sel) : null;
  const [showSettings, setShowSettings] = useState(false);
  const [scanning, setScanning]   = useState(false);
  const [scanErr, setScanErr]     = useState<string | null>(null);

  useEffect(() => {
    const h = () => setScanning(false);
    window.addEventListener("scan-done", h);
    return () => window.removeEventListener("scan-done", h);
  }, []);

  const onScan = useCallback(async () => {
    if (!port || scanning) return;
    setScanning(true); setScanErr(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/scan`, { method: "POST" });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || "Backend unreachable");
      }
    } catch (e: any) {
      setScanErr(e.message || "Scan failed"); setScanning(false);
    }
  }, [port, scanning]);

  const onStopScan = useCallback(async () => {
    if (!port) return;
    try { await fetch(`http://127.0.0.1:${port}/api/v1/scan/stop`, { method: "POST" }); }
    catch { /* ignore */ }
  }, [port]);

  const deleteLead = useCallback(async (jobId: string) => {
    if (!port) return;
    await fetch(`http://127.0.0.1:${port}/api/v1/leads/${jobId}`, { method: "DELETE" });
    setLeads(prev => prev.filter(l => l.job_id !== jobId));
  }, [port, setLeads]);

  const leadCounts = {
    total:        leads.length,
    discovered:   leads.filter(l=>l.status==="discovered").length,
    evaluating:   leads.filter(l=>l.status==="evaluating").length,
    tailoring:    leads.filter(l=>l.status==="tailoring").length,
    approved:     leads.filter(l=>l.status==="approved").length,
    applied:      leads.filter(l=>l.status==="applied").length,
    interviewing: leads.filter(l=>l.status==="interviewing").length,
    accepted:     leads.filter(l=>l.status==="accepted").length,
    rejected:     leads.filter(l=>l.status==="rejected").length,
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", alignItems: "stretch" }}>
      <Sidebar view={view} setView={setView} leadCounts={leadCounts} online={conn === "connected"} port={port} beat={beat} onSettings={() => setShowSettings(true)} />
      <div className="app-main">
        <Topbar view={view} />
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
          {view === "dashboard" && <DashboardView leads={leads} logs={logs} setView={setView} openDrawer={setSel} scanning={scanning} onScan={onScan} onStopScan={onStopScan} scanErr={scanErr} />}
          {view === "pipeline"  && <PipelineView leads={leads} openDrawer={setSel} deleteLead={deleteLead} port={port} />}
          {view === "graph"     && <GraphView stats={stats} />}
          {view === "activity"  && <ActivityView logs={logs} />}
          {view === "profile"   && port && <ProfileView port={port} setView={setView} />}
          {view === "ingestion" && port && <IngestionView port={port} />}
        </div>
      </div>

      <AnimatePresence>
        {liveSel && port && (
          <ApprovalDrawer key={liveSel.job_id} j={liveSel} port={port} onClose={() => setSel(null)} onFired={() => setSel(null)} />
        )}
        {showSettings && port && (
          <SettingsModal key="settings" port={port} onClose={() => setShowSettings(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
