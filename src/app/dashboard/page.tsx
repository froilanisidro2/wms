'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface DashboardMetrics {
  totalItems: number;
  totalWarehouses: number;
  totalLocations: number;
  totalCustomers: number;
  totalVendors: number;
  totalStockValue: number;
  
  // Inbound Metrics
  pendingASNs: number;
  receivedASNs: number;
  putAwayASNs?: number;
  completeASNs?: number;
  totalASNLines: number;
  
  // Outbound Metrics
  pendingSOs: number;
  allocatedSOs: number;
  pickingSOs: number;
  pickedSOs?: number;
  shippedSOs: number;
  totalSOLines: number;
  
  // Inventory Metrics
  totalInventoryQuantity: number;
  lowStockItems: number;
  outOfStockItems: number;
  perishableItems: number;
  
  // Stock Movement
  recentMovements: number;
  todaysMovements: number;
}

interface ChartData {
  label: string;
  value: number;
  color: string;
}

// Simple SVG Pie Chart Component
const PieChart: React.FC<{ data: ChartData[], title: string }> = ({ data, title }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  
  let currentAngle = 0;
  const slices = data.map((item, idx) => {
    if (item.value === 0) return null;
    
    const percentage = item.value / total;
    const angle = percentage * 360;
    const startX = 200 + 120 * Math.cos((currentAngle - 90) * Math.PI / 180);
    const startY = 200 + 120 * Math.sin((currentAngle - 90) * Math.PI / 180);
    const endAngle = currentAngle + angle;
    const endX = 200 + 120 * Math.cos((endAngle - 90) * Math.PI / 180);
    const endY = 200 + 120 * Math.sin((endAngle - 90) * Math.PI / 180);
    const largeArc = angle > 180 ? 1 : 0;
    
    // Handle full circle case (only one item with all values)
    let path;
    if (angle >= 359.9) {
      // Draw as two semicircles for full circle
      path = `M 200 200 L ${startX} ${startY} A 120 120 0 1 1 ${startX - 0.1} ${startY} Z`;
    } else {
      path = `M 200 200 L ${startX} ${startY} A 120 120 0 ${largeArc} 1 ${endX} ${endY} Z`;
    }
    currentAngle = endAngle;
    
    return (
      <path key={idx} d={path} fill={item.color} stroke="white" strokeWidth="3" />
    );
  }).filter(Boolean);

  return (
    <div className="bg-white rounded-lg shadow-md p-6 h-full flex flex-col">
      <h3 className="text-lg font-bold text-gray-900 mb-4">{title}</h3>
      <div className="flex flex-col items-center flex-1 justify-center">
        {total > 0 && slices.length > 0 ? (
          <svg width="280" height="280" viewBox="0 0 400 400" className="mb-4">
            {slices}
          </svg>
        ) : (
          <div className="w-64 h-64 flex items-center justify-center text-gray-400 text-sm rounded border-2 border-dashed border-gray-300 mb-4">
            No data
          </div>
        )}
        <div className="space-y-2 text-center w-full">
          {data.map((item, idx) => (
            <div key={idx} className="flex items-center justify-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
              <span className="text-sm font-medium text-gray-700">{item.label}: {item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalItems: 0,
    totalWarehouses: 0,
    totalLocations: 0,
    totalCustomers: 0,
    totalVendors: 0,
    totalStockValue: 0,
    pendingASNs: 0,
    receivedASNs: 0,
    totalASNLines: 0,
    pendingSOs: 0,
    allocatedSOs: 0,
    pickingSOs: 0,
    shippedSOs: 0,
    totalSOLines: 0,
    totalInventoryQuantity: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
    perishableItems: 0,
    recentMovements: 0,
    todaysMovements: 0,
  });

  const [loading, setLoading] = useState(true);
  const [cacheSource, setCacheSource] = useState<'server' | 'fresh' | null>(null);

  useEffect(() => {
    // Check for clearCache parameter in URL
    const shouldClear = searchParams?.get('clearCache') === 'true';
    if (shouldClear) {
      // Call API to clear cache on server
      const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
      fetch(`/api/dashboard-metrics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, action: 'clear' }),
      }).then(() => {
        // Reload data after cache is cleared
        setLoading(true);
      });
    }
  }, [searchParams]);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        // Get year and warehouse from URL params
        const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
        const warehouse = searchParams?.get('warehouse');

        console.log('📊 Fetching dashboard metrics:', { year, warehouse });

        // Set timeout for API call (10 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.error('📊 API request timeout');
          controller.abort();
        }, 10000);

        // Build API URL with warehouse filter if provided
        const apiUrl = warehouse 
          ? `/api/dashboard-metrics?year=${year}&warehouse=${warehouse}`
          : `/api/dashboard-metrics?year=${year}`;

        console.log('📊 API URL:', apiUrl);

        // Call the server-side cached API endpoint
        const response = await fetch(apiUrl, {
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);

        console.log('📊 API response status:', response.status);

        if (!response.ok) {
          throw new Error(`Failed to fetch metrics: ${response.status}`);
        }

        const data = await response.json();
        console.log('📊 API response data:', data);
        setCacheSource(data.cacheSource);
        
        const newMetrics = {
          totalItems: data.totalItems || 0,
          totalWarehouses: data.totalWarehouses || 0,
          totalLocations: data.totalLocations || 0,
          totalCustomers: data.totalCustomers || 0,
          totalVendors: data.totalVendors || 0,
          totalStockValue: data.totalStockValue || 0,
          pendingASNs: data.pendingASNs || 0,
          receivedASNs: data.receivedASNs || 0,
          totalASNLines: data.totalASNLines || 0,
          pendingSOs: data.pendingSOs || 0,
          allocatedSOs: data.allocatedSOs || 0,
          pickingSOs: data.pickingSOs || 0,
          shippedSOs: data.shippedSOs || 0,
          totalSOLines: data.totalSOLines || 0,
          totalInventoryQuantity: data.totalInventoryQuantity || 0,
          lowStockItems: data.lowStockItems || 0,
          outOfStockItems: data.outOfStockItems || 0,
          perishableItems: data.perishableItems || 0,
          recentMovements: data.recentMovements || 0,
          todaysMovements: data.todaysMovements || 0,
        };

        console.log('📊 Setting metrics:', newMetrics);
        setMetrics(newMetrics);
      } catch (error) {
        console.error('❌ Error fetching metrics:', error);
        // Don't show error to user, just use empty metrics
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [searchParams]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Warehouse Management Dashboard</h1>
            <p className="text-gray-600">Real-time overview of your warehouse operations</p>
          </div>
          
          {/* Skeleton loaders */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-lg shadow-md p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-3"></div>
                <div className="h-8 bg-gray-300 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Warehouse Management Dashboard</h1>
          <p className="text-gray-600">Real-time overview of your warehouse operations</p>
        </div>

        {/* Charts Grid - All in One Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Inbound */}
          <PieChart 
            title="Inbound Operations"
            data={[
              { label: 'New', value: metrics.pendingASNs, color: '#3B82F6' },
              { label: 'Received', value: metrics.receivedASNs, color: '#F97316' },
              { label: 'PutAway', value: metrics.putAwayASNs, color: '#A855F7' },
              { label: 'Complete', value: metrics.completeASNs, color: '#10B981' },
            ]}
          />
          
          {/* Outbound */}
          <PieChart 
            title="Outbound Operations"
            data={[
              { label: 'New', value: metrics.pendingSOs, color: '#3B82F6' },
              { label: 'Allocated', value: metrics.allocatedSOs, color: '#F97316' },
              { label: 'Picked', value: metrics.pickedSOs || metrics.pickingSOs, color: '#A855F7' },
              { label: 'Shipped', value: metrics.shippedSOs, color: '#10B981' },
            ]}
          />
          
          {/* Inventory */}
          <PieChart 
            title="Inventory Status"
            data={[
              { label: 'In Stock', value: Math.max(0, metrics.totalInventoryQuantity - metrics.lowStockItems - metrics.outOfStockItems), color: '#10B981' },
              { label: 'Low Stock', value: metrics.lowStockItems, color: '#FCD34D' },
              { label: 'Out of Stock', value: metrics.outOfStockItems, color: '#EF4444' },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
