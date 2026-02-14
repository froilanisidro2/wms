import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlASNInventory = process.env.NEXT_PUBLIC_URL_ASN_INVENTORY || '';

/**
 * GET /api/asn-inventory
 * Proxy for ASN inventory data with optional filters
 * Query params:
 * - asn_line_id: Filter by ASN line ID
 * - warehouse_id: Filter by warehouse ID
 * - status: Filter by status
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const asnLineId = searchParams.get('asn_line_id');
    const warehouseId = searchParams.get('warehouse_id');
    const status = searchParams.get('status');

    if (!urlASNInventory) {
      return NextResponse.json({ error: 'ASN Inventory URL not configured' }, { status: 500 });
    }

    let queryUrl = urlASNInventory;
    const filters = [];

    if (asnLineId) {
      filters.push(`asn_line_id=eq.${asnLineId}`);
    }
    if (warehouseId) {
      filters.push(`warehouse_id=eq.${warehouseId}`);
    }
    if (status) {
      filters.push(`status=eq.${status}`);
    }

    if (filters.length > 0) {
      queryUrl += '?' + filters.join('&');
    }

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to fetch ASN inventory:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to fetch ASN inventory: ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('❌ ASN inventory GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/asn-inventory
 * Create a new ASN inventory record
 */
export async function POST(request: NextRequest) {
  try {
    if (!urlASNInventory) {
      return NextResponse.json({ error: 'ASN Inventory URL not configured' }, { status: 500 });
    }

    const body = await request.json();

    console.log('📦 [POST /api/asn-inventory] Creating ASN inventory record:', body);

    const response = await fetch(urlASNInventory, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to create ASN inventory:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to create ASN inventory: ${errorText}` },
        { status: response.status }
      );
    }

    // Handle empty response body (PostgREST returns empty for inserts)
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0' || !response.body) {
      console.log('✅ ASN inventory created successfully (empty response)');
      return NextResponse.json({ success: true, message: 'ASN inventory created' });
    }

    const text = await response.text();
    if (!text) {
      console.log('✅ ASN inventory created successfully (empty response body)');
      return NextResponse.json({ success: true, message: 'ASN inventory created' });
    }

    const data = JSON.parse(text);
    console.log('✅ ASN inventory created successfully:', data);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('❌ ASN inventory POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/asn-inventory
 * Update an ASN inventory record
 */
export async function PATCH(request: NextRequest) {
  try {
    if (!urlASNInventory) {
      return NextResponse.json({ error: 'ASN Inventory URL not configured' }, { status: 500 });
    }

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const body = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    }

    console.log(`📝 [PATCH /api/asn-inventory] Updating record ${id}:`, body);

    const response = await fetch(`${urlASNInventory}?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to update ASN inventory:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to update ASN inventory: ${errorText}` },
        { status: response.status }
      );
    }

    // Handle empty response from PATCH
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0' || !response.body) {
      console.log('✅ ASN inventory updated successfully (empty response)');
      return NextResponse.json({ success: true, message: 'ASN inventory updated' });
    }

    const text = await response.text();
    if (!text) {
      console.log('✅ ASN inventory updated successfully (empty response body)');
      return NextResponse.json({ success: true, message: 'ASN inventory updated' });
    }

    const data = JSON.parse(text);
    console.log('✅ ASN inventory updated successfully:', data);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('❌ ASN inventory PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const maxDuration = 60;
