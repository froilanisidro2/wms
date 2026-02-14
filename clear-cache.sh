#!/bin/bash

# Cache Control Helper Script
# Usage: ./clear-cache.sh [action] [options]
# 
# Examples:
#   ./clear-cache.sh all              # Clear all caches
#   ./clear-cache.sh config           # Clear config cache
#   ./clear-cache.sh year 2025        # Clear all tables for 2025
#   ./clear-cache.sh table inbound 2025  # Clear inbound/2025
#   ./clear-cache.sh stats            # Show cache stats

API_URL="http://localhost:3000/api/cache-control"
CACHE_KEY="${CACHE_CONTROL_KEY:-dev-key-123}"

action="${1:-all}"
param1="${2:-}"
param2="${3:-}"

case $action in
  all)
    echo "🔄 Clearing ALL caches..."
    curl -X POST "$API_URL" \
      -H "Content-Type: application/json" \
      -H "X-Cache-Control-Key: $CACHE_KEY" \
      -d '{"action":"clear-all"}' \
      && echo "\n✅ Done!"
    ;;
  
  config)
    echo "🔄 Clearing CONFIG cache..."
    curl -X POST "$API_URL" \
      -H "Content-Type: application/json" \
      -H "X-Cache-Control-Key: $CACHE_KEY" \
      -d '{"action":"clear-config"}' \
      && echo "\n✅ Done!"
    ;;
  
  year)
    if [ -z "$param1" ]; then
      echo "❌ Year is required. Usage: ./clear-cache.sh year 2025"
      exit 1
    fi
    echo "🔄 Clearing all tables for year $param1..."
    curl -X POST "$API_URL" \
      -H "Content-Type: application/json" \
      -H "X-Cache-Control-Key: $CACHE_KEY" \
      -d "{\"action\":\"clear-year\",\"year\":$param1}" \
      && echo "\n✅ Done!"
    ;;
  
  table)
    if [ -z "$param1" ] || [ -z "$param2" ]; then
      echo "❌ Table and year are required. Usage: ./clear-cache.sh table inbound 2025"
      exit 1
    fi
    echo "🔄 Clearing $param1 cache for year $param2..."
    curl -X POST "$API_URL" \
      -H "Content-Type: application/json" \
      -H "X-Cache-Control-Key: $CACHE_KEY" \
      -d "{\"action\":\"clear-table\",\"table\":\"$param1\",\"year\":$param2}" \
      && echo "\n✅ Done!"
    ;;
  
  stats)
    echo "📊 Cache Statistics:"
    curl -X GET "$API_URL" \
      -H "X-Cache-Control-Key: $CACHE_KEY"
    echo ""
    ;;
  
  *)
    echo "❌ Unknown action: $action"
    echo ""
    echo "Available actions:"
    echo "  all              - Clear all caches"
    echo "  config           - Clear config cache only"
    echo "  year <year>      - Clear all tables for a year (e.g., year 2025)"
    echo "  table <table> <year> - Clear specific table (e.g., table inbound 2025)"
    echo "  stats            - Show cache statistics"
    exit 1
    ;;
esac
