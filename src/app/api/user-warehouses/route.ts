import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.NEXT_PUBLIC_X_API_KEY || '';
// Internal API call uses HTTP on internal network (safe, faster)
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://');
const baseUrl = process.env.NEXT_PUBLIC_URL_USER_WAREHOUSES || `${API_BASE}/user_warehouses`;
const url = baseUrl.replace(/^https?:\/\//, 'http://');

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    let userId = searchParams.get('user_id');

    // If user_id not provided, fetch ALL user-warehouse assignments
    // This is needed for the config page to load all assignments
    if (!userId) {
      const fetchUrl = `${url}`;
      console.log('📡 Fetching ALL user warehouses from:', fetchUrl);

      const response = await fetch(fetchUrl, {
        headers: {
          'x-api-key': API_KEY,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('❌ Failed to fetch user warehouses:', response.status);
        return NextResponse.json([], { status: 200 }); // Return empty array for backward compatibility
      }

      const data = await response.json();
      console.log('✓ All user warehouses fetched:', data?.length || 0);
      return NextResponse.json(data);
    }

    // Handle both formats: "18" and "eq.18"
    if (userId.startsWith('eq.')) {
      userId = userId.substring(3);
    }

    // Fetch from PostgREST via internal HTTP
    const fetchUrl = `${url}?user_id=eq.${userId}`;
    console.log('📡 Fetching user warehouses from:', fetchUrl);

    const response = await fetch(fetchUrl, {
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('❌ Failed to fetch user warehouses:', response.status);
      return NextResponse.json([], { status: 200 }); // Return empty array for backward compatibility
    }

    const data = await response.json();
    console.log('✓ User warehouses fetched:', data?.length || 0);

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error fetching user warehouses:', error);
    return NextResponse.json([], { status: 200 }); // Return empty array for backward compatibility
  }
}

export const maxDuration = 60;
