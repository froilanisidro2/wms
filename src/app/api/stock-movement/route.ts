import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/utils/safeFetch';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlStockMovement = process.env.NEXT_PUBLIC_URL_STOCK_MOVEMENT || '';
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://');
const urlItems = (process.env.NEXT_PUBLIC_URL_ITEMS || `${API_BASE}/items`).replace(/^https?:\/\//, 'http://');
const urlWarehouses = (process.env.NEXT_PUBLIC_URL_WAREHOUSES || `${API_BASE}/warehouses`).replace(/^https?:\/\//, 'http://');
const urlLocations = (process.env.NEXT_PUBLIC_URL_LOCATIONS || `${API_BASE}/locations`).replace(/^https?:\/\//, 'http://');
const urlUsers = (process.env.NEXT_PUBLIC_URL_USERS || `${API_BASE}/users`).replace(/^https?:\/\//, 'http://');
const urlSoInventory = (process.env.NEXT_PUBLIC_URL_SO_INVENTORY || `${API_BASE}/so_inventory`).replace(/^https?:\/\//, 'http://');
const urlPutaway = (process.env.NEXT_PUBLIC_URL_PUTAWAY_TRANSACTIONS || `${API_BASE}/putaway_transactions`).replace(/^https?:\/\//, 'http://');
const urlAsnInventory = (process.env.NEXT_PUBLIC_URL_ASN_INVENTORY || `${API_BASE}/asn_inventory`).replace(/^https?:\/\//, 'http://');
const urlAsnLines = (process.env.NEXT_PUBLIC_URL_ASN_LINES || `${API_BASE}/asn_lines`).replace(/^https?:\/\//, 'http://');

/**
 * GET /api/stock-movement
 * Fetch comprehensive stock movement data including:
 * - Stock movement records
 * - SO inventory movements
 * - Putaway movements
 * - With all necessary mappings (items, warehouses, locations, users)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const warehouseId = searchParams.get('warehouseId');
    const type = searchParams.get('type') || 'all';
    const limit = searchParams.get('limit') || '1000';

    console.log(`📊 [GET /api/stock-movement] Starting - warehouse: ${warehouseId || 'all'}, type: ${type}`);

    // Fetch all supporting data in parallel using safeFetch
    // Reference data (items, warehouses, locations, users) cached 1 hour
    // Request deduplication prevents duplicate in-flight calls
    const [items, warehouses, locations, users] = await Promise.all([
      safeFetch(`${urlItems}?limit=5000&order=id.desc`, {
        headers: { 'x-api-key': apiKey },
        timeout: 15000,
        cacheKey: 'stock_items',
        dataType: 'reference',
        fallbackData: [],
      }),
      safeFetch(`${urlWarehouses}?limit=500&order=id.desc`, {
        headers: { 'x-api-key': apiKey },
        timeout: 15000,
        cacheKey: 'stock_warehouses',
        dataType: 'reference',
        fallbackData: [],
      }),
      safeFetch(`${urlLocations}?limit=5000&order=id.desc`, {
        headers: { 'x-api-key': apiKey },
        timeout: 15000,
        cacheKey: 'stock_locations',
        dataType: 'reference',
        fallbackData: [],
      }),
      safeFetch(urlUsers, {
        headers: { 'x-api-key': apiKey },
        timeout: 15000,
        cacheKey: 'stock_users',
        dataType: 'reference',
        fallbackData: [],
      }),
    ]);

    // Build maps for lookups
    let itemsMap: any = {};
    let warehousesMap: any = {};
    let locationsMap: any = {};
    let usersMap: any = {};

    if (Array.isArray(items)) {
      items.forEach((item: any) => {
        itemsMap[item.id] = { code: item.item_code, name: item.item_name };
      });
    }

    if (Array.isArray(warehouses)) {
      warehouses.forEach((wh: any) => {
        warehousesMap[wh.id] = { code: wh.warehouse_code, name: wh.warehouse_name || wh.warehouse_code };
      });
    }

    if (Array.isArray(locations)) {
      locations.forEach((loc: any) => {
        locationsMap[loc.id] = {
          code: loc.location_code,
          name: loc.location_name || loc.location_code,
          display: `${loc.location_code} - ${loc.location_name || loc.location_code}`
        };
      });
    }

    if (Array.isArray(users)) {
      users.forEach((user: any) => {
        usersMap[user.id] = user.full_name || user.username;
      });
    }

    console.log(`✅ Built maps - items: ${Object.keys(itemsMap).length}, warehouses: ${Object.keys(warehousesMap).length}, locations: ${Object.keys(locationsMap).length}, users: ${Object.keys(usersMap).length}`);

    const allMovements: any[] = [];
    let outboundMovements: any[] = [];
    let inboundMovements: any[] = [];

    // Fetch main stock movement records if requested
    if (type === 'movements' || type === 'all') {
      if (urlStockMovement) {
        try {
          let query = `${urlStockMovement}?order=movement_date.desc&limit=${limit}`;
          if (warehouseId) {
            query += `&warehouse_id=eq.${warehouseId}`;
          }
          
          const response = await fetch(query, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          });

          if (response.ok) {
            const data = await response.json();
            const movements = Array.isArray(data) ? data : (data ? [data] : []);
            console.log(`✅ Fetched ${movements.length} stock movements`);
            allMovements.push(...movements);
          } else {
            console.warn(`⚠️ Stock movements fetch failed: ${response.status}`);
          }
        } catch (e) {
          console.warn('⚠️ Stock movements error:', e);
        }
      }
    }

    // Fetch outbound SO inventory movements if requested
    if (type === 'outbound' || type === 'all') {
      try {
        let query = `${urlSoInventory}?limit=${limit}`;
        if (warehouseId) {
          query += `&warehouse_id=eq.${warehouseId}`;
        }
        
        const response = await fetch(query, { headers: { 'x-api-key': apiKey } });

        if (response.ok) {
          const soInvArray = await response.json();
          console.log(`✅ Fetched ${soInvArray.length} SO inventory records`);
          
          outboundMovements = soInvArray.map((soInv: any) => {
            let transactionType = 'ALLOCATED';
            let fromLocation = 'WAREHOUSE';
            let toLocation = 'RESERVED';
            let quantity = soInv.quantity_allocated || 0;
            
            if (soInv.status === 'picked') {
              transactionType = 'PICKED';
              fromLocation = 'STORAGE';
              toLocation = 'PICKING AREA';
            } else if (soInv.status === 'shipped') {
              transactionType = 'SHIPPED';
              fromLocation = 'PICKING AREA';
              toLocation = 'SHIPPED';
              quantity = soInv.quantity_shipped || soInv.quantity_allocated || 0;
            }
            
            return {
              id: soInv.id,
              so_inventory_id: soInv.id,
              item_id: soInv.item_id,
              item_code: itemsMap[soInv.item_id]?.code || soInv.item_code || 'N/A',
              item_name: itemsMap[soInv.item_id]?.name || soInv.item_name || 'N/A',
              warehouse_id: soInv.warehouse_id,
              warehouse_code: warehousesMap[soInv.warehouse_id]?.code || 'N/A',
              warehouse_name: warehousesMap[soInv.warehouse_id]?.name || 'N/A',
              location_id: soInv.location_id,
              from_location_code: fromLocation,
              to_location_code: toLocation,
              quantity_moved: quantity,
              quantity_change: quantity,
              transaction_type: transactionType,
              reference_id: soInv.so_header_id,
              reference_type: 'SO_HEADER',
              created_at: soInv.updated_at || soInv.created_at,
              movement_date: soInv.updated_at || soInv.created_at,
              batch_number: soInv.batch_number,
              pallet_id: soInv.pallet_id,
            };
          });
        }
      } catch (e) {
        console.warn('⚠️ SO inventory error:', e);
      }
    }

    // Fetch inbound putaway movements if requested
    if (type === 'inbound' || type === 'all') {
      try {
        let query = `${urlPutaway}?order=created_at.desc&limit=${limit}`;
        
        const response = await fetch(query, { headers: { 'x-api-key': apiKey } });

        if (response.ok) {
          const putawayArray = await response.json();
          console.log(`✅ Fetched ${putawayArray.length} putaway transactions`);

          // Fetch ASN inventory and lines for additional mapping
          let asnInventoryMap: any = {};
          let asnLinesMap: any = {};

          try {
            const asnInvRes = await fetch(`${urlAsnInventory}?limit=10000`, { headers: { 'x-api-key': apiKey } });
            if (asnInvRes.ok) {
              const asnInvArray = await asnInvRes.json();
              asnInvArray.forEach((inv: any) => {
                const key = `${inv.item_id}_${inv.batch_number}`;
                asnInventoryMap[key] = inv;
              });
            }
          } catch (e) {
            console.warn('⚠️ ASN inventory error:', e);
          }

          try {
            const asnLinesRes = await fetch(`${urlAsnLines}?limit=10000`, { headers: { 'x-api-key': apiKey } });
            if (asnLinesRes.ok) {
              const asnLinesArray = await asnLinesRes.json();
              asnLinesArray.forEach((line: any) => {
                asnLinesMap[line.id] = line;
              });
            }
          } catch (e) {
            console.warn('⚠️ ASN lines error:', e);
          }

          inboundMovements = putawayArray.map((put: any) => {
            const toLocInfo = locationsMap[put.location_id];
            return {
              id: put.id,
              putaway_id: put.id,
              asn_inventory_id: put.asn_inventory_id,
              item_id: put.item_id,
              item_code: itemsMap[put.item_id]?.code || put.item_code || 'N/A',
              item_name: itemsMap[put.item_id]?.name || put.item_name || 'N/A',
              warehouse_id: asnInventoryMap[`${put.item_id}_${put.batch_number}`]?.warehouse_id || 1,
              warehouse_code: warehousesMap[asnInventoryMap[`${put.item_id}_${put.batch_number}`]?.warehouse_id || 1]?.code || 'N/A',
              warehouse_name: warehousesMap[asnInventoryMap[`${put.item_id}_${put.batch_number}`]?.warehouse_id || 1]?.name || 'N/A',
              location_id: put.location_id,
              from_location_code: 'RECEIVING',
              to_location_code: toLocInfo?.code || 'STORAGE',
              quantity_moved: put.putaway_quantity || put.quantity_putaway || 0,
              quantity_change: put.putaway_quantity || put.quantity_putaway || 0,
              transaction_type: 'PUTAWAY',
              reference_id: put.asn_inventory_id,
              reference_type: 'ASN_INVENTORY',
              created_at: put.created_at,
              movement_date: put.created_at,
              batch_number: put.batch_number,
              pallet_id: put.pallet_id,
              created_by: put.created_by,
              created_by_name: usersMap[put.created_by] || 'N/A',
            };
          });
        }
      } catch (e) {
        console.warn('⚠️ Putaway error:', e);
      }
    }

    const result = {
      success: true,
      data: {
        allMovements,
        outboundMovements,
        inboundMovements,
        maps: { items: itemsMap, warehouses: warehousesMap, locations: locationsMap, users: usersMap },
        totals: {
          allMovementsCount: allMovements.length,
          outboundCount: outboundMovements.length,
          inboundCount: inboundMovements.length,
          total: allMovements.length + outboundMovements.length + inboundMovements.length
        }
      }
    };

    console.log(`📊 [GET /api/stock-movement] Complete - total movements: ${result.data.totals.total}`);
    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ [GET /api/stock-movement] Error:', error);
    return NextResponse.json(
      { error: `Error fetching stock movement data: ${error}` },
      { status: 500 }
    );
  }
}

export const maxDuration = 60; // Safe - safeFetch handles timeouts & fallbacks
