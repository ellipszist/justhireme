import type { ApiFetch } from "./types";

export function createApiFetch(port: number, token: string): ApiFetch {
  return (path, opts) => {
    const headers = new Headers(opts?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeoutId = window.setTimeout(() => controller.abort(), 30000);
    if (opts?.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", abort, { once: true });
    }
    return fetch(`http://127.0.0.1:${port}${path}`, { ...opts, headers, signal: controller.signal })
      .finally(() => {
        window.clearTimeout(timeoutId);
        opts?.signal?.removeEventListener("abort", abort);
      });
  };
}
