/**
 * Safe Fetch Handler with Tiered Caching
 * Prevents 504 errors by using timeouts, circuit breaker, caching, and graceful degradation
 * Automatically adjusts cache TTL based on data type (reference vs transactional)
 */

import { fetchWithTimeout } from './fetchHelper';
import { isCircuitOpen, recordFailure, recordSuccess } from './circuitBreaker';
import { getPendingRequest } from './requestDedup';

interface SafeFetchOptions {
  timeout?: number;
  fallbackData?: any;
  cacheKey?: string;
  cacheTTL?: number;  // Override default TTL
  dataType?: 'reference' | 'transactional'; // Auto-configures cache TTL
  allowEmpty?: boolean;
}

// Simple in-memory cache for safe fetch
const safeFetchCache = new Map<string, { data: any; expiresAt: number }>();

// Default cache TTLs by data type
const DEFAULT_CACHE_TTLS = {
  reference: 60 * 60 * 1000,      // 1 hour for items, warehouses, locations, vendors, etc.
  transactional: 5 * 60 * 1000,   // 5 minutes for inventory, ASNs, SOs (changes frequently)
};

/**
 * Safe fetch that never throws and always returns data (cached or default)
 * Ideal for critical endpoints that must not fail
 * Features:
 * - 15 second timeout (fail-fast)
 * - Request deduplication (prevent duplicate in-flight requests)
 * - Tiered caching (1 hour for reference data, 5 min for transactional)
 * - Circuit breaker (stop hammering failing backends)
 * - Fallback data (return something instead of error)
 * 
 * @param url URL to fetch
 * @param options Fetch options, fallback data, caching, timeout
 * @returns Promise<any> - Always resolves, never rejects
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions & Record<string, any> = {}
): Promise<any> {
  const {
    timeout = 15000, // 15 seconds - fail fast to prevent 504s
    fallbackData = null,
    cacheKey,
    dataType = 'transactional',
    cacheTTL = DEFAULT_CACHE_TTLS[dataType] || DEFAULT_CACHE_TTLS.transactional,
    allowEmpty = true,
    ...fetchOptions
  } = options;

  const key = cacheKey || url;

  // Check circuit breaker
  if (isCircuitOpen(url)) {
    console.warn(`⚠️ Circuit breaker OPEN for ${url}, returning cached/fallback data`);
    return getCachedData(key) || fallbackData;
  }

  // Check cache first
  const cached = getCachedData(key);
  if (cached !== null && cached !== undefined) {
    console.log(`✅ Cache HIT (${dataType}): ${key}`);
    return cached;
  }

  // Deduplicate identical in-flight requests
  const fetchFn = async () => {
    try {
      console.log(`🔄 Fetching (${dataType}): ${url} (timeout: ${timeout}ms)`);
      const response = await fetchWithTimeout(url, {
        ...fetchOptions,
        timeout,
      });

      // Record success for circuit breaker
      recordSuccess(url);

      // Check if response is ok
      if (!response.ok) {
        console.error(`❌ API returned ${response.status} for ${url}`);
        recordFailure(url);
        return getCachedData(key) || fallbackData;
      }

      // Try to parse JSON
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      // Handle empty/null responses
      if (!data && !allowEmpty) {
        console.warn(`⚠️ Empty response from ${url}`);
        return getCachedData(key) || fallbackData;
      }

      // Cache the successful response with appropriate TTL
      if (cacheTTL > 0) {
        setCachedData(key, data, cacheTTL);
        console.log(`✅ Cached (${dataType}, ${cacheTTL}ms): ${key}`);
      }

      return data;
    } catch (error: any) {
      console.error(`❌ Fetch failed for ${url}:`, error.message);
      recordFailure(url);

      // Return cached data or fallback
      const cached = getCachedData(key);
      if (cached !== null && cached !== undefined) {
        console.log(`⚠️ Returning cached data as fallback`);
        return cached;
      }

      return fallbackData;
    }
  };

  // Deduplicate in-flight requests
  return getPendingRequest(key, fetchFn);
}

/**
 * Parallel safe fetch - fetch multiple URLs with fallbacks
 * Automatically deduplicates overlapping requests
 * Returns array of results in order; never throws
 */
export async function safeParallelFetch(
  urls: Array<{
    url: string;
    fallback?: any;
    timeout?: number;
    cacheKey?: string;
    dataType?: 'reference' | 'transactional';
  }>
): Promise<any[]> {
  return Promise.all(
    urls.map((config) =>
      safeFetch(config.url, {
        fallbackData: config.fallback,
        timeout: config.timeout || 15000,
        cacheKey: config.cacheKey,
        dataType: config.dataType || 'transactional',
      })
    )
  );
}

/**
 * Prefetch reference data (items, locations, vendors, etc) with longer cache
 * Call this during page load or app initialization
 */
export async function prefetchReferenceData(urls: string[]): Promise<void> {
  console.log(`📥 Prefetching ${urls.length} reference datasets...`);
  await Promise.allSettled(
    urls.map((url) =>
      safeFetch(url, {
        dataType: 'reference',
        timeout: 20000, // More time for reference data
        fallbackData: [],
      })
    )
  );
}

/**
 * Get all cached data
 */
function getCachedData(key: string): any | null {
  const cached = safeFetchCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    safeFetchCache.delete(key);
    return null;
  }
  return cached.data;
}

/**
 * Set cached data
 */
function setCachedData(key: string, data: any, ttlMs: number): void {
  safeFetchCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Clear specific cache entry
 */
export function clearSafeCache(key?: string): void {
  if (key) {
    safeFetchCache.delete(key);
  } else {
    safeFetchCache.clear();
  }
}

/**
 * Get cache stats for debugging
 */
export function getCacheSizeInfo(): {
  totalEntries: number;
  estimatedSizeKB: number;
  entries: Array<{ key: string; expiresAt: string }>;
} {
  const entries: Array<{ key: string; expiresAt: string }> = [];
  let totalSize = 0;

  safeFetchCache.forEach((value, key) => {
    const size = JSON.stringify(value.data).length;
    totalSize += size;
    entries.push({
      key,
      expiresAt: new Date(value.expiresAt).toISOString(),
    });
  });

  return {
    totalEntries: safeFetchCache.size,
    estimatedSizeKB: Math.round(totalSize / 1024),
    entries: entries.sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime()),
  };
}
