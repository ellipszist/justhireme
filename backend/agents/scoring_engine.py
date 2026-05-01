"""
Deterministic scoring engine for lead-candidate fit.

The evaluators used to delegate judgment to an LLM prompt. That made scores noisy:
the same lead could land in different bands depending on model/provider mood. This
module keeps the model out of the rating loop and scores each lead through a fixed
rubric with visible criteria, caps, and evidence.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class CriterionScore:
    name: str
    score: int
    weight: int
    reason: str


@dataclass(frozen=True)
class ScoreResult:
    score: int
    reason: str
    match_points: list[str]
    gaps: list[str]
    criteria: list[CriterionScore]

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "reason": self.reason,
            "match_points": self.match_points,
            "gaps": self.gaps,
        }


@dataclass
class CandidateEvidence:
    skills: set[str]
    project_terms: set[str]
    experience_terms: set[str]
    all_terms: set[str]
    project_by_term: dict[str, list[str]]
    experience_by_term: dict[str, list[str]]
    project_texts: list[tuple[str, str, set[str]]]
    experience_texts: list[tuple[str, str, set[str]]]
    role_tags: set[str]
    deliverables: set[str]
    level: str
    work_months: int
    summary: str
    location: str


@dataclass
class PostingSignals:
    title: str
    company: str
    text: str
    terms: set[str]
    primary_terms: set[str]
    role_tags: set[str]
    deliverables: set[str]
    wrong_field: bool
    wrong_field_terms: list[str]
    max_years: int
    seniority_flags: set[str]
    entry_level: bool
    remote: bool
    onsite: bool
    location_limited: bool
    budget_amount: int | None
    budget_present: bool
    commercial_intent: bool
    red_flags: list[str]
    quality_features: list[str]


TECH_TAXONOMY: dict[str, tuple[str, ...]] = {
    "Python": ("python",),
    "TypeScript": ("typescript",),
    "JavaScript": ("javascript",),
    "C++": ("c++", "cpp"),
    "C#": ("c#", "c sharp"),
    "Java": ("java",),
    "PHP": ("php",),
    "Ruby": ("ruby",),
    "Go": ("golang", "go lang"),
    "Rust": ("rust",),
    "SQL": ("sql",),
    "React": ("react", "react.js", "reactjs"),
    "Next.js": ("next.js", "nextjs", "next js"),
    "Vite": ("vite",),
    "Tailwind": ("tailwind", "tailwindcss", "tailwind css"),
    "HTML": ("html",),
    "CSS": ("css",),
    "Vue": ("vue", "vue.js", "vuejs"),
    "Angular": ("angular",),
    "Svelte": ("svelte",),
    "Flutter": ("flutter",),
    "Swift": ("swift",),
    "Kotlin": ("kotlin",),
    "Android": ("android",),
    "iOS": ("ios", "i os"),
    "Node.js": ("node.js", "nodejs", "node js"),
    "Express": ("express", "express.js", "expressjs"),
    "NestJS": ("nestjs", "nest.js", "nest js"),
    "FastAPI": ("fastapi", "fast api"),
    "Django": ("django",),
    "Flask": ("flask",),
    "Laravel": ("laravel",),
    "Ruby on Rails": ("ruby on rails", "rails"),
    "WordPress": ("wordpress", "wp"),
    "REST API": ("rest api", "restful api", "restful", "rest endpoints", "api endpoint", "api endpoints"),
    "GraphQL": ("graphql", "graph ql"),
    "PostgreSQL": ("postgresql", "postgres", "neon postgres", "neon"),
    "MySQL": ("mysql",),
    "MongoDB": ("mongodb", "mongo"),
    "Redis": ("redis",),
    "Prisma": ("prisma",),
    "Drizzle": ("drizzle", "drizzle orm"),
    "Supabase": ("supabase",),
    "Qdrant": ("qdrant",),
    "Pinecone": ("pinecone",),
    "ChromaDB": ("chromadb", "chroma"),
    "Vector DB": ("vector database", "vector db", "vector store"),
    "RAG": ("rag", "retrieval augmented generation", "retrieval-augmented generation"),
    "LLM": ("llm", "large language model", "language model"),
    "AI Agents": ("ai agent", "ai agents", "agentic", "multi-agent", "multi agent"),
    "OpenAI": ("openai", "gpt", "chatgpt"),
    "Anthropic": ("anthropic", "claude"),
    "LangChain": ("langchain", "lang chain"),
    "LangGraph": ("langgraph", "lang graph"),
    "Machine Learning": ("machine learning", "ml engineer", "ml engineering", "ml ops", "mlops", "ml model", "ml pipeline", "ai/ml"),
    "NLP": ("nlp", "natural language processing"),
    "Computer Vision": ("computer vision", "vision model", "object detection", "image segmentation"),
    "PyTorch": ("pytorch", "torch"),
    "TensorFlow": ("tensorflow",),
    "Automation": ("automation", "workflow automation", "zapier", "n8n"),
    "Docker": ("docker", "container"),
    "Kubernetes": ("kubernetes", "k8s"),
    "Terraform": ("terraform",),
    "AWS": ("aws", "amazon web services"),
    "GCP": ("gcp", "google cloud"),
    "Azure": ("azure",),
    "Vercel": ("vercel",),
    "CI/CD": ("ci/cd", "cicd", "github actions"),
    "Linux": ("linux",),
    "WebSockets": ("websocket", "websockets", "socket.io"),
    "LiveKit": ("livekit", "livekit agents"),
    "Deepgram": ("deepgram",),
    "Groq": ("groq",),
    "Stripe": ("stripe",),
    "Firebase": ("firebase",),
    "Tauri": ("tauri",),
    "Electron": ("electron",),
    "Playwright": ("playwright",),
    "Data Pipeline": ("data pipeline", "etl", "data engineering"),
    "SAP": ("sap",),
    "ABAP": ("abap",),
    "Salesforce": ("salesforce", "apex"),
    "ServiceNow": ("servicenow", "service now"),
}


TECH_CATEGORY: dict[str, str] = {
    "Python": "language",
    "TypeScript": "language",
    "JavaScript": "language",
    "C++": "language",
    "C#": "language",
    "Java": "language",
    "PHP": "language",
    "Ruby": "language",
    "Go": "language",
    "Rust": "language",
    "SQL": "data",
    "React": "frontend",
    "Next.js": "frontend",
    "Vite": "frontend",
    "Tailwind": "frontend",
    "HTML": "frontend",
    "CSS": "frontend",
    "Vue": "frontend",
    "Angular": "frontend",
    "Svelte": "frontend",
    "Flutter": "mobile",
    "Swift": "mobile",
    "Kotlin": "mobile",
    "Android": "mobile",
    "iOS": "mobile",
    "Node.js": "backend",
    "Express": "backend",
    "NestJS": "backend",
    "FastAPI": "backend",
    "Django": "backend",
    "Flask": "backend",
    "Laravel": "backend",
    "Ruby on Rails": "backend",
    "WordPress": "cms",
    "REST API": "backend",
    "GraphQL": "backend",
    "PostgreSQL": "data",
    "MySQL": "data",
    "MongoDB": "data",
    "Redis": "data",
    "Prisma": "data",
    "Drizzle": "data",
    "Supabase": "data",
    "Qdrant": "ai",
    "Pinecone": "ai",
    "ChromaDB": "ai",
    "Vector DB": "ai",
    "RAG": "ai",
    "LLM": "ai",
    "AI Agents": "ai",
    "OpenAI": "ai",
    "Anthropic": "ai",
    "LangChain": "ai",
    "LangGraph": "ai",
    "Machine Learning": "ai",
    "NLP": "ai",
    "Computer Vision": "ai",
    "PyTorch": "ai",
    "TensorFlow": "ai",
    "Automation": "automation",
    "Docker": "infra",
    "Kubernetes": "infra",
    "Terraform": "infra",
    "AWS": "infra",
    "GCP": "infra",
    "Azure": "infra",
    "Vercel": "infra",
    "CI/CD": "infra",
    "Linux": "infra",
    "WebSockets": "backend",
    "LiveKit": "realtime",
    "Deepgram": "realtime",
    "Groq": "ai",
    "Stripe": "product",
    "Firebase": "backend",
    "Tauri": "desktop",
    "Electron": "desktop",
    "Playwright": "testing",
    "Data Pipeline": "data",
    "SAP": "enterprise",
    "ABAP": "enterprise",
    "Salesforce": "enterprise",
    "ServiceNow": "enterprise",
}


ROLE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "ai": (
        "ai engineer", "ai developer", "ai/ml engineer", "ai/ml developer",
        "applied ai", "applied ml", "ml engineer", "machine learning engineer",
        "llm engineer", "llm developer", "ai agent", "agentic", "rag engineer",
        "prompt engineer", "genai", "generative ai", "ai automation",
        "chatbot developer", "chatbot engineer",
    ),
    "backend": (
        "backend", "back-end", "back end", "server engineer", "microservice",
        "platform engineer", "python developer", "node developer",
        "api engineer", "api developer",
    ),
    "frontend": (
        "frontend", "front-end", "front end", "react developer", "react engineer",
        "next.js developer", "web developer", "ui engineer", "ui developer",
    ),
    "fullstack": (
        "full stack", "full-stack", "software engineer", "product engineer",
        "web app developer", "saas engineer", "application developer",
    ),
    "data": ("data engineer", "analytics engineer", "etl engineer", "data pipeline"),
    "devops": ("devops", "cloud engineer", "sre", "site reliability", "infrastructure engineer", "platform reliability"),
    "mobile": ("mobile developer", "ios developer", "android developer", "react native", "flutter developer"),
    "desktop": ("desktop app", "electron developer", "tauri developer"),
    "testing": ("qa automation", "test automation", "playwright engineer"),
}


DELIVERABLE_KEYWORDS: dict[str, tuple[str, ...]] = {
    "ai agent": ("ai agent", "agentic", "multi-agent", "workflow agent"),
    "rag": ("rag", "retrieval", "knowledge base", "semantic search"),
    "chatbot": ("chatbot", "chat bot", "assistant", "copilot"),
    "voice ai": ("voice ai", "voice agent", "speech", "deepgram", "livekit"),
    "automation": ("automation", "workflow", "scraper", "bot"),
    "dashboard": ("dashboard", "admin panel", "analytics"),
    "saas": ("saas", "multi-tenant", "subscription"),
    "api": ("rest api", "graphql api", "backend api", "server api"),
    "frontend app": ("frontend", "ui", "landing page", "web app"),
    "full-stack app": ("full stack", "full-stack", "end-to-end", "web app"),
    "data pipeline": ("data pipeline", "etl", "ingestion"),
    "fintech": ("fintech", "finance", "payments", "stripe"),
    "desktop app": ("desktop app", "tauri", "electron"),
    "testing": ("test automation", "qa automation", "playwright"),
}


WRONG_FIELD_TERMS = (
    "nurse", "doctor", "physician", "medical assistant", "pharmacist",
    "accountant", "bookkeeper", "tax preparer", "lawyer", "paralegal",
    "cashier", "retail associate", "warehouse", "driver", "delivery",
    "cook", "chef", "mechanic", "civil engineer", "mechanical engineer",
    "electrical engineer", "chemical engineer", "petroleum engineer",
    "real estate agent", "insurance agent", "teacher", "tutor", "data entry",
    "marketing analyst", "marketing manager", "marketing specialist",
    "marketing coordinator", "social media manager", "content writer",
    "copywriter", "blog writer", "seo specialist", "seo writer",
    "sales representative", "sales manager", "sales executive", "sdr",
    "account executive", "account manager", "customer success",
    "customer service", "customer support agent", "call center",
    "recruiter", "talent acquisition", "human resources", "hr manager",
    "executive assistant", "virtual assistant", "personal assistant",
    "graphic designer", "video editor", "animator", "illustrator",
    "translator", "transcriber", "voice actor", "video producer",
    "construction", "plumber", "electrician", "welder", "carpenter",
    "barista", "waiter", "waitress", "bartender",
    "security guard", "janitor", "housekeeper", "babysitter",
)


RED_FLAGS = (
    "unpaid", "for exposure", "equity only", "college assignment", "homework",
    "no budget", "cheap", "lowest bidder", "free trial", "commission only",
    "crypto token", "urgent cheap", "do not apply", "training course",
)


COMMERCIAL_TERMS = (
    "hiring", "job opening", "open role", "role available", "apply",
    "we're hiring", "we are hiring", "is hiring", "internship",
    "junior", "entry level", "new grad", "graduate",
)


def clamp(n: float, lo: int = 0, hi: int = 100) -> int:
    return max(lo, min(hi, int(round(n))))


def build_proof_text(candidate_data: dict) -> str:
    parts: list[str] = []
    for proj in candidate_data.get("projects", []) or []:
        stack = proj.get("stack", [])
        if isinstance(stack, list):
            stack = ", ".join(str(x) for x in stack if str(x).strip())
        title = proj.get("title", "")
        impact = proj.get("impact", "")
        if title:
            parts.append(f"Project: {title} | Stack: {stack} | Impact: {impact}")
    for exp in candidate_data.get("exp", []) or []:
        role = exp.get("role", "")
        co = exp.get("co", "")
        period = exp.get("period", "")
        desc = exp.get("d", "")
        stack = exp.get("s", [])
        stack_text = ", ".join(stack) if isinstance(stack, list) else str(stack or "")
        if role:
            parts.append(f"Role: {role} at {co} ({period}) | Stack: {stack_text} | {desc}")
    skills = [str(s.get("n", "")).strip() for s in candidate_data.get("skills", []) or [] if s.get("n")]
    if skills:
        parts.append(f"Skills: {', '.join(skills)}")
    return "\n".join(parts) if parts else "No profile data found."


_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _period_months(period: str) -> int:
    """Estimate the number of months an experience period covers."""
    if not period:
        return 0
    text = str(period).lower()
    text = re.sub(r"\bpresent\b|\bcurrent\b|\bnow\b|\btoday\b", "2099-12", text)
    pairs = re.findall(
        r"([a-z]{3,4})?\s*(\d{4})\s*(?:to|-|–|—|->|→)\s*([a-z]{3,4})?\s*(\d{4})",
        text,
    )
    months = 0
    for sm, sy, em, ey in pairs:
        try:
            sy_i, ey_i = int(sy), int(ey)
        except ValueError:
            continue
        s_m = _MONTHS.get((sm or "jan")[:4], 1)
        e_m = _MONTHS.get((em or "dec")[:4], 12)
        delta = (ey_i - sy_i) * 12 + (e_m - s_m) + 1
        if delta > 0:
            months += min(delta, 600)
    if not pairs:
        years = re.search(r"(\d{1,2})\s*\+?\s*(?:years|yrs|yoe)", text)
        if years:
            months = int(years.group(1)) * 12
    return months


def _total_work_months(candidate_data: dict) -> int:
    """Return total months of non-intern professional experience."""
    exp_entries = candidate_data.get("exp", []) or []
    real_roles = []
    for entry in exp_entries:
        role = str(entry.get("role", "")).lower()
        if not role:
            continue
        if any(kw in role for kw in ("intern", "trainee", "student", "assistant only")):
            continue
        real_roles.append(entry)
    return sum(_period_months(e.get("period", "")) for e in real_roles)


def infer_experience_level(candidate_data: dict) -> str:
    """Estimate seniority from experience periods, role titles, and projects.

    Looks at total months of non-intern experience plus shipped project count so
    that someone with 3 strong projects but only 2 months of paid work doesn't
    get treated identically to a true zero-experience fresher.
    """
    exp_entries = candidate_data.get("exp", []) or []
    real_roles = []
    for entry in exp_entries:
        role = str(entry.get("role", "")).lower()
        if not role:
            continue
        if any(kw in role for kw in ("intern", "trainee", "student", "assistant only")):
            continue
        real_roles.append(entry)

    total_months = sum(_period_months(e.get("period", "")) for e in real_roles)
    senior_titles = sum(
        1 for e in real_roles
        if any(kw in str(e.get("role", "")).lower() for kw in ("senior", "lead", "principal", "staff", "head of", "manager"))
    )
    project_count = len(candidate_data.get("projects", []) or [])

    if senior_titles >= 1 and total_months >= 36:
        return "senior"
    if total_months >= 60:
        return "senior"
    if total_months >= 24 or len(real_roles) >= 2:
        return "mid"
    if real_roles or project_count >= 2:
        return "junior"
    return "fresher"


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _alias_regex(alias: str) -> re.Pattern[str]:
    alias = alias.lower().strip()
    escaped = re.escape(alias)
    escaped = escaped.replace(r"\ ", r"[\s\-_/.]+")
    escaped = escaped.replace(r"\.", r"[.\s\-_]?")
    return re.compile(rf"(?<![a-z0-9]){escaped}(?![a-z0-9])", re.I)


_ALIAS_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (canonical, _alias_regex(alias))
    for canonical, aliases in TECH_TAXONOMY.items()
    for alias in aliases
]


def _contains_phrase(text: str, phrase: str) -> bool:
    return bool(_alias_regex(phrase).search(text.lower()))


def _find_terms(text: str) -> set[str]:
    lower = str(text or "").lower()
    found: set[str] = set()
    for canonical, pattern in _ALIAS_PATTERNS:
        if pattern.search(lower):
            found.add(canonical)
    return found


def _find_tags(text: str, taxonomy: dict[str, tuple[str, ...]]) -> set[str]:
    lower = str(text or "").lower()
    return {
        label
        for label, aliases in taxonomy.items()
        if any(_contains_phrase(lower, alias) for alias in aliases)
    }


def _split_stack(value) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if not value:
        return []
    return [part.strip() for part in re.split(r"[,;/|]", str(value)) if part.strip()]


def _candidate_location(summary: str) -> str:
    lower = summary.lower()
    for loc in ("india", "united states", "usa", "us", "canada", "uk", "europe"):
        if re.search(rf"\b{re.escape(loc)}\b", lower):
            return "US" if loc in {"usa", "us", "united states"} else loc.title()
    return ""


def _profile_text(candidate_data: dict) -> str:
    return "\n".join(
        [
            str(candidate_data.get("s", "")),
            build_proof_text(candidate_data),
        ]
    )


def analyze_candidate(candidate_data: dict) -> CandidateEvidence:
    skill_terms: set[str] = set()
    project_terms: set[str] = set()
    experience_terms: set[str] = set()
    project_by_term: dict[str, list[str]] = {}
    experience_by_term: dict[str, list[str]] = {}
    project_texts: list[tuple[str, str, set[str]]] = []
    experience_texts: list[tuple[str, str, set[str]]] = []

    for skill in candidate_data.get("skills", []) or []:
        skill_terms |= _find_terms(skill.get("n", ""))

    for project in candidate_data.get("projects", []) or []:
        title = _squash(project.get("title", ""))
        stack = ", ".join(_split_stack(project.get("stack", [])))
        text = _squash(f"{title} {stack} {project.get('impact', '')}")
        terms = _find_terms(text)
        project_terms |= terms
        project_texts.append((title or "Unnamed project", text, terms))
        for term in terms:
            project_by_term.setdefault(term, [])
            if title and title not in project_by_term[term]:
                project_by_term[term].append(title)

    for exp in candidate_data.get("exp", []) or []:
        title = _squash(f"{exp.get('role', '')} at {exp.get('co', '')}".strip())
        stack = ", ".join(_split_stack(exp.get("s", [])))
        text = _squash(f"{title} {exp.get('period', '')} {stack} {exp.get('d', '')}")
        terms = _find_terms(text)
        experience_terms |= terms
        experience_texts.append((title or "Experience", text, terms))
        for term in terms:
            experience_by_term.setdefault(term, [])
            if title and title not in experience_by_term[term]:
                experience_by_term[term].append(title)

    summary = _profile_text(candidate_data)
    all_terms = skill_terms | project_terms | experience_terms | _find_terms(summary)
    role_tags = _find_tags(summary, ROLE_KEYWORDS)
    role_tags |= {TECH_CATEGORY[t] for t in all_terms if t in TECH_CATEGORY and TECH_CATEGORY[t] in ROLE_KEYWORDS}
    deliverables = _find_tags(summary, DELIVERABLE_KEYWORDS)

    return CandidateEvidence(
        skills=skill_terms,
        project_terms=project_terms,
        experience_terms=experience_terms,
        all_terms=all_terms,
        project_by_term=project_by_term,
        experience_by_term=experience_by_term,
        project_texts=project_texts,
        experience_texts=experience_texts,
        role_tags=role_tags,
        deliverables=deliverables,
        level=infer_experience_level(candidate_data),
        work_months=_total_work_months(candidate_data),
        summary=summary,
        location=_candidate_location(summary),
    )


def _field(text: str, name: str) -> str:
    match = re.search(rf"(?im)^\s*{re.escape(name)}\s*:\s*(.+)$", text or "")
    return _squash(match.group(1)) if match else ""


def _title_from_text(text: str, fallback: str) -> str:
    title = _field(text, "Job Title") or _field(text, "Gig Title") or _field(text, "Title")
    if title:
        return title[:180]
    for line in str(text or "").splitlines():
        line = _squash(line)
        if not line or len(line) > 180:
            continue
        lower = line.lower()
        if lower.startswith(("url:", "description:", "budget:", "company:", "client:")):
            continue
        if lower.startswith(("http://", "https://", "www.")):
            continue
        return line
    return fallback


def _company_from_text(text: str) -> str:
    return _field(text, "Company") or _field(text, "Client")


def _extract_years(text: str) -> int:
    years: list[int] = []
    for pattern in (
        r"(\d{1,2})\s*\+?\s*(?:years|yrs|yoe)",
        r"(\d{1,2})\s*-\s*(\d{1,2})\s*(?:years|yrs|yoe)",
    ):
        for match in re.finditer(pattern, text or "", flags=re.I):
            nums = [int(g) for g in match.groups() if g and g.isdigit()]
            if nums:
                years.append(max(nums))
    return max(years) if years else 0


def _budget_amount(text: str) -> int | None:
    amounts: list[int] = []
    for raw in re.findall(r"\$\s?(\d[\d,]*)", text or ""):
        try:
            amounts.append(int(raw.replace(",", "")))
        except ValueError:
            pass
    return max(amounts) if amounts else None


def _quality_features(text: str, terms: set[str], title: str, company: str) -> list[str]:
    clean = _squash(text)
    out: list[str] = []
    if title:
        out.append("clear title")
    if company:
        out.append("company/client named")
    if len(clean) >= 240:
        out.append("substantive description")
    if len(terms) >= 2:
        out.append("specific stack")
    if re.search(r"\b(remote|hybrid|onsite|salary|budget|apply|email|dm|proposal)\b", clean, re.I):
        out.append("next-step/context present")
    return out


def analyze_posting(raw_text: str, default_title: str = "Lead") -> PostingSignals:
    text = str(raw_text or "")
    lower = text.lower()
    title = _title_from_text(text, default_title)
    company = _company_from_text(text)
    terms = _find_terms(text)
    title_terms = _find_terms(title)
    first_chunk_terms = _find_terms(text[:700])
    primary = title_terms | first_chunk_terms
    if not primary:
        primary = set(terms)
    role_tags = _find_tags(f"{title}\n{text}", ROLE_KEYWORDS)
    deliverables = _find_tags(f"{title}\n{text}", DELIVERABLE_KEYWORDS)
    wrong_terms = [term for term in WRONG_FIELD_TERMS if _contains_phrase(lower, term)]
    tech_role = bool(terms or role_tags & {"ai", "backend", "frontend", "fullstack", "data", "devops", "desktop", "testing"})
    wrong_field = bool(wrong_terms and not tech_role)
    max_years = _extract_years(text)
    seniority_flags = {
        flag
        for flag, aliases in {
            "senior": ("senior", "sr.", "sr ", "lead", "staff", "principal"),
            "manager": ("manager", "director", "head of"),
        }.items()
        if any(_contains_phrase(lower, alias) for alias in aliases)
    }
    entry_level = any(_contains_phrase(lower, alias) for alias in ("junior", "entry level", "entry-level", "fresher", "graduate", "intern", "0-2 years", "0 to 2 years"))
    remote = any(_contains_phrase(lower, alias) for alias in ("remote", "work from home", "wfh", "anywhere"))
    onsite = any(_contains_phrase(lower, alias) for alias in ("onsite", "on-site", "in office", "relocation"))
    location_limited = any(_contains_phrase(lower, alias) for alias in ("us only", "u.s. only", "usa only", "must be in us", "us-based", "europe only", "uk only"))
    budget = _budget_amount(text)
    commercial_intent = any(_contains_phrase(lower, term) for term in COMMERCIAL_TERMS)
    red_flags = [flag for flag in RED_FLAGS if _contains_phrase(lower, flag)]

    return PostingSignals(
        title=title,
        company=company,
        text=text,
        terms=terms,
        primary_terms=primary,
        role_tags=role_tags,
        deliverables=deliverables,
        wrong_field=wrong_field,
        wrong_field_terms=wrong_terms,
        max_years=max_years,
        seniority_flags=seniority_flags,
        entry_level=entry_level,
        remote=remote,
        onsite=onsite,
        location_limited=location_limited,
        budget_amount=budget,
        budget_present=budget is not None or bool(re.search(r"\b(budget|salary|rate)\b", lower)),
        commercial_intent=commercial_intent,
        red_flags=red_flags,
        quality_features=_quality_features(text, terms, title, company),
    )


def _category_set(terms: Iterable[str]) -> set[str]:
    return {TECH_CATEGORY[t] for t in terms if t in TECH_CATEGORY}


def _sorted_terms(terms: Iterable[str]) -> list[str]:
    return sorted(set(terms), key=lambda x: x.lower())


def _fmt_terms(terms: Iterable[str], empty: str = "none") -> str:
    values = _sorted_terms(terms)
    return ", ".join(values[:8]) if values else empty


# Categories that are tightly coupled to specific tech where transferability is
# weak. A Python dev is not, for hiring purposes, "adjacent" to a Java role even
# though both are in the language category. Same for frontend/mobile/desktop.
_ADJACENCY_BLOCKLIST = {"language", "frontend", "mobile", "desktop", "cms", "enterprise"}


def _direct_and_adjacent(posting: PostingSignals, candidate: CandidateEvidence) -> tuple[set[str], set[str], set[str]]:
    required = posting.terms
    direct = required & candidate.all_terms
    candidate_categories = _category_set(candidate.all_terms)
    adjacent: set[str] = set()
    for term in required - direct:
        category = TECH_CATEGORY.get(term)
        if not category or category in _ADJACENCY_BLOCKLIST:
            continue
        if category in candidate_categories:
            adjacent.add(term)
    missing = required - direct - adjacent
    return direct, adjacent, missing


def _role_alignment(posting: PostingSignals, candidate: CandidateEvidence) -> CriterionScore:
    if posting.wrong_field:
        return CriterionScore(
            "Role alignment",
            0,
            18,
            "non-technical/non-target field: " + ", ".join(posting.wrong_field_terms[:3]),
        )

    if not posting.role_tags and not posting.terms:
        return CriterionScore("Role alignment", 30, 18, "posting has no clear technical role signal")

    overlap = posting.role_tags & candidate.role_tags
    direct_terms = posting.terms & candidate.all_terms
    if overlap:
        if direct_terms:
            score = 88
            reason = "same role lane (" + ", ".join(sorted(overlap)) + ") with direct stack overlap"
        elif posting.terms:
            # Same lane label but no shared concrete tools - likely a different sub-niche.
            score = 64
            reason = "role lane label matches (" + ", ".join(sorted(overlap)) + ") but stacks differ"
        else:
            score = 78
            reason = "same role lane: " + ", ".join(sorted(overlap))
    elif posting.role_tags and (posting.role_tags & {"backend", "frontend", "fullstack", "ai", "data"}) and candidate.all_terms:
        score = 55
        reason = "technical role is adjacent to candidate profile"
    elif posting.terms and direct_terms:
        score = 60
        reason = "technical stack overlap exists but role lane is weakly specified"
    elif posting.terms and candidate.all_terms:
        score = 38
        reason = "stack mentioned but no shared tools and no role label"
    else:
        score = 22
        reason = "role does not map to candidate target"
    return CriterionScore("Role alignment", score, 18, reason)


def _stack_overlap(posting: PostingSignals, candidate: CandidateEvidence, weight: int) -> CriterionScore:
    required = posting.terms
    if not required:
        score = 55 if posting.role_tags else 25
        return CriterionScore("Stack overlap", score, weight, "no explicit stack to compare")

    direct, adjacent, missing = _direct_and_adjacent(posting, candidate)
    direct_value = len(direct)
    adjacent_value = 0.30 * len(adjacent)
    coverage = (direct_value + adjacent_value) / max(1, len(required))
    score = clamp((coverage * 88) + min(10, len(direct) * 2))
    if direct and not missing:
        score = max(score, 86)
    elif direct:
        score = max(score, 55)
    elif adjacent:
        score = max(min(38, 22 + len(adjacent) * 4), 22)
    reason = (
        f"matched {_fmt_terms(direct)}"
        + (f"; adjacent {_fmt_terms(adjacent)}" if adjacent else "")
        + (f"; missing {_fmt_terms(missing)}" if missing else "")
    )
    return CriterionScore("Stack overlap", score, weight, reason)


def _proof_strength(posting: PostingSignals, candidate: CandidateEvidence, weight: int) -> CriterionScore:
    required = posting.terms
    if not required:
        project_count = len(candidate.project_texts)
        deliverable_overlap = posting.deliverables & candidate.deliverables
        if deliverable_overlap:
            score = min(80, 56 + len(deliverable_overlap) * 12)
        elif project_count:
            score = 50
        else:
            score = 30
        return CriterionScore(
            "Proof of work",
            score,
            weight,
            f"{project_count} profile projects; no exact stack requested",
        )

    values: list[float] = []
    proofed_terms: list[str] = []
    weak_terms: list[str] = []
    for term in required:
        if term in candidate.project_terms:
            values.append(1.0)
            proofed_terms.append(term)
        elif term in candidate.experience_terms:
            values.append(0.75)
            proofed_terms.append(term)
        elif term in candidate.skills:
            values.append(0.45)
            weak_terms.append(term)
        else:
            values.append(0.0)

    term_score = (sum(values) / max(1, len(required))) * 100
    deliverable_overlap = posting.deliverables & candidate.deliverables
    deliverable_score = min(100, 55 + len(deliverable_overlap) * 15) if deliverable_overlap else 45
    score = clamp(term_score * 0.78 + deliverable_score * 0.22)
    if proofed_terms:
        evidence = _evidence_line(candidate, set(proofed_terms))
        reason = "project/experience proof for " + _fmt_terms(proofed_terms)
        if evidence:
            reason += f" ({evidence})"
    elif weak_terms:
        reason = "listed skills only for " + _fmt_terms(weak_terms)
    else:
        reason = "no direct proof for requested stack"
    if deliverable_overlap:
        reason += "; similar deliverable: " + ", ".join(sorted(deliverable_overlap)[:3])
    return CriterionScore("Proof of work", score, weight, reason)


def _seniority_fit(posting: PostingSignals, candidate: CandidateEvidence) -> CriterionScore:
    level_years = {"fresher": 0, "junior": 1.5, "mid": 3.5, "senior": 7}.get(candidate.level, 1)
    flags = posting.seniority_flags
    required_years = posting.max_years

    if posting.entry_level and candidate.level in {"fresher", "junior"}:
        return CriterionScore("Seniority fit", 92, 20, f"{candidate.level} profile matches entry-level signal")
    if not required_years and not flags:
        return CriterionScore("Seniority fit", 84, 20, f"no hard seniority requirement; profile reads {candidate.level}")

    effective_required = required_years
    if "senior" in flags:
        effective_required = max(effective_required, 5)
    if "manager" in flags:
        effective_required = max(effective_required, 6)

    gap = effective_required - level_years
    if gap <= 0.5:
        score = 86
    elif gap <= 1.5:
        score = 62
    elif gap <= 3:
        score = 34
    elif gap <= 5:
        score = 18
    else:
        score = 10
    reason = f"requires about {effective_required:g}+ years; profile reads {candidate.level}"
    if flags:
        reason += " with " + ", ".join(sorted(flags)) + " title signal"
    return CriterionScore("Seniority fit", score, 20, reason)


def _job_constraints(posting: PostingSignals, candidate: CandidateEvidence) -> CriterionScore:
    score = 78
    reasons: list[str] = []
    if posting.remote:
        score += 8
        reasons.append("remote-friendly")
    if posting.onsite and not posting.remote:
        score -= 14
        reasons.append("onsite-only constraint")
    if posting.location_limited and candidate.location and candidate.location not in {"US", "United States"}:
        score -= 28
        reasons.append(f"location-limited while profile hints {candidate.location}")
    if posting.red_flags:
        score -= min(35, len(posting.red_flags) * 14)
        reasons.append("red flags: " + ", ".join(posting.red_flags[:3]))
    if not posting.quality_features:
        score -= 18
        reasons.append("thin scraped posting")
    elif len(posting.quality_features) >= 3:
        score += 5
        reasons.append("good posting detail")
    return CriterionScore("Constraints and lead quality", clamp(score), 15, "; ".join(reasons) or "no major constraints found")


def _weighted_total(criteria: list[CriterionScore]) -> int:
    total_weight = sum(c.weight for c in criteria) or 1
    return clamp(sum(c.score * c.weight for c in criteria) / total_weight)


def _seniority_cap(posting: PostingSignals, candidate: CandidateEvidence) -> tuple[int, str] | None:
    effective_required = posting.max_years
    if "senior" in posting.seniority_flags:
        effective_required = max(effective_required, 5)
    if "manager" in posting.seniority_flags:
        effective_required = max(effective_required, 6)
    # Zero or near-zero professional experience vs any seniority requirement
    # is always a hard mismatch, regardless of project count.
    if candidate.work_months < 6 and effective_required >= 3:
        return 30, (
            f"seniority cap: {candidate.work_months} months professional experience "
            f"vs {effective_required}+ year requirement"
        )
    if candidate.level == "fresher" and effective_required >= 3:
        return 30, f"seniority cap: fresher profile vs {effective_required}+ year requirement"
    if candidate.level == "junior" and effective_required >= 5:
        return 38, f"seniority cap: junior profile vs {effective_required}+ year requirement"
    if candidate.level == "junior" and effective_required >= 3:
        return 45, f"seniority cap: junior profile vs {effective_required}+ year requirement"
    if candidate.level == "mid" and effective_required >= 7:
        return 48, f"seniority cap: mid profile vs {effective_required}+ year requirement"
    return None


def _apply_caps(
    score: int,
    posting: PostingSignals,
    candidate: CandidateEvidence,
    direct: set[str],
    adjacent: set[str],
) -> tuple[int, list[str]]:
    caps: list[tuple[int, str]] = []
    if posting.wrong_field:
        caps.append((15, "wrong-field cap: posting is not a technical/software opportunity"))
    seniority = _seniority_cap(posting, candidate)
    if seniority:
        caps.append(seniority)
    if posting.terms and not direct and len(posting.terms) >= 2:
        cap = 52 if adjacent else 42
        caps.append((cap, "stack cap: no exact evidence for requested primary stack"))
    if not posting.terms and len(_squash(posting.text)) < 160:
        caps.append((68, "confidence cap: posting is too thin for a high rating"))
    if not caps:
        return score, []
    cap, _reason = min(caps, key=lambda item: item[0])
    limit_notes = [reason for _limit, reason in sorted(caps, key=lambda item: item[0])]
    return min(score, cap), limit_notes


def _evidence_line(candidate: CandidateEvidence, terms: set[str]) -> str:
    chunks: list[str] = []
    for term in _sorted_terms(terms):
        projects = candidate.project_by_term.get(term, [])[:2]
        exps = candidate.experience_by_term.get(term, [])[:1]
        if projects:
            chunks.append(f"{term} in {', '.join(projects)}")
        elif exps:
            chunks.append(f"{term} in {', '.join(exps)}")
    return "; ".join(chunks[:4])


def _result(
    final_score: int,
    criteria: list[CriterionScore],
    posting: PostingSignals,
    candidate: CandidateEvidence,
    direct: set[str],
    adjacent: set[str],
    missing: set[str],
    caps: list[str],
) -> ScoreResult:
    ordered = sorted(criteria, key=lambda c: c.weight, reverse=True)
    breakdown = ", ".join(f"{c.name.split()[0]} {c.score}" for c in ordered)
    reason_bits = [f"Custom deterministic score from weighted criteria: {breakdown}."]
    if direct:
        reason_bits.append("Strongest evidence: " + (_evidence_line(candidate, direct) or _fmt_terms(direct)) + ".")
    if missing:
        reason_bits.append("Main gaps: " + _fmt_terms(missing) + ".")
    if caps:
        reason_bits.append("Limit noted: " + caps[0] + ".")
    reason = " ".join(reason_bits)[:500]

    match_points = [
        f"{c.name} {c.score}/100 (weight {c.weight}%): {c.reason}"
        for c in criteria
        if c.score >= 58
    ]
    if adjacent:
        match_points.append("Adjacent transferable stack: " + _fmt_terms(adjacent))
    gaps = [
        f"{c.name} {c.score}/100: {c.reason}"
        for c in criteria
        if c.score < 58
    ]
    if missing:
        gaps.insert(0, "Missing or weak evidence for: " + _fmt_terms(missing))
    gaps.extend(caps)
    return ScoreResult(
        score=final_score,
        reason=reason,
        match_points=match_points[:7],
        gaps=list(dict.fromkeys(gaps))[:8],
        criteria=criteria,
    )


def _with_weight(c: CriterionScore, weight: int) -> CriterionScore:
    """Return a copy of ``c`` with a different weight (CriterionScore is frozen)."""
    return CriterionScore(c.name, c.score, weight, c.reason)


def _semantic_criterion(jd: str, candidate_data: dict, weight: int) -> CriterionScore | None:
    """Build a Semantic-fit CriterionScore from embedding similarity.

    Returns ``None`` when embeddings or the vector store are unavailable so the
    caller can fall back to pure keyword scoring without changing weights.
    """
    try:
        from agents.semantic import semantic_fit
    except Exception:
        return None
    try:
        result = semantic_fit(jd, candidate_data=candidate_data)
    except Exception:
        return None
    if not result:
        return None
    score = int(result.get("score", 0))
    skill_matches = result.get("skill_matches") or []
    project_matches = result.get("project_matches") or []
    parts: list[str] = []
    if project_matches:
        parts.append(
            "projects: "
            + ", ".join(f"{name} ({sim:.2f})" for name, sim in project_matches[:2])
        )
    if skill_matches:
        parts.append(
            "skills: "
            + ", ".join(f"{name} ({sim:.2f})" for name, sim in skill_matches[:3])
        )
    reason = "embedding similarity vs current profile vectors"
    if parts:
        reason += " - " + "; ".join(parts)
    return CriterionScore("Semantic fit", score, weight, reason)


def score_job_lead(jd: str, candidate_data: dict) -> ScoreResult:
    candidate = analyze_candidate(candidate_data)
    posting = analyze_posting(jd, "Job lead")
    role = _role_alignment(posting, candidate)
    seniority = _seniority_fit(posting, candidate)
    constraints = _job_constraints(posting, candidate)

    semantic = _semantic_criterion(jd, candidate_data, weight=15)
    if semantic is not None:
        # Hybrid weighting: semantic acts as a tiebreaker, keyword/rubric still leads.
        stack = _stack_overlap(posting, candidate, 20)
        proof = _proof_strength(posting, candidate, 18)
        criteria = [
            _with_weight(role, 15),
            stack,
            proof,
            _with_weight(seniority, 20),
            _with_weight(constraints, 12),
            semantic,
        ]
    else:
        stack = _stack_overlap(posting, candidate, 27)
        proof = _proof_strength(posting, candidate, 20)
        criteria = [role, stack, proof, _with_weight(seniority, 20), constraints]

    direct, adjacent, missing = _direct_and_adjacent(posting, candidate)
    raw = _weighted_total(criteria)
    final, caps = _apply_caps(raw, posting, candidate, direct, adjacent)
    return _result(final, criteria, posting, candidate, direct, adjacent, missing, caps)
