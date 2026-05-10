from regression_support import *  # noqa: F401,F403

class RegressionTests(unittest.TestCase):
    def test_profile_update_bodies_accept_existing_item_ids(self):
        from core.types import ExperienceBody, ProjectBody

        exp = ExperienceBody.model_validate({"id": "exp-1", "role": "Engineer", "co": "Acme"})
        project = ProjectBody.model_validate({"id": "proj-1", "title": "Agent", "stack": "Python"})

        self.assertEqual(exp.id, "exp-1")
        self.assertEqual(project.id, "proj-1")

    def test_settings_body_keeps_dynamic_keys_but_rejects_objects(self):
        from core.types import SettingsBody

        valid = SettingsBody.model_validate({"llm_provider": "deepseek", "ghost_mode": True})
        self.assertEqual(valid.model_dump()["llm_provider"], "deepseek")

        with self.assertRaises(ValueError):
            SettingsBody.model_validate({"bad key": "x"})

        with self.assertRaises(ValueError):
            SettingsBody.model_validate({"nested": {"oops": True}})

    def test_job_reevaluation_preserves_active_workflow_statuses(self):
        from api.routers.discovery import should_preserve_job_status

        for status in ["approved", "applied", "interviewing", "rejected", "accepted", "discarded"]:
            self.assertTrue(should_preserve_job_status(status))

        for status in ["discovered", "tailoring"]:
            self.assertFalse(should_preserve_job_status(status))

    def test_job_reevaluation_prompt_includes_full_job_context(self):
        from ranking.service import RankingService

        doc = RankingService.job_document({
            "title": "Applied AI Engineer",
            "company": "Acme",
            "url": "https://example.com/job",
            "description": "Build FastAPI and React agents.",
        })

        self.assertIn("Job Title: Applied AI Engineer", doc)
        self.assertIn("Company: Acme", doc)
        self.assertIn("URL: https://example.com/job", doc)
        self.assertIn("Description: Build FastAPI and React agents.", doc)

    def test_agent_event_action_formats_durable_log_lines(self):
        import main

        self.assertEqual(
            main._agent_event_action({"event": "cleanup_done", "msg": "discarded 2 bad rows"}),
            "cleanup_done: discarded 2 bad rows",
        )
        self.assertEqual(main._agent_event_action({"event": "heartbeat"}), "heartbeat")

    def test_profile_read_falls_back_to_snapshot_instead_of_emptying_ui(self):
        from data.graph import profile

        snapshot = {
            "n": "Existing Candidate",
            "s": "AI engineer",
            "skills": [{"id": "py", "n": "Python", "cat": "technical"}],
            "projects": [{"id": "p1", "title": "Agent", "stack": ["Python"], "repo": "", "impact": "Built it"}],
            "exp": [{"id": "e1", "role": "Engineer", "co": "Acme", "period": "2024", "d": "Built systems"}],
        }

        with mock.patch.object(profile, "load_profile_snapshot", return_value=snapshot), \
             mock.patch.object(profile, "read_profile_from_graph", side_effect=RuntimeError("graph read failed")):
            self.assertEqual(profile.get_profile(), snapshot)

    def test_profile_stack_normalizer_accepts_existing_list_values(self):
        from data.graph import profile

        self.assertEqual(profile.stack_list(["Python", " React ", ""]), ["Python", "React"])
        self.assertEqual(profile.stack_list("Python, React"), ["Python", "React"])

    def test_ingestor_parses_portfolio_markdown_into_graph_entities(self):
        from profile.ingestor import _parse_local

        markdown = """
# Vasu DevS - Portfolio Content

## Hero Section
- **Name:** Vasu DevS
- **Tagline:** A 21-year-old self-taught Full Stack AI Engineer based in India.

---

## 01 / Experience
**Mar 2026 -> Apr 2026 | Freelance - Sole engineer**
### Full-Stack Engineer - Internal Finance & P&L Platform
End-to-end build of a production-grade financial reporting platform.
**Tech Stack:** Next.js 15, TypeScript, PostgreSQL, Prisma 7, Tailwind 4

---

## 02 / Selected Work (Featured Projects)
### 1. BranchGPT (Context Optimization / AI)
**Live:** https://branchgpt.vasudev.live/ | **Video:** https://youtu.be/RB3zvAXbpL0
**Summary:** Conversations are trees, not lists.
**Highlights:**
- Conversations as DAGs
**Tech Stack:** Next.js 16, TypeScript, Drizzle ORM, Neon Postgres

### 2. Vaani (Voice AI / Fintech)
**Summary:** Voice-native debt-recovery command center.
**Tech Stack:** Python, FastAPI, LiveKit Agents, Groq, Deepgram

## 03 / More from GitHub (Public Work & Modals)
### Waldo (Python)
- **Summary:** Production-grade agentic RAG pipeline.
- **Tech:** Python, FastAPI, React, Qdrant, LangGraph

## 04 / Technical Expertise
- **Languages:** Python, TypeScript, JavaScript, C++
- **Frontend:** Next.js, React, Vite

## 05 / Community (Open Source Impact)
## 06 / Services (What I Build)
- **AI Agents & Automation:** Multi-agent pipelines.
## 07 / Contact (Footer)
- Email: siddhvasudev1402@gmail.com
"""

        profile = _parse_local(markdown)

        self.assertEqual(profile.n, "Vasu DevS")
        self.assertGreaterEqual(len(profile.skills), 8)
        self.assertEqual(profile.exp[0].role, "Full-Stack Engineer - Internal Finance & P&L Platform")
        self.assertIn("BranchGPT", [p.title for p in profile.projects])
        self.assertIn("Waldo", [p.title for p in profile.projects])
        self.assertIn("siddhvasudev1402@gmail.com", profile.s)
