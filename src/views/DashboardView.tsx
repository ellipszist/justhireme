import Icon from "../components/Icon";
import type { Lead, LogLine, View } from "../types";
import { StatCard } from "../components/Topbar";
import { getMark, getTone } from "../lib/leadUtils";

export function DashboardView({
  leads, dueFollowups, logs, setView, openDrawer,
  scanning, reevaluating, cleaning, onScan, onStopScan, onReevaluate, onStopReevaluate, onCleanup, scanErr,
}: {
  leads: Lead[]; dueFollowups: Lead[]; logs: LogLine[]; setView: (v: View) => void; openDrawer: (l: Lead) => void;
  scanning: boolean; reevaluating: boolean; cleaning: boolean;
  onScan: () => void; onStopScan: () => void; onReevaluate: () => void; onStopReevaluate: () => void; onCleanup: () => void; scanErr: string | null;
}) {
  const counts = {
    total:      leads.length,
    discovered: leads.filter(l=>l.status==="discovered").length,
    evaluated:  leads.filter(l=>l.score > 0).length,
    tailoring:  leads.filter(l=>l.status==="tailoring").length,
    approved:   leads.filter(l=>l.status==="approved").length,
    applied:    leads.filter(l=>l.status==="applied").length,
  };
  const topMatches = [...leads].filter(l => l.score > 0).sort((a,b) => b.score - a.score).slice(0, 4);
  const dailyHot = [...leads]
    .filter(l => l.status !== "discarded")
    .sort((a, b) => Math.max(b.signal_score || 0, b.score || 0) - Math.max(a.signal_score || 0, a.score || 0))
    .slice(0, 6);

  return (
    <div className="scroll" style={{ padding: 24, flex: 1, height: "100%", minHeight: 0 }}>
      <div className="card" style={{ padding: "26px 28px", marginBottom: 18, background: "linear-gradient(135deg, var(--orange-soft) 0%, var(--pink-soft) 60%, var(--purple-soft) 100%)" }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
          <div className="col gap-3" style={{ maxWidth: 560 }}>
            <span className="eyebrow">Agent Online</span>
            <h1 style={{ fontSize: 52 }}>The hunt is <span className="italic-serif" style={{ color: "var(--ink-2)" }}>on.</span></h1>
            <div style={{ fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.55, maxWidth: 480 }}>
              Scanned <b>{leads.length} job leads</b>, evaluated <b>{counts.evaluated}</b> with scores, tailored <b>{counts.tailoring + counts.approved} resumes</b>.
            </div>
            <div className="row gap-2" style={{ marginTop: 6 }}>
              <button onClick={onScan} disabled={scanning || reevaluating || cleaning} style={{
                padding: "10px 22px", borderRadius: 12, fontSize: 12, fontWeight: 700,
                letterSpacing: "0.12em", textTransform: "uppercase", cursor: scanning ? "wait" : reevaluating || cleaning ? "not-allowed" : "pointer",
                background: scanning || reevaluating || cleaning ? "var(--ink-4)" : "var(--ink)",
                color: "var(--paper)", border: "1px solid var(--ink-3)",
                opacity: (reevaluating || cleaning) && !scanning ? 0.72 : 1,
                transition: "all .2s ease", display: "flex", alignItems: "center", gap: 8,
              }}>
                {scanning ? <><span className="dot pulse-soft" /> SCAN IN PROGRESS...</> : <><Icon name="spark" size={13} /> INITIATE AUTONOMOUS SCAN</>}
              </button>
              {scanning && (
                <button onClick={onStopScan} style={{
                  padding: "10px 18px", borderRadius: 12, fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer",
                  background: "var(--bad-soft)", color: "var(--bad)", border: "1px solid var(--bad)",
                  transition: "all .2s ease", display: "flex", alignItems: "center", gap: 7,
                }}>
                  <Icon name="x" size={13} color="var(--bad)" /> STOP SCAN
                </button>
              )}
              {reevaluating ? (
                <button onClick={onStopReevaluate} style={{
                  padding: "10px 18px", borderRadius: 12, fontSize: 12, fontWeight: 700,
                  letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer",
                  background: "var(--bad-soft)", color: "var(--bad)", border: "1px solid var(--bad)",
                  transition: "all .2s ease", display: "flex", alignItems: "center", gap: 7,
                }}>
                  <Icon name="x" size={13} color="var(--bad)" /> STOP RE-EVAL
                </button>
              ) : (
                <button onClick={onReevaluate} disabled={scanning || leads.length === 0} className="btn" style={{
                  opacity: scanning || leads.length === 0 ? 0.58 : 1,
                  cursor: scanning || leads.length === 0 ? "not-allowed" : "pointer",
                }}>
                  <Icon name="pulse" size={13} /> Re-evaluate jobs
                </button>
              )}
              <button onClick={onCleanup} disabled={scanning || reevaluating || cleaning || leads.length === 0} className="btn" style={{
                opacity: scanning || reevaluating || cleaning || leads.length === 0 ? 0.58 : 1,
                cursor: cleaning ? "wait" : scanning || reevaluating || leads.length === 0 ? "not-allowed" : "pointer",
              }}>
                <Icon name="trash" size={13} /> {cleaning ? "Cleaning..." : "Clean bad data"}
              </button>
              <button className="btn btn-accent" onClick={() => setView("pipeline")}>Open pipeline <Icon name="arrow-right" size={13} /></button>
              <button className="btn" onClick={() => setView("inbox")}><Icon name="plus" size={13} /> Paste lead</button>
              <button className="btn" onClick={() => setView("activity")}><Icon name="pulse" size={13} /> Live activity</button>
            </div>
            {scanErr && <div style={{ marginTop: 6, fontSize: 12, color: "var(--bad)", fontWeight: 500 }}>⚠ {scanErr}</div>}
          </div>
          <div className="col gap-2" style={{ width: 300 }}>
            <div className="eyebrow" style={{ marginBottom: 2 }}>Top matches awaiting review</div>
            {topMatches.length === 0 ? (
              <div className="card-flat" style={{ padding: 14, fontSize: 12, color: "var(--ink-3)" }}>Run a scan to find matches.</div>
            ) : topMatches.map(l => (
              <div key={l.job_id} onClick={() => openDrawer(l)} className="lift" style={{
                background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12,
                padding: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: `var(--${getTone(l.status)})`, color: `var(--${getTone(l.status)}-ink)`,
                  display: "grid", placeItems: "center",
                  fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500,
                  border: `1px solid var(--${getTone(l.status)}-ink)`,
                }}>{getMark(l.company)}</div>
                <div className="col" style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.title}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{l.company}</div>
                </div>
                <span style={{
                  fontSize: 12, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                  background: l.score >= 85 ? "var(--green)" : l.score >= 50 ? "var(--yellow)" : "var(--bad-soft)",
                  color: l.score >= 85 ? "var(--green-ink)" : l.score >= 50 ? "var(--yellow-ink)" : "var(--bad)",
                }}>{l.score}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
        <StatCard tone="blue"   label="Leads found"      value={counts.discovered} sub="Awaiting eval"   icon="layers" />
        <StatCard tone="yellow" label="Evaluated"         value={counts.evaluated}  sub="Non-zero scores" icon="spark"  />
        <StatCard tone="purple" label="Resumes tailored"  value={counts.tailoring}  sub="PDFs cached"     icon="file"   />
        <StatCard tone="green"  label="Awaiting approval" value={counts.approved}   sub="Ready to fire"   icon="check"  />
        <StatCard tone="orange" label="Applications sent" value={counts.applied}    sub="Success"         icon="arrow-up" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginBottom: 18 }}>
        <div className="card" style={{ padding: 18 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3>Daily hot leads</h3>
            <button className="btn btn-ghost" onClick={() => setView("pipeline")} style={{ fontSize: 12 }}>Pipeline <Icon name="arrow-right" size={12} /></button>
          </div>
          <div className="col gap-2">
            {dailyHot.length === 0 ? (
              <div className="card-flat" style={{ padding: 14, color: "var(--ink-3)", fontSize: 12 }}>No hot leads yet.</div>
            ) : dailyHot.map(lead => {
              const signal = Math.max(lead.signal_score || 0, lead.score || 0);
              const nextAction = lead.last_contacted_at
                ? "Follow up"
                : "Send fit email";
              return (
                <div key={lead.job_id} onClick={() => openDrawer(lead)} className="lift" style={{ padding: 12, borderRadius: 12, border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer", display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.learning_reason || lead.signal_reason || lead.reason || nextAction}</div>
                    <div className="row gap-2" style={{ marginTop: 4, flexWrap: "wrap" }}>
                      <span className="pill mono" style={{ fontSize: 9 }}>{lead.platform}</span>
                      <span className="pill mono" style={{ fontSize: 9 }}>{lead.kind || "job"}</span>
                      <span className="pill mono" style={{ fontSize: 9, background: "var(--blue-soft)", color: "var(--blue-ink)" }}>{nextAction}</span>
                      {!!lead.learning_delta && <span className="pill mono" style={{ fontSize: 9, background: lead.learning_delta > 0 ? "var(--green-soft)" : "var(--bad-soft)", color: lead.learning_delta > 0 ? "var(--green-ink)" : "var(--bad)" }}>learn {lead.learning_delta > 0 ? "+" : ""}{lead.learning_delta}</span>}
                      {lead.budget && <span className="pill mono" style={{ fontSize: 9, background: "var(--green-soft)", color: "var(--green-ink)" }}>{lead.budget}</span>}
                    </div>
                  </div>
                  <span className="mono" style={{ alignSelf: "center", fontSize: 13, fontWeight: 800, color: signal >= 80 ? "var(--orange-ink)" : "var(--ink-3)" }}>{signal}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card" style={{ padding: 18, background: "var(--green-soft)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h3>Follow-ups due</h3>
            <span className="pill mono" style={{ background: "var(--green)", color: "var(--green-ink)" }}>{dueFollowups.length}</span>
          </div>
          <div className="col gap-2">
            {dueFollowups.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.45 }}>No follow-ups due right now.</div>
            ) : dueFollowups.slice(0, 5).map(lead => (
              <div key={lead.job_id} onClick={() => openDrawer(lead)} className="lift" style={{ padding: 10, borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.title}</div>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 3 }}>{lead.company}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18, background: "var(--yellow-soft)" }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h3>Recent agent events</h3>
          <button className="btn btn-ghost" onClick={() => setView("activity")} style={{ fontSize: 12 }}>See all <Icon name="arrow-right" size={12} /></button>
        </div>
        <div className="col gap-1" style={{ fontSize: 12 }}>
          {logs.slice(0, 6).map((ln, i) => {
            const tone = ln.kind === "heartbeat" ? "blue" : ln.kind === "agent" ? "green" : "yellow";
            return (
              <div key={ln.id} className="row gap-3" style={{ padding: "7px 10px", borderRadius: 8, background: i === 0 ? "var(--card)" : "transparent" }}>
                <span className="mono tabular" style={{ fontSize: 10, color: "var(--ink-3)", minWidth: 50 }}>{ln.ts}</span>
                <span className="mono" style={{ fontSize: 9.5, fontWeight: 600, padding: "1px 6px", borderRadius: 3, background: `var(--${tone})`, color: `var(--${tone}-ink)`, textTransform: "uppercase", letterSpacing: "0.08em" }}>{ln.kind}</span>
                <span style={{ fontSize: 12, flex: 1, color: "var(--ink-2)" }}>{ln.msg}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   JOB CARD (shared across tabs)
══════════════════════════════════════ */
