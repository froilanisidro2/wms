/**
 * Request Deduplication Helper
 * Prevents duplicate in-flight requests to the same URL
 * Shares response across multiple callers
 */

interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();
const PENDING_TIMEOUT = 60000; // 60 second timeout for pending requests

/**
 * Get or create a pending request (deduplication)
 * If this URL is already being fetched, return that promise instead of making new request
 */
export function getPendingRequest<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  // Clean up old pending requests
  pendingRequests.forEach((req, url) => {
    if (Date.now() - req.timestamp > PENDING_TIMEOUT) {
      pendingRequests.delete(url);
    }
  });

  // Return existing pending request if available
  const existing = pendingRequests.get(key);
  if (existing) {
    console.log(`⚡ REQUEST DEDUP: Using in-flight request for ${key}`);
    return existing.promise;
  }

  // Create new request and track it
  const promise = fetchFn().catch((error) => {
    // Clean up failed request so it can be retried
    pendingRequests.delete(key);
    throw error;
  });

  pendingRequests.set(key, {
    promise,
    timestamp: Date.now(),
  });

  // Clean up after request completes
  promise.finally(() => {
    pendingRequests.delete(key);
  });

  return promise;
}

/**
 * Clear pending requests (for testing or emergency)
 */
export function clearPendingRequests(): void {
  pendingRequests.clear();
  console.log('🔄 Pending requests cleared');
}
