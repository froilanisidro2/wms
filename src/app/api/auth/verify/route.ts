import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify authentication via HTTP-Only cookie
 * Called on app mount to restore user session
 */
const API_KEY = process.env.NEXT_PUBLIC_X_API_KEY || '';

export async function GET(request: NextRequest) {
  try {
    // Get auth_token from cookies
    const token = request.cookies.get('auth_token')?.value;
    console.log('🔍 Verify endpoint - Cookie received:', token ? token.substring(0, 20) + '...' : 'NONE');

    if (!token) {
      console.log('❌ No auth_token cookie found');
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Decode base64 token to get user info
    // Token format: base64(userRole:userId:username)
    let userRole = '';
    let userId = 0;
    let username = '';

    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parts = decoded.split(':');
      userRole = parts[0];
      userId = parseInt(parts[1], 10);
      username = parts[2];
    } catch (decodeError) {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 401 }
      );
    }

    // Fetch user details from PostgREST (uses environment variables)
    const baseUrl = process.env.NEXT_PUBLIC_URL_USERS || `${(process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://')}/users`;
    const postgrestUrl = baseUrl.replace(/^https?:\/\//, 'http://');
    const fetchUrl = `${postgrestUrl}?id=eq.${userId}`;
    console.log('📡 Fetching user from:', fetchUrl);
    
    const response = await fetch(fetchUrl, {
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
    });

    console.log('📊 API Response Status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to fetch user:', response.status, errorText);
      return NextResponse.json(
        { error: 'Failed to fetch user' },
        { status: 401 }
      );
    }

    const users = await response.json();
    console.log('✓ Users found:', users?.length || 0);
    
    let user;
    
    // For super admin (id 1), if not found in database, return hardcoded data
    if ((!users || users.length === 0) && userId === 1) {
      console.log('✓ Using hardcoded super admin data');
      user = {
        id: 1,
        username: 'ewms-prod',
        email: 'admin@expediseph.com',
        full_name: 'Super Admin',
        role: 'Admin',
      };
    } else if (!users || users.length === 0) {
      console.log('❌ User not found with id:', userId);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 401 }
      );
    } else {
      user = users[0];
    }
    
    console.log('✓ User verified:', user.username);

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      token: 'authenticated', // Not returning actual token (it's in cookie)
    });
  } catch (error: any) {
    console.error('Verification error:', error);
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
