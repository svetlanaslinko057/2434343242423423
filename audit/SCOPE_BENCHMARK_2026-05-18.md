# Scope Perception Benchmark — 2026-05-18T18:58:50Z

> Diagnostic corpus. Measures *operational perception*, not correctness. Charter: `/app/docs/scope-benchmark-charter.md`.

- Endpoint: `POST http://localhost:8001/api/estimate` (mode `hybrid`, infer_axes=true)
- Archetypes: **10**
- Categories: **16** operational obligations
- LLM-as-judge: ❌ (deterministic keyword classifier)

## 1. Recognition rate per operational category

Across all archetypes — fraction where the model surfaced at least one keyword.

| Category | Recognized / Total | % | Audience |
|----------|---------------------|---|----------|
| `authentication_identity` | 10/10 | 100.0%  `██████████` | both |
| `authorization_rbac` | 7/10 |  70.0%  `███████   ` | both |
| `data_persistence` | 4/10 |  40.0%  `████      ` | operator |
| `admin_operations` | 1/10 |  10.0%  `█         ` | operator |
| `observability_monitoring` | 10/10 | 100.0%  `██████████` | operator |
| `deployment_infrastructure` | 10/10 | 100.0%  `██████████` | operator |
| `payments_billing` | 3/10 |  30.0%  `███       ` | both |
| `realtime_synchronization` | 7/10 |  70.0%  `███████   ` | user |
| `integrations_external` | 0/10 |   0.0%  `          ` | operator |
| `ai_orchestration` | 0/10 |   0.0%  `          ` | operator |
| `reliability_recovery` | 8/10 |  80.0%  `████████  ` | operator |
| `compliance_security` | 3/10 |  30.0%  `███       ` | operator |
| `collaboration_multiplayer` | 1/10 |  10.0%  `█         ` | user |
| `notifications_delivery` | 0/10 |   0.0%  `          ` | both |
| `analytics_reporting` | 7/10 |  70.0%  `███████   ` | both |
| `qa_edge_cases` | 10/10 | 100.0%  `██████████` | operator |

## 2. Coverage matrix (per archetype × category)

`●` = recognized, `○` = absent, `!` = recognized but flagged as **false simplicity**.

| Archetype | authen | author | data | admin | observ | deploy | paymen | realti | integr | ai | reliab | compli | collab | notifi | analyt | qa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slack | ● | ● | ○ | ○ | ● | ● | ○ | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ● |
| linear | ● | ● | ○ | ○ | ● | ● | ○ | ● | ○ | ○ | ● | ○ | ○ | ○ | ● | ● |
| stripe_for_x | ● | ● | ● | ○ | ● | ● | ● | ● | ○ | ○ | ● | ● | ○ | ○ | ● | ● |
| b2b_crm | ● | ● | ○ | ○ | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ● | ● |
| ai_copilot | ● | ● | ○ | ○ | ● | ● | ○ | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ● |
| infra_observability | ● | ○ | ○ | ○ | ● | ● | ○ | ● | ○ | ○ | ● | ○ | ○ | ○ | ● | ● |
| marketplace | ● | ○ | ● | ● | ● | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● |
| multiplayer | ● | ● | ○ | ○ | ● | ● | ○ | ● | ○ | ○ | ● | ○ | ● | ○ | ○ | ● |
| banking_dashboard | ● | ○ | ● | ○ | ● | ● | ○ | ● | ○ | ○ | ● | ● | ○ | ○ | ● | ● |
| enterprise_erp | ● | ● | ● | ○ | ● | ! | ● | ○ | ○ | ○ | ○ | ● | ○ | ○ | ● | ● |

Category short-keys: `authen`=`authentication_identity`, `author`=`authorization_rbac`, `data`=`data_persistence`, `admin`=`admin_operations`, `observ`=`observability_monitoring`, `deploy`=`deployment_infrastructure`, `paymen`=`payments_billing`, `realti`=`realtime_synchronization`, `integr`=`integrations_external`, `ai`=`ai_orchestration`, `reliab`=`reliability_recovery`, `compli`=`compliance_security`, `collab`=`collaboration_multiplayer`, `notifi`=`notifications_delivery`, `analyt`=`analytics_reporting`, `qa`=`qa_edge_cases`

## 3. Operational asymmetry (user-side vs operator-side coverage)

Asymmetry ratio = `user_coverage / operator_coverage`. Values > 1.5 indicate **builder-not-operator** cognition (rich user-facing scope, blind operator scope).

| Archetype | User cov | Operator cov | Ratio | Flag |
|-----------|----------|--------------|-------|------|
| slack | 0.43 (3/7) | 0.43 (6/14) | 1.00 |  |
| linear | 0.57 (4/7) | 0.50 (7/14) | 1.14 |  |
| stripe_for_x | 0.71 (5/7) | 0.71 (10/14) | 1.00 |  |
| b2b_crm | 0.43 (3/7) | 0.50 (7/14) | 0.86 |  |
| ai_copilot | 0.43 (3/7) | 0.43 (6/14) | 1.00 |  |
| infra_observability | 0.43 (3/7) | 0.43 (6/14) | 1.00 |  |
| marketplace | 0.43 (3/7) | 0.57 (8/14) | 0.75 |  |
| multiplayer | 0.57 (4/7) | 0.43 (6/14) | 1.33 |  |
| banking_dashboard | 0.43 (3/7) | 0.57 (8/14) | 0.75 |  |
| enterprise_erp | 0.57 (4/7) | 0.64 (9/14) | 0.89 |  |

## 4. False simplicity flags (complexity collapse)

The model **named** the responsibility but framed it with trivializing modifiers ("simple", "basic", "minimal", "just", ...). These are more dangerous than outright omissions because they create false confidence.

### `enterprise_erp` — Enterprise ERP system
- **`deployment_infrastructure`** → evidence: *…roles, and payroll basics.
deployment & ci/cd
set up automated deployment and continu…*

## 5. Per-archetype quick summary

### `slack` — Slack clone (team chat MVP)
- implementation_price: **$13,173**  ·  final_price: **$128,040**  ·  reality_multiplier: ×9.72
- estimated_hours: **395**  ·  complexity: **medium**  ·  confidence: **0.88**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User Authentication** (40h) — Manage user registration, login, and secure sessions.
  - **Workspace Creation** (30h) — Allow companies to create and manage their workspaces.
  - **Channel Management** (35h) — Create, join, and manage communication channels within workspaces.
  - **Direct Messaging** (30h) — Enable one-on-one conversation between users through DMs.
  - **Real-time Messaging** (50h) — Implement live message delivery and updates across all channels and DMs.
  - **Attachments & File Sharing** (45h) — Allow users to send and receive files within messages.
  - **Roles & Permissions** (30h) — Define user roles and access levels within workspaces and channels.
  - **Observability & Logging** (25h) — Setup logging and monitoring for application health and usage insights.
  - **Deployment & CI/CD** (40h) — Establish CI/CD pipelines for automated deployment and integration.
  - **Message Retries** (40h) — Implement retries for message delivery to ensure fault tolerance.
- recognized categories: 9/16
- **missing categories (9)**: `data_persistence`, `admin_operations`, `payments_billing`, `integrations_external`, `ai_orchestration`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `analytics_reporting`

### `linear` — Linear clone (issue tracker)
- implementation_price: **$15,137**  ·  final_price: **$147,136**  ·  reality_multiplier: ×9.72
- estimated_hours: **457**  ·  complexity: **medium**  ·  confidence: **0.91**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (40h) — Manage user registrations, logins, and authentication workflows.
  - **Role-based access** (30h) — Implement user roles to control access to various features and data.
  - **Issue management** (50h) — Allow users to create, assign, and update issues easily.
  - **Workflow board** (60h) — Visual representation of issues in different statuses on a board.
  - **Live updates** (45h) — Implement real-time updates for issues and board status changes.
  - **Notifications system** (30h) — Notify users about updates and changes to assigned issues.
  - **Analytics dashboard** (40h) — Provide insights and statistics on issues and team performance.
  - **Observability & logging** (50h) — Set up monitoring and logging for system performance and error tracking.
  - **Deployment & CI/CD** (40h) — Automate deployment and integrate continuous delivery processes.
  - **Retries and Rollback** (40h) — Implement retry logic, rollback mechanisms, and ensure data integrity for issue updates.
- recognized categories: 11/16
- **missing categories (8)**: `data_persistence`, `admin_operations`, `payments_billing`, `integrations_external`, `ai_orchestration`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`

### `stripe_for_x` — Stripe-for-X (vertical payments platform)
- implementation_price: **$59,912**  ·  final_price: **$582,343**  ·  reality_multiplier: ×9.72
- estimated_hours: **1870**  ·  complexity: **complex**  ·  confidence: **0.91**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (120h) — Secure onboarding and login processes for merchants and users.
  - **Merchant onboarding** (200h) — Process for onboarding new merchants with necessary compliance checks.
  - **Payments processing** (300h) — Handle card transactions, including authorization and settlement.
  - **Chargeback management** (220h) — Tools to help merchants handle and respond to chargebacks effectively.
  - **Transaction reporting** (150h) — Reports for merchants to view transaction history and settlements.
  - **Reconciliation tools** (180h) — Features for merchants to reconcile their accounts and manage finances.
  - **Observability & logging** (160h) — Set up monitoring and logging for system performance and issue tracking.
  - **Roles & permissions** (100h) — Management of user roles and permissions for secure access control.
  - **Deployment & CI/CD** (140h) — Automated deployment strategies and continuous integration pipelines.
  - **Idempotency Guarantees** (40h) — Implement idempotency for payment workflows to avoid duplicate transactions.
- recognized categories: 15/16
- **missing categories (5)**: `admin_operations`, `integrations_external`, `ai_orchestration`, `collaboration_multiplayer`, `notifications_delivery`

### `b2b_crm` — B2B CRM
- implementation_price: **$19,986**  ·  final_price: **$151,091**  ·  reality_multiplier: ×7.56
- estimated_hours: **610**  ·  complexity: **medium**  ·  confidence: **0.89**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Collaboration`, `Long-term product`
- modules:
  - **User authentication** (40h) — Secure login and user registration for CRM access.
  - **Roles & permissions** (30h) — Define access levels for different user roles in the CRM.
  - **Contacts management** (60h) — Add, edit, and organize contacts in the CRM.
  - **Accounts management** (50h) — Manage accounts associated with contacts and deals.
  - **Deals pipeline** (70h) — Track deals through various stages in the sales pipeline.
  - **Activity timeline** (50h) — Log activities related to contacts and deals for viewing history.
  - **Email integration** (80h) — Connect and sync email accounts for communication tracking.
  - **Reporting & analytics** (70h) — Generate reports on sales performance and user activities.
  - **Deployment & CI/CD** (40h) — Set up continuous integration and delivery for the application.
  - **Observability & logging** (40h) — Implement logging and monitoring for performance and issues.
- recognized categories: 10/16
- **missing categories (9)**: `data_persistence`, `admin_operations`, `payments_billing`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`

### `ai_copilot` — AI copilot (LLM product)
- implementation_price: **$21,316**  ·  final_price: **$161,153**  ·  reality_multiplier: ×7.56
- estimated_hours: **652**  ·  complexity: **complex**  ·  confidence: **0.9**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Collaboration`, `Long-term product`
- modules:
  - **User Authentication** (40h) — Secure user authentication to access the AI copilot features.
  - **Document Management** (60h) — Upload, store, and manage user documents for AI processing.
  - **AI Chat Interface** (80h) — User interface for interacting with the AI copilot in real-time.
  - **Response Drafting** (100h) — AI generates draft responses based on user documents and chat history.
  - **Style Learning** (100h) — AI learns and adapts to the user's writing style over time.
  - **Roles & Permissions** (50h) — Management of user roles and permissions for secure access.
  - **Deployment & CI/CD** (40h) — Automated deployment pipeline for continuous integration and delivery.
  - **Observability & Logging** (50h) — Implement logging and monitoring for system performance and user activity.
  - **QA & Validation** (60h) — Quality assurance processes to validate AI output and overall system.
  - **Retries & Idempotency** (40h) — Implement retry logic and ensure idempotency for AI requests.
- recognized categories: 9/16
- **missing categories (9)**: `data_persistence`, `admin_operations`, `payments_billing`, `integrations_external`, `ai_orchestration`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `analytics_reporting`

### `infra_observability` — Infrastructure observability platform
- implementation_price: **$32,661**  ·  final_price: **$587,891**  ·  reality_multiplier: ×18.00
- estimated_hours: **1010**  ·  complexity: **complex**  ·  confidence: **0.91**
- narrative_chips: `Scaled production`, `Platform complexity`, `Discovery work`, `Realtime`, `Infrastructure`
- modules:
  - **Data Ingestion** (120h) — Ingest logs, metrics, and traces from various customer infrastructures.
  - **Query Engine** (150h) — Engine to run optimized queries on ingested data for analysis.
  - **Dashboard Builder** (130h) — Tool for users to create and customize their dashboards based on the data.
  - **Alerting System** (100h) — Trigger alerts based on defined thresholds and conditions in data.
  - **User Authentication** (80h) — Manage user authentication to ensure secure access to the platform.
  - **Multi-Tenancy Layer** (140h) — Implement mechanisms to support multiple clients with data isolation.
  - **Observability & Logging** (90h) — Incorporate logging for observability and debugging of the platform itself.
  - **Deployment & CI/CD** (100h) — Setup continuous integration and deployment pipelines for platform updates.
  - **Fault Tolerance Mechanisms** (40h) — Implement retries and fault tolerance for data ingestion and processing.
  - **Input Validation Testing** (32h) — Thorough validation and testing of data inputs from customers for edge cases.
- recognized categories: 9/16
- **missing categories (9)**: `authorization_rbac`, `data_persistence`, `admin_operations`, `payments_billing`, `integrations_external`, `ai_orchestration`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`

### `marketplace` — Two-sided marketplace
- implementation_price: **$21,000**  ·  final_price: **$158,757**  ·  reality_multiplier: ×7.56
- estimated_hours: **642**  ·  complexity: **complex**  ·  confidence: **0.93**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Collaboration`, `Long-term product`
- modules:
  - **User Authentication** (40h) — Enable users to register, log in, and manage accounts securely.
  - **Service Listings** (60h) — Allow sellers to create, edit, and manage service offers on the platform.
  - **Search & Filter** (50h) — Implement search and filtering capabilities for buyers to find services easily.
  - **Booking System** (70h) — Facilitate on-platform bookings for services with a user-friendly calendar interface.
  - **Payments & Escrow** (80h) — Manage payment transactions with escrow system for added buyer protection.
  - **Reviews & Ratings** (50h) — Enable users to rate and review services after completion.
  - **Dispute Handling** (60h) — Create a process for resolving disputes between buyers and sellers effectively.
  - **Admin Dashboard** (70h) — Provide administrators with tools to manage users, listings, and transactions.
  - **Logging & Observability** (40h) — Implement logging for user activities and system observability for monitoring.
  - **Deployment & CI/CD** (50h) — Set up deployment processes and continuous integration for reliable updates.
- recognized categories: 11/16
- **missing categories (8)**: `authorization_rbac`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`

### `multiplayer` — Realtime multiplayer experience
- implementation_price: **$15,296**  ·  final_price: **$148,676**  ·  reality_multiplier: ×9.72
- estimated_hours: **462**  ·  complexity: **medium**  ·  confidence: **0.9**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (40h) — Securely manage user accounts and sessions for collaboration.
  - **Real-time collaboration** (120h) — Enable real-time editing with cursor visibility and shape manipulation.
  - **Commenting system** (60h) — Allow users to add comments on shapes and collaborate asynchronously.
  - **Shareable links** (30h) — Create unique links for users to access whiteboard sessions easily.
  - **Roles & permissions** (50h) — Manage user roles to control editing and commenting rights.
  - **Logging & observability** (40h) — Implement logging for user actions and performance monitoring.
  - **Deployment & CI/CD** (50h) — Set up continuous integration and deployment for automated builds.
  - **Fault Tolerance** (40h) — Implement retries and idempotency for critical operations to ensure reliability.
  - **Edge Case Testing** (32h) — Develop tests for edge cases and error handling in collaborative features.
- recognized categories: 10/16
- **missing categories (8)**: `data_persistence`, `admin_operations`, `payments_billing`, `integrations_external`, `ai_orchestration`, `compliance_security`, `notifications_delivery`, `analytics_reporting`

### `banking_dashboard` — Banking-grade financial dashboard
- implementation_price: **$19,669**  ·  final_price: **$191,180**  ·  reality_multiplier: ×9.72
- estimated_hours: **600**  ·  complexity: **complex**  ·  confidence: **0.92**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (40h) — Secure user login and session management for accessing the dashboard.
  - **Account overview** (60h) — Display user's financial accounts and their balances in real-time.
  - **Transaction history** (80h) — Show detailed transaction history for each account.
  - **Money transfers** (100h) — Enable users to transfer money between their accounts securely.
  - **Scheduled payments** (70h) — Allow users to set up recurring payments easily.
  - **Statements viewer** (50h) — Provide downloadable financial statements for user accounts.
  - **Roles & permissions** (30h) — Manage user permissions and roles to enhance security and compliance.
  - **Observability & logging** (40h) — Implement logging for transaction tracking and system performance monitoring.
  - **Deployment & CI/CD** (50h) — Set up continuous integration and deployment for seamless updates.
  - **Retries and Rollback** (40h) — Implement retries, idempotency, and rollback for transaction reliability.
- recognized categories: 11/16
- **missing categories (7)**: `authorization_rbac`, `admin_operations`, `payments_billing`, `integrations_external`, `ai_orchestration`, `collaboration_multiplayer`, `notifications_delivery`

### `enterprise_erp` — Enterprise ERP system
- implementation_price: **$21,887**  ·  final_price: **$135,918**  ·  reality_multiplier: ×6.21
- estimated_hours: **670**  ·  complexity: **complex**  ·  confidence: **0.92**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Long-term product`
- modules:
  - **User Authentication** (40h) — Manage user identities and session management securely.
  - **Roles & Permissions** (30h) — Define user roles and permissions for secure access control.
  - **Inventory Management** (80h) — Track and manage inventory levels and stock movements effectively.
  - **Purchase Orders** (60h) — Create, track, and manage purchase orders for suppliers.
  - **Invoicing System** (70h) — Generate and send invoices to customers with payment tracking.
  - **General Ledger** (90h) — Maintain accounting records and financial reporting for compliance.
  - **Customer/Vendor Records** (50h) — Store and manage data for customers and vendors efficiently.
  - **Basic HR Module** (70h) — Manage employee records, roles, and payroll basics.
  - **Deployment & CI/CD** (60h) — Set up automated deployment and continuous integration for the application.
  - **Observability & Logging** (50h) — Implement monitoring and logging systems for application health tracking.
- recognized categories: 13/16
- **missing categories (7)**: `admin_operations`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `collaboration_multiplayer`, `notifications_delivery`

## 6. Aggregate takeaways

**Most blind categories** (lowest recognition across corpus):
- `integrations_external` — 0/10 recognized
- `ai_orchestration` — 0/10 recognized
- `notifications_delivery` — 0/10 recognized
- `admin_operations` — 1/10 recognized
- `collaboration_multiplayer` — 1/10 recognized

**Best-perceived categories** (highest recognition):
- `qa_edge_cases` — 10/10 recognized
- `deployment_infrastructure` — 10/10 recognized
- `observability_monitoring` — 10/10 recognized
- `authentication_identity` — 10/10 recognized
- `reliability_recovery` — 8/10 recognized

**Asymmetric archetypes (ratio > 1.5)**: 0/10
**False-simplicity flags fired**: 1

---

_This report is generated. Raw JSON: `/app/audit/scope-benchmark-corpus.json`._