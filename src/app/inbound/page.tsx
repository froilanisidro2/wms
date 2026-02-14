"use client";
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getVendors, getItems, getLocations } from '../config/api';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { ASNBarcode } from './ASNBarcode';
import { submitPutawayRecord, submitSplitPutaway } from '@/utils/putawayHelper';
import { getManilaDateForInput } from '@/utils/timezoneHelper';
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
const urlHeaders = process.env.NEXT_PUBLIC_URL_ASN_HEADERS || '';
const urlLines = process.env.NEXT_PUBLIC_URL_ASN_LINES || '';
const urlPutaway = process.env.NEXT_PUBLIC_URL_PUTAWAY_TRANSACTIONS || '';
const urlReceivingTransactions = process.env.NEXT_PUBLIC_URL_RECEIVING_TRANSACTIONS || '';
const urlAsnInventory = process.env.NEXT_PUBLIC_URL_ASN_INVENTORY || '';

/**
 * Wrapper functions to route ASN data through API layer
 * These replace direct PostgREST calls
 */
async function fetchASNHeaders() {
  const response = await fetch('/api/asn-data?dataType=headers');
  if (!response.ok) throw new Error(`Failed to fetch headers: ${response.status}`);
  const data = await response.json();
  return data.asnHeaders || [];
}

async function fetchASNLines(headerId?: number) {
  const query = headerId ? `/api/asn-data?dataType=lines&headerId=${headerId}` : '/api/asn-data?dataType=lines';
  const response = await fetch(query);
  if (!response.ok) throw new Error(`Failed to fetch lines: ${response.status}`);
  const data = await response.json();
  return data.asnLines || [];
}

async function fetchASNData() {
  const response = await fetch('/api/asn-data?dataType=all');
  if (!response.ok) throw new Error(`Failed to fetch ASN data: ${response.status}`);
  return response.json();
}

async function postASNHeader(payload: any) {
  return fetch('/api/asn-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createHeader', header: payload }),
  });
}

async function postASNLines(payload: any[]) {
  // Post all lines at once via API endpoint
  return fetch('/api/asn-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createLines', lines: payload }),
  });
}

// AG Grid columnDefs for entry grid (hides non-essential fields)
const columnDefs = [
  { headerName: 'Item Code', field: 'itemCode', editable: true },
  { headerName: 'Item Name', field: 'itemName', editable: true },
  { headerName: 'Description', field: 'description', editable: true },
  { headerName: 'Expected Qty', field: 'expectedQuantity', editable: true },
  { headerName: 'ASN UOM', field: 'asnUom', editable: true },
  { headerName: 'Weight UOM (KG)', field: 'weightUomKg', editable: true },
  { headerName: 'Received Qty', field: 'receivedQuantity', editable: true, hide: true },
  { headerName: 'Batch #', field: 'batchNumber', editable: true, hide: true },
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
  { headerName: 'Pallet ID', field: 'palletId', editable: true },
  { headerName: 'Pallet Config', field: 'palletConfig', editable: true },
  { headerName: 'Item UOM', field: 'itemUom', editable: true },
  { headerName: 'Remarks', field: 'remarks', editable: true, hide: true },
];

// AG Grid columnDefs for record view grid (shows all fields)
const recordViewColumnDefs = [
  { headerName: '', field: 'actions', width: 50, sortable: false, filter: false, editable: false, hide: true, cellRenderer: 'actionsCellRenderer' },
  { 
    headerName: 'Putaway', 
    field: 'putawayStatus', 
    width: 130, 
    sortable: false, 
    filter: false, 
    editable: false, 
    cellRenderer: 'putawayStatusRenderer',
    headerComponent: () => <div title="Putaway Status" className="font-semibold">PutAway</div>
  },
  { headerName: 'Item Code', field: 'itemCode', editable: true },
  { headerName: 'Item Name', field: 'itemName', editable: true },
  { headerName: 'Description', field: 'description', editable: true },
  { headerName: 'Expected Qty', field: 'expectedQuantity', editable: true },
  { headerName: 'ASN UOM', field: 'asnUom', editable: true },
  { headerName: 'Weight UOM (KG)', field: 'weightUomKg', editable: true },
  { headerName: 'Item UOM', field: 'itemUom', editable: true },
  { headerName: 'Received Qty', field: 'receivedQuantity', editable: true },
  { headerName: 'Batch #', field: 'batchNumber', editable: true },
  {
    headerName: 'Mfg Date',
    field: 'manufacturingDate',
    editable: true,
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
    cellEditor: 'agDatePicker',
    cellEditorParams: {
      // Optionally set min/max date
    },
    valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString() : '',
  },
  { headerName: 'Pallet ID', field: 'palletId', editable: true },
  { headerName: 'Pallet Config', field: 'palletConfig', editable: true },
  { headerName: 'Remarks', field: 'remarks', editable: true },
];


interface ASNHeader {
  asnNumber: string;
  barcode?: string;
  vendorCode: string;
  vendorName: string;
  poNumber: string;
  asnDate: string;
  status: string;
  remarks: string;
  warehouse_id?: number;
}

interface ASNLine {
  itemCode: string;
  itemName: string;
  description: string;
  expectedQuantity: string;
  receivedQuantity: string;
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

export default function InboundPage() {
    // State for Inbound Entry collapse/expand
    const [isInboundEntryExpanded, setIsInboundEntryExpanded] = useState(true);
    // State for Putaway modal
    const [showPutawayModal, setShowPutawayModal] = useState(false);
    const [putawayHeaderId, setPutawayHeaderId] = useState<number | null>(null);
    const [putawayLineId, setPutawayLineId] = useState<number | null>(null);
    const [putawayLocation, setPutawayLocation] = useState('');
    const [putawayLocationSearch, setPutawayLocationSearch] = useState('');
    const [putawayQuantity, setPutawayQuantity] = useState('');
    const [putawayRemarks, setPutawayRemarks] = useState('');
    const [putawayLoading, setPutawayLoading] = useState(false);
    const [putawayError, setPutawayError] = useState<string | null>(null);
    const [showPutawayLocationDropdown, setShowPutawayLocationDropdown] = useState(false);
    
    // Split putaway state - now supports multiple reasons
    const [isSplitMode, setIsSplitMode] = useState(false);
    const [splitRecords, setSplitRecords] = useState<Array<{
      id: string;
      reason: 'good' | 'damage' | 'missing' | 'defective';
      quantity: number | string;
      location: string;
      locationSearch: string;
    }>>([
      { id: '1', reason: 'good', quantity: '', location: '', locationSearch: '' },
      { id: '2', reason: 'damage', quantity: '', location: '', locationSearch: '' },
    ]);
    
    // State for Putaway Confirmation Modal
    const [showPutawayConfirmation, setShowPutawayConfirmation] = useState(false);
    const [putawayConfirmationData, setPutawayConfirmationData] = useState<any>(null);
    
    // State for Gatepass Modal
    const [showGatepassModal, setShowGatepassModal] = useState(false);
    const [gatepassHeaderId, setGatepassHeaderId] = useState<number | null>(null);
    const [gatepassNumber, setGatepassNumber] = useState('');
    
    // State for Print Preview modal
    const [showPrintPreview, setShowPrintPreview] = useState(false);
    const [printHeaderId, setPrintHeaderId] = useState<number | null>(null);
    
    // State for Receiving Confirmation modal
    const [showReceivingConfirmation, setShowReceivingConfirmation] = useState(false);
    const [receivingConfirmationHeaderId, setReceivingConfirmationHeaderId] = useState<number | null>(null);
    
    // State for Pallet Tag modal
    const [showPalletTag, setShowPalletTag] = useState(false);
    const [palletTagHeaderId, setPalletTagHeaderId] = useState<number | null>(null);
    const [palletTagLineId, setPalletTagLineId] = useState<number | null>(null);
    
    // State for ASN Items Preview modal
    const [showAsnItemsPreview, setShowAsnItemsPreview] = useState(false);
    
    // State for tracking putaway status by line ID
    const [putawayCompletedLines, setPutawayCompletedLines] = useState<Set<number>>(new Set());
    
    // State for location options (from API)
    const [locationOptions, setLocationOptions] = useState<any[]>([]);
    
    // State for tracking last clicked status cell (for 2nd click to open dropdown)
    const [lastClickedStatusCell, setLastClickedStatusCell] = useState<{ rowIndex: number | null; colKey: string | null }>({ rowIndex: null, colKey: null });
  // Vendor and item lists for dropdowns
  const [vendors, setVendors] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [vendorSearchInput, setVendorSearchInput] = useState('');
  const [showVendorDropdown, setShowVendorDropdown] = useState(false);
  const vendorInputRef = useRef<HTMLInputElement>(null);

  // Filter vendors based on search input
  const filteredVendors = useMemo(() => {
    if (!vendorSearchInput.trim()) return vendors;
    const search = vendorSearchInput.toLowerCase();
    return vendors.filter(v =>
      v.vendor_code.toLowerCase().includes(search) ||
      v.vendor_name.toLowerCase().includes(search)
    );
  }, [vendors, vendorSearchInput]);

  useEffect(() => {
    getVendors().then(setVendors);
    getItems().then(setItems);
    
    // Fetch location options from cached API
    const fetchLocations = async () => {
      try {
        const locations = await getLocations();
        
        // Map locations table fields to dropdown display
        const normalizedLocations = locations.map((loc: any) => ({
          id: loc.id,
          name: loc.location_code ? `${loc.location_code} (${loc.bin || 'Bin'})` : loc.location_name || `Bin-${loc.id}`,
          location_code: loc.location_code,
          bin: loc.bin,
        }));
        
        setLocationOptions(normalizedLocations);
        
        // Also set available locations for receiving (receiving modal)
        // Filter for active locations and sort with Staging-004 first
        const receivingLocations = locations
          .filter((loc: any) => loc.is_active) // Only active locations
          .map((loc: any) => ({
            id: loc.id,
            location_name: loc.location_name || `Location-${loc.id}`,
          }))
          .sort((a: any, b: any) => {
            // Sort with Staging-004 first (default)
            if (a.location_name === 'Staging-004') return -1;
            if (b.location_name === 'Staging-004') return 1;
            return a.location_name.localeCompare(b.location_name);
          });
        
        setAvailableLocations(receivingLocations);
      } catch (err) {
        console.error('Error fetching locations:', err);
        // Fallback to empty array or basic options
        setLocationOptions([
          { id: 'A1', name: 'A1' },
          { id: 'B1', name: 'B1' },
          { id: 'C1', name: 'C1' },
        ]);
        // Fallback for receiving locations
        setAvailableLocations([{ id: 1, location_name: 'Staging-004' }]);
      }
    };
    
    fetchLocations();
  }, []);
            // State for ASN lines update feedback
            const [linesUpdateStatus, setLinesUpdateStatus] = useState<string | null>(null);

            // Handler to update ASN lines in backend
            const handleUpdateLines = async () => {
              setLinesUpdateStatus(null);
              if (!selectedHeaderId) {
                setLinesUpdateStatus('No ASN header selected.');
                return;
              }
              const linesToUpdate = lineRecords.filter(line => line.asn_header_id === selectedHeaderId);
              if (linesToUpdate.length === 0) {
                setLinesUpdateStatus('No ASN lines to update.');
                return;
              }
              try {
                for (const line of linesToUpdate) {
                  // Only send editable fields for PATCH
                  const lineToSend = {
                    item_id: line.item_id,
                    item_description: line.item_description,
                    expected_quantity: line.expected_quantity,
                    received_quantity: line.received_quantity,
                    batch_number: line.batch_number,
                    serial_number: line.serial_number,
                    manufacturing_date: line.manufacturing_date,
                    expiry_date: line.expiry_date,
                    pallet_id: line.pallet_id,
                    uom: line.uom,
                    remarks: line.remarks ?? ''
                  };
                  console.log('PATCH ASN line:', { id: line.id, payload: lineToSend });
                  // Use API route instead of direct PostgREST call
                  const res = await fetch('/api/patch-record', {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      table: 'asn_lines',
                      id: line.id,
                      data: lineToSend,
                    }),
                  });
                  const resText = await res.text();
                  console.log('PATCH response:', { status: res.status, text: resText });
                  if (!res.ok) {
                    setLinesUpdateStatus(`Failed to update ASN line ${line.id}. Status: ${res.status}. Response: ${resText}`);
                    return;
                  }
                }
                setLinesUpdateStatus('ASN lines updated successfully!');
                // Re-fetch ASN lines from backend to update grid via API route
                try {
                  const linesData = await fetchASNLines();
                  setLineRecords(Array.isArray(linesData) ? linesData : []);
                } catch (err) {
                  // Optionally handle fetch error
                }
              } catch (err: any) {
                setLinesUpdateStatus(`Error: ${err.message}`);
              }
            };
          // Track selected ASN header id for filtering lines
          const [selectedHeaderId, setSelectedHeaderId] = useState<string | null>(null);
          // Track selected ASN line id for putaway/tag actions
          const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
        // Ref for ASN headers grid
        const headerGridRef = useRef<any>(null);
        // State for delete feedback
        const [deleteStatus, setDeleteStatus] = useState<string | null>(null);

        // Handler to delete selected ASN headers
        const handleDeleteSelectedHeaders = async () => {
          setDeleteStatus(null);
          const selectedNodes = headerGridRef.current?.api.getSelectedNodes() || [];
          const selectedIds = selectedNodes.map((node: any) => node.data.id);
          console.log('🗑️ Delete handler - selectedNodes:', selectedNodes.length, 'selectedIds:', selectedIds);
          if (selectedIds.length === 0) {
            setDeleteStatus('No ASN headers selected.');
            return;
          }
          try {
            // Build batch delete operations IN CORRECT ORDER (child tables before parent)
            const deleteOps: any[] = [];
            
            // Step 1: DELETE asn_lines FIRST (they reference asn_headers via foreign key)
            for (const headerId of selectedIds) {
              const linesToDelete = lineRecords.filter(l => l.asn_header_id === headerId);
              for (const line of linesToDelete) {
                deleteOps.push({
                  table: 'asn_lines',
                  filters: { 'id': `eq.${line.id}` }
                });
              }
            }

            // Step 2: Delete asn_inventory (references asn_lines, but if we delete asn_lines first via cascade, this may not be needed)
            for (const headerId of selectedIds) {
              const linesToDelete = lineRecords.filter(l => l.asn_header_id === headerId);
              for (const line of linesToDelete) {
                deleteOps.push({
                  table: 'asn_inventory',
                  filters: { 'asn_line_id': `eq.${line.id}` }
                });
              }
            }

            // Step 3: Delete dependent records from receiving_transactions (if exists)
            for (const headerId of selectedIds) {
              deleteOps.push({
                table: 'receiving_transactions',
                filters: { 'asn_header_id': `eq.${headerId}` }
              });
            }

            // Step 4: Delete dependent records from putaway_transactions (by receiving_transaction_id)
            for (const headerId of selectedIds) {
              deleteOps.push({
                table: 'putaway_transactions',
                filters: { 'receiving_transaction_id': `eq.${headerId}` }
              });
            }

            // Step 5: NOW delete ASN headers (after all dependent records are gone)
            for (const id of selectedIds) {
              deleteOps.push({
                table: 'asn_headers',
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
            setLineRecords(prev => prev.filter(line => !selectedIds.includes(line.asn_header_id)));
            setPutawayCompletedLines(new Set());
            setDeleteStatus('✅ Selected ASN headers and all related records deleted successfully!');
          } catch (err: any) {
            setDeleteStatus(`❌ Error: ${err.message}`);
          }
        };
      // State for unified ASN entry submission feedback
      const [entrySubmitStatus, setEntrySubmitStatus] = useState<string | null>(null);

      // Unified handler for ASN header and lines submission
      const handleSubmitEntry = async () => {
        setEntrySubmitStatus(null);
        if (!header.asnDate) {
          setEntrySubmitStatus('ASN Date is required. Please select a valid date.');
          return;
        }
        if (!header.vendorCode) {
          setEntrySubmitStatus('Vendor is required.');
          return;
        }
        // Prepare ASN header payload (no id)
        const asnHeaderPayload = {
          asn_number: header.asnNumber,
          vendor_code: header.vendorCode,
          vendor_name: header.vendorName,
          po_number: header.poNumber,
          asn_date: header.asnDate,
          status: header.status || 'New',
          barcode: header.barcode,
          remarks: header.remarks,
          warehouse_id: warehouseFilter ? parseInt(warehouseFilter) : undefined
        };
        // Prepare ASN lines payload
        const filteredRows = rowData.filter(row => row.itemCode);
        const asnLinesPayload = filteredRows.map(row => ({
          item_code: row.itemCode,
          item_name: row.itemName,
          description: row.description,
          expected_quantity: row.expectedQuantity ? Number(row.expectedQuantity) : null,
          received_quantity: row.receivedQuantity ? Number(row.receivedQuantity) : null,
          batch_number: row.batchNumber || null,
          manufacturing_date: row.manufacturingDate ? row.manufacturingDate.slice(0, 10) : null,
          expiry_date: row.expiryDate ? row.expiryDate.slice(0, 10) : null,
          pallet_id: row.palletId || null,
          weight_uom_kg: row.weightUomKg ? Number(row.weightUomKg) : null,
          pallet_config: row.palletConfig || null,
          item_uom: row.itemUom || null,
          asn_uom: row.asnUom || null,
          remarks: row.remarks || null,
        }));
        if (asnLinesPayload.length === 0) {
          setEntrySubmitStatus('No valid ASN line items to submit.');
          return;
        }
        try {
          // 1. Insert ASN header via API route
          const headerRes = await postASNHeader(asnHeaderPayload);
          if (!headerRes.ok) {
            const headerText = await headerRes.text();
            console.error('ASN Header POST failed:', { status: headerRes.status, body: headerText });
            setEntrySubmitStatus(`Header insert failed: ${headerRes.status} - ${headerText.slice(0, 500)}`);
            return;
          }
          
          const headerData = await headerRes.json();
          console.log('✅ ASN Header created:', headerData.data?.id);
          
          let asn_header_id = headerData.data?.id;
          if (!asn_header_id) {
            setEntrySubmitStatus('Header insert did not return an ID.');
            return;
          }
          // 2. Insert ASN lines with correct header id via API route
          const asnLinesPayloadWithHeader = asnLinesPayload.map(line => ({ ...line, asn_header_id }));
          const linesRes = await postASNLines(asnLinesPayloadWithHeader);
          
          if (!linesRes.ok) {
            const linesText = await linesRes.text();
            console.error('ASN Lines POST failed:', { status: linesRes.status, body: linesText });
            setEntrySubmitStatus(`Lines insert failed: ${linesRes.status} - ${linesText.slice(0, 500)}`);
            return;
          }
          setEntrySubmitStatus('ASN entry (header + lines) submitted successfully!');
          // Clear cache and refetch fresh data
          const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
          try {
            await fetch(`/api/inbound-records`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ year, action: 'clear' }),
            });
            
            // Refetch records with fresh=true to bypass cache
            const refreshUrl = `/api/inbound-records?year=${year}&refresh=true${warehouseFilter ? `&warehouse=${warehouseFilter}` : ''}`;
            const refreshRes = await fetch(refreshUrl);
            if (refreshRes.ok) {
              const freshData = await refreshRes.json();
              console.log('🔄 Refreshed ASN records after entry submission');
              setHeaderRecords(freshData.headers || []);
              setLineRecords(freshData.lines || []);
            }
          } catch (err) {
            console.log('Note: Cache clear/refresh completed');
          }
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
    const [searchRecordLineInput, setSearchRecordLineInput] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
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
          header.asn_number?.toLowerCase().includes(searchHeaderInput.toLowerCase()) ||
          header.vendor_code?.toLowerCase().includes(searchHeaderInput.toLowerCase()) ||
          header.vendor_name?.toLowerCase().includes(searchHeaderInput.toLowerCase()) ||
          header.po_number?.toLowerCase().includes(searchHeaderInput.toLowerCase()) ||
          header.barcode?.toLowerCase().includes(searchHeaderInput.toLowerCase());
        
        const matchesStatus = statusFilter === '' || header.status === statusFilter;
        
        return matchesSearch && matchesStatus;
      });
    }, [headerRecords, searchHeaderInput, statusFilter]);

    // Handle refresh - clear cache and re-fetch
    const handleRefresh = () => {
      setIsRefreshing(true);
      // Call API to clear server cache
      fetch(`/api/inbound-records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: yearFilter, action: 'clear' }),
      }).then(() => {
        // Trigger fetch by temporarily changing state
        setHeaderRecords([]);
        setLineRecords([]);
      });
    };

    // Fetch ASN headers and lines for record view (with caching)
      useEffect(() => {
        async function fetchRecords() {
          try {
            // Call server-side cached API endpoint
            const url = `/api/inbound-records?year=${yearFilter}${warehouseFilter ? `&warehouse=${warehouseFilter}` : ''}`;
            const response = await fetch(url);
            
            if (!response.ok) {
              throw new Error(`Failed to fetch records: ${response.status}`);
            }

            const data = await response.json();
            setHeaderRecords(data.headers || []);
            setLineRecords(data.lines || []);
          } catch (err) {
            console.error('Error fetching records:', err);
            // ...handle error
          } finally {
            setIsRefreshing(false);
          }
        }
        fetchRecords();
      }, [yearFilter, warehouseFilter]);

  // AG Grid column definitions for record view
  // Status transition map - defines which statuses can transition to which
  const statusTransitions: { [key: string]: string[] } = {
    'New': ['Received', 'PutAway', 'Complete'],
    'Received': ['PutAway', 'Complete'],
    'PutAway': ['Complete'],
    'Complete': []
  };

  // Function to get allowed statuses for current status
  const getAllowedStatuses = (currentStatus: string): string[] => {
    const isAdmin = localStorage.getItem('isAdmin') === 'true' || localStorage.getItem('userRole') === 'admin';
    const allStatuses = ['New', 'Received', 'PutAway', 'Complete'];
    
    if (isAdmin) {
      // Admin can go to any status except current
      return allStatuses.filter(s => s !== currentStatus);
    }
    
    // Non-admin can only go forward - show remaining future statuses
    const currentIndex = allStatuses.indexOf(currentStatus);
    return allStatuses.slice(currentIndex + 1);
  };

  const headerRecordCols = [
      {
        headerName: 'Status',
        field: 'status',
        editable: true,
        cellEditor: 'agSelectCellEditor',
        cellEditorParams: (params: any) => {
          const currentStatus = params.data?.status || 'New';
          return {
            values: getAllowedStatuses(currentStatus),
          };
        },
        cellRenderer: (params: any) => {
          const status = params.value;
          const colors: Record<string, string> = {
            'New': 'bg-blue-100 text-blue-800',
            'Received': 'bg-green-100 text-green-800',
            'PutAway': 'bg-yellow-100 text-yellow-800',
            'Complete': 'bg-purple-100 text-purple-800',
          };
          const colorClass = colors[status] || 'bg-gray-100 text-gray-800';
          return <span className={`px-2 py-1 rounded text-xs font-semibold cursor-pointer hover:opacity-80 ${colorClass}`}>{status}</span>;
        }
      },
      { headerName: 'Vendor Code', field: 'vendor_code', editable: true },
      { headerName: 'Vendor Name', field: 'vendor_name', editable: true },
      { headerName: 'PO Number', field: 'po_number', editable: true },
      { headerName: 'ASN Number', field: 'asn_number', editable: true },
      { headerName: 'ASN Date', field: 'asn_date', editable: true },
      { headerName: 'Warehouse ID', field: 'warehouse_id', editable: true },
      { headerName: 'ID', field: 'id', editable: false, hide: true },
      { headerName: 'Created At', field: 'created_at', editable: false },
      { headerName: 'Updated At', field: 'updated_at', editable: false },
      { headerName: 'Remarks', field: 'remarks', editable: true },
  ];

  const lineRecordCols = [
    { 
      headerName: 'Item ID', 
      field: 'item_id', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        // Not editable if status is Received, PutAway, or Complete
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'Item Description', 
      field: 'item_description', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'Expected Qty', 
      field: 'expected_quantity', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'Received Qty', 
      field: 'received_quantity', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'Batch #', 
      field: 'batch_number', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'Serial #', 
      field: 'serial_number', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'Mfg Date', 
      field: 'manufacturing_date', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'Expiry Date', 
      field: 'expiry_date', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'Pallet ID', 
      field: 'pallet_id', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'UOM', 
      field: 'uom', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
    { 
      headerName: 'Remarks', 
      field: 'remarks', 
      editable: (params: any) => {
        const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
        const status = selectedHeader?.status || 'New';
        return !['Received', 'PutAway', 'Complete'].includes(status);
      }
    },
  ];
  const pasteTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const recordPasteTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [showRecordPasteArea, setShowRecordPasteArea] = useState(false);
  const [originalRecordLines, setOriginalRecordLines] = useState<any[]>([]); // Store original state before paste
  const [isSavingPastedData, setIsSavingPastedData] = useState(false);
  const [pasteDataStatus, setPasteDataStatus] = useState<string | null>(null); // Status message for save
  const [showEntryConfirmation, setShowEntryConfirmation] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [showStatusConfirmation, setShowStatusConfirmation] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ recordId: number; oldStatus: string; newStatus: string } | null>(null);
  const [receiveLocationId, setReceiveLocationId] = useState<string>('Staging-004'); // Default to Staging-004
  const [availableLocations, setAvailableLocations] = useState<any[]>([]); // For receiving locations
  const [header, setHeader] = useState<ASNHeader>({
    asnNumber: '',
    vendorCode: '',
    vendorName: '',
    poNumber: '',
    asnDate: getManilaDateForInput(new Date()),
    status: 'New',
    remarks: '',
    warehouse_id: warehouseFilter ? parseInt(warehouseFilter) : undefined,
  });

  // Auto-generate ASN number with timestamp format: ASN+yy+mm+dd+hh+mm+ss
  useEffect(() => {
    const generateASNNumber = () => {
      const now = new Date();
      
      // Format date/time in Asia/Manila timezone for ASN number generation
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      
      const parts = formatter.formatToParts(now);
      const getPartValue = (type: string) => parts.find(p => p.type === type)?.value || '';
      
      const yy = getPartValue('year').slice(-2);
      const mm = getPartValue('month');
      const dd = getPartValue('day');
      const hh = getPartValue('hour');
      const mins = getPartValue('minute');
      const ss = getPartValue('second');
      const ms = String(now.getMilliseconds()).padStart(3, '0');
      
      const asnNumber = `ASN${yy}${mm}${dd}${hh}${mins}${ss}`;
      
      // Generate barcode: numeric format (standard barcode, Code128 compatible)
      // Format: yymmddhhmmssms (14 digits) - use timestamp with milliseconds for uniqueness
      const barcode = `${yy}${mm}${dd}${hh}${mins}${ss}${ms}`;
      
      setHeader(h => ({
        ...h,
        asnNumber: asnNumber,
        barcode: barcode
      }));
    };
    generateASNNumber();
  }, []);
  const [clientReady, setClientReady] = useState(false);

  // Set client ready flag only
  useEffect(() => {
    setClientReady(true);
  }, []);

  // Counter for unique pallet ID generation
  let palletIdCounter = 0;

  // Helper function to safely get received quantity from line record
  const getReceivedQuantity = (line: any): number => {
    if (!line) return 0;
    return Number(line.received_quantity || line.receivedQuantity || 0);
  };

  // Helper function to generate Pallet ID with format: PAL-YYMMDDHHmmss-XXXXX
  // Uses timestamp + milliseconds + counter to ensure GLOBAL uniqueness across all items
  const generatePalletId = (): string => {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    // Increment counter for absolute uniqueness
    palletIdCounter++;
    const counterStr = String(palletIdCounter).padStart(5, '0');
    return `PAL-${yy}${mm}${dd}${hh}${min}${ss}${ms}${counterStr}`;
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
  const [pendingPalletRows, setPendingPalletRows] = useState<ASNLine[]>([]);

  const [rowCount, setRowCount] = useState(5);
  const [rowData, setRowData] = useState<ASNLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const gridRef = useRef<AgGridReact>(null);

  const defaultColDef = useMemo(() => ({ resizable: true, sortable: true, filter: true, minWidth: 120 }), []);

  const handleHeaderChange = (field: keyof ASNHeader, value: any) => {
    setHeader({ ...header, [field]: value });
  };

  const handleRowCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const count = Math.max(1, Number(e.target.value));
    setRowCount(count);
    setRowData(Array.from({ length: count }, () => ({
      itemCode: '',
      itemName: '',
      description: '',
      expectedQuantity: '',
      receivedQuantity: '',
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
    const rows = text.trim().split(/\r?\n/).map(row => row.split('\t'));
    const newRows: ASNLine[] = rows.map(cols => {
      // Look up item by code to auto-fill weight, pallet config, and unit of measure
      const itemCode = cols[0] || '';
      const itemData = items.find(i => i.item_code === itemCode);
      const asnUom = cols[4] || ''; // ASN UOM from pasted data
      
      return {
        itemCode: cols[0] || '',
        itemName: cols[1] || '',
        description: cols[2] || '',
        expectedQuantity: cols[3] || '',
        receivedQuantity: '',
        batchNumber: '',
        manufacturingDate: '',
        expiryDate: '',
        palletId: '',
        weightUomKg: itemData?.weight_uom_kg ? String(itemData.weight_uom_kg) : '',
        palletConfig: itemData?.pallet_config ? String(itemData.pallet_config) : (itemData?.pallet_qty ? String(itemData.pallet_qty) : ''),
        itemUom: itemData?.item_uom || '',
        asnUom: asnUom,
        remarks: '',
      };
    });
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
      alert('Please select an ASN header first');
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
          receivedQuantity: rows[index][0] || line.receivedQuantity,
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
            received_quantity: updated.receivedQuantity,
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
        const receivedQtyChanged = currentLine.receivedQuantity !== originalLine.receivedQuantity;
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
            patchPayload.received_quantity = currentLine.receivedQuantity;
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
                table: 'asn_lines',
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

    // Calculate pallet count: ASN QTY / (WEIGHT * PALLET_CONFIG)
    const palletCount = Math.ceil(qty / (wt * cfg));
    
    if (palletCount <= 0) {
      setPalletGenError('Pallet count calculation resulted in 0 or negative');
      return;
    }

    // Generate Pallet IDs - use the improved generatePalletId function for each pallet
    // This ensures absolute uniqueness even when generating multiple pallets
    
    // Create rows for each pallet
    const newRows: ASNLine[] = Array.from({ length: palletCount }, (_, index) => ({
      itemCode,
      itemName,
      description,
      expectedQuantity: String(qty),
      receivedQuantity: '',
      batchNumber: '',
      manufacturingDate: '',
      expiryDate: '',
      palletId: generatePalletId(), // Call function for each pallet to ensure uniqueness
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
    // Validate ASN Date
    if (!header.asnDate) {
      setLoading(false);
      setError('ASN Date is required. Please select a valid date.');
      return;
    }
    try {
      // Validate ASN lines first
      const filteredRows = rowData.filter(row => row.itemCode !== '');
      const asnLinesPayload = filteredRows.map(row => ({
        item_code: row.itemCode,
        item_name: row.itemName,
        description: row.description,
        expected_quantity: row.expectedQuantity ? Number(row.expectedQuantity) : null,
        received_quantity: row.receivedQuantity ? Number(row.receivedQuantity) : null,
        batch_number: row.batchNumber || null,
        manufacturing_date: row.manufacturingDate ? row.manufacturingDate.slice(0, 10) : null,
        expiry_date: row.expiryDate ? row.expiryDate.slice(0, 10) : null,
        pallet_id: row.palletId || null,
        weight_uom_kg: row.weightUomKg ? Number(row.weightUomKg) : null,
        pallet_config: row.palletConfig || null,
        item_uom: row.itemUom || null,
        asn_uom: row.asnUom || null,
        remarks: row.remarks || null,
      }));

      console.log('ASN lines payload:', asnLinesPayload);
      if (asnLinesPayload.length === 0) {
        setLoading(false);
        setError('No valid ASN line items to submit. Please fill in at least one Item ID.');
        return;
      }

      // 1. Insert ASN header
      // headerId is auto-generated by backend
      const asnHeaderPayload = {
        asn_number: header.asnNumber,
        vendor_code: header.vendorCode,
        vendor_name: header.vendorName,
        po_number: header.poNumber,
        asn_date: header.asnDate,
        status: header.status,
        barcode: header.barcode,
        remarks: header.remarks,
        warehouse_id: header.warehouse_id || parseInt(warehouseFilter || '1')
      };

      const headerRes = await postASNHeader(asnHeaderPayload);

      // Parse header response
      if (!headerRes.ok) {
        const headerText = await headerRes.text();
        setLoading(false);
        setError(`ASN header insert failed: ${headerRes.status} - ${headerText.slice(0, 500)}`);
        return;
      }

      const headerData = await headerRes.json();
      let asn_header_id = headerData.data?.id;
      if (!asn_header_id) {
        setLoading(false);
        setError('Header insert did not return an ID.');
        return;
      }

      // Now insert ASN lines with correct header id
      const asnLinesPayloadWithHeader = asnLinesPayload.map(line => ({ ...line, asn_header_id }));

      console.log('Submitting ASN lines via API endpoint');
      console.log('ASN lines payload with header:', asnLinesPayloadWithHeader);
      const linesRes = await postASNLines(asnLinesPayloadWithHeader);

      if (!linesRes.ok) {
        const linesText = await linesRes.text();
        console.error('ASN lines response:', { response: linesText, status: linesRes.status });
        setLoading(false);
        setError(`Failed to insert ASN lines. Status: ${linesRes.status}, Response: ${linesText.slice(0, 500)}`);
        return;
      }

      setSuccess(true);
      // Clear cache and reload to show new record
      const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
      await fetch(`/api/inbound-records`, {
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
      {/* Side-by-side ASN Entry Block */}
      <div className="w-full bg-white rounded-lg border shadow p-6" style={{ width: '100%', minWidth: 0 }}>
        <div className="flex items-center justify-between mb-4 cursor-pointer" onClick={() => setIsInboundEntryExpanded(!isInboundEntryExpanded)}>
          <h2 className="text-2xl font-bold">Inbound Entry</h2>
          <span className="text-gray-600 text-xl">{isInboundEntryExpanded ? '▼' : '▶'}</span>
        </div>
        {isInboundEntryExpanded && (
        <div className="flex flex-row gap-6" style={{ width: '100%', minWidth: 0 }}>
        {/* Header Fields (left column, auto) */}
        <div className="min-w-0" style={{ flex: '0 0 auto', minWidth: 0 }}>
          <form className="grid grid-cols-1 gap-2" style={{ maxWidth: '280px' }}>
            {clientReady && (
              <></>
            )}
            {/* Vendor Searchable Dropdown */}
            <div>
              <label className="block text-base font-medium mb-1">Vendor</label>
              <div className="relative">
                <div className="flex items-center border rounded">
                  <input
                    ref={vendorInputRef}
                    type="text"
                    placeholder="Search vendor..."
                    value={vendorSearchInput}
                    onChange={e => {
                      setVendorSearchInput(e.target.value);
                      setShowVendorDropdown(true);
                    }}
                    onFocus={() => setShowVendorDropdown(true)}
                    className="flex-1 px-4 py-3 text-base border-none outline-none rounded-l"
                  />
                  <button
                    type="button"
                    onClick={() => setShowVendorDropdown(!showVendorDropdown)}
                    className="px-4 py-3 text-gray-500 hover:text-gray-700 transition-colors"
                    title={showVendorDropdown ? 'Collapse' : 'Expand'}
                  >
                    {showVendorDropdown ? '▲' : '▼'}
                  </button>
                </div>
                {showVendorDropdown && filteredVendors.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-t-0 rounded-b shadow-lg z-10 max-h-40 overflow-y-auto">
                    {filteredVendors.map(v => (
                      <div
                        key={v.vendor_code}
                        onClick={() => {
                          setHeader(h => ({
                            ...h,
                            vendorCode: v.vendor_code,
                            vendorName: v.vendor_name,
                          }));
                          setVendorSearchInput(`${v.vendor_code} - ${v.vendor_name}`);
                          setShowVendorDropdown(false);
                        }}
                        className="px-3 py-2 hover:bg-blue-100 cursor-pointer text-sm border-b last:border-b-0"
                      >
                        {v.vendor_code} - {v.vendor_name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div>
              <label className="block text-base font-medium mb-1">PO Number</label>
              <input type="text" value={header.poNumber} onChange={e => handleHeaderChange('poNumber', e.target.value)} className="border px-4 py-3 text-base w-full rounded" />
            </div>
            <div>
              <label className="block text-base font-medium mb-1">ASN Date</label>
              <input type="date" value={header.asnDate} onChange={e => handleHeaderChange('asnDate', e.target.value)} className="border px-4 py-3 text-base w-full rounded" />
            </div>
            {/* Status is hidden and defaults to 'New' */}
            {/* Remarks is hidden */}
          </form>
          {/* Action Buttons - Above Save Button */}
          <div className="flex flex-col gap-2 mt-4" style={{ width: '100%' }}>
            <button
              type="button"
              className="bg-sky-500 text-white px-6 py-3 text-base rounded shadow font-semibold hover:bg-sky-600 active:bg-sky-700 active:scale-95 transition-all duration-100 w-full"
              onClick={() => {
                const today = new Date().toISOString().slice(0, 10);
                setRowData([...rowData, {
                  itemCode: '',
                  itemName: '',
                  description: '',
                  expectedQuantity: '',
                  receivedQuantity: '',
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
              className="text-white px-6 py-3 text-base rounded shadow font-semibold active:scale-95 transition-all duration-100 w-full"
              style={{ backgroundColor: '#008ecc' }}
              onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.9)'}
              onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
              onClick={() => {
                setRowData([]);
                setShowPalletGeneration(true);
              }}
            >Paste Values</button>
            <button
              type="button"
              className="text-white px-6 py-3 text-base rounded shadow font-semibold active:scale-95 transition-all duration-100 w-full"
              style={{ backgroundColor: '#008ecc' }}
              onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.9)'}
              onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
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
            >Delete Selected</button>
            <button
              type="button"
              className="text-white px-6 py-3 text-base rounded shadow font-semibold active:scale-95 transition-all duration-100 w-full"
              style={{ backgroundColor: '#008ecc' }}
              onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(0.9)'}
              onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
              onClick={() => {
                if (window.confirm('Are you sure you want to clear the entire form?')) {
                  setRowData([]);
                  setHeader({
                    asnNumber: '',
                    vendorCode: '',
                    vendorName: '',
                    poNumber: '',
                    asnDate: new Date().toISOString().split('T')[0],
                    status: 'New',
                    remarks: '',
                  });
                  setVendorSearchInput('');
                  setShowVendorDropdown(false);
                  setEntrySubmitStatus('');
                  // Hard refresh the page
                  window.location.reload();
                }
              }}
            >Clear Form</button>
          </div>
          {/* Save Button */}
          <button
            type="button"
            className="text-white px-6 py-3 text-base rounded shadow font-semibold w-full mt-3 active:scale-95 transition-all duration-100"
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
                            table: 'asn_lines',
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
                  receivedQuantity: '',
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

      {/* Record View Grids */}
      <div className="w-full bg-white rounded-lg border shadow p-6 flex flex-col gap-6 mt-8" style={{ width: '100%', minWidth: 0 }}>
        {/* Print Preview Modal */}
        {showPrintPreview && printHeaderId && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '1400px', maxHeight: '95vh', overflowY: 'auto' }}>
              {(() => {
                const header = headerRecords.find(h => h.id === printHeaderId);
                const lines = lineRecords.filter(l => l.asn_header_id === printHeaderId);
                
                if (!header) return <div>Header not found</div>;
                
                return (
                  <div className="flex flex-col">
                    {/* Header with Title */}
                    <div className="flex items-start justify-between mb-3 border-b pb-2 bg-white">
                      <div>
                        <h1 className="text-2xl font-bold mb-1 text-black">RECEIVING CHECKLIST</h1>
                        <p className="text-xs text-gray-800">Goods Receiving Document</p>
                      </div>
                    </div>

                    {/* Receipt Information */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mb-3 border-b pb-2 bg-white">
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">ASN Number</p>
                        <p className="text-sm font-bold text-black">{header.asn_number}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">ASN Date</p>
                        <p className="text-sm font-bold text-black">{new Date(header.asn_date).toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Status</p>
                        <p className="text-sm font-bold text-black">{header.status}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Vendor Code</p>
                        <p className="text-sm font-bold text-black">{header.vendor_code}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Vendor Name</p>
                        <p className="text-sm font-bold text-black">{header.vendor_name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">PO Number</p>
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
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Received Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Confirmed Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Batch #</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Mfg Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Expiry Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Pallet ID</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Item UOM</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Location</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.length > 0 ? (
                              lines.map((line, idx) => (
                                <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                  <td className="border border-gray-400 px-2 py-1 text-black">{line.item_code || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-black">{line.item_name || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.pallet_config || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.received_quantity || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.batch_number || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.manufacturing_date ? new Date(line.manufacturing_date).toLocaleDateString() : ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.expiry_date ? new Date(line.expiry_date).toLocaleDateString() : ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.pallet_id || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.item_uom || ''}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black"></td>
                                </tr>
                              ))
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
                        <p className="text-xs font-semibold uppercase">Received By</p>
                      </div>
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-1 mb-1" style={{ width: '100%', height: '40px' }}></div>
                        <p className="text-xs font-semibold uppercase">Verified By</p>
                      </div>
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-1 mb-1" style={{ width: '100%', height: '40px' }}></div>
                        <p className="text-xs font-semibold uppercase">Approved By</p>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-8 text-center text-xs text-gray-800 border-t pt-4">
                      <p>This is an official Receiving Checklist. Please retain for your records.</p>
                      <p>Printed on: {new Date().toLocaleString()}</p>
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-6 flex gap-3 justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          // Open new window for printing only the content
                          const printWindow = window.open('', '_blank');
                          if (printWindow) {
                            const htmlContent = `
                              <!DOCTYPE html>
                              <html>
                              <head>
                                <meta charset="UTF-8">
                                <title>RECEIVING CHECKLIST - ${header.asn_number}</title>
                                <style>
                                  body { font-family: Arial, sans-serif; margin: 20px; }
                                  h1 { font-size: 24px; margin-bottom: 10px; }
                                  .header-info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; border-bottom: 1px solid #ccc; padding-bottom: 15px; }
                                  .header-field { }
                                  .header-field .label { font-size: 11px; font-weight: bold; text-transform: uppercase; color: #666; }
                                  .header-field .value { font-size: 14px; font-weight: bold; color: #000; }
                                  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                                  th, td { border: 1px solid #999; padding: 8px; text-align: left; font-size: 12px; }
                                  th { background-color: #ddd; font-weight: bold; }
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
                                  <h1>RECEIVING CHECKLIST</h1>
                                  <p style="font-size: 12px; color: #666;">Goods Receiving Document</p>
                                  
                                  <div class="header-info">
                                    <div class="header-field">
                                      <div class="label">ASN Number</div>
                                      <div class="value">${header.asn_number}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">ASN Date</div>
                                      <div class="value">${new Date(header.asn_date).toLocaleDateString()}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Status</div>
                                      <div class="value">${header.status}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Vendor Code</div>
                                      <div class="value">${header.vendor_code}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Vendor Name</div>
                                      <div class="value">${header.vendor_name}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">PO Number</div>
                                      <div class="value">${header.po_number}</div>
                                    </div>
                                  </div>
                                  
                                  <h3 style="font-size: 16px; margin-top: 20px; margin-bottom: 15px; text-transform: uppercase; font-weight: bold;">Received Items</h3>
                                  <table>
                                    <thead>
                                      <tr>
                                        <th>Item Code</th>
                                        <th>Item Name</th>
                                        <th>Received Qty</th>
                                        <th>Confirmed Qty</th>
                                        <th>Batch #</th>
                                        <th>Mfg Date</th>
                                        <th>Expiry Date</th>
                                        <th>Pallet ID</th>
                                        <th>Item UOM</th>
                                        <th>Location</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      ${lines.length > 0 ? lines.map(line => `
                                        <tr>
                                          <td>${line.item_code || ''}</td>
                                          <td>${line.item_name || ''}</td>
                                          <td>${line.pallet_config || ''}</td>
                                          <td>${line.received_quantity || ''}</td>
                                          <td>${line.batch_number || ''}</td>
                                          <td>${line.manufacturing_date ? new Date(line.manufacturing_date).toLocaleDateString() : ''}</td>
                                          <td>${line.expiry_date ? new Date(line.expiry_date).toLocaleDateString() : ''}</td>
                                          <td>${line.pallet_id || ''}</td>
                                          <td>${line.item_uom || ''}</td>
                                          <td></td>
                                        </tr>
                                      `).join('') : '<tr><td colspan="10" style="text-align: center;">No items found</td></tr>'}
                                    </tbody>
                                  </table>
                                  
                                  <div class="signature-section">
                                    <div class="signature-line">
                                      <div class="line"></div>
                                      <div class="label">Received By</div>
                                    </div>
                                    <div class="signature-line">
                                      <div class="line"></div>
                                      <div class="label">Verified By</div>
                                    </div>
                                    <div class="signature-line">
                                      <div class="line"></div>
                                      <div class="label">Approved By</div>
                                    </div>
                                  </div>
                                  
                                  <div class="footer">
                                    <p>This is an official Receiving Checklist. Please retain for your records.</p>
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
                        onClick={() => setShowPrintPreview(false)}
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
        
        {/* Receiving Confirmation Modal */}
        {showReceivingConfirmation && receivingConfirmationHeaderId && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '1400px', maxHeight: '95vh', overflowY: 'auto' }}>
              {(() => {
                const header = headerRecords.find(h => h.id === receivingConfirmationHeaderId);
                const lines = lineRecords.filter(l => l.asn_header_id === receivingConfirmationHeaderId);
                
                if (!header) return <div>Header not found</div>;
                
                // Group lines by item_code and sum quantities
                const groupedLines = lines.reduce((acc: any[], line: any) => {
                  const existingItem = acc.find((item: any) => item.item_code === line.item_code);
                  if (existingItem) {
                    existingItem.expected_quantity = (Number(existingItem.expected_quantity) || 0) + (Number(line.expected_quantity) || 0);
                    existingItem.received_quantity = (Number(existingItem.received_quantity) || 0) + (Number(line.received_quantity) || 0);
                    existingItem.pallet_config = (Number(existingItem.pallet_config) || 0) + (Number(line.pallet_config) || 0);
                  } else {
                    acc.push({ ...line });
                  }
                  return acc;
                }, []);
                
                // Calculate totals
                const totalExpectedQty = groupedLines.reduce((sum: number, line: any) => sum + (Number(line.expected_quantity) || 0), 0);
                const totalReceivedQty = groupedLines.reduce((sum: number, line: any) => sum + (Number(line.received_quantity) || 0), 0);
                const totalPalletConfig = groupedLines.reduce((sum: number, line: any) => sum + (Number(line.pallet_config) || 0), 0);
                
                return (
                  <div className="flex flex-col">
                    {/* Header with Title */}
                    <div className="flex items-start justify-between mb-3 border-b pb-2">
                      <div>
                        <h1 className="text-2xl font-bold mb-1 text-black">RECEIVING CONFIRMATION</h1>
                        <p className="text-xs text-gray-800">Goods Receiving Summary</p>
                      </div>
                    </div>

                    {/* Receipt Information Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mb-3 pb-2 border-b bg-white">
                      <div>
                        <p className="text-xs text-gray-800 font-semibold">ASN Number</p>
                        <p className="text-sm font-bold text-black">{header.asn_number}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 font-semibold">ASN Date</p>
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
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Received Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Confirmed Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Item UOM</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Batch #</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Mfg Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Expiry Date</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Received Qty (ASN)</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">ASN UOM</th>
                            </tr>
                          </thead>
                          <tbody>
                            {groupedLines.length > 0 ? (
                              groupedLines.map((line: any, idx: number) => {
                                // Calculate Received Qty (Not Converted) = Received_converted × (ASN_QTY / pallet_config)
                                const conversionFactor = (Number(line.expected_quantity) || 0) / (Number(line.pallet_config) || 1);
                                const receivedNotConverted = (Number(line.received_quantity) || 0) * conversionFactor;
                                // Calculate Confirmed Qty (ASN) = Expected Qty / Pallet Config
                                const confirmedQtyAsn = (Number(line.expected_quantity) || 0) / (Number(line.pallet_config) || 1);
                                return (
                                  <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    <td className="border border-gray-400 px-2 py-1 text-black">{line.item_code || ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-black">{line.item_name || ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.pallet_config || ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.pallet_config || ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.item_uom || ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.batch_number || ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.manufacturing_date ? new Date(line.manufacturing_date).toLocaleDateString() : ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.expiry_date ? new Date(line.expiry_date).toLocaleDateString() : ''}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center font-semibold text-black">{line.expected_quantity || '0'}</td>
                                    <td className="border border-gray-400 px-2 py-1 text-center font-semibold text-blue-900">{line.asn_uom || line.item_uom || ''}</td>
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
                            {/* Totals Row */}
                            {groupedLines.length > 0 && (
                              <tr className="bg-gray-300 font-bold">
                                <td colSpan={2} className="border border-gray-400 px-2 py-1 text-right text-black">TOTALS:</td>
                                <td className="border border-gray-400 px-2 py-1 text-center text-black">{totalPalletConfig}</td>
                                <td className="border border-gray-400 px-2 py-1 text-center text-black">{totalPalletConfig}</td>
                                <td className="border border-gray-400 px-2 py-1"></td>
                                <td className="border border-gray-400 px-2 py-1"></td>
                                <td className="border border-gray-400 px-2 py-1"></td>
                                <td className="border border-gray-400 px-2 py-1"></td>
                                <td className="border border-gray-400 px-2 py-1 text-center text-black">{totalExpectedQty}</td>
                                <td className="border border-gray-400 px-2 py-1"></td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-6 flex gap-3 justify-center">
                      <button
                        type="button"
                        onClick={() => {
                          // Open new window for printing only the content
                          const printWindow = window.open('', '_blank');
                          if (printWindow) {
                            const htmlContent = `
                              <!DOCTYPE html>
                              <html>
                              <head>
                                <meta charset="UTF-8">
                                <title>RECEIVING CONFIRMATION - ${header.asn_number}</title>
                                <style>
                                  body { font-family: Arial, sans-serif; margin: 20px; }
                                  h1 { font-size: 24px; margin-bottom: 10px; }
                                  .header-info { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px; border-bottom: 1px solid #ccc; padding-bottom: 15px; }
                                  .header-field { }
                                  .header-field .label { font-size: 11px; font-weight: bold; color: #666; }
                                  .header-field .value { font-size: 14px; font-weight: bold; color: #000; }
                                  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                                  th, td { border: 1px solid #999; padding: 8px; text-align: left; font-size: 12px; }
                                  th { background-color: #ddd; font-weight: bold; }
                                  tr:nth-child(even) { background-color: #f9f9f9; }
                                  .totals-row { background-color: #ddd; font-weight: bold; }
                                  @media print { body { margin: 0; } }
                                </style>
                              </head>
                              <body>
                                <div>
                                  <h1>RECEIVING CONFIRMATION</h1>
                                  <p style="font-size: 12px; color: #666;">Goods Receiving Summary</p>
                                  
                                  <div class="header-info">
                                    <div class="header-field">
                                      <div class="label">ASN Number</div>
                                      <div class="value">${header.asn_number}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">ASN Date</div>
                                      <div class="value">${new Date(header.asn_date).toLocaleDateString()}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Status</div>
                                      <div class="value">${header.status}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Vendor Code</div>
                                      <div class="value">${header.vendor_code}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">Vendor Name</div>
                                      <div class="value">${header.vendor_name}</div>
                                    </div>
                                    <div class="header-field">
                                      <div class="label">PO Number</div>
                                      <div class="value">${header.po_number}</div>
                                    </div>
                                  </div>
                                  
                                  <h3 style="font-size: 16px; margin-top: 20px; margin-bottom: 15px; text-transform: uppercase; font-weight: bold;">Received Items</h3>
                                  <table>
                                    <thead>
                                      <tr style="background-color: #ddd;">
                                        <th>Item Code</th>
                                        <th>Item Name</th>
                                        <th>Received Qty</th>
                                        <th>Confirmed Qty</th>
                                        <th>Item UOM</th>
                                        <th>Batch #</th>
                                        <th>Mfg Date</th>
                                        <th>Expiry Date</th>
                                        <th>Received Qty (ASN)</th>
                                        <th>ASN UOM</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      ${groupedLines.length > 0 ? groupedLines.map((line: any) => `
                                        <tr>
                                          <td>${line.item_code || ''}</td>
                                          <td>${line.item_name || ''}</td>
                                          <td>${line.pallet_config || ''}</td>
                                          <td>${line.pallet_config || ''}</td>
                                          <td>${line.item_uom || ''}</td>
                                          <td>${line.batch_number || ''}</td>
                                          <td>${line.manufacturing_date ? new Date(line.manufacturing_date).toLocaleDateString() : ''}</td>
                                          <td>${line.expiry_date ? new Date(line.expiry_date).toLocaleDateString() : ''}</td>
                                          <td>${line.expected_quantity || '0'}</td>
                                          <td>${line.asn_uom || line.item_uom || ''}</td>
                                        </tr>
                                      `).join('') : '<tr><td colspan="10" style="text-align: center;">No items found</td></tr>'}
                                      <tr class="totals-row">
                                        <td colspan="2" style="text-align: right;">TOTALS:</td>
                                        <td>${totalPalletConfig}</td>
                                        <td>${totalPalletConfig}</td>
                                        <td></td>
                                        <td></td>
                                        <td></td>
                                        <td></td>
                                        <td>${totalExpectedQty}</td>
                                        <td></td>
                                      </tr>
                                    </tbody>
                                  </table>
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
        
        {/* Pallet Tag Modal - All Tags for Selected ASN - Print Friendly */}
        {showPalletTag && palletTagHeaderId && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 p-4" style={{ overflow: 'auto' }}>
            <div className="bg-white rounded-lg shadow-lg" style={{ width: '950px' }}>
              {/* Tags Container - Print Friendly Layout */}
              <div style={{ width: '950px' }}>
                {(() => {
                  const header = headerRecords.find(h => h.id === palletTagHeaderId);
                  const asnLines = lineRecords.filter(l => l.asn_header_id === palletTagHeaderId);
                  
                  console.log('📋 Pallet Tag Modal - Header ID:', palletTagHeaderId);
                  console.log('📋 Found header:', header?.asn_number);
                  console.log('📋 Total ASN lines:', asnLines.length);
                  console.log('📋 All lines:', asnLines.map(l => ({ id: l.id, item_code: l.item_code, pallet_id: l.pallet_id, batch: l.batch_number })));
                  
                  if (!header) return <div className="p-8 text-red-500 text-center">Header not found</div>;
                  if (asnLines.length === 0) return <div className="p-8 text-red-500 text-center">No lines found for this ASN</div>;
                  
                  console.log('📋 Generating tags for all pallet lines:', asnLines.length);
                  
                  return (
                    <>
                      {asnLines.map((line, lineIdx) => {
                        // Use the pallet_id from the line (generated when pallets were created)
                        const palletId = line.pallet_id || `PAL-${header.id}-${line.id}`;
                        
                        console.log(`📦 Pallet Tag ${lineIdx}:`, { item_code: line.item_code, pallet_id: palletId });
                        
                        return (
                          <div key={lineIdx} style={{ width: '950px', height: '420px', pageBreakAfter: 'avoid' }} className="flex border-b-4 border-gray-300">
                            {/* LEFT SIDE - QR CODE (40%) */}
                            <div className="flex flex-col items-center justify-center w-2/5 border-r-4 border-gray-300 px-6 py-4">
                              <div style={{ transform: 'scale(1.6)', transformOrigin: 'center' }}>
                                <ASNBarcode value={palletId} />
                              </div>
                            </div>
                            
                            {/* RIGHT SIDE - DETAILS (60%) */}
                            <div className="flex flex-col justify-start w-3/5 px-6 py-4">
                              {/* BATCH # - LARGEST */}
                              {line.batch_number && (
                                <div className="mb-3">
                                  <p className="text-xs text-gray-600 font-semibold mb-0.5 tracking-wide">BATCH #</p>
                                  <p className="text-5xl font-bold text-black leading-tight">{line.batch_number}</p>
                                </div>
                              )}
                              
                              {/* Item Information - Two Columns */}
                              <div className="grid grid-cols-2 gap-2 mb-3">
                                <div>
                                  <p className="text-xs text-gray-600 font-semibold mb-0.5 tracking-wide">ITEM CODE</p>
                                  <p className="text-lg font-bold text-black">{line.item_code}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-600 font-semibold mb-0.5 tracking-wide">ITEM NAME</p>
                                  <p className="text-sm font-bold text-black">{line.item_name}</p>
                                </div>
                              </div>
                              
                              {/* Dates - Two Columns */}
                              <div className="grid grid-cols-2 gap-2 mb-2 pb-2 border-b border-gray-300">
                                <div>
                                  <p className="text-xs text-gray-600 font-semibold mb-0.5 tracking-wide">MFG DATE</p>
                                  <p className="text-sm font-bold text-black">{line.manufacturing_date ? new Date(line.manufacturing_date).toLocaleDateString() : 'N/A'}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-600 font-semibold mb-0.5 tracking-wide">EXP DATE</p>
                                  <p className="text-sm font-bold text-black">{line.expiry_date ? new Date(line.expiry_date).toLocaleDateString() : 'N/A'}</p>
                                </div>
                              </div>
                              
                              {/* Vendor and Received Date - Two Columns */}
                              <div className="grid grid-cols-2 gap-2 mb-2 pb-2 border-b border-gray-300">
                                <div>
                                  <p className="text-xs text-gray-600 font-semibold mb-0.5 tracking-wide">VENDOR</p>
                                  <p className="text-sm font-bold text-black">{header.vendor_name}</p>
                                  <p className="text-xs text-gray-700 font-semibold">{header.vendor_code}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-600 font-semibold mb-0.5 tracking-wide">RECEIVED DATE</p>
                                  <p className="text-sm font-bold text-blue-900">{header.asn_date ? new Date(header.asn_date).toLocaleDateString() : 'N/A'}</p>
                                </div>
                              </div>
                              
                              {/* PO Number */}
                              <div>
                                <p className="text-xs text-gray-600 font-semibold mb-0.5 tracking-wide">PO NUMBER</p>
                                <p className="text-lg font-bold text-black">{header.po_number}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
              
              {/* Action Buttons */}
              <div className="flex gap-4 justify-center py-3 border-t-2 border-gray-300 bg-gray-50" style={{ width: '950px' }}>
                <button
                  type="button"
                  onClick={() => {
                    // Open new window for printing only the pallet tags content
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                      const header = headerRecords.find(h => h.id === palletTagHeaderId);
                      const asnLines = lineRecords.filter(l => l.asn_header_id === palletTagHeaderId);
                      
                      let tagsHtml = '';
                      asnLines.forEach((line) => {
                        const palletId = line.pallet_id || `PAL-${header.id}-${line.id}`;
                        
                        // Generate QR code URL using API
                        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(palletId)}`;
                        
                        tagsHtml += `
                          <div style="width: 100%; height: 420px; display: flex; border-bottom: 4px solid #ccc; page-break-after: avoid; break-after: avoid; page-break-inside: avoid;">
                            <!-- LEFT SIDE - QR CODE -->
                            <div style="width: 40%; border-right: 4px solid #ccc; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px;">
                              <img src="${qrCodeUrl}" alt="QR Code" style="width: 180px; height: 180px; margin-bottom: 10px;">
                              <p style="font-size: 11px; font-family: monospace; font-weight: bold; margin: 0; text-align: center;">${palletId}</p>
                            </div>
                            
                            <!-- RIGHT SIDE - DETAILS -->
                            <div style="width: 60%; padding: 20px; display: flex; flex-direction: column; justify-content: flex-start;">
                              ${line.batch_number ? `
                                <div style="margin-bottom: 20px;">
                                  <p style="font-size: 11px; color: #666; font-weight: bold; margin-bottom: 5px; letter-spacing: 1px;">BATCH #</p>
                                  <p style="font-size: 48px; font-weight: bold; color: #000; margin: 0; line-height: 1;">${line.batch_number}</p>
                                </div>
                              ` : ''}
                              
                              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">
                                <div>
                                  <p style="font-size: 11px; color: #666; font-weight: bold; margin-bottom: 5px; letter-spacing: 1px;">ITEM CODE</p>
                                  <p style="font-size: 16px; font-weight: bold; color: #000; margin: 0;">${line.item_code}</p>
                                </div>
                                <div>
                                  <p style="font-size: 11px; color: #666; font-weight: bold; margin-bottom: 5px; letter-spacing: 1px;">ITEM NAME</p>
                                  <p style="font-size: 13px; font-weight: bold; color: #000; margin: 0;">${line.item_name}</p>
                                </div>
                              </div>
                              
                              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #ccc;">
                                <div>
                                  <p style="font-size: 11px; color: #666; font-weight: bold; margin-bottom: 5px; letter-spacing: 1px;">MFG DATE</p>
                                  <p style="font-size: 13px; font-weight: bold; color: #000; margin: 0;">${line.manufacturing_date ? new Date(line.manufacturing_date).toLocaleDateString() : 'N/A'}</p>
                                </div>
                                <div>
                                  <p style="font-size: 11px; color: #666; font-weight: bold; margin-bottom: 5px; letter-spacing: 1px;">EXP DATE</p>
                                  <p style="font-size: 13px; font-weight: bold; color: #000; margin: 0;">${line.expiry_date ? new Date(line.expiry_date).toLocaleDateString() : 'N/A'}</p>
                                </div>
                              </div>
                              
                              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #ccc;">
                                <div>
                                  <p style="font-size: 11px; color: #666; font-weight: bold; margin-bottom: 5px; letter-spacing: 1px;">VENDOR</p>
                                  <p style="font-size: 13px; font-weight: bold; color: #000; margin: 0;">${header.vendor_name}</p>
                                  <p style="font-size: 11px; color: #333; font-weight: bold; margin: 0;">${header.vendor_code}</p>
                                </div>
                                <div>
                                  <p style="font-size: 11px; color: #666; font-weight: bold; margin-bottom: 5px; letter-spacing: 1px;">RECEIVED DATE</p>
                                  <p style="font-size: 13px; font-weight: bold; color: #003366; margin: 0;">${header.asn_date ? new Date(header.asn_date).toLocaleDateString() : 'N/A'}</p>
                                </div>
                              </div>
                              
                              <div>
                                <p style="font-size: 11px; color: #666; font-weight: bold; margin-bottom: 5px; letter-spacing: 1px;">PO NUMBER</p>
                                <p style="font-size: 16px; font-weight: bold; color: #000; margin: 0;">${header.po_number}</p>
                              </div>
                            </div>
                          </div>
                        `;
                      });

                      const htmlContent = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                          <meta charset="UTF-8">
                          <title>PALLET TAGS - ${header.asn_number}</title>
                          <style>
                            @page { 
                              size: A4 portrait;
                              margin: 0;
                              padding: 0;
                            }
                            body { 
                              margin: 0; 
                              padding: 0; 
                              font-family: Arial, sans-serif;
                              width: 100%;
                              height: 100%;
                            }
                            @media print { 
                              body { margin: 0; padding: 0; }
                              .tag { page-break-after: always; break-after: always; page-break-inside: avoid; break-inside: avoid; }
                            }
                          </style>
                        </head>
                        <body>
                          ${tagsHtml}
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
                  className="p-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition"
                  title="Print"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4H9a2 2 0 00-2 2v2a2 2 0 002 2h10a2 2 0 002-2v-2a2 2 0 00-2-2h-2m-4-4V9m0 4v6m0-6H7m10 0h2" />
                  </svg>
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    const header = headerRecords.find(h => h.id === palletTagHeaderId);
                    if (header) {
                      setShowAsnItemsPreview(true);
                    }
                  }}
                  className="p-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                  title="View ASN Items"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    setShowPalletTag(false);
                    setPalletTagLineId(null);
                    setShowAsnItemsPreview(false);
                  }}
                  className="p-2 bg-gray-400 text-white rounded hover:bg-gray-500 transition"
                  title="Close"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* ASN Items Preview Modal */}
        {showAsnItemsPreview && palletTagHeaderId && (
          <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50 overflow-auto">
            <div className="bg-white rounded-lg shadow-lg p-8 my-8 w-full max-w-4xl max-h-96 overflow-y-auto">
              {(() => {
                const header = headerRecords.find(h => h.id === palletTagHeaderId);
                const asnLines = lineRecords.filter(l => l.asn_header_id === palletTagHeaderId);
                
                if (!header) return <div className="text-center text-red-500">Header not found</div>;
                
                return (
                  <div>
                    {/* Header Info */}
                    <div className="mb-6 pb-4 border-b-2 border-gray-300">
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                          <p className="text-xs text-gray-600 font-semibold tracking-wide">ASN NUMBER</p>
                          <p className="text-xl font-bold text-black">{header.asn_number}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600 font-semibold tracking-wide">VENDOR</p>
                          <p className="text-lg font-bold text-black">{header.vendor_name}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600 font-semibold tracking-wide">TOTAL ITEMS</p>
                          <p className="text-lg font-bold text-blue-600">{asnLines.length}</p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Items Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-100 border-b-2 border-gray-300">
                          <tr>
                            <th className="px-4 py-3 text-left font-bold text-gray-700">Item Code</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700">Item Name</th>
                            <th className="px-4 py-3 text-center font-bold text-gray-700">Expected Qty</th>
                            <th className="px-4 py-3 text-center font-bold text-gray-700">Received Qty</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700">Batch #</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700">Pallet ID</th>
                            <th className="px-4 py-3 text-left font-bold text-gray-700">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {asnLines.map((line, idx) => (
                            <tr key={line.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                              <td className="px-4 py-3 font-semibold text-gray-900">{line.item_code}</td>
                              <td className="px-4 py-3 text-gray-700">{line.item_name}</td>
                              <td className="px-4 py-3 text-center font-bold text-gray-900">{line.expected_quantity}</td>
                              <td className="px-4 py-3 text-center font-bold text-blue-600">{line.received_quantity || 0}</td>
                              <td className="px-4 py-3 font-mono text-gray-900">{line.batch_number || '-'}</td>
                              <td className="px-4 py-3 font-mono text-blue-900 font-bold">{line.pallet_id || '-'}</td>
                              <td className="px-4 py-3">
                                {line.putaway_marked === 'Putaway' && (
                                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-bold">✓ Putaway</span>
                                )}
                                {line.putaway_marked === 'Splitted' && (
                                  <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">✓ Splitted</span>
                                )}
                                {!line.putaway_marked && (
                                  <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-bold">Pending</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    
                    {/* Close Button */}
                    <div className="mt-6 flex justify-center">
                      <button
                        type="button"
                        onClick={() => setShowAsnItemsPreview(false)}
                        className="px-6 py-2 bg-gray-400 text-white rounded font-bold hover:bg-gray-500 transition"
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
                  
                  if (!header || !line) throw new Error('ASN header or line not found');
                  
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
                    
                    // Mark line as completed in database with 'Splitted' status
                    if (line.id) {
                      console.log('💾 Saving split putaway - Line ID:', line.id, 'Setting putaway_marked to: Splitted');
                      
                      await fetch('/api/patch-record', {
                        method: 'PATCH',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          table: 'asn_lines',
                          id: line.id,
                          data: { putaway_marked: 'Splitted' },
                        }),
                      }).catch(err => console.error('Error marking line as putaway:', err));
                      
                      // ✅ UPDATE INVENTORY STATUS TO 'PUTAWAY'
                      console.log('🔄 Updating inventory status to putaway for pallet:', line.pallet_id);
                      try {
                        // Step 1: Fetch inventory record to get its ID
                        const invCheckRes = await fetch(
                          `/api/inventory-sync?item_id=${line.item_id}&pallet_id=${line.pallet_id}&warehouse_id=${header.warehouse_id || parseInt(warehouseFilter || '1')}`
                        );
                        
                        if (invCheckRes.ok) {
                          const invRecords = await invCheckRes.json();
                          console.log('📊 Found inventory records:', invRecords, 'Count:', invRecords.length);
                          
                          if (!Array.isArray(invRecords) || invRecords.length === 0) {
                            console.warn('⚠️ No inventory records found for pallet:', line.pallet_id);
                          }
                          
                          // Update each inventory record found
                          for (const invRec of invRecords) {
                            if (invRec && invRec.id) {
                              console.log(`💾 Updating inventory ID ${invRec.id} status to putaway. Current status: ${invRec.inventory_status}`);
                              const patchRes = await fetch('/api/patch-record', {
                                method: 'PATCH',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                  table: 'inventory',
                                  id: invRec.id,
                                  data: { inventory_status: 'putaway' },
                                }),
                              });
                              
                              const patchText = await patchRes.text();
                              console.log(`📝 PATCH response status: ${patchRes.status}, text:`, patchText);
                              
                              if (patchRes.ok) {
                                console.log(`✅ Inventory ID ${invRec.id} status updated to putaway`);
                              } else {
                                console.error(`❌ PATCH failed for inventory ID ${invRec.id}:`, patchText);
                              }
                            } else {
                              console.warn('⚠️ Invalid inventory record, missing ID:', invRec);
                            }
                          }
                        } else {
                          const errText = await invCheckRes.text();
                          console.warn('⚠️ Could not fetch inventory record to update status. Status:', invCheckRes.status, 'Error:', errText);
                        }
                      } catch (err) {
                        console.error('❌ Error updating inventory status:', err);
                      }
                      
                      // Update local state to reflect the change
                      setFilteredRecordLines(prev => {
                        const updated = prev.map(l => 
                          l.id === line.id 
                            ? { ...l, putaway_marked: 'Splitted', putawayMarked: 'Splitted', putawayStatusText: 'Splitted' }
                            : l
                        );
                        console.log('🔄 Updated filteredRecordLines - Line ID:', line.id, 'New data:', updated.find(x => x.id === line.id));
                        return updated;
                      });
                      
                      // Also update lineRecords for consistency
                      setLineRecords(prev => prev.map(l => 
                        l.id === line.id 
                          ? { ...l, putaway_marked: 'Splitted' }
                          : l
                      ));
                      
                      // Also update client-side state for consistency
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
                    setGatepassNumber(result.gpNumber);
                  } else {
                    // Normal single putaway
                    if (!putawayLocation) {
                      throw new Error('Please select a location');
                    }
                    
                    const quantity = Number(line.received_quantity || line.receivedQuantity || 0);
                    
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
                    
                    // Mark line as completed in database with 'Done' status
                    if (line.id) {
                      console.log('💾 Saving single putaway - Line ID:', line.id, 'Setting putaway_marked to: Done');
                      
                      await fetch('/api/patch-record', {
                        method: 'PATCH',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          table: 'asn_lines',
                          id: line.id,
                          data: { putaway_marked: 'Done' },
                        }),
                      }).catch(err => console.error('Error marking line as putaway:', err));
                      
                      // ✅ UPDATE INVENTORY STATUS TO 'PUTAWAY'
                      console.log('🔄 Updating inventory status to putaway for pallet:', line.pallet_id, 'item_id:', line.item_id);
                      try {
                        // Step 1: Fetch inventory record by pallet_id + item_id + warehouse_id (MUST match all 3 to get correct record)
                        const invSyncUrl = `/api/inventory-sync?pallet_id=${line.pallet_id}&item_id=${line.item_id}&warehouse_id=${header.warehouse_id || parseInt(warehouseFilter || '1')}`;
                        console.log('🔗 inventory-sync URL:', invSyncUrl);
                        const invCheckRes = await fetch(invSyncUrl);
                        console.log(`📡 inventory-sync response status: ${invCheckRes.status}, ok: ${invCheckRes.ok}`);
                        
                        const invText = await invCheckRes.text();
                        console.log(`📄 inventory-sync response body:`, invText);
                        
                        if (invCheckRes.ok && invText) {
                          const invRecords = JSON.parse(invText);
                          console.log('📊 Found inventory records:', invRecords, 'Count:', Array.isArray(invRecords) ? invRecords.length : 'N/A');
                          
                          if (!Array.isArray(invRecords) || invRecords.length === 0) {
                            console.warn('⚠️ No inventory records found for pallet:', line.pallet_id);
                          }
                          
                          // Update each inventory record found
                          for (const invRec of invRecords) {
                            if (invRec && invRec.id) {
                              console.log(`💾 Updating inventory ID ${invRec.id} status to putaway. Current status: ${invRec.inventory_status}`);
                              const patchRes = await fetch('/api/patch-record', {
                                method: 'PATCH',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                  table: 'inventory',
                                  id: invRec.id,
                                  data: { inventory_status: 'putaway' },
                                }),
                              });
                              
                              const patchText = await patchRes.text();
                              console.log(`📝 PATCH response status: ${patchRes.status}, text:`, patchText);
                              
                              if (patchRes.ok) {
                                console.log(`✅ Inventory ID ${invRec.id} status updated to putaway`);
                              } else {
                                console.error(`❌ PATCH failed for inventory ID ${invRec.id}:`, patchText);
                              }
                            } else {
                              console.warn('⚠️ Invalid inventory record, missing ID:', invRec);
                            }
                          }
                        } else {
                          const errText = await invCheckRes.text();
                          console.warn('⚠️ Could not fetch inventory record. Status:', invCheckRes.status, 'Response:', errText);
                        }
                      } catch (err) {
                        console.error('❌ Error updating inventory status:', err);
                      }
                      
                      // Update local state to reflect the change
                      setFilteredRecordLines(prev => {
                        const updated = prev.map(l => 
                          l.id === line.id 
                            ? { ...l, putaway_marked: 'Done', putawayMarked: 'Done', putawayStatusText: 'Done' }
                            : l
                        );
                        console.log('🔄 Updated filteredRecordLines - Line ID:', line.id, 'New data:', updated.find(x => x.id === line.id));
                        return updated;
                      });
                      
                      // Also update lineRecords for consistency
                      setLineRecords(prev => prev.map(l => 
                        l.id === line.id 
                          ? { ...l, putaway_marked: 'Done' }
                          : l
                      ));
                      
                      // Also update client-side state for consistency
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
                    setGatepassNumber(result.gpNumber);
                  }
                  
                  setShowPutawayConfirmation(true);
                  
                  // Clear inventory cache after successful putaway
                  const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
                  await fetch(`/api/inventory-records`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ year, action: 'clear' }),
                  }).catch(err => console.log('Note: Inventory cache clear request sent'));
                  
                  // Close putaway modal and reset
                  setShowPutawayModal(false);
                  setPutawayHeaderId(null);
                  setPutawayLineId(null);
                  setPutawayLocation('');
                  setPutawayQuantity('');
                  setIsSplitMode(false);
                  setSplitRecords([
                    { id: '1', reason: 'good', quantity: '', location: '', locationSearch: '' },
                    { id: '2', reason: 'damage', quantity: '', location: '', locationSearch: '' },
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
                      
                      {/* Autocomplete Location Dropdown */}
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Search or select location..."
                          value={putawayLocationSearch}
                          onChange={(e) => {
                            setPutawayLocationSearch(e.target.value);
                            setShowPutawayLocationDropdown(true);
                          }}
                          onFocus={() => setShowPutawayLocationDropdown(true)}
                          className="w-full border border-gray-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                        
                        {/* Dropdown List */}
                        {showPutawayLocationDropdown && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
                            {locationOptions && locationOptions.length > 0 ? (
                              locationOptions
                                .filter(loc => loc.name.toLowerCase().includes(putawayLocationSearch.toLowerCase()))
                                .map(loc => (
                                  <div
                                    key={loc.id}
                                    onClick={() => {
                                      setPutawayLocation(loc.id);
                                      setPutawayLocationSearch(loc.name);
                                      setShowPutawayLocationDropdown(false);
                                    }}
                                    className="px-4 py-2.5 hover:bg-blue-100 cursor-pointer text-sm border-b last:border-b-0"
                                  >
                                    {loc.name}
                                  </div>
                                ))
                            ) : (
                              <div className="px-4 py-2.5 text-sm text-gray-500">No locations available</div>
                            )}
                          </div>
                        )}
                      </div>
                      
                      {putawayLocation && (
                        <p className="text-xs text-green-600 mt-1">✓ Location selected: {putawayLocationSearch}</p>
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
                            setSplitRecords([...splitRecords, { id: newId, reason: 'damage', quantity: '', location: '', locationSearch: '' }]);
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
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="Search or select location..."
                                value={record.locationSearch || ''}
                                onChange={(e) => {
                                  const updated = [...splitRecords];
                                  updated[index].locationSearch = e.target.value;
                                  setSplitRecords(updated);
                                }}
                                onFocus={() => {
                                  const updated = [...splitRecords];
                                  updated[index].locationSearch = record.locationSearch || '';
                                  setSplitRecords(updated);
                                }}
                                className="w-full border border-gray-300 px-3 py-1.5 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              
                              {/* Dropdown List */}
                              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded shadow-lg max-h-40 overflow-y-auto z-50">
                                {locationOptions && locationOptions.length > 0 ? (
                                  locationOptions
                                    .filter(loc => loc.name.toLowerCase().includes((record.locationSearch || '').toLowerCase()))
                                    .map(loc => (
                                      <div
                                        key={loc.id}
                                        onClick={() => {
                                          const updated = [...splitRecords];
                                          updated[index].location = loc.id;
                                          updated[index].locationSearch = loc.name;
                                          setSplitRecords(updated);
                                        }}
                                        className="px-3 py-1.5 hover:bg-blue-100 cursor-pointer text-xs border-b last:border-b-0"
                                      >
                                        {loc.name}
                                      </div>
                                    ))
                                ) : (
                                  <div className="px-3 py-1.5 text-xs text-gray-500">No locations</div>
                                )}
                              </div>
                            </div>
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
                            <p className="font-bold text-gray-900">{locationOptions.find(l => l.id === Number(record.location))?.name || `LOC-${record.location}`}</p>
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
                      <p className="text-sm font-bold">{locationOptions.find(l => l.id === Number(putawayConfirmationData.location))?.name || `LOC-${putawayConfirmationData.location}`}</p>
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
                </div>
              )}

              <div className="flex gap-3">
                <button 
                  type="button" 
                  className="w-full px-4 py-2.5 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400 transition" 
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
              <h3 className="text-xl font-bold mb-6">Generate Multiple Pallets</h3>
              <p className="text-sm text-gray-600 mb-4">Paste tab-separated data from Excel. Format: Item Code | Item Name | Description | Expected Qty | ASN UOM</p>
              <p className="text-xs text-gray-500 mb-4">Weight and Pallet Config will be auto-fetched from Item Master based on Item Code</p>
              
              {palletGenError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                  {palletGenError}
                </div>
              )}

              <textarea
                className="w-full border-2 border-gray-300 px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm font-mono"
                placeholder="Paste here (Ctrl+V)...&#10;Example:&#10;MC9119&#9;Takis Intense&#9;Snack&#9;200&#9;BOX"
                value={palletPasteData}
                onChange={e => setPalletPasteData(e.target.value)}
                rows={8}
              />
              
              <p className="text-xs text-gray-500 mt-2">Pallet count will be calculated as: Qty ÷ (Weight from Item Master × Pallet Config from Item Master)</p>

              <div className="flex gap-3 mt-6">
                <button 
                  type="button" 
                  className="flex-1 px-4 py-2.5 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition"
                  onClick={() => {
                    if (!palletPasteData.trim()) {
                      setPalletGenError('Please paste data');
                      return;
                    }
                    
                    setPalletGenError(null);
                    setRemainderWarning(null);
                    const rows = palletPasteData.trim().split(/\r?\n/).map(row => row.split('\t'));
                    const newPalletRows: ASNLine[] = [];
                    const remainderDetails: any[] = [];
                    let errorOccurred = false;

                    rows.forEach((cols, rowIndex) => {
                      if (errorOccurred) return;

                      if (cols.length < 5) {
                        setPalletGenError(`Row ${rowIndex + 1}: Invalid format. Expected 5 columns (Item Code, Item Name, Description, Expected Qty, ASN UOM).`);
                        errorOccurred = true;
                        return;
                      }

                      const itemCode = cols[0]?.trim() || '';
                      const itemName = cols[1]?.trim() || '';
                      const description = cols[2]?.trim() || '';
                      const qty = Number(cols[3]?.trim() || '0');
                      const asnUom = cols[4]?.trim() || '';

                      if (!itemCode || !itemName || !description || qty <= 0 || !asnUom) {
                        setPalletGenError(`Row ${rowIndex + 1}: Invalid values. Ensure Item Code, Item Name, Description, Expected Qty (>0), and ASN UOM are provided.`);
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

                      // Calculate pallet count: Qty ÷ (weight_uom_kg × pallet_config)
                      const capacityPerPallet = weightUomKg * palletConfig;
                      const exactPallets = qty / capacityPerPallet;
                      const palletCount = Math.ceil(exactPallets);
                      const remainder = (qty % capacityPerPallet);

                      // Check for remainder
                      if (remainder !== 0) {
                        remainderDetails.push({
                          itemCode,
                          itemName,
                          expectedQty: qty,
                          capacityPerPallet: capacityPerPallet,
                          remainder: remainder,
                          palletCount: palletCount,
                        });
                      }

                      // Generate Pallet IDs - use generatePalletId() for each pallet to ensure absolute uniqueness
                      // This prevents different items from having the same pallet ID
                      for (let i = 0; i < palletCount; i++) {
                        // Last pallet gets the remainder, all others get the full capacity
                        const qtyForThisPallet = (i === palletCount - 1 && remainder > 0) 
                          ? remainder 
                          : capacityPerPallet;

                        // For last pallet with remainder, adjust pallet config to reflect partial fill
                        let palletConfigForThisPallet = palletConfig;
                        if (i === palletCount - 1 && remainder > 0) {
                          // Pallet config = how many units (in weight UOM KG) fit on this pallet
                          palletConfigForThisPallet = Math.ceil(remainder / weightUomKg);
                        }

                        newPalletRows.push({
                          itemCode,
                          itemName,
                          description,
                          expectedQuantity: String(qtyForThisPallet),
                          receivedQuantity: '',
                          batchNumber: '',
                          manufacturingDate: '',
                          expiryDate: '',
                          palletId: generatePalletId(), // Call for each pallet - ensures uniqueness across rows
                          weightUomKg: String(weightUomKg),
                          palletConfig: String(palletConfigForThisPallet),
                          itemUom: item.item_uom || asnUom,
                          asnUom: asnUom,
                          remarks: '',
                        });
                      }
                    });

                    // If there are remainders, show warning and don't proceed
                    if (remainderDetails.length > 0) {
                      setRemainderWarning({
                        items: remainderDetails,
                        pendingRows: newPalletRows,
                      });
                      setPendingPalletRows(newPalletRows);
                      return;
                    }

                    if (!errorOccurred && newPalletRows.length > 0) {
                      setRowData([...rowData, ...newPalletRows]);
                      setShowPalletGeneration(false);
                      setPalletPasteData('');
                      setPalletGenError(null);
                      setPendingPalletRows([]);
                    }
                  }}
                >
                  Generate Pallets
                </button>
                <button 
                  type="button" 
                  className="flex-1 px-4 py-2.5 bg-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-400 transition" 
                  onClick={() => {
                    setShowPalletGeneration(false);
                    setPalletGenError(null);
                    setPalletPasteData('');
                  }}
                >
                  Cancel
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
            <div className="bg-white rounded-lg shadow-lg p-8 my-8" style={{ width: '95vw', maxWidth: '900px', maxHeight: '95vh', overflowY: 'auto' }}>
              {(() => {
                const header = headerRecords.find(h => h.id === gatepassHeaderId);
                const lines = lineRecords.filter(l => l.asn_header_id === gatepassHeaderId);
                
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
                          <p className="text-2xl font-bold text-green-700 tracking-wider font-mono">{gatepassNumber}</p>
                        </div>
                      </div>
                    </div>

                    {/* Gatepass Information */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-4 mb-6 border-b pb-4 bg-white">
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">ASN Number</p>
                        <p className="text-lg font-bold text-black">{header.asn_number}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Gatepass Date</p>
                        <p className="text-lg font-bold text-black">{new Date().toLocaleDateString()}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Status</p>
                        <p className="text-lg font-bold text-green-900">Complete</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Vendor Code</p>
                        <p className="text-lg font-bold text-black">{header.vendor_code}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">Vendor Name</p>
                        <p className="text-lg font-bold text-black">{header.vendor_name}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-800 uppercase font-semibold">PO Number</p>
                        <p className="text-lg font-bold text-black">{header.po_number}</p>
                      </div>
                    </div>

                    {/* Items Table */}
                    <div className="mb-6">
                      <h3 className="text-lg font-bold mb-3 uppercase text-black">Released Items</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse border border-gray-400 text-xs bg-white">
                          <thead>
                            <tr className="bg-green-200">
                              <th className="border border-gray-400 px-2 py-1 text-left font-bold text-black">Item Code</th>
                              <th className="border border-gray-400 px-2 py-1 text-left font-bold text-black">Description</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Received Qty</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Batch #</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">Pallet ID</th>
                              <th className="border border-gray-400 px-2 py-1 text-center font-bold text-black">UOM</th>
                              <th className="border border-gray-400 px-2 py-1 text-left font-bold text-black">Remarks</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.length > 0 ? (
                              lines.map((line, idx) => (
                                <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                  <td className="border border-gray-400 px-2 py-1 text-black">{line.item_code || '-'}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-black">{line.item_description || '-'}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.received_quantity || '-'}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.batch_number || '-'}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.pallet_id || '-'}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-center text-black">{line.uom || '-'}</td>
                                  <td className="border border-gray-400 px-2 py-1 text-black">{line.remarks || '-'}</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={7} className="border border-gray-400 px-2 py-1 text-center text-gray-800">
                                  No items found
                                </td>
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
                        <p className="text-xs font-semibold uppercase text-black">Released By</p>
                        <p className="text-xs text-gray-800">Warehouse Manager</p>
                      </div>
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-2 mb-2" style={{ width: '100%', height: '60px' }}></div>
                        <p className="text-xs font-semibold uppercase text-black">Verified By</p>
                        <p className="text-xs text-gray-800">Security Officer</p>
                      </div>
                      <div className="text-center">
                        <div className="border-t-2 border-gray-400 pt-2 mb-2" style={{ width: '100%', height: '60px' }}></div>
                        <p className="text-xs font-semibold uppercase text-black">Received By</p>
                        <p className="text-xs text-gray-800">Transport/Recipient</p>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-8 text-center text-xs text-gray-800 border-t pt-4">
                      <p className="font-semibold text-green-900">✓ GOODS CLEARED FOR GATE RELEASE</p>
                      <p className="text-black">This gatepass must be presented at the warehouse exit gate.</p>
                      <p className="text-black">Generated on: {new Date().toLocaleString()}</p>
                    </div>

                    {/* Action Buttons */}
                    <div className="mt-6 flex gap-3 justify-center">
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="px-6 py-2 bg-green-600 text-white rounded font-semibold hover:bg-green-700"
                      >
                        Print Gatepass
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowGatepassModal(false);
                          setGatepassHeaderId(null);
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
        
        {/* ASN Headers and Lines - Vertical Stacking */}
        <div style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* ASN Headers Section */}
          <div className="min-w-0" style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Title and Search Box on Same Row */}
            <div className="flex gap-3 mb-4 items-center justify-between">
              <h2 className="text-2xl font-bold">Inbound Records</h2>
              <div className="flex gap-2 items-center">
                <input 
                  type="text" 
                  placeholder="Search ASN..." 
                  className="border px-4 py-3 rounded text-base" 
                  style={{ width: '250px' }}
                  value={searchHeaderInput}
                  onChange={e => setSearchHeaderInput(e.target.value)}
                />
              </div>
            </div>
            
            {/* Filter and Controls */}
            <div className="flex gap-3 mb-4">
              {/* Left Side Controls */}
              <div className="flex flex-col gap-3" style={{ width: '280px', flexShrink: 0 }}>
              <div>
                <label className="block text-base font-medium mb-1">Filter Status</label>
                <select 
                  className="border px-4 py-3 rounded text-base w-full" 
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                >
                  <option value="">All Status</option>
                  <option value="New">New</option>
                  <option value="Received">Received</option>
                  <option value="PutAway">PutAway</option>
                  <option value="Complete">Complete</option>
                </select>
              </div>
              
              {/* Delete and Paste Actions */}
              {(() => {
                const selectedRow = headerGridRef.current?.api?.getSelectedRows()[0];
                const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId || selectedRow?.id));
                const status = selectedHeader?.status || '';
                const isDeleteEnabled = status !== 'PutAway' && status !== 'Received' && status !== 'Complete';
                const isPasteEnabled = status !== 'PutAway' && status !== 'Received' && status !== 'Complete';
                
                return (
                  <>
                    <button
                      type="button"
                      className={`px-6 py-3 rounded shadow text-base font-semibold w-full transition-all duration-100 text-white active:scale-95 ${isDeleteEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                      style={{ backgroundColor: '#008ecc', opacity: isDeleteEnabled ? 1 : 0.6 }}
                      onMouseEnter={(e) => isDeleteEnabled && (e.currentTarget.style.filter = 'brightness(0.9)')}
                      onMouseLeave={(e) => isDeleteEnabled && (e.currentTarget.style.filter = 'brightness(1)')}
                      title={isDeleteEnabled ? 'Delete selected records' : `Not available for ${status} status`}
                      onClick={() => { if (isDeleteEnabled) handleDeleteSelectedHeaders(); }}
                    >Delete</button>
                    <button
                      type="button"
                      className={`px-6 py-3 rounded shadow text-base font-semibold w-full transition-all duration-100 text-white active:scale-95 ${isPasteEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                      style={{ backgroundColor: '#008ecc', opacity: isPasteEnabled ? 1 : 0.6 }}
                      onMouseEnter={(e) => isPasteEnabled && (e.currentTarget.style.filter = 'brightness(0.9)')}
                      onMouseLeave={(e) => isPasteEnabled && (e.currentTarget.style.filter = 'brightness(1)')}
                      title={isPasteEnabled ? 'Paste values' : `Not available for ${status} status`}
                      onClick={() => {
                        if (isPasteEnabled) {
                          setShowRecordPasteArea(true);
                          setPasteDataStatus(null);
                          setOriginalRecordLines([]);
                        }
                      }}
                    >Paste Values</button>
                  </>
                );
              })()}
              
              {/* Row Action Buttons */}
              {(() => {
                const selectedRow = headerGridRef.current?.api?.getSelectedRows()[0];
                const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId || selectedRow?.id));
                const status = selectedHeader?.status || '';
                const isPrintEnabled = status === 'New';
                const isReceivingEnabled = status === 'Received';
                const isGatepassEnabled = status === 'Complete';
                
                return (
                  <>
                    <button
                      type="button"
                      className={`px-6 py-3 rounded shadow text-base font-semibold w-full transition-all duration-100 text-white active:scale-95 ${isPrintEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                      style={{ backgroundColor: '#008ecc', opacity: isPrintEnabled ? 1 : 0.6 }}
                      onMouseEnter={(e) => isPrintEnabled && (e.currentTarget.style.filter = 'brightness(0.9)')}
                      onMouseLeave={(e) => isPrintEnabled && (e.currentTarget.style.filter = 'brightness(1)')}
                      title={isPrintEnabled ? 'Print ASN' : 'Only available for New status'}
                      onClick={() => {
                        if (selectedHeader && isPrintEnabled) {
                          setPrintHeaderId(selectedHeader.id);
                          setShowPrintPreview(true);
                        }
                      }}
                    >📄 Print Receiving Checklist</button>
                    <button
                      type="button"
                      className={`px-6 py-3 rounded shadow text-base font-semibold w-full transition-all duration-100 text-white active:scale-95 ${isReceivingEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                      style={{ backgroundColor: '#008ecc', opacity: isReceivingEnabled ? 1 : 0.6 }}
                      onMouseEnter={(e) => isReceivingEnabled && (e.currentTarget.style.filter = 'brightness(0.9)')}
                      onMouseLeave={(e) => isReceivingEnabled && (e.currentTarget.style.filter = 'brightness(1)')}
                      title={isReceivingEnabled ? 'Receiving Confirmation' : 'Only available for Received status'}
                      onClick={() => {
                        if (selectedHeader && isReceivingEnabled) {
                          setReceivingConfirmationHeaderId(selectedHeader.id);
                          setShowReceivingConfirmation(true);
                        }
                      }}
                    >✓ Received Confirmation</button>
                  </>
                );
              })()}
            </div>
            {/* Grid on right */}
            <div className="flex-1 min-w-0 flex flex-col">
          <div className="ag-theme-alpine" style={{ width: '100%', minWidth: 0, height: 500, background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px' }}>
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
              columnDefs={[
                { headerName: '', field: 'selected', checkboxSelection: true, width: 40 },
                {
                  headerName: '',
                  field: 'actions',
                  width: 110,
                  sortable: false,
                  filter: false,
                  hide: true,
                  cellRenderer: (params: any) => {
                    const status = params.data?.status || '';
                    const isPrintEnabled = status === 'New';
                    const isReceivingEnabled = status === 'Received';
                    const isForkliftEnabled = status === 'PutAway';
                    const isGatepassEnabled = status === 'Complete';
                    
                    return (
                      <div className="flex gap-0.5 items-center justify-center h-full">
                        <button
                          className={`p-1 rounded text-sm flex items-center justify-center leading-none ${
                            isPrintEnabled
                              ? 'bg-blue-600 text-white cursor-pointer hover:bg-blue-700'
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                          style={{ width: '28px', height: '28px' }}
                          onClick={e => {
                            e.stopPropagation();
                            if (isPrintEnabled) {
                              setPrintHeaderId(params.data.id);
                              setShowPrintPreview(true);
                            }
                          }}
                          disabled={!isPrintEnabled}
                          title={isPrintEnabled ? 'Print ASN' : 'Only available for New status'}
                        >
                          📄
                        </button>
                        <button
                          className={`p-1 rounded text-sm flex items-center justify-center leading-none ${
                            isReceivingEnabled
                              ? 'bg-yellow-600 text-white cursor-pointer hover:bg-yellow-700'
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                          style={{ width: '28px', height: '28px' }}
                          onClick={e => {
                            e.stopPropagation();
                            if (isReceivingEnabled) {
                              setReceivingConfirmationHeaderId(params.data.id);
                              setShowReceivingConfirmation(true);
                            }
                          }}
                          disabled={!isReceivingEnabled}
                          title={isReceivingEnabled ? 'Receiving Confirmation' : 'Only available for Received status'}
                        >
                          ✓
                        </button>
                        <button
                          className={`p-1 rounded text-sm flex items-center justify-center leading-none ${
                            isGatepassEnabled
                              ? 'bg-orange-600 text-white cursor-pointer hover:bg-orange-700'
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                          style={{ width: '28px', height: '28px' }}
                          onClick={e => {
                            e.stopPropagation();
                            if (isGatepassEnabled) {
                              setGatepassHeaderId(params.data.id);
                              setShowGatepassModal(true);
                            }
                          }}
                          disabled={!isGatepassEnabled}
                          title={isGatepassEnabled ? 'Issuance Gatepass' : 'Only available for Complete status'}
                        >
                          🚪
                        </button>
                      </div>
                    );
                  }
                },
                {
                  headerName: 'Status',
                  field: 'status',
                  editable: true,
                  cellEditor: 'agSelectCellEditor',
                  cellEditorParams: (params: any) => {
                    const currentStatus = params.data?.status || 'New';
                    return {
                      values: getAllowedStatuses(currentStatus),
                    };
                  },
                  width: 120,
                  cellRenderer: (params: any) => {
                    const status = params.value;
                    const statusColors: any = {
                      'New': 'bg-blue-100 text-blue-800',
                      'Received': 'bg-green-100 text-green-800',
                      'PutAway': 'bg-yellow-100 text-yellow-800',
                      'Complete': 'bg-purple-100 text-purple-800',
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
                { headerName: 'Vendor Code', field: 'vendor_code', editable: true, width: 120 },
                { headerName: 'Vendor Name', field: 'vendor_name', editable: true, width: 200 },
                { headerName: 'PO Number', field: 'po_number', editable: true, width: 120 },
                { headerName: 'Barcode', field: 'barcode', editable: true, width: 180 },
                ...headerRecordCols.filter(col => !['status', 'vendor_code', 'vendor_name', 'po_number'].includes(col.field)),
              ]}
              rowHeight={40}
              headerHeight={35}
              suppressRowClickSelection={false}
              rowSelection="multiple"
              rowClassRules={{
                'bg-yellow-100 border-l-4 border-yellow-500': (params: any) => !!(putawayHeaderId && params.data?.id === putawayHeaderId),
              }}
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
              onRowClicked={async params => {
                if (params.data && params.data.id) {
                  const headerId = Number(params.data.id);
                  console.log('📍 Header row clicked:', headerId, 'Type:', typeof headerId);
                  console.log('📊 Total line records:', lineRecords.length);
                  console.log('📊 Sample lineRecords[0]:', lineRecords[0]);
                  console.log('📊 lineRecords[0].putaway_marked:', lineRecords[0]?.putaway_marked);
                  
                  let filteredLines: any[] = [];
                  
                  // Fetch fresh lines for this header to ensure we have latest putaway_marked status
                  try {
                    const freshLines = await fetchASNLines(headerId);
                    console.log('🔄 Fetched fresh lines for header:', headerId, 'Count:', freshLines.length);
                    if (freshLines.length > 0) {
                      console.log('🔄 Sample fresh line putaway_marked:', freshLines[0].putaway_marked);
                    }
                    
                    filteredLines = freshLines;
                    
                    // Update the lineRecords with fresh data for this header
                    setLineRecords(prev => {
                      const otherLines = prev.filter(line => {
                        const lineHeaderId = line.asn_header_id ?? line.header_id ?? line.receiving_header_id;
                        return Number(lineHeaderId) !== headerId;
                      });
                      return [...otherLines, ...freshLines];
                    });
                  } catch (err) {
                    console.error('Error fetching fresh lines:', err);
                    
                    // Fallback to original filter logic
                    filteredLines = lineRecords.filter(line => {
                      const lineHeaderId = line.asn_header_id ?? line.header_id ?? line.receiving_header_id;
                      const numLineHeaderId = Number(lineHeaderId);
                      return numLineHeaderId === headerId;
                    });
                  }
                  
                  console.log('✅ Filtered lines count:', filteredLines.length);
                  if (filteredLines.length > 0) {
                    console.log('✅ Sample filtered line:', filteredLines[0]);
                    console.log('✅ Sample filtered line putaway_marked:', filteredLines[0].putaway_marked);
                  }
                  
                  setSelectedHeaderId(String(headerId));
                  setFilteredRecordLines(filteredLines);
                  
                  // Note: Putaway status fetch moved to background (non-blocking)
                  // This prevents API timeouts from blocking the grid display
                  setTimeout(() => {
                    const fetchPutawayStatus = async () => {
                      try {
                        // Fetch putaway status from API route instead of direct PostgREST
                        // This is async and non-blocking, so grid displays immediately
                        const response = await fetch(`/api/putaway-transactions?receiving_transaction_id=eq.${params.data.id}`, {
                          method: 'GET',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                        });
                        
                        if (response.ok) {
                          const putawayRecords = await response.json();
                          console.log('Fetched putaway records:', putawayRecords);
                          
                          // Build a Set of asn_line_ids that have been putaway
                          const putawayLineIds = new Set<number>();
                          if (Array.isArray(putawayRecords)) {
                            putawayRecords.forEach((record: any) => {
                              // Find the asn_line_id by matching item_code + pallet_id with filteredLines
                              const matchingLine = filteredLines.find(
                                line => line.item_code === record.item_code && line.pallet_id === record.pallet_id
                              );
                            if (matchingLine) {
                              putawayLineIds.add(matchingLine.id);
                            }
                          });
                        }
                        
                        setPutawayCompletedLines(putawayLineIds);
                        console.log('Putaway completed lines:', putawayLineIds);
                      }
                    } catch (error) {
                      console.error('Error fetching putaway status:', error);
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
                            asn_number: data.asn_number ?? data.asnNumber ?? '',
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
                    asn_number: data.asn_number ?? data.asnNumber ?? '',
                    vendor_code: data.vendor_code ?? data.vendorCode ?? '',
                    vendor_name: data.vendor_name ?? data.vendorName ?? '',
                    po_number: data.po_number ?? data.poNumber ?? '',
                    asn_date: (data.asn_date ?? data.asnDate) ? (data.asn_date ?? data.asnDate).slice(0, 10) : null,
                    status: data.status ?? '',
                    barcode: data.barcode ?? '',
                    remarks: data.remarks ?? ''
                  };
                  console.log('PATCH ASN header (record grid):', { table: 'asn_headers', id: data.id, payload: headerToSend });
                  const res = await fetch('/api/patch-record', {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      table: 'asn_headers',
                      id: data.id,
                      data: headerToSend,
                    }),
                  });
                  const resText = await res.text();
                  console.log('PATCH response (header record grid):', { status: res.status, text: resText });
                  
                  // Clear cache after status update
                  const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
                  await fetch(`/api/inbound-records`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ year, action: 'clear' }),
                  }).catch(err => console.log('Note: Cache clear request sent'));
                  
                  // Force grid refresh after PATCH via API route
                  try {
                    const headersData = await fetchASNHeaders();
                    setHeaderRecords(Array.isArray(headersData) ? headersData : []);
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

          {/* ASN Lines Section - Only show when header is selected */}
          {selectedHeaderId ? (
          <div className="min-w-0" style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div className="flex gap-3 mb-2">
              {/* Left Side Spacing */}
              <div style={{ width: '280px', flexShrink: 0 }}></div>
              {/* Title */}
              <div className="flex-1 flex items-center">
                <h2 className="text-2xl font-bold">Item Details</h2>
              </div>
            </div>
            <div className="flex gap-3 mb-4">
              {/* Item Details Action Buttons - Left Side */}
              <div className="flex flex-col gap-3" style={{ width: '280px', flexShrink: 0 }}>
                {/* Search box for record lines */}
                <input
                  type="text"
                  placeholder="Search items..."
                  className="border px-3 py-2 rounded text-sm w-full"
                  value={searchRecordLineInput}
                  onChange={(e) => setSearchRecordLineInput(e.target.value)}
                />
                {(() => {
                  const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
                  const selectedLineRow = filteredRecordLines.find(line => line.id === selectedLineId);
                  const status = selectedHeader?.status || '';
                  const isAlreadyPutaway = selectedLineId ? putawayCompletedLines.has(selectedLineId) : false;
                  const isPutawayEnabled = status === 'PutAway' && selectedLineRow && !isAlreadyPutaway;
                  const isTagEnabled = (status === 'PutAway' || status === 'Received') && selectedLineRow;
                  
                  return (
                    <>
                      <button
                        type="button"
                        className={`px-6 py-3 rounded shadow text-base font-semibold w-full transition-all duration-100 text-white active:scale-95 ${isPutawayEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                        style={{ backgroundColor: '#008ecc', opacity: isPutawayEnabled ? 1 : 0.6 }}
                        onMouseEnter={(e) => isPutawayEnabled && (e.currentTarget.style.filter = 'brightness(0.9)')}
                        onMouseLeave={(e) => isPutawayEnabled && (e.currentTarget.style.filter = 'brightness(1)')}
                        title={!selectedLineRow ? 'Select a line' : isAlreadyPutaway ? 'Already Putaway' : 'Only available for PutAway status'}
                        onClick={() => {
                          if (selectedHeader && selectedLineRow && isPutawayEnabled) {
                            setPutawayHeaderId(selectedHeader.id);
                            setPutawayLineId(selectedLineRow.id);
                            setShowPutawayModal(true);
                          }
                        }}
                      >➜ Putaway</button>
                      <button
                        type="button"
                        className={`px-6 py-3 rounded shadow text-base font-semibold w-full transition-all duration-100 text-white active:scale-95 ${isTagEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                        style={{ backgroundColor: '#008ecc', opacity: isTagEnabled ? 1 : 0.6 }}
                        onMouseEnter={(e) => isTagEnabled && (e.currentTarget.style.filter = 'brightness(0.9)')}
                        onMouseLeave={(e) => isTagEnabled && (e.currentTarget.style.filter = 'brightness(1)')}
                        title={!selectedHeader ? 'Select an ASN' : 'Print all pallet tags for this ASN'}
                        onClick={() => {
                          if (selectedHeader && isTagEnabled) {
                            setPalletTagHeaderId(selectedHeader.id);
                            setShowPalletTag(true);
                          }
                        }}
                      >🏷️ Pallet Tag</button>
                    </>
                  );
                })()}
              </div>
              
              {/* Grid on right */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="ag-theme-alpine" style={{ width: '100%', minWidth: 0, height: 300, background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px' }}>
                <AgGridReact
                  theme="legacy"
                  rowData={filteredRecordLines.filter(line => {
                    if (searchRecordLineInput.trim() === '') return true;
                    const searchLower = searchRecordLineInput.toLowerCase();
                    return (
                      (line.item_code || line.itemCode || '').toLowerCase().includes(searchLower) ||
                      (line.item_name || line.itemName || '').toLowerCase().includes(searchLower) ||
                      (line.batch_number || line.batchNumber || '').toLowerCase().includes(searchLower) ||
                      (line.description || '').toLowerCase().includes(searchLower) ||
                      (line.pallet_id || line.palletId || '').toLowerCase().includes(searchLower)
                    );
                  }).map(line => ({
                itemCode: line.itemCode ?? line.item_code ?? '',
                itemName: line.itemName ?? line.item_name ?? '',
                description: line.description ?? '',
                expectedQuantity: line.expectedQuantity ?? line.expected_quantity ?? '',
                receivedQuantity: line.receivedQuantity ?? line.received_quantity ?? '',
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
                    id: line.id,
                    putawayMarked: ((line.putawayMarked ?? line.putaway_marked) === 'Pending' || !(line.putawayMarked ?? line.putaway_marked)) ? false : true,
                    putawayStatus: ((line.putawayMarked ?? line.putaway_marked) === 'Pending' || !(line.putawayMarked ?? line.putaway_marked)) ? 'pending' : 'complete',
                    putawayStatusText: (line.putawayMarked ?? line.putaway_marked) || 'Pending'
                  }))}
                  columnDefs={recordViewColumnDefs as any}
                  defaultColDef={{
                    resizable: false,
                    sortable: false,
                    filter: true,
                    editable: headerRecords.find(h => h.id === Number(selectedHeaderId))?.status !== 'PutAway'
                  }}
                  pagination={true}
                  paginationPageSize={100}
                  rowHeight={40}
                  headerHeight={35}
                  components={{
                    putawayStatusRenderer: (params: any) => {
                      const status = params.data?.putawayStatusText || 'Pending';
                      console.log('🔍 putawayStatusRenderer - ID:', params.data?.id, 'Status:', status, 'Raw putaway_marked:', params.data?.putaway_marked, 'Data:', params.data);
                      
                      let statusColor = 'text-gray-300';
                      let statusSymbol = '○';
                      
                      if (status === 'Done') {
                        statusColor = 'text-green-600';
                        statusSymbol = '✓';
                      } else if (status === 'Splitted') {
                        statusColor = 'text-blue-600';
                        statusSymbol = '⊡';
                      }
                      
                      return (
                        <div className="flex items-center justify-center h-full gap-1">
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                // Only allow toggling between Pending and Done, not Splitted
                                const currentStatus = params.data?.putawayStatusText || 'Pending';
                                
                                // If it's Splitted, don't allow manual toggle
                                if (currentStatus === 'Splitted') {
                                  alert('Cannot toggle Splitted status. This was set by split putaway operation.');
                                  return;
                                }
                                
                                // Cycle through Pending → Done → Pending
                                const newStatus = currentStatus === 'Done' ? 'Pending' : 'Done';
                                
                                const response = await fetch('/api/patch-record', {
                                  method: 'PATCH',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    table: 'asn_lines',
                                    id: params.data.id,
                                    data: { putaway_marked: newStatus },
                                  }),
                                });
                                
                                if (response.ok) {
                                  // Update the local data to reflect the change
                                  setFilteredRecordLines(prev => prev.map(line => 
                                    line.id === params.data.id 
                                      ? { ...line, putaway_marked: newStatus, putawayMarked: newStatus, putawayStatusText: newStatus }
                                      : line
                                  ));
                                  
                                  // Also update lineRecords for consistency
                                  setLineRecords(prev => prev.map(line => 
                                    line.id === params.data.id 
                                      ? { ...line, putaway_marked: newStatus }
                                      : line
                                  ));
                                } else {
                                  console.error('Failed to update putaway_marked:', await response.text());
                                }
                              } catch (error) {
                                console.error('Error updating putaway status:', error);
                              }
                            }}
                            className="flex items-center gap-1 px-2 py-1 rounded cursor-pointer hover:opacity-80 transition-all whitespace-nowrap"
                            title={`Status: ${status}. Click to toggle.`}
                          >
                            <span className={`text-base font-bold ${statusColor}`}>{statusSymbol}</span>
                            <span className="text-sm font-semibold text-gray-700" title={status}>{status}</span>
                          </button>
                        </div>
                      );
                    },
                    actionsCellRenderer: (params: any) => {
                      const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
                      const isPutawayEnabled = selectedHeader?.status === 'PutAway';
                      const isAlreadyPutaway = params.data?.putawayStatus === 'complete';
                      const isButtonEnabled = isPutawayEnabled && !isAlreadyPutaway;
                      return isPutawayEnabled ? (
                        <div className="flex gap-1 items-center justify-center h-full">
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
                          <button
                            className="p-1 rounded text-sm flex items-center justify-center leading-none bg-yellow-600 text-white cursor-pointer hover:bg-yellow-700"
                            style={{ width: '28px', height: '28px' }}
                            onClick={e => {
                              e.stopPropagation();
                              if (selectedHeaderId) {
                                setPalletTagHeaderId(Number(selectedHeaderId));
                                setPalletTagLineId(params.data.id);
                                setShowPalletTag(true);
                              }
                            }}
                            title="Pallet Tag"
                          >
                            🏷️
                          </button>
                        </div>
                      ) : null;
                    },
                  }}
                  getRowId={(params) => String(params.data?.id || Math.random())}
                  suppressRowClickSelection={false}
                  rowSelection="single"
                  onRowClicked={params => {
                    if (params.data && params.data.id) {
                      setSelectedLineId(params.data.id);
                    }
                  }}
                  key={selectedHeaderId}
                  onCellValueChanged={async params => {
                const data = params.data;
                const colDef = params.colDef;
                console.log('🔄 Cell changed:', { field: colDef?.field, oldValue: params.oldValue, newValue: params.newValue, data });
                
                // Check if ASN status is locked (Received, PutAway, or Complete)
                const selectedHeader = headerRecords.find(h => h.id === Number(selectedHeaderId));
                const status = selectedHeader?.status || 'New';
                if (['Received', 'PutAway', 'Complete'].includes(status)) {
                  // Revert the change
                  params.data[params.colDef.field!] = params.oldValue;
                  params.api.refreshCells({ rowNodes: [params.node], force: true });
                  alert(`⚠️ Edit cancelled - ASN status is "${status}". This record is locked for editing.`);
                  return;
                }
                
                if (data.id) {
                  setLineRecords(prev => {
                    const updated = prev.map(line =>
                      line.id === data.id
                        ? {
                            ...line,
                            item_code: data.itemCode,
                            item_name: data.itemName,
                            description: data.description,
                            expected_quantity: data.expectedQuantity,
                            received_quantity: data.receivedQuantity,
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
                            receivedQuantity: data.receivedQuantity,
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
                    expected_quantity: data.expectedQuantity ? Number(data.expectedQuantity) : null,
                    received_quantity: data.receivedQuantity ? Number(data.receivedQuantity) : null,
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
                    const linesData = await fetchASNLines();
                    setLineRecords(Array.isArray(linesData) ? linesData : []);
                    // Update filteredRecordLines to reflect the change
                    const updatedLines = (Array.isArray(linesData) ? linesData : []).filter((line: any) => line.asn_header_id === selectedHeaderId);
                    setFilteredRecordLines(updatedLines.map((line: any) => ({
                      itemCode: line.itemCode ?? line.item_code ?? '',
                      itemName: line.itemName ?? line.item_name ?? '',
                      description: line.description ?? '',
                      expectedQuantity: line.expectedQuantity ?? line.expected_quantity ?? '',
                      receivedQuantity: line.receivedQuantity ?? line.received_quantity ?? '',
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
                    console.error('Error refreshing ASN lines:', err);
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
              <p className="text-yellow-800">👉 Select an ASN header to view item details</p>
            </div>
          )}
        </div>

        {/* Entry Confirmation Modal */}
        {showEntryConfirmation && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full mx-4">
              <h2 className="text-lg font-bold mb-4">Confirm Entry Submission</h2>
              <p className="text-gray-700 mb-6">
                Are you sure you want to submit this ASN entry? <br />
                <span className="font-semibold text-sm mt-2 block">
                  Vendor: {header.vendorName || 'N/A'} <br />
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
                      if (!header.asnDate) {
                        setLoading(false);
                        setEntrySubmitStatus('ASN Date is required.');
                        return;
                      }
                      if (!header.vendorCode) {
                        setLoading(false);
                        setEntrySubmitStatus('Vendor is required.');
                        return;
                      }
                      const asnHeaderPayload = {
                        asn_number: header.asnNumber,
                        vendor_code: header.vendorCode,
                        vendor_name: header.vendorName,
                        po_number: header.poNumber,
                        asn_date: header.asnDate,
                        status: header.status || 'New',
                        barcode: header.barcode,
                        remarks: header.remarks,
                        warehouse_id: warehouseFilter ? parseInt(warehouseFilter) : undefined
                      };
                      const filteredRows = rowData.filter(row => row.itemCode);
                      const asnLinesPayload = filteredRows.map(row => ({
                        item_code: row.itemCode,
                        item_name: row.itemName,
                        description: row.description,
                        expected_quantity: row.expectedQuantity ? Number(row.expectedQuantity) : null,
                        received_quantity: row.receivedQuantity ? Number(row.receivedQuantity) : null,
                        batch_number: row.batchNumber || null,
                        manufacturing_date: row.manufacturingDate ? row.manufacturingDate.slice(0, 10) : null,
                        expiry_date: row.expiryDate ? row.expiryDate.slice(0, 10) : null,
                        pallet_id: row.palletId || null,
                        weight_uom_kg: row.weightUomKg ? Number(row.weightUomKg) : null,
                        pallet_config: row.palletConfig || null,
                        item_uom: row.itemUom || null,
                        asn_uom: row.asnUom || null,
                        remarks: row.remarks || null,
                      }));
                      if (asnLinesPayload.length === 0) {
                        setLoading(false);
                        setEntrySubmitStatus('No valid ASN line items to submit.');
                        return;
                      }
                      const headerRes = await postASNHeader(asnHeaderPayload);
                      if (!headerRes.ok) {
                        const headerText = await headerRes.text();
                        setLoading(false);
                        setEntrySubmitStatus(`Header insert failed: ${headerRes.status} - ${headerText.slice(0, 500)}`);
                        return;
                      }
                      
                      const headerData = await headerRes.json();
                      const asn_header_id = headerData.data?.id;
                      
                      if (!asn_header_id) {
                        setLoading(false);
                        setEntrySubmitStatus('Header insert did not return an ID.');
                        return;
                      }
                      const asnLinesPayloadWithHeader = asnLinesPayload.map((line: any) => ({ ...line, asn_header_id }));
                      console.log('📤 Sending ASN Lines Payload:', JSON.stringify(asnLinesPayloadWithHeader, null, 2));
                      const linesRes = await postASNLines(asnLinesPayloadWithHeader);
                      
                      if (!linesRes.ok) {
                        const linesText = await linesRes.text();
                        console.error('📥 ASN Lines Response Status:', linesRes.status);
                        console.error('📥 ASN Lines Response Body:', linesText);
                        setLoading(false);
                        setEntrySubmitStatus(`Lines insert failed: ${linesRes.status} - ${linesText.slice(0, 500)}`);
                        return;
                      }
                      setEntrySubmitStatus('ASN entry submitted successfully!');
                      setLoading(false);
                      
                      // Clear cache and fetch fresh records
                      try {
                        const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
                        const warehouse = searchParams?.get('warehouse');
                        // Clear server cache
                        await fetch(`/api/inbound-records`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ year, action: 'clear' }),
                        });

                        // Fetch fresh data from cached API with refresh flag and warehouse filter
                        const freshUrl = `/api/inbound-records?year=${year}&refresh=true${warehouse ? `&warehouse=${warehouse}` : ''}`;
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
                          asnNumber: `ASN${new Date().toISOString().slice(2, 4)}${new Date().toISOString().slice(5, 7)}${new Date().toISOString().slice(8, 10)}${new Date().toISOString().slice(11, 13)}${new Date().toISOString().slice(14, 16)}${new Date().toISOString().slice(17, 19)}`,
                          vendorCode: '',
                          vendorName: '',
                          poNumber: '',
                          asnDate: getManilaDateForInput(new Date()),
                          status: 'New',
                          remarks: '',
                        });
                        setVendorSearchInput('');
                        setShowVendorDropdown(false);
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

        {/* Status Change Confirmation Modal */}
        {showStatusConfirmation && pendingStatusChange && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
              <h2 className="text-lg font-bold mb-4">Confirm Status Change</h2>
              <p className="text-gray-700 mb-4">
                Are you sure you want to change the status? <br />
                <span className="font-semibold text-sm mt-2 block">
                  From: <span className="text-red-600">{pendingStatusChange.oldStatus}</span> <br />
                  To: <span className="text-green-600">{pendingStatusChange.newStatus}</span>
                </span>
              </p>
              
              {/* Location selector for Received status */}
              {pendingStatusChange.newStatus === 'Received' && (
                <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    📍 Receiving Location
                  </label>
                  <select
                    value={receiveLocationId}
                    onChange={(e) => setReceiveLocationId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {availableLocations.map((loc) => (
                      <option key={loc.id} value={loc.location_name}>
                        {loc.location_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              
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

                        // Send PATCH to internal API (not directly to backend)
                        try {
                          const res = await fetch(`/api/inbound-records?id=${pendingStatusChange.recordId}`, {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ status: pendingStatusChange.newStatus }),
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
                            
                            // If status changed to "Received", automatically insert inventory to selected Location
                            if (pendingStatusChange.newStatus === 'Received') {
                              try {
                                console.log('� DEBUG: Attempting inventory insertion...');
                                console.log('🔍 DEBUG: receiveLocationId =', receiveLocationId);
                                console.log('🔍 DEBUG: record.warehouse_id =', record.warehouse_id);
                                console.log('🔍 DEBUG: pendingStatusChange.recordId =', pendingStatusChange.recordId);
                                console.log('📦 Inserting inventory for Received status to location:', receiveLocationId);
                                
                                const payloadData = {
                                  action: 'insertReceivedInventory',
                                  asnHeaderId: pendingStatusChange.recordId,
                                  locationName: receiveLocationId, // Use selected location
                                  warehouseId: record.warehouse_id,
                                };
                                console.log('🔍 DEBUG: Full payload:', JSON.stringify(payloadData, null, 2));
                                
                                const insertRes = await fetch('/api/inventory-management', {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify(payloadData),
                                });
                                
                                console.log('🔍 DEBUG: Response status =', insertRes.status);
                                const insertData = await insertRes.json();
                                console.log('📬 Inventory API Response:', insertData);
                                
                                if (insertRes.ok) {
                                  console.log('✅ Inventory inserted to', receiveLocationId, 'successfully');
                                  console.log('📊 Insert results:', insertData.results);
                                  
                                  // Log each insert result for debugging
                                  if (insertData.results && Array.isArray(insertData.results)) {
                                    insertData.results.forEach((result: any) => {
                                      if (result.success) {
                                        console.log(`  ✅ ${result.item_code}: ${result.action} qty=${result.qty || result.new_qty}`);
                                      } else {
                                        console.warn(`  ❌ ${result.item_code}: ${result.error}`);
                                      }
                                    });
                                  }
                                } else {
                                  console.warn('⚠️ Warning: Inventory insertion failed:', insertData.error);
                                  // Don't revert status - let user know but don't rollback
                                }
                              } catch (inventoryErr) {
                                console.error('❌ ERROR: Could not auto-insert inventory:', inventoryErr);
                                // Don't revert status - the main status change succeeded
                              }
                            }
                            
                            // Clear cache after status update
                            const year = parseInt(searchParams?.get('year') || String(new Date().getFullYear()));
                            try {
                              await fetch(`/api/inbound-records`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ year, action: 'clear' }),
                              });
                              
                              // Refetch records with fresh=true to bypass cache
                              const refreshUrl = `/api/inbound-records?year=${year}&refresh=true${warehouseFilter ? `&warehouse=${warehouseFilter}` : ''}`;
                              const refreshRes = await fetch(refreshUrl);
                              if (refreshRes.ok) {
                                const freshData = await refreshRes.json();
                                console.log('🔄 Refreshed ASN records after status update');
                                setHeaderRecords(freshData.headers || []);
                                setLineRecords(freshData.lines || []);
                                // Refresh grid to display the updated status
                                headerGridRef.current?.api?.refreshCells({ force: true });
                              }
                            } catch (err) {
                              console.log('Note: Cache clear/refresh completed');
                              // At minimum, refresh the grid cells
                              headerGridRef.current?.api?.refreshCells({ force: true });
                            }
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
      </div>
    </main>
  );
}
