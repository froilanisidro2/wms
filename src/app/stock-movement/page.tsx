'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import DateRangeSelector from '@/app/components/DateRangeSelector';
import { downloadCSV, filterByDateRange } from '@/utils/exportHelper';

ModuleRegistry.registerModules([AllCommunityModule]);

interface StockMovement {
  id: number;
  so_inventory_id?: number;
  so_header_id?: number;
  asn_header_id?: number;
  asn_inventory_id?: number;
  item_id?: number;
  item_code?: string;
  item_name?: string;
  warehouse_id?: number;
  warehouse_code?: string;
  warehouse_name?: string;
  from_location_id?: number;
  from_location_code?: string;
  to_location_id?: number;
  to_location_code?: string;
  location_id?: number;
  location_code?: string;
  batch_number?: string;
  quantity_moved?: number;
  quantity_change?: number;
  movement_type?: string; // 'picking', 'loading', 'return', 'adjustment', 'transfer'
  transaction_type?: string; // IN, OUT, TRANSFER, ADJUSTMENT, etc.
  reference_id?: number;
  reference_type?: string;
  reference_number?: string;
  created_by?: number;
  moved_by?: string;
  created_by_name?: string;
  created_at: string;
  movement_date?: string;
  weight_uom_kg?: number;
  pallet_config?: string;
  pallet_id?: string;
  expiry_date?: string;
  manufacturing_date?: string;
  notes?: string;
  remarks?: string;
  reason?: string;
}

const transactionTypeColors: any = {
  'ALLOCATED': 'bg-blue-100 text-blue-800',
  'PICKED': 'bg-orange-100 text-orange-800',
  'SHIPPED': 'bg-green-100 text-green-800',
  'PUTAWAY': 'bg-indigo-100 text-indigo-800',
  'TRANSFERRED': 'bg-purple-100 text-purple-800',
  'ADJUSTED': 'bg-yellow-100 text-yellow-800',
  'RETURNED': 'bg-red-100 text-red-800',
  'IN': 'bg-indigo-100 text-indigo-800',
  'OUT': 'bg-red-100 text-red-800',
  'TRANSFER': 'bg-purple-100 text-purple-800',
  'ADJUSTMENT': 'bg-yellow-100 text-yellow-800',
};

export default function StockMovementPage() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [transactionTypeFilter, setTransactionTypeFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [selectedMovement, setSelectedMovement] = useState<StockMovement | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const gridRef = useRef<AgGridReact>(null);

  // Get year from URL params
  const searchParams = useSearchParams();
  const yearFilter = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
  const warehouseFilter = searchParams?.get('warehouse');
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://172.31.39.68:8030').replace(/^https?:\/\//, 'http://');
  const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';

  // Fetch stock movements from database (with caching)
  useEffect(() => {
    const fetchMovements = async () => {
      try {
        setLoading(true);
        
        console.log('📊 Fetching stock movements via comprehensive API route');
        
        // Route through /api/stock-movement to get ALL data with proper mappings
        let stockMovementUrl = `/api/stock-movement?limit=1000&type=all`;
        if (warehouseFilter) {
          stockMovementUrl += `&warehouseId=${warehouseFilter}`;
          console.log(`📊 Filtering by warehouse: ${warehouseFilter}`);
        }
        
        const response = await fetch(stockMovementUrl, {
          method: 'GET',
        });
        
        console.log('📊 Stock movement API response status:', response.status);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch stock movements: ${response.status}`);
        }

        const apiData = await response.json();
        
        if (!apiData.success || !apiData.data) {
          throw new Error('Invalid response format from stock movement API');
        }

        const { outboundMovements, inboundMovements } = apiData.data;
        
        console.log(`✅ API returned - outbound: ${outboundMovements?.length || 0}, inbound: ${inboundMovements?.length || 0}`);
        
        // Combine both movements
        const allMovements = [...(outboundMovements || []), ...(inboundMovements || [])];
        
        // Filter by warehouse if needed (API should already do this, but double-check)
        const filteredMovements = allMovements.filter((movement: any) => {
          if (warehouseFilter) {
            return movement.warehouse_id === parseInt(warehouseFilter);
          }
          return true;
        });
        
        console.log(`✅ Total movements after filter: ${filteredMovements.length}, warehouse filter: ${warehouseFilter}`);
        
        // Set the movements
        setMovements(filteredMovements);
      } catch (error) {
        console.error('❌ Error fetching stock movements:', error);
        setMovements([]);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    };

    fetchMovements();
  }, [yearFilter, warehouseFilter, apiKey]);

  // Enrich movement with related data
  const enrichMovement = async (movement: StockMovement): Promise<StockMovement> => {
    try {
      // Fetch item details
      const itemRes = await fetch(`${apiBaseUrl}/items`, {
        headers: { 'X-Api-Key': apiKey },
      });
      if (itemRes.ok) {
        const items = await itemRes.json();
        const item = items.find((i: any) => i.id === movement.item_id);
        if (item) {
          movement.item_code = item.item_code;
          movement.item_name = item.item_name;
        }
      }

      // Fetch location details
      if (movement.location_id) {
        const locRes = await fetch(`${apiBaseUrl}/locations`, {
          headers: { 'X-Api-Key': apiKey },
        });
        if (locRes.ok) {
          const locs = await locRes.json();
          const loc = locs.find((l: any) => l.id === movement.location_id);
          if (loc) {
            movement.location_code = loc.location_code;
          }
        }
      }

      // Fetch warehouse details
      if (movement.warehouse_id) {
        const whRes = await fetch(`${apiBaseUrl}/warehouses`, {
          headers: { 'X-Api-Key': apiKey },
        });
        if (whRes.ok) {
          const warehouses = await whRes.json();
          const wh = warehouses.find((w: any) => w.id === movement.warehouse_id);
          if (wh) {
            movement.warehouse_code = wh.warehouse_code;
          }
        }
      }

      return movement;
    } catch (error) {
      console.error('Error enriching movement:', error);
      return movement;
    }
  };

  // Filter movements
  const filteredMovements = useMemo(() => {
    return movements.filter(movement => {
      const matchesSearch = 
        movement.item_code?.toLowerCase().includes(searchInput.toLowerCase()) ||
        movement.item_name?.toLowerCase().includes(searchInput.toLowerCase()) ||
        movement.batch_number?.toLowerCase().includes(searchInput.toLowerCase()) ||
        movement.so_header_id?.toString().includes(searchInput);

      const filterValue = transactionTypeFilter.toLowerCase();
      const matchesType = !transactionTypeFilter || 
        (movement.movement_type?.toLowerCase() === filterValue) ||
        (movement.transaction_type?.toLowerCase() === filterValue);

      const dateField = movement.movement_date || movement.created_at;
      const movementDate = new Date(dateField);
      const matchesDateFrom = !dateFromFilter || movementDate >= new Date(dateFromFilter);
      const matchesDateTo = !dateToFilter || movementDate <= new Date(dateToFilter + 'T23:59:59');

      return matchesSearch && matchesType && matchesDateFrom && matchesDateTo;
    });
  }, [movements, searchInput, transactionTypeFilter, dateFromFilter, dateToFilter]);

  const columnDefs = [
    { 
      headerName: 'Date/Time', 
      field: 'movement_date',
      valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleString() : new Date(params.data?.created_at).toLocaleString(),
      width: 180,
      sortable: true,
    },
    { 
      headerName: 'Type', 
      field: 'movement_type',
      valueFormatter: (params: any) => params.value || params.data?.transaction_type || 'N/A',
      cellRenderer: (params: any) => {
        const type = params.value || params.data?.transaction_type || 'N/A';
        const typeMap: any = {
          'picking': 'bg-orange-100 text-orange-800',
          'loading': 'bg-blue-100 text-blue-800',
          'return': 'bg-purple-100 text-purple-800',
          'adjustment': 'bg-yellow-100 text-yellow-800',
          'transfer': 'bg-green-100 text-green-800',
          'PICKED': 'bg-red-100 text-red-800',
          'RECEIVED': 'bg-green-100 text-green-800',
          'TRANSFERRED': 'bg-blue-100 text-blue-800',
        };
        return (
          <span className={`px-2 py-1 rounded text-xs font-semibold ${typeMap[type] || 'bg-gray-100 text-gray-800'}`}>
            {type}
          </span>
        );
      },
      width: 120,
      sortable: true,
    },
    { 
      headerName: 'Item Code', 
      field: 'item_code',
      width: 130,
      sortable: true,
    },
    { 
      headerName: 'Item Name', 
      field: 'item_name',
      width: 220,
      sortable: true,
    },
    { 
      headerName: 'Qty Moved', 
      field: 'quantity_moved',
      valueFormatter: (params: any) => {
        const qty = params.value !== undefined ? params.value : params.data?.quantity_change;
        return qty !== undefined && qty !== null ? qty.toString() : '0';
      },
      width: 110,
      sortable: true,
      cellRenderer: (params: any) => {
        const qty = params.value !== undefined ? params.value : params.data?.quantity_change;
        return (
          <span className={`font-semibold ${qty > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {qty}
          </span>
        );
      }
    },
    { 
      headerName: 'From Location', 
      field: 'from_location_code',
      width: 140,
      sortable: true,
    },
    { 
      headerName: 'To Location', 
      field: 'to_location_code',
      width: 140,
      sortable: true,
    },
    { 
      headerName: 'Batch #', 
      field: 'batch_number',
      width: 140,
      sortable: true,
    },
    { 
      headerName: 'Warehouse Code', 
      field: 'warehouse_code',
      width: 120,
      sortable: true,
    },
    { 
      headerName: 'Warehouse Name', 
      field: 'warehouse_name',
      width: 200,
      sortable: true,
    },
    { 
      headerName: 'ASN Header ID', 
      field: 'asn_header_id',
      width: 130,
      sortable: true,
      hide: true,
    },
    { 
      headerName: 'ASN Inventory ID', 
      field: 'asn_inventory_id',
      width: 140,
      sortable: true,
      hide: true,
    },
    { 
      headerName: 'Moved By', 
      field: 'moved_by',
      valueFormatter: (params: any) => params.value || params.data?.created_by_name || 'System',
      width: 130,
      sortable: true,
    },
  ];

  // Export handler
  const handleExportStockMovement = (startDate: string, endDate: string) => {
    setExportStartDate(startDate);
    setExportEndDate(endDate);

    let dataToExport = movements;
    
    if (startDate && endDate) {
      dataToExport = filterByDateRange(movements, startDate, endDate, 'movement_date');
    }

    const exportData = dataToExport.map(row => ({
      'ID': row.id,
      'Item Code': row.item_code || '-',
      'Item Name': row.item_name || '-',
      'From Location': row.from_location_code || row.from_location_id || '-',
      'To Location': row.to_location_code || row.to_location_id || '-',
      'Quantity': row.quantity_moved || row.quantity_change || '-',
      'Movement Type': row.movement_type || row.transaction_type || '-',
      'Movement Date': row.movement_date || row.created_at || '-',
      'SO Header ID': row.so_header_id || '-',
      'Warehouse': row.warehouse_code || row.warehouse_name || row.warehouse_id || '-',
      'Pallet ID': row.pallet_id || '-',
      'Batch': row.batch_number || '-',
      'Notes': row.notes || '-',
    }));

    downloadCSV({
      filename: 'stock_movement_report',
      data: exportData,
    });
  };

  return (
    <div className="p-8 min-h-screen bg-gray-50">
      <div className="max-w-8xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Stock Movement History</h1>
            <p className="text-gray-600">Track all inventory movements and transactions</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Search</label>
              <input
                type="text"
                placeholder="Item code, name, batch, or reference..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full border border-gray-300 px-4 py-3 rounded text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Transaction Type Filter */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Transaction Type</label>
              <select
                value={transactionTypeFilter}
                onChange={(e) => setTransactionTypeFilter(e.target.value)}
                className="w-full border border-gray-300 px-4 py-3 rounded text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Types</option>
                <optgroup label="Inbound">
                  <option value="putaway">Putaway</option>
                </optgroup>
                <optgroup label="Outbound">
                  <option value="allocated">Allocated</option>
                  <option value="picked">Picked</option>
                  <option value="shipped">Shipped</option>
                </optgroup>
                <optgroup label="Other">
                  <option value="transfer">Transfer</option>
                  <option value="adjustment">Adjustment</option>
                </optgroup>
              </select>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">From Date</label>
              <input
                type="date"
                value={dateFromFilter}
                onChange={(e) => setDateFromFilter(e.target.value)}
                className="w-full border border-gray-300 px-4 py-3 rounded text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">To Date</label>
              <input
                type="date"
                value={dateToFilter}
                onChange={(e) => setDateToFilter(e.target.value)}
                className="w-full border border-gray-300 px-4 py-3 rounded text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Download Button */}
            <div className="flex items-end gap-2">
              <button
                onClick={() => handleExportStockMovement('', '')}
                className="px-4 py-3 bg-blue-600 text-white rounded text-base font-semibold hover:bg-blue-700 active:bg-blue-800 transition-all flex items-center justify-center gap-2"
              >
                📥 Download CSV
              </button>
            </div>
          </div>

          {/* Results Count */}
          <div className="mt-4 text-sm text-gray-600">
            Showing <span className="font-semibold">{filteredMovements.length}</span> of <span className="font-semibold">{movements.length}</span> movements
          </div>
        </div>

        {/* Grid */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="ag-theme-alpine" style={{ width: '100%', height: 600 }}>
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500 text-lg">Loading movements...</p>
              </div>
            ) : filteredMovements.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-gray-500 text-lg mb-2">No movements found</p>
                  <p className="text-gray-400 text-sm mb-4">Stock movements will appear here as items are allocated, picked, and shipped</p>
                  <p className="text-xs text-gray-500">Check browser console (F12) for API status</p>
                </div>
              </div>
            ) : (
              <AgGridReact
                ref={gridRef}
                theme="legacy"
                rowData={filteredMovements}
                columnDefs={columnDefs}
                defaultColDef={{
                  resizable: true,
                  sortable: true,
                  filter: true,
                }}
                rowHeight={40}
                headerHeight={40}
                pagination={true}
                paginationPageSize={20}
                suppressRowClickSelection={false}
                onRowClicked={(params) => {
                  setSelectedMovement(params.data);
                  setShowDetails(true);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Details Modal */}
      {showDetails && selectedMovement && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-96 overflow-auto">
            <div className="p-8">
              <h2 className="text-2xl font-bold mb-6">Movement Details</h2>

              <div className="grid grid-cols-2 gap-6 mb-8">
                <div>
                  <label className="text-sm text-gray-600 font-semibold">Item Code</label>
                  <p className="text-lg font-semibold text-gray-900">{selectedMovement.item_code}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-600 font-semibold">Item Name</label>
                  <p className="text-lg font-semibold text-gray-900">{selectedMovement.item_name}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-600 font-semibold">Movement Type</label>
                  <p className="text-lg font-semibold">
                    <span className={`px-2 py-1 rounded text-sm ${
                      selectedMovement.movement_type === 'picking' ? 'bg-orange-100 text-orange-800' :
                      selectedMovement.movement_type === 'loading' ? 'bg-blue-100 text-blue-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {selectedMovement.movement_type || selectedMovement.transaction_type}
                    </span>
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-600 font-semibold">Quantity Moved</label>
                  <p className={`text-lg font-semibold ${((selectedMovement.quantity_moved || selectedMovement.quantity_change) ?? 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {((selectedMovement.quantity_moved || selectedMovement.quantity_change) ?? 0) > 0 ? '+' : ''}{selectedMovement.quantity_moved || selectedMovement.quantity_change}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-600 font-semibold">From Location</label>
                  <p className="text-lg font-semibold text-gray-900">{selectedMovement.from_location_code || selectedMovement.location_code || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-600 font-semibold">To Location</label>
                  <p className="text-lg font-semibold text-gray-900">{selectedMovement.to_location_code || selectedMovement.location_code || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-600 font-semibold">Batch Number</label>
                  <p className="text-lg font-semibold text-gray-900">{selectedMovement.batch_number || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-600 font-semibold">SO Reference</label>
                  <p className="text-lg font-semibold text-blue-600">{selectedMovement.so_header_id ? `SO #${selectedMovement.so_header_id}` : 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm text-gray-600 font-semibold">Date/Time</label>
                  <p className="text-lg font-semibold text-gray-900">
                    {new Date(selectedMovement.movement_date || selectedMovement.created_at).toLocaleString()}
                  </p>
                </div>
                <div>
                  <label className="text-sm text-gray-600 font-semibold">Moved By</label>
                  <p className="text-lg font-semibold text-gray-900">{selectedMovement.moved_by || selectedMovement.created_by_name || 'System'}</p>
                </div>
                {selectedMovement.reason && (
                  <div className="col-span-2">
                    <label className="text-sm text-gray-600 font-semibold">Reason</label>
                    <p className="text-base text-gray-900">{selectedMovement.reason}</p>
                  </div>
                )}
                {selectedMovement.remarks && (
                  <div className="col-span-2">
                    <label className="text-sm text-gray-600 font-semibold">Remarks</label>
                    <p className="text-base text-gray-900">{selectedMovement.remarks}</p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end border-t pt-6">
                <button
                  onClick={() => setShowDetails(false)}
                  className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500 transition-all"
                >
                  Close
                </button>
                <button
                  onClick={() => window.print()}
                  className="px-6 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 transition-all"
                >
                  Print Details
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
