import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Icon from "../components/Icon";
import type { ApiFetch } from "../types";

export function IngestionView({ api }: { api: ApiFetch }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [activeTab, setActiveTab] = useState<"resume" | "manual" | "raw" | "template" | "linkedin" | "github" | "portfolio" | "json-import">("resume");

  // Forms
  const [skillForm, setSkillForm] = useState({ n: "", cat: "technical" });
  const [expForm, setExpForm]     = useState({ role: "", co: "", period: "", d: "" });
  const [projForm, setProjForm]   = useState({ title: "", stack: "", repo: "", impact: "" });
  const [rawText, setRawText]     = useState("");
  const [template, setTemplate]   = useState("");
  const [templateLoaded, setTemplateLoaded] = useState(false);

  // LinkedIn tab state
  const [linkedinFile, setLinkedinFile] = useState<File | null>(null);
  const [linkedinResult, setLinkedinResult] = useState<any>(null);
  // GitHub tab state
  const [githubUsername, setGithubUsername] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubResult, setGithubResult] = useState<any>(null);
  const [showToken, setShowToken] = useState(false);
  const [githubMaxRepos, setGithubMaxRepos] = useState(12);
  // Portfolio tab state
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [portfolioResult, setPortfolioResult] = useState<any>(null);
  // JSON import tab state
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [jsonResult, setJsonResult] = useState<any>(null);

  // Load existing template on mount
  useEffect(() => {
    if (activeTab !== "template" || templateLoaded) return;
    api(`/api/v1/template`)
      .then(r => r.json())
      .then(d => { setTemplate(d.template || ""); setTemplateLoaded(true); })
      .catch(() => {});
  }, [activeTab, api, templateLoaded]);

  const saveTemplate = async () => {
    setStatus("loading");
    try {
      const r = await api(`/api/v1/template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      setStatus(r.ok ? "done" : "error");
    } catch { setStatus("error"); }
  };

  const addManual = async (type: string, data: any) => {
    setStatus("loading");
    try {
      const endpointType = type === "exp" ? "experience" : type;
      const r = await api(`/api/v1/profile/${endpointType}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      if (r.ok) {
        setStatus("done");
        if (type === "skill")   setSkillForm({ n: "", cat: "technical" });
        if (type === "exp")     setExpForm({ role: "", co: "", period: "", d: "" });
        if (type === "project") setProjForm({ title: "", stack: "", repo: "", impact: "" });
      } else { setStatus("error"); }
    } catch { setStatus("error"); }
  };

  const ingestResume = async (file: File) => {
    setStatus("loading");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await api(`/api/v1/ingest`, { method: "POST", body: fd });
      setStatus(r.ok ? "done" : "error");
    } catch { setStatus("error"); }
  };

  const ingestLinkedin = async () => {
    if (!linkedinFile) return;
    setStatus("loading");
    setLinkedinResult(null);
    const fd = new FormData();
    fd.append("file", linkedinFile);
    try {
      const r = await api(`/api/v1/ingest/linkedin`, { method: "POST", body: fd });
      if (r.ok) {
        const data = await r.json();
        setLinkedinResult(data);
        setStatus("idle");
      } else { setStatus("error"); }
    } catch { setStatus("error"); }
  };

  const ingestGithub = async () => {
    setStatus("loading");
    setGithubResult(null);
    try {
      const r = await api(`/api/v1/ingest/github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: githubUsername, token: githubToken, max_repos: githubMaxRepos }),
      });
      if (r.ok) {
        const data = await r.json();
        setGithubResult(data);
        setStatus("idle");
      } else if (r.status === 404) {
        setGithubResult({ errorMsg: `GitHub user '${githubUsername}' not found` });
        setStatus("idle");
      } else { setStatus("error"); }
    } catch { setStatus("error"); }
  };

  const scanPortfolio = async (autoImport = false) => {
    setStatus("loading");
    if (!autoImport) setPortfolioResult(null);
    try {
      const r = await api(`/api/v1/ingest/portfolio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: portfolioUrl, auto_import: autoImport }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setPortfolioResult(autoImport ? { ...data, imported: true } : data);
        setStatus("idle");
      } else {
        setPortfolioResult({ errorMsg: data?.detail || "Could not fetch portfolio." });
        setStatus("idle");
      }
    } catch {
      setPortfolioResult({ errorMsg: "Could not fetch portfolio." });
      setStatus("idle");
    }
  };

  const downloadProfileTemplate = async () => {
    try {
      const r = await api(`/api/v1/ingest/profile/template`);
      if (!r.ok) throw new Error(`Template download failed (${r.status})`);
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "jhm_profile_template.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setJsonError("Could not download template.");
    }
  };

  const importProfileJson = async () => {
    setJsonError(null);
    setJsonResult(null);
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err: any) {
      setJsonError(err?.message || "Invalid JSON.");
      return;
    }
    setStatus("loading");
    try {
      const r = await api(`/api/v1/ingest/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) {
        setJsonResult(data);
        setStatus("idle");
      } else {
        setJsonError(data?.detail ? JSON.stringify(data.detail) : `Import failed (${r.status})`);
        setStatus("idle");
      }
    } catch {
      setJsonError("Could not import profile JSON.");
      setStatus("idle");
    }
  };

  const ingestRaw = async () => {
    setStatus("loading");
    const fd = new FormData();
    fd.append("raw", rawText);
    try {
      const r = await api(`/api/v1/ingest`, { method: "POST", body: fd });
      if (r.ok) { setStatus("done"); setRawText(""); } else { setStatus("error"); }
    } catch { setStatus("error"); }
  };

  const TABS = [
    { id: "resume" as const,   label: "Resume Upload" },
    { id: "manual" as const,   label: "Manual Forms"  },
    { id: "raw" as const,      label: "Raw Text"      },
    { id: "template" as const, label: "📄 Resume Template" },
    { id: "linkedin" as const, label: "LinkedIn Export" },
    { id: "github" as const,   label: "GitHub" },
    { id: "portfolio" as const, label: "Portfolio URL" },
    { id: "json-import" as const, label: "JSON Import" },
  ];

  return (
    <div className="col scroll" style={{ flex: 1, height: "100%", overflow: "auto", background: "var(--paper)", padding: "48px 32px", alignItems: "center" }}>
      <div style={{ maxWidth: 680, width: "100%" }}>
        <div style={{ marginBottom: 32 }}>
          <span className="eyebrow">Append-only Pipeline</span>
          <h2 style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>Add Context</h2>
          <p style={{ color: "var(--ink-3)", marginTop: 8, fontSize: 14 }}>Everything you add is merged into your Identity Graph. Set a resume template so the generator follows your preferred format.</p>
        </div>

        <div className="row gap-2" style={{ background: "var(--paper-3)", padding: 6, borderRadius: 12, marginBottom: 32 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => { setActiveTab(t.id); setStatus("idle"); }}
              className={"btn " + (activeTab === t.id ? "btn-primary" : "btn-ghost")}
              style={{ flex: 1, border: "none", boxShadow: activeTab === t.id ? "var(--shadow-sm)" : "none", fontSize: 13, padding: "10px 0", borderRadius: 8 }}>
              {t.label}
            </button>
          ))}
        </div>

        {status === "done" && (
          <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} style={{ padding: 16, background: "var(--green-soft)", color: "var(--green-ink)", borderRadius: 12, marginBottom: 24, display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--green)" }}>
            <Icon name="check" size={18} /><div style={{fontWeight:600}}>Saved successfully!</div>
          </motion.div>
        )}
        {status === "error" && (
          <motion.div initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} style={{ padding: 16, background: "var(--bad-soft)", color: "var(--bad)", borderRadius: 12, marginBottom: 24, border: "1px solid var(--bad)" }}>
            An error occurred.
          </motion.div>
        )}

        {activeTab === "resume" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="card col gap-4" style={{ padding: "64px 32px", alignItems: "center", textAlign: "center", border: "2px dashed var(--line)", background: "var(--paper-2)" }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: "var(--teal-soft)", color: "var(--teal)", display: "grid", placeItems: "center" }}><Icon name="upload" size={28} /></div>
            <div style={{ fontWeight: 600, fontSize: 18 }}>Drop a fresh Resume PDF</div>
            <div style={{ fontSize: 14, color: "var(--ink-3)", maxWidth: 360, lineHeight: 1.5 }}>Our ingestion agent discovers skills, roles, and projects and maps them into your graph.</div>
            <input type="file" accept=".pdf" onChange={e => e.target.files?.[0] && ingestResume(e.target.files[0])} style={{ display: "none" }} id="pdf-in" />
            <button className="btn btn-primary" style={{ marginTop: 16, padding: "12px 32px", fontSize: 15 }} onClick={() => document.getElementById("pdf-in")?.click()}>Select PDF File</button>
            {status === "loading" && <div className="mono pulse" style={{ fontSize: 12, marginTop: 16 }}>Agent parsing resume…</div>}
          </motion.div>
        )}

        {activeTab === "manual" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="col gap-8">
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}><Icon name="spark" size={16}/> Add Skill</h3>
              <input className="field-input" placeholder="Skill name" value={skillForm.n} onChange={v => setSkillForm({...skillForm, n: v.target.value})} />
              <select className="field-input" value={skillForm.cat} onChange={v => setSkillForm({...skillForm, cat: v.target.value})}>
                <option value="technical">Technical</option>
                <option value="soft">Soft Skill</option>
                <option value="tool">Tool / Utility</option>
                <option value="language">Language</option>
                <option value="framework">Framework</option>
              </select>
              <button className="btn btn-primary" style={{alignSelf:"flex-start",padding:"10px 24px"}} onClick={() => addManual("skill", skillForm)} disabled={status==="loading" || !skillForm.n.trim()}>Add Skill</button>
            </div>
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}><Icon name="brief" size={16}/> Add Experience</h3>
              <input className="field-input" placeholder="Role Title" value={expForm.role} onChange={v => setExpForm({...expForm, role: v.target.value})} />
              <input className="field-input" placeholder="Company" value={expForm.co} onChange={v => setExpForm({...expForm, co: v.target.value})} />
              <input className="field-input" placeholder="Period (e.g. 2022-2024)" value={expForm.period} onChange={v => setExpForm({...expForm, period: v.target.value})} />
              <textarea className="field-input" placeholder="Description" rows={3} value={expForm.d} onChange={v => setExpForm({...expForm, d: v.target.value})} />
              <button className="btn btn-primary" style={{alignSelf:"flex-start",padding:"10px 24px"}} onClick={() => addManual("exp", expForm)} disabled={status==="loading" || (!expForm.role.trim() && !expForm.co.trim())}>Add Experience</button>
            </div>
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}><Icon name="layers" size={16}/> Add Project</h3>
              <input className="field-input" placeholder="Project Title" value={projForm.title} onChange={v => setProjForm({...projForm, title: v.target.value})} />
              <input className="field-input" placeholder="Stack (comma-separated)" value={projForm.stack} onChange={v => setProjForm({...projForm, stack: v.target.value})} />
              <input className="field-input" placeholder="Repo URL (optional)" value={projForm.repo} onChange={v => setProjForm({...projForm, repo: v.target.value})} />
              <textarea className="field-input" placeholder="Impact / Description" rows={3} value={projForm.impact} onChange={v => setProjForm({...projForm, impact: v.target.value})} />
              <button className="btn btn-primary" style={{alignSelf:"flex-start",padding:"10px 24px"}} onClick={() => addManual("project", projForm)} disabled={status==="loading" || !projForm.title.trim()}>Add Project</button>
            </div>
          </motion.div>
        )}

        {activeTab === "raw" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="card col gap-4" style={{ padding: 24 }}>
            <div className="eyebrow">Raw Text Aggregator</div>
            <textarea className="field-input" placeholder="Paste unstructured text from LinkedIn, personal websites, or notes…" rows={16} value={rawText} onChange={v => setRawText(v.target.value)} style={{ fontSize: 14, lineHeight: 1.6 }} />
            <button className="btn btn-primary" style={{ padding: 16, fontSize: 15 }} onClick={ingestRaw} disabled={status==="loading"}>
              {status === "loading" ? "Processing…" : "Sync Raw Context"}
            </button>
          </motion.div>
        )}

        {activeTab === "linkedin" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="col gap-4">
            <div
              className="card col gap-4"
              style={{ padding: "48px 32px", alignItems: "center", textAlign: "center", border: "2px dashed var(--line)", background: "var(--paper-2)", cursor: "pointer" }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f && f.name.endsWith(".zip")) { setLinkedinFile(f); setLinkedinResult(null); }
              }}
              onClick={() => document.getElementById("linkedin-zip-in")?.click()}
            >
              <div style={{ width: 64, height: 64, borderRadius: 16, background: "var(--teal-soft)", color: "var(--teal)", display: "grid", placeItems: "center" }}><Icon name="upload" size={28} /></div>
              <div style={{ fontWeight: 600, fontSize: 18 }}>
                {linkedinFile ? linkedinFile.name : "Drop your LinkedIn data export (.zip) here"}
              </div>
              <div style={{ fontSize: 14, color: "var(--ink-3)", maxWidth: 400, lineHeight: 1.5 }}>
                {linkedinFile ? "File ready to import." : "or click to browse"}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-4)", maxWidth: 420, lineHeight: 1.6, marginTop: 4 }}>
                How to get it: LinkedIn → Settings → Data Privacy → Get a copy of your data
              </div>
              <input type="file" accept=".zip" id="linkedin-zip-in" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) { setLinkedinFile(f); setLinkedinResult(null); } }} />
            </div>
            <button className="btn btn-primary" style={{ padding: 16, fontSize: 15 }}
              disabled={!linkedinFile || status === "loading"}
              onClick={ingestLinkedin}>
              {status === "loading" ? "Importing…" : "Import LinkedIn data"}
            </button>
            {linkedinResult && (
              <div style={{
                padding: 16,
                background: linkedinResult.status === "ok" ? "var(--green-soft)" : "var(--paper-3)",
                color: linkedinResult.status === "ok" ? "var(--green-ink)" : "var(--ink-2)",
                borderRadius: 12,
                border: `1px solid ${linkedinResult.status === "ok" ? "var(--green)" : "var(--line)"}`,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Imported: {linkedinResult.stats?.skills ?? 0} skills · {linkedinResult.stats?.experience ?? 0} jobs · {linkedinResult.stats?.projects ?? 0} projects · {linkedinResult.stats?.certifications ?? 0} certifications
                </div>
                {linkedinResult.status === "partial" && (
                  <div style={{ fontSize: 13, marginTop: 4, color: "var(--ink-3)" }}>Some items could not be imported.</div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "github" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="col gap-4">
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>GitHub username</h3>
              <input className="field-input" placeholder="e.g. torvalds" value={githubUsername}
                onChange={e => setGithubUsername(e.target.value)} />
              <button className="btn btn-ghost" style={{ alignSelf: "flex-start", fontSize: 13, padding: "6px 12px" }}
                onClick={() => setShowToken(t => !t)}>
                {showToken ? "− Hide token" : "+ Add GitHub token for higher rate limits"}
              </button>
              {showToken && (
                <div className="col gap-2">
                  <input className="field-input" type="password" placeholder="ghp_…" value={githubToken}
                    onChange={e => setGithubToken(e.target.value)} />
                  <div style={{ fontSize: 12, color: "var(--ink-4)", lineHeight: 1.5 }}>
                    Optional — increases API rate limit from 60 to 5,000 req/hr. Never stored remotely.
                  </div>
                </div>
              )}
              <div className="row gap-3" style={{ alignItems: "center" }}>
                <span style={{ fontSize: 14, color: "var(--ink-2)" }}>Max repos to scan:</span>
                <input className="field-input" type="number" min={1} max={30} value={githubMaxRepos}
                  style={{ width: 80 }}
                  onChange={e => setGithubMaxRepos(Math.max(1, Math.min(30, parseInt(e.target.value) || 12)))} />
              </div>
            </div>
            <button className="btn btn-primary" style={{ padding: 16, fontSize: 15 }}
              disabled={!githubUsername.trim() || status === "loading"}
              onClick={ingestGithub}>
              {status === "loading" ? "Fetching repos and reading READMEs…" : "Scan GitHub profile"}
            </button>
            {githubResult && !githubResult.errorMsg && (
              <div className="card col gap-3" style={{ padding: 24 }}>
                <div className="row gap-3" style={{ alignItems: "center" }}>
                  {githubResult.github_user?.avatar
                    ? <img src={githubResult.github_user.avatar} alt="avatar" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} />
                    : <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--teal-soft)", color: "var(--teal)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
                        {(githubResult.github_user?.login?.[0] ?? "?").toUpperCase()}
                      </div>
                  }
                  <div>
                    <div style={{ fontWeight: 600 }}>@{githubResult.github_user?.login}</div>
                    {githubResult.github_user?.bio && (
                      <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>{githubResult.github_user.bio}</div>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 14, color: "var(--ink-2)" }}>
                  Found {githubResult.stats?.repos_fetched ?? 0} repos · Extracted {githubResult.stats?.projects_extracted ?? 0} projects
                </div>
                {githubResult.errors?.length > 0 && (
                  <div style={{ fontSize: 13, color: "var(--ink-4)" }}>Some items skipped</div>
                )}
              </div>
            )}
            {githubResult?.errorMsg && (
              <div style={{ padding: 16, background: "var(--bad-soft)", color: "var(--bad)", borderRadius: 12, border: "1px solid var(--bad)", fontSize: 14 }}>
                {githubResult.errorMsg}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "portfolio" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="col gap-4">
            <div className="card col gap-4" style={{ padding: 24 }}>
              <h3 style={{ fontSize: 16, fontWeight: 600 }}>Your portfolio / personal site URL</h3>
              <input className="field-input" placeholder="https://yoursite.com" value={portfolioUrl}
                onChange={e => { setPortfolioUrl(e.target.value); setPortfolioResult(null); }} />
              <button className="btn btn-primary" style={{ alignSelf: "flex-start", padding: "10px 24px" }}
                disabled={!portfolioUrl.trim() || status === "loading"}
                onClick={() => scanPortfolio(false)}>
                {status === "loading" ? "Fetching and reading your site..." : "Scan portfolio"}
              </button>
            </div>
            {portfolioResult?.errorMsg && (
              <div style={{ padding: 16, background: "var(--bad-soft)", color: "var(--bad)", borderRadius: 12, border: "1px solid var(--bad)", fontSize: 14 }}>
                {portfolioResult.errorMsg}
              </div>
            )}
            {portfolioResult && !portfolioResult.errorMsg && (
              <div className="card col gap-3" style={{ padding: 24 }}>
                {portfolioResult.screenshot_b64 && (
                  <img src={`data:image/png;base64,${portfolioResult.screenshot_b64}`} alt="Portfolio screenshot" style={{ maxHeight: 160, width: "100%", objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }} />
                )}
                {portfolioResult.candidate ? (
                  <>
                    <div style={{ fontSize: 14, color: "var(--ink-2)" }}>
                      Found {portfolioResult.stats?.skills ?? 0} skills Â· {portfolioResult.stats?.projects ?? 0} projects
                    </div>
                    {portfolioResult.imported ? (
                      <div style={{ padding: 12, background: "var(--green-soft)", color: "var(--green-ink)", borderRadius: 8, border: "1px solid var(--green)", fontWeight: 600 }}>
                        Imported!
                      </div>
                    ) : (
                      <button className="btn btn-primary" style={{ alignSelf: "flex-start", padding: "10px 24px" }}
                        disabled={status === "loading"}
                        onClick={() => scanPortfolio(true)}>
                        Import to Knowledge Brain
                      </button>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
                    {portfolioResult.error || "No structured data was extracted."}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "json-import" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="col gap-4">
            <div className="card col gap-4" style={{ padding: 24 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600 }}>Paste your profile JSON here</h3>
                <button className="btn btn-ghost" style={{ fontSize: 13, padding: "8px 12px", flexShrink: 0 }}
                  onClick={downloadProfileTemplate}>
                  Download template
                </button>
              </div>
              <textarea className="field-input" value={jsonText}
                onChange={e => { setJsonText(e.target.value); setJsonError(null); setJsonResult(null); }}
                placeholder={`{\n  "candidate": { "name": "..." },\n  "skills": []\n}`}
                style={{ minHeight: 220, fontSize: 13, lineHeight: 1.6, fontFamily: "var(--font-mono)" }} />
              <button className="btn btn-primary" style={{ alignSelf: "flex-start", padding: "10px 24px" }}
                disabled={!jsonText.trim() || status === "loading"}
                onClick={importProfileJson}>
                {status === "loading" ? "Importing..." : "Import profile"}
              </button>
            </div>
            {jsonError && (
              <div style={{ padding: 16, background: "var(--bad-soft)", color: "var(--bad)", borderRadius: 12, border: "1px solid var(--bad)", fontSize: 14 }}>
                {jsonError}
              </div>
            )}
            {jsonResult && (
              <div style={{
                padding: 16,
                background: jsonResult.status === "ok" ? "var(--green-soft)" : "var(--paper-3)",
                color: jsonResult.status === "ok" ? "var(--green-ink)" : "var(--ink-2)",
                borderRadius: 12,
                border: `1px solid ${jsonResult.status === "ok" ? "var(--green)" : "var(--line)"}`,
              }}>
                <div style={{ fontWeight: 600 }}>
                  Imported: {jsonResult.stats?.skills ?? 0} skills Â· {jsonResult.stats?.experience ?? 0} jobs Â· {jsonResult.stats?.projects ?? 0} projects Â· {jsonResult.stats?.certifications ?? 0} certifications
                </div>
                {jsonResult.status === "partial" && (
                  <div style={{ fontSize: 13, marginTop: 4, color: "var(--ink-3)" }}>Some items were skipped.</div>
                )}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "template" && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="col gap-4">
            <div className="card" style={{ padding: 24, background: "var(--purple-soft)", border: "1px solid var(--purple)" }}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Resume Template</h3>
              <p style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
                Paste your preferred resume format here (plain text or Markdown). When the agent generates a tailored resume, it will follow this structure — section order, headings, and layout — and fill it in with your profile and the job's requirements.
              </p>
            </div>
            <div className="card col gap-4" style={{ padding: 24 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>Template content</span>
                {template && <span className="pill mono" style={{ fontSize: 10, background: "var(--green-soft)", color: "var(--green-ink)", border: "1px solid var(--green)" }}>Template saved</span>}
              </div>
              <textarea
                className="field-input"
                placeholder={`Paste your resume template here. For example:\n\n# [Name]\n[Contact info]\n\n## Summary\n[2-3 sentence professional summary]\n\n## Experience\n### [Role] — [Company] ([Period])\n- [Bullet points]\n\n## Projects\n### [Project Name]\n- Stack: ...\n- Impact: ...\n\n## Skills\n[Comma-separated list]`}
                rows={24}
                value={template}
                onChange={e => setTemplate(e.target.value)}
                style={{ fontSize: 13, lineHeight: 1.65, fontFamily: "var(--font-mono)" }}
              />
              <div className="row gap-3" style={{ alignItems: "center" }}>
                <button className="btn btn-primary" style={{ padding: "12px 28px", fontSize: 14 }} onClick={saveTemplate} disabled={status==="loading"}>
                  {status === "loading" ? "Saving…" : "Save Template"}
                </button>
                {template && (
                  <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => { setTemplate(""); }}>
                    Clear
                  </button>
                )}
                <span style={{ fontSize: 12, color: "var(--ink-4)" }}>{template.length} chars</span>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   APPROVAL DRAWER
══════════════════════════════════════ */
