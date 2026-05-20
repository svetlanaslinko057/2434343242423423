# Scope Perception Benchmark — 2026-05-18T16:56:40Z

> Diagnostic corpus. Measures *operational perception*, not correctness. Charter: `/app/docs/scope-benchmark-charter.md`.

- Endpoint: `POST http://localhost:8001/api/estimate` (mode `hybrid`, infer_axes=true)
- Archetypes: **10**
- Categories: **16** operational obligations
- LLM-as-judge: ❌ (deterministic keyword classifier)

## 1. Recognition rate per operational category

Across all archetypes — fraction where the model surfaced at least one keyword.

| Category | Recognized / Total | % | Audience |
|----------|---------------------|---|----------|
| `authentication_identity` | 9/10 |  90.0%  `█████████ ` | both |
| `authorization_rbac` | 5/10 |  50.0%  `█████     ` | both |
| `data_persistence` | 0/10 |   0.0%  `          ` | operator |
| `admin_operations` | 2/10 |  20.0%  `██        ` | operator |
| `observability_monitoring` | 9/10 |  90.0%  `█████████ ` | operator |
| `deployment_infrastructure` | 9/10 |  90.0%  `█████████ ` | operator |
| `payments_billing` | 4/10 |  40.0%  `████      ` | both |
| `realtime_synchronization` | 7/10 |  70.0%  `███████   ` | user |
| `integrations_external` | 0/10 |   0.0%  `          ` | operator |
| `ai_orchestration` | 0/10 |   0.0%  `          ` | operator |
| `reliability_recovery` | 0/10 |   0.0%  `          ` | operator |
| `compliance_security` | 2/10 |  20.0%  `██        ` | operator |
| `collaboration_multiplayer` | 1/10 |  10.0%  `█         ` | user |
| `notifications_delivery` | 0/10 |   0.0%  `          ` | both |
| `analytics_reporting` | 5/10 |  50.0%  `█████     ` | both |
| `qa_edge_cases` | 0/10 |   0.0%  `          ` | operator |

## 2. Coverage matrix (per archetype × category)

`●` = recognized, `○` = absent, `!` = recognized but flagged as **false simplicity**.

| Archetype | authen | author | data | admin | observ | deploy | paymen | realti | integr | ai | reliab | compli | collab | notifi | analyt | qa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slack | ● | ○ | ○ | ● | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| linear | ● | ● | ○ | ○ | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| stripe_for_x | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| b2b_crm | ● | ● | ○ | ○ | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| ai_copilot | ● | ● | ○ | ○ | ● | ● | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| infra_observability | ● | ○ | ○ | ○ | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| marketplace | ● | ○ | ○ | ● | ● | ● | ● | ○ | ○ | ○ | ○ | ● | ○ | ○ | ● | ○ |
| multiplayer | ● | ○ | ○ | ○ | ● | ● | ○ | ● | ○ | ○ | ○ | ○ | ● | ○ | ● | ○ |
| banking_dashboard | ● | ● | ○ | ○ | ● | ● | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| enterprise_erp | ● | ● | ○ | ○ | ! | ● | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

Category short-keys: `authen`=`authentication_identity`, `author`=`authorization_rbac`, `data`=`data_persistence`, `admin`=`admin_operations`, `observ`=`observability_monitoring`, `deploy`=`deployment_infrastructure`, `paymen`=`payments_billing`, `realti`=`realtime_synchronization`, `integr`=`integrations_external`, `ai`=`ai_orchestration`, `reliab`=`reliability_recovery`, `compli`=`compliance_security`, `collab`=`collaboration_multiplayer`, `notifi`=`notifications_delivery`, `analyt`=`analytics_reporting`, `qa`=`qa_edge_cases`

## 3. Operational asymmetry (user-side vs operator-side coverage)

Asymmetry ratio = `user_coverage / operator_coverage`. Values > 1.5 indicate **builder-not-operator** cognition (rich user-facing scope, blind operator scope).

| Archetype | User cov | Operator cov | Ratio | Flag |
|-----------|----------|--------------|-------|------|
| slack | 0.43 (3/7) | 0.36 (5/14) | 1.20 |  |
| linear | 0.43 (3/7) | 0.29 (4/14) | 1.50 |  |
| stripe_for_x | 0.29 (2/7) | 0.07 (1/14) | 4.00 | ⚠ high |
| b2b_crm | 0.43 (3/7) | 0.36 (5/14) | 1.20 |  |
| ai_copilot | 0.29 (2/7) | 0.36 (5/14) | 0.80 |  |
| infra_observability | 0.43 (3/7) | 0.29 (4/14) | 1.50 |  |
| marketplace | 0.43 (3/7) | 0.50 (7/14) | 0.86 |  |
| multiplayer | 0.57 (4/7) | 0.29 (4/14) | 2.00 | ⚠ high |
| banking_dashboard | 0.57 (4/7) | 0.36 (5/14) | 1.60 | ⚠ high |
| enterprise_erp | 0.57 (4/7) | 0.36 (5/14) | 1.60 | ⚠ high |

## 4. False simplicity flags (complexity collapse)

The model **named** the responsibility but framed it with trivializing modifiers ("simple", "basic", "minimal", "just", ...). These are more dangerous than outright omissions because they create false confidence.

### `enterprise_erp` — Enterprise ERP system
- **`observability_monitoring`** → evidence: *…omer/vendor records
basic hr management
observability & logging
deployment & ci/cd
node.js
re…*

## 5. Per-archetype quick summary

### `slack` — Slack clone (team chat MVP)
- implementation_price: **$11,430**  ·  final_price: **$111,100**  ·  reality_multiplier: ×9.72
- estimated_hours: **340**  ·  complexity: **medium**  ·  confidence: **0.88**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (40h) — Handle user registration, login, and session management securely.
  - **Workspace management** (30h) — Allow companies to create and manage their own workspaces.
  - **Channel & DM features** (50h) — Enable users to join channels and send direct messages.
  - **Message handling** (60h) — Implement real-time messaging with support for attachments.
  - **Notifications system** (30h) — Notify users of new messages and activity.
  - **Admin dashboard** (40h) — Provide an interface for workspace admins to manage users and settings.
  - **Deployment & CI/CD** (50h) — Set up deployment pipeline and continuous integration for updates.
  - **Observability & logging** (40h) — Implement monitoring and logging for system performance and troubleshooting.
- recognized categories: 8/16
- **missing categories (10)**: `authorization_rbac`, `data_persistence`, `payments_billing`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `linear` — Linear clone (issue tracker)
- implementation_price: **$13,331**  ·  final_price: **$129,580**  ·  reality_multiplier: ×9.72
- estimated_hours: **400**  ·  complexity: **complex**  ·  confidence: **0.91**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User Authentication** (40h) — Enable users to securely log in and manage their accounts.
  - **Issues Management** (60h) — Allow users to create, update, and delete issues with relevant details.
  - **User Roles & Permissions** (50h) — Define roles for users to control access and actions on issues.
  - **Kanban Board** (80h) — Visual board for tracking issues across different statuses in real-time.
  - **Live Updates** (50h) — Enable real-time notifications for changes to issues and statuses.
  - **Collaborative Features** (40h) — Allow users to comment, tag, and communicate on issues.
  - **Observability & Logging** (30h) — Implement logging to monitor system performance and track issues.
  - **Deployment & CI/CD** (50h) — Set up automated deployment pipelines for continuous integration and delivery.
- recognized categories: 7/16
- **missing categories (11)**: `data_persistence`, `admin_operations`, `payments_billing`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `analytics_reporting`, `qa_edge_cases`

### `stripe_for_x` — Stripe-for-X (vertical payments platform)
- implementation_price: **$1,875**  ·  final_price: **$18,225**  ·  reality_multiplier: ×9.72
- estimated_hours: **38**  ·  complexity: **medium**  ·  confidence: **0.81**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **Payment integration** (19h) — 
  - **Billing logic** (19h) — 
- recognized categories: 3/16
- **missing categories (14)**: `authentication_identity`, `authorization_rbac`, `data_persistence`, `admin_operations`, `observability_monitoring`, `deployment_infrastructure`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `analytics_reporting`, `qa_edge_cases`

### `b2b_crm` — B2B CRM
- implementation_price: **$19,986**  ·  final_price: **$124,111**  ·  reality_multiplier: ×6.21
- estimated_hours: **610**  ·  complexity: **medium**  ·  confidence: **0.89**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Long-term product`
- modules:
  - **User authentication** (40h) — Manage user accounts and secure access to the CRM.
  - **Contacts management** (60h) — Create, update, and organize contacts within the CRM.
  - **Accounts management** (60h) — Handle company records and their associated details.
  - **Deals pipeline** (80h) — Track deals through various stages in the sales pipeline.
  - **Activity timeline** (50h) — Log and view all customer interactions and activities.
  - **Email integration** (70h) — Integrate email services for communication with contacts.
  - **Reporting dashboard** (80h) — Generate and display reports on sales activities and performance.
  - **Roles & permissions** (50h) — Define user roles and access levels within the CRM.
  - **Deployment & CI/CD** (40h) — Automate deployment processes and ensure continuous integration.
  - **Observability & logging** (40h) — Implement analytics and logging for monitoring application health.
- recognized categories: 8/16
- **missing categories (11)**: `data_persistence`, `admin_operations`, `payments_billing`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `ai_copilot` — AI copilot (LLM product)
- implementation_price: **$18,718**  ·  final_price: **$141,509**  ·  reality_multiplier: ×7.56
- estimated_hours: **570**  ·  complexity: **complex**  ·  confidence: **0.9**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Collaboration`, `Long-term product`
- modules:
  - **User Authentication** (40h) — Manage user identities and secure access to the application.
  - **Document Management** (60h) — Store and organize user documents for AI access and learning.
  - **AI Chat Assistant** (100h) — Facilitate user interaction through a conversational chat interface.
  - **Response Drafting** (120h) — Generate document drafts based on user input and document context.
  - **Style Learning** (80h) — Implement machine learning to adapt to users' writing styles over time.
  - **Roles & Permissions** (40h) — Define user roles to manage access levels and document permissions.
  - **Observability & Logging** (30h) — Track user interactions and system performance for insights and debugging.
  - **Deployment & CI/CD** (50h) — Automate deployment processes to ensure smooth updates and scalability.
  - **Security & Compliance** (60h) — Implement security measures and compliance tracking for user data.
- recognized categories: 7/16
- **missing categories (11)**: `data_persistence`, `admin_operations`, `payments_billing`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `collaboration_multiplayer`, `notifications_delivery`, `analytics_reporting`, `qa_edge_cases`

### `infra_observability` — Infrastructure observability platform
- implementation_price: **$16,975**  ·  final_price: **$220,000**  ·  reality_multiplier: ×12.96
- estimated_hours: **515**  ·  complexity: **complex**  ·  confidence: **0.91**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Infrastructure`
- modules:
  - **User Authentication** (40h) — Secure login system for users to access the platform.
  - **Data Ingestion** (80h) — API for users to send logs, metrics, and traces at scale.
  - **Query Engine** (60h) — Process queries on ingested data to return relevant results.
  - **Dashboard Builder** (70h) — Create customizable dashboards to visualize data for users.
  - **Alerts & Notifications** (50h) — System for users to set alerts based on data thresholds.
  - **Multi-Tenancy Management** (90h) — Ensure data isolation and security for multiple customers.
  - **Observability Foundations** (75h) — Implement logging, monitoring, and performance metrics for the platform.
  - **Deployment & CI/CD** (50h) — Set up automated deployment process and continuous integration pipeline.
- recognized categories: 7/16
- **missing categories (11)**: `authorization_rbac`, `data_persistence`, `admin_operations`, `payments_billing`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `marketplace` — Two-sided marketplace
- implementation_price: **$25,372**  ·  final_price: **$191,816**  ·  reality_multiplier: ×7.56
- estimated_hours: **780**  ·  complexity: **complex**  ·  confidence: **0.93**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Collaboration`, `Long-term product`
- modules:
  - **User Authentication** (40h) — Implement secure user authentication and session management for buyers and sellers.
  - **Service Listings** (60h) — Allow sellers to create and manage their service listings on the platform.
  - **Search & Discovery** (50h) — Enable buyers to efficiently search and browse services offered by sellers.
  - **Messaging System** (70h) — Facilitate communication between buyers and sellers through an integrated messaging system.
  - **Booking Management** (80h) — Handle service bookings, scheduling, and notifications for buyers and sellers.
  - **Payments & Escrow** (90h) — Manage payments held in escrow until the service is successfully delivered.
  - **Reviews & Feedback** (50h) — Allow buyers to leave reviews and feedback on completed services.
  - **Dispute Handling** (60h) — Establish a process for managing service disputes between buyers and sellers.
  - **Admin Dashboard** (70h) — Provide an interface for administrators to manage users, services, and disputes.
  - **Logging & Monitoring** (40h) — Implement observability and logging for performance tracking and issue resolution.
- recognized categories: 10/16
- **missing categories (9)**: `authorization_rbac`, `data_persistence`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `multiplayer` — Realtime multiplayer experience
- implementation_price: **$14,599**  ·  final_price: **$141,900**  ·  reality_multiplier: ×9.72
- estimated_hours: **440**  ·  complexity: **medium**  ·  confidence: **0.9**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (40h) — Secure user login and registration management.
  - **Real-time collaboration** (80h) — Sync user actions and updates in real-time across all devices.
  - **Whiteboard functionalities** (100h) — Implement drawing, shape creation, and editing tools.
  - **Commenting system** (40h) — Enable users to leave comments on the whiteboard.
  - **Link sharing** (30h) — Allow users to share whiteboard sessions via unique links.
  - **Roles & permissions** (50h) — Manage user access levels for editing and viewing.
  - **Observability & logging** (40h) — Implement logging for usage analytics and error tracking.
  - **Deployment & CI/CD** (60h) — Set up continuous integration and delivery pipelines.
- recognized categories: 8/16
- **missing categories (10)**: `authorization_rbac`, `data_persistence`, `admin_operations`, `payments_billing`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `notifications_delivery`, `qa_edge_cases`

### `banking_dashboard` — Banking-grade financial dashboard
- implementation_price: **$16,500**  ·  final_price: **$160,380**  ·  reality_multiplier: ×9.72
- estimated_hours: **500**  ·  complexity: **complex**  ·  confidence: **0.92**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (40h) — Secure login and registration for users to access their accounts.
  - **Accounts overview** (60h) — Display user accounts with balance and account details.
  - **Transactions log** (50h) — Show all transactions associated with user accounts.
  - **Money transfers** (70h) — Enable users to transfer funds between their accounts.
  - **Scheduled payments** (80h) — Allow users to set up recurring payment schedules.
  - **Statements retrieval** (50h) — Enable users to view and download account statements.
  - **Roles & permissions** (40h) — Manage user roles and permissions for secure access.
  - **Observability & logging** (30h) — Implement logging and monitoring for system health and performance.
  - **Deployment & CI/CD** (40h) — Set up continuous integration and deployment pipelines for efficient releases.
- recognized categories: 9/16
- **missing categories (10)**: `data_persistence`, `admin_operations`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `analytics_reporting`, `qa_edge_cases`

### `enterprise_erp` — Enterprise ERP system
- implementation_price: **$28,066**  ·  final_price: **$174,289**  ·  reality_multiplier: ×6.21
- estimated_hours: **865**  ·  complexity: **complex**  ·  confidence: **0.92**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Long-term product`
- modules:
  - **User authentication** (40h) — Manage user identities with secure login and session handling.
  - **Roles & permissions** (60h) — Define user roles and access levels for secure operations.
  - **Inventory management** (120h) — Track stock levels, orders, and deliveries in real-time.
  - **Purchase orders** (100h) — Facilitate ordering processes and vendor interactions.
  - **Invoices & billing** (90h) — Automate invoice generation and payment processing.
  - **General ledger** (110h) — Manage accounting records and financial transactions efficiently.
  - **Customer/vendor records** (80h) — Maintain comprehensive profiles for all business contacts.
  - **Basic HR management** (95h) — Handle employee records, payroll, and benefits administration.
  - **Observability & logging** (50h) — Implement monitoring and logging for tracking system performance.
  - **Deployment & CI/CD** (70h) — Establish continuous integration and deployment workflows.
- recognized categories: 9/16
- **missing categories (10)**: `data_persistence`, `admin_operations`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `analytics_reporting`, `qa_edge_cases`

## 6. Aggregate takeaways

**Most blind categories** (lowest recognition across corpus):
- `data_persistence` — 0/10 recognized
- `integrations_external` — 0/10 recognized
- `ai_orchestration` — 0/10 recognized
- `reliability_recovery` — 0/10 recognized
- `notifications_delivery` — 0/10 recognized

**Best-perceived categories** (highest recognition):
- `deployment_infrastructure` — 9/10 recognized
- `observability_monitoring` — 9/10 recognized
- `authentication_identity` — 9/10 recognized
- `realtime_synchronization` — 7/10 recognized
- `analytics_reporting` — 5/10 recognized

**Asymmetric archetypes (ratio > 1.5)**: 4/10
**False-simplicity flags fired**: 1

---

_This report is generated. Raw JSON: `/app/audit/scope-benchmark-corpus.json`._