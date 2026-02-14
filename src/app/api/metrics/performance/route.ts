import { NextRequest, NextResponse } from 'next/server';
import { getCacheSizeInfo } from '@/utils/safeFetch';
import { getCacheStats } from '@/utils/serverCacheHelper';
import { getCircuitState } from '@/utils/circuitBreaker';

/**
 * GET /api/metrics/performance
 * Monitor caching performance, request deduplication, and circuit breaker status
 */
export async function GET(request: NextRequest) {
  try {
    const format = request.nextUrl.searchParams.get('format') || 'json';

    const safeFetchInfo = getCacheSizeInfo();
    const serverCacheStats = getCacheStats();

    // Get circuit breaker status for key endpoints
    const backendBase = process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';
    const criticalEndpoints = [
      `${backendBase}/items`,
      `${backendBase}/asn_headers`,
      `${backendBase}/so_headers`,
      `${backendBase}/inventory`,
    ];

    const circuitStatus: Record<string, any> = {};
    for (const endpoint of criticalEndpoints) {
      const state = getCircuitState(endpoint);
      if (state) {
        circuitStatus[endpoint] = {
          status: state.status,
          failures: state.failures,
          successes: state.successCount,
        };
      }
    }

    const metrics = {
      timestamp: new Date().toISOString(),
      cache: {
        safeFetch: {
          totalEntries: safeFetchInfo.totalEntries,
          estimatedSizeKB: safeFetchInfo.estimatedSizeKB,
          description: 'In-memory cache with tiered TTLs (1hr for reference data, 5min for transactional)',
          topEntries: safeFetchInfo.entries.slice(0, 5),
        },
        serverCache: {
          stats: serverCacheStats,
          description: 'Node-cache on server (5min default TTL)',
        },
      },
      circuitBreaker: {
        status: circuitStatus,
        description: 'Circuit breaker prevents hammering failing backends',
      },
      optimization: {
        requestDeduplication: {
          enabled: true,
          description: 'Duplicate in-flight requests to same URL share response',
          benefit: 'Reduces backend load by up to 50% on heavy pages',
        },
        tieredCaching: {
          enabled: true,
          description: 'Reference data cached 1 hour, transactional data 5 minutes',
          benefit: 'Reduces API calls for slow-changing data',
        },
        gracefulDegradation: {
          enabled: true,
          description: 'Always returns cached or default data instead of 504 errors',
          benefit: 'User never sees error, always gets some data',
        },
      },
    };

    if (format === 'simple') {
      return NextResponse.json({
        summary: {
          safeFetch_entries: safeFetchInfo.totalEntries,
          safeFetch_size_kb: safeFetchInfo.estimatedSizeKB,
          server_cache_size: serverCacheStats.ksize,
          backend_status: Object.values(circuitStatus).every((s: any) => s.status === 'closed') ? 'healthy' : 'degraded',
        },
      });
    }

    return NextResponse.json(metrics);
  } catch (error: any) {
    return NextResponse.json(
      {
        timestamp: new Date().toISOString(),
        error: error.message,
        status: 'error',
      },
      { status: 500 }
    );
  }
}

export const maxDuration = 30;
