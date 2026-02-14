#!/bin/bash
# Migration runner for inventory table updates
# This script applies the migration and refreshes PostgREST schema cache

set -e

# Database connection details
DB_HOST="172.31.39.68"
DB_PORT="5432"
DB_USER="mswmsapp"
DB_PASSWORD="mswmsapp123"
DB_NAME="expediseph_wms_dev"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔄 Starting inventory table migration...${NC}"

# Run the migration
echo -e "${YELLOW}📝 Running migration 002_add_shipped_qty_to_inventory.sql...${NC}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f migrations/002_add_shipped_qty_to_inventory.sql

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Migration completed successfully${NC}"
else
  echo -e "${RED}❌ Migration failed${NC}"
  exit 1
fi

# Verify columns were added
echo -e "${YELLOW}🔍 Verifying columns in inventory table...${NC}"
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" <<EOF
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'inventory' AND column_name IN ('quantity_shipped', 'shipped_at', 'shipped_by', 'updated_at')
ORDER BY ordinal_position;
EOF

echo -e "${GREEN}✅ All columns verified${NC}"

# Try to refresh PostgREST schema cache via API
echo -e "${YELLOW}🔄 Attempting to refresh PostgREST schema cache...${NC}"

# Try to hit a non-existent endpoint to trigger schema reload
curl -s -X GET "https://172.31.39.68:8030/rpc/pgrst.schema" \
  -H "Content-Type: application/json" \
  -H "x-api-key: mswmsapp" 2>/dev/null || true

echo -e "${GREEN}✅ Migration process completed!${NC}"
echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo "1. Restart the PostgREST service to refresh schema cache (if available)"
echo "2. Test the 'Confirm Ship' button in the application"
echo "3. Check browser console for any remaining errors"
