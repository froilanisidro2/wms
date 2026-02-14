import { NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '@/lib/auth';

/**
 * POST /api/auth/password/hash
 * Hash a plaintext password (server-side only)
 * 
 * Body:
 * {
 *   password: string
 * }
 * 
 * Returns:
 * {
 *   hash: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body;

    console.log('Password hash request received:', { passwordLength: password?.length });

    if (!password) {
      console.log('Password is required error');
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    if (typeof password !== 'string') {
      console.log('Password is not a string:', typeof password);
      return NextResponse.json(
        { error: 'Password must be a string' },
        { status: 400 }
      );
    }

    if (password.trim().length === 0) {
      console.log('Password is empty after trim');
      return NextResponse.json(
        { error: 'Password cannot be empty' },
        { status: 400 }
      );
    }

    // Hash the password without length restrictions (admin can set any password)
    const hash = await hashPassword(password);
    console.log('Password hashed successfully');

    return NextResponse.json({
      hash,
    });
  } catch (error: any) {
    console.error('Password hashing error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to hash password' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
