/**
 * Server-side cache helper using node-cache
 * Stores data in memory on the Next.js server
 * Data is NOT visible in browser - only server holds it
 */

import NodeCache from 'node-cache';

// Create a single cache instance (shared across all requests)
const cache = new NodeCache({ stdTTL: 5 * 60 }); // 5 minute default TTL for real-time updates

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Build cache key with optional filters
 */
function buildCacheKey(page: string, year: number, filters?: Record<string, any>): string {
  let cacheKey = `${page}_${year}`;
  if (filters && Object.keys(filters).length > 0) {
    const sortedFilters = Object.entries(filters)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}_${v}`)
      .join('_');
    cacheKey = `${cacheKey}_${sortedFilters}`;
  }
  return cacheKey;
}

/**
 * Get cached data from server
 */
export function getServerCachedData<T>(
  page: string,
  year: number,
  filters?: Record<string, any>
): T | null {
  try {
    const cacheKey = buildCacheKey(page, year, filters);
    const cached = cache.get<CacheEntry<T>>(cacheKey);

    if (cached) {
      console.log(`✓ Server Cache HIT: ${cacheKey}`);
      return cached.data;
    }

    console.log(`✗ Server Cache MISS: ${cacheKey}`);
    return null;
  } catch (err) {
    console.error('Server cache retrieval error:', err);
    return null;
  }
}

/**
 * Store data in server cache
 */
export function setServerCachedData<T>(
  page: string,
  year: number,
  data: T,
  ttlSeconds: number = 5 * 60, // 5 minutes default (was 24 hours)
  filters?: Record<string, any>
): void {
  try {
    const cacheKey = buildCacheKey(page, year, filters);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
    };

    cache.set(cacheKey, entry, ttlSeconds);
    console.log(`✓ Server Cache STORED: ${cacheKey} (TTL: ${ttlSeconds}s)`);
  } catch (err) {
    console.error('Server cache storage error:', err);
  }
}

/**
 * Clear cache for a specific page/year
 */
export function clearServerCache(page: string, year?: number, filters?: Record<string, any>): void {
  try {
    if (year !== undefined) {
      const cacheKey = buildCacheKey(page, year, filters);
      cache.del(cacheKey);
      console.log(`✓ Server Cache CLEARED: ${cacheKey}`);
    } else {
      // Clear all caches for this page
      const keys = cache.keys();
      const pageCacheKeys = keys.filter(k => k.startsWith(`${page}_`));
      cache.del(pageCacheKeys);
      console.log(`✓ Server Cache CLEARED: ${page}/* (${pageCacheKeys.length} entries)`);
    }
  } catch (err) {
    console.error('Server cache clear error:', err);
  }
}

/**
 * Get cache stats for debugging
 */
export function getCacheStats() {
  return cache.getStats();
}

/**
 * Flush entire cache
 */
export function flushServerCache(): void {
  cache.flushAll();
  console.log('✓ Server Cache FLUSHED (all data cleared)');
}
