import { useState } from "react";
import Icon from "../components/Icon";

export interface Cfg {
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
  hunter_api_key: string; proxycurl_api_key: string; contact_lookup_enabled: string;
  x_max_requests_per_scan: string; x_max_results_per_query: string; x_min_signal_score: string; x_hot_lead_threshold: string; x_enable_notifications: string;
  free_sources_enabled: string; free_source_targets: string; company_watchlist: string; free_source_max_requests: string; free_source_min_signal_score: string;
  job_boards: string; job_market_focus: string;
  ghost_mode: string; auto_apply: string; headed_browser: string;
}

export const EMPTY: Cfg = {
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
  hunter_api_key: "", proxycurl_api_key: "", contact_lookup_enabled: "true",
  x_max_requests_per_scan: "5", x_max_results_per_query: "50", x_min_signal_score: "55", x_hot_lead_threshold: "80", x_enable_notifications: "false",
  free_sources_enabled: "false", free_source_targets: "", company_watchlist: "", free_source_max_requests: "20", free_source_min_signal_score: "45",
  job_boards: "", job_market_focus: "global",
  ghost_mode: "false", auto_apply: "false", headed_browser: "false",
};

export const PROVIDERS = [
  { id: "deepseek",  label: "DeepSeek",  tone: "teal",   sub: "V3 / R1"   },
  { id: "nvidia",    label: "NVIDIA",    tone: "green",  sub: "GLM / NIM" },
  { id: "groq",      label: "Groq",      tone: "orange", sub: "Llama 3.3" },
  { id: "openai",    label: "OpenAI",    tone: "blue",   sub: "GPT-4o"    },
  { id: "anthropic", label: "Anthropic", tone: "purple", sub: "Claude"    },
  { id: "ollama",    label: "Ollama",    tone: "pink",   sub: "Local"     },
];

export const MODEL_HINTS: Record<string, string[]> = {
  deepseek:  ["deepseek-chat", "deepseek-reasoner"],
  nvidia:    ["z-ai/glm-5.1", "meta/llama-3.1-70b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1"],
  groq:      ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  openai:    ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
  anthropic: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-6"],
  ollama:    ["llama3", "mistral", "gemma2", "codellama"],
};

export const STEPS = [
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

export const GLOBAL_SOURCE_PRESET = [
  "hn-hiring,",
  "https://remoteok.com/api,",
  "https://remotive.com/api/remote-jobs?search=junior,",
  "https://remotive.com/api/remote-jobs?search=python,",
  "https://remotive.com/api/remote-jobs?search=react,",
  "https://remotive.com/api/remote-jobs?search=ai,",
  "https://jobicy.com/api/v2/remote-jobs?count=50&tag=python,",
  "https://jobicy.com/api/v2/remote-jobs?count=50&tag=react,",
  "https://jobicy.com/feed/newjobs,",
  "https://weworkremotely.com/categories/remote-programming-jobs.rss,",
  "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss,",
  "site:boards.greenhouse.io,",
  "site:jobs.lever.co,",
  "site:jobs.ashbyhq.com,",
  "site:apply.workable.com,",
  "site:wellfound.com/jobs,",
  "site:linkedin.com/jobs,",
  "site:indeed.com/jobs,",
  "site:naukri.com,",
  "site:instahyre.com,",
  "site:cutshort.io/jobs,",
].join("\n");

export const INDIA_SOURCE_PRESET = [
  "site:wellfound.com/jobs India startup,",
  "site:cutshort.io/jobs software engineer India startup,",
  "site:instahyre.com software engineer India,",
  "site:naukri.com software engineer startup India,",
  "site:linkedin.com/jobs software engineer India startup,",
  "site:indeed.com/jobs software engineer India startup,",
  "site:boards.greenhouse.io India,",
  "site:jobs.lever.co India,",
  "site:jobs.ashbyhq.com India,",
  "site:apply.workable.com India,",
].join("\n");

export const KEY_FIELD: Record<string, keyof Cfg> = {
  anthropic: "anthropic_key", groq: "groq_api_key",
  nvidia: "nvidia_api_key", openai: "openai_api_key", deepseek: "deepseek_api_key",
};

/* helpers */
export function LabelledField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

export function SectionLabel({ label, sub }: { label: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
      {sub && <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{sub}</span>}
    </div>
  );
}

export function ProviderPills({ value, onChange, small }: { value: string; onChange: (v: string) => void; small?: boolean }) {
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

export function ModelChips({ provider, value, onChange }: { provider: string; value: string; onChange: (v: string) => void }) {
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

export function ApiKeyInput({ value, onChange, provider, isStep, disabled = false, placeholder }: {
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

export function StepCard({ step, cfg, onChange }: { step: typeof STEPS[0]; cfg: Cfg; onChange: (k: keyof Cfg, v: string) => void }) {
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

export function BigToggle({ active, onToggle, icon, label, badge, sub, tone }: { active: boolean; onToggle: () => void; icon: string; label: string; badge: string; sub: string; tone: string }) {
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
