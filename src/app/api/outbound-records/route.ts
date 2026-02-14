import { NextRequest, NextResponse } from 'next/server';
import {
  getServerCachedData,
  setServerCachedData,
  clearServerCache,
} from '@/utils/serverCacheHelper';

interface OutboundRecords {
  headers: any[];
  lines: any[];
  cachedAt?: string;
  cacheSource?: 'server' | 'fresh';
}

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlHeaders = process.env.NEXT_PUBLIC_URL_SO_HEADERS || '';
const urlLines = process.env.NEXT_PUBLIC_URL_SO_LINES || '';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const warehouseId = searchParams.get('warehouse'); // Get warehouse filter
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Check server cache first (unless forced refresh)
    if (!forceRefresh) {
      const filters = warehouseId ? { warehouse: warehouseId } : undefined;
      const cachedRecords = getServerCachedData<OutboundRecords>('outbound', year, filters);
      if (cachedRecords) {
        return NextResponse.json({
          ...cachedRecords,
          cachedAt: new Date().toISOString(),
          cacheSource: 'server',
        });
      }
    }

    // Cache miss - fetch from API
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    let headersUrlWithFilter = `${urlHeaders}?so_date=gte.${startDate}&so_date=lte.${endDate}&order=so_date.desc`;
    let linesUrlWithFilter = `${urlLines}?limit=10000&order=id.asc`;
    
    // Add warehouse filter if provided (only to headers, not lines - so_lines doesn't have warehouse_id)
    if (warehouseId) {
      headersUrlWithFilter += `&warehouse_id=eq.${warehouseId}`;
      console.log(`📦 Outbound: Filtering by warehouse ${warehouseId}`);
    }

    const [headersRes, linesRes] = await Promise.all([
      fetch(headersUrlWithFilter, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      }),
      fetch(linesUrlWithFilter, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      }),
    ]);

    const headersData = await headersRes.json();
    const linesData = await linesRes.json();

    const normalizedHeaders = Array.isArray(headersData) ? headersData : (headersData ? [headersData] : []);
    const normalizedLines = Array.isArray(linesData) ? linesData : (linesData ? [linesData] : []);
    
    // Normalize line field names: ensure so_header_id is set from sales_order_header_id
    const linesWithNormalizedFields = normalizedLines.map((line: any) => ({
      ...line,
      so_header_id: line.so_header_id || line.sales_order_header_id
    }));
    
    // Filter headers if warehouse filter is applied
    let filteredHeaders = normalizedHeaders;
    let filteredLines = linesWithNormalizedFields;
    
    if (warehouseId) {
      filteredHeaders = normalizedHeaders.filter((h: any) => h.warehouse_id === parseInt(warehouseId));
      
      // Also filter lines to only include lines from filtered headers
      const filteredHeaderIds = new Set(filteredHeaders.map((h: any) => h.id));
      filteredLines = linesWithNormalizedFields.filter((l: any) => filteredHeaderIds.has(l.sales_order_header_id || l.so_header_id));
    }
    
    // Fetch SO inventory to get allocated/shipped quantities
    const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';
    let inventoryByLineId: { [key: number]: { allocated: number; shipped: number } } = {};

    try {
      const invRes = await fetch(`${urlSOInventory}?select=so_line_id,quantity_allocated,quantity_shipped,status&limit=10000`, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      });

      if (invRes.ok) {
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
      }
    } catch (err) {
      console.warn('⚠️ Could not fetch SO inventory allocations:', err);
    }

    // Enrich lines with allocated/shipped quantities
    const enrichedLines = filteredLines.map((l: any) => {
      const inventory = inventoryByLineId[l.id] || { allocated: 0, shipped: 0 };
      const enriched = {
        ...l,
        allocatedQuantity: inventory.allocated,
        shippedQuantity: inventory.shipped,
        // Transform snake_case to camelCase for grid display
        itemCode: l.item_code,
        itemName: l.item_name,
        itemUom: l.item_uom,
        orderedQuantity: l.ordered_quantity,
        expectedQuantity: l.expected_quantity,
        quantityExpected: l.expected_quantity, // Support both field names
        soUom: l.so_uom,
        batchNumber: l.batch_number,
        palletConfig: l.pallet_config,
        palletId: l.pallet_id,
        weightUomKg: l.weight_uom_kg,
        requiredExpiryDate: l.required_expiry_date,
        expiryDate: l.expiry_date,
        soHeaderId: l.so_header_id,
        // Keep original snake_case for compatibility
        so_header_id: l.so_header_id,
        item_code: l.item_code,
        item_name: l.item_name,
        item_uom: l.item_uom,
        ordered_quantity: l.ordered_quantity,
        expected_quantity: l.expected_quantity,
        so_uom: l.so_uom,
        batch_number: l.batch_number,
        pallet_config: l.pallet_config,
        pallet_id: l.pallet_id,
        weight_uom_kg: l.weight_uom_kg,
        required_expiry_date: l.required_expiry_date,
      };
      // Log sample for verification
      if (l.id === 17) {
        console.log('🔍 Enriched line 17 - has quantityExpected?', !!enriched.quantityExpected, 'value:', enriched.quantityExpected, 'soUom?', !!enriched.soUom, 'value:', enriched.soUom);
      }
      return enriched;
    });

    // ✅ FIXED: Show ALL SO headers and lines, not just those with status='New'
    // This allows users to see the full order lifecycle (New -> Allocated -> Picking -> Shipped)
    // The UI can filter based on status if needed
    console.log(`📦 Outbound records: Headers=${filteredHeaders.length}, Lines=${enrichedLines.length}`);

    const records: OutboundRecords = {
      headers: filteredHeaders,
      lines: enrichedLines,
    };

    // Cache the records on server (30 second TTL for faster real-time updates)
    // Previous: 5 minutes (too slow for status changes)
    // New: 30 seconds (enables near real-time updates)
    const filters = warehouseId ? { warehouse: warehouseId } : undefined;
    setServerCachedData('outbound', year, records, 30, filters);

    return NextResponse.json({
      ...records,
      cachedAt: new Date().toISOString(),
      cacheSource: 'fresh',
    });
  } catch (error) {
    console.error('Error fetching outbound records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch outbound records' },
      { status: 500 }
    );
  }
}

/**
 * POST to clear cache for a specific year
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { year, action } = body;

    if (action === 'clear') {
      clearServerCache('outbound', year);
      return NextResponse.json({
        success: true,
        message: `Cache cleared for outbound/${year}`,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error in cache action:', error);
    return NextResponse.json(
      { error: 'Failed to process cache action' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
