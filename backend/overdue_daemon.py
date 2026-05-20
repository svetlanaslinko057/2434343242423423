#!/usr/bin/env python3
"""
OVERDUE ENGINE DAEMON
Runs continuously, checking every 15 minutes
"""
import time
import sys
import os

# Add parent directory to path
sys.path.insert(0, '/app/ATLAS')

from overdue_engine import check_overdue_invoices, logger

INTERVAL_SECONDS = 15 * 60  # 15 minutes

logger.info("🚀 Overdue Engine Daemon starting...")
logger.info(f"   Check interval: {INTERVAL_SECONDS}s (15 min)")

while True:
    try:
        logger.info("🔄 Running overdue check...")
        result = check_overdue_invoices()
        logger.info(f"✅ Check complete: {result}")
        
    except Exception as e:
        logger.error(f"❌ Error in overdue check: {e}")
    
    # Wait for next interval
    logger.info(f"⏰ Sleeping for {INTERVAL_SECONDS}s...")
    time.sleep(INTERVAL_SECONDS)
