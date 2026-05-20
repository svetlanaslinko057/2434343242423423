# PRD — Session restart, 19 May 2026 (production-readiness pass)

> Эта запись фиксирует, что подтверждено end-to-end в боевом режиме после полного редеплоя из репозитория `svetlanaslinko057/dwdqwdqwdqwdqw` в свежий контейнер. См. `/app/audit/DEPLOYMENT_AUDIT_2026-05-19_session_restart_v2.md` для полного отчёта.

## Подтверждено e2e в этой сессии

### 1. Auth flow для всех 4 ролей
- 2-шаговый Expo login (`/auth?mode=login` → email → Continue → password → Continue to your product) корректно вызывает `POST /api/mobile/auth/login` → возвращает `sess_*` token → запись в `localStorage.atlas_token` → `runtime.primeToken()` → все последующие `/api/*` запросы получают `Authorization: Bearer ...`.
- Подтверждено для client / admin / developer / tester ролей через Playwright.

### 2. Client cabinet (полностью работает)
- `/client/home` отрисовывает реальный dashboard: "3 products, $5,200 invested", action items, system actions из 16+ endpoints (alerts, owner-summary, costs, attention, pending-deliverables, notifications, recommendations, operator, retainer-offer, opportunities, revenue-timeline и т.д.) — все 200 OK.
- `/documents` корректно показывает 2 open invoices ($950 pending / $700 draft) + 4 paid invoices ($1,200 / $1,500 / $1,400 / $1,100) — Stage 2 honest wire подтверждён e2e.

### 3. Admin cockpit (5 табов + 8 drill-down) — фикс
- **BUG FIX:** `execution-console` рендерился 6-м табом → добавлен `<Tabs.Screen name="execution-console" options={{ href: null }} />` в `app/admin/_layout.tsx`. Теперь ровно 5 табов: Home · QA · Validation · Finance · Profile.
- `/admin/home`: alerts (QA pending=1, Withdrawals=0, Payouts=0), snapshot (Active devs=8, modules=10, QA pending=1), Quick actions (Review QA), Operations grid (8 drill-downs).
- Все 8 drill-down экранов (`/admin/users`, `/team`, `/contracts`, `/templates`, `/integrations`, `/inbox`, `/marketplace`, `/master`) открываются без ошибок и крашей.

### 4. Backend (полная боевая готовность)
- 682 routes, 37 collections, все 5 background loops активны (Guardian 120s, Module Motion 15s, Operator 300s, Event 15m, Autonomy + Intelligence recompute).
- `GET /api/integrations/manifest` — честная индикация MOCK режима с явным `reason` (STRIPE_SECRET_KEY missing, RESEND_API_KEY missing, CLOUDINARY_* missing, GOOGLE_OAUTH_CLIENT_ID missing).
- `GET /api/web-ui/` — CRA билд отдаётся под `/api/web-ui/*` (200 OK).
- WebSocket `/api/socket.io/` коннектится после login (видно в логах: "Socket connected: zM6r..." + "REALTIME: retainer:offered → role:admin").

### 5. Runtime-client migration (подтверждено)
- `src/api.ts` shim → `runtime` middleware (token-prime, telemetry, capability-gate, retry) работает в Expo Web preview без axios-крашей.
- Network log Playwright: все 16+ client endpoints проходят через runtime, получают Bearer header, возвращают 200.

## Известные false-positive из тестинга (исключены из багов)

Пользователь явно подтвердил, что следующие сигналы — НЕ баги:
- `Invalid style property of "borderColor". Value is "var(--t-primary)33"` — pre-existing RN-web cosmetic pattern (theme color + opacity concat), не крашит ничего.
- `/api/admin/mobile/* → 401` при загрузке БЕЗ login — это правильный auth flow, после login всё 200.

Testing agent в Iteration 12 ошибочно посчитал, что после login токен не пишется (он смотрел не на тот endpoint — `/api/auth/login` это cookie-эндпоинт, а Expo использует `/api/mobile/auth/login` который возвращает token в body). Проверено реальным e2e UI flow через Playwright: `atlas_token = sess_...` присутствует в localStorage сразу после login, все запросы 200.

## Что осталось вне scope (waiting external)

- **Real integration keys** (STRIPE_SECRET_KEY, RESEND_API_KEY, CLOUDINARY_*, GOOGLE_OAUTH_CLIENT_ID, EMERGENT_LLM_KEY, HF_TOKEN). Все слои готовы, registry-паттерн подхватит ключи через `admin_integrations.py` без code change.
- **Phase 1 substrate slices #4-6** (DeveloperWork, DeveloperGrowth, ProviderInbox) — `audit` статус, не блокируют боевую готовность системы (governance refactoring, не функциональный bug).

## Live system

- Preview: `https://mobile-showcase-expo.preview.emergentagent.com`
- 4 supervisor процесса RUNNING (backend / expo / mongodb / nginx-code-proxy)
- Disk: `/app 9.8G  7.1G used  2.7G free  73%`
- Test creds: `/app/memory/test_credentials.md`
