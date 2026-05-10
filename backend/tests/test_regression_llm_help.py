from regression_support import *  # noqa: F401,F403

class RegressionTests(unittest.TestCase):
    def test_extended_llm_provider_catalog_is_configured(self):
        from llm import _DEFAULT_MODELS, _ENV_NAMES, _KEY_NAMES, _OPENAI_COMPAT_BASE_URLS

        providers = {
            "xai", "kimi", "mistral", "openrouter", "together", "fireworks",
            "cerebras", "perplexity", "huggingface", "custom",
        }
        for provider in providers:
            self.assertIn(provider, _KEY_NAMES)
            self.assertIn(provider, _ENV_NAMES)
            self.assertIn(provider, _DEFAULT_MODELS)
        for provider in providers - {"custom"}:
            self.assertTrue(_OPENAI_COMPAT_BASE_URLS[provider].startswith("https://"))

    def test_help_assistant_answers_api_and_llm_setup_from_guide(self):
        from help.service import answer

        result = answer("what is an api and what all are available in here for llm and how do i get them")
        text = result["answer"].lower()

        self.assertEqual(result["source"], "guide")
        self.assertIn("api key is", text)
        self.assertIn("settings > global ai", text)
        for provider in ["gemini", "deepseek", "nvidia", "groq", "grok", "kimi", "anthropic", "ollama"]:
            self.assertIn(provider, text)
        self.assertIn("run the provider check", text)

    def test_model_facing_agents_have_production_guardrails(self):
        import inspect
        from automation import actuator, scout
        from ranking import evaluator
        from generation import generator

        contracts = [
            evaluator._SYSTEM_PROMPT,
            scout._SCOUT_EXTRACT_SYSTEM,
            scout._WELLFOUND_EXTRACT_SYSTEM,
            actuator._VISION_SYSTEM,
            inspect.getsource(generator._draft_package),
        ]
        joined = "\n".join(contracts).lower()

        self.assertIn("production", joined)
        self.assertIn("untrusted", joined)
        self.assertIn("never invent", joined)
        self.assertIn("do not click final", actuator._VISION_SYSTEM.lower())
        self.assertIn("structured output only", scout._SCOUT_EXTRACT_SYSTEM.lower())
