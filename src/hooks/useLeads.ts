import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ApiFetch, Lead, LogLine } from "../types";

export function useLeads(api: ApiFetch | null, addLog?: (msg: string, kind: LogLine["kind"], src?: string) => void) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const knownLeadIds = useRef<Set<string>>(new Set());

  const notifyStrongLead = (lead: Lead) => {
    const topScore = Math.max(lead.score || 0, lead.signal_score ?? 0);
    if (topScore < 80) return;
    invoke("notify_high_score_lead", {
      title: `Strong match: ${lead.title}`,
      body: `${lead.company} · Score ${topScore}`,
    }).catch(() => {});
  };

  useEffect(() => {
    if (!api) {
      setLoading(true);
      setLoaded(false);
      initialLoadDone.current = false;
      return;
    }
    let alive = true;
    const load = async (background = false) => {
      if (!background) setLoading(true);
      try {
        const r = await api(`/api/v1/leads`);
        if (!r.ok) throw new Error(`Lead load failed (${r.status})`);
        const items = await r.json();
        if (!alive) return;
        const jobLeads = (items as Lead[]).filter(l => (l.kind || "job") !== "freelance");
        setLeads(jobLeads);
        jobLeads.forEach(lead => knownLeadIds.current.add(lead.job_id));
        if (!background) initialLoadDone.current = true;
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
        if (idx === -1) {
          const isNew = !knownLeadIds.current.has(updated.job_id);
          knownLeadIds.current.add(updated.job_id);
          if (initialLoadDone.current && isNew) notifyStrongLead(updated);
          return [updated, ...prev];
        }
        const next = [...prev];
        next[idx] = { ...next[idx], ...updated };
        return next;
      });
    };
    window.addEventListener("lead-updated", onLeadUpdated);
    const onRefresh = () => load(true);
    window.addEventListener("leads-refresh", onRefresh);

    api(`/api/v1/events?limit=200`)
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
  }, [api]);
  return { leads, setLeads, loading: loading && !loaded, error };
}
