"""
LLM Orchestrator — single source of truth for LLM key resolution & client construction.

Admin UI at /admin/integrations writes settings to MongoDB `system_config.llm_settings`:
    {
      preferred_provider: 'openai' | 'emergent'    (default: 'openai')
      openai_api_key:     string                    (sk-...)
      emergent_llm_key:   string                    (Emergent Universal Key / MRGate)
      default_model:      string                    (gpt-4o-mini, gpt-4o, ...)
    }

Resolution priority (in get_active_llm_key):
    1. preferred_provider's UI-configured key (openai OR emergent)
    2. the OTHER provider's UI-configured key (soft-fallback if preferred missing)
    3. preferred_provider's env var (EMERGENT_LLM_KEY / OPENAI_API_KEY)
    4. any env var (hard fallback)

Usage in server.py:
    from admin_llm_settings import get_active_llm_key, build_chat

    chat = await build_chat(session_id="...", system_message="...", max_tokens=1200)
    if chat is None:
        raise HTTPException(500, "LLM not configured — admin must set a key in /admin/integrations")
    response = await chat.send_message(UserMessage(text=prompt))
"""
import os
import logging
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

_db = None

# Default provider when no setting yet. OpenAI per product requirement.
DEFAULT_PROVIDER = "openai"
DEFAULT_MODEL = "gpt-4o-mini"


class LLMSettingsUpdate(BaseModel):
    openai_api_key: Optional[str] = None
    emergent_llm_key: Optional[str] = None
    preferred_provider: Optional[str] = None  # 'openai' | 'emergent'
    default_model: Optional[str] = None


def _mask(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 10:
        return "*" * len(key)
    return f"{key[:4]}…{key[-4:]}"


async def get_llm_settings() -> dict:
    """Load settings from DB — never raises. Returns {} if unset."""
    if _db is None:
        return {}
    doc = await _db.system_config.find_one({"key": "llm_settings"}, {"_id": 0})
    return doc or {}


async def get_active_llm_key() -> dict:
    """
    Resolve the active LLM key.
    Returns: {provider: 'openai'|'emergent'|None, key: str, model: str, source: str}
    `source` ∈ {'db-preferred', 'db-fallback', 'env', 'none'} — useful for UI/logs.
    """
    settings = await get_llm_settings()
    preferred = (settings.get("preferred_provider") or DEFAULT_PROVIDER).lower()
    if preferred not in {"openai", "emergent"}:
        preferred = DEFAULT_PROVIDER
    model = settings.get("default_model") or DEFAULT_MODEL

    openai_key = (settings.get("openai_api_key") or "").strip()
    emergent_key = (settings.get("emergent_llm_key") or "").strip()
    env_emergent = (os.environ.get("EMERGENT_LLM_KEY") or "").strip()
    env_openai = (os.environ.get("OPENAI_API_KEY") or "").strip()

    def pick(provider: str, key: str, source: str) -> dict:
        return {"provider": provider, "key": key, "model": model, "source": source}

    # 1. Preferred provider's UI key
    if preferred == "openai" and openai_key:
        return pick("openai", openai_key, "db-preferred")
    if preferred == "emergent" and emergent_key:
        return pick("emergent", emergent_key, "db-preferred")

    # 2. Other provider's UI key (soft-fallback — admin configured at least one)
    if preferred == "openai" and emergent_key:
        return pick("emergent", emergent_key, "db-fallback")
    if preferred == "emergent" and openai_key:
        return pick("openai", openai_key, "db-fallback")

    # 3. Env fallback — preferred first
    if preferred == "openai" and env_openai:
        return pick("openai", env_openai, "env")
    if preferred == "emergent" and env_emergent:
        return pick("emergent", env_emergent, "env")

    # 4. Any env
    if env_openai:
        return pick("openai", env_openai, "env")
    if env_emergent:
        return pick("emergent", env_emergent, "env")

    return {"provider": None, "key": "", "model": model, "source": "none"}


async def build_chat(
    session_id: str,
    system_message: str,
    max_tokens: int = 1200,
    model: Optional[str] = None,
):
    """
    Construct an LlmChat instance using the active provider. Returns None if no key.
    Logs which provider/source was used for observability.
    """
    active = await get_active_llm_key()
    if not active["key"]:
        logger.warning("LLM_ORCHESTRATOR: no key configured — LLM call skipped")
        return None
    use_model = model or active["model"]
    logger.info(
        f"LLM_ORCHESTRATOR: using provider={active['provider']} "
        f"model={use_model} source={active['source']}"
    )
    from emergentintegrations.llm.chat import LlmChat  # lazy import
    return (
        LlmChat(api_key=active["key"], session_id=session_id, system_message=system_message)
        .with_model("openai", use_model)
        .with_params(max_tokens=max_tokens)
    )


def init_router(db, admin_dep):
    """Wire router into the FastAPI app. Called from server.py."""
    global _db
    _db = db

    router = APIRouter(prefix="/api/admin/settings", tags=["admin-settings"])

    @router.get("/llm")
    async def read_llm_settings(_admin=Depends(admin_dep)):
        """Admin-only: read LLM settings (keys are masked)."""
        settings = await get_llm_settings()
        active = await get_active_llm_key()
        openai_key = settings.get("openai_api_key") or ""
        emergent_key = settings.get("emergent_llm_key") or ""
        return {
            "preferred_provider": settings.get("preferred_provider") or DEFAULT_PROVIDER,
            "default_model": settings.get("default_model") or DEFAULT_MODEL,
            "openai": {
                "configured": bool(openai_key),
                "masked": _mask(openai_key),
            },
            "emergent": {
                "configured": bool(emergent_key),
                "masked": _mask(emergent_key),
            },
            "active_provider": active["provider"],
            "active_source": active["source"],
            "env_fallback": {
                "emergent": bool(os.environ.get("EMERGENT_LLM_KEY", "").strip()),
                "openai": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
            },
        }

    @router.put("/llm")
    async def update_llm_settings(payload: LLMSettingsUpdate, _admin=Depends(admin_dep)):
        """Admin-only: update LLM settings. Pass null/omit to leave unchanged, empty string to clear."""
        update = {}
        if payload.openai_api_key is not None:
            update["openai_api_key"] = payload.openai_api_key.strip()
        if payload.emergent_llm_key is not None:
            update["emergent_llm_key"] = payload.emergent_llm_key.strip()
        if payload.preferred_provider is not None:
            pp = payload.preferred_provider.strip().lower()
            if pp not in {"openai", "emergent"}:
                raise HTTPException(status_code=400, detail="preferred_provider must be 'openai' or 'emergent'")
            update["preferred_provider"] = pp
        if payload.default_model is not None:
            update["default_model"] = payload.default_model.strip() or DEFAULT_MODEL

        if not update:
            raise HTTPException(status_code=400, detail="Nothing to update")

        await _db.system_config.update_one(
            {"key": "llm_settings"},
            {"$set": {"key": "llm_settings", **update}},
            upsert=True,
        )
        logger.info(f"LLM SETTINGS updated: fields={list(update.keys())}")
        return await read_llm_settings()

    @router.post("/llm/test")
    async def test_llm_key(_admin=Depends(admin_dep)):
        """Admin-only: live test — call the active provider with a tiny prompt."""
        active = await get_active_llm_key()
        if not active["key"]:
            return {"ok": False, "error": "No API key configured in admin settings or env"}
        try:
            chat = await build_chat(
                session_id=f"test_{uuid.uuid4().hex[:8]}",
                system_message="Reply with exactly: OK",
                max_tokens=10,
            )
            from emergentintegrations.llm.chat import UserMessage
            response = await chat.send_message(UserMessage(text="Say OK"))
            return {
                "ok": True,
                "provider": active["provider"],
                "source": active["source"],
                "model": active["model"],
                "response": (response or "").strip()[:100],
            }
        except Exception as e:
            return {
                "ok": False,
                "error": str(e)[:300],
                "provider": active["provider"],
                "source": active["source"],
            }

    return router
