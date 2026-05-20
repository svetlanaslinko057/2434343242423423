"""
MODULE DECOMPOSITION ENGINE

Two decomposition paths live here:

1) L4 deterministic decomposition — `decompose_project(goal, project)`
   Used by POST /api/projects (client-facing). Splits goal into 3–5 modules,
   divides project.pricing.final_price equally, and derives assignment_mode
   from production_mode (dev → manual, ai/hybrid → auto).
   NO AI, NO magic — deterministic work generator.

2) Legacy template-based decomposition — `decompose_project_by_template(project_type, ...)`
   Used by admin flow (POST /api/admin/projects/{id}/decompose).

Rules for templates (legacy):
- Module = finished deliverable (NOT "fix bug")
- Each module has: scope + deliverables + DoD
- Price: $400 / $600 / $800 / $1200 / $2000
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional
import logging
import uuid

logger = logging.getLogger(__name__)


# ============ L4 — DETERMINISTIC DECOMPOSITION ============

def _generate_module_id() -> str:
    return f"mod_{uuid.uuid4().hex[:12]}"


def _resolve_titles(goal: Optional[str]) -> List[str]:
    """Deterministic goal → module titles. Max 5 modules."""
    if not goal:
        return [
            "Core setup",
            "Main functionality",
            "UI layer",
            "Testing & QA",
        ]
    g = goal.lower()
    parts: List[str] = []
    if "dashboard" in g:
        parts += ["Data layer", "Dashboard UI", "Charts & analytics"]
    if "auth" in g or "login" in g:
        parts += ["Authentication", "User management"]
    if "payment" in g:
        parts += ["Payment integration", "Billing logic"]
    if not parts:
        parts = [
            "Core logic",
            "User interface",
            "Integrations",
            "QA & testing",
        ]
    return parts[:5]


def _resolve_assignment_mode(project: Dict) -> str:
    """
    CORE (manual) vs SYSTEM (auto) routing.

    - production_mode == "dev"    → manual (guardian/operator SKIP these modules)
    - production_mode in {ai,hybrid} → auto (system drives the flow)
    """
    mode = project.get("production_mode")
    if mode == "dev":
        return "manual"
    return "auto"


def decompose_project(goal: Optional[str], project: Dict) -> List[Dict]:
    """
    L4: deterministic project → modules.

    Returns a list of module dicts ready for db.modules.insert_many().
    Budget is project.pricing.final_price split equally across modules.
    """
    titles = _resolve_titles(goal)
    pricing = project.get("pricing") or {}
    total_budget = float(pricing.get("final_price") or 0.0)
    per_module = round(total_budget / len(titles), 2) if titles else 0.0
    assignment_mode = _resolve_assignment_mode(project)
    now = datetime.now(timezone.utc)
    modules: List[Dict] = []
    for title in titles:
        modules.append({
            "module_id": _generate_module_id(),
            "project_id": project["project_id"],
            "title": title,
            # lifecycle
            "status": "pending",
            "progress": 0,
            # economics
            "price": per_module,
            "base_price": per_module,
            # CORE vs SYSTEM routing
            "assignment_mode": assignment_mode,
            # provenance
            "source": "l4_decomposition",
            "created_at": now.isoformat(),
        })
    return modules


# ============ LEGACY TEMPLATE SYSTEM ============

# ============ MODULE TEMPLATES ============

MODULE_TEMPLATES = {
    "auth": {
        "type": "auth",
        "title": "Authentication System",
        "scope": [
            "Login / Register pages",
            "JWT authentication",
            "Password reset flow",
            "Email verification (optional)",
            "User roles & permissions"
        ],
        "deliverables": [
            "Working frontend (login/register)",
            "API endpoints (/auth/login, /auth/register, etc.)",
            "JWT token management",
            "Tested authentication flow"
        ],
        "definition_of_done": "User can register → login → access protected routes",
        "base_price": 400,
        "estimated_hours": 8
    },
    
    "dashboard": {
        "type": "dashboard",
        "title": "Admin Dashboard (CRUD)",
        "scope": [
            "Dashboard layout",
            "User management (Create, Read, Update, Delete)",
            "Data tables with pagination",
            "Search & filters",
            "Role-based access control"
        ],
        "deliverables": [
            "Admin UI with tables",
            "CRUD API endpoints",
            "Data validation",
            "Tested CRUD flows"
        ],
        "definition_of_done": "Admin can manage users: create, edit, delete, search",
        "base_price": 600,
        "estimated_hours": 12
    },
    
    "integration": {
        "type": "integration",
        "title": "Third-Party Integration",
        "scope": [
            "API integration (e.g., Stripe, Twilio, etc.)",
            "Webhook handling",
            "Error handling & retries",
            "Testing with sandbox"
        ],
        "deliverables": [
            "Integration endpoints",
            "Webhook receivers",
            "Error handling logic",
            "Integration tests"
        ],
        "definition_of_done": "Integration works end-to-end with real provider",
        "base_price": 500,
        "estimated_hours": 10
    },
    
    "feature": {
        "type": "feature",
        "title": "Feature Module",
        "scope": [
            "Feature UI components",
            "Backend API",
            "Data models",
            "Business logic"
        ],
        "deliverables": [
            "Working feature UI",
            "API endpoints",
            "Database models",
            "Tested feature flow"
        ],
        "definition_of_done": "Feature works end-to-end as specified",
        "base_price": 400,
        "estimated_hours": 8
    },
    
    "chart": {
        "type": "chart",
        "title": "Chart/Analytics Integration",
        "scope": [
            "Chart library integration (e.g., Recharts, Chart.js)",
            "Data aggregation API",
            "Real-time updates (optional)",
            "Responsive design"
        ],
        "deliverables": [
            "Working charts",
            "Data endpoints",
            "Interactive features",
            "Mobile-responsive"
        ],
        "definition_of_done": "Charts display correct data and update on changes",
        "base_price": 800,
        "estimated_hours": 14
    },
    
    "landing": {
        "type": "landing",
        "title": "Landing Page",
        "scope": [
            "Hero section",
            "Features section",
            "Pricing/Plans",
            "Contact form",
            "Responsive design"
        ],
        "deliverables": [
            "Responsive landing page",
            "Contact form with backend",
            "SEO optimization",
            "Performance optimization"
        ],
        "definition_of_done": "Landing page is live and converts visitors",
        "base_price": 400,
        "estimated_hours": 8
    }
}

# ============ PROJECT TYPE TEMPLATES ============

PROJECT_TEMPLATES = {
    "saas": {
        "name": "SaaS Application",
        "modules": [
            {"template": "auth", "title": "Authentication System", "price": 400},
            {"template": "dashboard", "title": "Admin Dashboard", "price": 600},
            {"template": "feature", "title": "Core Feature Module", "price": 800, "custom_scope": ["Main app functionality", "User workflows", "Data management"]},
            {"template": "integration", "title": "Payment Integration (Stripe)", "price": 500},
            {"template": "landing", "title": "Marketing Landing Page", "price": 400}
        ]
    },
    
    "dashboard": {
        "name": "Analytics Dashboard",
        "modules": [
            {"template": "auth", "title": "Authentication System", "price": 400},
            {"template": "dashboard", "title": "Admin Panel (Users/Settings)", "price": 600},
            {"template": "chart", "title": "Analytics Charts", "price": 800},
            {"template": "feature", "title": "Data Export Module", "price": 400}
        ]
    },
    
    "marketplace": {
        "name": "Marketplace Platform",
        "modules": [
            {"template": "auth", "title": "User Authentication", "price": 400},
            {"template": "feature", "title": "Product Catalog", "price": 800, "custom_scope": ["Product listings", "Search & filters", "Product details"]},
            {"template": "feature", "title": "Shopping Cart & Checkout", "price": 800, "custom_scope": ["Cart management", "Checkout flow", "Order placement"]},
            {"template": "integration", "title": "Payment Integration", "price": 500},
            {"template": "dashboard", "title": "Seller Dashboard", "price": 600}
        ]
    },
    
    "crypto": {
        "name": "Crypto Dashboard",
        "modules": [
            {"template": "auth", "title": "Authentication System", "price": 400},
            {"template": "chart", "title": "Trading Charts", "price": 800},
            {"template": "feature", "title": "Wallet Integration", "price": 800, "custom_scope": ["Wallet connect", "Balance display", "Transaction history"]},
            {"template": "integration", "title": "Exchange API Integration", "price": 600},
            {"template": "dashboard", "title": "Admin Panel", "price": 600}
        ]
    },
    
    "custom": {
        "name": "Custom Project",
        "modules": []  # Admin will manually add modules
    }
}


# ============ DECOMPOSITION ENGINE (legacy, admin template flow) ============

def decompose_project_by_template(project_type: str, custom_modules: List[Dict] = None) -> List[Dict]:
    """
    Legacy template-based decomposition (admin flow).
    Decompose project into modules based on named project template.

    Args:
        project_type: "saas" | "dashboard" | "marketplace" | "crypto" | "custom"
        custom_modules: Optional custom module definitions

    Returns:
        List of module definitions
    """
    if project_type == "custom" and custom_modules:
        return custom_modules
    
    if project_type not in PROJECT_TEMPLATES:
        logger.error(f"Unknown project type: {project_type}")
        return []
    
    project_template = PROJECT_TEMPLATES[project_type]
    modules = []
    
    for module_spec in project_template["modules"]:
        template_type = module_spec["template"]
        
        if template_type not in MODULE_TEMPLATES:
            logger.warning(f"Unknown template type: {template_type}")
            continue
        
        template = MODULE_TEMPLATES[template_type]
        
        # Build module from template
        module = {
            "title": module_spec.get("title", template["title"]),
            "description": f"{template['definition_of_done']}",
            "scope": module_spec.get("custom_scope", template["scope"]),
            "deliverables": template["deliverables"],
            "price": module_spec.get("price", template["base_price"]),
            "estimated_hours": template["estimated_hours"],
            "template_type": template_type
        }
        
        modules.append(module)
    
    return modules


def estimate_module_price(
    base_price: int,
    complexity: float = 1.0,
    urgency: float = 1.0,
    risk: float = 1.0
) -> int:
    """
    Estimate module price with multipliers
    
    Args:
        base_price: Base price from template
        complexity: 0.5 - 2.0 (simple to complex)
        urgency: 1.0 - 1.5 (normal to urgent)
        risk: 1.0 - 1.3 (low to high risk)
    
    Returns:
        Final price
    """
    # For MVP: use simple price tiers
    # Later: apply multipliers
    
    # Round to nearest tier: $400/$600/$800/$1200/$2000
    tiers = [400, 600, 800, 1200, 2000]
    
    estimated = int(base_price * complexity * urgency * risk)
    
    # Find closest tier
    closest = min(tiers, key=lambda x: abs(x - estimated))
    
    return closest


def validate_module(module: Dict) -> Dict:
    """
    Validate module has all required fields
    
    Returns:
        {
            "valid": bool,
            "errors": []
        }
    """
    errors = []
    
    required_fields = ["title", "scope", "deliverables", "price", "estimated_hours"]
    
    for field in required_fields:
        if field not in module or not module[field]:
            errors.append(f"Missing required field: {field}")
    
    # Validate scope
    if "scope" in module:
        if not isinstance(module["scope"], list) or len(module["scope"]) == 0:
            errors.append("Scope must be a non-empty list")
    
    # Validate deliverables
    if "deliverables" in module:
        if not isinstance(module["deliverables"], list) or len(module["deliverables"]) == 0:
            errors.append("Deliverables must be a non-empty list")
    
    # Validate price
    if "price" in module:
        if module["price"] < 100 or module["price"] > 5000:
            errors.append("Price must be between $100 and $5000")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors
    }
