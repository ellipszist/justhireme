import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { motion, AnimatePresence } from "framer-motion";
import SettingsModal from "./SettingsModal";
import Icon from "./components/Icon";
import "./index.css";

// Types
type ConnSt = "disconnected" | "connecting" | "connected";
type View = "apply" | "dashboard" | "inbox" | "pipeline" | "graph" | "activity" | "profile" | "ingestion";
type PipelineTab = "all" | "hot" | "found" | "evaluated" | "generated" | "applied" | "discarded";
type LeadSort = "recommended" | "newest" | "signal" | "match" | "company";
type SeniorityFilter = "all" | "beginner" | "fresher" | "junior" | "mid" | "senior" | "unknown";

interface KeywordCoverage {
  jd_terms?: string[];
  covered_terms?: string[];
  missing_terms?: string[];
  incorporated_terms?: string[];
  coverage_pct?: number;
}

interface ContactLookup {
  status?: string;
  domain?: string;
  message?: string;
  primary_contact?: {
    name?: string;
    first_name?: string;
    title?: string;
    email?: string;
    linkedin_url?: string;
    confidence?: number;
    personalized_email?: string;
  };
  contacts?: {
    name?: string;
    title?: string;
    email?: string;
    linkedin_url?: string;
    confidence?: number;
  }[];
}

interface Lead {
  job_id: string; title: string; company: string;
  url: string; platform: string; status: string; asset: string;
  resume_asset?: string; cover_letter_asset?: string; selected_projects?: string[];
  keyword_coverage?: KeywordCoverage;
  contact_lookup?: ContactLookup;
  score: number; reason: string; match_points: string[]; gaps?: string[];
  description?: string; kind?: string; budget?: string;
  signal_score?: number; signal_reason?: string; signal_tags?: string[];
  base_signal_score?: number; learning_delta?: number; learning_reason?: string;
  outreach_reply?: string; outreach_dm?: string; outreach_email?: string; proposal_draft?: string;
  fit_bullets?: string[]; followup_sequence?: string[]; proof_snippet?: string;
  tech_stack?: string[]; location?: string; urgency?: string;
  seniority_level?: string;
  source_meta?: Record<string, any>; feedback?: string; feedback_note?: string;
  followup_due_at?: string; last_contacted_at?: string;
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
const PAGE_SIZE = 80;
const ONBOARDING_KEY = "justhireme:onboarding:v1";
const DEMO_JOB_DRAFT = `https://jobs.example.com/applied-ai-engineer-demo

Applied AI Engineer
Company: NimbusWorks
Location: Remote

Build production AI workflows for hiring teams using Python, FastAPI, React, PostgreSQL, background jobs, prompt evaluation, and ATS-friendly document generation. The role needs someone comfortable with LLM integrations, CI/CD, observability, and shipping user-facing automation from messy product requirements.`;

const leadSignal = (lead: Lead) => Math.max(lead.signal_score || 0, lead.score || 0);

const leadSearchText = (lead: Lead) => [
  lead.title, lead.company, lead.platform, lead.status, lead.kind, lead.budget,
  lead.location, lead.urgency, lead.feedback, lead.description, lead.reason,
  lead.signal_reason, lead.learning_reason, ...(lead.signal_tags || []), ...(lead.tech_stack || []),
].join(" ").toLowerCase();

const uniqueLeadValues = (leads: Lead[], key: keyof Lead) =>
  Array.from(new Set(leads.map(l => String(l[key] || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));

const normalizeSeniority = (value: unknown): SeniorityFilter => {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "fresher" || raw === "freshers" || raw === "intern" || raw === "internship" || raw === "new grad") return "fresher";
  if (raw === "junior" || raw === "jr" || raw === "entry" || raw === "entry level") return "junior";
  if (raw === "mid" || raw === "middle" || raw === "mid-level" || raw === "mid level") return "mid";
  if (raw === "senior" || raw === "sr" || raw === "lead" || raw === "staff" || raw === "principal") return "senior";
  return "unknown";
};

const leadSeniority = (lead: Lead): SeniorityFilter => {
  const fromMeta = normalizeSeniority(lead.seniority_level || lead.source_meta?.seniority_level || lead.source_meta?.seniority);
  if (fromMeta !== "unknown") return fromMeta;

  const text = [lead.title, lead.description, lead.reason, ...(lead.signal_tags || [])].join(" ").toLowerCase();
  const years = Array.from(text.matchAll(/(\d{1,2})\s*(?:\+|to|-)?\s*(?:years|yrs|yoe)/g)).map(m => Number(m[1])).filter(Boolean);
  const maxYears = years.length ? Math.max(...years) : 0;
  if (/\b(senior|sr\.?|staff|principal|lead|manager|director|architect|head of)\b/.test(text) || maxYears >= 5) return "senior";
  if (/\b(mid[- ]?level|intermediate|engineer ii|developer ii|sde ii)\b/.test(text) || maxYears >= 3) return "mid";
  if (/\b(fresher|new grad|graduate|internship?|trainee|apprentice|campus|no experience)\b/.test(text) || maxYears === 1) return "fresher";
  if (/\b(junior|jr\.?|entry[- ]?level|associate|early career|0-2 years?|1-2 years?|engineer i|developer i|sde i)\b/.test(text) || maxYears === 2) return "junior";
  return "unknown";
};

const seniorityLabel = (level: SeniorityFilter) => ({
  fresher: "Fresher",
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
  beginner: "Beginner",
  unknown: "Unknown",
  all: "All levels",
}[level]);

const seniorityTone = (level: SeniorityFilter) => ({
  fresher: "teal",
  junior: "green",
  mid: "yellow",
  senior: "purple",
  beginner: "green",
  unknown: "blue",
  all: "blue",
}[level]);

const seniorityMatches = (lead: Lead, filter: SeniorityFilter) => {
  if (filter === "all") return true;
  const level = leadSeniority(lead);
  if (filter === "beginner") return level === "fresher" || level === "junior";
  return level === filter;
};

const cleanLeadText = (value: unknown) =>
  String(value || "").replace(/\s+/g, " ").trim();

const stripCompanyPrefix = (title: string, company: string) => {
  if (!title || !company) return title;
  const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title.replace(new RegExp(`^${escaped}\\s*(?:[|:-]+)\\s*`, "i"), "").trim();
};

const isLocationLike = (part: string) =>
  /\b(remote|onsite|on-site|hybrid|san francisco|new york|nyc|toronto|canada|india|usa|united states|europe|london|berlin|office|flexibility)\b/i.test(part) ||
  /^[A-Z][A-Za-z .-]+,\s*[A-Z]{2,}$/i.test(part);

const isCompLike = (part: string, company: string) => {
  const normalized = part.toLowerCase().replace(/^www\./, "");
  const co = company.toLowerCase().replace(/^www\./, "");
  return Boolean(
    normalized === co ||
    normalized === `${co}.com` ||
    normalized.includes(`${co}.com`) ||
    (co && normalized.includes(co) && normalized.length <= co.length + 8)
  );
};

const cleanRoleSegment = (segment: string) => {
  let role = cleanLeadText(segment);
  const looking = role.match(/\b(?:looking for|hiring(?: for)?|we are hiring|we're hiring)\s*:?\s*(?:a|an|two|[0-9]+)?\s*([^.;|]+)/i);
  if (looking?.[1]) role = cleanLeadText(looking[1]);
  role = role.replace(/\s+(?:to join|to help|for our|in our|at our)\b[\s\S]*$/i, "").trim();
  role = role.replace(/\s+\$[\s\S]*$/i, "").trim();
  role = role.replace(/\s+(?:we are hiring|we're hiring|looking for|hiring)\b[\s\S]*$/i, "").trim();
  role = role.replace(/\s+[–—-]\s*(?:we'?re|we are|looking|hiring)\b[\s\S]*$/i, "").trim();
  return role;
};

const roleFromLead = (lead: Lead) => {
  const company = cleanLeadText(lead.company) || "Unknown company";
  const rawTitle = cleanLeadText(lead.title);
  const parts = rawTitle.split(/\s*\|\s*/).map(cleanLeadText).filter(Boolean);
  const roleHints = /\b(engineer|developer|designer|product|backend|front[- ]?end|frontend|full[- ]?stack|ai|ml|data|software|devops|sre|mobile|ios|android|platform|founding|deployed|research|intern|analyst|architect|security|qa)\b/i;
  const noisy = (part: string) =>
    isCompLike(part, company) ||
    isLocationLike(part) ||
    /^\$|₹|€|£/.test(part) ||
    /\b(equity|salary|visa|remote|onsite|hybrid)\b/i.test(part);
  const candidates = parts.map(cleanRoleSegment).filter(part => part && !noisy(part));
  const hinted = candidates.find(part => roleHints.test(part));
  const fallback = cleanRoleSegment(stripCompanyPrefix(rawTitle, company));
  const role = cleanLeadText(hinted || candidates[0] || fallback || "Untitled role");
  return role.length > 96 ? `${role.slice(0, 93).trim()}...` : role;
};

const leadDisplayHeading = (lead: Lead) => {
  const company = cleanLeadText(lead.company) || "Unknown company";
  return { role: roleFromLead(lead), company };
};

const sortLeads = (items: Lead[], sort: LeadSort) => {
  const copy = [...items];
  if (sort === "signal") return copy.sort((a, b) => (b.signal_score || 0) - (a.signal_score || 0));
  if (sort === "match") return copy.sort((a, b) => (b.score || 0) - (a.score || 0));
  if (sort === "company") return copy.sort((a, b) => `${a.company} ${a.title}`.localeCompare(`${b.company} ${b.title}`));
  if (sort === "recommended") {
    return copy.sort((a, b) => {
      const aContacted = a.last_contacted_at ? 1 : 0;
      const bContacted = b.last_contacted_at ? 1 : 0;
      return (
        leadSignal(b) - leadSignal(a) ||
        (b.learning_delta || 0) - (a.learning_delta || 0) ||
        bContacted - aContacted ||
        (b.budget ? 1 : 0) - (a.budget ? 1 : 0)
      );
    });
  }
  return copy;
};

function LeadFilterBar({
  search, setSearch, platform, setPlatform, minSignal, setMinSignal,
  minMatch, setMinMatch, sort, setSort, budgetOnly, setBudgetOnly,
  learningOnly, setLearningOnly, seniority, setSeniority, platforms, total, shown, label,
}: {
  search: string; setSearch: (v: string) => void;
  platform: string; setPlatform: (v: string) => void;
  minSignal: number; setMinSignal: (v: number) => void;
  minMatch: number; setMinMatch: (v: number) => void;
  sort: LeadSort; setSort: (v: LeadSort) => void;
  budgetOnly: boolean; setBudgetOnly: (v: boolean) => void;
  learningOnly: boolean; setLearningOnly: (v: boolean) => void;
  seniority: SeniorityFilter; setSeniority: (v: SeniorityFilter) => void;
  platforms: string[]; total: number; shown: number; label: string;
}) {
  const hasFilters = Boolean(search || platform || minSignal || minMatch || budgetOnly || learningOnly || seniority !== "all");
  const resetFilters = () => {
    setSearch("");
    setPlatform("");
    setMinSignal(0);
    setMinMatch(0);
    setBudgetOnly(false);
    setLearningOnly(false);
    setSeniority("all");
    setSort("recommended");
  };
  const toggleClass = (active: boolean) => `pipeline-toggle ${active ? "active" : ""}`;

  return (
    <div className="pipeline-filterbar">
      <label className="pipeline-searchbox">
        <Icon name="search" size={14} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${label}`}
        />
      </label>

      <div className="pipeline-filter-fields">
        <label className="pipeline-field">
          <span>Source</span>
          <select value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="">All sources</option>
            {platforms.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="pipeline-field">
          <span>Level</span>
          <select value={seniority} onChange={e => setSeniority(e.target.value as SeniorityFilter)}>
            <option value="all">All levels</option>
            <option value="beginner">Beginner</option>
            <option value="fresher">Fresher</option>
            <option value="junior">Junior</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="pipeline-field">
          <span>Sort</span>
          <select value={sort} onChange={e => setSort(e.target.value as LeadSort)}>
            <option value="recommended">Recommended</option>
            <option value="newest">Newest</option>
            <option value="signal">Signal score</option>
            <option value="match">Match score</option>
            <option value="company">Company</option>
          </select>
        </label>
        <label className="pipeline-field compact">
          <span>Signal</span>
          <input
            type="number"
            min={0}
            max={100}
            value={minSignal}
            onChange={e => setMinSignal(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            title="Minimum signal score"
          />
        </label>
        <label className="pipeline-field compact">
          <span>Fit</span>
          <input
            type="number"
            min={0}
            max={100}
            value={minMatch}
            onChange={e => setMinMatch(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            title="Minimum fit score"
          />
        </label>
      </div>

      <div className="pipeline-filter-actions">
        <button className={toggleClass(budgetOnly)} onClick={() => setBudgetOnly(!budgetOnly)}>Budget</button>
        <button className={toggleClass(learningOnly)} onClick={() => setLearningOnly(!learningOnly)}>Learned</button>
        <button className="pipeline-clear" onClick={resetFilters} disabled={!hasFilters}>Clear</button>
        <span className="pipeline-count mono">{shown}/{total}</span>
      </div>
    </div>
  );
}

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
    case "matched":      return "green";
    case "bidding":      return "teal";
    case "proposal_sent": return "purple";
    case "awarded":      return "blue";
    case "completed":    return "green";
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
          if (d.event === "reeval_done") {
            window.dispatchEvent(new CustomEvent("reevaluate-done"));
            window.dispatchEvent(new CustomEvent("leads-refresh"));
          }
          if (d.event === "cleanup_done") {
            window.dispatchEvent(new CustomEvent("cleanup-done"));
            window.dispatchEvent(new CustomEvent("leads-refresh"));
          }
          if (d.event === "auto_discard_done") window.dispatchEvent(new CustomEvent("leads-refresh"));
        } else if (d.type === "LEAD_UPDATED" && d.data) {
          window.dispatchEvent(new CustomEvent("lead-updated", { detail: d.data }));
        } else if (d.type === "HOT_X_LEAD" && d.data) {
          window.dispatchEvent(new CustomEvent("hot-x-lead", { detail: d.data }));
          if ("Notification" in window && Notification.permission === "granted") {
            const lead = d.data as Lead;
            new Notification("Hot X lead", { body: `${lead.company}: ${lead.title}` });
          }
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
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!port) {
      setLoading(true);
      setLoaded(false);
      return;
    }
    let alive = true;
    const load = async (background = false) => {
      if (!background) setLoading(true);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/v1/leads`);
        if (!r.ok) throw new Error(`Lead load failed (${r.status})`);
        const items = await r.json();
        if (!alive) return;
        setLeads((items as Lead[]).filter(l => (l.kind || "job") !== "freelance"));
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Lead load failed");
      } finally {
        if (alive) {
          setLoading(false);
          setLoaded(true);
        }
      }
    };
    load(false);

    // Keep leads fresh when backend broadcasts LEAD_UPDATED over WS
    const onLeadUpdated = (e: Event) => {
      const updated = (e as CustomEvent<Lead>).detail;
      setLoaded(true);
      setLoading(false);
      setLeads(prev => {
        const idx = prev.findIndex(l => l.job_id === updated.job_id);
        if (idx === -1) return [updated, ...prev];
        const next = [...prev];
        next[idx] = { ...next[idx], ...updated };
        return next;
      });
    };
    window.addEventListener("lead-updated", onLeadUpdated);
    const onRefresh = () => load(true);
    window.addEventListener("leads-refresh", onRefresh);

    fetch(`http://127.0.0.1:${port}/api/v1/events?limit=200`)
      .then(r => r.json())
      .then((evts: {job_id: string; action: string; ts: string}[]) => {
        evts.forEach(ev => {
          const isSystem = !ev.job_id || ev.job_id === "__system__";
          const src = isSystem ? "system" : ev.job_id.slice(0, 8);
          addLog?.(`[${src}] ${ev.action}`, isSystem ? "system" : "agent", src);
        });
      })
      .catch(() => {});
    const t = setInterval(() => load(true), 5000);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("lead-updated", onLeadUpdated);
      window.removeEventListener("leads-refresh", onRefresh);
    };
  }, [port]);
  return { leads, setLeads, loading: loading && !loaded, error };
}

function useDueFollowups(port: number | null) {
  const [leads, setLeads] = useState<Lead[]>([]);
  useEffect(() => {
    if (!port) return;
    const load = () => fetch(`http://127.0.0.1:${port}/api/v1/followups/due?limit=25`)
      .then(r => r.json())
      .then(setLeads)
      .catch(() => {});
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
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
  { id: "apply",     label: "Apply",         icon: "spark",  tone: "green"  },
  { id: "dashboard", label: "Dashboard",     icon: "home",   tone: "blue"   },
  { id: "inbox",     label: "Lead Inbox",    icon: "plus",   tone: "orange" },
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

function DashboardView({
  leads, dueFollowups, logs, setView, openDrawer,
  scanning, reevaluating, cleaning, onScan, onStopScan, onReevaluate, onStopReevaluate, onCleanup, scanErr,
}: {
  leads: Lead[]; dueFollowups: Lead[]; logs: LogLine[]; setView: (v: View) => void; openDrawer: (l: Lead) => void;
  scanning: boolean; reevaluating: boolean; cleaning: boolean;
  onScan: () => void; onStopScan: () => void; onReevaluate: () => void; onStopReevaluate: () => void; onCleanup: () => void; scanErr: string | null;
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
  const dailyHot = [...leads]
    .filter(l => l.status !== "discarded")
    .sort((a, b) => Math.max(b.signal_score || 0, b.score || 0) - Math.max(a.signal_score || 0, a.score || 0))
    .slice(0, 6);

  return (
    <div className="scroll" style={{ padding: 24, flex: 1, height: "100%", minHeight: 0 }}>
      <div className="card" style={{ padding: "26px 28px", marginBottom: 18, background: "linear-gradient(135deg, var(--orange-soft) 0%, var(--pink-soft) 60%, var(--purple-soft) 100%)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
          <div className="col gap-3" style={{ maxWidth: 560 }}>
            <span className="eyebrow">Agent Online</span>
            <h1 style={{ fontSize: 52 }}>The hunt is <span className="italic-serif" style={{ color: "var(--ink-2)" }}>on.</span></h1>
            <div style={{ fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.55, maxWidth: 480 }}>
              Scanned <b>{leads.length} job leads</b>, evaluated <b>{counts.evaluated}</b> with scores, tailored <b>{counts.tailoring + counts.approved} resumes</b>.
            </div>
            <div className="row gap-2" style={{ marginTop: 6 }}>
              <button onClick={onScan} disabled={scanning || reevaluating || cleaning} style={{
                padding: "10px 22px", borderRadius: 12, fontSize: 12, fontWeight: 700,
                letterSpacing: "0.12em", textTransform: "uppercase", cursor: scanning ? "wait" : reevaluating || cleaning ? "not-allowed" : "pointer",
                background: scanning || reevaluating || cleaning ? "var(--ink-4)" : "var(--ink)",
                color: "var(--paper)", border: "1px solid var(--ink-3)",
                opacity: (reevaluating || cleaning) && !scanning ? 0.72 : 1,
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
              {reevaluating ? (
                <button onClick={onStopReevaluate} style={{
                  padding: "10px 18px", borderRadius: 12, fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer",
                  background: "var(--bad-soft)", color: "var(--bad)", border: "1px solid var(--bad)",
                  transition: "all .2s ease", display: "flex", alignItems: "center", gap: 7,
                }}>
                  <Icon name="x" size={13} color="var(--bad)" /> STOP RE-EVAL
                </button>
              ) : (
                <button onClick={onReevaluate} disabled={scanning || leads.length === 0} className="btn" style={{
                  opacity: scanning || leads.length === 0 ? 0.58 : 1,
                  cursor: scanning || leads.length === 0 ? "not-allowed" : "pointer",
                }}>
                  <Icon name="pulse" size={13} /> Re-evaluate jobs
                </button>
              )}
              <button onClick={onCleanup} disabled={scanning || reevaluating || cleaning || leads.length === 0} className="btn" style={{
                opacity: scanning || reevaluating || cleaning || leads.length === 0 ? 0.58 : 1,
                cursor: cleaning ? "wait" : scanning || reevaluating || leads.length === 0 ? "not-allowed" : "pointer",
              }}>
                <Icon name="trash" size={13} /> {cleaning ? "Cleaning..." : "Clean bad data"}
              </button>
              <button className="btn btn-accent" onClick={() => setView("pipeline")}>Open pipeline <Icon name="arrow-right" size={13} /></button>
              <button className="btn" onClick={() => setView("inbox")}><Icon name="plus" size={13} /> Paste lead</button>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 18 }}>
        <div className="card" style={{ padding: 18 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3>Daily hot leads</h3>
            <button className="btn btn-ghost" onClick={() => setView("pipeline")} style={{ fontSize: 12 }}>Pipeline <Icon name="arrow-right" size={12} /></button>
          </div>
          <div className="col gap-2">
            {dailyHot.length === 0 ? (
              <div className="card-flat" style={{ padding: 14, color: "var(--ink-3)", fontSize: 12 }}>No hot leads yet.</div>
            ) : dailyHot.map(lead => {
              const signal = Math.max(lead.signal_score || 0, lead.score || 0);
              const nextAction = lead.last_contacted_at
                ? "Follow up"
                : "Send fit email";
              return (
                <div key={lead.job_id} onClick={() => openDrawer(lead)} className="lift" style={{ padding: 12, borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer", display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.learning_reason || lead.signal_reason || lead.reason || nextAction}</div>
                    <div className="row gap-2" style={{ marginTop: 4, flexWrap: "wrap" }}>
                      <span className="pill mono" style={{ fontSize: 9 }}>{lead.platform}</span>
                      <span className="pill mono" style={{ fontSize: 9 }}>{lead.kind || "job"}</span>
                      <span className="pill mono" style={{ fontSize: 9, background: "var(--blue-soft)", color: "var(--blue-ink)" }}>{nextAction}</span>
                      {!!lead.learning_delta && <span className="pill mono" style={{ fontSize: 9, background: lead.learning_delta > 0 ? "var(--green-soft)" : "var(--bad-soft)", color: lead.learning_delta > 0 ? "var(--green-ink)" : "var(--bad)" }}>learn {lead.learning_delta > 0 ? "+" : ""}{lead.learning_delta}</span>}
                      {lead.budget && <span className="pill mono" style={{ fontSize: 9, background: "var(--green-soft)", color: "var(--green-ink)" }}>{lead.budget}</span>}
                    </div>
                  </div>
                  <span className="mono" style={{ alignSelf: "center", fontSize: 13, fontWeight: 800, color: signal >= 80 ? "var(--orange-ink)" : "var(--ink-3)" }}>{signal}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card" style={{ padding: 18, background: "var(--green-soft)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3>Follow-ups due</h3>
            <span className="pill mono" style={{ background: "var(--green)", color: "var(--green-ink)" }}>{dueFollowups.length}</span>
          </div>
          <div className="col gap-2">
            {dueFollowups.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45 }}>No follow-ups due right now.</div>
            ) : dueFollowups.slice(0, 5).map(lead => (
              <div key={lead.job_id} onClick={() => openDrawer(lead)} className="lift" style={{ padding: 10, borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.title}</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 3 }}>{lead.company}</div>
              </div>
            ))}
          </div>
        </div>
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

function LeadInboxView({ port, onCreated }: { port: number | null; onCreated: (l: Lead) => void }) {
  const kind = "job";
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scanningFree, setScanningFree] = useState(false);

  const submit = async () => {
    if (!port || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/leads/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, url, text }),
      });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || `Server returned ${r.status}`);
      }
      const lead = await r.json();
      setText("");
      setUrl("");
      onCreated(lead);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lead save failed");
    } finally {
      setBusy(false);
    }
  };

  const scanFree = async () => {
    if (!port || scanningFree) return;
    setScanningFree(true);
    setErr(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/free-sources/scan`, { method: "POST" });
      if (!r.ok) throw new Error(`Free source scan returned ${r.status}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Free source scan failed");
    } finally {
      setScanningFree(false);
    }
  };

  return (
    <div className="scroll" style={{ flex: 1, padding: 24, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="eyebrow">Manual Lead Inbox</div>
          <h2 style={{ fontSize: 26, marginTop: 4 }}>Paste anything useful</h2>
          <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5, margin: "8px 0 16px" }}>
            Drop a job URL, founder post, Discord message, Reddit comment, HN lead, or client brief. The app extracts signal score and outreach drafts.
          </div>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Source URL"
            className="mono field-input"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12, marginBottom: 10 }}
          />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={12}
            placeholder={"Paste job text here...\n\nExample: AI Engineer role posted today. Python, FastAPI, React. Remote or hybrid. Include the seniority/years if visible."}
            className="field-input"
            style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", fontSize: 13, resize: "vertical", lineHeight: 1.55 }}
          />
          {err && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 10 }}>{err}</div>}
          <button className="btn btn-accent" onClick={submit} disabled={busy} style={{ marginTop: 12, width: "100%", justifyContent: "center", padding: "11px 16px" }}>
            <Icon name="plus" size={13} /> {busy ? "Saving..." : "Save and score lead"}
          </button>
        </div>

        <div className="col gap-4">
          <div className="card" style={{ padding: 22, background: "var(--green-soft)" }}>
            <div className="eyebrow">Free Sources</div>
            <h3 style={{ marginTop: 4, fontSize: 20 }}>Run the free scout</h3>
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 8 }}>
              Checks the configured ATS company watchlist plus GitHub issues, HN comments, and Reddit searches without paid scraping APIs.
            </div>
            <button className="btn" onClick={scanFree} disabled={scanningFree} style={{ marginTop: 14, borderColor: "var(--green)", background: "var(--card)", color: "var(--green-ink)" }}>
              <Icon name="search" size={13} /> {scanningFree ? "Scanning..." : "Scan free sources"}
            </button>
          </div>
          <div className="card" style={{ padding: 22 }}>
            <div className="eyebrow">Zero-cost playbook</div>
            <div className="col gap-2" style={{ marginTop: 10, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              <div><b>1.</b> Paste high-signal leads as you browse.</div>
              <div><b>2.</b> Keep 10-30 target companies in Settings.</div>
              <div><b>3.</b> Use GitHub/HN/Reddit scans for founder and dev-community demand.</div>
              <div><b>4.</b> Mark contacted leads so follow-ups appear in the dashboard.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function ApplyJobView({ port, leads, openDrawer, initialInput }: { port: number | null; leads: Lead[]; openDrawer: (l: Lead) => void; initialInput?: string }) {
  const [input, setInput] = useState("");
  const initialApplied = useRef(false);
  const [lead, setLead] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resumeBlobUrl, setResumeBlobUrl] = useState<string | null>(null);
  const [coverBlobUrl, setCoverBlobUrl] = useState<string | null>(null);
  const [resumeLoadErr, setResumeLoadErr] = useState<string | null>(null);
  const [coverLoadErr, setCoverLoadErr] = useState<string | null>(null);
  const [fireBusy, setFireBusy] = useState(false);
  const [fireMsg, setFireMsg] = useState<string | null>(null);

  const liveLead = lead ? (leads.find(l => l.job_id === lead.job_id) || lead) : null;
  const resumeReady = Boolean(liveLead?.resume_asset || liveLead?.asset);
  const coverReady = Boolean(liveLead?.cover_letter_asset);
  const generating = Boolean(liveLead && (!resumeReady || !coverReady) && (busy || liveLead.status === "tailoring" || liveLead.status === "approved"));
  const resumeDocUrl = liveLead && resumeReady ? `http://127.0.0.1:${port}/api/v1/leads/${liveLead.job_id}/pdf?kind=resume` : null;
  const coverDocUrl = liveLead && coverReady ? `http://127.0.0.1:${port}/api/v1/leads/${liveLead.job_id}/pdf?kind=cover_letter` : null;
  const coverage = (liveLead?.keyword_coverage || liveLead?.source_meta?.keyword_coverage || {}) as KeywordCoverage;
  const contactLookup = (liveLead?.contact_lookup || liveLead?.source_meta?.contact_lookup || {}) as ContactLookup;
  const primaryContact = contactLookup.primary_contact;
  const missingTerms: string[] = Array.isArray(coverage.missing_terms) ? coverage.missing_terms : [];
  const incorporatedTerms: string[] = Array.isArray(coverage.incorporated_terms) ? coverage.incorporated_terms : [];
  const coveragePct = typeof coverage.coverage_pct === "number" ? coverage.coverage_pct : null;

  useEffect(() => {
    if (initialInput && !initialApplied.current) {
      initialApplied.current = true;
      setInput(initialInput);
    }
  }, [initialInput]);

  useEffect(() => {
    if (!lead?.job_id || !port || (resumeReady && coverReady)) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/v1/leads/${lead.job_id}`);
        if (!r.ok) return;
        const updated = await r.json();
        if (alive) setLead(updated);
      } catch { /* keep waiting */ }
    }, 1800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [lead?.job_id, port, resumeReady, coverReady]);

  useEffect(() => {
    if (!resumeDocUrl) { setResumeBlobUrl(null); setResumeLoadErr(null); return; }
    let revoke: string | null = null;
    let alive = true;
    setResumeLoadErr(null);
    setResumeBlobUrl(null);
    fetch(resumeDocUrl)
      .then(r => {
        if (!r.ok) throw new Error("Resume PDF not ready");
        return r.blob();
      })
      .then(blob => {
        if (!alive) return;
        revoke = URL.createObjectURL(blob);
        setResumeBlobUrl(revoke);
      })
      .catch(e => alive && setResumeLoadErr(e instanceof Error ? e.message : "Resume failed to load"));
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [resumeDocUrl]);

  useEffect(() => {
    if (!coverDocUrl) { setCoverBlobUrl(null); setCoverLoadErr(null); return; }
    let revoke: string | null = null;
    let alive = true;
    setCoverLoadErr(null);
    setCoverBlobUrl(null);
    fetch(coverDocUrl)
      .then(r => {
        if (!r.ok) throw new Error("Cover letter PDF not ready");
        return r.blob();
      })
      .then(blob => {
        if (!alive) return;
        revoke = URL.createObjectURL(blob);
        setCoverBlobUrl(revoke);
      })
      .catch(e => alive && setCoverLoadErr(e instanceof Error ? e.message : "Cover letter failed to load"));
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [coverDocUrl]);

  useEffect(() => {
    if (busy && resumeReady && coverReady) setBusy(false);
  }, [busy, resumeReady, coverReady]);

  const submit = async () => {
    if (!port || busy || !input.trim()) return;
    setBusy(true);
    setErr(null);
    setFireMsg(null);
    setResumeBlobUrl(null);
    setCoverBlobUrl(null);
    try {
      const trimmed = input.trim();
      const url = trimmed.match(/https?:\/\/\S+/)?.[0] || "";
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/leads/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "job", url, text: trimmed }),
      });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || `Server returned ${r.status}`);
      }
      const created = await r.json();
      setLead(created);
      const gen = await fetch(`http://127.0.0.1:${port}/api/v1/leads/${created.job_id}/generate`, { method: "POST" });
      if (!gen.ok) throw new Error(`Generation returned ${gen.status}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Application package failed");
      setBusy(false);
    }
  };

  const fire = async () => {
    if (!port || !liveLead || !resumeReady || !coverReady || fireBusy) return;
    setFireBusy(true);
    setFireMsg(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/fire/${liveLead.job_id}`, { method: "POST" });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || `Server returned ${r.status}`);
      }
      setFireMsg("Application automation started.");
    } catch (e) {
      setFireMsg(e instanceof Error ? e.message : "Could not start application automation");
    } finally {
      setFireBusy(false);
    }
  };

  const copyText = (value: string) => navigator.clipboard?.writeText(value);
  const stepTone = (done: boolean, active: boolean) => done ? "green" : active ? "purple" : "blue";
  const stepPill = (label: string, done: boolean, active: boolean) => {
    const tone = stepTone(done, active);
    return (
      <div className="pill mono" style={{ background: `var(--${tone}-soft)`, color: `var(--${tone}-ink)`, border: `1px solid var(--${tone})`, fontSize: 10 }}>
        {done ? "Done" : active ? "Working" : "Waiting"} - {label}
      </div>
    );
  };

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: liveLead ? "420px minmax(0, 1fr)" : "minmax(0, 880px)", gap: 18, alignItems: "start", justifyContent: "center" }}>
        <section className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="eyebrow">Apply to this job</div>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginTop: 5, marginBottom: 6 }}>Paste a job URL.</h2>
            <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55 }}>Analyse fit, generate the resume and cover letter, then copy outreach from one page.</div>
          </div>
          <textarea
            className="field-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Paste job URL or full job description"
            rows={liveLead ? 8 : 12}
            style={{ fontSize: 14, lineHeight: 1.55, resize: "vertical" }}
          />
          <button className="btn btn-accent" onClick={submit} disabled={!port || busy || !input.trim()} style={{ justifyContent: "center", padding: "12px 16px", fontSize: 14 }}>
            <Icon name="spark" size={15} color="#fff" /> {busy ? "Analysing and generating..." : "Analyse & Generate"}
          </button>
          {err && <div style={{ color: "var(--bad)", background: "var(--bad-soft)", border: "1px solid var(--bad)", borderRadius: 8, padding: "9px 11px", fontSize: 12 }}>{err}</div>}
          {liveLead && (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {stepPill("Job captured", true, false)}
              {stepPill("Resume generated", resumeReady, generating && !resumeReady)}
              {stepPill("Cover letter generated", coverReady, generating && resumeReady && !coverReady)}
              <button className="btn" onClick={() => openDrawer(liveLead)} style={{ justifyContent: "center" }}>Open full details</button>
            </div>
          )}
        </section>

        {liveLead && (
          <section style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <div className="card" style={{ padding: 18, display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow">Application Package</div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 5 }}>{roleFromLead(liveLead)}</h3>
                <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>{liveLead.company || "Unknown company"}</div>
              </div>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                {coveragePct !== null && <span className="pill mono" style={{ background: "var(--blue-soft)", color: "var(--blue-ink)", border: "1px solid var(--blue)" }}>{coveragePct}% coverage</span>}
                <span className="pill mono" style={{ background: resumeReady && coverReady ? "var(--green-soft)" : "var(--purple-soft)", color: resumeReady && coverReady ? "var(--green-ink)" : "var(--purple-ink)", border: `1px solid ${resumeReady && coverReady ? "var(--green)" : "var(--purple)"}` }}>
                  {resumeReady && coverReady ? "Ready" : "Generating"}
                </span>
              </div>
            </div>

            {(missingTerms.length > 0 || incorporatedTerms.length > 0) && (
              <div className="card" style={{ padding: 16, borderColor: "var(--blue)", background: "var(--blue-soft)" }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 8 }}>
                  <span className="eyebrow" style={{ color: "var(--blue-ink)" }}>Coverage</span>
                  {coveragePct !== null && <span className="mono" style={{ fontSize: 11, fontWeight: 800, color: "var(--blue-ink)" }}>{coveragePct}% JD keywords</span>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                  {missingTerms.length
                    ? <>You're missing these terms from the JD: <b>{missingTerms.slice(0, 8).join(", ")}</b>. We've incorporated supported matches where applicable.</>
                    : <>Strong keyword coverage. Supported JD terms were incorporated where they fit.</>
                  }
                </div>
                {incorporatedTerms.length > 0 && (
                  <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 10 }}>
                    {incorporatedTerms.slice(0, 10).map(term => (
                      <span key={term} className="pill" style={{ background: "var(--paper)", color: "var(--blue-ink)", border: "1px solid var(--blue)" }}>{term}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="card" style={{ padding: 16, borderColor: primaryContact ? "var(--green)" : "var(--line)", background: primaryContact ? "var(--green-soft)" : "var(--paper)" }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div className="eyebrow" style={{ color: primaryContact ? "var(--green-ink)" : "var(--ink-3)" }}>Who to contact</div>
                  {primaryContact ? (
                    <>
                      <h3 style={{ fontSize: 17, fontWeight: 800, marginTop: 5 }}>{primaryContact.name || "Company contact"}</h3>
                      <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3 }}>{primaryContact.title || "Hiring contact"}{contactLookup.domain ? ` at ${contactLookup.domain}` : ""}</div>
                    </>
                  ) : (
                    <>
                      <h3 style={{ fontSize: 17, fontWeight: 800, marginTop: 5 }}>Contact lookup</h3>
                      <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3 }}>
                        {contactLookup.message || (resumeReady && coverReady ? "Add a Hunter.io API key in Settings to find recruiter and founder emails." : "Contact lookup runs after the package is generated.")}
                      </div>
                    </>
                  )}
                </div>
                {contactLookup.status && (
                  <span className="pill mono" style={{ background: primaryContact ? "var(--paper)" : "var(--paper-3)", color: primaryContact ? "var(--green-ink)" : "var(--ink-3)", border: `1px solid ${primaryContact ? "var(--green)" : "var(--line)"}` }}>
                    {contactLookup.status.replace(/_/g, " ")}
                  </span>
                )}
              </div>
              {primaryContact && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
                  <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
                    <div className="eyebrow">Direct line</div>
                    <div className="col gap-2" style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-2)" }}>
                      {primaryContact.email && (
                        <button className="btn btn-ghost" style={{ justifyContent: "space-between" }} onClick={() => copyText(primaryContact.email || "")}>
                          <span className="mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{primaryContact.email}</span>
                          <span>Copy</span>
                        </button>
                      )}
                      {primaryContact.linkedin_url && (
                        <button className="btn btn-ghost" style={{ justifyContent: "space-between" }} onClick={() => copyText(primaryContact.linkedin_url || "")}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>LinkedIn profile</span>
                          <span>Copy</span>
                        </button>
                      )}
                      {typeof primaryContact.confidence === "number" && primaryContact.confidence > 0 && (
                        <div className="mono" style={{ color: "var(--green-ink)", fontSize: 11 }}>{primaryContact.confidence}% Hunter confidence</div>
                      )}
                    </div>
                  </div>
                  {primaryContact.personalized_email && (
                    <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                        <span className="eyebrow">Cold email</span>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => copyText(primaryContact.personalized_email || "")}>Copy</button>
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{primaryContact.personalized_email}</div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
              {[
                { label: "Resume", ready: resumeReady, blob: resumeBlobUrl, error: resumeLoadErr, url: resumeDocUrl },
                { label: "Cover Letter", ready: coverReady, blob: coverBlobUrl, error: coverLoadErr, url: coverDocUrl },
              ].map(doc => (
                <div key={doc.label} className="card" style={{ minHeight: 600, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  <div className="row" style={{ padding: 11, borderBottom: "1px solid var(--line)", background: "var(--paper-3)", justifyContent: "space-between", gap: 10 }}>
                    <div className="row gap-2">
                      <span style={{ fontSize: 13, fontWeight: 800 }}>{doc.label}</span>
                      <span className="dot" style={{ color: doc.ready ? "var(--ok)" : "var(--ink-4)" }} />
                    </div>
                    <button className="btn btn-ghost" disabled={!doc.url} onClick={() => doc.url && openUrl(doc.url)} style={{ fontSize: 11, padding: "4px 9px" }}>
                      <Icon name="download" size={12} /> Download PDF
                    </button>
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    {doc.ready && doc.blob && (
                      <iframe key={doc.blob} src={doc.blob} title={doc.label} width="100%" style={{ height: "100%", minHeight: 548, border: "none", display: "block" }} />
                    )}
                    {doc.ready && !doc.blob && !doc.error && (
                      <div style={{ minHeight: 548, display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 12 }}>Loading PDF...</div>
                    )}
                    {doc.error && (
                      <div style={{ minHeight: 548, display: "grid", placeItems: "center", color: "var(--bad)", fontSize: 12 }}>{doc.error}</div>
                    )}
                    {!doc.ready && (
                      <div style={{ minHeight: 548, display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 12, textAlign: "center", padding: 24 }}>
                        {generating ? `Generating ${doc.label.toLowerCase()}...` : `${doc.label} will appear here.`}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {(liveLead.outreach_reply || liveLead.outreach_dm || liveLead.outreach_email || (liveLead.fit_bullets?.length ?? 0) > 0) && (
              <div className="card" style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                {[
                  ["3-line pitch", liveLead.outreach_reply],
                  ["Cold email", liveLead.outreach_email],
                  ["LinkedIn note", liveLead.outreach_dm],
                  ["Fit bullets", (liveLead.fit_bullets || []).join("\n")],
                ].filter(([, value]) => Boolean(value)).map(([label, value]) => (
                  <div key={label} style={{ background: "var(--paper-3)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px" }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 7 }}>
                      <span className="eyebrow">{label}</span>
                      <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => copyText(String(value))}>Copy</button>
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{value}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{fireMsg || "Ready package can be sent to the application form."}</div>
              <button className="btn btn-accent" onClick={fire} disabled={!resumeReady || !coverReady || fireBusy} style={{ minWidth: 170, justifyContent: "center" }}>
                <Icon name="fire" size={14} color="#fff" /> {fireBusy ? "Starting..." : "Fire Application"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}


function OnboardingWizard({ port, onFinish, onOpenSettings }: { port: number; onFinish: (draft: string) => void; onOpenSettings: () => void }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [rawResume, setRawResume] = useState("");
  const [role, setRole] = useState("Applied AI Engineer");
  const [market, setMarket] = useState("remote");
  const [provider, setProvider] = useState("ollama");
  const [apiKey, setApiKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [demoDraft, setDemoDraft] = useState(DEMO_JOB_DRAFT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const steps = ["Resume", "Preferences", "Demo Job"];
  const keyField: Record<string, string> = {
    openai: "openai_api_key",
    anthropic: "anthropic_key",
    groq: "groq_api_key",
    deepseek: "deepseek_api_key",
    nvidia: "nvidia_api_key",
  };

  const saveResume = async () => {
    if (!file && !rawResume.trim()) {
      setErr("Upload a resume file or paste resume text.");
      return;
    }
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    if (file) fd.append("file", file);
    else fd.append("raw", rawResume.trim());
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/ingest`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`Resume import returned ${r.status}`);
      setStep(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Resume import failed");
    } finally {
      setBusy(false);
    }
  };

  const savePreferences = async () => {
    setBusy(true);
    setErr(null);
    const payload: Record<string, any> = {
      job_market_focus: market,
      llm_provider: provider,
      onboarding_target_role: role,
      free_sources_enabled: true,
    };
    if (provider === "ollama") payload.ollama_url = ollamaUrl;
    const field = keyField[provider];
    if (field && apiKey.trim()) payload[field] = apiKey.trim();
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`Preferences returned ${r.status}`);
      setStep(2);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Preferences failed to save");
    } finally {
      setBusy(false);
    }
  };

  const progress = (
    <div className="row gap-2" style={{ flexWrap: "wrap" }}>
      {steps.map((label, idx) => (
        <button
          key={label}
          className="btn btn-ghost"
          onClick={() => idx <= step && setStep(idx)}
          style={{
            borderColor: idx === step ? "var(--accent)" : idx < step ? "var(--green)" : "var(--line)",
            background: idx === step ? "var(--accent-soft)" : idx < step ? "var(--green-soft)" : "var(--paper-3)",
            color: idx === step ? "var(--ink)" : idx < step ? "var(--green-ink)" : "var(--ink-3)",
            fontSize: 12,
            minHeight: 34,
          }}
        >
          {idx < step ? <Icon name="check" size={13} /> : <span className="mono">{idx + 1}</span>} {label}
        </button>
      ))}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(244,239,230,0.94)", display: "grid", placeItems: "center", padding: 22 }}
    >
      <motion.section
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 10, opacity: 0 }}
        className="card"
        style={{ width: "min(960px, 100%)", maxHeight: "min(760px, 94vh)", overflow: "auto", padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div className="eyebrow">First Run</div>
            <h2 style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>Get to your first package</h2>
            <p style={{ color: "var(--ink-2)", fontSize: 13.5, lineHeight: 1.55, marginTop: 8 }}>
              Import your resume, set the basics, then open the one-shot Apply page with a demo job ready.
            </p>
          </div>
          {progress}
          <div style={{ background: "var(--paper-3)", border: "1px solid var(--line)", borderRadius: 8, padding: 14, color: "var(--ink-2)", fontSize: 13, lineHeight: 1.55 }}>
            <b style={{ color: "var(--ink)" }}>{steps[step]}</b>
            <div style={{ marginTop: 4 }}>
              {step === 0 && "Your profile graph starts with resume data."}
              {step === 1 && "These defaults shape scoring, generation, and source selection."}
              {step === 2 && "The demo opens directly in Apply with all generated outputs on one page."}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => onFinish(DEMO_JOB_DRAFT)} style={{ alignSelf: "flex-start" }}>
            Skip setup
          </button>
        </div>

        <div style={{ minWidth: 0 }}>
          {err && <div style={{ color: "var(--bad)", background: "var(--bad-soft)", border: "1px solid var(--bad)", borderRadius: 8, padding: "9px 11px", fontSize: 12, marginBottom: 12 }}>{err}</div>}

          {step === 0 && (
            <div className="col gap-4">
              <label className="card" style={{ padding: 18, cursor: "pointer", borderStyle: "dashed", background: "var(--paper)" }}>
                <input type="file" accept=".pdf,.doc,.docx,.txt,.md" style={{ display: "none" }} onChange={e => setFile(e.target.files?.[0] || null)} />
                <div className="row gap-3">
                  <Icon name="upload" size={20} />
                  <div>
                    <div style={{ fontWeight: 800 }}>{file ? file.name : "Upload resume"}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>PDF, DOCX, TXT, or Markdown</div>
                  </div>
                </div>
              </label>
              <textarea
                className="field-input"
                value={rawResume}
                onChange={e => setRawResume(e.target.value)}
                placeholder="Or paste resume text"
                rows={8}
                style={{ lineHeight: 1.55, resize: "vertical" }}
              />
              <button className="btn btn-accent" onClick={saveResume} disabled={busy} style={{ justifyContent: "center", padding: "12px 16px" }}>
                <Icon name="arrow-right" size={14} color="#fff" /> {busy ? "Importing..." : "Continue"}
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="col gap-4">
              <div>
                <label className="eyebrow">Target role</label>
                <input className="field-input" value={role} onChange={e => setRole(e.target.value)} style={{ marginTop: 7 }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="eyebrow">Market</label>
                  <select className="field-input" value={market} onChange={e => setMarket(e.target.value)} style={{ marginTop: 7 }}>
                    <option value="remote">Remote first</option>
                    <option value="india">India</option>
                    <option value="us">United States</option>
                    <option value="global">Global</option>
                  </select>
                </div>
                <div>
                  <label className="eyebrow">LLM Provider</label>
                  <select className="field-input" value={provider} onChange={e => setProvider(e.target.value)} style={{ marginTop: 7 }}>
                    <option value="ollama">Ollama</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="groq">Groq</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="nvidia">NVIDIA</option>
                  </select>
                </div>
              </div>
              {provider === "ollama" ? (
                <div>
                  <label className="eyebrow">Ollama URL</label>
                  <input className="field-input" value={ollamaUrl} onChange={e => setOllamaUrl(e.target.value)} style={{ marginTop: 7 }} />
                </div>
              ) : (
                <div>
                  <label className="eyebrow">API key</label>
                  <input className="field-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Optional for now" style={{ marginTop: 7 }} />
                </div>
              )}
              <div className="row gap-2" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <button className="btn" onClick={onOpenSettings}><Icon name="settings" size={13} /> Advanced settings</button>
                <button className="btn btn-accent" onClick={savePreferences} disabled={busy || !role.trim()} style={{ minWidth: 170, justifyContent: "center" }}>
                  <Icon name="arrow-right" size={14} color="#fff" /> {busy ? "Saving..." : "Continue"}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="col gap-4">
              <div>
                <label className="eyebrow">Demo job URL</label>
                <textarea className="field-input" value={demoDraft} onChange={e => setDemoDraft(e.target.value)} rows={12} style={{ marginTop: 7, lineHeight: 1.55, resize: "vertical" }} />
              </div>
              <button className="btn btn-accent" onClick={() => onFinish(demoDraft)} style={{ justifyContent: "center", padding: "12px 16px" }}>
                <Icon name="spark" size={14} color="#fff" /> Try it on a job
              </button>
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}


export function JobCard({ lead, onOpen, onDelete, showScore = false, showGenerate = false, port }: {
  lead: Lead;
  onOpen: (l: Lead) => void;
  onDelete: (id: string) => void;
  showScore?: boolean;
  showGenerate?: boolean;
  port?: number | null;
}) {
  const [generating, setGenerating] = useState(false);
  const desc = lead.description?.trim();
  const signalScore = lead.signal_score || 0;
  const isHotX = lead.platform === "x" && signalScore >= 80;
  const level = leadSeniority(lead);
  const levelTone = seniorityTone(level);

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
            <span className="pill mono" style={{ fontSize: 8.5, padding: "1px 6px", background: `var(--${levelTone}-soft)`, color: `var(--${levelTone}-ink)`, border: `1px solid var(--${levelTone})` }}>{seniorityLabel(level)}</span>
            {isHotX && <span className="pill mono" style={{ fontSize: 8.5, padding: "1px 6px", background: "var(--orange-soft)", color: "var(--orange-ink)", border: "1px solid var(--orange)" }}>HOT X</span>}
            {lead.budget && <span className="pill mono" style={{ fontSize: 8.5, padding: "1px 6px", background: "var(--green-soft)", color: "var(--green-ink)" }}>{lead.budget}</span>}
          </div>
        </div>
        {signalScore > 0 && (
          <span style={{
            flexShrink: 0, fontSize: 11.5, fontWeight: 800, padding: "3px 9px", borderRadius: 999,
            background: signalScore >= 80 ? "var(--orange-soft)" : signalScore >= 60 ? "var(--yellow-soft)" : "var(--paper-3)",
            color: signalScore >= 80 ? "var(--orange-ink)" : signalScore >= 60 ? "var(--yellow-ink)" : "var(--ink-3)",
            border: `1px solid ${signalScore >= 80 ? "var(--orange)" : "var(--line)"}`,
          }}>{signalScore}</span>
        )}
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

      {lead.signal_reason && (
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.5, borderLeft: "2px solid var(--orange)", paddingLeft: 8 }}>
          {lead.signal_reason.slice(0, 150)}{lead.signal_reason.length > 150 ? "..." : ""}
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

function PipelineJobCard({ lead, onOpen, onDelete, showGenerate = false, port }: {
  lead: Lead;
  onOpen: (l: Lead) => void;
  onDelete: (id: string) => void;
  showGenerate?: boolean;
  port?: number | null;
}) {
  const [generating, setGenerating] = useState(false);
  const signalScore = lead.signal_score || 0;
  const matchScore = lead.score || 0;
  const isHotX = lead.platform === "x" && signalScore >= 80;
  const level = leadSeniority(lead);
  const levelTone = seniorityTone(level);
  const statusTone = getTone(lead.status);
  const display = leadDisplayHeading(lead);
  const urlLabel = lead.url ? lead.url.replace(/^https?:\/\//, "").slice(0, 42) : "No source URL";

  const handleGenerate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!port) return;
    setGenerating(true);
    await fetch(`http://127.0.0.1:${port}/api/v1/leads/${lead.job_id}/generate`, { method: "POST" });
    setTimeout(() => setGenerating(false), 2000);
  };

  return (
    <div className="pipeline-job-card lift" onClick={() => onOpen(lead)}>
      <div className="pipeline-job-mark" style={{ background: `var(--${statusTone}-soft)`, color: `var(--${statusTone}-ink)`, borderColor: `var(--${statusTone})` }}>
        {getMark(lead.company)}
      </div>
      <div className="pipeline-job-main">
        <div className="pipeline-job-title-row">
          <div className="pipeline-job-title">
            <span>{display.role}</span>
            <b>||</b>
            <span className="company">{display.company}</span>
          </div>
          <span className="pipeline-status-pill" style={{ background: `var(--${statusTone}-soft)`, color: `var(--${statusTone}-ink)`, borderColor: `var(--${statusTone})` }}>
            {lead.status || "discovered"}
          </span>
        </div>
        <div className="pipeline-job-meta">
          <span>{lead.platform || "source"}</span>
          <span style={{ color: `var(--${levelTone}-ink)` }}>{seniorityLabel(level)}</span>
          {isHotX && <span style={{ color: "var(--orange-ink)" }}>Hot X</span>}
          {lead.budget && <span style={{ color: "var(--green-ink)" }}>{lead.budget}</span>}
        </div>
      </div>
      <div className="pipeline-job-side">
        <div className="pipeline-score-stack">
          {matchScore > 0 && <span className={`pipeline-score ${matchScore >= 76 ? "good" : matchScore >= 50 ? "warn" : "bad"}`}>Fit {matchScore}</span>}
          {signalScore > 0 && <span className={`pipeline-score ${signalScore >= 80 ? "hot" : signalScore >= 60 ? "warn" : ""}`}>Signal {signalScore}</span>}
        </div>
        <div className="pipeline-job-actions">
          {showGenerate && (
            <button className="btn" onClick={handleGenerate} disabled={generating}>
              <Icon name="file" size={12} /> {generating ? "Queued" : "Generate"}
            </button>
          )}
          <button className="btn btn-icon" onClick={e => { e.stopPropagation(); if (lead.url) openUrl(lead.url); }} title={lead.url} disabled={!lead.url}>
            <Icon name="external-link" size={13} />
          </button>
          <button className="btn" onClick={e => { e.stopPropagation(); onOpen(lead); }}>Details</button>
          <button className="btn btn-icon danger" onClick={e => { e.stopPropagation(); onDelete(lead.job_id); }} title="Delete lead">
            <Icon name="trash" size={13} />
          </button>
        </div>
        <div className="pipeline-source mono" title={lead.url}>{urlLabel}</div>
      </div>
    </div>
  );
}

function PipelineSkeleton() {
  return (
    <div className="pipeline-skeleton">
      <div className="pipeline-skeleton-bar" />
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="pipeline-skeleton-card">
          <span />
          <div>
            <i />
            <b />
            <em />
          </div>
          <strong />
        </div>
      ))}
    </div>
  );
}

function PipelineView({ leads, openDrawer, deleteLead, port, scanning, reevaluating, cleaning, onReevaluate, onStopReevaluate, onCleanup, loading, error }: {
  leads: Lead[]; openDrawer: (l: Lead) => void;
  deleteLead: (id: string) => void; port: number | null;
  scanning: boolean; reevaluating: boolean; cleaning: boolean; onReevaluate: () => void; onStopReevaluate: () => void; onCleanup: () => void;
  loading: boolean; error: string | null;
}) {
  const [tab, setTab] = useState<PipelineTab>("all");
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [minSignal, setMinSignal] = useState(0);
  const [minMatch, setMinMatch] = useState(0);
  const [sort, setSort] = useState<LeadSort>("recommended");
  const [budgetOnly, setBudgetOnly] = useState(false);
  const [learningOnly, setLearningOnly] = useState(false);
  const [seniority, setSeniority] = useState<SeniorityFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [bulkSelecting, setBulkSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => setVisibleCount(PAGE_SIZE), [tab, search, platform, minSignal, minMatch, sort, budgetOnly, learningOnly, seniority]);

  const platforms = useMemo(() => uniqueLeadValues(leads, "platform"), [leads]);

  const tabs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const keep = (lead: Lead) => {
      if (q && !leadSearchText(lead).includes(q)) return false;
      if (platform && lead.platform !== platform) return false;
      if (minSignal && (lead.signal_score || 0) < minSignal) return false;
      if (minMatch && (lead.score || 0) < minMatch) return false;
      if (budgetOnly && !lead.budget) return false;
      if (learningOnly && !lead.learning_delta) return false;
      if (!seniorityMatches(lead, seniority)) return false;
      return true;
    };
    const apply = (arr: Lead[]) => sortLeads(arr.filter(keep), sort);
    const tabItems: { id: PipelineTab; label: string; tone: string; leads: Lead[] }[] = [
      { id: "all",       label: "All",       tone: "teal",   leads: apply(leads) },
      { id: "hot",       label: "Hot",       tone: "orange", leads: apply(leads.filter(l => (l.signal_score || 0) >= 80 || (l.score || 0) >= 85)) },
      { id: "found",     label: "New",       tone: "blue",   leads: apply(leads.filter(l => l.status === "discovered")) },
      { id: "evaluated", label: "Rated",     tone: "yellow", leads: apply(leads.filter(l => l.score > 0 || (l.signal_score || 0) > 0)) },
      { id: "generated", label: "Ready",     tone: "purple", leads: apply(leads.filter(l => l.status === "tailoring" || l.status === "approved")) },
      { id: "applied",   label: "Active",    tone: "orange", leads: apply(leads.filter(l => ["applied", "interviewing", "accepted", "rejected"].includes(l.status))) },
      { id: "discarded", label: "Discarded", tone: "bad",    leads: apply(leads.filter(l => l.status === "discarded")) },
    ];
    return tabItems;
  }, [leads, search, platform, minSignal, minMatch, sort, budgetOnly, learningOnly, seniority]);

  const activeTab = tabs.find(t => t.id === tab) || tabs[0];
  const visibleLeads = activeTab.leads.slice(0, visibleCount);
  const hasFilters = Boolean(search || platform || minSignal || minMatch || budgetOnly || learningOnly || seniority !== "all");
  const hotCount = leads.filter(l => (l.signal_score || 0) >= 80 || (l.score || 0) >= 85).length;
  const readyCount = leads.filter(l => l.status === "tailoring" || l.status === "approved").length;
  const activeCount = leads.filter(l => ["applied", "interviewing", "accepted", "rejected"].includes(l.status)).length;
  const busyLabel = scanning ? "Scanning for new leads" : reevaluating ? "Re-evaluating fit scores" : cleaning ? "Cleaning bad data" : "";
  const metrics = [
    { label: "Total", value: leads.length, tone: "blue", icon: "layers" },
    { label: "Hot", value: hotCount, tone: "orange", icon: "spark" },
    { label: "New", value: leads.filter(l => l.status === "discovered").length, tone: "teal", icon: "search" },
    { label: "Ready", value: readyCount, tone: "purple", icon: "file" },
    { label: "Active", value: activeCount, tone: "green", icon: "fire" },
    { label: "Discarded", value: leads.filter(l => l.status === "discarded").length, tone: "bad", icon: "trash" },
  ];
  const toneSoft = (tone: string) => tone === "bad" ? "var(--bad-soft)" : `var(--${tone}-soft)`;
  const toneInk = (tone: string) => tone === "bad" ? "var(--bad)" : `var(--${tone}-ink)`;
  const toneBorder = (tone: string) => tone === "bad" ? "var(--bad)" : `var(--${tone})`;

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
    <div className="pipeline-page">
      <div className="pipeline-top">
        <div className="pipeline-overview">
          <div className="pipeline-overview-copy">
            <span className="eyebrow">Lead queue</span>
            <h2>Review, clean, and ship applications</h2>
            <p>{loading ? "Loading saved job leads..." : `${activeTab.leads.length} matching leads in ${activeTab.label.toLowerCase()}.`}</p>
          </div>
          {metrics.map(metric => (
            <button
              key={metric.label}
              className="pipeline-metric"
              onClick={() => {
                const nextTab = metric.label === "Hot" ? "hot" : metric.label === "New" ? "found" : metric.label === "Ready" ? "generated" : metric.label === "Active" ? "applied" : metric.label === "Discarded" ? "discarded" : "all";
                setTab(nextTab as PipelineTab);
                setBulkSelecting(false);
                setSelected(new Set());
              }}
              style={{ background: toneSoft(metric.tone), borderColor: toneBorder(metric.tone), color: toneInk(metric.tone) }}
            >
              <Icon name={metric.icon} size={14} />
              <span className="mono tabular">{metric.value}</span>
              <small>{metric.label}</small>
            </button>
          ))}
        </div>

        {(busyLabel || error) && (
          <div className={`pipeline-notice ${error ? "error" : ""}`}>
            {error ? <Icon name="x" size={13} /> : <span className="dot pulse-soft" />}
            <span>{error || busyLabel}</span>
          </div>
        )}

        <div className="pipeline-toolbar">
          <div className="pipeline-tabs" role="tablist" aria-label="Pipeline stages">
            {tabs.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? "active" : ""}
                onClick={() => { setTab(t.id); setBulkSelecting(false); setSelected(new Set()); }}
                style={tab === t.id ? { background: toneSoft(t.tone), borderColor: toneBorder(t.tone), color: toneInk(t.tone) } : undefined}
              >
                <span>{t.label}</span>
                <b className="mono tabular">{t.leads.length}</b>
              </button>
            ))}
          </div>

          <div className="pipeline-actions">
            {reevaluating ? (
              <button className="btn danger" onClick={onStopReevaluate}>
                <Icon name="x" size={13} /> Stop re-eval
              </button>
            ) : (
              <button className="btn" onClick={onReevaluate} disabled={leads.length === 0 || scanning || cleaning || loading}>
                <Icon name="pulse" size={13} /> Re-evaluate
              </button>
            )}
            <button className="btn danger-soft" onClick={onCleanup} disabled={leads.length === 0 || scanning || reevaluating || cleaning || loading}>
              <Icon name="trash" size={13} /> {cleaning ? "Cleaning" : "Clean bad data"}
            </button>
            {tab === "discarded" && (
              bulkSelecting ? (
                <>
                  <button className="btn danger" onClick={bulkDelete} disabled={selected.size === 0}>Delete {selected.size}</button>
                  <button className="btn" onClick={() => { setBulkSelecting(false); setSelected(new Set()); }}>Cancel</button>
                </>
              ) : (
                <button className="btn" onClick={() => setBulkSelecting(true)} disabled={activeTab.leads.length === 0}>Bulk delete</button>
              )
            )}
          </div>
        </div>

        <LeadFilterBar
          search={search}
          setSearch={setSearch}
          platform={platform}
          setPlatform={setPlatform}
          minSignal={minSignal}
          setMinSignal={setMinSignal}
          minMatch={minMatch}
          setMinMatch={setMinMatch}
          sort={sort}
          setSort={setSort}
          budgetOnly={budgetOnly}
          setBudgetOnly={setBudgetOnly}
          learningOnly={learningOnly}
          setLearningOnly={setLearningOnly}
          seniority={seniority}
          setSeniority={setSeniority}
          platforms={platforms}
          total={activeTab.leads.length}
          shown={Math.min(visibleCount, activeTab.leads.length)}
          label="jobs"
        />
      </div>

      <div className="pipeline-content scroll">
        <div className="pipeline-results-head">
          <div>
            <h3>{activeTab.label}</h3>
            <p>{hasFilters ? "Filtered results" : "All matching leads"} - showing {Math.min(visibleCount, activeTab.leads.length)} of {activeTab.leads.length}</p>
          </div>
          {bulkSelecting && tab === "discarded" && <span className="pipeline-selected mono">{selected.size} selected</span>}
        </div>
        {loading ? (
          <PipelineSkeleton />
        ) : activeTab.leads.length === 0 ? (
          <div className="pipeline-empty">
            <Icon name={hasFilters ? "filter" : "search"} size={18} />
            <h3>{hasFilters ? "No leads match these filters" : `No ${activeTab.label.toLowerCase()} jobs yet`}</h3>
            <p>{hasFilters ? "Clear filters or lower the score thresholds." : "Run a scan or paste a lead from the inbox to start filling this lane."}</p>
          </div>
        ) : (
          <div className="pipeline-list">
            {visibleLeads.map(lead => (
              <div key={lead.job_id} className="pipeline-list-item">
                {bulkSelecting && tab === "discarded" && (
                  <div
                    className="pipeline-select-box"
                    onClick={() => toggleSelect(lead.job_id)}
                    style={{ borderColor: selected.has(lead.job_id) ? "var(--bad)" : "var(--line)", background: selected.has(lead.job_id) ? "var(--bad)" : "var(--paper)" }}
                  >
                    {selected.has(lead.job_id) && <Icon name="check" size={11} color="#fff" />}
                  </div>
                )}
                <PipelineJobCard
                  lead={lead}
                  onOpen={openDrawer}
                  onDelete={deleteLead}
                  showGenerate={tab === "evaluated"}
                  port={port}
                />
              </div>
            ))}
          </div>
        )}
        {activeTab.leads.length > visibleCount && (
          <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
            <button className="btn" onClick={() => setVisibleCount(v => v + PAGE_SIZE)}>
              Show next {Math.min(PAGE_SIZE, activeTab.leads.length - visibleCount)} of {activeTab.leads.length}
            </button>
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
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [editingCandidate, setEditingCandidate] = useState(false);
  const [candForm, setCandForm] = useState({ n: "", s: "" });
  const [activeProfileTab, setActiveProfileTab] = useState<"skills" | "experience" | "projects">("skills");
  const [expandedProfileList, setExpandedProfileList] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/profile`);
      if (!r.ok) throw new Error(`Profile load failed (${r.status})`);
      const data = await r.json();
      if (!data || !Array.isArray(data.skills) || !Array.isArray(data.projects) || !Array.isArray(data.exp)) {
        throw new Error("Profile response was not a valid identity graph");
      }
      setProfile(data);
      setProfileErr(null);
    } catch (err: any) {
      console.error("Profile load failed:", err);
      setProfileErr(err?.message || "Profile load failed");
    }
  }, [port]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);
  useEffect(() => { setExpandedProfileList(false); }, [activeProfileTab]);
  useEffect(() => {
    const exportProfile = () => {
      if (!profile) return;
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${profile.n || "identity-graph"}.json`.replace(/[^\w.-]+/g, "-");
      a.click();
      URL.revokeObjectURL(url);
    };
    window.addEventListener("profile-export", exportProfile);
    return () => window.removeEventListener("profile-export", exportProfile);
  }, [profile]);

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
  const summary = String(profile?.s || "").replace(/\s+/g, " ").trim();
  const summaryPreview = summary
    ? summary.length > 265 ? `${summary.slice(0, 262).trim()}...` : summary
    : "Add your name and target role summary above. This becomes the anchor for scoring and document generation.";
  const skillRanks = useMemo(() => {
    const counts = new Map<string, { label: string; count: number; cat: string; id: string }>();
    const bump = (label: string, weight = 1, cat = "general", id = "") => {
      const clean = String(label || "").trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      const prev = counts.get(key);
      counts.set(key, { label: prev?.label || clean, count: (prev?.count || 0) + weight, cat: prev?.cat || cat, id: prev?.id || id });
    };
    skills.forEach((s: any) => bump(s.n, 1, s.cat, s.id));
    projects.forEach((p: any) => stackItems(p.stack).forEach(name => bump(name, 3)));
    exp.forEach((e: any) => (Array.isArray(e.s) ? e.s : stackItems(e.s)).forEach((name: string) => bump(name, 2)));
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [skills, projects, exp]);
  const previewSkills = expandedProfileList ? skillRanks : skillRanks.slice(0, 10);
  const previewExp = expandedProfileList ? exp : exp.slice(0, 6);
  const previewProjects = expandedProfileList ? projects : projects.slice(0, 8);
  const listTotal = activeProfileTab === "skills" ? skillRanks.length : activeProfileTab === "experience" ? exp.length : projects.length;
  const listShown = activeProfileTab === "skills" ? previewSkills.length : activeProfileTab === "experience" ? previewExp.length : previewProjects.length;
  const graphNodes = [
    { id: "skills" as const, label: "Skills", count: skills.length, tone: "blue", icon: "spark" },
    { id: "experience" as const, label: "Experience", count: exp.length, tone: "orange", icon: "brief" },
    { id: "projects" as const, label: "Projects", count: projects.length, tone: "pink", icon: "layers" },
  ];

  return (
    <div className="scroll profile-page">
      <div className="profile-shell profile-shell-compact">
        {profileErr && (
          <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 8, background: "var(--bad-soft)", border: "1px solid var(--bad)", color: "var(--bad)", fontSize: 13 }}>
            Could not refresh the Identity Graph. Your existing profile was not overwritten.
          </div>
        )}
        <div className="profile-workspace">
          <aside className="profile-left-rail">
            <div className="card profile-identity-card">
              <div className="profile-identity-head">
                <div className="profile-avatar">{(profile?.n || "C").slice(0, 1).toUpperCase()}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="eyebrow">Identity Context</span>
                  <h1 className="profile-name">{profile?.n || "Candidate Profile"}</h1>
                </div>
                {!editingCandidate && (
                  <button className="btn profile-edit-btn" onClick={() => { setEditingCandidate(true); setCandForm({ n: profile?.n || "", s: profile?.s || "" }); }}>
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
              <p className="profile-summary">{summaryPreview}</p>
              <div className="profile-pill-row">
                <span className="pill mono">{skills.length} SKILLS</span>
                <span className="pill mono">{exp.length} ROLES</span>
                <span className="pill mono">{projects.length} PROJECTS</span>
              </div>
            </>
          )}
            </div>

            <div className="card profile-signal-card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span className="eyebrow">Graph Signal</span>
                  <div className="display tabular" style={{ fontSize: 44, color: "var(--pink-ink)", marginTop: 6 }}>{evidenceCount}</div>
                </div>
                <Icon name="pulse" size={18} color="var(--pink-ink)" />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 8 }}>Evidence available for matching and application package generation.</div>
              {visibleStacks.length > 0 && (
                <div className="profile-stack-mini">
                  {visibleStacks.map(s => <span key={s} className="pill">{s}</span>)}
                </div>
              )}
              <button className="profile-add-context" onClick={() => setView("ingestion")}>
                <Icon name="plus" size={14} /> Add Context
              </button>
            </div>
          </aside>

          <main className="profile-main-panel">
            <section className="card profile-map-card">
              <div className="profile-map-head">
                <div>
                  <span className="eyebrow">Relationship View</span>
                  <h3>Candidate Evidence Map</h3>
                </div>
                <span className="pill mono">{topStacks.length} STACK TAGS</span>
              </div>
              <div className="profile-map-visual">
                <svg className="profile-map-connectors" viewBox="0 0 980 205" preserveAspectRatio="none" aria-hidden="true">
                  <path className="profile-connector profile-connector-blue" d="M235 111 C330 111 385 111 445 111" />
                  <path className="profile-connector profile-connector-orange" d="M565 111 C650 111 646 52 730 52 C760 52 762 52 790 52" />
                  <path className="profile-connector profile-connector-purple" d="M565 111 C650 111 646 168 730 168 C760 168 762 168 790 168" />
                </svg>
                <div className="profile-map-node profile-map-center-node">
                  <div className="profile-map-icon"><Icon name="user" size={18} /></div>
                  <strong>{profile?.n || "Candidate"}</strong>
                  <span>{evidenceCount} evidence items</span>
                </div>
                {graphNodes.map(node => (
                  <button
                    key={node.id}
                    className={`profile-map-node profile-map-node-${node.id} ${activeProfileTab === node.id ? "active" : ""}`}
                    onClick={() => { setActiveProfileTab(node.id); setEditId(null); }}
                    style={{ color: `var(--${node.tone}-ink)` }}
                  >
                    <div className="profile-map-icon" style={{ background: `var(--${node.tone}-soft)`, borderColor: `var(--${node.tone})` }}>
                      <Icon name={node.icon} size={17} />
                    </div>
                    <div className="profile-map-copy">
                      <strong>{node.label}</strong>
                      <span className="tabular">{node.count}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="card profile-tab-card">
              <div className="profile-tabs">
                {graphNodes.map(node => (
                  <button
                    key={node.id}
                    className={activeProfileTab === node.id ? "active" : ""}
                    onClick={() => { setActiveProfileTab(node.id); setEditId(null); }}
                  >
                    <Icon name={node.icon} size={14} />
                    <span>{node.label}</span>
                    <span className="mono">{node.count}</span>
                  </button>
                ))}
              </div>

              <div className="profile-tab-scroll">
                {activeProfileTab === "skills" && (
                  <div className="profile-skill-grid">
                    {skillRanks.length === 0 && <div className="profile-empty">No skills yet.</div>}
                    {previewSkills.map((s, idx) => {
                      const tone = ["blue", "yellow", "purple", "green", "orange", "teal"][idx % 6];
                      return (
                        <div key={`${s.id || s.label}-${idx}`} className={`profile-list-tile profile-list-tile-${tone}`}>
                          <div className="profile-list-leading">
                            <Icon name="check" size={14} />
                            <span>{s.label}</span>
                          </div>
                          <div className="profile-list-trailing">
                            <span className="profile-count-badge">{s.count}</span>
                            {s.id ? (
                              <button className="profile-row-action" onClick={() => deleteItem("skill", s.id)} title="Delete skill">
                                <Icon name="arrow-right" size={14} />
                              </button>
                            ) : (
                              <Icon name="arrow-right" size={14} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeProfileTab === "experience" && (
                  <div className="profile-timeline">
                    {exp.length === 0 && <div className="profile-empty">No experience recorded.</div>}
                    {previewExp.map((e: any, idx: number) => (
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
                                <div className="profile-card-title">{e.role}</div>
                                <div className="row gap-2" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>
                                  <span>{e.co}</span><span style={{ color: "var(--ink-4)" }}>-</span><span className="mono" style={{ fontSize: 11 }}>{e.period}</span>
                                </div>
                              </div>
                              <div className="row gap-2">
                                <span className="profile-count-badge">{idx + 1}</span>
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
                )}

                {activeProfileTab === "projects" && (
                  <div className="profile-project-grid">
                    {projects.length === 0 && <div className="profile-empty">No projects mapped.</div>}
                    {previewProjects.map((p: any, idx: number) => (
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
                              <div className="profile-card-title">{p.title}</div>
                              <div className="row gap-2">
                                <span className="profile-count-badge">{idx + 1}</span>
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
                )}
                {listTotal > listShown && (
                  <button className="profile-view-all" onClick={() => setExpandedProfileList(true)}>
                    View all {activeProfileTab} <Icon name="arrow-right" size={13} />
                  </button>
                )}
              </div>
            </section>
          </main>
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
      const endpointType = type === "exp" ? "experience" : type;
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/profile/${endpointType}`, {
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
              <button className="btn btn-primary" style={{alignSelf:"flex-start",padding:"10px 24px"}} onClick={() => addManual("skill", skillForm)} disabled={status==="loading" || !skillForm.n.trim()}>Add Skill</button>
            </div>
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}><Icon name="brief" size={16}/> Add Experience</h3>
              <input className="field-input" placeholder="Role Title" value={expForm.role} onChange={v => setExpForm({...expForm, role: v.target.value})} />
              <input className="field-input" placeholder="Company" value={expForm.co} onChange={v => setExpForm({...expForm, co: v.target.value})} />
              <input className="field-input" placeholder="Period (e.g. 2022-2024)" value={expForm.period} onChange={v => setExpForm({...expForm, period: v.target.value})} />
              <textarea className="field-input" placeholder="Description" rows={3} value={expForm.d} onChange={v => setExpForm({...expForm, d: v.target.value})} />
              <button className="btn btn-primary" style={{alignSelf:"flex-start",padding:"10px 24px"}} onClick={() => addManual("exp", expForm)} disabled={status==="loading" || (!expForm.role.trim() && !expForm.co.trim())}>Add Experience</button>
            </div>
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}><Icon name="layers" size={16}/> Add Project</h3>
              <input className="field-input" placeholder="Project Title" value={projForm.title} onChange={v => setProjForm({...projForm, title: v.target.value})} />
              <input className="field-input" placeholder="Stack (comma-separated)" value={projForm.stack} onChange={v => setProjForm({...projForm, stack: v.target.value})} />
              <input className="field-input" placeholder="Repo URL (optional)" value={projForm.repo} onChange={v => setProjForm({...projForm, repo: v.target.value})} />
              <textarea className="field-input" placeholder="Impact / Description" rows={3} value={projForm.impact} onChange={v => setProjForm({...projForm, impact: v.target.value})} />
              <button className="btn btn-primary" style={{alignSelf:"flex-start",padding:"10px 24px"}} onClick={() => addManual("project", projForm)} disabled={status==="loading" || !projForm.title.trim()}>Add Project</button>
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
  const [feedbackBusy, setFeedbackBusy] = useState<string | null>(null);
  const [feedbackErr, setFeedbackErr] = useState<string | null>(null);
  const [followupBusy, setFollowupBusy] = useState<number | null>(null);

  const resumeReady = Boolean(j.resume_asset || j.asset);
  const coverReady = Boolean(j.cover_letter_asset);
  const activeReady = activeDoc === "resume" ? resumeReady : coverReady;
  const activeDocUrl = activeReady
    ? `http://127.0.0.1:${port}/api/v1/leads/${j.job_id}/pdf?kind=${activeDoc === "resume" ? "resume" : "cover_letter"}`
    : null;
  const selectedProjects = j.selected_projects || [];
  const coverage = (j.keyword_coverage || j.source_meta?.keyword_coverage || {}) as KeywordCoverage;
  const missingTerms: string[] = Array.isArray(coverage.missing_terms) ? coverage.missing_terms : [];
  const incorporatedTerms: string[] = Array.isArray(coverage.incorporated_terms) ? coverage.incorporated_terms : [];
  const coveredTerms: string[] = Array.isArray(coverage.covered_terms) ? coverage.covered_terms : [];
  const coveragePct = typeof coverage.coverage_pct === "number" ? coverage.coverage_pct : null;
  const hasCoverage = missingTerms.length > 0 || incorporatedTerms.length > 0 || coveredTerms.length > 0;
  const canFire = resumeReady && coverReady && !firing;
  const display = leadDisplayHeading(j);
  const originalTitle = cleanLeadText(j.title);
  const descriptionText = cleanLeadText(j.description);
  const jobDescription = [
    originalTitle && originalTitle !== display.role ? `Original listing title:\n${originalTitle}` : "",
    descriptionText ? `Description:\n${descriptionText}` : "",
  ].filter(Boolean).join("\n\n") || "No job description extracted yet.";

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

  const submitFeedback = async (feedback: string) => {
    setFeedbackBusy(feedback);
    setFeedbackErr(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/leads/${j.job_id}/feedback`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || `Server returned ${r.status}`);
      }
    } catch (err) {
      setFeedbackErr(err instanceof Error ? err.message : "Feedback failed");
    } finally {
      setFeedbackBusy(null);
    }
  };

  const scheduleFollowup = async (days: number) => {
    setFollowupBusy(days);
    setFeedbackErr(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/leads/${j.job_id}/followup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || `Server returned ${r.status}`);
      }
    } catch (err) {
      setFeedbackErr(err instanceof Error ? err.message : "Follow-up save failed");
    } finally {
      setFollowupBusy(null);
    }
  };

  const extractedDetails = [
    ["Tech stack", (j.tech_stack || []).join(", ")],
    ["Location", j.location || ""],
    ["Urgency", j.urgency || ""],
    ["Budget", j.budget || ""],
  ].filter(([, value]) => value);

  const draftBlock = (label: string, value?: string) => value ? (
    <div key={label} style={{ background: "var(--paper-3)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => navigator.clipboard?.writeText(value)}>Copy</button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{value}</div>
    </div>
  ) : null;

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
              {j.budget && <span className="pill mono" style={{ background: "var(--green-soft)", color: "var(--green-ink)", border: "1px solid var(--green)" }}>{j.budget}</span>}
              {(j.signal_score || 0) > 0 && <span className="pill mono" style={{ background: (j.signal_score || 0) >= 80 ? "var(--orange-soft)" : "var(--yellow-soft)", color: (j.signal_score || 0) >= 80 ? "var(--orange-ink)" : "var(--yellow-ink)", border: `1px solid ${(j.signal_score || 0) >= 80 ? "var(--orange)" : "var(--yellow)"}` }}>Lead signal {j.signal_score}</span>}
              {!!j.learning_delta && <span className="pill mono" style={{ background: j.learning_delta > 0 ? "var(--green-soft)" : "var(--bad-soft)", color: j.learning_delta > 0 ? "var(--green-ink)" : "var(--bad)", border: `1px solid ${j.learning_delta > 0 ? "var(--green)" : "var(--bad)"}` }}>Learning {j.learning_delta > 0 ? "+" : ""}{j.learning_delta}</span>}
              {j.feedback && <span className="pill mono" style={{ background: "var(--blue-soft)", color: "var(--blue-ink)", border: "1px solid var(--blue)" }}>{j.feedback.replace(/_/g, " ")}</span>}
              {j.score > 0 && <span className="pill mono" style={{ background: j.score >= 85 ? "var(--green-soft)" : j.score >= 60 ? "var(--yellow-soft)" : "var(--bad-soft)", color: j.score >= 85 ? "var(--green-ink)" : j.score >= 60 ? "var(--yellow-ink)" : "var(--bad)" }}>{j.score}/100 match</span>}
            </div>
            <h2 style={{ fontSize: 26, fontWeight: 600, overflowWrap: "anywhere" }}>
              {display.role} <span style={{ color: "var(--ink-3)", fontWeight: 700 }}>||</span> {display.company}
            </h2>
            <p style={{ color: "var(--ink-3)", fontSize: 13, marginTop: 2 }}>{j.platform}</p>
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
            {hasCoverage && (
              <div style={{ background: "var(--blue-soft)", border: "1px solid var(--blue)", borderRadius: 10, padding: "10px 12px" }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 7 }}>
                  <span className="eyebrow" style={{ color: "var(--blue-ink)" }}>Coverage</span>
                  {coveragePct !== null && <span className="mono" style={{ fontSize: 11, fontWeight: 800, color: "var(--blue-ink)" }}>{coveragePct}% JD keywords</span>}
                </div>
                <div style={{ fontSize: 12.3, color: "var(--ink-2)", lineHeight: 1.5 }}>
                  {missingTerms.length > 0
                    ? <>You're missing these terms from the JD: <b>{missingTerms.slice(0, 6).join(", ")}</b>. We've incorporated the supported matches where applicable.</>
                    : <>Strong keyword coverage. We've incorporated supported JD terms where they fit the profile.</>
                  }
                </div>
                {incorporatedTerms.length > 0 && (
                  <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 8 }}>
                    <span className="eyebrow" style={{ marginRight: 2 }}>In resume</span>
                    {incorporatedTerms.slice(0, 8).map((term, i) => (
                      <span key={i} className="pill" style={{ background: "var(--paper)", color: "var(--blue-ink)", border: "1px solid var(--blue)" }}>{term}</span>
                    ))}
                  </div>
                )}
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
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Job Description</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6, background: "var(--paper-3)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--line)", whiteSpace: "pre-wrap" }}>
                {jobDescription}
              </div>
            </div>

            {extractedDetails.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Extracted Details</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                  {extractedDetails.map(([label, value]) => (
                    <div key={label} style={{ background: "var(--paper-3)", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 10px", minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 12.5, color: "var(--ink-2)", overflowWrap: "anywhere" }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="eyebrow">Match Reasoning</div>

            {(j.signal_score || j.signal_reason || (j.signal_tags?.length ?? 0) > 0) && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Lead Signal</div>
                <div style={{ background: "var(--orange-soft)", border: "1px solid var(--orange)", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12.5, color: "var(--orange-ink)", fontWeight: 700 }}>Signal score</span>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 800, color: "var(--orange-ink)" }}>{j.signal_score || 0}/100</span>
                  </div>
                  {!!j.learning_delta && (
                    <div style={{ background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px" }}>
                      <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Feedback learning</span>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: j.learning_delta > 0 ? "var(--green-ink)" : "var(--bad)" }}>
                          {(j.base_signal_score ?? 0) || ((j.signal_score || 0) - j.learning_delta)} {j.learning_delta > 0 ? "+" : ""}{j.learning_delta}
                        </span>
                      </div>
                      {j.learning_reason && <div style={{ marginTop: 5, fontSize: 12.2, color: "var(--ink-2)", lineHeight: 1.45 }}>{j.learning_reason}</div>}
                    </div>
                  )}
                  {j.signal_reason && <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>{j.signal_reason}</div>}
                  {(j.signal_tags?.length ?? 0) > 0 && (
                    <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                      {j.signal_tags!.slice(0, 8).map(tag => (
                        <span key={tag} className="pill mono" style={{ fontSize: 9, background: "var(--paper)", color: "var(--ink-3)", border: "1px solid var(--line)" }}>{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {((j.fit_bullets?.length ?? 0) > 0 || j.proof_snippet) && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Proof Pack</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(j.fit_bullets?.length ?? 0) > 0 && (
                    <div style={{ background: "var(--green-soft)", border: "1px solid var(--green)", borderRadius: 10, padding: "10px 12px" }}>
                      <div className="mono" style={{ fontSize: 10, color: "var(--green-ink)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Why I fit</div>
                      <div className="col gap-1">
                        {j.fit_bullets!.map((bullet, idx) => (
                          <div key={idx} style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.45 }}>{bullet}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {j.proof_snippet && draftBlock("Proof snippet", j.proof_snippet)}
                </div>
              </div>
            )}

            {(j.outreach_reply || j.outreach_dm || j.outreach_email || j.proposal_draft) && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Outreach Messages</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {j.outreach_reply && (
                    <div style={{ background: "var(--purple-soft)", border: "1px solid var(--purple)", borderRadius: 10, padding: "10px 12px" }}>
                      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span className="mono" style={{ fontSize: 10, color: "var(--purple-ink)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>3-Line Founder Message</span>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => navigator.clipboard?.writeText(j.outreach_reply!)}>Copy</button>
                      </div>
                      <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.65, whiteSpace: "pre-wrap", fontWeight: 500 }}>{j.outreach_reply}</div>
                    </div>
                  )}
                  {draftBlock("LinkedIn Note", j.outreach_dm)}
                  {draftBlock("Cold Email", j.outreach_email)}
                  {draftBlock("Proposal", j.proposal_draft)}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Lead Feedback</div>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                {[
                  ["relevant", "Relevant"],
                  ["not_relevant", "Not Relevant"],
                  ["duplicate", "Duplicate"],
                  ["low_quality", "Low Quality"],
                  ["incorrect_category", "Incorrect Category"],
                  ["already_contacted", "Contacted"],
                ].map(([id, label]) => {
                  const active = j.feedback === id;
                  return (
                    <button key={id} onClick={() => submitFeedback(id)} disabled={feedbackBusy === id} style={{
                      padding: "5px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: feedbackBusy === id ? "wait" : "pointer",
                      border: `1px solid ${active ? "var(--blue)" : "var(--line)"}`,
                      background: active ? "var(--blue-soft)" : "var(--paper-3)",
                      color: active ? "var(--blue-ink)" : "var(--ink-2)",
                    }}>{feedbackBusy === id ? "Saving..." : label}</button>
                  );
                })}
              </div>
              {feedbackErr && <div style={{ marginTop: 6, color: "var(--bad)", fontSize: 11.5 }}>{feedbackErr}</div>}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Follow-up</div>
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                {[2, 5, 10].map(days => (
                  <button key={days} onClick={() => scheduleFollowup(days)} disabled={followupBusy === days} style={{
                    padding: "5px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: followupBusy === days ? "wait" : "pointer",
                    border: "1px solid var(--green)", background: "var(--green-soft)", color: "var(--green-ink)",
                  }}>{followupBusy === days ? "Saving..." : `${days} days`}</button>
                ))}
              </div>
              {j.followup_due_at && <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 6 }}>Due {j.followup_due_at}</div>}
              {(j.followup_sequence?.length ?? 0) > 0 && (
                <div style={{ marginTop: 8, background: "var(--paper-3)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px" }}>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Suggested sequence</div>
                  <div className="col gap-1">
                    {j.followup_sequence!.map((step, idx) => (
                      <div key={idx} style={{ fontSize: 12.2, color: "var(--ink-2)", lineHeight: 1.45 }}>{step}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

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
  const { leads, setLeads, loading: leadsLoading, error: leadsError } = useLeads(port, wsAddLog);
  const dueFollowups = useDueFollowups(port);
  const stats  = useGraphStats(port);
  const [view, setView]           = useState<View>("apply");
  const [sel, setSel]             = useState<Lead | null>(null);
  // Always pass the live version of the selected lead so the drawer reflects real-time updates
  const liveSel = sel ? (leads.find(l => l.job_id === sel.job_id) ?? sel) : null;
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem(ONBOARDING_KEY) !== "done");
  const [applyDraft, setApplyDraft] = useState("");
  const [scanning, setScanning]   = useState(false);
  const [reevaluating, setReevaluating] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [scanErr, setScanErr]     = useState<string | null>(null);

  useEffect(() => {
    const h = () => setScanning(false);
    window.addEventListener("scan-done", h);
    return () => window.removeEventListener("scan-done", h);
  }, []);

  useEffect(() => {
    const h = () => setReevaluating(false);
    window.addEventListener("reevaluate-done", h);
    return () => window.removeEventListener("reevaluate-done", h);
  }, []);

  useEffect(() => {
    const h = () => setCleaning(false);
    window.addEventListener("cleanup-done", h);
    return () => window.removeEventListener("cleanup-done", h);
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

  const onReevaluateJobs = useCallback(async () => {
    if (!port || reevaluating || scanning) return;
    setReevaluating(true); setScanErr(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/leads/reevaluate`, { method: "POST" });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || "Re-evaluation failed");
      }
    } catch (e: any) {
      const msg = e.message || "Re-evaluation failed";
      setScanErr(msg); setReevaluating(false);
      wsAddLog(msg, "system", "reeval");
    }
  }, [port, reevaluating, scanning, wsAddLog]);

  const onStopReevaluate = useCallback(async () => {
    if (!port) return;
    try { await fetch(`http://127.0.0.1:${port}/api/v1/leads/reevaluate/stop`, { method: "POST" }); }
    catch { /* ignore */ }
  }, [port]);

  const onCleanupLeads = useCallback(async () => {
    if (!port || scanning || reevaluating || cleaning) return;
    const ok = window.confirm("Discard obvious bad rows like HN discussion comments and non-job content? This keeps the rows in Discarded with a cleanup reason.");
    if (!ok) return;
    setCleaning(true); setScanErr(null);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/v1/leads/cleanup`, { method: "POST" });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || "Cleanup failed");
      }
      const result = await r.json();
      wsAddLog(`Cleanup discarded ${result.discarded ?? 0} bad rows after scanning ${result.scanned ?? 0}`, "system", "cleanup");
      window.dispatchEvent(new CustomEvent("leads-refresh"));
    } catch (e: any) {
      const msg = e.message || "Cleanup failed";
      setScanErr(msg);
      wsAddLog(msg, "system", "cleanup");
    } finally {
      setCleaning(false);
    }
  }, [port, scanning, reevaluating, cleaning, wsAddLog]);

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
          {view === "apply"     && <ApplyJobView port={port} leads={leads} openDrawer={setSel} initialInput={applyDraft} />}
          {view === "dashboard" && <DashboardView leads={leads} dueFollowups={dueFollowups} logs={logs} setView={setView} openDrawer={setSel} scanning={scanning} reevaluating={reevaluating} cleaning={cleaning} onScan={onScan} onStopScan={onStopScan} onReevaluate={onReevaluateJobs} onStopReevaluate={onStopReevaluate} onCleanup={onCleanupLeads} scanErr={scanErr} />}
          {view === "inbox"     && <LeadInboxView port={port} onCreated={setSel} />}
          {view === "pipeline"  && <PipelineView leads={leads} openDrawer={setSel} deleteLead={deleteLead} port={port} scanning={scanning} reevaluating={reevaluating} cleaning={cleaning} onReevaluate={onReevaluateJobs} onStopReevaluate={onStopReevaluate} onCleanup={onCleanupLeads} loading={leadsLoading || !port} error={leadsError} />}
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
        {showOnboarding && port && (
          <OnboardingWizard
            key="onboarding"
            port={port}
            onOpenSettings={() => setShowSettings(true)}
            onFinish={(draft) => {
              localStorage.setItem(ONBOARDING_KEY, "done");
              setApplyDraft(draft);
              setView("apply");
              setShowOnboarding(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
