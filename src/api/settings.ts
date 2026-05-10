import type { ApiFetch } from "./types";

export const settingsApi = {
  get: (api: ApiFetch) => api("/api/v1/settings"),
  save: (api: ApiFetch, settings: Record<string, unknown>) => api("/api/v1/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }),
  validate: (api: ApiFetch, settings: Record<string, unknown>) => api("/api/v1/settings/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }),
};
