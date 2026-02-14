import { NextRequest, NextResponse } from 'next/server';
import {
  getServerCachedData,
  setServerCachedData,
  clearServerCache,
} from '@/utils/serverCacheHelper';

interface InboundRecords {
  headers: any[];
  lines: any[];
  asnInventory: any[];
  cachedAt?: string;
  cacheSource?: 'server' | 'fresh';
}

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlHeaders = process.env.NEXT_PUBLIC_URL_ASN_HEADERS || '';
const urlLines = process.env.NEXT_PUBLIC_URL_ASN_LINES || '';
const urlAsnInventory = process.env.NEXT_PUBLIC_URL_ASN_INVENTORY || '';
const urlPutawayTransactions = process.env.NEXT_PUBLIC_URL_PUTAWAY_TRANSACTIONS || '';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const year = parseInt(searchParams.get('year') || new Date().getFullYear().toString());
    const warehouseId = searchParams.get('warehouse'); // Get warehouse filter
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Check server cache first (unless forced refresh)
    if (!forceRefresh) {
      const filters = warehouseId ? { warehouse: warehouseId } : undefined;
      const cachedRecords = getServerCachedData<InboundRecords>('inbound', year, filters);
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
    let headersUrlWithFilter = `${urlHeaders}?asn_date=gte.${startDate}&asn_date=lte.${endDate}&order=asn_date.desc`;
    // PostgREST returns all columns by default, just ensure order
    let linesUrlWithFilter = `${urlLines}?limit=10000&order=id.asc`;
    let asnInvUrl = `${urlAsnInventory}?quantity_received=gt.0&limit=10000&order=item_id`;
    let putawayUrl = `${urlPutawayTransactions}?limit=10000&order=receiving_transaction_id`;
    
    // Add warehouse filter if provided (only to headers, not lines - asn_lines doesn't have warehouse_id)
    if (warehouseId) {
      headersUrlWithFilter += `&warehouse_id=eq.${warehouseId}`;
      asnInvUrl += `&warehouse_id=eq.${warehouseId}`;
      putawayUrl += `&warehouse_id=eq.${warehouseId}`;
      console.log(`📦 Inbound: Filtering by warehouse ${warehouseId}`);
    }

    const [headersRes, linesRes, asnInvRes, putawayRes] = await Promise.all([
      fetch(headersUrlWithFilter, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      }),
      fetch(linesUrlWithFilter, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      }),
      fetch(asnInvUrl, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      }),
      urlPutawayTransactions ? fetch(putawayUrl, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      }).catch(err => {
        console.warn('⚠️ Failed to fetch putaway transactions:', err);
        return new Response(JSON.stringify([]), { status: 200 });
      }) : Promise.resolve(new Response(JSON.stringify([]), { status: 200 })),
    ]);

    const headersData = await headersRes.json();
    const linesData = await linesRes.json();
    const asnInvData = await asnInvRes.json();
    const putawayData = await putawayRes.json();

    // Log first line to verify putaway_marked is included
    if (Array.isArray(linesData) && linesData.length > 0) {
      console.log('📦 First line from API (inbound-records):', linesData[0]);
    }

    const normalizedHeaders = Array.isArray(headersData) ? headersData : (headersData ? [headersData] : []);
    const normalizedLines = Array.isArray(linesData) ? linesData : (linesData ? [linesData] : []);
    const normalizedAsnInv = Array.isArray(asnInvData) ? asnInvData : (asnInvData ? [asnInvData] : []);
    const normalizedPutaway = Array.isArray(putawayData) ? putawayData : (putawayData ? [putawayData] : []);
    
    // Create a map of asn_line_id -> remarks from putaway transactions
    const putawayByLineId = new Map();
    normalizedPutaway.forEach((pt: any) => {
      if (pt.receiving_transaction_id && pt.asn_line_id) {
        putawayByLineId.set(pt.asn_line_id, pt.remarks);
      }
    });

    // Don't filter headers by warehouse - asn_headers API already filters by warehouse_id
    // Just use the headers and lines as-is, no client-side filtering
    // BUT: merge remarks from putaway_transactions
    const filteredHeaders = normalizedHeaders;
    const filteredLines = normalizedLines.map((line: any) => ({
      ...line,
      remarks: putawayByLineId.get(line.id) || line.remarks || '',
    }));

    const records: InboundRecords = {
      headers: filteredHeaders,
      lines: filteredLines,
      asnInventory: normalizedAsnInv,
    };

    // Cache the records on server (5 minute TTL for transactional data)
    const filters = warehouseId ? { warehouse: warehouseId } : undefined;
    setServerCachedData('inbound', year, records, 5 * 60, filters);

    return NextResponse.json({
      ...records,
      cachedAt: new Date().toISOString(),
      cacheSource: 'fresh',
    });
  } catch (error) {
    console.error('Error fetching inbound records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inbound records' },
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
      clearServerCache('inbound', year);
      return NextResponse.json({
        success: true,
        message: `Cache cleared for inbound/${year}`,
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
 * PATCH to update ASN header status
 */
export async function PATCH(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { error: 'Missing ASN header ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { status } = body;

    if (!status) {
      return NextResponse.json(
        { error: 'Missing status field' },
        { status: 400 }
      );
    }

    // Update ASN header status in backend
    const patchUrl = `${urlHeaders}?id=eq.${id}`;
    const response = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to update ASN header status:', errorText);
      return NextResponse.json(
        { error: 'Failed to update status', details: errorText },
        { status: response.status }
      );
    }

    // Clear cache for the year to ensure fresh data on next fetch
    const year = new Date().getFullYear();
    clearServerCache('inbound', year);
    clearServerCache('inbound', year - 1); // Also clear previous year if needed

    return NextResponse.json({ 
      success: true,
      message: 'Status updated successfully'
    });
  } catch (error) {
    console.error('Error updating ASN header status:', error);
    return NextResponse.json(
      { error: 'Failed to update status' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
