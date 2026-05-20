"""
Initialize Earnings Engine Collections and Indexes

Run once to set up MongoDB collections for Step 3
"""

import asyncio
import os
import sys
from motor.motor_asyncio import AsyncIOMotorClient

async def initialize_earnings_collections():
    """
    Create collections and indexes for earnings engine
    """
    # Connect to MongoDB
    mongo_url = os.environ.get('MONGO_URL')
    if not mongo_url:
        print("ERROR: MONGO_URL not found in environment")
        sys.exit(1)
    
    client = AsyncIOMotorClient(mongo_url)
    db = client.devos_db
    
    print("="*60)
    print("INITIALIZING EARNINGS ENGINE COLLECTIONS")
    print("="*60)
    
    # ========== task_earnings collection ==========
    print("\n1. Creating task_earnings collection...")
    
    try:
        # Create collection if not exists
        collections = await db.list_collection_names()
        if "task_earnings" not in collections:
            await db.create_collection("task_earnings")
            print("  ✓ Collection created")
        else:
            print("  ✓ Collection already exists")
        
        # Create indexes
        print("  Creating indexes...")
        
        # Primary lookup by earning_id
        await db.task_earnings.create_index("earning_id", unique=True)
        print("    ✓ earning_id (unique)")
        
        # Lookup by task_id
        await db.task_earnings.create_index("task_id")
        print("    ✓ task_id")
        
        # Lookup by user_id (for developer earnings summary)
        await db.task_earnings.create_index("user_id")
        print("    ✓ user_id")
        
        # Lookup by project_id (for project dev cost)
        await db.task_earnings.create_index("project_id")
        print("    ✓ project_id")
        
        # Filter by earning_status
        await db.task_earnings.create_index("earning_status")
        print("    ✓ earning_status")
        
        # Filter by qa_status
        await db.task_earnings.create_index("qa_status")
        print("    ✓ qa_status")
        
        # Compound index for developer earnings queries
        await db.task_earnings.create_index([
            ("user_id", 1),
            ("earning_status", 1),
            ("created_at", -1)
        ])
        print("    ✓ user_id + earning_status + created_at (compound)")
        
        # Compound index for flagged/held earnings (admin view)
        await db.task_earnings.create_index([
            ("earning_status", 1),
            ("requires_manual_review", 1)
        ])
        print("    ✓ earning_status + requires_manual_review (compound)")
        
        # Index for payout batch queries
        await db.task_earnings.create_index("payout_batch_id")
        print("    ✓ payout_batch_id")
        
        print("  ✓ task_earnings indexes created")
    
    except Exception as e:
        print(f"  ✗ Error creating task_earnings: {e}")
        raise
    
    # ========== payout_batches collection ==========
    print("\n2. Creating payout_batches collection...")
    
    try:
        # Create collection if not exists
        if "payout_batches" not in collections:
            await db.create_collection("payout_batches")
            print("  ✓ Collection created")
        else:
            print("  ✓ Collection already exists")
        
        # Create indexes
        print("  Creating indexes...")
        
        # Primary lookup by batch_id
        await db.payout_batches.create_index("batch_id", unique=True)
        print("    ✓ batch_id (unique)")
        
        # Lookup by user_id
        await db.payout_batches.create_index("user_id")
        print("    ✓ user_id")
        
        # Filter by status
        await db.payout_batches.create_index("status")
        print("    ✓ status")
        
        # Compound index for developer batch queries
        await db.payout_batches.create_index([
            ("user_id", 1),
            ("status", 1),
            ("created_at", -1)
        ])
        print("    ✓ user_id + status + created_at (compound)")
        
        # Time-based queries
        await db.payout_batches.create_index("period_start")
        await db.payout_batches.create_index("period_end")
        print("    ✓ period_start, period_end")
        
        print("  ✓ payout_batches indexes created")
    
    except Exception as e:
        print(f"  ✗ Error creating payout_batches: {e}")
        raise
    
    # ========== Verify collections ==========
    print("\n3. Verifying collections...")
    
    collections = await db.list_collection_names()
    
    if "task_earnings" in collections:
        count = await db.task_earnings.count_documents({})
        print(f"  ✓ task_earnings: {count} documents")
    
    if "payout_batches" in collections:
        count = await db.payout_batches.count_documents({})
        print(f"  ✓ payout_batches: {count} documents")
    
    print("\n" + "="*60)
    print("✅ EARNINGS ENGINE COLLECTIONS INITIALIZED")
    print("="*60)
    
    client.close()

if __name__ == "__main__":
    asyncio.run(initialize_earnings_collections())
