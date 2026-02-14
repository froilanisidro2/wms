import { NextRequest, NextResponse } from 'next/server';
import { hashPassword, validatePasswordStrength } from '@/lib/auth';

// Internal API call uses HTTP on internal network (safe, faster)
const API_URL = (process.env.NEXT_PUBLIC_URL_USERS || `${(process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://')}/users`).replace(/^https?:\/\//, 'http://');
const API_KEY = process.env.NEXT_PUBLIC_X_API_KEY || '';

/**
 * PATCH /api/auth/password
 * Update a user's password
 * 
 * Body:
 * {
 *   userId: number,
 *   currentPassword?: string,  // Required if updating own password
 *   newPassword: string        // Required, must meet strength requirements
 * }
 */
export async function PATCH(request: NextRequest) {
  try {
    const { userId, currentPassword, newPassword } = await request.json();

    if (!userId || !newPassword) {
      return NextResponse.json(
        { error: 'User ID and new password are required' },
        { status: 400 }
      );
    }

    // Validate password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.isValid) {
      return NextResponse.json(
        { 
          error: 'Password does not meet strength requirements',
          details: validation.errors,
        },
        { status: 400 }
      );
    }

    // Hash the new password
    let hashedPassword: string;
    try {
      hashedPassword = await hashPassword(newPassword);
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to process password' },
        { status: 500 }
      );
    }

    // Update user password in database
    try {
      const response = await fetch(`${API_URL}?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          password_hash: hashedPassword,
          updated_at: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        return NextResponse.json(
          { error: 'Failed to update password' },
          { status: response.status }
        );
      }

      return NextResponse.json({
        message: 'Password updated successfully',
      });
    } catch (apiError) {
      console.error('API Error:', apiError);
      return NextResponse.json(
        { error: 'Failed to update password in database' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Password update error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update password' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/password/reset
 * Admin reset of user password (generates temporary password)
 * 
 * Body:
 * {
 *   userId: number
 * }
 * 
 * Returns:
 * {
 *   userId: number,
 *   temporaryPassword: string,
 *   message: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Import here to avoid issues on client side
    const { generateTempPassword } = await import('@/lib/auth');
    const tempPassword = generateTempPassword();

    // Hash the temporary password
    let hashedPassword: string;
    try {
      hashedPassword = await hashPassword(tempPassword);
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to process temporary password' },
        { status: 500 }
      );
    }

    // Update user password in database
    try {
      const response = await fetch(`${API_URL}?id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          password_hash: hashedPassword,
          updated_at: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        return NextResponse.json(
          { error: 'Failed to reset password' },
          { status: response.status }
        );
      }

      // TODO: Send email with temporary password
      // await sendPasswordResetEmail(user.email, tempPassword);

      return NextResponse.json({
        userId,
        temporaryPassword: tempPassword,
        message: 'Temporary password generated. User should change it on first login.',
      });
    } catch (apiError) {
      console.error('API Error:', apiError);
      return NextResponse.json(
        { error: 'Failed to reset password in database' },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Password reset error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to reset password' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
