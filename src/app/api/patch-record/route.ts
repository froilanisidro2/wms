import { NextRequest, NextResponse } from 'next/server';
import {
  clearServerCache,
} from '@/utils/serverCacheHelper';

const API_KEY = process.env.NEXT_PUBLIC_X_API_KEY || '';

// Internal API URLs
const getInternalUrl = (endpoint: string) => {
  const base = process.env.NEXT_PUBLIC_URL_ENDPOINT || process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';
  const cleanUrl = base.replace(/^https?:\/\//, '');
  return `http://${cleanUrl}/${endpoint}`;
};

interface PatchRequest {
  table: string; // e.g., 'asn_lines', 'so_lines', 'putaway_transactions'
  id?: number;
  data?: Record<string, any>;
  filters?: Record<string, any>;
}

interface PostRequest {
  table: string;
  data: Record<string, any>;
}

interface DeleteRequest {
  table: string;
  filters?: Record<string, any>;
  id?: number;
}

/**
 * PATCH /api/patch-record
 * Generic PATCH handler for updating database records
 * 
 * Body:
 * {
 *   table: string,        // Table name (asn_lines, so_lines, etc.)
 *   id: number,          // Record ID
 *   data: object         // Fields to update
 * }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as PatchRequest;
    const { table, id, data } = body;

    if (!table || !id || !data) {
      return NextResponse.json(
        { error: 'Missing required fields: table, id, data' },
        { status: 400 }
      );
    }

    // Build URL and fetch
    // Use PostgREST proper filter format - if id column exists, use it
    // Otherwise, assume the primary key column matches the pattern
    const url = `${getInternalUrl(table)}?id=eq.${id}`;
    console.log(`📝 PATCH ${table}:`, { url, payload: data });

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation', // Request the updated record back
      },
      body: JSON.stringify(data),
    });

    const responseText = await response.text();
    console.log(`📝 PATCH response:`, { status: response.status, text: responseText });
    console.log(`🔍 PATCH detail - Table: ${table}, ID: ${id}, Data being sent:`, JSON.stringify(data));
    console.log(`🔍 PATCH full response text:`, responseText);

    if (!response.ok) {
      console.error(`❌ PATCH failed:`, responseText);
      return NextResponse.json(
        { error: `PATCH failed: ${responseText}` },
        { status: response.status }
      );
    }

    // Clear relevant caches after successful PATCH
    clearServerCache('config');
    console.log(`🧹 Cleared cache for table: ${table}`);

    return NextResponse.json({
      success: true,
      message: `${table} record updated`,
    });
  } catch (error: any) {
    console.error('Error in PATCH handler:', error);
    return NextResponse.json(
      { error: `Failed to update record: ${error.message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/patch-record
 * Generic POST handler for creating new records OR updating via PATCH if id is provided
 * 
 * Body for INSERT:
 * {
 *   table: string,        // Table name
 *   data: object          // Record data to insert
 * }
 * 
 * Body for UPDATE (PATCH):
 * {
 *   table: string,        // Table name
 *   id: number,          // Record ID to update
 *   data: object         // Fields to update
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as any;
    
    // Check if this is a DELETE operation masquerading as POST
    if ('filters' in body && body.filters) {
      return await handleDelete(body as DeleteRequest);
    }

    const { table, data, id } = body;

    if (!table || !data) {
      return NextResponse.json(
        { error: 'Missing required fields: table, data' },
        { status: 400 }
      );
    }

    // If id is provided, treat this as an UPDATE (PATCH) operation
    if (id) {
      const url = `${getInternalUrl(table)}?id=eq.${id}`;
      console.log(`📝 PATCH ${table} (via POST):`, { url, payload: data });

      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'x-api-key': API_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(data),
      });

      const responseText = await response.text();
      console.log(`📝 PATCH response:`, { status: response.status, text: responseText });

      if (!response.ok) {
        console.error(`❌ PATCH failed:`, responseText);
        return NextResponse.json(
          { error: `PATCH failed: ${responseText}` },
          { status: response.status }
        );
      }

      // Clear relevant caches after successful PATCH
      clearServerCache('config');
      console.log(`🧹 Cleared cache for table: ${table}`);

      return NextResponse.json({
        success: true,
        message: `${table} record updated`,
      });
    }

    // Otherwise handle as INSERT (POST)
    const url = `${getInternalUrl(table)}`;
    console.log(`➕ POST ${table}:`, { url, payload: data });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const responseText = await response.text();
    console.log(`➕ POST response:`, { status: response.status, text: responseText });

    if (!response.ok) {
      console.error(`❌ POST failed:`, responseText);
      return NextResponse.json(
        { error: `POST failed: ${responseText}` },
        { status: response.status }
      );
    }

    // Clear relevant caches after successful POST
    clearServerCache('config');
    console.log(`🧹 Cleared config cache after creating ${table}`);

    return NextResponse.json({
      success: true,
      message: `${table} record created`,
    });
  } catch (error: any) {
    console.error('Error in POST handler:', error);
    return NextResponse.json(
      { error: `Failed to create record: ${error.message}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/patch-record
 * Generic DELETE handler for soft or hard deletes
 * 
 * Body:
 * {
 *   table: string,        // Table name
 *   id?: number,          // Record ID (optional if filters provided)
 *   filters?: object      // Filter conditions
 * }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json() as DeleteRequest;
    return await handleDelete(body);
  } catch (error: any) {
    console.error('Error in DELETE handler:', error);
    return NextResponse.json(
      { error: `Failed to delete record: ${error.message}` },
      { status: 500 }
    );
  }
}

/**
 * Helper to handle DELETE operations
 */
async function handleDelete(body: DeleteRequest) {
  const { table, id, filters } = body;

  if (!table) {
    return NextResponse.json(
      { error: 'Missing required field: table' },
      { status: 400 }
    );
  }

  // Build query string from filters or id
  let queryString = '';
  if (filters) {
    queryString = Object.entries(filters)
      .map(([key, value]) => `${key}=eq.${value}`)
      .join('&');
  } else if (id) {
    queryString = `id=eq.${id}`;
  } else {
    return NextResponse.json(
      { error: 'Missing required: either id or filters' },
      { status: 400 }
    );
  }

  const url = `${getInternalUrl(table)}?${queryString}`;
  console.log(`🗑️ DELETE ${table}:`, { url });

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
    },
  });

  const responseText = await response.text();
  console.log(`🗑️ DELETE response:`, { status: response.status, text: responseText });

  if (!response.ok) {
    console.error(`❌ DELETE failed:`, responseText);
    return NextResponse.json(
      { error: `DELETE failed: ${responseText}` },
      { status: response.status }
    );
  }

  // Clear relevant caches after successful DELETE
  clearServerCache(table);
  console.log(`🧹 Cleared cache for table: ${table}`);

  return NextResponse.json({
    success: true,
    message: `${table} records deleted`,
  });
}

export const maxDuration = 60;
