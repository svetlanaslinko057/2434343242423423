"""
Shared operational obligations catalog.

Used by:
    /app/scripts/scope-benchmark-corpus.py   (Pass 1 corpus runner)
    /app/scripts/scope-reviewer-probe.py     (Pass 1 + Pass 2 probe)

Charter:
    /app/docs/scope-benchmark-charter.md
    /app/docs/operational-reviewer-probe-charter.md

If you edit categories or keywords here, both scripts pick it up on next run.
"""

CATEGORIES = {
    "authentication_identity": {
        "audience": "both",
        "description": "login, session, account recovery, social auth, password policy",
        "keywords": [
            "authentication", "auth ", "sign up", "sign-up", "signup", "sign in",
            "sign-in", "signin", "login", "log in", "log-in", "registration", "register",
            "password reset", "forgot password", "account recovery", "session",
            "oauth", "social auth", "social login", "sso", "single sign-on",
            "magic link", "passwordless", "jwt", "credentials",
        ],
    },
    "authorization_rbac": {
        "audience": "both",
        "description": "roles, permissions, admin boundaries, scoped access, multi-tenant isolation",
        "keywords": [
            "role-based", "rbac", "roles and permissions", "permission",
            "access control", "acl", "scoped access", "admin role", "tenant isolation",
            "multi-tenant", "multi tenant", "workspace permissions", "team permissions",
            "user roles",
        ],
    },
    "data_persistence": {
        "audience": "operator",
        "description": "state consistency, storage, migrations, schema evolution",
        "keywords": [
            "migration", "schema migration", "database schema", "data model",
            "consistency", "transaction", "acid", "data store", "persistence layer",
            "indexes", "indexing strategy", "data versioning",
        ],
    },
    "admin_operations": {
        "audience": "operator",
        "description": "backoffice, manual intervention, moderation tooling, support operations",
        "keywords": [
            "admin panel", "admin dashboard", "backoffice", "back office",
            "moderation", "manual intervention", "support tool", "operator console",
            "internal tooling", "admin tools", "admin interface", "ops dashboard",
            "moderator", "admin workflow", "manage users", "user management",
        ],
    },
    "observability_monitoring": {
        "audience": "operator",
        "description": "logs, metrics, error tracking, alerting, audit trails",
        "keywords": [
            "logging", "logs ", "monitoring", "metrics", "telemetry",
            "error tracking", "error reporting", "alerting", "alert system",
            "audit log", "audit trail", "observability", "sentry", "datadog",
            "prometheus", "grafana", "tracing", "distributed tracing", "apm",
        ],
    },
    "deployment_infrastructure": {
        "audience": "operator",
        "description": "environments, CI/CD, hosting, scaling, infrastructure-as-code",
        "keywords": [
            "ci/cd", "ci / cd", "continuous integration", "continuous deployment",
            "deployment pipeline", "deploy pipeline", "docker", "kubernetes",
            "infrastructure", "infra-as-code", "terraform", "ansible",
            "auto-scaling", "scaling strategy", "horizontal scale",
            "staging environment", "production environment", "hosting",
            "load balancer", "cdn", "cloudfront",
        ],
    },
    "payments_billing": {
        "audience": "both",
        "description": "subscriptions, invoices, refunds, webhooks, dunning, reconciliation",
        "keywords": [
            "payment", "billing", "subscription", "invoicing", "invoice",
            "refund", "chargeback", "webhook", "stripe", "paypal", "checkout",
            "settlement", "reconciliation", "dunning", "payout", "escrow",
            "transaction fee", "tax handling", "vat",
        ],
    },
    "realtime_synchronization": {
        "audience": "user",
        "description": "websocket, presence, live state, conflict resolution",
        "keywords": [
            "websocket", "web socket", "real-time", "realtime", "real time",
            "live update", "live sync", "presence", "presence indicator",
            "live state", "live cursor", "live cursors", "live notification",
            "push update", "pub/sub", "pubsub", "server-sent events",
            "socket.io", "ably", "pusher",
        ],
    },
    "integrations_external": {
        "audience": "operator",
        "description": "third-party APIs, webhook handling, retry policies, vendor failure modes",
        "keywords": [
            "third-party api", "third party api", "api integration",
            "webhook handler", "webhook handling", "webhook retry",
            "external integration", "vendor api", "rate limit handling",
            "integration retry", "retry policy", "circuit breaker",
            "webhook validation",
        ],
    },
    "ai_orchestration": {
        "audience": "operator",
        "description": "prompt engineering, context windows, rate limits, model fallbacks, hallucination handling",
        "keywords": [
            "prompt engineering", "prompt template", "context window",
            "embedding", "vector search", "vector store", "vector db",
            "model fallback", "model selection", "llm rate limit",
            "openai", "gpt-", "claude", "gemini", "llm orchestration",
            "rag ", "retrieval-augmented", "function calling",
        ],
    },
    "reliability_recovery": {
        "audience": "operator",
        "description": "retries, idempotency, backups, failure states, circuit breakers",
        "keywords": [
            "retry logic", "retry policy", "retries", "idempotency", "idempotent",
            "backup", "backup strategy", "disaster recovery", "failure recovery",
            "graceful degradation", "circuit breaker", "fallback strategy",
            "dead letter queue", "dlq", "outbox pattern",
        ],
    },
    "compliance_security": {
        "audience": "operator",
        "description": "GDPR/HIPAA/PCI, encryption, audit trails, access logs, data retention",
        "keywords": [
            "gdpr", "hipaa", "sox", "pci", "soc2", "soc 2", "compliance",
            "encryption at rest", "encryption in transit", "data privacy",
            "privacy policy", "consent management", "data retention",
            "data deletion", "right to be forgotten", "audit trail",
            "access logs", "security review",
        ],
    },
    "collaboration_multiplayer": {
        "audience": "user",
        "description": "comments, shared editing, concurrency control, optimistic locking",
        "keywords": [
            "comments", "commenting", "comment thread", "shared editing",
            "co-editing", "concurrent editing", "optimistic locking",
            "conflict resolution", "operational transform", "crdt",
            "shared workspace", "shared document", "shared session",
            "@mention", "mentions", "reactions",
        ],
    },
    "notifications_delivery": {
        "audience": "both",
        "description": "email, push, in-app delivery guarantees, opt-out",
        "keywords": [
            "email notification", "push notification", "in-app notification",
            "notification center", "notification delivery", "transactional email",
            "email service", "sendgrid", "resend", "postmark",
            "expo notification", "fcm", "apn ", "delivery guarantee",
            "notification preference", "opt-out", "unsubscribe",
        ],
    },
    "analytics_reporting": {
        "audience": "both",
        "description": "dashboards, exports, business metrics, BI integrations",
        "keywords": [
            "analytics", "dashboard", "report", "reporting", "business metric",
            "kpi", "data export", "csv export", "excel export", "bi integration",
            "tableau", "looker", "metabase", "mixpanel", "amplitude", "segment",
            "funnel analysis", "cohort analysis",
        ],
    },
    "qa_edge_cases": {
        "audience": "operator",
        "description": "validation, race conditions, error handling, test coverage",
        "keywords": [
            "validation", "input validation", "form validation", "error handling",
            "error state", "race condition", "edge case", "malformed input",
            "unit test", "integration test", "e2e test", "end-to-end test",
            "test coverage", "qa process", "regression test",
        ],
    },
}


FALSE_SIMPLICITY_TRIGGERS = [
    "simple", "basic", "minimal", "lightweight", "straightforward", "easy",
    "quick", "just ", "small ", "trivial",
]


# -----------------------------------------------------------------------------
# Classifier v2 — experimental keyword extensions (Hypothesis A test)
# -----------------------------------------------------------------------------
# After Phase A graft, `reliability_recovery` and `qa_edge_cases` stayed at 0/10
# despite explicit prompt invitation. Two competing hypotheses:
#   A. classifier keywords too strict — model emitted broader phrasing
#      ("Quality Assurance", "Reliability Framework") that didn't match v1.
#   B. reviewer-only recoverable — generator mode can't produce these even
#      when invited.
#
# These v2 overrides ONLY extend the two suspect categories. All other
# categories keep their v1 keywords. We test which hypothesis holds by
# re-running the classifier on the SAME corpus rows — no new LLM calls.
#
# If reliability/qa jump under v2 → Hypothesis A (classifier issue).
# If they stay at 0 → Hypothesis B (reviewer-only recoverable).
# -----------------------------------------------------------------------------

CATEGORIES_V2_OVERRIDES = {
    "reliability_recovery": {
        "extra_keywords": [
            # Top-level domain terms the model may use as a module title
            "reliability", "reliability framework", "reliability layer",
            "reliability system", "reliability strategy",
            # Fault-tolerance vocabulary
            "fault tolerance", "fault-tolerant", "fault tolerant",
            "high availability", "ha cluster", "failover", "redundancy",
            "uptime", "service availability",
            # Recovery vocabulary
            "rollback", "data integrity", "transaction integrity",
            "atomic operation", "atomicity", "consistency check",
            "self-healing", "self healing",
            # Async resilience vocabulary
            "message queue", "queueing system", "queue retry",
            "event sourcing",
        ],
    },
    "qa_edge_cases": {
        "extra_keywords": [
            # Top-level domain terms
            "qa ", "quality assurance", "quality control",
            "testing protocol", "testing framework", "testing strategy",
            "testing process", "testing setup",
            # Specific test-types beyond v1
            "automated testing", "automated test", "test suite",
            "test plan", "test coverage", "test automation",
            "manual testing", "user acceptance testing", "uat ",
            "smoke testing", "stress testing", "performance testing",
            # Validation vocabulary
            "data validation", "input sanitization", "sanitization",
            "sanity check", "edge handling", "boundary case",
            "boundary condition", "error boundary",
            # Defect handling
            "bug tracking", "defect tracking", "issue tracking",
        ],
    },
}


def get_categories_v2() -> dict:
    """Return a deep-copied CATEGORIES dict with v2 keyword extensions applied."""
    import copy
    cats = copy.deepcopy(CATEGORIES)
    for cat_name, override in CATEGORIES_V2_OVERRIDES.items():
        if cat_name in cats:
            cats[cat_name]["keywords"] = list(cats[cat_name]["keywords"]) + override.get("extra_keywords", [])
            cats[cat_name]["_v2_extended"] = True
    return cats
