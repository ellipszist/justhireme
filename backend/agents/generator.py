import os
import re
from pydantic import BaseModel, Field
from db.client import get_profile

_assets = os.path.join(
    os.environ.get("LOCALAPPDATA", os.path.expanduser("~")),
    "BoomBoom", "assets",
)
os.makedirs(_assets, exist_ok=True)


class _DocPackage(BaseModel):
    selected_projects: list[str] = Field(default_factory=list)
    resume_markdown: str = Field(
        default="",
        description="Only the tailored resume markdown. Must not include a cover letter section.",
    )
    cover_letter_markdown: str = Field(
        default="",
        description="Only the tailored cover letter markdown. Must not include resume content.",
    )


def _build_proof(profile: dict) -> str:
    """Build proof-of-work string from profile dict -- avoids dead PROJ_UTILIZES graph edges."""
    parts = []
    for proj in profile.get("projects", []):
        stack = proj.get("stack", [])
        if isinstance(stack, list):
            stack = ", ".join(stack)
        title  = proj.get("title", "")
        impact = proj.get("impact", "")
        if title:
            parts.append(f"Project: {title} | Stack: {stack} | Impact: {impact}")
    for exp in profile.get("exp", []):
        role   = exp.get("role", "")
        co     = exp.get("co", "")
        period = exp.get("period", "")
        desc   = exp.get("d", "")
        if role:
            parts.append(f"Role: {role} at {co} ({period}) | {desc}")
    skills = [s["n"] for s in profile.get("skills", []) if s.get("n")]
    if skills:
        parts.append(f"Skills: {', '.join(skills)}")
    return "\n".join(parts) if parts else ""


def _keywords(text: str) -> set[str]:
    stop = {
        "and", "the", "with", "for", "from", "that", "this", "you", "are",
        "job", "role", "engineer", "developer", "company", "team", "will",
        "have", "has", "using", "build", "work", "your", "their",
    }
    return {t for t in re.findall(r"[a-zA-Z][a-zA-Z0-9+#.-]{1,}", text.lower()) if t not in stop}


def _rank_projects(profile: dict, lead: dict, limit: int = 4) -> list[dict]:
    jd = " ".join([
        lead.get("title", ""),
        lead.get("company", ""),
        lead.get("description", ""),
        lead.get("reason", ""),
        " ".join(lead.get("match_points", []) or []),
    ])
    target = _keywords(jd)
    ranked = []
    for project in profile.get("projects", []):
        stack = project.get("stack", [])
        stack_text = ", ".join(stack) if isinstance(stack, list) else str(stack)
        text = " ".join([
            project.get("title", ""),
            stack_text,
            project.get("impact", ""),
        ])
        tokens = _keywords(text)
        stack_hits = len(target.intersection(_keywords(stack_text))) * 3
        score = len(target.intersection(tokens)) + stack_hits
        ranked.append((score, project))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [p for idx, (score, p) in enumerate(ranked[:limit]) if p.get("title") and (score > 0 or idx < 2)]


def _profile_payload(profile: dict) -> dict:
    return {
        "candidate": {"name": profile.get("n", ""), "summary": profile.get("s", "")},
        "skills": profile.get("skills", []),
        "experience": profile.get("exp", []),
        "projects": profile.get("projects", []),
    }


_COVER_HEADING_RE = re.compile(
    r"(?im)^(?:#{1,6}\s*)?(?:\*\*)?\s*cover\s+letter\s*(?:\*\*)?\s*:?\s*$"
)


def _strip_doc_heading(text: str, heading: str) -> str:
    pattern = re.compile(
        rf"(?im)^\s*(?:#{{1,6}}\s*)?(?:\*\*)?\s*{re.escape(heading)}\s*(?:\*\*)?\s*:?\s*$"
    )
    return pattern.sub("", text, count=1).strip()


def _is_trivial_doc(text: str, kind: str) -> bool:
    cleaned = re.sub(r"(?im)^\s*(?:#{1,6}\s*)?(resume|cover\s+letter)\s*:?\s*$", "", text or "")
    cleaned = re.sub(r"[*_`#>\-\s]+", " ", cleaned).strip()
    alpha = re.sub(r"[^A-Za-z]+", "", cleaned)
    if not alpha:
        return True
    # A useful cover letter needs more than a salutation/signoff stub.
    if kind == "cover" and len(cleaned) < 120:
        return True
    return kind == "resume" and len(cleaned) < 160


def _split_cover_from_resume(text: str) -> tuple[str, str]:
    match = _COVER_HEADING_RE.search(text or "")
    if not match:
        return text or "", ""
    resume = (text or "")[:match.start()].strip()
    cover = (text or "")[match.start():].strip()
    return resume, cover


def _normalize_package(package: _DocPackage, profile: dict, lead: dict, template: str = "") -> _DocPackage:
    """Defensively split combined LLM output into two real documents."""
    resume = package.resume_markdown or ""
    cover = package.cover_letter_markdown or ""

    resume_without_cover, extracted_cover = _split_cover_from_resume(resume)
    if extracted_cover:
        resume = resume_without_cover
        if _is_trivial_doc(cover, "cover"):
            cover = extracted_cover

    # Some models put both documents in the cover field instead.
    cover_resume, cover_only = _split_cover_from_resume(cover)
    if cover_only:
        if _is_trivial_doc(resume, "resume") and not _is_trivial_doc(cover_resume, "resume"):
            resume = cover_resume
        cover = cover_only

    resume = _strip_doc_heading(resume, "Resume")
    cover = _strip_doc_heading(cover, "Cover Letter")

    fallback = None
    if _is_trivial_doc(resume, "resume") or _is_trivial_doc(cover, "cover"):
        fallback = _fallback_package(profile, lead, template=template)
    if _is_trivial_doc(resume, "resume") and fallback:
        resume = fallback.resume_markdown
    if _is_trivial_doc(cover, "cover") and fallback:
        cover = fallback.cover_letter_markdown

    selected = [str(p).strip() for p in package.selected_projects if str(p).strip()]
    if not selected:
        selected = [
            p.get("title", "") for p in _rank_projects(profile, lead, limit=4) if p.get("title")
        ]
    if not selected and fallback:
        selected = fallback.selected_projects

    package.resume_markdown = resume.strip()
    package.cover_letter_markdown = cover.strip()
    package.selected_projects = selected
    return package


def _fallback_package(profile: dict, lead: dict, template: str = "") -> _DocPackage:
    selected = _rank_projects(profile, lead, limit=3)
    name = profile.get("n") or "Candidate"
    target = profile.get("s") or lead.get("title", "Software Engineer")
    skills = [s.get("n", "") for s in profile.get("skills", []) if s.get("n")]

    project_lines = []
    for p in selected:
        stack = p.get("stack", [])
        stack_text = ", ".join(stack) if isinstance(stack, list) else str(stack)
        project_lines.append(
            f"### {p.get('title','Project')}\n"
            f"- Stack: {stack_text}\n"
            f"- Impact: {p.get('impact','Relevant project experience aligned to the role.')}"
        )
    if not project_lines:
        project_lines.append("- Add projects to the Identity Graph for stronger tailoring.")

    exp_lines = []
    for e in profile.get("exp", [])[:3]:
        exp_lines.append(
            f"### {e.get('role','Role')} - {e.get('co','Company')} ({e.get('period','')})\n"
            f"- {e.get('d','Relevant professional experience.')}"
        )

    resume = f"""# {name}

## Summary
{target}

Tailored for {lead.get('title','the role')} at {lead.get('company','the company')}, highlighting direct proof of work against the job requirements.

## Core Skills
{", ".join(skills[:24])}

## Selected Projects
{chr(10).join(project_lines)}

## Experience
{chr(10).join(exp_lines) if exp_lines else "- Add experience to the Identity Graph for stronger tailoring."}
"""
    cover = f"""# Cover Letter

Dear {lead.get('company','Hiring Team')} team,

I am excited to apply for the {lead.get('title','open role')} position. My background combines {", ".join(skills[:6]) if skills else "hands-on software delivery"} with project work that maps directly to the requirements in your job description.

The strongest examples from my profile are {", ".join(p.get('title','Project') for p in selected) if selected else "the projects in my portfolio"}. These demonstrate practical experience I can bring to {lead.get('company','your team')} from day one.

Thank you for your time and consideration.

Sincerely,
{name}
"""
    return _DocPackage(
        selected_projects=[p.get("title", "") for p in selected if p.get("title")],
        resume_markdown=resume,
        cover_letter_markdown=cover,
    )


def _draft_package(profile: dict, proof: str, j: dict, template: str = "") -> _DocPackage:
    from llm import call_llm
    import json

    recommended = _rank_projects(profile, j, limit=4)
    template_instruction = (
        "Use the provided resume template as the resume structure. Preserve section order and heading style where practical. "
        "Do not force the cover letter into the resume template."
        if template else
        "Use a crisp ATS-friendly resume structure."
    )
    system = (
        "You are an expert technical recruiter and resume writer. Generate a separate tailored resume "
        "and separate cover letter for one job. Select the strongest 2-4 projects from the candidate profile "
        "based on the job description, company, required stack, seniority, and evaluator match points. "
        "Use only facts present in the candidate profile; do not invent employers, metrics, degrees, tools, or project outcomes. "
        "The resume must emphasize relevant skills, experience, selected projects, and ATS keywords. "
        "The cover letter must be specific to the company and role, concise, and evidence-based. "
        "Never include any cover letter heading, salutation, or letter body inside resume_markdown. "
        "Never include resume sections, skills lists, or project lists inside cover_letter_markdown unless referenced naturally in prose. "
        "Return valid structured output only."
    )
    user = (
        f"JOB TITLE: {j.get('title','')}\n"
        f"COMPANY: {j.get('company','')}\n"
        f"URL: {j.get('url','')}\n"
        f"JOB DESCRIPTION:\n{j.get('description','')}\n\n"
        f"EVALUATOR SCORE: {j.get('score', 0)}\n"
        f"EVALUATOR REASON:\n{j.get('reason','')}\n\n"
        f"MATCH POINTS:\n{json.dumps(j.get('match_points', []) or [], ensure_ascii=False)}\n"
        f"GAPS:\n{json.dumps(j.get('gaps', []) or [], ensure_ascii=False)}\n\n"
        f"RECOMMENDED PROJECT SHORTLIST:\n{json.dumps(recommended, ensure_ascii=False)}\n\n"
        f"FULL CANDIDATE PROFILE:\n{json.dumps(_profile_payload(profile), ensure_ascii=False)}\n\n"
        f"PROOF OF WORK SUMMARY:\n{proof}\n\n"
        f"RESUME TEMPLATE INSTRUCTION: {template_instruction}\n"
        "OUTPUT CONTRACT:\n"
        "- resume_markdown must contain only the resume.\n"
        "- cover_letter_markdown must contain only the cover letter.\n"
        "- Do not concatenate resume and cover letter in either field.\n"
        + (f"RESUME TEMPLATE:\n{template[:3500]}\n" if template else "")
    )
    return call_llm(system, user, _DocPackage, step="generator")


def _draft(proof: str, j: dict, template: str = "") -> str:
    from llm import call_raw
    mp = "\n".join(f"- {pt}" for pt in j.get("match_points", []))
    candidate_name = j.get("candidate_name", "")
    desc = j.get("description", "")

    template_instruction = (
        "\nIMPORTANT: Use the provided resume template as the structural and formatting guide. "
        "Preserve section order, heading style, and layout. Replace content with tailored material."
        if template else
        ""
    )
    template_block = (
        f"\n\nRESUME TEMPLATE TO FOLLOW:\n{template[:3000]}"
        if template else ""
    )

    system = (
        "You are an expert resume and cover letter writer. "
        "Generate a tailored, ATS-optimised resume followed by a cover letter in Markdown. "
        + template_instruction +
        " Use ## Resume and ## Cover Letter as section headers. "
        "Explicitly weave in the provided match points. "
        "Keep language concise, factual, and impactful."
    )
    user = (
        f"JOB TITLE: {j.get('title','')}\n"
        f"COMPANY: {j.get('company','')}\n"
        + (f"JOB DESCRIPTION: {desc}\n" if desc else "") +
        f"\nMATCH POINTS:\n{mp}\n\n"
        f"CANDIDATE PROOF OF WORK:\n{proof}"
        + template_block
    )
    return call_raw(system, user, step="generator")


def _clean(text: str) -> str:
    """
    Replace every character that Helvetica (Latin-1) cannot encode,
    then NFKD-normalise and re-encode to latin-1 so nothing slips through.
    """
    import unicodedata
    _subs = {
        # Bullets & boxes
        "•": "-", "‣": "-", "●": "-", "▪": "-",
        "■": "-", "▫": "-", "▶": ">",
        # Dashes
        "–": "-", "—": "--", "―": "--", "‐": "-",
        "‑": "-", "‒": "-",
        # Quotes
        "‘": "'", "’": "'", "‚": ",",
        "“": '"', "”": '"', "„": '"',
        # Arrows & misc symbols
        "→": "->", "←": "<-", "↔": "<->",
        "…": "...",
        "✓": "(v)", "✔": "(v)", "✗": "(x)", "✘": "(x)",
        "®": "(R)", "©": "(C)", "™": "(TM)",
        # Zero-width / special spaces
        "​": "", "‌": "", "‍": "",
        " ": " ", " ": " ", " ": " ", " ": " ",
        # Middle dot
        "·": "-",
        # Checkmarks and crosses sometimes used in LLM output
        "✅": "(v)", "❌": "(x)",
    }
    for ch, rep in _subs.items():
        text = text.replace(ch, rep)
    text = unicodedata.normalize("NFKD", text)
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _strip_inline(text: str) -> str:
    """Remove **bold**, *italic*, `code`, and [link](url) inline markers."""
    import re
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*',     r'\1', text)
    text = re.sub(r'`(.+?)`',       r'\1', text)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    return text.strip()


def _render(md_text: str, filename: str) -> str:
    """
    Convert Markdown to PDF using direct multi_cell() calls.
    No write_html / HTMLMixin -- avoids the entity-unescaping bug in fpdf2
    that re-introduces unicode characters after sanitisation.
    """
    import re
    from fpdf import FPDF

    text = _clean(md_text)
    lines = text.splitlines()

    pdf = FPDF()
    pdf.add_page()
    pdf.set_margins(20, 20, 20)
    pdf.set_auto_page_break(auto=True, margin=20)
    eff_w = pdf.w - pdf.l_margin - pdf.r_margin

    def emit(txt: str, size: int = 11, bold: bool = False, indent: float = 0):
        pdf.set_font("Helvetica", style="B" if bold else "", size=size)
        pdf.set_x(pdf.l_margin + indent)
        pdf.multi_cell(eff_w - indent, size * 0.5, txt)

    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        i += 1

        if not stripped:
            pdf.ln(2)
            continue

        # Horizontal rule  (--- or ***)
        if re.match(r'^[-*]{3,}$', stripped):
            pdf.set_draw_color(180, 180, 180)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(3)
            continue

        # Headings
        if stripped.startswith("#### "):
            emit(_strip_inline(stripped[5:]), size=11, bold=True)
            continue
        if stripped.startswith("### "):
            pdf.ln(2)
            emit(_strip_inline(stripped[4:]), size=12, bold=True)
            continue
        if stripped.startswith("## "):
            pdf.ln(3)
            emit(_strip_inline(stripped[3:]), size=14, bold=True)
            pdf.set_draw_color(100, 100, 100)
            pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(2)
            continue
        if stripped.startswith("# "):
            pdf.ln(4)
            emit(_strip_inline(stripped[2:]), size=16, bold=True)
            pdf.ln(2)
            continue

        # Blockquote
        if stripped.startswith("> "):
            emit(_strip_inline(stripped[2:]), size=10, indent=8)
            continue

        # Unordered list  (- item  or  * item)
        m = re.match(r'^[-*+]\s+(.*)', stripped)
        if m:
            emit("- " + _strip_inline(m.group(1)), size=11, indent=6)
            continue

        # Numbered list
        m = re.match(r'^\d+\.\s+(.*)', stripped)
        if m:
            emit(_strip_inline(stripped), size=11, indent=6)
            continue

        # Plain paragraph
        emit(_strip_inline(stripped), size=11)

    out = os.path.join(_assets, filename)
    pdf.output(out)
    return out


def run_package(lead: dict, template: str = "") -> dict:
    profile = get_profile()
    proof   = _build_proof(profile)

    # Enrich lead with candidate name so the draft can use it
    lead_with_ctx = {**lead, "candidate_name": profile.get("n", "")}

    try:
        package = _draft_package(profile, proof, lead_with_ctx, template=template)
        package = _normalize_package(package, profile, lead_with_ctx, template=template)
    except Exception as exc:
        import sys
        print(f"[generator] LLM draft failed for {lead.get('job_id','?')}: {exc}", file=sys.stderr)
        raise RuntimeError(f"Draft generation failed: {exc}") from exc

    try:
        resume_path = _render(package.resume_markdown, f"{lead['job_id']}_resume.pdf")
        cover_letter_path = _render(package.cover_letter_markdown, f"{lead['job_id']}_cover_letter.pdf")
    except Exception as exc:
        import sys
        print(f"[generator] PDF render failed for {lead.get('job_id','?')}: {exc}", file=sys.stderr)
        raise RuntimeError(f"PDF render failed: {exc}") from exc

    return {
        "resume": resume_path,
        "cover_letter": cover_letter_path,
        "selected_projects": package.selected_projects,
    }


def run(lead: dict, template: str = "") -> str:
    """Backward-compatible entry point: generate the package and return the resume path."""
    return run_package(lead, template=template)["resume"]
