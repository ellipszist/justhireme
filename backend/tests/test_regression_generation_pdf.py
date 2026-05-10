from regression_support import *  # noqa: F401,F403

class RegressionTests(unittest.TestCase):
    def test_score_lists_preserve_commas_when_json_encoded(self):
        from data.sqlite.leads import json_dumps_list, json_list

        encoded = json_dumps_list(["FastAPI, React, PostgreSQL", "LLM agents"])
        self.assertEqual(
            json_list(encoded),
            ["FastAPI, React, PostgreSQL", "LLM agents"],
        )
        self.assertEqual(json_list("FastAPI, React"), ["FastAPI", "React"])

    def test_generator_splits_flexible_cover_letter_starts(self):
        from generation.generator import _DocPackage, _normalize_package

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
        import generation.generator as generator

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

    def test_generator_uses_local_fallback_when_llm_is_unavailable(self):
        import generation.generator as generator

        lead = {
            "job_id": "fallback-gen-001",
            "title": "Applied AI Engineer",
            "company": "Acme AI",
            "description": "Build FastAPI, React, and LangGraph workflows.",
            "match_points": ["FastAPI and React match"],
        }
        previous_assets = generator._assets
        generator._assets = str(Path(__file__).resolve().parent)
        try:
            with (
                mock.patch.object(generator, "get_profile", return_value=_sample_scoring_profile()),
                mock.patch.object(generator, "_draft_package", side_effect=RuntimeError("provider offline")),
            ):
                package = generator.run_package(lead)

            self.assertTrue(package["resume"].endswith("_v1.pdf"))
            self.assertTrue(package["cover_letter"].endswith("_cl_v1.pdf"))
            self.assertGreaterEqual(package["keyword_coverage"]["coverage_pct"], 0)
            self.assertIn("Waldo", package["selected_projects"])
        finally:
            generator._assets = previous_assets
            for name in ("fallback-gen-001_v1.pdf", "fallback-gen-001_cl_v1.pdf"):
                try:
                    (Path(__file__).resolve().parent / name).unlink()
                except FileNotFoundError:
                    pass
