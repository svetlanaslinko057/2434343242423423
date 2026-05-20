"""
Web Adapter — shape-tweaks для ATLLAS web frontend.

STATUS: порожній skeleton. Core backend (mobile) покриває 100% endpoints,
що викликає web-frontend (перевірено: 0 endpoints present у web але відсутні у core).

Правила:
 1. НІЯКОЇ БІЗНЕС-ЛОГІКИ. Тільки reshape результату з core у очікуваний web-форматом.
 2. Додавати endpoint ТІЛЬКИ коли smoke-test web-сторінки виявив 422/500 через різний shape.
 3. Кожен endpoint = 5-15 рядків (виклик core + return reshaped dict).

Підключається у server.py через include_router одразу після api_router.
"""
from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["web-adapter"])

# ---------------------------------------------------------------------------
# Приклад як додавати shape-адаптер (залишаємо закоментованим до потреби):
# ---------------------------------------------------------------------------
# @router.get("/dev/workspace-web")
# async def web_dev_workspace(user_id: str):
#     """Legacy web shape: activeModules/earnings замість modules/earnings_total."""
#     from server import db  # reuse core db
#     # ... виклик core logic ...
#     return {
#         "activeModules": ...,
#         "earnings": ...,
#         "progress": ...,
#     }
