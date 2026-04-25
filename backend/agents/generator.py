import os
from db.client import conn

_assets = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    "BoomBoom", "assets",
)
os.makedirs(_assets, exist_ok=True)


def _proof(skills: list[str]) -> str:
    parts = []
    for sk in skills:
        q = conn.execute(
            "MATCH (p:Project)-[:PROJ_UTILIZES]->(s:Skill) WHERE s.n=$n RETURN p.title,p.stack,p.impact",
            {"n": sk},
        )
        while q.has_next():
            r = q.get_next()
            parts.append(f"Project: {r[0]} | Stack: {r[1]} | Impact: {r[2]}")
        q = conn.execute(
            "MATCH (e:Experience)-[:EXP_UTILIZES]->(s:Skill) WHERE s.n=$n RETURN e.role,e.co,e.d",
            {"n": sk},
        )
        while q.has_next():
            r = q.get_next()
            parts.append(f"Role: {r[0]} at {r[1]} | {r[2]}")
    return "\n".join(parts) if parts else ""


def _candidate() -> dict:
    q = conn.execute("MATCH (c:Candidate) RETURN c.n, c.s LIMIT 1")
    if q.has_next():
        r = q.get_next()
        return {"name": r[0], "summary": r[1]}
    return {"name": "Candidate", "summary": ""}


def _draft(p: str, j: dict) -> str:
    from llm import call_raw
    mp = "\n".join(f"- {pt}" for pt in j.get("match_points", []))
    return call_raw(
        "You are an expert resume and cover letter writer. "
        "Generate a tailored, ATS-optimised resume followed by a cover letter in Markdown. "
        "Use ## Resume and ## Cover Letter as section headers. "
        "Explicitly weave in the provided match points. "
        "Keep language concise, factual, and impactful.",
        f"JOB: {j.get('title','')} at {j.get('company','')}\n\n"
        f"MATCH POINTS:\n{mp}\n\n"
        f"CANDIDATE PROOF OF WORK:\n{p}",
    )


def _render(m: str, f: str) -> str:
    import markdown as _md
    from fpdf import FPDF, HTMLMixin

    class _PDF(FPDF, HTMLMixin):
        pass

    h = _md.markdown(m, extensions=["tables", "fenced_code"])
    pdf = _PDF()
    pdf.add_page()
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.set_font("Helvetica", size=11)
    pdf.write_html(h)
    out = os.path.join(_assets, f)
    pdf.output(out)
    return out


def run(lead: dict) -> str:
    c = _candidate()
    skills = lead.get("skills", [])
    p = _proof(skills)
    m = _draft(p, lead)
    path = _render(m, f"{lead['job_id']}.pdf")
    return path
