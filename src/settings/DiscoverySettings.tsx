import type { Cfg } from "./shared";
import { BigToggle, GLOBAL_SOURCE_PRESET, INDIA_SOURCE_PRESET, LabelledField, SectionLabel } from "./shared";

export function DiscoverySettings({ cfg, set, onChange }: { cfg: Cfg; set: (k: keyof Cfg) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void; onChange: (k: keyof Cfg, v: string) => void }) {
  return (
    <>
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
                <SectionLabel label="Recruiter Lookup" sub="Hunter.io emails, optional Proxycurl LinkedIn" />
                <BigToggle
                  active={cfg.contact_lookup_enabled !== "false"}
                  onToggle={() => onChange("contact_lookup_enabled", cfg.contact_lookup_enabled === "false" ? "true" : "false")}
                  icon="user"
                  label="Who to contact"
                  badge={cfg.contact_lookup_enabled !== "false" ? "on" : "off"}
                  sub="Runs after package generation and stores the best contact on the lead"
                  tone="blue"
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <LabelledField label="Hunter.io API key" hint="domain search">
                    <input type="password" placeholder="hunter key" value={cfg.hunter_api_key} onChange={set("hunter_api_key")} className="mono field-input"
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                  </LabelledField>
                  <LabelledField label="Proxycurl API key" hint="optional LinkedIn resolve">
                    <input type="password" placeholder="proxycurl key" value={cfg.proxycurl_api_key} onChange={set("proxycurl_api_key")} className="mono field-input"
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--card)", fontSize: 12 }} />
                  </LabelledField>
                </div>
              </div>

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
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Market focus</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { id: "global", label: "Global boards", sub: "HN, RemoteOK, Remotive, ATS, RSS, job boards" },
                      { id: "india", label: "India only", sub: "India roles, Indian startups, Indian job boards and ATS" },
                    ].map(mode => {
                      const active = (cfg.job_market_focus || "global") === mode.id;
                      return (
                        <button key={mode.id} onClick={() => onChange("job_market_focus", mode.id)} style={{
                          textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                          background: active ? "var(--blue-soft)" : "var(--paper-3)",
                          border: `1.5px solid ${active ? "var(--blue)" : "var(--line)"}`,
                          color: active ? "var(--blue-ink)" : "var(--ink-2)",
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{mode.label}</div>
                          <div style={{ fontSize: 11, marginTop: 3, lineHeight: 1.35, color: "var(--ink-3)" }}>{mode.sub}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 7 }}>Quick add sources</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {[
                      { label: "Global preset", url: GLOBAL_SOURCE_PRESET },
                      { label: "India preset", url: INDIA_SOURCE_PRESET },
                      { label: "HN Hiring", url: "hn-hiring" },
                      { label: "RemoteOK", url: "https://remoteok.com/api" },
                      { label: "Naukri", url: "site:naukri.com software engineer India" },
                      { label: "Instahyre", url: "site:instahyre.com software engineer India" },
                      { label: "Cutshort", url: "site:cutshort.io/jobs software engineer India startup" },
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
                          if (p.label === "India preset") onChange("job_market_focus", "india");
                          if (p.label === "Global preset") onChange("job_market_focus", "global");
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
    </>
  );
}
