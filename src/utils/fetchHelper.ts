/**
 * Fetch helper with timeout support
 * Prevents hanging requests and ensures predictable behavior
 */

interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number; // milliseconds
}

/**
 * Fetch with built-in timeout support
 * @param url URL to fetch
 * @param options Fetch options with optional timeout (default: 30 seconds)
 * @returns Promise<Response>
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const timeout = options.timeout || 30000; // 30 second default
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Fetch timeout after ${timeout}ms for ${url}`);
    }
    throw error;
  }
}

/**
 * Fetch multiple URLs in parallel with timeout
 * @param urls Array of URLs to fetch
 * @param options Fetch options with optional timeout
 * @returns Promise<Response[]> in the same order as input
 */
export async function fetchMultipleWithTimeout(
  urls: string[],
  options: FetchWithTimeoutOptions = {}
): Promise<Response[]> {
  return Promise.allSettled(
    urls.map(url => fetchWithTimeout(url, options))
  ).then(results =>
    results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      throw new Error(`Failed to fetch ${urls[index]}: ${result.reason}`);
    })
  );
}
