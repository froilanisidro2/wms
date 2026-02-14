/**
 * Shipment Helper Utilities
 * Handles inventory deduction on shipment (Shipped status)
 */

interface SOLine {
  id: number;
  so_header_id: number;
  item_id: number;
  item_code: string;
  item_name: string;
  ordered_quantity: number;
  batch_number?: string;
  pallet_id?: string;
}

interface SOHeader {
  id: number;
  so_number: string;
  customer_code: string;
  customer_name: string;
  status: 'Allocated' | 'Picked' | 'Shipped';
}

interface InventoryRecord {
  id: number;
  item_id: number;
  location_id: number;
  on_hand_quantity: number;
  available_quantity: number;
  allocated_quantity?: number;
  [key: string]: any;
}

interface ShipmentDeductionParams {
  soHeader: SOHeader;
  soLines: SOLine[];
  items: any[];
  inventory: InventoryRecord[];
  apiKey: string;
  urlShipmentTransactions?: string;
  urlSOHeaders: string;
}

interface ShipmentResult {
  success: boolean;
  message: string;
  deductedItems: Array<{
    itemCode: string;
    locationId: number;
    quantityDeducted: number;
  }>;
  errors: string[];
}

/**
 * Deduct inventory from main inventory table on Shipped status
 * 
 * Inventory Deduction Flow:
 * - ALLOCATED: Deducts from Available Qty (Available = On Hand - Allocated)
 * - SHIPPED: Deducts from On Hand Qty only
 * 
 * Relationship:
 * - On Hand Qty = Total physical quantity in warehouse
 * - Available Qty = On Hand - Allocated (quantity available for new allocations)
 * - Allocated Qty = Reserved for sales orders
 * - Shipped Qty = Deducted from On Hand during shipment
 */
export async function deductInventoryOnShipped(
  params: ShipmentDeductionParams
): Promise<ShipmentResult> {
  const {
    soHeader,
    soLines,
    items,
    inventory,
    apiKey,
    urlShipmentTransactions,
    urlSOHeaders
  } = params;

  const result: ShipmentResult = {
    success: false,
    message: '',
    deductedItems: [],
    errors: []
  };

  try {
    // Step 0: Validate SO status - must be "Picked" before allowing shipment
    if (soHeader.status === 'Allocated') {
      result.message = '❌ Cannot ship from Allocated status. Please confirm picks first.';
      result.errors.push('SO status is Allocated - must be Picked before shipment');
      return result;
    }

    if (soHeader.status && !['Picked', 'Shipped'].includes(soHeader.status)) {
      result.message = `❌ Invalid SO status for shipment: ${soHeader.status}`;
      result.errors.push(`SO status is ${soHeader.status} - cannot process shipment`);
      return result;
    }

    // Step 1: Group SO lines by item
    const itemGroupMap = new Map<number, Array<{ quantity: number; lineId: number }>>();
    
    for (const line of soLines) {
      if (!itemGroupMap.has(line.item_id)) {
        itemGroupMap.set(line.item_id, []);
      }
      itemGroupMap.get(line.item_id)!.push({
        quantity: line.ordered_quantity,
        lineId: line.id
      });
    }

    // Step 2: For each item, find inventory records and deduct
    const deductedItems = [];
    
    for (const [itemId, lineData] of itemGroupMap.entries()) {
      const totalQuantityToDeduct = lineData.reduce((sum, l) => sum + l.quantity, 0);
      
      // Find item details
      const item = items.find(i => i.id === itemId);
      if (!item) {
        result.errors.push(`Item ID ${itemId} not found in items list`);
        continue;
      }

      // Find inventory records for this item (from saleable locations only)
      const itemInventory = inventory.filter(inv => 
        inv.item_id === itemId && 
        inv.available_quantity > 0
      );

      if (itemInventory.length === 0) {
        result.errors.push(`No available inventory found for item ${item.item_code}`);
        continue;
      }

      // Deduct from inventory records in order
      let remainingQuantity = totalQuantityToDeduct;

      for (const invRecord of itemInventory) {
        if (remainingQuantity <= 0) break;

        const quantityToDeduct = Math.min(remainingQuantity, invRecord.available_quantity);
        
        // PATCH inventory: Deduct quantities
        // ⚠️ IMPORTANT: Shipped items are deducted ONLY from on_hand_quantity
        // allocated = deduct from available_quantity
        // shipped = deduct from on_hand_quantity
        // ALSO: Reduce allocated_quantity when shipped (since items are no longer reserved)
        const patchPayload = {
          on_hand_quantity: Math.max(0, invRecord.on_hand_quantity - quantityToDeduct),
          available_quantity: Math.max(0, invRecord.available_quantity - quantityToDeduct),
          // Also reduce allocated_quantity on shipment (items are no longer allocated, they're shipped)
          allocated_quantity: Math.max(0, (invRecord.allocated_quantity || 0) - quantityToDeduct)
        };

        try {
          // Use API route instead of direct PostgREST call
          const patchRes = await fetch('/api/patch-record', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              table: 'inventory',
              id: invRecord.id,
              data: patchPayload
            }),
          });

          if (!patchRes.ok) {
            const errorText = await patchRes.text();
            result.errors.push(`Failed to deduct from inventory ${invRecord.id}: ${patchRes.status} - ${errorText.slice(0, 200)}`);
            continue;
          }

          deductedItems.push({
            itemCode: item.item_code,
            locationId: invRecord.location_id,
            quantityDeducted: quantityToDeduct
          });

          remainingQuantity -= quantityToDeduct;
        } catch (err: any) {
          result.errors.push(`Error deducting inventory: ${err.message}`);
        }
      }

      if (remainingQuantity > 0) {
        result.errors.push(`Insufficient inventory for item ${item.item_code}. Short by ${remainingQuantity} units`);
      }
    }

    // Step 3: Create shipment transaction record (if table exists)
    if (urlShipmentTransactions) {
      try {
        const shipmentTransaction = {
          so_header_id: soHeader.id,
          so_number: soHeader.so_number,
          customer_code: soHeader.customer_code,
          customer_name: soHeader.customer_name,
          total_quantity: deductedItems.reduce((sum, item) => sum + item.quantityDeducted, 0),
          transaction_date: new Date().toISOString(),
          status: 'Shipped',
          remarks: `Shipment processed for SO ${soHeader.so_number}`
        };

        const txRes = await fetch('/api/patch-record', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            table: 'shipment_transactions',
            data: shipmentTransaction
          }),
        });

        if (!txRes.ok) {
          console.warn(`Warning: Failed to create shipment transaction: ${txRes.status}`);
        }
      } catch (err: any) {
        console.warn(`Warning: Error creating shipment transaction: ${err.message}`);
      }
    }

    // Step 4: Update SO header status to 'Shipped'
    try {
      const statusRes = await fetch('/api/patch-record', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          table: 'so_headers',
          id: soHeader.id,
          data: { status: 'Shipped' }
        }),
      });

      if (!statusRes.ok) {
        result.errors.push(`Failed to update SO header status: ${statusRes.status}`);
      }
    } catch (err: any) {
      result.errors.push(`Error updating SO status: ${err.message}`);
    }

    // Success if we deducted something and have no errors
    result.success = deductedItems.length > 0 && result.errors.length === 0;
    result.deductedItems = deductedItems;
    result.message = result.success 
      ? `✅ Shipment processed successfully. Deducted ${deductedItems.length} item location(s).`
      : `⚠️ Shipment partially processed. ${deductedItems.length} items deducted with ${result.errors.length} error(s).`;

    return result;

  } catch (err: any) {
    result.success = false;
    result.message = `❌ Fatal error: ${err.message}`;
    result.errors.push(err.message);
    return result;
  }
}

/**
 * Validate inventory availability before allowing shipment
 */
export function validateShipmentInventory(
  soLines: SOLine[],
  inventory: InventoryRecord[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Group lines by item
  const itemNeeds = new Map<number, number>();
  for (const line of soLines) {
    const current = itemNeeds.get(line.item_id) || 0;
    itemNeeds.set(line.item_id, current + line.ordered_quantity);
  }

  // Check availability
  for (const [itemId, neededQty] of itemNeeds.entries()) {
    const available = inventory
      .filter(inv => inv.item_id === itemId)
      .reduce((sum, inv) => sum + inv.available_quantity, 0);

    if (available < neededQty) {
      errors.push(`Item ID ${itemId}: Need ${neededQty} units, but only ${available} available`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get shipment summary before processing
 */
export function getShipmentSummary(
  soHeader: SOHeader,
  soLines: SOLine[],
  items: any[]
): {
  soNumber: string;
  customerName: string;
  lineCount: number;
  totalQuantity: number;
  itemSummary: Array<{ itemCode: string; itemName: string; quantity: number }>;
} {
  const itemMap = new Map<number, { code: string; name: string; qty: number }>();

  for (const line of soLines) {
    const item = items.find(i => i.id === line.item_id);
    if (item) {
      const key = line.item_id;
      if (!itemMap.has(key)) {
        itemMap.set(key, { code: item.item_code, name: item.item_name, qty: 0 });
      }
      itemMap.get(key)!.qty += line.ordered_quantity;
    }
  }

  const itemSummary = Array.from(itemMap.values()).map(item => ({
    itemCode: item.code,
    itemName: item.name,
    quantity: item.qty
  }));

  return {
    soNumber: soHeader.so_number,
    customerName: soHeader.customer_name,
    lineCount: soLines.length,
    totalQuantity: soLines.reduce((sum, line) => sum + line.ordered_quantity, 0),
    itemSummary
  };
}
