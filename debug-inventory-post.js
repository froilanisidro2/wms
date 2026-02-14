#!/usr/bin/env node
// Debug script to test inventory POST payload against PostgREST API

const API_URL = 'https://172.31.39.68:8030';
const API_KEY = process.env.POSTGREST_API_KEY || process.env.NEXT_PUBLIC_X_API_KEY || '';

async function testInventoryPost() {
  console.log('🔍 Testing inventory POST payload...\n');
  
  if (!API_KEY) {
    console.error('❌ No API key found in environment variables');
    console.log('Set POSTGREST_API_KEY or NEXT_PUBLIC_X_API_KEY');
    process.exit(1);
  }

  console.log('✓ API Key found:', API_KEY.substring(0, 10) + '...\n');

  // Test payload - minimal required fields
  const testPayload = {
    item_id: 1,
    location_id: 85,  // Staging-004
    warehouse_id: 5,
    on_hand_quantity: 10,
    allocated_quantity: 0,
    available_quantity: 10,
    weight_uom_kg: null,
    pallet_config: null,
    pallet_id: null,
  };

  console.log('📝 Test Payload:');
  console.log(JSON.stringify(testPayload, null, 2));
  console.log('\n');

  try {
    const response = await fetch(`${API_URL}/inventory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(testPayload),
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    console.log('📡 Response Status:', response.status, response.statusText);
    console.log('📡 Response Headers:');
    response.headers.forEach((value, name) => {
      if (!name.includes('cookie') && !name.includes('authorization')) {
        console.log(`  ${name}: ${value}`);
      }
    });
    console.log('\n📊 Response Body:');
    console.log(JSON.stringify(responseData, null, 2));

    if (!response.ok) {
      console.error('\n❌ POST failed!');
      process.exit(1);
    } else {
      console.log('\n✅ POST succeeded!');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    process.exit(1);
  }
}

testInventoryPost();
