"""
Initialize events collection and indexes
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

async def init_events_collection():
    """Create events collection with proper indexes"""
    mongo_url = os.environ['MONGO_URL']
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ['DB_NAME']]
    
    print("Initializing events collection...")
    
    # Create indexes
    indexes = [
        # Unique event_id
        ("event_id", 1, True),
        
        # Deduplication key (unique for open events)
        ("dedupe_key", 1, False),
        
        # Query by status
        ("status", 1, False),
        
        # Query by severity
        ("severity", 1, False),
        
        # Query by entity
        ("entity_type", 1, False),
        ("entity_id", 1, False),
        
        # Query by project
        ("project_id", 1, False),
        
        # Query by user
        ("user_id", 1, False),
        
        # Query by type
        ("type", 1, False),
        
        # Compound index for open events by severity
        ([("status", 1), ("severity", 1)], False),
        
        # Compound index for entity lookup
        ([("entity_type", 1), ("entity_id", 1), ("status", 1)], False),
        
        # Compound index for project events
        ([("project_id", 1), ("status", 1)], False),
        
        # Compound index for user events
        ([("user_id", 1), ("status", 1)], False),
        
        # Sort by created_at
        ("created_at", -1, False),
    ]
    
    for idx_spec in indexes:
        if isinstance(idx_spec[0], list):
            # Compound index
            fields = idx_spec[0]
            unique = idx_spec[1]
            await db.events.create_index(fields, unique=unique)
            print(f"✓ Created compound index: {fields}")
        else:
            # Single field index
            field = idx_spec[0]
            direction = idx_spec[1]
            unique = idx_spec[2]
            await db.events.create_index([(field, direction)], unique=unique)
            print(f"✓ Created index: {field} (unique={unique})")
    
    # Count existing events
    count = await db.events.count_documents({})
    print(f"\n✓ Events collection initialized. Current events: {count}")
    
    client.close()

if __name__ == "__main__":
    asyncio.run(init_events_collection())
