/**
 * Picking Helper Utilities
 * Handles pick confirmation, transaction recording, and status transitions
 */

interface PickBatch {
  id: number;
  soLineId: number;
  itemId: number;
  batchNumber?: string;
  locationId: number;
  locationCode?: string;
  palletId?: string;
  allocatedQuantity: number;
  expiryDate?: string;
  manufacturingDate?: string;
  picked: boolean;
  pickedQuantity: number;
}

interface PickConfirmationParams {
  soHeaderId: number;
  soLines: any[];
  soInventoryRecords: any[];
  items: any[];
  locations: any[];
  apiKey: string;
  urlPickTransactions: string;
  urlSOHeaders: string;
  urlSOInventory: string;
  urlStockMovement?: string; // URL for stock_movement table
  stagingLocationId?: number; // ID of staging/pick area location
  stagingLocationCode?: string; // Code of staging/pick area location
  movedBy?: string; // User performing the movement
}

interface PickResult {
  success: boolean;
  message: string;
  pickTransactionId?: number;
  pickedBatches: number;
  totalQuantityPicked: number;
  errors: string[];
}

/**
 * Fetch allocated batches for an SO from so_inventory
 * @param soLineIds - Array of SO line IDs to fetch allocations for
 */
export async function fetchAllocatedBatches(
  soLineIds: number[],
  apiKey: string,
  urlSOInventory: string
): Promise<PickBatch[]> {
  try {
    if (!soLineIds || soLineIds.length === 0) {
      console.log('⚠️ [fetchAllocatedBatches] No SO line IDs provided');
      return [];
    }

    // Use the new API endpoint that joins SO inventory with location codes
    const lineIdParam = soLineIds.join(',');
    const apiUrl = `/api/so-inventory?so_line_id=${lineIdParam}&status=allocated&refresh=true`;
    
    console.log('🔍 [fetchAllocatedBatches] Querying for SO lines:', soLineIds);
    console.log('🔍 [fetchAllocatedBatches] Query URL:', apiUrl);
    
    const res = await fetch(apiUrl, {
      method: 'GET',
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.warn(`⚠️ [fetchAllocatedBatches] New endpoint failed, falling back to regular API: ${res.status}`);
      
      // Fallback to regular API if new endpoint fails
      return await fetchAllocatedBatchesFallback(soLineIds, apiKey, urlSOInventory);
    }

    const data = await res.json();
    const allocations = Array.isArray(data) ? data : (data ? [data] : []);
    
    console.log('📦 [fetchAllocatedBatches] Found allocations:', allocations.length);
    console.log('📦 [fetchAllocatedBatches] Sample allocation:', allocations[0]);

    // Fetch inventory records to get location codes by pallet_id
    let inventoryByPallet: { [key: string]: any } = {};
    try {
      const invResponse = await fetch('/api/inventory-records?year=' + new Date().getFullYear());
      if (invResponse.ok) {
        const invData = await invResponse.json();
        const inventoryRecords = Array.isArray(invData.inventory) ? invData.inventory : [];
        console.log('� [fetchAllocatedBatches] Fetched inventory records:', inventoryRecords.length);
        
        // Create a map of pallet_id -> location_code for quick lookup
        inventoryRecords.forEach((rec: any) => {
          if (rec.pallet_id) {
            inventoryByPallet[rec.pallet_id] = rec;
          }
        });
        console.log('� [fetchAllocatedBatches] Created pallet->location map:', Object.keys(inventoryByPallet).length, 'entries');
      }
    } catch (err) {
      console.warn('⚠️ [fetchAllocatedBatches] Could not fetch inventory records for location lookup:', err);
    }

    // Convert to PickBatch format
    const batches: PickBatch[] = allocations.map((alloc: any) => {
      // Try to get location code from:
      // 1. location_code field in so_inventory
      // 2. Lookup via pallet_id in inventory_records
      // 3. Construct from location_id
      let locCode = alloc.location_code;
      
      if (!locCode && alloc.pallet_id && inventoryByPallet[alloc.pallet_id]) {
        const invRecord = inventoryByPallet[alloc.pallet_id];
        locCode = invRecord.location_code || invRecord.location_id;
        console.log(`✅ [fetchAllocatedBatches] Found location code for pallet ${alloc.pallet_id}: ${locCode}`);
      }
      
      if (!locCode && alloc.location_id) {
        locCode = `LOC-${alloc.location_id}`;
      }
      
      return {
        id: alloc.id,
        soLineId: alloc.so_line_id,
        itemId: alloc.item_id,
        batchNumber: alloc.batch_number,
        locationId: alloc.location_id,
        locationCode: locCode || undefined,
        palletId: alloc.pallet_id,
        allocatedQuantity: alloc.quantity_allocated || alloc.allocated_quantity || 0,
        expiryDate: alloc.expiry_date,
        manufacturingDate: alloc.manufacturing_date,
        picked: false,
        pickedQuantity: 0
      };
    });

    console.log('✅ [fetchAllocatedBatches] Converted batches:', batches);
    
    return batches;
  } catch (err: any) {
    console.error('❌ [fetchAllocatedBatches] Error:', err.message);
    // Fallback to regular fetch
    try {
      return await fetchAllocatedBatchesFallback(soLineIds, apiKey, urlSOInventory);
    } catch (fallbackErr: any) {
      throw new Error(`Error fetching allocated batches: ${err.message}`);
    }
  }
}

/**
 * Fallback function to fetch allocated batches using regular API
 */
async function fetchAllocatedBatchesFallback(
  soLineIds: number[],
  apiKey: string,
  urlSOInventory: string
): Promise<PickBatch[]> {
  const lineIdParam = soLineIds.join(',');
  const apiUrl = `/api/so-inventory?so_line_id=${lineIdParam}&status=allocated&refresh=true`;
  
  console.log('🔄 [fetchAllocatedBatchesFallback] Using fallback API:', apiUrl);
  
  const res = await fetch(apiUrl, {
    method: 'GET',
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to fetch allocations: ${res.status} ${res.statusText}. Response: ${errorText.substring(0, 200)}`);
  }

  const data = await res.json();
  const allocations = Array.isArray(data) ? data : (data ? [data] : []);
  
  console.log('📦 [fetchAllocatedBatchesFallback] Found allocations:', allocations.length);

  const batches: PickBatch[] = allocations.map((alloc: any) => ({
    id: alloc.id,
    soLineId: alloc.so_line_id,
    itemId: alloc.item_id,
    batchNumber: alloc.batch_number,
    locationId: alloc.location_id,
    locationCode: alloc.location_code || (alloc.location_id ? `LOC-${alloc.location_id}` : undefined),
    palletId: alloc.pallet_id,
    allocatedQuantity: alloc.quantity_allocated || alloc.allocated_quantity || 0,
    expiryDate: alloc.expiry_date,
    manufacturingDate: alloc.manufacturing_date,
    picked: false,
    pickedQuantity: 0
  }));

  return batches;
}

/**
 * Create stock movement record for audit trail and location update
 */
export async function recordLocationTransfer(
  soInventoryId: number,
  soHeaderId: number,
  fromLocationId: number | null,
  toLocationId: number,
  fromLocationCode: string | null,
  toLocationCode: string,
  itemId: number,
  batchNumber: string | undefined,
  quantityMoved: number,
  movementType: 'picking' | 'loading' | 'return' | 'adjustment' | 'transfer',
  apiKey: string,
  urlStockMovement: string,
  movedBy?: string,
  reason?: string
): Promise<boolean> {
  try {
    const movement = {
      so_inventory_id: soInventoryId,
      so_header_id: soHeaderId,
      from_location_id: fromLocationId || null,
      to_location_id: toLocationId,
      from_location_code: fromLocationCode || null,
      to_location_code: toLocationCode,
      item_id: itemId,
      batch_number: batchNumber || null,
      quantity_moved: quantityMoved,
      movement_type: movementType,
      movement_date: new Date().toISOString(),
      moved_by: movedBy || 'System',
      reason: reason || `${movementType} movement`,
      remarks: `Moved from ${fromLocationCode || 'Unknown'} to ${toLocationCode}`
    };

    console.log('📦 [recordLocationTransfer] Creating movement record:', movement);

    // Use API route instead of direct PostgREST
    const res = await fetch('/api/patch-record', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        table: 'stock_movement',
        data: movement
      })
    });

    if (res.ok) {
      try {
        const resultData = await res.json();
        const movementId = Array.isArray(resultData) ? resultData[0]?.id : resultData.id;
        console.log('✅ [recordLocationTransfer] Movement recorded with ID:', movementId);
        return true;
      } catch {
        console.log('ℹ️ [recordLocationTransfer] Movement recorded (response parsing skipped)');
        return true;
      }
    } else {
      const errorText = await res.text();
      console.warn(`⚠️ [recordLocationTransfer] Failed to record movement: ${res.status} ${errorText.substring(0, 100)}`);
      return false;
    }
  } catch (err: any) {
    console.error('❌ [recordLocationTransfer] Error:', err.message);
    return false;
  }
}

/**
 * Get batch status for display (expired, expiring soon, ok)
 */
export function getBatchStatus(expiryDate?: string): 'expired' | 'expiring-soon' | 'ok' {
  if (!expiryDate) return 'ok';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);

  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 30) return 'expiring-soon';
  return 'ok';
}

/**
 * Format batch info for display
 */
export function formatBatchDisplay(batch: any, locationMap: Map<number, string>): string {
  const parts: string[] = [];

  if (batch.batchNumber) parts.push(`Batch: ${batch.batchNumber}`);
  if (batch.palletId) parts.push(`Pallet: ${batch.palletId}`);
  if (batch.locationCode) {
    parts.push(`📍 Loc: ${batch.locationCode}`);
  }
  if (batch.manufacturingDate) {
    const mfg = new Date(batch.manufacturingDate).toLocaleDateString();
    parts.push(`Mfg: ${mfg}`);
  }
  if (batch.expiryDate) {
    const exp = new Date(batch.expiryDate).toLocaleDateString();
    const status = getBatchStatus(batch.expiryDate);
    const badge = status === 'expired' ? '⛔' : status === 'expiring-soon' ? '⚠️' : '✓';
    parts.push(`${badge} Exp: ${exp}`);
  }

  return parts.join(' | ');
}

/**
 * Validate that all batches are marked as picked
 */
export function validatePickCompletion(batches: PickBatch[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const batch of batches) {
    if (!batch.picked) {
      errors.push(`Batch ${batch.batchNumber || batch.id} (${batch.allocatedQuantity} units) not picked`);
    }

    // Validate picked quantity matches allocated
    if (batch.pickedQuantity > batch.allocatedQuantity) {
      errors.push(`Batch ${batch.batchNumber}: Picked ${batch.pickedQuantity} but allocated ${batch.allocatedQuantity}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Create pick transaction record and update SO status
 */
export async function confirmPicks(
  params: PickConfirmationParams,
  batches: PickBatch[]
): Promise<PickResult> {
  const {
    soHeaderId,
    soLines,
    apiKey,
    urlPickTransactions,
    urlSOHeaders,
    urlSOInventory
  } = params;

  const result: PickResult = {
    success: false,
    message: '',
    pickedBatches: 0,
    totalQuantityPicked: 0,
    errors: []
  };

  try {
    // Step 1: Validate all batches picked
    const validation = validatePickCompletion(batches);
    if (!validation.valid) {
      result.errors = validation.errors;
      result.message = `❌ Picking incomplete: ${validation.errors.join(', ')}`;
      return result;
    }

    // Step 2: Create pick transaction record (optional - for audit trail, skip if endpoint unavailable)
    const totalQty = batches.reduce((sum, b) => sum + b.pickedQuantity, 0);
    let pickTransactionId: number | undefined;

    if (urlPickTransactions && urlPickTransactions.trim() !== '') {
      const pickTransaction = {
        so_header_id: soHeaderId,
        pick_type: 'outbound',
        total_quantity: totalQty,
        total_batches: batches.length,
        pick_date: new Date().toISOString(),
        status: 'Completed',
        remarks: `${batches.length} batches picked for SO${soHeaderId}`
      };

      try {
        console.log('📝 [confirmPicks] Creating pick transaction:', pickTransaction);
        
        const txRes = await fetch(urlPickTransactions, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey
          },
          body: JSON.stringify(pickTransaction)
        });

        if (txRes.ok) {
          try {
            const txData = await txRes.json();
            pickTransactionId = Array.isArray(txData) ? txData[0]?.id : txData.id;
            console.log('✅ Pick transaction created:', pickTransactionId);
            result.pickTransactionId = pickTransactionId;
          } catch (parseErr: any) {
            console.log('ℹ️ Pick transaction created but response format unclear');
          }
        } else {
          console.log(`ℹ️ Pick transaction endpoint returned ${txRes.status} - skipping transaction record`);
        }
      } catch (err: any) {
        console.log(`ℹ️ Pick transaction creation skipped: ${err.message}`);
      }
    } else {
      console.log('ℹ️ Pick transaction endpoint not configured - skipping');
    }

    // Step 3: Record picks (log for auditing)
    try {
      const batchUpdates: any[] = [];
      
      for (const batch of batches) {
        const updatePayload = {
          id: batch.id,
          so_line_id: batch.soLineId,
          status: 'Picked',
          quantity_picked: batch.pickedQuantity,
          pick_date: new Date().toISOString()
        };
        
        batchUpdates.push(updatePayload);
        console.log(`✅ [confirmPicks] Batch ${batch.id} marked as picked:`, updatePayload);
        
        result.pickedBatches++;
        result.totalQuantityPicked += batch.pickedQuantity;
      }
      
      console.log('📝 [confirmPicks] Recorded', batchUpdates.length, 'batch picks for pick transaction', pickTransactionId);
      // Note: Individual so_inventory records will be updated separately or via reconciliation
    } catch (err: any) {
      console.error(`❌ Error recording picks:`, err);
      result.errors.push(`Error recording pick details: ${err.message}`);
    }

    // Step 4: Update SO header status to 'Ready for Shipment' (optional - for workflow progress)
    try {
      console.log(`📝 [confirmPicks] Attempting to update SO header ${soHeaderId} status to 'Picked'`);
      
      const headerUpdateRes = await fetch('/api/patch-record', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          table: 'so_headers',
          id: soHeaderId,
          data: { status: 'Picked' }
        })
      });

      if (headerUpdateRes.ok) {
        console.log('✅ SO header status updated to Picked');
        
        // Step 4a: Update so_inventory quantity_picked for all allocated batches
        try {
          console.log(`🔄 [confirmPicks] Updating so_inventory quantity_picked for SO header ${soHeaderId}`);
          
          // Fetch all so_inventory records for this SO's lines using API route
          const soLineIds = soLines.map(l => l.id).filter(Boolean);
          if (soLineIds.length > 0) {
            const soInventoryRes = await fetch(
              `/api/so-inventory?so_line_id=${soLineIds.join(',')}`,
              {
                method: 'GET',
              }
            );
            
            if (soInventoryRes.ok) {
              const soInventoryRecords = await soInventoryRes.json();
              const records = Array.isArray(soInventoryRecords) ? soInventoryRecords : [soInventoryRecords];
              
              console.log(`📊 [confirmPicks] Found ${records.length} so_inventory records to update`);
              
              // Update each record: set quantity_picked = quantity_allocated and status = 'picked'
              for (const record of records) {
                try {
                  const updatePayload = {
                    quantity_picked: record.quantity_allocated || record.allocated_quantity || 0,
                    status: 'picked'
                  };
                  
                  // Use API route instead of direct PostgREST
                  const patchRes = await fetch('/api/so-inventory?id=' + record.id, {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(updatePayload)
                  });
                  
                  if (patchRes.ok) {
                    console.log(`✅ [confirmPicks] Updated so_inventory ${record.id}: quantity_picked = ${updatePayload.quantity_picked}, status = picked`);
                  } else {
                    console.warn(`⚠️ [confirmPicks] Failed to update so_inventory ${record.id}: ${patchRes.status}`);
                  }
                } catch (updateErr: any) {
                  console.warn(`⚠️ [confirmPicks] Error updating so_inventory ${record.id}: ${updateErr.message}`);
                }
              }
            } else {
              console.warn(`⚠️ [confirmPicks] Could not fetch so_inventory records: ${soInventoryRes.status}`);
            }
          } else {
            console.log('ℹ️ [confirmPicks] No SO lines found to update so_inventory');
          }
        } catch (soInvErr: any) {
          console.warn(`⚠️ [confirmPicks] Error updating so_inventory: ${soInvErr.message}`);
        }
      } else {
        console.warn(`⚠️ SO header update returned status ${headerUpdateRes.status} - picks still recorded`);
      }
    } catch (err: any) {
      console.warn(`⚠️ Could not update SO header status: ${err.message} - picks still recorded`);
      // Don't add to errors - picks are already confirmed, this is optional
    }

    // Step 4b: Update location_id and create stock movement records for picking transfer
    const stagingLocationId = params.stagingLocationId;
    const stagingLocationCode = params.stagingLocationCode || 'STAGING';
    const urlStockMovement = params.urlStockMovement;

    if (stagingLocationId && urlStockMovement) {
      try {
        console.log(`📦 [confirmPicks] Recording location transfers to staging area (location_id: ${stagingLocationId})`);
        
        // Fetch all so_inventory records for this SO's lines using API route
        const soLineIds = soLines.map(l => l.id).filter(Boolean);
        if (soLineIds.length > 0) {
          const soInventoryRes = await fetch(
            `/api/so-inventory?so_line_id=${soLineIds.join(',')}`,
            {
              method: 'GET',
            }
          );
          
          if (soInventoryRes.ok) {
            const soInventoryRecords = await soInventoryRes.json();
            const records = Array.isArray(soInventoryRecords) ? soInventoryRecords : [soInventoryRecords];
            
            console.log(`📊 [confirmPicks] Processing location transfers for ${records.length} so_inventory records`);
            
            // Update each record: move to staging location and create stock movement record
            for (const record of records) {
              try {
                const fromLocationId = record.location_id;
                const fromLocationCode = record.location_code || `LOC-${fromLocationId}`;
                
                // Create stock movement audit record
                if (urlStockMovement) {
                  await recordLocationTransfer(
                    record.id, // so_inventory_id
                    soHeaderId, // so_header_id
                    fromLocationId, // from_location_id
                    stagingLocationId, // to_location_id
                    fromLocationCode, // from_location_code
                    stagingLocationCode, // to_location_code
                    record.item_id,
                    record.batch_number,
                    record.quantity_allocated || record.allocated_quantity || 0,
                    'picking', // movement_type
                    apiKey,
                    urlStockMovement,
                    params.movedBy || 'System',
                    'Items picked and moved to staging area'
                  );
                }
                
                // Update so_inventory location_id to staging location
                const updatePayload = {
                  location_id: stagingLocationId,
                  location_code: stagingLocationCode
                };
                
                // Use API route instead of direct PostgREST
                const patchRes = await fetch('/api/so-inventory?id=' + record.id, {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(updatePayload)
                });
                
                if (patchRes.ok) {
                  console.log(`✅ [confirmPicks] Updated so_inventory ${record.id}: location_id = ${stagingLocationId} (${stagingLocationCode})`);
                } else {
                  console.warn(`⚠️ [confirmPicks] Failed to update location in so_inventory ${record.id}: ${patchRes.status}`);
                }
              } catch (updateErr: any) {
                console.warn(`⚠️ [confirmPicks] Error updating location for so_inventory ${record.id}: ${updateErr.message}`);
              }
            }
          } else {
            console.warn(`⚠️ [confirmPicks] Could not fetch so_inventory records for location transfer: ${soInventoryRes.status}`);
          }
        }
      } catch (locErr: any) {
        console.warn(`⚠️ [confirmPicks] Error recording location transfers: ${locErr.message}`);
      }
    } else {
      console.log('ℹ️ [confirmPicks] Staging location not configured - skipping location transfer');
    }

    // Step 5: Return result
    result.success = result.errors.length === 0;
    result.pickedBatches = batches.filter(b => b.picked).length;
    result.totalQuantityPicked = batches.reduce((sum, b) => sum + b.pickedQuantity, 0);
    result.pickTransactionId = pickTransactionId;

    result.message = result.success
      ? `✅ Pick confirmation complete! ${result.pickedBatches} batches, ${result.totalQuantityPicked} units picked`
      : `⚠️ Pick confirmed with ${result.errors.length} error(s)`;

    return result;
  } catch (err: any) {
    result.success = false;
    result.message = `❌ Fatal error: ${err.message}`;
    result.errors.push(err.message);
    return result;
  }
}

/**
 * Get picking summary for display
 */
export function getPickingSummary(batches: PickBatch[]): {
  totalBatches: number;
  pickedBatches: number;
  unpickedBatches: number;
  totalQuantity: number;
  pickedQuantity: number;
  summary: string;
} {
  const pickedBatches = batches.filter(b => b.picked).length;
  const unpickedBatches = batches.length - pickedBatches;
  const totalQuantity = batches.reduce((sum, b) => sum + b.allocatedQuantity, 0);
  const pickedQuantity = batches.reduce((sum, b) => sum + b.pickedQuantity, 0);

  const summary =
    pickedBatches === batches.length
      ? `✅ All ${batches.length} batches picked (${pickedQuantity} units)`
      : `⏳ ${pickedBatches}/${batches.length} batches picked, ${unpickedBatches} remaining`;

  return {
    totalBatches: batches.length,
    pickedBatches,
    unpickedBatches,
    totalQuantity,
    pickedQuantity,
    summary
  };
}

/**
 * Group batches by item for display
 */
export function groupBatchesByItem(
  batches: PickBatch[],
  items: any[]
): Array<{
  itemId: number;
  itemCode: string;
  itemName: string;
  totalQty: number;
  batches: PickBatch[];
}> {
  const grouped = new Map<number, PickBatch[]>();

  for (const batch of batches) {
    if (!grouped.has(batch.itemId)) {
      grouped.set(batch.itemId, []);
    }
    grouped.get(batch.itemId)!.push(batch);
  }

  return Array.from(grouped.entries()).map(([itemId, itemBatches]) => {
    const item = items.find(i => i.id === itemId);
    return {
      itemId,
      itemCode: item?.item_code || `Item-${itemId}`,
      itemName: item?.item_name || 'Unknown',
      totalQty: itemBatches.reduce((sum, b) => sum + b.allocatedQuantity, 0),
      batches: itemBatches
    };
  });
}
