import { useEffect, useState } from "react";
import Icon from "./components/Icon";

interface Props { port: number; onClose: () => void; }

interface Cfg {
  llm_provider: string;
  anthropic_key: string; openai_api_key: string; openai_model: string;
  deepseek_api_key: string; groq_api_key: string; nvidia_api_key: string;
  nvidia_model: string; ollama_url: string;
  scout_provider: string;     scout_api_key: string;     scout_model: string;
  evaluator_provider: string; evaluator_api_key: string; evaluator_model: string;
  generator_provider: string; generator_api_key: string; generator_model: string;
  ingestor_provider: string;  ingestor_api_key: string;  ingestor_model: string;
  actuator_provider: string;  actuator_api_key: string;  actuator_model: string;
  apify_token: string; apify_actor: string; linkedin_cookie: string; x_bearer_token: string; x_search_queries: string; x_watchlist: string;
  x_max_requests_per_scan: string; x_max_results_per_query: string; x_min_signal_score: string; x_hot_lead_threshold: string; x_enable_notifications: string;
  free_sources_enabled: string; free_source_targets: string; company_watchlist: string; free_source_max_requests: string; free_source_min_signal_score: string;
  job_boards: string;
  ghost_mode: string; auto_apply: string; headed_browser: string;
}

const EMPTY: Cfg = {
  llm_provider: "ollama",
  anthropic_key: "", openai_api_key: "", openai_model: "gpt-4o-mini",
  deepseek_api_key: "", groq_api_key: "", nvidia_api_key: "",
  nvidia_model: "z-ai/glm-5.1", ollama_url: "http://localhost:11434/v1",
  scout_provider: "", scout_api_key: "", scout_model: "",
  evaluator_provider: "", evaluator_api_key: "", evaluator_model: "",
  generator_provider: "", generator_api_key: "", generator_model: "",
  ingestor_provider: "", ingestor_api_key: "", ingestor_model: "",
  actuator_provider: "", actuator_api_key: "", actuator_model: "",
  apify_token: "", apify_actor: "", linkedin_cookie: "", x_bearer_token: "", x_search_queries: "", x_watchlist: "",
  x_max_requests_per_scan: "5", x_max_results_per_query: "50", x_min_signal_score: "55", x_hot_lead_threshold: "80", x_enable_notifications: "false",
  free_sources_enabled: "false", free_source_targets: "", company_watchlist: "", free_source_max_requests: "20", free_source_min_signal_score: "45",
  job_boards: "",
  ghost_mode: "false", auto_apply: "false", headed_browser: "false",
};

const PROVIDERS = [
  { id: "deepseek",  label: "DeepSeek",  tone: "teal",   sub: "V3 / R1"   },
  { id: "nvidia",    label: "NVIDIA",    tone: "green",  sub: "GLM / NIM" },
  { id: "groq",      label: "Groq",      tone: "orange", sub: "Llama 3.3" },
  { id: "openai",    label: "OpenAI",    tone: "blue",   sub: "GPT-4o"    },
  { id: "anthropic", label: "Anthropic", tone: "purple", sub: "Claude"    },
  { id: "ollama",    label: "Ollama",    tone: "pink",   sub: "Local"     },
];

const MODEL_HINTS: Record<string, string[]> = {
  deepseek:  ["deepseek-chat", "deepseek-reasoner"],
  nvidia:    ["z-ai/glm-5.1", "meta/llama-3.1-70b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1"],
  groq:      ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  openai:    ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6"],
  ollama:    ["llama3", "mistral", "gemma2", "codellama"],
};

const STEPS = [
  { id: "scout",     label: "Scout",     icon: "search", tone: "blue",
    desc: "Discovers job listings — a fast cheap model is ideal here" },
  { id: "evaluator", label: "Evaluator", icon: "pulse",  tone: "purple",
    desc: "Scores job fit — use a reasoning model (DeepSeek R1) for best results" },
  { id: "generator", label: "Generator", icon: "file",   tone: "orange",
    desc: "Writes tailored resumes + cover letters — quality matters here" },
  { id: "ingestor",  label: "Ingestor",  icon: "upload", tone: "green",
    desc: "Parses your resume into the knowledge graph" },
  { id: "actuator",  label: "Actuator",  icon: "ghost",  tone: "pink",
    desc: "Vision-based form filler — needs a model with image support" },
];

const _KEY_FIELD: Record<string, keyof Cfg> = {
  anthropic: "anthropic_key", groq: "groq_api_key",
  nvidia: "nvidia_api_key", openai: "openai_api_key", deepseek: "deepseek_api_key",
};

/* helpers */
function LabelledField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SectionLabel({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
      {sub && <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{sub}</span>}
    </div>
  );
}

function ProviderPills({ value, onChange, small }: { value: string; onChange: (v: string) => void; small?: boolean }) {
  return (
    <div style={{ display: "flex", gap: small ? 5 : 7, flexWrap: "wrap" }}>
      {PROVIDERS.map(p => {
        const active = value === p.id;
        return (
          <button key={p.id} onClick={() => onChange(p.id)} style={{
            padding: small ? "5px 10px" : "10px 12px", borderRadius: small ? 8 : 11, cursor: "pointer",
            background: active ? `var(--${p.tone}-soft)` : "var(--card)",
            border: `1.5px solid ${active ? `var(--${p.tone})` : "var(--line)"}`,
            display: "flex", flexDirection: "column", alignItems: "center",
            gap: small ? 2 : 5, transition: "all .15s ease", minWidth: small ? 0 : 78,
          }}>
            <div style={{ fontSize: small ? 12 : 13, fontWeight: 600, color: active ? `var(--${p.tone}-ink)` : "var(--ink-2)" }}>
              {p.label}
            </div>
            {!small && <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--ink-3)" }}>{p.sub}</div>}
          </button>
        );
      })}
    </div>
  );
}

function ModelChips({ provider, value, onChange }: { provider: string; value: string; onChange: (v: string) => void }) {
  const hints = MODEL_HINTS[provider] || [];
  const placeholder = hints[0] || "model-id";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {hints.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {hints.map(m => (
            <button key={m} onClick={() => onChange(m)} style={{
              padding: "3px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
              fontFamily: "var(--font-mono)",
              background: value === m ? "var(--ink)" : "var(--paper-3)",
              color: value === m ? "var(--paper)" : "var(--ink-3)",
              border: "1px solid var(--line)", transition: "all .12s ease",
            }}>{m}</button>
          ))}
        </div>
      )}
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        placeholder={`custom model — e.g. ${placeholder}`}
        className="mono field-input"
        style={{ width: "100%", padding: "8px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }}
      />
    </div>
  );
}

function ApiKeyInput({ value, onChange, provider, isStep, disabled = false, placeholder }: {
  value: string; onChange: (v: string) => void; provider: string; isStep?: boolean; disabled?: boolean; placeholder?: string;
}) {
  if (provider === "ollama") return null;
  const ph: Record<string, string> = { anthropic: "sk-ant-••••", groq: "gsk_••••", nvidia: "nvapi-••••", openai: "sk-••••", deepseek: "sk-••••" };
  return (
    <input type="password" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      placeholder={placeholder || (isStep ? `API key for ${provider}` : ph[provider] || "API key")}
      className="mono field-input"
      style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: disabled ? "var(--paper-3)" : "var(--card)", fontSize: 12, opacity: disabled ? 0.75 : 1, cursor: disabled ? "not-allowed" : "text" }}
    />
  );
}

function StepCard({ step, cfg, onChange }: { step: typeof STEPS[0]; cfg: Cfg; onChange: (k: keyof Cfg, v: string) => void }) {
  const provKey  = `${step.id}_provider` as keyof Cfg;
  const apiKey   = `${step.id}_api_key`  as keyof Cfg;
  const modelKey = `${step.id}_model`    as keyof Cfg;
  const isCustom = !!(cfg[provKey] as string);
  const stepProv = (cfg[provKey] as string) || cfg.llm_provider || "ollama";
  const [forceStepKey, setForceStepKey] = useState(false);
  const usesGlobalKey = stepProv !== "ollama" && !forceStepKey && !(cfg[apiKey] as string);
  const keySourceLabel = stepProv === cfg.llm_provider
    ? `Use global ${stepProv} API key`
    : `Use saved ${stepProv} API key`;
  const enable  = () => { setForceStepKey(false); onChange(provKey, cfg.llm_provider || "ollama"); };
  const disable = () => { setForceStepKey(false); onChange(provKey, ""); onChange(apiKey, ""); onChange(modelKey, ""); };

  return (
    <div style={{ padding: 14, borderRadius: 14, background: isCustom ? "var(--card)" : "var(--paper-2)", border: `1.5px solid ${isCustom ? `var(--${step.tone})` : "var(--line)"}`, transition: "all .15s ease" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: isCustom ? 14 : 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, background: isCustom ? `var(--${step.tone}-soft)` : "var(--paper-3)", color: isCustom ? `var(--${step.tone}-ink)` : "var(--ink-3)", display: "grid", placeItems: "center" }}>
              <Icon name={step.icon} size={13} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{step.label}</span>
            {isCustom && (
              <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", background: `var(--${step.tone}-soft)`, color: `var(--${step.tone}-ink)`, padding: "2px 8px", borderRadius: 999 }}>
                {stepProv}{cfg[modelKey] ? ` · ${cfg[modelKey]}` : ""}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", paddingLeft: 33, lineHeight: 1.4 }}>{step.desc}</div>
        </div>
        <button onClick={isCustom ? disable : enable} style={{ padding: "4px 12px", borderRadius: 999, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0, background: isCustom ? "var(--ink)" : "var(--paper-3)", color: isCustom ? "var(--paper)" : "var(--ink-3)", border: `1.5px solid ${isCustom ? "var(--ink)" : "var(--line)"}`, transition: "all .15s ease" }}>
          {isCustom ? "custom" : "global"}
        </button>
      </div>
      {isCustom && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>Provider</div>
            <ProviderPills value={stepProv} onChange={v => { setForceStepKey(false); onChange(provKey, v); onChange(apiKey, ""); }} small />
          </div>
          {stepProv !== "ollama" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-2)", cursor: "pointer", userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={usesGlobalKey}
                  onChange={e => {
                    if (e.target.checked) {
                      setForceStepKey(false);
                      onChange(apiKey, "");
                    } else {
                      setForceStepKey(true);
                    }
                  }}
                  style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }}
                />
                <span>{keySourceLabel}</span>
              </label>
              <ApiKeyInput
                value={usesGlobalKey ? "" : (cfg[apiKey] as string)}
                onChange={v => { setForceStepKey(true); onChange(apiKey, v); }}
                provider={stepProv}
                isStep
                disabled={usesGlobalKey}
                placeholder={usesGlobalKey ? "Using global key; choose any model below" : `Optional ${stepProv} key for this step`}
              />
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>Model</div>
            <ModelChips provider={stepProv} value={cfg[modelKey] as string} onChange={v => onChange(modelKey, v)} />
          </div>
        </div>
      )}
    </div>
  );
}

function BigToggle({ active, onToggle, icon, label, badge, sub, tone }: { active: boolean; onToggle: () => void; icon: string; label: string; badge: string; sub: string; tone: string }) {
  return (
    <div onClick={onToggle} style={{ padding: 14, borderRadius: 14, cursor: "pointer", background: active ? `var(--${tone}-soft)` : "var(--paper-2)", border: `1px solid ${active ? `var(--${tone})` : "var(--line)"}`, transition: "all .2s ease", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: active ? `var(--${tone})` : "var(--paper-3)", color: active ? `var(--${tone}-ink)` : "var(--ink-3)", display: "grid", placeItems: "center", transition: "all .2s ease" }}>
          <Icon name={icon} size={15} />
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
            <span className="mono" style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", background: active ? `var(--${tone})` : "var(--paper-3)", color: active ? `var(--${tone}-ink)` : "var(--ink-3)", padding: "2px 7px", borderRadius: 999, transition: "all .2s ease" }}>{badge}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>
        </div>
      </div>
      <div style={{ width: 42, height: 24, borderRadius: 999, flexShrink: 0, background: active ? `var(--${tone})` : "var(--paper-4)", position: "relative", transition: "background .2s ease" }}>
        <div style={{ position: "absolute", top: 3, left: active ? 21 : 3, width: 18, height: 18, borderRadius: 999, background: "white", transition: "left .2s ease", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }} />
      </div>
    </div>
  );
}

export default function SettingsModal({ port, onClose }: Props) {
  const [cfg, setCfg]       = useState<Cfg>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    fetch(`http://127.0.0.1:${port}/api/v1/settings`)
      .then(r => r.json())
      .then(d => setCfg(c => ({ ...c, ...d })))
      .catch(() => {});
  }, [port]);

  const set = (k: keyof Cfg) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setCfg(c => ({ ...c, [k]: e.target.value }));

  const onChange = (k: keyof Cfg, v: string) => setCfg(c => ({ ...c, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`http://127.0.0.1:${port}/api/v1/settings`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg),
      });
      if (cfg.x_enable_notifications === "true" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  const prov = cfg.llm_provider || "ollama";

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 100 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(720px, 94vw)", maxHeight: "90vh", background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 22, boxShadow: "var(--shadow-lg)", zIndex: 101, overflow: "hidden", display: "flex", flexDirection: "column", animation: "slide-up .3s ease" }}>

        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--line)", background: "var(--blue-soft)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div className="eyebrow">Configuration</div>
            <h2 style={{ fontSize: 26, marginTop: 2 }}>Settings</h2>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3 }}>Set a global default, then override each step's model, provider, or key independently</div>
          </div>
          <button className="btn btn-icon" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>

        {/* Body */}
        <div className="scroll" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 22 }}>

          {/* 1. Global default */}
          <div>
            <SectionLabel label="Global Default" sub="fallback for any step not overridden" />
            <div style={{ padding: 16, borderRadius: 14, background: "var(--paper-2)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 12 }}>
              <ProviderPills value={prov} onChange={v => onChange("llm_provider", v)} />
              {prov !== "ollama" && (
                <ApiKeyInput value={cfg[_KEY_FIELD[prov]] as string} onChange={v => onChange(_KEY_FIELD[prov], v)} provider={prov} />
              )}
              {prov === "ollama" && (
                <input type="text" placeholder="http://localhost:11434/v1" value={cfg.ollama_url} onChange={set("ollama_url")} className="mono field-input"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
              )}
              {(prov === "nvidia" || prov === "openai") && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>Global Model</div>
                  <ModelChips provider={prov} value={prov === "nvidia" ? cfg.nvidia_model : cfg.openai_model} onChange={v => onChange(prov === "nvidia" ? "nvidia_model" : "openai_model", v)} />
                </div>
              )}
            </div>
          </div>

          {/* 2. Per-step */}
          <div>
            <SectionLabel label="Per-Step Configuration" sub="reuse the global key, or give any step its own provider, key & model" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {STEPS.map(step => <StepCard key={step.id} step={step} cfg={cfg} onChange={onChange} />)}
            </div>
          </div>

          {/* 3. Scraping */}
          <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 18 }}>
            <SectionLabel label="Scraping & Discovery" />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <LabelledField label="Apify Token" hint="for LinkedIn/X scraping">
                  <input type="password" placeholder="apify_api_•••" value={cfg.apify_token} onChange={set("apify_token")} className="mono field-input"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                </LabelledField>
                <LabelledField label="Apify Actor ID" hint="actor to run">
                  <input type="text" placeholder="drobnikj/…" value={cfg.apify_actor} onChange={set("apify_actor")} className="mono field-input"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                </LabelledField>
              </div>
              <LabelledField label="LinkedIn session cookie" hint="li_at value">
                <input type="password" placeholder="li_at=•••" value={cfg.linkedin_cookie} onChange={set("linkedin_cookie")} className="mono field-input"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
              </LabelledField>
              <div style={{ padding: 13, borderRadius: 13, background: "var(--paper-2)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
                <SectionLabel label="X Signals" sub="recent posts for job leads" />
                <LabelledField label="X API Bearer Token" hint="Developer Console token">
                  <input type="password" placeholder="Bearer token" value={cfg.x_bearer_token} onChange={set("x_bearer_token")} className="mono field-input"
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                </LabelledField>
                <LabelledField label="X recent-search queries" hint="one query per line; leave blank for AI defaults">
                  <textarea value={cfg.x_search_queries} onChange={set("x_search_queries")} rows={4} className="mono field-input"
                    placeholder={[
                      "(\"hiring\" OR \"job opening\" OR \"open role\") (\"AI engineer\" OR \"software engineer\" OR \"Python developer\") lang:en -is:retweet",
                      "(\"we are hiring\" OR \"is hiring\") (\"React developer\" OR \"backend engineer\" OR \"full stack engineer\") lang:en -is:retweet",
                      "(\"apply\" OR \"open role\") (Python OR React OR FastAPI OR LLM) (remote OR hybrid) lang:en -is:retweet",
                    ].join("\n")}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 11.5, resize: "vertical", lineHeight: 1.6 }} />
                </LabelledField>
                <LabelledField label="X watchlist handles" hint="one founder, hiring, or AI account per line">
                  <textarea value={cfg.x_watchlist} onChange={set("x_watchlist")} rows={3} className="mono field-input"
                    placeholder={"@levelsio\n@alexalbert__\n@rauchg"}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 11.5, resize: "vertical", lineHeight: 1.6 }} />
                </LabelledField>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
                  <LabelledField label="Requests" hint="per scan">
                    <input type="number" min={1} max={50} value={cfg.x_max_requests_per_scan} onChange={set("x_max_requests_per_scan")} className="mono field-input"
                      style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                  </LabelledField>
                  <LabelledField label="Posts" hint="per query">
                    <input type="number" min={10} max={100} value={cfg.x_max_results_per_query} onChange={set("x_max_results_per_query")} className="mono field-input"
                      style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                  </LabelledField>
                  <LabelledField label="Min signal" hint="0-100">
                    <input type="number" min={0} max={100} value={cfg.x_min_signal_score} onChange={set("x_min_signal_score")} className="mono field-input"
                      style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                  </LabelledField>
                  <LabelledField label="Hot score" hint="0-100">
                    <input type="number" min={1} max={100} value={cfg.x_hot_lead_threshold} onChange={set("x_hot_lead_threshold")} className="mono field-input"
                      style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                  </LabelledField>
                </div>
                <BigToggle
                  active={cfg.x_enable_notifications === "true"}
                  onToggle={() => onChange("x_enable_notifications", cfg.x_enable_notifications === "true" ? "false" : "true")}
                  icon="spark"
                  label="Hot X notifications"
                  badge={cfg.x_enable_notifications === "true" ? "on" : "off"}
                  sub="Desktop alert when an X lead crosses the hot score"
                  tone="orange"
                />
              </div>
              <div style={{ padding: 13, borderRadius: 13, background: "var(--paper-2)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
                <SectionLabel label="Free Source Stack" sub="Optional job-only ATS, GitHub, HN, and Reddit sources" />
                <BigToggle
                  active={cfg.free_sources_enabled !== "false"}
                  onToggle={() => onChange("free_sources_enabled", cfg.free_sources_enabled === "false" ? "true" : "false")}
                  icon="search"
                  label="Free scouts"
                  badge={cfg.free_sources_enabled !== "false" ? "on" : "off"}
                  sub="Off by default; saves job leads and classifies seniority for filtering"
                  tone="green"
                />
                <LabelledField label="Company watchlist" hint="provider,slug per line: greenhouse,openai">
                  <textarea value={cfg.company_watchlist} onChange={set("company_watchlist")} rows={4} className="mono field-input"
                    placeholder={[
                      "greenhouse,openai",
                      "greenhouse,anthropic",
                      "lever,perplexity",
                      "ashby,linear",
                      "workable,canonical",
                    ].join("\n")}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 11.5, resize: "vertical", lineHeight: 1.6 }} />
                </LabelledField>
                <LabelledField label="Free source targets" hint="github:, hn:, reddit:, or ats: targets">
                  <textarea value={cfg.free_source_targets} onChange={set("free_source_targets")} rows={5} className="mono field-input"
                    placeholder={[
                      "github:software engineer help wanted",
                      "hn:software engineer remote",
                      "reddit:cscareerquestions:developer hiring",
                      "ats:greenhouse:openai",
                    ].join("\n")}
                    style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 11.5, resize: "vertical", lineHeight: 1.6 }} />
                </LabelledField>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                  <LabelledField label="Free requests" hint="per scan">
                    <input type="number" min={1} max={80} value={cfg.free_source_max_requests} onChange={set("free_source_max_requests")} className="mono field-input"
                      style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                  </LabelledField>
                  <LabelledField label="Free min signal" hint="0-100">
                    <input type="number" min={0} max={100} value={cfg.free_source_min_signal_score} onChange={set("free_source_min_signal_score")} className="mono field-input"
                      style={{ width: "100%", padding: "9px 10px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                  </LabelledField>
                </div>
              </div>
              <LabelledField label="Target job boards / search URLs" hint="comma-separated">
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>Quick add sources</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {[
                      { label: "HN Hiring", url: "hn-hiring" },
                      { label: "RemoteOK", url: "https://remoteok.com/api" },
                      { label: "Greenhouse", url: "site:boards.greenhouse.io" },
                      { label: "Lever", url: "site:jobs.lever.co" },
                      { label: "Ashby", url: "site:jobs.ashbyhq.com" },
                      { label: "Workable", url: "site:apply.workable.com" },
                      { label: "Wellfound", url: "site:wellfound.com/jobs" },
                      { label: "WWR", url: "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss" },
                      { label: "Remotive AI", url: "https://remotive.com/api/remote-jobs?search=ai" },
                      { label: "Remotive Python", url: "https://remotive.com/api/remote-jobs?search=python" },
                      { label: "Remotive React", url: "https://remotive.com/api/remote-jobs?search=react" },
                      { label: "Jobicy", url: "https://jobicy.com/feed/newjobs" },
                    ].map(p => {
                      const already = cfg.job_boards.includes(p.url);
                      return (
                        <button key={p.label} onClick={() => {
                          if (already) return;
                          const sep = cfg.job_boards.trim() ? ",\n" : "";
                          onChange("job_boards", cfg.job_boards.trim() + sep + p.url);
                        }} style={{
                          padding: "4px 10px", borderRadius: 7, fontSize: 10.5, cursor: already ? "default" : "pointer",
                          fontWeight: 600, transition: "all .12s ease",
                          background: already ? "var(--blue-soft)" : "var(--paper-3)",
                          color: already ? "var(--blue-ink)" : "var(--ink-2)",
                          border: `1px solid ${already ? "var(--blue)" : "var(--line)"}`,
                          opacity: already ? 0.7 : 1,
                        }}>
                          {already ? "✓ " : "+ "}{p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <textarea value={cfg.job_boards} onChange={set("job_boards")} rows={5} className="mono field-input"
                  placeholder={[
                    "# Hacker News Who is Hiring (Algolia API)",
                    "hn-hiring,",
                    "# Direct API / RSS feeds",
                    "https://remoteok.com/api,",
                    "https://remotive.com/api/remote-jobs?search=python,",
                    "https://remotive.com/api/remote-jobs?search=react,",
                    "https://remotive.com/api/remote-jobs?search=ai,",
                    "https://jobicy.com/feed/newjobs,",
                    "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss,",
                    "# ATS boards (Google site: search — query gen enriches these)",
                    "site:boards.greenhouse.io,",
                    "site:jobs.lever.co,",
                    "site:jobs.ashbyhq.com,",
                    "site:apply.workable.com,",
                    "site:wellfound.com/jobs,",
                  ].join("\n")}
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 11.5, resize: "vertical", lineHeight: 1.6 }} />
              </LabelledField>
            </div>
          </div>

          {/* 4. Automation */}
          <div style={{ borderTop: "1px dashed var(--line)", paddingTop: 18 }}>
            <SectionLabel label="Automation" />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <BigToggle active={cfg.ghost_mode === "true"} onToggle={() => onChange("ghost_mode", cfg.ghost_mode === "true" ? "false" : "true")}
                icon="ghost" tone="purple" label="Ghost Mode" badge={cfg.ghost_mode === "true" ? "autonomous" : "manual"}
                sub="Runs the full pipeline every 6 hours in the background" />
              <BigToggle active={cfg.auto_apply === "true"} onToggle={() => onChange("auto_apply", cfg.auto_apply === "true" ? "false" : "true")}
                icon="fire" tone="orange" label="Auto Apply" badge={cfg.auto_apply === "true" ? "on" : "off"}
                sub="Submits approved applications automatically — skips Sniper review" />
              <BigToggle active={cfg.headed_browser === "true"} onToggle={() => onChange("headed_browser", cfg.headed_browser === "true" ? "false" : "true")}
                icon="globe" tone="blue" label="Headed Browser" badge={cfg.headed_browser === "true" ? "visible" : "headless"}
                sub="Show the browser window during actuation — useful for debugging" />
            </div>
          </div>

          <div style={{ height: 6 }} />
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid var(--line)", background: "var(--paper-2)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn" onClick={onClose} style={{ padding: "9px 20px", fontSize: 13, borderRadius: 10 }}>Cancel</button>
          <button className="btn btn-accent" onClick={save} disabled={saving} style={{ padding: "9px 26px", fontSize: 13, borderRadius: 10, minWidth: 110 }}>
            {saved ? "✓ Saved" : saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </>
  );
}
