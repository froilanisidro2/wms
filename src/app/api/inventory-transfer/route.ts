import { NextRequest, NextResponse } from 'next/server';
import { clearServerCache } from '@/utils/serverCacheHelper';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
// Internal API call uses environment variables
const baseUrlRaw = process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';
const baseUrl = baseUrlRaw.startsWith('http') ? baseUrlRaw : `http://${baseUrlRaw}`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      item_id,
      source_location_id,
      destination_location_id,
      quantity,
      warehouse_id,
    } = body;

    // Validate required fields
    if (!item_id || !source_location_id || !destination_location_id || !quantity || !warehouse_id) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (quantity <= 0) {
      return NextResponse.json(
        { error: 'Quantity must be greater than 0' },
        { status: 400 }
      );
    }

    // Get source inventory record
    const sourceUrl = `${baseUrl}/inventory?item_id=eq.${item_id}&location_id=eq.${source_location_id}&warehouse_id=eq.${warehouse_id}`;
    const sourceRes = await fetch(sourceUrl, {
      headers: { 'x-api-key': apiKey },
    });

    if (!sourceRes.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch source inventory' },
        { status: 500 }
      );
    }

    const sourceData = await sourceRes.json();
    if (!Array.isArray(sourceData) || sourceData.length === 0) {
      return NextResponse.json(
        { error: 'Source inventory not found' },
        { status: 404 }
      );
    }

    const sourceInventory = sourceData[0];
    const currentOnHand = Number(sourceInventory.on_hand_quantity) || 0;
    const currentAllocated = Number(sourceInventory.allocated_quantity) || 0;
    const currentAvailable = currentOnHand - currentAllocated; // Available = On-hand - Allocated

    // Check if sufficient AVAILABLE quantity (not allocated)
    if (currentAvailable < quantity) {
      return NextResponse.json(
        { error: `Insufficient available quantity. Available: ${currentAvailable}, Allocated: ${currentAllocated}, Requested: ${quantity}` },
        { status: 400 }
      );
    }

    // Get destination inventory record
    const destUrl = `${baseUrl}/inventory?item_id=eq.${item_id}&location_id=eq.${destination_location_id}&warehouse_id=eq.${warehouse_id}`;
    const destRes = await fetch(destUrl, {
      headers: { 'x-api-key': apiKey },
    });

    if (!destRes.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch destination inventory' },
        { status: 500 }
      );
    }

    const destData = await destRes.json();
    let destinationInventory = Array.isArray(destData) && destData.length > 0 ? destData[0] : null;

    // Update source inventory (decrease on_hand_quantity)
    const sourceNewOnHand = currentOnHand - quantity;
    
    // If all quantity is transferred out, delete the source inventory record
    // Otherwise, just update the quantity
    let updateSourceRes;
    if (sourceNewOnHand <= 0) {
      console.log(`🗑️ [transfer] Removing source inventory record (ID: ${sourceInventory.id}) as quantity transferred completely`);
      updateSourceRes = await fetch(`${baseUrl}/inventory?id=eq.${sourceInventory.id}`, {
        method: 'DELETE',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
      });
    } else {
      console.log(`📦 [transfer] Updating source inventory quantity from ${currentOnHand} to ${sourceNewOnHand}`);
      updateSourceRes = await fetch(`${baseUrl}/inventory?id=eq.${sourceInventory.id}`, {
        method: 'PATCH',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          on_hand_quantity: sourceNewOnHand,
          available_quantity: sourceNewOnHand - currentAllocated, // Recalculate available after transfer
        }),
      });
    }

    if (!updateSourceRes.ok) {
      const errorText = await updateSourceRes.text();
      console.error(`❌ [transfer] Failed to update/delete source inventory:`, updateSourceRes.status, errorText);
      return NextResponse.json(
        { error: 'Failed to update source inventory', details: errorText },
        { status: updateSourceRes.status || 500 }
      );
    }

    // Update or create destination inventory
    if (destinationInventory) {
      // Update existing destination inventory
      const destCurrentOnHand = Number(destinationInventory.on_hand_quantity) || 0;
      const destCurrentAllocated = Number(destinationInventory.allocated_quantity) || 0;
      const destNewOnHand = destCurrentOnHand + quantity;
      const destNewAvailable = destNewOnHand - destCurrentAllocated; // Recalculate available

      const updateDestRes = await fetch(`${baseUrl}/inventory?id=eq.${destinationInventory.id}`, {
        method: 'PATCH',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          on_hand_quantity: destNewOnHand,
          available_quantity: destNewAvailable,
          pallet_id: sourceInventory.pallet_id, // Transfer pallet ID from source
          // ✅ Also transfer all metadata
          batch_number: sourceInventory.batch_number,
          asn_number: sourceInventory.asn_number,
          date_received: sourceInventory.date_received,
          asn_status: sourceInventory.asn_status,
          vendor_code: sourceInventory.vendor_code,
          vendor_name: sourceInventory.vendor_name,
        }),
      });

      if (!updateDestRes.ok) {
        const errorText = await updateDestRes.text();
        console.error(`❌ [transfer] Failed to update destination inventory:`, updateDestRes.status, errorText);
        return NextResponse.json(
          { error: 'Failed to update destination inventory', details: errorText },
          { status: 500 }
        );
      }
    } else {
      // Create new destination inventory record with transferred quantity as available
      // Transfer the available_quantity proportionally: (quantity / on_hand) * available_quantity
      const sourceAvailableQty = Number(sourceInventory.available_quantity) || sourceNewOnHand;
      const transferAvailableQty = (quantity / currentOnHand) * sourceAvailableQty;
      
      const createDestRes = await fetch(`${baseUrl}/inventory`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          item_id,
          location_id: destination_location_id,
          warehouse_id,
          on_hand_quantity: quantity,
          allocated_quantity: 0, // Destination starts with no allocations
          available_quantity: transferAvailableQty, // Transfer proportional available qty
          pallet_id: sourceInventory.pallet_id, // Transfer pallet ID
          inventory_status: sourceInventory.inventory_status, // Transfer status from source
          // ✅ Also transfer all metadata
          batch_number: sourceInventory.batch_number,
          asn_number: sourceInventory.asn_number,
          date_received: sourceInventory.date_received,
          asn_status: sourceInventory.asn_status,
          vendor_code: sourceInventory.vendor_code,
          vendor_name: sourceInventory.vendor_name,
        }),
      });

      if (!createDestRes.ok) {
        const errorText = await createDestRes.text();
        console.error(`❌ [transfer] Failed to create destination inventory:`, createDestRes.status, errorText);
        return NextResponse.json(
          { error: 'Failed to create destination inventory', details: errorText },
          { status: 500 }
        );
      }
    }

    // Create stock movement record (attempt, but don't fail if it doesn't work)
    try {
      await fetch(`${baseUrl}/stock_movements`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          item_id,
          from_location_id: source_location_id,
          to_location_id: destination_location_id,
          quantity,
          warehouse_id,
          transaction_type: 'Transfer',
        }),
      });
    } catch (err) {
      console.warn('Failed to create stock movement record:', err);
      // Continue - transfer was successful, just couldn't log it
    }

    // Clear dashboard cache to show real-time updates
    clearServerCache('dashboard');

    return NextResponse.json(
      {
        message: 'Transfer completed successfully',
        source: { id: sourceInventory.id, newOnHand: sourceNewOnHand },
        destination: destinationInventory
          ? { id: destinationInventory.id, newOnHand: (Number(destinationInventory.on_hand_quantity) || 0) + quantity }
          : { created: true, onHand: quantity },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Transfer error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export const maxDuration = 180; // 3 minutes for transfer operations
