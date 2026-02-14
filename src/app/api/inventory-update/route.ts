import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlInventory = process.env.NEXT_PUBLIC_URL_INVENTORY || '';

interface AllocationToUpdate {
  item_id: number;
  pallet_id?: string;
  allocation_quantity: number;
}

/**
 * POST /api/inventory-update
 * Update inventory allocated_quantity based on allocations
 * 
 * Request body:
 * {
 *   allocations: [
 *     { item_id: 3, pallet_id: "PAL-xxx", allocation_quantity: 6 },
 *     ...
 *   ]
 * }
 * 
 * This endpoint:
 * 1. Fetches inventory records from the database (server can access internal IP)
 * 2. Matches allocations to inventory by item_id + pallet_id
 * 3. Updates allocated_quantity in inventory records
 * 4. Returns the updated records
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const allocations: AllocationToUpdate[] = body.allocations || [];

    if (!allocations || allocations.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No allocations to update',
        updated: []
      });
    }

    if (!urlInventory) {
      return NextResponse.json({
        success: false,
        message: 'NEXT_PUBLIC_URL_INVENTORY not configured',
        updated: []
      }, { status: 500 });
    }

    console.log(`📝 [inventory-update] Processing ${allocations.length} allocations`);

    // Fetch all inventory records from database (server can access internal IP)
    const invFetchUrl = `${urlInventory}?limit=10000`;
    console.log(`🔍 Fetching inventory from: ${invFetchUrl}`);

    const invFetchRes = await fetch(invFetchUrl, {
      method: 'GET',
      headers: { 'x-api-key': apiKey }
    });

    if (!invFetchRes.ok) {
      console.error(`❌ Failed to fetch inventory: ${invFetchRes.status}`);
      return NextResponse.json({
        success: false,
        message: `Failed to fetch inventory: ${invFetchRes.status}`,
        updated: []
      }, { status: invFetchRes.status });
    }

    const allInventoryRecords = await invFetchRes.json();
    const inventoryArray = Array.isArray(allInventoryRecords) ? allInventoryRecords : (allInventoryRecords ? [allInventoryRecords] : []);

    console.log(`✅ Fetched ${inventoryArray.length} inventory records`);

    // Process each allocation
    const updated = [];
    const errors = [];

    for (const alloc of allocations) {
      try {
        // Find matching inventory record by item_id + pallet_id
        let matchingRecords = inventoryArray.filter((inv: any) =>
          inv.item_id === alloc.item_id && 
          inv.pallet_id === alloc.pallet_id
        );

        // Fallback: If no match by pallet, try by item_id only
        if (matchingRecords.length === 0 && alloc.pallet_id) {
          console.log(`ℹ️ No match for item=${alloc.item_id}, pallet=${alloc.pallet_id}. Trying item_id only...`);
          matchingRecords = inventoryArray.filter((inv: any) => inv.item_id === alloc.item_id);
        }

        if (matchingRecords.length === 0) {
          const msg = `No inventory found for item_id=${alloc.item_id}, pallet_id=${alloc.pallet_id}`;
          console.warn(`⚠️ ${msg}`);
          errors.push(msg);
          continue;
        }

        // Update first matching inventory record
        const invRecord = matchingRecords[0];
        const currentAllocated = invRecord.allocated_quantity || 0;
        const newAllocated = currentAllocated + alloc.allocation_quantity;
        const newAvailable = Math.max(0, (invRecord.on_hand_quantity || 0) - newAllocated);

        console.log(`📦 Updating inventory ID ${invRecord.id}:`);
        console.log(`   Item: ${alloc.item_id}, Pallet: ${alloc.pallet_id}`);
        console.log(`   Allocated: ${currentAllocated} → ${newAllocated}`);
        console.log(`   Available: ${invRecord.available_quantity} → ${newAvailable}`);

        // Send PATCH request to update inventory
        const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://');
        const patchUrl = (process.env.NEXT_PUBLIC_URL_INVENTORY?.replace('/inventory', '') || API_BASE).replace(/^https?:\/\//, 'http://');
        const patchRes = await fetch(`${patchUrl}/inventory?id=eq.${invRecord.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
          },
          body: JSON.stringify({
            allocated_quantity: newAllocated,
            available_quantity: newAvailable
          })
        });

        if (!patchRes.ok) {
          const errText = await patchRes.text();
          const msg = `Failed to update inventory ${invRecord.id}: ${patchRes.status}`;
          console.warn(`⚠️ ${msg}`);
          errors.push(msg);
        } else {
          console.log(`✅ Updated inventory ID ${invRecord.id}`);
          updated.push({
            id: invRecord.id,
            item_id: alloc.item_id,
            pallet_id: alloc.pallet_id,
            allocated_quantity: newAllocated,
            available_quantity: newAvailable
          });
        }
      } catch (err: any) {
        const msg = `Error processing allocation: ${err.message}`;
        console.error(`❌ ${msg}`);
        errors.push(msg);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      message: `Updated ${updated.length} inventory records${errors.length > 0 ? `, ${errors.length} errors` : ''}`,
      updated,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('❌ Error in inventory-update:', error);
    return NextResponse.json({
      success: false,
      message: `Error: ${error.message}`,
      updated: []
    }, { status: 500 });
  }
}

export const maxDuration = 120; // 2 minutes for inventory updates
