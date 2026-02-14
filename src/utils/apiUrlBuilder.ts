/**
 * API URL Builder Utility - Browser-Side
 * 
 * CRITICAL: Browser code should ONLY call Next.js API routes (on same server)
 * Never call PostgREST directly from browser (violates CSP, times out)
 * 
 * Architecture:
 * Browser → Next.js API Routes (HTTPS) → PostgREST (HTTP internal)
 */

/**
 * Get API endpoint URL for browser (via Next.js API routes)
 * @param endpoint - The API route path (e.g., 'config-records', 'users')
 * @returns Next.js API route URL
 */
export function getApiEndpoint(endpoint: string): string {
  // Browser should always use Next.js API routes, never direct PostgREST
  return `/api/${endpoint}`;
}

/**
 * Get API base URL for browser (via Next.js API routes)
 */
export function getApiUrl(envUrl: string | undefined, fallbackPath: string): string {
  // Always use Next.js API routes for browser
  // Format: /api/resource-name
  const resourceName = fallbackPath.replace(/^\//, '');
  return getApiEndpoint(resourceName);
}

/**
 * Get PostgREST API URL wrapper (for backward compatibility)
 * IMPORTANT: This should only be used server-side in API routes
 * Browser code should use getApiEndpoint() instead
 */
export function getPostgRESTUrl(tableName: string, envUrl?: string): string {
  // This is only for server-side code in API routes
  // Browser code should NOT call this - use getApiEndpoint() instead
  
  // If we're in browser, redirect to API route instead
  if (typeof window !== 'undefined') {
    console.warn(`[getPostgRESTUrl] Called from browser for '${tableName}'. Use getApiEndpoint() instead!`);
    return getApiEndpoint(tableName);
  }

  // Server-side: Use internal HTTP for PostgREST
  if (envUrl) {
    return envUrl.replace(/^https?:\/\//, 'http://');
  }

  // Fallback to internal HTTP
  return `http://172.31.39.68:8030/${tableName}`;
}

/**
 * Helper: Check if code is running in browser
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}
/**
 * For backward compatibility - gets API URL for specific endpoints
 */
export const getAPIEndpoints = () => {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://localhost:8030';
  
  return {
    asn_inventory: getPostgRESTUrl('asn_inventory', process.env.NEXT_PUBLIC_URL_ASN_INVENTORY),
    inventory: getPostgRESTUrl('inventory', process.env.NEXT_PUBLIC_URL_INVENTORY),
    so_inventory: getPostgRESTUrl('so_inventory', process.env.NEXT_PUBLIC_URL_SO_INVENTORY),
    asn_headers: getPostgRESTUrl('asn_headers', process.env.NEXT_PUBLIC_URL_ASN_HEADERS),
    asn_lines: getPostgRESTUrl('asn_lines', process.env.NEXT_PUBLIC_URL_ASN_LINES),
    so_headers: getPostgRESTUrl('so_headers', process.env.NEXT_PUBLIC_URL_SO_HEADERS),
    user_permissions: getPostgRESTUrl('user_permissions', process.env.NEXT_PUBLIC_URL_USER_PERMISSIONS),
    user_warehouses: getPostgRESTUrl('user_warehouses', process.env.NEXT_PUBLIC_URL_USER_WAREHOUSES),
    warehouses: getPostgRESTUrl('warehouses', process.env.NEXT_PUBLIC_URL_WAREHOUSES),
  };
};
