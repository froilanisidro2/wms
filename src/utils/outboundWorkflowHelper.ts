/**
 * Outbound Workflow Helper
 * Manages complete SO workflow: New → Allocated → Ready for Picking → Picking → Ready for Shipment → Shipped
 */

import { getPostgRESTUrl } from './apiUrlBuilder';

export type SOStatus = 'New' | 'Allocated' | 'Ready for Picking' | 'Picking' | 'Ready for Shipment' | 'Shipped' | 'Completed';
export type AllocationMethod = 'FEFO' | 'FIFO' | 'BATCH';

interface AllocationBatch {
  id: number;
  asn_line_id?: number;
  item_id: number;
  item_code: string; // Added to prevent hallucination: must match SO item_code
  batch_number: string;
  expiry_date: string; // ISO date
  manufacturing_date?: string;
  received_at?: string; // ISO date - when batch was received
  on_hand_quantity: number;
  quantity_allocated?: number;
  location_id: number;
  warehouse_id: number;
  pallet_id?: string;
}

interface SOLineForAllocation {
  id: number;
  so_header_id: number;
  item_id: number;
  item_code: string;
  item_name: string;
  ordered_quantity: number;
  allocated_quantity?: number;
  picked_quantity?: number;
  uom: string;
  batchNumber?: string; // Optional: requested batch number for this SO line
}

export interface AllocationResult {
  so_line_id: number;
  item_id: number;
  item_code?: string;
  item_name?: string;
  item_uom?: string;
  batch_number: string;
  allocation_quantity: number;
  asn_line_id?: number;
  expiry_date: string;
  manufacturing_date?: string;
  received_at?: string;
  location_id: number;
  location_code?: string;
  warehouse_id?: number;
  pallet_id?: string;
  allocation_method: AllocationMethod;
  status: 'allocated' | 'partial' | 'pending';
}

/**
 * Check if an expiry date is valid (not expired)
 */
function isValidExpiryDate(expiryDate: string | null): boolean {
  if (!expiryDate) return false;
  const expiry = new Date(expiryDate);
  const today = new Date();
  return expiry > today;
}

/**
 * Sort batches by allocation method
 * FEFO (First Expiry First Out) - allocate oldest VALID expiry first, then expired batches
 * FIFO (First In First Out) - allocate oldest received_at first
 */
function sortBatchesByMethod(
  batches: AllocationBatch[],
  method: AllocationMethod,
  isManualMode: boolean = false
): AllocationBatch[] {
  // In manual mode, preserve the user-selected order
  if (isManualMode) {
    return [...batches];
  }
  
  const sorted = [...batches];
  
  if (method === 'FEFO') {
    // Separate batches with valid vs invalid expiry dates
    const batchesWithValidExpiry = sorted.filter(b => isValidExpiryDate(b.expiry_date));
    const batchesWithInvalidExpiry = sorted.filter(b => !isValidExpiryDate(b.expiry_date));
    
    // Sort batches with valid expiry by date (ascending - earliest expiry first)
    batchesWithValidExpiry.sort((a, b) => {
      const dateA = new Date(a.expiry_date).getTime();
      const dateB = new Date(b.expiry_date).getTime();
      return dateA - dateB;
    });
    
    // Append expired batches at the end (to be used only if needed)
    return [...batchesWithValidExpiry, ...batchesWithInvalidExpiry];
  } else if (method === 'FIFO') {
    // Sort by received_at date (ascending - earliest first)
    sorted.sort((a, b) => {
      const dateA = new Date(a.received_at || '1900-01-01').getTime();
      const dateB = new Date(b.received_at || '1900-01-01').getTime();
      return dateA - dateB;
    });
  } else if (method === 'BATCH') {
    // Sort by batch number (alphanumeric)
    sorted.sort((a, b) => a.batch_number.localeCompare(b.batch_number));
  }
  
  return sorted;
}

/**
 * Allocate SO lines to available batches with smart allocation rules
 * 
 * Allocation Rules:
 * 1. If Batch # is true (batch_tracking enabled) -> Use BATCH Allocation
 * 2. If No Batch # (batch_tracking disabled) or batch_tracking = false:
 *    a. Look for Expiry Date if valid -> Use FEFO Allocation
 *    b. If Expiry Date is invalid/null -> Use FIFO Allocation
 */
export function allocateSOLinesToBatches(
  soLines: SOLineForAllocation[],
  availableBatches: AllocationBatch[],
  allocationMethod: AllocationMethod,
  isManualMode: boolean = false,
  itemConfigs?: { [itemId: number]: { batch_tracking: boolean } }
): AllocationResult[] {
  const results: AllocationResult[] = [];
  const batchesRemaining = availableBatches.map(b => ({
    ...b,
    quantity_allocated: 0
  }));

  for (const line of soLines) {
    let quantityNeeded = line.ordered_quantity;
    const lineAllocations: AllocationResult[] = [];

    // SMART ALLOCATION RULE: Determine allocation method dynamically
    let effectiveMethod = allocationMethod;
    
    if (itemConfigs && itemConfigs[line.item_id]) {
      const itemConfig = itemConfigs[line.item_id];
      
      if (itemConfig.batch_tracking) {
        // Rule 1: Batch tracking enabled -> Use BATCH allocation
        effectiveMethod = 'BATCH';
        console.log(`📦 Item ${line.item_code}: Batch tracking enabled -> Using BATCH allocation`);
      } else {
        // Rule 2: Batch tracking disabled -> Check expiry date validity
        const batchesForItem = batchesRemaining.filter(b => 
          b.item_id === line.item_id && b.item_code === line.item_code
        );
        
        const hasValidExpiry = batchesForItem.some(b => {
          if (!b.expiry_date) return false;
          const expiryDate = new Date(b.expiry_date);
          const today = new Date();
          return expiryDate > today;
        });
        
        if (hasValidExpiry) {
          // Rule 2a: Valid expiry date exists -> Use FEFO allocation
          effectiveMethod = 'FEFO';
          console.log(`📦 Item ${line.item_code}: No batch tracking, valid expiry date found -> Using FEFO allocation`);
        } else {
          // Rule 2b: No valid expiry date or null -> Use FIFO allocation
          effectiveMethod = 'FIFO';
          console.log(`📦 Item ${line.item_code}: No batch tracking, invalid/null expiry date -> Using FIFO allocation`);
        }
      }
    } else if (!isManualMode) {
      // Fallback: Try to infer from batches if no config provided
      const batchesForItem = batchesRemaining.filter(b => 
        b.item_id === line.item_id && b.item_code === line.item_code
      );
      
      const hasValidExpiry = batchesForItem.some(b => {
        if (!b.expiry_date) return false;
        const expiryDate = new Date(b.expiry_date);
        const today = new Date();
        return expiryDate > today;
      });
      
      if (hasValidExpiry) {
        effectiveMethod = 'FEFO';
      } else {
        effectiveMethod = 'FIFO';
      }
    }

    // STEP 1: Try specific batch number if provided (PRIORITY: always try requested batch first)
    if (line.batchNumber) {
      const specificBatch = batchesRemaining.find(b => 
        b.item_id === line.item_id && 
        b.item_code === line.item_code &&
        b.batch_number?.toUpperCase() === line.batchNumber?.toUpperCase() &&
        (b.on_hand_quantity - (b.quantity_allocated || 0)) > 0
      );

      if (specificBatch) {
        const availableInBatch = (specificBatch.on_hand_quantity - (specificBatch.quantity_allocated || 0));
        const allocateQty = Math.min(quantityNeeded, availableInBatch);

        if (allocateQty > 0) {
          lineAllocations.push({
            so_line_id: line.id,
            item_id: line.item_id,
            item_code: line.item_code,
            item_name: line.item_name,
            item_uom: line.uom,
            batch_number: specificBatch.batch_number,
            allocation_quantity: allocateQty,
            asn_line_id: specificBatch.asn_line_id,
            expiry_date: specificBatch.expiry_date,
            manufacturing_date: specificBatch.manufacturing_date,
            received_at: specificBatch.received_at,
            location_id: specificBatch.location_id,
            warehouse_id: specificBatch.warehouse_id,
            pallet_id: specificBatch.pallet_id,
            allocation_method: effectiveMethod,
            status: 'allocated'
          });

          // Update batch remaining quantity
          specificBatch.quantity_allocated = (specificBatch.quantity_allocated || 0) + allocateQty;
          quantityNeeded -= allocateQty;
          
          console.log(`✅ Specific Batch Found: Item ${line.item_code} allocated ${allocateQty} units from batch ${line.batchNumber}`);
        }
      } else {
        console.warn(`⚠️ Specific Batch NOT found: Item ${line.item_code}, Batch ${line.batchNumber}. Will try other batches...`);
      }
    }

    // STEP 2: Get remaining batches for this item - CRITICAL: Verify item_id AND item_code match to prevent hallucination
    const itemBatches = sortBatchesByMethod(
      batchesRemaining.filter(b => {
        // ABSOLUTE MATCH: item_id AND item_code must both match
        const idMatch = b.item_id === line.item_id;
        const codeMatch = b.item_code === line.item_code;
        const qtyAvailable = (b.on_hand_quantity - (b.quantity_allocated || 0)) > 0;
        
        // Skip the specific batch if already allocated
        const isSpecificBatch = line.batchNumber && b.batch_number?.toUpperCase() === line.batchNumber.toUpperCase();
        if (isSpecificBatch && lineAllocations.some(la => la.batch_number === b.batch_number)) {
          return false;
        }
        
        // Log if there's a mismatch (hallucination attempt)
        if (idMatch && !codeMatch) {
          console.warn(`⚠️ HALLUCINATION DETECTED: Batch item_code "${b.item_code}" doesn't match SO item "${line.item_code}" (both have item_id=${line.item_id})`);
        }
        
        // Only return if ALL checks pass
        return idMatch && codeMatch && qtyAvailable;
      }),
      effectiveMethod,
      isManualMode
    );

    // STEP 3: Allocate from remaining batches
    for (const batch of itemBatches) {
      if (quantityNeeded <= 0) break;

      const availableInBatch = (batch.on_hand_quantity - (batch.quantity_allocated || 0));
      const allocateQty = Math.min(quantityNeeded, availableInBatch);

      if (allocateQty > 0) {
        lineAllocations.push({
          so_line_id: line.id,
          item_id: line.item_id,
          item_code: line.item_code,
          item_name: line.item_name,
          item_uom: line.uom,
          batch_number: batch.batch_number,
          allocation_quantity: allocateQty,
          asn_line_id: batch.asn_line_id,
          expiry_date: batch.expiry_date,
          manufacturing_date: batch.manufacturing_date,
          received_at: batch.received_at,
          location_id: batch.location_id,
          warehouse_id: batch.warehouse_id,
          pallet_id: batch.pallet_id,
          allocation_method: effectiveMethod,
          status: 'allocated'
        });

        // Update batch remaining quantity
        batch.quantity_allocated = (batch.quantity_allocated || 0) + allocateQty;
        quantityNeeded -= allocateQty;
      }
    }

    // If not fully allocated
    if (quantityNeeded > 0) {
      lineAllocations.forEach(la => {
        la.status = 'partial';
      });
      
      // Add pending allocation record
      lineAllocations.push({
        so_line_id: line.id,
        item_id: line.item_id,
        item_code: line.item_code,
        item_name: line.item_name,
        item_uom: line.uom,
        batch_number: 'PENDING',
        allocation_quantity: quantityNeeded,
        expiry_date: '',
        location_id: 0,
        allocation_method: effectiveMethod,
        status: 'pending'
      });
    }

    results.push(...lineAllocations);
  }

  return results;
}

/**
 * Validate allocation completeness
 */
export function validateAllocationCompleteness(
  soLines: SOLineForAllocation[],
  allocations: AllocationResult[]
): {
  isComplete: boolean;
  totalOrdered: number;
  totalAllocated: number;
  shortfallItems: string[];
} {
  const totalOrdered = soLines.reduce((sum, line) => sum + line.ordered_quantity, 0);
  const totalAllocated = allocations
    .filter(a => a.status !== 'pending')
    .reduce((sum, a) => sum + a.allocation_quantity, 0);

  const shortfallByLine = soLines.map(line => {
    const allocated = allocations
      .filter(a => a.so_line_id === line.id && a.status !== 'pending')
      .reduce((sum, a) => sum + a.allocation_quantity, 0);
    
    return {
      lineId: line.id,
      itemCode: line.item_code,
      ordered: line.ordered_quantity,
      allocated,
      shortfall: line.ordered_quantity - allocated
    };
  });

  const shortfallItems = shortfallByLine
    .filter(s => s.shortfall > 0)
    .map(s => `${s.itemCode}: ${s.shortfall} units short`);

  return {
    isComplete: totalAllocated >= totalOrdered,
    totalOrdered,
    totalAllocated,
    shortfallItems
  };
}

/**
 * Generate picking list from allocations
 */
export function generatePickingList(allocations: AllocationResult[]): any[] {
  // Group by location for efficient picking
  const pickingByLocation = new Map<number, AllocationResult[]>();
  
  allocations.forEach(alloc => {
    if (alloc.status !== 'pending' && alloc.location_id) {
      if (!pickingByLocation.has(alloc.location_id)) {
        pickingByLocation.set(alloc.location_id, []);
      }
      pickingByLocation.get(alloc.location_id)!.push(alloc);
    }
  });

  // Convert to picking list format
  const pickingList: any[] = [];
  pickingByLocation.forEach((allocations, locationId) => {
    pickingList.push({
      location_id: locationId,
      allocations: allocations.sort((a, b) => a.so_line_id - b.so_line_id),
      total_quantity: allocations.reduce((sum, a) => sum + a.allocation_quantity, 0),
      status: 'pending'
    });
  });

  return pickingList.sort((a, b) => a.location_id - b.location_id);
}

/**
 * Update SO header status
 */
export async function updateSOStatus(
  soHeaderId: number,
  newStatus: SOStatus,
  apiKey: string,
  urlHeaders: string
): Promise<boolean> {
  try {
    const response = await fetch('/api/patch-record', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        table: 'so_headers',
        id: soHeaderId,
        data: { status: newStatus }
      })
    });

    return response.ok;
  } catch (err) {
    console.error('Error updating SO status:', err);
    return false;
  }
}

/**
 * Update individual SO line statuses
 */
export async function updateSOLineStatus(
  soLineIds: number[],
  newStatus: SOStatus
): Promise<boolean> {
  try {
    if (!soLineIds || soLineIds.length === 0) return true;
    
    // Update each SO line status via patch-record API
    const responses = await Promise.all(
      soLineIds.map(lineId => 
        fetch('/api/patch-record', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            table: 'so_lines',
            id: lineId,
            data: { status: newStatus }
          })
        })
      )
    );

    // Check if all updates succeeded
    const allSuccess = responses.every(r => r.ok);
    if (allSuccess) {
      console.log(`✅ Updated ${soLineIds.length} SO lines to status: ${newStatus}`);
    } else {
      console.warn(`⚠️ Some SO line updates failed. Status: ${responses.map(r => r.status).join(', ')}`);
    }
    
    return allSuccess;
  } catch (err) {
    console.error('Error updating SO line statuses:', err);
    return false;
  }
}

/**
 * Update ASN inventory to track allocation status
 * NOTE: We no longer reduce on_hand_quantity. Instead:
 * - on_hand_quantity stays as received quantity
 * - available_quantity = on_hand - allocated (from so_inventory)
 * - Allocations are tracked only in so_inventory table
 */
export async function updateASNInventoryAfterAllocation(
  allocations: AllocationResult[],
  apiKey: string,
  urlAsnInventory: string
): Promise<boolean> {
  try {
    console.log('🔄 [updateASNInventoryAfterAllocation] Allocations saved to so_inventory');
    console.log('📊 No ASN inventory updates needed - tracking via so_inventory table');
    console.log('✅ Allocations recorded successfully');
    return true;
  } catch (err) {
    console.error('❌ [updateASNInventoryAfterAllocation] Error:', err);
    return false;
  }
}

/**
 * Save allocation results to so_inventory table
 */
export async function saveAllocationsToInventory(
  allocations: AllocationResult[],
  warehouseId: number,
  apiKey: string,
  urlSOInventory: string,
  urlAsnInventory?: string
): Promise<boolean> {
  try {
    // Convert AllocationResult[] (flattened list) to SO inventory records
    // Each AllocationResult represents one allocation from one batch
    const payload = allocations
      .filter(a => a.status !== 'pending')
      .map(a => ({
        so_line_id: a.so_line_id,
        warehouse_id: warehouseId,
        item_id: a.item_id,
        item_code: a.item_code || null,
        item_name: a.item_name || null,
        item_uom: a.item_uom || null,
        batch_number: a.batch_number,
        location_id: a.location_id,  // ← Direct field from AllocationResult
        pallet_id: a.pallet_id || null,
        manufacturing_date: a.manufacturing_date || null,
        expiry_date: a.expiry_date || null,
        quantity_ordered: null,  // Not in AllocationResult
        quantity_allocated: a.allocation_quantity,  // ← Direct field from AllocationResult
        quantity_picked: 0,
        quantity_shipped: 0,
        status: 'allocated',
        notes: `Allocated via ${a.allocation_method}`,
        weight_uom_kg: null,
        pallet_config: null
      }));

    console.log('💾 [saveAllocationsToInventory] Sending POST via /api/so-inventory');
    console.log('📊 [saveAllocationsToInventory] Payload:', payload);

    // Use API route instead of direct PostgREST call to avoid timeout
    const response = await fetch('/api/so-inventory', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey
      },
      body: JSON.stringify(payload)
    });

    console.log('🔄 [saveAllocationsToInventory] Response status:', response.status);
    const responseText = await response.text();
    console.log('📝 [saveAllocationsToInventory] Response text:', responseText);

    if (!response.ok) {
      console.error('❌ [saveAllocationsToInventory] Failed to save allocations. Status:', response.status);
      return false;
    }

    console.log('✅ [saveAllocationsToInventory] Successfully saved allocations to SO inventory');

    // IMPORTANT: Update main inventory table to track allocated_quantity
    // This ensures available_quantity = on_hand - allocated is correct
    console.log('📝 [saveAllocationsToInventory] Updating main inventory allocated_quantity...');
    
    try {
      // Prepare allocations for inventory update
      const allocationsForUpdate = allocations
        .filter(a => a.status !== 'pending')
        .map(a => ({
          item_id: a.item_id,
          pallet_id: a.pallet_id,
          allocation_quantity: a.allocation_quantity
        }));

      if (allocationsForUpdate.length > 0) {
        console.log(`📊 Sending ${allocationsForUpdate.length} allocations to inventory-update API`);
        
        // Call server-side API to update inventory (server can access internal IPs)
        const updateRes = await fetch('/api/inventory-update', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            allocations: allocationsForUpdate
          })
        });

        if (!updateRes.ok) {
          const errText = await updateRes.text();
          console.error(`⚠️ Inventory update failed: ${updateRes.status} - ${errText.slice(0, 200)}`);
        } else {
          const result = await updateRes.json();
          console.log(`✅ Inventory update response:`, result);
          
          if (result.updated && result.updated.length > 0) {
            console.log(`✅ Successfully updated ${result.updated.length} inventory records`);
            result.updated.forEach((upd: any) => {
              console.log(`   - ID ${upd.id}: allocated=${upd.allocated_quantity}, available=${upd.available_quantity}`);
            });
          }
          
          if (result.errors && result.errors.length > 0) {
            console.warn(`⚠️ Inventory update had ${result.errors.length} errors:`, result.errors);
          }
        }
      } else {
        console.log(`ℹ️ No allocations to update in inventory`);
      }
    } catch (err: any) {
      console.error('❌ Error calling inventory-update API:', err.message);
    }

    // Now update ASN inventory to reduce on_hand quantities
    if (urlAsnInventory) {
      const asnUpdateSuccess = await updateASNInventoryAfterAllocation(
        allocations,
        apiKey,
        urlAsnInventory
      );
      if (!asnUpdateSuccess) {
        console.error('⚠️ Failed to update ASN inventory after allocation');
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('❌ [saveAllocationsToInventory] Error:', err);
    return false;
  }
}

/**
 * Get workflow status color for display
 */
export function getStatusColor(status: SOStatus): string {
  const colors: Record<SOStatus, string> = {
    'New': 'bg-blue-100 text-blue-800',
    'Allocated': 'bg-purple-100 text-purple-800',
    'Ready for Picking': 'bg-indigo-100 text-indigo-800',
    'Picking': 'bg-yellow-100 text-yellow-800',
    'Ready for Shipment': 'bg-cyan-100 text-cyan-800',
    'Shipped': 'bg-green-100 text-green-800',
    'Completed': 'bg-gray-100 text-gray-800'
  };
  return colors[status] || 'bg-gray-100 text-gray-800';
}

/**
 * Get next status in workflow
 */
export function getNextWorkflowStatus(currentStatus: SOStatus): SOStatus | null {
  const workflow: Record<SOStatus, SOStatus | null> = {
    'New': 'Allocated',
    'Allocated': 'Ready for Picking',
    'Ready for Picking': 'Picking',
    'Picking': 'Ready for Shipment',
    'Ready for Shipment': 'Shipped',
    'Shipped': 'Completed',
    'Completed': null
  };
  return workflow[currentStatus] || null;
}

/**
 * Check if allocation can be performed (must be in New or Allocated status)
 */
export function canAllocate(status: SOStatus): boolean {
  return status === 'New' || status === 'Allocated';
}

/**
 * Check if picking can be performed (must be in Ready for Picking or Picking status)
 */
export function canPick(status: SOStatus): boolean {
  return status === 'Ready for Picking' || status === 'Picking';
}

/**
 * Check if shipment can be performed (must be in Ready for Shipment status)
 */
export function canShip(status: SOStatus): boolean {
  return status === 'Ready for Shipment';
}
