"""
Legal Contract Signing — Phase 1 (core backend).

Scope (per product spec, Phase 1):
  1. Legal profile collected ONLY when user signs their first contract.
  2. Contract becomes an immutable snapshot at the moment of signing:
       - contract_version
       - html_snapshot
       - project_snapshot
       - legal_profile_snapshot
       - sha256_hash
       - signed_at / ip / user_agent / otp_verified
  3. Click-wrap + email OTP (reuses existing auth_otp email pipeline,
     mocked via Resend in dev — code shows up in backend.err.log).
  4. Full audit trail in `contract_signatures`.
  5. Contract-status gate:
       estimate_approved → agreement_required → legal_profile_completed
       → otp_verified_signature → agreement_signed → payment_unlocked
       → project_starts_after_payment

Phase 2 (NOT here): PDF generation (with HTML fallback), mobile+web
signing UI, Documents screen, payment gate wiring, production template.

Models / Collections
--------------------
client_legal_profiles : { user_id, full_name, tax_id, registered_address,
                          country, phone, created_at, updated_at }
contract_templates    : { version, status, body_html, created_at } — the
                        versioned English placeholder. Marked
                        `placeholder_pending_legal_review`.
contracts             : { contract_id, user_id, project_id, estimate_id?,
                          state, template_version, price, payment_plan,
                          modules, timeline, created_at,
                          signed_at?, html_snapshot?, project_snapshot?,
                          legal_profile_snapshot?, sha256_hash?,
                          pdf_status, pdf_bytes? (base64) }
contract_signatures   : per-sign audit record (immutable).
contract_otp_codes    : { contract_id, user_id, code_hash, expires_at,
                          attempts, consumed_at? } — short-lived.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("legal_contract")

# ---------------------------------------------------------------------------
# Wiring — set by init_router() from server.py
# ---------------------------------------------------------------------------

_db = None
_get_current_user = None
_send_otp_email = None  # async (email, code, ttl_minutes) -> msg_id | None
_email_is_configured = None  # () -> bool

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

TEMPLATE_VERSION = "v1.0-placeholder"
TEMPLATE_STATUS = "placeholder_pending_legal_review"

OTP_TTL_SECONDS = 10 * 60
OTP_RESEND_COOLDOWN_SECONDS = 30
OTP_MAX_ATTEMPTS = 5

# DEV: if Resend not configured, surface OTP code in response so client
# can sign without a real inbox. Same pattern as auth_otp.
def _dev_mode() -> bool:
    try:
        return not bool(_email_is_configured and _email_is_configured())
    except Exception:
        return True


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _client_ip(request: Request) -> str:
    # Respect proxy header when present (kubernetes ingress).
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return (request.client.host if request.client else "") or ""


def _client_ua(request: Request) -> str:
    return request.headers.get("user-agent", "") or ""


# ---------------------------------------------------------------------------
# Contract template (English placeholder — Phase 1)
# ---------------------------------------------------------------------------


DEFAULT_TEMPLATE_HTML = """
<section class="contract">
<h1>Software Development Agreement</h1>
<p class="meta">Template version: {template_version} — {template_status}</p>

<h2>1. Parties</h2>
<p>
  This agreement (the "<b>Agreement</b>") is made between
  <b>{client_name}</b> (the "<b>Client</b>"),
  identified by tax ID <b>{client_tax_id}</b>, registered at
  <b>{client_address}</b>, and the platform operator (the "<b>Provider</b>"),
  operating the EVA-X / ATLAS DevOS product delivery system.
</p>

<h2>2. Project scope</h2>
<p>
  The Provider will deliver the project titled
  <b>"{project_title}"</b> as described in the attached scope snapshot.
  The scope consists of the following modules, which form a single
  integrated deliverable:
</p>
{modules_html}

<h2>3. Timeline</h2>
<p>
  Estimated timeline: <b>{timeline}</b>. Timeline starts after the
  initial payment is received and is subject to change requests handled
  under Section 7.
</p>

<h2>4. Price and payment schedule</h2>
<p>Total project price: <b>{price}</b>.</p>
{payment_plan_html}

<h2>5. Start condition</h2>
<p>
  The Provider begins work only after (a) this Agreement is signed
  electronically by the Client, and (b) the initial payment listed in
  Section 4 has been received.
</p>

<h2>6. Delivery and review</h2>
<p>
  Each module is delivered to the Client's workspace with an acceptance
  window. If no review is submitted within the acceptance window, the
  module is considered accepted.
</p>

<h2>7. Change requests</h2>
<p>
  Changes that are outside of the scope snapshot are handled as
  change requests. Each change request is priced and scheduled
  separately and requires the Client's written approval before work
  begins on it.
</p>

<h2>8. Intellectual property</h2>
<p>
  On full payment, all project-specific deliverables (code, design
  assets, configuration) produced under this Agreement transfer to the
  Client. Pre-existing components (platform code, internal libraries)
  remain the property of the Provider and are licensed to the Client
  for use inside the delivered product.
</p>

<h2>9. Cancellation and refund</h2>
<p>
  Either party may terminate this Agreement in writing. Work completed
  up to the termination date is invoiced at actual cost. Unused portions
  of pre-paid milestones are refunded within 30 days.
</p>

<h2>10. Electronic acceptance</h2>
<p>
  This Agreement is signed electronically in accordance with applicable
  electronic signature laws. The Client confirms identity by completing
  the click-wrap acceptance flow and by entering a one-time code
  delivered to the registered email address. The captured evidence
  package (Section 11) serves as proof of signature.
</p>

<h2>11. Evidence package</h2>
<p>
  At the moment of signing, the following items are stored as immutable
  evidence of the Client's acceptance:
</p>
<ul>
  <li>Full HTML snapshot of this Agreement</li>
  <li>Snapshot of the project scope, price and payment schedule</li>
  <li>Snapshot of the Client's legal profile</li>
  <li>SHA-256 hash of the combined snapshot</li>
  <li>Signing timestamp, IP address, user-agent string</li>
  <li>Confirmation of the one-time code used to verify identity</li>
  <li>Template version and acceptance copy version</li>
</ul>

<h2>12. Governing law</h2>
<p class="placeholder">
  [Placeholder — to be set by legal review. Default: laws of the Client's
  country of registration, with disputes resolved in good faith
  negotiation prior to any formal action.]
</p>

<h2>13. Acknowledgements</h2>
<ul>
  <li>I confirm my legal details are correct.</li>
  <li>I agree to the project scope, payment schedule and terms.</li>
  <li>I understand development starts after initial payment.</li>
</ul>
</section>
""".strip()


def _render_template(
    *,
    client_name: str,
    client_tax_id: str,
    client_address: str,
    project_title: str,
    modules: List[Dict[str, Any]],
    timeline: str,
    price: str,
    payment_plan: List[Dict[str, Any]],
) -> str:
    modules_html = "<ul>" + "".join(
        f"<li><b>{(m.get('title') or m.get('name') or '').strip()}</b>"
        f"{' — ' + m.get('description') if m.get('description') else ''}</li>"
        for m in (modules or [])
    ) + "</ul>"
    if not modules:
        modules_html = "<p class='placeholder'>[Scope modules attached as snapshot]</p>"

    if payment_plan:
        payment_plan_html = "<ol>" + "".join(
            f"<li><b>{(p.get('label') or p.get('name') or 'Milestone').strip()}</b>: "
            f"{p.get('amount', '')} — {p.get('trigger', 'on agreed milestone')}</li>"
            for p in payment_plan
        ) + "</ol>"
    else:
        payment_plan_html = (
            "<p class='placeholder'>[Payment plan attached as snapshot]</p>"
        )

    return DEFAULT_TEMPLATE_HTML.format(
        template_version=TEMPLATE_VERSION,
        template_status=TEMPLATE_STATUS,
        client_name=client_name or "[Client]",
        client_tax_id=client_tax_id or "[Tax ID]",
        client_address=client_address or "[Registered address]",
        project_title=project_title or "[Project]",
        modules_html=modules_html,
        timeline=timeline or "[Timeline]",
        price=price or "[Price]",
        payment_plan_html=payment_plan_html,
    )


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------


class LegalProfileIn(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=200)
    tax_id: str = Field(..., min_length=3, max_length=32)
    registered_address: str = Field(..., min_length=3, max_length=400)
    country: str = Field(..., min_length=2, max_length=64)
    phone: Optional[str] = Field(default=None, max_length=40)


class PrepareContractIn(BaseModel):
    project_id: Optional[str] = None
    estimate_id: Optional[str] = None
    # For dev/demo — caller can pass inline fields when we don't have
    # a persisted project doc to pull from yet.
    project_title: Optional[str] = None
    price: Optional[str] = None
    timeline: Optional[str] = None
    modules: Optional[List[Dict[str, Any]]] = None
    payment_plan: Optional[List[Dict[str, Any]]] = None


class SignRequestIn(BaseModel):
    # The client may re-submit / update legal data right before signing.
    legal_profile: LegalProfileIn


class SignConfirmIn(BaseModel):
    legal_profile: LegalProfileIn
    acknowledgements: Dict[str, bool] = Field(default_factory=dict)
    # Required keys: legal_details_correct, scope_terms_agreed,
    # start_after_payment_understood
    otp_code: str = Field(..., min_length=4, max_length=10)
    terms_version: str = Field(default="v1.0")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


async def _get_or_null_legal_profile(user_id: str) -> Optional[Dict[str, Any]]:
    return await _db.client_legal_profiles.find_one({"user_id": user_id}, {"_id": 0})


async def _upsert_legal_profile(user_id: str, p: LegalProfileIn) -> Dict[str, Any]:
    now = _now_iso()
    existing = await _get_or_null_legal_profile(user_id)
    doc = {
        "user_id": user_id,
        "full_name": p.full_name.strip(),
        "tax_id": p.tax_id.strip(),
        "registered_address": p.registered_address.strip(),
        "country": p.country.strip(),
        "phone": (p.phone or "").strip() or None,
        "updated_at": now,
        "created_at": existing["created_at"] if existing else now,
    }
    await _db.client_legal_profiles.update_one(
        {"user_id": user_id},
        {"$set": doc},
        upsert=True,
    )
    return doc


def _contract_state_public(c: Dict[str, Any]) -> Dict[str, Any]:
    """Strip heavy / secret fields for list views."""
    return {
        "contract_id": c["contract_id"],
        "user_id": c["user_id"],
        "project_id": c.get("project_id"),
        "estimate_id": c.get("estimate_id"),
        "state": c["state"],
        "template_version": c["template_version"],
        "template_status": c.get("template_status"),
        "price": c.get("price"),
        "timeline": c.get("timeline"),
        "project_title": c.get("project_title"),
        "created_at": c["created_at"],
        "signed_at": c.get("signed_at"),
        "sha256_hash": c.get("sha256_hash"),
        "pdf_status": c.get("pdf_status", "not_generated"),
    }


async def _build_project_snapshot(
    user_id: str,
    body: PrepareContractIn,
) -> Dict[str, Any]:
    """Pull project/estimate data if we have it; otherwise fall back to
    whatever the caller passed inline. This keeps Phase 1 usable even
    before estimate layer is wired."""
    snapshot: Dict[str, Any] = {
        "project_id": body.project_id,
        "estimate_id": body.estimate_id,
        "project_title": body.project_title or "[Project]",
        "price": body.price or "[Price]",
        "timeline": body.timeline or "[Timeline]",
        "modules": body.modules or [],
        "payment_plan": body.payment_plan or [],
    }

    # If we have a project_id, try to load real data.
    if body.project_id:
        try:
            proj = await _db.projects.find_one(
                {"$or": [{"project_id": body.project_id}, {"id": body.project_id}]},
                {"_id": 0},
            )
            if proj:
                snapshot["project_title"] = (
                    proj.get("title") or proj.get("name") or snapshot["project_title"]
                )
                snapshot["price"] = (
                    proj.get("price")
                    or proj.get("total_cost")
                    or snapshot["price"]
                )
                snapshot["timeline"] = (
                    proj.get("timeline")
                    or proj.get("deadline")
                    or snapshot["timeline"]
                )
                if not snapshot["modules"]:
                    try:
                        mods = await _db.modules.find(
                            {"project_id": body.project_id}, {"_id": 0}
                        ).to_list(length=200)
                        snapshot["modules"] = mods or []
                    except Exception:  # noqa: BLE001
                        pass
                snapshot["_project_loaded"] = True
        except Exception as e:  # noqa: BLE001
            logger.warning(f"contract snapshot: project load failed: {e}")

    return snapshot


# ---------------------------------------------------------------------------
# OTP (contract-specific, independent from auth_otp)
# ---------------------------------------------------------------------------


def _gen_code() -> str:
    return f"{random.SystemRandom().randint(0, 999_999):06d}"


def _code_hash(code: str, contract_id: str) -> str:
    # Namespaced HMAC so a leaked auth_otp hash can't be replayed here.
    key = os.environ.get("CONTRACT_OTP_SECRET", "atlas-contract-otp-dev-secret").encode()
    return hmac.new(key, f"{contract_id}:{code}".encode(), hashlib.sha256).hexdigest()


async def _issue_contract_otp(contract_id: str, user_id: str, email: str) -> Dict[str, Any]:
    now = _now()
    # Cooldown
    latest = await _db.contract_otp_codes.find_one(
        {"contract_id": contract_id, "user_id": user_id, "consumed_at": None},
        sort=[("created_at", -1)],
    )
    if latest:
        try:
            created = datetime.fromisoformat(latest["created_at"])
        except Exception:  # noqa: BLE001
            created = now
        age = (now - created).total_seconds()
        if age < OTP_RESEND_COOLDOWN_SECONDS:
            raise HTTPException(
                status_code=429,
                detail=f"Please wait {int(OTP_RESEND_COOLDOWN_SECONDS - age)}s before requesting a new code.",
            )

    code = _gen_code()
    doc = {
        "otp_id": f"cotp_{uuid.uuid4().hex[:12]}",
        "contract_id": contract_id,
        "user_id": user_id,
        "email": email,
        "code_hash": _code_hash(code, contract_id),
        "attempts": 0,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=OTP_TTL_SECONDS)).isoformat(),
        "consumed_at": None,
    }
    await _db.contract_otp_codes.insert_one(doc)

    # Deliver. Fall back to DEV surfacing when Resend not configured.
    delivered = False
    msg_id: Optional[str] = None
    dev_mode = _dev_mode()
    if not dev_mode and _send_otp_email:
        try:
            msg_id = await _send_otp_email(email, code, ttl_minutes=OTP_TTL_SECONDS // 60)
            delivered = True
        except Exception as e:  # noqa: BLE001
            logger.warning(f"contract OTP email failed, falling back to dev: {e}")
            dev_mode = True

    result = {
        "otp_id": doc["otp_id"],
        "expires_at": doc["expires_at"],
        "channel": "email",
        "dev_mode": dev_mode,
        "delivered": delivered,
        "message_id": msg_id,
    }
    if dev_mode:
        # Same pattern as auth_otp — log it too so we can find it after.
        logger.info(
            f"CONTRACT OTP (DEV): contract={contract_id} code={code} → {email}"
        )
        result["dev_code"] = code
    return result


async def _consume_contract_otp(contract_id: str, user_id: str, code: str) -> bool:
    now = _now()
    # Latest active code
    rec = await _db.contract_otp_codes.find_one(
        {"contract_id": contract_id, "user_id": user_id, "consumed_at": None},
        sort=[("created_at", -1)],
    )
    if not rec:
        raise HTTPException(status_code=400, detail="No active verification code. Request a new one.")

    try:
        expires = datetime.fromisoformat(rec["expires_at"])
    except Exception:  # noqa: BLE001
        expires = now - timedelta(seconds=1)
    if expires < now:
        raise HTTPException(status_code=400, detail="Verification code expired. Request a new one.")

    attempts = int(rec.get("attempts", 0))
    if attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new code.")

    expected = rec["code_hash"]
    got = _code_hash(code.strip(), contract_id)
    if not hmac.compare_digest(expected, got):
        await _db.contract_otp_codes.update_one(
            {"otp_id": rec["otp_id"]},
            {"$inc": {"attempts": 1}},
        )
        raise HTTPException(status_code=400, detail="Incorrect code.")

    await _db.contract_otp_codes.update_one(
        {"otp_id": rec["otp_id"]},
        {"$set": {"consumed_at": now.isoformat()}},
    )
    return True


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def init_router(
    *,
    db,
    get_current_user,
    send_otp_email,
    email_is_configured,
) -> APIRouter:
    global _db, _get_current_user, _send_otp_email, _email_is_configured
    _db = db
    _get_current_user = get_current_user
    _send_otp_email = send_otp_email
    _email_is_configured = email_is_configured

    router = APIRouter(prefix="/api", tags=["legal-contract"])

    # ------- Legal profile -------

    @router.get("/legal/profile")
    async def get_profile(user=Depends(_get_current_user)):
        prof = await _get_or_null_legal_profile(user.user_id)
        return {"profile": prof, "exists": bool(prof)}

    @router.put("/legal/profile")
    async def upsert_profile(
        payload: LegalProfileIn,
        user=Depends(_get_current_user),
    ):
        saved = await _upsert_legal_profile(user.user_id, payload)
        return {"profile": saved, "saved": True}

    # ------- Contracts -------

    @router.post("/contracts/prepare")
    async def prepare_contract(
        body: PrepareContractIn,
        user=Depends(_get_current_user),
    ):
        """Create a DRAFT contract for the current user + project.

        Idempotent per (user, project_id, state='draft'): if a draft already
        exists for the same project we return it instead of stacking drafts.
        """
        now = _now_iso()
        user_id = user.user_id

        if body.project_id:
            existing = await _db.contracts.find_one(
                {
                    "user_id": user_id,
                    "project_id": body.project_id,
                    "state": {"$in": ["draft", "awaiting_signature"]},
                },
                {"_id": 0},
            )
            if existing:
                return {
                    "contract": _contract_state_public(existing),
                    "html": existing.get("rendered_html"),
                }

        snap = await _build_project_snapshot(user_id, body)
        profile = await _get_or_null_legal_profile(user_id) or {}

        rendered_html = _render_template(
            client_name=profile.get("full_name", "[Client]"),
            client_tax_id=profile.get("tax_id", "[Tax ID]"),
            client_address=profile.get("registered_address", "[Registered address]"),
            project_title=snap["project_title"],
            modules=snap["modules"],
            timeline=snap["timeline"],
            price=snap["price"],
            payment_plan=snap["payment_plan"],
        )

        contract_id = f"ctr_{uuid.uuid4().hex[:12]}"
        doc = {
            "contract_id": contract_id,
            "user_id": user_id,
            "project_id": body.project_id,
            "estimate_id": body.estimate_id,
            "state": "draft",
            "template_version": TEMPLATE_VERSION,
            "template_status": TEMPLATE_STATUS,
            "project_title": snap["project_title"],
            "price": snap["price"],
            "timeline": snap["timeline"],
            "modules": snap["modules"],
            "payment_plan": snap["payment_plan"],
            "rendered_html": rendered_html,
            "created_at": now,
            "pdf_status": "not_generated",
        }
        await _db.contracts.insert_one(doc)
        doc.pop("_id", None)
        return {"contract": _contract_state_public(doc), "html": rendered_html}

    @router.get("/contracts/my")
    async def my_contracts(user=Depends(_get_current_user)):
        cur = _db.contracts.find({"user_id": user.user_id}, {"_id": 0}).sort(
            "created_at", -1
        )
        items = [await _c_public_async(c) async for c in cur]
        return {"items": items, "count": len(items)}

    @router.get("/contracts/{contract_id}")
    async def get_contract(contract_id: str, user=Depends(_get_current_user)):
        c = await _db.contracts.find_one(
            {"contract_id": contract_id, "user_id": user.user_id}, {"_id": 0}
        )
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        # Post-sign reads return the immutable snapshot HTML, not the
        # live-rendered draft.
        html = c.get("html_snapshot") or c.get("rendered_html")
        return {
            "contract": _contract_state_public(c),
            "html": html,
            "is_signed": c["state"] == "signed",
        }

    @router.get("/contracts/{contract_id}/html", response_class=HTMLResponse)
    async def get_contract_html(contract_id: str, user=Depends(_get_current_user)):
        c = await _db.contracts.find_one(
            {"contract_id": contract_id, "user_id": user.user_id}, {"_id": 0}
        )
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        html = c.get("html_snapshot") or c.get("rendered_html") or ""
        return HTMLResponse(content=html)

    # ------- Signing -------

    @router.post("/contracts/{contract_id}/sign/request-otp")
    async def request_otp(
        contract_id: str,
        body: SignRequestIn,
        user=Depends(_get_current_user),
    ):
        c = await _db.contracts.find_one(
            {"contract_id": contract_id, "user_id": user.user_id}, {"_id": 0}
        )
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        if c["state"] == "signed":
            raise HTTPException(status_code=409, detail="Contract is already signed")

        # Persist legal profile (this is the "only at signing" collection point).
        await _upsert_legal_profile(user.user_id, body.legal_profile)

        # Regenerate rendered_html with the updated legal profile so the
        # client sees the real values on the contract viewer before signing.
        profile = await _get_or_null_legal_profile(user.user_id) or {}
        rendered_html = _render_template(
            client_name=profile.get("full_name", "[Client]"),
            client_tax_id=profile.get("tax_id", "[Tax ID]"),
            client_address=profile.get("registered_address", "[Registered address]"),
            project_title=c.get("project_title", "[Project]"),
            modules=c.get("modules", []),
            timeline=c.get("timeline", "[Timeline]"),
            price=c.get("price", "[Price]"),
            payment_plan=c.get("payment_plan", []),
        )
        await _db.contracts.update_one(
            {"contract_id": contract_id},
            {"$set": {"rendered_html": rendered_html, "state": "awaiting_signature"}},
        )

        email = user.email or ""
        if not email:
            raise HTTPException(status_code=400, detail="Account has no email; cannot issue OTP.")

        otp = await _issue_contract_otp(contract_id, user.user_id, email)
        return {
            "ok": True,
            "otp": otp,
            "contract_state": "awaiting_signature",
        }

    @router.post("/contracts/{contract_id}/sign/confirm")
    async def confirm_signature(
        contract_id: str,
        body: SignConfirmIn,
        request: Request,
        user=Depends(_get_current_user),
    ):
        c = await _db.contracts.find_one(
            {"contract_id": contract_id, "user_id": user.user_id}, {"_id": 0}
        )
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        if c["state"] == "signed":
            raise HTTPException(status_code=409, detail="Contract is already signed")

        # Enforce all 3 acknowledgements — "evidence package, not a checkbox".
        req_keys = (
            "legal_details_correct",
            "scope_terms_agreed",
            "start_after_payment_understood",
        )
        missing = [k for k in req_keys if not body.acknowledgements.get(k)]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Missing acknowledgements: {', '.join(missing)}",
            )

        # Upsert the legal profile one more time so the snapshot captures the
        # exact values the user saw in the signing UI.
        legal_profile = await _upsert_legal_profile(user.user_id, body.legal_profile)

        # OTP.
        await _consume_contract_otp(contract_id, user.user_id, body.otp_code)

        # Build final snapshot.
        final_html = _render_template(
            client_name=legal_profile["full_name"],
            client_tax_id=legal_profile["tax_id"],
            client_address=legal_profile["registered_address"],
            project_title=c.get("project_title", "[Project]"),
            modules=c.get("modules", []),
            timeline=c.get("timeline", "[Timeline]"),
            price=c.get("price", "[Price]"),
            payment_plan=c.get("payment_plan", []),
        )

        project_snapshot = {
            "project_id": c.get("project_id"),
            "estimate_id": c.get("estimate_id"),
            "project_title": c.get("project_title"),
            "price": c.get("price"),
            "timeline": c.get("timeline"),
            "modules": c.get("modules", []),
            "payment_plan": c.get("payment_plan", []),
        }
        legal_profile_snapshot = {
            k: v for k, v in legal_profile.items() if not k.startswith("_")
        }
        signed_at = _now_iso()
        composite = json.dumps(
            {
                "contract_id": c["contract_id"],
                "user_id": c["user_id"],
                "template_version": c["template_version"],
                "terms_version": body.terms_version,
                "project_snapshot": project_snapshot,
                "legal_profile_snapshot": legal_profile_snapshot,
                "html_snapshot": final_html,
                "signed_at": signed_at,
            },
            sort_keys=True,
            ensure_ascii=False,
        )
        sha = _sha256_hex(composite)

        ip = _client_ip(request)
        ua = _client_ua(request)

        # ---- PDF generation (optional, never blocks) ----
        pdf_status = "skipped"
        pdf_b64 = None
        try:
            pdf_b64 = await _try_render_pdf(final_html)
            pdf_status = "generated" if pdf_b64 else "skipped"
        except Exception as e:  # noqa: BLE001
            logger.warning(f"PDF generation failed, HTML fallback kept: {e}")
            pdf_status = "failed"

        # ---- Persist contract as immutable ----
        await _db.contracts.update_one(
            {"contract_id": contract_id},
            {
                "$set": {
                    "state": "signed",
                    "signed_at": signed_at,
                    "html_snapshot": final_html,
                    "project_snapshot": project_snapshot,
                    "legal_profile_snapshot": legal_profile_snapshot,
                    "terms_version": body.terms_version,
                    "sha256_hash": sha,
                    "pdf_status": pdf_status,
                    "pdf_b64": pdf_b64,
                    "signer": {
                        "ip": ip,
                        "user_agent": ua,
                        "email": user.email,
                        "user_id": user.user_id,
                    },
                }
            },
        )

        # ---- Audit trail row ----
        signature_id = f"sig_{uuid.uuid4().hex[:12]}"
        await _db.contract_signatures.insert_one(
            {
                "signature_id": signature_id,
                "contract_id": contract_id,
                "user_id": user.user_id,
                "accepted": True,
                "full_name": legal_profile["full_name"],
                "tax_id": legal_profile["tax_id"],
                "registered_address": legal_profile["registered_address"],
                "country": legal_profile["country"],
                "phone": legal_profile.get("phone"),
                "ip": ip,
                "user_agent": ua,
                "otp_verified": True,
                "otp_channel": "email",
                "signed_at": signed_at,
                "contract_hash": sha,
                "terms_version": body.terms_version,
                "template_version": c["template_version"],
                "signature_method": "clickwrap_otp",
                "acknowledgements": {k: bool(v) for k, v in body.acknowledgements.items()},
            }
        )

        signed = await _db.contracts.find_one({"contract_id": contract_id}, {"_id": 0})
        return {
            "ok": True,
            "contract": _contract_state_public(signed),
            "evidence": {
                "signature_id": signature_id,
                "sha256_hash": sha,
                "signed_at": signed_at,
                "otp_verified": True,
                "pdf_status": pdf_status,
            },
        }

    @router.get("/contracts/{contract_id}/evidence")
    async def get_evidence(contract_id: str, user=Depends(_get_current_user)):
        c = await _db.contracts.find_one(
            {"contract_id": contract_id, "user_id": user.user_id}, {"_id": 0}
        )
        if not c:
            raise HTTPException(status_code=404, detail="Contract not found")
        if c["state"] != "signed":
            raise HTTPException(status_code=400, detail="Contract is not signed yet")
        sig = await _db.contract_signatures.find_one(
            {"contract_id": contract_id}, {"_id": 0}, sort=[("signed_at", -1)]
        )
        return {
            "contract": _contract_state_public(c),
            "signature": sig,
            "project_snapshot": c.get("project_snapshot"),
            "legal_profile_snapshot": c.get("legal_profile_snapshot"),
            "terms_version": c.get("terms_version"),
            "template_version": c.get("template_version"),
            "sha256_hash": c.get("sha256_hash"),
            "pdf_status": c.get("pdf_status", "not_generated"),
        }

    # ------- Gate -------

    @router.get("/contracts/gate/{project_id}")
    async def contract_gate(project_id: str, user=Depends(_get_current_user)):
        """Resolve whether a project's contract blocks payment / start.

        Returned states:
          - contract_required       : no contract yet, client must prepare + sign
          - legal_profile_required  : contract exists but client has no legal profile
          - awaiting_signature      : contract prepared, OTP pending or verified
          - signed_payment_unlocked : contract fully signed, payment unlocked
        """
        c = await _db.contracts.find_one(
            {"user_id": user.user_id, "project_id": project_id},
            {"_id": 0},
            sort=[("created_at", -1)],
        )
        prof = await _get_or_null_legal_profile(user.user_id)

        if not c:
            return {
                "state": "contract_required",
                "contract_id": None,
                "has_legal_profile": bool(prof),
                "payment_unlocked": False,
            }
        if c["state"] == "signed":
            return {
                "state": "signed_payment_unlocked",
                "contract_id": c["contract_id"],
                "has_legal_profile": True,
                "payment_unlocked": True,
            }
        if not prof:
            return {
                "state": "legal_profile_required",
                "contract_id": c["contract_id"],
                "has_legal_profile": False,
                "payment_unlocked": False,
            }
        return {
            "state": "awaiting_signature",
            "contract_id": c["contract_id"],
            "has_legal_profile": True,
            "payment_unlocked": False,
        }

    return router


# ---------------------------------------------------------------------------
# PDF generation (best-effort, never blocks signing)
# ---------------------------------------------------------------------------


async def _try_render_pdf(html: str) -> Optional[str]:
    """
    Best-effort PDF rendering. Returns base64-encoded PDF bytes or None.

    Strategy (Phase 1, hard rule: never block signing):
      1. Try weasyprint if present in the environment.
      2. If not installed or rendering throws → return None, caller records
         pdf_status='failed' and keeps html_snapshot + sha256 as source of
         truth.

    We intentionally do NOT install weasyprint in requirements.txt here —
    on some base images it needs system deps (pango/cairo) which would
    break deploy. The Phase 2 task will decide whether to pull it in, or
    swap to a lighter HTML-to-PDF path.
    """
    try:
        import asyncio
        import base64
        try:
            from weasyprint import HTML  # type: ignore
        except Exception:  # noqa: BLE001
            return None

        def _render() -> bytes:
            wrapped = (
                "<html><head><meta charset='utf-8'>"
                "<style>body{font-family: -apple-system, system-ui, sans-serif;"
                "line-height:1.55; color:#0F172A; padding:32px 40px; max-width:780px;}"
                "h1{font-size:22px;} h2{font-size:15px;margin-top:22px;}"
                "p,li{font-size:12px;} .placeholder{color:#94A3B8;font-style:italic;}"
                "</style></head><body>" + html + "</body></html>"
            )
            return HTML(string=wrapped).write_pdf()

        pdf_bytes = await asyncio.to_thread(_render)
        return base64.b64encode(pdf_bytes).decode("ascii")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"weasyprint render failed: {e}")
        return None


# Small helper for async generator -> list with public projection.
async def _c_public_async(c: Dict[str, Any]) -> Dict[str, Any]:
    return _contract_state_public(c)
