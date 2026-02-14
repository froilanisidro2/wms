import { NextRequest, NextResponse } from 'next/server';
import {
  getServerCachedData,
  setServerCachedData,
  clearServerCache,
} from '@/utils/serverCacheHelper';

interface InventoryRecords {
  inventory: any[];
  asnInventory: any[];
  soInventory: any[];
  items: any[];
  locations: any[];
  cycleCounts: any[];
  cachedAt?: string;
  cacheSource?: 'server' | 'fresh';
}

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
// Use environment variable API base
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://');
const urlInventory = (process.env.NEXT_PUBLIC_URL_INVENTORY || `${API_BASE}/inventory`).replace(/^https?:\/\//, 'http://');
const urlAsnInventory = (process.env.NEXT_PUBLIC_URL_ASN_INVENTORY || `${API_BASE}/asn_inventory`).replace(/^https?:\/\//, 'http://');
const urlSOInventory = (process.env.NEXT_PUBLIC_URL_SO_INVENTORY || `${API_BASE}/so_inventory`).replace(/^https?:\/\//, 'http://');
const urlItems = (process.env.NEXT_PUBLIC_URL_ITEMS || `${API_BASE}/items`).replace(/^https?:\/\//, 'http://');
const urlLocations = (process.env.NEXT_PUBLIC_URL_LOCATIONS || `${API_BASE}/locations`).replace(/^https?:\/\//, 'http://');
const urlCycleCounts = (process.env.NEXT_PUBLIC_URL_CYCLE_COUNTS || `${API_BASE}/cycle_counts`).replace(/^https?:\/\//, 'http://');

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const warehouseId = searchParams.get('warehouse'); // Get warehouse filter
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Check server cache first (unless forced refresh)
    if (!forceRefresh) {
      const filters = warehouseId ? { warehouse: warehouseId } : undefined;
      const cachedRecords = getServerCachedData<InventoryRecords>('inventory', year, filters);
      if (cachedRecords) {
        return NextResponse.json({
          ...cachedRecords,
          cachedAt: new Date().toISOString(),
          cacheSource: 'server',
        });
      }
    }

    // Cache miss - fetch from API
    let invUrl = urlInventory;
    let asnUrl = urlAsnInventory;
    let soInvUrl = urlSOInventory;
    
    // Add warehouse filter if provided
    if (warehouseId) {
      invUrl += `?warehouse_id=eq.${warehouseId}`;
      asnUrl += `?warehouse_id=eq.${warehouseId}`;
      soInvUrl += `?warehouse_id=eq.${warehouseId}`;
      console.log(`📦 Inventory: Filtering by warehouse ${warehouseId}`);
    }

    // Add select parameter to fetch related ASN and SO header data through joins
    // Note: asn_inventory table already contains batch_number, expiry_date, and quantity_received directly
    // No need to fetch from asn_lines since those fields are already in asn_inventory
    const asnSelectFields = 'id,pallet_id,item_id,location_id,asn_line_id,warehouse_id,status,quantity_received,batch_number,expiry_date';
    const soSelectFields = 'id,pallet_id,item_id,location_id,so_line_id,status,quantity_allocated,quantity_picked,quantity_shipped,so_lines(so_header_id,so_headers(so_number,so_date,customer_code,customer_name))';
    
    // Append select parameter to URLs
    const separator = asnUrl.includes('?') ? '&' : '?';
    asnUrl += `${separator}select=${encodeURIComponent(asnSelectFields)}`;
    soInvUrl += `${soInvUrl.includes('?') ? '&' : '?'}select=${encodeURIComponent(soSelectFields)}`;
    
    const [invRes, asnRes, soInvRes, itemsRes, locsRes, cyclesRes] = await Promise.all([
      fetch(invUrl, { headers: { 'x-api-key': apiKey } }),
      fetch(asnUrl, { headers: { 'x-api-key': apiKey } }),
      fetch(soInvUrl, { headers: { 'x-api-key': apiKey } }),
      fetch(urlItems, { headers: { 'x-api-key': apiKey } }),
      fetch(urlLocations, { headers: { 'x-api-key': apiKey } }),
      fetch(urlCycleCounts, { headers: { 'x-api-key': apiKey } }),
    ]);

    const inventoryData = await invRes.json();
    const asnInventoryData = await asnRes.json();
    const soInventoryData = await soInvRes.json();
    const itemsData = await itemsRes.json();
    const locationsData = await locsRes.json();
    const cycleCountsData = await cyclesRes.json();

    // Check for errors in responses
    if (!invRes.ok) {
      console.error('❌ Inventory fetch failed:', invRes.status, inventoryData);
      throw new Error(`Inventory API error: ${invRes.status}`);
    }
    if (!itemsRes.ok) {
      console.error('❌ Items fetch failed:', itemsRes.status, itemsData);
      throw new Error(`Items API error: ${itemsRes.status}`);
    }
    if (!locsRes.ok) {
      console.error('❌ Locations fetch failed:', locsRes.status, locationsData);
      throw new Error(`Locations API error: ${locsRes.status}`);
    }

    // Normalize arrays
    const locations = Array.isArray(locationsData) ? locationsData : (locationsData ? [locationsData] : []);
    const inventoryArr = Array.isArray(inventoryData) ? inventoryData : (inventoryData ? [inventoryData] : []);
    const asnInventoryArr = Array.isArray(asnInventoryData) ? asnInventoryData : (asnInventoryData ? [asnInventoryData] : []);
    const soInventoryArr = Array.isArray(soInventoryData) ? soInventoryData : (soInventoryData ? [soInventoryData] : []);
    const items = Array.isArray(itemsData) ? itemsData : (itemsData ? [itemsData] : []);
    
    // Create lookup maps for fast O(1) lookups
    const locationMap = new Map<number, any>();
    locations.forEach((loc: any) => {
      if (loc.id) {
        locationMap.set(loc.id, loc);
      }
    });

    const asnInventoryMap = new Map<number, any>();
    asnInventoryArr.forEach((asn: any) => {
      if (asn.id) {
        // batch_number and expiry_date come directly from asn_inventory table
        asnInventoryMap.set(asn.id, {
          ...asn,
          batch_number: asn.batch_number || null,
          expiry_date: asn.expiry_date || null,
        });
      }
    });

    const soInventoryMap = new Map<number, any>();
    soInventoryArr.forEach((so: any) => {
      if (so.id) {
        soInventoryMap.set(so.id, so);
      }
    });

    // ✅ CRITICAL: Enrich inventory records with location_code
    // Data like asn_number, vendor_code, vendor_name, so_number, customer_code, customer_name
    // are now stored directly in the inventory table columns
    const enrichedInventory = inventoryArr.map((inv: any) => {
      const locationId = inv.location_id;
      const locationRec = locationMap.get(locationId);
      const location_code = locationRec?.location_code || inv.location_code || `LOC-${locationId}`;
      
      return {
        ...inv,
        location_code: location_code,
        // These fields are now stored directly in inventory table
        asn_number: inv.asn_number || null,
        batch_number: inv.batch_number || null,
        date_received: inv.date_received || null,
        asn_status: inv.asn_status || null,
        vendor_code: inv.vendor_code || null,
        vendor_name: inv.vendor_name || null,
        so_number: inv.so_number || null,
        date_shipped: inv.date_shipped || null,
        so_status: inv.so_status || null,
        customer_code: inv.customer_code || null,
        customer_name: inv.customer_name || null,
      };
    });

    // ✅ Enrich ASN Inventory records - batch_number and expiry_date come directly from asn_inventory table
    const enrichedAsnInventory = asnInventoryArr.map((asn: any) => {
      return {
        ...asn,
        batch_number: asn.batch_number || null,
        expiry_date: asn.expiry_date || null,
      };
    });

    const records: InventoryRecords = {
      inventory: enrichedInventory,
      asnInventory: enrichedAsnInventory,
      soInventory: soInventoryArr,
      items: items,
      locations: locations,
      cycleCounts: Array.isArray(cycleCountsData) ? cycleCountsData : (cycleCountsData ? [cycleCountsData] : []),
    };

    // Log batch/expiry data for debugging
    const recordsWithBatchExpiry = enrichedAsnInventory.filter((a: any) => a.batch_number || a.expiry_date);
    console.log(`✅ ASN Inventory enriched: ${enrichedAsnInventory.length} records, ${recordsWithBatchExpiry.length} with batch/expiry`);
    if (recordsWithBatchExpiry.length > 0) {
      console.log('📥 Sample batch/expiry records:', recordsWithBatchExpiry.slice(0, 2));
    }

    // Cache the records on server (10 minute TTL for inventory data)
    const filters = warehouseId ? { warehouse: warehouseId } : undefined;
    setServerCachedData('inventory', year, records, 10 * 60, filters);

    return NextResponse.json({
      ...records,
      cachedAt: new Date().toISOString(),
      cacheSource: 'fresh',
    });
  } catch (error) {
    console.error('Error fetching inventory records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory records' },
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
      clearServerCache('inventory', year);
      return NextResponse.json({
        success: true,
        message: `Cache cleared for inventory/${year}`,
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
