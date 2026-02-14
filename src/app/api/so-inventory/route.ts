import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';

/**
 * GET /api/so-inventory
 * Proxy for SO inventory data with optional filters
 * Query params:
 * - so_line_id: Filter by SO line ID(s)
 * - allocated: Filter by allocated status
 * - picked: Filter by picked status  
 * - shipped: Filter by shipped status
 * - batch_number: Filter by batch number
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    // Build query URL based on provided filters
    let queryUrl = urlSOInventory + '?limit=10000&order=id.desc';
    
    // Add filters if provided
    if (searchParams.get('so_line_id')) {
      const soLineIds = searchParams.get('so_line_id')!.split(',').join(',');
      queryUrl += `&so_line_id=in.(${soLineIds})`;
    }
    
    if (searchParams.get('status')) {
      queryUrl += `&status=eq.${searchParams.get('status')}`;
    }
    
    if (searchParams.get('batch_number')) {
      queryUrl += `&batch_number=eq.${searchParams.get('batch_number')}`;
    }
    
    if (searchParams.get('select')) {
      queryUrl += `&select=${searchParams.get('select')}`;
    }

    console.log(`📦 SO Inventory API: Fetching from ${queryUrl}`);

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SO Inventory API error: ${response.status}`, errorText);
      return NextResponse.json(
        { error: 'Failed to fetch SO inventory', details: errorText },
        { status: response.status }
      );
    }

    let data = await response.json();
    
    // Enrich SO inventory records with location_code from locations table
    if (Array.isArray(data) && data.length > 0) {
      try {
        const urlLocations = process.env.NEXT_PUBLIC_URL_LOCATIONS || '';
        const locResponse = await fetch(urlLocations + '?limit=10000', {
          headers: { 'x-api-key': apiKey }
        });
        
        if (locResponse.ok) {
          const locations = await locResponse.json();
          const locationMap = new Map(locations.map((l: any) => [l.id, l.location_code]));
          
          // Enrich each SO inventory record with location_code
          data = data.map((record: any) => ({
            ...record,
            location_code: record.location_code || locationMap.get(record.location_id)
          }));
          
          console.log(`✅ Enriched ${data.length} SO inventory records with location codes`);
        }
      } catch (err) {
        console.warn('⚠️ Could not enrich SO inventory with location codes:', err);
      }
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in SO inventory API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SO inventory' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/so-inventory
 * Create new SO inventory records (allocations)
 * Body: Array of allocation records to insert
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Body must be an array of allocation records' },
        { status: 400 }
      );
    }

    console.log(`📝 SO Inventory POST: Creating ${body.length} allocation records`);
    console.log(`📋 Payload sample:`, JSON.stringify(body[0], null, 2));

    const postUrl = urlSOInventory;
    console.log(`🔗 Posting to: ${postUrl}`);
    
    const response = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    console.log(`📊 Response status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SO Inventory POST error: ${response.status}`, errorText);
      return NextResponse.json(
        { error: 'Failed to create SO inventory allocations', details: errorText },
        { status: response.status }
      );
    }

    // PostgREST returns empty body for successful inserts
    const contentLength = response.headers.get('content-length');
    const contentType = response.headers.get('content-type');
    
    let result: any;
    
    if (contentLength === '0' || !contentType?.includes('application/json')) {
      // Empty response - successful insert
      console.log(`✅ SO Inventory POST: Successfully created allocations (empty response from PostgREST)`);
      result = { success: true, message: `${body.length} records inserted` };
    } else {
      // Try to parse JSON response
      const text = await response.text();
      if (text) {
        try {
          result = JSON.parse(text);
          console.log(`✅ SO Inventory POST: Successfully created allocations`);
        } catch (parseErr) {
          console.warn(`⚠️ Could not parse response as JSON, treating as success:`, text.slice(0, 100));
          result = { success: true, message: `${body.length} records inserted` };
        }
      } else {
        console.log(`✅ SO Inventory POST: Successfully created allocations (empty text response)`);
        result = { success: true, message: `${body.length} records inserted` };
      }
    }
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('❌ Error creating SO inventory allocations:', error.message);
    console.error('Stack:', error.stack);
    return NextResponse.json(
      { error: 'Failed to create SO inventory allocations', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/so-inventory
 * Update SO inventory record(s)
 * Query params:
 * - id: Record ID to update
 */
export async function PATCH(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json(
        { error: 'Missing SO inventory ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    
    const patchUrl = `${urlSOInventory}?id=eq.${id}`;
    console.log(`🔄 SO Inventory PATCH: ${patchUrl}`, body);

    const response = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SO Inventory PATCH error: ${response.status}`, errorText);
      return NextResponse.json(
        { error: 'Failed to update SO inventory', details: errorText },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating SO inventory:', error);
    return NextResponse.json(
      { error: 'Failed to update SO inventory' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
