/**
 * Putaway Helper Utilities
 * Handles single and split putaway transactions with inventory sync
 */

interface ASNLine {
  id: number;
  item_code: string;
  item_name?: string;
  batch_number?: string;
  manufacturing_date?: string;
  expiry_date?: string;
  pallet_id?: string;
  weight_uom_kg?: number;
  pallet_config?: string;
  received_quantity?: number;
  receivedQuantity?: number;
  expected_quantity?: number;
  item_id?: number;
}

interface ASNHeader {
  id: number;
  asn_number: string;
}

interface Item {
  id: number;
  item_code: string;
  item_name: string;
}

interface PutawaySubmitParams {
  quantity: number;
  location: string; // location_id
  line: ASNLine;
  header: ASNHeader;
  items: Item[];
  apiKey: string;
  generatePalletId: () => string;
  palletId?: string; // Optional: use provided ID or generate new one
  warehouseId?: number; // Optional: warehouse to associate inventory with (defaults to 1)
}

interface SplitRecord {
  quantity: number;
  location: string;
  reason: 'good' | 'damage' | 'missing' | 'defective'; // Reason for split
}

interface SplitPutawayParams extends Omit<PutawaySubmitParams, 'quantity' | 'location' | 'generatePalletId'> {
  splits: SplitRecord[]; // Array of split records with reason
}

/**
 * Generate pallet ID based on reason
 */
export function generatePalletIdByReason(reason: 'good' | 'damage' | 'missing' | 'defective'): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  // Different prefix based on reason
  const prefixes: Record<string, string> = {
    good: 'PAL', // Good inventory
    damage: 'DAM', // Damaged
    missing: 'MIS', // Missing
    defective: 'DEF', // Defective
  };

  const prefix = prefixes[reason] || 'PAL';
  return `${prefix}-${yy}${mm}${dd}${hh}${min}${ss}`;
}

/**
 * Sync inventory to ASN Inventory table
 */
async function syncASNInventory(
  lineId: number,
  itemId: number,
  quantity: number,
  location: number,
  line: ASNLine,
  apiKey: string,
  warehouseId?: number
): Promise<void> {
  try {
    const asnInventoryPayload = {
      asn_line_id: lineId,
      warehouse_id: warehouseId || 1,
      item_id: itemId,
      batch_number: line.batch_number,
      expiry_date: line.expiry_date || null,
      manufacturing_date: line.manufacturing_date || null,
      pallet_id: line.pallet_id || null,
      weight_uom_kg: line.weight_uom_kg ? Number(line.weight_uom_kg) : null,
      pallet_config: line.pallet_config || null,
      quantity_expected: Number(line.expected_quantity) || 0,
      quantity_received: Number(quantity),
      quantity_pending: Math.max(0, (Number(line.expected_quantity) || 0) - Number(quantity)),
      location_id: location,
      status: 'Complete',
      received_at: new Date().toISOString(),
      received_by: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Use API route instead of direct PostgREST call
    const asnRes = await fetch('/api/asn-inventory', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(asnInventoryPayload),
    });

    if (!asnRes.ok) {
      const errorText = await asnRes.text();
      console.error('❌ Failed to sync ASN inventory:', asnRes.status, errorText);
    } else {
      console.log('✅ ASN inventory synced successfully via API route');
    }
  } catch (err) {
    console.error('❌ ASN inventory sync exception:', err);
  }
}

/**
 * Sync inventory to main Inventory table (create or update)
 * IMPORTANT: This function is called during PUTAWAY, so it:
 * 1. CREATES staging inventory if missing (as a fallback for ASN received items)
 * 2. MOVES inventory from current location to target location
 */
async function syncMainInventory(
  itemId: number,
  location: number,
  quantity: number,
  line: ASNLine,
  apiKey: string,
  palletId?: string,
  warehouseId?: number
): Promise<void> {
  try {
    const locationId = location;
    const warehouseIdFinal = warehouseId || 1;
    
    console.log(`\n🔄 PUTAWAY INVENTORY TRANSFER:`);
    console.log(`   Item ID: ${itemId}, Qty: ${quantity}, Target Location: ${locationId}, Warehouse: ${warehouseIdFinal}`);

    // STEP 1: Find inventory from ANY location (usually Staging, but could be elsewhere)
    console.log(`\n📍 Step 1: FIND and MOVE ${quantity} from current location...`);
    
    // Search for inventory by ITEM + PALLET only (ignore location - find wherever it is)
    const stagingPalletId = line.pallet_id || palletId;
    let stagingCheckUrl = `/api/inventory-sync?item_id=${itemId}&warehouse_id=${warehouseIdFinal}`;
    if (stagingPalletId) {
      stagingCheckUrl += `&pallet_id=${stagingPalletId}`; // Don't add "eq." - API will add it
    }
    
    console.log(`🔍 Searching for inventory: ${stagingCheckUrl}`);
    const stagingCheckRes = await fetch(stagingCheckUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    let stagingRec = null; // Declare here so it's accessible in STEP 2
    if (stagingCheckRes.ok) {
      const stagingInventory = await stagingCheckRes.json();
      if (stagingInventory && stagingInventory.length > 0) {
        stagingRec = stagingInventory[0];
        console.log(`📦 Found inventory record: item_id=${stagingRec.item_id}, location_id=${stagingRec.location_id}, qty=${stagingRec.on_hand_quantity}`);
      } else {
        console.warn(`⚠️ No inventory found for item ${itemId}, pallet ${stagingPalletId}`);
      }
    } else {
      console.warn(`⚠️ Failed to check inventory: ${stagingCheckRes.status}`);
    }

    // If no staging record found, CREATE ONE (fallback for ASN received items)
    if (!stagingRec || !stagingRec.id) {
      console.warn(`⚠️ No staging inventory found - creating one as fallback...`);
      
      // Get staging location ID (usually "Staging-004" or similar)
      let stagingLocationId = 1; // Default fallback
      try {
        const locRes = await fetch(`/api/inventory-sync?name=Staging-004`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (locRes.ok) {
          const locData = await locRes.json();
          if (Array.isArray(locData) && locData.length > 0) {
            stagingLocationId = locData[0].id || 1;
          }
        }
      } catch (locErr) {
        console.warn(`⚠️ Could not fetch staging location: ${locErr}, using default location 1`);
      }

      const finalPalletId = palletId || line.pallet_id || null;
      
      // Create staging inventory record via API
      const createRes = await fetch('/api/inventory-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'create',
          item_id: itemId,
          warehouse_id: warehouseIdFinal,
          location_id: stagingLocationId,
          pallet_id: finalPalletId,
          on_hand_quantity: quantity,
          batch_number: line.batch_number || null,
          expiry_date: line.expiry_date || null,
          manufacturing_date: line.manufacturing_date || null,
        }),
      });

      if (!createRes.ok) {
        const errorText = await createRes.text();
        console.error('❌ Failed to create staging inventory:', createRes.status, errorText);
        throw new Error(`Failed to create staging inventory: ${errorText}`);
      }

      console.log('✅ Created staging inventory record as fallback');
      
      // Now fetch it again to get the ID for moving
      const stagingCheckRes2 = await fetch(stagingCheckUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (stagingCheckRes2.ok) {
        const stagingInventory = await stagingCheckRes2.json();
        if (stagingInventory && stagingInventory.length > 0) {
          stagingRec = stagingInventory[0];
          console.log(`📦 Re-fetched newly created inventory record: id=${stagingRec.id}`);
        }
      }
    }

    // STEP 2: MOVE inventory from current location to TARGET location (update location_id only)
    console.log(`\n📍 Step 2: MOVE item to target location ${locationId}...`);
    
    const finalPalletId = palletId || line.pallet_id || null;

    if (stagingRec && stagingRec.id) {
      // Use the MOVE operation to change location_id
      const moveRes = await fetch('/api/inventory-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'move',
          id: stagingRec.id,
          location_id: locationId,
          warehouse_id: warehouseIdFinal,
        }),
      });

      if (!moveRes.ok) {
        const errorText = await moveRes.text();
        console.error('❌ Failed to move inventory:', moveRes.status, errorText);
        throw new Error(`Failed to move inventory: ${moveRes.status}`);
      } else {
        console.log(`✅ Inventory MOVED from current location to location ${locationId}`);
        console.log(`\n✅ Putaway inventory transfer completed successfully\n`);
        return;
      }
    } else {
      console.warn(`⚠️ Staging record still not found after creation attempt`);
      throw new Error('Staging inventory record not found - cannot move to target location');
    }
  } catch (err) {
    console.error('❌ Main inventory sync exception:', err);
    throw err; // Re-throw so caller knows it failed
  }
}

/**
 * Submit a single putaway transaction
 */
export async function submitPutawayRecord(params: PutawaySubmitParams): Promise<{ palletId: string; gpNumber: string }> {
  const { quantity, location, line, header, items, apiKey, generatePalletId, palletId, warehouseId } = params;

  if (!header || !line) {
    throw new Error('ASN header or line not found');
  }

  // Look up item details
  let itemId = line.item_id; // First try from ASN line
  let itemName = line.item_name || '';

  // If no item_id in line, try to find in items array or fetch from API
  if (!itemId) {
    const item = items?.find((i: any) => i.item_code === line.item_code);
    if (item) {
      itemId = item.id;
      itemName = item.item_name || itemName;
    } else {
      // Fetch item from API by item_code as fallback
      try {
        console.log(`🔍 Fetching item by code ${line.item_code} from API...`);
        const itemResponse = await fetch(`/api/config-records?type=items&filter=item_code&value=${encodeURIComponent(line.item_code)}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (itemResponse.ok) {
          const itemData = await itemResponse.json();
          const foundItem = Array.isArray(itemData) ? itemData[0] : itemData;
          if (foundItem?.id) {
            itemId = foundItem.id;
            itemName = foundItem.item_name || itemName;
            console.log(`✅ Found item via API: ${itemName} (ID: ${itemId})`);
          }
        }
      } catch (err) {
        console.warn(`⚠️ Could not fetch item from API: ${err}`);
      }
    }
  }

  if (!itemId) {
    throw new Error(`Could not find item_id for item_code: ${line.item_code}`);
  }

  console.log('🔹 Starting submitPutawayRecord:');
  console.log(`   - Item: ${itemName} (ID: ${itemId})`);
  console.log(`   - Quantity: ${quantity}`);
  console.log(`   - Location: ${location}`);
  console.log(`   - Line ID: ${line.id}`);
  console.log(`   - Header ID: ${header.id}`);

  // Ensure location is a number
  const locationId = Number(location);

  // Generate pallet ID (new one for split, or use existing)
  const finalPalletId = palletId || generatePalletId();

  // Generate gatepass number
  const now = new Date();
  const gpNumber = `GP${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

  // Build putaway transaction payload
  const putawayPayload = {
    receiving_transaction_id: header.id,
    item_code: line.item_code,
    item_name: itemName,
    item_id: itemId,
    asn_number: header.asn_number,
    putaway_quantity: Number(quantity),
    batch_number: line.batch_number,
    manufacturing_date: line.manufacturing_date || null,
    expiry_date: line.expiry_date || null,
    pallet_id: finalPalletId,
    weight_uom_kg: line.weight_uom_kg ? Number(line.weight_uom_kg) : null,
    pallet_config: line.pallet_config || null,
    from_location_id: null,
    to_location_id: locationId,
    putaway_by: 1,
    putaway_date: new Date().toISOString(),
    location_id: locationId,
    created_at: new Date().toISOString(),
  };

  console.log('📦 Putaway payload:', putawayPayload);

  // 1. Save putaway transaction via API route (not direct PostgREST)
  const res = await fetch('/api/putaway-transactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(putawayPayload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('❌ Putaway transaction error:', errorText);
    throw new Error('Failed to save putaway transaction');
  }

  console.log('✅ Putaway transaction saved successfully via API route');

  // 2. Sync to ASN Inventory
  await syncASNInventory(line.id, itemId, quantity, locationId, line, apiKey, warehouseId);

  // 3. Sync to main Inventory (pass the pallet ID that was assigned)
  await syncMainInventory(itemId, locationId, quantity, line, apiKey, finalPalletId, warehouseId);

  return { palletId: finalPalletId, gpNumber };
}

/**
 * Submit a split putaway with multiple reasons (damage, missing, defective, etc.)
 */
export async function submitSplitPutaway(params: SplitPutawayParams): Promise<{
  splitPalletIds: Record<string, string>; // Map of reason to pallet ID
  gpNumber: string;
}> {
  const { splits, header, line, items, apiKey, warehouseId } = params;

  // Validate splits array
  if (!splits || splits.length === 0) {
    throw new Error('At least one split record is required');
  }

  // Validate quantities sum to total received
  const totalReceived = Number(line.received_quantity || line.receivedQuantity || 0);
  const totalSplit = splits.reduce((sum, split) => sum + split.quantity, 0);

  if (totalSplit !== totalReceived) {
    throw new Error(
      `Quantities don't match. Received: ${totalReceived}, Split total: ${totalSplit}`
    );
  }

  // Check for negative quantities
  if (splits.some(split => split.quantity < 0)) {
    throw new Error('Quantities cannot be negative');
  }

  // Get item ID
  let itemId = line.item_id;
  if (!itemId) {
    const item = items?.find((i: any) => i.item_code === line.item_code);
    if (item) {
      itemId = item.id;
    }
  }

  if (!itemId) {
    throw new Error('Could not resolve item ID');
  }

  // Find the original inventory record ONCE (by item_id + warehouse, matching pallet and current location)
  const originalPalletId = line.pallet_id;
  const warehouseIdFinal = warehouseId || 1;
  
  let originalInventory = null;
  try {
    // First try to find by pallet_id specifically
    let checkUrl = `/api/inventory-sync?item_id=${itemId}&warehouse_id=${warehouseIdFinal}&pallet_id=${originalPalletId}`;
    let checkRes = await fetch(checkUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    let inventoryRecords: any[] = [];
    if (checkRes.ok) {
      inventoryRecords = await checkRes.json();
    }
    
    // If not found by pallet, try by item_id alone for that warehouse (might be at staging)
    if (!Array.isArray(inventoryRecords) || inventoryRecords.length === 0) {
      checkUrl = `/api/inventory-sync?item_id=${itemId}&warehouse_id=${warehouseIdFinal}`;
      checkRes = await fetch(checkUrl, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (checkRes.ok) {
        inventoryRecords = await checkRes.json();
        // Filter to those that might match the original pallet
        if (originalPalletId) {
          inventoryRecords = inventoryRecords.filter((inv: any) => inv.pallet_id === originalPalletId);
        }
      }
    }
    
    if (Array.isArray(inventoryRecords) && inventoryRecords.length > 0) {
      originalInventory = inventoryRecords[0];
      console.log(`📦 Found original inventory: id=${originalInventory.id}, location=${originalInventory.location_id}, pallet=${originalInventory.pallet_id}, qty=${originalInventory.on_hand_quantity}`);
    } else {
      console.warn('⚠️ Could not find original inventory record for item:', itemId, 'pallet:', originalPalletId);
    }
  } catch (err) {
    console.warn('⚠️ Could not find original inventory for split:', err);
  }

  // Generate pallet IDs for each split with reason-based prefix
  const splitPalletIds: Record<string, string> = {};

  console.log('🔀 SPLIT PUTAWAY - Processing multiple locations');

  // Process first split: MOVE original inventory if found, otherwise CREATE
  if (splits.length > 0) {
    const firstSplit = splits[0];
    // Only use original pallet ID if it exists AND first split is 'good', otherwise generate new
    const firstPalletId = (firstSplit.reason === 'good' && originalPalletId) 
      ? originalPalletId 
      : generatePalletIdByReason(firstSplit.reason);
    splitPalletIds[firstSplit.reason] = firstPalletId;

    console.log(
      `📦 1. ${firstSplit.reason.toUpperCase()}: ${firstSplit.quantity} units → Location ${firstSplit.location}, Pallet ${firstPalletId}`
    );

    if (firstSplit.reason === 'good' && originalInventory) {
      // For GOOD items: UPDATE the original inventory with new quantity and location, don't create new
      try {
        const updateRes = await fetch('/api/inventory-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'update',
            id: originalInventory.id,
            location_id: firstSplit.location,
            warehouse_id: warehouseIdFinal,
            on_hand_quantity: firstSplit.quantity,
            allocated_quantity: 0,
            available_quantity: firstSplit.quantity,
          }),
        });

        if (updateRes.ok) {
          console.log(`✅ GOOD: Updated original inventory to ${firstSplit.quantity} units at location ${firstSplit.location}, keeping original pallet ${firstPalletId}`);
        } else {
          console.warn(`⚠️ Failed to update GOOD inventory for first split: ${updateRes.status}`);
        }
      } catch (err) {
        console.error('❌ Error updating GOOD inventory:', err);
      }
    } else if (originalInventory && firstSplit.quantity === totalReceived) {
      // For non-GOOD items with all quantity: MOVE the original inventory to the first location
      try {
        const moveRes = await fetch('/api/inventory-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'move',
            id: originalInventory.id,
            location_id: firstSplit.location,
            warehouse_id: warehouseIdFinal,
          }),
        });

        if (moveRes.ok) {
          console.log(`✅ Moved original inventory to location ${firstSplit.location}`);
        } else {
          console.warn(`⚠️ Failed to move inventory for first split: ${moveRes.status}`);
        }
      } catch (err) {
        console.error('❌ Error moving inventory:', err);
      }
    } else if (firstSplit.quantity > 0) {
      // CREATE new inventory for first split (only for non-GOOD items or when couldn't move)
      try {
        const createPayload = {
          item_id: itemId,
          location_id: Number(firstSplit.location),
          warehouse_id: warehouseIdFinal,
          on_hand_quantity: firstSplit.quantity,
          allocated_quantity: 0,
          available_quantity: firstSplit.quantity,
          weight_uom_kg: line.weight_uom_kg ? Number(line.weight_uom_kg) : null,
          pallet_config: line.pallet_config || null,
          pallet_id: firstPalletId,
          // Copy metadata from original inventory or line
          batch_number: line.batch_number || originalInventory?.batch_number || null,
          asn_number: header.asn_number || originalInventory?.asn_number || null,
          asn_status: originalInventory?.asn_status || null,
          date_received: originalInventory?.date_received || null,
          vendor_code: originalInventory?.vendor_code || null,
          vendor_name: originalInventory?.vendor_name || null,
        };

        const createRes = await fetch('/api/inventory-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'create',
            ...createPayload,
          }),
        });

        if (createRes.ok) {
          console.log(`✅ Created inventory for first split (${firstSplit.reason}) at location ${firstSplit.location}, pallet: ${firstPalletId}`);
        } else {
          console.warn(`⚠️ Failed to create inventory for first split: ${createRes.status}`);
        }
      } catch (err) {
        console.error('❌ Error creating inventory for first split:', err);
      }
    }
  }

  // Process remaining splits: CREATE new inventory records for each (except GOOD items)
  for (let i = 1; i < splits.length; i++) {
    const split = splits[i];
    const splitPalletId = (split.reason === 'good' && originalPalletId) 
      ? originalPalletId 
      : generatePalletIdByReason(split.reason);
    splitPalletIds[split.reason] = splitPalletId;

    console.log(
      `📦 ${i + 1}. ${split.reason.toUpperCase()}: ${split.quantity} units → Location ${split.location}, Pallet ${splitPalletId}`
    );

    if (split.reason === 'good' && originalInventory) {
      // For GOOD items in remaining splits: UPDATE the original inventory with new quantity and location
      try {
        const newQuantity = Math.max(0, originalInventory.on_hand_quantity - split.quantity);
        const updateRes = await fetch('/api/inventory-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'update',
            id: originalInventory.id,
            location_id: split.location,
            warehouse_id: warehouseIdFinal,
            on_hand_quantity: newQuantity,
            allocated_quantity: 0,
            available_quantity: newQuantity,
          }),
        });

        if (updateRes.ok) {
          console.log(`✅ GOOD (split ${i + 1}): Updated original inventory to ${newQuantity} units at location ${split.location}, keeping original pallet ${splitPalletId}`);
          originalInventory.on_hand_quantity = newQuantity;  // Update reference for next iteration
        } else {
          console.warn(`⚠️ Failed to update GOOD inventory for split ${i + 1}: ${updateRes.status}`);
        }
      } catch (err) {
        console.error(`❌ Error updating GOOD inventory for split ${i + 1}:`, err);
      }
    } else if (split.quantity > 0) {
      // For non-GOOD items: CREATE new inventory records
      try {
        const createPayload = {
          item_id: itemId,
          location_id: Number(split.location),
          warehouse_id: warehouseIdFinal,
          on_hand_quantity: split.quantity,
          allocated_quantity: 0,
          available_quantity: split.quantity,
          weight_uom_kg: line.weight_uom_kg ? Number(line.weight_uom_kg) : null,
          pallet_config: line.pallet_config || null,
          pallet_id: splitPalletId,
          // Copy metadata from original inventory or line
          batch_number: line.batch_number || originalInventory?.batch_number || null,
          asn_number: header.asn_number || originalInventory?.asn_number || null,
          asn_status: originalInventory?.asn_status || null,
          date_received: originalInventory?.date_received || null,
          vendor_code: originalInventory?.vendor_code || null,
          vendor_name: originalInventory?.vendor_name || null,
        };

        const createRes = await fetch('/api/inventory-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'create',
            ...createPayload,
          }),
        });

        if (createRes.ok) {
          console.log(`✅ Created inventory for split ${i + 1} (${split.reason}) at location ${split.location}, pallet: ${splitPalletId}`);
        } else {
          console.warn(`⚠️ Failed to create inventory for split ${i + 1}: ${createRes.status}`);
        }
      } catch (err) {
        console.error(`❌ Error creating inventory for split ${i + 1}:`, err);
      }
    }
  }

  // Generate gatepass number (shared for all splits)
  const now = new Date();
  const gpNumber = `GP${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

  return { splitPalletIds, gpNumber };
}
