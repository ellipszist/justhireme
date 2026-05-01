import sys
import hashlib
import re
import kuzu
from db.client import vec
from models.schema import C


_st = None


def _h(t: str) -> str:
    return hashlib.md5(t.encode()).hexdigest()[:12]


def _emb(texts: list[str]) -> list:
    global _st
    if _st is None:
        import signal, threading
        from sentence_transformers import SentenceTransformer
        # Load with a timeout — if model isn't cached this could take minutes
        result = [None]
        exc_holder = [None]
        def _load():
            try:
                result[0] = SentenceTransformer("all-MiniLM-L6-v2")
            except Exception as e:
                exc_holder[0] = e
        t = threading.Thread(target=_load, daemon=True)
        t.start()
        t.join(timeout=120)
        if t.is_alive() or exc_holder[0] or result[0] is None:
            print("[ingestor] SentenceTransformer load timed out or failed — skipping vectors for now", file=sys.stderr)
            return None
        _st = result[0]
    return _st.encode(texts).tolist()


def _conn():
    """Get a fresh Kùzu connection per call to avoid lock contention."""
    from db.client import db
    return kuzu.Connection(db)


def _put_node(tbl: str, props: dict):
    pk = next(iter(props))
    try:
        c = _conn()
        cols = ", ".join(f"{k}: ${k}" for k in props)
        c.execute(f"CREATE (:{tbl} {{{cols}}})", props)
    except Exception:
        try:
            if len(props) > 1:
                c = _conn()
                sets = ", ".join(f"n.{k} = ${k}" for k in props if k != pk)
                c.execute(f"MATCH (n:{tbl}) WHERE n.{pk} = ${pk} SET {sets}", props)
        except Exception:
            pass


def _put_rel(a: str, aid: str, b: str, bid: str, rel: str):
    try:
        c = _conn()
        c.execute(
            f"MATCH (a:{a} {{id: $s}}), (b:{b} {{id: $d}}) MERGE (a)-[:{rel}]->(b)",
            {"s": aid, "d": bid},
        )
    except Exception:
        pass


def _put_vec(name: str, rows: list):
    if not rows:
        return
    ids = [str(row.get("id") or "") for row in rows if row.get("id")]
    if name in vec.list_tables():
        table = vec.open_table(name)
        if ids:
            quoted = ["'" + item.replace("'", "''") + "'" for item in ids]
            try:
                table.delete("id IN (" + ", ".join(quoted) + ")")
            except Exception:
                pass
        table.add(rows)
    else:
        vec.create_table(name, data=rows)


def _graph(p: C):
    cid = _h(p.n)
    _put_node("Candidate", {"id": cid, "n": p.n, "s": p.s})

    for sk in p.skills:
        sid = _h(sk.n)
        _put_node("Skill", {"id": sid, "n": sk.n, "cat": sk.cat})

    for e in p.exp:
        eid = _h(e.role + e.co)
        _put_node("Experience", {"id": eid, "role": e.role, "co": e.co, "period": e.period, "d": e.d})
        _put_rel("Candidate", cid, "Experience", eid, "WORKED_AS")
        for sn in e.s:
            sid = _h(sn)
            _put_node("Skill", {"id": sid, "n": sn, "cat": "general"})
            _put_rel("Experience", eid, "Skill", sid, "EXP_UTILIZES")

    for pr in p.projects:
        pid = _h(pr.title)
        _put_node("Project", {
            "id": pid, "title": pr.title,
            "stack": ",".join(pr.stack), "repo": pr.repo or "", "impact": pr.impact,
        })
        _put_rel("Candidate", cid, "Project", pid, "BUILT")
        for sn in pr.s:
            sid = _h(sn)
            _put_node("Skill", {"id": sid, "n": sn, "cat": "general"})
            _put_rel("Project", pid, "Skill", sid, "PROJ_UTILIZES")

    for cert in getattr(p, "certifications", []) or []:
        title = str(cert or "").strip()
        if not title:
            continue
        sid = _h(title)
        _put_node("Certification", {"id": sid, "title": title})
        _put_rel("Candidate", cid, "Certification", sid, "HAS_CERTIFICATION")

    for item in getattr(p, "education", []) or []:
        title = str(item or "").strip()
        if not title:
            continue
        sid = _h(title)
        _put_node("Education", {"id": sid, "title": title})
        _put_rel("Candidate", cid, "Education", sid, "HAS_EDUCATION")

    for item in getattr(p, "achievements", []) or []:
        title = str(item or "").strip()
        if not title:
            continue
        sid = _h(title)
        _put_node("Achievement", {"id": sid, "title": title})
        _put_rel("Candidate", cid, "Achievement", sid, "HAS_ACHIEVEMENT")


def _vectors(p: C):
    try:
        s_rows = [{"id": _h(sk.n), "n": sk.n, "cat": sk.cat} for sk in p.skills]
        if s_rows:
            vecs = _emb([r["n"] for r in s_rows])
            if vecs:
                _put_vec("skills", [{**r, "vector": v} for r, v in zip(s_rows, vecs)])

        p_rows = [
            {"id": _h(pr.title), "title": pr.title, "stack": ",".join(pr.stack), "impact": pr.impact}
            for pr in p.projects
        ]
        if p_rows:
            texts = [f"{r['title']} {r['stack']} {r['impact']}" for r in p_rows]
            vecs = _emb(texts)
            if vecs:
                _put_vec("projects", [{**r, "vector": v} for r, v in zip(p_rows, vecs)])
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print(f"[ingestor] vectors skipped: {exc}")


def _pdf(path: str) -> str:
    try:
        from pypdf import PdfReader
        pages = PdfReader(path).pages
        text = " ".join(pg.extract_text() or "" for pg in pages)
        if not text.strip():
            print(f"[ingestor] PDF has no extractable text (may be scanned/image-only): {path}", file=sys.stderr)
        return text
    except Exception as exc:
        print(f"[ingestor] PDF read error for {path}: {exc}", file=sys.stderr)
        return ""


def _strip_md(text: str) -> str:
    text = re.sub(r"`([^`]+)`", r"\1", text or "")
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = text.replace("\u2192", "->").replace("\u00b7", "-")
    return re.sub(r"\s+", " ", text).strip(" -")


def _split_csv(value: str) -> list[str]:
    return [_strip_md(part) for part in str(value or "").split(",") if _strip_md(part)]


def _dedupe(items: list[str]) -> list[str]:
    seen = set()
    out = []
    for item in items:
        clean = _strip_md(item)
        key = clean.lower()
        if clean and key not in seen:
            seen.add(key)
            out.append(clean)
    return out


def _section_items(text: str, names: tuple[str, ...]) -> list[str]:
    pattern = "|".join(re.escape(name) for name in names)
    match = re.search(rf"(?im)^\s*#{1,3}\s+(?:\d+\s*/\s*)?(?:{pattern})\b[^\n]*$", text or "")
    if not match:
        return []
    tail = text[match.end():]
    end = re.search(r"(?m)^\s*#{1,3}\s+", tail)
    if end:
        tail = tail[:end.start()]
    items = []
    for line in tail.splitlines():
        clean = _strip_md(re.sub(r"^\s*[-*]\s*", "", line))
        if clean and not clean.startswith("---"):
            items.append(clean)
    return _dedupe(items)


def _section(text: str, start: str, end: str | None = None) -> str:
    start_match = re.search(start, text, flags=re.I | re.M)
    if not start_match:
        return ""
    tail = text[start_match.end():]
    if end:
        end_match = re.search(end, tail, flags=re.I | re.M)
        if end_match:
            tail = tail[:end_match.start()]
    return tail.strip()


def _field(block: str, name: str) -> str:
    match = re.search(rf"(?im)^\s*[-*]?\s*\*\*{re.escape(name)}:\*\*\s*(.+)$", block or "")
    return _strip_md(match.group(1)) if match else ""


def _heading_blocks(section: str) -> list[tuple[str, str]]:
    matches = list(re.finditer(r"(?m)^###\s+(.+?)\s*$", section or ""))
    blocks = []
    for idx, match in enumerate(matches):
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(section)
        blocks.append((_strip_md(match.group(1)), section[match.end():end].strip()))
    return blocks


def _title_from_heading(heading: str) -> str:
    heading = re.sub(r"^\d+\.\s*", "", heading or "").strip()
    return _strip_md(re.sub(r"\s*\([^)]*\)\s*$", "", heading))


def _first_url(value: str) -> str:
    match = re.search(r"https?://[^\s|)]+", value or "")
    return match.group(0) if match else ""


def _project_from_block(heading: str, block: str):
    from models.schema import P

    title = _title_from_heading(heading)
    stack = _split_csv(_field(block, "Tech Stack") or _field(block, "Tech"))
    live = _first_url(_field(block, "Live"))
    video = _first_url(_field(block, "Video"))

    parts = []
    for key in ("Description", "Summary", "Highlights"):
        value = _field(block, key)
        if value:
            parts.append(f"{key}: {value}")

    modal = _section(block, r"(?m)^\s*[-*]?\s*\*\*Modal Details:\*\*", None)
    if not modal:
        modal = _section(block, r"(?m)^\s*\*\*Project Modal Details:\*\*", None)
    if modal:
        cleaned = "\n".join(_strip_md(line) for line in modal.splitlines() if _strip_md(line))
        if cleaned:
            parts.append(cleaned)

    if live:
        parts.append(f"Live: {live}")
    if video:
        parts.append(f"Video: {video}")

    return P(
        title=title,
        stack=stack,
        repo=live or video or "",
        impact="\n".join(parts).strip(),
        s=stack,
    )


def _parse_portfolio_markdown(txt: str):
    from models.schema import S, E, P

    if not re.search(r"(?i)portfolio content|selected work|technical expertise", txt or ""):
        return None

    hero = _section(txt, r"(?m)^##\s+Hero Section", r"(?m)^---\s*$")
    name = _field(hero, "Name") or "Candidate"
    tagline = _field(hero, "Tagline")

    exp_section = _section(txt, r"(?m)^##\s+01\s*/\s*Experience", r"(?m)^##\s+02\s*/")
    exp = []
    if exp_section:
        period_line = ""
        period_match = re.search(r"(?m)^\*\*(.+?)\*\*\s*$", exp_section)
        if period_match:
            period_line = _strip_md(period_match.group(1))
        role_match = re.search(r"(?m)^###\s+(.+?)\s*$", exp_section)
        role = _strip_md(role_match.group(1)) if role_match else "Full-Stack Engineer"
        company = "Freelance"
        if "|" in period_line:
            period, rest = [part.strip() for part in period_line.split("|", 1)]
            company = _strip_md(rest.split("-")[0])
        else:
            period = period_line
        exp_stack = _split_csv(_field(exp_section, "Tech Stack"))
        detail_lines = [
            _strip_md(line)
            for line in exp_section.splitlines()
            if _strip_md(line)
            and not line.strip().startswith("#")
            and not re.match(r"^\*\*.*\*\*$", line.strip())
        ]
        exp.append(E(role=role, co=company or "Freelance", period=period, d="\n".join(detail_lines), s=exp_stack))

    selected = _section(txt, r"(?m)^##\s+02\s*/\s+Selected Work", r"(?m)^##\s+03\s*/")
    more = _section(txt, r"(?m)^##\s+03\s*/\s+More from GitHub", r"(?m)^##\s+04\s*/")
    projects: list[P] = []
    for section_text in (selected, more):
        for heading, block in _heading_blocks(section_text):
            project = _project_from_block(heading, block)
            if project.title:
                projects.append(project)

    expertise = _section(txt, r"(?m)^##\s+04\s*/\s+Technical Expertise", r"(?m)^##\s+05\s*/")
    skill_names = []
    for line in expertise.splitlines():
        match = re.match(r"\s*[-*]\s*\*\*([^:]+):\*\*\s*(.+)$", line)
        if match:
            skill_names.extend(_split_csv(match.group(2)))
    for project in projects:
        skill_names.extend(project.stack)
    for item in exp:
        skill_names.extend(item.s)

    skills = [S(n=skill, cat="portfolio") for skill in _dedupe(skill_names)]
    services = _section(txt, r"(?m)^##\s+06\s*/\s+Services", r"(?m)^##\s+07\s*/")
    contact = _section(txt, r"(?m)^##\s+07\s*/\s+Contact", None)
    summary_parts = [tagline]
    if services:
        summary_parts.append("Services: " + " ".join(_strip_md(line) for line in services.splitlines() if _strip_md(line)))
    if contact:
        email = re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", contact)
        if email:
            summary_parts.append(f"Contact: {email.group(0)}")

    return C(
        n=name,
        s="\n".join(part for part in summary_parts if part),
        skills=skills,
        exp=exp,
        projects=projects,
        certifications=_section_items(txt, ("certifications", "credentials", "certificates")),
        education=_section_items(txt, ("education", "academic background")),
        achievements=_section_items(txt, ("achievements", "awards", "honors")),
    )


def _parse_local(txt: str) -> C:
    from models.schema import S, E, P

    portfolio = _parse_portfolio_markdown(txt)
    if portfolio is not None:
        return portfolio

    lines = txt.strip().splitlines()
    fields: dict[str, str] = {}
    projects_raw: list[str] = []
    exp_raw: list[str] = []

    section = "fields"
    buf: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped == "--- Projects ---":
            section = "projects"
            continue
        if stripped == "--- Experience ---":
            if buf and section == "projects":
                projects_raw.append("\n".join(buf))
                buf = []
            section = "experience"
            continue

        if section == "fields":
            if ": " in stripped:
                k, v = stripped.split(": ", 1)
                fields[k.strip()] = v.strip()

        elif section == "projects":
            if stripped.startswith("Project: ") and buf:
                projects_raw.append("\n".join(buf))
                buf = []
            buf.append(stripped)

        elif section == "experience":
            if stripped.startswith("Experience: ") and buf:
                exp_raw.append("\n".join(buf))
                buf = []
            buf.append(stripped)

    if buf:
        if section == "projects":
            projects_raw.append("\n".join(buf))
        elif section == "experience":
            exp_raw.append("\n".join(buf))

    name = fields.get("name", "") or fields.get("targetRole", "") or "Candidate"
    summary = fields.get("summary", "")

    projects: list[P] = []
    for block in projects_raw:
        pf: dict[str, str] = {}
        for pline in block.splitlines():
            if ": " in pline:
                pk, pv = pline.split(": ", 1)
                pf[pk.strip()] = pv.strip()
        if pf.get("Project"):
            stack_str = pf.get("Stack", "")
            projects.append(P(
                title=pf["Project"],
                stack=[s.strip() for s in stack_str.split(",") if s.strip()],
                repo=pf.get("Repo", ""),
                impact=pf.get("Impact", ""),
                s=[s.strip() for s in stack_str.split(",") if s.strip()],
            ))

    exps: list[E] = []
    for block in exp_raw:
        ef: dict[str, str] = {}
        for eline in block.splitlines():
            if eline.startswith("Experience: "):
                parts = eline.replace("Experience: ", "").split(" at ", 1)
                ef["role"] = parts[0].strip()
                ef["co"] = parts[1].strip() if len(parts) > 1 else ""
            elif ": " in eline:
                ek, ev = eline.split(": ", 1)
                ef[ek.strip()] = ev.strip()
        if ef.get("role"):
            exps.append(E(
                role=ef["role"],
                co=ef.get("co", ""),
                period=ef.get("Period", ""),
                d=ef.get("Description", ""),
                s=[],
            ))

    skill_names: set[str] = set()
    for p in projects:
        skill_names.update(p.stack)
    skills = [S(n=sn, cat="general") for sn in skill_names if sn]

    certifications = _split_csv(fields.get("certifications", "") or fields.get("certs", ""))
    education = _split_csv(fields.get("education", ""))
    achievements = _split_csv(fields.get("achievements", "") or fields.get("awards", ""))

    return C(
        n=name,
        s=summary,
        skills=skills,
        exp=exps,
        projects=projects,
        certifications=certifications,
        education=education,
        achievements=achievements,
    )


def run(raw: str = "", pdf: str | None = None) -> C:
    from llm import call_llm, resolve_config

    txt = (raw + " " + _pdf(pdf)).strip() if pdf else raw
    p, k, model = resolve_config("ingestor")

    if p != "ollama" and not k:
        print(f"[ingestor] provider='{p}' but no API key set — using local parser. "
              "Open Settings and add your API key for AI-powered extraction.", file=sys.stderr)
        return _parse_local(txt)

    try:
        result = call_llm(
            "You are a professional identity extractor. "
            "Parse the supplied resume or profile text and return every skill, "
            "work experience, project, certification, education item, and achievement you can identify. "
            "Use concise, factual descriptions.",
            txt,
            C,
            step="ingestor",
        )
        print(f"[ingestor] LLM extraction OK via '{p}' — "
              f"{len(result.skills)} skills, {len(result.exp)} roles, {len(result.projects)} projects, "
              f"{len(result.certifications)} certifications",
              file=sys.stderr)
        return result
    except Exception as exc:
        if p != "ollama":
            print(f"[ingestor] LLM call failed ({p}): {exc}", file=sys.stderr)
            raise RuntimeError(f"{p} extraction failed: {exc}") from exc
        print(f"[ingestor] LLM call failed ({p}): {exc} — falling back to local parser", file=sys.stderr)
        return _parse_local(txt)


def ingest(raw: str = "", pdf: str | None = None) -> C:
    pdf_text = _pdf(pdf) if pdf else ""
    txt = (raw + " " + pdf_text).strip() if pdf_text else raw
    if not txt.strip():
        print("[ingestor] No usable text for extraction — returning empty profile", file=sys.stderr)
        return C(n="Unknown", s="")
    p = run(txt)
    try:
        _graph(p)
    except Exception as exc:
        print(f"[ingestor] graph write skipped: {exc}")
    try:
        _vectors(p)
    except Exception as exc:
        print(f"[ingestor] vector write skipped: {exc}")
    return p
