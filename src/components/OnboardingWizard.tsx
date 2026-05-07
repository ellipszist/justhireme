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
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [demoDraft, setDemoDraft] = useState(DEMO_JOB_DRAFT);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const steps = ["Resume", "AI Setup", "Workspace Tour", "Demo Job"];
  const keyField: Record<string, string> = {
    openai: "openai_api_key",
    anthropic: "anthropic_key",
    gemini: "gemini_api_key",
    groq: "groq_api_key",
    deepseek: "deepseek_api_key",
    nvidia: "nvidia_api_key",
  };
  const modelField: Record<string, string> = {
    openai: "openai_model",
    anthropic: "anthropic_model",
    gemini: "gemini_model",
    groq: "groq_model",
    deepseek: "deepseek_model",
    nvidia: "nvidia_model",
  };
  const modelHints: Record<string, string[]> = {
    openai: ["gpt-4o-mini", "gpt-4o"],
    anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"],
    deepseek: ["deepseek-chat", "deepseek-reasoner"],
    nvidia: ["z-ai/glm-5.1", "meta/llama-3.1-70b-instruct"],
  };
  const providerNotes: Record<string, string> = {
    ollama: "Runs locally through your own Ollama server. Best for privacy; install models separately.",
    gemini: "Good default for fast, affordable tailoring. Uses Google's OpenAI-compatible Gemini endpoint.",
    groq: "Great for fast scouting, parsing, and drafts. Uses Groq's OpenAI-compatible endpoint.",
    openai: "Strong general default for generation and scoring if you already use OpenAI.",
    anthropic: "Strong writing and reasoning option for polished resumes and cover letters.",
    deepseek: "Useful when you want lower-cost reasoning-style evaluation.",
    nvidia: "Advanced NIM route for users with NVIDIA API access.",
  };
  const tourPages = [
    { name: "Customize", detail: "Paste a job URL or job text, analyze fit, generate a tailored resume, cover letter, and outreach drafts from one screen." },
    { name: "Dashboard", detail: "See the working snapshot: saved leads, pipeline counts, recent activity, source coverage, and what the agent has been doing." },
    { name: "Leads", detail: "Review discovered jobs, sort by fit and signal, open details, approve the ones worth applying to, and remove weak leads." },
    { name: "Job Pipeline", detail: "Track approved jobs from evaluating to applied, interviewing, accepted, or rejected so follow-up work stays organized." },
    { name: "Knowledge", detail: "Inspect the local profile graph built from your resume, projects, GitHub, portfolio, and manual context." },
    { name: "Activity", detail: "Read the event trail for scans, scoring, generation, scraping, imports, and failures when you need to debug or audit decisions." },
    { name: "Profile", detail: "Edit your candidate identity, experience, skills, education, links, and application defaults used in generated packages." },
    { name: "Add Context", detail: "Import projects, portfolio pages, GitHub data, notes, achievements, or extra resume material into the local knowledge stores." },
    { name: "Setup Guide", detail: "Reopen this wizard any time from the sidebar if you want to re-check keys, sources, pages, or the first package flow." },
  ];

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
      if (!r.ok) {
        const detail = await r.json().then(d => d.detail).catch(() => "");
        throw new Error(detail || `Resume import returned ${r.status}`);
      }
      setStep(1);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Resume import failed";
      setErr(message === "Failed to fetch" ? "Could not reach the local backend. Restart JustHireMe and try again." : message);
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
    const modelKey = modelField[provider];
    if (modelKey && model.trim()) payload[modelKey] = model.trim();
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
              Import your resume, connect AI, learn the workspace, then open the one-shot customization page with a demo job ready.
            </p>
          </div>
          {progress}
          <div style={{ background: "var(--paper-3)", border: "1px solid var(--line)", borderRadius: 8, padding: 14, color: "var(--ink-2)", fontSize: 13, lineHeight: 1.55 }}>
            <b style={{ color: "var(--ink)" }}>{steps[step]}</b>
            <div style={{ marginTop: 4 }}>
              {step === 0 && "Your profile graph starts with resume data."}
              {step === 1 && "These defaults shape scoring, generation, source selection, and generated application packages."}
              {step === 2 && "Every page is part of the same local-first workflow: find jobs, understand fit, tailor, apply, and learn from outcomes."}
              {step === 3 && "The demo opens directly in Customize with all generated outputs on one page."}
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
                  <select className="field-input" value={provider} onChange={e => { const next = e.target.value; setProvider(next); setApiKey(""); setModel(modelHints[next]?.[0] || ""); }} style={{ marginTop: 7 }}>
                    <option value="ollama">Ollama</option>
                    <option value="gemini">Gemini</option>
                    <option value="groq">Groq</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="nvidia">NVIDIA</option>
                  </select>
                </div>
              </div>
              <div style={{ background: "var(--paper-3)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)" }}>
                <b style={{ color: "var(--ink)" }}>{provider === "ollama" ? "Local mode" : provider.toUpperCase()}</b>
                <div style={{ marginTop: 4 }}>{providerNotes[provider]}</div>
              </div>
              {provider === "ollama" ? (
                <div>
                  <label className="eyebrow">Ollama URL</label>
                  <input className="field-input" value={ollamaUrl} onChange={e => setOllamaUrl(e.target.value)} style={{ marginTop: 7 }} />
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <label className="eyebrow">API key</label>
                    <input className="field-input" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Optional for now" style={{ marginTop: 7 }} />
                  </div>
                  <div>
                    <label className="eyebrow">Default model</label>
                    <select className="field-input" value={model} onChange={e => setModel(e.target.value)} style={{ marginTop: 7 }}>
                      {(modelHints[provider] || []).map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
                {tourPages.map(page => (
                  <div key={page.name} style={{ border: "1px solid var(--line)", borderRadius: 8, background: "var(--paper)", padding: 12 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{page.name}</div>
                    <div style={{ color: "var(--ink-2)", fontSize: 12, lineHeight: 1.45, marginTop: 5 }}>{page.detail}</div>
                  </div>
                ))}
              </div>
              <button className="btn btn-accent" onClick={() => setStep(3)} style={{ justifyContent: "center", padding: "12px 16px" }}>
                <Icon name="arrow-right" size={14} color="#fff" /> Continue
              </button>
            </div>
          )}

          {step === 3 && (
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
