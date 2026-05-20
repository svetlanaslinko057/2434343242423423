# Scope Perception Benchmark — 2026-05-18T13:09:00Z

> Diagnostic corpus. Measures *operational perception*, not correctness. Charter: `/app/docs/scope-benchmark-charter.md`.

- Endpoint: `POST http://localhost:8001/api/estimate` (mode `hybrid`, infer_axes=true)
- Archetypes: **10**
- Categories: **16** operational obligations
- LLM-as-judge: ❌ (deterministic keyword classifier)

## 1. Recognition rate per operational category

Across all archetypes — fraction where the model surfaced at least one keyword.

| Category | Recognized / Total | % | Audience |
|----------|---------------------|---|----------|
| `authentication_identity` | 8/10 |  80.0%  `████████  ` | both |
| `authorization_rbac` | 3/10 |  30.0%  `███       ` | both |
| `data_persistence` | 1/10 |  10.0%  `█         ` | operator |
| `admin_operations` | 6/10 |  60.0%  `██████    ` | operator |
| `observability_monitoring` | 4/10 |  40.0%  `████      ` | operator |
| `deployment_infrastructure` | 3/10 |  30.0%  `███       ` | operator |
| `payments_billing` | 3/10 |  30.0%  `███       ` | both |
| `realtime_synchronization` | 6/10 |  60.0%  `██████    ` | user |
| `integrations_external` | 0/10 |   0.0%  `          ` | operator |
| `ai_orchestration` | 0/10 |   0.0%  `          ` | operator |
| `reliability_recovery` | 0/10 |   0.0%  `          ` | operator |
| `compliance_security` | 1/10 |  10.0%  `█         ` | operator |
| `collaboration_multiplayer` | 1/10 |  10.0%  `█         ` | user |
| `notifications_delivery` | 0/10 |   0.0%  `          ` | both |
| `analytics_reporting` | 8/10 |  80.0%  `████████  ` | both |
| `qa_edge_cases` | 0/10 |   0.0%  `          ` | operator |

## 2. Coverage matrix (per archetype × category)

`●` = recognized, `○` = absent, `!` = recognized but flagged as **false simplicity**.

| Archetype | authen | author | data | admin | observ | deploy | paymen | realti | integr | ai | reliab | compli | collab | notifi | analyt | qa |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| slack | ● | ● | ○ | ● | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| linear | ● | ● | ○ | ○ | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| stripe_for_x | ○ | ○ | ○ | ● | ○ | ● | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| b2b_crm | ● | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| ai_copilot | ● | ○ | ○ | ● | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| infra_observability | ● | ○ | ○ | ● | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| marketplace | ● | ○ | ○ | ○ | ○ | ○ | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| multiplayer | ● | ○ | ○ | ● | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ |
| banking_dashboard | ● | ○ | ● | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ● | ○ | ○ | ● | ○ |
| enterprise_erp | ○ | ! | ○ | ● | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |

Category short-keys: `authen`=`authentication_identity`, `author`=`authorization_rbac`, `data`=`data_persistence`, `admin`=`admin_operations`, `observ`=`observability_monitoring`, `deploy`=`deployment_infrastructure`, `paymen`=`payments_billing`, `realti`=`realtime_synchronization`, `integr`=`integrations_external`, `ai`=`ai_orchestration`, `reliab`=`reliability_recovery`, `compli`=`compliance_security`, `collab`=`collaboration_multiplayer`, `notifi`=`notifications_delivery`, `analyt`=`analytics_reporting`, `qa`=`qa_edge_cases`

## 3. Operational asymmetry (user-side vs operator-side coverage)

Asymmetry ratio = `user_coverage / operator_coverage`. Values > 1.5 indicate **builder-not-operator** cognition (rich user-facing scope, blind operator scope).

| Archetype | User cov | Operator cov | Ratio | Flag |
|-----------|----------|--------------|-------|------|
| slack | 0.57 (4/7) | 0.29 (4/14) | 2.00 | ⚠ high |
| linear | 0.57 (4/7) | 0.29 (4/14) | 2.00 | ⚠ high |
| stripe_for_x | 0.43 (3/7) | 0.29 (4/14) | 1.50 |  |
| b2b_crm | 0.29 (2/7) | 0.21 (3/14) | 1.33 |  |
| ai_copilot | 0.29 (2/7) | 0.36 (5/14) | 0.80 |  |
| infra_observability | 0.29 (2/7) | 0.36 (5/14) | 0.80 |  |
| marketplace | 0.43 (3/7) | 0.14 (2/14) | 3.00 | ⚠ high |
| multiplayer | 0.43 (3/7) | 0.14 (2/14) | 3.00 | ⚠ high |
| banking_dashboard | 0.43 (3/7) | 0.29 (4/14) | 1.50 |  |
| enterprise_erp | 0.43 (3/7) | 0.29 (4/14) | 1.50 |  |

## 4. False simplicity flags (complexity collapse)

The model **named** the responsibility but framed it with trivializing modifiers ("simple", "basic", "minimal", "just", ...). These are more dangerous than outright omissions because they create false confidence.

### `enterprise_erp` — Enterprise ERP system
- **`authorization_rbac`** → evidence: *…customer/vendor records
basic hr module
access control
react
node.js
mongodb
aws
express
produ…*

## 5. Per-archetype quick summary

### `slack` — Slack clone (team chat MVP)
- implementation_price: **$11,430**  ·  final_price: **$111,100**  ·  reality_multiplier: ×9.72
- estimated_hours: **340**  ·  complexity: **medium**  ·  confidence: **0.88**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (40h) — Implement secure login and registration for users and organizations.
  - **Workspace management** (50h) — Allow companies to create and manage their workspaces efficiently.
  - **Channel messaging** (70h) — Enable users to join channels and send messages, including attachments.
  - **Direct messaging** (60h) — Implement private messaging between users with real-time updates.
  - **Real-time notifications** (40h) — Provide instant notifications for messages and channel activity.
  - **User roles & permissions** (30h) — Manage different access levels for users within workspaces and channels.
  - **Admin dashboard** (50h) — Allow administrators to monitor and manage user activities and settings.
- recognized categories: 8/16
- **missing categories (11)**: `data_persistence`, `observability_monitoring`, `deployment_infrastructure`, `payments_billing`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `linear` — Linear clone (issue tracker)
- implementation_price: **$11,113**  ·  final_price: **$108,020**  ·  reality_multiplier: ×9.72
- estimated_hours: **330**  ·  complexity: **medium**  ·  confidence: **0.91**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User Authentication** (40h) — Manage user sign-up, login, and permission levels across teams.
  - **Issue Management** (60h) — Create, edit, and assign issues to team members effectively.
  - **Kanban Board** (80h) — Visual representation of issues for efficient status management and tracking.
  - **Real-time Updates** (50h) — Stream live updates on issue changes and team member activities.
  - **Notifications System** (30h) — Alert users on issue updates and assignments through various channels.
  - **Analytics Dashboard** (70h) — Provide insights on issue resolution times and team performance metrics.
- recognized categories: 8/16
- **missing categories (11)**: `data_persistence`, `admin_operations`, `deployment_infrastructure`, `payments_billing`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `stripe_for_x` — Stripe-for-X (vertical payments platform)
- implementation_price: **$32,344**  ·  final_price: **$314,381**  ·  reality_multiplier: ×9.72
- estimated_hours: **1000**  ·  complexity: **medium**  ·  confidence: **0.91**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **Merchant Onboarding** (160h) — Facilitate smooth onboarding for law firms to use the payment platform.
  - **Payment Processing** (200h) — Enable secure card processing for law firms and their clients.
  - **Chargeback Management** (120h) — Manage and automate chargeback responses for law firms.
  - **Settlement Reporting** (100h) — Provide detailed reports on transactions and settlements for law firms.
  - **Reconciliation Tools** (140h) — Provide tools for law firms to reconcile their financial books easily.
  - **Admin Dashboard** (180h) — Admin interface for managing users, transactions, and settings.
- recognized categories: 7/16
- **missing categories (11)**: `authentication_identity`, `authorization_rbac`, `data_persistence`, `observability_monitoring`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `b2b_crm` — B2B CRM
- implementation_price: **$13,648**  ·  final_price: **$84,755**  ·  reality_multiplier: ×6.21
- estimated_hours: **410**  ·  complexity: **medium**  ·  confidence: **0.89**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Long-term product`
- modules:
  - **User Authentication** (40h) — Secure login and management for sales representatives and admins.
  - **Contact Management** (60h) — Manage and organize contacts, including details and relationship history.
  - **Account Management** (70h) — Track and manage accounts with comprehensive insights and interactions.
  - **Deals Pipeline** (80h) — Visualize, track, and manage deals through the sales pipeline stages.
  - **Activity Timeline** (50h) — Log and display all activities and interactions for better tracking.
  - **Email Integration** (50h) — Integrate with email platforms to streamline communication and record keeping.
  - **Reporting Dashboard** (60h) — Generate reports on performance metrics and sales activities.
- recognized categories: 5/16
- **missing categories (13)**: `authorization_rbac`, `data_persistence`, `admin_operations`, `deployment_infrastructure`, `payments_billing`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `ai_copilot` — AI copilot (LLM product)
- implementation_price: **$33,294**  ·  final_price: **$251,705**  ·  reality_multiplier: ×7.56
- estimated_hours: **1030**  ·  complexity: **complex**  ·  confidence: **0.9**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Collaboration`, `Long-term product`
- modules:
  - **User Chat Interface** (120h) — Frontend interface for users to interact with the AI copilot.
  - **Document Integration** (180h) — System to pull and analyze user documents for context.
  - **AI Response Generation** (200h) — Backend logic to generate personalized responses based on user style.
  - **User Learning Module** (160h) — Algorithm to learn user preferences and improve response accuracy.
  - **Admin Dashboard** (100h) — Management interface for monitoring usage and performance metrics.
  - **User Authentication** (80h) — Secure user login and session management.
  - **Analytics & Reporting** (90h) — Tools for tracking user engagement and AI performance.
- recognized categories: 7/16
- **missing categories (11)**: `authorization_rbac`, `data_persistence`, `payments_billing`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `infra_observability` — Infrastructure observability platform
- implementation_price: **$23,788**  ·  final_price: **$196,966**  ·  reality_multiplier: ×8.28
- estimated_hours: **730**  ·  complexity: **complex**  ·  confidence: **0.91**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Infrastructure`
- modules:
  - **Data Ingestion** (120h) — Capture and process logs, metrics, and traces from customer infrastructures.
  - **Query Engine** (100h) — Develop a scalable system for executing queries on ingested data.
  - **Dashboard Builder** (90h) — Allow users to create and customize dashboards for their observability needs.
  - **Alerting System** (80h) — Implement a mechanism for notifying users based on specified triggers.
  - **Multi-tenancy Support** (70h) — Ensure data isolation and security for multiple customer environments.
  - **User Management** (60h) — Create functionality for user sign-up, roles, and permissions management.
  - **Monitoring & Reliability** (110h) — Set up infrastructure monitoring and failover mechanisms for reliability.
- recognized categories: 7/16
- **missing categories (11)**: `authorization_rbac`, `data_persistence`, `payments_billing`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `marketplace` — Two-sided marketplace
- implementation_price: **$13,014**  ·  final_price: **$98,389**  ·  reality_multiplier: ×7.56
- estimated_hours: **390**  ·  complexity: **medium**  ·  confidence: **0.93**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Collaboration`, `Long-term product`
- modules:
  - **User authentication** (40h) — Secure registration and login for buyers and sellers.
  - **Service listings** (60h) — Allows sellers to create and manage service offers on the platform.
  - **Messaging system** (50h) — In-platform communication between buyers and sellers for inquiries and coordination.
  - **Booking management** (70h) — Facilitates appointment scheduling and calendar integration for services offered.
  - **Payments & escrow** (80h) — Handles secure transactions, holding payments until service completion.
  - **Reviews & ratings** (40h) — Enables buyers to leave feedback and ratings for services received.
  - **Dispute resolution** (50h) — Processes complaints and mediates disputes between buyers and sellers.
- recognized categories: 5/16
- **missing categories (13)**: `authorization_rbac`, `data_persistence`, `admin_operations`, `observability_monitoring`, `deployment_infrastructure`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `analytics_reporting`, `qa_edge_cases`

### `multiplayer` — Realtime multiplayer experience
- implementation_price: **$12,381**  ·  final_price: **$120,340**  ·  reality_multiplier: ×9.72
- estimated_hours: **370**  ·  complexity: **medium**  ·  confidence: **0.9**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (40h) — Manage user sign-up, login, and session handling securely.
  - **Realtime collaboration** (100h) — Implement live updates for multiple users interacting on the whiteboard.
  - **Drawing tools** (80h) — Provide tools for shapes, drawing, and editing on the whiteboard.
  - **Comments & feedback** (40h) — Enable users to leave comments and feedback on the whiteboard.
  - **Link sharing** (50h) — Allow users to share editable whiteboard links with others.
  - **User management** (60h) — Admin features for managing users and permissions within the app.
- recognized categories: 5/16
- **missing categories (12)**: `authorization_rbac`, `data_persistence`, `observability_monitoring`, `deployment_infrastructure`, `payments_billing`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `notifications_delivery`, `analytics_reporting`, `qa_edge_cases`

### `banking_dashboard` — Banking-grade financial dashboard
- implementation_price: **$16,183**  ·  final_price: **$157,300**  ·  reality_multiplier: ×9.72
- estimated_hours: **490**  ·  complexity: **complex**  ·  confidence: **0.92**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Realtime`, `Long-term product`
- modules:
  - **User authentication** (40h) — Secure login and registration for customer accounts.
  - **Account overview** (60h) — Display a summary of customer accounts and balances.
  - **Transaction history** (80h) — Show detailed transactions for each account over time.
  - **Money transfers** (100h) — Enable customers to transfer funds between their accounts securely.
  - **Scheduled payments** (70h) — Allow customers to set up and manage recurring payments.
  - **Statement generation** (50h) — Generate and display account statements for customer review.
  - **Compliance & reporting** (90h) — Ensure regulatory requirements are met and generate necessary reports.
- recognized categories: 7/16
- **missing categories (11)**: `authorization_rbac`, `admin_operations`, `observability_monitoring`, `deployment_infrastructure`, `payments_billing`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

### `enterprise_erp` — Enterprise ERP system
- implementation_price: **$24,739**  ·  final_price: **$133,589**  ·  reality_multiplier: ×5.40
- estimated_hours: **760**  ·  complexity: **medium**  ·  confidence: **0.92**
- narrative_chips: `Production-grade`, `Platform complexity`, `Discovery work`, `Long-term product`
- modules:
  - **Inventory Management** (120h) — Track and manage inventory levels, orders, and deliveries.
  - **Purchase Orders** (100h) — Manage creation, approval, and tracking of purchase orders.
  - **Invoices & Billing** (100h) — Handle invoicing, payments, and billing processes.
  - **General Ledger** (150h) — Recording and managing financial transactions and reporting.
  - **Customer/Vendor Records** (90h) — Store and manage detailed information for customers and vendors.
  - **Basic HR Module** (120h) — Manage employee records, payroll and leave management.
  - **Access Control** (80h) — Implement role-based access for secure user management.
- recognized categories: 7/16
- **missing categories (12)**: `authentication_identity`, `data_persistence`, `observability_monitoring`, `deployment_infrastructure`, `realtime_synchronization`, `integrations_external`, `ai_orchestration`, `reliability_recovery`, `compliance_security`, `collaboration_multiplayer`, `notifications_delivery`, `qa_edge_cases`

## 6. Aggregate takeaways

**Most blind categories** (lowest recognition across corpus):
- `integrations_external` — 0/10 recognized
- `ai_orchestration` — 0/10 recognized
- `reliability_recovery` — 0/10 recognized
- `notifications_delivery` — 0/10 recognized
- `qa_edge_cases` — 0/10 recognized

**Best-perceived categories** (highest recognition):
- `analytics_reporting` — 8/10 recognized
- `authentication_identity` — 8/10 recognized
- `realtime_synchronization` — 6/10 recognized
- `admin_operations` — 6/10 recognized
- `observability_monitoring` — 4/10 recognized

**Asymmetric archetypes (ratio > 1.5)**: 4/10
**False-simplicity flags fired**: 1

---

_This report is generated. Raw JSON: `/app/audit/scope-benchmark-corpus.json`._