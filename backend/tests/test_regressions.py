import os
from pathlib import Path
import sys
import types
import unittest
from unittest import mock


os.environ["LOCALAPPDATA"] = str(Path(__file__).resolve().parent)
os.makedirs = lambda *_args, **_kwargs: None


class _FakeResult:
    def has_next(self):
        return False

    def get_next(self):
        return [0]


class _FakeConnection:
    def execute(self, *_args, **_kwargs):
        return _FakeResult()


class _FakeSqlConnection:
    def executescript(self, *_args, **_kwargs):
        return self

    def execute(self, *_args, **_kwargs):
        return self

    def fetchone(self):
        return None

    def fetchall(self):
        return []

    def commit(self):
        return None

    def close(self):
        return None


class _FakeVectorStore:
    def list_tables(self):
        return []

    def create_table(self, *_args, **_kwargs):
        return None

    def open_table(self, *_args, **_kwargs):
        return self

    def add(self, *_args, **_kwargs):
        return None


class _FakeSemanticSearch:
    def __init__(self, rows):
        self.rows = list(rows)
        self._limit = len(self.rows)

    def metric(self, *_args, **_kwargs):
        return self

    def where(self, clause, *_args, **_kwargs):
        self.rows = [row for row in self.rows if f"'{row['id']}'" in clause]
        return self

    def limit(self, limit):
        self._limit = limit
        return self

    def to_list(self):
        return self.rows[: self._limit]


class _FakeSemanticTable:
    def __init__(self, rows):
        self.rows = rows

    def search(self, *_args, **_kwargs):
        return _FakeSemanticSearch(self.rows)


class _FakeSemanticStore:
    def __init__(self, tables):
        self.tables = tables

    def list_tables(self):
        return list(self.tables)

    def open_table(self, name):
        return _FakeSemanticTable(self.tables[name])


def _install_storage_fakes():
    sys.modules.setdefault("kuzu", types.SimpleNamespace(Database=lambda _path: object(), Connection=lambda _db: _FakeConnection()))
    sys.modules["sqlite3"] = types.SimpleNamespace(connect=lambda _path: _FakeSqlConnection())
    sys.modules.setdefault(
        "lancedb",
        types.SimpleNamespace(LanceDBConnection=_FakeVectorStore, connect=lambda _path: _FakeVectorStore()),
    )


_install_storage_fakes()


def _sample_scoring_profile():
    return {
        "n": "Candidate",
        "s": "Full Stack AI Engineer based in India",
        "skills": [
            {"n": "Python"},
            {"n": "FastAPI"},
            {"n": "React"},
            {"n": "Next.js"},
            {"n": "TypeScript"},
            {"n": "PostgreSQL"},
            {"n": "LangGraph"},
            {"n": "Qdrant"},
        ],
        "projects": [
            {
                "title": "Waldo",
                "stack": ["Python", "FastAPI", "React", "Qdrant", "LangGraph"],
                "impact": "Production-grade agentic RAG pipeline.",
            },
            {
                "title": "Vaani",
                "stack": ["Python", "FastAPI", "LiveKit Agents", "Deepgram"],
                "impact": "Voice AI debt recovery command center.",
            },
            {
                "title": "BranchGPT",
                "stack": ["Next.js", "TypeScript", "Drizzle ORM", "Neon Postgres"],
                "impact": "Conversation DAG product.",
            },
        ],
        "exp": [
            {
                "role": "Full-Stack Engineer",
                "co": "Freelance",
                "period": "Mar 2026-Apr 2026",
                "d": "Built financial reporting platform with Next.js, TypeScript, PostgreSQL, Prisma.",
            }
        ],
    }


class RegressionTests(unittest.TestCase):
    def test_job_evaluator_is_deterministic_and_quantified(self):
        from agents.evaluator import score

        jd = (
            "Job Title: Applied AI Engineer\n"
            "Company: Acme\n"
            "Description: Build RAG agents with Python, FastAPI, React, "
            "LangGraph, Qdrant. 1+ years. Remote."
        )

        first = score(jd, _sample_scoring_profile())
        second = score(jd, _sample_scoring_profile())

        self.assertEqual(first, second)
        self.assertGreaterEqual(first["score"], 85)
        self.assertTrue(any("Stack overlap" in point and "/100" in point for point in first["match_points"]))
        self.assertTrue(any("Proof of work" in point and "Waldo" in point for point in first["match_points"]))

    def test_job_evaluator_uses_llm_when_configured(self):
        from agents.evaluator import score

        expected = {
            "score": 88,
            "reason": "LLM fit based on projects and certifications.",
            "match_points": ["Waldo proves RAG agent work."],
            "gaps": ["No Kubernetes production experience."],
        }

        with mock.patch("agents.evaluator._evaluator_llm_requested", return_value=True), \
             mock.patch("agents.evaluator._score_with_llm", return_value=expected) as score_with_llm:
            result = score(
                "Job Title: Applied AI Engineer\nDescription: Build RAG agents.",
                {**_sample_scoring_profile(), "certifications": ["AWS Cloud Practitioner"]},
            )

        self.assertEqual(result, expected)
        score_with_llm.assert_called_once()

    def test_evaluator_prompt_includes_profile_extras(self):
        from agents.evaluator import _user_prompt

        profile = {
            **_sample_scoring_profile(),
            "certifications": ["AWS Cloud Practitioner"],
            "education": ["B.Tech Computer Science"],
            "achievements": ["Winner, AI hackathon"],
            "portfolio": "https://example.com",
        }
        prompt = _user_prompt("Job Title: AI Engineer", profile, {"score": 80, "reason": "baseline"})

        self.assertIn("AWS Cloud Practitioner", prompt)
        self.assertIn("B.Tech Computer Science", prompt)
        self.assertIn("Winner, AI hackathon", prompt)
        self.assertIn("https://example.com", prompt)

    def test_job_evaluator_applies_wrong_field_and_seniority_caps(self):
        from agents.evaluator import score

        profile = _sample_scoring_profile()
        nurse = score("Job Title: Registered Nurse\nDescription: ICU nurse needed.", profile)
        senior = score(
            "Job Title: Senior Platform Engineer\n"
            "Description: Requires 7+ years Kubernetes, AWS, Go, and distributed systems.",
            profile,
        )

        self.assertLessEqual(nurse["score"], 15)
        self.assertTrue(any("wrong-field cap" in gap for gap in nurse["gaps"]))
        self.assertLessEqual(senior["score"], 30)
        self.assertTrue(any("seniority cap" in gap for gap in senior["gaps"]))

    def test_zero_experience_vs_senior_role_gets_hard_capped(self):
        from agents.evaluator import score

        # Profile with strong stack match but ZERO professional experience
        zero_exp_profile = {
            "n": "Candidate",
            "s": "Full Stack AI Engineer based in India",
            "skills": [
                {"n": "React"},
                {"n": "Next.js"},
                {"n": "TypeScript"},
                {"n": "Node.js"},
                {"n": "FastAPI"},
                {"n": "PostgreSQL"},
                {"n": "Docker"},
            ],
            "projects": [
                {
                    "title": "BranchGPT",
                    "stack": ["Next.js", "TypeScript", "Drizzle ORM", "Neon Postgres"],
                    "impact": "Conversation DAG product.",
                },
                {
                    "title": "Waldo",
                    "stack": ["Python", "FastAPI", "React", "Qdrant", "LangGraph"],
                    "impact": "Production-grade agentic RAG pipeline.",
                },
                {
                    "title": "Vaani",
                    "stack": ["Python", "FastAPI", "LiveKit Agents", "Deepgram"],
                    "impact": "Voice AI debt recovery command center.",
                },
            ],
            "exp": [],  # No professional experience at all
        }

        senior_react = score(
            "Job Title: Senior Full stack React Developer\n"
            "Company: Lemon.io\n"
            "Description: Looking for a senior full-stack React developer "
            "with strong TypeScript, Node.js, and PostgreSQL skills. Remote.",
            zero_exp_profile,
        )

        # Must NOT be in the "strong fit" or "excellent fit" bands —
        # zero professional experience vs Senior title is a hard mismatch.
        self.assertLessEqual(senior_react["score"], 30,
            f"Zero-experience candidate got {senior_react['score']}/100 for a Senior role — "
            "seniority cap should prevent this")
        self.assertTrue(any("seniority cap" in gap for gap in senior_react["gaps"]))

    def test_semantic_skips_embedding_when_vector_tables_are_missing(self):
        from agents import semantic

        with mock.patch.object(semantic, "_embed_jd", side_effect=AssertionError("embedding should not load")):
            self.assertIsNone(semantic.semantic_fit("Need Python RAG engineer", candidate_data=_sample_scoring_profile()))

    def test_semantic_search_is_scoped_to_current_profile_vectors(self):
        from agents import semantic

        profile = {
            "skills": [{"n": "FastAPI"}],
            "projects": [{"title": "Waldo"}],
        }
        store = _FakeSemanticStore({
            "skills": [
                {"id": semantic._h("StaleSkill"), "n": "StaleSkill", "_distance": 0.01},
                {"id": semantic._h("FastAPI"), "n": "FastAPI", "_distance": 0.12},
            ],
            "projects": [
                {"id": semantic._h("Old Project"), "title": "Old Project", "_distance": 0.01},
                {"id": semantic._h("Waldo"), "title": "Waldo", "_distance": 0.10},
            ],
        })

        with mock.patch.object(semantic, "_vec_store", return_value=store), \
             mock.patch.object(semantic, "_embed_jd", return_value=[0.0, 1.0]):
            result = semantic.semantic_fit("Build a FastAPI RAG platform", candidate_data=profile)

        self.assertIsNotNone(result)
        self.assertEqual([name for name, _sim in result["skill_matches"]], ["FastAPI"])
        self.assertEqual([name for name, _sim in result["project_matches"]], ["Waldo"])

    def test_evaluator_passes_current_profile_into_semantic_signal(self):
        from agents.evaluator import score

        profile = _sample_scoring_profile()
        semantic_result = {
            "score": 82,
            "skill_matches": [("FastAPI", 0.71)],
            "project_matches": [("Waldo", 0.76)],
        }
        with mock.patch("agents.semantic.semantic_fit", return_value=semantic_result) as semantic_fit:
            result = score(
                "Job Title: Applied AI Engineer\nDescription: Build RAG agents with FastAPI and Qdrant.",
                profile,
            )

        self.assertIs(semantic_fit.call_args.kwargs["candidate_data"], profile)
        self.assertTrue(any("Semantic fit" in point for point in result["match_points"]))

    def test_score_lists_preserve_commas_when_json_encoded(self):
        from db import client

        encoded = client._json_dumps_list(["FastAPI, React, PostgreSQL", "LLM agents"])
        self.assertEqual(
            client._json_list(encoded),
            ["FastAPI, React, PostgreSQL", "LLM agents"],
        )
        self.assertEqual(client._json_list("FastAPI, React"), ["FastAPI", "React"])

    def test_fire_blocker_requires_real_resume_and_cover_letter(self):
        import main

        existing_path = __file__
        lead = {"url": "https://example.com/apply", "cover_letter_asset": existing_path}
        self.assertEqual(main._fire_blocker(lead, existing_path), (0, ""))

        missing_cover = {"url": "https://example.com/apply", "cover_letter_asset": ""}
        self.assertEqual(main._fire_blocker(missing_cover, existing_path)[0], 409)
        self.assertEqual(main._fire_blocker({}, existing_path)[0], 404)

    def test_generator_splits_flexible_cover_letter_starts(self):
        from agents.generator import _DocPackage, _normalize_package

        package = _DocPackage(
            selected_projects=["AgentOps"],
            resume_markdown=(
                "# Candidate\n\n"
                "## Summary\n"
                "Backend engineer focused on AI products.\n\n"
                "## Selected Projects\n"
                "- AgentOps: shipped a FastAPI and React workflow.\n\n"
                "## Cover Letter for Acme AI\n\n"
                "Dear Acme AI team,\n\n"
                "I am excited about the Applied AI Engineer role because it matches my agent workflow experience."
            ),
            cover_letter_markdown="",
        )
        profile = {
            "n": "Candidate",
            "s": "Backend engineer focused on AI products.",
            "skills": [{"n": "FastAPI"}, {"n": "React"}],
            "projects": [{"title": "AgentOps", "stack": ["FastAPI", "React"], "impact": "Built agent workflows."}],
            "exp": [],
        }
        lead = {"title": "Applied AI Engineer", "company": "Acme AI", "description": "FastAPI React agents"}

        normalized = _normalize_package(package, profile, lead)

        self.assertNotIn("Cover Letter", normalized.resume_markdown)
        self.assertNotIn("Dear Acme", normalized.resume_markdown)
        self.assertIn("Dear Acme AI team", normalized.cover_letter_markdown)

    def test_generator_render_keeps_pdf_to_one_page(self):
        from pypdf import PdfReader
        import agents.generator as generator

        long_resume = "# Candidate\n\n## Summary\n" + "\n".join(
            f"- Built AI platform feature {i} with FastAPI, React, queues, and measurable product impact."
            for i in range(90)
        )

        test_tmp_root = Path(__file__).resolve().parent
        previous_assets = generator._assets
        generator._assets = str(test_tmp_root)
        path = test_tmp_root / "one_page_test.pdf"
        try:
            rendered = generator._render(long_resume, path.name, kind="resume")
            with open(rendered, "rb") as fh:
                self.assertEqual(len(PdfReader(fh).pages), 1)
        finally:
            generator._assets = previous_assets
            try:
                path.unlink()
            except FileNotFoundError:
                pass

    def test_profile_update_bodies_accept_existing_item_ids(self):
        import main

        exp = main.ExperienceBody.model_validate({"id": "exp-1", "role": "Engineer", "co": "Acme"})
        project = main.ProjectBody.model_validate({"id": "proj-1", "title": "Agent", "stack": "Python"})

        self.assertEqual(exp.id, "exp-1")
        self.assertEqual(project.id, "proj-1")

    def test_settings_body_keeps_dynamic_keys_but_rejects_objects(self):
        import main

        valid = main.SettingsBody.model_validate({"llm_provider": "deepseek", "ghost_mode": True})
        self.assertEqual(valid.model_dump()["llm_provider"], "deepseek")

        with self.assertRaises(ValueError):
            main.SettingsBody.model_validate({"bad key": "x"})

        with self.assertRaises(ValueError):
            main.SettingsBody.model_validate({"nested": {"oops": True}})

    def test_job_reevaluation_preserves_active_workflow_statuses(self):
        import main

        for status in ["approved", "applied", "interviewing", "rejected", "accepted", "discarded"]:
            self.assertTrue(main._should_preserve_job_status(status))

        for status in ["discovered", "tailoring"]:
            self.assertFalse(main._should_preserve_job_status(status))

    def test_job_reevaluation_prompt_includes_full_job_context(self):
        import main

        doc = main._job_eval_document({
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

    def test_cleanup_flags_hn_discussion_comments_but_not_jobs(self):
        from db import client

        bad = {
            "title": "Maybe Claude code/anthropic should deprecate hooks",
            "company": "HN user",
            "url": "https://news.ycombinator.com/item?id=123",
            "platform": "hn_hiring",
            "description": "It understands the rule but treats it as optional instead of enforcing it.",
        }
        good = {
            "title": "Acme AI | Remote | Full-time | Backend Engineer",
            "company": "Acme AI",
            "url": "https://news.ycombinator.com/item?id=456",
            "platform": "hn_hiring",
            "description": "Acme AI | Remote | Full-time | Backend Engineer\nWe are hiring Python and React engineers. Salary range shown. Apply by email.",
        }

        self.assertTrue(client.lead_cleanup_reasons(bad))
        self.assertEqual(client.lead_cleanup_reasons(good), [])

    def test_profile_read_falls_back_to_snapshot_instead_of_emptying_ui(self):
        from db import client

        snapshot = {
            "n": "Existing Candidate",
            "s": "AI engineer",
            "skills": [{"id": "py", "n": "Python", "cat": "technical"}],
            "projects": [{"id": "p1", "title": "Agent", "stack": ["Python"], "repo": "", "impact": "Built it"}],
            "exp": [{"id": "e1", "role": "Engineer", "co": "Acme", "period": "2024", "d": "Built systems"}],
        }

        with mock.patch.object(client, "_load_profile_snapshot", return_value=snapshot), \
             mock.patch.object(client, "_read_profile_from_graph", side_effect=RuntimeError("graph read failed")):
            self.assertEqual(client.get_profile(), snapshot)

    def test_profile_stack_normalizer_accepts_existing_list_values(self):
        from db import client

        self.assertEqual(client._stack_list(["Python", " React ", ""]), ["Python", "React"])
        self.assertEqual(client._stack_list("Python, React"), ["Python", "React"])

    def test_ingestor_parses_portfolio_markdown_into_graph_entities(self):
        from agents.ingestor import _parse_local

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

    def test_feedback_body_accepts_lead_quality_labels(self):
        import main

        body = main.FeedbackBody.model_validate({"feedback": "incorrect_category"})
        self.assertEqual(body.feedback, "incorrect_category")

    def test_feedback_ranker_boosts_matching_future_leads(self):
        from agents.feedback_ranker import apply_feedback_learning

        examples = [{
            "feedback": "relevant",
            "platform": "github",
            "company": "owner/repo",
            "kind": "job",
            "signal_tags": ["ai", "job"],
            "tech_stack": ["AI", "FastAPI"],
            "source_meta": {"source": "github"},
        }]
        lead = {
            "platform": "github",
            "company": "owner/repo",
            "kind": "job",
            "signal_score": 55,
            "signal_reason": "intent",
            "signal_tags": ["ai", "job"],
            "tech_stack": ["AI"],
            "source_meta": {"source": "github"},
        }

        ranked = apply_feedback_learning(lead, examples)

        self.assertGreater(ranked["signal_score"], 55)
        self.assertGreater(ranked["learning_delta"], 0)
        self.assertEqual(ranked["base_signal_score"], 55)
        self.assertIn("feedback learning +", ranked["signal_reason"])

    def test_feedback_ranker_penalizes_rejected_patterns(self):
        from agents.feedback_ranker import apply_feedback_learning

        examples = [{
            "feedback": "not_relevant",
            "platform": "reddit",
            "kind": "job",
            "signal_tags": ["course", "job"],
            "tech_stack": ["AI"],
            "source_meta": {"source": "reddit"},
        }]
        lead = {
            "platform": "reddit",
            "kind": "job",
            "signal_score": 60,
            "signal_tags": ["course", "job"],
            "tech_stack": ["AI"],
            "source_meta": {"source": "reddit"},
        }

        ranked = apply_feedback_learning(lead, examples)

        self.assertLess(ranked["signal_score"], 60)
        self.assertLess(ranked["learning_delta"], 0)
        self.assertIn("Feedback penalty", ranked["learning_reason"])

    def test_actuator_submit_gate_requires_upload_and_work(self):
        from agents.actuator import _ready_to_submit

        self.assertFalse(_ready_to_submit({"uploaded": False, "fields": ["email"], "vision_actions": 0}))
        self.assertFalse(_ready_to_submit({"uploaded": True, "fields": [], "vision_actions": 0}))
        self.assertTrue(_ready_to_submit({"uploaded": True, "fields": ["email"], "vision_actions": 0}))
        self.assertTrue(_ready_to_submit({"uploaded": True, "fields": [], "vision_actions": 2}))

    def test_weworkremotely_html_is_not_treated_as_rss(self):
        from agents.scout import _is_rss_target

        self.assertFalse(_is_rss_target("https://weworkremotely.com/categories/remote-programming-jobs"))
        self.assertTrue(_is_rss_target("https://weworkremotely.com/remote-jobs.rss"))

    def test_hn_hiring_story_filter_requires_who_is_hiring_title(self):
        from agents.scout import _is_hn_hiring_story

        self.assertTrue(_is_hn_hiring_story({"title": "Ask HN: Who is hiring? (April 2026)"}))
        self.assertFalse(_is_hn_hiring_story({"title": "Ask HN: Why is Claude Code ignoring hooks?"}))

    def test_hn_hiring_post_filter_rejects_discussion_comments(self):
        from agents.scout import _looks_like_hn_job_post, _strip_html_text

        bad = (
            "Maybe Claude code&#x2F;anthropic should deprecate certain features."
            "<p>It understands the rule but treats it as optional instead of enforcing it."
        )
        good = (
            "Acme AI | Remote (US) | Full-time | Backend Engineer"
            "<p>We are hiring Python and React engineers. Salary range shown. Apply by email."
        )

        self.assertEqual(_strip_html_text("Claude code&#x2F;anthropic"), "Claude code/anthropic")
        self.assertFalse(_looks_like_hn_job_post(bad))
        self.assertTrue(_looks_like_hn_job_post(good))

    def test_job_seniority_classifier_segregates_roles(self):
        from agents.scout import _passes_beginner_job_filter, classify_job_seniority

        junior = {
            "title": "Junior AI Engineer",
            "description": "Entry level Python and React role. Posted: today. 0-2 years.",
        }
        senior = {
            "title": "Senior AI Engineer",
            "description": "Requires 5+ years. Posted: today.",
        }
        unknown = {
            "title": "Python Engineer",
            "description": "No seniority or posted date shown.",
        }

        self.assertEqual(classify_job_seniority(junior), "junior")
        self.assertEqual(classify_job_seniority(senior), "senior")
        self.assertEqual(classify_job_seniority({
            "title": "Backend Engineer",
            "description": "Requires 3+ years building APIs.",
        }), "mid")
        self.assertEqual(classify_job_seniority(unknown), "unknown")
        self.assertTrue(_passes_beginner_job_filter(junior))
        self.assertFalse(_passes_beginner_job_filter(senior))

    def test_job_targets_only_drop_freelance_sources(self):
        import main

        targets = main._job_targets("\n".join([
            "site:linkedin.com/jobs",
            "site:indeed.com/jobs",
            "site:jobs.lever.co",
            "https://remoteok.com/api",
            "site:freelancer.com/projects",
        ]))

        self.assertIn("site:jobs.lever.co", targets)
        self.assertIn("https://remoteok.com/api", targets)
        self.assertIn("site:linkedin.com/jobs", targets)
        self.assertIn("site:indeed.com/jobs", targets)
        self.assertNotIn("site:freelancer.com/projects", targets)

    def test_target_parser_ignores_comments_without_swallowing_urls(self):
        import main

        raw = "\n".join([
            "# Beginner fallback feeds",
            "https://remotive.com/api/remote-jobs?search=junior,",
            "",
            "# ATS",
            "site:jobs.lever.co,",
            "https://remoteok.com/api",
        ])

        self.assertEqual(
            main._split_configured_targets(raw),
            [
                "https://remotive.com/api/remote-jobs?search=junior",
                "site:jobs.lever.co",
                "https://remoteok.com/api",
            ],
        )

    def test_x_scout_classifies_and_saves_beginner_job_signals(self):
        from agents import x_scout

        saved = []
        tweets = [{
            "id": "12345",
            "author_id": "u1",
            "text": "We are hiring a junior AI engineer for FastAPI and React. Entry level, 0-2 years. Apply today.",
            "created_at": "2026-04-30T10:00:00Z",
            "public_metrics": {"like_count": 4, "retweet_count": 1, "reply_count": 2},
        }]
        users = {"u1": {"id": "u1", "username": "startup_ai", "name": "Startup AI"}}

        with mock.patch.object(x_scout, "_search_recent", new=mock.AsyncMock(return_value=(tweets, users))) as search_recent, \
             mock.patch.object(x_scout, "url_exists", return_value=False), \
             mock.patch.object(x_scout, "save_lead", side_effect=lambda *args, **kwargs: saved.append((args, kwargs))):
            leads = x_scout.run(bearer_token="token", raw_queries="junior AI engineer", kind_filter="job")

        search_recent.assert_called_once()
        self.assertEqual(len(leads), 1)
        self.assertEqual(leads[0]["kind"], "job")
        self.assertEqual(leads[0]["platform"], "x")
        self.assertEqual(leads[0]["budget"], "")
        self.assertGreaterEqual(leads[0]["signal_score"], 60)
        self.assertIn("job", leads[0]["signal_tags"])
        self.assertIn("apply", leads[0]["outreach_reply"].lower())
        self.assertIn("proposal_draft", leads[0])
        self.assertIn("proof_snippet", leads[0])
        self.assertIn("AI", leads[0]["tech_stack"])
        self.assertEqual(saved[0][1]["kind"], "job")
        self.assertGreaterEqual(saved[0][1]["signal_score"], 60)
        self.assertIn("proposal_draft", saved[0][1])

    def test_x_scout_builds_watchlist_queries(self):
        from agents.x_scout import build_watchlist_queries

        queries = build_watchlist_queries("@client_ai\nhttps://x.com/founder_1\nbad/extra")

        self.assertEqual(len(queries), 2)
        self.assertTrue(queries[0].startswith("from:client_ai "))
        self.assertTrue(queries[1].startswith("from:founder_1 "))

    def test_manual_lead_extracts_signal_and_outreach(self):
        from agents.lead_intel import manual_lead_from_text

        lead = manual_lead_from_text(
            "Junior AI Engineer opening for Python, React, and automation. Entry level, remote, apply this week.",
            "https://example.com/jobs/1",
            "job",
        )

        self.assertEqual(lead["kind"], "job")
        self.assertEqual(lead["budget"], "")
        self.assertGreaterEqual(lead["signal_score"], 60)
        self.assertIn("job", lead["signal_tags"])
        self.assertIn("apply", lead["outreach_reply"].lower())
        self.assertIn("Subject:", lead["outreach_email"])
        self.assertIn("Role-fit pitch", lead["proposal_draft"])
        self.assertIn("Credibility block", lead["proof_snippet"])
        self.assertIn("AI", lead["tech_stack"])
        self.assertIn("this week", lead["urgency"])
        self.assertEqual(len(lead["followup_sequence"]), 3)

    def test_free_scout_builds_ats_watchlist_targets(self):
        from agents.free_scout import _ats_targets_from_watchlist

        self.assertEqual(
            _ats_targets_from_watchlist("greenhouse,openai\nlever|perplexity\nashby,linear\nworkable,acme"),
            ["ats:greenhouse:openai", "ats:lever:perplexity", "ats:ashby:linear", "ats:workable:acme"],
        )


if __name__ == "__main__":
    unittest.main()
