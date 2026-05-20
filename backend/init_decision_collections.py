"""
Initialize Decision Layer collections (recommendations, actions)
"""

import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from decision_layer import init_decision_collections

async def main():
    mongo_url = os.environ['MONGO_URL']
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ['DB_NAME']]
    
    print("Initializing Decision Layer collections...")
    result = await init_decision_collections(db)
    print(f"✅ Decision Layer initialized: {list(result.keys())}")
    
    client.close()

if __name__ == "__main__":
    asyncio.run(main())
