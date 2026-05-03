import { useState } from "react";
import { motion } from "framer-motion";
import Icon from "./Icon";
import type { ApiFetch } from "../types";
import { DEMO_JOB_DRAFT } from "../lib/leadUtils";

export function OnboardingWizard({ api, onFinish, onOpenSettings }: { api: ApiFetch; onFinish: (draft: string) => void; onOpenSettings: () => void }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [rawResume, setRawResume] = useState("");
  const [role, setRole] = useState("Applied AI Engineer");
  const [market, setMarket] = useState("remote");
  const [provider, setProvider] = useState("ollama");
  const [apiKey, setApiKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [demoDraft, setDemoDraft] = useState(DEMO_JOB_DRAFT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const steps = ["Resume", "Preferences", "Demo Job"];
  const keyField: Record<string, string> = {
    openai: "openai_api_key",
    anthropic: "anthropic_key",
    groq: "groq_api_key",
    deepseek: "deepseek_api_key",
    nvidia: "nvidia_api_key",
  };

  const saveResume = async () => {
    if (!file && !rawResume.trim()) {
      setErr("Upload a resume file or paste resume text.");
      return;
    }
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    if (file) fd.append("file", file);
    else fd.append("raw", rawResume.trim());
    try {
      const r = await api(`/api/v1/ingest`, { method: "POST", body: fd });
      if (!r.ok) throw new Error(`Resume import returned ${r.status}`);
      setStep(1);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Resume import failed");
    } finally {
      setBusy(false);
    }
  };

  const savePreferences = async () => {
    setBusy(true);
    setErr(null);
    const payload: Record<string, any> = {
      job_market_focus: market,
      llm_provider: provider,
      onboarding_target_role: role,
      free_sources_enabled: true,
    };
    if (provider === "ollama") payload.ollama_url = ollamaUrl;
    const field = keyField[provider];
    if (field && apiKey.trim()) payload[field] = apiKey.trim();
    try {
      const r = await api(`/api/v1/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`Preferences returned ${r.status}`);
      setStep(2);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Preferences failed to save");
    } finally {
      setBusy(false);
    }
  };

  const progress = (
    <div className="row gap-2" style={{ flexWrap: "wrap" }}>
      {steps.map((label, idx) => (
        <button
          key={label}
          className="btn btn-ghost"
          onClick={() => idx <= step && setStep(idx)}
          style={{
            borderColor: idx === step ? "var(--accent)" : idx < step ? "var(--green)" : "var(--line)",
            background: idx === step ? "var(--accent-soft)" : idx < step ? "var(--green-soft)" : "var(--paper-3)",
            color: idx === step ? "var(--ink)" : idx < step ? "var(--green-ink)" : "var(--ink-3)",
            fontSize: 12,
            minHeight: 34,
          }}
        >
          {idx < step ? <Icon name="check" size={13} /> : <span className="mono">{idx + 1}</span>} {label}
        </button>
      ))}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(244,239,230,0.94)", display: "grid", placeItems: "center", padding: 22 }}
    >
      <motion.section
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 10, opacity: 0 }}
        className="card"
        style={{ width: "min(960px, 100%)", maxHeight: "min(760px, 94vh)", overflow: "auto", padding: 24, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22 }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div className="eyebrow">First Run</div>
            <h2 style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>Get to your first package</h2>
            <p style={{ color: "var(--ink-2)", fontSize: 13.5, lineHeight: 1.55, marginTop: 8 }}>
              Import your resume, set the basics, then open the one-shot Apply page with a demo job ready.
            </p>
          </div>
          {progress}
          <div style={{ background: "var(--paper-3)", border: "1px solid var(--line)", borderRadius: 8, padding: 14, color: "var(--ink-2)", fontSize: 13, lineHeight: 1.55 }}>
            <b style={{ color: "var(--ink)" }}>{steps[step]}</b>
            <div style={{ marginTop: 4 }}>
              {step === 0 && "Your profile graph starts with resume data."}
              {step === 1 && "These defaults shape scoring, generation, and source selection."}
              {step === 2 && "The demo opens directly in Apply with all generated outputs on one page."}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={() => onFinish(DEMO_JOB_DRAFT)} style={{ alignSelf: "flex-start" }}>
            Skip setup
          </button>
        </div>

        <div style={{ minWidth: 0 }}>
          {err && <div style={{ color: "var(--bad)", background: "var(--bad-soft)", border: "1px solid var(--bad)", borderRadius: 8, padding: "9px 11px", fontSize: 12, marginBottom: 12 }}>{err}</div>}

          {step === 0 && (
            <div className="col gap-4">
              <label className="card" style={{ padding: 18, cursor: "pointer", borderStyle: "dashed", background: "var(--paper)" }}>
                <input type="file" accept=".pdf,.doc,.docx,.txt,.md" style={{ display: "none" }} onChange={e => setFile(e.target.files?.[0] || null)} />
                <div className="row gap-3">
                  <Icon name="upload" size={20} />
                  <div>
                    <div style={{ fontWeight: 800 }}>{file ? file.name : "Upload resume"}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>PDF, DOCX, TXT, or Markdown</div>
                  </div>
                </div>
              </label>
              <textarea
                className="field-input"
                value={rawResume}
                onChange={e => setRawResume(e.target.value)}
                placeholder="Or paste resume text"
                rows={8}
                style={{ lineHeight: 1.55, resize: "vertical" }}
              />
              <button className="btn btn-accent" onClick={saveResume} disabled={busy} style={{ justifyContent: "center", padding: "12px 16px" }}>
                <Icon name="arrow-right" size={14} color="#fff" /> {busy ? "Importing..." : "Continue"}
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="col gap-4">
              <div>
                <label className="eyebrow">Target role</label>
                <input className="field-input" value={role} onChange={e => setRole(e.target.value)} style={{ marginTop: 7 }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="eyebrow">Market</label>
                  <select className="field-input" value={market} onChange={e => setMarket(e.target.value)} style={{ marginTop: 7 }}>
                    <option value="remote">Remote first</option>
                    <option value="india">India</option>
                    <option value="us">United States</option>
                    <option value="global">Global</option>
                  </select>
                </div>
                <div>
                  <label className="eyebrow">LLM Provider</label>
                  <select className="field-input" value={provider} onChange={e => setProvider(e.target.value)} style={{ marginTop: 7 }}>
                    <option value="ollama">Ollama</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="groq">Groq</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="nvidia">NVIDIA</option>
                  </select>
                </div>
              </div>
              {provider === "ollama" ? (
                <div>
                  <label className="eyebrow">Ollama URL</label>
                  <input className="field-input" value={ollamaUrl} onChange={e => setOllamaUrl(e.target.value)} style={{ marginTop: 7 }} />
                </div>
              ) : (
                <div>
                  <label className="eyebrow">API key</label>
                  <input className="field-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Optional for now" style={{ marginTop: 7 }} />
                </div>
              )}
              <div className="row gap-2" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <button className="btn" onClick={onOpenSettings}><Icon name="settings" size={13} /> Advanced settings</button>
                <button className="btn btn-accent" onClick={savePreferences} disabled={busy || !role.trim()} style={{ minWidth: 170, justifyContent: "center" }}>
                  <Icon name="arrow-right" size={14} color="#fff" /> {busy ? "Saving..." : "Continue"}
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="col gap-4">
              <div>
                <label className="eyebrow">Demo job URL</label>
                <textarea className="field-input" value={demoDraft} onChange={e => setDemoDraft(e.target.value)} rows={12} style={{ marginTop: 7, lineHeight: 1.55, resize: "vertical" }} />
              </div>
              <button className="btn btn-accent" onClick={() => onFinish(demoDraft)} style={{ justifyContent: "center", padding: "12px 16px" }}>
                <Icon name="spark" size={14} color="#fff" /> Try it on a job
              </button>
            </div>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}
