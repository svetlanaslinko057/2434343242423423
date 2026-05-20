#!/bin/bash
# AUTO-INVOICE OVERDUE ENGINE CRON
# Run every 15 minutes

cd /app/ATLAS

# Export environment
export MONGO_URL="mongodb://localhost:27017"
export DB_NAME="test_database"

# Run overdue check
python3 overdue_engine.py >> /var/log/overdue_engine.log 2>&1
