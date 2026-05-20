# Scope Reviewer Probe — 2026-05-18T13:24:57Z

> Pass 1 = live `/api/estimate` (unchanged generator). Pass 2 = out-of-band LLM reviewer call. Charter: `/app/docs/operational-reviewer-probe-charter.md`.

- Endpoint: `POST http://localhost:8001/api/estimate` (Pass 1)
- Reviewer model: same key/provider as Pass 1, separate LlmChat session
- Archetypes: **10**
- Categories: **16** operational obligations

## 1. Perception ceiling — what Pass 2 closed that Pass 1 missed

| Category | Pass 1 (corpus) | Pass 2 closed | Combined | Audience |
|----------|-----------------|---------------|----------|----------|
| `authentication_identity` | 7/10 | +3 | 10/10 | both |
| `authorization_rbac` | 3/10 | +7 | 10/10 | both |
| `data_persistence` | 1/10 | +8 | 9/10 | operator |
| `admin_operations` | 2/10 | +6 | 8/10 | operator |
| `observability_monitoring` | 2/10 | +8 | 10/10 | operator |
| `deployment_infrastructure` | 3/10 | +7 | 10/10 | operator |
| `payments_billing` | 5/10 | +0 | 5/10 | both |
| `realtime_synchronization` | 7/10 | +0 | 7/10 | user |
| `integrations_external` | 0/10 | +4 | 4/10 | operator |
| `ai_orchestration` | 0/10 | +0 | 0/10 | operator |
| `reliability_recovery` | 0/10 | +10 | 10/10 | operator |
| `compliance_security` | 2/10 | +8 | 10/10 | operator |
| `collaboration_multiplayer` | 2/10 | +0 | 2/10 | user |
| `notifications_delivery` | 0/10 | +1 | 1/10 | both |
| `analytics_reporting` | 5/10 | +1 | 6/10 | both |
| `qa_edge_cases` | 0/10 | +10 | 10/10 | operator |

## 2. Reviewer's required-for-archetype matrix

`R` = reviewer says required for this archetype, `-` = not required, `?` = no answer. Read across to see which categories the reviewer thinks each archetype actually needs.

| Archetype | authen | author | data | admin | observ | deploy | paymen | realti | integr | ai | reliab | compli | collab | notifi | analyt | qa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slack | R | R | R | R | R | R | - | R | - | - | R | R | - | R | - | R |
| linear | R | R | R | · | R | R | - | · | R | - | R | R | · | · | · | R |
| stripe_for_x | R | R | R | R | R | R | R | · | R | - | R | R | - | - | R | R |
| b2b_crm | R | R | R | R | R | R | - | - | R | - | R | R | - | - | R | R |
| ai_copilot | R | R | R | R | R | R | R | - | R | R | R | R | - | - | R | R |
| infra_observability | R | R | R | R | R | R | - | · | R | - | R | R | - | R | · | R |
| marketplace | R | R | R | R | R | R | R | · | - | - | R | R | - | R | - | R |
| multiplayer | R | R | R | - | R | R | - | R | - | - | R | R | R | - | - | R |
| banking_dashboard | R | R | R | R | R | R | · | · | R | - | R | R | - | - | - | R |
| enterprise_erp | R | R | R | R | R | R | R | - | R | - | R | R | - | - | R | R |

Category short-keys: `authen`=`authentication_identity`, `author`=`authorization_rbac`, `data`=`data_persistence`, `admin`=`admin_operations`, `observ`=`observability_monitoring`, `deploy`=`deployment_infrastructure`, `paymen`=`payments_billing`, `realti`=`realtime_synchronization`, `integr`=`integrations_external`, `ai`=`ai_orchestration`, `reliab`=`reliability_recovery`, `compli`=`compliance_security`, `collab`=`collaboration_multiplayer`, `notifi`=`notifications_delivery`, `analyt`=`analytics_reporting`, `qa`=`qa_edge_cases`

## 3. Hallucination check (suggested module + not_required)

These are categories where the reviewer suggested a module BUT ALSO marked the category as not required for the archetype. Forced compliance answers, not real perception.

_No hallucination flags fired. Reviewer was internally consistent across the corpus._

## 4. Classifier vs Reviewer disagreement

Where the deterministic Pass-1 classifier sees a category as recognized but the reviewer says `present_in_draft: false` — or vice versa. Calibrates how much to trust each.

### `slack`
- `realtime_synchronization` — classifier=● / reviewer=○

### `linear`
- `admin_operations` — classifier=● / reviewer=○
- `collaboration_multiplayer` — classifier=● / reviewer=○
- `notifications_delivery` — classifier=○ / reviewer=●

### `stripe_for_x`
- `authentication_identity` — classifier=● / reviewer=○
- `data_persistence` — classifier=○ / reviewer=●
- `realtime_synchronization` — classifier=● / reviewer=○
- `analytics_reporting` — classifier=● / reviewer=○

### `b2b_crm`
- `observability_monitoring` — classifier=● / reviewer=○
- `integrations_external` — classifier=○ / reviewer=●

### `ai_copilot`
- `admin_operations` — classifier=● / reviewer=○
- `analytics_reporting` — classifier=● / reviewer=○

### `infra_observability`
- `authorization_rbac` — classifier=● / reviewer=○
- `deployment_infrastructure` — classifier=● / reviewer=○
- `realtime_synchronization` — classifier=● / reviewer=○
- `analytics_reporting` — classifier=● / reviewer=○

### `marketplace`
- `realtime_synchronization` — classifier=● / reviewer=○

### `banking_dashboard`
- `data_persistence` — classifier=● / reviewer=○
- `deployment_infrastructure` — classifier=● / reviewer=○
- `payments_billing` — classifier=● / reviewer=○
- `realtime_synchronization` — classifier=● / reviewer=○

### `enterprise_erp`
- `deployment_infrastructure` — classifier=● / reviewer=○
- `payments_billing` — classifier=● / reviewer=○

**Total disagreements across corpus: 23**

## 5. Cost of operator-awareness if applied (informational only)

**This is NOT pushed into the pricing engine.** It's the back-of-envelope number for discussion.

| Archetype | Pass 1 hours | Suggested hours | Δ hours | Pass 1 impl. price | Δ cost @ $65/h |
|-----------|--------------|-----------------|---------|---------------------|----------------|
| slack | 390 | +500 | +500 | $13,014 | +$32,500 |
| linear | 300 | +395 | +395 | $10,162 | +$25,675 |
| stripe_for_x | 850 | +920 | +920 | $27,591 | +$59,800 |
| b2b_crm | 415 | +415 | +415 | $13,807 | +$26,975 |
| ai_copilot | 535 | +500 | +500 | $17,609 | +$32,500 |
| infra_observability | 700 | +910 | +910 | $22,838 | +$59,150 |
| marketplace | 450 | +660 | +660 | $14,916 | +$42,900 |
| multiplayer | 330 | +315 | +315 | $11,113 | +$20,475 |
| banking_dashboard | 615 | +780 | +780 | $20,144 | +$50,700 |
| enterprise_erp | 780 | +1170 | +1170 | $25,372 | +$76,050 |
| **total** | **5365** | **+6565** | **+6565** | — | **+$426,725** |

**Corpus-wide cost inflation if Pass-2 adopted: +122.4%**

## 6. Per-archetype detail

### `slack` — Slack clone (team chat MVP)
- Reviewer summary: *The operational maturity of the project is low, with many critical and important gaps. Addressing these gaps will enhance reliability, security, and overall user satisfaction.*
- Pass 1 hours: **390** · Pass 2 suggested: **+500h**
- Pass 2 closed: `data_persistence`, `admin_operations`, `observability_monitoring`, `deployment_infrastructure`, `reliability_recovery`, `compliance_security`, `qa_edge_cases`
- Required+suggested modules (9):
  - `data_persistence` → **Data Management** (60h)
  - `admin_operations` → **Admin Tools** (50h)
  - `observability_monitoring` → **Monitoring Setup** (50h)
  - `deployment_infrastructure` → **Infrastructure Setup** (70h)
  - `realtime_synchronization` → **Real-Time Handling** (70h)
  - `reliability_recovery` → **Reliability Features** (50h)
  - `compliance_security` → **Security Compliance** (50h)
  - `notifications_delivery` → **Notification System** (50h)

### `linear` — Linear clone (issue tracker)
- Reviewer summary: *The project scope has multiple critical operational gaps that need addressing. Ensuring authentication, authorization, and compliance measures are prioritized will enhance operational maturity.*
- Pass 1 hours: **300** · Pass 2 suggested: **+395h**
- Pass 2 closed: `authentication_identity`, `authorization_rbac`, `data_persistence`, `observability_monitoring`, `deployment_infrastructure`, `integrations_external`, `reliability_recovery`, `compliance_security`, `qa_edge_cases`
- Required+suggested modules (9):
  - `authentication_identity` → **User Authentication** (40h)
  - `authorization_rbac` → **Role-Based Access** (30h)
  - `data_persistence` → **Data Persistence** (50h)
  - `observability_monitoring` → **Monitoring Setup** (45h)
  - `deployment_infrastructure` → **Deployment Infrastructure** (60h)
  - `integrations_external` → **External Integrations** (40h)
  - `reliability_recovery` → **Reliability Setup** (40h)
  - `compliance_security` → **Security Compliance** (50h)

### `stripe_for_x` — Stripe-for-X (vertical payments platform)
- Reviewer summary: *The draft scope has significant gaps in operational aspects necessary for a payments platform. Critical modules for authentication, authorization, admin operations, and reliability need to be included to ensure operational completeness.*
- Pass 1 hours: **850** · Pass 2 suggested: **+920h**
- Pass 2 closed: `authorization_rbac`, `data_persistence`, `admin_operations`, `observability_monitoring`, `deployment_infrastructure`, `integrations_external`, `reliability_recovery`, `qa_edge_cases`
- Required+suggested modules (9):
  - `authentication_identity` → **User Authentication** (100h)
  - `authorization_rbac` → **Role-Based Access Control** (80h)
  - `admin_operations` → **Admin Operations** (120h)
  - `observability_monitoring` → **Monitoring Setup** (100h)
  - `deployment_infrastructure` → **Infrastructure Setup** (120h)
  - `integrations_external` → **External Integrations** (100h)
  - `reliability_recovery` → **Reliability Features** (80h)
  - `analytics_reporting` → **Analytics Module** (100h)

### `b2b_crm` — B2B CRM
- Reviewer summary: *The scope has significant gaps in critical operational areas such as security, reliability, and admin operations, which need to be addressed to ensure operational maturity.*
- Pass 1 hours: **415** · Pass 2 suggested: **+415h**
- Pass 2 closed: `authorization_rbac`, `admin_operations`, `deployment_infrastructure`, `reliability_recovery`, `compliance_security`, `qa_edge_cases`
- Required+suggested modules (8):
  - `authorization_rbac` → **User Roles Management** (40h)
  - `data_persistence` → **Database Management** (60h)
  - `admin_operations` → **Admin Dashboard** (50h)
  - `observability_monitoring` → **Monitoring & Logging** (45h)
  - `deployment_infrastructure` → **CI/CD Pipeline** (70h)
  - `reliability_recovery` → **Reliability Strategies** (50h)
  - `compliance_security` → **Security Compliance** (60h)
  - `qa_edge_cases` → **Quality Assurance** (40h)

### `ai_copilot` — AI copilot (LLM product)
- Reviewer summary: *The draft scope lacks essential operational categories necessary for product stability and compliance. Addressing identified gaps will enhance readiness for production.*
- Pass 1 hours: **535** · Pass 2 suggested: **+500h**
- Pass 2 closed: `authorization_rbac`, `data_persistence`, `observability_monitoring`, `deployment_infrastructure`, `integrations_external`, `reliability_recovery`, `compliance_security`, `qa_edge_cases`
- Required+suggested modules (11):
  - `authorization_rbac` → **Role-Based Access Control** (50h)
  - `data_persistence` → **Data Storage Setup** (40h)
  - `admin_operations` → **Admin Interfaces** (30h)
  - `observability_monitoring` → **Monitoring System** (50h)
  - `deployment_infrastructure` → **Deployment Management** (60h)
  - `integrations_external` → **External Integrations** (40h)
  - `ai_orchestration` → **AI Orchestration** (50h)
  - `reliability_recovery` → **Reliability Framework** (55h)

### `infra_observability` — Infrastructure observability platform
- Reviewer summary: *The project scope has critical gaps in areas such as authentication, authorization, data persistence, and compliance. A focus on operational readiness is essential for a robust observability platform.*
- Pass 1 hours: **700** · Pass 2 suggested: **+910h**
- Pass 2 closed: `authentication_identity`, `data_persistence`, `reliability_recovery`, `compliance_security`, `notifications_delivery`, `qa_edge_cases`
- Required+suggested modules (10):
  - `authentication_identity` → **User Authentication** (80h)
  - `authorization_rbac` → **Role-Based Access Control** (100h)
  - `data_persistence` → **Data Storage Solutions** (120h)
  - `admin_operations` → **Admin Operations Dashboard** (80h)
  - `deployment_infrastructure` → **Deployment Infrastructure Setup** (100h)
  - `integrations_external` → **External Integrations Module** (90h)
  - `reliability_recovery` → **Reliability and Backup Systems** (100h)
  - `compliance_security` → **Security Compliance Measures** (80h)

### `marketplace` — Two-sided marketplace
- Reviewer summary: *The project scope lacks multiple critical operational categories necessary for a successful production launch. Key modules must be developed to achieve operational readiness.*
- Pass 1 hours: **450** · Pass 2 suggested: **+660h**
- Pass 2 closed: `authorization_rbac`, `data_persistence`, `admin_operations`, `observability_monitoring`, `deployment_infrastructure`, `reliability_recovery`, `compliance_security`, `qa_edge_cases`
- Required+suggested modules (9):
  - `authorization_rbac` → **Role-Based Access** (50h)
  - `data_persistence` → **Data Persistence** (70h)
  - `admin_operations` → **Admin Tools** (60h)
  - `observability_monitoring` → **Monitoring Setup** (80h)
  - `deployment_infrastructure` → **Deployment Plan** (100h)
  - `reliability_recovery` → **Reliability Strategies** (70h)
  - `compliance_security` → **Compliance Setup** (90h)
  - `notifications_delivery` → **Notifications Module** (60h)

### `multiplayer` — Realtime multiplayer experience
- Reviewer summary: *The operational completeness of the draft is significantly lacking in critical areas such as authorization, data persistence, and monitoring. It is essential to address these gaps to ensure a reliable and secure production environment.*
- Pass 1 hours: **330** · Pass 2 suggested: **+315h**
- Pass 2 closed: `authorization_rbac`, `data_persistence`, `observability_monitoring`, `deployment_infrastructure`, `reliability_recovery`, `compliance_security`, `qa_edge_cases`
- Required+suggested modules (7):
  - `authorization_rbac` → **Role-Based Access Control** (40h)
  - `data_persistence` → **Data Storage & Migration** (50h)
  - `observability_monitoring` → **Monitoring Setup** (30h)
  - `deployment_infrastructure` → **Deployment Pipeline** (60h)
  - `reliability_recovery` → **Reliability Features** (45h)
  - `compliance_security` → **Security Compliance** (50h)
  - `qa_edge_cases` → **Quality Assurance** (40h)

### `banking_dashboard` — Banking-grade financial dashboard
- Reviewer summary: *The draft scope has critical gaps in operational categories essential for a banking-grade product. Addressing these gaps is crucial to ensure a secure and reliable deployment.*
- Pass 1 hours: **615** · Pass 2 suggested: **+780h**
- Pass 2 closed: `authorization_rbac`, `admin_operations`, `observability_monitoring`, `integrations_external`, `reliability_recovery`, `qa_edge_cases`
- Required+suggested modules (8):
  - `authorization_rbac` → **RBAC Module** (100h)
  - `data_persistence` → **Data Persistence Module** (120h)
  - `admin_operations` → **Admin Operation Tools** (80h)
  - `observability_monitoring` → **Monitoring and Logging** (100h)
  - `deployment_infrastructure` → **Deployment Setup** (100h)
  - `integrations_external` → **External Integrations** (100h)
  - `reliability_recovery` → **Reliability Features** (100h)
  - `qa_edge_cases` → **QA and Testing** (80h)

### `enterprise_erp` — Enterprise ERP system
- Reviewer summary: *The draft scope lacks several critical operational components necessary for a robust ERP system. It needs to address authentication, data persistence, and reliability through additional modules.*
- Pass 1 hours: **780** · Pass 2 suggested: **+1170h**
- Pass 2 closed: `authentication_identity`, `data_persistence`, `admin_operations`, `observability_monitoring`, `reliability_recovery`, `compliance_security`, `analytics_reporting`, `qa_edge_cases`
- Required+suggested modules (11):
  - `authentication_identity` → **User Authentication** (80h)
  - `data_persistence` → **Data Persistence** (120h)
  - `admin_operations` → **Admin Operations** (100h)
  - `observability_monitoring` → **Monitoring System** (100h)
  - `deployment_infrastructure` → **Deployment Infrastructure** (120h)
  - `payments_billing` → **Payments Module** (100h)
  - `integrations_external` → **External Integrations** (100h)
  - `reliability_recovery` → **Reliability Features** (120h)

## 7. Aggregate verdict (probe outcomes)

**Fully closed by Pass 2** (7): `authentication_identity`, `authorization_rbac`, `observability_monitoring`, `deployment_infrastructure`, `reliability_recovery`, `compliance_security`, `qa_edge_cases`

**Mostly closed (≥50% of gap)** (2): `data_persistence`, `admin_operations`

**Stubborn (Pass 2 didn't help)** (7): `payments_billing`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `collaboration_multiplayer`, `notifications_delivery`, `analytics_reporting`

**Total hallucination flags**: 0
**Total classifier-reviewer disagreements**: 23

---

_Raw data: `/app/audit/scope-reviewer-corpus.json`._