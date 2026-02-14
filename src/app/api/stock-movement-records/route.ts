import { NextRequest, NextResponse } from 'next/server';
import {
  getServerCachedData,
  setServerCachedData,
  clearServerCache,
} from '@/utils/serverCacheHelper';

interface StockMovement {
  id: number;
  item_id: number;
  item_code?: string;
  item_name?: string;
  warehouse_id: number;
  warehouse_code?: string;
  location_id: number;
  location_code?: string;
  batch_number?: string;
  quantity_change: number;
  transaction_type: string;
  reference_id: number;
  reference_type?: string;
  reference_number?: string;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  weight_uom_kg?: number;
  pallet_config?: string;
  pallet_id?: string;
  expiry_date?: string;
  manufacturing_date?: string;
  notes?: string;
}

interface StockMovementRecords {
  movements: StockMovement[];
  cachedAt?: string;
  cacheSource?: 'server' | 'fresh';
}

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
// Internal API calls use HTTP on internal network (safe, faster)
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://');
const urlStockMovements = (process.env.NEXT_PUBLIC_URL_STOCK_MOVEMENT || `${API_BASE}/stock_movement`).replace(/^https?:\/\//, 'http://');
const urlLocations = (process.env.NEXT_PUBLIC_URL_LOCATIONS || `${API_BASE}/locations`).replace(/^https?:\/\//, 'http://');

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const warehouseId = searchParams.get('warehouse');
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Check server cache first (unless forced refresh)
    if (!forceRefresh) {
      const filters = warehouseId ? { warehouse: warehouseId } : undefined;
      const cachedRecords = getServerCachedData<StockMovementRecords>('stock_movement', year, filters);
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
    let urlWithFilter = `${urlStockMovements}?created_at=gte.${startDate}&created_at=lte.${endDate}&order=created_at.desc`;

    // Fetch movements
    const movementsRes = await fetch(urlWithFilter, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    const movementsData = await movementsRes.json();
    let movements = Array.isArray(movementsData) ? movementsData : (movementsData ? [movementsData] : []);

    // If warehouse filter is specified, filter movements by location warehouse_id
    if (warehouseId) {
      try {
        // Fetch all locations for the specified warehouse
        const locationsUrl = `${urlLocations}?warehouse_id=eq.${warehouseId}`;
        const locRes = await fetch(locationsUrl, {
          method: 'GET',
          headers: { 'x-api-key': apiKey },
        });

        if (locRes.ok) {
          const locationsData = await locRes.json();
          const locations = Array.isArray(locationsData) ? locationsData : (locationsData ? [locationsData] : []);
          const locationIds = locations.map((loc: any) => loc.id);

          // Filter movements: include only those with from_location_id or to_location_id in the warehouse
          movements = movements.filter((mov: any) => 
            locationIds.includes(mov.from_location_id) || locationIds.includes(mov.to_location_id)
          );

          console.log(`✅ Filtered stock movements by warehouse ${warehouseId}: ${movements.length} records`);
        }
      } catch (locError) {
        console.warn(`⚠️ Could not filter by warehouse locations: ${locError}`);
        // Continue with unfiltered movements if location fetch fails
      }
    }

    const records: StockMovementRecords = {
      movements,
    };

    // Cache the records on server (5 minute TTL for transactional data)
    const filters = warehouseId ? { warehouse: warehouseId } : undefined;
    setServerCachedData('stock_movement', year, records, 5 * 60, filters);

    return NextResponse.json({
      ...records,
      cachedAt: new Date().toISOString(),
      cacheSource: 'fresh',
    });
  } catch (error) {
    console.error('Error fetching stock movement records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stock movement records' },
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
      clearServerCache('stock_movement', year);
      return NextResponse.json({
        success: true,
        message: `Cache cleared for stock_movement/${year}`,
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
