/**
 * Allocation Data Diagnostic Script
 * Run this in browser console to debug allocation issues
 */

// 1. Check which tables have data
async function checkInventoryTables() {
  const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
  // Get HTTPS URL - convert HTTP to HTTPS if needed
  let baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  if (baseUrl.startsWith('http://')) {
    baseUrl = baseUrl.replace('http://', 'https://');
  } else if (!baseUrl) {
    baseUrl = 'https://172.31.39.68:8030'; // Default fallback to HTTPS
  }
  
  console.log('🔍 Checking Inventory Tables for Allocation Data...\n');
  
  const tables = [
    { name: 'asn_inventory', desc: 'Batch-level received inventory (PRIMARY)', url: `${baseUrl}/asn_inventory?limit=1` },
    { name: 'inventory', desc: 'Item-level aggregated inventory', url: `${baseUrl}/inventory?limit=1` },
    { name: 'asn_lines', desc: 'ASN line details', url: `${baseUrl}/asn_lines?limit=1` },
    { name: 'so_lines', desc: 'SO line items', url: `${baseUrl}/so_lines?limit=1` }
  ];
  
  for (const table of tables) {
    try {
      const res = await fetch(table.url, {
        headers: { 'X-Api-Key': apiKey }
      });
      const data = await res.json();
      const count = Array.isArray(data) ? data.length : 1;
      console.log(`✅ ${table.name}`);
      console.log(`   Description: ${table.desc}`);
      console.log(`   Status: ${res.ok ? '✅ OK' : `❌ ${res.status}`}`);
      console.log(`   Sample: ${JSON.stringify(data[0] || {}).substring(0, 100)}...\n`);
    } catch (err) {
      console.log(`❌ ${table.name} - ${err.message}\n`);
    }
  }
}

// 2. Check ASN inventory with available quantities
async function checkAvailableBatches() {
  const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
  // Get HTTPS URL - convert HTTP to HTTPS if needed
  let baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '';
  if (baseUrl.startsWith('http://')) {
    baseUrl = baseUrl.replace('http://', 'https://');
  } else if (!baseUrl) {
    baseUrl = 'https://172.31.39.68:8030'; // Default fallback to HTTPS
  }
  
  console.log('\n📦 Checking Available Batches in ASN_INVENTORY...\n');
  
  const queries = [
    {
      name: 'All ASN Inventory Records',
      url: `${baseUrl}/asn_inventory?limit=100`,
      desc: 'Get all batch records'
    },
    {
      name: 'Batches with quantity_received > quantity_pending',
      url: `${baseUrl}/asn_inventory?quantity_received=gt.quantity_pending&limit=100`,
      desc: 'Get only allocatable batches'
    },
    {
      name: 'By Status = pending',
      url: `${baseUrl}/asn_inventory?status=eq.pending&limit=100`,
      desc: 'Get pending ASN batches'
    },
    {
      name: 'By Status = received',
      url: `${baseUrl}/asn_inventory?status=eq.received&limit=100`,
      desc: 'Get received ASN batches'
    }
  ];
  
  for (const query of queries) {
    try {
      const res = await fetch(query.url, {
        headers: { 'X-Api-Key': apiKey }
      });
      console.log(`Query: ${query.name}`);
      console.log(`URL: ${query.url.substring(25)}`);
      console.log(`Status: ${res.status} ${res.statusText}`);
      
      if (res.ok) {
        const data = await res.json();
        console.log(`Records: ${Array.isArray(data) ? data.length : 1}`);
        if (Array.isArray(data) && data.length > 0) {
          console.log(`Sample: ${JSON.stringify(data[0]).substring(0, 150)}...`);
        }
      }
      console.log('---\n');
    } catch (err) {
      console.log(`Error: ${err.message}\n`);
    }
  }
}

// 3. Test allocation query (the one used in handleOpenAllocation)
async function testAllocationQuery() {
  const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
  // Get HTTPS URL - convert HTTP to HTTPS if needed
  let urlAsnInventory = process.env.NEXT_PUBLIC_URL_ASN_INVENTORY || '';
  if (urlAsnInventory.startsWith('http://')) {
    urlAsnInventory = urlAsnInventory.replace('http://', 'https://');
  } else if (!urlAsnInventory) {
    urlAsnInventory = 'https://api.example.com:8030/asn_inventory'; // fallback
  }
  
  console.log('\n🔄 Testing Allocation Query...\n');
  console.log(`Base URL: ${urlAsnInventory}`);
  
  try {
    // Current query from handleOpenAllocation
    const query = `${urlAsnInventory}?quantity_received=gt.quantity_pending&limit=10000&order=item_id`;
    console.log(`Query: ${query.substring(25)}`);
    
    const res = await fetch(query, {
      method: 'GET',
      headers: { 'X-Api-Key': apiKey }
    });
    
    console.log(`Response Status: ${res.status} ${res.statusText}`);
    
    if (!res.ok) {
      const text = await res.text();
      console.log(`Error Response: ${text}`);
    } else {
      const data = await res.json();
      console.log(`✅ Successfully fetched ${Array.isArray(data) ? data.length : 1} records`);
      
      if (Array.isArray(data) && data.length > 0) {
        console.log('\nSample Batch:');
        console.log(JSON.stringify(data[0], null, 2).substring(0, 500));
      }
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
}

// 4. Recommended fixes based on your schema
function showRecommendations() {
  console.log('\n💡 RECOMMENDATIONS:\n');
  console.log('1. USE TABLE: asn_inventory');
  console.log('   WHY: Contains batch details (batch_number, expiry_date, mfg_date)');
  console.log('   KEY FIELD: on_hand_quantity OR (quantity_received - quantity_pending)\n');
  
  console.log('2. QUERY OPTIONS:');
  console.log('   Option A: ?limit=10000 (get all, filter in app)');
  console.log('   Option B: ?status=eq.received&limit=10000 (only received ASN)');
  console.log('   Option C: ?quantity_received=gt.0&limit=10000 (has received qty)\n');
  
  console.log('3. REQUIRED FIELDS FOR ALLOCATION:');
  console.log('   - item_id (match to SO lines)');
  console.log('   - batch_number (identify batch)');
  console.log('   - on_hand_quantity OR (quantity_received - quantity_pending) (available qty)');
  console.log('   - expiry_date (for FEFO sorting)');
  console.log('   - manufacturing_date (for FIFO sorting)');
  console.log('   - location_id (for picking)');
  console.log('   - pallet_id (for tracking)\n');
  
  console.log('4. IF NO DATA APPEARS:');
  console.log('   a) Check Inbound module - receive an ASN shipment first');
  console.log('   b) Verify NEXT_PUBLIC_URL_ASN_INVENTORY environment variable');
  console.log('   c) Check API key access (NEXT_PUBLIC_X_API_KEY)');
  console.log('   d) Run SQL: SELECT COUNT(*) FROM asn_inventory;\n');
  
  console.log('5. DATABASE VERIFICATION:');
  console.log('   Run in PostgreSQL:');
  console.log('   - SELECT COUNT(*) FROM asn_inventory;');
  console.log('   - SELECT * FROM asn_inventory LIMIT 5;');
  console.log('   - SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns');
  console.log('     WHERE table_name = \'asn_inventory\';');
}

// Run all diagnostics
console.log('===== ALLOCATION DATA DIAGNOSTIC =====\n');
console.log('Running checks...\n');

checkInventoryTables()
  .then(() => checkAvailableBatches())
  .then(() => testAllocationQuery())
  .then(() => showRecommendations())
  .catch(err => console.error('Diagnostic error:', err));

// Also available individually:
// checkInventoryTables() - Check which tables have data
// checkAvailableBatches() - Check batch availability
// testAllocationQuery() - Test the actual allocation query
// showRecommendations() - Show fix options
