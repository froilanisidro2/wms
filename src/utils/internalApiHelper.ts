/**
 * Internal API Helper - For server-to-server API calls
 * 
 * Security Context:
 * - Internal network calls (Next.js server → PostgREST): Use HTTP (safe on internal network)
 * - Browser requests (Client → Next.js): Use HTTPS (enforced by CSP headers)
 * 
 * This separation is the correct security model:
 * 1. Internal services communicate via HTTP within the internal network
 * 2. External clients only receive HTTPS responses via CSP enforcement
 * 3. No sensitive data leaked via HTTP (internal network is trusted)
 */

/**
 * Get internal API URL for server-to-server calls
 * Uses HTTP for internal network (faster, no SSL overhead)
 * Falls back to environment variable or default internal IP
 */
export function getInternalApiUrl(endpoint: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_URL_ENDPOINT || 'http://172.31.39.68:8030';
  
  // Ensure it's HTTP for internal calls (internal network is trusted)
  const protocol = 'http://';
  
  // Remove any protocol prefix if present
  const cleanedUrl = baseUrl.replace(/^(https?:\/\/)/, '');
  
  return `${protocol}${cleanedUrl}/${endpoint}`;
}

/**
 * Get internal users API URL
 */
export function getInternalUsersUrl(): string {
  const endpoint = process.env.NEXT_PUBLIC_URL_USERS || 'http://172.31.39.68:8030/users';
  const cleanedUrl = endpoint.replace(/^(https?:\/\/)/, '');
  return `http://${cleanedUrl}`;
}

/**
 * Get internal endpoint URL
 */
export function getInternalEndpointUrl(endpoint: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_URL_ENDPOINT || 'http://172.31.39.68:8030';
  const cleanedUrl = baseUrl.replace(/^(https?:\/\/)/, '');
  return `http://${cleanedUrl}/${endpoint}`;
}

/**
 * Build internal API URL from environment variable or default
 * Supports environment variables like:
 * - NEXT_PUBLIC_URL_USERS=http://api.internal:8030/users
 * - NEXT_PUBLIC_URL_STOCK_MOVEMENT=http://api.internal:8030/stock_movement
 */
export function buildInternalUrl(envVar: string | undefined, defaultEndpoint: string): string {
  if (!envVar) {
    return getInternalEndpointUrl(defaultEndpoint);
  }
  
  // Remove any HTTPS prefix and ensure HTTP for internal calls
  const cleanedUrl = envVar.replace(/^https?:\/\//, '');
  return `http://${cleanedUrl}`;
}

/**
 * Example usage in API routes:
 * 
 * import { buildInternalUrl } from '@/utils/internalApiHelper';
 * 
 * const usersUrl = buildInternalUrl(
 *   process.env.NEXT_PUBLIC_URL_USERS,
 *   'users'
 * );
 * 
 * const response = await fetch(usersUrl, {
 *   headers: {
 *     'X-API-Key': API_KEY,
 *     'Content-Type': 'application/json',
 *   },
 * });
 */
