import type { ApiFetch } from "./types";

export const discoveryApi = {
  scan: (api: ApiFetch) => api("/api/v1/scan", { method: "POST" }),
  stopScan: (api: ApiFetch) => api("/api/v1/scan/stop", { method: "POST" }),
  freeSources: (api: ApiFetch) => api("/api/v1/free-sources/scan", { method: "POST" }),
};
