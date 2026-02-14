import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_X_API_KEY || '';

const getInternalUrl = (endpoint: string) => {
  const base = process.env.NEXT_PUBLIC_URL_ENDPOINT || process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';
  const cleanUrl = base.replace(/^https?:\/\//, '');
  return `http://${cleanUrl}/${endpoint}`;
};

/**
 * GET /api/so-data
 * Fetch SO (Sales Order) headers and/or lines data with optional filters
 * Query parameters:
 * - dataType: 'headers' | 'lines' | 'all' (default: 'all')
 * - headerId: filter by so_header_id
 * - status: filter by status
 * - customerCode: filter by customer_code
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const dataType = searchParams.get('dataType') || 'all';
    const headerId = searchParams.get('headerId');
    const status = searchParams.get('status');
    const customerCode = searchParams.get('customerCode');

    let headers: any[] = [];
    let lines: any[] = [];

    // Fetch headers if needed
    if (dataType === 'headers' || dataType === 'all') {
      let headersUrl = getInternalUrl('so_headers');
      const headersFilters: string[] = [];

      if (status) {
        headersFilters.push(`status=eq.${status}`);
      }
      if (customerCode) {
        headersFilters.push(`customer_code=eq.${customerCode}`);
      }

      if (headersFilters.length > 0) {
        headersUrl += '?' + headersFilters.join('&');
      }

      console.log('📡 Fetching SO headers from:', headersUrl);
      const headersRes = await fetch(headersUrl, {
        headers: { 'x-api-key': API_KEY },
      });

      if (!headersRes.ok) {
        console.error('❌ Failed to fetch SO headers:', headersRes.status);
        return NextResponse.json(
          { error: 'Failed to fetch SO headers' },
          { status: headersRes.status }
        );
      }

      const data = await headersRes.json();
      headers = Array.isArray(data) ? data : [];
      console.log('✓ SO headers fetched:', headers.length);
    }

    // Fetch lines if needed
    if (dataType === 'lines' || dataType === 'all') {
      let linesUrl = getInternalUrl('so_lines');
      const linesFilters: string[] = [];

      if (headerId) {
        linesFilters.push(`so_header_id=eq.${headerId}`);
      }

      if (linesFilters.length > 0) {
        linesUrl += '?' + linesFilters.join('&');
      }

      console.log('📡 Fetching SO lines from:', linesUrl);
      const linesRes = await fetch(linesUrl, {
        headers: { 'x-api-key': API_KEY },
      });

      if (!linesRes.ok) {
        console.error('❌ Failed to fetch SO lines:', linesRes.status);
        return NextResponse.json(
          { error: 'Failed to fetch SO lines' },
          { status: linesRes.status }
        );
      }

      const data = await linesRes.json();
      lines = Array.isArray(data) ? data : [];
      console.log('✓ SO lines fetched:', lines.length);
    }

    return NextResponse.json({
      soHeaders: headers,
      soLines: lines,
    });
  } catch (error: any) {
    console.error('Error fetching SO data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SO data' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/so-data
 * Create SO header and/or lines
 * Body:
 * {
 *   action: 'createHeader' | 'createLines'
 *   header?: {...}  // SO header data
 *   lines?: [...]   // SO lines data array
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, header, lines, headerId } = body;

    if (action === 'updateHeader') {
      // Update SO header
      if (!headerId || !header) {
        return NextResponse.json(
          { error: 'Missing headerId or header data' },
          { status: 400 }
        );
      }

      const headersUrl = getInternalUrl('so_headers') + `?id=eq.${headerId}`;
      console.log('📝 Updating SO header:', headerId, header);

      const response = await fetch(headersUrl, {
        method: 'PATCH',
        headers: {
          'x-api-key': API_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(header),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to update SO header:', response.status, errorText);
        return NextResponse.json(
          { error: `Failed to update SO header: ${errorText}` },
          { status: response.status }
        );
      }

      console.log('✅ SO header updated:', headerId);
      return NextResponse.json({
        success: true,
        message: 'SO header updated',
        headerId,
      });
    }

    if (action === 'createHeader') {
      // Create SO header and return the created record with ID
      if (!header) {
        return NextResponse.json(
          { error: 'Missing header data' },
          { status: 400 }
        );
      }

      const headersUrl = getInternalUrl('so_headers');
      console.log('📤 Creating SO header:', header);

      const response = await fetch(headersUrl, {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(header),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to create SO header:', response.status, errorText);
        return NextResponse.json(
          { error: `Failed to create SO header: ${errorText}` },
          { status: response.status }
        );
      }

      // Handle empty response from POST
      const contentLength = response.headers.get('content-length');
      const responseText = contentLength !== '0' ? await response.text() : '';

      // Fetch the newly created header by sorting by ID descending (get most recent)
      const latestUrl = getInternalUrl('so_headers') + '?order=id.desc&limit=1';
      const latestRes = await fetch(latestUrl, {
        headers: { 'x-api-key': API_KEY },
      });

      if (!latestRes.ok) {
        console.error('❌ Failed to fetch latest SO header');
        return NextResponse.json(
          { error: 'Header created but could not fetch ID' },
          { status: 500 }
        );
      }

      const latestData = await latestRes.json();
      const createdHeader = Array.isArray(latestData) && latestData.length > 0 ? latestData[0] : null;

      if (!createdHeader) {
        return NextResponse.json(
          { error: 'Header created but could not retrieve ID' },
          { status: 500 }
        );
      }

      console.log('✅ SO header created:', createdHeader.id);
      return NextResponse.json({
        success: true,
        message: 'SO header created',
        data: createdHeader,
      });
    }

    if (action === 'createLines') {
      // Create multiple SO lines
      if (!Array.isArray(lines) || lines.length === 0) {
        return NextResponse.json(
          { error: 'Missing or empty lines data' },
          { status: 400 }
        );
      }

      const linesUrl = getInternalUrl('so_lines');
      console.log(`📤 Creating ${lines.length} SO lines`);

      const results = [];
      for (const line of lines) {
        const response = await fetch(linesUrl, {
          method: 'POST',
          headers: {
            'x-api-key': API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(line),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Failed to create SO line:`, response.status, errorText);
          return NextResponse.json(
            { error: `Failed to create SO line: ${errorText}` },
            { status: response.status }
          );
        }
        results.push({ success: true, line });
      }

      console.log('✅ All SO lines created');
      return NextResponse.json({
        success: true,
        message: `${lines.length} SO lines created`,
        data: results,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use createHeader or createLines' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Error in SO data POST:', error);
    return NextResponse.json(
      { error: `Failed to create SO data: ${error.message}` },
      { status: 500 }
    );
  }
}

export const maxDuration = 180; // 3 minutes for SO data operations
