import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlPutaway = process.env.NEXT_PUBLIC_URL_PUTAWAY_TRANSACTIONS || '';

/**
 * GET /api/putaway-transactions
 * Proxy for putaway transaction data with optional filters
 * Query params:
 * - receiving_transaction_id: Filter by receiving transaction ID (raw value, not eq.X)
 * - item_id: Filter by item ID (raw value)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const receivingTransactionId = searchParams.get('receiving_transaction_id');
    const itemId = searchParams.get('item_id');

    if (!urlPutaway) {
      return NextResponse.json({ error: 'Putaway URL not configured' }, { status: 500 });
    }

    let queryUrl = urlPutaway;
    const filters = [];

    // Handle receiving_transaction_id - could be "eq.1" or just "1"
    if (receivingTransactionId) {
      const value = receivingTransactionId.startsWith('eq.') ? receivingTransactionId : `eq.${receivingTransactionId}`;
      filters.push(`receiving_transaction_id=${value}`);
    }
    // Handle item_id - could be "eq.1" or just "1"
    if (itemId) {
      const value = itemId.startsWith('eq.') ? itemId : `eq.${itemId}`;
      filters.push(`item_id=${value}`);
    }

    if (filters.length > 0) {
      queryUrl += '?' + filters.join('&');
    }

    console.log('📍 [GET] Fetching putaway from:', queryUrl);

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to fetch putaway transactions:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to fetch putaway transactions: ${errorText}` },
        { status: response.status }
      );
    }

    // Handle empty response - PostgREST sometimes returns empty body
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0' || !response.body) {
      console.log('ℹ️ Empty putaway response');
      return NextResponse.json([]);
    }

    const text = await response.text();
    if (!text) {
      console.log('ℹ️ Empty putaway response body');
      return NextResponse.json([]);
    }

    const data = JSON.parse(text);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('❌ Putaway transaction GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/putaway-transactions
 * Create a new putaway transaction
 */
export async function POST(request: NextRequest) {
  try {
    if (!urlPutaway) {
      return NextResponse.json({ error: 'Putaway URL not configured' }, { status: 500 });
    }

    const body = await request.json();

    console.log('📦 [POST /api/putaway-transactions] Creating putaway transaction:', body);

    const response = await fetch(urlPutaway, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to create putaway transaction:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to create putaway transaction: ${errorText}` },
        { status: response.status }
      );
    }

    // Handle PostgREST response - it may return empty body for inserts
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0' || !response.body) {
      console.log('✅ Putaway transaction created successfully (empty response)');
      return NextResponse.json({ success: true, message: 'Putaway transaction created' });
    }

    const text = await response.text();
    if (!text) {
      console.log('✅ Putaway transaction created successfully (empty response body)');
      return NextResponse.json({ success: true, message: 'Putaway transaction created' });
    }

    const data = JSON.parse(text);
    console.log('✅ Putaway transaction created successfully:', data);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('❌ Putaway transaction POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/putaway-transactions
 * Update a putaway transaction
 */
export async function PATCH(request: NextRequest) {
  try {
    if (!urlPutaway) {
      return NextResponse.json({ error: 'Putaway URL not configured' }, { status: 500 });
    }

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    const body = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
    }

    console.log(`📝 [PATCH /api/putaway-transactions] Updating transaction ${id}:`, body);

    const response = await fetch(`${urlPutaway}?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to update putaway transaction:', response.status, errorText);
      return NextResponse.json(
        { error: `Failed to update putaway transaction: ${errorText}` },
        { status: response.status }
      );
    }

    // Handle empty response from PATCH
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0' || !response.body) {
      console.log('✅ Putaway transaction updated successfully (empty response)');
      return NextResponse.json({ success: true, message: 'Putaway transaction updated' });
    }

    const text = await response.text();
    if (!text) {
      console.log('✅ Putaway transaction updated successfully (empty response body)');
      return NextResponse.json({ success: true, message: 'Putaway transaction updated' });
    }

    const data = JSON.parse(text);
    console.log('✅ Putaway transaction updated successfully:', data);
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('❌ Putaway transaction PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export const maxDuration = 180; // 3 minutes for putaway transactions
