#!/usr/bin/env python3
"""
AUTO-INVOICE OVERDUE ENGINE
Runs every 15 minutes to check overdue invoices and pause contracts
"""
from pymongo import MongoClient
import os
from datetime import datetime, timezone
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# MongoDB connection
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

client = MongoClient(MONGO_URL)
db = client[DB_NAME]


def pause_contract_on_overdue(contract_id):
    """Pause contract due to overdue invoice"""
    contract = db.contracts.find_one({"contract_id": contract_id})
    if not contract:
        return
    
    if not contract.get("billing_rules", {}).get("pause_on_overdue"):
        return
    
    # Update contract
    db.contracts.update_one(
        {"contract_id": contract_id},
        {
            "$set": {
                "status": "paused",
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )
    
    # Update project
    db.projects.update_one(
        {"project_id": contract["project_id"]},
        {
            "$set": {
                "contract_status": "paused",
                "status": "payment_blocked"
            }
        }
    )
    
    logger.warning(f"Contract paused: {contract_id}")


def check_overdue_invoices():
    """
    Core overdue engine
    """
    now = datetime.now(timezone.utc)
    
    # Find all pending invoices with due_date
    invoices = list(db.invoices.find({
        "status": "pending",
        "due_date": {"$exists": True}
    }))
    
    overdue_count = 0
    paused_count = 0
    
    for invoice in invoices:
        due_date = datetime.fromisoformat(invoice["due_date"])
        
        if now > due_date:
            # Calculate days overdue
            days_overdue = (now - due_date).days
            
            # Update invoice status
            db.invoices.update_one(
                {"invoice_id": invoice["invoice_id"]},
                {
                    "$set": {
                        "status": "overdue",
                        "days_overdue": days_overdue,
                        "updated_at": now.isoformat()
                    }
                }
            )
            
            overdue_count += 1
            logger.warning(f"Invoice overdue: {invoice['invoice_id']} - {days_overdue} days")
            
            # HARD STOP: Pause contract if > 7 days overdue
            if days_overdue > 7:
                contract_id = invoice.get("contract_id")
                if contract_id:
                    contract = db.contracts.find_one({"contract_id": contract_id})
                    
                    if contract and contract["status"] == "active":
                        # Pause contract
                        pause_contract_on_overdue(contract_id)
                        paused_count += 1
                        logger.error(f"🔴 CONTRACT PAUSED: {contract_id} (invoice {invoice['invoice_id']}, {days_overdue}d overdue)")
    
    logger.info(f"✅ Overdue check complete: {overdue_count} overdue, {paused_count} paused")
    
    return {
        "overdue_count": overdue_count,
        "paused_count": paused_count
    }


if __name__ == "__main__":
    logger.info("🔄 Starting overdue invoice check...")
    result = check_overdue_invoices()
    logger.info(f"📊 Results: {result}")
    client.close()
