'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { isReadOnlyRole } from '@/utils/rolePermissions';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import TransferModal from '@/app/components/TransferModal';
import DateRangeSelector from '@/app/components/DateRangeSelector';
import { downloadCSV } from '@/utils/exportHelper';

// Register all community modules for AG Grid
ModuleRegistry.registerModules([AllCommunityModule]);

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlInventory = (process.env.NEXT_PUBLIC_URL_INVENTORY || 'http://172.31.39.68:8030/inventory').replace(/^https?:\/\//, 'http://');
const urlAsnInventory = (process.env.NEXT_PUBLIC_URL_ASN_INVENTORY || 'http://172.31.39.68:8030/asn_inventory').replace(/^https?:\/\//, 'http://');
const urlSOInventory = (process.env.NEXT_PUBLIC_URL_SO_INVENTORY || 'http://172.31.39.68:8030/so_inventory').replace(/^https?:\/\//, 'http://');
const urlItems = (process.env.NEXT_PUBLIC_URL_ITEMS || 'http://172.31.39.68:8030/items').replace(/^https?:\/\//, 'http://');
const urlLocations = (process.env.NEXT_PUBLIC_URL_LOCATIONS || 'http://172.31.39.68:8030/locations').replace(/^https?:\/\//, 'http://');
const urlCycleCounts = (process.env.NEXT_PUBLIC_URL_CYCLE_COUNTS || 'http://172.31.39.68:8030/cycle_counts').replace(/^https?:\/\//, 'http://');

export default function InventoryPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const warehouseFilter = searchParams?.get('warehouse');
  const isViewerOnly = isReadOnlyRole(user?.role || '');
  
  // Data States
  const [inventory, setInventory] = useState<any[]>([]);
  const [asnInventory, setAsnInventory] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [cycleCounts, setCycleCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Collapsible States
  const [expandedSections, setExpandedSections] = useState({
    summary: true,
    currentLevels: true,
    batchExpiry: false,
    location: false,
    reorder: false,
    cycleCount: false,
  });

  // Search Filter State
  const [currentLevelsSearchText, setCurrentLevelsSearchText] = useState('');
  const [batchExpirySearchText, setBatchExpirySearchText] = useState('');
  const [reorderSearchText, setReorderSearchText] = useState('');
  const [locationSearchText, setLocationSearchText] = useState('');

  // Transfer Modal State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedInventoryForTransfer, setSelectedInventoryForTransfer] = useState<any>(null);

  // Export State
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');

  // Fetch all data
  const fetchAllData = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log(`🔄 Fetching inventory data for warehouse: ${warehouseFilter || 'all'}`);
      
      // Always fetch with refresh=true to get latest data from database
      // This ensures allocations are reflected immediately
      const url = `/api/inventory-records?year=${new Date().getFullYear()}&refresh=true${warehouseFilter ? `&warehouse=${warehouseFilter}` : ''}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch records: ${response.status}`);
      }

      const data = await response.json();
      const invData = data.inventory || [];
      const asnData = data.asnInventory || [];
      const itemsData = data.items || [];
      const locsData = data.locations || [];
      const cyclesData = data.cycleCounts || [];
      const soInvData = data.soInventory || [];

      console.log(`📦 Inventory records: ${invData.length}, ASN: ${asnData.length}, SO: ${soInvData.length}, warehouse: ${warehouseFilter || 'all'}`);
      console.log('✅ Inventory data:', invData);
      console.log('✅ ASN Inventory data:', asnData);
      console.log('✅ Items data:', itemsData);
      console.log('✅ SO Inventory data:', soInvData);

      // Calculate allocated and shipped quantities from SO inventory
      // Primary key: item_id + location_id + pallet_id (for individual pallet matching)
      // Fallback key: item_id + location_id (if pallet_id is not available)
      const allocatedMap = new Map<string, number>();
      const shippedMap = new Map<string, number>();
      const allocationsByItemLoc = new Map<string, number>(); // Fallback map without pallet_id
      const soInvArray = Array.isArray(soInvData) ? soInvData : (soInvData ? [soInvData] : []);
      
      soInvArray.forEach((so: any) => {
        console.log(`🔍 [SO_INVENTORY] item_id=${so.item_id}, location_id=${so.location_id}, pallet_id=${so.pallet_id}, status=${so.status}, qty_allocated=${so.quantity_allocated}`);
      });
      
      soInvArray
        .filter((so: any) => ['allocated', 'picked', 'shipped'].includes(so.status))
        .forEach((so: any) => {
          // Primary key with pallet_id
          const keyWithPallet = `${so.item_id}-${so.location_id}-${so.pallet_id || 'no-pallet'}`;
          // Fallback key without pallet_id
          const keyWithoutPallet = `${so.item_id}-${so.location_id}`;
          
          // Count allocated and picked in allocated quantity
          if (['allocated', 'picked'].includes(so.status)) {
            allocatedMap.set(keyWithPallet, (allocatedMap.get(keyWithPallet) || 0) + (Number(so.quantity_allocated) || 0));
            allocationsByItemLoc.set(keyWithoutPallet, (allocationsByItemLoc.get(keyWithoutPallet) || 0) + (Number(so.quantity_allocated) || 0));
          }
          // Count shipped separately - use quantity_shipped field
          if (so.status === 'shipped') {
            shippedMap.set(keyWithPallet, (shippedMap.get(keyWithPallet) || 0) + (Number(so.quantity_shipped) || 0));
          }
        });

      console.log('📊 Allocated quantities map (with pallet):', Array.from(allocatedMap.entries()));
      console.log('📊 Allocated quantities map (without pallet - fallback):', Array.from(allocationsByItemLoc.entries()));
      console.log('📊 Shipped quantities map:', Array.from(shippedMap.entries()));

      const enrichedInventory = (Array.isArray(invData) ? invData : (invData ? [invData] : [])).map((inv: any) => {
        // Use the actual allocated_quantity from the database directly
        // This is authoritative and updated by the system when allocations are made
        const allocatedQty = Number(inv.allocated_quantity) || 0;
        
        let onHandQty = Number(inv.on_hand_quantity) || 0;
        
        // Get shipped quantity from database (quantity_shipped column)
        const shippedQty = Number(inv.quantity_shipped) || 0;
        
        // CRITICAL FIX: If items are shipped, reduce on_hand_quantity accordingly
        // Shipped items should NOT count as on-hand
        // on_hand_quantity should be: original_on_hand - shipped
        if (shippedQty > 0) {
          onHandQty = Math.max(0, onHandQty - shippedQty);
          console.log(`📦 Adjusted on_hand for shipped items: original=${inv.on_hand_quantity}, shipped=${shippedQty}, adjusted=${onHandQty}`);
        }
        
        // Determine if location is staging/preparation area (reserved for shipment, not for new allocation)
        // Check: location_code (e.g., "STAGING", "STAGING-004"), location_name (e.g., "Staging-004")
        const location = locations.find(l => l.id === inv.location_id);
        const locationCode = location?.location_code || location?.code || '';
        const locationName = location?.name || location?.location_name || '';
        
        // CRITICAL: If location lookup failed (empty code AND name), check location_id directly
        // Location 85 is the known staging location
        const isStagingLocation = 
          inv.location_id === 85 ||  // FALLBACK: Location 85 is staging
          locationCode.toUpperCase().includes('STAG') ||
          locationCode.toUpperCase().includes('PREP') ||
          locationName.toUpperCase().includes('STAG') ||
          locationName.toUpperCase().includes('PREP') ||
          locationName.toUpperCase().includes('STAGING');
        
        // Only count as available if:
        // 1. inventory_status is 'putaway' (in main storage)
        // 2. NOT in staging/preparation location
        // 3. NOT in damage/defective locations
        const inventoryStatus = inv.inventory_status || 'received';
        const isAllocatable = inventoryStatus === 'putaway' && !isStagingLocation;
        const availableQty = isAllocatable
          ? Math.max(0, onHandQty - allocatedQty)
          : 0; // Not available unless in putaway AND not in staging
        
        if (inv.location_id === 85) {
          console.log(`🔍 [Staging Check] item_id=${inv.item_id}, location_id=${inv.location_id}, code="${locationCode}", name="${locationName}", isStaging=${isStagingLocation}, status=${inventoryStatus}, available=${availableQty}`);
        }
        
        return {
          ...inv,
          on_hand_quantity: onHandQty,
          allocated_quantity: allocatedQty,
          available_quantity: availableQty,
          shipped_quantity: shippedQty,
          quantity_shipped: shippedQty, // Keep both field names for compatibility
          pallet_id: inv.pallet_id || null,
          inventory_status: inventoryStatus,
        };
      });

      setInventory(enrichedInventory);
      setAsnInventory(Array.isArray(asnData) ? asnData : (asnData ? [asnData] : []));
      setItems(Array.isArray(itemsData) ? itemsData : (itemsData ? [itemsData] : []));
      setLocations(Array.isArray(locsData) ? locsData : (locsData ? [locsData] : []));
      setCycleCounts(Array.isArray(cyclesData) ? cyclesData : (cyclesData ? [cyclesData] : []));
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
      console.error('❌ Fetch error:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAllData();
  }, [warehouseFilter]);

  // Listen for inventory update events from other pages (e.g., outbound allocation)
  useEffect(() => {
    const handleInventoryUpdated = () => {
      console.log('📡 Received: inventoryUpdated event - refetching data immediately');
      fetchAllData();
    };
    
    window.addEventListener('inventoryUpdated', handleInventoryUpdated);
    return () => {
      window.removeEventListener('inventoryUpdated', handleInventoryUpdated);
    };
  }, []);

  // Real-time refresh: Poll SO inventory every 30 seconds to update allocated/shipped quantities

  // This ensures allocated and shipped columns stay current without waiting for 1-minute cache to expire
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    
    // Start polling after initial data load
    const startPolling = () => {
      pollInterval = setInterval(() => {
        console.log('🔄 Polling SO inventory for real-time updates...');
        fetchAllData();
      }, 30000); // Poll every 30 seconds
    };
    
    // Small delay to avoid polling immediately after initial load
    const timer = setTimeout(() => {
      startPolling();
    }, 5000);
    
    return () => {
      clearTimeout(timer);
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [warehouseFilter]); // Restart polling if warehouse changes

  // Helper: Get item by ID
  const getItem = (itemId: number) => items.find((i) => i.id === itemId);

  // Helper: Get location by ID
  const getLocation = (locId: number) => locations.find((l) => l.id === locId);

  // Helper: Check if inventory is damage/reject/missing/defective by location name or pallet_id prefix
  const isDamageLocation = (locId: number, palletId?: string): boolean => {
    // Check pallet_id prefix first (DAM-, MIS-, DEF-, PAL-damage, etc.)
    if (palletId) {
      const palletPrefix = (palletId || '').toUpperCase();
      if (palletPrefix.startsWith('DAM-') || 
          palletPrefix.startsWith('MIS-') || 
          palletPrefix.startsWith('DEF-')) {
        return true;
      }
    }
    
    // Check location name as fallback
    const location = getLocation(locId);
    if (!location) return false;
    const locName = (location.location_name || '').toLowerCase();
    // Identify non-saleable locations by name patterns
    return (
      locName.includes('damage') ||
      locName.includes('damaged') ||
      locName.includes('defect') ||
      locName.includes('defective') ||
      locName.includes('reject') ||
      locName.includes('rejected') ||
      locName.includes('missing') ||
      locName.includes('recon') ||
      locName.includes('rma') ||
      locName.includes('scrap')
    );
  };

  // ========== SECTION 1: INVENTORY SUMMARY ==========
  const summaryMetrics = useMemo(() => {
    const totalOnHand = inventory.reduce((sum, inv) => sum + (Number(inv.on_hand_quantity) || 0), 0);
    const totalAllocated = inventory.reduce((sum, inv) => sum + (Number(inv.allocated_quantity) || 0), 0);
    const totalShipped = inventory.reduce((sum, inv) => sum + (Number(inv.shipped_quantity) || 0), 0);
    // Exclude damage locations from available quantity
    const totalAvailable = inventory
      .filter((inv) => !isDamageLocation(inv.location_id, inv.pallet_id))
      .reduce((sum, inv) => sum + (Number(inv.available_quantity) || 0), 0);
    // Count items in damage/missing locations (by location name OR pallet_id prefix)
    const damageOrMissing = inventory
      .filter((inv) => isDamageLocation(inv.location_id, inv.pallet_id))
      .reduce((sum, inv) => sum + (Number(inv.on_hand_quantity) || 0), 0);
    const uniqueLocations = new Set(inventory.map((inv) => inv.location_id)).size;

    return {
      totalItems: inventory.length,
      totalOnHand,
      totalAllocated,
      totalShipped,
      totalAvailable,
      damageOrMissing,
      locations: uniqueLocations,
    };
  }, [inventory, locations]);

  // ========== SECTION 2: CURRENT INVENTORY LEVELS ==========
  const currentLevelsColumns = [
    { headerName: 'Item Code', field: 'item_code', width: 160, sortable: true, filter: true },
    { headerName: 'Item Name', field: 'item_name', width: 220, sortable: true, filter: true },
    { headerName: 'Location', field: 'location_name', width: 130, sortable: true, filter: true },
    { headerName: 'Pallet ID', field: 'pallet_id', width: 280, sortable: true, filter: true },
    { headerName: 'Batch #', field: 'batch_number', width: 110, sortable: true, filter: true },
    { headerName: 'Date Received', field: 'date_received', width: 140, sortable: true, filter: true },
    { headerName: 'On Hand', field: 'on_hand_quantity', width: 110, type: 'numericColumn', sortable: true },
    { headerName: 'Available', field: 'available_quantity', width: 110, type: 'numericColumn', sortable: true },
    { headerName: 'Allocated', field: 'allocated_quantity', width: 110, type: 'numericColumn', sortable: true },
    { headerName: 'Shipped', field: 'shipped_quantity', width: 110, type: 'numericColumn', sortable: true },
    { headerName: 'Date Added', field: 'date_added', width: 140, sortable: true, filter: true, hide: true },
    { headerName: 'ASN #', field: 'asn_number', width: 160, sortable: true, filter: true },
    { headerName: 'ASN Status', field: 'asn_status', width: 120, sortable: true, filter: true, hide: true },
    { headerName: 'Vendor Code', field: 'vendor_code', width: 130, sortable: true, filter: true },
    { headerName: 'Vendor Name', field: 'vendor_name', width: 180, sortable: true, filter: true, wrapText: true, autoHeight: true },
    { headerName: 'SO #', field: 'so_number', width: 160, sortable: true, filter: true },
    { headerName: 'SO Status', field: 'so_status', width: 120, sortable: true, filter: true, hide: true },
    { headerName: 'Customer Code', field: 'customer_code', width: 130, sortable: true, filter: true },
    { headerName: 'Customer Name', field: 'customer_name', width: 180, sortable: true, filter: true, wrapText: true, autoHeight: true },
    { headerName: 'Date Shipped', field: 'date_shipped', width: 140, sortable: true, filter: true },
    { headerName: 'Weight (KG)', field: 'weight_uom_kg', width: 110, type: 'numericColumn', sortable: true, hide: true },
    { headerName: 'Pallet Config', field: 'pallet_config', width: 130, sortable: true, hide: true },
    {
      headerName: 'Actions',
      field: 'actions',
      width: 100,
      sortable: false,
      filter: false,
      cellRenderer: (params: any) => {
        // Disable transfer if status is allocated, picked, or shipped
        const status = params.data?.inventory_status || 'received';
        const isDisabled = ['allocated', 'picked', 'shipped'].includes(status);
        
        return (
          !isViewerOnly && (
            <button
              onClick={() => {
                setSelectedInventoryForTransfer(params.data);
                setIsTransferModalOpen(true);
              }}
              disabled={isDisabled}
              title={isDisabled ? `Cannot transfer: inventory is ${status}` : 'Transfer inventory'}
              className={`px-3 py-1 rounded text-sm transition ${
                isDisabled
                  ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              Transfer
            </button>
          )
        );
      },
    },
  ];

  const currentLevelsData = useMemo(() => {
    let data = inventory.map((inv) => ({
      ...inv,
      item_code: getItem(inv.item_id)?.item_code || '-',
      item_name: getItem(inv.item_id)?.item_name || '-',
      location_name: getLocation(inv.location_id)?.location_name || '-',
      pallet_id: inv.pallet_id || '-',
      batch_number: inv.batch_number || '-',
      date_received: inv.date_received ? new Date(inv.date_received).toLocaleDateString() : '-',
      date_added: inv.date_added ? new Date(inv.date_added).toLocaleDateString() : '-',
      asn_number: inv.asn_number || '-',
      asn_status: inv.asn_status || '-',
      vendor_code: inv.vendor_code || '-',
      vendor_name: inv.vendor_name || '-',
      so_number: inv.so_number || '-',
      so_status: inv.so_status || '-',
      customer_code: inv.customer_code || '-',
      customer_name: inv.customer_name || '-',
      date_shipped: inv.date_shipped ? new Date(inv.date_shipped).toLocaleDateString() : '-',
      weight_uom_kg: getItem(inv.item_id)?.weight_kg || getItem(inv.item_id)?.weight_uom_kg || '-',
      pallet_config: getItem(inv.item_id)?.pallet_config || '-',
    }));

    // Apply search filter
    if (currentLevelsSearchText.trim()) {
      const searchLower = currentLevelsSearchText.toLowerCase();
      data = data.filter((row) =>
        row.item_code?.toLowerCase().includes(searchLower) ||
        row.item_name?.toLowerCase().includes(searchLower) ||
        row.location_name?.toLowerCase().includes(searchLower) ||
        row.pallet_id?.toLowerCase().includes(searchLower) ||
        row.batch_number?.toLowerCase().includes(searchLower) ||
        row.asn_number?.toLowerCase().includes(searchLower) ||
        row.asn_status?.toLowerCase().includes(searchLower) ||
        row.vendor_code?.toLowerCase().includes(searchLower) ||
        row.vendor_name?.toLowerCase().includes(searchLower) ||
        row.so_number?.toLowerCase().includes(searchLower) ||
        row.so_status?.toLowerCase().includes(searchLower) ||
        row.customer_code?.toLowerCase().includes(searchLower) ||
        row.customer_name?.toLowerCase().includes(searchLower)
      );
    }

    return data;
  }, [inventory, items, locations, currentLevelsSearchText]);

  // ========== SECTION 3: BATCH & EXPIRY DETAILS ==========
  const batchExpiryColumns = [
    { headerName: 'Item Code', field: 'item_code', width: 120, sortable: true, filter: true },
    { headerName: 'Item Name', field: 'item_name', width: 150, sortable: true, filter: true },
    { headerName: 'Batch #', field: 'batch_number', width: 110, sortable: true, filter: true },
    { headerName: 'Pallet ID', field: 'pallet_id', width: 120, sortable: true, filter: true },
    { headerName: 'Quantity', field: 'quantity_received', width: 110, type: 'numericColumn', sortable: true },
    { headerName: 'Expiry Date', field: 'expiry_date', width: 130, sortable: true },
    { headerName: 'Days Until Expiry', field: 'days_until_expiry', width: 150, type: 'numericColumn', sortable: true },
    {
      headerName: 'Status',
      field: 'expiry_status',
      width: 110,
      sortable: true,
      cellStyle: (params: any) => {
        const status = params.value;
        if (status === 'Expired') return { backgroundColor: '#FEE2E2', color: '#DC2626', fontWeight: 'bold' } as any;
        if (status === 'Expiring Soon') return { backgroundColor: '#FEF3C7', color: '#D97706', fontWeight: 'bold' } as any;
        if (status === 'Valid') return { backgroundColor: '#DCFCE7', color: '#166534', fontWeight: 'bold' } as any;
        return {} as any;
      },
    },
  ];

  const batchExpiryData = useMemo(() => {
    const now = new Date();
    
    console.log(`🔍 Processing batch expiry data: asnInventory=${asnInventory.length}, warehouseFilter=${warehouseFilter}`);
    console.log('📦 ASN Inventory sample:', asnInventory.slice(0, 2).map(a => ({ 
      id: a.id, 
      batch_number: a.batch_number, 
      expiry_date: a.expiry_date, 
      status: a.status 
    })));
    
    // Deduplicate: Keep only one record per unique item_id + batch_number + expiry_date + pallet_id combination
    const uniqueBatches = new Map<string, any>();
    
    asnInventory
      .filter((asn) => {
        // Filter by warehouse if selected
        if (warehouseFilter && asn.warehouse_id !== parseInt(warehouseFilter)) {
          return false;
        }
        // Only show on-hand inventory, exclude shipped
        if (asn.status === 'shipped' || asn.status === 'Shipped') {
          return false;
        }
        // Must have batch_number or expiry_date to display
        const hasBatchOrExpiry = asn.batch_number || asn.expiry_date;
        return hasBatchOrExpiry;
      })
      .forEach((asn) => {
        // Create unique key to prevent duplicates
        const uniqueKey = `${asn.item_id}-${asn.batch_number}-${asn.expiry_date}-${asn.pallet_id || 'no-pallet'}`;
        
        // Only add if we haven't seen this batch combination before
        if (!uniqueBatches.has(uniqueKey)) {
          let daysUntilExpiry = null;
          let expiryStatus = 'Valid';

          if (asn.expiry_date) {
            const expiryDate = new Date(asn.expiry_date);
            daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            if (daysUntilExpiry < 0) expiryStatus = 'Expired';
            else if (daysUntilExpiry < 30) expiryStatus = 'Expiring Soon';
          }

          uniqueBatches.set(uniqueKey, {
            ...asn,
            item_code: getItem(asn.item_id)?.item_code || '-',
            item_name: getItem(asn.item_id)?.item_name || '-',
            pallet_id: asn.pallet_id || '-',
            days_until_expiry: daysUntilExpiry,
            expiry_status: expiryStatus,
          });
        }
      });
    
    const result = Array.from(uniqueBatches.values());
    console.log(`✅ Batch expiry records found: ${result.length}`);
    return result;
  }, [asnInventory, items, warehouseFilter]);

  // Filtered batch expiry data with search
  const filteredBatchExpiryData = useMemo(() => {
    let data = batchExpiryData;
    
    if (batchExpirySearchText.trim()) {
      const searchLower = batchExpirySearchText.toLowerCase();
      data = data.filter((row) =>
        row.item_code?.toLowerCase().includes(searchLower) ||
        row.item_name?.toLowerCase().includes(searchLower) ||
        row.batch_number?.toLowerCase().includes(searchLower)
      );
    }
    
    return data;
  }, [batchExpiryData, batchExpirySearchText]);

  // Handler for exporting batch/expiry data
  const handleExportBatchExpiry = () => {
    const exportData = filteredBatchExpiryData.map((row) => ({
      'Item Code': row.item_code,
      'Item Name': row.item_name,
      'Batch #': row.batch_number,
      'Pallet ID': row.pallet_id,
      'Quantity': row.quantity_received,
      'Expiry Date': row.expiry_date,
      'Days Until Expiry': row.days_until_expiry,
      'Status': row.expiry_status,
    }));

    downloadCSV({
      filename: 'batch_expiry_details',
      data: exportData,
    });
  };

  // ========== SECTION 4: LOCATION BREAKDOWN ==========
  const locationColumns = [
    { headerName: 'Location', field: 'location_name', width: 150, sortable: true, filter: true },
    { headerName: 'Total On Hand', field: 'total_on_hand', width: 130, type: 'numericColumn', sortable: true },
    { headerName: 'Total Allocated', field: 'total_allocated', width: 130, type: 'numericColumn', sortable: true },
    { headerName: 'Total Available', field: 'total_available', width: 130, type: 'numericColumn', sortable: true },
    { headerName: 'Item Count', field: 'item_count', width: 110, type: 'numericColumn', sortable: true },
  ];

  const locationBreakdownData = useMemo(() => {
    const locationMap = new Map<number, any>();

    inventory.forEach((inv) => {
      const locId = inv.location_id;
      if (!locationMap.has(locId)) {
        locationMap.set(locId, {
          location_id: locId,
          location_name: getLocation(locId)?.location_name || '-',
          total_on_hand: 0,
          total_allocated: 0,
          total_available: 0,
          item_count: 0,
        });
      }

      const loc = locationMap.get(locId)!;
      loc.total_on_hand += Number(inv.on_hand_quantity) || 0;
      loc.total_allocated += Number(inv.allocated_quantity) || 0;
      // Only add to available if not in damage location
      if (!isDamageLocation(locId)) {
        loc.total_available += Number(inv.available_quantity) || 0;
      }
      loc.item_count += 1;
    });

    return Array.from(locationMap.values());
  }, [inventory, locations]);

  // ========== SECTION 5: REORDER ANALYSIS ==========
  const reorderColumns = [
    { headerName: 'Item Code', field: 'item_code', width: 120, sortable: true, filter: true },
    { headerName: 'Item Name', field: 'item_name', width: 150, sortable: true, filter: true },
    { headerName: 'ABC Class', field: 'abc_classification', width: 110, sortable: true, filter: true },
    { headerName: 'Current Qty', field: 'current_qty', width: 110, type: 'numericColumn', sortable: true },
    { headerName: 'Min Stock', field: 'min_stock_level', width: 110, type: 'numericColumn', sortable: true },
    { headerName: 'Max Stock', field: 'max_stock_level', width: 110, type: 'numericColumn', sortable: true },
    { headerName: 'Reorder Point', field: 'reorder_point', width: 120, type: 'numericColumn', sortable: true },
    {
      headerName: 'Needs Reorder',
      field: 'needs_reorder',
      width: 130,
      sortable: true,
      cellStyle: (params: any) => {
        if (params.value) return { backgroundColor: '#FEE2E2', color: '#DC2626', fontWeight: 'bold' } as any;
        return { backgroundColor: '#DCFCE7', color: '#166534', fontWeight: 'bold' } as any;
      },
    },
  ] as any;

  const reorderAnalysisData = useMemo(() => {
    const itemMap = new Map<number, { on_hand: number }>();

    // Filter inventory by warehouse and calculate quantities
    inventory.forEach((inv) => {
      // If warehouse filter is set, only include items from that warehouse
      if (warehouseFilter && inv.warehouse_id !== parseInt(warehouseFilter)) {
        return;
      }
      
      if (!itemMap.has(inv.item_id)) {
        itemMap.set(inv.item_id, { on_hand: 0 });
      }
      itemMap.get(inv.item_id)!.on_hand += Number(inv.on_hand_quantity) || 0;
    });

    // Only return items that actually have inventory in the warehouse and need reordering
    return items
      .map((item) => {
        const currentQty = itemMap.get(item.id)?.on_hand || 0;
        const reorderPoint = item.reorder_point || item.min_stock_level || 0;
        const needsReorder = currentQty <= reorderPoint;

        return {
          item_id: item.id,
          item_code: item.item_code,
          item_name: item.item_name || '-',
          abc_classification: item.abc_classification || 'Unclassified',
          current_qty: currentQty,
          min_stock_level: item.min_stock_level || 0,
          max_stock_level: item.max_stock_level || 0,
          reorder_point: reorderPoint,
          needs_reorder: needsReorder ? 'Yes' : 'No',
        };
      })
      .filter(item => itemMap.has(item.item_id)) // Only show items in current warehouse
      .filter(item => item.needs_reorder === 'Yes') // Only show items that need reordering
      .sort((a, b) => a.current_qty - b.current_qty); // Sort by current qty (lowest first)
  }, [inventory, items, warehouseFilter]);

  // Filtered reorder analysis data with search
  const filteredReorderData = useMemo(() => {
    let data = reorderAnalysisData;
    
    if (reorderSearchText.trim()) {
      const searchLower = reorderSearchText.toLowerCase();
      data = data.filter((row) =>
        row.item_code?.toLowerCase().includes(searchLower) ||
        row.item_name?.toLowerCase().includes(searchLower)
      );
    }
    
    return data;
  }, [reorderAnalysisData, reorderSearchText]);

  // Handler for exporting reorder analysis data
  const handleExportReorder = () => {
    const exportData = filteredReorderData.map((row) => ({
      'Item Code': row.item_code,
      'Item Name': row.item_name,
      'ABC Class': row.abc_classification,
      'Current Qty': row.current_qty,
      'Min Stock': row.min_stock_level,
      'Max Stock': row.max_stock_level,
      'Reorder Point': row.reorder_point,
      'Needs Reorder': row.needs_reorder,
    }));

    downloadCSV({
      filename: 'reorder_analysis',
      data: exportData,
    });
  };

  // Filtered location breakdown data with search
  const filteredLocationData = useMemo(() => {
    let data = locationBreakdownData;
    
    if (locationSearchText.trim()) {
      const searchLower = locationSearchText.toLowerCase();
      data = data.filter((row) =>
        row.location_name?.toLowerCase().includes(searchLower)
      );
    }
    
    return data;
  }, [locationBreakdownData, locationSearchText]);

  // Handler for exporting location breakdown data
  const handleExportLocation = () => {
    const exportData = filteredLocationData.map((row) => ({
      'Location': row.location_name,
      'Total On Hand': row.total_on_hand,
      'Total Allocated': row.total_allocated,
      'Total Available': row.total_available,
      'Item Count': row.item_count,
    }));

    downloadCSV({
      filename: 'location_breakdown',
      data: exportData,
    });
  };

  // ========== SECTION 6: CYCLE COUNT ==========
  const cycleCountColumns = [
    { headerName: 'Item Name', field: 'item_name', width: 150, sortable: true, filter: true },
    { headerName: 'Batch', field: 'batch_number', width: 110, sortable: true },
    { headerName: 'Count Date', field: 'count_date', width: 130, sortable: true },
    { headerName: 'System Qty', field: 'system_quantity', width: 120, type: 'numericColumn', sortable: true },
    { headerName: 'Counted Qty', field: 'counted_quantity', width: 120, type: 'numericColumn', sortable: true },
    { headerName: 'Discrepancy', field: 'discrepancy', width: 120, type: 'numericColumn', sortable: true },
    { headerName: 'Discrepancy %', field: 'discrepancy_percentage', width: 130, type: 'numericColumn', sortable: true },
    {
      headerName: 'Status',
      field: 'status_badge',
      width: 120,
      sortable: true,
      cellStyle: (params: any) => {
        const status = params.value;
        if (status === 'Match') return { backgroundColor: '#DCFCE7', color: '#166534', fontWeight: 'bold' } as any;
        if (status === 'Shortage') return { backgroundColor: '#FEE2E2', color: '#DC2626', fontWeight: 'bold' } as any;
        if (status === 'Overage') return { backgroundColor: '#FEF3C7', color: '#D97706', fontWeight: 'bold' } as any;
        return {} as any;
      },
    },
  ];

  const cycleCountData = useMemo(() => {
    return cycleCounts.map((cc) => {
      const discrepancy = (cc.counted_quantity || 0) - (cc.system_quantity || 0);
      const discrepancyPercentage = cc.system_quantity ? ((Math.abs(discrepancy) / cc.system_quantity) * 100).toFixed(2) : '0';
      let statusBadge = 'Match';
      if (discrepancy < 0) statusBadge = 'Shortage';
      else if (discrepancy > 0) statusBadge = 'Overage';

      return {
        ...cc,
        item_name: getItem(cc.item_id)?.item_name || '-',
        discrepancy,
        discrepancy_percentage: discrepancyPercentage,
        status_badge: statusBadge,
      };
    });
  }, [cycleCounts, items]);

  // Collapse/Expand Handler
  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Export handler
  const handleExportInventory = (startDate: string, endDate: string) => {
    setExportStartDate(startDate);
    setExportEndDate(endDate);
    
    const exportData = currentLevelsData.map(row => ({
      'Item Code': row.item_code,
      'Item Name': row.item_name,
      'Location': row.location_name,
      'Pallet ID': row.pallet_id,
      'Batch #': row.batch_number,
      'Date Received': row.date_received,
      'Date Added': row.date_added,
      'ASN #': row.asn_number,
      'ASN Status': row.asn_status,
      'Vendor Code': row.vendor_code,
      'Vendor Name': row.vendor_name,
      'SO #': row.so_number,
      'SO Status': row.so_status,
      'Customer Code': row.customer_code,
      'Customer Name': row.customer_name,
      'Date Shipped': row.date_shipped,
      'On Hand': row.on_hand_quantity,
      'Available': row.available_quantity,
      'Allocated': row.allocated_quantity,
      'Shipped': row.shipped_quantity,
      'Weight (KG)': row.weight_uom_kg,
    }));

    downloadCSV({
      filename: 'inventory_report',
      data: exportData,
    });
  };

  // Collapsible Section Component
  const CollapsibleSection = ({
    title,
    sectionKey,
    children,
  }: {
    title: string;
    sectionKey: keyof typeof expandedSections;
    children: React.ReactNode;
  }) => (
    <div className="bg-white rounded-lg border shadow mb-6">
      <button
        onClick={() => toggleSection(sectionKey)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition"
      >
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        <span className={`text-2xl text-gray-600 transition ${expandedSections[sectionKey] ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>
      {expandedSections[sectionKey] && <div className="border-t px-6 py-4">{children}</div>}
    </div>
  );

  return (
    <main className="p-6 bg-gray-100 min-h-screen">
      {/* Transfer Modal */}
      {selectedInventoryForTransfer && (
        <TransferModal
          isOpen={isTransferModalOpen}
          sourceInventory={selectedInventoryForTransfer}
          locations={locations}
          items={items}
          onClose={() => setIsTransferModalOpen(false)}
          onTransferComplete={() => {
            // Refresh the inventory data
            fetchAllData();
          }}
        />
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Inventory Dashboard</h1>
        <p className="text-gray-600">Comprehensive inventory analytics and tracking</p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 text-red-700">
          <p className="font-semibold">⚠️ Error: {error}</p>
        </div>
      )}

      {/* SECTION 1: Inventory Summary */}
      <CollapsibleSection title="📊 Inventory Summary" sectionKey="summary">
        <div className="grid grid-cols-7 gap-4">
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <p className="text-gray-600 text-sm font-semibold">Total Items</p>
            <p className="text-3xl font-bold text-blue-600 mt-2">{summaryMetrics.totalItems}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4 border border-green-200">
            <p className="text-gray-600 text-sm font-semibold">On Hand Qty</p>
            <p className="text-3xl font-bold text-green-600 mt-2">{summaryMetrics.totalOnHand}</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
            <p className="text-gray-600 text-sm font-semibold">Available Qty</p>
            <p className="text-3xl font-bold text-purple-600 mt-2">{summaryMetrics.totalAvailable}</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
            <p className="text-gray-600 text-sm font-semibold">Allocated Qty</p>
            <p className="text-3xl font-bold text-yellow-600 mt-2">{summaryMetrics.totalAllocated}</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
            <p className="text-gray-600 text-sm font-semibold">Shipped Qty</p>
            <p className="text-3xl font-bold text-orange-600 mt-2">{summaryMetrics.totalShipped}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-4 border border-red-200">
            <p className="text-gray-600 text-sm font-semibold">Damage/Missing</p>
            <p className="text-3xl font-bold text-red-600 mt-2">{summaryMetrics.damageOrMissing}</p>
          </div>
          <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
            <p className="text-gray-600 text-sm font-semibold">Locations</p>
            <p className="text-3xl font-bold text-indigo-600 mt-2">{summaryMetrics.locations}</p>
          </div>
        </div>
      </CollapsibleSection>

      {/* SECTION 2: Current Inventory Levels */}
      <CollapsibleSection title="📦 Current Inventory Levels (Per Item)" sectionKey="currentLevels">
        {currentLevelsData.length === 0 && !currentLevelsSearchText ? (
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg font-semibold mb-2">📭 No inventory data available</p>
            <p className="text-sm">Inventory will appear here after items are added via putaway</p>
          </div>
        ) : (
          <>
            {/* Search Bar & Export */}
            <div className="mb-4 flex gap-2 flex-wrap">
              <input
                type="text"
                placeholder="🔍 Search by Item Code, Item Name, Location, or Pallet ID..."
                value={currentLevelsSearchText}
                onChange={(e) => setCurrentLevelsSearchText(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[300px]"
              />
              {currentLevelsSearchText && (
                <button
                  onClick={() => setCurrentLevelsSearchText('')}
                  className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => handleExportInventory('', '')}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold flex items-center gap-2"
              >
                📥 Download CSV
              </button>
            </div>

            {currentLevelsData.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <p className="text-lg font-semibold mb-2">🔍 No results found</p>
                <p className="text-sm">Try a different search term</p>
              </div>
            ) : (
              <div className="ag-theme-quartz" style={{ width: '100%', height: 600 }}>
                <AgGridReact
                  theme="legacy"
                  rowData={currentLevelsData}
                  columnDefs={currentLevelsColumns}
                  defaultColDef={{ resizable: true, sortable: true, filter: true, minWidth: 100 }}
                  pagination={true}
                  paginationPageSize={100}
                  paginationPageSizeSelector={[10, 20, 50, 100]}
                  suppressPaginationPanel={false}
                />
              </div>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* SECTION 3: Batch & Expiry Details */}
      <CollapsibleSection title="⏰ Batch & Expiry Details" sectionKey="batchExpiry">
        {batchExpiryData.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg font-semibold mb-2">📭 No batch/expiry data available</p>
            <p className="text-sm">Data will appear here when items with batch numbers are received</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                placeholder="Search by Item Code, Item Name, or Batch #..."
                value={batchExpirySearchText}
                onChange={(e) => setBatchExpirySearchText(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleExportBatchExpiry}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
              >
                📥 Download CSV
              </button>
            </div>
            <div className="ag-theme-quartz" style={{ width: '100%', height: 600 }}>
              <AgGridReact
                theme="legacy"
                rowData={filteredBatchExpiryData}
                columnDefs={batchExpiryColumns}
                defaultColDef={{ resizable: true, sortable: true, filter: true, minWidth: 100 }}
                pagination={true}
                paginationPageSize={100}
                paginationPageSizeSelector={[10, 20, 50, 100]}
                suppressPaginationPanel={false}
              />
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* SECTION 4: Location Breakdown */}
      <CollapsibleSection title="📍 Location Breakdown" sectionKey="location">
        {locationBreakdownData.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg font-semibold mb-2">📭 No location data available</p>
            <p className="text-sm">Locations will appear here when inventory is received</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                placeholder="Search by Location..."
                value={locationSearchText}
                onChange={(e) => setLocationSearchText(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleExportLocation}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
              >
                📥 Download CSV
              </button>
            </div>
            <div className="ag-theme-quartz" style={{ width: '100%', height: 600 }}>
              <AgGridReact
                theme="legacy"
                rowData={filteredLocationData}
                columnDefs={locationColumns}
                defaultColDef={{ resizable: true, sortable: true, filter: true, minWidth: 100 }}
                pagination={true}
                paginationPageSize={100}
                paginationPageSizeSelector={[10, 20, 50, 100]}
                suppressPaginationPanel={false}
              />
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* SECTION 5: Reorder Analysis */}
      <CollapsibleSection title="🔄 Reorder Analysis" sectionKey="reorder">
        {reorderAnalysisData.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg font-semibold mb-2">📭 No items configured</p>
            <p className="text-sm">Reorder analysis will appear here when items are added to the system</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                placeholder="Search by Item Code or Item Name..."
                value={reorderSearchText}
                onChange={(e) => setReorderSearchText(e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleExportReorder}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition whitespace-nowrap"
              >
                📥 Download CSV
              </button>
            </div>
            <div className="ag-theme-quartz" style={{ width: '100%', height: 600 }}>
              <AgGridReact
                theme="legacy"
                rowData={filteredReorderData}
                columnDefs={reorderColumns}
                defaultColDef={{ resizable: true, sortable: true, filter: true, minWidth: 100 }}
                pagination={true}
                paginationPageSize={100}
                paginationPageSizeSelector={[10, 20, 50, 100]}
                suppressPaginationPanel={false}
              />
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* SECTION 6: Cycle Count */}
      <CollapsibleSection title="📋 Cycle Count Variance Analysis" sectionKey="cycleCount">
        {cycleCountData.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p className="text-lg font-semibold mb-2">📭 No cycle count data</p>
            <p className="text-sm">Cycle count records will appear here once they are created</p>
          </div>
        ) : (
          <div className="ag-theme-quartz" style={{ width: '100%', height: 600 }}>
            <AgGridReact
              theme="legacy"
              rowData={cycleCountData}
              columnDefs={cycleCountColumns}
              defaultColDef={{ resizable: true, sortable: true, filter: true, minWidth: 100 }}
              pagination={true}
              paginationPageSize={100}
              paginationPageSizeSelector={[10, 20, 50, 100]}
              suppressPaginationPanel={false}
            />
          </div>
        )}
      </CollapsibleSection>
    </main>
  );
}
