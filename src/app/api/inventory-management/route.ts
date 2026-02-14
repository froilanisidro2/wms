import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || process.env.POSTGREST_API_KEY || '';

// Get API base URL from environment, fallback to public IP
const API_BASE = (() => {
  const base = process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';
  return base.replace(/^https?:\/\//, 'http://').replace(/\/$/, '');
})();

async function fetchInventory(table: string, filters: Record<string, string> = {}, select?: string) {
  const params = new URLSearchParams();
  
  for (const [key, value] of Object.entries(filters)) {
    params.append(key, value);
  }
  
  if (select) {
    params.append('select', select);
  }

  const url = `${API_BASE}/${table}?${params.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'x-api-key': apiKey },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch from ${table}: ${response.status}`);
  }

  return response.json();
}

async function updateInventory(table: string, id: number | string, data: any) {
  const url = `${API_BASE}/${table}?id=eq.${id}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to update ${table}: ${response.status}`);
  }

  return response.json();
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const table = searchParams.get('table');
    const select = searchParams.get('select');

    if (!table) {
      return NextResponse.json(
        { error: 'Missing table parameter' },
        { status: 400 }
      );
    }

    // Build filters from query params (exclude special params)
    const filters: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (!['table', 'select'].includes(key) && value) {
        filters[key] = value;
      }
    }

    const data = await fetchInventory(table, filters, select || undefined);
    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Inventory fetch error:', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { table, id, data } = body;

    if (!table || !id || !data) {
      return NextResponse.json(
        { error: 'Missing table, id, or data parameter' },
        { status: 400 }
      );
    }

    const result = await updateInventory(table, id, data);

    // Clear cache after update
    try {
      const cacheUrl = new URL('/api/cache-control', request.url);
      cacheUrl.searchParams.set('action', 'clear');
      cacheUrl.searchParams.set('table', table);
      await fetch(cacheUrl.toString());
    } catch (err) {
      console.error('Cache clear error:', err);
    }

    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    console.error('Inventory update error:', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, asnHeaderId, locationName, warehouseId } = body;

    if (action === 'insertReceivedInventory') {
      console.log('📦 Processing insertReceivedInventory for ASN Header ID:', asnHeaderId);
      console.log('🔑 API Key configured:', apiKey ? '✓ Yes' : '✗ No - API calls will fail with 401');

      // Check if this ASN has already been received (inventory already exists)
      let headerAlreadyReceived = false;
      try {
        const asnInvCheckUrl = `${API_BASE}/asn_inventory?asn_header_id=eq.${asnHeaderId}&status=eq.Received`;
        const asnCheckRes = await fetch(asnInvCheckUrl, {
          headers: { 'x-api-key': apiKey },
        });
        if (asnCheckRes.ok) {
          const existingASNRecords = await asnCheckRes.json();
          if (Array.isArray(existingASNRecords) && existingASNRecords.length > 0) {
            headerAlreadyReceived = true;
            console.log('⚠️ WARNING: This ASN Header has already been received! Skipping inventory insertion to prevent duplicates.');
          }
        }
      } catch (checkErr) {
        console.warn('⚠️ Could not check if ASN already received:', checkErr);
      }

      if (headerAlreadyReceived) {
        return NextResponse.json({
          success: true,
          message: 'ASN Header already received - skipping to prevent duplicates',
          stagingLocationId: 0,
          stagingLocationName: 'N/A',
          results: [],
        });
      }

      // 1. Get the location ID by name (default to "Staging" location)
      let stagingLocation;
      try {
        // Fetch all locations and find by name
        const locationsUrl = `${API_BASE}/locations`;
        console.log('📍 Fetching locations from:', locationsUrl);
        const locRes = await fetch(locationsUrl, {
          headers: { 'x-api-key': apiKey },
        });

        if (!locRes.ok) {
          throw new Error(`Failed to fetch locations: ${locRes.status} ${locRes.statusText}`);
        }

        const allLocations = await locRes.json();
        console.log('✓ Fetched locations:', Array.isArray(allLocations) ? allLocations.length : 'unknown');
        console.log('📍 Location names available:', Array.isArray(allLocations) ? allLocations.map((l: any) => l.location_name).join(', ') : 'N/A');

        if (Array.isArray(allLocations)) {
          // Try exact match first, then partial match
          stagingLocation = allLocations.find((loc: any) => 
            loc.location_name && loc.location_name.toLowerCase() === locationName.toLowerCase()
          );
          
          if (!stagingLocation) {
            stagingLocation = allLocations.find((loc: any) => 
              loc.location_name && loc.location_name.toLowerCase().includes(locationName.toLowerCase())
            );
          }
        }

        if (!stagingLocation) {
          console.error('❌ Location not found. Available locations:', allLocations);
          throw new Error(`Location "${locationName}" not found in system. Available: ${allLocations.map((l: any) => l.location_name).join(', ')}`);
        }
      } catch (err) {
        console.error('❌ Failed to fetch staging location:', err);
        return NextResponse.json(
          { error: `Failed to find location "${locationName}": ${err}` },
          { status: 400 }
        );
      }

      const stagingLocationId = stagingLocation.id;
      console.log('✓ Found Staging Location:', stagingLocation.location_name, 'ID:', stagingLocationId);

      // 2. Get ASN lines for this header
      let asnLines;
      try {
        const asnLinesUrl = `${API_BASE}/asn_lines?asn_header_id=eq.${asnHeaderId}`;
        const linesRes = await fetch(asnLinesUrl, {
          headers: { 'x-api-key': apiKey },
        });

        if (!linesRes.ok) {
          throw new Error(`Failed to fetch ASN lines: ${linesRes.status}`);
        }

        asnLines = await linesRes.json();
        console.log('✓ Fetched ASN lines:', Array.isArray(asnLines) ? asnLines.length : 'unknown');
      } catch (err) {
        console.error('❌ Failed to fetch ASN lines:', err);
        return NextResponse.json(
          { error: `Failed to fetch ASN lines: ${err}` },
          { status: 400 }
        );
      }

      if (!Array.isArray(asnLines) || asnLines.length === 0) {
        console.log('⚠️ No ASN lines found for header ID:', asnHeaderId);
        return NextResponse.json(
          { success: true, message: 'No lines to process' },
          { status: 200 }
        );
      }

      console.log('✓ Found', asnLines.length, 'ASN lines to insert');

      // 2b. Fetch ASN header to get asn_number and date_received
      let asnHeader = null;
      try {
        const asnHeaderUrl = `${API_BASE}/asn_headers?id=eq.${asnHeaderId}`;
        const headerRes = await fetch(asnHeaderUrl, {
          headers: { 'x-api-key': apiKey },
        });

        if (headerRes.ok) {
          const headers = await headerRes.json();
          if (Array.isArray(headers) && headers.length > 0) {
            asnHeader = headers[0];
            console.log('✓ Fetched ASN header:', asnHeader.asn_number, 'Status:', asnHeader.status);
          }
        }
      } catch (err) {
        console.warn('⚠️ Could not fetch ASN header:', err);
      }

      // 3. For each ASN line, need to get item_id from items table using item_code
      const insertResults = [];
      for (const line of asnLines) {
        try {
          // Check if received_quantity or quantity_received field exists
          // If no received_quantity, fall back to expected_quantity
          const receivedQty = Number(line.received_quantity || line.quantity_received || line.quantityReceived || line.expected_quantity || line.expectedQuantity || 0) || 0;
          
          console.log('📝 Processing ASN line:', line.id, 'item_code:', line.item_code, 'qty:', receivedQty, 'received_qty:', line.received_quantity, 'expected_qty:', line.expected_quantity);
          console.log('📝 Full line data:', JSON.stringify(line));

          if (receivedQty <= 0) {
            console.warn('⚠️ Skipping line with zero or negative quantity:', line.id);
            insertResults.push({
              item_code: line.item_code,
              success: false,
              error: 'Received quantity is zero or negative',
            });
            continue;
          }

          // First, get the item_id from items table using item_code
          let itemId = null;
          try {
            const itemsUrl = `${API_BASE}/items?item_code=eq.${line.item_code}`;
            const itemRes = await fetch(itemsUrl, {
              headers: { 'x-api-key': apiKey },
            });

            if (itemRes.ok) {
              const items = await itemRes.json();
              if (Array.isArray(items) && items.length > 0) {
                itemId = items[0].id;
                console.log('✓ Found item_id:', itemId, 'for item_code:', line.item_code);
              } else {
                console.warn('⚠️ Item not found for code:', line.item_code);
              }
            } else {
              console.warn('⚠️ Failed to fetch item for code:', line.item_code);
            }
          } catch (itemErr) {
            console.error('❌ Error fetching item:', itemErr);
          }

          if (!itemId) {
            console.error('❌ Could not find item_id for item_code:', line.item_code);
            insertResults.push({
              item_code: line.item_code,
              success: false,
              error: `Item not found for code: ${line.item_code}`,
            });
            continue;
          }

          // Payload for asn_inventory table - only fields that exist in schema
          const asnInventoryPayload = {
            asn_line_id: line.id,
            warehouse_id: Number(warehouseId) || 1,
            item_id: itemId,
            location_id: stagingLocationId,
            batch_number: line.batch_number || null,
            manufacturing_date: line.manufacturing_date || null,
            expiry_date: line.expiry_date || null,
            pallet_id: line.pallet_id || null,
            quantity_expected: Number(line.expected_quantity || line.expectedQuantity || 0) || 0,
            quantity_received: receivedQty,
            quantity_pending: 0,
            on_hand_quantity: receivedQty,
            available_quantity: receivedQty,
            weight_uom_kg: line.weight_uom_kg || null,
            pallet_config: line.pallet_config || null,
            status: 'Received',
            received_at: new Date().toISOString(),
            received_by: null,
            notes: 'Auto-received from ASN status change',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          // Payload for inventory table - only fields that exist in schema
          const inventoryPayload = {
            item_id: itemId,
            location_id: stagingLocationId,
            warehouse_id: Number(warehouseId) || 1,
            pallet_id: line.pallet_id || null,
            pallet_config: line.pallet_config || null,
            on_hand_quantity: receivedQty,
            allocated_quantity: 0,
            available_quantity: receivedQty,
            weight_uom_kg: line.weight_uom_kg || null,
            batch_number: line.batch_number || null,
            asn_number: asnHeader?.asn_number || null,
            asn_status: asnHeader?.status || null,
            date_received: asnHeader?.created_at || asnHeader?.asn_date || null,
          };

          console.log('📝 Inserting inventory for item_code:', line.item_code, '(id:', itemId, '), qty:', receivedQty);
          console.log('📝 ASN Inventory Payload:', JSON.stringify(asnInventoryPayload));
          console.log('📝 Inventory Payload:', JSON.stringify(inventoryPayload));

          // 1. POST to asn_inventory table first
          const asnInventoryUrl = `${API_BASE}/asn_inventory`;
          const asnInventoryRes = await fetch(asnInventoryUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            body: JSON.stringify(asnInventoryPayload),
          });

          if (!asnInventoryRes.ok) {
            const errorText = await asnInventoryRes.text();
            console.error('⚠️ Failed to insert asn_inventory for item:', line.item_code, 'Status:', asnInventoryRes.status, 'Response:', errorText);
            insertResults.push({
              item_code: line.item_code,
              success: false,
              error: `asn_inventory insert failed: ${asnInventoryRes.status} - ${errorText}`,
            });
            continue;
          }

          // Handle empty response body (PostgREST returns 201/202 with empty body)
          let asnInvData = null;
          try {
            const responseText = await asnInventoryRes.text();
            if (responseText && responseText.trim().length > 0) {
              asnInvData = JSON.parse(responseText);
            }
          } catch (parseErr) {
            console.warn('⚠️ Could not parse asn_inventory response:', parseErr);
          }
          console.log('✅ Inserted asn_inventory for item:', line.item_code, 'record id:', asnInvData?.id || 'unknown');

          // 2. Check if inventory record already exists for this item+location+warehouse+pallet
          // Each pallet should have its own inventory record
          const palletIdFilter = line.pallet_id ? `&pallet_id=eq.${line.pallet_id}` : '';
          const inventoryCheckUrl = `${API_BASE}/inventory?item_id=eq.${itemId}&location_id=eq.${stagingLocationId}&warehouse_id=eq.${Number(warehouseId) || 1}${palletIdFilter}`;
          console.log('📍 Checking existing inventory at:', inventoryCheckUrl);
          
          let existingInventory = null;
          try {
            const checkRes = await fetch(inventoryCheckUrl, {
              headers: { 'x-api-key': apiKey },
            });
            if (checkRes.ok) {
              const existingRecords = await checkRes.json();
              if (Array.isArray(existingRecords) && existingRecords.length > 0) {
                existingInventory = existingRecords[0];
                console.log('📦 Found existing inventory record, id:', existingInventory.id, 'pallet:', existingInventory.pallet_id, 'current qty:', existingInventory.on_hand_quantity);
              } else {
                console.log('📦 No existing inventory for this pallet - will create new record');
              }
            }
          } catch (checkErr) {
            console.warn('⚠️ Could not check for existing inventory:', checkErr);
          }

          if (existingInventory) {
            // UPDATE existing record - add to quantities
            const updatedQty = Number(existingInventory.on_hand_quantity || 0) + receivedQty;
            const updatedAllocated = Number(existingInventory.allocated_quantity || 0);
            const updatedAvailable = updatedQty - updatedAllocated;

            const updatePayload = {
              on_hand_quantity: updatedQty,
              available_quantity: updatedAvailable,
              updated_at: new Date().toISOString(),
            };

            console.log('📝 Updating existing inventory: id:', existingInventory.id, 'new qty:', updatedQty, 'available:', updatedAvailable);

            const updateUrl = `${API_BASE}/inventory?id=eq.${existingInventory.id}`;
            const updateRes = await fetch(updateUrl, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
              },
              body: JSON.stringify(updatePayload),
            });

            if (!updateRes.ok) {
              const errorText = await updateRes.text();
              console.error('⚠️ Failed to update inventory for item:', line.item_code, 'Status:', updateRes.status, 'Response:', errorText);
              insertResults.push({
                item_code: line.item_code,
                success: false,
                error: `inventory update failed: ${updateRes.status} - ${errorText}`,
              });
            } else {
              console.log('✅ Updated inventory for item:', line.item_code, 'new on_hand_qty:', updatedQty, 'available_qty:', updatedAvailable);
              insertResults.push({
                item_code: line.item_code,
                success: true,
                action: 'updated',
                new_qty: updatedQty,
              });
            }
          } else {
            // INSERT new record
            const inventoryUrl = `${API_BASE}/inventory`;
            console.log('📝 Creating new inventory record for item:', line.item_code);
            
            const inventoryRes = await fetch(inventoryUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
              },
              body: JSON.stringify(inventoryPayload),
            });

            if (!inventoryRes.ok) {
              const errorText = await inventoryRes.text();
              console.error('⚠️ Failed to insert inventory for item:', line.item_code, 'Status:', inventoryRes.status, 'Response:', errorText);
              insertResults.push({
                item_code: line.item_code,
                success: false,
                error: `inventory insert failed: ${inventoryRes.status} - ${errorText}`,
              });
            } else {
              // Handle empty response body (PostgREST returns 201/202 with empty body)
              let invData = null;
              try {
                const responseText = await inventoryRes.text();
                if (responseText && responseText.trim().length > 0) {
                  invData = JSON.parse(responseText);
                }
              } catch (parseErr) {
                console.warn('⚠️ Could not parse inventory response:', parseErr);
              }
              console.log('✅ Inserted inventory for item:', line.item_code, 'record id:', invData?.id || 'unknown', 'quantity:', receivedQty);
              insertResults.push({
                item_code: line.item_code,
                success: true,
                action: 'inserted',
                qty: receivedQty,
              });
            }
          }
        } catch (err) {
          console.error('❌ Error processing line:', line.id, err);
          insertResults.push({
            item_code: line.item_code || 'unknown',
            success: false,
            error: String(err),
          });
        }
      }

      console.log('📊 Insert results summary:', insertResults.filter((r: any) => r.success).length, 'succeeded,', insertResults.filter((r: any) => !r.success).length, 'failed');

      return NextResponse.json({
        success: true,
        message: 'Received inventory inserted to Staging Location',
        stagingLocationId,
        stagingLocationName: stagingLocation.location_name,
        results: insertResults,
      });
    }

    if (action === 'shipmentConfirmation') {
      const { inventoryRecords, userId } = body;
      console.log('🚚 Processing shipmentConfirmation for inventory records:', inventoryRecords?.length || 0);
      
      if (!Array.isArray(inventoryRecords) || inventoryRecords.length === 0) {
        return NextResponse.json(
          { error: 'No inventory records provided for shipment' },
          { status: 400 }
        );
      }

      const updateResults = [];
      
      for (const invRecord of inventoryRecords) {
        try {
          const { id, on_hand_quantity, quantity_shipped, shipped_qty } = invRecord;
          const actualShippedQty = shipped_qty || quantity_shipped || 0;
          const newOnHand = Math.max(0, (on_hand_quantity || 0) - actualShippedQty);
          const newShipped = (quantity_shipped || 0) + actualShippedQty;
          
          const updateData = {
            on_hand_quantity: newOnHand,
            allocated_quantity: 0,
            available_quantity: Math.max(0, newOnHand),
            quantity_shipped: newShipped,
            shipped_at: new Date().toISOString(),
            shipped_by: userId || null,
            inventory_status: newOnHand === 0 ? 'shipped' : 'received',
            updated_at: new Date().toISOString()
          };

          const url = `${API_BASE}/inventory?id=eq.${id}`;
          console.log(`📝 Updating inventory ${id}: on_hand ${on_hand_quantity} → ${newOnHand}, shipped_qty: ${newShipped}`);
          
          const response = await fetch(url, {
            method: 'PATCH',
            headers: {
              'x-api-key': apiKey,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
            body: JSON.stringify(updateData),
          });

          const responseText = await response.text();
          console.log(`📝 PATCH response status: ${response.status}, body:`, responseText);

          if (!response.ok) {
            console.error(`❌ Failed to update inventory ${id}: ${responseText}`);
            updateResults.push({
              id,
              success: false,
              error: responseText,
            });
          } else {
            console.log(`✅ Inventory ${id} updated successfully`);
            updateResults.push({
              id,
              success: true,
              on_hand_quantity: newOnHand,
              quantity_shipped: newShipped,
            });
          }
        } catch (err) {
          console.error(`❌ Error updating inventory:`, err);
          updateResults.push({
            id: invRecord.id,
            success: false,
            error: String(err),
          });
        }
      }

      const successCount = updateResults.filter((r: any) => r.success).length;
      const failureCount = updateResults.filter((r: any) => !r.success).length;
      
      console.log(`📊 Shipment update results: ${successCount} succeeded, ${failureCount} failed`);

      return NextResponse.json({
        success: failureCount === 0,
        message: `Shipment confirmation: ${successCount} records updated, ${failureCount} failed`,
        results: updateResults,
      });
    }

    return NextResponse.json(
      { error: 'Unknown action' },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('Inventory management POST error:', err);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

export const maxDuration = 300; // 5 minutes for inventory operations