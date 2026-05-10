from __future__ import annotations

from generation.generators.cover_letter import CoverLetterGenerator
from generation.generators.founder_message import FounderMessageGenerator
from generation.generators.keywords import KeywordsGenerator
from generation.generators.linkedin_message import LinkedInMessageGenerator
from generation.generators.outreach_email import OutreachEmailGenerator
from generation.generators.resume import ResumeGenerator


def test_generation_generators_expose_expected_assets():
    profile = {
        "candidate": {"name": "Vasu", "summary": "Builds AI products."},
        "skills": [{"n": "FastAPI"}, {"n": "React"}],
        "projects": [{"title": "Agent CRM", "stack": ["FastAPI", "React"], "impact": "Shipped workflows."}],
    }
    lead = {
        "title": "AI Engineer",
        "company": "Acme",
        "description": "Build FastAPI and React AI workflows.",
    }

    assert ResumeGenerator().generate(lead, profile)["text"]
    assert CoverLetterGenerator().generate(lead, profile)["text"]
    assert FounderMessageGenerator().generate(lead, profile)["text"]
    assert LinkedInMessageGenerator().generate(lead, profile)["text"]
    assert OutreachEmailGenerator().generate(lead, profile)["text"]
    assert KeywordsGenerator().generate(lead, profile)["metadata"]["jd_terms"]
