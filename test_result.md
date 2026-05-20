# Testing Protocol — ATLAS DevOS / EVA-X (Session restart, May 19 2026)

## user_problem_statement
"Завершить последние задачи, привести систему к полностью боевому готовому состоянию." 
Контекст: репозиторий `svetlanaslinko057/dwdqwdqwdqwdqw` развёрнут в `/app` после полной потери контейнера. Все 5 пунктов PRD_2026-05-19 (recovery / estimate→booting unification / web build re-shipped under `/api/web-ui` / runtime-client migration / 8 Expo admin drill-downs) числятся `shipped`. Нужно подтвердить смоук-тестами, что они РЕАЛЬНО работают после редеплоя.

## backend:
  - task: "Auth login (4 roles)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Все 4 роли (admin/client/developer/tester) логинятся через POST /api/auth/login, возвращают user_id + role + cookie."

  - task: "Integrations manifest reflects MOCK mode honestly"
    implemented: true
    working: true
    file: "backend/integrations_api.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "GET /api/integrations/manifest → 200 с capabilities {payment, mail, storage, oauth} = mock + reason 'X_KEY missing'. Полная честность UI о состоянии интеграций."

  - task: "/api/web-ui/ serves CRA build"
    implemented: true
    working: true
    file: "backend/server.py + /app/web/build"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "GET /api/web-ui/ → 200 c HTML CRA-бандла. Web admin/client surfaces доступны."

  - task: "/api/contracts/my + /api/client/invoices (документы)"
    implemented: true
    working: true
    file: "backend/legal_contract_layer.py + earnings_layer.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: true
        agent: "main"
        comment: "Авторизованный клиент получает invoices (paid: inv_e0e0a556e9be amount=1200) и contracts/my возвращает items[]. Документы экран consumes оба."

  - task: "Background loops (Guardian, Module Motion, Operator, Event)"
    implemented: true
    working: true
    file: "backend/auto_guardian.py + module_motion.py + operator_engine.py + event_engine.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Все 4 фоновые петли стартуют, видно в логах ('GUARDIAN: loop started interval 120s', 'MODULE MOTION 15s', 'OPERATOR SCHEDULER 300s')."

## frontend:
  - task: "Expo bundles & welcome screen renders"
    implemented: true
    working: true
    file: "frontend/app/index.tsx + welcome.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Expo bundled 1561 модулей, GET / → 200, рендерится EVA-X брендинг ('Build real products. Not tasks.')"

  - task: "Documents screen (Stage 2 wired): contracts + invoices + payment confirmations"
    implemented: true
    working: "NA"
    file: "frontend/app/documents.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "documents.tsx обращается к /contracts/my + /client/invoices через Promise.allSettled. Нужен e2e UI смоук под логином клиента."

  - task: "Estimate → project booting flow (web + mobile)"
    implemented: true
    working: "NA"
    file: "frontend/app/describe.tsx + estimate-result.tsx + project-booting.tsx + web/src/components/InlineSignup.js + AuthedCta.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "createProjectAndBoot() единый helper. PRD_2026-05-19 числит shipped. Нужен e2e: гость заполняет describe → estimate → booting."

  - task: "Expo Admin cockpit + 8 drill-down screens"
    implemented: true
    working: "NA"
    file: "frontend/app/admin/_layout.tsx + home.tsx + users.tsx + team.tsx + contracts.tsx + templates.tsx + integrations.tsx + inbox.tsx + marketplace.tsx + master.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "5-tab cockpit + 8 drill-down (href:null). PRD_2026-05-19 числит shipped. Нужен e2e: admin логинится, видит home cockpit, открывает каждый drill-down."

  - task: "Runtime-client migration (src/api.ts → runtime shim)"
    implemented: true
    working: "NA"
    file: "frontend/src/api.ts + frontend/src/runtime/* + web/src/runtime-client/*"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Все 43 import api в Expo маршрутизируется через runtime middleware (token-prime, telemetry, retry). PRD_2026-05-19 числит completed. Нужен e2e: проверить, что fetch'и из admin/client идут через runtime без axios-крашей."

## metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: true

## test_plan:
  current_focus:
    - "Documents screen (Stage 2 wired): contracts + invoices + payment confirmations"
    - "Estimate → project booting flow (web + mobile)"
    - "Expo Admin cockpit + 8 drill-down screens"
    - "Runtime-client migration (src/api.ts → runtime shim)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

## agent_communication:
  - agent: "main"
    message: "Полный редеплой репо в /app завершён (backend + Expo + MongoDB RUNNING, 682 routes, 37 collections, сидинг применён). Все 5 PRD_2026-05-19 пунктов числятся shipped. Запускаю testing agent чтобы подтвердить, что после редеплоя 4 high-priority frontend flow реально работают end-to-end. Пользователь явно подтвердил: 'Invalid borderColor' warnings и WS auth-token 401 на первой загрузке (до login) — ожидаемые pre-existing patterns, НЕ баги. Не нужно их фиксить."
