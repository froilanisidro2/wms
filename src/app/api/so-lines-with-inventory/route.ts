import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlSOLines = process.env.NEXT_PUBLIC_URL_SO_LINES || '';
const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';

/**
 * GET /api/so-lines-with-inventory
 * Fetch SO lines enriched with allocated and shipped quantities from SO_INVENTORY
 * 
 * This endpoint:
 * 1. Fetches SO lines
 * 2. Queries SO_INVENTORY to get allocated_quantity and shipped_quantity
 * 3. Calculates allocatedQuantity for display
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    // Support both 'headerIds' and 'so_header_id' parameters
    let soHeaderIds = searchParams.get('headerIds')?.split(',').map(Number) || [];
    if (soHeaderIds.length === 0) {
      const singleHeaderId = searchParams.get('so_header_id');
      if (singleHeaderId) {
        soHeaderIds = [Number(singleHeaderId)];
      }
    }

    // Fetch all SO lines
    const linesRes = await fetch(`${urlSOLines}?limit=10000&order=id.asc`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    if (!linesRes.ok) {
      throw new Error(`Failed to fetch SO lines: ${linesRes.status}`);
    }

    const allLines = await linesRes.json();
    const normalizedLines = Array.isArray(allLines) ? allLines : (allLines ? [allLines] : []);

    // Filter by header IDs if provided
    let filteredLines = normalizedLines;
    if (soHeaderIds.length > 0) {
      filteredLines = normalizedLines.filter((line: any) => 
        soHeaderIds.includes(line.so_header_id || line.sales_order_header_id)
      );
    }

    // Fetch SO inventory allocations
    const invRes = await fetch(`${urlSOInventory}?select=so_line_id,quantity_allocated,quantity_shipped,status&limit=10000`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    let inventoryByLineId: { [key: number]: { allocated: number; shipped: number } } = {};

    if (invRes.ok) {
      try {
        const invData = await invRes.json();
        const invArray = Array.isArray(invData) ? invData : (invData ? [invData] : []);

        // Group inventory by SO line ID and sum allocated/shipped
        invArray.forEach((inv: any) => {
          if (inv.so_line_id) {
            if (!inventoryByLineId[inv.so_line_id]) {
              inventoryByLineId[inv.so_line_id] = { allocated: 0, shipped: 0 };
            }
            
            // Sum allocated quantities (from allocated and picked statuses)
            if (['allocated', 'picked'].includes(inv.status)) {
              inventoryByLineId[inv.so_line_id].allocated += inv.quantity_allocated || 0;
            }
            
            // Sum shipped quantities
            if (inv.status === 'shipped') {
              inventoryByLineId[inv.so_line_id].shipped += inv.quantity_shipped || 0;
            }
          }
        });

        console.log('📊 Inventory allocation summary:', inventoryByLineId);
      } catch (err) {
        console.warn('⚠️ Could not parse SO inventory:', err);
      }
    }

    // Enrich SO lines with allocated/shipped quantities
    const enrichedLines = filteredLines.map((line: any) => {
      const inventory = inventoryByLineId[line.id] || { allocated: 0, shipped: 0 };
      return {
        ...line,
        allocatedQuantity: inventory.allocated,
        shippedQuantity: inventory.shipped,
        soHeaderId: line.so_header_id || line.sales_order_header_id,
        itemCode: line.item_code,
        itemName: line.item_name,
        itemUom: line.item_uom,
        orderedQuantity: line.ordered_quantity,
        expectedQuantity: line.expected_quantity,
        quantityExpected: line.expected_quantity, // Support both field names
        soUom: line.so_uom,
        batchNumber: line.batch_number,
        palletConfig: line.pallet_config,
        palletId: line.pallet_id,
        weightUomKg: line.weight_uom_kg,
        requiredExpiryDate: line.required_expiry_date,
        expiryDate: line.expiry_date,
        // Keep original snake_case for compatibility
        so_header_id: line.so_header_id,
        item_code: line.item_code,
        item_name: line.item_name,
        item_uom: line.item_uom,
        ordered_quantity: line.ordered_quantity,
        expected_quantity: line.expected_quantity,
        so_uom: line.so_uom,
        batch_number: line.batch_number,
        pallet_config: line.pallet_config,
        pallet_id: line.pallet_id,
        weight_uom_kg: line.weight_uom_kg,
        required_expiry_date: line.required_expiry_date,
      };
    });

    console.log(`✅ SO lines enriched with inventory: ${enrichedLines.length} lines`);

    return NextResponse.json({
      lines: enrichedLines,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching SO lines with inventory:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SO lines with inventory' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
