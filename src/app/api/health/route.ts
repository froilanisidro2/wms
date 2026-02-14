import { NextRequest, NextResponse } from 'next/server';
import { getCircuitState, resetAllCircuits } from '@/utils/circuitBreaker';

/**
 * GET /api/health
 * Monitor circuit breaker and fetch health status
 */
export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get('action');

    if (action === 'reset-circuits') {
      resetAllCircuits();
      return NextResponse.json({
        success: true,
        message: 'All circuit breakers reset',
      });
    }

    // Check key backend endpoints
    const backendBaseUrl = process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030';
    const endpoints = [
      `${backendBaseUrl}/items?limit=1`,
      `${backendBaseUrl}/warehouses?limit=1`,
      `${backendBaseUrl}/asn_headers?limit=1`,
      `${backendBaseUrl}/so_headers?limit=1`,
      `${backendBaseUrl}/inventory?limit=1`,
    ];

    const health: Record<string, any> = {
      timestamp: new Date().toISOString(),
      backend: backendBaseUrl,
      endpoints: {},
      circuitBreakers: {},
    };

    // Check backend connectivity
    for (const url of endpoints) {
      const key = new URL(url).pathname.slice(1);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        health.endpoints[key] = {
          status: response.ok ? 'ok' : `error-${response.status}`,
          time: new Date().toISOString(),
        };
      } catch (error: any) {
        health.endpoints[key] = {
          status: 'unreachable',
          error: error.message,
          time: new Date().toISOString(),
        };
      }
    }

    // Get circuit breaker states
    const circuitEndpoints = [
      `${backendBaseUrl}/items`,
      `${backendBaseUrl}/warehouses`,
      `${backendBaseUrl}/asn_headers`,
      `${backendBaseUrl}/so_headers`,
      `${backendBaseUrl}/inventory`,
    ];

    for (const url of circuitEndpoints) {
      const circuitState = getCircuitState(url);
      if (circuitState) {
        health.circuitBreakers[url] = {
          status: circuitState.status,
          failures: circuitState.failures,
          successCount: circuitState.successCount,
          lastFailureTime: new Date(circuitState.lastFailureTime).toISOString(),
        };
      }
    }

    return NextResponse.json(health);
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
