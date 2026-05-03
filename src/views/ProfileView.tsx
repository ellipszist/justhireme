import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import type { ApiFetch, View } from "../types";

const stackItems = (stack: any): string[] =>
  (Array.isArray(stack) ? stack : String(stack || "").split(","))
    .map((s: string) => s.trim())
    .filter(Boolean);

export function ProfileView({ api, setView }: { api: ApiFetch; setView: (v: View) => void }) {
  const [profile, setProfile] = useState<any>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [editingCandidate, setEditingCandidate] = useState(false);
  const [candForm, setCandForm] = useState({ n: "", s: "" });
  const [activeProfileTab, setActiveProfileTab] = useState<"skills" | "experience" | "projects">("skills");
  const [expandedProfileList, setExpandedProfileList] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      const r = await api(`/api/v1/profile`);
      if (!r.ok) throw new Error(`Profile load failed (${r.status})`);
      const data = await r.json();
      if (!data || !Array.isArray(data.skills) || !Array.isArray(data.projects) || !Array.isArray(data.exp)) {
        throw new Error("Profile response was not a valid identity graph");
      }
      setProfile(data);
      setProfileErr(null);
    } catch (err: any) {
      console.error("Profile load failed:", err);
      setProfileErr(err?.message || "Profile load failed");
    }
  }, [api]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);
  useEffect(() => { setExpandedProfileList(false); }, [activeProfileTab]);
  useEffect(() => {
    const exportProfile = () => {
      if (!profile) return;
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${profile.n || "identity-graph"}.json`.replace(/[^\w.-]+/g, "-");
      a.click();
      URL.revokeObjectURL(url);
    };
    window.addEventListener("profile-export", exportProfile);
    return () => window.removeEventListener("profile-export", exportProfile);
  }, [profile]);

  const deleteItem = async (type: string, id: string) => {
    if (!window.confirm("Delete this item?")) return;
    try {
      const res = await api(`/api/v1/profile/${type}/${id}`, { method: "DELETE" });
      if (!res.ok) console.error("Delete failed:", res.status);
    } catch (err) {
      console.error("Delete error:", err);
    }
    await fetchProfile();
  };

  const saveEdit = async (type: string, id: string) => {
    await api(`/api/v1/profile/${type}/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editData),
    });
    setEditId(null); fetchProfile();
  };

  const saveCandidate = async () => {
    await api(`/api/v1/profile/candidate`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(candForm),
    });
    setEditingCandidate(false); fetchProfile();
  };

  const skills = profile?.skills || [];
  const exp = profile?.exp || [];
  const projects = profile?.projects || [];
  const evidenceCount = skills.length + exp.length + projects.length;
  const topStacks = Array.from(new Set<string>(projects.flatMap((p: any) => stackItems(p.stack)))).slice(0, 10);
  const visibleStacks = topStacks.slice(0, 6);
  const summary = String(profile?.s || "").replace(/\s+/g, " ").trim();
  const summaryPreview = summary
    ? summary.length > 265 ? `${summary.slice(0, 262).trim()}...` : summary
    : "Add your name and target role summary above. This becomes the anchor for scoring and document generation.";
  const skillRanks = useMemo(() => {
    const counts = new Map<string, { label: string; count: number; cat: string; id: string }>();
    const bump = (label: string, weight = 1, cat = "general", id = "") => {
      const clean = String(label || "").trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      const prev = counts.get(key);
      counts.set(key, { label: prev?.label || clean, count: (prev?.count || 0) + weight, cat: prev?.cat || cat, id: prev?.id || id });
    };
    skills.forEach((s: any) => bump(s.n, 1, s.cat, s.id));
    projects.forEach((p: any) => stackItems(p.stack).forEach(name => bump(name, 3)));
    exp.forEach((e: any) => (Array.isArray(e.s) ? e.s : stackItems(e.s)).forEach((name: string) => bump(name, 2)));
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [skills, projects, exp]);
  const previewSkills = expandedProfileList ? skillRanks : skillRanks.slice(0, 10);
  const previewExp = expandedProfileList ? exp : exp.slice(0, 6);
  const previewProjects = expandedProfileList ? projects : projects.slice(0, 8);
  const listTotal = activeProfileTab === "skills" ? skillRanks.length : activeProfileTab === "experience" ? exp.length : projects.length;
  const listShown = activeProfileTab === "skills" ? previewSkills.length : activeProfileTab === "experience" ? previewExp.length : previewProjects.length;
  const graphNodes = [
    { id: "skills" as const, label: "Skills", count: skills.length, tone: "blue", icon: "spark" },
    { id: "experience" as const, label: "Experience", count: exp.length, tone: "orange", icon: "brief" },
    { id: "projects" as const, label: "Projects", count: projects.length, tone: "pink", icon: "layers" },
  ];

  return (
    <div className="scroll profile-page">
      <div className="profile-shell profile-shell-compact">
        {profileErr && (
          <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 8, background: "var(--bad-soft)", border: "1px solid var(--bad)", color: "var(--bad)", fontSize: 13 }}>
            Could not refresh the Identity Graph. Your existing profile was not overwritten.
          </div>
        )}
        <div className="profile-workspace">
          <aside className="profile-left-rail">
            <div className="card profile-identity-card">
              <div className="profile-identity-head">
                <div className="profile-avatar">{(profile?.n || "C").slice(0, 1).toUpperCase()}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="eyebrow">Identity Context</span>
                  <h1 className="profile-name">{profile?.n || "Candidate Profile"}</h1>
                </div>
                {!editingCandidate && (
                  <button className="btn profile-edit-btn" onClick={() => { setEditingCandidate(true); setCandForm({ n: profile?.n || "", s: profile?.s || "" }); }}>
                    <Icon name="edit" size={13} /> Edit
                  </button>
                )}
              </div>

          {editingCandidate ? (
            <div className="col gap-3" style={{ marginTop: 18 }}>
              <input className="field-input" placeholder="Your full name" value={candForm.n} onChange={e => setCandForm({ ...candForm, n: e.target.value })} style={{ fontSize: 18, fontWeight: 600 }} />
              <textarea className="field-input" placeholder="Professional summary / target role - agents use this for scoring" rows={4} value={candForm.s} onChange={e => setCandForm({ ...candForm, s: e.target.value })} style={{ fontSize: 14, lineHeight: 1.6 }} />
              <div className="row gap-2">
                <button className="btn btn-primary" style={{ padding: "10px 24px" }} onClick={saveCandidate}>Save Identity</button>
                <button className="btn btn-ghost" onClick={() => setEditingCandidate(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <p className="profile-summary">{summaryPreview}</p>
              <div className="profile-pill-row">
                <span className="pill mono">{skills.length} SKILLS</span>
                <span className="pill mono">{exp.length} ROLES</span>
                <span className="pill mono">{projects.length} PROJECTS</span>
              </div>
            </>
          )}
            </div>

            <div className="card profile-signal-card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <span className="eyebrow">Graph Signal</span>
                  <div className="display tabular" style={{ fontSize: 44, color: "var(--pink-ink)", marginTop: 6 }}>{evidenceCount}</div>
                </div>
                <Icon name="pulse" size={18} color="var(--pink-ink)" />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55, marginTop: 8 }}>Evidence available for matching and application package generation.</div>
              {visibleStacks.length > 0 && (
                <div className="profile-stack-mini">
                  {visibleStacks.map(s => <span key={s} className="pill">{s}</span>)}
                </div>
              )}
              <button className="profile-add-context" onClick={() => setView("ingestion")}>
                <Icon name="plus" size={14} /> Add Context
              </button>
            </div>
          </aside>

          <main className="profile-main-panel">
            <section className="card profile-map-card">
              <div className="profile-map-head">
                <div>
                  <span className="eyebrow">Relationship View</span>
                  <h3>Candidate Evidence Map</h3>
                </div>
                <span className="pill mono">{topStacks.length} STACK TAGS</span>
              </div>
              <div className="profile-map-visual">
                <svg className="profile-map-connectors" viewBox="0 0 980 205" preserveAspectRatio="none" aria-hidden="true">
                  <path className="profile-connector profile-connector-blue" d="M235 111 C330 111 385 111 445 111" />
                  <path className="profile-connector profile-connector-orange" d="M565 111 C650 111 646 52 730 52 C760 52 762 52 790 52" />
                  <path className="profile-connector profile-connector-purple" d="M565 111 C650 111 646 168 730 168 C760 168 762 168 790 168" />
                </svg>
                <div className="profile-map-node profile-map-center-node">
                  <div className="profile-map-icon"><Icon name="user" size={18} /></div>
                  <strong>{profile?.n || "Candidate"}</strong>
                  <span>{evidenceCount} evidence items</span>
                </div>
                {graphNodes.map(node => (
                  <button
                    key={node.id}
                    className={`profile-map-node profile-map-node-${node.id} ${activeProfileTab === node.id ? "active" : ""}`}
                    onClick={() => { setActiveProfileTab(node.id); setEditId(null); }}
                    style={{ color: `var(--${node.tone}-ink)` }}
                  >
                    <div className="profile-map-icon" style={{ background: `var(--${node.tone}-soft)`, borderColor: `var(--${node.tone})` }}>
                      <Icon name={node.icon} size={17} />
                    </div>
                    <div className="profile-map-copy">
                      <strong>{node.label}</strong>
                      <span className="tabular">{node.count}</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="card profile-tab-card">
              <div className="profile-tabs">
                {graphNodes.map(node => (
                  <button
                    key={node.id}
                    className={activeProfileTab === node.id ? "active" : ""}
                    onClick={() => { setActiveProfileTab(node.id); setEditId(null); }}
                  >
                    <Icon name={node.icon} size={14} />
                    <span>{node.label}</span>
                    <span className="mono">{node.count}</span>
                  </button>
                ))}
              </div>

              <div className="profile-tab-scroll">
                {activeProfileTab === "skills" && (
                  <div className="profile-skill-grid">
                    {skillRanks.length === 0 && <div className="profile-empty">No skills yet.</div>}
                    {previewSkills.map((s, idx) => {
                      const tone = ["blue", "yellow", "purple", "green", "orange", "teal"][idx % 6];
                      return (
                        <div key={`${s.id || s.label}-${idx}`} className={`profile-list-tile profile-list-tile-${tone}`}>
                          <div className="profile-list-leading">
                            <Icon name="check" size={14} />
                            <span>{s.label}</span>
                          </div>
                          <div className="profile-list-trailing">
                            <span className="profile-count-badge">{s.count}</span>
                            {s.id ? (
                              <button className="profile-row-action" onClick={() => deleteItem("skill", s.id)} title="Delete skill">
                                <Icon name="arrow-right" size={14} />
                              </button>
                            ) : (
                              <Icon name="arrow-right" size={14} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeProfileTab === "experience" && (
                  <div className="profile-timeline">
                    {exp.length === 0 && <div className="profile-empty">No experience recorded.</div>}
                    {previewExp.map((e: any, idx: number) => (
                      <div key={e.id} className="profile-timeline-item">
                        {editId === e.id ? (
                          <div className="col gap-3">
                            <div className="grid-2 gap-3">
                              <input className="field-input" value={editData.role} placeholder="Role" onChange={v => setEditData({ ...editData, role: v.target.value })} />
                              <input className="field-input" value={editData.co} placeholder="Company" onChange={v => setEditData({ ...editData, co: v.target.value })} />
                            </div>
                            <input className="field-input" value={editData.period} placeholder="Period" onChange={v => setEditData({ ...editData, period: v.target.value })} />
                            <textarea className="field-input" value={editData.d} rows={4} placeholder="Description" onChange={v => setEditData({ ...editData, d: v.target.value })} />
                            <div className="row gap-2">
                              <button className="btn btn-primary" onClick={() => saveEdit("experience", e.id)}>Save</button>
                              <button className="btn btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="col gap-1">
                            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                              <div className="col">
                                <div className="profile-card-title">{e.role}</div>
                                <div className="row gap-2" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>
                                  <span>{e.co}</span><span style={{ color: "var(--ink-4)" }}>-</span><span className="mono" style={{ fontSize: 11 }}>{e.period}</span>
                                </div>
                              </div>
                              <div className="row gap-2">
                                <span className="profile-count-badge">{idx + 1}</span>
                                <button className="btn-icon profile-mini-action" onClick={() => { setEditId(e.id); setEditData({ ...e }); }}><Icon name="edit" size={14} /></button>
                                <button className="btn-icon profile-mini-action profile-danger" onClick={() => deleteItem("experience", e.id)}><Icon name="trash" size={14} /></button>
                              </div>
                            </div>
                            {e.d && <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, marginTop: 10, whiteSpace: "pre-wrap" }}>{e.d}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {activeProfileTab === "projects" && (
                  <div className="profile-project-grid">
                    {projects.length === 0 && <div className="profile-empty">No projects mapped.</div>}
                    {previewProjects.map((p: any, idx: number) => (
                      <div key={p.id} className="profile-project-card">
                        {editId === p.id ? (
                          <div className="col gap-3">
                            <input className="field-input" value={editData.title} placeholder="Title" onChange={v => setEditData({ ...editData, title: v.target.value })} />
                            <input className="field-input" value={editData.stack} placeholder="Stack (comma-separated)" onChange={v => setEditData({ ...editData, stack: v.target.value })} />
                            <input className="field-input" value={editData.repo} placeholder="Repo URL" onChange={v => setEditData({ ...editData, repo: v.target.value })} />
                            <textarea className="field-input" value={editData.impact} rows={4} placeholder="Impact" onChange={v => setEditData({ ...editData, impact: v.target.value })} />
                            <div className="row gap-2">
                              <button className="btn btn-primary" onClick={() => saveEdit("project", p.id)}>Save</button>
                              <button className="btn btn-ghost" onClick={() => setEditId(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="col gap-1">
                            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                              <div className="profile-card-title">{p.title}</div>
                              <div className="row gap-2">
                                <span className="profile-count-badge">{idx + 1}</span>
                                <button className="btn-icon profile-mini-action" onClick={() => { setEditId(p.id); setEditData({ ...p, stack: stackItems(p.stack).join(", ") }); }}><Icon name="edit" size={14} /></button>
                                <button className="btn-icon profile-mini-action profile-danger" onClick={() => deleteItem("project", p.id)}><Icon name="trash" size={14} /></button>
                              </div>
                            </div>
                            <div className="row gap-1" style={{ flexWrap: "wrap", margin: "8px 0 10px" }}>
                              {stackItems(p.stack).map((s: string, i: number) => (
                                <span key={i} className="pill" style={{ fontSize: 11, padding: "4px 10px", background: "var(--pink-soft)", color: "var(--pink-ink)", border: "1px solid var(--pink)" }}>{s.trim()}</span>
                              ))}
                            </div>
                            {p.impact && <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>{p.impact}</div>}
                            {p.repo && <div className="row gap-2" style={{ marginTop: 10 }}><Icon name="link" size={12} color="var(--ink-3)" /><a href={p.repo} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--ink-3)" }}>{p.repo}</a></div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {listTotal > listShown && (
                  <button className="profile-view-all" onClick={() => setExpandedProfileList(true)}>
                    View all {activeProfileTab} <Icon name="arrow-right" size={13} />
                  </button>
                )}
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   INGESTION VIEW
══════════════════════════════════════ */
