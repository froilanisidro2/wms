import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';

/**
 * POST /api/bulk-insert
 * Insert a single record via the API layer (avoids CSP violations)
 * Routes through backend API with proper authentication
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { table, data } = body;

    if (!table || !data) {
      return NextResponse.json(
        { error: 'Missing table or data parameter' },
        { status: 400 }
      );
    }

    const url = `${apiBase}/${table}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Failed to insert into ${table}: ${errorText}` },
        { status: response.status }
      );
    }

    // Handle empty response
    const contentLength = response.headers.get('content-length');
    if (contentLength === '0' || !response.body) {
      return NextResponse.json({ success: true, message: 'Record inserted' });
    }

    const text = await response.text();
    if (!text) {
      return NextResponse.json({ success: true, message: 'Record inserted' });
    }

    const result = JSON.parse(text);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Insert failed' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
