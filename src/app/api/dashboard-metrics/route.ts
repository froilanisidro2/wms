import { NextRequest, NextResponse } from 'next/server';
import {
  getServerCachedData,
  setServerCachedData,
  clearServerCache,
} from '@/utils/serverCacheHelper';
import { safeFetch } from '@/utils/safeFetch';

interface DashboardMetrics {
  totalItems: number;
  totalWarehouses: number;
  totalLocations: number;
  totalCustomers: number;
  totalVendors: number;
  totalStockValue: number;
  pendingASNs: number;
  receivedASNs: number;
  putAwayASNs: number;
  completeASNs: number;
  totalASNLines: number;
  pendingSOs: number;
  allocatedSOs: number;
  pickingSOs: number;
  shippedSOs: number;
  totalSOLines: number;
  totalInventoryQuantity: number;
  lowStockItems: number;
  outOfStockItems: number;
  perishableItems: number;
  recentMovements: number;
  todaysMovements: number;
  cachedAt?: string;
  cacheSource?: 'server' | 'fresh';
}

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000/api';
const apiKey = process.env.NEXT_PUBLIC_API_KEY || '';

const defaultMetrics: DashboardMetrics = {
  totalItems: 0,
  totalWarehouses: 0,
  totalLocations: 0,
  totalCustomers: 0,
  totalVendors: 0,
  totalStockValue: 0,
  pendingASNs: 0,
  receivedASNs: 0,
  putAwayASNs: 0,
  completeASNs: 0,
  totalASNLines: 0,
  pendingSOs: 0,
  allocatedSOs: 0,
  pickingSOs: 0,
  shippedSOs: 0,
  totalSOLines: 0,
  totalInventoryQuantity: 0,
  lowStockItems: 0,
  outOfStockItems: 0,
  perishableItems: 0,
  recentMovements: 0,
  todaysMovements: 0,
};

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const warehouse = searchParams.get('warehouse');
    const forceRefresh = searchParams.get('refresh') === 'true';

    console.log('📊 Dashboard metrics request:', { year, warehouse, forceRefresh });

    // Check server cache first (unless forced refresh)
    if (!forceRefresh) {
      const filters = warehouse ? { warehouse } : undefined;
      const cachedMetrics = getServerCachedData<DashboardMetrics>('dashboard', year, filters);
      if (cachedMetrics) {
        console.log('📊 ✅ Returning cached dashboard metrics');
        return NextResponse.json({
          ...cachedMetrics,
          cachedAt: new Date().toISOString(),
          cacheSource: 'server',
        });
      }
    }

    console.log('📊 Fetching fresh dashboard metrics...');

    // Fetch fresh metrics with race condition timeout
    const metrics = await Promise.race([
      fetchMetricsInBackground(year, warehouse || undefined),
      new Promise<DashboardMetrics>((resolve) =>
        setTimeout(() => {
          console.log('📊 ⚠️ Metrics fetch timeout (3s), returning defaults');
          resolve(defaultMetrics);
        }, 3000)
      ),
    ]);

    // Cache the metrics (5 minute TTL for dashboard)
    if (metrics !== defaultMetrics) {
      const filters = warehouse ? { warehouse } : undefined;
      setServerCachedData('dashboard', year, metrics, 5 * 60, filters);
      console.log('📊 ✅ Metrics cached successfully');
    }

    console.log('📊 ✅ Returning fresh metrics:', { 
      items: metrics.totalItems,
      warehouses: metrics.totalWarehouses,
      asnNew: metrics.pendingASNs,
      asnComplete: metrics.receivedASNs,
      soNew: metrics.pendingSOs,
      soAllocated: metrics.allocatedSOs,
      soShipped: metrics.shippedSOs,
    });

    return NextResponse.json({
      ...metrics,
      cachedAt: new Date().toISOString(),
      cacheSource: 'fresh',
    });
  } catch (error) {
    console.error('❌ Error in GET dashboard metrics:', error);
    return NextResponse.json(
      {
        ...defaultMetrics,
        cachedAt: new Date().toISOString(),
        cacheSource: 'error',
      },
      { status: 200 }
    );
  }
}

async function fetchMetricsInBackground(year: number, warehouse?: string): Promise<DashboardMetrics> {
  // Internal API call uses HTTP on internal network (safe, faster)
  const apiBase = (process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://');
  const realApiBase = apiBase;
  const realApiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
  const headers = { 'X-Api-Key': realApiKey };

  console.log('📊 Starting metrics fetch');
  console.log('📊 API Base:', realApiBase);
  console.log('📊 API Key Present:', realApiKey ? '✓' : '✗');
  console.log('📊 Warehouse Filter:', warehouse || 'none');

  try {
    // Build warehouse filter query if provided
    const warehouseFilter = warehouse ? `?warehouse_id=eq.${warehouse}` : '';
    
    // Fetch all required data in parallel with safeFetch
    // Reference data (items, warehouses, locations, vendors) cached 1 hour
    // Transactional data (ASNs, SOs, inventory) cached 5 minutes
    const [items, warehouses, locations, asnHeaders, asnLines, soHeaders, soLines, inventory, vendors] = await Promise.all([
      safeFetch(`${realApiBase}/items?limit=5000`, { 
        headers, 
        timeout: 15000, 
        cacheKey: 'dash_items',
        dataType: 'reference',
        fallbackData: [] 
      }),
      safeFetch(`${realApiBase}/warehouses?limit=500`, { 
        headers, 
        timeout: 15000, 
        cacheKey: 'dash_warehouses',
        dataType: 'reference',
        fallbackData: [] 
      }),
      safeFetch(`${realApiBase}/locations${warehouseFilter}?limit=5000`, { 
        headers, 
        timeout: 15000, 
        cacheKey: `dash_locations_${warehouse || 'all'}`,
        dataType: 'reference',
        fallbackData: [] 
      }),
      safeFetch(`${realApiBase}/asn_headers${warehouseFilter}?limit=1000`, { 
        headers, 
        timeout: 15000, 
        cacheKey: `dash_asn_headers_${warehouse || 'all'}`,
        dataType: 'transactional',
        fallbackData: [] 
      }),
      safeFetch(`${realApiBase}/asn_lines?limit=5000`, { 
        headers, 
        timeout: 15000, 
        cacheKey: 'dash_asn_lines',
        dataType: 'transactional',
        fallbackData: [] 
      }),
      safeFetch(`${realApiBase}/so_headers${warehouseFilter}?limit=1000`, { 
        headers, 
        timeout: 15000, 
        cacheKey: `dash_so_headers_${warehouse || 'all'}`,
        dataType: 'transactional',
        fallbackData: [] 
      }),
      safeFetch(`${realApiBase}/so_lines?limit=5000`, { 
        headers, 
        timeout: 15000, 
        cacheKey: 'dash_so_lines',
        dataType: 'transactional',
        fallbackData: [] 
      }),
      safeFetch(`${realApiBase}/inventory${warehouseFilter}?limit=5000`, { 
        headers, 
        timeout: 15000, 
        cacheKey: `dash_inventory_${warehouse || 'all'}`,
        dataType: 'transactional',
        fallbackData: [] 
      }),
      safeFetch(`${realApiBase}/vendors?limit=500`, { 
        headers, 
        timeout: 15000, 
        cacheKey: 'dash_vendors',
        dataType: 'reference',
        fallbackData: [] 
      }),
    ]);

    const metrics: DashboardMetrics = { ...defaultMetrics };

    // Parse items
    if (Array.isArray(items)) {
      metrics.totalItems = items.length || 0;
      console.log('📊 Items fetched:', metrics.totalItems);
    }

    // Parse warehouses
    if (Array.isArray(warehouses)) {
      metrics.totalWarehouses = warehouses.length || 0;
      console.log('📊 Warehouses fetched:', metrics.totalWarehouses);
    }

    // Parse locations
    if (Array.isArray(locations)) {
      metrics.totalLocations = locations.length || 0;
      console.log('📊 Locations fetched:', metrics.totalLocations);
    }

    // Parse ASN headers
    if (Array.isArray(asnHeaders)) {
      metrics.pendingASNs = asnHeaders.filter((h: any) => h.status === 'New').length || 0;
      metrics.receivedASNs = asnHeaders.filter((h: any) => h.status === 'Received').length || 0;
      metrics.putAwayASNs = asnHeaders.filter((h: any) => h.status === 'PutAway').length || 0;
      metrics.completeASNs = asnHeaders.filter((h: any) => h.status === 'Complete').length || 0;
      console.log('📊 ASN Headers - New:', metrics.pendingASNs, 'Received:', metrics.receivedASNs, 'PutAway:', metrics.putAwayASNs, 'Complete:', metrics.completeASNs);
    }

    // Parse ASN lines
    if (Array.isArray(asnLines)) {
      metrics.totalASNLines = asnLines.length || 0;
      console.log('📊 ASN Lines fetched:', metrics.totalASNLines);
    }

    // Parse SO headers
    if (Array.isArray(soHeaders)) {
      metrics.pendingSOs = soHeaders.filter((h: any) => h.status === 'New').length || 0;
      metrics.allocatedSOs = soHeaders.filter((h: any) => h.status === 'Allocated').length || 0;
      metrics.pickingSOs = soHeaders.filter((h: any) => h.status === 'Picking').length || 0;
      metrics.shippedSOs = soHeaders.filter((h: any) => h.status === 'Shipped').length || 0;
      const uniqueCustomers = new Set(soHeaders.map((h: any) => h.customer_code).filter(Boolean));
      metrics.totalCustomers = uniqueCustomers.size || 0;
      console.log('📊 SO Headers - New:', metrics.pendingSOs, 'Allocated:', metrics.allocatedSOs, 'Picking:', metrics.pickingSOs, 'Shipped:', metrics.shippedSOs, 'Customers:', metrics.totalCustomers);
    }

    // Parse SO lines
    if (Array.isArray(soLines)) {
      metrics.totalSOLines = soLines.length || 0;
      console.log('📊 SO Lines fetched:', metrics.totalSOLines);
    }

    // Parse inventory
    if (Array.isArray(inventory)) {
      metrics.totalInventoryQuantity = inventory.reduce((sum: number, inv: any) => sum + (inv.on_hand_quantity || 0), 0) || 0;
      metrics.lowStockItems = inventory.filter((inv: any) => inv.on_hand_quantity > 0 && inv.on_hand_quantity < 10).length || 0;
      metrics.outOfStockItems = inventory.filter((inv: any) => inv.on_hand_quantity <= 0).length || 0;
      console.log('📊 Inventory - Total Qty:', metrics.totalInventoryQuantity, 'Low Stock:', metrics.lowStockItems, 'Out of Stock:', metrics.outOfStockItems);
    }

    // Parse vendors
    if (Array.isArray(vendors)) {
      metrics.totalVendors = vendors.length || 0;
      console.log('📊 Vendors fetched:', metrics.totalVendors);
    }

    console.log('📊 ✅ Metrics fetch completed successfully');
    console.log('📊 Final metrics:', {
      items: metrics.totalItems,
      warehouses: metrics.totalWarehouses,
      locations: metrics.totalLocations,
      customers: metrics.totalCustomers,
      vendors: metrics.totalVendors,
      asnNew: metrics.pendingASNs,
      asnComplete: metrics.receivedASNs,
      soNew: metrics.pendingSOs,
      soAllocated: metrics.allocatedSOs,
      soShipped: metrics.shippedSOs,
      inventoryQty: metrics.totalInventoryQuantity,
      lowStock: metrics.lowStockItems,
      outOfStock: metrics.outOfStockItems,
    });
    return metrics;
  } catch (error) {
    console.error('Failed to fetch metrics:', error);
    return defaultMetrics;
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
      clearServerCache('dashboard', year);
      return NextResponse.json({
        success: true,
        message: `Cache cleared for dashboard/${year}`,
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

export const maxDuration = 60; // Safe - safeFetch handles timeouts & fallbacks
