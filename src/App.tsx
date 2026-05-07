import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import SettingsModal from "./SettingsModal";
import "./index.css";
import type { ApiFetch, Lead, View } from "./types";
import { ONBOARDING_KEY } from "./lib/leadUtils";
import { useWS } from "./hooks/useWS";
import { useLeads } from "./hooks/useLeads";
import { useDueFollowups } from "./hooks/useDueFollowups";
import { useGraphStats } from "./hooks/useGraphStats";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import ErrorBoundary from "./components/ErrorBoundary";
import { DashboardView } from "./views/DashboardView";
import { LeadInboxView } from "./views/LeadInboxView";
import { ApplyJobView } from "./views/ApplyJobView";
import { PipelineView } from "./views/PipelineView";
import { GraphView } from "./views/GraphView";
import { ActivityView } from "./views/ActivityView";
import { ProfileView } from "./views/ProfileView";
import { IngestionView } from "./views/IngestionView";
import { ApprovalDrawer } from "./components/ApprovalDrawer";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { HelpChat } from "./components/HelpChat";

export default function App() {
  const { conn, port, apiToken, logs, beat, addLog: wsAddLog } = useWS();
  const api = useMemo<ApiFetch | null>(() => {
    if (!port || !apiToken) return null;
    return (path, opts) => {
      const headers = new Headers(opts?.headers);
      headers.set("Authorization", `Bearer ${apiToken}`);
      return fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers });
    };
  }, [port, apiToken]);
  const { leads, setLeads, loading: leadsLoading, error: leadsError } = useLeads(api, wsAddLog);
  const dueFollowups = useDueFollowups(api);
  const stats  = useGraphStats(api);
  const [view, setView]           = useState<View>("dashboard");
  const [sel, setSel]             = useState<Lead | null>(null);
  // Always pass the live version of the selected lead so the drawer reflects real-time updates
  const liveSel = sel ? (leads.find(l => l.job_id === sel.job_id) ?? sel) : null;
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => localStorage.getItem(ONBOARDING_KEY) !== "done");
  const [applyDraft, setApplyDraft] = useState("");
  const [applyAutoFocus, setApplyAutoFocus] = useState(false);
  const [scanning, setScanning]   = useState(false);
  const [reevaluating, setReevaluating] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [scanErr, setScanErr]     = useState<string | null>(null);
  const [startupSeconds, setStartupSeconds] = useState(0);
  const closeDrawer = useCallback(() => setSel(null), []);
  const focusApplyView = useCallback(() => {
    setView("apply");
    setApplyAutoFocus(true);
  }, []);
  const openSettings = useCallback(() => setShowSettings(true), []);
  const openSetupGuide = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    setShowOnboarding(true);
  }, []);

  useEffect(() => {
    const h = () => setScanning(false);
    window.addEventListener("scan-done", h);
    return () => window.removeEventListener("scan-done", h);
  }, []);

  useEffect(() => {
    if (api) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setStartupSeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [api]);

  useKeyboardShortcuts({
    onEscape: closeDrawer,
    onCmdK: focusApplyView,
    onCmdComma: openSettings,
  });

  useEffect(() => {
    if (view !== "apply" || !applyAutoFocus) return;
    const timer = window.setTimeout(() => setApplyAutoFocus(false), 0);
    return () => window.clearTimeout(timer);
  }, [view, applyAutoFocus]);

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
    if (!port || !api || scanning) return;
    setScanning(true); setScanErr(null);
    try {
      const r = await api(`/api/v1/scan`, { method: "POST" });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || "Backend unreachable");
      }
    } catch (e: any) {
      setScanErr(e.message || "Scan failed"); setScanning(false);
    }
  }, [port, api, scanning]);

  const onStopScan = useCallback(async () => {
    if (!port || !api) return;
    try { await api(`/api/v1/scan/stop`, { method: "POST" }); }
    catch { /* ignore */ }
  }, [port, api]);

  const onReevaluateJobs = useCallback(async () => {
    if (!port || !api || reevaluating || scanning) return;
    setReevaluating(true); setScanErr(null);
    try {
      const r = await api(`/api/v1/leads/reevaluate`, { method: "POST" });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || "Re-evaluation failed");
      }
    } catch (e: any) {
      const msg = e.message || "Re-evaluation failed";
      setScanErr(msg); setReevaluating(false);
      wsAddLog(msg, "system", "reeval");
    }
  }, [port, api, reevaluating, scanning, wsAddLog]);

  const onStopReevaluate = useCallback(async () => {
    if (!port || !api) return;
    try { await api(`/api/v1/leads/reevaluate/stop`, { method: "POST" }); }
    catch { /* ignore */ }
  }, [port, api]);

  const onCleanupLeads = useCallback(async () => {
    if (!port || !api || scanning || reevaluating || cleaning) return;
    const ok = window.confirm("Discard obvious bad rows like HN discussion comments and non-job content? This keeps the rows in Discarded with a cleanup reason.");
    if (!ok) return;
    setCleaning(true); setScanErr(null);
    try {
      const r = await api(`/api/v1/leads/cleanup`, { method: "POST" });
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
  }, [port, api, scanning, reevaluating, cleaning, wsAddLog]);

  const deleteLead = useCallback(async (jobId: string) => {
    if (!port || !api) return;
    await api(`/api/v1/leads/${jobId}`, { method: "DELETE" });
    setLeads(prev => prev.filter(l => l.job_id !== jobId));
  }, [port, api, setLeads]);

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

  if (!api) {
    return <StartupScreen conn={conn} port={port} seconds={startupSeconds} />;
  }

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden", alignItems: "stretch" }}>
      <Sidebar view={view} setView={setView} leadCounts={leadCounts} online={conn === "connected"} port={port} beat={beat} onSettings={() => setShowSettings(true)} onSetup={openSetupGuide} />
      <div className="app-main">
        <Topbar view={view} />
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
          {view === "apply"     && <ErrorBoundary label="Apply"><ApplyJobView port={port} api={api} leads={leads} openDrawer={setSel} initialInput={applyDraft} autoFocus={applyAutoFocus} /></ErrorBoundary>}
          {view === "dashboard" && <ErrorBoundary label="Dashboard"><DashboardView leads={leads} dueFollowups={dueFollowups} logs={logs} setView={setView} openDrawer={setSel} scanning={scanning} reevaluating={reevaluating} cleaning={cleaning} onScan={onScan} onStopScan={onStopScan} onReevaluate={onReevaluateJobs} onStopReevaluate={onStopReevaluate} onCleanup={onCleanupLeads} scanErr={scanErr} /></ErrorBoundary>}
          {view === "inbox"     && <ErrorBoundary label="Inbox"><LeadInboxView port={port} api={api} onCreated={setSel} /></ErrorBoundary>}
          {view === "pipeline"  && <ErrorBoundary label="Pipeline"><PipelineView leads={leads} openDrawer={setSel} deleteLead={deleteLead} port={port} api={api} scanning={scanning} reevaluating={reevaluating} cleaning={cleaning} onReevaluate={onReevaluateJobs} onStopReevaluate={onStopReevaluate} onCleanup={onCleanupLeads} loading={leadsLoading || !port || !api} error={leadsError} /></ErrorBoundary>}
          {view === "graph"     && <ErrorBoundary label="Graph"><GraphView stats={stats} /></ErrorBoundary>}
          {view === "activity"  && <ErrorBoundary label="Activity"><ActivityView logs={logs} /></ErrorBoundary>}
          {view === "profile"   && (api ? <ErrorBoundary label="Profile"><ProfileView api={api} setView={setView} /></ErrorBoundary> : <BackendUnavailable title="Profile" conn={conn} port={port} />)}
          {view === "ingestion" && (api ? <ErrorBoundary label="Ingestion"><IngestionView api={api} /></ErrorBoundary> : <BackendUnavailable title="Add Context" conn={conn} port={port} />)}
        </div>
      </div>

      <AnimatePresence>
        {liveSel && api && (
          <ApprovalDrawer key={liveSel.job_id} j={liveSel} api={api} onClose={() => setSel(null)} onFired={() => setSel(null)} />
        )}
        {showSettings && api && (
          <SettingsModal key="settings" api={api} onClose={() => setShowSettings(false)} />
        )}
        {showOnboarding && api && (
          <OnboardingWizard
            key="onboarding"
            api={api}
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
      {api && <HelpChat api={api} />}
    </div>
  );
}

function StartupScreen({ conn, port, seconds }: { conn: string; port: number | null; seconds: number }) {
  const isSlow = seconds >= 20;
  return (
    <div style={{
      minHeight: "100vh",
      width: "100vw",
      display: "grid",
      placeItems: "center",
      background: "var(--paper)",
      color: "var(--ink)",
      padding: 24,
    }}>
      <section className="card col gap-4" style={{ width: "min(720px, 100%)", padding: 30 }}>
        <div className="row gap-3">
          <div className="spinner" />
          <div>
            <div className="eyebrow">Starting JustHireMe</div>
            <h1 style={{ fontSize: 30, marginTop: 6 }}>Preparing your local workspace</h1>
          </div>
        </div>
        <p style={{ color: "var(--ink-2)", lineHeight: 1.6, maxWidth: 620 }}>
          The desktop app is launching its bundled backend, opening the local database, and waiting for a private API token.
          The setup guide will appear automatically as soon as the backend is ready.
        </p>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          <span className="pill">Backend: {conn}</span>
          <span className="pill">Port: {port ?? "pending"}</span>
          <span className="pill">Elapsed: {seconds}s</span>
        </div>
        {isSlow && (
          <div style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 14,
            background: "var(--paper-3)",
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}>
            This is taking longer than expected. If it stays here, the bundled sidecar failed to start or Windows blocked it.
            Restarting the app usually clears a locked local database; the Activity view will show live events after startup.
          </div>
        )}
      </section>
    </div>
  );
}

function BackendUnavailable({ title, conn, port }: { title: string; conn: string; port: number | null }) {
  return (
    <div className="ingestion-page scroll">
      <div className="ingestion-shell">
        <div className="card col gap-4" style={{ padding: 28 }}>
          <div className="row gap-3">
            <div className="spinner" />
            <div>
              <div className="eyebrow">Starting local backend</div>
              <h2 style={{ marginTop: 6 }}>{title} will appear automatically</h2>
            </div>
          </div>
          <p style={{ color: "var(--ink-2)", maxWidth: 620, lineHeight: 1.6 }}>
            JustHireMe is waiting for the bundled sidecar to publish its API token and port. This should take a few seconds after launch.
          </p>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            <span className="pill">Connection: {conn}</span>
            <span className="pill">Port: {port ?? "pending"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
