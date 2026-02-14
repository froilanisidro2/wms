"use client";
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getCustomers, getItems, getLocations } from '../config/api';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { submitPutawayRecord, submitSplitPutaway, generatePalletIdByReason } from '@/utils/putawayHelper';
import { deductInventoryOnShipped, validateShipmentInventory, getShipmentSummary } from '@/utils/shipmentHelper';
import { allocateSOLines, allocateSOLinesWithBatchFallback, validateAllocation, saveAllocation, getAllocationSummary, formatBatchInfo, AllocationStrategy } from '@/utils/batchAllocationHelper';
import { fetchAllocatedBatches, confirmPicks, validatePickCompletion, formatBatchDisplay, getPickingSummary, groupBatchesByItem } from '@/utils/pickingHelper';
import { 
  allocateSOLinesToBatches, 
  validateAllocationCompleteness, 
  generatePickingList, 
  updateSOStatus, 
  saveAllocationsToInventory,
  getStatusColor, 
  canAllocate, 
  canPick, 
  canShip,
  type SOStatus,
  type AllocationResult
} from '@/utils/outboundWorkflowHelper';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

// Global style to show grid lines even when empty
const gridStyles = `
  .ag-root {
    --ag-grid-size: 10px;
  }
  .ag-theme-alpine {
    --ag-borders-side-color: #d1d5db;
  }
  .ag-center-cols-container {
    border: 1px solid #d1d5db;
  }
`;

// Register all community modules for AG Grid v34+ (ESM)
ModuleRegistry.registerModules([AllCommunityModule]);

// Remove uuidv4, IDs are now auto-incremented by backend

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
const urlHeaders = process.env.NEXT_PUBLIC_URL_SO_HEADERS || '';
const urlLines = process.env.NEXT_PUBLIC_URL_SO_LINES || '';
const urlPutaway = process.env.NEXT_PUBLIC_URL_PUTAWAY_TRANSACTIONS || '';
const urlReceivingTransactions = process.env.NEXT_PUBLIC_URL_PICK_TRANSACTIONS || '';
const urlAsnInventory = process.env.NEXT_PUBLIC_URL_ASN_INVENTORY || '';
const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';

/**
 * Wrapper functions to route SO data through API layer
 * These replace direct PostgREST calls
 */
async function fetchSOHeaders() {
  const response = await fetch('/api/so-data?dataType=headers');
  if (!response.ok) throw new Error(`Failed to fetch headers: ${response.status}`);
  const data = await response.json();
  return data.soHeaders || [];
}

async function fetchSOLines(headerId?: number) {
  const query = headerId ? `/api/so-data?dataType=lines&headerId=${headerId}` : '/api/so-data?dataType=lines';
  const response = await fetch(query);
  if (!response.ok) throw new Error(`Failed to fetch lines: ${response.status}`);
  const data = await response.json();
  return data.soLines || [];
}

async function fetchSOData() {
  const response = await fetch('/api/so-data?dataType=all');
  if (!response.ok) throw new Error(`Failed to fetch SO data: ${response.status}`);
  return response.json();
}

async function postSOHeader(payload: any) {
  return fetch('/api/so-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createHeader', header: payload }),
  });
}

async function postSOLines(payload: any[]) {
  // Post all lines at once via API endpoint
  return fetch('/api/so-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createLines', lines: payload }),
  });
}

// AG Grid columnDefs for entry grid (hides non-essential fields)
const columnDefs = [
  { headerName: 'Item Code', field: 'itemCode', editable: true, width: 130 },
  { headerName: 'Item Name', field: 'itemName', editable: true, width: 200 },
  { headerName: 'Expected Qty', field: 'quantityExpected', editable: true, width: 130 },
  { headerName: 'SO UOM', field: 'soUom', editable: true, width: 110 },
  { headerName: 'Ordered Qty', field: 'orderedQuantity', editable: true, width: 130 },
  { headerName: 'UOM', field: 'itemUom', editable: false, width: 100 },
  { headerName: 'Pallet Config', field: 'palletConfig', editable: false, width: 130 },
  { headerName: 'Weight (KG)', field: 'weightUomKg', editable: true, width: 110 },
  { headerName: 'Batch #', field: 'batchNumber', editable: true, width: 120 },
  { headerName: 'Description', field: 'description', editable: true, hide: true },
  { headerName: 'Expected Qty', field: 'expectedQuantity', editable: true, hide: true },
  { headerName: 'SO UOM', field: 'asnUom', editable: true, hide: true },
  {
    headerName: 'Mfg Date',
    field: 'manufacturingDate',
    editable: true,
    hide: true,
    cellEditor: 'agDatePicker',
    cellEditorParams: {
      // Optionally set min/max date
    },
    valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString() : '',
  },
  {
    headerName: 'Expiry Date',
    field: 'expiryDate',
    editable: true,
    hide: true,
    cellEditor: 'agDatePicker',
    cellEditorParams: {
      // Optionally set min/max date
    },
    valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString() : '',
  },
  { headerName: 'Pallet ID', field: 'palletId', editable: true, hide: true },
  { headerName: 'Remarks', field: 'remarks', editable: true, hide: true },
];

// AG Grid columnDefs for record view grid (shows all fields)
const recordViewColumnDefs = [
  { headerName: 'Item Code', field: 'itemCode', editable: true, width: 130 },
  { headerName: 'Item Name', field: 'itemName', editable: true, width: 220 },
  { headerName: 'Expected Qty', field: 'quantityExpected', editable: true, width: 120 },
  { headerName: 'SO UOM', field: 'soUom', editable: true, width: 100 },
  { headerName: 'Ordered Qty', field: 'orderedQuantity', editable: true, width: 130 },
  { headerName: 'Allocated Qty', field: 'allocatedQuantity', editable: false, width: 140 },
  { headerName: 'Shipped Qty', field: 'shippedQuantity', editable: false, width: 120 },
  { headerName: 'UOM', field: 'itemUom', editable: false, width: 90 },
  { headerName: 'Pallet Config', field: 'palletConfig', editable: false, width: 110 },
  { headerName: 'Batch #', field: 'batchNumber', editable: true, width: 100 },
  { headerName: 'Pallet ID', field: 'palletId', editable: false, width: 280 },
  // Hidden fields - kept for reference
  { headerName: 'Mfg Date', field: 'manufacturingDate', editable: true, hide: true },
  { headerName: 'Expiry Date', field: 'expiryDate', editable: true, hide: true },
  { headerName: 'Description', field: 'description', editable: true, hide: true },
  { headerName: 'Expected Qty', field: 'expectedQuantity', editable: true, hide: true },
  { headerName: 'SO UOM', field: 'asnUom', editable: true, hide: true },
  { headerName: 'Weight UOM (KG)', field: 'weightUomKg', editable: true, hide: true },
  { headerName: 'Remarks', field: 'remarks', editable: true, hide: true },
];


interface SOHeader {
  soNumber: string;
  barcode: string;
  customerId: number | null;
  soDate: string;
  status: string;
  remarks: string;
}

interface SOLine {
  itemCode: string;
  itemName: string;
  description: string;
  expectedQuantity: string;
  orderedQuantity: string;
  batchNumber: string;
  // serialNumber removed
  manufacturingDate: string;
  expiryDate: string;
  palletId: string;
  weightUomKg: string;
  palletConfig: string;
  itemUom: string;
  asnUom: string;
  remarks: string;
  [key: string]: any;
}

export default function OutboundPage() {
    // State for Outbound Entry collapse/expand
    const [isOutboundEntryExpanded, setIsOutboundEntryExpanded] = useState(true);
    // State for Putaway modal
    const [showPutawayModal, setShowPutawayModal] = useState(false);
    const [putawayHeaderId, setPutawayHeaderId] = useState<number | null>(null);
    const [putawayLineId, setPutawayLineId] = useState<number | null>(null);
    const [putawayLocation, setPutawayLocation] = useState('');
    const [putawayQuantity, setPutawayQuantity] = useState('');
    const [putawayRemarks, setPutawayRemarks] = useState('');
    const [putawayLoading, setPutawayLoading] = useState(false);
    const [putawayError, setPutawayError] = useState<string | null>(null);
    
    // Split putaway state - now supports multiple reasons
    const [isSplitMode, setIsSplitMode] = useState(false);
    const [splitRecords, setSplitRecords] = useState<Array<{
      id: string;
      reason: 'good' | 'damage' | 'missing' | 'defective';
      quantity: number | string;
      location: string;
    }>>([
      { id: '1', reason: 'good', quantity: '', location: '' },
      { id: '2', reason: 'damage', quantity: '', location: '' },
    ]);
    
    // State for Putaway Confirmation Modal
    const [showPutawayConfirmation, setShowPutawayConfirmation] = useState(false);
    const [putawayConfirmationData, setPutawayConfirmationData] = useState<any>(null);
    
    // Dispatch form state
    const [dispatchForm, setDispatchForm] = useState({
      driver_name: '',
      driver_phone: '',
      vehicle_plate_no: '',
      trucking_company: '',
      route: '',
      remarks: ''
    });
    
    // Dispatch modal state
    const [showDispatchModal, setShowDispatchModal] = useState(false);
    const [dispatchHeaderId, setDispatchHeaderId] = useState<number | null>(null);
    
    // Issuance Gatepass print preview state
    const [showGatepassModal, setShowGatepassModal] = useState(false);
    const [gatepassHeaderId, setGatepassHeaderId] = useState<number | null>(null);
    const [gatepassData, setGatepassData] = useState<any>(null);
    const [gatepassSoInventory, setGatepassSoInventory] = useState<any>(null);
    const [gatepassLoading, setGatepassLoading] = useState(false);
    
    // Loading Checklist modal state
    const [showLoadingChecklistModal, setShowLoadingChecklistModal] = useState(false);
    const [loadingChecklistHeaderId, setLoadingChecklistHeaderId] = useState<number | null>(null);
    const [loadingChecklistData, setLoadingChecklistData] = useState<any[]>([]);
    const [verifiedChecklistItems, setVerifiedChecklistItems] = useState<any[]>([]); // Persist verified items for gatepass modal
    const [itemQuantities, setItemQuantities] = useState<Map<string, {good: number, damaged: number}>>(new Map()); // Track good/damaged split per item
    const [damageLocations, setDamageLocations] = useState<Map<string, number>>(new Map()); // Track selected damage location for each item row
    const [damagedItemsNote, setDamagedItemsNote] = useState(''); // Note for damaged items
    const [checklistVerified, setChecklistVerified] = useState(false); // Track if checklist has been verified
    const [itemsByCode, setItemsByCode] = useState<{ [key: string]: any }>({}); // Store item config data for gatepass
    
    // State for Damage Modal
    const [showDamageModal, setShowDamageModal] = useState(false); // Show/hide damage modal
    const [damageModalItem, setDamageModalItem] = useState<any>(null); // Item being edited
    const [damageModalItemKey, setDamageModalItemKey] = useState<string>(''); // Key to lookup in itemQuantities
    const [damageModalQty, setDamageModalQty] = useState<number>(0); // Temporary damage qty
    const [damageModalLocation, setDamageModalLocation] = useState<number | null>(null); // Selected location
    const [damageModalNotes, setDamageModalNotes] = useState(''); // Item-specific damage notes
    
    // State for Receiving Confirmation modal
    const [showReceivingConfirmation, setShowReceivingConfirmation] = useState(false);
    const [receivingConfirmationHeaderId, setReceivingConfirmationHeaderId] = useState<number | null>(null);
    
    // State for Pallet Tag modal
    const [showPalletTag, setShowPalletTag] = useState(false);
    const [palletTagHeaderId, setPalletTagHeaderId] = useState<number | null>(null);
    
    // State for tracking putaway status by line ID
    const [putawayCompletedLines, setPutawayCompletedLines] = useState<Set<number>>(new Set());
    
    // State for location options (from API)
    const [locationOptions, setLocationOptions] = useState<any[]>([]);
    
    // State for Entry Confirmation Modal
    const [showEntryConfirmation, setShowEntryConfirmation] = useState(false);
    const [isConfirmed, setIsConfirmed] = useState(false);
    
    // State for tracking last clicked status cell (for 2nd click to open dropdown)
    const [lastClickedStatusCell, setLastClickedStatusCell] = useState<{ rowIndex: number | null; colKey: string | null }>({ rowIndex: null, colKey: null });
  // Customer and item lists for dropdowns
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [customerSearchInput, setCustomerSearchInput] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const customerInputRef = useRef<HTMLInputElement>(null);
  
  // State for SO lines search
  const [searchSOLineInput, setSearchSOLineInput] = useState('');

  // Filter customers based on search input
  const filteredCustomers = useMemo(() => {
    if (!customerSearchInput.trim()) return customers;
    const search = customerSearchInput.toLowerCase();
    return customers.filter(c =>
      (c.customer_code && c.customer_code.toLowerCase().includes(search)) ||
      (c.customer_name && c.customer_name.toLowerCase().includes(search))
    );
  }, [customers, customerSearchInput]);

  useEffect(() => {
    getCustomers().then(setCustomers);
    getItems().then((itemsData: any[]) => {
      console.log('📦 Items loaded from API - Full response:', JSON.stringify(itemsData.slice(0, 1), null, 2)); // Log first item in detail
      console.log('📦 Items batch_tracking values:', itemsData.slice(0, 15).map((i: any) => ({ id: i.id, item_code: i.item_code, batch_tracking: i.batch_tracking })));
      setItems(itemsData);
    });
    
    // Clear SO lines search when switching SO headers
    setSearchSOLineInput('');
    
    // Fetch location options from API
    const fetchLocations = async () => {
      try {
        // Fetch locations using the cached config API
        const locations = await getLocations();
        
        // Map locations table fields to dropdown display
        // Build display name from location_code and bin info
        const normalizedLocations = locations.map((loc: any) => ({
          id: loc.id,
          name: loc.location_code ? `${loc.location_code} (${loc.bin || 'Bin'})` : loc.location_name || `Bin-${loc.id}`,
          location_code: loc.location_code,
          bin: loc.bin,
        }));
        
        console.log('✅ Locations loaded:', normalizedLocations);
        setLocationOptions(normalizedLocations);
      } catch (err) {
        // Fallback to hardcoded options if fetch fails
        console.error('Error fetching locations:', err);
        setLocationOptions([
          { id: 1, name: 'A1' },
          { id: 2, name: 'B1' },
          { id: 3, name: 'C1' },
        ]);
      }
    };
    
    fetchLocations();
  }, []);

  // Fetch gatepass data when gatepassHeaderId changes
  useEffect(() => {
    if (!gatepassHeaderId) {
      setGatepassData(null);
      setGatepassSoInventory(null);
      return;
    }
    
    const fetchGatepassData = async () => {
      try {
        const response = await fetch(`/api/gatepass?so_header_id=${gatepassHeaderId}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && Array.isArray(result.data) && result.data.length > 0) {
            const gatepass = result.data[0];
            setGatepassData(gatepass);
            
            // If gatepass has so_inventory_id, fetch the so_inventory record
            if (gatepass.so_inventory_id) {
              try {
                const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
                const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';
                const soInventoryRes = await fetch(
                  `${urlSOInventory}?id=eq.${gatepass.so_inventory_id}`,
                  { method: 'GET', headers: { 'X-Api-Key': apiKey } }
                );
                if (soInventoryRes.ok) {
                  const soInventoryData = await soInventoryRes.json();
                  if (Array.isArray(soInventoryData) && soInventoryData.length > 0) {
                    setGatepassSoInventory(soInventoryData[0]);
                    console.log('✅ Fetched so_inventory for gatepass:', soInventoryData[0].quantity_ordered);
                  }
                }
              } catch (err) {
                console.warn('Could not fetch so_inventory details for gatepass:', err);
              }
            }
          }
        }
      } catch (err) {
        console.log('Gatepass data not yet available');
      }
    };
    
    fetchGatepassData();
  }, [gatepassHeaderId]);

  // Fetch loading checklist data when loading checklist header ID changes
  useEffect(() => {
    if (!loadingChecklistHeaderId) {
      setLoadingChecklistData([]);
      return;
    }
    
    const fetchLoadingChecklistData = async () => {
      try {
        const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
        
        // Step 1: Find the selected SO header
        const selectedHeader = headerRecords.find(h => h.id === loadingChecklistHeaderId);
        if (!selectedHeader) {
          console.log('SO header not found');
          setLoadingChecklistData([]);
          return;
        }
        
        // Step 2: Get SO lines for this header
        const soLinesRes = await fetch(
          `/api/so-lines-with-inventory?so_header_id=${loadingChecklistHeaderId}`,
          { method: 'GET' }
        );
        
        if (!soLinesRes.ok) {
          console.log('Could not fetch SO lines');
          setLoadingChecklistData([]);
          return;
        }
        
        const soLinesData = await soLinesRes.json();
        const soLines = Array.isArray(soLinesData) ? soLinesData : (soLinesData?.lines || soLinesData?.data || []);
        console.log('📋 SO Lines fetched:', { soLinesData, count: soLines.length });
        
        if (soLines.length === 0) {
          console.log('No SO lines found for this header');
          setLoadingChecklistData([]);
          return;
        }
        
        // Step 3: Get SO inventory (allocated/picked items) for these lines
        const soLineIds = soLines.map((line: any) => line.id).join(',');
        const soInventoryRes = await fetch(
          `/api/so-inventory?so_line_id=${soLineIds}&status=picked`,
          { method: 'GET' }
        );
        
        let soInventory = [];
        if (soInventoryRes.ok) {
          const soInventoryData = await soInventoryRes.json();
          soInventory = Array.isArray(soInventoryData) ? soInventoryData : (soInventoryData?.data || soInventoryData?.inventory || []);
          console.log('📦 SO Inventory fetched with status=picked:', soInventory.length, 'items');
        } else {
          console.log('⚠️  Could not fetch SO inventory with status=picked, trying without status filter');
          // Fallback: try fetching without status filter
          const fallbackRes = await fetch(
            `/api/so-inventory?so_line_id=${soLineIds}`,
            { method: 'GET' }
          );
          if (fallbackRes.ok) {
            const soInventoryData = await fallbackRes.json();
            soInventory = Array.isArray(soInventoryData) ? soInventoryData : (soInventoryData?.data || soInventoryData?.inventory || []);
            console.log('📦 SO Inventory fetched without status filter:', soInventory.length, 'items');
          }
        }
        
        // Step 3b: If still no inventory, fall back to SO lines data
        if (soInventory.length === 0) {
          console.log('⚠️  No SO inventory found, using SO lines as fallback');
          soInventory = soLines.map((line: any) => ({
            id: line.id,
            so_line_id: line.id,
            item_code: line.item_code,
            item_name: line.item_name,
            item_id: line.item_id,
            batch_number: line.batch_number,
            manufacturing_date: line.manufacturing_date,
            expiry_date: line.expiry_date,
            pallet_id: line.pallet_id,
            weight_uom_kg: line.weight_uom_kg,
            uom: line.uom,
            quantity_allocated: line.orderedQuantity || line.quantity_allocated || 0,
            quantity_picked: line.orderedQuantity || line.quantity_picked || 0,
            status: 'picked'
          }));
        }
        
        // Step 4: Fetch config/items to get product names
        let itemsByCodeMap: { [key: string]: any } = {};
        try {
          const configRes = await fetch('/api/config-records');
          if (configRes.ok) {
            const configData = await configRes.json();
            const configItems = configData.items || [];
            configItems.forEach((item: any) => {
              itemsByCodeMap[item.item_code || item.code] = item;
            });
            console.log('📦 Loaded', Object.keys(itemsByCodeMap).length, 'items from config');
            setItemsByCode(itemsByCodeMap); // Update state for use in gatepass modal
          }
        } catch (err) {
          console.log('Could not fetch config items:', err);
        }
        
        // Step 5: Map SO inventory to loading checklist format
        // Enrich with item names from SO lines - TRY MULTIPLE SOURCES
        if (soInventory.length === 0) {
          console.log('⚠️  No inventory items to display');
          setLoadingChecklistData([]);
          return;
        }
        
        const checklistItems = soInventory.map((item: any, idx: number) => {
          // Find matching SO line to get item_name if not in inventory
          const matchingLine = soLines.find((line: any) => line.id === item.so_line_id || line.id === item.id);
          
          // Get item name from multiple sources in priority order
          let itemName = item.item_name;
          if (!itemName && matchingLine) {
            itemName = matchingLine.item_name || matchingLine.description || matchingLine.item_description;
          }
          // Try config items table
          if (!itemName && item.item_code && itemsByCodeMap[item.item_code]) {
            itemName = itemsByCodeMap[item.item_code].item_name || itemsByCodeMap[item.item_code].name;
          }
          // Fallback
          if (!itemName) {
            itemName = item.description || `Item ${item.item_id || item.item_code}`;
          }
          
          console.log(`📋 Loading checklist item [${idx}] ${item.item_code}:`, {
            from_inventory: item.item_name,
            from_line: matchingLine?.item_name,
            from_config: itemsByCodeMap[item.item_code]?.item_name,
            final: itemName,
            qty: item.quantity_picked || item.quantity_allocated || item.orderedQuantity || 0
          });
          
          return {
            id: item.id,
            item_code: item.item_code,
            item_name: itemName,
            item_id: item.item_id,
            batch_number: item.batch_number,
            manufacturing_date: item.manufacturing_date,
            expiry_date: item.expiry_date,
            pallet_id: item.pallet_id,
            weight_uom_kg: item.weight_uom_kg,
            uom: item.uom,
            ordered_qty: item.quantity_allocated || item.quantity_picked || item.orderedQuantity || 0,
            packed_qty: item.quantity_picked || item.quantity_allocated || item.orderedQuantity || 0,
            checked_qty: item.quantity_picked || item.quantity_allocated || item.orderedQuantity || 0,
            damaged_qty: 0,
            status: item.status || 'picked',
            so_line_id: item.so_line_id || item.id,
            // ✅ Add traceability fields from inventory
            asn_number: item.asn_number || null,
            date_received: item.date_received || null,
            vendor_code: item.vendor_code || null,
            vendor_name: item.vendor_name || null,
          };
        });
        
        console.log('✅ Loaded', checklistItems.length, 'items for loading checklist');
        setLoadingChecklistData(checklistItems);
        
        // Step 6: Check if loading checklist is already verified in database
        // First fetch the gatepass for this SO to get gatepass_id
        try {
          const gpRes = await fetch(`/api/gatepass?so_header_id=${loadingChecklistHeaderId}`, { method: 'GET' });
          if (gpRes.ok) {
            const gpResult = await gpRes.json();
            // Handle API response format: { success: true, data: [...] }
            const gatepassArray = Array.isArray(gpResult) ? gpResult : (gpResult?.data || []);
            const gatepassData = Array.isArray(gatepassArray) && gatepassArray.length > 0 ? gatepassArray[0] : null;
            
            if (gatepassData && gatepassData.id) {
              const gatepassId = gatepassData.id;  // Use 'id' not 'gatepass_id'
              console.log('✅ Found existing gatepass:', gatepassId, gatepassData);
              
              // Now fetch loading_checklist records by gatepass_id
              try {
                const lcRes = await fetch(`/api/config-records?table=loading_checklist&gatepass_id=${gatepassId}`);
                if (lcRes.ok) {
                  const lcData = await lcRes.json();
                  const loadingChecklistRecords = Array.isArray(lcData) ? lcData : (lcData?.data || []);
                  const isVerified = loadingChecklistRecords.length > 0 && loadingChecklistRecords.some((lc: any) => lc.status === 'verified');
                  
                  if (isVerified) {
                    console.log('📋 Loading checklist is already verified - locking interface');
                    console.log('✅ Verified records:', loadingChecklistRecords);
                    setChecklistVerified(true);
                    
                    // ✅ CRITICAL: Update loadingChecklistData with verified data from database
                    // Include ALL items (good + damaged) since display splits them by itemQuantities map
                    const verifiedItems = loadingChecklistRecords.map((lc: any) => {
                      const item = {
                        id: lc.id,
                        item_code: lc.item_code,
                        item_name: lc.item_name,
                        item_id: lc.item_id,
                        batch_number: lc.batch_number,
                        manufacturing_date: lc.manufacturing_date,
                        expiry_date: lc.expiry_date,
                        pallet_id: lc.pallet_id,
                        weight_uom_kg: lc.weight_uom_kg,
                        uom: lc.uom,
                        ordered_qty: lc.ordered_qty,
                        packed_qty: lc.packed_qty,
                        checked_qty: lc.checked_qty,
                        damaged_qty: lc.damaged_qty || 0,
                        status: lc.status,
                        so_line_id: lc.so_line_id,
                        asn_number: lc.asn_number || null,
                        date_received: lc.date_received || null,
                        vendor_code: lc.vendor_code || null,
                        vendor_name: lc.vendor_name || null
                      };
                      console.log(`📋 Verified item ${lc.item_code}:`, {
                        ordered_qty: lc.ordered_qty,
                        packed_qty: lc.packed_qty,
                        checked_qty: lc.checked_qty,
                        damaged_qty: lc.damaged_qty || 0,
                        will_display: `${lc.checked_qty || 0} good + ${lc.damaged_qty || 0} damaged`
                      });
                      return item;
                    });
                    // ✅ Update BOTH states with verified data
                    setLoadingChecklistData(verifiedItems); // This is what the display renders from!
                    setVerifiedChecklistItems(verifiedItems.filter((lc: any) => (lc.checked_qty || 0) > 0)); // Good items only
                    
                    // ✅ Pre-populate itemQuantities map with verified quantities from database
                    const quantitiesMap = new Map();
                    verifiedItems.forEach((lc: any, idx: number) => {
                      const itemKey = `${lc.item_code}-${lc.batch_number}-${idx}`;
                      quantitiesMap.set(itemKey, {
                        good: lc.checked_qty || 0,
                        damaged: lc.damaged_qty || 0
                      });
                    });
                    setItemQuantities(quantitiesMap);
                    
                    // ✅ Pre-populate damageLocations map (if damage location was saved somewhere)
                    // Note: Currently damage location is NOT persisted to database, so map this from inventory if needed
                    
                    console.log('✅ Restored verified items:', verifiedItems);
                    console.log('✅ Populated itemQuantities map with', quantitiesMap.size, 'entries');
                  }
                }
              } catch (err) {
                console.log('Could not fetch loading checklist records:', err);
              }
            }
          }
        } catch (err) {
          console.log('Could not fetch gatepass:', err);
        }
        
        console.log('✅ Loading checklist items loaded from SO:', checklistItems.length, 'items', checklistItems);
      } catch (err) {
        console.log('Loading checklist data error:', err);
        setLoadingChecklistData([]);
      }
    };
    
    fetchLoadingChecklistData();
  }, [loadingChecklistHeaderId]);

  // Fetch gatepass data when modal opens
  useEffect(() => {
    if (!showGatepassModal || !gatepassHeaderId) {
      return;
    }

    const fetchGatepassData = async () => {
      setGatepassLoading(true);
      try {
        console.log('🔍 Fetching gatepass for SO header:', gatepassHeaderId);
        
        // Fetch gatepass record for this SO
        const gatepassRes = await fetch(`/api/gatepass?so_header_id=${gatepassHeaderId}`, {
          method: 'GET',
        });
        
        console.log('📡 Gatepass fetch response status:', gatepassRes.status);
        
        if (gatepassRes.ok) {
          const result = await gatepassRes.json();
          console.log('✅ Gatepass API response:', result);
          
          if (result.success && Array.isArray(result.data) && result.data.length > 0) {
            const gatepass = result.data[0];
            setGatepassData(gatepass);
            console.log('✅ Loaded gatepass data:', {
              gatepass_id: gatepass.id,
              gatepass_number: gatepass.gatepass_number,
              driver_name: gatepass.driver_name,
              vehicle_plate_no: gatepass.vehicle_plate_no,
              trucking_company: gatepass.trucking_company,
              route: gatepass.route
            });
          } else {
            console.log('⚠️ No gatepass found. Response:', result);
            setGatepassData(null);
          }
        } else {
          const errorText = await gatepassRes.text();
          console.error('❌ Gatepass fetch failed:', { status: gatepassRes.status, error: errorText });
          setGatepassData(null);
        }
      } catch (err) {
        console.error('❌ Error fetching gatepass:', err);
        setGatepassData(null);
      } finally {
        setGatepassLoading(false);
      }
    };

    fetchGatepassData();
  }, [showGatepassModal, gatepassHeaderId]);

  // State for Batch Allocation Modal
  const [showAllocationModal, setShowAllocationModal] = useState(false);
  const [allocationHeaderId, setAllocationHeaderId] = useState<number | null>(null);
  const [allocationStrategy, setAllocationStrategy] = useState<AllocationStrategy>('FEFO');
  const [allocationMethod, setAllocationMethod] = useState<'BATCH' | 'FEFO' | 'FIFO'>('BATCH'); // Kept for compatibility but no longer used
  const [allocationResults, setAllocationResults] = useState<any[]>([]);
  const [rawAllocationResults, setRawAllocationResults] = useState<any[]>([]); // Keep raw allocation data for saving
  const [allocationStatus, setAllocationStatus] = useState<string | null>(null);
  const [allocationLoading, setAllocationLoading] = useState(false);
  const [currentBatches, setCurrentBatches] = useState<any[]>([]);
  const [selectedBatchesForAllocation, setSelectedBatchesForAllocation] = useState<Set<number>>(new Set());
  const [allocationPreviewMode, setAllocationPreviewMode] = useState(false);
  const [allocationMode, setAllocationMode] = useState<'auto' | 'manual'>('auto'); // Auto or manual batch selection
  const [batchFilterInput, setBatchFilterInput] = useState(''); // Input for manual batch selection autocomplete
  const [showBatchDropdown, setShowBatchDropdown] = useState(false); // Toggle batch autocomplete dropdown

  // State for Picking Modal
  const [showPickingModal, setShowPickingModal] = useState(false);
  const [pickingHeaderId, setPickingHeaderId] = useState<number | null>(null);
  const [pickingBatches, setPickingBatches] = useState<any[]>([]);
  const [pickedBatchIds, setPickedBatchIds] = useState<Set<number>>(new Set());
  const [pickingStatus, setPickingStatus] = useState<string | null>(null);
  const [pickingLoading, setPickingLoading] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string | null>(null);

  // State for Shipment Modal
  const [showShipmentModal, setShowShipmentModal] = useState(false);
  const [shipmentHeaderId, setShipmentHeaderId] = useState<number | null>(null);
  const [shipmentItems, setShipmentItems] = useState<any[]>([]);
  const [shippedItemIds, setShippedItemIds] = useState<Set<string>>(new Set());
  const [shipmentStatus, setShipmentStatus] = useState<string | null>(null);
  const [shipmentLoading, setShipmentLoading] = useState(false);

  // Fetch batches from ASN inventory when opening allocation
  const handleOpenShipmentModal = async (headerId: number) => {
    console.log('🚚 [handleOpenShipmentModal] Opening shipment modal for header:', headerId);
    setShipmentHeaderId(headerId);
    setShipmentStatus(null);
    setShipmentLoading(true);
    setShippedItemIds(new Set());
    setShowShipmentModal(true);  // Show modal immediately

    try {
      // Get SO line IDs for this header
      const soLinesForShipment = lineRecords.filter(l => l.so_header_id === headerId);
      const soLineIds = soLinesForShipment.map(l => l.id);
      
      console.log(`🚚 [handleOpenShipmentModal] Header ${headerId} has ${soLineIds.length} SO lines for shipment`);
      console.log(`🚚 [handleOpenShipmentModal] SO line IDs:`, soLineIds);
      console.log(`🚚 [handleOpenShipmentModal] Total lineRecords available:`, lineRecords.length);

      if (soLineIds.length === 0) {
        setShipmentStatus('⚠️ No items to ship.');
        setShipmentLoading(false);
        return;
      }

      const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';
      
      // Fetch picked items from so_inventory - Get all records for these SO lines (don't filter by status yet)
      const response = await fetch(`/api/so-inventory?so_line_id=${soLineIds.join(',')}`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch shipment items: ${response.status}`);
      }

      const allItems = await response.json();
      console.log('📦 [handleOpenShipmentModal] ALL SO inventory records:', allItems);
      console.log('📦 [handleOpenShipmentModal] Item count:', allItems?.length || 0);
      
      if (!Array.isArray(allItems) || allItems.length === 0) {
        console.warn('⚠️ No SO inventory records found for these SO lines');
        setShipmentStatus('⚠️ No allocated items found. Allocation may not have been completed.');
        setShipmentLoading(false);
        return;
      }

      // Show all items - user will select which ones to ship
      setShipmentItems(allItems);
    } catch (err: any) {
      console.error('❌ [handleOpenShipmentModal] Error:', err);
      setShipmentStatus(`❌ Error: ${err.message}`);
    } finally {
      setShipmentLoading(false);
    }
  };

  // Confirm shipment
  const handleConfirmShipment = async () => {
    setShipmentLoading(true);
    setShipmentStatus(null);

    try {
      if (!shipmentHeaderId) {
        setShipmentStatus('No SO header selected');
        return;
      }

      // Check that all items are marked as shipped
      if (shippedItemIds.size === 0) {
        setShipmentStatus('❌ Please select items to ship');
        setShipmentLoading(false);
        return;
      }

      if (shippedItemIds.size !== shipmentItems.length) {
        setShipmentStatus('❌ All items must be shipped');
        setShipmentLoading(false);
        return;
      }

      // Update so_inventory records - set quantity_shipped and status
      const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';
      const updatePromises: Promise<Response>[] = [];

      for (const item of shipmentItems) {
        if (shippedItemIds.has(item.id)) {
          // Deduct from on_hand quantity when shipping
          const on_hand_deducted = Math.max(0, (item.on_hand || 0) - (item.quantity_allocated || 0));
          
          const updatePayload = {
            status: 'shipped',
            quantity_shipped: item.quantity_allocated,
            quantity_allocated: 0,  // Not allocatable anymore
            on_hand: on_hand_deducted  // CRITICAL: Deduct from on_hand quantity
          };

          console.log(`📦 Marking item ${item.id} as shipped:`, updatePayload);

          const patchPromise = fetch('/api/patch-record', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              table: 'so_inventory',
              id: item.id,
              data: updatePayload,
            })
          });

          updatePromises.push(patchPromise);
        }
      }

      // Wait for all updates
      const results = await Promise.all(updatePromises);
      const allSuccess = results.every(r => r.ok);

      if (allSuccess) {
        console.log('✅ All shipment records updated');
        
        // ⚠️ CRITICAL: Deduct from main inventory table (on_hand_quantity)
        try {
          const headerRecord = headerRecords.find(h => h.id === shipmentHeaderId);
          const soLinesForShipment = lineRecords.filter(l => l.so_header_id === shipmentHeaderId);
          
          if (headerRecord && soLinesForShipment.length > 0) {
            // Fetch latest inventory via API route
            const inventoryRes = await fetch(`/api/inventory-records?refresh=true`, {
              method: 'GET',
              headers: { 'X-Api-Key': apiKey }
            });
            const inventoryResponseData = await inventoryRes.json();
            const currentInventory = Array.isArray(inventoryResponseData.inventory) ? inventoryResponseData.inventory : [];

            // Deduct inventory from main inventory table
            const shipmentResult = await deductInventoryOnShipped({
              soHeader: headerRecord,
              soLines: soLinesForShipment,
              items,
              inventory: currentInventory,
              apiKey,
              urlShipmentTransactions: process.env.NEXT_PUBLIC_URL_SHIPMENT_TRANSACTIONS,
              urlSOHeaders: urlHeaders
            });

            if (!shipmentResult.success) {
              console.warn('⚠️ Inventory deduction had errors:', shipmentResult.errors);
            }
          }
        } catch (err: any) {
          console.error('⚠️ Error deducting inventory during shipment:', err.message);
        }
        
        // Update SO header status to Shipped
        await fetch('/api/patch-record', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            table: 'so_headers',
            id: shipmentHeaderId,
            data: { status: 'Shipped' },
          })
        }).catch(err => console.warn('⚠️ Could not update SO header status:', err.message));

        setShipmentStatus(`✅ Shipment confirmed! ${shipmentItems.length} items shipped successfully - Inventory deducted from On Hand`);
        
        // Dispatch event to notify inventory page to refresh
        if (typeof window !== 'undefined') {
          console.log('📡 Dispatching: inventoryUpdated event');
          window.dispatchEvent(new Event('inventoryUpdated'));
        }
        
        // Clear caches since status and inventory changed
        const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
        await Promise.all([
          // Clear outbound records cache
          fetch('/api/outbound-records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year, action: 'clear' }),
          }).catch(err => console.log('Note: Outbound cache clear request sent')),
          // Clear inventory cache since shipped quantities changed
          fetch(`/api/inventory-records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year, action: 'clear' }),
          }).catch(err => console.log('Note: Inventory cache clear request sent'))
        ]);
        
        // Update local state
        setHeaderRecords(prev => prev.map(h =>
          h.id === shipmentHeaderId ? { ...h, status: 'Shipped' } : h
        ));

        // Refresh SO lines with updated shipped quantities
        try {
          const lineRefreshRes = await fetch(`/api/outbound-records?year=${year}${searchParams?.get('warehouse') ? `&warehouse=${searchParams.get('warehouse')}` : ''}&refresh=true`);
          if (lineRefreshRes.ok) {
            const freshData = await lineRefreshRes.json();
            const freshLines = freshData.lines || [];
            // Enrich lines with item details
            const enrichedLines = freshLines.map((line: any) => {
              const item = items.find(i => i.id === line.item_id);
              return {
                ...line,
                item_code: item?.item_code || line.item_code || '-',
                item_name: item?.item_name || line.item_name || '-',
                batch_tracking: item?.batch_tracking || false
              };
            });
            setLineRecords(enrichedLines);
            console.log('✅ Refreshed SO lines with shipped quantities');
          }
        } catch (err) {
          console.error('⚠️ Could not refresh line records:', err);
        }

        // Close modal after 2 seconds
        setTimeout(() => {
          setShowShipmentModal(false);
          if (headerGridRef.current?.api) {
            headerGridRef.current.api.refreshCells();
            // Ensure row stays selected by selecting it again
            const node = headerGridRef.current.api.getRowNode(String(shipmentHeaderId));
            if (node) {
              node.setSelected(true);
            }
          }
        }, 2000);
      } else {
        setShipmentStatus('❌ Failed to update some shipment records');
      }
    } catch (err: any) {
      setShipmentStatus(`❌ Error: ${err.message}`);
    } finally {
      setShipmentLoading(false);
    }
  };
  const handleOpenAllocation = async (headerId: number) => {
    // Reset allocation state completely
    setAllocationHeaderId(headerId);
    setAllocationStatus(null);
    setAllocationLoading(true);
    setAllocationResults([]); // Clear previous results
    setAllocationPreviewMode(false); // Reset preview mode
    setRawAllocationResults([]);
    setAllocationMethod('BATCH'); // Reset to default
    setAllocationMode('auto'); // Reset to auto mode
    setBatchFilterInput('');
    setSelectedBatchesForAllocation(new Set());
    setShowAllocationModal(true); // Show modal immediately while loading

    try {
      // Get warehouse ID from the selected header
      const warehouseId = headerRecords.find(h => h.id === headerId)?.warehouse_id || 1;
      
      // Fetch from cached API endpoint that includes ASN inventory batches
      const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
      const apiRes = await fetch(`/api/inbound-records?year=${year}`);

      if (!apiRes.ok) {
        throw new Error(`Failed to fetch batches: ${apiRes.status}`);
      }

      const data = await apiRes.json();
      const batches = data.asnInventory || [];
      console.log('📦 [ALLOCATION MODAL] Fetched ASN batches from cache:', batches);
      console.log('📦 First batch structure:', batches[0]);
      console.log('📦 Batch fields available:', Object.keys(batches[0] || {}));
      
      // Fetch inventory records to get the ACTUAL putaway locations (not receiving location)
      // CRITICAL: Use refresh=true to bypass cache and get fresh location_code data
      console.log('🔍 Fetching INVENTORY records to get actual putaway locations...');
      const invRes = await fetch(`/api/inventory-records?year=${new Date().getFullYear()}${warehouseId ? `&warehouse=${warehouseId}` : ''}&refresh=true`, {
        method: 'GET',
      });
      
      // Create a map of batch to inventory locations (pallet_id -> inventory record with actual location)
      const inventoryByPallet = new Map<string, any>();
      if (invRes.ok) {
        try {
          const invData = await invRes.json();
          const invRecords = invData.inventory || [];
          console.log('📊 Inventory records fetched:', invRecords.length);
          invRecords.forEach((inv: any) => {
            if (inv.pallet_id) {
              inventoryByPallet.set(inv.pallet_id, inv);
              console.log(`📍 Pallet ${inv.pallet_id}: actual location=${inv.location_id}`);
            }
          });
        } catch (err) {
          console.warn('⚠️ Could not fetch inventory records, using ASN locations');
        }
      }
      
      // Fetch already allocated quantities from so_inventory to reduce available qty
      console.log('🔍 Fetching allocated quantities to calculate true available...');
      const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';
      const allocRes = await fetch(`/api/so-inventory?select=batch_number,location_id,quantity_allocated,quantity_shipped,status`, {
        method: 'GET',
      });

      let allocatedByBatchLocation: { [key: string]: number } = {};
      let shippedByBatchLocation: { [key: string]: number } = {};
      if (allocRes.ok) {
        try {
          const allocData = await allocRes.json();
          console.log('📊 Raw SO inventory allocations (all records):', allocData);
          if (Array.isArray(allocData)) {
            // Group and sum by batch_number + location_id to handle same batch in different locations
            allocData.forEach((item: any) => {
              if (item.batch_number && item.location_id) {
                const key = `${item.batch_number}|${item.location_id}`;
                // Count allocated (both allocated and picked statuses)
                if (['allocated', 'picked'].includes(item.status)) {
                  allocatedByBatchLocation[key] = (allocatedByBatchLocation[key] || 0) + (item.quantity_allocated || 0);
                }
                // Count shipped separately
                if (item.status === 'shipped') {
                  shippedByBatchLocation[key] = (shippedByBatchLocation[key] || 0) + (item.quantity_shipped || 0);
                }
              }
            });
            console.log('📊 Aggregated allocated quantities by batch+location:', allocatedByBatchLocation);
            console.log('📊 Aggregated shipped quantities by batch+location:', shippedByBatchLocation);
          }
        } catch (err) {
          console.warn('⚠️ Could not parse allocated quantities, proceeding without deduction');
        }
      }

      // Map batches with available quantity for allocation
      // Available quantity = on_hand_quantity (which already accounts for putaway) - allocated - shipped
      console.log('🔍 Starting batch mapping with', batches.length, 'batches');
      
      const allProcessedBatches = batches.map((batch: any) => {
        const batchNum = batch.batch_number;
        // Use INVENTORY location if available (actual putaway location), fallback to ASN location
        const inventoryRec = inventoryByPallet.get(batch.pallet_id);
        const actualLocationId = inventoryRec?.location_id || batch.location_id;
        
        // ✅ CRITICAL: Lookup location_code from locations table using actualLocationId
        // Try multiple sources in order of preference:
        // 1. From inventory record directly (PRIORITY - always has accurate data)
        // 2. From batch record directly
        // 3. From locationOptions (fetched from API)
        // 4. Fallback to location ID
        let locationCode = '';
        
        // PRIORITY: Check inventory record first (most reliable source)
        if (inventoryRec?.location_code) {
          locationCode = inventoryRec.location_code;
          console.log(`✅ Location code from inventory record: ${actualLocationId} => ${locationCode}`);
        } else if (batch.location_code) {
          locationCode = batch.location_code;
          console.log(`✅ Location code from batch: ${actualLocationId} => ${locationCode}`);
        } else {
          // Try to find in locationOptions (loaded from API) as fallback
          const locationRec = locationOptions.find((l: any) => l.id === actualLocationId);
          if (locationRec?.location_code) {
            locationCode = locationRec.location_code;
            console.log(`✅ Location code from locationOptions: ${actualLocationId} => ${locationCode}`);
          } else {
            locationCode = `LOC-${actualLocationId}`;
            console.warn(`⚠️ Location code not found for ID ${actualLocationId}, using fallback: ${locationCode}`);
            console.log(`   inventoryRec.location_code=${inventoryRec?.location_code}, batch.location_code=${batch.location_code}, locationOptions.length=${locationOptions.length}`);
          }
        }
        
        // Calculate allocated quantity from:
        // 1. The aggregated allocatedByBatchLocation (SO inventory allocations) - PRIORITY
        // 2. The inventory_record.allocated_quantity (fallback)
        const batchLocationKey = `${batch.batch_number}|${actualLocationId}`;
        const allocatedFromSO = allocatedByBatchLocation[batchLocationKey] || 0;
        const allocatedFromInventory = inventoryRec ? Number(inventoryRec.allocated_quantity) || 0 : 0;
        const allocatedQty = Math.max(allocatedFromSO, allocatedFromInventory); // Take the higher to be safe
        
        // Get shipped quantity from the aggregated map
        const shippedQty = shippedByBatchLocation[batchLocationKey] || 0;
        
        // Use on_hand_quantity from inventory if available (pre-calculated)
        // Otherwise fallback to batch's quantity_received
        const onHandQty = inventoryRec ? Number(inventoryRec.on_hand_quantity) || 0 : (Number(batch.on_hand_quantity) || Number(batch.quantity_received) || 0);
        
        // Available = On Hand - Allocated - Shipped (the true available quantity from database)
        const availableQty = Math.max(0, onHandQty - allocatedQty - shippedQty);
        
        // Get inventory status (only putaway items are available for allocation)
        const inventoryStatus = inventoryRec?.inventory_status || 'received';
        
        // ✅ CRITICAL: Enrich batch with item_code to prevent hallucination
        // This ensures batch item matches the correct SO item
        const itemMaster = items.find(i => i.id === batch.item_id);
        const itemCode = itemMaster?.item_code || batch.item_code || inventoryRec?.item_code || `ITEM-${batch.item_id}`;
        
        console.log(`📦 ${batchNum} @ Location ${batch.location_id} (actual: ${actualLocationId}, code: ${locationCode}): Item=${itemCode}, Status=${inventoryStatus}, OnHand=${onHandQty}, Allocated=${allocatedQty}, Available=${availableQty}`);
        return {
          ...batch,
          item_code: itemCode, // ✅ ADDED: Ensure item_code is populated for allocation validation
          location_id: actualLocationId, // ← USE ACTUAL PUTAWAY LOCATION
          location_code: locationCode, // ✅ ADDED: Location code (A-1-5-1 format) from locations table
          inventory_status: inventoryStatus, // ← Track inventory status
          on_hand_quantity: onHandQty, // ← Actual on-hand from database
          allocated_quantity: allocatedQty, // ← Actual allocated from database + SO inventory
          available_quantity: availableQty, // ← True available (on_hand - allocated - shipped)
          // Add tracking info for inventory movement
          movement_status: availableQty > 0 ? 'available' : 'depleted',
          movement_timestamp: new Date().toISOString()
        };
      });
      
      console.log('📊 All processed batches (before filter):', allProcessedBatches.length);
      allProcessedBatches.forEach((b: any) => {
        const isAllocatable = b.inventory_status === 'putaway' && (b.available_quantity || (b.on_hand_quantity - b.allocated_quantity)) > 0;
        console.log(`  - ${b.batch_number} @ Loc ${b.location_id} (code: ${b.location_code}): status=${b.inventory_status}, on_hand=${b.on_hand_quantity}, allocated=${b.allocated_quantity}, available=${b.available_quantity || (b.on_hand_quantity - b.allocated_quantity)}, allocatable=${isAllocatable}`);
      });
      
      // Get list of item_ids from SO lines for this header
      const soLinesForThisHeader = lineRecords.filter((l: any) => l.so_header_id === headerId);
      const itemIdsInSO = new Set(soLinesForThisHeader.map((l: any) => l.item_id).filter(Boolean));
      console.log('📌 Item IDs in SO:', Array.from(itemIdsInSO));
      
      // Filter batches to only show items that are in the SO
      const batchesForSOItems = allProcessedBatches.filter((batch: any) => itemIdsInSO.has(batch.item_id));
      
      // ADDITIONAL VALIDATION: Also check item_code matches if available
      // This prevents hallucination where wrong item is allocated (e.g., A4 Paper instead of Coca-Cola)
      const validatedBatchesForSO = batchesForSOItems.filter((batch: any) => {
        const soLine = soLinesForThisHeader.find((l: any) => l.item_id === batch.item_id);
        if (!soLine) return false; // Item not in SO
        
        // Verify item_code matches if both have the data
        if (batch.item_code && soLine.item_code && batch.item_code !== soLine.item_code) {
          console.warn(`⚠️ ITEM CODE MISMATCH: Batch has ${batch.item_code} but SO line expects ${soLine.item_code} for item_id ${batch.item_id}`);
          return false; // REJECT - wrong item
        }
        
        return true; // ACCEPT - item matches
      });
      
      console.log('📊 Batches after validation:', validatedBatchesForSO.length, '(filtered to prevent hallucination)');
      const batchesForAllocation = validatedBatchesForSO.length > 0 ? validatedBatchesForSO : batchesForSOItems; // Fallback if strict validation too restrictive
      
      // ✅ CRITICAL FIX: ONLY allocate items with inventory_status = 'putaway'
      // Exclude all others: received, staging, allocated, defective, damaged, etc.
      const availableBatches = batchesForAllocation.filter((batch: any) => {
        const availableQty = batch.available_quantity !== undefined ? batch.available_quantity : (batch.on_hand_quantity - batch.allocated_quantity);
        
        // STRICT: Only accept items with status = 'putaway' (warehouse storage)
        const isPutaway = (batch.inventory_status || '').toLowerCase() === 'putaway';
        
        // Check if location is staging (reserved for shipment, not allocatable)
        const locationRec = locationOptions.find((l: any) => l.id === batch.location_id);
        const locationCode = locationRec?.location_code || locationRec?.code || '';
        const locationName = locationRec?.name || locationRec?.location_name || '';
        
        // CRITICAL: If location lookup failed, check location_id directly
        // Location 85 is the known staging location
        const isStagingLocation = 
          batch.location_id === 85 ||  // FALLBACK: Location 85 is staging
          locationCode.toUpperCase().includes('STAG') ||
          locationCode.toUpperCase().includes('PREP') ||
          locationName.toUpperCase().includes('STAG') ||
          locationName.toUpperCase().includes('PREP') ||
          locationName.toUpperCase().includes('STAGING');
        
        // ✅ STRICT RULES: MUST be putaway + must have available qty + must NOT be in staging
        const isAllocatable = isPutaway && availableQty > 0 && !isStagingLocation;
        
        // Debug logging for items that are filtered out
        if (!isAllocatable) {
          const reason = !isPutaway ? `status="${batch.inventory_status}"(NOT putaway)` :
                        availableQty <= 0 ? `availableQty=${availableQty}` :
                        isStagingLocation ? `isStaging=true` : 'unknown';
          console.log(`   ❌ FILTERED OUT: ${batch.item_code} (${batch.batch_number}) - ${reason}`);
        } else {
          console.log(`   ✅ INCLUDED: ${batch.item_code} (${batch.batch_number}) - Status: ${batch.inventory_status}, Available: ${availableQty}`);
        }
        
        return isAllocatable;
      });
      
      console.log('✅ Available batches (after filter):', availableBatches.length, '(filtered for SO items + available qty + not staging)');
      setCurrentBatches(availableBatches); // Set ONLY the batches that are actually allocatable
      console.log('✅ Set currentBatches to', availableBatches.length, 'allocatable batches');
      
      const totalWithAnyQty = batchesForSOItems.length;
      if (totalWithAnyQty === 0) {
        setAllocationStatus('⚠️ No inventory found. Check ASN inventory.');
      } else if (availableBatches.length === 0) {
        setAllocationStatus('⚠️ No putaway inventory available. Items may still be in received status or fully allocated.');
      } else {
        setAllocationStatus(null);
      }
    } catch (err: any) {
      console.error('Allocation error:', err);
      setAllocationStatus(`❌ ${err.message}`);
      setCurrentBatches([]);
    } finally {
      setAllocationLoading(false);
    }
  };

  // Trigger allocation processing when modal finishes loading batches
  useEffect(() => {
    if (!showAllocationModal || allocationLoading || !allocationHeaderId) return;
    if (currentBatches.length === 0) return;
    if (allocationResults.length > 0) return; // Skip if already processed
    
    // Auto-trigger allocation in AUTO mode after batches are loaded
    if (allocationMode === 'auto') {
      console.log('🔄 Batches loaded and modal ready, triggering auto-allocation');
      const timer = setTimeout(() => {
        handleProcessAllocation();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [showAllocationModal, allocationLoading, allocationHeaderId, currentBatches.length, allocationMode]);

  // Auto-preview allocation when selections change
  useEffect(() => {
    if (!showAllocationModal || !allocationHeaderId || allocationLoading) return;
    
    // Only auto-preview if:
    // 1. In auto mode, OR
    // 2. In manual mode AND at least one batch is selected
    if (allocationMode === 'auto' || (allocationMode === 'manual' && selectedBatchesForAllocation.size > 0)) {
      // Small delay to debounce rapid changes
      const timer = setTimeout(() => {
        handleProcessAllocation();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [allocationMethod, allocationMode, selectedBatchesForAllocation, showAllocationModal, allocationHeaderId, currentBatches.length]);

  // Trigger allocation processing when batches are first loaded for the modal
  useEffect(() => {
    if (!showAllocationModal || !allocationHeaderId || currentBatches.length === 0) return;
    
    // Only trigger if we have results to process (debounce to avoid duplicate calls)
    if (allocationMode === 'auto' && !allocationLoading) {
      const timer = setTimeout(() => {
        console.log('🔄 Triggering allocation preview after batch load');
        handleProcessAllocation();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showAllocationModal, currentBatches]);

  // Auto-select best allocation method based on available batches
  useEffect(() => {
    if (!showAllocationModal || currentBatches.length === 0 || !allocationHeaderId) return;

    // Get SO lines for this header
    const soLinesForHeader = Array.isArray(lineRecords) 
      ? lineRecords.filter(l => l.so_header_id === allocationHeaderId)
      : [];
    
    // Determine which allocation method is best
    for (const line of soLinesForHeader) {
      const batchNumberRequested = line.batch_number;
      
      if (batchNumberRequested) {
        // Check if the requested batch exists
        const batchExists = currentBatches.some(
          b => b.item_id === line.item_id && 
               b.batch_number?.toUpperCase() === batchNumberRequested.toUpperCase() &&
               (b.on_hand_quantity || 0) > 0
        );
        
        if (batchExists) {
          // Batch available - use BATCH method
          console.log(`✅ Auto-selecting BATCH method: Batch ${batchNumberRequested} is available`);
          setAllocationMethod('BATCH');
          return;
        }
      }
    }

    // Check if batches have VALID (non-expired) expiry dates (FEFO capable)
    const today = new Date();
    const hasValidExpiryDates = currentBatches.some(b => {
      if (!b.expiry_date) return false;
      const expiryDate = new Date(b.expiry_date);
      return expiryDate > today; // Only valid if expiry date is in the future
    });
    
    if (hasValidExpiryDates) {
      // Use FEFO if batches have valid expiry dates
      console.log(`📦 Auto-selecting FEFO method: Batches have valid expiry dates`);
      setAllocationMethod('FEFO');
    } else {
      // Fall back to FIFO (oldest first) - either no expiry dates or all are expired
      console.log(`📋 Auto-selecting FIFO method: No valid expiry dates found, using oldest batches first`);
      setAllocationMethod('FIFO');
    }
  }, [showAllocationModal, allocationHeaderId, currentBatches]);

  // Process batch allocation
  const handleProcessAllocation = async () => {
    setAllocationLoading(true);
    setAllocationStatus(null);

    try {
      if (!allocationHeaderId) {
        setAllocationStatus('No SO header selected');
        return;
      }

      // Get SO lines for this header
      const soLinesForAllocation = lineRecords.filter(l => l.so_header_id === allocationHeaderId);
      console.log('📋 SO Lines for allocation:', soLinesForAllocation.map(l => ({ id: l.id, item_id: l.item_id, item_code: l.item_code, ordered_quantity: l.ordered_quantity })));
      if (soLinesForAllocation.length === 0) {
        setAllocationStatus('No SO lines found');
        return;
      }

      // Convert to allocation format with batch number support
      const allocationLines = soLinesForAllocation.map(line => ({
        id: line.id,
        so_header_id: line.so_header_id,
        item_id: line.item_id,
        item_code: line.item_code,
        item_name: line.item_name,
        ordered_quantity: line.ordered_quantity,
        uom: line.uom,
        batchNumber: line.batch_number // Include batch number for allocation
      }));
      console.log('🎯 Allocation lines prepared:', allocationLines);

      // Use intelligent batch fallback allocation (BATCH > FEFO > FIFO)
      // Rules are applied automatically per-item based on batch_tracking and expiry dates
      console.log('📦 Current batches available:', currentBatches);
      
      let allocationResults: any[] = [];
      
      // Always use intelligent allocation with automatic rule detection
      console.log('🤖 Using intelligent allocation with automatic per-item method detection');
      
      // Convert SO lines to the format expected by batch fallback function
      const batchFallbackLines = allocationLines.map(line => ({
        soLineId: line.id,
        itemId: line.item_id,
        itemCode: line.item_code,
        itemName: line.item_name,
        orderedQuantity: line.ordered_quantity,
        requiredBatch: line.batchNumber || undefined // Batch from SO entry
      }));
      
      // Convert inventory batches to the format expected by batch fallback function
      const inventoryBatches = currentBatches.map(batch => ({
        id: batch.id,
        item_id: batch.item_id,
        item_code: batch.item_code,
        batch_number: batch.batch_number,
        location_id: batch.location_id,
        location_code: batch.location_code,
        expiry_date: batch.expiry_date,
        manufacturing_date: batch.manufacturing_date,
        received_date: batch.received_date,
        on_hand_quantity: batch.on_hand_quantity,
        available_quantity: batch.available_quantity,
        pallet_id: batch.pallet_id
      }));
      
      console.log('📊 Sample currentBatch[0]:', currentBatches[0]);
      console.log('📊 Sample inventoryBatch[0]:', inventoryBatches[0]);
      console.log('📊 First 3 batches expiry dates:', inventoryBatches.slice(0, 3).map(b => ({ batch: b.batch_number, expiry: b.expiry_date })));
      
      // Build item configs with batch_tracking info
      console.log('🔍 STATE CHECK - items.length:', items.length);
      console.log('🔍 STATE CHECK - items IDs:', items.map(i => i.id));
      console.log('🔍 STATE CHECK - SO line item IDs needed:', allocationLines.map(l => l.item_id));
      
      const itemConfigs = Object.fromEntries(
        items.map(i => [i.id, { batch_tracking: i.batch_tracking || false }])
      );
      console.log('📝 Full items array:', items);
      console.log('📝 Item Configs being passed to allocation:', itemConfigs);
      console.log('📝 Items array detailed:', items.map(i => ({ 
        id: i.id, 
        item_code: i.item_code, 
        batch_tracking: i.batch_tracking,
        batch_tracking_type: typeof i.batch_tracking
      })));
      
      const batchFallbackResults = allocateSOLinesWithBatchFallback(
        batchFallbackLines,
        inventoryBatches,
        itemConfigs
      );
      
      console.log('🎯 [DEBUG] batchFallbackResults:', batchFallbackResults.map(r => ({
        itemCode: r.itemCode,
        allocations: r.allocations.map(a => ({ locationCode: a.locationCode, locationId: a.locationId }))
      })));
      
      // Convert batch fallback results to old format for compatibility
      allocationResults = batchFallbackResults.flatMap(result => {
        // Get the corresponding SO line for item name and UOM
        const soLine = allocationLines.find(l => l.id === result.soLineId);
        
        return result.allocations.map(alloc => {
          console.log(`🎯 [DEBUG] Processing allocation: soLineId=${result.soLineId}, locationCode=${alloc.locationCode}, locationId=${alloc.locationId}, batchNumber=${alloc.batchNumber}`);
          return {
            so_line_id: result.soLineId || soLine?.id || 0,
            item_id: result.itemId,
          item_code: result.itemCode,
          item_name: soLine?.item_name || '',
          item_uom: soLine?.uom || 'units',
          batch_number: alloc.batchNumber,
          allocation_quantity: alloc.allocatedQuantity,
          expiry_date: alloc.expiryDate,
          manufacturing_date: alloc.manufacturingDate,
          received_at: null,
          pallet_id: alloc.palletId,
          location_id: alloc.locationId,
          location_code: alloc.locationCode, // ✅ ADDED: Include location_code from allocation
          status: 'allocated',
          allocation_method: result.allocationMethod // ← ADDED: Include the method from backend
          };
        });
      });
      
      console.log('✅ Allocation completed with automatic rule detection');
      
      console.log('✅ Allocation results from algorithm:', allocationResults);

      // Validate completeness
      const validation = validateAllocationCompleteness(
        allocationLines,
        allocationResults
      );
      console.log('📊 Validation result:', validation);

      // Transform flat allocation results into grouped format for UI display
      const groupedResults = allocationLines.map(line => {
        const lineAllocations = allocationResults.filter(a => a.so_line_id === line.id && a.status !== 'pending');
        const pendingAllocation = allocationResults.find(a => a.so_line_id === line.id && a.status === 'pending');
        const totalAllocated = lineAllocations.reduce((sum, a) => sum + a.allocation_quantity, 0);
        const shortfall = Math.max(0, line.ordered_quantity - totalAllocated);
        
        // Get allocation method from first result for this line
        const allocationMethod = lineAllocations.length > 0 ? lineAllocations[0].allocation_method : 'BATCH';

        return {
          so_line_id: line.id,
          itemCode: line.item_code,
          itemName: line.item_name,
          orderedQuantity: line.ordered_quantity,
          uom: line.uom || 'units',
          totalAllocated,
          shortfall,
          allocationMethod, // Add allocation method to grouped result
          allocations: lineAllocations.map((a, allocIdx) => {
            const displayLocationCode = a.location_code || `LOC-${a.location_id}`;
            console.log(`🎯 [DEBUG-DISPLAY] Allocation for ${a.batch_number}: location_code='${a.location_code}', location_id=${a.location_id}, display='${displayLocationCode}'`);
            return {
              batchNumber: a.batch_number,
              allocatedQuantity: a.allocation_quantity,
              expiryDate: a.expiry_date,
              manufacturingDate: a.manufacturing_date,
              receivedAt: a.received_at,
              palletId: a.pallet_id,
              uom: line.uom || 'units',
              locationCode: displayLocationCode, // ✅ Use location_code directly from allocation
              allocationOrder: allocIdx + 1 // Track which batch was selected first, second, etc.
            };
          })
        };
      });
      console.log('📈 Grouped results for display:', groupedResults);

      // Store BOTH the raw results (for saving) and grouped results (for display)
      const rawResults = allocationResults.filter(a => a.status !== 'pending');
      setRawAllocationResults(rawResults);
      setAllocationResults(groupedResults);
      
      console.log('✅ Allocation processed, setting preview mode');
      console.log('📊 Grouped results:', groupedResults.length, 'items');
      
      // NOTE: We do NOT update currentBatches quantities anymore
      // on_hand_quantity stays as received quantity (immutable)
      // Available is calculated as: received - allocated_from_so_inventory
      // This prevents false "depleted" display
      
      setAllocationPreviewMode(true);
      // Don't show status message during preview - wait until confirmation
      setAllocationStatus(null);
    } catch (err: any) {
      console.error('❌ Allocation error:', err);
      setAllocationStatus(`Error: ${err.message}`);
      setAllocationPreviewMode(false);
    } finally {
      setAllocationLoading(false);
    }
  };

  const handleConfirmAndSaveAllocation = async () => {
    setAllocationLoading(true);
    setAllocationStatus(null);

    try {
      if (!allocationHeaderId || allocationResults.length === 0) {
        setAllocationStatus('No allocation preview to save');
        return;
      }

      // Check if this SO header already has allocations
      const soLineIds = lineRecords
        .filter(l => l.so_header_id === allocationHeaderId)
        .map(l => l.id);
      
      const existingAllocsRes = await fetch(`/api/so-inventory?so_line_id=${soLineIds.join(',')}`, {
        method: 'GET',
      });

      if (existingAllocsRes.ok) {
        const existingAllocs = await existingAllocsRes.json();
        if (Array.isArray(existingAllocs) && existingAllocs.length > 0) {
          console.warn('⚠️ Allocations already exist for this SO. Clearing old allocations...');
          
          // Delete existing allocations for these SO lines (via delete-records API)
          for (const alloc of existingAllocs) {
            await fetch(`/api/delete-records`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                table: 'so_inventory',
                filters: { id: `eq.${alloc.id}` }
              })
            });
          }
          console.log('🗑️ Old allocations cleared');
        }
      }

      // Save allocation to SO inventory table
      const warehouseId = headerRecords.find(h => h.id === allocationHeaderId)?.warehouse_id || 1;
      console.log('💾 Saving allocations via API');
      console.log('🏢 Warehouse ID:', warehouseId);
      console.log('📝 Payload being saved:', rawAllocationResults);
      
      const saveSuccess = await saveAllocationsToInventory(
        rawAllocationResults,
        warehouseId,
        apiKey,
        urlSOInventory,
        urlAsnInventory
      );

      if (!saveSuccess) {
        setAllocationStatus('❌ Failed to save allocations to database');
        setAllocationLoading(false);
        return;
      }

      // Update SO lines with pallet IDs from allocations
      console.log('📝 Updating SO lines with pallet IDs from allocations...');
      try {
        for (const allocation of rawAllocationResults) {
          if (allocation.so_line_id && allocation.pallet_id) {
            await fetch(`/api/patch-record`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                table: 'so_lines',
                id: allocation.so_line_id,
                data: {
                  pallet_id: allocation.pallet_id,
                },
              }),
            });
          }
        }
        console.log('✅ SO lines updated with pallet IDs');
      } catch (err) {
        console.warn('⚠️ Failed to update SO lines with pallet IDs:', err);
        // Don't fail the whole allocation for this
      }

      // Update SO status to "Allocated"
      const statusUpdateSuccess = await updateSOStatus(
        allocationHeaderId,
        'Allocated',
        apiKey,
        urlHeaders
      );

      if (!statusUpdateSuccess) {
        setAllocationStatus('⚠️ Allocations saved but failed to update SO status');
        setAllocationLoading(false);
        return;
      }

      // Clear cache so fresh data is loaded
      const yearFilter = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
      await fetch('/api/outbound-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify({ year: yearFilter, action: 'clear' }),
      }).catch(err => console.error('Cache clear error:', err));

      // Clear caches
      await Promise.all([
        // Clear outbound records cache
        fetch('/api/outbound-records', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
          },
          body: JSON.stringify({ year: yearFilter, action: 'clear' }),
        }).catch(err => console.error('Outbound cache clear error:', err)),
        // Clear inventory cache so Allocated Qty updates appear
        fetch('/api/inventory-records', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': apiKey,
          },
          body: JSON.stringify({ year: yearFilter, action: 'clear' }),
        }).catch(err => console.error('Inventory cache clear error:', err))
      ]);

      // Update local header record status
      setHeaderRecords(prev => prev.map(h => 
        h.id === allocationHeaderId ? { ...h, status: 'Allocated' } : h
      ));

      // Refresh SO lines with updated allocated quantities
      try {
        const lineRefreshRes = await fetch(`/api/outbound-records?year=${yearFilter}${searchParams?.get('warehouse') ? `&warehouse=${searchParams.get('warehouse')}` : ''}&refresh=true`);
        if (lineRefreshRes.ok) {
          const freshData = await lineRefreshRes.json();
          const freshLines = freshData.lines || [];
          // Enrich lines with item details
          const enrichedLines = freshLines.map((line: any) => {
            const item = items.find(i => i.id === line.item_id);
            return {
              ...line,
              item_code: item?.item_code || line.item_code || '-',
              item_name: item?.item_name || line.item_name || '-',
              batch_tracking: item?.batch_tracking || false
            };
          });
          setLineRecords(enrichedLines);
          console.log('✅ Refreshed SO lines with allocated quantities');
        }
      } catch (err) {
        console.error('⚠️ Could not refresh line records:', err);
      }

      setAllocationStatus(`✅ Allocation Confirmed & Saved Successfully! (${allocationMethod} method)\n\nSO ready for picking.`);
      setAllocationPreviewMode(false);
      
      // Dispatch event to notify inventory page to refresh
      if (typeof window !== 'undefined') {
        console.log('📡 Dispatching: inventoryUpdated event');
        window.dispatchEvent(new Event('inventoryUpdated'));
      }
      
      // Close modal after 3 seconds
      setTimeout(() => {
        setShowAllocationModal(false);
        setAllocationResults([]);
        setRawAllocationResults([]);
        setSelectedBatchesForAllocation(new Set());
        
        // Refresh grid to show updated status
        if (headerGridRef.current?.api) {
          headerGridRef.current.api.refreshCells();
          // Ensure row stays selected by selecting it again
          const node = headerGridRef.current.api.getRowNode(String(allocationHeaderId));
          if (node) {
            node.setSelected(true);
          }
        }
      }, 3000);
    } catch (err: any) {
      setAllocationStatus(`Error: ${err.message}`);
    } finally {
      setAllocationLoading(false);
    }
  };

  // Fetch allocated batches for picking
  const handleOpenPickingModal = async (headerId: number) => {
    setPickingHeaderId(headerId);
    setPickingStatus(null);
    setPickingLoading(true);
    setPickedBatchIds(new Set());
    setShowPickingModal(true); // Show modal immediately while loading

    try {
      // Get SO line IDs for this header
      const soLinesForPicking = lineRecords.filter(l => l.so_header_id === headerId);
      const soLineIds = soLinesForPicking.map(l => l.id);
      
      console.log(`🔍 [handleOpenPickingModal] Header ${headerId} has ${soLineIds.length} SO lines:`, soLineIds);

      if (soLineIds.length === 0) {
        setPickingStatus('⚠️ No SO lines found for this order.');
        setPickingLoading(false);
        return;
      }

      const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';
      const batches = await fetchAllocatedBatches(soLineIds, apiKey, urlSOInventory);
      
      if (batches.length === 0) {
        setPickingStatus('⚠️ No allocated batches found. Please allocate batches first.');
        setPickingLoading(false);
        return;
      }

      setPickingBatches(batches);
      setPickingStatus(null); // Clear any loading status
    } catch (err: any) {
      setPickingStatus(`❌ Error: ${err.message}`);
    } finally {
      setPickingLoading(false);
    }
  };

  // Handle barcode scan - search and select matching batch by Pallet ID, Batch Number, or Item Code
  const handleBarcodeScanned = (barcode: string) => {
    if (!barcode || barcode.trim() === '') return;
    
    console.log('📱 Barcode scanned:', barcode);
    const searchTerm = barcode.toLowerCase().trim();
    
    // Find matching batch by pallet_id, batch_number, or item code
    const matchingBatch = pickingBatches.find(batch => {
      const palletMatch = batch.palletId?.toString().toLowerCase().includes(searchTerm);
      const batchNumMatch = batch.batchNumber?.toString().toLowerCase().includes(searchTerm);
      
      // Get item code from items array
      const itemFromArray = items.find(i => i.id === batch.itemId);
      const itemCodeMatch = itemFromArray?.item_code?.toLowerCase().includes(searchTerm) || 
                           batch.itemCode?.toString().toLowerCase().includes(searchTerm);
      
      return palletMatch || batchNumMatch || itemCodeMatch;
    });
    
    if (matchingBatch) {
      console.log('✅ Found matching batch:', matchingBatch);
      
      // Auto-select the batch
      const newSet = new Set(pickedBatchIds);
      newSet.add(matchingBatch.id);
      setPickedBatchIds(newSet);
      
      // Get item name
      const itemData = items.find(i => i.id === matchingBatch.itemId);
      const itemCode = itemData?.item_code || '-';
      const itemName = itemData?.item_name || '-';
      
      // Show feedback with match type
      let matchType = '';
      if (matchingBatch.palletId?.toString().toLowerCase().includes(searchTerm)) {
        matchType = `Pallet: ${matchingBatch.palletId}`;
      } else if (matchingBatch.batchNumber?.toString().toLowerCase().includes(searchTerm)) {
        matchType = `Batch: ${matchingBatch.batchNumber}`;
      } else {
        matchType = `Item: ${itemCode}`;
      }
      
      setPickingStatus(`✅ Scanned (${matchType}) - ${itemCode} ${itemName} (${matchingBatch.allocatedQuantity} units)`);
      setLastScannedBarcode(barcode);
      
      // Clear input for next scan
      setBarcodeInput('');
      
      // Auto-clear feedback after 3 seconds
      setTimeout(() => setPickingStatus(null), 3000);
    } else {
      console.warn('❌ No matching batch found for barcode:', barcode);
      setPickingStatus(`❌ Barcode not found: ${barcode} (searched Pallet ID, Batch Number, Item Code)`);
      setTimeout(() => setPickingStatus(null), 3000);
      setBarcodeInput('');
    }
  };

  // Confirm picked batches
  const handleConfirmPicks = async () => {
    setPickingLoading(true);
    setPickingStatus(null);

    try {
      if (!pickingHeaderId) {
        setPickingStatus('No SO header selected');
        return;
      }

      // Mark batches as picked based on checkboxes
      const batchesToPick = pickingBatches.map(batch => ({
        ...batch,
        picked: pickedBatchIds.has(batch.id),
        pickedQuantity: pickedBatchIds.has(batch.id) ? batch.allocatedQuantity : 0
      }));

      // Validate all batches are picked
      const validation = validatePickCompletion(batchesToPick);
      if (!validation.valid) {
        setPickingStatus(`❌ Picking incomplete:\n${validation.errors.join('\n')}`);
        setPickingLoading(false);
        return;
      }

      // Confirm picks and update status
      const urlSOInventory = process.env.NEXT_PUBLIC_URL_SO_INVENTORY || '';
      const urlSOHeaders = urlHeaders;
      const urlPickTransactions = process.env.NEXT_PUBLIC_URL_PICK_TRANSACTIONS || '';
      const urlStockMovement = (process.env.NEXT_PUBLIC_URL_STOCK_MOVEMENT || 'http://172.31.39.68:8030/stock_movement').replace(/^https?:\/\//, 'http://');

      // Get SO lines for this SO header
      const soLinesForPicking = lineRecords.filter(l => l.so_header_id === pickingHeaderId);

      // Get staging location (assuming ID 2 for STAGING location, or use first location)
      const stagingLocation = locationOptions.find(loc => loc.location_code?.includes('STAG')) || 
                             locationOptions.find(loc => loc.is_staging === true) ||
                             { id: 2, location_code: 'STAGING' };

      // Get current user from localStorage
      const currentUserName = typeof window !== 'undefined' 
        ? (localStorage.getItem('currentUser') || localStorage.getItem('username') || 'System')
        : 'System';

      const result = await confirmPicks(
        {
          soHeaderId: pickingHeaderId,
          soLines: soLinesForPicking,
          soInventoryRecords: batchesToPick,
          items: items,
          locations: locationOptions,
          apiKey,
          urlPickTransactions,
          urlSOHeaders,
          urlSOInventory,
          urlStockMovement,
          stagingLocationId: stagingLocation?.id || 2,
          stagingLocationCode: stagingLocation?.location_code || 'STAGING',
          movedBy: currentUserName
        },
        batchesToPick
      );

      if (result.success) {
        const summary = getPickingSummary(batchesToPick);
        setPickingStatus(`✅ ${result.message}\n\n${summary.summary}`);
        
        // Close modal after 2 seconds and refresh data
        setTimeout(async () => {
          setShowPickingModal(false);
          
          // Clear server cache to ensure fresh data is fetched
          try {
            await fetch('/api/outbound-records', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                year: new Date().getFullYear(),
                action: 'clear' 
              })
            });
            console.log('✅ Outbound cache cleared');
          } catch (err) {
            console.log('ℹ️ Could not clear cache, proceeding anyway');
          }
          
          // Update the SO header status locally to "Picked"
          if (pickingHeaderId) {
            setHeaderRecords(prev => prev.map(h =>
              h.id === pickingHeaderId ? { ...h, status: 'Picked' } : h
            ));
          }
          
          // Refresh grid to show updated status
          if (headerGridRef.current?.api) {
            headerGridRef.current.api.refreshCells();
            // Ensure row stays selected by selecting it again
            const node = headerGridRef.current.api.getRowNode(String(pickingHeaderId));
            if (node) {
              node.setSelected(true);
            }
          }
        }, 2000);
      } else {
        setPickingStatus(`⚠️ ${result.message}\nErrors: ${result.errors.join('\n')}`);
      }
    } catch (err: any) {
      setPickingStatus(`❌ Fatal error: ${err.message}`);
    } finally {
      setPickingLoading(false);
    }
  };
            // State for SO lines update feedback
            const [linesUpdateStatus, setLinesUpdateStatus] = useState<string | null>(null);

            // Handler to update SO lines in backend
            const handleUpdateLines = async () => {
              setLinesUpdateStatus(null);
              if (!selectedHeaderId) {
                setLinesUpdateStatus('No SO header selected.');
                return;
              }
              const linesToUpdate = lineRecords.filter(line => line.so_header_id === selectedHeaderId);
              if (linesToUpdate.length === 0) {
                setLinesUpdateStatus('No SO lines to update.');
                return;
              }
              try {
                for (const line of linesToUpdate) {
                  // Only send editable fields for PATCH
                  const lineToSend = {
                    item_id: line.item_id,
                    item_description: line.item_description,
                    ordered_quantity: line.ordered_quantity,
                    batch_number: line.batch_number,
                    serial_number: line.serial_number,
                    manufacturing_date: line.manufacturing_date,
                    expiry_date: line.expiry_date,
                    pallet_id: line.pallet_id,
                    uom: line.uom,
                    remarks: line.remarks ?? ''
                  };
                  console.log('PATCH SO line:', { table: 'so_lines', id: line.id, payload: lineToSend });
                  const res = await fetch('/api/patch-record', {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      table: 'so_lines',
                      id: line.id,
                      data: lineToSend,
                    }),
                  });
                  const resText = await res.text();
                  console.log('PATCH response:', { status: res.status, text: resText });
                  if (!res.ok) {
                    setLinesUpdateStatus(`Failed to update SO line ${line.id}. Status: ${res.status}. Response: ${resText}`);
                    return;
                  }
                }
                setLinesUpdateStatus('SO lines updated successfully!');
                // Re-fetch SO lines from backend to update grid
                try {
                  const linesData = await fetchSOLines();
                  setLineRecords(Array.isArray(linesData) ? linesData : [linesData]);
                } catch (err) {
                  // Optionally handle fetch error
                }
              } catch (err: any) {
                setLinesUpdateStatus(`Error: ${err.message}`);
              }
            };
          // Track selected SO header id for filtering lines
          const [selectedHeaderId, setSelectedHeaderId] = useState<string | null>(null);
        // Ref for SO headers grid
        const headerGridRef = useRef<any>(null);
        // State for delete feedback
        const [deleteStatus, setDeleteStatus] = useState<string | null>(null);

        // Handler to delete selected SO headers
        const handleDeleteSelectedHeaders = async () => {
          setDeleteStatus(null);
          const selectedNodes = headerGridRef.current?.api.getSelectedNodes() || [];
          const selectedIds = selectedNodes.map((node: any) => node.data.id);
          console.log('🗑️ Delete handler - selectedNodes:', selectedNodes.length, 'selectedIds:', selectedIds);
          if (selectedIds.length === 0) {
            setDeleteStatus('No SO headers selected.');
            return;
          }
          try {
            // Build batch delete operations
            const deleteOps: any[] = [];
            
            // Step 1: Delete dependent records from pick_transactions (if exists)
            for (const headerId of selectedIds) {
              deleteOps.push({
                table: 'pick_transactions',
                filters: { 'so_header_id': `eq.${headerId}` }
              });
            }

            // Step 2: Delete from so_inventory table (references so_lines)
            for (const headerId of selectedIds) {
              const linesToDelete = lineRecords.filter(l => l.so_header_id === headerId);
              for (const line of linesToDelete) {
                deleteOps.push({
                  table: 'so_inventory',
                  filters: { 'so_line_id': `eq.${line.id}` }
                });
              }
            }

            // Step 3: Delete SO lines individually (by line ID, not by header ID)
            for (const headerId of selectedIds) {
              const linesToDelete = lineRecords.filter(l => l.so_header_id === headerId);
              for (const line of linesToDelete) {
                deleteOps.push({
                  table: 'so_lines',
                  filters: { 'id': `eq.${line.id}` }
                });
              }
            }

            // Step 4: Delete SO headers
            for (const id of selectedIds) {
              deleteOps.push({
                table: 'so_headers',
                filters: { 'id': `eq.${id}` }
              });
            }

            console.log('🗑️ Sending delete operations:', deleteOps.length, 'ops');
            
            // Execute batch delete via API
            const response = await fetch('/api/delete-records', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(deleteOps)
            });

            console.log('🗑️ Delete response status:', response.status);
            if (!response.ok) {
              const responseText = await response.text();
              console.error('🗑️ Delete response text:', responseText);
              let errorData: any = {};
              try {
                errorData = JSON.parse(responseText);
              } catch (e) {
                errorData = { error: `HTTP ${response.status}: ${responseText || 'Unknown error'}` };
              }
              console.error('🗑️ Delete error:', errorData);
              setDeleteStatus(`❌ Error: ${errorData?.error || errorData?.errors?.map((e: any) => e.error).join(', ') || 'Failed to delete records'}`);
              return;
            }

            const result = await response.json();
            console.log('🗑️ Delete result:', result);

            // Step 6: Remove deleted headers and lines from UI
            setHeaderRecords(prev => prev.filter(rec => !selectedIds.includes(rec.id)));
            setLineRecords(prev => prev.filter(line => !selectedIds.includes(line.so_header_id)));
            setPutawayCompletedLines(new Set());
            setDeleteStatus('✅ Selected SO headers and all related records deleted successfully!');
          } catch (err: any) {
            console.error('🗑️ Delete error:', err);
            setDeleteStatus(`❌ Error: ${err.message}`);
          }
        };
      // State for unified SO entry submission feedback
      const [entrySubmitStatus, setEntrySubmitStatus] = useState<string | null>(null);

      // Unified handler for SO header and lines submission
      const handleSubmitEntry = async () => {
        setEntrySubmitStatus(null);
        if (!header.soDate) {
          setEntrySubmitStatus('SO Date is required. Please select a valid date.');
          return;
        }
        if (!header.customerId) {
          setEntrySubmitStatus('Customer is required.');
          return;
        }
        // Prepare SO header payload (no id)
        const customer = customers.find(c => c.id === header.customerId);
        const generateUniqueBarcode = () => `SO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const soHeaderPayload = {
          so_number: header.soNumber,
          customer_id: header.customerId,
          customer_code: customer?.customer_code || customer?.code || '',
          customer_name: customer?.customer_name || customer?.name || '',
          warehouse_id: warehouseFilter ? parseInt(warehouseFilter) : 1,
          so_date: header.soDate,
          status: header.status,
          barcode: header.barcode ? header.barcode : generateUniqueBarcode(),
          notes: header.remarks
        };
        // Prepare SO lines payload
        const filteredRows = rowData.filter(row => row.itemCode);
        const soLinesPayload = filteredRows.map(row => {
          const itemData = items.find(i => i.item_code === row.itemCode);
          return {
            item_id: itemData?.id || null,
            item_code: itemData?.item_code || row.itemCode || null,
            item_name: itemData?.item_name || row.itemName || null,
            item_uom: itemData?.item_uom || null,
            ordered_quantity: row.expectedQuantity ? Number(row.expectedQuantity) : null,
            batch_number: row.batchNumber || null,
            required_expiry_date: row.expiryDate ? row.expiryDate.slice(0, 10) : null,
            pallet_id: row.palletId || null,
            weight_uom_kg: row.weightUomKg ? Number(row.weightUomKg) : null,
            pallet_config: row.palletConfig || null,
            notes: row.remarks || null,
          };
        });
        if (soLinesPayload.length === 0) {
          setEntrySubmitStatus('No valid SO line items to submit.');
          return;
        }
        try {
          // 1. Insert SO header
          const headerRes = await postSOHeader(soHeaderPayload);
          if (!headerRes.ok) {
            const headerText = await headerRes.text();
            setEntrySubmitStatus(`Header insert failed: ${headerRes.status} - ${headerText.slice(0, 500)}`);
            return;
          }
          const headerData = await headerRes.json();
          const so_header_id = headerData?.data?.id;
          if (!so_header_id) {
            console.error('❌ No header ID in response:', headerData);
            setEntrySubmitStatus('Header created but ID not found in response.');
            return;
          }
          console.log(`✅ SO header created with ID: ${so_header_id}`);
          // 2. Insert SO lines with correct header id
          const soLinesPayloadWithHeader = soLinesPayload.map(line => ({ ...line, so_header_id }));
          const linesRes = await postSOLines(soLinesPayloadWithHeader);
          if (!linesRes.ok) {
            const linesText = await linesRes.text();
            setEntrySubmitStatus(`Lines insert failed: ${linesRes.status} - ${linesText.slice(0, 500)}`);
            return;
          }
          console.log(`✅ SO lines created: ${soLinesPayloadWithHeader.length} lines`);
          setEntrySubmitStatus('✅ SO entry created successfully! Opening allocation wizard...');
          
          // Clear cache and refetch fresh data
          const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
          try {
            await fetch(`/api/outbound-records`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ year, action: 'clear' }),
            });
            
            // Refetch records with fresh=true to bypass cache
            const refreshUrl = `/api/outbound-records?year=${year}&refresh=true${warehouseFilter ? `&warehouse=${warehouseFilter}` : ''}`;
            const refreshRes = await fetch(refreshUrl);
            if (refreshRes.ok) {
              const freshData = await refreshRes.json();
              console.log('🔄 Refreshed SO records after entry submission');
              setHeaderRecords(freshData.headers || []);
              setLineRecords(freshData.lines || []);
            }
          } catch (err) {
            console.log('Note: Cache clear/refresh completed');
          }
          
          // Auto-open allocation modal after successful save
          setTimeout(() => {
            setAllocationHeaderId(so_header_id);
            setShowAllocationModal(true);
            setAllocationMethod('FEFO'); // Default to FEFO
          }, 500);
        } catch (err: any) {
          setEntrySubmitStatus(`Error: ${err.message}`);
        }
      };
    // Record view state
    const [headerRecords, setHeaderRecords] = useState<any[]>([]);
    const [lineRecords, setLineRecords] = useState<any[]>([]);
    const [filteredRecordLines, setFilteredRecordLines] = useState<any[]>([]);
    // State for search and status filter
    const [searchHeaderInput, setSearchHeaderInput] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    // State for status change confirmation
    const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
    const [pendingStatusChange, setPendingStatusChange] = useState<{ recordId: number; oldStatus: string; newStatus: string } | null>(null);
    // State for refresh loading
    const [isRefreshing, setIsRefreshing] = useState(false);
    
    // Get year and warehouse from URL params
    const searchParams = useSearchParams();
    const yearFilter = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
    const warehouseFilter = searchParams?.get('warehouse');
    
    // Filtered headers based on search and status filter
    const filteredHeaderRecords = useMemo(() => {
      return headerRecords.filter(header => {
        const matchesSearch = searchHeaderInput.trim() === '' || 
          header.so_number?.toLowerCase().includes(searchHeaderInput.toLowerCase()) ||
          header.customer_code?.toLowerCase().includes(searchHeaderInput.toLowerCase()) ||
          header.customer_name?.toLowerCase().includes(searchHeaderInput.toLowerCase()) ||
          header.po_number?.toLowerCase().includes(searchHeaderInput.toLowerCase()) ||
          header.barcode?.toLowerCase().includes(searchHeaderInput.toLowerCase());
        
        const matchesStatus = statusFilter === '' || header.status === statusFilter;
        
        return matchesSearch && matchesStatus;
      });
    }, [headerRecords, searchHeaderInput, statusFilter]);

    // Handle refresh - clear cache and re-fetch

    // Fetch SO headers and lines for record view (with caching)
      useEffect(() => {
        async function fetchRecords() {
          try {
            // Call server-side cached API endpoint
            const url = `/api/outbound-records?year=${yearFilter}${warehouseFilter ? `&warehouse=${warehouseFilter}` : ''}`;
            const response = await fetch(url);
            
            if (!response.ok) {
              throw new Error(`Failed to fetch records: ${response.status}`);
            }

            const data = await response.json();
            const headers = data.headers || [];
            const lines = data.lines || [];
            
            setHeaderRecords(headers);
            
            // Enrich SO lines with item code and name from items list
            const enrichedLines = lines.map((line: any) => {
              const item = items.find(i => i.id === line.item_id);
              return {
                ...line,
                item_code: item?.item_code || line.item_code || '-',
                item_name: item?.item_name || line.item_name || '-',
                batch_tracking: item?.batch_tracking || false
              };
            });
            
            setLineRecords(enrichedLines);
          } catch (err) {
            console.error('Error fetching records:', err);
            // ...handle error
          } finally {
            setIsRefreshing(false);
          }
        }
        fetchRecords();
      }, [items, yearFilter, warehouseFilter]);

  // Status transition map - defines which statuses can transition to which
  const statusTransitions: { [key: string]: string[] } = {
    'New': ['Allocated', 'Picking', 'Shipped'],
    'Allocated': ['Picking', 'Shipped'],
    'Picking': ['Shipped'],
    'Shipped': []
  };

  // Function to get allowed statuses for current status
  const getAllowedStatuses = (currentStatus: string): string[] => {
    const isAdmin = localStorage.getItem('isAdmin') === 'true' || localStorage.getItem('userRole') === 'admin';
    const allStatuses = ['New', 'Allocated', 'Picked', 'Shipped'];
    
    if (isAdmin) {
      // Admin can go to any status except current
      return allStatuses.filter(s => s !== currentStatus);
    }
    
    // Non-admin can only go forward - show remaining future statuses
    const currentIndex = allStatuses.indexOf(currentStatus);
    return allStatuses.slice(currentIndex + 1);
  };

  // AG Grid column definitions for record view
  const headerRecordCols = [
      { headerName: 'SO Number', field: 'so_number', editable: true, width: 110 },
      { headerName: 'Customer Code', field: 'customer_code', editable: true, width: 120 },
      { headerName: 'Customer Name', field: 'customer_name', editable: true, width: 150 },
      { headerName: 'SO Date', field: 'so_date', editable: true, width: 110 },
      { headerName: 'Warehouse ID', field: 'warehouse_id', editable: true, width: 100 },
      { headerName: 'Barcode', field: 'barcode', editable: true, width: 140, hide: false },
      {
        headerName: 'Status',
        field: 'status',
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: (params: any) => ({
          values: getAllowedStatuses(params.data?.status || 'New'),
        }),
        width: 130,
        cellRenderer: (params: any) => {
          const status = params.value;
          const colors: Record<string, string> = {
            'New': 'bg-blue-100 text-blue-800',
            'Allocated': 'bg-purple-100 text-purple-800',
            'Ready for Picking': 'bg-indigo-100 text-indigo-800',
            'Picked': 'bg-yellow-100 text-yellow-800',
            'Ready for Shipment': 'bg-cyan-100 text-cyan-800',
            'Shipped': 'bg-green-100 text-green-800',
            'Completed': 'bg-gray-100 text-gray-800'
          };
          const colorClass = colors[status] || 'bg-gray-100 text-gray-800';
          return <span className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer hover:opacity-80 ${colorClass}`}>{status}</span>;
        }
      },
      { headerName: 'ID', field: 'id', editable: false, hide: true },
      { headerName: 'Created At', field: 'created_at', editable: false },
      { headerName: 'Updated At', field: 'updated_at', editable: false },
      { headerName: 'Remarks', field: 'remarks', editable: true, width: 150, hide: true },
  ];

  const lineRecordCols = [
    { headerName: 'Item ID', field: 'item_id', editable: true },
    { headerName: 'Item Description', field: 'item_description', editable: true },
    { headerName: 'Expected Qty', field: 'ordered_quantity', editable: true },
    { headerName: 'Ordered Qty', field: 'ordered_quantity', editable: true },
    { headerName: 'Batch #', field: 'batch_number', editable: true },
    { headerName: 'Serial #', field: 'serial_number', editable: true },
    { headerName: 'Mfg Date', field: 'manufacturing_date', editable: true },
    { headerName: 'Expiry Date', field: 'expiry_date', editable: true },
    { headerName: 'Pallet ID', field: 'pallet_id', editable: true },
    { headerName: 'UOM', field: 'uom', editable: true },
    { headerName: 'Remarks', field: 'remarks', editable: true },
  ];
  const pasteTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const recordPasteTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [showRecordPasteArea, setShowRecordPasteArea] = useState(false);
  const [originalRecordLines, setOriginalRecordLines] = useState<any[]>([]); // Store original state before paste
  const [isSavingPastedData, setIsSavingPastedData] = useState(false);
  const [pasteDataStatus, setPasteDataStatus] = useState<string | null>(null); // Status message for save
  const [header, setHeader] = useState<SOHeader>({
    soNumber: '',
    barcode: '',
    customerId: null,
    soDate: new Date().toISOString().split('T')[0],
    status: 'New',
    remarks: '',
  });

  // Generate barcode (only) - SO number is now manual input
  useEffect(() => {
    const generateBarcode = () => {
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const hh = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      
      // Generate barcode: yy+mm+dd+hh+mm+ss+ms (15 digits)
      // Unique within millisecond precision (up to 1000 barcodes per second)
      const barcode = `${yy}${mm}${dd}${hh}${mins}${ss}${ms}`;
      
      setHeader(h => ({
        ...h,
        barcode: barcode
      }));
    };
    generateBarcode();
  }, []);
  const [clientReady, setClientReady] = useState(false);

  // Set client ready flag only
  useEffect(() => {
    setClientReady(true);
  }, []);

  // Helper function to safely get received quantity from line record
  const getReceivedQuantity = (line: any): number => {
    if (!line) return 0;
    return Number(line.ordered_quantity || line.orderedQuantity || 0);
  };

  // Helper function to generate Pallet ID with format: PAL-YYMMDDHHmmss
  const generatePalletId = (): string => {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    // Add 3-digit counter to ensure uniqueness within same second
    const counter = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return `PAL-${yy}${mm}${dd}${hh}${min}${ss}-${counter}`;
  };

  // State for Pallet ID Generation Modal
  const [showPalletGeneration, setShowPalletGeneration] = useState(false);
  const [palletPasteData, setPalletPasteData] = useState('');
  const [palletGenFormData, setPalletGenFormData] = useState({
    itemCode: '',
    itemName: '',
    description: '',
    asnQty: '',
    itemUom: '',
    weight: '',
    palletConfig: '',
  });
  const [palletGenError, setPalletGenError] = useState<string | null>(null);
  const [remainderWarning, setRemainderWarning] = useState<any>(null);
  const [pendingPalletRows, setPendingPalletRows] = useState<SOLine[]>([]);

  const [rowCount, setRowCount] = useState(5);
  const [rowData, setRowData] = useState<SOLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const gridRef = useRef<AgGridReact>(null);

  const defaultColDef = useMemo(() => ({ resizable: true, sortable: true, filter: true, minWidth: 120 }), []);

  const handleHeaderChange = async (field: keyof SOHeader, value: any) => {
    setHeader({ ...header, [field]: value });

    // Handle Shipped status - trigger inventory deduction
    if (field === 'status' && value === 'Shipped' && selectedHeaderId) {
      try {
        // Fetch latest inventory and SO data
        const headerRecord = headerRecords.find(h => h.id === selectedHeaderId);
        if (!headerRecord) {
          alert('SO header not found');
          return;
        }

        const soLinesForShipment = lineRecords.filter(l => l.so_header_id === selectedHeaderId);
        if (soLinesForShipment.length === 0) {
          alert('No SO lines found for this order');
          return;
        }

        // Fetch latest inventory via API route
        const inventoryRes = await fetch(`/api/inventory-records?refresh=true`, {
          method: 'GET',
          headers: { 'X-Api-Key': apiKey }
        });
        const inventoryResponseData = await inventoryRes.json();
        const currentInventory = Array.isArray(inventoryResponseData.inventory) ? inventoryResponseData.inventory : [];

        // Validate inventory availability
        const validation = validateShipmentInventory(soLinesForShipment, currentInventory);
        if (!validation.valid) {
          const errorMsg = validation.errors.join('\n');
          alert(`❌ Insufficient inventory:\n${errorMsg}`);
          setHeader(h => ({ ...h, status: headerRecord.status || 'Allocated' }));
          return;
        }

        // Show summary before deduction
        const summary = getShipmentSummary(headerRecord, soLinesForShipment, items);
        const confirm = window.confirm(
          `Ship to ${summary.customerName}?\n\nSO: ${summary.soNumber}\n` +
          `Lines: ${summary.lineCount}\nTotal Qty: ${summary.totalQuantity}\n\n` +
          `Items:\n${summary.itemSummary.map(i => `- ${i.itemCode}: ${i.quantity}`).join('\n')}\n\n` +
          `This will DEDUCT from inventory.`
        );

        if (!confirm) {
          setHeader(h => ({ ...h, status: headerRecord.status || 'Allocated' }));
          return;
        }

        // Process shipment - deduct inventory
        const shipmentResult = await deductInventoryOnShipped({
          soHeader: headerRecord,
          soLines: soLinesForShipment,
          items,
          inventory: currentInventory,
          apiKey,
          urlShipmentTransactions: process.env.NEXT_PUBLIC_URL_SHIPMENT_TRANSACTIONS,
          urlSOHeaders: urlHeaders
        });

        if (shipmentResult.success) {
          alert(shipmentResult.message);
          // Refresh records to show updated status
          window.location.reload();
        } else {
          alert(`${shipmentResult.message}\n\nErrors: ${shipmentResult.errors.join('\n')}`);
          setHeader(h => ({ ...h, status: headerRecord.status || 'Allocated' }));
        }
      } catch (err: any) {
        alert(`Error processing shipment: ${err.message}`);
        setHeader(h => ({ ...h, status: 'Allocated' }));
      }
    }
  };

  const handleRowCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const count = Math.max(1, Number(e.target.value));
    setRowCount(count);
    setRowData(Array.from({ length: count }, () => ({
      itemCode: '',
      itemName: '',
      description: '',
      expectedQuantity: '',
      orderedQuantity: '',
      batchNumber: '',
      manufacturingDate: '',
      expiryDate: '',
      palletId: '',
      weightUomKg: '',
      palletConfig: '',
      itemUom: '',
      asnUom: '',
      remarks: '',
    })));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const rows = text.trim().split(/\r?\n/).filter(r => r.trim()).map(row => row.split('\t'));
    const newRows: SOLine[] = [];
    let errorMsg = '';

    rows.forEach((cols, rowIndex) => {
      if (errorMsg) return;
      
      // Expect: Item Code | Item Name | Description | Expected Qty | SO UOM | Ordered Qty | Batch #
      if (cols.length < 6) {
        errorMsg = `Row ${rowIndex + 1}: Expected minimum 6 columns (Item Code, Item Name, Description, Expected Qty, SO UOM, Ordered Qty). Batch # is optional. Got ${cols.length}`;
        return;
      }

      const itemCode = cols[0]?.trim() || '';
      const itemName = cols[1]?.trim() || '';
      const description = cols[2]?.trim() || '';
      const expectedQty = Number(cols[3]?.trim() || '0'); // ← Column 4: Expected Qty
      const soUom = cols[4]?.trim() || ''; // ← Column 5: SO UOM
      const orderedQty = Number(cols[5]?.trim() || '0'); // ← Column 6: Ordered Qty
      const batchNumber = cols[6]?.trim() || ''; // ← Column 7: Batch # (optional)

      if (!itemCode || !itemName || expectedQty <= 0 || !soUom || orderedQty <= 0) {
        errorMsg = `Row ${rowIndex + 1}: Invalid data. Item Code, Item Name, Expected Qty (>0), SO UOM, and Ordered Qty (>0) are required.`;
        return;
      }

      // Look up item by code to auto-fill weight, pallet config, and unit of measure
      const itemData = items.find(i => i.item_code?.toUpperCase() === itemCode.toUpperCase());
      
      if (!itemData) {
        errorMsg = `Row ${rowIndex + 1}: Item code "${itemCode}" not found in Item Master`;
        return;
      }

      // Get weight and pallet config from item master
      const weightUomKg = itemData?.weight_uom_kg || 1;
      const palletConfig = itemData?.pallet_config || itemData?.pallet_qty || 1;

      if (weightUomKg <= 0 || palletConfig <= 0) {
        errorMsg = `Row ${rowIndex + 1}: Item "${itemCode}" has invalid Weight UOM KG (${weightUomKg}) or Pallet Config (${palletConfig})`;
        return;
      }

      // FOR SO ENTRIES: Handle based on SO UOM
      // If SO UOM is KG/KGS, ordered qty is in KG and we need to split by pallet capacity in KG
      // If SO UOM is units, ordered qty is in units and we split by pallet config (units)
      
      let fullPallets = 0;
      let remainder = 0;
      let qtyPerPalletDisplay = palletConfig; // Display quantity per pallet
      
      const isKgBased = soUom.toUpperCase() === 'KG' || soUom.toUpperCase() === 'KGS';
      
      if (isKgBased) {
        // Ordered qty is in KG
        // Pallet capacity in KG = weight per unit × units per pallet
        const capacityPerPalletKg = weightUomKg * palletConfig;
        
        // Split by pallet capacity in KG
        fullPallets = Math.floor(orderedQty / capacityPerPalletKg);
        remainder = orderedQty % capacityPerPalletKg;
        qtyPerPalletDisplay = capacityPerPalletKg; // Show per-pallet capacity, not total
        
        console.log(`📦 SO Paste (KG): Item=${itemCode}, OrderedQty=${orderedQty} KG, CapacityPerPallet=${capacityPerPalletKg} KG, FullPallets=${fullPallets}, Remainder=${remainder} KG`);
      } else {
        // Ordered qty is in units
        fullPallets = Math.floor(orderedQty / palletConfig);
        remainder = orderedQty % palletConfig;
        qtyPerPalletDisplay = palletConfig;
        
        console.log(`📦 SO Paste (Units): Item=${itemCode}, OrderedQty=${orderedQty} units, PalletConfig=${palletConfig} units, FullPallets=${fullPallets}, Remainder=${remainder} units`);
      }

      // Create one SO line per full pallet + one remainder if needed
      for (let i = 0; i < fullPallets; i++) {
        // Convert KG to units for Ordered Qty if needed
        const orderedQtyDisplay = isKgBased ? Math.ceil(qtyPerPalletDisplay / weightUomKg) : qtyPerPalletDisplay;
        
        newRows.push({
          itemCode: itemCode,
          itemName: itemName,
          description: description,
          expectedQuantity: String(orderedQty), // ✅ FIXED: Show total ordered qty, not per-pallet
          quantityExpected: String(orderedQty) as any,
          orderedQuantity: String(orderedQtyDisplay),
          soUom: soUom,
          batchNumber: batchNumber,
          manufacturingDate: '',
          expiryDate: '',
          palletId: '',
          weightUomKg: String(weightUomKg),
          palletConfig: String(palletConfig),
          itemUom: itemData?.item_uom || soUom,
          asnUom: soUom,
          remarks: `Pallet ${i + 1} of ${fullPallets + (remainder > 0 ? 1 : 0)}`,
        });
      }

      // Add remainder pallet if needed
      if (remainder > 0) {
        let remainderQtyDisplay = remainder;
        let remainderConfig = palletConfig;
        
        if (isKgBased) {
          // Remainder is in KG, convert to units for config
          remainderConfig = Math.ceil(remainder / weightUomKg);
          remainderQtyDisplay = remainder; // Keep in KG for display
        } else {
          // Remainder is in units
          remainderConfig = remainder;
        }
        
        // Convert remainder KG to units for Ordered Qty if needed
        const remainderOrderedQtyDisplay = isKgBased ? remainderConfig : remainderQtyDisplay;
        
        newRows.push({
          itemCode: itemCode,
          itemName: itemName,
          description: description,
          expectedQuantity: String(orderedQty), // ✅ FIXED: Show total ordered qty, not remainder
          quantityExpected: String(orderedQty) as any,
          orderedQuantity: String(remainderOrderedQtyDisplay),
          soUom: soUom,
          batchNumber: batchNumber,
          manufacturingDate: '',
          expiryDate: '',
          palletId: '',
          weightUomKg: String(weightUomKg),
          palletConfig: String(remainderConfig),
          itemUom: itemData?.item_uom || soUom,
          asnUom: soUom,
          remarks: `Remainder Pallet (Config: ${remainderConfig})`,
        });
      }
    });

    if (errorMsg) {
      alert(`❌ ${errorMsg}`);
      return;
    }

    if (newRows.length === 0) {
      alert('No valid rows to add');
      return;
    }

    console.log(`✅ SO Paste: Added ${newRows.length} rows`, newRows);
    setRowData(newRows);
    setShowPasteArea(false);
  };

  // Handle paste for records (Received Qty, Batch #, Mfg Date, Expiry Date)
  const handleRecordPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const rows = text.trim().split(/\r?\n/).map(row => row.split('\t'));
    
    // Get selected header ID to filter lines
    if (!selectedHeaderId) {
      alert('Please select an SO header first');
      return;
    }
    
    // Store original state before pasting for later comparison when saving
    setOriginalRecordLines(JSON.parse(JSON.stringify(filteredRecordLines)));
    setPasteDataStatus(null);
    
    // Update filtered lines with pasted data (Received Qty, Batch #, Mfg Date, Expiry Date)
    const updatedLines = filteredRecordLines.map((line, index) => {
      if (index < rows.length) {
        return {
          ...line,
          orderedQuantity: rows[index][0] || line.orderedQuantity,
          batchNumber: rows[index][1] || line.batchNumber,
          manufacturingDate: rows[index][2] || line.manufacturingDate,
          expiryDate: rows[index][3] || line.expiryDate,
        };
      }
      return line;
    });
    
    setFilteredRecordLines(updatedLines);
    
    // Also update lineRecords state
    setLineRecords(prev => {
      return prev.map(line => {
        const updated = updatedLines.find(u => u.id === line.id);
        if (updated) {
          return {
            ...line,
            ordered_quantity: updated.orderedQuantity,
            batch_number: updated.batchNumber,
            manufacturing_date: updated.manufacturingDate,
            expiry_date: updated.expiryDate,
          };
        }
        return line;
      });
    });
    
    // Keep textarea open so user can click Save button - don't automatically hide
    // setShowRecordPasteArea(false);
  };

  // Handle saving pasted data to backend
  const handleSavePastedData = async () => {
    if (originalRecordLines.length === 0) {
      setPasteDataStatus('No pasted data to save');
      return;
    }

    setIsSavingPastedData(true);
    setPasteDataStatus('Saving pasted changes...');

    try {
      let successCount = 0;
      let errorCount = 0;
      const failedLines: string[] = [];

      // Compare each line with original and save changes
      for (const currentLine of filteredRecordLines) {
        const originalLine = originalRecordLines.find(ol => ol.id === currentLine.id);
        if (!originalLine) continue;

        // Check if any of the relevant fields changed
        const receivedQtyChanged = currentLine.orderedQuantity !== originalLine.orderedQuantity;
        const batchNumberChanged = currentLine.batchNumber !== originalLine.batchNumber;
        const mfgDateChanged = currentLine.manufacturingDate !== originalLine.manufacturingDate;
        const expiryDateChanged = currentLine.expiryDate !== originalLine.expiryDate;

        if (
          receivedQtyChanged ||
          batchNumberChanged ||
          mfgDateChanged ||
          expiryDateChanged
        ) {
          // Build PATCH payload with changed fields
          const patchPayload: any = {};

          if (receivedQtyChanged) {
            patchPayload.ordered_quantity = currentLine.orderedQuantity;
          }
          if (batchNumberChanged) {
            patchPayload.batch_number = currentLine.batchNumber;
          }
          if (mfgDateChanged) {
            patchPayload.manufacturing_date = currentLine.manufacturingDate;
          }
          if (expiryDateChanged) {
            patchPayload.expiry_date = currentLine.expiryDate;
          }

          try {
            console.log('PATCH pasted data:', { id: currentLine.id, payload: patchPayload });

            // Use API route instead of direct PostgREST call
            const res = await fetch('/api/patch-record', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                table: 'so_lines',
                id: currentLine.id,
                data: patchPayload,
              }),
            });

            if (!res.ok) {
              const errorText = await res.text();
              console.error('PATCH failed:', errorText);
              errorCount++;
              failedLines.push(`Item ${currentLine.itemCode || currentLine.item_code || 'unknown'}`);
            } else {
              successCount++;
              console.log('PATCH successful for line:', currentLine.id);
            }
          } catch (error) {
            console.error('Error saving line:', error);
            errorCount++;
            failedLines.push(`Item ${currentLine.itemCode || currentLine.item_code || 'unknown'}`);
          }
        }
      }

      // Show status message
      if (errorCount > 0) {
        setPasteDataStatus(
          `Saved ${successCount} lines. Failed: ${errorCount} (${failedLines.join(', ')})`
        );
      } else if (successCount > 0) {
        setPasteDataStatus(`Successfully saved ${successCount} lines!`);
        // Clear the paste area after successful save
        setTimeout(() => {
          setShowRecordPasteArea(false);
          setPasteDataStatus(null);
          setOriginalRecordLines([]);
        }, 2000);
      } else {
        setPasteDataStatus('No changes detected to save');
      }
    } catch (error) {
      console.error('Error during save:', error);
      setPasteDataStatus('Error saving pasted data. Please try again.');
    } finally {
      setIsSavingPastedData(false);
    }
  };

  // Handle Pallet ID Generation
  const handleGeneratePallets = () => {
    setPalletGenError(null);
    
    const { itemCode, itemName, description, asnQty, itemUom, weight, palletConfig } = palletGenFormData;
    
    // Validate inputs
    if (!itemCode || !asnQty || !weight || !palletConfig) {
      setPalletGenError('Please fill in all required fields');
      return;
    }

    const qty = Number(asnQty);
    const wt = Number(weight);
    const cfg = Number(palletConfig);

    if (qty <= 0 || wt <= 0 || cfg <= 0) {
      setPalletGenError('All quantities must be positive numbers');
      return;
    }

    // Calculate pallet count: SO QTY / (WEIGHT * PALLET_CONFIG)
    const palletCount = Math.ceil(qty / (wt * cfg));
    
    if (palletCount <= 0) {
      setPalletGenError('Pallet count calculation resulted in 0 or negative');
      return;
    }

    // Generate Pallet IDs with format: PAL-YYMMDDHHmmSS-{increment}
    const now = new Date();
    const timestamp = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    
    // Create rows for each pallet
    const newRows: SOLine[] = Array.from({ length: palletCount }, (_, index) => ({
      itemCode,
      itemName,
      description,
      expectedQuantity: String(qty),
      orderedQuantity: '',
      batchNumber: '',
      manufacturingDate: '',
      expiryDate: '',
      palletId: `PAL-${timestamp}-${String(index + 1).padStart(3, '0')}`,
      weightUomKg: String(wt),
      palletConfig: String(cfg),
      itemUom,
      asnUom: itemUom,
      remarks: '',
    }));

    setRowData(newRows);
    setShowPalletGeneration(false);
    setPalletGenFormData({
      itemCode: '',
      itemName: '',
      description: '',
      asnQty: '',
      itemUom: '',
      weight: '',
      palletConfig: '',
    });
  };

      // (removed stray JSX, only keep in return statement)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    // Validate SO Date
    if (!header.soDate) {
      setLoading(false);
      setError('SO Date is required. Please select a valid date.');
      return;
    }
    try {
      // Validate SO lines first
      const filteredRows = rowData.filter(row => row.itemCode !== '');
      const asnLinesPayload = filteredRows.map(row => {
        const itemData = items.find(i => i.item_code === row.itemCode);
        return {
          item_id: itemData?.id || null,
          item_code: itemData?.item_code || row.itemCode || null,
          item_name: itemData?.item_name || row.itemName || null,
          item_uom: itemData?.item_uom || null,
          ordered_quantity: row.orderedQuantity ? Number(row.orderedQuantity) : (row.expectedQuantity ? Number(row.expectedQuantity) : null),
          batch_number: row.batchNumber || null,
          required_expiry_date: row.expiryDate ? row.expiryDate.slice(0, 10) : null,
          pallet_id: row.palletId || null,
          weight_uom_kg: row.weightUomKg ? Number(row.weightUomKg) : null,
          pallet_config: row.palletConfig || null,
          notes: row.remarks || null,
        };
      });

      console.log('SO lines payload:', asnLinesPayload);
      if (asnLinesPayload.length === 0) {
        setLoading(false);
        setError('No valid SO line items to submit. Please fill in at least one Item ID.');
        return;
      }

      // 1. Insert SO header
      // headerId is auto-generated by backend
      const customer = customers.find(c => c.id === header.customerId);
      const generateUniqueBarcode = () => `SO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const soHeaderPayload = {
        so_number: header.soNumber,
        customer_id: header.customerId,
        customer_code: customer?.customer_code || customer?.code || '',
        customer_name: customer?.customer_name || customer?.name || '',
        warehouse_id: warehouseFilter ? parseInt(warehouseFilter) : 1,
        so_date: header.soDate,
        status: header.status,
        barcode: header.barcode ? header.barcode : generateUniqueBarcode(),
        notes: header.remarks
      };

      const headerRes = await postSOHeader(soHeaderPayload);
      
      if (!headerRes.ok) {
        const headerText = await headerRes.text();
        setLoading(false);
        setError(`Failed to insert SO header. Status: ${headerRes.status}, Response: ${headerText.slice(0, 500)}`);
        return;
      }

      const headerData = await headerRes.json();
      const so_header_id = headerData?.data?.id;
      if (!so_header_id) {
        console.error('❌ No header ID in response:', headerData);
        setLoading(false);
        setError('Header created but ID not found in response.');
        return;
      }

      console.log(`✅ SO header created with ID: ${so_header_id}`);

      // Now insert SO lines with correct header id
      const asnLinesPayloadWithHeader = asnLinesPayload.map(line => ({ ...line, so_header_id }));

      console.log('Submitting SO lines to:', urlLines);
      console.log('SO lines payload with header:', asnLinesPayloadWithHeader);
      const linesRes = await postSOLines(asnLinesPayloadWithHeader);

      if (!linesRes.ok) {
        const linesText = await linesRes.text();
        console.error('SO lines response error:', { status: linesRes.status, response: linesText });
        setLoading(false);
        setError(`Failed to insert SO lines. Status: ${linesRes.status}, Response: ${linesText.slice(0, 500)}`);
        return;
      }

      console.log(`✅ SO lines created: ${asnLinesPayloadWithHeader.length} lines`);

      setSuccess(true);
      // Clear cache and reload to show new record
      const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
      await fetch(`/api/outbound-records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, action: 'clear' }),
      }).catch(err => console.log('Note: Cache clear request sent'));
      
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      setError(err.message);
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="p-4 bg-gray-100 min-h-screen">
      {/* Paste Value Modal */}
      {showPasteArea && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-2xl">
            <h2 className="text-2xl font-bold mb-4">Paste SO Entry Data</h2>
            <p className="text-sm text-gray-600 mb-2">Paste tab-separated data from Excel. Format: Item Code | Item Name | Description | Expected Qty | SO UOM | Ordered Qty | Batch # (optional)</p>
            <p className="text-xs text-gray-500 mb-4">⚡ Conversion to multiple rows happens automatically based on UOM and Pallet Config from Item Master</p>
            <textarea
              ref={pasteTextareaRef}
              onPaste={handlePaste}
              placeholder="Example:&#10;CC5001	Coca-Cola Bottle	Beverage	200	BOX	150	BAT-7&#10;MC9119	Takis Intense	Snack	150	CASE	120	BAT-8"
              className="w-full h-48 border rounded p-3 text-sm font-mono mb-4"
            />
            <p className="text-xs text-gray-500 mb-4">Each row represents a unit based on: Qty ÷ (Weight from Item Master × Pallet Config)</p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowPasteArea(false)}
                className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Side-by-side SO Entry Block */}
      <div className="w-full bg-white rounded-lg border shadow p-6" style={{ width: '100%', minWidth: 0 }}>
        <div className="flex items-center justify-between mb-4 cursor-pointer" onClick={() => setIsOutboundEntryExpanded(!isOutboundEntryExpanded)}>
          <h2 className="text-2xl font-bold">Outbound Entry</h2>
          <span className="text-gray-600 text-xl">{isOutboundEntryExpanded ? '▼' : '▶'}</span>
        </div>
        {isOutboundEntryExpanded && (
        <div className="flex flex-row gap-6" style={{ width: '100%', minWidth: 0 }}>
        {/* Header Fields (left column, auto) */}
        <div className="min-w-0" style={{ flex: '0 0 auto', minWidth: 0 }}>
          <form className="grid grid-cols-1 gap-2" style={{ maxWidth: '280px' }}>
            {clientReady && (
              <></>
            )}
            {/* Customer Searchable Dropdown */}
            <div>
              <label className="block text-sm font-medium mb-0.5">Customer</label>
              <div className="relative">
                <div className="flex items-center border rounded">
                  <input
                    ref={customerInputRef}
                    type="text"
                    placeholder="Search customer..."
                    value={customerSearchInput}
                    onChange={e => {
                      setCustomerSearchInput(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    className="flex-1 px-4 py-3 text-base border-none outline-none rounded-l"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCustomerDropdown(!showCustomerDropdown)}
                    className="px-4 py-3 text-gray-500 hover:text-gray-700 transition-colors"
                    title={showCustomerDropdown ? 'Collapse' : 'Expand'}
                  >
                    {showCustomerDropdown ? '▲' : '▼'}
                  </button>
                </div>
                {showCustomerDropdown && filteredCustomers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-t-0 rounded-b shadow-lg z-10 max-h-40 overflow-y-auto">
                    {filteredCustomers.map(c => (
                      <div
                        key={c.id}
                        onClick={() => {
                          setHeader(h => ({
                            ...h,
                            customerId: c.id,
                          }));
                          setCustomerSearchInput(`${c.customer_code || c.code} - ${c.customer_name || c.name}`);
                          setShowCustomerDropdown(false);
                        }}
                        className="px-3 py-2 hover:bg-blue-100 cursor-pointer text-sm border-b last:border-b-0"
                      >
                        {c.customer_code || c.code} - {c.customer_name || c.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-0.5">DR/SO Number</label>
              <input 
                type="text" 
                value={header.soNumber} 
                onChange={e => handleHeaderChange('soNumber', e.target.value)} 
                placeholder="Enter SO number" 
                className="border px-4 py-3 text-base w-full rounded" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-0.5">SO Date</label>
              <input type="date" value={header.soDate} onChange={e => handleHeaderChange('soDate', e.target.value)} className="border px-4 py-3 text-base w-full rounded" />
            </div>
          </form>
          {/* Action Buttons - Above Save Button */}
          <div className="flex flex-col gap-2 mt-4">
            <button
              type="button"
              className="bg-sky-500 text-white px-4 py-3 text-base rounded shadow font-semibold hover:bg-sky-600 active:bg-sky-700 active:scale-95 transition-all duration-100"
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                setRowData([...rowData, {
                  itemCode: '',
                  itemName: '',
                  description: '',
                  expectedQuantity: '',
                  orderedQuantity: '',
                  batchNumber: '',
                  manufacturingDate: today,
                  expiryDate: today,
                  palletId: '',
                  weightUomKg: '',
                  palletConfig: '',
                  itemUom: '',
                  asnUom: '',
                  remarks: '',
                }]);
              }}
              style={{ display: 'none' }}
            >Add Row</button>
            <button
              type="button"
              className="text-white px-4 py-3 text-base rounded shadow font-semibold active:scale-95 transition-all duration-100"
              style={{ backgroundColor: '#008ecc', opacity: ['Received', 'Complete'].includes(header.status) ? 0.6 : 1 }}
              onMouseEnter={(e) => !['Received', 'Complete'].includes(header.status) && (e.currentTarget.style.filter = 'brightness(0.9)')}
              onMouseLeave={(e) => !['Received', 'Complete'].includes(header.status) && (e.currentTarget.style.filter = 'brightness(1)')}
              onClick={() => {
                setRowData([]);
                setShowPasteArea(true);
              }}
              disabled={['Received', 'Complete'].includes(header.status)}
              title={['Received', 'Complete'].includes(header.status) ? 'Not available for this status' : ''}
            >Paste Values</button>
            <button
              type="button"
              className="text-white px-4 py-3 text-base rounded shadow font-semibold active:scale-95 transition-all duration-100"
              style={{ backgroundColor: '#008ecc', opacity: ['Received', 'Complete'].includes(header.status) ? 0.6 : 1 }}
              onMouseEnter={(e) => !['Received', 'Complete'].includes(header.status) && (e.currentTarget.style.filter = 'brightness(0.9)')}
              onMouseLeave={(e) => !['Received', 'Complete'].includes(header.status) && (e.currentTarget.style.filter = 'brightness(1)')}
              onClick={() => {
                if (window.confirm('Are you sure you want to delete selected rows?')) {
                  const selectedNodes = gridRef.current?.api?.getSelectedNodes() || [];
                  if (selectedNodes.length > 0) {
                    const selectedIndexes = new Set(selectedNodes.map(node => node.rowIndex));
                    const newRowData = rowData.filter((_, index) => !selectedIndexes.has(index));
                    setRowData(newRowData);
                  }
                }
              }}
              disabled={['Received', 'Complete'].includes(header.status)}
              title={['Received', 'Complete'].includes(header.status) ? 'Not available for this status' : ''}
            >Delete Selected</button>
            <button
              type="button"
              className="text-white px-4 py-3 text-base rounded shadow font-semibold active:scale-95 transition-all duration-100"
              style={{ backgroundColor: '#008ecc' }}
              onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.9)'}
              onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
              onClick={() => {
                if (window.confirm('Are you sure you want to clear the entire form?')) {
                  setRowData([]);
                  setHeader({
                    soNumber: '',
                    barcode: '',
                    customerId: null,
                    soDate: new Date().toISOString().split('T')[0],
                    status: 'New',
                    remarks: '',
                  });
                  setCustomerSearchInput('');
                  setEntrySubmitStatus('');
                }
              }}
            >Clear Form</button>
          </div>
          {/* Save Button */}
          <button
            type="button"
            className="text-white px-4 py-3 text-base rounded shadow font-semibold w-full mt-3 active:scale-95 transition-all duration-100"
            style={{ backgroundColor: '#008ecc' }}
            onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.9)'}
            onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
            onClick={() => {
              setShowEntryConfirmation(true);
              setIsConfirmed(false);
            }}
          >
            Save
          </button>
          {entrySubmitStatus && (
            <div className="mt-2 text-sm font-semibold p-2 rounded" style={{ background: '#f3f4f6', color: entrySubmitStatus.startsWith('Error') || entrySubmitStatus.includes('failed') ? '#dc2626' : '#059669' }}>
              {entrySubmitStatus}
            </div>
          )}
        </div>

        {/* AG Grid Entry (right column, flex 1) */}
        <div className="min-w-0" style={{ flex: '1 1 auto', minWidth: 0 }}>
          {showPasteArea && (
            <textarea
              ref={pasteTextareaRef}
              onPaste={handlePaste}
              onBlur={() => setShowPasteArea(false)}
              rows={3}
              className="border rounded p-2 text-sm mb-4"
              placeholder="Paste here (Ctrl+V)..."
              style={{ minWidth: 300, width: '100%' }}
            />
          )}
          <div className="ag-theme-alpine" style={{ width: '100%', minWidth: 0, height: 500, background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px' }}>
            <AgGridReact
              theme="legacy"
              ref={gridRef}
              rowData={rowData}
              columnDefs={columnDefs}
              defaultColDef={{ resizable: true, sortable: true, filter: true, editable: true }}
              pagination={true}
              paginationPageSize={100}
              onCellValueChanged={async params => {
                const rowIndex = params.node?.rowIndex;
                if (rowIndex !== null && rowIndex !== undefined) {
                  const updatedRows = [...rowData];
                  const data = { ...params.data };
                  const field = params.colDef.field;
                  if (field) {
                    // Prepare PATCH payload for backend
                    const patchPayload = { [field]: params.newValue };
                    if (data.id) {
                      try {
                        const res = await fetch('/api/patch-record', {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            table: 'so_lines',
                            id: data.id,
                            data: patchPayload,
                          }),
                        });
                        if (res.ok) {
                          updatedRows[rowIndex][field] = params.newValue;
                          setRowData(updatedRows);
                        } else {
                          // Optionally show error
                        }
                      } catch {
                        // Optionally show error
                      }
                    } else {
                      // For new rows not yet in backend, just update local data
                      updatedRows[rowIndex][field] = params.newValue;
                      setRowData(updatedRows);
                    }
                  }
                }
              }}
              stopEditingWhenCellsLoseFocus={true}
              suppressRowClickSelection={true}
              rowSelection='multiple'
            />
          </div>
          {/* Add Rows Section Below Grid */}
          <div className="mt-4 flex gap-2 items-center">
            <input
              type="number"
              min="1"
              max="100"
              defaultValue="1"
              id="addRowsCount"
              className="border px-3 py-2 rounded text-sm w-24"
              placeholder="Rows"
            />
            <button
              type="button"
              className="text-white px-4 py-2 text-sm rounded shadow font-semibold active:scale-95 transition-all duration-100"
              style={{ backgroundColor: '#008ecc' }}
              onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.9)'}
              onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
              onClick={() => {
                const count = parseInt((document.getElementById('addRowsCount') as HTMLInputElement)?.value || '1', 10);
                const today = new Date().toISOString().slice(0, 10);
                const newRows = Array.from({ length: count }, () => ({
                  itemCode: '',
                  itemName: '',
                  description: '',
                  expectedQuantity: '',
                  orderedQuantity: '',
                  batchNumber: '',
                  manufacturingDate: today,
                  expiryDate: today,
                  palletId: '',
                  weightUomKg: '',
                  palletConfig: '',
                  itemUom: '',
                  asnUom: '',
                  remarks: '',
                }));
                setRowData([...rowData, ...newRows]);
              }}
            >
              Add Rows
            </button>
          </div>
        </div>
        </div>
        )}
      </div>

      {/* Entry Confirmation Modal */}
      {showEntryConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
            <h2 className="text-lg font-bold mb-4">Confirm SO Entry Submission</h2>
            <p className="text-gray-700 mb-6">
              Are you sure you want to submit this SO entry? <br />
              <span className="font-semibold text-sm mt-2 block">
                Customer: {customers.find(c => c.id === header.customerId)?.customer_name || customers.find(c => c.id === header.customerId)?.name || 'N/A'} <br />
                Items: {rowData.filter(r => r.itemCode).length} lines
              </span>
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                className="flex-1 px-4 py-2 rounded font-semibold text-white"
                style={{ backgroundColor: '#008ecc' }}
                onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.9)'}
                onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                onClick={async () => {
                  setShowEntryConfirmation(false);
                  setLoading(true);
                  setEntrySubmitStatus(null);
                  try {
                    if (!header.soDate) {
                      setLoading(false);
                      setEntrySubmitStatus('SO Date is required.');
                      return;
                    }
                    if (!header.customerId) {
                      setLoading(false);
                      setEntrySubmitStatus('Customer is required.');
                      return;
                    }
                    const customer = customers.find(c => c.id === header.customerId);
                    const generateUniqueBarcode = () => `SO-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    const soHeaderPayload = {
                      so_number: header.soNumber,
                      customer_id: header.customerId,
                      customer_code: customer?.customer_code || customer?.code || '',
                      customer_name: customer?.customer_name || customer?.name || '',
                      warehouse_id: warehouseFilter ? parseInt(warehouseFilter) : 1,
                      so_date: header.soDate,
                      status: header.status,
                      barcode: header.barcode ? header.barcode : generateUniqueBarcode(),
                      notes: header.remarks
                    };
                    const filteredRows = rowData.filter(row => row.itemCode);
                    const soLinesPayload = filteredRows.map(row => {
                      const itemData = items.find(i => i.item_code === row.itemCode);
                      return {
                        item_id: itemData?.id || null,
                        item_code: itemData?.item_code || row.itemCode || null,
                        item_name: itemData?.item_name || row.itemName || null,
                        item_uom: itemData?.item_uom || null,
                        expected_quantity: row.expectedQuantity ? Number(row.expectedQuantity) : null, // ← Added
                        so_uom: row.soUom || null, // ← Added
                        ordered_quantity: row.orderedQuantity ? Number(row.orderedQuantity) : null,
                        batch_number: row.batchNumber || null,
                        required_expiry_date: row.expiryDate ? row.expiryDate.slice(0, 10) : null,
                        pallet_id: row.palletId || null,
                        weight_uom_kg: row.weightUomKg ? Number(row.weightUomKg) : null,
                        pallet_config: row.palletConfig || null,
                        notes: row.remarks || null,
                      };
                    });
                    if (soLinesPayload.length === 0) {
                      setLoading(false);
                      setEntrySubmitStatus('No valid SO line items to submit.');
                      return;
                    }
                    const headerRes = await postSOHeader(soHeaderPayload);
                    if (!headerRes.ok) {
                      const headerText = await headerRes.text();
                      console.error('SO Header POST Response Error:', { status: headerRes.status, body: headerText, payload: soHeaderPayload });
                      setLoading(false);
                      setEntrySubmitStatus(`Header insert failed: ${headerRes.status} - ${headerText.slice(0, 500)}`);
                      return;
                    }
                    
                    const headerData = await headerRes.json();
                    const so_header_id = headerData?.data?.id;
                    if (!so_header_id) {
                      console.error('❌ No header ID in response:', headerData);
                      setLoading(false);
                      setEntrySubmitStatus('Header created but ID not found in response.');
                      return;
                    }
                    console.log(`✅ SO header created with ID: ${so_header_id}`);
                    const soLinesPayloadWithHeader = soLinesPayload.map((line: any) => ({ ...line, so_header_id }));
                    console.log('📤 Sending SO Lines Payload:', JSON.stringify(soLinesPayloadWithHeader, null, 2));
                    const linesRes = await postSOLines(soLinesPayloadWithHeader);
                    
                    if (!linesRes.ok) {
                      const linesText = await linesRes.text();
                      console.error('📥 SO Lines Response Status:', linesRes.status);
                      console.error('📥 SO Lines Response Body:', linesText);
                      setLoading(false);
                      setEntrySubmitStatus(`Lines insert failed: ${linesRes.status} - ${linesText.slice(0, 500)}`);
                      return;
                    }
                    setEntrySubmitStatus('SO entry submitted successfully!');
                    setLoading(false);
                    
                    // Clear cache and fetch fresh records
                    try {
                      const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
                      const warehouse = searchParams?.get('warehouse');
                      // Clear server cache
                      await fetch(`/api/outbound-records`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ year, action: 'clear' }),
                      });

                      // Fetch fresh data from cached API with refresh flag and warehouse filter
                      const freshUrl = `/api/outbound-records?year=${year}&refresh=true${warehouse ? `&warehouse=${warehouse}` : ''}`;
                      const freshRes = await fetch(freshUrl);
                      const freshData = await freshRes.json();
                      
                      if (freshRes.ok) {
                        setHeaderRecords(Array.isArray(freshData.headers) ? freshData.headers : []);
                        setLineRecords(Array.isArray(freshData.lines) ? freshData.lines : []);
                        console.log('✅ Refreshed records after save. New count:', freshData.headers.length, 'headers');
                      }
                    } catch (err) {
                      console.log('⚠️ Warning: Could not fully refresh cached records, but data was saved to database');
                    }

                    // Auto clear the form after successful save
                    setTimeout(() => {
                      setRowData([]);
                      setHeader({
                        soNumber: '',
                        barcode: '',
                        customerId: null,
                        soDate: new Date().toISOString().split('T')[0],
                        status: 'New',
                        remarks: '',
                      });
                      setCustomerSearchInput('');
                      setEntrySubmitStatus('');
                    }, 1500);
                  } catch (err: any) {
                    setLoading(false);
                    setEntrySubmitStatus(`Error: ${err.message}`);
                  }
                }}
              >
                ✓ Confirm & Save
              </button>
              <button
                type="button"
                className="flex-1 px-4 py-2 rounded font-semibold text-gray-700 bg-gray-200"
                onClick={() => setShowEntryConfirmation(false)}
              >
                ✕ Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receiving Confirmation Modal */}
        {showReceivingConfirmation && receivingConfirmationHeaderId && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '1400px', maxHeight: '95vh', overflowY: 'auto' }}>
              {(() => {
                const header = headerRecords.find(h => h.id === receivingConfirmationHeaderId);
                const lines = lineRecords.filter(l => l.so_header_id === receivingConfirmationHeaderId);
                
                if (!header) return <div>Header not found</div>;
                
                // Calculate totals
                const totalExpectedQty = lines.reduce((sum, line) => sum + (line.ordered_quantity || 0), 0);
                const totalReceivedQty = lines.reduce((sum, line) => sum + (line.ordered_quantity || 0), 0);
                
                return (
                  <div className="flex flex-col">
                    {/* Header with Title and Barcode */}
                    <div className="flex items-start justify-between mb-3 border-b pb-2 bg-white">
                      <div>
                        <h1 className="text-2xl font-bold mb-1 text-black">RECEIVING CONFIRMATION</h1>
                        <p className="text-xs text-gray-800">Goods Receiving Summary</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-800 uppercase font-semibold mb-1">SO Barcode</p>
                        {/* <SOBarcode value={header.barcode} /> */}
                        <p className="text-sm font-mono text-black">{header.barcode}</p>
                      </div>
                    </div>

                    {/* Receipt Information Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mb-3 pb-2 border-b bg-white">
                      <div>
                        <p className="text-xs text-gray-800 font-semibold">SO Number</p>
                        <p className="text-sm font-bold text-black">{header.so_number}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 font-semibold">SO Date</p>
                        <p className="text-sm font-bold text-black">{new Date(header.asn_date).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 font-semibold">Status</p>
                        <p className="text-sm font-bold text-black">{header.status}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 font-semibold">Vendor Code</p>
                        <p className="text-sm font-bold text-black">{header.vendor_code}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 font-semibold">Vendor Name</p>
                        <p className="text-sm font-bold text-black">{header.vendor_name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 font-semibold">PO Number</p>
                        <p className="text-sm font-bold text-black">{header.po_number}</p>
                      </div>
                    </div>

                    {/* Items Table with All Fields */}
                    <div className="mb-6">
                      <h3 className="text-lg font-bold mb-3 uppercase text-black">Received Items</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-gray-400 text-xs bg-white">
                          <thead>
                            <tr className="bg-gray-300">
                              <th className="border border-gray-400 px-2 py-1 text-left font-bold text-black">Item Code</th>
                              <th className="border border-gray-400 px-2 py-1 text-left font-bold text-black">Item Name</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Expected Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Received Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Batch #</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Mfg Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Expiry Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Pallet ID</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Item UOM</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.length > 0 ? (
                              lines.map((line, idx) => (
                                <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                  <td className="border border-gray-400 px-2 py-1 text-black">{line.item_code || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-black">{line.item_name || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.ordered_quantity || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.ordered_quantity || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.batch_number || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.manufacturing_date ? new Date(line.manufacturing_date).toLocaleDateString() : ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.expiry_date ? new Date(line.expiry_date).toLocaleDateString() : ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.pallet_id || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.item_uom || ''}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={9} className="border border-gray-400 px-2 py-1 text-center text-gray-800">
                                  No items found
                                </td>
                              </tr>
                            )}
                            {/* Totals Row */}
                            <tr className="bg-gray-300 font-bold">
                              <td colSpan={2} className="border border-gray-400 px-2 py-1 text-right text-black">TOTALS:</td>
                              <td className="border border-gray-400 px-2 py-1 text-center text-black">{totalExpectedQty}</td>
                              <td className="border border-gray-400 px-2 py-1 text-center text-black">{totalReceivedQty}</td>
                              <td colSpan={5} className="border border-gray-400 px-2 py-1"></td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-6 flex gap-3 justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          const printWindow = window.open('', '_blank');
                          if (printWindow) {
                            // Build items table from lines
                            let tableRowsHtml = '';
                            if (lines && lines.length > 0) {
                              tableRowsHtml = lines.map((line, idx) => `
                                <tr>
                                  <td>${line.item_code || ''}</td>
                                  <td>${line.item_name || ''}</td>
                                  <td>${line.ordered_quantity || ''}</td>
                                  <td>${line.ordered_quantity || ''}</td>
                                  <td>${line.batch_number || ''}</td>
                                  <td>${line.manufacturing_date ? new Date(line.manufacturing_date).toLocaleDateString() : ''}</td>
                                  <td>${line.expiry_date ? new Date(line.expiry_date).toLocaleDateString() : ''}</td>
                                  <td>${line.pallet_id || ''}</td>
                                  <td>${line.item_uom || ''}</td>
                                </tr>
                              `).join('');
                            }
                            
                            const htmlContent = `
                              <!DOCTYPE html>
                              <html>
                              <head>
                                <meta charset="UTF-8">
                                <title>RECEIVING CONFIRMATION - ${header?.so_number || 'N/A'}</title>
                                <style>
                                  body { font-family: Arial, sans-serif; margin: 20px; }
                                  h1 { font-size: 22px; margin-bottom: 10px; }
                                  .subtitle { font-size: 12px; color: #666; margin-bottom: 15px; }
                                  .barcode-section { text-align: right; margin-bottom: 15px; }
                                  .barcode-section .label { font-size: 11px; font-weight: bold; color: #666; }
                                  .barcode-section .value { font-size: 14px; font-weight: bold; font-family: monospace; }
                                  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 15px; border-bottom: 1px solid #999; padding-bottom: 15px; }
                                  .info-field .label { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #666; }
                                  .info-field .value { font-size: 13px; font-weight: bold; color: #000; }
                                  table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                                  th, td { border: 1px solid #999; padding: 8px; text-align: left; font-size: 11px; }
                                  th { background-color: #ddd; font-weight: bold; text-align: center; }
                                  td { text-align: center; }
                                  td:nth-child(1), td:nth-child(2) { text-align: left; }
                                  tr:nth-child(even) { background-color: #f9f9f9; }
                                  .footer { margin-top: 20px; text-align: center; font-size: 11px; border-top: 1px solid #999; padding-top: 15px; }
                                  @media print { body { margin: 0; } }
                                </style>
                              </head>
                              <body>
                                <h1>RECEIVING CONFIRMATION</h1>
                                <p class="subtitle">Goods Receiving Summary</p>
                                
                                <div class="barcode-section">
                                  <div class="label">SO Barcode</div>
                                  <div class="value">${header?.barcode || 'N/A'}</div>
                                </div>
                                
                                <div class="info-grid">
                                  <div class="info-field">
                                    <div class="label">SO Number</div>
                                    <div class="value">${header?.so_number || '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">SO Date</div>
                                    <div class="value">${header?.asn_date ? new Date(header.asn_date).toLocaleDateString() : '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">Status</div>
                                    <div class="value">${header?.status || '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">Vendor Code</div>
                                    <div class="value">${header?.vendor_code || '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">Vendor Name</div>
                                    <div class="value">${header?.vendor_name || '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">PO Number</div>
                                    <div class="value">${header?.po_number || '-'}</div>
                                  </div>
                                </div>
                                
                                <h3 style="font-size: 14px; margin: 15px 0 10px 0; font-weight: bold;">Received Items</h3>
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Item Code</th>
                                      <th>Item Name</th>
                                      <th>Expected Qty</th>
                                      <th>Received Qty</th>
                                      <th>Batch #</th>
                                      <th>Mfg Date</th>
                                      <th>Expiry Date</th>
                                      <th>Pallet ID</th>
                                      <th>Item UOM</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${tableRowsHtml}
                                  </tbody>
                                </table>
                                
                                <div class="footer">
                                  <p style="margin: 0;">Generated on: ${new Date().toLocaleString()}</p>
                                </div>
                              </body>
                              <script>
                                window.onload = function() {
                                  window.print();
                                };
                              </script>
                              </html>
                            `;
                            printWindow.document.write(htmlContent);
                            printWindow.document.close();
                          }
                        }}
                        className="px-6 py-2 bg-purple-600 text-white rounded font-semibold hover:bg-purple-700"
                      >
                        Print
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReceivingConfirmation(false)}
                        className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
        
        {/* Pallet Tag Modal */}
        {showPalletTag && palletTagHeaderId && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <div className="bg-white rounded-lg shadow-lg p-12 my-8" style={{ width: '600px' }}>
              {(() => {
                const header = headerRecords.find(h => h.id === palletTagHeaderId);
                
                if (!header) return <div>Header not found</div>;
                
                return (
                  <div className="flex flex-col items-center justify-center">
                    {/* Title */}
                    <h1 className="text-4xl font-bold mb-8 uppercase">Pallet Tag</h1>
                    
                    {/* Barcode */}
                    <div className="mb-8">
                      {/* <SOBarcode value={header.barcode} /> */}
                      <p className="text-2xl font-mono border border-gray-300 p-4 rounded">{header.barcode}</p>
                    </div>
                    
                    {/* Vendor Information - Large Font */}
                    <div className="text-center mb-6 border-b-2 border-gray-400 pb-4 w-full">
                      <p className="text-sm text-gray-600 font-semibold mb-2">VENDOR</p>
                      <p className="text-3xl font-bold">{header.vendor_name}</p>
                      <p className="text-lg text-gray-700 mt-2">{header.vendor_code}</p>
                    </div>
                    
                    {/* PO Number - Large Font */}
                    <div className="text-center mb-6 border-b-2 border-gray-400 pb-4 w-full">
                      <p className="text-sm text-gray-600 font-semibold mb-2">PO NUMBER</p>
                      <p className="text-4xl font-bold">{header.po_number}</p>
                    </div>
                    
                    {/* SO Date - Large Font */}
                    <div className="text-center mb-8 pb-4 w-full">
                      <p className="text-sm text-gray-600 font-semibold mb-2">RECEIVED DATE</p>
                      <p className="text-3xl font-bold">{new Date(header.asn_date).toLocaleDateString()}</p>
                    </div>
                    
                    {/* Pallet IDs - Large Font */}
                    {(() => {
                      const lines = lineRecords.filter(l => l.so_header_id === palletTagHeaderId);
                      const palletIds = [...new Set(lines.map(l => l.pallet_id).filter(Boolean))];
                      
                      return palletIds.length > 0 ? (
                        <div className="text-center mb-8 pb-4 w-full border-b-2 border-gray-400">
                          <p className="text-sm text-gray-600 font-semibold mb-3">PALLET ID{palletIds.length > 1 ? 'S' : ''}</p>
                          <div className="flex flex-col gap-2">
                            {palletIds.map((palletId, idx) => (
                              <p key={idx} className="text-4xl font-bold text-blue-700">{palletId}</p>
                            ))}
                          </div>
                        </div>
                      ) : null;
                    })()}
                    
                    {/* Action Buttons */}
                    <div className="mt-8 flex gap-3 justify-center w-full">
                      <button
                        type="button"
                        onClick={() => {
                          const printWindow = window.open('', '_blank');
                          if (printWindow) {
                            // Get pallet IDs from lines for this header
                            const lines = lineRecords.filter(l => l.so_header_id === palletTagHeaderId);
                            const palletIds = [...new Set(lines.map(l => l.pallet_id).filter(Boolean))];
                            
                            let palletHtml = palletIds.length > 0 ? palletIds.map(id => 
                              `<div style="page-break-inside: avoid; margin-bottom: 30px; text-align: center; border: 2px solid #333; padding: 20px; background-color: #f0f0f0;">
                                <h2 style="margin: 0; font-size: 16px;">PALLET ID</h2>
                                <p style="font-size: 32px; font-weight: bold; color: #0066cc; margin: 10px 0; font-family: monospace;">${id}</p>
                                <p style="font-size: 12px; color: #666; margin: 0;">Generated: ${new Date().toLocaleString()}</p>
                              </div>`
                            ).join('') : '<p>No pallet IDs to display</p>';
                            
                            const htmlContent = `
                              <!DOCTYPE html>
                              <html>
                              <head>
                                <meta charset="UTF-8">
                                <title>PALLET TAGS</title>
                                <style>
                                  body { font-family: Arial, sans-serif; margin: 20px; background: white; }
                                  h1 { text-align: center; font-size: 28px; margin-bottom: 20px; }
                                  @media print { 
                                    body { margin: 0; }
                                    .pallet-tag { page-break-after: always; }
                                  }
                                </style>
                              </head>
                              <body>
                                <h1>PALLET TAGS</h1>
                                ${palletHtml}
                              </body>
                              <script>
                                window.onload = function() {
                                  window.print();
                                };
                              </script>
                              </html>
                            `;
                            printWindow.document.write(htmlContent);
                            printWindow.document.close();
                          }
                        }}
                        className="px-8 py-3 bg-yellow-600 text-white rounded font-bold text-lg hover:bg-yellow-700"
                      >
                        Print
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPalletTag(false)}
                        className="px-8 py-3 bg-gray-400 text-white rounded font-bold text-lg hover:bg-gray-500"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
        
        {/* Batch Allocation Modal */}
        {showAllocationModal && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '900px', maxHeight: '95vh', overflowY: 'auto' }}>
              <h3 className="text-2xl font-bold mb-6">🔄 Batch Allocation Workflow</h3>
              
              {allocationLoading && <p className="text-sm text-blue-600 mb-4">⏳ Processing allocation...</p>}
              
              {/* Allocation Rules - Automatic Detection */}
              <div className="mb-6 p-4 bg-gradient-to-r from-blue-50 to-cyan-50 rounded border border-blue-200">
                <p className="text-sm font-semibold text-gray-800">✅ Allocation Rules Applied Automatically (STRICT PRIORITY)</p>
                <div className="mt-2 text-xs text-gray-700 space-y-1">
                  <p><strong>Rule 1 (Highest Priority):</strong> If Batch Lookup enabled → Use <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-800 rounded font-semibold">📦 BATCH</span></p>
                  <p><strong>Rule 2 (2nd Priority):</strong> If Batch Lookup disabled + at least ONE batch has valid expiry → Use <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-semibold">📅 FEFO</span></p>
                  <p><strong>Rule 3 (3rd Priority):</strong> If Batch Lookup disabled + NO valid expiry (all expired/null) → Use <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-800 rounded font-semibold">⏱️ FIFO</span></p>
                </div>
              </div>

              {/* Process Allocation Button */}
              {!allocationPreviewMode && (
                <div className="mb-6 flex justify-end">
                  <button
                    type="button"
                    className={`px-6 py-3 rounded text-base font-semibold text-white active:scale-95 transition-all duration-100 ${allocationLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    style={{ backgroundColor: '#0066cc', opacity: allocationLoading ? 0.6 : 1 }}
                    onMouseEnter={(e) => !allocationLoading && (e.currentTarget.style.filter = 'brightness(0.9)')}
                    onMouseLeave={(e) => !allocationLoading && (e.currentTarget.style.filter = 'brightness(1)')}
                    disabled={allocationLoading || currentBatches.length === 0}
                    onClick={handleProcessAllocation}
                  >
                    {allocationLoading ? '⏳ Processing...' : '🚀 Process Allocation'}
                  </button>
                </div>
              )}

              {/* SO Lines to Allocate */}
              <div className="mb-6">
                <p className="text-sm font-semibold mb-3">📋 SO Lines to Allocate</p>
                {allocationHeaderId && (
                  <div className="border rounded overflow-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-3 py-2 text-left">Item Code</th>
                          <th className="px-3 py-2 text-left">Item Name</th>
                          <th className="px-3 py-2 text-right">Qty Needed</th>
                          <th className="px-3 py-2 text-left">UOM</th>
                          <th className="px-3 py-2 text-left">Batch #</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineRecords
                          .filter(l => l.so_header_id === allocationHeaderId)
                          .map(line => {
                            // Fallback to lookup from items if not enriched
                            const itemCode = line.item_code || (line.item_id && items.find(i => i.id === line.item_id)?.item_code) || '-';
                            const itemName = line.item_name || (line.item_id && items.find(i => i.id === line.item_id)?.item_name) || '-';
                            const batchNumber = line.batch_number || line.batchNumber || '-';
                            return (
                              <tr key={line.id} className="border-t hover:bg-gray-50">
                                <td className="px-3 py-2">{itemCode}</td>
                                <td className="px-3 py-2">{itemName}</td>
                                <td className="px-3 py-2 text-right font-semibold">{line.ordered_quantity}</td>
                                <td className="px-3 py-2">{line.uom || 'units'}</td>
                                <td className="px-3 py-2 font-semibold text-blue-600">{batchNumber}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Summary: Inventory Ready Status */}
              <div className="mb-6 p-3 bg-blue-50 rounded border border-blue-200">
                <p className="text-sm font-semibold">📦 Inventory Status: <span className="text-green-600">{currentBatches.filter(b => (b.on_hand_quantity || 0) > 0).length} batches available</span></p>
              </div>

              {/* Allocation Results with Inventory Movement - Only show in preview/confirmation mode */}
              {allocationResults.length > 0 && allocationPreviewMode && (
                <div className="mb-6 p-4 bg-green-50 rounded border border-green-200">
                  <p className="text-sm font-semibold mb-3">✅ Allocation Preview - Ready to Confirm ({allocationResults.length} items)</p>
                  <div className="space-y-4 max-h-72 overflow-auto text-xs">
                    {allocationResults.map((result, idx) => {
                      // Get method color and icon
                      const methodColors: Record<string, string> = {
                        'BATCH': 'bg-purple-100 text-purple-800',
                        'FEFO': 'bg-orange-100 text-orange-800',
                        'FIFO': 'bg-blue-100 text-blue-800'
                      };
                      const methodIcons: Record<string, string> = {
                        'BATCH': '📦',
                        'FEFO': '📅',
                        'FIFO': '⏱️'
                      };
                      const method = result.allocationMethod || 'BATCH';
                      const methodColor = methodColors[method] || 'bg-gray-100 text-gray-800';
                      const methodIcon = methodIcons[method] || '📦';
                      
                      return (
                      <div key={idx} className="border rounded p-3 bg-white">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <p className="font-semibold text-sm">{result.itemCode} - {result.itemName || ''}</p>
                            <p className="text-gray-600 text-xs">Required: {result.orderedQuantity} {result.uom} | Allocated: {result.totalAllocated} {result.uom} {result.shortfall > 0 ? `| ⚠️ Shortfall: ${result.shortfall}` : '✓'}</p>
                          </div>
                          <div className="flex gap-2">
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${methodColor}`}>
                              {methodIcon} {method}
                            </span>
                          </div>
                        </div>
                        {result.shortfall > 0 && (
                          <div className="mb-3 p-2 bg-red-100 border border-red-400 rounded">
                            <p className="text-red-800 text-xs font-semibold">
                              ❌ SHORTFALL: Only {result.totalAllocated} of {result.orderedQuantity} units allocated. Missing {result.shortfall} units!
                            </p>
                            <p className="text-red-700 text-xs mt-1">Insufficient putaway inventory available.</p>
                          </div>
                        )}
                        {result.allocations.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-100">
                                <tr>
                                  <th className="px-2 py-1 text-left">Order</th>
                                  <th className="px-2 py-1 text-left">Batch #</th>
                                  <th className="px-2 py-1 text-left">Mfg Date</th>
                                  <th className="px-2 py-1 text-left">Exp Date</th>
                                  <th className="px-2 py-1 text-right">Qty</th>
                                  <th className="px-2 py-1 text-left">UOM</th>
                                  <th className="px-2 py-1 text-left">Pallet</th>
                                  <th className="px-2 py-1 text-left">Location</th>
                                </tr>
                              </thead>
                              <tbody>
                                {result.allocations.map((alloc: any, aidx: number) => {
                                  // Highlight if this is expired
                                  const expiryDate = alloc.expiryDate ? new Date(alloc.expiryDate) : null;
                                  const today = new Date();
                                  const isExpired = expiryDate && expiryDate <= today;
                                  const rowBg = isExpired ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-blue-50';
                                  
                                  return (
                                  <tr key={aidx} className={`border-t ${rowBg}`}>
                                    <td className="px-2 py-1">
                                      <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-yellow-200 text-yellow-900">#{alloc.allocationOrder}</span>
                                    </td>
                                    <td className="px-2 py-1 font-semibold">{alloc.batchNumber || '-'}</td>
                                    <td className="px-2 py-1">{alloc.manufacturingDate ? new Date(alloc.manufacturingDate).toLocaleDateString() : '-'}</td>
                                    <td className={`px-2 py-1 font-semibold ${isExpired ? 'text-red-600' : ''}`}>
                                      {alloc.expiryDate ? new Date(alloc.expiryDate).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="px-2 py-1 text-right font-semibold">{alloc.allocatedQuantity}</td>
                                    <td className="px-2 py-1">{alloc.uom || 'units'}</td>
                                    <td className="px-2 py-1 text-blue-600">{alloc.palletId || '-'}</td>
                                    <td className="px-2 py-1">{alloc.locationCode || '-'}</td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {method === 'FEFO' && result.allocations.length > 1 && (
                          <div className="mt-2 p-2 bg-orange-50 rounded text-xs border-l-2 border-orange-400">
                            <p className="font-semibold text-orange-900">ℹ️ FEFO Allocation Details:</p>
                            <p className="text-orange-800">Multiple batches allocated in order of earliest expiry date first. Each allocation is prioritized to minimize waste.</p>
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Status Message */}
              {allocationStatus && (
                <div className={`mb-6 p-4 rounded whitespace-pre-wrap text-sm font-mono ${
                  allocationStatus.includes('✅') ? 'bg-green-100 border border-green-400 text-green-800' :
                  allocationStatus.includes('❌') ? 'bg-red-100 border border-red-400 text-red-800' :
                  'bg-yellow-100 border border-yellow-400 text-yellow-800'
                }`}>
                  {allocationStatus}
                </div>
              )}

              {/* Shortfall Summary */}
              {allocationResults.length > 0 && (
                (() => {
                  const totalShortfall = allocationResults.reduce((sum, r) => sum + (r.shortfall || 0), 0);
                  const itemsWithShortfall = allocationResults.filter(r => r.shortfall > 0).length;
                  
                  return totalShortfall > 0 ? (
                    <div className="mb-6 p-4 bg-red-50 rounded border border-red-400">
                      <p className="text-red-800 font-semibold">⚠️ ALLOCATION INCOMPLETE - SHORTFALL DETECTED</p>
                      <p className="text-red-700 text-sm mt-1">
                        {itemsWithShortfall} item(s) with shortfall | Total missing: {totalShortfall} units
                      </p>
                      <p className="text-red-600 text-xs mt-2">
                        💡 Check if more items need to be putaway or confirm partial allocation.
                      </p>
                    </div>
                  ) : null;
                })()
              )}

              {/* Buttons */}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  className="px-4 py-3 rounded text-base font-semibold border hover:bg-gray-100"
                  onClick={() => {
                    setShowAllocationModal(false);
                    setAllocationResults([]);
                    setAllocationStatus(null);
                    setAllocationPreviewMode(false);
                    setAllocationMethod('BATCH');
                    setAllocationMode('auto');
                    setBatchFilterInput('');
                    setSelectedBatchesForAllocation(new Set());
                  }}
                >
                  Close
                </button>
                
                {/* Only show Confirm & Save when preview is ready */}
                {allocationResults.length > 0 && (
                  <button
                    type="button"
                    className={`px-4 py-3 rounded text-base font-semibold text-white active:scale-95 transition-all duration-100 ${allocationLoading ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    style={{ backgroundColor: '#008ecc', opacity: allocationLoading ? 0.6 : 1 }}
                    onMouseEnter={(e) => !allocationLoading && (e.currentTarget.style.filter = 'brightness(0.9)')}
                    onMouseLeave={(e) => !allocationLoading && (e.currentTarget.style.filter = 'brightness(1)')}
                    onClick={handleConfirmAndSaveAllocation}
                  >
                    {allocationLoading ? '💾 Saving...' : '✅ Confirm & Save'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* Picking Modal */}
        {showPickingModal && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '900px', maxHeight: '95vh', overflowY: 'auto' }}>
              <h3 className="text-2xl font-bold mb-6">Confirm Picks</h3>
              
              {/* Barcode Scanner Input */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded">
                <label className="block text-sm font-semibold mb-2">🔍 Scan Barcode (Pallet ID, Batch Number, or Item Code)</label>
                <input
                  type="text"
                  placeholder="Scan QR code or enter pallet ID / batch number / item code..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleBarcodeScanned(barcodeInput);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <p className="text-xs text-gray-600 mt-2">✓ Press Enter after scanning • Searches: Pallet ID • Batch Number • Item Code</p>
                {lastScannedBarcode && (
                  <p className="text-xs text-green-700 mt-2">Last scanned: {lastScannedBarcode}</p>
                )}
              </div>
              
              {pickingLoading && <p className="text-sm text-gray-600 mb-4">Processing picks...</p>}

              {/* Allocated Batches */}
              {pickingBatches.length > 0 && (
                <div className="mb-6">
                  <p className="text-sm font-semibold mb-3">📦 Allocated Batches for Picking ({pickingBatches.length})</p>
                  <div className="space-y-3 max-h-96 overflow-auto border rounded p-4 bg-gray-50">
                    {groupBatchesByItem(pickingBatches, items).map((itemGroup, idx) => (
                      <div key={idx} className="mb-4 border rounded p-3 bg-white">
                        <p className="text-sm font-semibold mb-3 pb-2 border-b">
                          {itemGroup.itemCode} - {itemGroup.itemName}
                          <span className="text-gray-600 ml-2 text-xs">({itemGroup.totalQty} units total)</span>
                        </p>
                        <div className="space-y-2 ml-2">
                          {itemGroup.batches.map((batch, bidx) => {
                            const expiryDate = batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : '-';
                            const mfgDate = batch.manufacturingDate ? new Date(batch.manufacturingDate).toLocaleDateString() : '-';
                            
                            return (
                              <label key={bidx} className="flex items-start gap-3 text-xs cursor-pointer p-2.5 hover:bg-blue-50 rounded border border-gray-200">
                                <input
                                  type="checkbox"
                                  checked={pickedBatchIds.has(batch.id)}
                                  onChange={e => {
                                    const newSet = new Set(pickedBatchIds);
                                    if (e.target.checked) {
                                      newSet.add(batch.id);
                                    } else {
                                      newSet.delete(batch.id);
                                    }
                                    setPickedBatchIds(newSet);
                                  }}
                                  className="mt-0.5 cursor-pointer w-4 h-4"
                                />
                                <div className="flex-1">
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                      <p className="text-gray-600 font-semibold">Batch #:</p>
                                      <p className="font-mono font-bold">{batch.batchNumber || '-'}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-600 font-semibold">Qty Allocated:</p>
                                      <p className="font-bold text-green-700">{batch.allocatedQuantity} units</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-600 font-semibold">Mfg Date:</p>
                                      <p>{mfgDate}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-600 font-semibold">Exp Date:</p>
                                      <p className={batch.expiryDate && new Date(batch.expiryDate) < new Date() ? 'text-red-600 font-bold' : ''}>{expiryDate}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-600 font-semibold">Location:</p>
                                      <p>{batch.locationCode || '-'}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-600 font-semibold">Pallet ID:</p>
                                      <p className="text-blue-600 font-mono">{batch.palletId || '-'}</p>
                                    </div>
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Picking Summary */}
              {pickingBatches.length > 0 && (
                <div className="mb-6 p-4 bg-blue-50 rounded border border-blue-200">
                  {(() => {
                    const summary = getPickingSummary(
                      pickingBatches.map(b => ({
                        ...b,
                        picked: pickedBatchIds.has(b.id),
                        pickedQuantity: pickedBatchIds.has(b.id) ? b.allocatedQuantity : 0
                      }))
                    );
                    return (
                      <p className="text-sm">
                        <strong>{summary.summary}</strong>
                      </p>
                    );
                  })()}
                </div>
              )}

              {/* Status Message */}
              {pickingStatus && (
                <div className={`mb-6 p-4 rounded whitespace-pre-wrap text-sm font-mono ${
                  pickingStatus.includes('✅') ? 'bg-green-100 border border-green-400 text-green-800' :
                  pickingStatus.includes('❌') ? 'bg-red-100 border border-red-400 text-red-800' :
                  'bg-yellow-100 border border-yellow-400 text-yellow-800'
                }`}>
                  {pickingStatus}
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  className="px-4 py-3 rounded text-base font-semibold border hover:bg-gray-100"
                  onClick={() => {
                    setShowPickingModal(false);
                    setPickingStatus(null);
                    setPickedBatchIds(new Set());
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="px-4 py-3 rounded text-base font-semibold border border-blue-600 text-blue-600 hover:bg-blue-50 active:scale-95 transition-all duration-100"
                  onClick={() => {
                    // Print preview using browser's print dialog
                    const printWindow = window.open('', '', 'height=600,width=900');
                    if (printWindow) {
                      const itemsPerPage = 10;
                      const totalPages = Math.ceil(pickingBatches.length / itemsPerPage);
                      
                      const pickListHTML = `
                        <html>
                          <head>
                            <title>Pick List</title>
                            <style>
                              * { margin: 0; padding: 0; }
                              html, body { height: 100%; }
                              body { font-family: Arial, sans-serif; background: white; }
                              .page { page-break-after: always; padding: 30px 25px; min-height: 100vh; display: flex; flex-direction: column; }
                              .page:last-child { page-break-after: avoid; }
                              .header-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; border-bottom: 2px solid #000; padding-bottom: 12px; }
                              .header-left h1 { font-size: 20px; font-weight: bold; letter-spacing: 0.5px; margin-bottom: 3px; }
                              .header-left p { font-size: 10px; color: #555; }
                              .header-right { text-align: right; }
                              .scan-barcode { font-weight: bold; font-size: 9px; margin-bottom: 4px; }
                              .barcode-value { font-family: 'Courier New', monospace; font-size: 14px; font-weight: bold; letter-spacing: 2px; margin-bottom: 2px; }
                              .barcode-small { font-family: 'Courier New', monospace; font-size: 8px; color: #666; letter-spacing: 1px; }
                              .info-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin: 10px 0; font-size: 10px; }
                              .info-field { }
                              .info-label { font-size: 9px; font-weight: bold; color: #333; letter-spacing: 0.5px; text-transform: uppercase; }
                              .info-value { font-size: 11px; font-weight: bold; margin-top: 1px; }
                              .divider { border-bottom: 1px solid #000; margin: 8px 0; }
                              .items-section { margin: 8px 0; flex: 1; }
                              .items-title { font-weight: bold; font-size: 11px; margin-bottom: 6px; letter-spacing: 0.5px; }
                              table { width: 100%; border-collapse: collapse; font-size: 9px; }
                              th { 
                                background-color: #e8e8e8; 
                                padding: 4px 3px; 
                                text-align: left; 
                                font-weight: bold; 
                                font-size: 9px;
                                border-top: 1px solid #000;
                                border-bottom: 1px solid #000;
                                letter-spacing: 0.3px;
                              }
                              td { padding: 3px 3px; border-bottom: 1px solid #ddd; }
                              tr:last-child td { border-bottom: 1px solid #000; }
                              .checkbox { display: inline-block; width: 12px; height: 12px; border: 1px solid #333; margin-right: 2px; vertical-align: middle; background: white; }
                              .qty-col { text-align: center; font-weight: bold; }
                              .signature-section { margin-top: auto; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; }
                              .signature-line { border-top: 1px solid #000; padding-top: 3px; min-height: 25px; }
                              .signature-label { font-size: 8px; font-weight: bold; text-align: center; margin-top: 2px; letter-spacing: 0.3px; }
                              .footer { text-align: center; font-size: 8px; color: #666; margin-top: 10px; line-height: 1.3; }
                              .page-num { text-align: right; font-size: 8px; color: #999; margin-top: 5px; }
                              @media print {
                                .page { page-break-after: always; }
                              }
                            </style>
                          </head>
                          <body>
                            ${Array.from({ length: totalPages }, (_, pageIdx) => {
                              const startIdx = pageIdx * itemsPerPage;
                              const endIdx = Math.min(startIdx + itemsPerPage, pickingBatches.length);
                              const pageItems = pickingBatches.slice(startIdx, endIdx);
                              const isLastPage = pageIdx === totalPages - 1;
                              
                              return `
                                <div class="page">
                                  <div class="header-top">
                                    <div class="header-left">
                                      <h1>PICK LIST</h1>
                                      <p>Goods Picking Document</p>
                                    </div>
                                    <div class="header-right">
                                      <div class="scan-barcode">SCAN BARCODE</div>
                                      <div class="barcode-value">${allocationHeaderId}</div>
                                      <div class="barcode-small">${allocationHeaderId}</div>
                                    </div>
                                  </div>
                                  
                                  <div class="info-section">
                                    <div class="info-field">
                                      <div class="info-label">Pick ID</div>
                                      <div class="info-value">${allocationHeaderId}</div>
                                    </div>
                                    <div class="info-field">
                                      <div class="info-label">Pick Date</div>
                                      <div class="info-value">${new Date().toLocaleDateString()}</div>
                                    </div>
                                    <div class="info-field">
                                      <div class="info-label">Status</div>
                                      <div class="info-value">Pending</div>
                                    </div>
                                  </div>
                                  
                                  <div class="divider"></div>
                                  
                                  <div class="items-section">
                                    <div class="items-title">ITEMS TO PICK</div>
                                    <table>
                                      <thead>
                                        <tr>
                                          <th style="width: 15px;"></th>
                                          <th style="width: 55px;">Item Code</th>
                                          <th>Item Name</th>
                                          <th style="width: 55px;">Batch #</th>
                                          <th style="width: 40px;">Qty</th>
                                          <th style="width: 60px;">Location</th>
                                          <th style="width: 85px;">Pallet ID</th>
                                          <th style="width: 60px;">Exp Date</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        ${pageItems.map((batch, idx) => {
                                          const item = items.find(i => i.id === batch.itemId);
                                          const expiryDate = batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString() : '-';
                                          return `
                                            <tr>
                                              <td style="text-align: center;"><span class="checkbox"></span></td>
                                              <td><strong>${item?.item_code || '-'}</strong></td>
                                              <td>${item?.item_name || '-'}</td>
                                              <td>${batch.batchNumber || '-'}</td>
                                              <td class="qty-col">${batch.allocatedQuantity}</td>
                                              <td>${batch.locationCode || (batch.locationId ? (locationOptions.find(l => l.id === batch.locationId)?.name || 'LOC-' + batch.locationId) : '-')}</td>
                                              <td>${batch.palletId || '-'}</td>
                                              <td>${expiryDate}</td>
                                            </tr>
                                          `;
                                        }).join('')}
                                      </tbody>
                                    </table>
                                  </div>
                                  
                                  ${isLastPage ? `
                                    <div class="divider"></div>
                                    <div class="signature-section">
                                      <div>
                                        <div class="signature-line"></div>
                                        <div class="signature-label">PICKED BY</div>
                                      </div>
                                      <div>
                                        <div class="signature-line"></div>
                                        <div class="signature-label">VERIFIED BY</div>
                                      </div>
                                      <div>
                                        <div class="signature-line"></div>
                                        <div class="signature-label">APPROVED BY</div>
                                      </div>
                                    </div>
                                  ` : ''}
                                  
                                  <div class="footer">
                                    <p>This is an official Pick List. Please retain for your records.</p>
                                    <p>Printed on: ${new Date().toLocaleDateString()}, ${new Date().toLocaleTimeString()}</p>
                                  </div>
                                  <div class="page-num">Page ${pageIdx + 1} of ${totalPages}</div>
                                </div>
                              `;
                            }).join('')}
                          </body>
                        </html>
                      `;
                      printWindow.document.write(pickListHTML);
                      printWindow.document.close();
                      setTimeout(() => {
                        printWindow.print();
                      }, 250);
                    }
                  }}
                >
                  🖨️ Print Preview
                </button>
                <button
                  type="button"
                  className={`px-4 py-3 rounded text-base font-semibold text-white active:scale-95 transition-all duration-100 ${pickingLoading || pickedBatchIds.size === 0 ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  style={{ backgroundColor: '#008ecc', opacity: pickingLoading || pickedBatchIds.size === 0 ? 0.6 : 1 }}
                  onMouseEnter={(e) => !(pickingLoading || pickedBatchIds.size === 0) && (e.currentTarget.style.filter = 'brightness(0.9)')}
                  onMouseLeave={(e) => !(pickingLoading || pickedBatchIds.size === 0) && (e.currentTarget.style.filter = 'brightness(1)')}
                  onClick={handleConfirmPicks}
                >
                  {pickingLoading ? 'Confirming...' : 'Mark All Picked'}
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Shipment Modal */}
        {showShipmentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '1200px', maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 className="text-2xl font-bold mb-6">Confirm Shipment</h3>
              
              {/* Loading State */}
              {shipmentLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <p className="text-lg text-gray-700 font-semibold mb-2">Loading shipment items...</p>
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Error/Status Messages */}
              {shipmentStatus && (
                <div className={`p-4 rounded mb-6 ${
                  shipmentStatus.includes('✅') ? 'bg-green-100 text-green-800 border border-green-300' :
                  shipmentStatus.includes('⚠️') ? 'bg-yellow-100 text-yellow-800 border border-yellow-300' :
                  'bg-red-100 text-red-800 border border-red-300'
                }`}>
                  <p className="text-base font-semibold">{shipmentStatus}</p>
                </div>
              )}

              {/* Items to Ship */}
              {verifiedChecklistItems && verifiedChecklistItems.length > 0 && (
                <div className="mb-6">
                  <p className="text-sm font-semibold mb-3">📦 Items to Ship ({verifiedChecklistItems.length})</p>
                  <div className="border rounded overflow-auto max-h-96">
                    <table className="w-full text-xs">
                      <thead className="bg-blue-100 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold">✓</th>
                          <th className="px-2 py-2 text-left font-semibold">Item Code</th>
                          <th className="px-2 py-2 text-left font-semibold">Item Name</th>
                          <th className="px-2 py-2 text-left font-semibold">Batch #</th>
                          <th className="px-2 py-2 text-right font-semibold">Qty</th>
                          <th className="px-2 py-2 text-left font-semibold">Mfg Date</th>
                          <th className="px-2 py-2 text-left font-semibold">Exp Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {verifiedChecklistItems.map((item: any, idx: number) => {
                          const itemKey = `${item.item_code}-${item.batch_number}-${idx}`;
                          const isSelected = shippedItemIds.has(itemKey);
                          
                          return (
                            <tr key={idx} className={`border-t hover:bg-blue-50 ${isSelected ? 'bg-blue-100' : ''}`}>
                              <td className="px-2 py-1.5">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={e => {
                                    const newSet = new Set(shippedItemIds);
                                    if (e.target.checked) {
                                      newSet.add(itemKey);
                                    } else {
                                      newSet.delete(itemKey);
                                    }
                                    setShippedItemIds(newSet);
                                  }}
                                  className="w-4 h-4 cursor-pointer"
                                />
                              </td>
                              <td className="px-2 py-1.5 font-medium">{item.item_code || '-'}</td>
                              <td className="px-2 py-1.5">{item.item_name || '-'}</td>
                              <td className="px-2 py-1.5">{item.batch_number || '-'}</td>
                              <td className="px-2 py-1.5 text-right font-semibold">{item.checked_qty} units</td>
                              <td className="px-2 py-1.5">{item.manufacturing_date ? new Date(item.manufacturing_date).toLocaleDateString() : '-'}</td>
                              <td className="px-2 py-1.5">{item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded text-sm font-semibold bg-gray-400 text-white hover:bg-gray-500"
                  onClick={() => setShowShipmentModal(false)}
                  disabled={shipmentLoading}
                >
                  Cancel
                </button>
                
                <button
                  type="button"
                  className={`px-4 py-2 rounded text-sm font-semibold text-white active:scale-95 transition-all duration-100 ${shipmentLoading || shippedItemIds.size === 0 ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  style={{ backgroundColor: '#008ecc', opacity: shipmentLoading || shippedItemIds.size === 0 ? 0.6 : 1 }}
                  onMouseEnter={(e) => !(shipmentLoading || shippedItemIds.size === 0) && (e.currentTarget.style.filter = 'brightness(0.9)')}
                  onMouseLeave={(e) => !(shipmentLoading || shippedItemIds.size === 0) && (e.currentTarget.style.filter = 'brightness(1)')}
                  onClick={handleConfirmShipment}
                >
                  ✅ Confirm Shipment
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Putaway Modal */}
        {showPutawayModal && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-8 w-96">
              <h3 className="text-xl font-bold mb-6">Putaway Receipt</h3>
              <form onSubmit={async e => {
                e.preventDefault();
                setPutawayLoading(true);
                setPutawayError(null);
                try {
                  const header = headerRecords.find(h => h.id === putawayHeaderId);
                  const line = lineRecords.find(l => l.id === putawayLineId);
                  
                  if (!header || !line) throw new Error('SO header or line not found');
                  
                  let result;
                  
                  if (isSplitMode) {
                    // Validate split records
                    const activeSplits = splitRecords.filter(r => Number(r.quantity) > 0);
                    if (activeSplits.length === 0) {
                      throw new Error('Please enter at least one split record with quantity > 0');
                    }
                    if (activeSplits.some(r => !r.location)) {
                      throw new Error('Please select a location for all split records with quantity');
                    }
                    
                    // Call split putaway helper
                    result = await submitSplitPutaway({
                      splits: activeSplits.map(r => ({
                        quantity: Number(r.quantity),
                        location: r.location,
                        reason: r.reason,
                      })),
                      line,
                      header,
                      items,
                      apiKey,
                      warehouseId: header.warehouse_id || parseInt(warehouseFilter || '1'),
                    });
                    
                    // Mark line as completed
                    if (line.id) {
                      setPutawayCompletedLines(prev => new Set(prev).add(line.id));
                    }
                    
                    // Show confirmation with split details
                    setPutawayConfirmationData({
                      splitRecords: activeSplits,
                      splitPalletIds: result.splitPalletIds,
                      quantity: activeSplits.reduce((sum, r) => sum + Number(r.quantity), 0),
                      timestamp: new Date().toLocaleString(),
                      gatepassNumber: result.gpNumber,
                      isSplit: true,
                    });
                  } else {
                    // Normal single putaway
                    if (!putawayLocation) {
                      throw new Error('Please select a location');
                    }
                    
                    const quantity = Number(line.ordered_quantity || line.orderedQuantity || 0);
                    
                    result = await submitPutawayRecord({
                      quantity,
                      location: putawayLocation,
                      line,
                      header,
                      items,
                      apiKey,
                      generatePalletId,
                      palletId: line.pallet_id,
                      warehouseId: header.warehouse_id || parseInt(warehouseFilter || '1'),
                    });
                    
                    // Mark line as completed
                    if (line.id) {
                      setPutawayCompletedLines(prev => new Set(prev).add(line.id));
                    }
                    
                    // Show confirmation
                    setPutawayConfirmationData({
                      palletId: result.palletId,
                      location: putawayLocation,
                      quantity,
                      timestamp: new Date().toLocaleString(),
                      gatepassNumber: result.gpNumber,
                      isSplit: false,
                    });
                  }
                  
                  setShowPutawayConfirmation(true);
                  
                  // Close putaway modal and reset
                  setShowPutawayModal(false);
                  setPutawayHeaderId(null);
                  setPutawayLineId(null);
                  setPutawayLocation('');
                  setPutawayQuantity('');
                  setIsSplitMode(false);
                  setSplitRecords([
                    { id: '1', reason: 'good', quantity: '', location: '' },
                    { id: '2', reason: 'damage', quantity: '', location: '' },
                  ]);
                } catch (err: any) {
                  setPutawayError(err.message);
                }
                setPutawayLoading(false);
              }}>
                {/* Header Info Display */}
                <div className="bg-gray-50 p-4 rounded mb-6 border border-gray-200">
                  <div className="grid grid-cols-1 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600 font-semibold">Pallet ID</p>
                      <p className="text-gray-900 font-bold text-lg">{lineRecords.find(l => l.id === putawayLineId)?.pallet_id || '-'}</p>
                    </div>
                    <div className="border-t pt-3 mt-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={isSplitMode} 
                          onChange={(e) => setIsSplitMode(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span className="text-sm font-semibold text-gray-700">Split Putaway (Damaged/Defective)</span>
                      </label>
                      <p className="text-xs text-gray-500 mt-1">Enable to split good and damaged quantities to different locations</p>
                    </div>
                  </div>
                </div>

                {!isSplitMode ? (
                  <>
                    {/* Normal Putaway - Single Location */}
                    <div className="mb-4">
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Bin Location <span className="text-red-600">*</span></label>
                      {locationOptions.length === 0 && (
                        <p className="text-xs text-yellow-600 mb-2">Loading locations...</p>
                      )}
                      <select 
                        className="w-full border border-gray-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" 
                        value={putawayLocation} 
                        onChange={e => setPutawayLocation(e.target.value)} 
                        required
                      >
                        <option value="">-- Select Bin Location --</option>
                        {locationOptions && locationOptions.length > 0 ? (
                          locationOptions.map(loc => (
                            <option key={loc.id} value={loc.id}>{loc.name}</option>
                          ))
                        ) : (
                          <option disabled>No locations available</option>
                        )}
                      </select>
                      {locationOptions.length === 0 && (
                        <p className="text-xs text-gray-500 mt-1">Tip: Check browser console to see location fetch status</p>
                      )}
                    </div>

                    {/* Quantity Input */}
                    <div className="mb-6">
                      <label className="block text-sm font-semibold mb-2 text-gray-700">Quantity <span className="text-red-600">*</span></label>
                      <input 
                        className="w-full border border-gray-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm bg-gray-100" 
                        type="number" 
                        min="1" 
                        value={putawayQuantity || getReceivedQuantity(lineRecords.find(l => l.id === putawayLineId))} 
                        readOnly
                      />
                      <p className="text-xs text-gray-500 mt-1">Auto-populated from Received Qty</p>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Split Putaway - Dynamic Split Records */}
                    <div className="mb-4">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="font-semibold text-sm text-gray-700">Split Inventory Records</h4>
                        <button
                          type="button"
                          onClick={() => {
                            const newId = String(Math.max(...splitRecords.map(r => Number(r.id) || 0)) + 1);
                            setSplitRecords([...splitRecords, { id: newId, reason: 'damage', quantity: '', location: '' }]);
                          }}
                          className="text-xs text-white px-2 py-1 rounded active:scale-95 transition-all duration-100"
                          style={{ backgroundColor: '#008ecc' }}
                          onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.9)'}
                          onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                        >
                          + Add Split
                        </button>
                      </div>

                      {splitRecords.map((record, index) => {
                        const reasonColors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
                          good: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: '✓' },
                          damage: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: '⚠️' },
                          missing: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: '❌' },
                          defective: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: '🔧' },
                        };
                        const colors = reasonColors[record.reason] || reasonColors['damage'];

                        return (
                          <div key={record.id} className={`mb-3 p-3 ${colors.bg} border ${colors.border} rounded`}>
                            <div className="flex justify-between items-start mb-2">
                              <h5 className={`font-semibold text-sm ${colors.text}`}>{colors.icon} {record.reason.toUpperCase()}</h5>
                              {splitRecords.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setSplitRecords(splitRecords.filter(r => r.id !== record.id))}
                                  className="text-xs text-red-600 hover:text-red-800 font-semibold"
                                >
                                  Remove
                                </button>
                              )}
                            </div>

                            {/* Reason Selection */}
                            <label className="block text-xs font-semibold mb-1 text-gray-700">Reason <span className="text-red-600">*</span></label>
                            <select
                              value={record.reason}
                              onChange={(e) => {
                                const updated = [...splitRecords];
                                updated[index].reason = e.target.value as any;
                                setSplitRecords(updated);
                              }}
                              className="w-full border border-gray-300 px-3 py-1.5 rounded text-xs mb-2"
                            >
                              <option value="good">Good</option>
                              <option value="damage">Damaged</option>
                              <option value="missing">Missing</option>
                              <option value="defective">Defective</option>
                            </select>

                            {/* Quantity Input */}
                            <label className="block text-xs font-semibold mb-1 text-gray-700">Quantity <span className="text-red-600">*</span></label>
                            <input
                              type="number"
                              min="0"
                              value={record.quantity}
                              onChange={(e) => {
                                const updated = [...splitRecords];
                                updated[index].quantity = e.target.value;
                                setSplitRecords(updated);
                              }}
                              placeholder="Enter quantity"
                              className="w-full border border-gray-300 px-3 py-1.5 rounded text-xs mb-2"
                            />

                            {/* Location Selection */}
                            <label className="block text-xs font-semibold mb-1 text-gray-700">Location <span className="text-red-600">*</span></label>
                            <select
                              value={record.location}
                              onChange={(e) => {
                                const updated = [...splitRecords];
                                updated[index].location = e.target.value;
                                setSplitRecords(updated);
                              }}
                              className="w-full border border-gray-300 px-3 py-1.5 rounded text-xs"
                            >
                              <option value="">-- Select Location --</option>
                              {locationOptions && locationOptions.length > 0 ? (
                                locationOptions.map(loc => (
                                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                                ))
                              ) : (
                                <option disabled>No locations available</option>
                              )}
                            </select>
                          </div>
                        );
                      })}
                    </div>

                    {/* Split Summary */}
                    {splitRecords.some(r => Number(r.quantity) > 0) && (
                      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-gray-700">
                        <p className="font-semibold mb-2">📦 Split Summary</p>
                        <p>Total Received: <strong>{getReceivedQuantity(lineRecords.find(l => l.id === putawayLineId))}</strong> units</p>
                        {splitRecords.map(r => (
                          Number(r.quantity) > 0 && (
                            <p key={r.id} className="text-gray-700">
                              {r.reason.toUpperCase()}: <strong>{r.quantity}</strong> units
                            </p>
                          )
                        ))}
                        {splitRecords.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0) !== getReceivedQuantity(lineRecords.find(l => l.id === putawayLineId)) && (
                          <p className="text-orange-700 mt-2 font-semibold">⚠️ Total does not match received quantity</p>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Error Message */}
                {putawayError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                    {putawayError}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button 
                    type="submit" 
                    className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed" 
                    disabled={putawayLoading}
                  >
                    {putawayLoading ? 'Saving...' : 'Confirm Putaway'}
                  </button>
                  <button 
                    type="button" 
                    className="flex-1 px-4 py-2.5 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400 transition" 
                    onClick={() => {
                      setShowPutawayModal(false);
                      setPutawayHeaderId(null);
                      setPutawayLineId(null);
                      setPutawayError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        
        {/* Putaway Confirmation Modal */}
        {showPutawayConfirmation && putawayConfirmationData && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md max-h-96 overflow-y-auto">
              <h3 className="text-xl font-bold mb-6 text-green-600">✓ Putaway Completed Successfully</h3>
              
              {putawayConfirmationData.isSplit ? (
                // Split Putaway Confirmation - Dynamic Splits
                <div className="space-y-4 mb-6">
                  {putawayConfirmationData.splitRecords && putawayConfirmationData.splitRecords.map((record: any, index: number) => {
                    const reasonColors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
                      good: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: '✓' },
                      damage: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: '⚠️' },
                      missing: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: '❌' },
                      defective: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: '🔧' },
                    };
                    const colors = reasonColors[record.reason] || reasonColors['damage'];
                    const palletId = putawayConfirmationData.splitPalletIds?.[record.reason] || 'N/A';

                    return (
                      <div key={record.id} className={`${colors.bg} border ${colors.border} rounded p-4`}>
                        <p className={`text-sm font-bold ${colors.text} mb-3`}>{colors.icon} {record.reason.toUpperCase()}</p>
                        <div className="space-y-2 text-sm">
                          <div className="bg-white p-2 rounded">
                            <p className="text-xs text-gray-600">Pallet ID</p>
                            <p className="font-bold break-all" style={{ color: colors.text === 'text-green-700' ? '#16a34a' : colors.text === 'text-red-700' ? '#dc2626' : colors.text === 'text-yellow-700' ? '#ca8a04' : '#ea580c' }}>
                              {palletId}
                            </p>
                          </div>
                          <div className="bg-white p-2 rounded">
                            <p className="text-xs text-gray-600">Location</p>
                            <p className="font-bold text-gray-900">{record.location}</p>
                          </div>
                          <div className="bg-white p-2 rounded">
                            <p className="text-xs text-gray-600">Quantity</p>
                            <p className="font-bold text-gray-900">{record.quantity} units</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Summary */}
                  <div className="bg-blue-50 p-3 rounded border border-blue-200">
                    <p className="text-xs text-blue-600 font-semibold mb-2">Total Processed</p>
                    <p className="text-lg font-bold text-blue-700">{putawayConfirmationData.quantity} units</p>
                    <p className="text-xs text-gray-600 mt-2">{putawayConfirmationData.timestamp}</p>
                  </div>

                  <div className="bg-purple-50 p-4 rounded border border-purple-200">
                    <p className="text-xs text-purple-600 font-semibold">Gatepass Number</p>
                    <p className="text-lg font-bold text-purple-700 break-all">{putawayConfirmationData.gatepassNumber}</p>
                  </div>
                </div>
              ) : (
                // Normal Single Putaway Confirmation
                <div className="space-y-4 mb-6">
                  <div className="bg-gray-50 p-4 rounded border border-gray-200">
                    <p className="text-xs text-gray-600 font-semibold">Pallet ID</p>
                    <p className="text-lg font-bold text-blue-700 break-all">{putawayConfirmationData.palletId}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 p-3 rounded border border-gray-200">
                      <p className="text-xs text-gray-600 font-semibold">Location</p>
                      <p className="text-sm font-bold">{putawayConfirmationData.location}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded border border-gray-200">
                      <p className="text-xs text-gray-600 font-semibold">Quantity</p>
                      <p className="text-sm font-bold">{putawayConfirmationData.quantity}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded border border-gray-200 col-span-2">
                      <p className="text-xs text-gray-600 font-semibold">Time</p>
                      <p className="text-xs font-bold">{putawayConfirmationData.timestamp}</p>
                    </div>
                  </div>
                  <div className="bg-blue-50 p-4 rounded border border-blue-200">
                    <p className="text-xs text-blue-600 font-semibold">Gatepass Number</p>
                    <p className="text-lg font-bold text-blue-700 break-all">{putawayConfirmationData.gatepassNumber}</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button 
                  type="button" 
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition" 
                  onClick={() => {
                    setShowGatepassModal(true);
                    setGatepassHeaderId(putawayHeaderId);
                    setShowPutawayConfirmation(false);
                  }}
                >
                  View Gatepass
                </button>
                <button 
                  type="button" 
                  className="flex-1 px-4 py-2.5 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400 transition" 
                  onClick={() => {
                    setShowPutawayConfirmation(false);
                    setPutawayConfirmationData(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Paste Data Modal */}
        {showRecordPasteArea && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-2xl">
              <h3 className="text-xl font-bold mb-6">Paste Item Details</h3>
              <p className="text-sm text-gray-600 mb-4">Paste tab-separated data from Excel. Format: Received Qty | Batch # | Mfg Date | Expiry Date</p>
              <p className="text-xs text-gray-500 mb-4">Each row will be matched to the corresponding line in the Item Details grid</p>
              
              {pasteDataStatus && pasteDataStatus.includes('Error') && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {pasteDataStatus}
                </div>
              )}

              <textarea
                ref={recordPasteTextareaRef}
                className="w-full border-2 border-gray-300 px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm font-mono"
                placeholder="Paste here (Ctrl+V)...&#10;Example:&#10;100&#9;BATCH001&#9;2024-01-15&#9;2025-01-15"
                onPaste={handleRecordPaste}
                rows={10}
              />

              <p className="text-xs text-gray-500 mt-2">Data will be pasted into the first N rows of your Item Details grid</p>

              {pasteDataStatus && pasteDataStatus.includes('Successfully') && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-green-700 text-sm">
                  ✓ {pasteDataStatus}
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button 
                  type="button" 
                  disabled={isSavingPastedData}
                  className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  onClick={handleSavePastedData}
                >
                  {isSavingPastedData ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
                <button 
                  type="button" 
                  disabled={isSavingPastedData}
                  className="flex-1 px-4 py-2.5 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400 transition disabled:bg-gray-400 disabled:cursor-not-allowed"
                  onClick={() => {
                    setShowRecordPasteArea(false);
                    setPasteDataStatus(null);
                    setOriginalRecordLines([]);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pallet ID Generation Modal - Paste Multiple Rows */}
        {showPalletGeneration && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-2xl">
              <h3 className="text-xl font-bold mb-6">Paste SO Entry Data</h3>
              <p className="text-sm text-gray-600 mb-2">Paste tab-separated data from Excel. Format: Item Code | Item Name | Description | Ordered Qty | SO UOM</p>
              <p className="text-xs text-gray-500 mb-4">⚡ Conversion to multiple rows happens automatically based on UOM and Pallet Config from Item Master</p>
              
              {palletGenError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {palletGenError}
                </div>
              )}

              <textarea
                className="w-full border-2 border-gray-300 px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm font-mono"
                placeholder="Paste here (Ctrl+V)...&#10;Example:&#10;CC5001&#9;Coca-Cola Bottle&#9;Beverage&#9;200&#9;BOX"
                value={palletPasteData}
                onChange={e => {
                  const pastedData = e.target.value;
                  setPalletPasteData(pastedData);
                  
                  // Auto-process on paste (when data is added)
                  if (pastedData.trim()) {
                    setPalletGenError(null);
                    setRemainderWarning(null);
                    const rows = pastedData.trim().split(/\r?\n/).filter(r => r.trim()).map(row => row.split('\t'));
                    const newSOLines: SOLine[] = [];
                    const remainderDetails: any[] = [];
                    let errorOccurred = false;

                    rows.forEach((cols, rowIndex) => {
                      if (errorOccurred) return;

                      if (cols.length < 5) {
                        setPalletGenError(`Row ${rowIndex + 1}: Invalid format. Expected 5 columns (Item Code, Item Name, Description, Ordered Qty, SO UOM).`);
                        errorOccurred = true;
                        return;
                      }

                      const itemCode = cols[0]?.trim() || '';
                      const itemName = cols[1]?.trim() || '';
                      const description = cols[2]?.trim() || '';
                      const qty = Number(cols[3]?.trim() || '0');
                      const soUom = cols[4]?.trim() || '';

                      if (!itemCode || !itemName || !description || qty <= 0 || !soUom) {
                        setPalletGenError(`Row ${rowIndex + 1}: Invalid values. Ensure Item Code, Item Name, Description, Ordered Qty (>0), and SO UOM are provided.`);
                        errorOccurred = true;
                        return;
                      }

                      // Fetch weight and pallet config from item master
                      const item = items.find(i => i.item_code?.toUpperCase() === itemCode.toUpperCase());
                      if (!item) {
                        setPalletGenError(`Row ${rowIndex + 1}: Item Code "${itemCode}" not found in Item Master.`);
                        errorOccurred = true;
                        return;
                      }

                      const weightUomKg = item.weight_uom_kg || 1;
                      const palletConfig = item.pallet_config || item.pallet_qty || 1;

                      if (weightUomKg <= 0 || palletConfig <= 0) {
                        setPalletGenError(`Row ${rowIndex + 1}: Item "${itemCode}" has invalid Weight UOM KG (${weightUomKg}) or Pallet Config (${palletConfig}). Please check Item Master.`);
                        errorOccurred = true;
                        return;
                      }

                      // Calculate rows based on pallet config: Qty ÷ (weight_uom_kg × pallet_config)
                      const capacityPerPallet = weightUomKg * palletConfig;
                      const exactPallets = qty / capacityPerPallet;
                      const rowCount = Math.ceil(exactPallets);
                      const remainder = (qty % capacityPerPallet);

                      // Check for remainder and warn
                      if (remainder !== 0) {
                        remainderDetails.push({
                          itemCode,
                          itemName,
                          orderedQty: qty,
                          capacityPerPallet: capacityPerPallet,
                          remainder: remainder,
                          rowCount: rowCount,
                        });
                      }

                      const qtyPerRow = Math.ceil(qty / rowCount);

                      // Create multiple SO lines without pallet IDs (just computed rows)
                      for (let i = 0; i < rowCount; i++) {
                        newSOLines.push({
                          itemCode,
                          itemName,
                          description,
                          expectedQuantity: String(qtyPerRow),
                          orderedQuantity: String(qtyPerRow),
                          batchNumber: '', // Blank batch number as requested
                          manufacturingDate: '',
                          expiryDate: '',
                          palletId: '', // NO pallet ID for SO entry
                          weightUomKg: String(weightUomKg),
                          palletConfig: String(palletConfig),
                          itemUom: item.item_uom || soUom,
                          asnUom: soUom,
                          remarks: '',
                        });
                      }
                    });

                    // If there are remainders, show warning and proceed
                    if (remainderDetails.length > 0) {
                      setRemainderWarning({
                        items: remainderDetails,
                        pendingRows: newSOLines,
                      });
                      setPendingPalletRows(newSOLines);
                      return;
                    }

                    if (!errorOccurred && newSOLines.length > 0) {
                      setRowData([...rowData, ...newSOLines]);
                      // Don't auto-close - let user review
                      console.log('SO lines converted:', newSOLines.length);
                    }
                  }
                }}
                rows={8}
              />
              
              <p className="text-xs text-gray-500 mt-2">Each row represents a unit based on: Qty ÷ (Weight from Item Master × Pallet Config from Item Master). No Pallet IDs are generated in SO.</p>

              <div className="flex gap-3 mt-6">
                <button 
                  type="button" 
                  className="flex-1 px-4 py-2.5 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition" 
                  onClick={() => {
                    setShowPalletGeneration(false);
                    setPalletGenError(null);
                    setPalletPasteData('');
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Remainder Warning Modal */}
        {remainderWarning && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-2xl">
              <h3 className="text-xl font-bold mb-4 text-orange-600">⚠️ Remainder Detected</h3>
              <p className="text-sm text-gray-700 mb-4">The following items have remainders that don't evenly fit into pallets. Review the details:</p>
              
              <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: '1rem' }}>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-orange-50">
                      <th className="border px-3 py-2 text-left">Item Code</th>
                      <th className="border px-3 py-2 text-left">Item Name</th>
                      <th className="border px-3 py-2 text-right">Expected Qty</th>
                      <th className="border px-3 py-2 text-right">Capacity/Pallet</th>
                      <th className="border px-3 py-2 text-right">Remainder</th>
                      <th className="border px-3 py-2 text-right">Pallets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remainderWarning.items.map((item: any, idx: number) => (
                      <tr key={idx}>
                        <td className="border px-3 py-2">{item.itemCode}</td>
                        <td className="border px-3 py-2">{item.itemName}</td>
                        <td className="border px-3 py-2 text-right font-semibold">{item.expectedQty}</td>
                        <td className="border px-3 py-2 text-right">{item.capacityPerPallet}</td>
                        <td className="border px-3 py-2 text-right text-orange-600 font-bold">{item.remainder.toFixed(2)}</td>
                        <td className="border px-3 py-2 text-right">{item.palletCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-gray-600 mb-4 p-3 bg-yellow-50 rounded border border-yellow-200">
                💡 <strong>Note:</strong> The remainder will be distributed across the pallets. Each pallet will have slightly more quantity to ensure all items are accounted for.
              </p>

              <div className="flex gap-3 mt-6">
                <button 
                  type="button" 
                  className="flex-1 px-4 py-2.5 bg-orange-600 text-white rounded-lg font-semibold hover:bg-orange-700 transition"
                  onClick={() => {
                    // Proceed with generation despite remainder
                    setRowData([...rowData, ...pendingPalletRows]);
                    setShowPalletGeneration(false);
                    setPalletPasteData('');
                    setPalletGenError(null);
                    setRemainderWarning(null);
                    setPendingPalletRows([]);
                  }}
                >
                  Proceed Anyway
                </button>
                <button 
                  type="button" 
                  className="flex-1 px-4 py-2.5 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400 transition" 
                  onClick={() => {
                    setRemainderWarning(null);
                    setPendingPalletRows([]);
                  }}
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Gatepass Modal */}
        {showGatepassModal && gatepassHeaderId && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <style>{`
              @media print {
                * { margin: 0; padding: 0; }
                body { background: white; }
                .print-hide { display: none !important; }
                .print-table-wrapper { page-break-inside: avoid; }
                .print-table-wrapper tbody tr:nth-child(n+11) { 
                  display: none !important; 
                  page-break-inside: avoid;
                }
                .print-table-wrapper tbody tr { 
                  page-break-inside: avoid;
                }
                .print-button-section { display: none !important; }
              }
              @page {
                size: A4 portrait;
                margin: 10mm;
              }
            `}</style>
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '900px', maxHeight: '95vh', overflowY: 'auto' }}>
              {/* Loading State */}
              {gatepassLoading && (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-lg text-gray-700 font-semibold">Loading gatepass data...</p>
                  </div>
                </div>
              )}

              {/* Content - Only show when not loading */}
              {!gatepassLoading && (() => {
                const header = headerRecords.find(h => h.id === gatepassHeaderId);
                
                // Use fetched gatepass data if available, otherwise show message
                if (!gatepassData) {
                  return (
                    <div className="text-center py-8">
                      <p className="text-gray-700 text-lg font-semibold mb-2">📋 Gatepass Not Yet Created</p>
                      <p className="text-gray-600 text-sm mb-6">Please complete dispatch entry first by clicking the "🚚 Dispatch" button.</p>
                      <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6 max-w-md mx-auto">
                        <p className="text-xs text-gray-700 mb-2"><strong>Steps to create gatepass:</strong></p>
                        <ol className="text-xs text-gray-700 text-left space-y-1">
                          <li>1. Click "🚚 Dispatch" button</li>
                          <li>2. Enter driver, vehicle, and route details</li>
                          <li>3. Click "Save Dispatch"</li>
                          <li>4. Then view gatepass here</li>
                        </ol>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShowGatepassModal(false);
                          setGatepassHeaderId(null);
                        }}
                        className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500 mt-4"
                      >
                        Close
                      </button>
                    </div>
                  );
                }
                
                // Fetch so_inventory record to get quantity_ordered
                let quantityOrdered = 1;
                if (gatepassSoInventory) {
                  quantityOrdered = gatepassSoInventory.quantity_ordered || gatepassSoInventory.quantity_allocated || 1;
                  console.log('Using so_inventory quantity_ordered:', quantityOrdered);
                } else {
                  // Fallback: try to get from pickingBatches
                  const soInventoryRecord = pickingBatches.find(b => b.id === gatepassData.so_inventory_id);
                  if (soInventoryRecord) {
                    quantityOrdered = soInventoryRecord.quantity_ordered || soInventoryRecord.quantity_allocated || 1;
                  }
                }
                
                if (!header) return <div>Header not found</div>;
                
                return (
                  <div className="flex flex-col">
                    {/* Header with Title and Gatepass Number */}
                    <div className="flex items-start justify-between mb-6 border-b pb-4 bg-white">
                      <div>
                        <h1 className="text-4xl font-bold mb-2 text-black">ISSUANCE GATEPASS</h1>
                        <p className="text-gray-800">Goods Release Document for Warehouse Exit</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-800 uppercase font-semibold mb-2">Gatepass #</p>
                        <div className="bg-green-100 p-3 rounded border-2 border-green-600">
                          <p className="text-2xl font-bold text-green-900 tracking-wider font-mono">{gatepassData.gatepass_number || `GP-${new Date().getFullYear()}-${String(gatepassHeaderId).padStart(5, '0')}`}</p>
                        </div>
                      </div>
                    </div>

                    {/* SO Information - Display Only */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-6 border-b pb-4 bg-white">
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">SO Number</p>
                        <p className="text-lg font-bold text-black">{header.so_number || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Gatepass Date</p>
                        <p className="text-lg font-bold text-black">{gatepassData.gatepass_date ? new Date(gatepassData.gatepass_date).toLocaleDateString() : new Date().toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Customer Code</p>
                        <p className="text-lg font-bold text-black">{header.customer_code || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Customer Name</p>
                        <p className="text-lg font-bold text-black">{header.customer_name || '-'}</p>
                      </div>
                    </div>

                    {/* Shipping & Loading Details - Display Only */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-6 border-b pb-4 bg-white">
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Trucking Company</p>
                        <p className="text-lg font-bold text-black">{gatepassData.trucking_company || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Vehicle Plate No.</p>
                        <p className="text-lg font-bold text-black">{gatepassData.vehicle_plate_no || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Driver Name</p>
                        <p className="text-lg font-bold text-black">{gatepassData.driver_name || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Driver Phone / Route</p>
                        <p className="text-lg font-bold text-black">{gatepassData.driver_phone || '-'} / {gatepassData.route || '-'}</p>
                      </div>
                    </div>

                    {/* Items Table - From Loading Checklist (All batch rows) */}
                    <div className="mb-6 print-table-wrapper">
                      <h3 className="text-lg font-bold mb-3 uppercase text-black">Released Items</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-gray-400 text-xs bg-white">
                          <thead style={{ pageBreakInside: 'avoid' }}>
                            <tr className="bg-green-200">
                              <th className="border border-gray-400 px-2 py-1 text-left font-bold text-black">Item Code</th>
                              <th className="border border-gray-400 px-2 py-1 text-left font-bold text-black" style={{ minWidth: '200px' }}>Item Name</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Released Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Batch #</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Mfg Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Exp Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Weight (KG) per Unit</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Total Weight (KG)</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">UOM</th>
                            </tr>
                          </thead>
                          <tbody>
                            {verifiedChecklistItems && verifiedChecklistItems.length > 0 ? (
                              verifiedChecklistItems.map((item: any, idx: number) => {
                                // Get item config data for weight and UOM
                                const itemConfig = Object.values(itemsByCode || {}).find((config: any) => 
                                  config.item_code === item.item_code || config.code === item.item_code
                                );
                                
                                const weightKg = itemConfig?.weight_uom_kg || itemConfig?.weight_kg || item.weight_uom_kg || 0;
                                const uom = itemConfig?.uom || itemConfig?.item_uom || item.uom || '-';
                                const releasedQty = item.checked_qty || item.ordered_qty || 0;
                                const totalWeight = (Number(weightKg) * Number(releasedQty)).toFixed(2);
                                
                                return (
                                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} style={{ pageBreakInside: 'avoid', display: idx < 10 ? 'table-row' : 'none' }}>
                                    <td className="border border-gray-400 px-2 py-1 text-black">{item.item_code || '-'}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-black" style={{ minWidth: '200px', wordWrap: 'break-word', whiteSpace: 'normal', maxWidth: '200px' }}>{item.item_name || '-'}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center font-semibold text-black">{releasedQty || '-'}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center font-semibold text-black">{item.batch_number || '-'}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{item.manufacturing_date ? new Date(item.manufacturing_date).toLocaleDateString() : '-'}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '-'}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center font-semibold text-black">{Number(weightKg).toFixed(2)}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center font-bold text-black bg-yellow-50">{totalWeight}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{uom}</td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr className="bg-white">
                                <td colSpan={9} className="border border-gray-400 px-2 py-1 text-center text-gray-500">No items to display</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Authorization Section */}
                    <div className="mt-8 grid grid-cols-3 gap-8">
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-2 mb-2" style={{ width: '100%', height: '60px' }}></div>
                        <p className="text-xs font-semibold uppercase">Released By</p>
                        <p className="text-xs text-gray-600">Warehouse Manager</p>
                      </div>
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-2 mb-2" style={{ width: '100%', height: '60px' }}></div>
                        <p className="text-xs font-semibold uppercase">Verified By</p>
                        <p className="text-xs text-gray-600">Security Officer</p>
                      </div>
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-2 mb-2" style={{ width: '100%', height: '60px' }}></div>
                        <p className="text-xs font-semibold uppercase">Received By</p>
                        <p className="text-xs text-gray-600">Transport/Recipient</p>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-8 text-center text-xs text-gray-600 border-t pt-4">
                      <p className="font-semibold text-green-700">✓ GOODS CLEARED FOR GATE RELEASE</p>
                      <p>This gatepass must be presented at the warehouse exit gate.</p>
                      <p>Generated on: {gatepassData.created_at ? new Date(gatepassData.created_at).toLocaleString() : new Date().toLocaleString()}</p>
                    </div>

                    {/* Action Buttons - Print Only */}
                    <div className="mt-6 flex gap-3 justify-center print-button-section">
                      <button
                        type="button"
                        onClick={() => {
                          const printWindow = window.open('', '_blank');
                          if (printWindow) {
                            // Build items table rows from gatepass data
                            let tableRowsHtml = '';
                            if (verifiedChecklistItems && verifiedChecklistItems.length > 0) {
                              tableRowsHtml = verifiedChecklistItems.map((item: any, idx: number) => {
                                const itemConfig = Object.values(itemsByCode || {}).find((config: any) => 
                                  config.item_code === item.item_code || config.code === item.item_code
                                );
                                const weightKg = itemConfig?.weight_uom_kg || itemConfig?.weight_kg || item.weight_uom_kg || 0;
                                const uom = itemConfig?.uom || itemConfig?.item_uom || item.uom || '-';
                                const releasedQty = item.checked_qty || item.ordered_qty || 0;
                                const totalWeight = (Number(weightKg) * Number(releasedQty)).toFixed(2);
                                
                                return `
                                  <tr>
                                    <td>${item.item_code || '-'}</td>
                                    <td>${item.item_name || '-'}</td>
                                    <td>${releasedQty || '-'}</td>
                                    <td>${item.batch_number || '-'}</td>
                                    <td>${item.manufacturing_date ? new Date(item.manufacturing_date).toLocaleDateString() : '-'}</td>
                                    <td>${item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '-'}</td>
                                    <td>${Number(weightKg).toFixed(2)}</td>
                                    <td>${totalWeight}</td>
                                    <td>${uom}</td>
                                  </tr>
                                `;
                              }).join('');
                            } else {
                              tableRowsHtml = '<tr><td colspan="9" style="text-align: center;">No items to display</td></tr>';
                            }

                            const htmlContent = `
                              <!DOCTYPE html>
                              <html>
                              <head>
                                <meta charset="UTF-8">
                                <title>ISSUANCE GATEPASS - ${header?.so_number || 'N/A'}</title>
                                <style>
                                  body { font-family: Arial, sans-serif; margin: 20px; }
                                  h1 { font-size: 24px; margin-bottom: 5px; text-align: center; }
                                  .subtitle { text-align: center; font-size: 12px; margin-bottom: 15px; color: #666; }
                                  .gatepass-number { text-align: right; margin-bottom: 15px; }
                                  .gatepass-number strong { font-size: 18px; background-color: #e8f5e9; padding: 5px 10px; border: 2px solid #2e7d32; }
                                  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 15px; margin-bottom: 15px; border-bottom: 1px solid #999; padding-bottom: 15px; }
                                  .info-field { }
                                  .info-field .label { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #666; }
                                  .info-field .value { font-size: 13px; font-weight: bold; color: #000; }
                                  table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                                  th, td { border: 1px solid #999; padding: 8px; text-align: left; font-size: 11px; }
                                  th { background-color: #c8e6c9; font-weight: bold; text-align: center; }
                                  td { text-align: center; }
                                  td:nth-child(1), td:nth-child(2) { text-align: left; }
                                  tr:nth-child(even) { background-color: #f9f9f9; }
                                  .signature-section { margin: 40px 0; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
                                  .signature-line { text-align: center; }
                                  .signature-line .line { border-top: 2px solid #000; height: 50px; margin-bottom: 10px; }
                                  .signature-line .label { font-size: 12px; font-weight: bold; text-transform: uppercase; }
                                  .footer { margin-top: 30px; text-align: center; font-size: 11px; border-top: 1px solid #999; padding-top: 15px; color: #2e7d32; font-weight: bold; }
                                  @media print { body { margin: 0; } }
                                </style>
                              </head>
                              <body>
                                <h1>ISSUANCE GATEPASS</h1>
                                <p class="subtitle">Goods Release Document for Warehouse Exit</p>
                                
                                <div class="gatepass-number">
                                  <strong>GP #: ${gatepassData?.gatepass_number || 'N/A'}</strong>
                                </div>
                                
                                <div class="info-grid">
                                  <div class="info-field">
                                    <div class="label">SO Number</div>
                                    <div class="value">${header?.so_number || '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">Gatepass Date</div>
                                    <div class="value">${gatepassData?.gatepass_date ? new Date(gatepassData.gatepass_date).toLocaleDateString() : new Date().toLocaleDateString()}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">Customer Code</div>
                                    <div class="value">${header?.customer_code || '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">Customer Name</div>
                                    <div class="value">${header?.customer_name || '-'}</div>
                                  </div>
                                </div>
                                
                                <div class="info-grid">
                                  <div class="info-field">
                                    <div class="label">Trucking Company</div>
                                    <div class="value">${gatepassData?.trucking_company || '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">Vehicle Plate No.</div>
                                    <div class="value">${gatepassData?.vehicle_plate_no || '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">Driver Name</div>
                                    <div class="value">${gatepassData?.driver_name || '-'}</div>
                                  </div>
                                  <div class="info-field">
                                    <div class="label">Route</div>
                                    <div class="value">${gatepassData?.route || '-'}</div>
                                  </div>
                                </div>
                                
                                <h3 style="font-size: 16px; margin-top: 15px; margin-bottom: 10px; text-transform: uppercase; font-weight: bold;">Released Items</h3>
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Item Code</th>
                                      <th style="min-width: 150px;">Item Name</th>
                                      <th>Released Qty</th>
                                      <th>Batch #</th>
                                      <th>Mfg Date</th>
                                      <th>Exp Date</th>
                                      <th>Weight (KG)</th>
                                      <th>Total Weight</th>
                                      <th>UOM</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    ${tableRowsHtml}
                                  </tbody>
                                </table>
                                
                                <div class="signature-section">
                                  <div class="signature-line">
                                    <div class="line"></div>
                                    <div class="label">Released By</div>
                                    <div style="font-size: 10px; color: #666;">Warehouse Manager</div>
                                  </div>
                                  <div class="signature-line">
                                    <div class="line"></div>
                                    <div class="label">Verified By</div>
                                    <div style="font-size: 10px; color: #666;">Security Officer</div>
                                  </div>
                                  <div class="signature-line">
                                    <div class="line"></div>
                                    <div class="label">Received By</div>
                                    <div style="font-size: 10px; color: #666;">Transport/Recipient</div>
                                  </div>
                                </div>
                                
                                <div class="footer">
                                  <p>✓ GOODS CLEARED FOR GATE RELEASE</p>
                                  <p>This gatepass must be presented at the warehouse exit gate.</p>
                                  <p style="color: #999;">Generated on: ${new Date().toLocaleString()}</p>
                                </div>
                              </body>
                              <script>
                                window.onload = function() {
                                  window.print();
                                };
                              </script>
                              </html>
                            `;
                            printWindow.document.write(htmlContent);
                            printWindow.document.close();
                          }
                        }}
                        className="px-6 py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700"
                      >
                        Print Gatepass
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          // Confirm shipment and update inventory status
                          const selectedHeader = headerRecords.find(h => h.id === gatepassHeaderId);
                          if (!selectedHeader) {
                            alert('No SO selected');
                            return;
                          }
                          
                          try {
                            console.log('🚚 Confirming shipment for SO:', selectedHeader.id);
                            
                            // Step 1: Get SO lines and their inventory data
                            const soLines = lineRecords.filter(l => l.so_header_id === gatepassHeaderId);
                            console.log('📋 SO Lines:', soLines.length);
                            
                            // Step 2: Update so_inventory records - mark as shipped
                            let soInventoryUpdateCount = 0;
                            let soInventoryFailureCount = 0;
                            
                            for (const soLine of soLines) {
                              try {
                                // Fetch so_inventory for this SO line
                                const soInventoryRes = await fetch(
                                  `/api/so-inventory?so_line_id=${soLine.id}`,
                                  { method: 'GET' }
                                );
                                
                                if (soInventoryRes.ok) {
                                  const soInventoryData = await soInventoryRes.json();
                                  const soInventoryRecords = Array.isArray(soInventoryData) ? soInventoryData : (soInventoryData?.data || []);
                                  
                                  for (const soInvRecord of soInventoryRecords) {
                                    // Match verified item using ABSOLUTE criteria: item_code + batch_number + so_line_id + pallet_id
                                    // This ensures we ship ONLY the EXACT pallet that was allocated, not just any pallet with same item/batch
                                    const verifiedItem = verifiedChecklistItems.find((v: any) => {
                                      const codeMatch = v.item_code === soInvRecord.item_code;
                                      const batchMatch = v.batch_number === soInvRecord.batch_number;
                                      const lineMatch = v.so_line_id === soLine.id;
                                      const palletMatch = v.pallet_id === soInvRecord.pallet_id; // CRITICAL: Match exact pallet
                                      const absoluteMatch = codeMatch && batchMatch && lineMatch && palletMatch;
                                      
                                      if (codeMatch && batchMatch && lineMatch && !palletMatch) {
                                        console.warn(`⚠️ PALLET MISMATCH: ${soInvRecord.item_code} batch ${soInvRecord.batch_number} - allocated pallet: ${soInvRecord.pallet_id}, verified pallet: ${v.pallet_id}`);
                                      }
                                      if (absoluteMatch) {
                                        console.log(`✅ ABSOLUTE MATCH: ${soInvRecord.item_code} batch ${soInvRecord.batch_number} pallet ${soInvRecord.pallet_id} on SO line ${soLine.id}`);
                                      }
                                      return absoluteMatch;
                                    });
                                    const shippedQty = verifiedItem ? Number(verifiedItem.checked_qty) || 0 : 
                                                       (soInvRecord.quantity_allocated || soInvRecord.quantity_picked || 0);
                                    
                                    console.log(`📦 Updating so_inventory ${soInvRecord.id} (${soInvRecord.item_code}/BAT-${soInvRecord.batch_number}) - released qty: ${shippedQty} (verified: ${verifiedItem ? 'yes' : 'no'})`);
                                    
                                    // Update so_inventory to shipped
                                    const updatePayload = {
                                      table: 'so_inventory',
                                      id: soInvRecord.id,  // ✅ CRITICAL: id must be at top level, not in match
                                      data: {
                                        status: 'shipped',
                                        quantity_shipped: shippedQty,
                                        quantity_allocated: 0,
                                        shipped_at: new Date().toISOString(),
                                        updated_at: new Date().toISOString()
                                      }
                                    };
                                    
                                    console.log(`  📤 PATCH payload:`, JSON.stringify(updatePayload));
                                    
                                    const updateRes = await fetch('/api/patch-record', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify(updatePayload)
                                    });
                                    
                                    const updateResText = await updateRes.text();
                                    if (!updateRes.ok) {
                                      console.error(`  ❌ PATCH FAILED: Status=${updateRes.status}, Response=${updateResText}`);
                                      soInventoryFailureCount++;
                                    } else {
                                      console.log(`  ✅ PATCH SUCCESS: Status=${updateRes.status}`);
                                      soInventoryUpdateCount++;
                                    }
                                  }
                                }
                              } catch (err) {
                                console.error(`Error fetching so_inventory for line ${soLine.id}:`, err);
                                soInventoryFailureCount++;
                              }
                            }
                            
                            console.log(`📊 SO inventory updates: ${soInventoryUpdateCount} succeeded, ${soInventoryFailureCount} failed`);
                            if (soInventoryFailureCount > 0) {
                              throw new Error(`${soInventoryFailureCount} SO inventory updates failed`);
                            }
                            console.log('✅ Step 2 Complete: SO inventory records updated to shipped');
                            
                            // Step 3: Deduct from main inventory table (on_hand_quantity) and add to quantity_shipped
                            try {
                              for (const soLine of soLines) {
                                const soInventoryRes = await fetch(
                                  `/api/so-inventory?so_line_id=${soLine.id}`,
                                  { method: 'GET' }
                                );
                                
                                if (soInventoryRes.ok) {
                                  const soInventoryData = await soInventoryRes.json();
                                  const soInventoryRecords = Array.isArray(soInventoryData) ? soInventoryData : (soInventoryData?.data || []);
                                  
                                  for (const soInvRecord of soInventoryRecords) {
                                    // Match verified item using ABSOLUTE criteria: item_code + batch_number + so_line_id + pallet_id
                                    // This ensures we ship ONLY the EXACT pallet that was allocated, not just any pallet with same item/batch
                                    const verifiedItem = verifiedChecklistItems.find((v: any) => {
                                      const codeMatch = v.item_code === soInvRecord.item_code;
                                      const batchMatch = v.batch_number === soInvRecord.batch_number;
                                      const lineMatch = v.so_line_id === soLine.id;
                                      const palletMatch = v.pallet_id === soInvRecord.pallet_id; // CRITICAL: Match exact pallet
                                      return codeMatch && batchMatch && lineMatch && palletMatch;
                                    });
                                    const shippedQty = verifiedItem ? Number(verifiedItem.checked_qty) || 0 : 
                                                       (Number(soInvRecord.quantity_picked) || Number(soInvRecord.quantity_allocated) || 0);
                                    
                                    if (shippedQty <= 0) {
                                      console.log(`⚠️ Skipping so_inventory ${soInvRecord.id} - no quantity to ship`);
                                      continue;
                                    }
                                    
                                    // Find matching inventory record - MUST match pallet_id + item_id
                                    // If SO inventory has batch_number, also validate it (prevent wrong batch)
                                    // If SO inventory missing batch_number, just match on pallet (pallet is unique enough)
                                    let invRecord: any = null;
                                    
                                    if (soInvRecord.pallet_id) {
                                      // CRITICAL: Find by pallet_id + item_id (absolute required match)
                                      console.log(`🔎 [Step 3] Looking for inventory: pallet="${soInvRecord.pallet_id}", item_id=${soInvRecord.item_id}`);
                                      
                                      // Fetch full inventory and filter client-side
                                      // (inventory-records API doesn't support query filtering)
                                      const invRes = await fetch(
                                        `/api/inventory-records?year=${new Date().getFullYear()}&warehouse=${selectedHeader.warehouse_id || 5}`,
                                        { method: 'GET' }
                                      );
                                      
                                      if (invRes.ok) {
                                        const invData = await invRes.json();
                                        const allInventory = Array.isArray(invData.inventory) ? invData.inventory : [];
                                        
                                        console.log(`  📦 Fetched ${allInventory.length} total inventory records, filtering...`);
                                        
                                        // Filter for matching pallet + item
                                        const matchedRecord = allInventory.find((rec: any) => 
                                          rec.pallet_id === soInvRecord.pallet_id && 
                                          rec.item_id === soInvRecord.item_id
                                        );
                                        
                                        if (matchedRecord) {
                                          invRecord = matchedRecord;
                                          console.log(`  ✅ MATCHED: Found pallet "${soInvRecord.pallet_id}", item ${soInvRecord.item_id}, location=${matchedRecord.location_id}, status=${matchedRecord.inventory_status}`);
                                        } else {
                                          // Show what pallets exist for this item
                                          const similarRecords = allInventory.filter((r: any) => r.item_id === soInvRecord.item_id);
                                          console.error(`  ❌ NO MATCH: Pallet "${soInvRecord.pallet_id}" not found for item_id=${soInvRecord.item_id}`);
                                          console.log(`     Similar records for this item:`, similarRecords.map((r: any) => ({ pallet: r.pallet_id, location: r.location_id, status: r.inventory_status })));
                                          invRecord = null;
                                        }
                                      } else {
                                        console.error(`  ❌ API ERROR: Failed to fetch inventory records, status=${invRes.status}`);
                                      }
                                    }
                                    
                                    // FALLBACK: Only if pallet_id not found above
                                    // Search by item_id only - will match the FIRST putaway inventory of that item
                                    if (!invRecord && !soInvRecord.pallet_id) {
                                      console.log(`🔍 [FALLBACK] No pallet_id in SO inventory, searching by item_id only...`);
                                      const inventoryRes = await fetch(
                                        `/api/inventory-records?item_id=${soInvRecord.item_id}`,
                                        { method: 'GET' }
                                      );
                                      
                                      if (inventoryRes.ok) {
                                        const inventoryData = await inventoryRes.json();
                                        const inventoryRecords = Array.isArray(inventoryData) ? inventoryData : (inventoryData?.inventory || []);
                                        
                                        // Find the FIRST putaway inventory record with available qty
                                        const matchedRecord = inventoryRecords.find((rec: any) => 
                                          rec.item_id === soInvRecord.item_id && 
                                          rec.inventory_status === 'putaway' && // Must be putaway
                                          (Number(rec.available_quantity) || 0) > 0 // Must have available
                                        );
                                        
                                        if (matchedRecord) {
                                          invRecord = matchedRecord;
                                          console.log(`✅ [FALLBACK MATCH] Found inventory record for item ${soInvRecord.item_id} at pallet ${matchedRecord.pallet_id}`);
                                        } else {
                                          console.warn(`⚠️ [FALLBACK FAILED] No putaway inventory found for item ${soInvRecord.item_id}`);
                                        }
                                      }
                                    }
                                    
                                    if (!invRecord) {
                                      console.warn(`⚠️ No inventory record found for SO inventory ${soInvRecord.id}`);
                                      continue;
                                    }
                                    
                                    // Update only the matched inventory record
                                    {
                                      // Calculate new values
                                      const currentOnHand = Number(invRecord.on_hand_quantity) || 0;
                                      const currentAllocated = Number(invRecord.allocated_quantity) || 0;
                                      const currentShipped = Number(invRecord.quantity_shipped) || 0;
                                      
                                      const newOnHand = Math.max(0, currentOnHand - shippedQty);
                                      const newQuantityShipped = currentShipped + shippedQty;
                                      
                                      // available_quantity = on_hand_quantity - allocated_quantity
                                      // Since we're shipping, allocated should be 0 and available should equal new on_hand
                                      const newAvailable = newOnHand;
                                      
                                      const inventoryUpdatePayload = {
                                        table: 'inventory',
                                        id: invRecord.id,
                                        data: {
                                          on_hand_quantity: newOnHand,
                                          available_quantity: newAvailable,
                                          allocated_quantity: 0,
                                          quantity_shipped: newQuantityShipped,
                                          shipped_at: new Date().toISOString(),
                                          inventory_status: 'shipped'
                                        }
                                      };
                                      
                                      console.log(`💾 Updating inventory ${invRecord.id} (pallet: ${invRecord.pallet_id}):`, {
                                        on_hand: `${currentOnHand} → ${newOnHand}`,
                                        shipped: `${currentShipped} → ${newQuantityShipped}`,
                                        allocated: `${currentAllocated} → 0`,
                                        available: `${invRecord.available_quantity || 0} → ${newAvailable}`
                                      });
                                      
                                      const patchRes = await fetch('/api/patch-record', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(inventoryUpdatePayload)
                                      });
                                      
                                      if (!patchRes.ok) {
                                        const err = await patchRes.text();
                                        console.error(`❌ Failed to update inventory ${invRecord.id}:`, err);
                                      }
                                    }
                                  }
                                }
                              }
                              console.log('✅ Main inventory records updated - quantities deducted and shipped qty added');
                            } catch (err) {
                              console.error('Error updating main inventory:', err);
                            }
                            
                            // Step 4: Update SO header status to 'Shipped'
                            const updateRes = await fetch('/api/so-data', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                action: 'updateHeader',
                                headerId: selectedHeader.id,
                                header: { 
                                  status: 'Shipped', 
                                  updated_at: new Date().toISOString() 
                                }
                              })
                            });
                            
                            if (updateRes.ok) {
                              console.log('✅ SO status updated to Shipped');
                              alert('✅ Shipment confirmed! Inventory updated and items marked as shipped.');
                              
                              // Refresh SO headers
                              const headersData = await fetch(`/api/outbound-records?year=${new Date().getFullYear()}`);
                              const data = await headersData.json();
                              setHeaderRecords(Array.isArray(data.soHeaders) ? data.soHeaders : []);
                              
                              // Close modal and reset
                              setShowGatepassModal(false);
                              setGatepassHeaderId(null);
                            } else {
                              const err = await updateRes.text();
                              console.error('❌ Failed to update SO status:', err);
                              alert('Failed to complete shipment confirmation');
                            }
                          } catch (err) {
                            console.error('❌ Error confirming shipment:', err);
                            alert('Error confirming shipment');
                          }
                        }}
                        className="px-6 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700"
                      >
                        ✓ Confirm Ship
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowGatepassModal(false);
                          setGatepassHeaderId(null);
                          setGatepassData(null);
                          setGatepassLoading(false);
                        }}
                        className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
        
        {/* Dispatch Modal - Form Input */}
        {showDispatchModal && dispatchHeaderId && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '800px', maxHeight: '95vh', overflowY: 'auto' }}>
              {(() => {
                const header = headerRecords.find(h => h.id === dispatchHeaderId);
                if (!header) return <div>Header not found</div>;
                
                return (
                  <div className="flex flex-col">
                    {/* Header */}
                    <div className="mb-6 border-b pb-4">
                      <h1 className="text-3xl font-bold mb-2">DISPATCH AUTHORIZATION</h1>
                      <p className="text-gray-600">Capture truck, driver, and route information</p>
                    </div>

                    {/* SO Information */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4 mb-6 border-b pb-4">
                      <div>
                        <p className="text-xs text-gray-600 uppercase font-semibold">SO Number</p>
                        <p className="text-lg font-bold">{header.so_number || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600 uppercase font-semibold">Vendor</p>
                        <p className="text-lg font-bold">{header.customer_name || '-'}</p>
                      </div>
                    </div>

                    {/* Form Fields */}
                    <div className="space-y-4 mb-6">
                      {/* Trucking Company */}
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Trucking Company *</label>
                        <input
                          type="text"
                          value={dispatchForm.trucking_company}
                          onChange={(e) => setDispatchForm({...dispatchForm, trucking_company: e.target.value})}
                          className="w-full border rounded px-3 py-2 text-sm"
                          placeholder="e.g., ABC Logistics"
                        />
                      </div>

                      {/* Vehicle Plate No */}
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Vehicle Plate No. *</label>
                        <input
                          type="text"
                          value={dispatchForm.vehicle_plate_no}
                          onChange={(e) => setDispatchForm({...dispatchForm, vehicle_plate_no: e.target.value})}
                          className="w-full border rounded px-3 py-2 text-sm"
                          placeholder="e.g., ABC-1234"
                        />
                      </div>

                      {/* Driver Name */}
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Driver Name *</label>
                        <input
                          type="text"
                          value={dispatchForm.driver_name}
                          onChange={(e) => setDispatchForm({...dispatchForm, driver_name: e.target.value})}
                          className="w-full border rounded px-3 py-2 text-sm"
                          placeholder="Driver full name"
                        />
                      </div>

                      {/* Driver Phone */}
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Driver Phone *</label>
                        <input
                          type="tel"
                          value={dispatchForm.driver_phone}
                          onChange={(e) => setDispatchForm({...dispatchForm, driver_phone: e.target.value})}
                          className="w-full border rounded px-3 py-2 text-sm"
                          placeholder="e.g., +63-9XX-XXXXXXX"
                        />
                      </div>

                      {/* Route */}
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Route *</label>
                        <input
                          type="text"
                          value={dispatchForm.route}
                          onChange={(e) => setDispatchForm({...dispatchForm, route: e.target.value})}
                          className="w-full border rounded px-3 py-2 text-sm"
                          placeholder="e.g., Metro Manila Route A"
                        />
                      </div>

                      {/* Remarks */}
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">Remarks</label>
                        <textarea
                          value={dispatchForm.remarks}
                          onChange={(e) => setDispatchForm({...dispatchForm, remarks: e.target.value})}
                          className="w-full border rounded px-3 py-2 text-sm"
                          placeholder="Additional notes (optional)"
                          rows={3}
                        />
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-6 flex gap-3 justify-center">
                      <button
                        type="button"
                        disabled={
                          // Get the current header record
                          (() => {
                            const header = headerRecords.find(h => h.id === dispatchHeaderId);
                            // Disable button if header already has dispatch data
                            return header && (
                              !!header.driver_name || 
                              !!header.driver_phone || 
                              !!header.vehicle_plate_no || 
                              !!header.trucking_company || 
                              !!header.route
                            );
                          })()
                        }
                        onClick={async () => {
                          // Validate required fields
                          if (!dispatchForm.driver_name.trim()) {
                            alert('Driver Name is required');
                            return;
                          }
                          if (!dispatchForm.driver_phone.trim()) {
                            alert('Driver Phone is required');
                            return;
                          }
                          if (!dispatchForm.vehicle_plate_no.trim()) {
                            alert('Vehicle Plate No. is required');
                            return;
                          }
                          if (!dispatchForm.trucking_company.trim()) {
                            alert('Trucking Company is required');
                            return;
                          }
                          if (!dispatchForm.route.trim()) {
                            alert('Route is required');
                            return;
                          }

                          try {
                            // Check if gatepass already exists for this SO header
                            const existingGatepassRes = await fetch(`/api/gatepass?so_header_id=${dispatchHeaderId}`, {
                              method: 'GET',
                            });
                            
                            let existingGatepassId = null;
                            if (existingGatepassRes.ok) {
                              const result = await existingGatepassRes.json();
                              const gatepassArray = Array.isArray(result) ? result : (result?.data || []);
                              if (gatepassArray.length > 0) {
                                existingGatepassId = gatepassArray[0].id;
                                console.log('📦 Found existing gatepass:', existingGatepassId);
                              }
                            }

                            // Generate unique gatepass number: GP-YYYY-SOID-TIMESTAMP
                            const generatedGatepassNumber = existingGatepassId 
                              ? `GP-${new Date().getFullYear()}-${String(dispatchHeaderId).padStart(5, '0')}`
                              : `GP-${new Date().getFullYear()}-${String(dispatchHeaderId).padStart(5, '0')}-${(Date.now() % 100000).toString().padStart(5, '0')}`;
                            
                            // Get SO lines for this order
                            const soLines = lineRecords.filter(l => l.so_header_id === dispatchHeaderId);
                            const firstLine = soLines[0];
                            const firstItemData = firstLine ? items.find(i => i.id === firstLine.item_id) : null;
                            
                            // Try to get batch data from pickingBatches, or from so_inventory if not available
                            let firstBatchData = firstLine ? pickingBatches.find(b => b.so_line_id === firstLine.id) : null;
                            
                            // If no pickingBatches available, fetch from so_inventory for this SO line
                            if (!firstBatchData && firstLine) {
                              try {
                                const soInventoryRes = await fetch(
                                  `/api/so-inventory?so_line_id=${firstLine.id}`,
                                  {
                                    method: 'GET',
                                  }
                                );
                                if (soInventoryRes.ok) {
                                  const soInventoryData = await soInventoryRes.json();
                                  if (Array.isArray(soInventoryData) && soInventoryData.length > 0) {
                                    firstBatchData = soInventoryData[0];
                                    console.log('📦 Fetched so_inventory for first line:', {id: firstBatchData.id, batch_number: firstBatchData.batch_number, so_line_id: firstBatchData.so_line_id});
                                  }
                                }
                              } catch (err) {
                                console.warn('Could not fetch so_inventory for batch details:', err);
                              }
                            }
                            
                            const gatepassData = {
                              so_header_id: dispatchHeaderId,
                              so_inventory_id: firstBatchData?.id || null,
                              gatepass_number: generatedGatepassNumber,
                              gatepass_date: new Date().toISOString(),
                              driver_name: dispatchForm.driver_name.trim(),
                              driver_phone: dispatchForm.driver_phone.trim(),
                              vehicle_plate_no: dispatchForm.vehicle_plate_no.trim(),
                              trucking_company: dispatchForm.trucking_company.trim(),
                              route: dispatchForm.route.trim(),
                              status: 'Draft',
                              loading_checklist_status: 'Pending',
                              remarks: dispatchForm.remarks.trim() || null,
                              // Add item details from first SO line (for gatepass summary)
                              item_code: firstLine?.item_code || firstBatchData?.item_code || null,
                              item_name: firstLine?.item_name || firstBatchData?.item_name || null,
                              batch_number: firstBatchData?.batch_number || null,
                              manufacturing_date: firstBatchData?.manufacturing_date || null,
                              expiry_date: firstBatchData?.expiry_date || null,
                              weight_uom_kg: firstItemData?.weight_uom_kg || firstItemData?.weight_kg || firstBatchData?.weight_uom_kg || null,
                              uom: firstLine?.item_uom || firstItemData?.item_uom || firstBatchData?.item_uom || null
                            };

                            // Save gatepass header through API route (with caching support)
                            // If gatepass exists, update it; otherwise create new
                            const action = existingGatepassId ? 'update-gatepass' : 'create-gatepass';
                            const response = await fetch('/api/gatepass', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                action: action,
                                gatepassId: existingGatepassId || undefined,
                                ...gatepassData
                              })
                            });

                            if (response.ok) {
                              const result = await response.json();
                              const gatepassId = result.gatepassId || existingGatepassId;
                              
                              if (gatepassId) {
                                // Get SO lines for this gatepass
                                const soLines = lineRecords.filter(l => l.so_header_id === dispatchHeaderId);

                                // Fetch allocated items from so_inventory if pickingBatches is empty
                                let allocatedItems = soLines.map(line => pickingBatches.find(b => b.so_line_id === line.id)).filter(Boolean);
                                
                                if (allocatedItems.length === 0) {
                                  try {
                                    // Fetch so_inventory records for each SO line (since so_inventory has so_line_id, not so_header_id)
                                    const soLineIds = soLines.map(l => l.id);
                                    const allAllocatedItems = [];
                                    
                                    for (const soLineId of soLineIds) {
                                      const soInventoryRes = await fetch(
                                        `/api/so-inventory?so_line_id=${soLineId}`,
                                        {
                                          method: 'GET',
                                        }
                                      );
                                      if (soInventoryRes.ok) {
                                        const soInventoryData = await soInventoryRes.json();
                                        if (Array.isArray(soInventoryData) && soInventoryData.length > 0) {
                                          allAllocatedItems.push(...soInventoryData);
                                        }
                                      }
                                    }
                                    
                                    if (allAllocatedItems.length > 0) {
                                      allocatedItems = allAllocatedItems;
                                      console.log('📦 Fetched so_inventory items:', JSON.stringify(allocatedItems.map(a => ({id: a.id, so_line_id: a.so_line_id, batch_number: a.batch_number, item_id: a.item_id}))));
                                    }
                                  } catch (err) {
                                    console.warn('Could not fetch so_inventory for loading checklist:', err);
                                  }
                                }

                                // Prepare loading checklist items with batch data
                                const checklistItems = soLines.map(line => {
                                  const itemData = items.find(i => i.id === line.item_id);
                                  // Get batch data from allocated items (either pickingBatches or so_inventory)
                                  // Match by so_line_id if available, otherwise by item_id
                                  let batchData = allocatedItems.find(b => b.so_line_id === line.id);
                                  if (!batchData) {
                                    // Fallback: match by item_id
                                    batchData = allocatedItems.find(b => b.item_id === line.item_id);
                                  }
                                  
                                  if (batchData) {
                                    console.log(`✅ Matched SO line ${line.id} with so_inventory ${batchData.id}:`, {batch_number: batchData.batch_number, mfg_date: batchData.manufacturing_date, exp_date: batchData.expiry_date});
                                  } else {
                                    console.warn(`⚠️ No batch data found for SO line ${line.id}, available items:`, allocatedItems.length);
                                  }
                                  
                                  const batchNumber = batchData?.batch_number || '';
                                  const palletId = batchData?.pallet_id || '';
                                  const mfgDate = batchData?.manufacturing_date || null;
                                  const expDate = batchData?.expiry_date || null;

                                  return {
                                    so_line_id: line.id,
                                    so_inventory_id: batchData?.id || null,
                                    item_id: line.item_id,
                                    item_code: line.item_code || batchData?.item_code,
                                    item_name: line.item_name || batchData?.item_name,
                                    batch_number: batchNumber,
                                    manufacturing_date: mfgDate,
                                    expiry_date: expDate,
                                    ordered_quantity: line.ordered_quantity,
                                    weight_kg: itemData?.weight_kg || itemData?.weight_uom_kg || batchData?.weight_uom_kg || 0,
                                    uom: line.item_uom || itemData?.item_uom || batchData?.item_uom || '',
                                    pallet_id: palletId,
                                    location_code: null,
                                    remarks: null
                                  };
                                });
                                
                                console.log('🚀 Sending checklist items to API:', JSON.stringify(checklistItems.map(ci => ({so_line_id: ci.so_line_id, so_inventory_id: ci.so_inventory_id, batch_number: ci.batch_number, mfg_date: ci.manufacturing_date, exp_date: ci.expiry_date}))));

                                // Create loading checklist through API route (with caching support)
                                const checklistResponse = await fetch('/api/gatepass', {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    action: 'create-loading-checklist',
                                    gatepass_id: gatepassId,
                                    items: checklistItems
                                  })
                                });

                                if (checklistResponse.ok) {
                                  const checklistResult = await checklistResponse.json();
                                  alert(`✅ Dispatch saved successfully! Gatepass and ${checklistResult.message}`);
                                } else {
                                  const errorData = await checklistResponse.json().catch(() => null);
                                  const errorMsg = errorData?.error || errorData?.details || 'Unknown error';
                                  console.error('Loading checklist creation error:', { status: checklistResponse.status, errorData });
                                  alert(`⚠️ Gatepass saved but loading checklist creation failed: ${errorMsg}`);
                                }
                              } else {
                                alert('⚠️ Gatepass saved but could not verify ID. Skipping loading checklist.');
                              }

                              // Refresh SO headers to show updated data
                              setHeaderRecords(prev => prev.map(h => 
                                h.id === dispatchHeaderId 
                                  ? {
                                      ...h,
                                      driver_name: dispatchForm.driver_name,
                                      driver_phone: dispatchForm.driver_phone,
                                      vehicle_plate_no: dispatchForm.vehicle_plate_no,
                                      trucking_company: dispatchForm.trucking_company,
                                      route: dispatchForm.route
                                    }
                                  : h
                              ));
                              setShowDispatchModal(false);
                              setDispatchHeaderId(null);
                              setDispatchForm({
                                driver_name: '',
                                driver_phone: '',
                                vehicle_plate_no: '',
                                trucking_company: '',
                                route: '',
                                remarks: ''
                              });
                            } else {
                              const errorData = await response.json().catch(() => null);
                              const errorMsg = errorData?.error || errorData?.details || 'Unknown error';
                              console.error('Gatepass creation failed:', { status: response.status, errorData });
                              alert(`❌ Failed to save dispatch: ${errorMsg}`);
                            }
                          } catch (err) {
                            console.error('Error saving dispatch:', err);
                            alert(`Error saving dispatch: ${(err as any).message}`);
                          }
                        }}
                        className={`px-6 py-2 rounded font-semibold ${
                          (() => {
                            const header = headerRecords.find(h => h.id === dispatchHeaderId);
                            const hasDispatchData = header && (
                              !!header.driver_name || 
                              !!header.driver_phone || 
                              !!header.vehicle_plate_no || 
                              !!header.trucking_company || 
                              !!header.route
                            );
                            return hasDispatchData
                              ? 'bg-gray-400 text-gray-600 cursor-not-allowed'
                              : 'bg-blue-600 text-white hover:bg-blue-700';
                          })()
                        }`}
                      >
                        Save Dispatch
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowDispatchModal(false);
                          setDispatchHeaderId(null);
                          setDispatchForm({
                            driver_name: '',
                            driver_phone: '',
                            vehicle_plate_no: '',
                            trucking_company: '',
                            route: '',
                            remarks: ''
                          });
                        }}
                        className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
        
        {/* Loading Checklist Modal */}
        {showLoadingChecklistModal && loadingChecklistHeaderId && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <style>{`
              @media print {
                * { margin: 0; padding: 0; }
                body { background: white; }
                .print-hide { display: none !important; }
                .loading-checklist-wrapper {
                  width: 100%;
                  margin: 0;
                  padding: 10mm;
                }
                .loading-checklist-table {
                  width: 100%;
                  border-collapse: collapse;
                  font-size: 9pt;
                  page-break-inside: avoid;
                }
                .loading-checklist-table thead {
                  page-break-inside: avoid;
                }
                .loading-checklist-table tbody tr {
                  page-break-inside: avoid;
                }
                .loading-checklist-table td,
                .loading-checklist-table th {
                  border: 1px solid #999;
                  padding: 4px 3px;
                  page-break-inside: avoid;
                }
                .loading-checklist-table th {
                  background-color: #999 !important;
                  font-weight: bold;
                  color: white;
                }
                .print-button-section { display: none !important; }
              }
              @page {
                size: A4 landscape;
                margin: 8mm;
              }
            `}</style>
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '1000px', maxHeight: '95vh', overflowY: 'auto' }}>
              {(() => {
                const header = headerRecords.find(h => h.id === loadingChecklistHeaderId);
                
                // Use fetched loading checklist data if available
                if (!loadingChecklistData || loadingChecklistData.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <p className="text-gray-800 text-lg">Loading checklist not yet created. Please complete dispatch first.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setShowLoadingChecklistModal(false);
                          setLoadingChecklistHeaderId(null);
                        }}
                        className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500 mt-4"
                      >
                        Close
                      </button>
                    </div>
                  );
                }
                
                if (!header) return <div>Header not found</div>;
                
                return (
                  <div className="flex flex-col">
                    {/* Header with Title */}
                    <div className="flex items-start justify-between mb-3 border-b pb-2 bg-white">
                      <div>
                        <h1 className="text-2xl font-bold mb-1 text-black">LOADING CHECKLIST</h1>
                        <p className="text-xs text-gray-800">Goods Release Document</p>
                      </div>
                    </div>

                    {/* SO Information */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mb-3 border-b pb-2 bg-white">
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">SO Number</p>
                        <p className="text-sm font-bold text-black">{header.so_number || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Customer Code</p>
                        <p className="text-sm font-bold text-black">{header.customer_code || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Customer</p>
                        <p className="text-sm font-bold text-black">{header.customer_name || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Status</p>
                        <p className="text-sm font-bold text-black">{header.status || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Delivery Date</p>
                        <p className="text-sm font-bold text-black">{header.scheduled_delivery_date ? new Date(header.scheduled_delivery_date).toLocaleDateString() : '-'}</p>
                      </div>
                    </div>

                    {/* Items Table with All Fields */}
                    <div className="mb-6">
                      <h3 className="text-lg font-bold mb-3 uppercase text-black">Items to Verify</h3>
                      <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                        <table className="border-collapse border border-gray-400 text-xs bg-white" style={{ minWidth: 'max-content' }}>
                          <thead>
                            <tr className="bg-gray-300">
                              <th className="border border-gray-400 px-2 py-1 text-left font-bold text-black">Item Code</th>
                              <th className="border border-gray-400 px-2 py-1 text-left font-bold text-black">Item Name</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Ordered Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Batch #</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Mfg Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Expiry Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Weight (KG)</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">UOM</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Good Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Damaged Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loadingChecklistData.length > 0 ? (
                              loadingChecklistData.map((item: any, idx: number) => {
                                const mfgDate = item.manufacturing_date ? new Date(item.manufacturing_date).toLocaleDateString() : '-';
                                const expDate = item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '-';
                                const itemKey = `${item.item_code}-${item.batch_number}-${idx}`;
                                // ✅ CRITICAL FIX: Load both checked_qty AND damaged_qty from database
                                const quantities = itemQuantities.get(itemKey) || { good: item.checked_qty || 0, damaged: item.damaged_qty || 0 };
                                const totalQty = (item.checked_qty || 0) + (item.damaged_qty || 0);
                                const currentTotal = quantities.good + quantities.damaged;
                                
                                // ✅ Get weight and UOM from items config (same pattern as gatepass)
                                const itemConfig = Object.values(itemsByCode || {}).find((config: any) => 
                                  config.item_code === item.item_code || config.code === item.item_code
                                );
                                const weightKg = itemConfig?.weight_uom_kg || itemConfig?.weight_kg || item.weight_uom_kg || 0;
                                const uom = itemConfig?.uom || itemConfig?.item_uom || item.uom || '-';
                                
                                return (
                                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    <td className="border border-gray-400 px-2 py-1 text-black">{item.item_code || ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-black">{item.item_name || ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center font-semibold text-black">{item.ordered_qty || '-'}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{item.batch_number || ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{mfgDate}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{expDate}</td>
                                    {/* ✅ Weight: Show as text when locked, input when editable */}
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">
                                      {checklistVerified ? (
                                        <span className="font-semibold">{Number(weightKg).toFixed(2)}</span>
                                      ) : (
                                        <input 
                                          type="text" 
                                          inputMode="decimal"
                                          value={weightKg || ''}
                                          placeholder="-"
                                          disabled={checklistVerified}
                                          onChange={(e) => {
                                            const updatedData = loadingChecklistData.map((itm: any, i: number) => 
                                              i === idx ? { ...itm, weight_uom_kg: e.target.value } : itm
                                            );
                                            setLoadingChecklistData(updatedData);
                                          }}
                                          className="w-12 border rounded px-1 py-0.5 text-xs text-center font-semibold border-gray-300 text-black"
                                        />
                                      )}
                                    </td>
                                    {/* ✅ UOM: Show as text when locked, input when editable */}
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">
                                      {checklistVerified ? (
                                        <span className="font-semibold">{uom}</span>
                                      ) : (
                                        <input 
                                          type="text" 
                                          value={uom || ''}
                                          placeholder="-"
                                          disabled={checklistVerified}
                                          onChange={(e) => {
                                            const updatedData = loadingChecklistData.map((itm: any, i: number) => 
                                              i === idx ? { ...itm, uom: e.target.value } : itm
                                            );
                                            setLoadingChecklistData(updatedData);
                                          }}
                                          className="w-12 border rounded px-1 py-0.5 text-xs text-center font-semibold border-gray-300 text-black"
                                        />
                                      )}
                                    </td>
                                    {/* ✅ Good Qty: Show as text when locked, input when editable */}
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">
                                      {checklistVerified ? (
                                        <span className="font-semibold">{quantities.good}</span>
                                      ) : (
                                        <input 
                                          type="text" 
                                          inputMode="numeric"
                                          value={quantities.good}
                                          placeholder="0"
                                          disabled={checklistVerified}
                                          onChange={(e) => {
                                            const newQuantities = new Map(itemQuantities);
                                            const numVal = parseInt(e.target.value) || 0;
                                            const goodVal = Math.max(0, Math.min(totalQty, numVal));
                                            newQuantities.set(itemKey, { good: goodVal, damaged: quantities.damaged });
                                            setItemQuantities(newQuantities);
                                          }}
                                          className="w-12 border rounded px-1 py-0.5 text-xs text-center font-semibold border-gray-300 text-black"
                                        />
                                      )}
                                    </td>
                                    {/* ✅ Damaged Qty: Show as text when locked, button to edit when editable */}
                                    <td className="border border-gray-400 px-2 py-1 text-center">
                                      <div className="flex flex-col gap-1 items-center">
                                        {checklistVerified ? (
                                          <span className="font-semibold text-black">{quantities.damaged}</span>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setDamageModalItem(item);
                                              setDamageModalItemKey(itemKey);
                                              setDamageModalQty(quantities.damaged);
                                              setDamageModalLocation(damageLocations.get(itemKey) || null);
                                              setDamageModalNotes('');
                                              setShowDamageModal(true);
                                            }}
                                            className="px-3 py-1 bg-red-500 text-white rounded text-xs font-semibold hover:bg-red-600"
                                            title="Set damage quantity and location"
                                          >
                                            {quantities.damaged > 0 ? `Set ${quantities.damaged}` : 'Add Damage'}
                                          </button>
                                        )}
                                        {quantities.damaged > 0 && damageLocations.get(itemKey) && (
                                          <span className="text-xs text-green-600 font-semibold">
                                            ✓ Location Set
                                          </span>
                                        )}
                                        {quantities.damaged > 0 && !damageLocations.get(itemKey) && !checklistVerified && (
                                          <span className="text-xs text-orange-600 font-semibold">
                                            ⚠ No Location
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr>
                                <td colSpan={10} className="border border-gray-400 px-2 py-1 text-center text-gray-800">
                                  No items found
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Signature Lines */}
                    <div className="mt-4 grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-1 mb-1" style={{ width: '100%', height: '40px' }}></div>
                        <p className="text-xs font-semibold uppercase">Picked By</p>
                      </div>
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-1 mb-1" style={{ width: '100%', height: '40px' }}></div>
                        <p className="text-xs font-semibold uppercase">Verified By</p>
                      </div>
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-1 mb-1" style={{ width: '100%', height: '40px' }}></div>
                        <p className="text-xs font-semibold uppercase">Released By</p>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-8 text-center text-xs text-gray-800 border-t pt-4">
                      <p>This is an official Loading Checklist. Please retain for your records.</p>
                      <p>Printed on: {new Date().toLocaleString()}</p>
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-6 flex gap-3 justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          const printWindow = window.open('', '_blank');
                          if (printWindow) {
                            let tableRowsHtml = '';
                            if (loadingChecklistData.length > 0) {
                              tableRowsHtml = loadingChecklistData.map((item: any, idx: number) => {
                                const mfgDate = item.manufacturing_date ? new Date(item.manufacturing_date).toLocaleDateString() : '-';
                                const expDate = item.expiry_date ? new Date(item.expiry_date).toLocaleDateString() : '-';
                                const itemKey = `${item.item_code}-${item.batch_number}-${idx}`;
                                // ✅ CRITICAL FIX: Load both checked_qty AND damaged_qty from database
                                const quantities = itemQuantities.get(itemKey) || { good: item.checked_qty || 0, damaged: item.damaged_qty || 0 };
                                
                                // ✅ FIX: Use same fallback logic as modal for weight and UOM
                                const itemConfig = Object.values(itemsByCode || {}).find((config: any) => 
                                  config.item_code === item.item_code || config.code === item.item_code
                                );
                                const weightKg = itemConfig?.weight_uom_kg || itemConfig?.weight_kg || item.weight_uom_kg || 0;
                                const uom = itemConfig?.uom || itemConfig?.item_uom || item.uom || '-';
                                
                                return `
                                  <tr>
                                    <td>${item.item_code || ''}</td>
                                    <td>${item.item_name || ''}</td>
                                    <td>${item.ordered_qty || '-'}</td>
                                    <td>${item.batch_number || ''}</td>
                                    <td>${mfgDate}</td>
                                    <td>${expDate}</td>
                                    <td>${Number(weightKg).toFixed(2)}</td>
                                    <td>${uom}</td>
                                    <td>${quantities.good}</td>
                                    <td>${quantities.damaged}</td>
                                  </tr>
                                `;
                              }).join('');
                            } else {
                              tableRowsHtml = '<tr><td colspan="10" style="text-align: center;">No items found</td></tr>';
                            }

                            const htmlContent = `
                              <!DOCTYPE html>
                              <html>
                              <head>
                                <meta charset="UTF-8">
                                <title>LOADING CHECKLIST - ${header.so_number}</title>
                                <style>
                                  body { font-family: Arial, sans-serif; margin: 20px; }
                                  h1 { font-size: 24px; margin-bottom: 10px; }
                                  .header-info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; border-bottom: 1px solid #ccc; padding-bottom: 15px; }
                                  .header-field { }
                                  .header-field .label { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #666; }
                                  .header-field .value { font-size: 14px; font-weight: bold; color: #000; }
                                  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                                  th, td { border: 1px solid #999; padding: 8px; text-align: left; font-size: 11px; }
                                  th { background-color: #ddd; font-weight: bold; text-align: center; }
                                  td { text-align: center; }
                                  td:first-child, td:nth-child(2) { text-align: left; }
                                  tr:nth-child(even) { background-color: #f9f9f9; }
                                  .signature-section { margin: 40px 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
                                  .signature-line { text-align: center; }
                                  .signature-line .line { border-top: 2px solid #000; height: 50px; margin-bottom: 10px; }
                                  .signature-line .label { font-size: 12px; font-weight: bold; text-transform: uppercase; }
                                  .footer { margin-top: 30px; text-align: center; font-size: 11px; border-top: 1px solid #ccc; padding-top: 15px; }
                                  @media print { body { margin: 0; } }
                                </style>
                              </head>
                              <body>
                                <div>
                                  <h1>LOADING CHECKLIST</h1>
                                  <p style="font-size: 12px; color: #666;">Goods Release Document</p>
                                  
                                  <div class="header-info">
                                    <div class="header-field">
                                      <div class="label">SO Number</div>
                                      <div class="value">${header.so_number || '-'}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Customer Code</div>
                                      <div class="value">${header.customer_code || '-'}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Customer Name</div>
                                      <div class="value">${header.customer_name || '-'}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Status</div>
                                      <div class="value">${header.status || '-'}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Scheduled Delivery</div>
                                      <div class="value">${header.scheduled_delivery_date ? new Date(header.scheduled_delivery_date).toLocaleDateString() : '-'}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Generated On</div>
                                      <div class="value">${new Date().toLocaleDateString()}</div>
                                    </div>
                                  </div>
                                  
                                  <h3 style="font-size: 16px; margin-top: 20px; margin-bottom: 15px; text-transform: uppercase; font-weight: bold;">Items to Verify</h3>
                                  <table>
                                    <thead>
                                      <tr>
                                        <th>Item Code</th>
                                        <th>Item Name</th>
                                        <th>Ordered Qty</th>
                                        <th>Batch #</th>
                                        <th>Mfg Date</th>
                                        <th>Expiry Date</th>
                                        <th>Weight (KG)</th>
                                        <th>UOM</th>
                                        <th>Good Qty</th>
                                        <th>Damaged Qty</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      ${tableRowsHtml}
                                    </tbody>
                                  </table>
                                  
                                  <div class="signature-section">
                                    <div class="signature-line">
                                      <div class="line"></div>
                                      <div class="label">Picked By</div>
                                    </div>
                                    <div class="signature-line">
                                      <div class="line"></div>
                                      <div class="label">Verified By</div>
                                    </div>
                                    <div class="signature-line">
                                      <div class="line"></div>
                                      <div class="label">Released By</div>
                                    </div>
                                  </div>
                                  
                                  <div class="footer">
                                    <p>This is an official Loading Checklist. Please retain for your records.</p>
                                    <p>Printed on: ${new Date().toLocaleString()}</p>
                                  </div>
                                </div>
                                <script>
                                  window.onload = function() {
                                    window.print();
                                  };
                                </script>
                              </body>
                              </html>
                            `;
                            printWindow.document.write(htmlContent);
                            printWindow.document.close();
                          }
                        }}
                        className="px-6 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700"
                      >
                        Print
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowLoadingChecklistModal(false);
                          setLoadingChecklistHeaderId(null);
                        }}
                        className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500"
                      >
                        Close
                      </button>
                      {!checklistVerified ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            // Step 1: Auto-create gatepass/dispatch if it doesn't exist
                            console.log('📋 Creating dispatch for SO:', loadingChecklistHeaderId);
                            
                            const header = headerRecords.find(h => h.id === loadingChecklistHeaderId);
                            if (!header) {
                              alert('Could not find SO header');
                              return;
                            }
                            
                            // Create gatepass record with proper action
                            const gatepassPayload = {
                              action: 'create-gatepass',
                              so_header_id: loadingChecklistHeaderId,
                              gatepass_number: `GP-${header.so_number}-${new Date().getTime()}`,
                              gatepass_date: new Date().toISOString(),
                              driver_name: '',
                              driver_phone: '',
                              vehicle_plate_no: '',
                              trucking_company: '',
                              route: '',
                              remarks: 'Auto-created from loading checklist verification',
                              status: 'Issued',
                              loading_checklist_status: 'Pending'
                            };
                            
                            console.log('Sending gatepass payload:', gatepassPayload);
                            
                            const gatepassRes = await fetch('/api/gatepass', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(gatepassPayload)
                            });
                            
                            if (!gatepassRes.ok) {
                              const errorText = await gatepassRes.text();
                              console.error('❌ Failed to create gatepass. Status:', gatepassRes.status, 'Error:', errorText);
                              alert(`Failed to create dispatch: ${errorText}`);
                              return;
                            }
                            
                            const gatepassData = await gatepassRes.json();
                            const gatepassId = gatepassData.gatepassId;
                            
                            if (!gatepassId) {
                              console.error('❌ No gatepass ID returned');
                              alert('Failed to create dispatch');
                              return;
                            }
                            
                            console.log('✅ Dispatch created with ID:', gatepassId);
                            
                            // Step 2: Process damaged items - create returns for damaged quantities
                            const damagedItemsWithQty = loadingChecklistData
                              .map((item: any, idx: number) => {
                                const itemKey = `${item.item_code}-${item.batch_number}-${idx}`;
                                const quantities = itemQuantities.get(itemKey) || { good: item.checked_qty || 0, damaged: 0 };
                                return quantities.damaged > 0 ? { ...item, damagedQty: quantities.damaged, index: idx } : null;
                              })
                              .filter(Boolean);
                            
                            if (damagedItemsWithQty.length > 0) {
                              console.log('🔴 Processing damaged items:', damagedItemsWithQty.length);
                              
                              // Create return transactions and move damaged items to Damage Location with pallet
                              for (const damagedItem of damagedItemsWithQty) {
                                try {
                                  // 1. Create returns_inventory record with ONLY the damaged quantity
                                  const returnPayload = {
                                    table: 'returns_inventory',
                                    data: {
                                      so_line_id: damagedItem.so_line_id,
                                      warehouse_id: header.warehouse_id || 1,
                                      item_id: damagedItem.item_id,
                                      batch_number: damagedItem.batch_number,
                                      quantity_returned: damagedItem.damagedQty,  // Damaged quantity being returned
                                      reason: damagedItemsNote || 'Damaged items identified during loading',
                                      status: 'damage_identified',
                                      weight_uom_kg: damagedItem.weight_uom_kg,
                                      received_at: new Date().toISOString(),
                                      created_at: new Date().toISOString(),
                                      updated_at: new Date().toISOString()
                                    }
                                  };
                                  
                                  console.log('Creating return payload:', returnPayload);
                                  
                                  const returnRes = await fetch('/api/patch-record', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(returnPayload)
                                  });
                                  
                                  if (returnRes.ok) {
                                    console.log(`✅ Return created for ${damagedItem.item_code}: ${damagedItem.damagedQty} units damaged`);
                                  } else {
                                    const errorText = await returnRes.text();
                                    console.error('❌ Failed to create return for:', damagedItem.item_code, 'Error:', errorText);
                                  }

                                  // 2. Generate pallet ID with DAM prefix (like putaway split logic)
                                  const damagePalletId = generatePalletIdByReason('damage');
                                  console.log(`🔴 Generated damage pallet ID: ${damagePalletId}`);

                                  // 3. Get the damage location - Use user-selected location from dropdown, with fallback to auto-detection
                                  const itemKey = `${damagedItem.item_code}-${damagedItem.batch_number}-${damagedItem.index}`;
                                  let damageLocationId = damageLocations.get(itemKey); // First, try user selection
                                  
                                  console.log(`📍 User selected damage location ID: ${damageLocationId || 'none - will auto-detect'}`);
                                  
                                  // If user didn't select a location, fallback to auto-detection
                                  if (!damageLocationId) {
                                    try {
                                      // Fallback: auto-detect if no user selection
                                      const locRes = await fetch('/api/config-records?refresh=true');
                                      if (locRes.ok) {
                                        const allConfigData = await locRes.json();
                                        const locations = Array.isArray(allConfigData.locations) ? allConfigData.locations : [];
                                        
                                        // Priority 1: Look for exact "Damage Location" or "DAMAGE"
                                        let damageLoc = locations.find((loc: any) => {
                                          const name = (loc.location_name || '').toUpperCase();
                                          return name === 'DAMAGE LOCATION' || name === 'DAMAGE' || name.includes('DAMAGE AREA');
                                        });
                                        
                                        // Priority 2: Look for any location containing "damage" or "defective"
                                        if (!damageLoc) {
                                          damageLoc = locations.find((loc: any) => 
                                            (loc.location_name || '').toLowerCase().includes('damage') ||
                                            (loc.location_name || '').toLowerCase().includes('defective')
                                          );
                                        }
                                        
                                        if (damageLoc) {
                                          damageLocationId = damageLoc.id;
                                          console.log(`📍 Auto-detected Damage Location: ${damageLoc.location_name} (ID: ${damageLocationId})`);
                                        } else if (locations.length > 0) {
                                          // Fallback: use first location if damage location not found
                                          damageLocationId = locations[0].id;
                                          console.warn(`⚠️ Damage location not found, using first location ID: ${damageLocationId} (${locations[0].location_name})`);
                                        }
                                      }
                                    } catch (err) {
                                      console.warn('⚠️ Auto-detection failed, using default location');
                                    }
                                  }
                                  
                                  // Final fallback
                                  if (!damageLocationId) {
                                    damageLocationId = 1;
                                    console.warn(`⚠️ No damage location selected or found, using default location ID: 1`);
                                  }

                                  // 4. Create inventory record for damaged items at Damage Location
                                  if (damageLocationId) {
                                    const damageInventoryPayload = {
                                      table: 'inventory',
                                      data: {
                                        item_id: damagedItem.item_id,
                                        location_id: damageLocationId,
                                        warehouse_id: header.warehouse_id || 1,
                                        pallet_id: damagePalletId,
                                        on_hand_quantity: damagedItem.damagedQty,
                                        allocated_quantity: 0,
                                        available_quantity: 0,  // Damage items are not available for allocation
                                        weight_uom_kg: damagedItem.weight_uom_kg,
                                        pallet_config: null,
                                        // ✅ Traceability: Store source batch and ASN info
                                        batch_number: damagedItem.batch_number || null,
                                        asn_number: damagedItem.asn_number || null,
                                        date_received: damagedItem.date_received || null,
                                        asn_status: 'damaged',
                                        vendor_code: damagedItem.vendor_code || null,
                                        vendor_name: damagedItem.vendor_name || null,
                                      }
                                    };

                                    console.log('Creating damage inventory payload:', damageInventoryPayload);

                                    const invRes = await fetch('/api/patch-record', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify(damageInventoryPayload)
                                    });

                                    if (invRes.ok) {
                                      console.log(`✅ Damage inventory created for ${damagedItem.item_code}: ${damagedItem.damagedQty} units at Damage Location with pallet ${damagePalletId}, batch: ${damagedItem.batch_number}`);
                                    } else {
                                      const errorText = await invRes.text();
                                      console.error('❌ Failed to create damage inventory:', errorText);
                                    }
                                  }
                                  
                                  // 5. CRITICAL: Deduct damaged quantity from original SO inventory location
                                  // This ensures on_hand_quantity is reduced when items are marked as damaged
                                  try {
                                    // Find the original inventory record for this item from the picked batches
                                    const soInventoryRes = await fetch(`/api/so-inventory-data?so_header_id=${gatepassHeaderId}`);
                                    if (soInventoryRes.ok) {
                                      const soInventoryData = await soInventoryRes.json();
                                      const soInventoryRecords = Array.isArray(soInventoryData) ? soInventoryData : (soInventoryData?.soInventory || []);
                                      
                                      // Find inventory records matching this item and batch
                                      const matchingRecords = soInventoryRecords.filter((rec: any) =>
                                        rec.item_id === damagedItem.item_id && 
                                        rec.batch_number === damagedItem.batch_number &&
                                        rec.quantity_allocated > 0
                                      );
                                      
                                      console.log(`🔄 Found ${matchingRecords.length} SO inventory records for ${damagedItem.item_code} to deduct damage from`);
                                      
                                      // Deduct damaged quantity from these records
                                      for (const soInvRecord of matchingRecords) {
                                        if (damagedItem.damagedQty <= 0) break;
                                        
                                        const deductAmount = Math.min(damagedItem.damagedQty, soInvRecord.quantity_allocated);
                                        const updatedAllocated = soInvRecord.quantity_allocated - deductAmount;
                                        
                                        const deductPayload = {
                                          table: 'so_inventory',
                                          data: {
                                            quantity_allocated: updatedAllocated,
                                            updated_at: new Date().toISOString()
                                          },
                                          match: { id: soInvRecord.id }
                                        };
                                        
                                        const deductRes = await fetch('/api/patch-record', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify(deductPayload)
                                        });
                                        
                                        if (deductRes.ok) {
                                          console.log(`✅ Deducted ${deductAmount} units of damaged items from SO inventory for ${damagedItem.item_code}`);
                                          damagedItem.damagedQty -= deductAmount;
                                        } else {
                                          console.error('❌ Failed to deduct damaged quantity from SO inventory');
                                        }
                                      }
                                    }
                                  } catch (err) {
                                    console.error('❌ Error deducting damaged items from SO inventory:', err);
                                  }
                                } catch (err) {
                                  console.error('❌ Error processing damaged item:', damagedItem.item_code, err);
                                }
                              }
                              
                              alert(`✅ Dispatch created! ${damagedItemsWithQty.reduce((sum, d) => sum + d.damagedQty, 0)} damaged units recorded and moved to Damage Location. Good items ready for gatepass.`);
                            } else {
                              console.log('✅ All items verified as good');
                              alert('✅ Dispatch created! All items ready for gatepass.');
                            }
                            
                            // Reset conditions and close modal
                            // Filter out damaged items from verified items - only include items with good quantity > 0
                            const goodItemsOnly = loadingChecklistData.map((item: any, idx: number) => {
                              const itemKey = `${item.item_code}-${item.batch_number}-${idx}`;
                              const quantities = itemQuantities.get(itemKey) || { good: item.checked_qty || 0, damaged: 0 };
                              return { ...item, checked_qty: quantities.good }; // Update checked_qty to only good quantity
                            }).filter((item: any) => item.checked_qty > 0); // Only include items with good qty > 0
                            
                            // Update loading_checklist records in database with verified status
                            for (const item of loadingChecklistData) {
                              try {
                                // Find the index of this item in loadingChecklistData to build the correct key
                                const itemIndex = loadingChecklistData.findIndex((i: any) => i.id === item.id);
                                const itemKey = `${item.item_code}-${item.batch_number}-${itemIndex}`;
                                const quantities = itemQuantities.get(itemKey) || { good: item.checked_qty || 0, damaged: 0 };
                                const totalVerified = quantities.good + quantities.damaged;
                                
                                const updatePayload = {
                                  table: 'loading_checklist',
                                  data: {
                                    gatepass_id: gatepassId,
                                    so_line_id: item.so_line_id,
                                    item_id: item.item_id,
                                    item_code: item.item_code,
                                    item_name: item.item_name,
                                    batch_number: item.batch_number,
                                    manufacturing_date: item.manufacturing_date,
                                    expiry_date: item.expiry_date,
                                    pallet_id: item.pallet_id,
                                    weight_uom_kg: item.weight_uom_kg,
                                    uom: item.uom,
                                    ordered_qty: item.ordered_qty,
                                    packed_qty: item.packed_qty,
                                    checked_qty: quantities.good,
                                    damaged_qty: quantities.damaged,
                                    variance_qty: (item.packed_qty || item.checked_qty || 0) - quantities.good,
                                    status: 'verified',
                                    checked_at: new Date().toISOString(),
                                    updated_at: new Date().toISOString()
                                  },
                                  match: { id: item.id }
                                };
                                
                                const updateRes = await fetch('/api/patch-record', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify(updatePayload)
                                });
                                
                                if (updateRes.ok) {
                                  console.log(`✅ Loading checklist record updated: ${item.item_code} status=verified`);
                                } else {
                                  const errorText = await updateRes.text();
                                  console.error('❌ Failed to update loading checklist record:', errorText);
                                }
                              } catch (err) {
                                console.error('❌ Error updating loading checklist record:', err);
                              }
                            }
                            
                            setVerifiedChecklistItems(goodItemsOnly); // Save only good items for gatepass modal
                            setItemQuantities(new Map());
                            setDamageLocations(new Map()); // Clear damage location selections
                            setDamagedItemsNote('');
                            setShowDamageModal(false); // Close damage modal if open
                            setChecklistVerified(true); // Lock the checklist after verification
                            setShowLoadingChecklistModal(false);
                            setLoadingChecklistHeaderId(null);
                            
                            // Refresh SO headers
                            await fetchSOHeaders();
                          } catch (err) {
                            console.error('❌ Error during verification:', err);
                            alert('Error during verification. Please try again.');
                          }
                        }}
                        className="px-6 py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700"
                      >
                        ✓ Verify & Close
                      </button>
                      ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setItemQuantities(new Map());
                          setDamageLocations(new Map()); // Clear damage location selections
                          setDamagedItemsNote('');
                          setChecklistVerified(false);
                          setShowDamageModal(false); // Close damage modal if open
                          setShowLoadingChecklistModal(false);
                          setLoadingChecklistHeaderId(null);
                        }}
                        className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500"
                      >
                        Close
                      </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ✅ Damage Modal - For setting damage qty and location */}
        {showDamageModal && damageModalItem && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6" style={{ width: '90%', maxWidth: '500px' }}>
              <h2 className="text-2xl font-bold mb-4 text-black">Damage Details</h2>
              
              {/* Item Info */}
              <div className="mb-6 p-4 bg-gray-100 rounded">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-600 font-semibold">ITEM CODE</p>
                    <p className="text-lg font-bold text-black">{damageModalItem.item_code}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-semibold">ITEM NAME</p>
                    <p className="text-lg font-bold text-black">{damageModalItem.item_name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-semibold">BATCH #</p>
                    <p className="text-lg font-bold text-black">{damageModalItem.batch_number || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-semibold">ORDERED QTY</p>
                    <p className="text-lg font-bold text-black">{damageModalItem.ordered_qty}</p>
                  </div>
                </div>
              </div>

              {/* Damage Quantity */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-black mb-2">
                  Damage Quantity <span className="text-red-600">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max={damageModalItem.ordered_qty}
                  value={damageModalQty}
                  onChange={(e) => setDamageModalQty(Math.max(0, Math.min(damageModalItem.ordered_qty, parseInt(e.target.value) || 0)))}
                  className="w-full border-2 border-red-400 rounded px-3 py-2 text-lg font-bold text-black focus:outline-none focus:border-red-600"
                  placeholder="0"
                />
                <p className="text-xs text-gray-600 mt-1">Max: {damageModalItem.ordered_qty} units</p>
              </div>

              {/* Damage Location */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-black mb-2">
                  Damage Location <span className="text-red-600">*</span>
                </label>
                <select
                  value={damageModalLocation || ''}
                  onChange={(e) => setDamageModalLocation(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full border-2 border-red-400 rounded px-3 py-2 text-black font-semibold focus:outline-none focus:border-red-600"
                >
                  <option value="">-- Select Location --</option>
                  {locationOptions && locationOptions.length > 0 ? (
                    locationOptions.map((loc: any) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name || loc.location_code || `LOC ${loc.id}`}
                      </option>
                    ))
                  ) : (
                    <option disabled>Loading locations...</option>
                  )}
                </select>
              </div>

              {/* Optional Notes */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-black mb-2">
                  Damage Notes (Optional)
                </label>
                <textarea
                  value={damageModalNotes}
                  onChange={(e) => setDamageModalNotes(e.target.value)}
                  placeholder="E.g., Dented packaging, Water damage, Missing parts..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-black focus:outline-none focus:border-blue-500"
                  rows={3}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowDamageModal(false);
                    setDamageModalItem(null);
                    setDamageModalItemKey('');
                    setDamageModalQty(0);
                    setDamageModalLocation(null);
                    setDamageModalNotes('');
                  }}
                  className="px-6 py-2 bg-gray-400 text-white rounded font-semibold hover:bg-gray-500"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (damageModalQty > 0 && damageModalLocation) {
                      // Update quantities
                      const newQuantities = new Map(itemQuantities);
                      const current = newQuantities.get(damageModalItemKey) || { good: 0, damaged: 0 };
                      newQuantities.set(damageModalItemKey, { good: current.good, damaged: damageModalQty });
                      setItemQuantities(newQuantities);

                      // Update locations
                      const newLocations = new Map(damageLocations);
                      newLocations.set(damageModalItemKey, damageModalLocation);
                      setDamageLocations(newLocations);

                      // Close modal
                      setShowDamageModal(false);
                      setDamageModalItem(null);
                      setDamageModalItemKey('');
                      setDamageModalQty(0);
                      setDamageModalLocation(null);
                      setDamageModalNotes('');
                    } else {
                      alert('Please enter damage quantity and select a location');
                    }
                  }}
                  className="px-6 py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700 disabled:bg-gray-400"
                  disabled={damageModalQty <= 0 || !damageModalLocation}
                >
                  ✓ Confirm Damage
                </button>
              </div>

              {/* Validation Message */}
              {damageModalQty > 0 && !damageModalLocation && (
                <div className="mt-4 p-3 bg-red-100 border border-red-400 rounded text-sm text-red-700">
                  ⚠️ Please select a location for damaged items
                </div>
              )}
            </div>
          </div>
        )}
      {/* SO Headers and Lines - Single Container */}
      <div className="w-full bg-white rounded-lg border shadow p-6" style={{ width: '100%', minWidth: 0, marginTop: '32px' }}>
        {/* SO Headers and Lines - Vertical Stacking */}
        <div style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* SO Headers Section */}
          <div className="min-w-0" style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold">Outbound Records</h2>
              <div className="flex gap-2 items-center">
                <input 
                  type="text" 
                  placeholder="Search SO..." 
                  className="border px-4 py-3 rounded text-base w-64" 
                  value={searchHeaderInput}
                  onChange={e => setSearchHeaderInput(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-3 mb-4">
              {/* Left Side Controls */}
              <div className="flex flex-col gap-3" style={{ width: '280px', flexShrink: 0 }}>
              <label className="block text-sm font-semibold text-gray-700">Filter Status</label>
              <select 
                className="border px-4 py-3 rounded text-base w-full" 
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
              >
                <option value="">All Status</option>
                <option value="New">New</option>
                <option value="Allocated">Allocated</option>
                <option value="Picking">Picking</option>
                <option value="Shipped">Shipped</option>
              </select>
              {(() => {
                const selectedHeader = selectedHeaderId ? headerRecords.find(h => h.id === Number(selectedHeaderId)) : null;
                const status = selectedHeader?.status || '';
                const isDeleteEnabled = status === 'New';
                
                return (
                  <>
                    <button
                      type="button"
                      className={`px-6 py-3 rounded shadow text-base font-semibold w-full transition-all duration-100 text-white active:scale-95 ${isDeleteEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                      style={{ backgroundColor: '#008ecc', opacity: isDeleteEnabled ? 1 : 0.6 }}
                      onMouseEnter={(e) => isDeleteEnabled && (e.currentTarget.style.filter = 'brightness(0.9)')}
                      onMouseLeave={(e) => isDeleteEnabled && (e.currentTarget.style.filter = 'brightness(1)')}
                      onClick={() => { if (isDeleteEnabled) handleDeleteSelectedHeaders(); }}
                    >Delete</button>
                  </>
                );
              })()}
              
              {/* Workflow Buttons */}
              {(() => {
                const selectedHeader = selectedHeaderId ? headerRecords.find(h => h.id === Number(selectedHeaderId)) : null;
                const status = selectedHeader?.status || '';
                const isDisabled = status !== 'New';
                return (
                  <button
                    type="button"
                    className={`text-white px-6 py-3 rounded shadow text-base font-semibold w-full active:scale-95 transition-all duration-100 ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    style={{ backgroundColor: '#008ecc', opacity: isDisabled ? 0.6 : 1 }}
                    onMouseEnter={(e) => !isDisabled && (e.currentTarget.style.filter = 'brightness(0.9)')}
                    onMouseLeave={(e) => !isDisabled && (e.currentTarget.style.filter = 'brightness(1)')}
                    onClick={() => {
                      if (!selectedHeader) {
                        alert('Please select an SO');
                        return;
                      }
                      if (selectedHeader.status !== 'New') {
                        alert(`Cannot allocate. Current status: ${selectedHeader.status}. Must be "New"`);
                        return;
                      }
                      handleOpenAllocation(selectedHeader.id);
                    }}
                    disabled={isDisabled}
                  >
                    🔄 Allocate
                  </button>
                );
              })()}

              {(() => {
                const selectedHeader = selectedHeaderId ? headerRecords.find(h => h.id === Number(selectedHeaderId)) : null;
                const status = selectedHeader?.status || '';
                const isDisabled = status !== 'Allocated';
                return (
                  <button
                    type="button"
                    className={`text-white px-6 py-3 rounded shadow text-base font-semibold w-full active:scale-95 transition-all duration-100 ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    style={{ backgroundColor: '#008ecc', opacity: isDisabled ? 0.6 : 1 }}
                    onMouseEnter={(e) => !isDisabled && (e.currentTarget.style.filter = 'brightness(0.9)')}
                    onMouseLeave={(e) => !isDisabled && (e.currentTarget.style.filter = 'brightness(1)')}
                    onClick={() => {
                      if (!selectedHeader) {
                        alert('Please select an SO');
                        return;
                      }
                      if (selectedHeader.status !== 'Allocated') {
                        alert(`Cannot pick. Current status: ${selectedHeader.status}. Must be "Allocated"`);
                        return;
                      }
                      handleOpenPickingModal(selectedHeader.id);
                    }}
                    disabled={isDisabled}
                  >
                    📦 Pick
                  </button>
                );
              })()}


            </div>
            {/* Grid on right with Search on top */}
            <div className="flex-1 min-w-0 flex flex-col">
          <div className="ag-theme-alpine" style={{ width: '100%', minWidth: 0, height: 400, background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px' }}>
            <AgGridReact
              theme="legacy"
              ref={headerGridRef}
              rowData={filteredHeaderRecords}
              pagination={true}
              paginationPageSize={100}
              defaultColDef={{ resizable: true, sortable: true, filter: true, editable: true }}
              sortingOrder={['desc', 'asc']}
              onGridReady={(params) => {
                // Sort by created_at descending on grid initialization
                params.api?.applyColumnState({
                  state: [{ colId: 'created_at', sort: 'desc' }]
                });
              }}
              rowHeight={40}
              headerHeight={40}
              columnDefs={[
                { headerName: '', field: 'selected', checkboxSelection: true, width: 40 },
                {
                  headerName: 'Status',
                  field: 'status',
                  editable: true,
                  cellEditor: 'agSelectCellEditor',
                  cellEditorParams: (params: any) => ({
                    values: getAllowedStatuses(params.data?.status || 'New'),
                  }),
                  width: 120,
                  cellRenderer: (params: any) => {
                    const status = params.value;
                    const statusColors: any = {
                      'New': 'bg-blue-100 text-blue-800',
                      'Allocated': 'bg-yellow-100 text-yellow-800',
                      'Picked': 'bg-purple-100 text-purple-800',
                      'Shipped': 'bg-green-100 text-green-800',
                    };
                    return (
                      <div className="flex items-center justify-between w-full h-full cursor-pointer hover:bg-gray-100" style={{ padding: '4px' }}>
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
                          {status}
                        </span>
                        <span className="text-gray-400 text-sm ml-1">▼</span>
                      </div>
                    );
                  }
                },
                { headerName: 'SO Number', field: 'so_number', editable: true, width: 110 },
                { headerName: 'Customer Code', field: 'customer_code', editable: true, width: 120 },
                { headerName: 'Customer Name', field: 'customer_name', editable: true, width: 200 },
                { headerName: 'SO Date', field: 'so_date', editable: true, width: 110 },
                { headerName: 'Barcode', field: 'barcode', editable: true, width: 180 },
                ...headerRecordCols.filter(col => !['status', 'so_number', 'customer_code', 'customer_name', 'so_date', 'barcode'].includes(col.field)),
              ]}
              suppressRowClickSelection={false}
              rowSelection="multiple"
              onCellClicked={(params) => {
                // For status column, require 2nd click to open dropdown
                if (params.colDef?.field === 'status') {
                  const currentRowIndex = params.rowIndex || 0;
                  const isSecondClick = lastClickedStatusCell.rowIndex === currentRowIndex && lastClickedStatusCell.colKey === 'status';
                  
                  if (isSecondClick) {
                    // Second click - open dropdown
                    params.api?.startEditingCell({
                      rowIndex: currentRowIndex,
                      colKey: 'status'
                    });
                    // Reset the tracking
                    setLastClickedStatusCell({ rowIndex: null, colKey: null });
                  } else {
                    // First click - just select the cell
                    setLastClickedStatusCell({ rowIndex: currentRowIndex, colKey: 'status' });
                  }
                }
              }}
              onRowClicked={params => {
                if (params.data && params.data.id) {
                  const headerId = Number(params.data.id);
                  console.log('📍 Header row clicked:', headerId, 'Type:', typeof headerId);
                  console.log('📊 Total line records:', lineRecords.length);
                  console.log('📊 Sample lineRecords[0]:', lineRecords[0]);
                  
                  // Filter lines by matching so_header_id field (convert both to numbers for comparison)
                  const filteredLines = lineRecords.filter(line => {
                    const lineHeaderId = line.so_header_id ?? line.header_id;
                    const numLineHeaderId = Number(lineHeaderId);
                    return numLineHeaderId === headerId;
                  });
                  
                  console.log('✅ Filtered lines count:', filteredLines.length);
                  if (filteredLines.length > 0) {
                    console.log('✅ Sample filtered line:', filteredLines[0]);
                  }
                  
                  setSelectedHeaderId(String(headerId));
                  setSearchSOLineInput(''); // Clear search when switching SO
                  
                  // Fetch allocated quantities from SO inventory
                  const fetchAllocatedQuantities = async () => {
                    try {
                      const soLineIds = filteredLines.map(l => l.id);
                      
                      if (soLineIds.length === 0) {
                        setFilteredRecordLines(filteredLines);
                        return;
                      }

                      // Fetch all allocations for these SO lines (API converts comma-separated to PostgREST IN syntax)
                      const query = `/api/so-inventory?so_line_id=${soLineIds.join(',')}`;
                      console.log('🔍 Fetching allocations from:', query);
                      const allocRes = await fetch(query, {
                        method: 'GET',
                        headers: { 'X-Api-Key': apiKey }
                      });

                      if (allocRes.ok) {
                        const allocData = await allocRes.json();
                        console.log('📊 Allocations fetched:', allocData);
                        console.log('📊 Allocation count:', Array.isArray(allocData) ? allocData.length : 0);
                        
                        // Sum allocated and shipped quantities by so_line_id, and collect pallet IDs
                        const allocMap: { [key: number]: number } = {};
                        const shippedMap: { [key: number]: number } = {};
                        const palletMap: { [key: number]: string[] } = {}; // Map SO line ID to array of pallet IDs
                        
                        if (Array.isArray(allocData)) {
                          allocData.forEach((item: any) => {
                            const lineId = item.so_line_id;
                            console.log(`  Allocation: Line ${lineId}, Qty ${item.quantity_allocated}, Pallet ${item.pallet_id}`);
                            allocMap[lineId] = (allocMap[lineId] || 0) + (item.quantity_allocated || 0);
                            shippedMap[lineId] = (shippedMap[lineId] || 0) + (item.quantity_shipped || 0);
                            
                            // Collect pallet IDs for this SO line (avoid duplicates)
                            if (item.pallet_id) {
                              if (!palletMap[lineId]) {
                                palletMap[lineId] = [];
                              }
                              if (!palletMap[lineId].includes(item.pallet_id)) {
                                palletMap[lineId].push(item.pallet_id);
                              }
                            }
                          });
                        }
                        console.log('💾 Allocation map:', allocMap);
                        console.log('💾 Shipped map:', shippedMap);
                        console.log('📦 Pallet map:', palletMap);

                        // Update filtered lines with allocated and shipped quantities AND pallet IDs
                        const updatedLines = filteredLines.map(line => {
                          const allocated = allocMap[line.id] || 0;
                          const shipped = shippedMap[line.id] || 0;
                          const palletIds = palletMap[line.id] || [];
                          const palletIdDisplay = palletIds.length > 0 ? palletIds.join(', ') : line.pallet_id || '';
                          
                          console.log(`📦 SO Line ${line.id}: Expected ${line.ordered_quantity}, Allocated ${allocated}, Shipped ${shipped}, Pallets: [${palletIdDisplay}]`);
                          return {
                            ...line,
                            allocatedQuantity: allocated,
                            shippedQuantity: shipped,
                            palletId: palletIdDisplay // Override with pallet IDs from allocation records
                          };
                        });
                        console.log('✅ Updated lines with allocations:', updatedLines);
                        setFilteredRecordLines(updatedLines);
                      } else {
                        console.error('❌ Failed to fetch allocations:', allocRes.status);
                        setFilteredRecordLines(filteredLines);
                      }
                    } catch (err) {
                      console.error('❌ Error fetching allocated quantities:', err);
                      setFilteredRecordLines(filteredLines);
                    }
                  };

                  fetchAllocatedQuantities();
                  
                  // Fetch allocation status in background (non-blocking)
                  // This prevents API timeouts from blocking the grid display
                  setTimeout(() => {
                    const fetchPutawayStatus = async () => {
                      try {
                        // In outbound workflow, check so_inventory for allocated items
                        // This shows what has been picked vs still needs to be picked
                        
                        // Get SO line IDs for this header
                        const soLineIds = filteredLines.map(l => l.id).join(',');
                        
                        const response = await fetch(`/api/so-inventory?so_line_id=${soLineIds}`, {
                          method: 'GET',
                        });
                        
                        if (response.ok) {
                          const allocations = await response.json();
                          console.log('📊 Fetched allocations for SO:', allocations);
                          
                          // Build a Set of so_line_ids that have been picked
                          const pickedLineIds = new Set<number>();
                          if (Array.isArray(allocations)) {
                            allocations.forEach((record: any) => {
                              // If quantity_picked > 0, item has been picked
                              if (record.quantity_picked > 0) {
                                pickedLineIds.add(record.so_line_id);
                              }
                            });
                          }
                          
                          setPutawayCompletedLines(pickedLineIds);
                          console.log('📦 Picked line IDs:', pickedLineIds);
                        }
                      } catch (error) {
                        console.error('⚠️ Error fetching allocation/pick status:', error);
                        // Silently fail - don't block grid display
                      }
                    };
                    
                    fetchPutawayStatus();
                  }, 500); // Delay to ensure grid renders first
                }
              }}
              onCellValueChanged={async params => {
                const data = params.data;
                const newValue = params.newValue;
                const oldValue = params.oldValue;
                const field = params.colDef.field;
                
                // If status field changed, show confirmation dialog and block the change
                if (field === 'status' && newValue !== oldValue) {
                  // Store the pending change
                  setPendingStatusChange({
                    recordId: data.id,
                    oldStatus: oldValue,
                    newStatus: newValue
                  });
                  setShowStatusConfirmation(true);
                  
                  // Force revert the value in the grid
                  params.data.status = oldValue;
                  // Refresh grid to show reverted value
                  headerGridRef.current?.api?.refreshCells({ rowNodes: [params.node], force: true });
                  return; // Important: return early, do NOT continue with PATCH
                }
                
                if (data.id) {
                  setHeaderRecords(prev => {
                    const updated = prev.map(header =>
                      header.id === data.id
                        ? {
                            ...header,
                            so_number: data.so_number ?? data.asnNumber ?? '',
                            vendor_id: data.vendor_id ?? data.vendorId ?? '',
                            vendor_name: data.vendor_name ?? data.vendorName ?? '',
                            po_number: data.po_number ?? data.poNumber ?? '',
                            asn_date: (data.asn_date ?? data.asnDate) ? (data.asn_date ?? data.asnDate).slice(0, 10) : null,
                            status: data.status ?? '',
                            remarks: data.remarks ?? ''
                          }
                        : header
                    );
                    console.log('Before PATCH (header):', prev.find(header => header.id === data.id));
                    console.log('After PATCH (header):', updated.find(header => header.id === data.id));
                    return updated;
                  });
                  // Normalize AG Grid fields to DB columns and convert types
                  const headerToSend = {
                    so_number: data.so_number ?? data.asnNumber ?? '',
                    vendor_code: data.vendor_code ?? data.vendorCode ?? '',
                    vendor_name: data.vendor_name ?? data.vendorName ?? '',
                    po_number: data.po_number ?? data.poNumber ?? '',
                    asn_date: (data.asn_date ?? data.asnDate) ? (data.asn_date ?? data.asnDate).slice(0, 10) : null,
                    status: data.status ?? '',
                    barcode: data.barcode ?? '',
                    remarks: data.remarks ?? ''
                  };
                  console.log('PATCH SO header (record grid):', { table: 'so_headers', id: data.id, payload: headerToSend });
                  const res = await fetch('/api/patch-record', {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      table: 'so_headers',
                      id: data.id,
                      data: headerToSend,
                    }),
                  });
                  const resText = await res.text();
                  console.log('PATCH response (header record grid):', { status: res.status, text: resText });
                  // Force grid refresh after PATCH
                  try {
                    const headersData = await fetchSOHeaders();
                    setHeaderRecords(Array.isArray(headersData) ? headersData : [headersData]);
                  } catch (err) {
                    // Optionally handle fetch error
                  }
                }
              }}
            />
              </div>
            {deleteStatus && (
              <div className="mt-2 text-sm font-semibold p-2 rounded" style={{ background: '#f3f4f6', color: deleteStatus.startsWith('Error') || deleteStatus.startsWith('Failed') ? '#dc2626' : '#059669' }}>
                {deleteStatus}
              </div>
            )}
              </div>
            </div>
          </div>

          {/* SO Lines Section - Only show when SO header is selected */}
          {selectedHeaderId ? (
          <div className="min-w-0" style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="flex gap-3 mb-4">
              {/* Left Side Controls for Item Details */}
              <div className="flex flex-col gap-3" style={{ width: '280px', flexShrink: 0 }}>
                {/* Search box for SO lines */}
                <div className="mt-12">
                  <input
                    type="text"
                    placeholder="Search SO items (code, name, batch)..."
                    className="border border-gray-300 px-6 py-3 rounded text-base w-full"
                    value={searchSOLineInput}
                    onChange={(e) => setSearchSOLineInput(e.target.value)}
                  />
                </div>
                {/* Loading Checklist Button - FIRST */}
                <button
                  type="button"
                  className={`text-white px-6 py-3 rounded shadow text-base font-semibold w-full active:scale-95 transition-all duration-100 ${selectedHeaderId && headerRecords.find(h => h.id === Number(selectedHeaderId))?.status === 'Picked' ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                  style={{ backgroundColor: '#008ecc', opacity: selectedHeaderId && headerRecords.find(h => h.id === Number(selectedHeaderId))?.status === 'Picked' ? 1 : 0.6 }}
                  onMouseEnter={(e) => selectedHeaderId && headerRecords.find(h => h.id === Number(selectedHeaderId))?.status === 'Picked' && (e.currentTarget.style.filter = 'brightness(0.9)')}
                  onMouseLeave={(e) => selectedHeaderId && headerRecords.find(h => h.id === Number(selectedHeaderId))?.status === 'Picked' && (e.currentTarget.style.filter = 'brightness(1)')}
                  onClick={() => {
                    const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
                    if (!selectedHeader) {
                      alert('Please select an SO first');
                      return;
                    }
                    if (selectedHeader.status !== 'Picked') {
                      alert(`Cannot access loading checklist. Current status: ${selectedHeader.status}. Must be "Picked"`);
                      return;
                    }
                    setLoadingChecklistHeaderId(selectedHeader.id);
                    setShowLoadingChecklistModal(true);
                  }}
                  disabled={!selectedHeaderId || headerRecords.find(h => h.id === Number(selectedHeaderId))?.status !== 'Picked'}
                >
                  📋 Loading Checklist
                </button>

                {/* Dispatch Button - SECOND */}
                <button
                  type="button"
                  className={`text-white px-6 py-3 rounded shadow text-base font-semibold w-full active:scale-95 transition-all duration-100 ${selectedHeaderId && ['Picked', 'Shipped'].includes(headerRecords.find(h => h.id === Number(selectedHeaderId))?.status) ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                  style={{ backgroundColor: '#008ecc', opacity: selectedHeaderId && ['Picked', 'Shipped'].includes(headerRecords.find(h => h.id === Number(selectedHeaderId))?.status) ? 1 : 0.6 }}
                  onMouseEnter={(e) => selectedHeaderId && ['Picked', 'Shipped'].includes(headerRecords.find(h => h.id === Number(selectedHeaderId))?.status) && (e.currentTarget.style.filter = 'brightness(0.9)')}
                  onMouseLeave={(e) => selectedHeaderId && ['Picked', 'Shipped'].includes(headerRecords.find(h => h.id === Number(selectedHeaderId))?.status) && (e.currentTarget.style.filter = 'brightness(1)')}
                  onClick={async () => {
                    const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
                    if (!selectedHeader) {
                      alert('Please select an SO first');
                      return;
                    }
                    if (!['Picked', 'Shipped'].includes(selectedHeader.status)) {
                      alert(`Cannot dispatch. Current status: ${selectedHeader.status}. Must be "Picked" or "Shipped"`);
                      return;
                    }
                    setDispatchHeaderId(selectedHeader.id);
                    
                    // Check if gatepass already exists for this SO
                    try {
                      const response = await fetch(`/api/gatepass?so_header_id=${selectedHeader.id}`);
                      
                      if (response.ok) {
                        const result = await response.json();
                        
                        if (result.success && Array.isArray(result.data) && result.data.length > 0) {
                          // Auto-fill with existing data
                          const gatepass = result.data[0];
                          setDispatchForm({
                            driver_name: gatepass.driver_name || '',
                            driver_phone: gatepass.driver_phone || '',
                            vehicle_plate_no: gatepass.vehicle_plate_no || '',
                            trucking_company: gatepass.trucking_company || '',
                            route: gatepass.route || '',
                            remarks: gatepass.remarks || ''
                          });
                        } else {
                          // No existing gatepass, show blank form
                          setDispatchForm({
                            driver_name: '',
                            driver_phone: '',
                            vehicle_plate_no: '',
                            trucking_company: '',
                            route: '',
                            remarks: ''
                          });
                        }
                      } else {
                        // API error, show blank form
                        setDispatchForm({
                          driver_name: '',
                          driver_phone: '',
                          vehicle_plate_no: '',
                          trucking_company: '',
                          route: '',
                          remarks: ''
                        });
                      }
                    } catch (err) {
                      console.error('Error checking existing gatepass:', err);
                      // Fallback to blank form
                      setDispatchForm({
                        driver_name: '',
                        driver_phone: '',
                        vehicle_plate_no: '',
                        trucking_company: '',
                        route: '',
                        remarks: ''
                      });
                    }
                    
                    setShowDispatchModal(true);
                  }}
                  disabled={!selectedHeaderId || !['Picked', 'Shipped'].includes(headerRecords.find(h => h.id === Number(selectedHeaderId))?.status)}
                >
                  🚚 Dispatch
                </button>
                
                {/* Issuance Gatepass Button - THIRD */}
                <button
                  type="button"
                  className={`text-white px-6 py-3 rounded shadow text-base font-semibold w-full active:scale-95 transition-all duration-100 ${selectedHeaderId && headerRecords.find(h => h.id === Number(selectedHeaderId))?.status === 'Picked' ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                  style={{ backgroundColor: '#008ecc', opacity: selectedHeaderId && headerRecords.find(h => h.id === Number(selectedHeaderId))?.status === 'Picked' ? 1 : 0.6 }}
                  onMouseEnter={(e) => selectedHeaderId && headerRecords.find(h => h.id === Number(selectedHeaderId))?.status === 'Picked' && (e.currentTarget.style.filter = 'brightness(0.9)')}
                  onMouseLeave={(e) => selectedHeaderId && headerRecords.find(h => h.id === Number(selectedHeaderId))?.status === 'Picked' && (e.currentTarget.style.filter = 'brightness(1)')}
                  onClick={() => {
                    const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
                    if (!selectedHeader) {
                      alert('Please select an SO first');
                      return;
                    }
                    if (selectedHeader.status !== 'Picked') {
                      alert(`Cannot view gatepass. Current status: ${selectedHeader.status}. Must be "Picked"`);
                      return;
                    }
                    setGatepassHeaderId(selectedHeader.id);
                    setShowGatepassModal(true);
                  }}
                  disabled={!selectedHeaderId || headerRecords.find(h => h.id === Number(selectedHeaderId))?.status !== 'Picked'}
                >
                  🚪 Issuance Gatepass
                </button>
              </div>
              {/* Grid on right */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-2xl font-bold">Item Details</h2>
                  {selectedHeaderId && headerRecords.find(h => h.id === Number(selectedHeaderId)) && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">Current Status:</span>
                      {(() => {
                        const status = headerRecords.find(h => h.id === Number(selectedHeaderId))?.status || '';
                        const statusColors: any = {
                          'New': 'bg-blue-100 text-blue-800',
                          'Received': 'bg-yellow-100 text-yellow-800',
                          'PutAway': 'bg-purple-100 text-purple-800',
                          'Complete': 'bg-green-100 text-green-800',
                        };
                        return (
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
                            {status}
                          </span>
                        );
                      })()}
                    </div>
                  )}
                </div>
                <div className="ag-theme-alpine" style={{ width: '100%', minWidth: 0, height: 400, background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px' }}>
                <AgGridReact
                  theme="legacy"
                  rowData={filteredRecordLines.filter(line => {
                    // Filter by search input
                    if (searchSOLineInput.trim() === '') return true;
                    const searchLower = searchSOLineInput.toLowerCase();
                    const itemData = items.find(i => i.id === line.item_id);
                    return (
                      (line.item_code || itemData?.item_code || '').toLowerCase().includes(searchLower) ||
                      (line.item_name || itemData?.item_name || '').toLowerCase().includes(searchLower) ||
                      (line.batch_number || '').toLowerCase().includes(searchLower) ||
                      (line.description || '').toLowerCase().includes(searchLower) ||
                      (line.pallet_id || '').toLowerCase().includes(searchLower)
                    );
                  }).map(line => {
                    // Lookup item details by item_id if not present
                    const itemData = items.find(i => i.id === line.item_id);
                    
                    // Calculate allocated and shipped quantities from current records
                    const allocatedQty = line.allocatedQuantity ?? line.allocated_quantity ?? 0;
                    const shippedQty = line.shippedQuantity ?? line.quantity_shipped ?? 0;
                    
                    return {
                      itemCode: line.itemCode ?? line.item_code ?? itemData?.item_code ?? '',
                      itemName: line.itemName ?? line.item_name ?? itemData?.item_name ?? '',
                      description: line.description ?? '',
                      expectedQuantity: line.expectedQuantity ?? line.expected_quantity ?? line.ordered_quantity ?? '',
                      quantityExpected: line.quantityExpected ?? line.expected_quantity ?? line.ordered_quantity ?? '',
                      orderedQuantity: line.orderedQuantity ?? line.ordered_quantity ?? '',
                      soUom: line.soUom ?? line.so_uom ?? 'units',
                      allocatedQuantity: allocatedQty,
                      shippedQuantity: shippedQty,
                      batchNumber: line.batchNumber ?? line.batch_number ?? '',
                      manufacturingDate: line.manufacturingDate ?? line.manufacturing_date ?? '',
                      expiryDate: line.expiryDate ?? line.expiry_date ?? '',
                      palletId: line.palletId ?? line.pallet_id ?? '',
                      weightUomKg: line.weightUomKg ?? line.weight_uom_kg ?? '',
                      palletConfig: line.palletConfig ?? line.pallet_config ?? '',
                      itemUom: line.itemUom ?? line.item_uom ?? itemData?.item_uom ?? '',
                      asnUom: line.asnUom ?? line.asn_uom ?? '',
                      remarks: line.remarks ?? '',
                      selected: false,
                      id: line.id,
                      putawayStatus: putawayCompletedLines.has(line.id) ? 'complete' : 'pending'
                    };
                  })}
                  rowHeight={40}
                  headerHeight={40}
                  pagination={true}
                  paginationPageSize={100}
                  columnDefs={recordViewColumnDefs as any}
                  defaultColDef={{
                    resizable: false,
                    sortable: false,
                    filter: true,
                    editable: headerRecords.find(h => h.id === Number(selectedHeaderId))?.status !== 'PutAway'
                  }}
                  components={{
                    putawayStatusRenderer: (params: any) => (
                      <div className="flex items-center justify-center h-full">
                        {params.data?.putawayStatus === 'complete' ? (
                          <span className="text-lg text-green-600 font-bold">✓</span>
                        ) : (
                          <span className="text-lg text-gray-300">○</span>
                        )}
                      </div>
                    ),
                    actionsCellRenderer: (params: any) => {
                      const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
                      const isPutawayEnabled = selectedHeader?.status === 'PutAway';
                      const isAlreadyPutaway = params.data?.putawayStatus === 'complete';
                      const isButtonEnabled = isPutawayEnabled && !isAlreadyPutaway;
                      return isPutawayEnabled ? (
                        <button
                          className={`p-1 rounded text-sm flex items-center justify-center leading-none ${
                            isButtonEnabled
                              ? 'bg-green-600 text-white cursor-pointer hover:bg-green-700'
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                          style={{ width: '28px', height: '28px' }}
                          onClick={e => {
                            e.stopPropagation();
                            if (isButtonEnabled && selectedHeaderId) {
                              console.log('🔍 Putaway button clicked - params.data:', params.data);
                              console.log('🔍 Line ID from params:', params.data.id);
                              console.log('🔍 Pallet ID from params:', params.data.palletId);
                              setPutawayHeaderId(Number(selectedHeaderId));
                              setPutawayLineId(params.data.id);
                              setShowPutawayModal(true);
                            }
                          }}
                          disabled={!isButtonEnabled}
                          title={isAlreadyPutaway ? 'Already Putaway' : 'Putaway'}
                        >
                          ➜
                        </button>
                      ) : null;
                    },
                  }}
                  getRowId={(params) => String(params.data?.id || Math.random())}
                  suppressRowClickSelection={true}
                  rowSelection="multiple"
                  key={selectedHeaderId}
                  onCellValueChanged={async params => {
                const data = params.data;
                const colDef = params.colDef;
                console.log('🔄 Cell changed:', { field: colDef?.field, oldValue: params.oldValue, newValue: params.newValue, data });
                if (data.id) {
                  setLineRecords(prev => {
                    const updated = prev.map(line =>
                      line.id === data.id
                        ? {
                            ...line,
                            item_code: data.itemCode,
                            item_name: data.itemName,
                            description: data.description,
                            ordered_quantity: data.orderedQuantity || data.expectedQuantity,
                            batch_number: data.batchNumber,
                            manufacturing_date: data.manufacturingDate,
                            expiry_date: data.expiryDate,
                            pallet_id: data.palletId,
                            weight_uom_kg: data.weightUomKg,
                            pallet_config: data.palletConfig,
                            item_uom: data.itemUom,
                            asn_uom: data.asnUom,
                            remarks: data.remarks,
                          }
                        : line
                    );
                    return updated;
                  });
                  setFilteredRecordLines(prev => {
                    const updated = prev.map(line =>
                      line.id === data.id
                        ? {
                            ...line,
                            itemCode: data.itemCode,
                            itemName: data.itemName,
                            description: data.description,
                            expectedQuantity: data.expectedQuantity,
                            orderedQuantity: data.orderedQuantity,
                            batchNumber: data.batchNumber,
                            manufacturingDate: data.manufacturingDate,
                            expiryDate: data.expiryDate,
                            palletId: data.palletId,
                            weightUomKg: data.weightUomKg,
                            palletConfig: data.palletConfig,
                            itemUom: data.itemUom,
                            asnUom: data.asnUom,
                            remarks: data.remarks,
                          }
                        : line
                    );
                    return updated;
                  });
                  // PATCH logic remains unchanged
                  const lineToSend = {
                    item_code: data.itemCode,
                    item_name: data.itemName,
                    description: data.description,
                    ordered_quantity: data.orderedQuantity ? Number(data.orderedQuantity) : (data.expectedQuantity ? Number(data.expectedQuantity) : null),
                    batch_number: data.batchNumber || null,
                    manufacturing_date: data.manufacturingDate ? (typeof data.manufacturingDate === 'string' ? data.manufacturingDate.slice(0, 10) : data.manufacturingDate) : null,
                    expiry_date: data.expiryDate ? (typeof data.expiryDate === 'string' ? data.expiryDate.slice(0, 10) : data.expiryDate) : null,
                    pallet_id: data.palletId || null,
                    weight_uom_kg: data.weightUomKg ? Number(data.weightUomKg) : null,
                    pallet_config: data.palletConfig || null,
                    item_uom: data.itemUom || null,
                    asn_uom: data.asnUom || null,
                    remarks: data.remarks || null
                  };
                  const patchUrl = `${urlLines}?id=eq.${data.id}`;
                  console.log('📤 Sending PATCH:', { url: patchUrl, payload: lineToSend });
                  const res = await fetch(patchUrl, {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-Api-Key': apiKey,
                    },
                    body: JSON.stringify(lineToSend),
                  });
                  const resText = await res.text();
                  console.log('📥 PATCH response:', { status: res.status, statusText: res.statusText, body: resText });
                  try {
                    const linesData = await fetchSOLines();
                    setLineRecords(Array.isArray(linesData) ? linesData : [linesData]);
                    // Update filteredRecordLines to reflect the change
                    const updatedLines = (Array.isArray(linesData) ? linesData : [linesData]).filter((line: any) => line.so_header_id === selectedHeaderId);
                    setFilteredRecordLines(updatedLines.map((line: any) => ({
                      itemCode: line.itemCode ?? line.item_code ?? '',
                      itemName: line.itemName ?? line.item_name ?? '',
                      description: line.description ?? '',
                      expectedQuantity: line.expectedQuantity ?? line.ordered_quantity ?? '',
                      orderedQuantity: line.orderedQuantity ?? line.ordered_quantity ?? '',
                      batchNumber: line.batchNumber ?? line.batch_number ?? '',
                      manufacturingDate: line.manufacturingDate ?? line.manufacturing_date ?? '',
                      expiryDate: line.expiryDate ?? line.expiry_date ?? '',
                      palletId: line.palletId ?? line.pallet_id ?? '',
                      weightUomKg: line.weightUomKg ?? line.weight_uom_kg ?? '',
                      palletConfig: line.palletConfig ?? line.pallet_config ?? '',
                      itemUom: line.itemUom ?? line.item_uom ?? '',
                      asnUom: line.asnUom ?? line.asn_uom ?? '',
                      remarks: line.remarks ?? '',
                      selected: false,
                      id: line.id
                    })));
                  } catch (err) {
                    console.error('Error refreshing SO lines:', err);
                  }
                }
              }}
                />
              </div>
            </div>
            </div>
          </div>
          ) : (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-yellow-800">👉 Select a Sales Order to view item details</p>
            </div>
          )}
        </div>
      </div>

      {/* Status Change Confirmation Modal */}
      {showStatusConfirmation && pendingStatusChange && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
            <h2 className="text-lg font-bold mb-4">Confirm Status Change</h2>
            <p className="text-gray-700 mb-6">
              Are you sure you want to change the status? <br />
              <span className="font-semibold text-sm mt-2 block">
                From: <span className="text-red-600">{pendingStatusChange.oldStatus}</span> <br />
                To: <span className="text-green-600">{pendingStatusChange.newStatus}</span>
              </span>
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                className="flex-1 px-4 py-2 rounded font-semibold text-white"
                style={{ backgroundColor: '#008ecc' }}
                onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.9)'}
                onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                onClick={async () => {
                  setShowStatusConfirmation(false);
                  
                  if (pendingStatusChange) {
                    const record = headerRecords.find(h => h.id === pendingStatusChange.recordId);
                    if (record) {
                      // Update local state
                      setHeaderRecords(prev => prev.map(h => 
                        h.id === pendingStatusChange.recordId 
                          ? { ...h, status: pendingStatusChange.newStatus }
                          : h
                      ));

                      // Send PATCH to backend via API route
                      try {
                        const res = await fetch('/api/patch-record', {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            table: 'so_headers',
                            id: pendingStatusChange.recordId,
                            data: { status: pendingStatusChange.newStatus },
                          }),
                        });
                        
                        if (!res.ok) {
                          console.error('Failed to update status');
                          // Revert on error
                          setHeaderRecords(prev => prev.map(h => 
                            h.id === pendingStatusChange.recordId 
                              ? { ...h, status: pendingStatusChange.oldStatus }
                              : h
                          ));
                        } else {
                          console.log('Status updated successfully');
                          // Clear cache so fresh data is loaded
                          const yearFilter = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
                          await fetch('/api/outbound-records', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                              'X-Api-Key': apiKey,
                            },
                            body: JSON.stringify({ year: yearFilter, action: 'clear' }),
                          }).catch(err => console.error('Cache clear error:', err));
                          // Refresh grid to display the updated status
                          headerGridRef.current?.api?.refreshCells({ force: true });
                        }
                      } catch (err) {
                        console.error('Error updating status:', err);
                        // Revert on error
                        setHeaderRecords(prev => prev.map(h => 
                          h.id === pendingStatusChange.recordId 
                            ? { ...h, status: pendingStatusChange.oldStatus }
                            : h
                        ));
                      }
                    }
                    setPendingStatusChange(null);
                  }
                }}
              >
                ✓ Confirm
              </button>
              <button
                type="button"
                className="flex-1 px-4 py-2 rounded font-semibold text-gray-700 bg-gray-200"
                onClick={() => {
                  setShowStatusConfirmation(false);
                  // Revert to old status
                  if (pendingStatusChange) {
                    setHeaderRecords(prev => prev.map(h => 
                      h.id === pendingStatusChange.recordId 
                        ? { ...h, status: pendingStatusChange.oldStatus }
                        : h
                    ));
                    setPendingStatusChange(null);
                  }
                }}
              >
                ✕ Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
