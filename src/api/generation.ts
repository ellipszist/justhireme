import type { ApiFetch } from "./types";

export const generationApi = {
  generate: (api: ApiFetch, jobId: string, template = "") => api(`/api/v1/leads/${encodeURIComponent(jobId)}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template }),
  }),
  getTemplate: (api: ApiFetch) => api("/api/v1/template"),
  saveTemplate: (api: ApiFetch, template: string) => api("/api/v1/template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template }),
  }),
};
