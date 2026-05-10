from ranking.criteria import DEFAULT_CRITERIA, criteria_by_key, criteria_by_name
from ranking.scoring_engine import ScoringEngine, score_job_lead


def test_default_criteria_registry_matches_roadmap():
    keys = [criterion.key for criterion in DEFAULT_CRITERIA]
    weights = {criterion.key: criterion.max_weight for criterion in DEFAULT_CRITERIA}

    assert keys == [
        "role_alignment",
        "stack_coverage",
        "evidence",
        "seniority_fit",
        "logistics",
        "learning_curve",
    ]
    assert weights == {
        "role_alignment": 15,
        "stack_coverage": 22,
        "evidence": 20,
        "seniority_fit": 25,
        "logistics": 13,
        "learning_curve": 5,
    }
    assert criteria_by_key()["stack_coverage"].name == "Stack overlap"
    assert criteria_by_name()["Proof of work"].key == "evidence"


def test_scoring_engine_facade_matches_function():
    jd = "Job Title: Junior Python Engineer\nDescription: Build FastAPI services with React dashboards."
    profile = {
        "s": "Junior Python developer",
        "skills": [{"n": "Python"}, {"n": "FastAPI"}, {"n": "React"}],
        "projects": [{"title": "API Dashboard", "stack": ["Python", "FastAPI", "React"], "impact": "Built dashboards"}],
        "exp": [],
    }

    direct = score_job_lead(jd, profile)
    via_engine = ScoringEngine().score(jd, profile)

    assert via_engine.score == direct.score
    assert via_engine.reason == direct.reason
