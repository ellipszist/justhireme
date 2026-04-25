from pydantic import BaseModel, Field
from typing import List
from db.client import conn, vec

_st = None


def _emb(t: str) -> list:
    global _st
    if _st is None:
        from sentence_transformers import SentenceTransformer
        _st = SentenceTransformer("all-MiniLM-L6-v2")
    return _st.encode([t]).tolist()[0]


def _get_proof(skills: list[str]) -> str:
    parts = []

    for sk in skills:
        q = conn.execute(
            """
            MATCH (p:Project)-[:PROJ_UTILIZES]->(s:Skill)
            WHERE s.n = $n
            RETURN p.title, p.stack, p.impact
            """,
            {"n": sk},
        )
        while q.has_next():
            row = q.get_next()
            parts.append(f"Project: {row[0]} | Stack: {row[1]} | Impact: {row[2]}")

        q = conn.execute(
            """
            MATCH (e:Experience)-[:EXP_UTILIZES]->(s:Skill)
            WHERE s.n = $n
            RETURN e.role, e.co, e.d
            """,
            {"n": sk},
        )
        while q.has_next():
            row = q.get_next()
            parts.append(f"Role: {row[0]} at {row[1]} | {row[2]}")

    if not parts and "skills" in vec.list_tables():
        tbl = vec.open_table("skills")
        for sk in skills:
            v = _emb(sk)
            res = tbl.search(v).limit(3).to_list()
            for row in res:
                sn = row.get("n", "")
                q = conn.execute(
                    """
                    MATCH (p:Project)-[:PROJ_UTILIZES]->(s:Skill)
                    WHERE s.n = $n
                    RETURN p.title, p.stack, p.impact
                    """,
                    {"n": sn},
                )
                while q.has_next():
                    r = q.get_next()
                    parts.append(f"Project: {r[0]} | Stack: {r[1]} | Impact: {r[2]}")

    return "\n".join(parts) if parts else "No proof of work found."


class _Score(BaseModel):
    score:        int
    reason:       str
    match_points: List[str] = Field(default_factory=list)


def score(jd: str, skills: list[str]) -> dict:
    from llm import call_llm
    p = _get_proof(skills)
    o = call_llm(
        "You are a recruitment evaluator. "
        "Compare the job description against the candidate's proof of work. "
        "Score 0-100 based on skill overlap and relevance. "
        "Be strict: score >= 85 only if genuinely strong match.",
        f"JOB DESCRIPTION:\n{jd}\n\nCANDIDATE PROOF OF WORK:\n{p}",
        _Score,
    )
    return {"score": o.score, "reason": o.reason, "match_points": o.match_points}
