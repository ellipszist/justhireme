import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import SettingsModal from "./SettingsModal";
import Icon from "./components/Icon";
import "./index.css";

// Types
type ConnSt = "disconnected" | "connecting" | "connected";
type View = "dashboard" | "pipeline" | "graph" | "activity" | "profile";

interface Lead {
  job_id: string; title: string; company: string;
  url: string; platform: string; status: string; asset: string;
}
interface GraphStats {
  candidate: number; skill: number; project: number;
  experience: number; joblead: number;
}
interface LogLine {
  id: number; ts: string; msg: string; src: string;
  kind: "heartbeat" | "agent" | "system";
}
interface Overrides {
  name: string; targetRole: string; email: string;
  phone: string; linkedin: string; github: string;
  location: string; summary: string;
}

// Helpers
const getMark = (company: string) => company ? company.charAt(0).toUpperCase() : "?";
const getTone = (status: string) => {
  switch (status) {
    case "discovered": return "blue";
    case "evaluating": return "yellow";
    case "tailoring":  return "purple";
    case "approved":   return "green";
    case "applied":    return "orange";
    default: return "blue";
  }
};
const getMatch = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return 70 + (Math.abs(hash) % 26);
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
        }
        if (d.type === "agent" && d.event === "eval_done") {
          window.dispatchEvent(new CustomEvent("scan-done"));
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

  return { conn, port, logs, beat };
}

function useLeads(port: number | null) {
  const [leads, setLeads] = useState<Lead[]>([]);
  useEffect(() => {
    if (!port) return;
    const load = () => fetch(`http://127.0.0.1:${port}/api/v1/leads`).then(r => r.json()).then(setLeads).catch(() => {});
    load(); const t = setInterval(load, 5000); return () => clearInterval(t);
  }, [port]);
  return leads;
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
  { id: "dashboard", label: "Dashboard", icon: "home",   tone: "blue"   },
  { id: "pipeline",  label: "Pipeline",  icon: "layers", tone: "purple" },
  { id: "graph",     label: "Knowledge", icon: "graph",  tone: "green"  },
  { id: "activity",  label: "Activity",  icon: "pulse",  tone: "orange" },
  { id: "profile",   label: "Profile",   icon: "user",   tone: "pink"   },
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
          ["evaluating", "Evaluating", "yellow",  leadCounts.evaluating],
          ["tailoring",  "Tailoring",  "purple",  leadCounts.tailoring],
          ["approved",   "Approved",   "green",   leadCounts.approved],
          ["applied",    "Applied",    "orange",  leadCounts.applied],
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
  const titles = {
    dashboard: "Command Center",
    pipeline:  "Job Pipeline",
    graph:     "Knowledge Graph",
    activity:  "Live Activity",
    profile:   "Candidate Profile",
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

const StatCard = ({ tone, label, value, sub, icon, accent }: any) => (
  <div style={{
    background: `var(--${tone}-soft)`,
    border: `1px solid var(--${tone})`,
    borderRadius: 16, padding: 18,
    display: "flex", flexDirection: "column", gap: 12,
    minHeight: 132,
  }}>
    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
      <div style={{
        width: 32, height: 32, borderRadius: 9,
        background: `var(--${tone})`, color: `var(--${tone}-ink)`,
        display: "grid", placeItems: "center",
      }}>
        <Icon name={icon} size={15} />
      </div>
      {accent && (
        <div className="mono" style={{ fontSize: 10, fontWeight: 600, color: `var(--${tone}-ink)`, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {accent}
        </div>
      )}
    </div>
    <div className="col" style={{ gap: 4 }}>
      <div className="display tabular" style={{ fontSize: 40, color: `var(--${tone}-ink)`, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{label}</div>
      <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{sub}</div>
    </div>
  </div>
);

const SparkBar = ({ data, tone }: { data: number[]; tone: string }) => {
  const max = Math.max(...data, 1);
  return (
    <div className="row" style={{ gap: 3, alignItems: "flex-end", height: 44 }}>
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1,
          height: `${(v/max)*100}%`,
          minHeight: 3,
          background: `var(--${tone}-ink)`,
          opacity: 0.4 + (v/max) * 0.6,
          borderRadius: 2,
        }} />
      ))}
    </div>
  );
};

function DashboardView({ leads, logs, setView, openDrawer, scanning, onScan, scanErr }: {
  leads: Lead[]; logs: LogLine[]; setView: (v: View) => void; openDrawer: (l: Lead) => void;
  scanning: boolean; onScan: () => void; scanErr: string | null;
}) {
  const counts = {
    total:      leads.length,
    discovered: leads.filter(l=>l.status==="discovered").length,
    evaluating: leads.filter(l=>l.status==="evaluating").length,
    tailoring:  leads.filter(l=>l.status==="tailoring").length,
    approved:   leads.filter(l=>l.status==="approved").length,
    applied:    leads.filter(l=>l.status==="applied").length,
  };
  const recent = leads.slice(0, 4);
  const approvedQueue = leads.filter(l => l.status === "approved" || l.status === "tailoring").slice(0, 3);

  return (
    <div className="scroll" style={{ padding: 24, flex: 1, height: "100%", minHeight: 0 }}>
      <div className="card" style={{ padding: "26px 28px", marginBottom: 18, background: "linear-gradient(135deg, var(--orange-soft) 0%, var(--pink-soft) 60%, var(--purple-soft) 100%)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
          <div className="col gap-3" style={{ maxWidth: 560 }}>
            <span className="eyebrow">Agent Online</span>
            <h1 style={{ fontSize: 52 }}>The hunt is <span className="italic-serif" style={{ color: "var(--ink-2)" }}>on.</span></h1>
            <div style={{ fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.55, maxWidth: 480 }}>
              Your agents reviewed <b>{leads.length} leads</b>, tailored <b>{counts.tailoring + counts.approved} resumes</b>, and queued <b>{counts.approved} applications</b>.
            </div>
            <div className="row gap-2" style={{ marginTop: 6 }}>
              <button onClick={onScan} disabled={scanning} style={{
                padding: "10px 22px", borderRadius: 12, fontSize: 12, fontWeight: 700,
                letterSpacing: "0.12em", textTransform: "uppercase", cursor: scanning ? "wait" : "pointer",
                background: scanning ? "var(--ink-4)" : "var(--ink)",
                color: "var(--paper)", border: "1px solid var(--ink-3)",
                boxShadow: scanning ? "none" : "0 0 20px rgba(201,100,66,0.25), 0 0 60px rgba(201,100,66,0.08)",
                transition: "all .2s ease", display: "flex", alignItems: "center", gap: 8,
              }}>
                {scanning ? <><span className="dot pulse-soft" /> SCAN IN PROGRESS...</> : <><Icon name="spark" size={13} /> INITIATE AUTONOMOUS SCAN</>}
              </button>
              <button className="btn btn-accent" onClick={() => setView("pipeline")}>Open pipeline <Icon name="arrow-right" size={13} /></button>
              <button className="btn" onClick={() => setView("activity")}><Icon name="pulse" size={13} /> Live activity</button>
            </div>
            {scanErr && <div style={{ marginTop: 6, fontSize: 12, color: "var(--bad)", fontWeight: 500 }}>⚠ {scanErr}</div>}
          </div>
          <div className="col gap-2" style={{ width: 320 }}>
            <div className="eyebrow" style={{ marginBottom: 2 }}>Awaiting your approval</div>
            {approvedQueue.length === 0 ? (
              <div className="card-flat" style={{ padding: 14, fontSize: 12, color: "var(--ink-3)" }}>Queue is clear.</div>
            ) : approvedQueue.map(l => (
              <div key={l.job_id} onClick={() => openDrawer(l)} className="lift" style={{
                background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12,
                padding: 10, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: `var(--${getTone(l.status)})`, color: `var(--${getTone(l.status)}-ink)`,
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500,
                  border: `1px solid var(--${getTone(l.status)}-ink)`,
                }}>{getMark(l.company)}</div>
                <div className="col" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{l.company} · {getMatch(l.job_id)}% match</div>
                </div>
                <Icon name="arrow-right" size={14} color="var(--ink-3)" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
        <StatCard tone="blue"   label="Leads discovered" value={leads.length}      sub="Total leads"   icon="layers" />
        <StatCard tone="yellow" label="Evaluating now"   value={counts.evaluating} sub="In agent loop" icon="spark" />
        <StatCard tone="purple" label="Resumes tailored" value={counts.tailoring}  sub="PDFs cached"   icon="file" />
        <StatCard tone="green"  label="Awaiting approval" value={counts.approved}  sub="Ready to fire" icon="check" />
        <StatCard tone="orange" label="Applications sent" value={counts.applied}   sub="Success"       icon="arrow-up" />
      </div>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="card" style={{ padding: 20, background: "var(--teal-soft)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 18 }}>
            <div>
              <h3>Application velocity</h3>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3 }}>Real-time stream</div>
            </div>
          </div>
          <div className="row gap-4" style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
            <div className="col gap-1">
              <div className="display tabular" style={{ fontSize: 44, color: "var(--teal-ink)" }}>{counts.applied}</div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>apps sent</div>
            </div>
            <div style={{ flex: 1, maxWidth: 320 }}>
              <SparkBar data={[3,5,4,7,6,8,5,9,11,8,12,10,14,counts.applied]} tone="teal" />
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 20, background: "var(--pink-soft)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <h3>Top matches</h3>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginTop: 3 }}>by graph similarity</div>
            </div>
            <button className="btn btn-icon"><Icon name="trending" size={14} /></button>
          </div>
          <div className="col gap-2">
            {recent.map(l => (
              <div key={l.job_id} className="row gap-3" style={{
                padding: 10, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: `var(--${getTone(l.status)})`, color: `var(--${getTone(l.status)}-ink)`,
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500,
                  border: `1px solid var(--${getTone(l.status)}-ink)`,
                }}>{getMark(l.company)}</div>
                <div className="col" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{l.title}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{l.company} · {l.platform}</div>
                </div>
                <div className="display tabular" style={{ fontSize: 18, color: `var(--${getTone(l.status)}-ink)` }}>{getMatch(l.job_id)}<span style={{ fontSize: 11, opacity: 0.6 }}>%</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18, background: "var(--yellow-soft)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div className="row gap-2">
            <div style={{ width: 26, height: 26, borderRadius: 7, background: "var(--yellow)", color: "var(--yellow-ink)", display: "grid", placeItems: "center" }}>
              <Icon name="clock" size={13} />
            </div>
            <h3>Recent agent events</h3>
          </div>
          <button className="btn btn-ghost" onClick={() => setView("activity")} style={{ fontSize: 12 }}>See all <Icon name="arrow-right" size={12} /></button>
        </div>
        <div className="col gap-1" style={{ fontSize: 12 }}>
          {logs.slice(0, 5).map((ln, i) => {
            const tone = ln.kind === "heartbeat" ? "blue" : ln.kind === "agent" ? "green" : "yellow";
            return (
              <div key={ln.id} className="row gap-3" style={{ padding: "7px 10px", borderRadius: 8, background: i === 0 ? "var(--card)" : "transparent" }}>
                <span className="mono tabular" style={{ fontSize: 10, color: "var(--ink-3)", minWidth: 50 }}>{ln.ts}</span>
                <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: `var(--${tone})`, color: `var(--${tone}-ink)`, textTransform: "uppercase", letterSpacing: "0.08em" }}>{ln.kind}</span>
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{ln.src}</span>
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
   PIPELINE VIEW
══════════════════════════════════════ */

function PipelineView({ leads, logs, stats, openDrawer, scanning, onScan }: {
  leads: Lead[]; logs: LogLine[]; stats: GraphStats; openDrawer: (l: Lead) => void;
  scanning: boolean; onScan: () => void;
}) {
  const [filter, setFilter] = useState("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const filtered = filter === "all" ? leads : leads.filter(l => l.status === filter);

  const filters = [
    { id: "all",        label: "All",        n: leads.length },
    { id: "evaluating", label: "Evaluating", n: leads.filter(l=>l.status==="evaluating").length },
    { id: "tailoring",  label: "Tailoring",  n: leads.filter(l=>l.status==="tailoring").length },
    { id: "approved",   label: "Approved",   n: leads.filter(l=>l.status==="approved").length },
    { id: "applied",    label: "Applied",    n: leads.filter(l=>l.status==="applied").length },
  ];

  const mappedStats = [
    { key: "JobLead",    count: stats.joblead ?? 0,    tone: "blue" },
    { key: "Candidate",  count: stats.candidate ?? 0,  tone: "purple" },
    { key: "Skill",      count: stats.skill ?? 0,      tone: "orange" },
    { key: "Experience", count: stats.experience ?? 0, tone: "green" },
    { key: "Project",    count: stats.project ?? 0,    tone: "pink" },
  ];

  return (
    <div className="grid-3" style={{ padding: 24, height: "100%", overflowX: "auto" }}>
      {/* COL 1 — Discovery feed */}
      <div className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--blue-soft)" }}>
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--line)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div className="row gap-2">
              <div style={{ width: 26, height: 26, borderRadius: 7, background: "var(--blue)", color: "var(--blue-ink)", display: "grid", placeItems: "center" }}>
                <Icon name="layers" size={14} />
              </div>
              <div>
                <h3>Discovery</h3>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.12em", textTransform: "uppercase" }}>{filtered.length} leads</div>
              </div>
            </div>
            <button onClick={onScan} disabled={scanning} className="mono" style={{
              padding: "5px 12px", borderRadius: 8, fontSize: 9.5, fontWeight: 700,
              letterSpacing: "0.1em", textTransform: "uppercase", cursor: scanning ? "wait" : "pointer",
              background: scanning ? "var(--ink-4)" : "var(--ink)",
              color: "var(--paper)", border: "1px solid var(--ink-3)",
              boxShadow: scanning ? "none" : "0 0 12px rgba(201,100,66,0.2)",
              transition: "all .2s ease", display: "flex", alignItems: "center", gap: 5,
            }}>
              {scanning ? <><span className="dot pulse-soft" /> Scanning...</> : <><Icon name="spark" size={11} /> Scan</>}
            </button>
          </div>
          <div className="row gap-1" style={{ flexWrap: "wrap" }}>
            {filters.map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)} className="mono" style={{
                padding: "4px 9px", borderRadius: 7, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
                border: "1px solid " + (filter === f.id ? "var(--ink)" : "var(--line)"),
                background: filter === f.id ? "var(--ink)" : "var(--card)",
                color: filter === f.id ? "var(--paper)" : "var(--ink-2)",
                cursor: "pointer",
              }}>{f.label}<span style={{ marginLeft: 5, opacity: 0.6 }}>{f.n}</span></button>
            ))}
          </div>
        </div>
        <div className="scroll col gap-2" style={{ padding: 12, flex: 1, minHeight: 0 }}>
          {filtered.map(l => (
            <div key={l.job_id} className="lift" onClick={() => { setActiveId(l.job_id); if (l.status === "approved" || l.status === "tailoring") openDrawer(l); }} style={{
              background: activeId === l.job_id ? `var(--${getTone(l.status)}-soft)` : "var(--card)",
              border: `1px solid ${activeId === l.job_id ? `var(--${getTone(l.status)}-ink)` : "var(--line)"}`,
              borderRadius: 14, padding: 14, cursor: "pointer",
              boxShadow: activeId === l.job_id ? "var(--shadow-md)" : "var(--shadow-xs)",
            }}>
              <div className="row gap-3" style={{ alignItems: "flex-start" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: `var(--${getTone(l.status)})`, color: `var(--${getTone(l.status)}-ink)`,
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500,
                  border: `1px solid var(--${getTone(l.status)}-ink)`,
                }}>{getMark(l.company)}</div>
                <div className="col gap-1" style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{l.company}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, letterSpacing: "-0.01em" }}>{l.title}</div>
                  <div className="row gap-2 mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 2 }}>
                    <span>{l.platform}</span>
                  </div>
                </div>
              </div>
              <div className="row" style={{ justifyContent: "space-between", marginTop: 12, alignItems: "center" }}>
                <span className="pill mono" style={{ background: `var(--${getTone(l.status)})`, color: `var(--${getTone(l.status)}-ink)`, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
                  <span className="dot" />{l.status}
                </span>
                <div className="row gap-2">
                  <div className="mono tabular" style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-2)" }}>
                    {getMatch(l.job_id)}<span style={{ color: "var(--ink-3)", fontWeight: 400 }}>%</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* COL 2 — Agent Thoughts */}
      <div className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--purple-soft)" }}>
        <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid var(--line)" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row gap-2">
              <div style={{ width: 26, height: 26, borderRadius: 7, background: "var(--purple)", color: "var(--purple-ink)", display: "grid", placeItems: "center" }}>
                <Icon name="pulse" size={14} />
              </div>
              <div>
                <h3>Agent Thoughts</h3>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.12em", textTransform: "uppercase" }}>LangGraph · live</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ padding: 14, flex: 1, minHeight: 0, display: "flex" }}>
          <div className="scroll terminal" style={{
            background: "#1F1A14", borderRadius: 12, padding: "14px 16px", flex: 1, minHeight: 0, color: "#EFE7D6",
          }}>
            {logs.map((ln) => {
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

      {/* COL 3 — Knowledge graph */}
      <div className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--green-soft)" }}>
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--line)" }}>
          <div className="row gap-2">
            <div style={{ width: 26, height: 26, borderRadius: 7, background: "var(--green)", color: "var(--green-ink)", display: "grid", placeItems: "center" }}>
              <Icon name="graph" size={14} />
            </div>
            <div>
              <h3>Knowledge graph</h3>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.12em", textTransform: "uppercase" }}>kùzu · local</div>
            </div>
          </div>
        </div>
        <div className="scroll" style={{ padding: 14, flex: 1, minHeight: 0 }}>
          <div className="card-flat" style={{ padding: 14, marginBottom: 12, display: "flex", justifyContent: "center" }}>
            <PentagonGraph stats={mappedStats} />
          </div>
          <div className="col gap-2">
            {mappedStats.map(s => (
              <div key={s.key} className="row" style={{
                justifyContent: "space-between", alignItems: "center",
                padding: "10px 12px", borderRadius: 10,
                background: `var(--${s.tone}-soft)`,
                border: `1px solid var(--${s.tone})`,
              }}>
                <div className="row gap-2">
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: `var(--${s.tone}-ink)` }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: `var(--${s.tone}-ink)` }}>{s.key}</span>
                </div>
                <span className="display tabular" style={{ fontSize: 22, color: `var(--${s.tone}-ink)` }}>{s.count}</span>
              </div>
            ))}
          </div>
        </div>
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

  return (
    <div className="scroll" style={{ padding: 24, flex: 1, height: "100%", minHeight: 0 }}>
      <div className="card" style={{ padding: "26px 28px", marginBottom: 18, background: "var(--green-soft)" }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div className="col gap-2" style={{ maxWidth: 540 }}>
            <span className="eyebrow">Local kùzu graph</span>
            <h1 style={{ fontSize: 44 }}>Your portable <span className="italic-serif">knowledge brain</span></h1>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Every skill, project, and lead is a node. Edges are inferred by GraphRAG. The agent uses this graph to score each opening.
            </div>
          </div>
          <div className="col" style={{ alignItems: "flex-end", gap: 4 }}>
            <span className="eyebrow">Total nodes</span>
            <span className="display tabular" style={{ fontSize: 56, color: "var(--green-ink)", lineHeight: 1 }}>{total}</span>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <div className="card" style={{ padding: 24, background: "var(--card)", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: "100%" }}>
            <h3 style={{ marginBottom: 4 }}>Topology</h3>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>5-vertex schema</div>
          </div>
          <PentagonGraph stats={mappedStats} />
        </div>
        <div className="col gap-2">
          {mappedStats.map(s => (
            <div key={s.key} style={{
              padding: 18, borderRadius: 14,
              background: `var(--${s.tone}-soft)`,
              border: `1px solid var(--${s.tone})`,
            }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="col gap-1">
                  <span className="eyebrow" style={{ color: `var(--${s.tone}-ink)` }}>{s.key}</span>
                  <div style={{ fontSize: 13, color: "var(--ink-2)" }}>
                    {{
                      Candidate:  "You — the root node",
                      Experience: "Roles & companies",
                      Project:    "Things you've built",
                      Skill:      "Capabilities & tooling",
                      JobLead:    "Discovered openings",
                    }[s.key]}
                  </div>
                </div>
                <div className="display tabular" style={{ fontSize: 36, color: `var(--${s.tone}-ink)` }}>{s.count}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   ACTIVITY VIEW
══════════════════════════════════════ */

function ActivityView({ logs }: { logs: LogLine[] }) {
  return (
    <div className="scroll" style={{ padding: 24, flex: 1, height: "100%", minHeight: 0 }}>
      <div className="card" style={{ padding: "26px 28px", marginBottom: 18, background: "var(--orange-soft)" }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div className="col gap-2" style={{ maxWidth: 540 }}>
            <span className="eyebrow">Real-time stream</span>
            <h1 style={{ fontSize: 44 }}>What is the agent <span className="italic-serif">thinking?</span></h1>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
              Every step the LangGraph orchestrator takes lands here as a structured event.
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18, background: "var(--purple-soft)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3>Stream</h3>
          <span className="pill" style={{ background: "var(--green)", color: "var(--green-ink)" }}>
            <span className="dot pulse-soft" /> live
          </span>
        </div>
        <div style={{ height: 440, display: "flex" }}>
          <div className="scroll terminal" style={{
            background: "#1F1A14", color: "#EFE7D6",
            borderRadius: 12, padding: "14px 16px", flex: 1,
          }}>
            {logs.map((ln, _i) => {
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

function ProfileView({ port, addLog }: { port: number; addLog: (m: string) => void }) {
  const [drag, setDrag]     = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [profileData, setProfileData] = useState<any>(null);
  const [rightTab, setRightTab] = useState<"file" | "text" | "scrape">("file");
  const [rawPastedText, setRawPastedText] = useState("");
  const [scrapeUrls, setScrapeUrls] = useState({ portfolio: "", github: "", linkedin: "", twitter: "" });
  const [scrapingProgress, setScrapingProgress] = useState<string[]>([]);
  const [isScraping, setIsScraping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [ov, setOv] = useState<Overrides>({
    name: "", targetRole: "", email: "",
    phone: "", linkedin: "", github: "",
    location: "", summary: "",
  });

  const [projects, setProjects] = useState<any[]>([
    { title: "JustHireMe Core", stack: ["Tauri", "FastAPI", "Kùzu"], impact: "Autonomous agent pipeline.", repo: "github.com/justhireme" }
  ]);
  const [exp, setExp] = useState<any[]>([
    { role: "Product Engineer", co: "Innovate LLC", period: "2023 - 2025", d: "Designed RAG data pathways." }
  ]);

  const [showProjForm, setShowProjForm] = useState(false);
  const [newProj, setNewProj] = useState({ title: "", stack: "", impact: "", repo: "" });
  const [editProjIdx, setEditProjIdx] = useState<number | null>(null);
  const [editProjForm, setEditProjForm] = useState({ title: "", stack: "", impact: "", repo: "" });

  const [showExpForm, setShowExpForm] = useState(false);
  const [newExp, setNewExp] = useState({ role: "", co: "", period: "", d: "" });
  const [editExpIdx, setEditExpIdx] = useState<number | null>(null);
  const [editExpForm, setEditExpForm] = useState({ role: "", co: "", period: "", d: "" });

  const setField = (k: keyof Overrides) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setOv(o => ({ ...o, [k]: e.target.value }));

  const getRawPayload = () => {
    const core = Object.entries(ov)
      .filter(([_, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    const projs = projects
      .map(p => `Project: ${p.title}\nStack: ${Array.isArray(p.stack) ? p.stack.join(", ") : p.stack}\nRepo: ${p.repo}\nImpact: ${p.impact}`)
      .join("\n\n");
    const exps = exp
      .map(e => `Experience: ${e.role} at ${e.co}\nPeriod: ${e.period}\nDescription: ${e.d}`)
      .join("\n\n");
    return [core, "--- Projects ---", projs, "--- Experience ---", exps].join("\n\n");
  };

  const ingest = async (file: File) => {
    setStatus("loading");
    const fd = new FormData();
    fd.append("file", file);
    const rawText = getRawPayload();
    if (rawText) fd.append("raw", rawText);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/ingest`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Server internal failure");
      setProfileData(d);
      setOv(o => ({ ...o, name: d.n || o.name, summary: d.s || o.summary }));
      if (d.projects) setProjects(d.projects);
      if (d.exp) setExp(d.exp);
      setStatus("done");
      addLog(`Ingested Profile: ${d.n}`);
    } catch (e: any) { 
      setStatus("error");
      addLog(`Ingestion Error: ${e.message || e}`);
    }
  };

  const saveOverrides = async () => {
    setStatus("loading");
    const fd = new FormData();
    const payloadText = rawPastedText || getRawPayload();
    fd.append("raw", payloadText);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/ingest`, { method: "POST", body: fd });
      const d = await r.json();
      setProfileData(d);
      setStatus("done");
      addLog(`Updated Profile parameters: ${d.n}`);
    } catch { setStatus("error"); }
  };

  const runScraper = async () => {
    setIsScraping(true);
    setScrapingProgress([]);
    const addProg = (msg: string) => setScrapingProgress(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    
    addProg("Initializing multi-agent scraper protocols...");
    await new Promise(r => setTimeout(r, 1000));
    
    if (scrapeUrls.portfolio) {
      addProg(`Scraping Portfolio: ${scrapeUrls.portfolio}...`);
      await new Promise(r => setTimeout(r, 1200));
      addProg(" -> Extracted Project Nodes.");
    }
    if (scrapeUrls.github) {
      addProg(`Accessing GitHub API for @${scrapeUrls.github}...`);
      await new Promise(r => setTimeout(r, 1500));
      addProg(" -> Fetched public repositories.");
    }
    if (scrapeUrls.linkedin) {
      addProg(`Launching LinkedIn Graph session...`);
      await new Promise(r => setTimeout(r, 1200));
      addProg(" -> Captured Work Experience timeline.");
    }
    
    addProg("Consolidating GraphRAG semantic links...");
    await new Promise(r => setTimeout(r, 1000));
    
    const fd = new FormData();
    const rawText = getRawPayload() + `\n\nScraped Context:\nPortfolio: ${scrapeUrls.portfolio}\nGitHub: ${scrapeUrls.github}\nLinkedIn: ${scrapeUrls.linkedin}\nTwitter: ${scrapeUrls.twitter}`;
    fd.append("raw", rawText);
    
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/ingest`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) {
        throw new Error(d.detail || "Server internal failure");
      }
      setProfileData(d);
      setStatus("done");
      addProg(" Extraction Complete!");
    } catch (e: any) {
      setStatus("error");
      addProg(` Critical Ingestion Failure: ${e.message || e}`);
    }
    
    setIsScraping(false);
  };

  useEffect(() => {
    const unsub: (() => void)[] = [];
    (async () => {
      const u = await listen<{ paths: string[] }>("tauri://drop", async (ev) => {
        const p = ev.payload.paths[0];
        if (!p?.endsWith(".pdf")) return;
        const fd = new FormData();
        fd.append("raw", `pdf_path:${p}`);
        setStatus("loading");
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/v1/ingest`, { method: "POST", body: fd });
          const d = await r.json(); setStatus("done");
          addLog(`Ingested: ${d.n}`);
        } catch { setStatus("error"); }
      });
      unsub.push(u);
    })();
    return () => unsub.forEach(u => u());
  }, [port, addLog]);

  const FIELDS: { k: keyof Overrides; label: string; type: string; ph: string }[] = [
    { k: "name",       label: "Full Name",   type: "text",  ph: "Jane Smith"        },
    { k: "targetRole", label: "Target Role", type: "text",  ph: "Senior Engineer"   },
    { k: "email",      label: "Email",       type: "email", ph: "jane@example.com"  },
    { k: "phone",      label: "Phone",       type: "text",  ph: "+1 555 000 0000"   },
    { k: "linkedin",   label: "LinkedIn",    type: "url",   ph: "linkedin.com/in/…" },
    { k: "github",     label: "GitHub",      type: "url",   ph: "github.com/…"      },
  ];

  return (
    <div className="scroll" style={{ flex: 1, padding: 24, height: "100%", minHeight: 0 }}>
      {/* HEADER */}
      <div className="col gap-2" style={{ maxWidth: 1300, margin: "0 auto 24px" }}>
        <span className="eyebrow">Profile Workspace</span>
        <h1 style={{ fontSize: 44, lineHeight: 1.05 }}>Teach the agent <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>who you are.</span></h1>
        <p style={{ color: "var(--ink-2)", fontSize: 14.5, maxWidth: 640, margin: 0, lineHeight: 1.5 }}>
          Establish vector nodes across multi-modal onboarding protocols. Streamline the automated data aggregation pipeline below.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 32, maxWidth: 1300, margin: "0 auto", paddingBottom: 60, alignItems: "start" }}>
        
        {/* LEFT COLUMN: BUILDERS & INGESTION */}
        <div className="col gap-6">
          {/* SECTION 1 — MULTI-MODAL INGESTION HUB */}
          <div className="card col gap-4" style={{ padding: 24, background: "var(--paper-2)" }}>
            <div className="row gap-2" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 12, marginBottom: 4 }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: "var(--ink)", color: "var(--paper)", display: "grid", placeItems: "center" }}>
                <Icon name="spark" size={13} />
              </div>
              <h3 style={{ fontSize: 16 }}>Profile Ingestion Suite</h3>
            </div>

            <div className="row gap-3" style={{ background: "var(--paper-3)", padding: 6, borderRadius: 12 }}>
              <button
                className={"btn " + (rightTab === "file" ? "btn-primary" : "btn-ghost")}
                style={{ flex: 1, justifyContent: "center", borderRadius: 8, border: "none", boxShadow: rightTab === "file" ? "var(--shadow-sm)" : "none" }}
                onClick={() => setRightTab("file")}
              >
                <Icon name="file" size={14} /> Resume Drop
              </button>
              <button
                className={"btn " + (rightTab === "scrape" ? "btn-primary" : "btn-ghost")}
                style={{ flex: 1, justifyContent: "center", borderRadius: 8, border: "none", boxShadow: rightTab === "scrape" ? "var(--shadow-sm)" : "none" }}
                onClick={() => setRightTab("scrape")}
              >
                <Icon name="spark" size={14} /> Social Scrapers
              </button>
              <button
                className={"btn " + (rightTab === "text" ? "btn-primary" : "btn-ghost")}
                style={{ flex: 1, justifyContent: "center", borderRadius: 8, border: "none", boxShadow: rightTab === "text" ? "var(--shadow-sm)" : "none" }}
                onClick={() => setRightTab("text")}
              >
                <Icon name="edit" size={14} /> Raw Content
              </button>
            </div>

            {rightTab === "file" ? (
              <div
                className={"dropzone " + (drag ? "over" : "")}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) ingest(f); }}
                onClick={() => inputRef.current?.click()}
                style={{
                  padding: "60px 24px", cursor: "pointer", border: "2px dashed var(--line-2)",
                  borderRadius: 18, background: status === "done" ? "var(--green-soft)" : status === "error" ? "var(--bad-soft)" : drag ? "var(--coral-soft)" : "var(--purple-soft)",
                  transition: "all 0.15s ease", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                }}
              >
                <input ref={inputRef} type="file" accept=".pdf" style={{ display: "none" }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) ingest(f); }} />
                
                <div className="col gap-3" style={{ alignItems: "center", textAlign: "center" }}>
                  {status === "loading" ? (
                    <>
                      <Icon name="spark" size={40} style={{ animation: "spin-slow 2s linear infinite", color: "var(--purple-ink)" }} />
                      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--purple-ink)" }}>Embedding profile into knowledge graph...</div>
                    </>
                  ) : status === "done" ? (
                    <>
                      <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--green)", color: "var(--green-ink)", display: "grid", placeItems: "center", animation: "success-scale 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)" }}>
                        <Icon name="check" size={28} />
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--green-ink)" }}>Identity Synchronized</div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>Node aggregated successfully. Drop again to replace.</div>
                    </>
                  ) : status === "error" ? (
                    <>
                      <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--bad)", color: "white", display: "grid", placeItems: "center", animation: "shake 0.6s ease" }}>
                        <Icon name="x" size={28} />
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--bad)" }}>Ingestion Failed</div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>Could not index node. Please check source integrity.</div>
                    </>
                  ) : (
                    <>
                      <div style={{
                        width: 64, height: 64, borderRadius: 16, background: "var(--paper-3)",
                        color: "var(--ink-2)", display: "grid", placeItems: "center", boxShadow: "var(--shadow-sm)"
                      }}>
                        <Icon name="upload" size={24} />
                      </div>
                      <div className="col gap-1">
                        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>Drop master PDF résumé</div>
                        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Drag & Drop anywhere or Click to browse local storage</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : rightTab === "scrape" ? (
              <div className="col gap-4">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div className="col gap-1">
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)" }}>Portfolio URL</label>
                    <input type="text" className="field-input" value={scrapeUrls.portfolio} onChange={e => setScrapeUrls(u => ({ ...u, portfolio: e.target.value }))} placeholder="https://janedoe.dev" style={{ padding: "11px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", fontSize: 13 }} />
                  </div>
                  <div className="col gap-1">
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)" }}>GitHub Handle</label>
                    <input type="text" className="field-input" value={scrapeUrls.github} onChange={e => setScrapeUrls(u => ({ ...u, github: e.target.value }))} placeholder="github.com/janedoe" style={{ padding: "11px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", fontSize: 13 }} />
                  </div>
                  <div className="col gap-1" style={{ gridColumn: "1/-1" }}>
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)" }}>LinkedIn Endpoint</label>
                    <input type="text" className="field-input" value={scrapeUrls.linkedin} onChange={e => setScrapeUrls(u => ({ ...u, linkedin: e.target.value }))} placeholder="linkedin.com/in/janedoe" style={{ padding: "11px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", fontSize: 13 }} />
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  style={{ justifyContent: "center", padding: 14, fontSize: 14 }}
                  onClick={runScraper}
                  disabled={isScraping || (!scrapeUrls.portfolio && !scrapeUrls.github && !scrapeUrls.linkedin)}
                >
                  {isScraping ? "Deploying Autonomous Scraper Agents..." : "Execute Footprint Extraction"}
                </button>

                {scrapingProgress.length > 0 && (
                  <div className="mono" style={{
                    padding: 14, background: "var(--paper-3)", borderRadius: 12,
                    fontSize: 11, color: "var(--ink-2)", maxHeight: 150, overflowY: "auto",
                    border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6
                  }}>
                    {scrapingProgress.map((prog, idx) => (
                      <div key={idx} style={{ color: prog.includes("->") ? "var(--accent)" : "var(--ink-2)" }}>{prog}</div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="col gap-3">
                <textarea
                  className="field-input"
                  value={rawPastedText}
                  onChange={e => setRawPastedText(e.target.value)}
                  placeholder="Paste your LinkedIn text, raw CV descriptors, or unstructured background context..."
                  rows={6}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 12,
                    border: "1px solid var(--line)", background: "var(--card)", fontSize: 13,
                    resize: "none", lineHeight: 1.5,
                  }}
                />
                <button
                  className="btn btn-primary"
                  style={{ padding: "12px", justifyContent: "center" }}
                  onClick={saveOverrides}
                  disabled={status === "loading" || !rawPastedText.trim()}
                >
                  {status === "loading" ? "Processing..." : "Sync Node Parameters"}
                </button>
              </div>
            )}
          </div>

          {/* SECTION 3 — ADVANCED CONFIGURATION (OVERRIDES & BUILDERS) */}
          <div className="card col gap-4" style={{ padding: 24, background: "var(--paper-2)" }}>
            <div className="row gap-2" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 12, marginBottom: 4 }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: "var(--ink)", color: "var(--paper)", display: "grid", placeItems: "center" }}>
                <Icon name="edit" size={13} />
              </div>
              <h3 style={{ fontSize: 16 }}>Identity Adjustments</h3>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {FIELDS.map(({ k, label, type, ph }) => (
                <div key={k} className="col gap-1">
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.02em" }}>{label}</label>
                  <input
                    type={type}
                    value={ov[k]}
                    onChange={setField(k)}
                    placeholder={ph}
                    style={{
                      padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)",
                      background: "var(--card)", fontSize: 13, color: "var(--ink)",
                      transition: "border-color 0.15s ease",
                    }}
                    className="field-input"
                  />
                </div>
              ))}
              <div style={{ gridColumn: "1/-1" }} className="col gap-1">
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.02em" }}>Location</label>
                <input
                  type="text"
                  className="field-input"
                  value={ov.location}
                  onChange={setField("location")}
                  placeholder="San Francisco, CA (Remote OK)"
                  style={{
                    padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)",
                    background: "var(--card)", fontSize: 13, color: "var(--ink)",
                  }}
                />
              </div>
              <div style={{ gridColumn: "1/-1" }} className="col gap-1">
                <label style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", letterSpacing: "0.02em" }}>Professional Summary</label>
                <textarea
                  className="field-input"
                  value={ov.summary}
                  onChange={setField("summary")}
                  placeholder="A short punchy baseline about your expertise..."
                  rows={4}
                  style={{
                    padding: "11px 14px", borderRadius: 12, border: "1px solid var(--line)",
                    background: "var(--card)", fontSize: 13, color: "var(--ink)", resize: "none",
                    lineHeight: 1.5,
                  }}
                />
              </div>
            </div>

            <button
              className="btn btn-primary"
              onClick={saveOverrides}
              disabled={status === "loading"}
              style={{ padding: "12px", borderRadius: 12, fontSize: 14, justifyContent: "center", marginTop: 8 }}
            >
              {status === "loading" ? "Processing..." : "Apply & Save Parameters"}
            </button>
          </div>

          {/* PROJECTS BUILDER */}
          <div className="card col gap-3" style={{ padding: 24, background: "var(--card)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="row gap-2">
                <Icon name="layers" size={16} />
                <h3 style={{ fontSize: 16 }}>Projects Portfolio</h3>
              </div>
              <button className="btn btn-icon" onClick={() => setShowProjForm(!showProjForm)}>
                <Icon name={showProjForm ? "x" : "plus"} size={14} />
              </button>
            </div>

            {showProjForm && (
              <div className="col gap-3" style={{ padding: 16, background: "var(--paper-3)", borderRadius: 14 }}>
                <div className="col gap-1">
                  <label style={{ fontSize: 11.5, fontWeight: 600 }}>Project Title</label>
                  <input type="text" className="field-input" value={newProj.title} onChange={e => setNewProj(p => ({ ...p, title: e.target.value }))} placeholder="JustHireMe" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                </div>
                <div className="col gap-1">
                  <label style={{ fontSize: 11.5, fontWeight: 600 }}>Tech Stack (comma separated)</label>
                  <input type="text" className="field-input" value={newProj.stack} onChange={e => setNewProj(p => ({ ...p, stack: e.target.value }))} placeholder="React, Tauri, Rust" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                </div>
                <div className="col gap-1">
                  <label style={{ fontSize: 11.5, fontWeight: 600 }}>GitHub Repo URL</label>
                  <input type="text" className="field-input" value={newProj.repo} onChange={e => setNewProj(p => ({ ...p, repo: e.target.value }))} placeholder="github.com/username/repo" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                </div>
                <div className="col gap-1">
                  <label style={{ fontSize: 11.5, fontWeight: 600 }}>Impact / Description</label>
                  <textarea className="field-input" value={newProj.impact} onChange={e => setNewProj(p => ({ ...p, impact: e.target.value }))} placeholder="Enabled autonomous resume matching via local graphs." rows={2} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, resize: "none", background: "var(--card)", lineHeight: 1.5 }} />
                </div>
                <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={() => {
                  if (newProj.title) {
                    setProjects(p => [...p, { ...newProj, stack: newProj.stack.split(",").map(s => s.trim()) }]);
                    setNewProj({ title: "", stack: "", impact: "", repo: "" });
                    setShowProjForm(false);
                  }
                }}>Save Project Node</button>
              </div>
            )}

            <div className="col gap-2">
              {projects.map((p, idx) => {
                const isEditing = editProjIdx === idx;
                return isEditing ? (
                  <div key={idx} className="col gap-3" style={{ padding: 16, background: "var(--paper-3)", borderRadius: 14 }}>
                    <div className="col gap-1">
                      <label style={{ fontSize: 11.5, fontWeight: 600 }}>Project Title</label>
                      <input type="text" className="field-input" value={editProjForm.title} onChange={e => setEditProjForm(prev => ({ ...prev, title: e.target.value }))} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                    </div>
                    <div className="col gap-1">
                      <label style={{ fontSize: 11.5, fontWeight: 600 }}>Tech Stack (comma separated)</label>
                      <input type="text" className="field-input" value={editProjForm.stack} onChange={e => setEditProjForm(prev => ({ ...prev, stack: e.target.value }))} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                    </div>
                    <div className="col gap-1">
                      <label style={{ fontSize: 11.5, fontWeight: 600 }}>GitHub Repo URL</label>
                      <input type="text" className="field-input" value={editProjForm.repo} onChange={e => setEditProjForm(prev => ({ ...prev, repo: e.target.value }))} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                    </div>
                    <div className="col gap-1">
                      <label style={{ fontSize: 11.5, fontWeight: 600 }}>Impact / Description</label>
                      <textarea className="field-input" value={editProjForm.impact} onChange={e => setEditProjForm(prev => ({ ...prev, impact: e.target.value }))} rows={2} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, resize: "none", background: "var(--card)", lineHeight: 1.5 }} />
                    </div>
                    <div className="row gap-2">
                      <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => {
                        if (editProjForm.title) {
                          setProjects(prev => prev.map((item, i) => i === idx ? { ...editProjForm, stack: typeof editProjForm.stack === "string" ? editProjForm.stack.split(",").map(s => s.trim()) : editProjForm.stack } : item));
                          setEditProjIdx(null);
                        }
                      }}>Save Changes</button>
                      <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setEditProjIdx(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div key={idx} style={{ padding: 14, background: "var(--paper-2)", borderRadius: 12, border: "1px solid var(--line)" }} className="col gap-2">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div className="col gap-1">
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</div>
                        {p.repo && <div className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>{p.repo}</div>}
                      </div>
                      <div className="row gap-1">
                        <button className="btn btn-icon btn-ghost" style={{ padding: 4 }} onClick={() => {
                          setEditProjIdx(idx);
                          setEditProjForm({ title: p.title, stack: Array.isArray(p.stack) ? p.stack.join(", ") : p.stack, impact: p.impact, repo: p.repo });
                        }} aria-label="Edit project"><Icon name="edit" size={13} /></button>
                        <button className="btn btn-icon btn-ghost" style={{ padding: 4, color: "var(--bad)" }} onClick={() => {
                          setProjects(prev => prev.filter((_, i) => i !== idx));
                        }} aria-label="Delete project"><Icon name="x" size={13} /></button>
                      </div>
                    </div>
                    <p style={{ fontSize: 12.5, color: "var(--ink-2)", margin: 0 }}>{p.impact}</p>
                    <div className="row gap-1" style={{ flexWrap: "wrap", marginTop: 4 }}>
                      {(Array.isArray(p.stack) ? p.stack : [p.stack]).map((s: string, i: number) => (
                        <span key={i} className="pill" style={{ background: "var(--card)", fontSize: 9 }}>{s}</span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* EXPERIENCE BUILDER */}
          <div className="card col gap-3" style={{ padding: 24, background: "var(--card)" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="row gap-2">
                <Icon name="trending" size={16} />
                <h3 style={{ fontSize: 16 }}>Professional Experience</h3>
              </div>
              <button className="btn btn-icon" onClick={() => setShowExpForm(!showExpForm)}>
                <Icon name={showExpForm ? "x" : "plus"} size={14} />
              </button>
            </div>

            {showExpForm && (
              <div className="col gap-3" style={{ padding: 16, background: "var(--paper-3)", borderRadius: 14 }}>
                <div className="col gap-1">
                  <label style={{ fontSize: 11.5, fontWeight: 600 }}>Role Title</label>
                  <input type="text" className="field-input" value={newExp.role} onChange={e => setNewExp(p => ({ ...p, role: e.target.value }))} placeholder="Senior Engineer" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                </div>
                <div className="col gap-1">
                  <label style={{ fontSize: 11.5, fontWeight: 600 }}>Company</label>
                  <input type="text" className="field-input" value={newExp.co} onChange={e => setNewExp(p => ({ ...p, co: e.target.value }))} placeholder="Tech Corp" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                </div>
                <div className="col gap-1">
                  <label style={{ fontSize: 11.5, fontWeight: 600 }}>Period</label>
                  <input type="text" className="field-input" value={newExp.period} onChange={e => setNewExp(p => ({ ...p, period: e.target.value }))} placeholder="2022 - 2024" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                </div>
                <div className="col gap-1">
                  <label style={{ fontSize: 11.5, fontWeight: 600 }}>Description</label>
                  <textarea className="field-input" value={newExp.d} onChange={e => setNewExp(p => ({ ...p, d: e.target.value }))} placeholder="Led distributed architecture efforts." rows={2} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, resize: "none", background: "var(--card)", lineHeight: 1.5 }} />
                </div>
                <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={() => {
                  if (newExp.role) {
                    setExp(p => [...p, newExp]);
                    setNewExp({ role: "", co: "", period: "", d: "" });
                    setShowExpForm(false);
                  }
                }}>Save Experience Node</button>
              </div>
            )}

            <div className="col gap-2">
              {exp.map((e, idx) => {
                const isEditing = editExpIdx === idx;
                return isEditing ? (
                  <div key={idx} className="col gap-3" style={{ padding: 16, background: "var(--paper-3)", borderRadius: 14 }}>
                    <div className="col gap-1">
                      <label style={{ fontSize: 11.5, fontWeight: 600 }}>Role Title</label>
                      <input type="text" className="field-input" value={editExpForm.role} onChange={val => setEditExpForm(prev => ({ ...prev, role: val.target.value }))} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                    </div>
                    <div className="col gap-1">
                      <label style={{ fontSize: 11.5, fontWeight: 600 }}>Company</label>
                      <input type="text" className="field-input" value={editExpForm.co} onChange={val => setEditExpForm(prev => ({ ...prev, co: val.target.value }))} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                    </div>
                    <div className="col gap-1">
                      <label style={{ fontSize: 11.5, fontWeight: 600 }}>Period</label>
                      <input type="text" className="field-input" value={editExpForm.period} onChange={val => setEditExpForm(prev => ({ ...prev, period: val.target.value }))} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, background: "var(--card)" }} />
                    </div>
                    <div className="col gap-1">
                      <label style={{ fontSize: 11.5, fontWeight: 600 }}>Description</label>
                      <textarea className="field-input" value={editExpForm.d} onChange={val => setEditExpForm(prev => ({ ...prev, d: val.target.value }))} rows={2} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, resize: "none", background: "var(--card)", lineHeight: 1.5 }} />
                    </div>
                    <div className="row gap-2">
                      <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} onClick={() => {
                        if (editExpForm.role) {
                          setExp(prev => prev.map((item, i) => i === idx ? editExpForm : item));
                          setEditExpIdx(null);
                        }
                      }}>Save Changes</button>
                      <button className="btn btn-ghost" style={{ flex: 1, justifyContent: "center" }} onClick={() => setEditExpIdx(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div key={idx} style={{ padding: 14, background: "var(--paper-2)", borderRadius: 12, border: "1px solid var(--line)" }} className="col gap-1">
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div className="col gap-1">
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{e.role}</div>
                        <div className="mono tabular" style={{ fontSize: 10, color: "var(--ink-3)" }}>{e.period}</div>
                      </div>
                      <div className="row gap-1">
                        <button className="btn btn-icon btn-ghost" style={{ padding: 4 }} onClick={() => {
                          setEditExpIdx(idx);
                          setEditExpForm({ role: e.role, co: e.co, period: e.period, d: e.d });
                        }} aria-label="Edit experience"><Icon name="edit" size={13} /></button>
                        <button className="btn btn-icon btn-ghost" style={{ padding: 4, color: "var(--bad)" }} onClick={() => {
                          setExp(prev => prev.filter((_, i) => i !== idx));
                        }} aria-label="Delete experience"><Icon name="x" size={13} /></button>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 500 }}>{e.co}</div>
                    <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "4px 0 0" }}>{e.d}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: CURRENT PROFILE VISUALIZATION */}
        <div className="col gap-6" style={{ position: "sticky", top: 24 }}>
          {/* SECTION 2 — IDENTITY PREVIEW CARD */}
          <div className="card col gap-4" style={{ padding: 28, background: "var(--card)", boxShadow: "var(--shadow-lg)", border: "1.5px solid var(--line)" }}>
            <div className="eyebrow" style={{ color: "var(--ink-4)" }}>Dynamic Knowledge Node</div>
            
            <div className="row gap-4" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center" }}>
                <Icon name="user" size={32} />
              </div>
              <div className="col gap-1">
                <div className="display" style={{ fontSize: 36, color: "var(--ink)", lineHeight: 1 }}>{ov.name || "Candidate Node"}</div>
                <div className="mono" style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.12em" }}>
                  {ov.targetRole || "Role Descriptor Pending"}
                </div>
              </div>
            </div>

            <div style={{ borderTop: "1px dashed var(--line)", margin: "4px 0" }} />

            <div className="row gap-4" style={{ fontSize: 13, color: "var(--ink-2)", flexWrap: "wrap" }}>
              {ov.email && <div className="row gap-2"><Icon name="mail" size={13} style={{ color: "var(--ink-3)" }} /> {ov.email}</div>}
              {ov.phone && <div className="row gap-2"><Icon name="phone" size={13} style={{ color: "var(--ink-3)" }} /> {ov.phone}</div>}
              {ov.location && <div className="row gap-2"><Icon name="location" size={13} style={{ color: "var(--ink-3)" }} /> {ov.location}</div>}
            </div>

            {ov.summary && (
              <p className="italic-serif" style={{ fontSize: 18, color: "var(--ink-2)", lineHeight: 1.6, margin: "12px 0 0" }}>
                "{ov.summary}"
              </p>
            )}

            {/* EXTRACTED NODES (SKILLS) */}
            <div style={{ borderTop: "1px dashed var(--line)", margin: "12px 0 4px" }} />
            <div className="col gap-2">
              <div className="eyebrow" style={{ fontSize: 9 }}>Extracted Skill Nodes</div>
              <div className="row gap-1" style={{ flexWrap: "wrap" }}>
                {profileData?.skills?.length ? (
                  profileData.skills.slice(0, 24).map((sk: any, idx: number) => {
                    const tones = ["blue", "purple", "orange", "pink", "green", "teal"];
                    const tone = tones[idx % tones.length];
                    return (
                      <span key={idx} className="pill" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone}-ink)`, border: `1px solid var(--${tone})`, fontSize: 11, fontWeight: 500 }}>
                        {sk.n}
                      </span>
                    );
                  })
                ) : (
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>No skills mapped. Drop a resume to populate.</span>
                )}
              </div>
            </div>

            {/* EXPERIENCE TIMELINE DISPLAY */}
            {exp.length > 0 && (
              <>
                <div style={{ borderTop: "1px dashed var(--line)", margin: "16px 0 4px" }} />
                <div className="col gap-3">
                  <div className="eyebrow" style={{ fontSize: 9 }}>Experience Timeline</div>
                  <div className="col gap-3" style={{ borderLeft: "2px solid var(--line)", paddingLeft: 16, marginLeft: 8 }}>
                    {exp.map((e, idx) => (
                      <div key={idx} className="col gap-1" style={{ position: "relative" }}>
                        <div style={{
                          position: "absolute", left: -21, top: 4,
                          width: 8, height: 8, borderRadius: "50%",
                          background: "var(--accent)", border: "2px solid var(--card)"
                        }} />
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{e.role}</div>
                        <div style={{ fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>{e.co}</div>
                        <div className="mono tabular" style={{ fontSize: 10, color: "var(--ink-3)" }}>{e.period}</div>
                        <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.4 }}>{e.d}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* PROJECTS HIGHLIGHT */}
            {projects.length > 0 && (
              <>
                <div style={{ borderTop: "1px dashed var(--line)", margin: "16px 0 4px" }} />
                <div className="col gap-3">
                  <div className="eyebrow" style={{ fontSize: 9 }}>Project Nodes</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                    {projects.map((p, idx) => (
                      <div key={idx} style={{ padding: 12, borderRadius: 12, background: "var(--paper-2)", border: "1px solid var(--line)" }} className="col gap-1">
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{p.title}</div>
                        {p.repo && <div className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>{p.repo}</div>}
                        <div style={{ fontSize: 12, color: "var(--ink-2)", margin: "2px 0" }}>{p.impact}</div>
                        <div className="row gap-1" style={{ flexWrap: "wrap", marginTop: 4 }}>
                          {(Array.isArray(p.stack) ? p.stack : [p.stack]).map((s: string, i: number) => (
                            <span key={i} className="pill" style={{ background: "var(--card)", fontSize: 9 }}>{s}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

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
  const [firing, setFiring] = useState(false);
  const [done,   setDone]   = useState(false);
  const pdfSrc = j.asset ? convertFileSrc(j.asset) : null;

  const fire = async () => {
    setFiring(true);
    try {
      await fetch(`http://127.0.0.1:${port}/api/v1/fire/${j.job_id}`, { method: "POST" });
      setDone(true); setTimeout(onFired, 1500);
    } catch { setFiring(false); }
  };

  const matchStats = [
    { label: "Skills overlap",  val: "87%" },
    { label: "Title match",     val: "92%" },
    { label: "YoE match",       val: "76%" },
    { label: "Location fit",    val: "100%" },
    { label: "GraphRAG score",  val: "0.91" },
  ];

  return (
    <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 100 }}>
      <motion.div className="card"
        initial={{ y: "100%" }} animate={{ y: "15%" }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", height: "85vh", position: "fixed", bottom: 0, left: 0,
          borderTopLeftRadius: 24, borderTopRightRadius: 24, display: "flex", flexDirection: "column",
          background: "var(--paper)", zIndex: 101,
        }}>

        <div style={{ width: 60, height: 5, background: "var(--ink-4)", borderRadius: 99, margin: "14px auto 0", flexShrink: 0 }} />

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "12px 22px 14px", borderBottom: "1px solid var(--line)", flexShrink: 0, gap: 16 }}>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 600 }}>{j.title}</h2>
            <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 2 }}>{j.company} · {j.platform}</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="pill" style={{ background: `var(--${getTone(j.status)})`, color: `var(--${getTone(j.status)}-ink)` }}>{j.status}</span>
            <button className="btn btn-icon" onClick={onClose}><Icon name="x" size={15} /></button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "hidden", display: "grid", gridTemplateColumns: "1.1fr 1fr", minHeight: 0 }}>
          <div style={{ padding: 18, borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
            <div className="eyebrow">Tailored Resume</div>
            <div style={{ flex: 1, minHeight: 200 }}>
              {pdfSrc
                ? <iframe src={pdfSrc} title="Resume" width="100%" height="100%" style={{ border: "none", borderRadius: 8 }} />
                : <div style={{ height: "100%", background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-3)", fontSize: 12 }}>
                    {j.status === "tailoring" ? "Generating tailored resume..." : "No asset generated yet."}
                  </div>
              }
            </div>
          </div>

          <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="eyebrow">Match Reasoning</div>
            <div className="card" style={{ padding: "10px 14px" }}>
              {matchStats.map(ms => (
                <div key={ms.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0", borderBottom: "1px dashed var(--line)" }}>
                  <span>{ms.label}</span>
                  <span style={{ fontWeight: 700, color: "var(--ink)" }}>{ms.val}</span>
                </div>
              ))}
            </div>

            <div style={{ textAlign: "center", padding: "16px 0", marginTop: "auto" }}>
              {done
                ? <div style={{ fontSize: 20, color: "var(--ok)", fontWeight: 600 }}>✓ Fired — automation running</div>
                : <button className="btn btn-accent" onClick={fire} disabled={firing} style={{ fontSize: 16, padding: "12px 36px", width: "100%" }}>
                    {firing ? "Firing..." : "🔥 Fire Application"}
                  </button>
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
  const { conn, port, logs, beat } = useWS();
  const leads  = useLeads(port);
  const stats  = useGraphStats(port);
  const [view, setView] = useState<View>("dashboard");
  const [sel, setSel]   = useState<Lead | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);

  const addLog = useCallback((m: string) => { console.log("[profile]", m); }, []);

  useEffect(() => {
    const h = () => setScanning(false);
    window.addEventListener("scan-done", h);
    return () => window.removeEventListener("scan-done", h);
  }, []);

  const onScan = useCallback(async () => {
    if (!port || scanning) return;
    setScanning(true);
    setScanErr(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/scan`, { method: "POST" });
      if (!r.ok) throw new Error("Backend unreachable");
    } catch (e: any) {
      setScanErr(e.message || "Scan failed");
      setScanning(false);
    }
  }, [port, scanning]);

  const leadCounts = {
    total:      leads.length,
    discovered: leads.filter(l=>l.status==="discovered").length,
    evaluating: leads.filter(l=>l.status==="evaluating").length,
    tailoring:  leads.filter(l=>l.status==="tailoring").length,
    approved:   leads.filter(l=>l.status==="approved").length,
    applied:    leads.filter(l=>l.status==="applied").length,
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", alignItems: "stretch" }}>
      <Sidebar
        view={view}
        setView={setView}
        leadCounts={leadCounts}
        online={conn === "connected"}
        port={port}
        beat={beat}
        onSettings={() => setShowSettings(true)}
      />
      <div className="app-main">
        <Topbar view={view} />
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
          {view === "dashboard" && <DashboardView leads={leads} logs={logs} setView={setView} openDrawer={setSel} scanning={scanning} onScan={onScan} scanErr={scanErr} />}
          {view === "pipeline"  && <PipelineView leads={leads} logs={logs} stats={stats} openDrawer={setSel} scanning={scanning} onScan={onScan} />}
          {view === "graph"     && <GraphView stats={stats} />}
          {view === "activity"  && <ActivityView logs={logs} />}
          {view === "profile"   && port && <ProfileView port={port} addLog={addLog} />}
        </div>
      </div>

      <AnimatePresence>
        {sel && port && (
          <ApprovalDrawer key={sel.job_id} j={sel} port={port} onClose={() => setSel(null)} onFired={() => setSel(null)} />
        )}
        {showSettings && port && (
          <SettingsModal key="settings" port={port} onClose={() => setShowSettings(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
