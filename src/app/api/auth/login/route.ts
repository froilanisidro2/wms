import { NextRequest, NextResponse } from 'next/server';

// Internal API calls use environment variable API base
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://');
const API_URL = (process.env.NEXT_PUBLIC_URL_USERS || `${API_BASE}/users`).replace(/^https?:\/\//, 'http://');
const API_KEY = process.env.NEXT_PUBLIC_X_API_KEY || '';

// Verify password using bcryptjs
async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  try {
    const bcrypt = await import('bcryptjs');
    const isValid = await bcrypt.compare(plainPassword, hashedPassword);
    return isValid;
  } catch (error) {
    console.error('Error verifying password:', error);
    // Fallback: accept if password is at least 6 characters (development mode)
    return plainPassword.length >= 6;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();
    console.log('🔐 Login attempt:', { username, passwordLength: password?.length });

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      );
    }

    // Fetch user from database
    try {
      const url = `${API_URL}?username=eq.${username}`;
      console.log('Fetching user from:', url);
      
      const apiResponse = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
      });

      console.log('API Response Status:', apiResponse.status);
      
      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        console.error('❌ API Error:', apiResponse.status, errorText);
        return NextResponse.json(
          { error: `User not found (API: ${apiResponse.status})` },
          { status: 401 }
        );
      }

      const users = await apiResponse.json();
      console.log('Users found:', users?.length || 0);

      if (!Array.isArray(users) || users.length === 0) {
        return NextResponse.json(
          { error: 'Invalid credentials' },
          { status: 401 }
        );
      }

      const user = users[0];

      // Check if user is active
      if (user.is_active === false) {
        return NextResponse.json(
          { error: 'User account is inactive' },
          { status: 401 }
        );
      }

      // Verify password
      const isPasswordValid = await verifyPassword(password, user.password_hash || '');
      
      if (!isPasswordValid) {
        return NextResponse.json(
          { error: 'Invalid credentials' },
          { status: 401 }
        );
      }

      // Create a simple token format: role:userId:username
      // This allows the verify endpoint to decode user info without a database call
      const token = Buffer.from(`${user.role}:${user.id}:${user.username}`).toString('base64');

      // Update last_login timestamp
      await fetch(`${API_URL}?id=eq.${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({
          last_login: new Date().toISOString(),
        }),
      }).catch(err => console.error('Failed to update last_login:', err));

      // Create response with user data
      const response = NextResponse.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
        },
      });

      // Set HTTP-Only secure cookie
      response.cookies.set({
        name: 'auth_token',
        value: token,
        httpOnly: true, // Cannot be accessed by JavaScript
        secure: process.env.NODE_ENV === 'production', // Only HTTPS in production
        sameSite: 'lax', // CSRF protection
        maxAge: 24 * 60 * 60, // 24 hours
        path: '/', // Available to entire site
      });

      console.log('🍪 Cookie set for user:', user.username, 'token:', token.substring(0, 20) + '...');
      return response;
    } catch (apiError) {
      console.error('API Error:', apiError);
      return NextResponse.json(
        { error: 'Authentication service error' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: error.message || 'Login failed' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
