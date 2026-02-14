#!/usr/bin/env node
// Debug script to simulate the full inventory insertion flow

const API_URL = 'http://172.31.39.68:8030';  // Use HTTP for internal network, not HTTPS
const API_KEY = 'W5kcjXoWfiZV3uW1c0MaIjfWHtql2gIrlGYR8bdtS8RQfyN9w0b2rHeaJy5PPW';

async function debugInventoryInsertion() {
  console.log('🔍 Simulating full inventory insertion flow...\n');
  
  // Step 1: Get all locations to verify Staging-004 exists
  console.log('Step 1: Fetching all locations...\n');
  try {
    const locRes = await fetch(`${API_URL}/locations`, {
      headers: { 'x-api-key': API_KEY },
    });
    
    if (!locRes.ok) {
      console.error('❌ Failed to fetch locations:', locRes.status);
      process.exit(1);
    }

    const locations = await locRes.json();
    const stagingLoc = locations.find((l) => 
      l.location_name.toLowerCase() === 'staging-004'
    );
    
    console.log(`✓ Found ${locations.length} locations`);
    console.log(`✓ Location names: ${locations.map(l => l.location_name).join(', ')}\n`);
    
    if (stagingLoc) {
      console.log(`✓ Found Staging-004: id=${stagingLoc.id}, warehouse_id=${stagingLoc.warehouse_id}\n`);
    } else {
      console.error('❌ Staging-004 not found!');
      console.log('Available locations:', locations.map(l => ({ name: l.location_name, id: l.id })));
      process.exit(1);
    }

    // Step 2: Get ASN header
    console.log('Step 2: Fetching ASN headers...\n');
    const asnRes = await fetch(`${API_URL}/asn_headers?status=eq.Received`, {
      headers: { 'x-api-key': API_KEY },
    });
    
    if (!asnRes.ok) {
      console.error('❌ Failed to fetch ASN headers:', asnRes.status);
      process.exit(1);
    }

    const asnHeaders = await asnRes.json();
    if (asnHeaders.length === 0) {
      console.log('⚠️ No ASN headers with Received status found');
      console.log('📝 Fetching any ASN header for testing...\n');
      
      const anyAsnRes = await fetch(`${API_URL}/asn_headers`, {
        headers: { 'x-api-key': API_KEY },
      });
      const anyAsn = await anyAsnRes.json();
      
      if (anyAsn.length === 0) {
        console.error('❌ No ASN headers found at all!');
        process.exit(1);
      }
      
      const asnHeader = anyAsn[0];
      console.log(`✓ Using ASN Header: id=${asnHeader.id}, asn_number=${asnHeader.asn_number}, status=${asnHeader.status}\n`);

      // Step 3: Get ASN lines
      console.log('Step 3: Fetching ASN lines for this header...\n');
      const linesRes = await fetch(`${API_URL}/asn_lines?asn_header_id=eq.${asnHeader.id}`, {
        headers: { 'x-api-key': API_KEY },
      });
      
      if (!linesRes.ok) {
        console.error('❌ Failed to fetch ASN lines:', linesRes.status);
        process.exit(1);
      }

      const asnLines = await linesRes.json();
      console.log(`✓ Found ${asnLines.length} ASN lines\n`);
      
      if (asnLines.length === 0) {
        console.error('❌ No ASN lines found!');
        process.exit(1);
      }

      const line = asnLines[0];
      console.log(`Processing line: ${line.item_code}, qty: ${line.expected_quantity}\n`);

      // Step 4: Lookup item
      console.log('Step 4: Looking up item by item_code...\n');
      const itemRes = await fetch(`${API_URL}/items?item_code=eq.${line.item_code}`, {
        headers: { 'x-api-key': API_KEY },
      });
      
      if (!itemRes.ok) {
        console.error('❌ Failed to fetch item:', itemRes.status);
        process.exit(1);
      }

      const items = await itemRes.json();
      if (items.length === 0) {
        console.error(`❌ Item not found for code: ${line.item_code}`);
        process.exit(1);
      }

      const item = items[0];
      console.log(`✓ Found item: id=${item.id}, item_code=${item.item_code}, item_name=${item.item_name}\n`);

      // Step 5: Check if inventory already exists
      console.log('Step 5: Checking if inventory record already exists...\n');
      const checkUrl = `${API_URL}/inventory?item_id=eq.${item.id}&location_id=eq.${stagingLoc.id}&warehouse_id=eq.${stagingLoc.warehouse_id}`;
      console.log('Check URL:', checkUrl, '\n');
      
      const checkRes = await fetch(checkUrl, {
        headers: { 'x-api-key': API_KEY },
      });
      
      if (!checkRes.ok) {
        console.error('❌ Failed to check existing inventory:', checkRes.status);
        process.exit(1);
      }

      const existing = await checkRes.json();
      if (existing.length > 0) {
        console.log(`✓ Inventory record exists: id=${existing[0].id}, qty=${existing[0].on_hand_quantity}\n`);
      } else {
        console.log('✓ No existing inventory record - will INSERT new one\n');
      }

      // Step 6: Try to insert inventory
      console.log('Step 6: Testing inventory INSERT...\n');
      const payload = {
        item_id: item.id,
        location_id: stagingLoc.id,
        warehouse_id: stagingLoc.warehouse_id,
        on_hand_quantity: 100,
        allocated_quantity: 0,
        available_quantity: 100,
        weight_uom_kg: null,
        pallet_config: null,
        pallet_id: null,
      };
      
      console.log('Payload:', JSON.stringify(payload, null, 2), '\n');
      
      const insertRes = await fetch(`${API_URL}/inventory`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify(payload),
      });
      
      const insertBody = await insertRes.text();
      
      console.log('Response Status:', insertRes.status, insertRes.statusText);
      if (insertBody) {
        try {
          console.log('Response Body:', JSON.stringify(JSON.parse(insertBody), null, 2));
        } catch {
          console.log('Response Body:', insertBody);
        }
      }
      
      if (!insertRes.ok) {
        console.error('\n❌ INSERT failed!');
        process.exit(1);
      }
      
      console.log('\n✅ All checks passed!');
      console.log('The inventory insertion flow should work correctly.');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

debugInventoryInsertion();
