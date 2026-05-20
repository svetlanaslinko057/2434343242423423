"""WayForPay payment provider — Phase 4.

Hosted Purchase flow (https://secure.wayforpay.com/pay) with HMAC_MD5
merchantSignature. Service-to-service callback at /api/payments/wayforpay/callback.

Signature concat (`;`-joined):
  Purchase  : merchantAccount;merchantDomainName;orderReference;orderDate;
              amount;currency;productName[0..n];productCount[0..n];productPrice[0..n]
  Callback  : merchantAccount;orderReference;amount;currency;authCode;
              cardPan;transactionStatus;reasonCode
  Response  : orderReference;status;time   (status MUST be "accept")
"""
import hashlib
import hmac
import logging
import os
import time
import httpx
from typing import Optional, List

from .base import BasePaymentProvider, PaymentResult, CallbackResult

logger = logging.getLogger(__name__)


def _hmac_md5(data: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), data.encode("utf-8"), hashlib.md5).hexdigest()


class WayForPayProvider(BasePaymentProvider):
    name = "wayforpay"
    PAY_URL = "https://secure.wayforpay.com/pay"
    API_URL = "https://api.wayforpay.com/api"

    def __init__(self) -> None:
        self.merchant_account = os.getenv("WAYFORPAY_MERCHANT_ACCOUNT", "")
        self.secret_key = os.getenv("WAYFORPAY_SECRET_KEY", "")
        self.domain = os.getenv("WAYFORPAY_DOMAIN", "")
        self.currency = os.getenv("WAYFORPAY_CURRENCY", "UAH")
        self.service_url = os.getenv("WAYFORPAY_SERVICE_URL", "")
        self.return_url_default = os.getenv("WAYFORPAY_RETURN_URL", "")

    # ------------- Purchase signature -------------

    def _purchase_signature(
        self,
        order_reference: str,
        order_date: int,
        amount: str,
        currency: str,
        product_names: List[str],
        product_counts: List[str],
        product_prices: List[str],
    ) -> str:
        parts = [
            self.merchant_account,
            self.domain,
            order_reference,
            str(order_date),
            str(amount),
            currency,
            *product_names,
            *product_counts,
            *product_prices,
        ]
        return _hmac_md5(";".join(parts), self.secret_key)

    # ------------- Callback verify -------------

    def _callback_signature(
        self,
        merchant_account: str,
        order_reference: str,
        amount: str,
        currency: str,
        auth_code: str,
        card_pan: str,
        transaction_status: str,
        reason_code: str,
    ) -> str:
        return _hmac_md5(
            ";".join([
                merchant_account, order_reference, str(amount), currency,
                auth_code or "", card_pan or "",
                transaction_status or "", str(reason_code or ""),
            ]),
            self.secret_key,
        )

    def _response_signature(self, order_reference: str, status: str, t: int) -> str:
        return _hmac_md5(f"{order_reference};{status};{t}", self.secret_key)

    # ------------- API -------------

    async def create_payment(self, invoice: dict, return_url: Optional[str] = None) -> PaymentResult:
        amount = f"{float(invoice.get('amount') or 0):.2f}"
        currency = invoice.get("currency") or self.currency
        order_reference = invoice.get("provider_order_id") or invoice.get("invoice_id") or f"inv_{int(time.time())}"
        order_date = int(time.time())
        product_name = invoice.get("title") or "Initial payment"
        product_names = [product_name]
        product_counts = ["1"]
        product_prices = [amount]

        signature = self._purchase_signature(
            order_reference, order_date, amount, currency,
            product_names, product_counts, product_prices,
        )

        # Use CREATE_INVOICE API → returns hosted invoiceUrl. Easier than
        # building HTML form ourselves; works for both web and mobile.
        payload = {
            "transactionType": "CREATE_INVOICE",
            "merchantAccount": self.merchant_account,
            "merchantAuthType": "SimpleSignature",
            "merchantDomainName": self.domain,
            "merchantSignature": signature,
            "apiVersion": 1,
            "language": "EN",
            "serviceUrl": self.service_url,
            "orderReference": order_reference,
            "orderDate": order_date,
            "amount": amount,
            "currency": currency,
            "productName": product_names,
            "productCount": [int(x) for x in product_counts],
            "productPrice": [float(x) for x in product_prices],
            "returnUrl": return_url or self.return_url_default,
        }
        client_email = invoice.get("client_email")
        if client_email:
            payload["clientEmail"] = client_email

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(self.API_URL, json=payload)
            data = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        except Exception as e:
            logger.exception("WayForPay create_payment error")
            return PaymentResult(success=False, error=str(e))

        url = data.get("invoiceUrl") or data.get("url")
        if not url:
            return PaymentResult(
                success=False,
                error=data.get("reason") or f"WayForPay rejected: {data}",
                raw=data,
            )

        return PaymentResult(
            success=True,
            payment_url=url,
            provider_order_id=order_reference,
            raw=data,
        )

    async def verify_callback(self, payload: dict) -> CallbackResult:
        try:
            received_sig = payload.get("merchantSignature") or ""
            calc = self._callback_signature(
                payload.get("merchantAccount", ""),
                payload.get("orderReference", ""),
                payload.get("amount", ""),
                payload.get("currency", ""),
                payload.get("authCode", ""),
                payload.get("cardPan", ""),
                payload.get("transactionStatus", ""),
                payload.get("reasonCode", ""),
            )
            valid = hmac.compare_digest(calc, received_sig)

            tx_status = (payload.get("transactionStatus") or "").lower()
            mapped = {
                "approved":  "paid",
                "refunded":  "refunded",
                "voided":    "failed",
                "declined":  "failed",
                "expired":   "failed",
                "pending":   "pending",
                "inprocessing": "pending",
            }.get(tx_status, "unknown")

            t = int(time.time())
            order_ref = payload.get("orderReference", "")
            response_body = {
                "orderReference": order_ref,
                "status": "accept",
                "time": t,
                "signature": self._response_signature(order_ref, "accept", t),
            }

            return CallbackResult(
                valid=valid,
                provider_order_id=order_ref,
                status=mapped,
                amount=float(payload.get("amount") or 0),
                currency=payload.get("currency"),
                raw=payload,
                response_body=response_body,
                error=None if valid else "signature_mismatch",
            )
        except Exception as e:
            logger.exception("WayForPay verify_callback error")
            return CallbackResult(valid=False, error=str(e), raw=payload)
