import os
import httpx
import anthropic
import instructor
from openai import OpenAI
from pydantic import BaseModel
from db.client import get_setting
from logger import get_logger

_log = get_logger(__name__)

_TIMEOUT = httpx.Timeout(300.0, connect=10.0)

# Maps provider id → settings key holding the global API key
_KEY_NAMES: dict[str, str] = {
    "anthropic": "anthropic_key",
    "groq":      "groq_api_key",
    "nvidia":    "nvidia_api_key",
    "openai":    "openai_api_key",
    "deepseek":  "deepseek_api_key",
}

# Maps provider id → environment variable fallback
_ENV_NAMES: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "groq":      "GROQ_API_KEY",
    "nvidia":    "NVIDIA_API_KEY",
    "openai":    "OPENAI_API_KEY",
    "deepseek":  "DEEPSEEK_API_KEY",
}

# Default model per provider (used when no step/global model is set)
_DEFAULT_MODELS: dict[str, str] = {
    "anthropic": "claude-sonnet-4-6",
    "groq":      "llama-3.3-70b-versatile",
    "nvidia":    "z-ai/glm-5.1",
    "openai":    "gpt-4o-mini",
    "deepseek":  "deepseek-chat",
    "ollama":    "llama3",
}


def _resolve(step: str | None = None) -> tuple[str, str, str]:
    """
    Resolve (provider, api_key, model) for a given pipeline step.

    Priority order:
      1. Step-specific setting  ({step}_provider / {step}_api_key / {step}_model)
      2. Global setting         (llm_provider / provider key / nvidia_model etc.)
      3. Environment variable   (ANTHROPIC_API_KEY etc.)
      4. Hardcoded defaults
    """
    sp = get_setting(f"{step}_provider", "") if step else ""
    sk = get_setting(f"{step}_api_key",  "") if step else ""
    sm = get_setting(f"{step}_model",    "") if step else ""

    p = sp or get_setting("llm_provider", "ollama")

    # API key: step-specific > global setting for this provider > env var
    if sk:
        k = sk
    else:
        k = (get_setting(_KEY_NAMES.get(p, ""), "")
             or os.environ.get(_ENV_NAMES.get(p, ""), ""))

    # Model: step-specific > provider-level setting > default
    if sm:
        model = sm
    elif p == "nvidia":
        model = get_setting("nvidia_model", _DEFAULT_MODELS["nvidia"])
    elif p == "openai":
        model = get_setting("openai_model", _DEFAULT_MODELS["openai"])
    else:
        model = _DEFAULT_MODELS.get(p, "llama3")

    if step:
        _log.debug("step=%s → provider=%s model=%s", step, p, model)

    return p, k, model


def resolve_config(step: str | None = None) -> tuple[str, str, str]:
    """Public resolver for agents that need provider-specific request shapes."""
    return _resolve(step)


def _client_nvidia(k: str):
    return instructor.from_openai(
        OpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=k,
            timeout=_TIMEOUT,
            max_retries=0,
        ),
        mode=instructor.Mode.JSON,
    )


def call_llm(s: str, u: str, m: type[BaseModel], step: str | None = None):
    """
    Call LLM with structured output.

    Pass `step` (e.g. "evaluator", "scout", "ingestor") to use that step's
    per-step provider/key/model settings. Omit for global defaults.
    """
    p, k, model = _resolve(step)

    if p == "anthropic":
        if not k:
            _log.warning("anthropic — no key (step=%s) — falling back", step)
            return _parse_fallback(u, m)
        c = anthropic.Anthropic(api_key=k, timeout=120.0)
        r = c.messages.parse(
            model=model,
            max_tokens=4096,
            system=s,
            messages=[{"role": "user", "content": u}],
            output_format=m,
        )
        return r.parsed_output

    elif p == "groq":
        if not k:
            _log.warning("groq — no key (step=%s) — falling back", step)
            return _parse_fallback(u, m)
        c = instructor.from_openai(
            OpenAI(base_url="https://api.groq.com/openai/v1", api_key=k,
                   timeout=_TIMEOUT, max_retries=0)
        )
        return c.chat.completions.create(
            model=model,
            response_model=m,
            max_retries=1,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )

    elif p == "nvidia":
        if not k:
            _log.warning("nvidia — no key (step=%s) — falling back", step)
            return _parse_fallback(u, m)
        c = _client_nvidia(k)
        return c.chat.completions.create(
            model=model,
            response_model=m,
            max_retries=1,
            max_tokens=16384,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )

    elif p == "openai":
        if not k:
            _log.warning("openai — no key (step=%s)", step)
            return _parse_fallback(u, m)
        c = instructor.from_openai(OpenAI(api_key=k, timeout=_TIMEOUT))
        return c.chat.completions.create(
            model=model,
            response_model=m,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )

    elif p == "deepseek":
        if not k:
            _log.warning("deepseek — no key (step=%s)", step)
            return _parse_fallback(u, m)
        # deepseek-reasoner does not support tool_choice — use JSON mode instead
        mode = instructor.Mode.JSON if "reasoner" in model else instructor.Mode.TOOLS
        c = instructor.from_openai(
            OpenAI(base_url="https://api.deepseek.com", api_key=k, timeout=_TIMEOUT),
            mode=mode,
        )
        return c.chat.completions.create(
            model=model,
            response_model=m,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )

    else:  # ollama / default
        b = get_setting("ollama_url", "http://localhost:11434/v1")
        _log.info("ollama at %s model=%s (step=%s)", b, model, step)
        c = instructor.from_openai(
            OpenAI(base_url=b, api_key="ollama", timeout=_TIMEOUT, max_retries=0)
        )
        return c.chat.completions.create(
            model=model,
            response_model=m,
            max_retries=1,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )


def call_raw(s: str, u: str, step: str | None = None) -> str:
    """
    Call LLM for free-form text output.

    Pass `step` (e.g. "generator") to use that step's per-step settings.
    """
    p, k, model = _resolve(step)

    if p == "anthropic":
        if not k:
            return ""
        c = anthropic.Anthropic(api_key=k, timeout=120.0)
        r = c.messages.create(
            model=model,
            max_tokens=4096,
            system=s,
            messages=[{"role": "user", "content": u}],
        )
        return r.content[0].text

    elif p == "groq":
        if not k:
            return ""
        c = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=k,
                   timeout=_TIMEOUT, max_retries=0)
        r = c.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )
        return r.choices[0].message.content or ""

    elif p == "nvidia":
        if not k:
            return ""
        c = OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=k,
                   timeout=_TIMEOUT, max_retries=0)
        r = c.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
            max_tokens=16384,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        return r.choices[0].message.content or ""

    elif p == "openai":
        if not k:
            return ""
        c = OpenAI(api_key=k, timeout=_TIMEOUT)
        r = c.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )
        return r.choices[0].message.content or ""

    elif p == "deepseek":
        if not k:
            return ""
        c = OpenAI(base_url="https://api.deepseek.com", api_key=k, timeout=_TIMEOUT)
        r = c.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )
        return r.choices[0].message.content or ""

    else:  # ollama
        b = get_setting("ollama_url", "http://localhost:11434/v1")
        c = OpenAI(base_url=b, api_key="ollama", timeout=_TIMEOUT, max_retries=0)
        r = c.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )
        return r.choices[0].message.content or ""


def _parse_fallback(u: str, m: type[BaseModel]):
    """Minimal local fallback — no LLM, returns empty structured output."""
    try:
        return m()
    except Exception:
        return m.model_construct()
