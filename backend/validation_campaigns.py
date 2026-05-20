"""
Validation Campaigns Layer — Human perception validation (NOT engineering QA).

Architecture (per Final Task spec, 2026-05-18):
    Validator = human sensor
    Admin     = judge
    Client    = buyer of extra confidence
    Platform  = records useful signal

Three collections:
    - validation_campaigns:    admin-created missions targeting a project
    - validation_submissions:  validator-submitted feedback (looks_good | issue)
    - validator_profiles:      credits + reputation per validator

Six endpoints:
    POST /api/admin/validation/campaigns                       — admin create
    GET  /api/admin/validation/campaigns                       — admin list (with stats)
    POST /api/admin/validation/submissions/{id}/review         — admin judge
    GET  /api/validator/missions                               — available missions
    GET  /api/validator/missions/{id}                          — mission detail
    POST /api/validator/missions/{id}/submit                   — submit feedback

Plus auxiliary:
    GET  /api/validator/me                                     — my profile + credits + history

Reward model (v1): credits only. No money. Admin verdict final, no appeals.
"""
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
import uuid
import logging

logger = logging.getLogger("validation_campaigns")

router = APIRouter(prefix="/api", tags=["validation"])


# ============ MODELS ============

class CampaignCreate(BaseModel):
    """Admin payload to start a new validation campaign."""
    project_id: str
    goal: str = Field("Pre-release review", max_length=80)  # short label
    max_validators: int = Field(3, ge=1, le=20)
    reward_pool_credits: int = Field(150, ge=0, le=5000)
    public: bool = True
    deadline_hours: int = Field(48, ge=1, le=720)  # 1h..30d
    preview_url: Optional[str] = None  # link the validator opens (staging/preview)
    checklist: List[str] = Field(default_factory=lambda: [
        "Mobile layout",
        "Visual glitch",
        "UX confusion",
        "Broken interaction",
        "Typography & readability",
        "Dark mode",
        "Navigation",
    ])
    # Provenance for HVL one-click bootstrap — fully optional. When the
    # admin spawns a session from a project's HVL tier we tag it so we
    # can dedupe ("not started" suggestions), audit, and link back from
    # /admin/projects/{id}.
    source: Optional[str] = None        # e.g. "project_hvl_tier"
    source_tier: Optional[str] = None   # "basic" | "pro" | "managed"


# ─── HVL → campaign defaults ────────────────────────────────────────────
# Single source of truth for what each tier suggests when the admin
# launches a session. The reward pool is denominated in engagement
# credits — not money — see validator_profiles.credits_balance.
HVL_TIER_DEFAULTS: Dict[str, Dict[str, int]] = {
    "basic":   {"max_validators": 3, "reward_pool_credits": 100, "deadline_hours": 48},
    "pro":     {"max_validators": 5, "reward_pool_credits": 250, "deadline_hours": 72},
    "managed": {"max_validators": 7, "reward_pool_credits": 500, "deadline_hours": 96},
}


class SubmissionCreate(BaseModel):
    """Validator payload to submit feedback for a mission."""
    kind: str = Field(..., pattern="^(looks_good|issue)$")
    category: Optional[str] = None  # one of checklist labels OR free text (<= 60c)
    comment: Optional[str] = Field(None, max_length=600)
    screenshot_b64: Optional[str] = None  # base64 data URL, optional
    platform_hint: Optional[str] = Field(None, max_length=40)  # "iOS 17 / Safari", "Android 14 / Chrome"


class SubmissionReview(BaseModel):
    """Admin verdict on a submitted observation."""
    verdict: str = Field(..., pattern="^(useful|duplicate|irrelevant)$")
    admin_note: Optional[str] = Field(None, max_length=300)


# ============ DB INDEX BOOTSTRAP ============

async def ensure_indexes(db):
    """Idempotent — called on backend boot."""
    await db.validation_campaigns.create_index("campaign_id", unique=True)
    await db.validation_campaigns.create_index("project_id")
    await db.validation_campaigns.create_index([("status", 1), ("public", 1)])
    await db.validation_submissions.create_index("submission_id", unique=True)
    await db.validation_submissions.create_index([("campaign_id", 1), ("validator_id", 1)])
    await db.validation_submissions.create_index([("admin_verdict", 1), ("created_at", -1)])
    await db.validator_profiles.create_index("user_id", unique=True)
    logger.info("VALIDATION CAMPAIGNS: indexes ensured")


# ============ HELPERS ============

async def _get_or_create_profile(db, user_id: str) -> Dict[str, Any]:
    prof = await db.validator_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if prof:
        return prof
    prof = {
        "user_id": user_id,
        "credits_balance": 0,
        "reputation_score": 50,  # neutral start, 0-100
        "useful_count": 0,
        "noise_count": 0,
        "total_submissions": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.validator_profiles.insert_one(prof.copy())
    return prof


async def _is_validator_enabled(db, user_id: str) -> bool:
    """Capability check — does this user have validation_enabled flag?

    Architecture (v2): validator is NOT a separate role. Any logged-in user
    (client / developer / admin / tester) can opt in via
    POST /api/validator/opt-in. The flag lives on users.features dict.
    """
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "features": 1})
    if not u:
        return False
    feat = u.get("features") or {}
    return bool(feat.get("validation_enabled"))


def _campaign_status(camp: Dict[str, Any]) -> str:
    """Recompute live status from stored row."""
    if camp.get("status") == "closed":
        return "closed"
    deadline = camp.get("deadline_at")
    if deadline:
        try:
            dl = datetime.fromisoformat(deadline.replace("Z", "+00:00")) if isinstance(deadline, str) else deadline
            if dl < datetime.now(timezone.utc):
                return "expired"
        except Exception:
            pass
    return camp.get("status", "active")


def _serialize_campaign(camp: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in camp.items() if k != "_id"}
    out["status"] = _campaign_status(camp)
    return out


def _serialize_submission(sub: Dict[str, Any]) -> Dict[str, Any]:
    out = {k: v for k, v in sub.items() if k != "_id"}
    # NEVER leak full screenshot back into list endpoints — only flag presence.
    if out.get("screenshot_b64"):
        out["has_screenshot"] = True
    return out


# ============ ROUTES (registered via factory so we can inject `db` + `get_current_user`) ============

def register_routes(app, db, get_current_user, require_role):
    """Call once from server.py after app + dependencies are ready."""

    @router.post("/admin/validation/campaigns")
    async def admin_create_campaign(
        payload: CampaignCreate,
        admin = Depends(require_role("admin")),
    ):
        project = await db.projects.find_one(
            {"project_id": payload.project_id},
            {"_id": 0, "name": 1, "title": 1, "hvl_tier": 1},
        )
        if not project:
            raise HTTPException(404, "Project not found")
        # ─── Idempotency for HVL one-click bootstrap ────────────────────
        # If this campaign is being spawned from a project's HVL tier
        # and there's already an ACTIVE campaign for the same project
        # tagged with the same source, hand back the existing one
        # instead of creating a duplicate. This matches the spec rule:
        # "если session уже есть по project_id — не создавать дубль,
        # показывать existing session."
        if payload.source == "project_hvl_tier":
            existing = await db.validation_campaigns.find_one(
                {
                    "project_id": payload.project_id,
                    "source": "project_hvl_tier",
                    "status": {"$ne": "closed"},
                },
                {"_id": 0},
            )
            if existing:
                return {**_serialize_campaign(existing), "_already_existed": True}
        now = datetime.now(timezone.utc)
        camp = {
            "campaign_id": f"camp_{uuid.uuid4().hex[:12]}",
            "project_id": payload.project_id,
            "project_title": project.get("name") or project.get("title") or "Project",
            "goal": payload.goal,
            "max_validators": payload.max_validators,
            "reward_pool_credits": payload.reward_pool_credits,
            "reward_per_useful": max(1, payload.reward_pool_credits // max(1, payload.max_validators * 2)),
            "public": payload.public,
            "preview_url": payload.preview_url,
            "checklist": payload.checklist,
            "deadline_at": (now + timedelta(hours=payload.deadline_hours)).isoformat(),
            "status": "active",
            "created_by": admin.user_id,
            "created_at": now.isoformat(),
            # Provenance — null when admin spawned the session by hand.
            "source": payload.source,
            "source_project_id": payload.project_id if payload.source else None,
            "source_tier": payload.source_tier or project.get("hvl_tier"),
        }
        await db.validation_campaigns.insert_one(camp.copy())
        logger.info(
            f"VALIDATION CAMPAIGN created: {camp['campaign_id']} project={payload.project_id} "
            f"goal='{payload.goal}' source={camp['source']} tier={camp['source_tier']}"
        )
        return _serialize_campaign(camp)

    @router.get("/admin/validation/campaigns")
    async def admin_list_campaigns(admin = Depends(require_role("admin"))):
        camps = await db.validation_campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
        out = []
        for c in camps:
            # enrich with submission stats
            subs = await db.validation_submissions.find(
                {"campaign_id": c["campaign_id"]}, {"_id": 0, "kind": 1, "admin_verdict": 1}
            ).to_list(500)
            stats = {
                "total": len(subs),
                "looks_good": sum(1 for s in subs if s.get("kind") == "looks_good"),
                "issues": sum(1 for s in subs if s.get("kind") == "issue"),
                "pending_review": sum(1 for s in subs if s.get("admin_verdict") == "pending"),
                "useful": sum(1 for s in subs if s.get("admin_verdict") == "useful"),
            }
            out.append({**_serialize_campaign(c), "stats": stats})
        return out

    # ─────────────────────────────────────────────────────────────────────
    # HVL one-click bootstrap (May 19, 2026)
    #
    # Closes the "operational bridge" between checkout and review:
    #   client picks HVL tier  →  project.hvl_tier stored
    #   →  GET /admin/validation/suggested-projects  surfaces this project
    #   →  admin clicks Create  →  POST /admin/validation/campaigns with
    #      source="project_hvl_tier" → campaign spawned, idempotent.
    #
    # The /admin/projects/{id}/validation endpoint is the project-detail
    # mirror — same data, single-project shape, so the admin can launch
    # the session from the project card too.
    # ─────────────────────────────────────────────────────────────────────

    @router.get("/admin/validation/suggested-projects")
    async def admin_validation_suggested(admin = Depends(require_role("admin"))):
        """List projects that purchased an HVL tier and their session status.

        Each row tells the admin:
          - which tier the client chose (provenance from checkout)
          - the suggested campaign defaults for that tier
          - whether a session already exists (idempotency guard)
        """
        projects = await db.projects.find(
            {"hvl_tier": {"$in": list(HVL_TIER_DEFAULTS.keys())}},
            {"_id": 0, "project_id": 1, "name": 1, "title": 1, "hvl_tier": 1,
             "client_id": 1, "current_stage": 1, "preview_url": 1, "created_at": 1},
        ).sort("created_at", -1).to_list(200)
        out = []
        for p in projects:
            tier = p.get("hvl_tier")
            defaults = HVL_TIER_DEFAULTS.get(tier, {})
            camp = await db.validation_campaigns.find_one(
                {"project_id": p["project_id"], "source": "project_hvl_tier"},
                {"_id": 0},
                sort=[("created_at", -1)],
            )
            campaign_status = "not_started"
            campaign_id = None
            if camp:
                live = _campaign_status(camp)
                campaign_status = "closed" if live == "closed" else ("expired" if live == "expired" else "active")
                campaign_id = camp.get("campaign_id")
            name = p.get("name") or p.get("title") or "Project"
            out.append({
                "project_id": p["project_id"],
                "project_name": name,
                "client_id": p.get("client_id"),
                "current_stage": p.get("current_stage"),
                "preview_url": p.get("preview_url"),
                "hvl_tier": tier,
                "campaign_status": campaign_status,    # "not_started" | "active" | "expired" | "closed"
                "campaign_id": campaign_id,
                "suggested": {
                    "title": f"{name} review",
                    "goal": "Pre-release human validation",
                    "max_validators": defaults.get("max_validators", 3),
                    "reward_pool_credits": defaults.get("reward_pool_credits", 150),
                    "deadline_hours": defaults.get("deadline_hours", 48),
                    "preview_url": p.get("preview_url") or None,
                    "source": "project_hvl_tier",
                    "source_tier": tier,
                },
            })
        return out

    @router.get("/admin/projects/{project_id}/validation")
    async def admin_project_validation(
        project_id: str,
        admin = Depends(require_role("admin")),
    ):
        """HVL block for the admin project-detail page.

        Returns:
          - hvl_tier (or null if the client didn't pick one)
          - suggested defaults for the tier
          - existing campaign (if any) + lightweight submission stats
        """
        proj = await db.projects.find_one(
            {"project_id": project_id},
            {"_id": 0, "project_id": 1, "name": 1, "title": 1, "hvl_tier": 1, "preview_url": 1},
        )
        if not proj:
            raise HTTPException(404, "Project not found")
        tier = proj.get("hvl_tier")
        defaults = HVL_TIER_DEFAULTS.get(tier, {}) if tier else {}
        name = proj.get("name") or proj.get("title") or "Project"
        camp = await db.validation_campaigns.find_one(
            {"project_id": project_id, "source": "project_hvl_tier"},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        stats = None
        campaign_block = None
        if camp:
            subs = await db.validation_submissions.find(
                {"campaign_id": camp["campaign_id"]},
                {"_id": 0, "kind": 1, "admin_verdict": 1},
            ).to_list(500)
            stats = {
                "total": len(subs),
                "pending_review": sum(1 for s in subs if s.get("admin_verdict") == "pending"),
                "useful": sum(1 for s in subs if s.get("admin_verdict") == "useful"),
            }
            campaign_block = {**_serialize_campaign(camp), "stats": stats}
        return {
            "project_id": project_id,
            "project_name": name,
            "hvl_tier": tier,
            "campaign": campaign_block,            # null if not started
            "suggested": {
                "title": f"{name} review",
                "goal": "Pre-release human validation",
                "max_validators": defaults.get("max_validators", 3) if tier else None,
                "reward_pool_credits": defaults.get("reward_pool_credits", 150) if tier else None,
                "deadline_hours": defaults.get("deadline_hours", 48) if tier else None,
                "preview_url": proj.get("preview_url") or None,
                "source": "project_hvl_tier",
                "source_tier": tier,
            } if tier else None,
        }

    @router.get("/admin/validation/campaigns/{campaign_id}/submissions")
    async def admin_campaign_submissions(
        campaign_id: str,
        admin = Depends(require_role("admin")),
    ):
        camp = await db.validation_campaigns.find_one({"campaign_id": campaign_id}, {"_id": 0})
        if not camp:
            raise HTTPException(404, "Campaign not found")
        subs = await db.validation_submissions.find(
            {"campaign_id": campaign_id}, {"_id": 0}
        ).sort("created_at", -1).to_list(500)
        return {"campaign": _serialize_campaign(camp), "submissions": [_serialize_submission(s) for s in subs]}

    # ---------------------------------------------------------------------
    # Project-scoped HVL block (client / developer surface).
    # Read-only summary so project members can see what HVL tier was bought
    # and current campaign state — without admin privileges.
    # ---------------------------------------------------------------------
    @router.get("/projects/{project_id}/hvl-status")
    async def project_hvl_status(
        project_id: str,
        user: "User" = Depends(get_current_user),
    ):
        """HVL status block visible to project members (client + assigned developers).

        Returns the same shape as the admin endpoint MINUS internal fields
        (no validator emails, no submission bodies, just counts + status).
        """
        proj = await db.projects.find_one(
            {"project_id": project_id},
            {"_id": 0, "project_id": 1, "name": 1, "title": 1, "hvl_tier": 1,
             "preview_url": 1, "client_id": 1, "assigned_developers": 1, "developers": 1},
        )
        if not proj:
            raise HTTPException(404, "Project not found")

        # Authorise: admin OR project client OR project developer.
        uid = user.user_id if hasattr(user, "user_id") else user.get("user_id")
        role = user.role if hasattr(user, "role") else user.get("role")
        is_admin = role == "admin"
        is_client = proj.get("client_id") == uid
        devs = (proj.get("assigned_developers") or []) + (proj.get("developers") or [])
        is_dev = uid in devs
        if not (is_admin or is_client or is_dev):
            raise HTTPException(403, "Not a project member")

        tier = proj.get("hvl_tier")
        name = proj.get("name") or proj.get("title") or "Project"
        defaults = HVL_TIER_DEFAULTS.get(tier, {}) if tier else {}

        camp = await db.validation_campaigns.find_one(
            {"project_id": project_id, "source": "project_hvl_tier"},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        campaign_block = None
        if camp:
            subs = await db.validation_submissions.find(
                {"campaign_id": camp["campaign_id"]},
                {"_id": 0, "kind": 1, "admin_verdict": 1, "validator_id": 1},
            ).to_list(500)
            unique_validators = {s.get("validator_id") for s in subs if s.get("validator_id")}
            campaign_block = {
                "campaign_id": camp["campaign_id"],
                "status": camp.get("status"),
                "max_validators": camp.get("max_validators"),
                "validators_count": len(unique_validators),
                "deadline_at": camp.get("deadline_at").isoformat() if isinstance(camp.get("deadline_at"), datetime) else camp.get("deadline_at"),
                "stats": {
                    "total": len(subs),
                    "useful": sum(1 for s in subs if s.get("admin_verdict") == "useful"),
                    "pending": sum(1 for s in subs if s.get("admin_verdict") in (None, "pending")),
                    "issues": sum(1 for s in subs if s.get("kind") == "issue"),
                },
            }
        return {
            "project_id": project_id,
            "project_name": name,
            "hvl_tier": tier,
            "tier_defaults": {
                "max_validators": defaults.get("max_validators"),
                "reward_pool_credits": defaults.get("reward_pool_credits"),
                "deadline_hours": defaults.get("deadline_hours"),
            } if tier else None,
            "campaign": campaign_block,
            "viewer_role": "admin" if is_admin else ("client" if is_client else "developer"),
        }

    @router.get("/admin/validation/submissions/{submission_id}")
    async def admin_get_submission(
        submission_id: str,
        admin = Depends(require_role("admin")),
    ):
        sub = await db.validation_submissions.find_one({"submission_id": submission_id}, {"_id": 0})
        if not sub:
            raise HTTPException(404, "Submission not found")
        # Admin gets full screenshot_b64 — they're the judge.
        return sub

    @router.post("/admin/validation/submissions/{submission_id}/review")
    async def admin_review_submission(
        submission_id: str,
        payload: SubmissionReview,
        admin = Depends(require_role("admin")),
    ):
        sub = await db.validation_submissions.find_one({"submission_id": submission_id}, {"_id": 0})
        if not sub:
            raise HTTPException(404, "Submission not found")
        if sub.get("admin_verdict") and sub["admin_verdict"] != "pending":
            raise HTTPException(409, f"Already reviewed: {sub['admin_verdict']}")

        camp = await db.validation_campaigns.find_one({"campaign_id": sub["campaign_id"]}, {"_id": 0})
        validator_id = sub["validator_id"]
        prof = await _get_or_create_profile(db, validator_id)

        # credit + reputation arithmetic — small, transparent, admin-controlled.
        verdict = payload.verdict
        credits_awarded = 0
        rep_delta = 0
        if verdict == "useful":
            credits_awarded = (camp or {}).get("reward_per_useful", 25)
            rep_delta = +3
        elif verdict == "duplicate":
            credits_awarded = max(1, (camp or {}).get("reward_per_useful", 25) // 5)
            rep_delta = 0
        elif verdict == "irrelevant":
            credits_awarded = 0
            rep_delta = -2

        now = datetime.now(timezone.utc)
        await db.validation_submissions.update_one(
            {"submission_id": submission_id},
            {"$set": {
                "admin_verdict": verdict,
                "admin_note": payload.admin_note,
                "credits_awarded": credits_awarded,
                "verdict_at": now.isoformat(),
                "verdict_by": admin.user_id,
            }},
        )

        # update profile
        new_rep = max(0, min(100, prof["reputation_score"] + rep_delta))
        update = {
            "reputation_score": new_rep,
            "credits_balance": prof["credits_balance"] + credits_awarded,
        }
        if verdict == "useful":
            update["useful_count"] = prof["useful_count"] + 1
        elif verdict == "irrelevant":
            update["noise_count"] = prof["noise_count"] + 1
        await db.validator_profiles.update_one({"user_id": validator_id}, {"$set": update})

        # immutable audit event
        await db.validator_credit_events.insert_one({
            "event_id": f"cev_{uuid.uuid4().hex[:12]}",
            "user_id": validator_id,
            "submission_id": submission_id,
            "campaign_id": sub["campaign_id"],
            "verdict": verdict,
            "credits": credits_awarded,
            "reputation_delta": rep_delta,
            "by": admin.user_id,
            "at": now.isoformat(),
        })
        logger.info(f"VALIDATION REVIEW: sub={submission_id} verdict={verdict} credits={credits_awarded} rep_delta={rep_delta}")
        return {
            "ok": True,
            "submission_id": submission_id,
            "verdict": verdict,
            "credits_awarded": credits_awarded,
            "reputation_delta": rep_delta,
        }

    # ============ VALIDATOR-FACING ROUTES ============

    @router.get("/validator/status")
    async def validator_status(user = Depends(get_current_user)):
        """Capability check — is this user opted into the Human Validation Program?

        Returns {enabled: bool, profile?: {...}}. Used by mobile UI to decide
        whether to show opt-in CTA or missions list.
        """
        enabled = await _is_validator_enabled(db, user.user_id)
        profile = None
        if enabled:
            profile = await _get_or_create_profile(db, user.user_id)
        return {"enabled": enabled, "profile": profile}

    @router.post("/validator/opt-in")
    async def validator_opt_in(user = Depends(get_current_user)):
        """Opt into the Human Validation Program. Idempotent.

        Validator is NOT a separate role — it's a capability flag stored on
        users.features.validation_enabled. Existing role (client / developer /
        admin / tester) is preserved.
        """
        await db.users.update_one(
            {"user_id": user.user_id},
            {"$set": {"features.validation_enabled": True,
                      "features.validation_enabled_at": datetime.now(timezone.utc).isoformat()}},
        )
        profile = await _get_or_create_profile(db, user.user_id)
        logger.info(f"VALIDATOR OPT-IN: user={user.user_id}")
        return {"enabled": True, "profile": profile}

    @router.post("/validator/opt-out")
    async def validator_opt_out(user = Depends(get_current_user)):
        """Disable validation capability. Profile + history are preserved
        (so credits and reputation survive a re-opt-in). Just hides the UI.
        """
        await db.users.update_one(
            {"user_id": user.user_id},
            {"$set": {"features.validation_enabled": False}},
        )
        logger.info(f"VALIDATOR OPT-OUT: user={user.user_id}")
        return {"enabled": False}

    @router.get("/validator/me")
    async def validator_profile(user = Depends(get_current_user)):
        enabled = await _is_validator_enabled(db, user.user_id)
        if not enabled:
            return {"enabled": False, "profile": None, "recent_submissions": []}
        prof = await _get_or_create_profile(db, user.user_id)
        # recent history (last 20)
        subs = await db.validation_submissions.find(
            {"validator_id": user.user_id}, {"_id": 0}
        ).sort("created_at", -1).limit(20).to_list(20)
        return {"enabled": True, "profile": prof, "recent_submissions": [_serialize_submission(s) for s in subs]}

    @router.get("/validator/missions")
    async def list_missions(user = Depends(get_current_user)):
        """Available missions = active + public + has slots + I haven't submitted yet.

        Requires opt-in (users.features.validation_enabled = true).
        """
        if not await _is_validator_enabled(db, user.user_id):
            raise HTTPException(403, "Validation Program opt-in required")
        camps = await db.validation_campaigns.find(
            {"status": "active", "public": True}, {"_id": 0}
        ).sort("created_at", -1).to_list(200)
        out = []
        for c in camps:
            # skip expired (without mutating DB — lazy)
            if _campaign_status(c) != "active":
                continue
            # count my submissions + total
            mine = await db.validation_submissions.count_documents(
                {"campaign_id": c["campaign_id"], "validator_id": user.user_id}
            )
            if mine > 0:
                continue
            total = await db.validation_submissions.count_documents(
                {"campaign_id": c["campaign_id"]}
            )
            distinct_validators = await db.validation_submissions.distinct(
                "validator_id", {"campaign_id": c["campaign_id"]}
            )
            if len(distinct_validators) >= c.get("max_validators", 3):
                continue  # mission full
            out.append({
                **_serialize_campaign(c),
                "submissions_count": total,
                "validators_count": len(distinct_validators),
            })
        return out

    @router.get("/validator/missions/{campaign_id}")
    async def mission_detail(campaign_id: str, user = Depends(get_current_user)):
        camp = await db.validation_campaigns.find_one({"campaign_id": campaign_id}, {"_id": 0})
        if not camp or not camp.get("public", True):
            raise HTTPException(404, "Mission not found")
        my_sub = await db.validation_submissions.find_one(
            {"campaign_id": campaign_id, "validator_id": user.user_id}, {"_id": 0}
        )
        return {
            "campaign": _serialize_campaign(camp),
            "my_submission": _serialize_submission(my_sub) if my_sub else None,
        }

    @router.post("/validator/missions/{campaign_id}/submit")
    async def submit_feedback(
        campaign_id: str,
        payload: SubmissionCreate,
        user = Depends(get_current_user),
    ):
        if not await _is_validator_enabled(db, user.user_id):
            raise HTTPException(403, "Validation Program opt-in required")
        camp = await db.validation_campaigns.find_one({"campaign_id": campaign_id}, {"_id": 0})
        if not camp:
            raise HTTPException(404, "Mission not found")
        if _campaign_status(camp) != "active":
            raise HTTPException(409, "Mission is closed or expired")

        # one submission per validator per campaign (v1 simplicity)
        existing = await db.validation_submissions.find_one(
            {"campaign_id": campaign_id, "validator_id": user.user_id}, {"_id": 0, "submission_id": 1}
        )
        if existing:
            raise HTTPException(409, "You already submitted feedback for this mission")

        # capacity check
        distinct_validators = await db.validation_submissions.distinct(
            "validator_id", {"campaign_id": campaign_id}
        )
        if len(distinct_validators) >= camp.get("max_validators", 3):
            raise HTTPException(409, "Mission is full")

        # ensure profile exists
        await _get_or_create_profile(db, user.user_id)

        # cap screenshot payload at 1.5MB base64 to avoid Mongo bloat
        screenshot = payload.screenshot_b64
        if screenshot and len(screenshot) > 1_500_000:
            raise HTTPException(413, "Screenshot too large (max ~1.5MB encoded)")

        now = datetime.now(timezone.utc)
        sub = {
            "submission_id": f"sub_{uuid.uuid4().hex[:12]}",
            "campaign_id": campaign_id,
            "project_id": camp["project_id"],
            "validator_id": user.user_id,
            "validator_name": (user.name or user.email or "Validator")[:60],
            "kind": payload.kind,
            "category": (payload.category or "")[:60] if payload.category else None,
            "comment": payload.comment,
            "screenshot_b64": screenshot,
            "platform_hint": payload.platform_hint,
            "admin_verdict": "pending",
            "credits_awarded": 0,
            "created_at": now.isoformat(),
        }
        await db.validation_submissions.insert_one(sub.copy())
        logger.info(f"VALIDATION SUB: camp={campaign_id} validator={user.user_id} kind={payload.kind}")
        return _serialize_submission(sub)

    app.include_router(router)
