import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { ConnSt, Lead, LogLine } from "../types";

export function useWS() {
  const [conn, setConn] = useState<ConnSt>("disconnected");
  const [port, setPort] = useState<number | null>(null);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [sidecarError, setSidecarError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [beat, setBeat] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const idRef = useRef(0);

  const addLog = useCallback((msg: string, kind: LogLine["kind"], src = "sys") => {
    setLogs(p => [
      { id: idRef.current++, ts: String(idRef.current).padStart(4, "0"), msg, src, kind },
      ...p.slice(0, 149),
    ]);
  }, []);

  const connect = useCallback((p: number, token: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setConn("connecting");
    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.onopen    = () => { setConn("connected"); addLog("WebSocket connected", "system", "ws"); };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === "heartbeat") {
          setBeat(d.beat);
          if (d.beat % 10 === 1)
            addLog(`Heartbeat #${d.beat} — uptime ${d.uptime_seconds.toFixed(0)}s`, "heartbeat", "hb");
        } else if (d.type === "agent") {
          addLog(d.msg ?? d.event, "agent", d.event ?? "agent");
          if (d.event === "eval_done") window.dispatchEvent(new CustomEvent("scan-done"));
          if (d.event === "reeval_done") {
            window.dispatchEvent(new CustomEvent("reevaluate-done"));
            window.dispatchEvent(new CustomEvent("leads-refresh"));
          }
          if (d.event === "cleanup_done") {
            window.dispatchEvent(new CustomEvent("cleanup-done"));
            window.dispatchEvent(new CustomEvent("leads-refresh"));
          }
          if (d.event === "auto_discard_done") window.dispatchEvent(new CustomEvent("leads-refresh"));
        } else if (d.type === "LEAD_UPDATED" && d.data) {
          window.dispatchEvent(new CustomEvent("lead-updated", { detail: d.data }));
        } else if (d.type === "HOT_X_LEAD" && d.data) {
          window.dispatchEvent(new CustomEvent("hot-x-lead", { detail: d.data }));
          if ("Notification" in window && Notification.permission === "granted") {
            const lead = d.data as Lead;
            new Notification("Hot X lead", { body: `${lead.company}: ${lead.title}` });
          }
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => { setConn("disconnected"); wsRef.current = null; setTimeout(() => connect(p, token), 3000); };
    ws.onerror = () => ws.close();
  }, [addLog]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    let poll: number | undefined;
    (async () => {
      let token: string | null = null;
      let currentPort: number | null = null;
      const syncSidecar = async () => {
        try {
          const err = await invoke<string>("get_sidecar_error");
          setSidecarError(err);
        } catch { /* no sidecar error */ }
        try {
          token = await invoke<string>("get_api_token");
          setApiToken(token);
        } catch { /* not ready */ }
        try {
          const p = await invoke<number>("get_sidecar_port");
          currentPort = p;
          setPort(p);
        } catch { /* not ready */ }
        if (token && currentPort) connect(currentPort, token);
      };
      await syncSidecar();
      poll = window.setInterval(() => {
        if (!cancelled && (!token || !currentPort)) void syncSidecar();
      }, 1000);
      try {
        unlisten = await listen<number>("sidecar-port", ev => {
          currentPort = ev.payload;
          setPort(ev.payload);
          if (token) connect(ev.payload, token);
        });
        const unlistenToken = await listen<string>("sidecar-token", ev => {
          token = ev.payload;
          setApiToken(ev.payload);
          if (currentPort) connect(currentPort, ev.payload);
        });
        const unlistenError = await listen<string>("sidecar-error", ev => {
          setSidecarError(ev.payload);
          addLog(ev.payload, "system", "sidecar");
        });
        const prevUnlisten = unlisten;
        unlisten = () => { prevUnlisten?.(); unlistenToken(); unlistenError(); };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSidecarError(`Desktop event bridge unavailable: ${message}`);
        addLog(`Desktop event bridge unavailable: ${message}`, "system", "sidecar");
      }
    })();
    return () => {
      cancelled = true;
      if (poll !== undefined) window.clearInterval(poll);
      unlisten?.();
      wsRef.current?.close();
    };
  }, [connect]);

  return { conn, port, apiToken, sidecarError, logs, beat, addLog };
}
