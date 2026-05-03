import { useState } from "react";
import type { LogLine } from "../types";

export function ActivityView({ logs }: { logs: LogLine[] }) {
  const [actTab, setActTab] = useState<"all"|"scout"|"eval"|"apply"|"system">("all");
  return (
    <div className="scroll" style={{ padding: 24, flex: 1, height: "100%", minHeight: 0 }}>
      <div style={{display:"flex", gap:6, marginBottom:16, flexWrap:"wrap"}}>
        {(["all","scout","eval","apply","system"] as const).map(tab => (
          <button key={tab} onClick={() => setActTab(tab)} style={{
            padding:"5px 14px", borderRadius:999, fontSize:11, fontWeight:700,
            letterSpacing:"0.1em", textTransform:"uppercase", cursor:"pointer",
            border: actTab === tab ? "none" : "1px solid var(--line)",
            background: actTab === tab ? "var(--ink)" : "var(--paper)",
            color: actTab === tab ? "var(--card)" : "var(--ink-3)",
            transition:"all 0.15s ease",
          }}>
            {tab === "all" ? "All" : tab === "scout" ? "Scout" : tab === "eval" ? "Eval" : tab === "apply" ? "Apply" : "System"}
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: "26px 28px", marginBottom: 18, background: "var(--orange-soft)" }}>
        <span className="eyebrow">Real-time stream</span>
        <h1 style={{ fontSize: 44 }}>What is the agent <span className="italic-serif">thinking?</span></h1>
      </div>
      <div className="card" style={{ padding: 18, background: "var(--purple-soft)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3>Stream</h3>
          <span className="pill" style={{ background: "var(--green)", color: "var(--green-ink)" }}>
            <span className="dot pulse-soft" /> live
          </span>
        </div>
        <div style={{ height: 440, display: "flex" }}>
          <div className="scroll terminal" style={{ background: "#1F1A14", color: "#EFE7D6", borderRadius: 12, padding: "14px 16px", flex: 1 }}>
            {logs.filter(l => {
              if (actTab === "all") return l.kind !== "heartbeat";
              if (actTab === "scout") return l.src === "scout" || (l.kind === "agent" && l.msg.toLowerCase().includes("scout"));
              if (actTab === "eval")  return l.src === "eval"  || (l.kind === "agent" && (l.msg.toLowerCase().includes("eval") || l.msg.toLowerCase().includes("scor")));
              if (actTab === "apply") return l.src === "apply" || (l.kind === "agent" && (l.msg.toLowerCase().includes("apply") || l.msg.toLowerCase().includes("fire") || l.msg.toLowerCase().includes("generat")));
              if (actTab === "system") return l.kind === "system";
              return true;
            }).map((ln) => {
              const tone = ln.kind === "heartbeat" ? "blue" : ln.kind === "agent" ? "green" : "yellow";
              return (
                <div key={ln.id} className="row gap-3" style={{ marginBottom: 5, alignItems: "baseline" }}>
                  <span className="mono tabular" style={{ color: "#7A6F62", fontSize: 10.5, minWidth: 50 }}>{ln.ts}</span>
                  <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", padding: "1px 6px", borderRadius: 4, background: `var(--${tone})`, color: `var(--${tone}-ink)`, minWidth: 42, textAlign: "center" }}>{ln.kind}</span>
                  <span style={{ color: "#B5AC9D", fontSize: 11 }}>{ln.src}</span>
                  <span style={{ flex: 1 }}>{ln.msg}</span>
                </div>
              );
            })}
            <div className="row gap-2" style={{ marginTop: 4 }}>
              <span style={{ color: "var(--accent)" }}>›</span>
              <span className="blink">▌</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   PROFILE VIEW
══════════════════════════════════════ */
