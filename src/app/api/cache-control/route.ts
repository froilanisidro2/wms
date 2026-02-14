import { NextRequest, NextResponse } from 'next/server';
import {
  clearServerCache,
  flushServerCache,
  getCacheStats,
} from '@/utils/serverCacheHelper';

interface CacheControlRequest {
  action: 'clear-all' | 'clear-year' | 'clear-config' | 'clear-table' | 'stats';
  table?: string; // 'dashboard', 'inbound', 'outbound', 'inventory', 'stock_movement', 'config'
  year?: number;
}

export async function POST(request: NextRequest) {
  try {
    // Simple auth check (can be enhanced)
    const authHeader = request.headers.get('X-Cache-Control-Key');
    const validKey = process.env.CACHE_CONTROL_KEY || 'dev-key-123';
    
    if (authHeader !== validKey) {
      return NextResponse.json(
        { error: 'Unauthorized - missing or invalid X-Cache-Control-Key header' },
        { status: 401 }
      );
    }

    const body: CacheControlRequest = await request.json();
    const { action, table, year } = body;

    switch (action) {
      case 'clear-all':
        // Clear ALL caches for all tables and all years
        flushServerCache();
        return NextResponse.json({
          success: true,
          message: '✓ All caches cleared successfully',
          timestamp: new Date().toISOString(),
        });

      case 'clear-config':
        // Clear only config cache (7-day data)
        clearServerCache('config', 0);
        return NextResponse.json({
          success: true,
          message: '✓ Config cache cleared',
          timestamp: new Date().toISOString(),
        });

      case 'clear-year':
        // Clear all transaction tables for a specific year
        if (!year) throw new Error('Year is required');
        
        const tables = ['dashboard', 'inbound', 'outbound', 'inventory', 'stock_movement'];
        tables.forEach(t => clearServerCache(t, year));
        
        return NextResponse.json({
          success: true,
          message: `✓ All tables cleared for year ${year}`,
          tables,
          timestamp: new Date().toISOString(),
        });

      case 'clear-table':
        // Clear specific table for a specific year
        if (!table || !year) throw new Error('Table and year are required');
        
        clearServerCache(table, year);
        return NextResponse.json({
          success: true,
          message: `✓ Cache cleared: ${table}/${year}`,
          timestamp: new Date().toISOString(),
        });

      case 'stats':
        // Get cache statistics
        const stats = getCacheStats();
        return NextResponse.json({
          success: true,
          stats,
          timestamp: new Date().toISOString(),
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: clear-all, clear-config, clear-year, clear-table, or stats' },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('Cache control error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process cache control request' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Simple auth check
    const authHeader = request.headers.get('X-Cache-Control-Key');
    const validKey = process.env.CACHE_CONTROL_KEY || 'dev-key-123';
    
    if (authHeader !== validKey) {
      return NextResponse.json(
        { error: 'Unauthorized - missing or invalid X-Cache-Control-Key header' },
        { status: 401 }
      );
    }

    // GET returns available actions and current stats
    const stats = getCacheStats();
    return NextResponse.json({
      success: true,
      message: 'Cache Control API',
      availableActions: [
        { action: 'clear-all', description: 'Clear all caches', body: { action: 'clear-all' } },
        { action: 'clear-config', description: 'Clear config cache only', body: { action: 'clear-config' } },
        { action: 'clear-year', description: 'Clear all tables for a year', body: { action: 'clear-year', year: 2025 } },
        { action: 'clear-table', description: 'Clear specific table/year', body: { action: 'clear-table', table: 'inbound', year: 2025 } },
        { action: 'stats', description: 'Get cache statistics', body: { action: 'stats' } },
      ],
      currentStats: stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get cache info' },
      { status: 500 }
    );
  }
}

export const maxDuration = 60;
