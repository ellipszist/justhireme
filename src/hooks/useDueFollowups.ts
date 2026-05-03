import { useEffect, useState } from "react";
import type { ApiFetch, Lead } from "../types";

export function useDueFollowups(api: ApiFetch | null) {
  const [leads, setLeads] = useState<Lead[]>([]);
  useEffect(() => {
    if (!api) return;
    const load = () => api(`/api/v1/followups/due?limit=25`)
      .then(r => r.json())
      .then(setLeads)
      .catch(() => {});
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [api]);
  return leads;
}
