import { useState } from "react";
import Icon from "../../shared/components/Icon";
import type { ApiFetch, Lead } from "../../types";

export function LeadInboxView({ port, api, onCreated }: { port: number | null; api: ApiFetch | null; onCreated: (l: Lead) => void }) {
  const kind = "job";
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scanningFree, setScanningFree] = useState(false);

  const submit = async () => {
    if (!port || !api || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api(`/api/v1/leads/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, url, text }),
      });
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || `Server returned ${r.status}`);
      }
      const lead = await r.json();
      setText("");
      setUrl("");
      onCreated(lead);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lead save failed");
    } finally {
      setBusy(false);
    }
  };

  const scanFree = async () => {
    if (!port || !api || scanningFree) return;
    setScanningFree(true);
    setErr(null);
    try {
      const r = await api(`/api/v1/free-sources/scan`, { method: "POST" });
      if (!r.ok) throw new Error(`Free source scan returned ${r.status}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Free source scan failed");
    } finally {
      setScanningFree(false);
    }
  };

  return (
    <div className="scroll" style={{ flex: 1, padding: 24, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        <div className="card" style={{ padding: 22 }}>
          <div className="eyebrow">Manual Lead Inbox</div>
          <h2 style={{ fontSize: 26, marginTop: 4 }}>Paste anything useful</h2>
          <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5, margin: "8px 0 16px" }}>
            Drop a job URL, founder post, Discord message, Reddit comment, HN lead, or client brief. The app extracts signal score and outreach drafts.
          </div>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Source URL"
            className="mono field-input"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12, marginBottom: 10 }}
          />
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={12}
            placeholder={"Paste job text here...\n\nExample: AI Engineer role posted today. Python, FastAPI, React. Remote or hybrid. Include the seniority/years if visible."}
            className="field-input"
            style={{ width: "100%", padding: "12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--card)", fontSize: 13, resize: "vertical", lineHeight: 1.55 }}
          />
          {err && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 10 }}>{err}</div>}
          <button className="btn btn-accent" onClick={submit} disabled={busy} style={{ marginTop: 12, width: "100%", justifyContent: "center", padding: "11px 16px" }}>
            <Icon name="plus" size={13} /> {busy ? "Saving..." : "Save and score lead"}
          </button>
        </div>

        <div className="col gap-4">
          <div className="card" style={{ padding: 22, background: "var(--green-soft)" }}>
            <div className="eyebrow">Free Sources</div>
            <h3 style={{ marginTop: 4, fontSize: 20 }}>Run the free scout</h3>
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 8 }}>
              Checks the configured ATS company watchlist plus GitHub issues, HN comments, and Reddit searches without paid scraping APIs.
            </div>
            <button className="btn" onClick={scanFree} disabled={scanningFree} style={{ marginTop: 14, borderColor: "var(--green)", background: "var(--card)", color: "var(--green-ink)" }}>
              <Icon name="search" size={13} /> {scanningFree ? "Scanning..." : "Scan free sources"}
            </button>
          </div>
          <div className="card" style={{ padding: 22 }}>
            <div className="eyebrow">Zero-cost playbook</div>
            <div className="col gap-2" style={{ marginTop: 10, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>
              <div><b>1.</b> Paste high-signal leads as you browse.</div>
              <div><b>2.</b> Keep 10-30 target companies in Settings.</div>
              <div><b>3.</b> Use GitHub/HN/Reddit scans for founder and dev-community demand.</div>
              <div><b>4.</b> Mark contacted leads so follow-ups appear in the dashboard.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
