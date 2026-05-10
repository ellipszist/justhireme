import { useEffect, useState } from "react";
import type { ApiFetch, GraphStats } from "../../types";

export function useGraphStats(api: ApiFetch | null) {
  const [stats, setStats] = useState<GraphStats>({ candidate: 0, skill: 0, project: 0, experience: 0, joblead: 0 });
  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    const load = () => api(`/api/v1/graph`, { signal: controller.signal }).then(r => r.json()).then(setStats).catch(() => {});
    const refresh = () => load();
    load();
    window.addEventListener("lead-updated", refresh);
    window.addEventListener("leads-refresh", refresh);
    window.addEventListener("scan-done", refresh);
    window.addEventListener("reevaluate-done", refresh);
    window.addEventListener("cleanup-done", refresh);
    return () => {
      controller.abort();
      window.removeEventListener("lead-updated", refresh);
      window.removeEventListener("leads-refresh", refresh);
      window.removeEventListener("scan-done", refresh);
      window.removeEventListener("reevaluate-done", refresh);
      window.removeEventListener("cleanup-done", refresh);
    };
  }, [api]);
  return stats;
}
