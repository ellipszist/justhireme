import { useEffect, useState } from "react";
import type { ApiFetch, GraphStats } from "../types";

export function useGraphStats(api: ApiFetch | null) {
  const [stats, setStats] = useState<GraphStats>({ candidate: 0, skill: 0, project: 0, experience: 0, joblead: 0 });
  useEffect(() => {
    if (!api) return;
    const load = () => api(`/api/v1/graph`).then(r => r.json()).then(setStats).catch(() => {});
    load(); const t = setInterval(load, 10000); return () => clearInterval(t);
  }, [api]);
  return stats;
}
