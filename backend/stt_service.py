"""
Speech-to-Text (STT) service.

Thin wrapper around emergentintegrations' OpenAISpeechToText that:
  • resolves the active provider/key through admin_llm_settings
    (admin can switch openai ⇄ emergent in /admin/integrations)
  • exposes one async helper: transcribe_path(path, language=None) → str

Used by:
  • /api/estimate/transcribe-voice — visitor voice → text on /describe
  • chat_voice_autotranscribe()    — auto-transcribe user voice messages
    so admins receive plain text in the inbox

The underlying library auto-detects the key kind:
  - key starts with "sk-emergent-" → routes through Emergent proxy
  - else (sk-... )                 → calls OpenAI directly
"""
from __future__ import annotations

import logging
from typing import Optional

from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText

from admin_llm_settings import get_active_llm_key

logger = logging.getLogger("stt_service")


class STTUnavailable(RuntimeError):
    """Raised when no LLM key is configured in admin settings or env."""


async def transcribe_path(path: str, language: Optional[str] = None) -> str:
    """Transcribe an audio file at `path` and return the text.

    Uses the provider currently active in admin settings. If neither
    OpenAI nor Emergent key is configured, raises STTUnavailable so the
    caller can surface a friendly 503.
    """
    active = await get_active_llm_key()
    key = active.get("key") or ""
    if not key:
        raise STTUnavailable("No LLM key configured — admin must set one in /admin/integrations")

    stt = OpenAISpeechToText(api_key=key)
    # response_format='text' returns a plain string in litellm.
    # litellm/openai SDK wants a file-like object (or tuple), not a string path —
    # so we open the file here and let the context manager close it.
    with open(path, "rb") as fh:
        result = await stt.transcribe(
            file=fh,
            model="whisper-1",
            response_format="text",
            language=language,
        )
    # litellm returns either a string (text) or an object with .text — be defensive.
    if isinstance(result, str):
        text = result
    elif hasattr(result, "text"):
        text = result.text or ""
    elif isinstance(result, dict):
        text = result.get("text", "") or ""
    else:
        text = ""
    text = (text or "").strip()
    logger.info(
        f"STT transcribed: provider={active.get('provider')} source={active.get('source')} "
        f"path={path} chars={len(text)}"
    )
    return text
