import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_X_API_KEY || '';

const getInternalUrl = (endpoint: string) => {
  const base = process.env.NEXT_PUBLIC_URL_ENDPOINT || process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';
  const cleanUrl = base.replace(/^https?:\/\//, '');
  return `http://${cleanUrl}/${endpoint}`;
};

/**
 * GET /api/locations
 * Fetch warehouse locations with optional filters
 * Query parameters:
 * - warehouseId: filter by warehouse_id
 * - isActive: filter by is_active (true/false) - default is undefined (all locations)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const warehouseId = searchParams.get('warehouseId');
    const isActive = searchParams.get('isActive');

    let url = getInternalUrl('warehouse_locations');
    const filters: string[] = [];

    if (warehouseId) {
      filters.push(`warehouse_id=eq.${warehouseId}`);
    }
    // Only filter by isActive if explicitly provided
    if (isActive !== null) {
      filters.push(`is_active=eq.${isActive === 'true'}`);
    }

    if (filters.length > 0) {
      url += '?' + filters.join('&');
    }

    console.log('📡 Fetching locations from:', url);
    const response = await fetch(url, {
      headers: { 'x-api-key': API_KEY },
    });

    if (!response.ok) {
      console.error('❌ Failed to fetch locations:', response.status);
      return NextResponse.json([], { status: 200 }); // Return empty array for compatibility
    }

    const data = await response.json();
    const locations = Array.isArray(data) ? data : [];
    console.log('✓ Locations fetched:', locations.length);
    if (locations.length > 0) {
      console.log('📍 Sample location:', JSON.stringify(locations[0], null, 2));
    }

    return NextResponse.json(locations);
  } catch (error: any) {
    console.error('Error fetching locations:', error);
    return NextResponse.json([], { status: 200 }); // Return empty array on error
  }
}

export const maxDuration = 60;
