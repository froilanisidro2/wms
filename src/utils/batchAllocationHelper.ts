/**
 * Batch Allocation Helper Utilities
 * Handles batch-aware allocation with FEFO/FIFO strategies and batch-specific matching
 * 
 * ========================================
 * ALLOCATION STRATEGY (Batch-Specific > FEFO > FIFO)
 * ========================================
 * 
 * When allocating SO lines to inventory:
 * 
 * STEP 1: BATCH-SPECIFIC MATCH (Highest Priority)
 *   - If SO line specifies a batch number, try to allocate from that specific batch
 *   - Example: "I need CC5001 from batch BAT-12345"
 *   - If the batch exists and has sufficient quantity, allocate from it
 *   - If batch doesn't exist or insufficient qty, proceed to STEP 2
 * 
 * STEP 2: FEFO FALLBACK (First Expiry First Out)
 *   - Used when batch-specific requirement not found or insufficient
 *   - Sorts batches by expiry_date (earliest first)
 *   - Prevents wasting products close to expiry
 *   - Falls back to manufacturing_date if no expiry dates
 *   - Ensures older stock and items about to expire are used first
 *   - Example: "Expiring on Jan 20" > "Expiring on Jan 25" > "Expiring on Feb 1"
 * 
 * STEP 3: FIFO FALLBACK (First In First Out)
 *   - Used if FEFO + Batch-Specific still insufficient
 *   - Sorts by manufacturing_date or received_date (oldest first)
 *   - Ensures first-received items are allocated first
 *   - Maintains LIFO principles for non-perishable items
 *   - Example: "Received on Dec 15" > "Received on Dec 20" > "Received on Jan 5"
 * 
 * RESULT: Items are allocated using minimum 1-3 batches, with smart fallback
 * that avoids waste (via FEFO) while maintaining fairness (via FIFO)
 */

export type AllocationStrategy = 'FEFO' | 'FIFO' | 'BATCH';

interface BatchRecord {
  id: number;
  item_id: number;
  item_code?: string;
  item_name?: string;
  location_id: number;
  location_code?: string;
  batch_number?: string;
  manufacturing_date?: string;
  expiry_date?: string;
  on_hand_quantity: number;
  available_quantity: number;
  pallet_id?: string;
  received_date?: string;
  created_at?: string;
}

interface AllocationLine {
  soLineId: number;
  itemId: number;
  itemCode: string;
  itemName: string;
  orderedQuantity: number;
  uom?: string;
}

interface AllocationResult {
  soLineId: number;
  itemId: number;
  itemCode: string;
  orderedQuantity: number;
  allocationMethod?: 'BATCH' | 'FEFO' | 'FIFO'; // Track which method was used
  allocations: Array<{
    batchId: number;
    batchNumber?: string;
    expiryDate?: string;
    manufacturingDate?: string;
    locationId: number;
    locationCode?: string;
    palletId?: string;
    allocatedQuantity: number;
  }>;
  totalAllocated: number;
  shortfall: number;
  isFullyAllocated: boolean;
}

interface BatchAllocationParams {
  soLines: AllocationLine[];
  inventory: BatchRecord[];
  strategy: AllocationStrategy;
  apiKey: string;
  urlSOInventory: string;
  soHeaderId: number;
}

/**
 * Get available batches for an item, sorted by allocation strategy
 */
export function getSortedBatches(
  itemId: number,
  inventory: BatchRecord[],
  strategy: AllocationStrategy
): BatchRecord[] {
  // Filter: only available inventory for this item
  const itemBatches = inventory.filter(
    inv => inv.item_id === itemId && inv.available_quantity > 0
  );

  if (strategy === 'FEFO') {
    // FEFO: Sort by expiry_date ASC (earliest expiry first) but prioritize non-expired
    // 1. Separate valid expiry from expired/null
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const validExpiry = itemBatches.filter(b => {
      if (!b.expiry_date) return false;
      const expiry = new Date(b.expiry_date);
      expiry.setHours(0, 0, 0, 0);
      return expiry > today;
    });
    
    const expiredOrNull = itemBatches.filter(b => {
      if (!b.expiry_date) return true;
      const expiry = new Date(b.expiry_date);
      expiry.setHours(0, 0, 0, 0);
      return expiry <= today;
    });
    
    // Sort valid by earliest expiry first
    validExpiry.sort((a, b) => {
      const aExp = new Date(a.expiry_date!).getTime();
      const bExp = new Date(b.expiry_date!).getTime();
      return aExp - bExp;
    });
    
    // Sort expired by FIFO (manufacturing date oldest first)
    expiredOrNull.sort((a, b) => {
      if (a.manufacturing_date && b.manufacturing_date) {
        const aMfg = new Date(a.manufacturing_date).getTime();
        const bMfg = new Date(b.manufacturing_date).getTime();
        if (aMfg !== bMfg) return aMfg - bMfg;
      }
      const aReceived = a.received_date || a.created_at || '';
      const bReceived = b.received_date || b.created_at || '';
      return new Date(aReceived).getTime() - new Date(bReceived).getTime();
    });
    
    // Return valid first (FEFO sorted), then expired (FIFO sorted) as fallback
    return [...validExpiry, ...expiredOrNull];
  } else {
    // FIFO: Sort by manufacturing_date ASC (oldest first)
    // Then by received_date/created_at
    return itemBatches.sort((a, b) => {
      if (a.manufacturing_date && b.manufacturing_date) {
        const aMfg = new Date(a.manufacturing_date).getTime();
        const bMfg = new Date(b.manufacturing_date).getTime();
        if (aMfg !== bMfg) return aMfg - bMfg; // Oldest first
      }

      // Fall back to received date
      const aReceived = a.received_date || a.created_at || '';
      const bReceived = b.received_date || b.created_at || '';
      return new Date(aReceived).getTime() - new Date(bReceived).getTime();
    });
  }
}

/**
 * Check batch expiry status
 */
export function getBatchStatus(expiryDate?: string): 'expired' | 'expiring-soon' | 'ok' {
  if (!expiryDate) return 'ok';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDate);
  expiry.setHours(0, 0, 0, 0);

  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 30) return 'expiring-soon'; // Flag if expiring within 30 days
  return 'ok';
}

/**
 * Allocate SO lines with intelligent batch matching:
 * 
 * STRICT PRIORITY ORDER (NO ALTERNATION):
 * 1. If Batch Lookup enabled → Use BATCH allocation
 * 2. If Batch Lookup disabled + ALL batches have valid expiry → Use FEFO (First Expiry First Out)
 * 3. If Batch Lookup disabled + mixed/no valid expiry → Use FIFO (First In First Out)
 * 
 * Returns allocation plan with strategy used for each batch
 */
export function allocateSOLinesWithBatchFallback(
  soLines: (AllocationLine & { requiredBatch?: string })[],
  inventory: BatchRecord[],
  itemConfigs?: { [itemId: number]: { batch_tracking: boolean } }
): AllocationResult[] {
  const results: AllocationResult[] = [];
  
  console.log('🔍 allocateSOLinesWithBatchFallback called with itemConfigs:', itemConfigs);
  
  // ✅ FIXED DEDUPLICATION: Combine quantities from multiple pallets with same batch/location
  // Instead of keeping one and discarding others, maintain individual pallet mappings
  // Build a map of batch/location → array of individual pallets
  const batchPalletMap = new Map<string, BatchRecord[]>();
  const consolidatedMap = new Map<string, BatchRecord>();
  
  for (const batch of inventory) {
    const uniqueKey = `${batch.item_id}|${batch.batch_number}|${batch.location_id}`;
    
    // Track individual pallets for this batch
    if (!batchPalletMap.has(uniqueKey)) {
      batchPalletMap.set(uniqueKey, []);
    }
    batchPalletMap.get(uniqueKey)!.push(batch);
    
    // Also build consolidated view for quantity checking
    if (!consolidatedMap.has(uniqueKey)) {
      consolidatedMap.set(uniqueKey, {
        ...batch
      });
    } else {
      const existing = consolidatedMap.get(uniqueKey)!;
      existing.on_hand_quantity = (existing.on_hand_quantity || 0) + (batch.on_hand_quantity || 0);
      existing.available_quantity = (existing.available_quantity || 0) + (batch.available_quantity || 0);
      console.log(`📦 Aggregating ${batch.item_code} (${batch.batch_number}): Pallet ${batch.pallet_id} added to group (Total: ${existing.available_quantity} units)`);
    }
  }
  const consolidatedInventory = Array.from(consolidatedMap.values());
  console.log(`✅ Inventory consolidation: ${inventory.length} pallets → ${consolidatedInventory.length} unique batches`);
  console.log(`📦 Pallet groupings:`, Array.from(batchPalletMap.entries()).map(([key, pallets]) => ({
    key,
    palletCount: pallets.length,
    pallets: pallets.map(p => p.pallet_id)
  })));
  
  // ✅ CRITICAL: Track cumulative allocations to prevent double-allocation across SO lines
  const batchAllocationTracker = new Map<string, number>();
  // Also track per-pallet allocations to ensure individual pallets don't exceed their quantity
  const palletAllocationTracker = new Map<string, number>();


  for (const line of soLines) {
    const allocation: AllocationResult = {
      soLineId: line.soLineId,
      itemId: line.itemId,
      itemCode: line.itemCode,
      orderedQuantity: line.orderedQuantity,
      allocations: [],
      totalAllocated: 0,
      shortfall: 0,
      isFullyAllocated: false
    };

    let remainingQty = line.orderedQuantity;
    const itemBatches = consolidatedInventory.filter(batch => {
      // Check if this batch still has available quantity after prior allocations
      const trackerKey = `${batch.item_id}|${batch.batch_number}|${batch.location_id}`;
      const alreadyAllocated = batchAllocationTracker.get(trackerKey) || 0;
      const trueAvailable = (batch.available_quantity || 0) - alreadyAllocated;
      
      return batch.item_id === line.itemId && trueAvailable > 0;
    });

    console.log(`📋 Item ${line.itemCode} (ID: ${line.itemId}): Found ${itemBatches.length} available batches`);
    console.log(`   Batch details:`, itemBatches.map(b => {
      const trackerKey = `${b.item_id}|${b.batch_number}|${b.location_id}`;
      const alreadyAllocated = batchAllocationTracker.get(trackerKey) || 0;
      const trueAvailable = (b.available_quantity || 0) - alreadyAllocated;
      return { batch: b.batch_number, expiry: b.expiry_date, totalAvailable: b.available_quantity, alreadyAllocated, trueAvailable };
    }));

    if (itemBatches.length === 0) {
      allocation.shortfall = remainingQty;
      results.push(allocation);
      continue;
    }

    // STRICT PRIORITY ALLOCATION RULES (NO ALTERNATION):
    // Rule 1: If batch_tracking = true -> Use BATCH allocation
    // Rule 2: If batch_tracking = false + ALL batches have valid expiry -> Use FEFO
    // Rule 3: If batch_tracking = false + mixed/null expiry -> Use FIFO
    
    let allocationStrategy: 'BATCH' | 'FEFO' | 'FIFO' = 'FIFO'; // Default to FIFO (safest fallback)
    
    // Determine strategy based on item config
    if (itemConfigs && itemConfigs[line.itemId]) {
      const itemConfig = itemConfigs[line.itemId];
      console.log(`🔍 Item ${line.itemCode} (ID: ${line.itemId}): batch_tracking=${itemConfig.batch_tracking}`);
      
      if (itemConfig.batch_tracking) {
        // RULE 1: Batch tracking enabled -> Use BATCH allocation (HIGHEST PRIORITY)
        allocationStrategy = 'BATCH';
        console.log(`✅ RULE 1 - Item ${line.itemCode}: Batch tracking enabled -> Using BATCH allocation`);
      } else {
        // RULE 2 & 3: Batch tracking disabled -> Check expiry date validity
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];
        console.log(`📅 Checking expiry dates for ALL batches. Today: ${todayStr}`);
        
        const batchesWithValidExpiry = itemBatches.filter(b => {
          if (!b.expiry_date) {
            console.log(`   ❌ ${b.batch_number}: No expiry date (null)`);
            return false;
          }
          const expiryDate = new Date(b.expiry_date);
          expiryDate.setHours(0, 0, 0, 0);
          const expiryStr = expiryDate.toISOString().split('T')[0];
          const isValid = expiryDate > today;
          console.log(`   ${isValid ? '✅' : '❌'} ${b.batch_number}: Expiry ${expiryStr} ${isValid ? '>' : '<='} Today`);
          return isValid;
        });
        
        const totalBatches = itemBatches.length;
        const validBatchCount = batchesWithValidExpiry.length;
        const anyBatchValid = validBatchCount > 0;
        
        console.log(`   Summary: ${validBatchCount}/${totalBatches} batches have valid expiry dates`);
        
        if (anyBatchValid) {
          // RULE 2: ANY batch has valid expiry -> Use FEFO (2ND PRIORITY)
          allocationStrategy = 'FEFO';
          console.log(`✅ RULE 2 - Item ${line.itemCode}: At least one batch has valid expiry -> Using FEFO allocation`);
        } else {
          // RULE 3: Mixed or no valid expiry -> Use FIFO (3RD PRIORITY)
          allocationStrategy = 'FIFO';
          console.log(`✅ RULE 3 - Item ${line.itemCode}: Mixed/no valid expiry -> Using FIFO allocation`);
        }
      }
    } else {
      console.warn(`⚠️ Item ${line.itemCode} (ID: ${line.itemId}): NOT FOUND in itemConfigs, inferring from batches...`);
      // Fallback: Try to infer from batches if no config provided
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const batchesWithValidExpiry = itemBatches.filter(b => {
        if (!b.expiry_date) return false;
        const expiryDate = new Date(b.expiry_date);
        expiryDate.setHours(0, 0, 0, 0);
        return expiryDate > today;
      });
      
      const anyBatchValid = batchesWithValidExpiry.length > 0;
      
      if (anyBatchValid) {
        allocationStrategy = 'FEFO';
        console.log(`✅ Fallback RULE 2 - Item ${line.itemCode}: At least one batch valid -> Using FEFO allocation`);
      } else {
        allocationStrategy = 'FIFO';
        console.log(`✅ Fallback RULE 3 - Item ${line.itemCode}: Mixed/no valid -> Using FIFO allocation`);
      }
    }

    // STEP 1: Try specific batch number if provided (PRIORITY: always try requested batch first)
    let usedSpecificBatch = false;
    if (line.requiredBatch) {
      const specificBatch = itemBatches.find(
        b => b.batch_number?.toUpperCase() === line.requiredBatch?.toUpperCase()
      );

      if (specificBatch) {
        // ✅ CRITICAL: Check true available quantity accounting for prior allocations
        const trackerKey = `${specificBatch.item_id}|${specificBatch.batch_number}|${specificBatch.location_id}`;
        const alreadyAllocated = batchAllocationTracker.get(trackerKey) || 0;
        const trueAvailable = (specificBatch.available_quantity || 0) - alreadyAllocated;
        
        if (trueAvailable > 0) {
          // Get individual pallets for this specific batch to allocate from them
          const individuaPallets = batchPalletMap.get(trackerKey) || [];
          console.log(`📦 Specific batch ${line.requiredBatch}: Using ${individuaPallets.length} pallet(s)`);
          
          // Allocate from individual pallets
          for (const pallet of individuaPallets) {
            if (remainingQty <= 0) break;
            
            const palletKey = pallet.pallet_id || `${specificBatch.item_id}|${specificBatch.batch_number}|${specificBatch.location_id}|${pallet.id}`;
            const palletAllocated = palletAllocationTracker.get(palletKey) || 0;
            const palletAvailable = (pallet.available_quantity || 0) - palletAllocated;
            
            if (palletAvailable <= 0) continue;
            
            const allocQty = Math.min(remainingQty, palletAvailable);

            allocation.allocations.push({
              batchId: pallet.id,
              batchNumber: pallet.batch_number,
              expiryDate: pallet.expiry_date,
              manufacturingDate: pallet.manufacturing_date,
              locationId: pallet.location_id,
              locationCode: pallet.location_code,
              palletId: pallet.pallet_id, // Use actual pallet_id
              allocatedQuantity: allocQty
            });

            // Track both cluster and individual pallet allocations
            batchAllocationTracker.set(trackerKey, alreadyAllocated + allocQty);
            palletAllocationTracker.set(palletKey, palletAllocated + allocQty);

            allocation.totalAllocated += allocQty;
            remainingQty -= allocQty;
            usedSpecificBatch = true;
            
            console.log(
              `✅ Specific Batch Match: Item ${line.itemCode} allocated ${allocQty}/${palletAvailable} units from Pallet ${pallet.pallet_id}`
            );
          }
          
          // Override strategy to BATCH when specific batch is requested and used
          if (usedSpecificBatch) {
            allocationStrategy = 'BATCH';
          }
        }
      } else {
        console.log(
          `⚠️ Specific Batch NOT found: Item ${line.itemCode}, Batch ${line.requiredBatch}. Falling back to ${allocationStrategy}...`
        );
      }
    }

    // STEP 2: Use the determined allocation strategy
    if (remainingQty > 0) {
      const strategyBatches = getSortedBatches(line.itemId, consolidatedInventory, allocationStrategy);
      console.log(`   🔄 STEP 2: Using ${allocationStrategy} strategy with ${strategyBatches.length} available batches`);
      
      let strategyCount = 0;
      for (const batch of strategyBatches) {
        if (remainingQty <= 0) break;

        // Skip the batch we already used in step 1
        if (line.requiredBatch && batch.batch_number?.toUpperCase() === line.requiredBatch.toUpperCase()) {
          continue;
        }

        // ✅ CRITICAL: Check true available quantity accounting for prior allocations
        const trackerKey = `${batch.item_id}|${batch.batch_number}|${batch.location_id}`;
        const alreadyAllocated = batchAllocationTracker.get(trackerKey) || 0;
        const trueAvailable = (batch.available_quantity || 0) - alreadyAllocated;
        
        if (trueAvailable <= 0) continue; // Skip if no true available qty
        
        // Get individual pallets for this batch/location
        const individuaPallets = batchPalletMap.get(trackerKey) || [];
        console.log(`   📦 Batch ${batch.batch_number}: Found ${individuaPallets.length} individual pallet(s)`);
        
        // Allocate from individual pallets to capture exact pallet_id usage
        for (const pallet of individuaPallets) {
          if (remainingQty <= 0) break;
          
          const palletKey = pallet.pallet_id || `${batch.item_id}|${batch.batch_number}|${batch.location_id}|${pallet.id}`;
          const palletAllocated = palletAllocationTracker.get(palletKey) || 0;
          const palletAvailable = (pallet.available_quantity || 0) - palletAllocated;
          
          if (palletAvailable <= 0) continue; // Skip if this pallet is exhausted
          
          const allocQty = Math.min(remainingQty, palletAvailable);
          strategyCount++;
          const expiryStr = pallet.expiry_date ? new Date(pallet.expiry_date).toLocaleDateString() : 'N/A';
          console.log(`   ✅ Batch ${strategyCount}: ${pallet.batch_number} from Pallet ${pallet.pallet_id} (Expiry: ${expiryStr}) - Allocating ${allocQty}/${palletAvailable} units`);
          
          allocation.allocations.push({
            batchId: pallet.id,
            batchNumber: pallet.batch_number,
            expiryDate: pallet.expiry_date,
            manufacturingDate: pallet.manufacturing_date,
            locationId: pallet.location_id,
            locationCode: pallet.location_code,
            palletId: pallet.pallet_id, // Use actual pallet_id from individual pallet!
            allocatedQuantity: allocQty
          });

          // Track both cluster and individual pallet allocations
          batchAllocationTracker.set(trackerKey, alreadyAllocated + allocQty);
          palletAllocationTracker.set(palletKey, palletAllocated + allocQty);

          allocation.totalAllocated += allocQty;
          remainingQty -= allocQty;
        }
      }

      if (allocation.allocations.length > 0) {
        const batchesUsed = allocation.allocations
          .slice(line.requiredBatch ? 1 : 0)
          .map(a => `${a.batchNumber}(${a.palletId})`)
          .join(', ');
        console.log(`   📦 ${allocationStrategy} Allocation completed: ${batchesUsed}`);
      }
    }

    // STEP 3: If still not fully allocated and strategy wasn't FIFO, try FIFO as last resort
    if (remainingQty > 0 && allocationStrategy !== 'FIFO') {
      const fifoBatches = getSortedBatches(line.itemId, consolidatedInventory, 'FIFO');

      for (const batch of fifoBatches) {
        if (remainingQty <= 0) break;

        // Skip batches we already used
        const alreadyUsed = allocation.allocations.some(a => a.batchId === batch.id);
        if (alreadyUsed) continue;

        // ✅ CRITICAL: Check true available quantity accounting for prior allocations
        const trackerKey = `${batch.item_id}|${batch.batch_number}|${batch.location_id}`;
        const alreadyAllocated = batchAllocationTracker.get(trackerKey) || 0;
        const trueAvailable = (batch.available_quantity || 0) - alreadyAllocated;
        
        if (trueAvailable <= 0) continue;
        
        // Get individual pallets for FIFO fallback
        const individuaPallets = batchPalletMap.get(trackerKey) || [];
        
        for (const pallet of individuaPallets) {
          if (remainingQty <= 0) break;
          
          const palletKey = pallet.pallet_id || `${batch.item_id}|${batch.batch_number}|${batch.location_id}|${pallet.id}`;
          const palletAllocated = palletAllocationTracker.get(palletKey) || 0;
          const palletAvailable = (pallet.available_quantity || 0) - palletAllocated;
          
          if (palletAvailable <= 0) continue;
          
          const allocQty = Math.min(remainingQty, palletAvailable);

          allocation.allocations.push({
            batchId: pallet.id,
            batchNumber: pallet.batch_number,
            expiryDate: pallet.expiry_date,
            manufacturingDate: pallet.manufacturing_date,
            locationId: pallet.location_id,
            locationCode: pallet.location_code,
            palletId: pallet.pallet_id, // Use actual pallet_id from individual pallet
            allocatedQuantity: allocQty
          });

          // Track both cluster and individual pallet allocations
          batchAllocationTracker.set(trackerKey, alreadyAllocated + allocQty);
          palletAllocationTracker.set(palletKey, palletAllocated + allocQty);

          allocation.totalAllocated += allocQty;
          remainingQty -= allocQty;
        }
      }

      if (remainingQty === 0) {
        const batchesUsed = allocation.allocations
          .filter(a => !a.batchNumber?.includes(line.requiredBatch || ''))
          .map(a => `${a.batchNumber}(${a.palletId})`)
          .join(', ');
        console.log(`📋 FIFO Fallback: Item ${line.itemCode} completed allocation using ${batchesUsed}`);
      }
    }

    allocation.shortfall = remainingQty;
    allocation.isFullyAllocated = remainingQty <= 0;
    allocation.allocationMethod = allocationStrategy;

    if (remainingQty > 0) {
      console.warn(
        `❌ Insufficient Inventory: Item ${line.itemCode} has shortfall of ${remainingQty} units. ` +
        `Allocated: ${allocation.totalAllocated}/${line.orderedQuantity}`
      );
    }

    results.push(allocation);
  }

  return results;
}

/**
 * Allocate SO lines to available batches using FEFO/FIFO strategy
 * Returns allocation plan (does not modify inventory yet)
 */
export function allocateSOLines(
  soLines: AllocationLine[],
  inventory: BatchRecord[],
  strategy: AllocationStrategy
): AllocationResult[] {
  const results: AllocationResult[] = [];

  for (const line of soLines) {
    const sortedBatches = getSortedBatches(line.itemId, inventory, strategy);

    const allocation: AllocationResult = {
      soLineId: line.soLineId,
      itemId: line.itemId,
      itemCode: line.itemCode,
      orderedQuantity: line.orderedQuantity,
      allocations: [],
      totalAllocated: 0,
      shortfall: 0,
      isFullyAllocated: false
    };

    let remainingQty = line.orderedQuantity;

    for (const batch of sortedBatches) {
      if (remainingQty <= 0) break;

      const allocQty = Math.min(remainingQty, batch.available_quantity);

      allocation.allocations.push({
        batchId: batch.id,
        batchNumber: batch.batch_number,
        expiryDate: batch.expiry_date,
        manufacturingDate: batch.manufacturing_date,
        locationId: batch.location_id,
        locationCode: batch.location_code,
        palletId: batch.pallet_id,
        allocatedQuantity: allocQty
      });

      allocation.totalAllocated += allocQty;
      remainingQty -= allocQty;
    }

    allocation.shortfall = remainingQty;
    allocation.isFullyAllocated = remainingQty <= 0;

    results.push(allocation);
  }

  return results;
}

/**
 * Validate that all SO lines can be fully allocated
 */
export function validateAllocation(
  results: AllocationResult[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const result of results) {
    if (!result.isFullyAllocated) {
      errors.push(
        `Item ${result.itemCode}: Insufficient inventory. ` +
        `Need ${result.orderedQuantity}, can allocate ${result.totalAllocated}. ` +
        `Shortfall: ${result.shortfall}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Save allocation to so_inventory table
 * Creates records linking SO lines to batches
 */
export async function saveAllocation(
  params: BatchAllocationParams,
  allocationResults: AllocationResult[]
): Promise<{ success: boolean; message: string; errors: string[] }> {
  const { soHeaderId, apiKey, urlSOInventory, strategy } = params;
  const errors: string[] = [];

  try {
    // Flatten allocations: one so_inventory record per batch allocation
    const soInventoryRecords = [];

    for (const result of allocationResults) {
      for (const alloc of result.allocations) {
        soInventoryRecords.push({
          so_header_id: soHeaderId,
          so_line_id: result.soLineId,
          item_id: result.itemId,
          batch_id: alloc.batchId,
          batch_number: alloc.batchNumber,
          location_id: alloc.locationId,
          pallet_id: alloc.palletId,
          allocated_quantity: alloc.allocatedQuantity,
          expiry_date: alloc.expiryDate,
          strategy: strategy,
          status: 'Allocated',
          allocation_date: new Date().toISOString(),
          remarks: `Allocated via ${strategy} strategy`
        });
      }
    }

    // Bulk insert
    if (soInventoryRecords.length > 0) {
      const res = await fetch('/api/so-inventory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey
        },
        body: JSON.stringify(soInventoryRecords)
      });

      if (!res.ok) {
        const errorText = await res.text();
        errors.push(`Failed to save allocation: ${res.status} - ${errorText.slice(0, 300)}`);
        return {
          success: false,
          message: `Failed to save allocation`,
          errors
        };
      }
    }

    return {
      success: true,
      message: `✅ Allocated ${soInventoryRecords.length} batch record(s) to SO`,
      errors: []
    };
  } catch (err: any) {
    errors.push(err.message);
    return {
      success: false,
      message: `❌ Error saving allocation`,
      errors
    };
  }
}

/**
 * Get allocation summary for display
 */
export function getAllocationSummary(results: AllocationResult[]): {
  itemCount: number;
  fullyAllocated: number;
  partiallyAllocated: number;
  unallocated: number;
  totalBatchesUsed: number;
  summary: string;
} {
  const fullyAllocated = results.filter(r => r.isFullyAllocated).length;
  const partiallyAllocated = results.filter(r => !r.isFullyAllocated && r.totalAllocated > 0).length;
  const unallocated = results.filter(r => r.totalAllocated === 0).length;
  const totalBatchesUsed = results.reduce((sum, r) => sum + r.allocations.length, 0);

  const summary =
    fullyAllocated === results.length
      ? `✅ All items fully allocated using ${totalBatchesUsed} batch(es)`
      : `⚠️ Partial allocation: ${fullyAllocated} items full, ${partiallyAllocated} partial, ${unallocated} unallocated`;

  return {
    itemCount: results.length,
    fullyAllocated,
    partiallyAllocated,
    unallocated,
    totalBatchesUsed,
    summary
  };
}

/**
 * Format batch information for display
 */
export function formatBatchInfo(batch: BatchRecord): string {
  const parts: string[] = [];

  if (batch.batch_number) parts.push(`Batch: ${batch.batch_number}`);
  if (batch.pallet_id) parts.push(`Pallet: ${batch.pallet_id}`);
  if (batch.manufacturing_date) {
    const mfg = new Date(batch.manufacturing_date).toLocaleDateString();
    parts.push(`Mfg: ${mfg}`);
  }
  if (batch.expiry_date) {
    const exp = new Date(batch.expiry_date).toLocaleDateString();
    const status = getBatchStatus(batch.expiry_date);
    const badge = status === 'expired' ? '⛔' : status === 'expiring-soon' ? '⚠️' : '✓';
    parts.push(`${badge} Exp: ${exp}`);
  }
  if (batch.location_code) parts.push(`Loc: ${batch.location_code}`);

  return parts.join(' | ');
}

/**
 * Handle remainder pallet logic for outbound allocations
 * 
 * Similar to ASN inbound logic:
 * - If quantity is divisible by pallet capacity → all full pallets
 * - If remainder exists → create additional remainder pallet with adjusted config
 * 
 * @param allocatedQuantity - Total quantity allocated for this SO line
 * @param palletCapacity - Standard capacity per pallet (from item config)
 * @param weightUOM - Weight per unit in kg
 * @param basePalletId - Base pallet ID to build from
 * @returns Array of pallet allocations with quantities and configs
 */
export interface RemainderPalletAllocation {
  palletId: string;
  quantity: number;
  palletConfig: number;
  isRemainder: boolean;
}

export function calculateRemainderPallets(
  allocatedQuantity: number,
  palletCapacity: number,
  weightUOM: number,
  basePalletId: string
): RemainderPalletAllocation[] {
  const allocations: RemainderPalletAllocation[] = [];

  if (allocatedQuantity <= 0) {
    return allocations;
  }

  // Calculate full pallets and remainder
  const fullPallets = Math.floor(allocatedQuantity / palletCapacity);
  const remainder = allocatedQuantity % palletCapacity;

  // Add full pallet allocations
  for (let i = 0; i < fullPallets; i++) {
    allocations.push({
      palletId: `${basePalletId}-P${i + 1}`,
      quantity: palletCapacity,
      palletConfig: palletCapacity,
      isRemainder: false
    });
  }

  // Add remainder pallet if needed
  if (remainder > 0) {
    const remainderConfig = Math.ceil(remainder / weightUOM);
    allocations.push({
      palletId: `${basePalletId}-REM`,
      quantity: remainder,
      palletConfig: remainderConfig,
      isRemainder: true
    });
  }

  console.log(
    `📦 Remainder Pallet Calculation: ${allocatedQuantity} units @ ${palletCapacity} capacity = ` +
    `${fullPallets} full + ${remainder > 0 ? `1 remainder (config: ${Math.ceil(remainder / weightUOM)})` : 'no remainder'}`
  );

  return allocations;
}

