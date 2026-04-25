import { useEffect, useState } from "react";
import Icon from "./components/Icon";

interface Props {
  port: number;
  onClose: () => void;
}

interface Cfg {
  llm_provider: string;
  anthropic_key: string;
  groq_api_key: string;
  nvidia_api_key: string;
  ollama_url: string;
  apify_token: string;
  apify_actor: string;
  linkedin_cookie: string;
  job_boards: string;
  ghost_mode: string;
}

const EMPTY: Cfg = {
  llm_provider: "ollama",
  anthropic_key: "",
  groq_api_key: "",
  nvidia_api_key: "",
  ollama_url: "http://localhost:11434/v1",
  apify_token: "",
  apify_actor: "",
  linkedin_cookie: "",
  job_boards: "",
  ghost_mode: "false",
};

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic", icon: "spark", tone: "purple", sub: "Claude Sonnet 4" },
  { id: "groq", label: "Groq", icon: "pulse", tone: "orange", sub: "Llama 3.3 70B" },
  { id: "nvidia", label: "NVIDIA NIM", icon: "trending", tone: "teal", sub: "GLM-5.1 · Free" },
  { id: "ollama", label: "Ollama", icon: "globe", tone: "green", sub: "Local · Llama 3" },
];

export default function SettingsModal({ port, onClose }: Props) {
  const [cfg, setCfg] = useState<Cfg>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`http://127.0.0.1:${port}/api/v1/settings`)
      .then(r => r.json())
      .then(d => setCfg(c => ({ ...c, ...d })))
      .catch(() => {});
  }, [port]);

  const set = (k: keyof Cfg) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setCfg(c => ({ ...c, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`http://127.0.0.1:${port}/api/v1/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const toggle = () =>
    setCfg(c => ({ ...c, ghost_mode: c.ghost_mode === "true" ? "false" : "true" }));

  const ghost = cfg.ghost_mode === "true";
  const prov = cfg.llm_provider || "ollama";

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} style={{ zIndex: 100 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(660px, 92vw)", maxHeight: "88vh",
        background: "var(--paper)", border: "1px solid var(--line)",
        borderRadius: 20, boxShadow: "var(--shadow-lg)",
        zIndex: 101, overflow: "hidden", display: "flex", flexDirection: "column",
        animation: "slide-up .3s ease",
      }}>
        <div className="row" style={{ padding: "18px 22px", borderBottom: "1px solid var(--line)", justifyContent: "space-between", background: "var(--blue-soft)" }}>
          <div className="col gap-1">
            <span className="eyebrow">Configuration</span>
            <h2 style={{ fontSize: 26 }}>Settings</h2>
          </div>
          <button className="btn btn-icon" onClick={onClose}><Icon name="x" size={15} /></button>
        </div>

        <div className="scroll" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>

          <div style={{
            padding: 16, borderRadius: 14,
            background: "var(--paper-2)",
            border: "1px solid var(--line)",
          }}>
            <div className="row gap-2" style={{ marginBottom: 12 }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, background: "var(--ink)", color: "var(--paper)", display: "grid", placeItems: "center" }}>
                <Icon name="spark" size={12} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>LLM Provider</div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>model router</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
              {PROVIDERS.map(p => {
                const active = prov === p.id;
                return (
                  <button key={p.id} onClick={() => setCfg(c => ({ ...c, llm_provider: p.id }))} style={{
                    padding: "12px 10px", borderRadius: 12, cursor: "pointer",
                    background: active ? `var(--${p.tone}-soft)` : "var(--card)",
                    border: `1.5px solid ${active ? `var(--${p.tone})` : "var(--line)"}`,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    transition: "all .15s ease",
                  }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 8,
                      background: active ? `var(--${p.tone})` : "var(--paper-3)",
                      color: active ? `var(--${p.tone}-ink)` : "var(--ink-3)",
                      display: "grid", placeItems: "center",
                      transition: "all .15s ease",
                    }}>
                      <Icon name={p.icon} size={14} />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: active ? `var(--${p.tone}-ink)` : "var(--ink)" }}>{p.label}</div>
                    <div className="mono" style={{ fontSize: 9.5, color: "var(--ink-3)", letterSpacing: "0.06em" }}>{p.sub}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {prov === "anthropic" && (
            <Field tone="purple" icon="key" label="Anthropic API key" hint="Claude Sonnet 4">
              <input type="password" placeholder="sk-ant-•••••••••••••" value={cfg.anthropic_key} onChange={set("anthropic_key")} className="mono field-input" style={{
                width: "100%", padding: "10px 12px", borderRadius: 9,
                border: "1px solid var(--line)", background: "var(--card)",
                fontSize: 12,
              }} />
            </Field>
          )}

          {prov === "groq" && (
            <Field tone="orange" icon="key" label="Groq API key" hint="Llama 3.3 70B via Groq Cloud">
              <input type="password" placeholder="gsk_•••••••••••••" value={cfg.groq_api_key} onChange={set("groq_api_key")} className="mono field-input" style={{
                width: "100%", padding: "10px 12px", borderRadius: 9,
                border: "1px solid var(--line)", background: "var(--card)",
                fontSize: 12,
              }} />
            </Field>
          )}

          {prov === "nvidia" && (
            <Field tone="teal" icon="key" label="NVIDIA API key" hint="GLM-5.1 via NIM">
              <input type="password" placeholder="nvapi-•••••••••••••" value={cfg.nvidia_api_key} onChange={set("nvidia_api_key")} className="mono field-input" style={{
                width: "100%", padding: "10px 12px", borderRadius: 9,
                border: "1px solid var(--line)", background: "var(--card)",
                fontSize: 12,
              }} />
            </Field>
          )}

          {prov === "ollama" && (
            <Field tone="green" icon="globe" label="Ollama endpoint" hint="Local inference server">
              <input type="text" placeholder="http://localhost:11434/v1" value={cfg.ollama_url} onChange={set("ollama_url")} className="mono field-input" style={{
                width: "100%", padding: "10px 12px", borderRadius: 9,
                border: "1px solid var(--line)", background: "var(--card)",
                fontSize: 12,
              }} />
            </Field>
          )}

          <div style={{ borderTop: "1px dashed var(--line)", margin: "2px 0" }} />

          <Field tone="orange" icon="key" label="Apify Token" hint="Scraper agents">
            <input type="password" placeholder="apify_api_•••••••••••••" value={cfg.apify_token} onChange={set("apify_token")} className="mono field-input" style={{
              width: "100%", padding: "10px 12px", borderRadius: 9,
              border: "1px solid var(--line)", background: "var(--card)",
              fontSize: 12,
            }} />
          </Field>

          <Field tone="orange" icon="layers" label="Apify Actor ID" hint="Actor to run for scraping">
            <input type="text" placeholder="drobnikj/…" value={cfg.apify_actor} onChange={set("apify_actor")} className="mono field-input" style={{
              width: "100%", padding: "10px 12px", borderRadius: 9,
              border: "1px solid var(--line)", background: "var(--card)",
              fontSize: 12,
            }} />
          </Field>

          <Field tone="blue" icon="link" label="LinkedIn session cookie" hint="Required for LinkedIn scraper">
            <input type="password" placeholder="li_at=•••" value={cfg.linkedin_cookie} onChange={set("linkedin_cookie")} className="mono field-input" style={{
              width: "100%", padding: "10px 12px", borderRadius: 9,
              border: "1px solid var(--line)", background: "var(--card)",
              fontSize: 12,
            }} />
          </Field>

          <Field tone="green" icon="globe" label="Target job queries" hint="Comma-separated list">
            <textarea value={cfg.job_boards} onChange={set("job_boards")} rows={4} className="mono field-input" style={{
              width: "100%", padding: "10px 12px", borderRadius: 9,
              border: "1px solid var(--line)", background: "var(--card)",
              fontSize: 12, resize: "vertical",
            }} />
          </Field>

          <div style={{
            padding: 16, borderRadius: 14,
            background: ghost ? "var(--purple-soft)" : "var(--paper-2)",
            border: `1px solid ${ghost ? "var(--purple-ink)" : "var(--line)"}`,
            transition: "all .2s ease",
          }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div className="col gap-1" style={{ flex: 1 }}>
                <div className="row gap-2">
                  <Icon name="ghost" size={14} color={ghost ? "var(--purple-ink)" : "var(--ink-3)"} />
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Ghost mode</div>
                  <span className="pill mono" style={{ background: ghost ? "var(--purple)" : "var(--paper-3)", color: ghost ? "var(--purple-ink)" : "var(--ink-3)", fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>{ghost ? "autonomous" : "manual"}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                  {ghost ? "Agent applies automatically when match score > 0.85." : "Agent waits for your approval before submitting any application."}
                </div>
              </div>
              <button onClick={toggle} style={{
                width: 46, height: 26, borderRadius: 999,
                background: ghost ? "var(--purple-ink)" : "var(--ink-4)",
                border: "none", cursor: "pointer", padding: 0,
                position: "relative", transition: "background .2s ease",
              }}>
                <span style={{
                  position: "absolute", top: 3, left: ghost ? 23 : 3,
                  width: 20, height: 20, borderRadius: "50%",
                  background: "white", transition: "left .2s ease",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }} />
              </button>
            </div>
          </div>
        </div>

        <div className="row" style={{ padding: "14px 22px", borderTop: "1px solid var(--line)", justifyContent: "flex-end", gap: 8, background: "var(--paper-2)" }}>
          {saved && <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 500 }}>✓ Saved</span>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Icon name="check" size={13} /> {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}

function Field({ tone, icon, label, hint, children }: { tone: string; icon: string; label: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      background: `var(--${tone}-soft)`,
      border: `1px solid var(--${tone})`,
    }}>
      <div className="row gap-2" style={{ marginBottom: 8 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: `var(--${tone})`, color: `var(--${tone}-ink)`, display: "grid", placeItems: "center" }}>
          <Icon name={icon} size={12} />
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: 4 }}>{hint}</div>
      </div>
      {children}
    </div>
  );
}
