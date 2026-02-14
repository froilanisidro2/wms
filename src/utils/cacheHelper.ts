/**
 * Cache helper for storing and retrieving data with expiration
 * Optimized for day-to-day transactions to minimize API calls
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiryMs: number;
}

interface CacheStore {
  [key: string]: string; // localStorage stores as string
}

const CACHE_PREFIX = 'wms_cache_';
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if cached data is still valid
 */
export function isCacheValid(timestamp: number, expiryMs: number): boolean {
  const now = Date.now();
  return now - timestamp < expiryMs;
}

/**
 * Get cached data for a specific year/page
 * Returns null if cache doesn't exist or has expired
 */
export function getCachedData<T>(
  page: string,
  year: number,
  expiryMs: number = DEFAULT_EXPIRY_MS
): T | null {
  if (typeof window === 'undefined') return null; // SSR safety

  try {
    const cacheKey = `${CACHE_PREFIX}${page}_${year}`;
    const cached = localStorage.getItem(cacheKey);

    if (!cached) return null;

    const entry: CacheEntry<T> = JSON.parse(cached);

    if (!isCacheValid(entry.timestamp, expiryMs)) {
      // Cache expired, remove it
      localStorage.removeItem(cacheKey);
      return null;
    }

    console.log(`✓ Cache HIT: ${page}/${year}`);
    return entry.data;
  } catch (err) {
    console.error('Cache retrieval error:', err);
    return null;
  }
}

/**
 * Store data in cache
 */
export function setCachedData<T>(
  page: string,
  year: number,
  data: T,
  expiryMs: number = DEFAULT_EXPIRY_MS
): void {
  if (typeof window === 'undefined') return; // SSR safety

  try {
    const cacheKey = `${CACHE_PREFIX}${page}_${year}`;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      expiryMs,
    };

    localStorage.setItem(cacheKey, JSON.stringify(entry));
    console.log(`✓ Cache STORED: ${page}/${year}`);
  } catch (err) {
    console.error('Cache storage error:', err);
    // Fail silently - app still works without cache
  }
}

/**
 * Clear cache for a specific page/year combination
 */
export function clearCache(page: string, year?: number): void {
  if (typeof window === 'undefined') return;

  try {
    if (year) {
      const cacheKey = `${CACHE_PREFIX}${page}_${year}`;
      localStorage.removeItem(cacheKey);
      console.log(`✓ Cache CLEARED: ${page}/${year}`);
    } else {
      // Clear all caches for this page
      const keys = Object.keys(localStorage).filter(
        k => k.startsWith(`${CACHE_PREFIX}${page}_`)
      );
      keys.forEach(k => localStorage.removeItem(k));
      console.log(`✓ Cache CLEARED: ${page}/* (${keys.length} items)`);
    }
  } catch (err) {
    console.error('Cache clear error:', err);
  }
}

/**
 * Clear all WMS caches
 */
export function clearAllCaches(): void {
  if (typeof window === 'undefined') return;

  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
    console.log(`✓ All caches CLEARED (${keys.length} items)`);
  } catch (err) {
    console.error('Clear all caches error:', err);
  }
}

/**
 * Get cache size and info for debugging
 */
export function getCacheStats(): {
  totalSize: number;
  itemCount: number;
  items: Array<{ key: string; size: number; year: number }>;
} {
  if (typeof window === 'undefined') {
    return { totalSize: 0, itemCount: 0, items: [] };
  }

  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    const items = keys.map(key => {
      const value = localStorage.getItem(key) || '';
      const year = parseInt(key.split('_').pop() || '0');
      return {
        key,
        size: value.length,
        year,
      };
    });

    const totalSize = items.reduce((sum, item) => sum + item.size, 0);

    return {
      totalSize,
      itemCount: items.length,
      items,
    };
  } catch (err) {
    console.error('Cache stats error:', err);
    return { totalSize: 0, itemCount: 0, items: [] };
  }
}
/**
 * Clear dashboard cache on the server (real-time updates)
 * Call this after any inventory/shipment operations
 */
export async function clearDashboardCache(): Promise<void> {
  try {
    const response = await fetch('/api/cache-control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear', table: 'dashboard' }),
    });

    if (response.ok) {
      console.log('✓ Dashboard cache cleared for real-time updates');
    }
  } catch (err) {
    console.warn('Error clearing dashboard cache:', err);
  }
}