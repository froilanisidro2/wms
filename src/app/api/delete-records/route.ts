import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';

interface DeleteOperation {
  table: string;
  filters: Record<string, string>;
}

async function deleteFromTable(tableName: string, filters: Record<string, string>) {
  const filterParams = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    filterParams.append(key, value);
  }

  const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';
  const url = `${apiBase.replace(/^https?:\/\//, 'http://')}/${tableName}?${filterParams.toString()}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey },
  });

  return response;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Handle single delete
    if (body.table && body.filters) {
      const response = await deleteFromTable(body.table, body.filters);
      
      if (!response.ok && response.status !== 404) {
        const text = await response.text();
        return NextResponse.json(
          { error: `Failed to delete from ${body.table}`, details: text },
          { status: response.status }
        );
      }

      // Clear server cache after delete
      try {
        const cacheUrl = new URL('/api/cache-control', request.url);
        cacheUrl.searchParams.set('action', 'clear');
        cacheUrl.searchParams.set('table', body.table);
        await fetch(cacheUrl.toString());
      } catch (err) {
        console.error('Cache clear error:', err);
      }

      return NextResponse.json({ success: true, status: response.status });
    }

    // Handle batch delete operations (array)
    if (Array.isArray(body)) {
      const results = [];
      const errors = [];

      // Process operations sequentially and wait for each to complete
      for (const op of body) {
        try {
          const response = await deleteFromTable(op.table, op.filters);
          results.push({ table: op.table, status: response.status, success: response.ok || response.status === 404 });
          
          if (response.ok || response.status === 404) {
            // Clear cache for this table
            try {
              const cacheUrl = new URL('/api/cache-control', request.url);
              cacheUrl.searchParams.set('action', 'clear');
              cacheUrl.searchParams.set('table', op.table);
              await fetch(cacheUrl.toString());
            } catch (err) {
              console.error('Cache clear error:', err);
            }
            // Add small delay between operations to ensure database consistency
            await new Promise(resolve => setTimeout(resolve, 50));
          } else {
            const text = await response.text();
            errors.push({ table: op.table, status: response.status, error: text });
            console.error(`Delete failed for ${op.table}:`, text);
          }
        } catch (err: any) {
          errors.push({ table: op.table, error: err.message });
        }
      }

      if (errors.length > 0) {
        return NextResponse.json(
          { results, errors, success: false },
          { status: 400 }
        );
      }

      return NextResponse.json({ results, success: true });
    }

    return NextResponse.json(
      { error: 'Invalid request format' },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('Delete operation error:', err);
    return NextResponse.json(
      { error: 'Internal server error', details: err.message },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
