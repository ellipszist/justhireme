import hashlib
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
        t.join(timeout=15)
        if t.is_alive() or exc_holder[0] or result[0] is None:
            raise RuntimeError("SentenceTransformer load timed out or failed — skipping vectors")
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
    if name in vec.list_tables():
        vec.open_table(name).add(rows)
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


def _vectors(p: C):
    try:
        s_rows = [{"id": _h(sk.n), "n": sk.n, "cat": sk.cat} for sk in p.skills]
        if s_rows:
            vecs = _emb([r["n"] for r in s_rows])
            _put_vec("skills", [{**r, "vector": v} for r, v in zip(s_rows, vecs)])

        p_rows = [
            {"id": _h(pr.title), "title": pr.title, "stack": ",".join(pr.stack), "impact": pr.impact}
            for pr in p.projects
        ]
        if p_rows:
            texts = [f"{r['title']} {r['stack']} {r['impact']}" for r in p_rows]
            vecs = _emb(texts)
            _put_vec("projects", [{**r, "vector": v} for r, v in zip(p_rows, vecs)])
    except Exception as exc:
        import traceback
        traceback.print_exc()
        print(f"[ingestor] vectors skipped: {exc}")


def _pdf(path: str) -> str:
    import sys
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


def _parse_local(txt: str) -> C:
    from models.schema import S, E, P

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

    return C(n=name, s=summary, skills=skills, exp=exps, projects=projects)


def run(raw: str = "", pdf: str | None = None) -> C:
    import sys
    from db.client import get_setting
    from llm import call_llm

    txt = (raw + " " + _pdf(pdf)).strip() if pdf else raw
    p = get_setting("llm_provider", "ollama")
    k = get_setting("anthropic_key") or get_setting("groq_api_key") or get_setting("nvidia_api_key")

    if p in ("anthropic", "groq", "nvidia") and not k:
        print(f"[ingestor] provider='{p}' but no API key set — using local parser. "
              "Open Settings and add your API key for AI-powered extraction.", file=sys.stderr)
        return _parse_local(txt)

    try:
        result = call_llm(
            "You are a professional identity extractor. "
            "Parse the supplied resume or profile text and return every skill, "
            "work experience, and project you can identify. "
            "Use concise, factual descriptions.",
            txt,
            C,
        )
        print(f"[ingestor] LLM extraction OK via '{p}' — "
              f"{len(result.skills)} skills, {len(result.exp)} roles, {len(result.projects)} projects",
              file=sys.stderr)
        return result
    except Exception as exc:
        print(f"[ingestor] LLM call failed ({p}): {exc} — falling back to local parser", file=sys.stderr)
        return _parse_local(txt)


def ingest(raw: str = "", pdf: str | None = None) -> C:
    import sys
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
