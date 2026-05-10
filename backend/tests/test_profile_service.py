import asyncio

from profile.service import ProfileService


def test_profile_service_import_profile_data_counts_and_identity(monkeypatch):
    service = ProfileService()
    calls = {"settings": []}

    monkeypatch.setattr(service, "update_candidate", lambda name, summary: {"n": name, "s": summary})
    monkeypatch.setattr(service, "add_skill", lambda name, category: {"n": name, "cat": category})
    monkeypatch.setattr(service, "add_experience", lambda role, company, period, description: {"role": role})
    monkeypatch.setattr(service, "add_project", lambda title, stack, repo, impact: {"title": title})
    monkeypatch.setattr(service, "add_education", lambda title: {"title": title})
    monkeypatch.setattr(service, "add_certification", lambda title: {"title": title})
    monkeypatch.setattr(service, "add_achievement", lambda title: {"title": title})

    def fake_save_settings(data):
        calls["settings"].append(data)

    monkeypatch.setattr("profile.service.settings.save_settings", fake_save_settings)

    result = asyncio.run(service.import_profile_data({
        "candidate": {"name": "Vasu", "summary": "AI engineer"},
        "identity": {"email": "vasu@example.com", "github_url": "https://github.com/vasu"},
        "skills": [{"name": "Python", "category": "technical"}],
        "experience": [{"role": "Engineer", "company": "Acme", "period": "2024", "description": "Built agents"}],
        "projects": [{"title": "JustHireMe", "stack": "Python, React", "repo": "", "impact": "Local-first job workbench"}],
        "education": [{"title": "B.Tech"}],
        "certifications": [{"title": "Cloud cert"}],
        "achievements": [{"title": "Shipped product"}],
    }))

    assert result["status"] == "ok"
    assert result["stats"] == {
        "skills": 1,
        "experience": 1,
        "projects": 1,
        "education": 1,
        "certifications": 1,
        "achievements": 1,
    }
    assert {"email": "vasu@example.com"} in calls["settings"]
    assert {"github_url": "https://github.com/vasu"} in calls["settings"]


def test_profile_service_import_profile_data_accepts_legacy_keys(monkeypatch):
    service = ProfileService()
    seen = {}

    monkeypatch.setattr(service, "add_skill", lambda name, category: seen.setdefault("skill", (name, category)))
    monkeypatch.setattr(service, "add_experience", lambda role, company, period, description: seen.setdefault("exp", (role, company, period, description)))

    result = asyncio.run(service.import_profile_data({
        "skills": [{"n": "FastAPI", "cat": "backend"}],
        "experience": [{"role": "Dev", "co": "Acme", "period": "2025", "d": "APIs"}],
    }))

    assert result["status"] == "ok"
    assert seen["skill"] == ("FastAPI", "backend")
    assert seen["exp"] == ("Dev", "Acme", "2025", "APIs")

