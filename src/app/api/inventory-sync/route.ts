import { NextRequest, NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/utils/fetchHelper';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlInventory = process.env.NEXT_PUBLIC_URL_INVENTORY || '';

/**
 * GET /api/inventory-sync
 * Check if inventory exists for an item-location combination
 * Query params:
 * - item_id: Item ID
 * - location_id: Location ID
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const itemId = searchParams.get('item_id');
    const locationId = searchParams.get('location_id');
    const warehouseId = searchParams.get('warehouse_id');
    const palletId = searchParams.get('pallet_id');

    if (!urlInventory) {
      return NextResponse.json({ error: 'Inventory URL not configured' }, { status: 500 });
    }

    // Require either: (item_id + location_id) OR (pallet_id + warehouse_id)
    if (!itemId && !palletId) {
      return NextResponse.json({ error: 'Missing item_id or pallet_id' }, { status: 400 });
    }
    if (!locationId && !palletId) {
      return NextResponse.json({ error: 'Missing location_id or pallet_id' }, { status: 400 });
    }

    // Build query URL - start with pallet_id if available, otherwise item_id
    let checkUrl = '';
    if (palletId) {
      checkUrl = `${urlInventory}?pallet_id=eq.${palletId}`;
    } else {
      checkUrl = `${urlInventory}?item_id=eq.${itemId}`;
    }
    
    // Filter by location_id if provided
    if (locationId) {
      checkUrl += `&location_id=eq.${locationId}`;
    }

    // Filter by warehouse_id if provided
    if (warehouseId) {
      checkUrl += `&warehouse_id=eq.${warehouseId}`;
    }

    console.log(`📍 [GET /api/inventory-sync] Checking inventory:`, checkUrl);
    
    const response = await fetchWithTimeout(checkUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      timeout: 30000, // 30 second timeout for inventory check
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to check inventory:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to check inventory: ${errorText}` },
        { status: response.status }
      );
    }

    // Handle empty response
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0' || !response.body) {
      console.log('ℹ️ No existing inventory found');
      return NextResponse.json([]);
    }

    const text = await response.text();
    if (!text) {
      console.log('ℹ️ No existing inventory found (empty body)');
      return NextResponse.json([]);
    }

    const data = JSON.parse(text);
    console.log('✅ Found existing inventory:', data);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('❌ Inventory check error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/inventory-sync
 * Create or update inventory for putaway operations
 * Body:
 * - operation: 'create' | 'update'
 * - id: Record ID (for update)
 * - item_id: Item ID
 * - location_id: Location ID
 * - warehouse_id: Warehouse ID
 * - on_hand_quantity: On hand quantity
 * - allocated_quantity: Allocated quantity
 * - available_quantity: Available quantity
 * - pallet_id: Optional pallet ID
 * - weight_uom_kg: Optional weight
 * - pallet_config: Optional pallet config
 */
export async function POST(request: NextRequest) {
  try {
    if (!urlInventory) {
      return NextResponse.json({ error: 'Inventory URL not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { operation, id, ...inventoryData } = body;

    if (operation === 'update') {
      if (!id) {
        return NextResponse.json({ error: 'Missing id for update operation' }, { status: 400 });
      }

      // Update existing inventory (quantities and location)
      const updatePayload: Record<string, any> = {
        on_hand_quantity: inventoryData.on_hand_quantity,
        allocated_quantity: inventoryData.allocated_quantity,
        available_quantity: inventoryData.available_quantity,
      };

      // Include location_id and warehouse_id if provided
      if (inventoryData.location_id !== undefined) {
        updatePayload.location_id = inventoryData.location_id;
      }
      if (inventoryData.warehouse_id !== undefined) {
        updatePayload.warehouse_id = inventoryData.warehouse_id;
      }

      console.log(`📝 [POST /api/inventory-sync] UPDATE Operation:`);
      console.log(`   ID: ${id}`);
      console.log(`   Payload:`, updatePayload);

      const response = await fetchWithTimeout(`${urlInventory}?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(updatePayload),
        timeout: 30000, // 30 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to update inventory:', response.status, errorText);
        return NextResponse.json(
          { error: `Failed to update inventory: ${errorText}` },
          { status: response.status }
        );
      }

      // Handle empty response from PATCH
      const contentLength = response.headers.get('content-length');
      if (contentLength === '0' || !response.body) {
        console.log('✅ Inventory updated successfully (empty response)');
        console.log('   on_hand_quantity:', updatePayload.on_hand_quantity);
        console.log('   available_quantity:', updatePayload.available_quantity);
        return NextResponse.json({ success: true, message: 'Inventory updated', data: updatePayload });
      }

      const text = await response.text();
      if (!text) {
        console.log('✅ Inventory updated successfully (empty response body)');
        console.log('   on_hand_quantity:', updatePayload.on_hand_quantity);
        console.log('   available_quantity:', updatePayload.available_quantity);
        return NextResponse.json({ success: true, message: 'Inventory updated', data: updatePayload });
      }

      const data = JSON.parse(text);
      console.log('✅ Inventory updated successfully:', data);
      return NextResponse.json(data);
    } else if (operation === 'create') {
      // Create new inventory
      const createPayload = {
        item_id: inventoryData.item_id,
        location_id: inventoryData.location_id,
        warehouse_id: inventoryData.warehouse_id || 1,
        on_hand_quantity: inventoryData.on_hand_quantity,
        allocated_quantity: inventoryData.allocated_quantity || 0,
        available_quantity: inventoryData.available_quantity || inventoryData.on_hand_quantity || 0,
        pallet_id: inventoryData.pallet_id || null,
        weight_uom_kg: inventoryData.weight_uom_kg || null,
        pallet_config: inventoryData.pallet_config || null,
        // Metadata fields - copy from source if provided
        batch_number: inventoryData.batch_number || null,
        asn_number: inventoryData.asn_number || null,
        asn_status: inventoryData.asn_status || null,
        date_received: inventoryData.date_received || null,
        vendor_code: inventoryData.vendor_code || null,
        vendor_name: inventoryData.vendor_name || null,
        so_number: inventoryData.so_number || null,
        so_status: inventoryData.so_status || null,
        date_shipped: inventoryData.date_shipped || null,
        customer_code: inventoryData.customer_code || null,
        customer_name: inventoryData.customer_name || null,
      };

      console.log('📦 [POST /api/inventory-sync] CREATE Operation:');
      console.log('   Item ID:', createPayload.item_id);
      console.log('   Location ID:', createPayload.location_id);
      console.log('   Warehouse ID:', createPayload.warehouse_id);
      console.log('   on_hand_quantity:', createPayload.on_hand_quantity);
      console.log('   available_quantity:', createPayload.available_quantity);
      console.log('   Metadata:', { batch: createPayload.batch_number, asn: createPayload.asn_number, vendor: createPayload.vendor_name });

      let response = await fetchWithTimeout(urlInventory, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(createPayload),
        timeout: 30000, // 30 second timeout
      });

      // If schema cache error, retry without pallet_id
      if (!response.ok) {
        const errorText = await response.text();
        if (errorText.includes('PGRST204') || errorText.includes('pallet_id')) {
          console.log('⚠️ PostgREST schema cache not updated for pallet_id. Retrying without it...');
          const { pallet_id, ...payloadWithoutPallet } = createPayload;
          
          response = await fetchWithTimeout(urlInventory, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
            },
            body: JSON.stringify(payloadWithoutPallet),
            timeout: 30000, // 30 second timeout
          });
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to create inventory:', response.status, errorText);
        return NextResponse.json(
          { error: `Failed to create inventory: ${errorText}` },
          { status: response.status }
        );
      }

      // Handle empty response from POST (create)
      const contentLength = response.headers.get('content-length');
      if (contentLength === '0' || !response.body) {
        console.log('✅ Inventory created successfully (empty response)');
        console.log('   Quantities:', {
          on_hand: createPayload.on_hand_quantity,
          available: createPayload.available_quantity,
          warehouse_id: createPayload.warehouse_id,
        });
        return NextResponse.json({ success: true, message: 'Inventory created', data: createPayload });
      }

      const text = await response.text();
      if (!text) {
        console.log('✅ Inventory created successfully (empty response body)');
        console.log('   Quantities:', {
          on_hand: createPayload.on_hand_quantity,
          available: createPayload.available_quantity,
          warehouse_id: createPayload.warehouse_id,
        });
        return NextResponse.json({ success: true, message: 'Inventory created', data: createPayload });
      }

      const data = JSON.parse(text);
      console.log('✅ Inventory created successfully:', data);
      return NextResponse.json(data);
    } else if (operation === 'move') {
      // Move inventory from one location to another (change location_id)
      if (!id) {
        return NextResponse.json({ error: 'Missing id for move operation' }, { status: 400 });
      }

      const movePayload = {
        location_id: inventoryData.location_id,
        warehouse_id: inventoryData.warehouse_id || 1,
      };

      console.log(`📍 [POST /api/inventory-sync] MOVE Operation:`);
      console.log(`   ID: ${id}`);
      console.log(`   From location: ???`);
      console.log(`   To location: ${movePayload.location_id}`);
      console.log(`   Warehouse: ${movePayload.warehouse_id}`);

      const response = await fetch(`${urlInventory}?id=eq.${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(movePayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to move inventory:', response.status, errorText);
        return NextResponse.json(
          { error: `Failed to move inventory: ${errorText}` },
          { status: response.status }
        );
      }

      console.log('✅ Inventory moved successfully to location:', movePayload.location_id);
      return NextResponse.json({ success: true, message: 'Inventory moved', data: movePayload });
    } else {
      return NextResponse.json({ error: 'Invalid operation. Use "create", "update", or "move"' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('❌ Inventory sync error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const maxDuration = 120; // 2 minutes for inventory sync operations
