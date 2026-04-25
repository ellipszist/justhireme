import os, sys
import httpx
import anthropic
import instructor
from openai import OpenAI
from pydantic import BaseModel
from db.client import get_setting

_TIMEOUT = httpx.Timeout(30.0, connect=5.0)


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


def call_llm(s: str, u: str, m: type[BaseModel]):
    p = get_setting("llm_provider", "ollama")

    if p == "anthropic":
        k = get_setting("anthropic_key") or os.environ.get("ANTHROPIC_API_KEY", "")
        if not k:
            print("[llm] anthropic selected but no key — falling back", file=sys.stderr)
            return _parse_fallback(u, m)
        c = anthropic.Anthropic(api_key=k)
        r = c.messages.parse(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=s,
            messages=[{"role": "user", "content": u}],
            output_format=m,
        )
        return r.parsed_output

    elif p == "groq":
        k = get_setting("groq_api_key") or os.environ.get("GROQ_API_KEY", "")
        if not k:
            print("[llm] groq selected but no key — falling back", file=sys.stderr)
            return _parse_fallback(u, m)
        c = instructor.from_openai(
            OpenAI(base_url="https://api.groq.com/openai/v1", api_key=k, timeout=_TIMEOUT, max_retries=0)
        )
        return c.chat.completions.create(
            model="llama-3.3-70b-versatile",
            response_model=m,
            max_retries=1,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )

    elif p == "nvidia":
        k = get_setting("nvidia_api_key") or os.environ.get("NVIDIA_API_KEY", "")
        if not k:
            print("[llm] nvidia selected but no key — falling back", file=sys.stderr)
            return _parse_fallback(u, m)
        model = get_setting("nvidia_model", "z-ai/glm-5.1")
        print(f"[llm] nvidia model={model}", file=sys.stderr)
        c = _client_nvidia(k)
        return c.chat.completions.create(
            model=model,
            response_model=m,
            max_retries=1,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )

    else:  # ollama / default
        b = get_setting("ollama_url", "http://localhost:11434/v1")
        print(f"[llm] Using ollama at {b}", file=sys.stderr)
        c = instructor.from_openai(
            OpenAI(base_url=b, api_key="ollama", timeout=_TIMEOUT, max_retries=0)
        )
        return c.chat.completions.create(
            model="llama3",
            response_model=m,
            max_retries=1,
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )


def call_raw(s: str, u: str) -> str:
    p = get_setting("llm_provider", "ollama")

    if p == "anthropic":
        k = get_setting("anthropic_key") or os.environ.get("ANTHROPIC_API_KEY", "")
        if not k:
            return ""
        c = anthropic.Anthropic(api_key=k)
        r = c.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            system=s,
            messages=[{"role": "user", "content": u}],
        )
        return r.content[0].text

    elif p == "groq":
        k = get_setting("groq_api_key") or os.environ.get("GROQ_API_KEY", "")
        if not k:
            return ""
        c = OpenAI(base_url="https://api.groq.com/openai/v1", api_key=k, timeout=_TIMEOUT, max_retries=0)
        r = c.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )
        return r.choices[0].message.content or ""

    elif p == "nvidia":
        k = get_setting("nvidia_api_key") or os.environ.get("NVIDIA_API_KEY", "")
        if not k:
            return ""
        c = OpenAI(base_url="https://integrate.api.nvidia.com/v1", api_key=k, timeout=_TIMEOUT, max_retries=0)
        r = c.chat.completions.create(
            model="nvidia/llama-3.3-nemotron-super-49b-v1",
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )
        return r.choices[0].message.content or ""

    else:
        b = get_setting("ollama_url", "http://localhost:11434/v1")
        c = OpenAI(base_url=b, api_key="ollama", timeout=_TIMEOUT, max_retries=0)
        r = c.chat.completions.create(
            model="llama3",
            messages=[{"role": "system", "content": s}, {"role": "user", "content": u}],
        )
        return r.choices[0].message.content or ""


def _parse_fallback(u: str, m: type[BaseModel]):
    """Minimal local fallback — no LLM, just returns empty structured output."""
    try:
        return m()
    except Exception:
        return m.model_construct()
