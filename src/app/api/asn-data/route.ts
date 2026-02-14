import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_X_API_KEY || '';

const getInternalUrl = (endpoint: string) => {
  const base = process.env.NEXT_PUBLIC_URL_ENDPOINT || process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';
  const cleanUrl = base.replace(/^https?:\/\//, '');
  return `http://${cleanUrl}/${endpoint}`;
};

/**
 * GET /api/asn-data
 * Fetch ASN headers and/or lines data with optional filters
 * Query parameters:
 * - dataType: 'headers' | 'lines' | 'all' (default: 'all')
 * - headerId: filter by asn_header_id
 * - status: filter by status
 * - vendorCode: filter by vendor_code
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const dataType = searchParams.get('dataType') || 'all';
    const headerId = searchParams.get('headerId');
    const status = searchParams.get('status');
    const vendorCode = searchParams.get('vendorCode');

    let headers: any[] = [];
    let lines: any[] = [];

    // Fetch headers if needed
    if (dataType === 'headers' || dataType === 'all') {
      let headersUrl = getInternalUrl('asn_headers');
      const headersFilters: string[] = [];

      if (status) {
        headersFilters.push(`status=eq.${status}`);
      }
      if (vendorCode) {
        headersFilters.push(`vendor_code=eq.${vendorCode}`);
      }

      if (headersFilters.length > 0) {
        headersUrl += '?' + headersFilters.join('&');
      }

      console.log('📡 Fetching ASN headers from:', headersUrl);
      const headersRes = await fetch(headersUrl, {
        headers: { 
          'x-api-key': API_KEY,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
      });

      if (!headersRes.ok) {
        console.error('❌ Failed to fetch ASN headers:', headersRes.status);
        return NextResponse.json(
          { error: 'Failed to fetch ASN headers' },
          { status: headersRes.status }
        );
      }

      const data = await headersRes.json();
      headers = Array.isArray(data) ? data : [];
      console.log('✓ ASN headers fetched:', headers.length);
    }

    // Fetch lines if needed
    if (dataType === 'lines' || dataType === 'all') {
      let linesUrl = getInternalUrl('asn_lines');
      const linesFilters: string[] = [];

      if (headerId) {
        linesFilters.push(`asn_header_id=eq.${headerId}`);
      }

      // Use explicit limit and offset for pagination (PostgREST standard)
      // This overrides the default limit and ensures we get all records
      linesFilters.push('limit=10000');
      linesFilters.push('offset=0');

      if (linesFilters.length > 0) {
        linesUrl += '?' + linesFilters.join('&');
      }

      console.log('📡 Fetching ASN lines from:', linesUrl);
      const linesRes = await fetch(linesUrl, {
        headers: { 
          'x-api-key': API_KEY,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
      });

      if (!linesRes.ok) {
        console.error('❌ Failed to fetch ASN lines:', linesRes.status);
        return NextResponse.json(
          { error: 'Failed to fetch ASN lines' },
          { status: linesRes.status }
        );
      }

      const data = await linesRes.json();
      lines = Array.isArray(data) ? data : [];
      console.log('✓ ASN lines fetched:', lines.length);
      console.log('📡 Response Content-Range:', linesRes.headers.get('Content-Range'));
      if (lines.length > 0) {
        console.log('📋 Sample line from API:', lines[0]);
        console.log('📋 putaway_marked field:', lines[0].putaway_marked, 'Type:', typeof lines[0].putaway_marked);
      }
    }

    return NextResponse.json({
      asnHeaders: headers,
      asnLines: lines,
    });
  } catch (error: any) {
    console.error('Error fetching ASN data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ASN data' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/asn-data
 * Create ASN header and/or lines
 * Body:
 * {
 *   action: 'createHeader' | 'createLines'
 *   header?: {...}  // ASN header data
 *   lines?: [...]   // ASN lines data array
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, header, lines } = body;

    if (action === 'createHeader') {
      // Create ASN header and return the created record with ID
      if (!header) {
        return NextResponse.json(
          { error: 'Missing header data' },
          { status: 400 }
        );
      }

      const headersUrl = getInternalUrl('asn_headers');
      console.log('📤 Creating ASN header:', header);

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
        console.error('❌ Failed to create ASN header:', response.status, errorText);
        return NextResponse.json(
          { error: `Failed to create ASN header: ${errorText}` },
          { status: response.status }
        );
      }

      // Handle empty response from POST
      const contentLength = response.headers.get('content-length');
      const responseText = contentLength !== '0' ? await response.text() : '';

      // Fetch the newly created header by sorting by ID descending (get most recent)
      const latestUrl = getInternalUrl('asn_headers') + '?order=id.desc&limit=1';
      const latestRes = await fetch(latestUrl, {
        headers: { 'x-api-key': API_KEY },
      });

      if (!latestRes.ok) {
        console.error('❌ Failed to fetch latest ASN header');
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

      console.log('✅ ASN header created:', createdHeader.id);
      return NextResponse.json({
        success: true,
        message: 'ASN header created',
        data: createdHeader,
      });
    }

    if (action === 'createLines') {
      // Create multiple ASN lines
      if (!Array.isArray(lines) || lines.length === 0) {
        return NextResponse.json(
          { error: 'Missing or empty lines data' },
          { status: 400 }
        );
      }

      const linesUrl = getInternalUrl('asn_lines');
      console.log(`📤 Creating ${lines.length} ASN lines`);

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
          console.error(`❌ Failed to create ASN line:`, response.status, errorText);
          return NextResponse.json(
            { error: `Failed to create ASN line: ${errorText}` },
            { status: response.status }
          );
        }
        results.push({ success: true, line });
      }

      console.log('✅ All ASN lines created');
      return NextResponse.json({
        success: true,
        message: `${lines.length} ASN lines created`,
        data: results,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use createHeader or createLines' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Error in ASN data POST:', error);
    return NextResponse.json(
      { error: `Failed to create ASN data: ${error.message}` },
      { status: 500 }
    );
  }
}

export const maxDuration = 180; // 3 minutes for ASN data operations
