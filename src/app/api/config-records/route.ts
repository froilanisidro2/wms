import { NextRequest, NextResponse } from 'next/server';
import {
  getServerCachedData,
  setServerCachedData,
  clearServerCache,
} from '@/utils/serverCacheHelper';

interface ConfigRecords {
  vendors: any[];
  customers: any[];
  items: any[];
  warehouses: any[];
  locations: any[];
  companies: any[];
  cachedAt?: string;
  cacheSource?: 'server' | 'fresh';
}

// 7 days TTL for config data (master data rarely changes)
const CONFIG_CACHE_TTL = 7 * 24 * 60 * 60;

// Get API base URL from environment
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://');

const defaultConfig: ConfigRecords = {
  vendors: [],
  customers: [],
  items: [],
  warehouses: [],
  locations: [],
  companies: [],
};

export async function GET(request: NextRequest) {
  try {
    const type = request.nextUrl.searchParams.get('type');
    const userId = request.nextUrl.searchParams.get('user_id');
    const forceRefresh = request.nextUrl.searchParams.get('refresh') === 'true';
    const table = request.nextUrl.searchParams.get('table');
    
    // Handle generic table queries (for loading_checklist, warehouse_locations, etc.)
    if (table) {
      return await fetchTableData(table, request.nextUrl.searchParams);
    }

    // Handle specific data type requests
    if (type === 'users') {
      return await fetchUsers();
    }
    if (type === 'permissions') {
      return await fetchUserPermissions(userId);
    }
    if (type === 'inventory') {
      return await fetchInventory();
    }

    // Default: fetch all config records
    // If refresh is forced, bypass cache and fetch fresh data
    if (forceRefresh) {
      console.log('🔄 Force refresh requested - fetching fresh data');
      return await fetchAllConfigData();
    }
    
    // Check server cache first
    const cachedRecords = getServerCachedData<ConfigRecords>('config', 0);
    if (cachedRecords) {
      console.log('✓ Config Cache HIT');
      return NextResponse.json({
        ...cachedRecords,
        cachedAt: new Date().toISOString(),
        cacheSource: 'server',
      });
    }

    console.log('✗ Config Cache MISS - returning empty config, fetching in background');

    // Return empty config immediately, fetch data in background
    fetchConfigInBackground().catch(err => {
      console.error('Background config fetch failed:', err);
    });

    return NextResponse.json({
      ...defaultConfig,
      cachedAt: new Date().toISOString(),
      cacheSource: 'fresh',
    });
  } catch (error) {
    console.error('Error in config GET:', error);
    return NextResponse.json(
      {
        ...defaultConfig,
        cachedAt: new Date().toISOString(),
        cacheSource: 'error',
      },
      { status: 200 }
    );
  }
}

async function fetchAllConfigData(): Promise<NextResponse> {
  try {
    const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
    const headers = { 'x-api-key': apiKey };

    // Fetch with 2-second timeout per request
    const fetchWithTimeout = (url: string, timeoutMs: number = 2000) => {
      return Promise.race([
        fetch(url, { headers }),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeoutMs)
        ),
      ]);
    };

    // Fetch all in parallel with Promise.allSettled to tolerate failures
    const [vendorsRes, customersRes, itemsRes, warehousesRes, locationsRes, companiesRes] = await Promise.allSettled([
      fetchWithTimeout(`${API_BASE}/vendors`),
      fetchWithTimeout(`${API_BASE}/customers`),
      fetchWithTimeout(`${API_BASE}/items`),
      fetchWithTimeout(`${API_BASE}/warehouses`),
      fetchWithTimeout(`${API_BASE}/locations`),
      fetchWithTimeout(`${API_BASE}/companies`),
    ]);

    const records: ConfigRecords = { ...defaultConfig };

    // Parse successful responses
    try {
      if (vendorsRes.status === 'fulfilled') {
        const data = await vendorsRes.value.json();
        records.vendors = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (customersRes.status === 'fulfilled') {
        const data = await customersRes.value.json();
        records.customers = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (itemsRes.status === 'fulfilled') {
        const data = await itemsRes.value.json();
        records.items = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (warehousesRes.status === 'fulfilled') {
        const data = await warehousesRes.value.json();
        records.warehouses = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (locationsRes.status === 'fulfilled') {
        const data = await locationsRes.value.json();
        records.locations = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (companiesRes.status === 'fulfilled') {
        const data = await companiesRes.value.json();
        records.companies = Array.isArray(data) ? data : [];
      }
    } catch {}

    // Cache the fetched records (60 minute TTL for config data)
    setServerCachedData('config', 0, records, 60 * 60);
    console.log('✓ Config records cached successfully (force refresh)');

    return NextResponse.json({
      ...records,
      cachedAt: new Date().toISOString(),
      cacheSource: 'fresh',
    });
  } catch (error) {
    console.error('Failed to fetch config:', error);
    return NextResponse.json({
      ...defaultConfig,
      error: 'Failed to fetch fresh config data',
    }, { status: 500 });
  }
}

async function fetchConfigInBackground() {
  try {
    const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
    const headers = { 'x-api-key': apiKey };

    // Fetch with 2-second timeout per request
    const fetchWithTimeout = (url: string, timeoutMs: number = 2000) => {
      return Promise.race([
        fetch(url, { headers }),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), timeoutMs)
        ),
      ]);
    };

    // Fetch all in parallel with Promise.allSettled to tolerate failures
    // Internal API calls use HTTP on internal network (safe, faster)
    // Fetch ALL records (including inactive) to show complete data
    const [vendorsRes, customersRes, itemsRes, warehousesRes, locationsRes, companiesRes] = await Promise.allSettled([
      fetchWithTimeout(`${API_BASE}/vendors`),
      fetchWithTimeout(`${API_BASE}/customers`),
      fetchWithTimeout(`${API_BASE}/items`),
      fetchWithTimeout(`${API_BASE}/warehouses`),
      fetchWithTimeout(`${API_BASE}/locations`),
      fetchWithTimeout(`${API_BASE}/companies`),
    ]);

    const records: ConfigRecords = { ...defaultConfig };

    // Parse successful responses
    try {
      if (vendorsRes.status === 'fulfilled') {
        const data = await vendorsRes.value.json();
        records.vendors = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (customersRes.status === 'fulfilled') {
        const data = await customersRes.value.json();
        records.customers = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (itemsRes.status === 'fulfilled') {
        const data = await itemsRes.value.json();
        records.items = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (warehousesRes.status === 'fulfilled') {
        const data = await warehousesRes.value.json();
        records.warehouses = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (locationsRes.status === 'fulfilled') {
        const data = await locationsRes.value.json();
        records.locations = Array.isArray(data) ? data : [];
      }
    } catch {}

    try {
      if (companiesRes.status === 'fulfilled') {
        const data = await companiesRes.value.json();
        records.companies = Array.isArray(data) ? data : [];
      }
    } catch {}

    // Cache the fetched records (60 minute TTL for config data - slower changing)
    setServerCachedData('config', 0, records, 60 * 60);
    console.log('✓ Config records cached successfully');
  } catch (error) {
    console.error('Failed to fetch config in background:', error);
  }
}

/**
 * POST to clear config cache
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'clear') {
      clearServerCache('config', 0);
      return NextResponse.json({
        success: true,
        message: 'Config cache cleared',
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

/**
 * Fetch users data
 */
async function fetchUsers() {
  try {
    const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
    const url = `${API_BASE}/users`;
    
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      return NextResponse.json([], { status: 200 });
    }

    const data = await response.json();
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json([], { status: 200 });
  }
}

/**
 * Fetch user permissions data
 */
async function fetchUserPermissions(userId: string | null) {
  try {
    const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
    let url = `${API_BASE}/user_permissions`;
    
    // If user_id is provided, filter by that user
    if (userId) {
      url += `?user_id=eq.${userId}`;
    }
    
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      // Return empty array for 404 (backward compatible)
      if (response.status === 404) {
        console.warn('User permissions table not found, returning empty array');
        return NextResponse.json([]);
      }
      console.error('Failed to fetch user permissions:', response.status);
      return NextResponse.json([], { status: 200 }); // Return empty for backward compatibility
    }

    const data = await response.json();
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    return NextResponse.json([], { status: 200 }); // Return empty for backward compatibility
  }
}

/**
 * Fetch inventory data
 */
async function fetchInventory() {
  try {
    const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
    const url = `${API_BASE}/inventory`;
    
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      return NextResponse.json([], { status: 200 });
    }

    const data = await response.json();
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    return NextResponse.json([], { status: 200 });
  }
}

/**
 * Fetch data from arbitrary tables with optional filtering
 * Supports queries like: ?table=loading_checklist&gatepass_id=117&warehouse_id=1
 */
async function fetchTableData(table: string, searchParams: URLSearchParams) {
  try {
    const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
    const baseUrl = (process.env.NEXT_PUBLIC_URL_GATEPASS_HEADERS?.replace('gatepass_headers', '') || API_BASE + '/').replace(/^https?:\/\//, 'http://');
    
    let url = `${baseUrl}${table}?limit=10000&order=id.desc`;
    
    // Build filter query from all parameters except 'table'
    const filters: string[] = [];
    searchParams.forEach((value, key) => {
      if (key === 'table') return;
      if (key === 'limit' || key === 'order') return;
      
      // Add filter: ?key=eq.value
      filters.push(`${key}=eq.${value}`);
    });
    
    if (filters.length > 0) {
      url += '&' + filters.join('&');
    }
    
    console.log(`📋 Fetching from table: ${table} with filters:`, filters);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`Table ${table} not found, returning empty array`);
        return NextResponse.json([]);
      }
      const errorText = await response.text();
      console.error(`Failed to fetch ${table}: ${response.status}`, errorText);
      return NextResponse.json([], { status: 200 });
    }

    const data = await response.json();
    console.log(`✅ Fetched ${table}:`, Array.isArray(data) ? data.length : 1, 'records');
    return NextResponse.json(Array.isArray(data) ? data : (data ? [data] : []));
  } catch (error) {
    console.error(`Error fetching ${table}:`, error);
    return NextResponse.json([], { status: 200 });
  }
}

export const maxDuration = 60;
