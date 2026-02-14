#!/usr/bin/env node

/**
 * Cache Control Helper Script
 * Usage: node clear-cache.js [action] [options]
 * 
 * Examples:
 *   node clear-cache.js all              # Clear all caches
 *   node clear-cache.js config           # Clear config cache
 *   node clear-cache.js year 2025        # Clear all tables for 2025
 *   node clear-cache.js table inbound 2025  # Clear inbound/2025
 *   node clear-cache.js stats            # Show cache stats
 */

const apiUrl = 'http://localhost:3000/api/cache-control';
const cacheKey = process.env.CACHE_CONTROL_KEY || 'dev-key-123';

const args = process.argv.slice(2);
const action = args[0] || 'all';
const param1 = args[1];
const param2 = args[2];

async function makeRequest(actionType, payload) {
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cache-Control-Key': cacheKey,
      },
      body: JSON.stringify({ action: actionType, ...payload }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Error:', error.error);
      process.exit(1);
    }

    const data = await response.json();
    console.log('✅', data.message);
    if (data.tables) {
      console.log('📊 Tables cleared:', data.tables.join(', '));
    }
    console.log('⏰ Timestamp:', data.timestamp);
  } catch (error) {
    console.error('❌ Failed to connect to API:', error.message);
    console.error('Make sure the WMS is running on http://localhost:3000');
    process.exit(1);
  }
}

async function getStats() {
  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'X-Cache-Control-Key': cacheKey,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('❌ Error:', error.error);
      process.exit(1);
    }

    const data = await response.json();
    console.log('\n📊 Cache Statistics:\n');
    console.log(JSON.stringify(data.currentStats, null, 2));
    console.log('\n📋 Available Actions:\n');
    data.availableActions.forEach((action) => {
      console.log(`  • ${action.action}`);
      console.log(`    ${action.description}`);
    });
  } catch (error) {
    console.error('❌ Failed to connect to API:', error.message);
    process.exit(1);
  }
}

async function main() {
  switch (action) {
    case 'all':
      console.log('🔄 Clearing ALL caches...');
      await makeRequest('clear-all', {});
      break;

    case 'config':
      console.log('🔄 Clearing CONFIG cache...');
      await makeRequest('clear-config', {});
      break;

    case 'year':
      if (!param1) {
        console.error('❌ Year is required. Usage: node clear-cache.js year 2025');
        process.exit(1);
      }
      console.log(`🔄 Clearing all tables for year ${param1}...`);
      await makeRequest('clear-year', { year: parseInt(param1) });
      break;

    case 'table':
      if (!param1 || !param2) {
        console.error('❌ Table and year are required. Usage: node clear-cache.js table inbound 2025');
        process.exit(1);
      }
      console.log(`🔄 Clearing ${param1} cache for year ${param2}...`);
      await makeRequest('clear-table', { table: param1, year: parseInt(param2) });
      break;

    case 'stats':
      await getStats();
      break;

    default:
      console.error(`❌ Unknown action: ${action}\n`);
      console.log('Available actions:');
      console.log('  all              - Clear all caches');
      console.log('  config           - Clear config cache only');
      console.log('  year <year>      - Clear all tables for a year');
      console.log('  table <table> <year> - Clear specific table');
      console.log('  stats            - Show cache statistics');
      process.exit(1);
  }
}

main();
