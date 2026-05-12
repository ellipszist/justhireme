import { useEffect, useMemo, useState } from "react";
import Icon from "../../shared/components/Icon";
import { LeadFilterBar } from "./components/LeadFilterBar";
import { PipelineJobCard, PipelineSkeleton } from "./components/JobCard";
import type { ApiFetch, Lead, LeadSort, PipelineTab, SeniorityFilter } from "../../types";
import { PAGE_SIZE, leadSearchText, sortLeads, seniorityMatches, uniqueLeadValues } from "../../shared/lib/leadUtils";

export function PipelineView({ leads, openDrawer, deleteLead, port, api, scanning, reevaluating, cleaning, onReevaluate, onStopReevaluate, onCleanup, loading, error }: {
  leads: Lead[]; openDrawer: (l: Lead) => void;
  deleteLead: (id: string) => void; port: number | null; api: ApiFetch | null;
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
  const [exporting, setExporting] = useState(false);

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
      { id: "applied",   label: "Applied",   tone: "orange", leads: apply(leads.filter(l => l.status === "applied")) },
      { id: "discarded", label: "Discarded", tone: "bad",    leads: apply(leads.filter(l => l.status === "discarded")) },
    ];
    return tabItems;
  }, [leads, search, platform, minSignal, minMatch, sort, budgetOnly, learningOnly, seniority]);

  const activeTab = tabs.find(t => t.id === tab) || tabs[0];
  const visibleLeads = activeTab.leads.slice(0, visibleCount);
  const hasFilters = Boolean(search || platform || minSignal || minMatch || budgetOnly || learningOnly || seniority !== "all");
  const hotCount = leads.filter(l => (l.signal_score || 0) >= 80 || (l.score || 0) >= 85).length;
  const readyCount = leads.filter(l => l.status === "tailoring" || l.status === "approved").length;
  const appliedCount = leads.filter(l => l.status === "applied").length;
  const busyLabel = scanning ? "Scanning for new leads" : reevaluating ? "Re-evaluating fit scores" : cleaning ? "Cleaning bad data" : "";
  const metrics = [
    { label: "Total", value: leads.length, tone: "blue", icon: "layers" },
    { label: "Hot", value: hotCount, tone: "orange", icon: "spark" },
    { label: "New", value: leads.filter(l => l.status === "discovered").length, tone: "teal", icon: "search" },
    { label: "Ready", value: readyCount, tone: "purple", icon: "file" },
    { label: "Applied", value: appliedCount, tone: "orange", icon: "check" },
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
    const count = selected.size;
    const results = await Promise.allSettled([...selected].map(id => Promise.resolve(deleteLead(id))));
    const failed = results.filter(r => r.status === "rejected").length;
    if (failed > 0) alert(`${failed} of ${count} deletions failed. Refreshing list.`);
    setSelected(new Set());
    setBulkSelecting(false);
    window.dispatchEvent(new CustomEvent("leads-refresh"));
  };

  const bulkMarkApplied = async () => {
    if (!api || selected.size === 0) return;
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map(id => api(`/api/v1/leads/${id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "applied" }),
    })));
    const failed = results.filter(r => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok)).length;
    if (failed > 0) alert(`${failed} of ${ids.length} jobs could not be marked as applied.`);
    ids.forEach(job_id => window.dispatchEvent(new CustomEvent("lead-updated", { detail: { job_id, status: "applied" } })));
    setSelected(new Set());
    setBulkSelecting(false);
    window.dispatchEvent(new CustomEvent("leads-refresh"));
  };

  const exportCsv = async () => {
    if (!api || exporting) return;
    setExporting(true);
    try {
      const res = await api("/api/v1/leads/export.csv");
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "jhm_pipeline.csv";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
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
                const nextTab = metric.label === "Hot" ? "hot" : metric.label === "New" ? "found" : metric.label === "Ready" ? "generated" : metric.label === "Applied" ? "applied" : metric.label === "Discarded" ? "discarded" : "all";
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
            <button className="btn" onClick={exportCsv} disabled={!api || exporting || loading}>
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
            {bulkSelecting ? (
              <>
                <button className="btn" onClick={bulkMarkApplied} disabled={!api || selected.size === 0 || loading}>
                  <Icon name="check" size={13} /> Mark applied {selected.size}
                </button>
                <button className="btn" onClick={() => { setBulkSelecting(false); setSelected(new Set()); }}>Cancel</button>
              </>
            ) : (
              <button className="btn" onClick={() => setBulkSelecting(true)} disabled={activeTab.leads.length === 0 || loading}>
                <Icon name="check" size={13} /> Select jobs
              </button>
            )}
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
          {bulkSelecting && (
            <span className={`pipeline-selected mono ${tab === "discarded" ? "danger" : "applied"}`}>
              {selected.size} selected
            </span>
          )}
        </div>
        {loading ? (
          <PipelineSkeleton />
        ) : activeTab.leads.length === 0 ? (
          <div className="pipeline-empty">
            <Icon name={hasFilters ? "filter" : "search"} size={18} />
            <h3>{hasFilters ? "No leads match these filters" : `No ${activeTab.label.toLowerCase()} jobs yet`}</h3>
            <p>{hasFilters ? "Clear filters or lower the score thresholds." : "Run a scan from the dashboard or customize a pasted job to start filling this lane."}</p>
          </div>
        ) : (
          <div className="pipeline-list">
            {visibleLeads.map(lead => (
              <div key={lead.job_id} className="pipeline-list-item">
                {bulkSelecting && (
                  <div
                    className="pipeline-select-box"
                    onClick={() => toggleSelect(lead.job_id)}
                    style={{
                      borderColor: selected.has(lead.job_id) ? (tab === "discarded" ? "var(--bad)" : "var(--orange)") : "var(--line)",
                      background: selected.has(lead.job_id) ? (tab === "discarded" ? "var(--bad)" : "var(--orange)") : "var(--paper)",
                    }}
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
                  api={api}
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
