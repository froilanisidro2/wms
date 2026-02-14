/**
 * Password hashing utility
 * Uses bcryptjs for secure password hashing and verification
 * 
 * Usage:
 * - Hashing: const hash = await hashPassword(plainPassword);
 * - Verifying: const isValid = await verifyPassword(plainPassword, hash);
 */

// For Node.js/Next.js server-side operations
export async function hashPassword(password: string): Promise<string> {
  try {
    // Dynamically import bcryptjs only on server
    const bcrypt = await import('bcryptjs');
    const saltRounds = 10;
    const hash = await bcrypt.hash(password, saltRounds);
    return hash;
  } catch (error) {
    console.error('Error hashing password:', error);
    throw new Error('Password hashing failed');
  }
}

export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  try {
    // Dynamically import bcryptjs only on server
    const bcrypt = await import('bcryptjs');
    const isValid = await bcrypt.compare(plainPassword, hashedPassword);
    return isValid;
  } catch (error) {
    console.error('Error verifying password:', error);
    return false;
  }
}

/**
 * Generate a temporary random password
 * Returns a 12-character random password
 */
export function generateTempPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain an uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain a lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain a number');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain a special character');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
