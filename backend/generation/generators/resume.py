from __future__ import annotations

import re

from generation.generators.base import GeneratedAsset, _DocPackage
from generation.generators.outreach_email import _fallback_outreach


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
        "certifications": profile.get("certifications", []) or profile.get("certs", []),
        "education": profile.get("education", []),
        "achievements": profile.get("achievements", []),
    }


def _categorize_skills(skills: list[dict]) -> dict[str, list[str]]:
    """Group skills into categories matching the resume format."""
    categories: dict[str, list[str]] = {
        "Languages": [],
        "Frameworks & Libraries": [],
        "Databases & Data Tools": [],
        "Tools & Platforms": [],
        "Core Concepts": [],
        "AI Skills": [],
    }
    _cat_map = {
        "language": "Languages", "languages": "Languages", "lang": "Languages",
        "framework": "Frameworks & Libraries", "frameworks": "Frameworks & Libraries",
        "library": "Frameworks & Libraries", "libraries": "Frameworks & Libraries",
        "frontend": "Frameworks & Libraries", "backend": "Frameworks & Libraries",
        "database": "Databases & Data Tools", "databases": "Databases & Data Tools",
        "data": "Databases & Data Tools", "db": "Databases & Data Tools",
        "tool": "Tools & Platforms", "tools": "Tools & Platforms",
        "platform": "Tools & Platforms", "platforms": "Tools & Platforms",
        "devops": "Tools & Platforms", "cloud": "Tools & Platforms",
        "concept": "Core Concepts", "concepts": "Core Concepts",
        "soft": "Core Concepts",
        "ai": "AI Skills", "ml": "AI Skills", "machine learning": "AI Skills",
    }
    for s in skills:
        name = s.get("n", "")
        if not name:
            continue
        cat_raw = (s.get("cat", "") or s.get("category", "") or "").lower().strip()
        target_cat = _cat_map.get(cat_raw, "Tools & Platforms")
        categories[target_cat].append(name)
    return {k: v for k, v in categories.items() if v}


def _fallback_package(profile: dict, lead: dict, template: str = "") -> _DocPackage:
    selected = _rank_projects(profile, lead, limit=3)
    name = profile.get("n") or "Candidate"
    title = lead.get("title", "Software Engineer")
    company = lead.get("company", "the company")
    skills_raw = profile.get("skills", [])
    education = profile.get("education", [])
    certs = profile.get("certifications", []) or profile.get("certs", [])
    achievements = profile.get("achievements", [])

    # Build categorized skills section
    skill_cats = _categorize_skills(skills_raw)
    skills_lines = []
    for cat, items in skill_cats.items():
        skills_lines.append(f"**{cat}:** {', '.join(items)}")
    skills_block = "\n".join(skills_lines) if skills_lines else "Python, JavaScript, TypeScript"

    # Projects
    project_lines = []
    for p in selected:
        stack = p.get("stack", [])
        stack_text = ", ".join(stack) if isinstance(stack, list) else str(stack)
        impact = p.get("impact", "Relevant project experience aligned to the role.")
        # Split impact into bullets if it's a single string
        impact_bullets = [b.strip() for b in impact.split(".") if b.strip()][:3]
        proj_block = f"### {p.get('title','Project')}\n"
        for bullet in impact_bullets:
            proj_block += f"- {bullet}.\n"
        proj_block += f"- Tech: {stack_text}"
        project_lines.append(proj_block)
    if not project_lines:
        project_lines.append("- Add projects to the Identity Graph for stronger tailoring.")

    # Experience
    exp_lines = []
    for e in profile.get("exp", [])[:3]:
        desc = e.get("d", "")
        role = e.get("role", "Role")
        co = e.get("co", "Company")
        period = e.get("period", "")
        exp_block = f"### {role} - {co} {period}\n"
        if desc:
            # Split description into bullets
            desc_bullets = [b.strip() for b in desc.split(".") if b.strip()][:4]
            for bullet in desc_bullets:
                exp_block += f"- {bullet}.\n"
        else:
            exp_block += f"- Relevant professional experience in {role}.\n"
        exp_lines.append(exp_block)

    # Certificates
    cert_lines = "\n".join(f"- {c}" for c in certs[:4]) if certs else ""
    # Achievements
    achv_lines = "\n".join(f"- {a}" for a in achievements[:4]) if achievements else ""
    # Education
    edu_lines = "\n".join(f"- {e}" for e in education[:3]) if education else ""
    all_skills = [s.get("n", "") for s in skills_raw if s.get("n")]

    summary = profile.get("s") or (
        f"Software engineer targeting {title} roles with hands-on experience in "
        f"{', '.join(all_skills[:5]) if all_skills else 'software engineering'}."
    )

    resume = f"# {name}\n\n"
    resume += f"## SUMMARY\n{summary}\n\n"
    resume += f"## SKILLS\n{skills_block}\n\n"
    resume += f"## PROJECTS\n{chr(10).join(project_lines)}\n"
    if exp_lines:
        resume += f"\n## EXPERIENCE\n{chr(10).join(exp_lines)}\n"
    if cert_lines:
        resume += f"\n## CERTIFICATES\n{cert_lines}\n"
    if achv_lines:
        resume += f"\n## ACHIEVEMENTS\n{achv_lines}\n"
    if edu_lines:
        resume += f"\n## EDUCATION\n{edu_lines}\n"

    cover = f"""Dear {company} team,

I am writing to apply for the {title} position at {company}. My background in {", ".join(all_skills[:5]) if all_skills else "software engineering"} aligns directly with the requirements outlined in your posting.

In my recent work, I have built and shipped {", ".join(p.get('title','Project') for p in selected[:3]) if selected else "production systems"} using technologies central to your stack. These projects demonstrate hands-on experience with the tools and patterns your team uses daily.

I would welcome the opportunity to discuss how my experience maps to your needs. Thank you for your consideration.

Sincerely,
{name}
"""
    outreach = _fallback_outreach(profile, lead)
    return _DocPackage(
        selected_projects=[p.get("title", "") for p in selected if p.get("title")],
        resume_markdown=resume,
        cover_letter_markdown=cover,
        founder_message=outreach["founder_message"],
        linkedin_note=outreach["linkedin_note"],
        cold_email=outreach["cold_email"],
    )


class ResumeGenerator:
    name = "resume"

    def generate(self, lead: dict, profile: dict, config: dict | None = None) -> GeneratedAsset:
        template = (config or {}).get("template", "")
        package = _fallback_package(profile, lead, template)
        return {"type": self.name, "text": package.resume_markdown}
