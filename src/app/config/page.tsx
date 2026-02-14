"use client";
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getVendors, getCustomers, getItems, getWarehouses, getLocations } from './api';
import { useAuth } from '@/lib/auth-context';
import { ExcelImportModal } from '@/components/ExcelImportModal';
import { 
  parseExcelFile, 
  mapVendorData, 
  mapCustomerData, 
  mapItemData, 
  mapWarehouseData, 
  mapLocationData, 
  mapUserData, 
  bulkImportData 
} from '@/utils/excelImporter';

// Helper: POST to backend via API layer (avoids CSP violations)
async function postConfigData(url: string, data: any) {
  // Extract table name from URL
  // URL format: "http://172.31.39.68:8030/vendors" → "vendors"
  let tableName = url;
  if (url.includes('/')) {
    tableName = url.split('/').pop() || 'unknown';
  }
  
  // Use bulk-insert API route instead of patch-record to handle CSP properly
  const res = await fetch('/api/bulk-insert', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      table: tableName,
      data,
    }),
  });
  
  const text = await res.text();
  
  if (!res.ok) {
    console.error('API Error Response:', { status: res.status, body: text, payload: data });
    throw new Error(`Failed to add: ${res.status} - ${text}`);
  }
  
  if (!text) return {}; // Defensive: avoid JSON parse error on empty response
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// Helper: PATCH to backend (for editing) - uses API route
async function patchConfigData(url: string, id: number, data: any) {
  // Extract table name from URL
  // URL format: "https://..." or just endpoint name
  let tableName = url;
  if (url.includes('/')) {
    tableName = url.split('/').pop() || 'unknown';
  }
  
  // Remove id from payload if it exists (shouldn't update primary key)
  let { id: _, created_at: __, updated_at: ___, password_hash, ...updateData } = data;
  
  // For users: only include password_hash if it was explicitly provided
  if (tableName.includes('user') && password_hash && password_hash.trim()) {
    updateData.password_hash = password_hash;
  }
  
  // Use API route instead of direct PostgREST call
  const res = await fetch('/api/patch-record', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      table: tableName,
      id,
      data: updateData,
    }),
  });
  
  const text = await res.text();
  
  if (!res.ok) {
    console.error('API Error Response:', { status: res.status, body: text, payload: updateData });
    throw new Error(`Failed to update: ${res.status} - ${text}`);
  }
  
  if (!text) return {}; 
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// Helper: SOFT DELETE from backend (set is_active to false)
async function deleteConfigData(url: string, id: number) {
  // Extract table name from URL
  let tableName = url;
  if (url.includes('/')) {
    tableName = url.split('/').pop() || 'unknown';
  }
  
  // Use API route instead of direct PostgREST call
  const res = await fetch('/api/patch-record', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      table: tableName,
      id,
      data: { is_active: false },
    }),
  });
  
  if (!res.ok) {
    const text = await res.text();
    console.error('API Error Response:', { status: res.status, body: text });
    throw new Error(`Failed to deactivate: ${res.status} - ${text}`);
  }
  
  return { success: true };
}

const tabs = [
  { name: 'Vendors', key: 'vendors' },
  { name: 'Customers', key: 'customers' },
  { name: 'Items', key: 'items' },
  { name: 'Warehouses', key: 'warehouses' },
  { name: 'Locations', key: 'locations' },
  { name: 'Users', key: 'users' },
];

export default function ConfigPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const warehouseFilter = searchParams?.get('warehouse');
  const isAdmin = user?.role === 'Admin';
  
  const [activeTab, setActiveTab] = useState('vendors');
  const [vendors, setVendors] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [showAddForm, setShowAddForm] = useState<{ [key: string]: boolean }>({});
  const [formData, setFormData] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [subUserTab, setSubUserTab] = useState<'list' | 'warehouse' | 'page_permissions'>('list');
  const [userWarehouseSelection, setUserWarehouseSelection] = useState<{ [userId: number]: number[] }>({});
  const [userWarehouseAssignments, setUserWarehouseAssignments] = useState<{ [userId: number]: number[] }>({});
  const [warehouseAssignmentLoading, setWarehouseAssignmentLoading] = useState(false);
  const [selectedUserForPermissions, setSelectedUserForPermissions] = useState<any | null>(null);
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [userPagePermissions, setUserPagePermissions] = useState<{ [userId: number]: { [pageName: string]: string } }>({});
  const [cacheRefreshing, setCacheRefreshing] = useState(false);
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [showCacheRefresher, setShowCacheRefresher] = useState(false);
  const [selectedRows, setSelectedRows] = useState<{ [key: string]: Set<number> }>({});
  const [editingRecord, setEditingRecord] = useState<any | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [searchQueries, setSearchQueries] = useState<{ [key: string]: string }>({
    vendors: '',
    customers: '',
    items: '',
    locations: '',
    warehouses: '',
    users: '',
  });

  // Fetch cache stats
  const fetchCacheStats = async () => {
    try {
      const response = await fetch('/api/cache-control', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cache-Control-Key': process.env.NEXT_PUBLIC_CACHE_CONTROL_KEY || 'dev-key-123',
        },
        body: JSON.stringify({ action: 'stats' }),
      });
      if (response.ok) {
        const data = await response.json();
        setCacheStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch cache stats:', err);
    }
  };

  // Refresh all master data cache
  const refreshMasterDataCache = async () => {
    setCacheRefreshing(true);
    try {
      // Get current year
      const currentYear = new Date().getFullYear();

      // Clear ALL caches (both config and all transaction years)
      // First clear config cache
      await fetch('/api/cache-control', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cache-Control-Key': process.env.NEXT_PUBLIC_CACHE_CONTROL_KEY || 'dev-key-123',
        },
        body: JSON.stringify({ action: 'clear-all' }),
      });

      // Refresh all config data
      const [vendorData, customerData, itemData, warehouseData, locationData] = await Promise.all([
        getVendors(),
        getCustomers(),
        getItems(),
        getWarehouses(),
        getLocations(),
      ]);

      setVendors(vendorData);
      setCustomers(customerData);
      setItems(itemData);
      setWarehouses(warehouseData);
      setLocations(locationData);

      // Fetch updated cache stats
      await fetchCacheStats();

      setError(null);
      alert('✅ Master data refreshed successfully! All caches cleared.');
    } catch (err: any) {
      setError('Failed to refresh cache: ' + (err.message || 'Unknown error'));
    }
    setCacheRefreshing(false);
  };

  // Clear transaction caches (inbound, outbound, inventory, etc.)
  const clearTransactionCache = async () => {
    if (!confirm('Refresh transaction data? This will reload all Inbound, Outbound, Inventory, and ASN/SO data from the backend.')) return;
    
    setCacheRefreshing(true);
    try {
      const currentYear = new Date().getFullYear();
      await fetch('/api/cache-control', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cache-Control-Key': process.env.NEXT_PUBLIC_CACHE_CONTROL_KEY || 'dev-key-123',
        },
        body: JSON.stringify({ action: 'clear-year', year: currentYear }),
      });
      setCacheStats(null);
      setError(null);
      alert('✅ Transaction data refreshed successfully! All transaction caches cleared.');
    } catch (err: any) {
      setError('Failed to refresh transaction data: ' + (err.message || 'Unknown error'));
    }
    setCacheRefreshing(false);
  };

  useEffect(() => {
    async function fetchAll() {
      try {
        setVendors(await getVendors());
        setCustomers(await getCustomers());
        setItems(await getItems());
        setWarehouses(await getWarehouses());
        setLocations(await getLocations());
      } catch (err) {
        // Optionally handle error
      }
      // Use API routes instead of direct PostgREST calls
      const res = await fetch('/api/config-records?type=users&refresh=true');
      if (res.ok) setUsers(await res.json());
      
      // Fetch user warehouse assignments via API route
      const uwRes = await fetch('/api/user-warehouses?refresh=true');
      if (uwRes.ok) {
        const assignments = await uwRes.json();
        // Map to user-centric format: { userId: [warehouseId1, warehouseId2, ...] }
        const mapped: { [userId: number]: number[] } = {};
        assignments.forEach((uw: any) => {
          if (!mapped[uw.user_id]) mapped[uw.user_id] = [];
          mapped[uw.user_id].push(uw.warehouse_id);
        });
        setUserWarehouseAssignments(mapped);
      }
      
      // Fetch user page permissions via API route
      const upRes = await fetch('/api/config-records?type=permissions&refresh=true');
      if (upRes.ok) {
        const permissions = await upRes.json();
        // Map to user-centric format: { userId: { pageName: accessLevel } }
        const mapped: { [userId: number]: { [pageName: string]: string } } = {};
        permissions.forEach((up: any) => {
          if (!mapped[up.user_id]) mapped[up.user_id] = {};
          mapped[up.user_id][up.page_name] = up.access_level;
        });
        setUserPagePermissions(mapped);
      }
      
      // Fetch inventory via API route
      const invRes = await fetch('/api/config-records?type=inventory&refresh=true');
      if (invRes.ok) setInventory(await invRes.json());
    }
    fetchAll();
  }, []);

  // Endpoint mapping (from environment or fallback)
  const endpoints: any = {
    vendors: process.env.NEXT_PUBLIC_URL_VENDORS || 'http://172.31.39.68:8030/vendors',
    customers: process.env.NEXT_PUBLIC_URL_CUSTOMERS || 'http://172.31.39.68:8030/customers',
    items: process.env.NEXT_PUBLIC_URL_ITEMS || 'http://172.31.39.68:8030/items',
    warehouses: process.env.NEXT_PUBLIC_URL_WAREHOUSES || 'http://172.31.39.68:8030/warehouses',
    locations: process.env.NEXT_PUBLIC_URL_LOCATIONS || 'http://172.31.39.68:8030/locations',
    inventory: process.env.NEXT_PUBLIC_URL_INVENTORY || 'http://172.31.39.68:8030/inventory',
    users: process.env.NEXT_PUBLIC_URL_USERS || 'http://172.31.39.68:8030/users',
    user_warehouses: process.env.NEXT_PUBLIC_URL_USER_WAREHOUSES || 'http://172.31.39.68:8030/user_warehouses',
    user_permissions: process.env.NEXT_PUBLIC_URL_USER_PERMISSIONS || 'http://172.31.39.68:8030/user_permissions',
  };

  // Helper: Filter data by warehouse (Admin sees all, non-Admin sees only their warehouse)
  const getFilteredData = (data: any[], fieldName: string): any[] => {
    // Admin always sees all data
    if (isAdmin) return data;
    
    // For locations, filter by warehouse_id
    if (fieldName === 'locations' && warehouseFilter) {
      const warehouseId = parseInt(warehouseFilter);
      return data.filter((item: any) => item.warehouse_id === warehouseId);
    }
    
    // For other tables (vendors, customers, items), return all if no warehouse filter
    // In future, if these get warehouse_id field, we can filter them too
    return data;
  };

  // Form field definitions for each tab
  const formFields: any = {
    vendors: [
      { name: 'vendor_code', label: 'Vendor Code' },
      { name: 'vendor_name', label: 'Vendor Name' },
      { name: 'contact_person', label: 'Contact Person' },
      { name: 'address', label: 'Address' },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'tin', label: 'TIN' },
      { name: 'payment_terms', label: 'Payment Terms' },
      { name: 'delivery_terms', label: 'Delivery Terms' },
      { name: 'contact_number', label: 'Contact Number' },
    ],
    customers: [
      { name: 'customer_code', label: 'Customer Code' },
      { name: 'customer_name', label: 'Customer Name' },
      { name: 'contact_person', label: 'Contact Person' },
      { name: 'address', label: 'Address' },
      { name: 'phone', label: 'Phone' },
      { name: 'email', label: 'Email' },
      { name: 'tin', label: 'TIN' },
      { name: 'payment_terms', label: 'Payment Terms' },
      { name: 'delivery_terms', label: 'Delivery Terms' },
      { name: 'credit_limit', label: 'Credit Limit' },
    ],
    items: [
      { name: 'item_code', label: 'Item Code', type: 'text' },
      { name: 'item_name', label: 'Item Name', type: 'text' },
      { name: 'description', label: 'Description', type: 'text' },
      { name: 'item_uom', label: 'Item UOM', type: 'text' },
      { name: 'item_category', label: 'Item Category', type: 'text' },
      { name: 'item_group', label: 'Item Group', type: 'text' },
      { name: 'abc_classification', label: 'ABC Classification', type: 'text' },
      { name: 'length_cm', label: 'Length (cm)', type: 'number' },
      { name: 'width_cm', label: 'Width (cm)', type: 'number' },
      { name: 'height_cm', label: 'Height (cm)', type: 'number' },
      { name: 'volume_cbm', label: 'Volume (cbm)', type: 'number' },
      { name: 'pallet_height_cm', label: 'Pallet Height (cm)', type: 'number' },
      { name: 'stackable', label: 'Stackable', type: 'checkbox' },
      { name: 'max_stack_height', label: 'Max Stack Height', type: 'number' },
      { name: 'min_stock_level', label: 'Min Stock Level', type: 'number' },
      { name: 'max_stock_level', label: 'Max Stock Level', type: 'number' },
      { name: 'reorder_point', label: 'Reorder Point', type: 'number' },
      { name: 'batch_tracking', label: 'Batch Tracking', type: 'checkbox' },
      { name: 'serial_tracking', label: 'Serial Tracking', type: 'checkbox' },
      { name: 'expiry_tracking', label: 'Expiry Tracking', type: 'checkbox' },
      { name: 'shelf_life_days', label: 'Shelf Life (days)', type: 'number' },
      { name: 'is_perishable', label: 'Is Perishable', type: 'checkbox' },
      { name: 'allocation_rule', label: 'Allocation Rule', type: 'select', options: ['FIFO', 'FEFO', 'LOT', 'Manual'] },
      { name: 'picking_method', label: 'Picking Method', type: 'select', options: ['Single-bin', 'Multi-bin', 'Zone picking'] },
      { name: 'brand', label: 'Brand', type: 'text' },
      { name: 'color', label: 'Color', type: 'text' },
      { name: 'weight_uom_kg', label: 'Weight UOM (kg)', type: 'number' },
      { name: 'pallet_config', label: 'Pallet Config', type: 'text' },
    ],
    warehouses: [
      { name: 'warehouse_code', label: 'Warehouse Code' },
      { name: 'warehouse_name', label: 'Warehouse Name' },
      { name: 'address', label: 'Address' },
      { name: 'contact_person', label: 'Contact Person' },
      { name: 'phone', label: 'Phone' },
    ],
    locations: [
      { name: 'warehouse_id', label: 'Warehouse ID' },
      { name: 'location_code', label: 'Location Code' },
      { name: 'location_name', label: 'Location Name' },
      { name: 'location_type', label: 'Location Type' },
      { name: 'zone', label: 'Zone' },
      { name: 'aisle', label: 'Aisle' },
      { name: 'rack', label: 'Rack' },
      { name: 'level', label: 'Level' },
      { name: 'bin', label: 'Bin' },
      { name: 'max_weight_kg', label: 'Max Weight (kg)' },
      { name: 'max_volume_cbm', label: 'Max Volume (cbm)' },
      { name: 'max_pallets', label: 'Max Pallets' },
      { name: 'temperature_controlled', label: 'Temperature Controlled' },
      { name: 'hazmat_approved', label: 'Hazmat Approved' },
      { name: 'warehouse_code', label: 'Warehouse Code' },
      { name: 'description', label: 'Description' },
    ],
    users: [
      { name: 'username', label: 'Username' },
      { name: 'email', label: 'Email' },
      { name: 'full_name', label: 'Full Name' },
      { name: 'password_hash', label: 'Password', type: 'password', placeholder: 'Leave empty to generate temporary password' },
      { name: 'role', label: 'Role', type: 'select', options: ['Admin', 'Manager', 'Supervisor', 'Operator', 'Viewer'] },
    ],
  };

  // Helper function to filter data based on search query
  function filterData(data: any[], query: string, searchableFields: string[]): any[] {
    if (!query.trim()) return data;
    const lowerQuery = query.toLowerCase();
    return data.filter(item =>
      searchableFields.some(field =>
        String(item[field] || '').toLowerCase().includes(lowerQuery)
      )
    );
  }

  // Handle form field change
  function handleFormChange(tab: string, field: string, value: any) {
    setFormData((prev: any) => ({ ...prev, [tab]: { ...prev[tab], [field]: value } }));
  }

  // Handle form submit
  async function handleFormSubmit(tab: string) {
    setLoading(true);
    setError(null);
    if (!endpoints[tab]) {
      setError('API endpoint for this tab is not defined in .env.local.');
      setLoading(false);
      return;
    }
    try {
      let payload = formData[tab];
      
      // Remove company_id for customers POST
      if (tab === 'customers') {
        const { company_id, ...rest } = payload;
        payload = rest;
      }
      
      // Handle password hashing for users
      if (tab === 'users') {
        // If no password provided, generate a temporary one via API
        if (!payload.password_hash || payload.password_hash.trim() === '') {
          const tempRes = await fetch('/api/auth/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          const tempData = await tempRes.json();
          payload.password_hash = tempData.temporaryPassword;
          console.warn('Temporary password generated. User should change on first login.');
        } else {
          // Hash the password using the API
          const hashRes = await fetch('/api/auth/password/hash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: payload.password_hash }),
          });
          if (!hashRes.ok) {
            throw new Error('Failed to hash password');
          }
          const hashData = await hashRes.json();
          payload.password_hash = hashData.hash;
        }
      }
      
      const result = await postConfigData(endpoints[tab], payload);
      console.log('✅ Record added successfully:', result);
      
      // Clear cache to ensure fresh data
      await fetch('/api/config-records', { method: 'POST', body: JSON.stringify({ action: 'clear' }) }).catch(err => console.log('Cache clear:', err));
      
      // Add a small delay to ensure cache is cleared
      await new Promise(resolve => setTimeout(resolve, 100));
      
      setShowAddForm((prev: any) => ({ ...prev, [tab]: false }));
      setFormData((prev: any) => ({ ...prev, [tab]: {} }));
      setError(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      
      // Refresh data with force refresh param to bypass cache
      if (tab === 'vendors') setVendors(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.vendors));
      if (tab === 'customers') setCustomers(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.customers));
      if (tab === 'items') setItems(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.items));
      if (tab === 'warehouses') setWarehouses(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.warehouses));
      if (tab === 'locations') setLocations(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.locations));
      if (tab === 'users') {
        const res = await fetch('/api/config-records?type=users');
        if (res.ok) setUsers(await res.json());
      }
    } catch (err: any) {
      console.error('❌ Error adding record:', err);
      setError(err.message || 'Failed to add record');
    }
    setLoading(false);
  }

  // Handle Edit - open modal with record data
  const handleEdit = (tab: string, record: any) => {
    setEditingRecord({ tab, data: { ...record } });
    setShowEditModal(true);
  };

  // Handle Update - save edited record to backend
  const handleUpdateRecord = async () => {
    if (!editingRecord) return;
    
    setLoading(true);
    setError(null);
    try {
      const { tab, data } = editingRecord;
      console.log('📝 Updating record in', tab, 'with id:', data.id);
      
      // Remove company_id for customers
      if (tab === 'customers') {
        const { company_id, ...rest } = data;
        await patchConfigData(endpoints[tab], data.id, rest);
      } else {
        await patchConfigData(endpoints[tab], data.id, data);
      }

      console.log('✅ Record updated successfully');
      
      // Clear cache to ensure fresh data
      await fetch('/api/config-records', { method: 'POST', body: JSON.stringify({ action: 'clear' }) }).catch(err => console.log('Cache clear:', err));
      
      // Add a small delay to ensure cache is cleared
      await new Promise(resolve => setTimeout(resolve, 100));

      // Refresh data with force refresh param to bypass cache
      if (tab === 'vendors') setVendors(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.vendors));
      if (tab === 'customers') setCustomers(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.customers));
      if (tab === 'items') setItems(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.items));
      if (tab === 'warehouses') setWarehouses(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.warehouses));
      if (tab === 'locations') setLocations(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.locations));
      if (tab === 'users') {
        const res = await fetch('/api/config-records?type=users');
        if (res.ok) setUsers(await res.json());
      }

      setShowEditModal(false);
      setEditingRecord(null);
      setError(null);
      // Clear search queries to show all records and ensure edited item is visible
      setSearchQueries({
        vendors: '',
        customers: '',
        items: '',
        locations: '',
        warehouses: '',
        users: '',
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('❌ Error updating record:', err);
      setError(err.message || 'Failed to update record');
    }
    setLoading(false);
  };

  // Handle Deactivate - single record
  const handleDeleteRecord = async (tab: string, id: number, recordName: string = '') => {
    if (!confirm(`Deactivate ${recordName || `${tab} record`}? The record will be hidden but can be restored.`)) return;

    setLoading(true);
    setError(null);
    try {
      console.log('🗑️ Deactivating', tab, 'record id:', id);
      await deleteConfigData(endpoints[tab], id);
      console.log('✅ Record deactivated successfully');

      // Clear cache to ensure fresh data
      await fetch('/api/config-records', { method: 'POST', body: JSON.stringify({ action: 'clear' }) }).catch(err => console.log('Cache clear:', err));

      // Refresh data
      if (tab === 'vendors') setVendors(await getVendors());
      if (tab === 'customers') setCustomers(await getCustomers());
      if (tab === 'items') setItems(await getItems());
      if (tab === 'warehouses') setWarehouses(await getWarehouses());
      if (tab === 'locations') setLocations(await getLocations());
      if (tab === 'users') {
        const res = await fetch('/api/config-records?type=users');
        if (res.ok) setUsers(await res.json());
      }

      setError(null);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error('❌ Error deactivating record:', err);
      setError(err.message || 'Failed to deactivate record');
    }
    setLoading(false);
  };

  // Handle Activate Record
  const handleActivateRecord = async (tab: string, id: number, name: string) => {
    if (!confirm(`Activate this ${tab.slice(0, -1)} record? It will be visible again.`)) return;

    setLoading(true);
    setError(null);
    try {
      console.log('✨ Activating', tab, 'record id:', id);
      
      const endpoint = endpoints[tab];
      const payload = { is_active: true };
      
      await patchConfigData(endpoint, id, payload);

      // Clear cache
      await fetch('/api/config-records', { method: 'POST', body: JSON.stringify({ action: 'clear' }) }).catch(err => console.log('Cache clear:', err));
      
      // Add a small delay to ensure cache is cleared
      await new Promise(resolve => setTimeout(resolve, 100));

      // Refresh data with force refresh param to bypass cache
      if (tab === 'vendors') setVendors(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.vendors));
      if (tab === 'customers') setCustomers(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.customers));
      if (tab === 'items') setItems(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.items));
      if (tab === 'warehouses') setWarehouses(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.warehouses));
      if (tab === 'locations') setLocations(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.locations));
      if (tab === 'users') {
        const res = await fetch('/api/config-records?type=users');
        if (res.ok) setUsers(await res.json());
      }

      console.log(`✅ Successfully activated ${name}`);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      setError(null);
    } catch (err: any) {
      console.error('❌ Error activating record:', err);
      setError(err.message || 'Failed to activate record');
    }
    setLoading(false);
  };

  // Handle Toggle Selection
  const toggleRowSelection = (tab: string, id: number) => {
    setSelectedRows(prev => {
      const tabSet = prev[tab] || new Set();
      const newSet = new Set(tabSet);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { ...prev, [tab]: newSet };
    });
  };

  // Handle Select All
  const toggleSelectAll = (tab: string, data: any[]) => {
    setSelectedRows(prev => {
      const tabSet = prev[tab] || new Set();
      const allIds = new Set(data.map(d => d.id));
      
      // If all are selected, deselect all; otherwise select all
      if (tabSet.size === allIds.size) {
        return { ...prev, [tab]: new Set() };
      } else {
        return { ...prev, [tab]: allIds };
      }
    });
  };

  // Handle Deactivate Selected
  const handleDeleteSelected = async (tab: string, data: any[]) => {
    const selected = selectedRows[tab] || new Set();
    if (selected.size === 0) {
      setError('No records selected for deactivation');
      return;
    }

    if (!confirm(`Deactivate ${selected.size} selected record(s)? These records will be hidden but can be restored.`)) return;

    setLoading(true);
    setError(null);
    try {
      let deletedCount = 0;
      let failedCount = 0;

      for (const id of selected) {
        try {
          console.log('🗑️ Deactivating', tab, 'record id:', id);
          await deleteConfigData(endpoints[tab], id);
          deletedCount++;
        } catch (err) {
          console.error(`❌ Failed to deactivate record ${id}:`, err);
          failedCount++;
        }
      }

      // Clear cache to ensure fresh data
      await fetch('/api/config-records', { method: 'POST', body: JSON.stringify({ action: 'clear' }) }).catch(err => console.log('Cache clear:', err));
      
      // Add a small delay to ensure cache is cleared
      await new Promise(resolve => setTimeout(resolve, 100));

      // Refresh data with force refresh param to bypass cache
      if (tab === 'vendors') setVendors(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.vendors));
      if (tab === 'customers') setCustomers(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.customers));
      if (tab === 'items') setItems(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.items));
      if (tab === 'warehouses') setWarehouses(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.warehouses));
      if (tab === 'locations') setLocations(await fetch('/api/config-records?refresh=true').then(r => r.json()).then(d => d.locations));
      if (tab === 'users') {
        const res = await fetch('/api/config-records?type=users');
        if (res.ok) setUsers(await res.json());
      }

      setSelectedRows(prev => ({ ...prev, [tab]: new Set() }));
      
      if (failedCount === 0) {
        console.log(`✅ Successfully deactivated ${deletedCount} records`);
        setError(null);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        console.log(`⚠️ Deactivated ${deletedCount} records. Failed to deactivate ${failedCount} records.`);
        setError(`Deactivated ${deletedCount} records. Failed to deactivate ${failedCount} records.`);
      }
    } catch (err: any) {
      console.error('❌ Error deactivating records:', err);
      setError(err.message || 'Failed to deactivate records');
    }
    setLoading(false);
  };

  // Handle Excel Import
  const handleExcelImport = async (file: File) => {
    setImportLoading(true);
    setImportMessage(null);
    try {
      // Parse Excel file
      const excelData = await parseExcelFile(file);
      const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
      
      // Get the first sheet data or use tab name
      const sheetName = Object.keys(excelData)[0];
      const rawData = excelData[sheetName] || [];

      if (rawData.length === 0) {
        throw new Error('No data found in Excel file');
      }

      // Map data based on active tab
      let mappedData: any[] = [];
      let endpoint = '';

      switch (activeTab) {
        case 'vendors':
          mappedData = mapVendorData(rawData);
          endpoint = endpoints.vendors;
          break;
        case 'customers':
          mappedData = mapCustomerData(rawData);
          endpoint = endpoints.customers;
          break;
        case 'items':
          mappedData = mapItemData(rawData);
          endpoint = endpoints.items;
          break;
        case 'warehouses':
          mappedData = mapWarehouseData(rawData);
          endpoint = endpoints.warehouses;
          break;
        case 'locations':
          mappedData = mapLocationData(rawData);
          endpoint = endpoints.locations;
          break;
        case 'users':
          mappedData = mapUserData(rawData);
          endpoint = (process.env.NEXT_PUBLIC_URL_USERS || 'http://172.31.39.68:8030/users').replace(/^https?:\/\//, 'http://');
          break;
        default:
          throw new Error('Unknown tab');
      }

      // Bulk import data
      const result = await bulkImportData(endpoint, mappedData, apiKey);

      // Clear config cache to ensure fresh data
      await fetch('/api/config-records', { 
        method: 'POST', 
        body: JSON.stringify({ action: 'clear' }),
        headers: { 'Content-Type': 'application/json' }
      }).catch(() => {});

      // Refresh data
      if (activeTab === 'vendors') setVendors(await getVendors());
      if (activeTab === 'customers') setCustomers(await getCustomers());
      if (activeTab === 'items') setItems(await getItems());
      if (activeTab === 'warehouses') setWarehouses(await getWarehouses());
      if (activeTab === 'locations') setLocations(await getLocations());
      if (activeTab === 'users') {
        const res = await fetch('/api/config-records?type=users');
        if (res.ok) setUsers(await res.json());
      }

      const message = `✅ Import complete! ${result.success} added, ${result.skipped} skipped (duplicates), ${result.failed} failed.`;
      setImportMessage({ type: 'success', text: message });
      console.log('Import result:', result);
      
      // Close modal after successful import
      setTimeout(() => {
        setShowImportModal(false);
      }, 500);
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : 'Import failed';
      setImportMessage({ type: 'error', text: `❌ ${errorMsg}` });
      console.error('Import error:', err);
    }
    setImportLoading(false);
  };

  // Add form UI
  function renderAddForm(tab: string) {
    if (!formFields[tab]) {
      return <div className="mb-4 p-4 border rounded bg-gray-50 text-red-600">No form fields defined for this tab.</div>;
    }
    return (
      <div className="mb-4 p-3 sm:p-4 border rounded bg-gray-50 overflow-x-auto">
        <h3 className="font-bold mb-2 text-sm sm:text-base">Add {tabs.find(t => t.key === tab)?.name}</h3>
        <form onSubmit={e => { e.preventDefault(); handleFormSubmit(tab); }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 mb-3">
            {formFields[tab].map((field: any) => (
              <div key={field.name}>
                <label className="block text-xs font-semibold mb-1">{field.label}</label>
                {field.type === 'checkbox' ? (
                  <input
                    className="border px-2 py-1 rounded w-6 h-6 text-xs"
                    type="checkbox"
                    checked={formData[tab]?.[field.name] || false}
                    onChange={e => handleFormChange(tab, field.name, e.target.checked)}
                  />
                ) : field.type === 'select' ? (
                  <select
                    className="border px-2 py-1 rounded w-full text-xs"
                    value={formData[tab]?.[field.name] || ''}
                    onChange={e => handleFormChange(tab, field.name, e.target.value)}
                  >
                    <option value="">-- Select --</option>
                    {field.options?.map((opt: string) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="border px-2 py-1 rounded w-full text-xs"
                    type={field.type || 'text'}
                    value={formData[tab]?.[field.name] || ''}
                    onChange={e => handleFormChange(tab, field.name, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
          {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
          <button type="submit" className="px-4 py-1 text-white rounded text-xs font-bold" style={{ backgroundColor: '#008ecc' }} disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </button>
          <button type="button" className="ml-2 px-4 py-1 bg-gray-400 text-white rounded text-xs font-bold" onClick={() => setShowAddForm((prev: any) => ({ ...prev, [tab]: false }))}>
            Cancel
          </button>
        </form>
      </div>
    );
  }

  // Download items as CSV
  function downloadItemsCSV() {
    if (items.length === 0) {
      alert('No items to download');
      return;
    }
    const headers = ['ID', 'Item Code', 'Item Name', 'Description', 'Item UOM', 'Category', 'Group', 'ABC Class', 'Length', 'Width', 'Height', 'Volume', 'Pallet Height (cm)', 'Stackable', 'Batch Tracking', 'Expiry Tracking', 'Shelf Life', 'Is Perishable', 'Allocation Rule', 'Picking Method', 'Brand', 'Color', 'Active'];
    const rows = items.map(item => [
      item.id,
      item.item_code,
      item.item_name,
      item.description || '',
      item.item_uom || '',
      item.item_category || '',
      item.item_group || '',
      item.abc_classification || '',
      item.length_cm || '',
      item.width_cm || '',
      item.height_cm || '',
      item.volume_cbm || '',
      item.pallet_height_cm || '',
      item.stackable ? 'Yes' : 'No',
      item.batch_tracking ? 'Yes' : 'No',
      item.expiry_tracking ? 'Yes' : 'No',
      item.shelf_life_days || '',
      item.is_perishable ? 'Yes' : 'No',
      item.allocation_rule || 'FIFO',
      item.picking_method || 'Single-bin',
      item.brand || '',
      item.color || '',
      item.is_active ? 'Yes' : 'No',
    ]);
    const csv = [headers, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `items_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // Generic CSV download for vendors, customers, warehouses, locations, users
  function downloadConfigCSV(data: any[], filename: string, headers: string[], getRow: (item: any) => any[]) {
    if (data.length === 0) {
      alert(`No data to download`);
      return;
    }
    const rows = data.map(item => getRow(item));
    const csv = [headers, ...rows].map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  function handleDownloadCSV() {
    if (activeTab === 'vendors') {
      downloadConfigCSV(
        vendors,
        'vendors',
        ['ID', 'Vendor Code', 'Vendor Name', 'Email', 'Phone', 'Address', 'City', 'State', 'Country', 'Postal Code', 'Active'],
        (v) => [v.id, v.vendor_code, v.vendor_name, v.email || '', v.phone || '', v.address || '', v.city || '', v.state || '', v.country || '', v.postal_code || '', v.is_active ? 'Yes' : 'No']
      );
    } else if (activeTab === 'customers') {
      downloadConfigCSV(
        customers,
        'customers',
        ['ID', 'Customer Code', 'Customer Name', 'Email', 'Phone', 'Address', 'City', 'State', 'Country', 'Postal Code', 'Credit Limit', 'Active'],
        (c) => [c.id, c.customer_code, c.customer_name, c.email || '', c.phone || '', c.address || '', c.city || '', c.state || '', c.country || '', c.postal_code || '', c.credit_limit || '', c.is_active ? 'Yes' : 'No']
      );
    } else if (activeTab === 'warehouses') {
      downloadConfigCSV(
        warehouses,
        'warehouses',
        ['ID', 'Warehouse Code', 'Warehouse Name', 'Address', 'City', 'State', 'Country', 'Postal Code', 'Phone', 'Manager Name', 'Active'],
        (w) => [w.id, w.warehouse_code, w.warehouse_name, w.address || '', w.city || '', w.state || '', w.country || '', w.postal_code || '', w.phone || '', w.manager_name || '', w.is_active ? 'Yes' : 'No']
      );
    } else if (activeTab === 'locations') {
      downloadConfigCSV(
        locations,
        'locations',
        ['ID', 'Location Code', 'Location Name', 'Warehouse ID', 'Zone', 'Aisle', 'Rack', 'Bin', 'Level', 'Type', 'Capacity', 'Active'],
        (l) => [l.id, l.location_code, l.location_name, l.warehouse_id || '', l.zone || '', l.aisle || '', l.rack || '', l.bin || '', l.level || '', l.location_type || '', l.capacity || '', l.is_active ? 'Yes' : 'No']
      );
    } else if (activeTab === 'items') {
      downloadItemsCSV();
    } else if (activeTab === 'users') {
      downloadConfigCSV(
        users,
        'users',
        ['ID', 'Username', 'Email', 'Full Name', 'Role', 'Warehouse ID', 'Active'],
        (u) => [u.id, u.username, u.email || '', u.full_name || '', u.role || '', u.warehouse_id || '', u.is_active ? 'Yes' : 'No']
      );
    }
  }

  return (
    <main className="p-8 bg-gray-100 min-h-screen">
      <h1 className="text-3xl font-bold mb-6 text-gray-900">Configuration</h1>
      <div className="mb-6 flex gap-4 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`px-4 py-2 rounded font-semibold border-b-2 ${activeTab === tab.key ? 'border-blue-600 text-blue-600 bg-white shadow' : 'border-transparent text-gray-700 bg-gray-200'}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.name}
          </button>
        ))}
        <button
          className={`px-4 py-2 rounded font-semibold border-b-2 border-transparent text-gray-700 bg-gray-200 hover:bg-green-100 transition flex items-center gap-2`}
          onClick={() => {
            setShowCacheRefresher(!showCacheRefresher);
            if (!showCacheRefresher && !cacheStats) {
              fetchCacheStats();
            }
          }}
        >
          🔄 Cache Control
        </button>
      </div>

      {/* Warehouse Filter Status */}
      {!isAdmin && warehouseFilter && (activeTab === 'locations' || activeTab === 'vendors' || activeTab === 'customers' || activeTab === 'items') && (
        <div className="mb-4 p-3 rounded bg-blue-50 border border-blue-200 text-blue-800 text-sm font-semibold">
          📍 Showing {activeTab === 'locations' ? 'locations for' : 'all'} warehouse: <strong>{warehouseFilter}</strong>
          {activeTab === 'locations' && ' (Non-Admin users see only their assigned warehouse)'}
        </div>
      )}

      {/* Master Data Refresher Section */}
      {showCacheRefresher && (
        <div className="mb-6 bg-gradient-to-r from-green-50 to-blue-50 p-6 rounded-lg border-2 border-green-300 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-green-900">🔄 Master Data Refresher</h2>
            <button
              className="text-gray-500 hover:text-gray-700 text-2xl"
              onClick={() => setShowCacheRefresher(false)}
            >
              ✕
            </button>
          </div>

          <p className="text-gray-700 mb-4">
            Manage server-side cache for master data (Vendors, Customers, Items, Warehouses, Locations). Data is stored securely on the server, not in your browser.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <button
              onClick={refreshMasterDataCache}
              disabled={cacheRefreshing}
              className={`px-6 py-3 rounded font-bold text-white transition flex items-center justify-center gap-2 ${
                cacheRefreshing
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {cacheRefreshing ? '⏳ Refreshing...' : '🔄 Refresh Master Data'}
            </button>

            <button
              onClick={clearTransactionCache}
              disabled={cacheRefreshing}
              className={`px-6 py-3 rounded font-bold text-white transition flex items-center justify-center gap-2 ${
                cacheRefreshing
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-orange-600 hover:bg-orange-700'
              }`}
            >
              {cacheRefreshing ? '⏳ Refreshing...' : '🔄 Refresh Transaction Data'}
            </button>

            <button
              onClick={fetchCacheStats}
              disabled={cacheRefreshing}
              className={`px-6 py-3 rounded font-bold text-white transition flex items-center justify-center gap-2 ${
                cacheRefreshing
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {cacheRefreshing ? '⏳ Loading...' : '📊 View Cache Stats'}
            </button>
          </div>

          {/* Cache Stats Display */}
          {cacheStats && (
            <div className="bg-white p-4 rounded-lg border border-gray-300 mb-4">
              <h3 className="text-lg font-bold text-gray-900 mb-4">📊 Cache Statistics</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 p-4 rounded border border-blue-200">
                  <p className="text-xs text-blue-600 font-semibold uppercase mb-2">Keys Count</p>
                  <p className="text-3xl font-bold text-blue-900">{cacheStats.keys?.length || 0}</p>
                  <p className="text-xs text-gray-600 mt-1">Total cached items</p>
                </div>
                
                <div className="bg-green-50 p-4 rounded border border-green-200">
                  <p className="text-xs text-green-600 font-semibold uppercase mb-2">Hits</p>
                  <p className="text-3xl font-bold text-green-900">{cacheStats.hits || 0}</p>
                  <p className="text-xs text-gray-600 mt-1">Successful cache reads</p>
                </div>
                
                <div className="bg-orange-50 p-4 rounded border border-orange-200">
                  <p className="text-xs text-orange-600 font-semibold uppercase mb-2">Misses</p>
                  <p className="text-3xl font-bold text-orange-900">{cacheStats.misses || 0}</p>
                  <p className="text-xs text-gray-600 mt-1">Cache fetch failures</p>
                </div>
                
                <div className="bg-purple-50 p-4 rounded border border-purple-200">
                  <p className="text-xs text-purple-600 font-semibold uppercase mb-2">Hit Rate</p>
                  <p className="text-3xl font-bold text-purple-900">
                    {cacheStats.hits && (cacheStats.hits + cacheStats.misses) > 0 
                      ? ((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(1) 
                      : '0'}%
                  </p>
                  <p className="text-xs text-gray-600 mt-1">Cache efficiency</p>
                </div>
              </div>

              {cacheStats.keys && cacheStats.keys.length > 0 && (
                <div className="mt-6 bg-gray-50 p-4 rounded border border-gray-200">
                  <h4 className="font-semibold text-gray-900 mb-3">🔑 Cached Keys:</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {cacheStats.keys.map((key: string) => (
                      <div key={key} className="flex items-center justify-between bg-white p-2 rounded border border-gray-100 text-xs">
                        <span className="font-mono text-gray-700">{key}</span>
                        <span className="text-gray-500">← cached</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          
          {success && (
            <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
              ✅ Operation completed successfully!
            </div>
          )}
        </div>
      )}

      <div className="bg-white p-6 rounded-lg border shadow">
        {/* Add button and form for each tab */}
        <div className="mb-4 flex gap-2 flex-wrap">
          <button
            className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90"
            style={{ backgroundColor: '#008ecc' }}
            onClick={() => setShowAddForm((prev: any) => ({ ...prev, [activeTab]: true }))}
          >
            + Add {tabs.find(t => t.key === activeTab)?.name}
          </button>
          <button
            className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90"
            style={{ backgroundColor: '#008ecc' }}
            onClick={() => setShowImportModal(true)}
          >
            📥 Import from Excel
          </button>
          <button
            className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90"
            style={{ backgroundColor: '#10b981' }}
            onClick={handleDownloadCSV}
            title="Download current tab as CSV"
          >
            ⬇️ Download CSV
          </button>
          
          {/* Select All and Deactivate Selected for all tabs */}
          {(
            <>
              <button
                className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90"
                style={{ backgroundColor: '#6366f1' }}
                onClick={() => {
                  const data = 
                    activeTab === 'vendors' ? vendors :
                    activeTab === 'customers' ? customers :
                    activeTab === 'items' ? items :
                    activeTab === 'warehouses' ? warehouses :
                    activeTab === 'locations' ? locations :
                    activeTab === 'users' ? users : [];
                  toggleSelectAll(activeTab, data);
                }}
              >
                ☑️ Select All
              </button>
              <button
                className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#ef4444' }}
                disabled={(selectedRows[activeTab] || new Set()).size === 0}
                onClick={() => {
                  const data = 
                    activeTab === 'vendors' ? vendors :
                    activeTab === 'customers' ? customers :
                    activeTab === 'items' ? items :
                    activeTab === 'warehouses' ? warehouses :
                    activeTab === 'locations' ? locations :
                    activeTab === 'users' ? users : [];
                  handleDeleteSelected(activeTab, data);
                }}
              >
                🗑️ Deactivate Selected ({(selectedRows[activeTab] || new Set()).size})
              </button>
            </>
          )}
        </div>

        {/* Import Message */}
        {importMessage && (
          <div className={`mb-4 p-3 rounded text-sm font-semibold ${
            importMessage.type === 'success' 
              ? 'bg-green-50 border border-green-200 text-green-700' 
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {importMessage.text}
          </div>
        )}

        {/* Import Modal */}
        <ExcelImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImport={handleExcelImport}
          tabName={tabs.find(t => t.key === activeTab)?.name || activeTab}
          tabKey={activeTab}
          isLoading={importLoading}
        />

        {showAddForm[activeTab] && renderAddForm(activeTab)}
        {activeTab === 'vendors' && (
          <div>
            <div className="mb-4 flex gap-2 flex-wrap">
              <button
                className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90"
                style={{ backgroundColor: '#008ecc' }}
                onClick={async () => {
                  setLoading(true);
                  setError(null);
                  try {
                    const data = await getVendors();
                    setVendors(data);
                  } catch (err: any) {
                    setError(err.message || 'Failed to fetch vendors');
                  }
                  setLoading(false);
                }}
              >
                🔄 Refresh
              </button>
              <input
                type="text"
                placeholder="🔍 Search vendors (code, name, contact...)"
                className="px-4 py-2 border border-gray-300 rounded text-sm flex-grow max-w-md"
                value={searchQueries.vendors}
                onChange={(e) => setSearchQueries(prev => ({ ...prev, vendors: e.target.value }))}
              />
            </div>
            <h2 className="text-xl font-bold mb-4">Vendors List</h2>
            {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
            <div style={{ maxHeight: 400, overflow: 'auto', minWidth: '100%' }}>
              <table className="min-w-full border bg-white rounded-lg shadow text-xs" style={{ minWidth: 1300 }}>
                <thead>
                  <tr className="bg-gray-200 text-gray-900 sticky top-0">
                    <th className="border px-2 py-1 w-12">
                      <input
                        type="checkbox"
                        checked={(selectedRows['vendors'] || new Set()).size === filterData(vendors, searchQueries.vendors, ['vendor_code', 'vendor_name', 'contact_person', 'email']).length && vendors.length > 0}
                        onChange={() => toggleSelectAll('vendors', filterData(vendors, searchQueries.vendors, ['vendor_code', 'vendor_name', 'contact_person', 'email']))}
                      />
                    </th>
                    <th className="border px-2 py-1">Actions</th>
                    <th className="border px-2 py-1">ID</th>
                    <th className="border px-2 py-1">Vendor Code</th>
                    <th className="border px-2 py-1">Vendor Name</th>
                    <th className="border px-2 py-1">Contact Person</th>
                    <th className="border px-2 py-1">Address</th>
                    <th className="border px-2 py-1">Phone</th>
                    <th className="border px-2 py-1">Email</th>
                    <th className="border px-2 py-1">TIN</th>
                    <th className="border px-2 py-1">Payment Terms</th>
                    <th className="border px-2 py-1">Delivery Terms</th>
                    <th className="border px-2 py-1">Is Active</th>
                    <th className="border px-2 py-1">Created At</th>
                    <th className="border px-2 py-1">Contact Number</th>
                  </tr>
                </thead>
                <tbody>
                  {filterData(vendors, searchQueries.vendors, ['vendor_code', 'vendor_name', 'contact_person', 'email']).map(vendor => (
                    <tr key={vendor.id} className={!vendor.is_active ? 'bg-gray-100 opacity-60' : ''}>
                      <td className="border px-2 py-1">
                        <input
                          type="checkbox"
                          checked={(selectedRows['vendors'] || new Set()).has(vendor.id)}
                          onChange={() => toggleRowSelection('vendors', vendor.id)}
                        />
                      </td>
                      <td className="border px-2 py-1 whitespace-nowrap flex gap-1">
                        <button
                          className="px-2 py-1 bg-blue-500 text-white rounded text-xs font-bold hover:bg-blue-600"
                          onClick={() => handleEdit('vendors', vendor)}
                        >
                          Edit
                        </button>
                        {vendor.is_active ? (
                          <button
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                            onClick={() => handleDeleteRecord('vendors', vendor.id, vendor.vendor_name)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <>
                            <button
                              className="px-2 py-1 bg-green-500 text-white rounded text-xs font-bold hover:bg-green-600"
                              onClick={() => handleActivateRecord('vendors', vendor.id, vendor.vendor_name)}
                            >
                              Activate
                            </button>
                            <button
                              className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                              onClick={() => handleDeleteRecord('vendors', vendor.id, vendor.vendor_name)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                      <td className="border px-2 py-1">{vendor.id}</td>
                      <td className="border px-2 py-1">{vendor.vendor_code}</td>
                      <td className="border px-2 py-1">{vendor.vendor_name}</td>
                      <td className="border px-2 py-1">{vendor.contact_person}</td>
                      <td className="border px-2 py-1">{vendor.address}</td>
                      <td className="border px-2 py-1">{vendor.phone}</td>
                      <td className="border px-2 py-1">{vendor.email}</td>
                      <td className="border px-2 py-1">{vendor.tin}</td>
                      <td className="border px-2 py-1">{vendor.payment_terms}</td>
                      <td className="border px-2 py-1">{vendor.delivery_terms}</td>
                      <td className="border px-2 py-1">{String(vendor.is_active)}</td>
                      <td className="border px-2 py-1">{vendor.created_at}</td>
                      <td className="border px-2 py-1">{vendor.contact_number}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'customers' && (
          <div>
            <div className="mb-4 flex gap-2 flex-wrap">
              <button
                className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90"
                style={{ backgroundColor: '#008ecc' }}
                onClick={async () => {
                  setLoading(true);
                  setError(null);
                  try {
                    const data = await getCustomers();
                    setCustomers(data);
                  } catch (err: any) {
                    setError(err.message || 'Failed to fetch customers');
                  }
                  setLoading(false);
                }}
              >
                🔄 Refresh
              </button>
              <input
                type="text"
                placeholder="🔍 Search customers (code, name, contact...)"
                className="px-4 py-2 border border-gray-300 rounded text-sm flex-grow max-w-md"
                value={searchQueries.customers}
                onChange={(e) => setSearchQueries(prev => ({ ...prev, customers: e.target.value }))}
              />
            </div>
            <h2 className="text-xl font-bold mb-4">Customers List</h2>
            {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
            <div style={{ maxHeight: 400, overflow: 'auto', minWidth: '100%' }}>
              <table className="min-w-full border bg-white rounded-lg shadow text-xs" style={{ minWidth: 1300 }}>
                <thead>
                  <tr className="bg-gray-200 text-gray-900 sticky top-0">
                    <th className="border px-2 py-1 w-12">
                      <input
                        type="checkbox"
                        checked={(selectedRows['customers'] || new Set()).size === filterData(customers, searchQueries.customers, ['customer_code', 'customer_name', 'contact_person', 'email']).length && customers.length > 0}
                        onChange={() => toggleSelectAll('customers', filterData(customers, searchQueries.customers, ['customer_code', 'customer_name', 'contact_person', 'email']))}
                      />
                    </th>
                    <th className="border px-2 py-1">Actions</th>
                    <th className="border px-2 py-1">ID</th>
                    <th className="border px-2 py-1">Customer Code</th>
                    <th className="border px-2 py-1">Customer Name</th>
                    <th className="border px-2 py-1">Contact Person</th>
                    <th className="border px-2 py-1">Address</th>
                    <th className="border px-2 py-1">Phone</th>
                    <th className="border px-2 py-1">Email</th>
                    <th className="border px-2 py-1">TIN</th>
                    <th className="border px-2 py-1">Payment Terms</th>
                    <th className="border px-2 py-1">Delivery Terms</th>
                    <th className="border px-2 py-1">Credit Limit</th>
                    <th className="border px-2 py-1">Is Active</th>
                    <th className="border px-2 py-1">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {filterData(customers, searchQueries.customers, ['customer_code', 'customer_name', 'contact_person', 'email']).map(customer => (
                    <tr key={customer.id} className={!customer.is_active ? 'bg-gray-100 opacity-60' : ''}>
                      <td className="border px-2 py-1">
                        <input
                          type="checkbox"
                          checked={(selectedRows['customers'] || new Set()).has(customer.id)}
                          onChange={() => toggleRowSelection('customers', customer.id)}
                        />
                      </td>
                      <td className="border px-2 py-1 whitespace-nowrap flex gap-1">
                        <button
                          className="px-2 py-1 bg-blue-500 text-white rounded text-xs font-bold hover:bg-blue-600"
                          onClick={() => handleEdit('customers', customer)}
                        >
                          Edit
                        </button>
                        {customer.is_active ? (
                          <button
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                            onClick={() => handleDeleteRecord('customers', customer.id, customer.customer_name)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <>
                            <button
                              className="px-2 py-1 bg-green-500 text-white rounded text-xs font-bold hover:bg-green-600"
                              onClick={() => handleActivateRecord('customers', customer.id, customer.customer_name)}
                            >
                              Activate
                            </button>
                            <button
                              className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                              onClick={() => handleDeleteRecord('customers', customer.id, customer.customer_name)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                      <td className="border px-2 py-1">{customer.id}</td>
                      <td className="border px-2 py-1">{customer.customer_code}</td>
                      <td className="border px-2 py-1">{customer.customer_name}</td>
                      <td className="border px-2 py-1">{customer.contact_person}</td>
                      <td className="border px-2 py-1">{customer.address}</td>
                      <td className="border px-2 py-1">{customer.phone}</td>
                      <td className="border px-2 py-1">{customer.email}</td>
                      <td className="border px-2 py-1">{customer.tin}</td>
                      <td className="border px-2 py-1">{customer.payment_terms}</td>
                      <td className="border px-2 py-1">{customer.delivery_terms}</td>
                      <td className="border px-2 py-1">{customer.credit_limit}</td>
                      <td className="border px-2 py-1">{String(customer.is_active)}</td>
                      <td className="border px-2 py-1">{customer.created_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'items' && (
          <div>
            <div className="mb-4 flex gap-2 flex-wrap">
              <button
                className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90"
                style={{ backgroundColor: '#008ecc' }}
                onClick={async () => {
                  setLoading(true);
                  setError(null);
                  try {
                    const data = await getItems();
                    setItems(data);
                  } catch (err: any) {
                    setError(err.message || 'Failed to fetch items');
                  }
                  setLoading(false);}
                }
              >
                🔄 Refresh
              </button>
              <input
                type="text"
                placeholder="🔍 Search items (code, name, category, group...)"
                className="px-4 py-2 border border-gray-300 rounded text-sm flex-grow max-w-md"
                value={searchQueries.items}
                onChange={(e) => setSearchQueries(prev => ({ ...prev, items: e.target.value }))}
              />
            </div>
            <h2 className="text-xl font-bold mb-4">Items List</h2>
            {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
            <div style={{ maxHeight: 400, overflow: 'auto', minWidth: '100%' }}>
              <table className="min-w-full border bg-white rounded-lg shadow text-xs" style={{ minWidth: 2100 }}>
                <thead>
                  <tr className="bg-gray-200 text-gray-900 sticky top-0">
                    <th className="border px-2 py-1 w-12">
                      <input
                        type="checkbox"
                        checked={(selectedRows['items'] || new Set()).size === filterData(items, searchQueries.items, ['item_code', 'item_name', 'category', 'group']).length && items.length > 0}
                        onChange={() => toggleSelectAll('items', filterData(items, searchQueries.items, ['item_code', 'item_name', 'category', 'group']))}
                      />
                    </th>
                    <th className="border px-2 py-1">Actions</th>
                    <th className="border px-2 py-1">ID</th>
                    <th className="border px-2 py-1">Item Code</th>
                    <th className="border px-2 py-1">Item Name</th>
                    <th className="border px-2 py-1">Description</th>
                    <th className="border px-2 py-1">UOM</th>
                    <th className="border px-2 py-1">Category</th>
                    <th className="border px-2 py-1">Group</th>
                    <th className="border px-2 py-1">ABC Class</th>
                    <th className="border px-2 py-1">Length (cm)</th>
                    <th className="border px-2 py-1">Width (cm)</th>
                    <th className="border px-2 py-1">Height (cm)</th>
                    <th className="border px-2 py-1">Volume (cbm)</th>
                    <th className="border px-2 py-1">Pallet Height (cm)</th>
                    <th className="border px-2 py-1">Stackable</th>
                    <th className="border px-2 py-1">Max Stack Height</th>
                    <th className="border px-2 py-1">Min Stock</th>
                    <th className="border px-2 py-1">Max Stock</th>
                    <th className="border px-2 py-1">Reorder Point</th>
                    <th className="border px-2 py-1">Batch Track</th>
                    <th className="border px-2 py-1">Serial Track</th>
                    <th className="border px-2 py-1">Expiry Track</th>
                    <th className="border px-2 py-1">Shelf Life (days)</th>
                    <th className="border px-2 py-1">Is Perishable</th>
                    <th className="border px-2 py-1">Allocation Rule</th>
                    <th className="border px-2 py-1">Picking Method</th>
                    <th className="border px-2 py-1">Brand</th>
                    <th className="border px-2 py-1">Color</th>
                    <th className="border px-2 py-1">Weight UOM (kg)</th>
                    <th className="border px-2 py-1">Pallet Config</th>
                    <th className="border px-2 py-1">Active</th>
                    <th className="border px-2 py-1">Created At</th>
                    <th className="border px-2 py-1">Updated At</th>
                  </tr>
                </thead>
                <tbody>
                  {filterData(items, searchQueries.items, ['item_code', 'item_name', 'category', 'group']).map(item => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="border px-2 py-1">
                        <input
                          type="checkbox"
                          checked={(selectedRows['items'] || new Set()).has(item.id)}
                          onChange={() => toggleRowSelection('items', item.id)}
                        />
                      </td>
                      <td className="border px-2 py-1 whitespace-nowrap">
                        <button
                          className="px-2 py-1 bg-blue-500 text-white rounded text-xs font-bold mr-1 hover:bg-blue-600"
                          onClick={() => handleEdit('items', item)}
                        >
                          Edit
                        </button>
                        <button
                          className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                          onClick={() => handleDeleteRecord('items', item.id, item.item_name)}
                        >
                          Deactivate
                        </button>
                      </td>
                      <td className="border px-2 py-1 font-mono text-gray-600">{item.id}</td>
                      <td className="border px-2 py-1 font-bold">{item.item_code}</td>
                      <td className="border px-2 py-1">{item.item_name}</td>
                      <td className="border px-2 py-1 text-gray-600 max-w-xs truncate">{item.description || '-'}</td>
                      <td className="border px-2 py-1">{item.item_uom || '-'}</td>
                      <td className="border px-2 py-1 text-gray-600">{item.item_category || '-'}</td>
                      <td className="border px-2 py-1 text-gray-600">{item.item_group || '-'}</td>
                      <td className="border px-2 py-1 text-center">{item.abc_classification || '-'}</td>
                      <td className="border px-2 py-1 text-right">{item.length_cm || '-'}</td>
                      <td className="border px-2 py-1 text-right">{item.width_cm || '-'}</td>
                      <td className="border px-2 py-1 text-right">{item.height_cm || '-'}</td>
                      <td className="border px-2 py-1 text-right">{item.volume_cbm || '-'}</td>
                      <td className="border px-2 py-1 text-right">{item.pallet_height_cm || '-'}</td>
                      <td className="border px-2 py-1 text-center">{item.stackable ? '✓' : '✗'}</td>
                      <td className="border px-2 py-1 text-right">{item.max_stack_height || '-'}</td>
                      <td className="border px-2 py-1 text-right">{item.min_stock_level || '-'}</td>
                      <td className="border px-2 py-1 text-right">{item.max_stock_level || '-'}</td>
                      <td className="border px-2 py-1 text-right">{item.reorder_point || '-'}</td>
                      <td className="border px-2 py-1 text-center">{item.batch_tracking ? '✓' : '✗'}</td>
                      <td className="border px-2 py-1 text-center">{item.serial_tracking ? '✓' : '✗'}</td>
                      <td className="border px-2 py-1 text-center">{item.expiry_tracking ? '✓' : '✗'}</td>
                      <td className="border px-2 py-1 text-right">{item.shelf_life_days || '-'}</td>
                      <td className="border px-2 py-1 text-center">{item.is_perishable ? '✓' : '✗'}</td>
                      <td className="border px-2 py-1 bg-blue-50">
                        <span className={`px-2 py-1 rounded text-xs font-bold ${item.allocation_rule === 'FEFO' ? 'bg-orange-200' : item.allocation_rule === 'FIFO' ? 'bg-green-200' : item.allocation_rule === 'LOT' ? 'bg-purple-200' : 'bg-gray-200'}`}>
                          {item.allocation_rule || 'FIFO'}
                        </span>
                      </td>
                      <td className="border px-2 py-1 bg-blue-50">{item.picking_method || 'Single-bin'}</td>
                      <td className="border px-2 py-1 text-gray-600">{item.brand || '-'}</td>
                      <td className="border px-2 py-1 text-gray-600">{item.color || '-'}</td>
                      <td className="border px-2 py-1 text-right">{item.weight_uom_kg || '-'}</td>
                      <td className="border px-2 py-1 text-gray-600">{item.pallet_config || '-'}</td>
                      <td className="border px-2 py-1 text-center">{item.is_active ? '✓' : '✗'}</td>
                      <td className="border px-2 py-1 text-gray-500 text-xs">{item.created_at ? new Date(item.created_at).toLocaleDateString() : '-'}</td>
                      <td className="border px-2 py-1 text-gray-500 text-xs">{item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'warehouses' && (
          <div>
            <div className="mb-4 flex gap-2 flex-wrap">
              <button
                className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90"
                style={{ backgroundColor: '#008ecc' }}
                onClick={async () => {
                  setLoading(true);
                  setError(null);
                  try {
                    const data = await getWarehouses();
                    setWarehouses(data);
                  } catch (err: any) {
                    setError(err.message || 'Failed to fetch warehouses');
                  }
                  setLoading(false);
                }}
              >
                🔄 Refresh
              </button>
              <input
                type="text"
                placeholder="🔍 Search warehouses (code, name, address...)"
                className="px-4 py-2 border border-gray-300 rounded text-sm flex-grow max-w-md"
                value={searchQueries.warehouses}
                onChange={(e) => setSearchQueries(prev => ({ ...prev, warehouses: e.target.value }))}
              />
            </div>
            <h2 className="text-xl font-bold mb-4">Warehouses List</h2>
            {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
            <div style={{ maxHeight: 400, overflow: 'auto', minWidth: '100%' }}>
              <table className="min-w-full border bg-white rounded-lg shadow text-xs" style={{ minWidth: 1300 }}>
                <thead>
                  <tr className="bg-gray-200 text-gray-900 sticky top-0">
                    <th className="border px-2 py-1 w-12">
                      <input
                        type="checkbox"
                        checked={(selectedRows['warehouses'] || new Set()).size === filterData(warehouses, searchQueries.warehouses, ['warehouse_code', 'warehouse_name', 'address', 'contact_person']).length && warehouses.length > 0}
                        onChange={() => toggleSelectAll('warehouses', filterData(warehouses, searchQueries.warehouses, ['warehouse_code', 'warehouse_name', 'address', 'contact_person']))}
                      />
                    </th>
                    <th className="border px-2 py-1">Actions</th>
                    <th className="border px-2 py-1">ID</th>
                    <th className="border px-2 py-1">Warehouse Code</th>
                    <th className="border px-2 py-1">Warehouse Name</th>
                    <th className="border px-2 py-1">Address</th>
                    <th className="border px-2 py-1">Contact Person</th>
                    <th className="border px-2 py-1">Phone</th>
                    <th className="border px-2 py-1">Is Active</th>
                    <th className="border px-2 py-1">Created At</th>
                    <th className="border px-2 py-1">Updated At</th>
                  </tr>
                </thead>
                <tbody>
                  {filterData(warehouses, searchQueries.warehouses, ['warehouse_code', 'warehouse_name', 'address', 'contact_person']).map(wh => (
                    <tr key={wh.id} className={!wh.is_active ? 'bg-gray-100 opacity-60' : ''}>
                      <td className="border px-2 py-1">
                        <input
                          type="checkbox"
                          checked={(selectedRows['warehouses'] || new Set()).has(wh.id)}
                          onChange={() => toggleRowSelection('warehouses', wh.id)}
                        />
                      </td>
                      <td className="border px-2 py-1 whitespace-nowrap flex gap-1">
                        <button
                          className="px-2 py-1 bg-blue-500 text-white rounded text-xs font-bold hover:bg-blue-600"
                          onClick={() => handleEdit('warehouses', wh)}
                        >
                          Edit
                        </button>
                        {wh.is_active ? (
                          <button
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                            onClick={() => handleDeleteRecord('warehouses', wh.id, wh.warehouse_name)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <>
                            <button
                              className="px-2 py-1 bg-green-500 text-white rounded text-xs font-bold hover:bg-green-600"
                              onClick={() => handleActivateRecord('warehouses', wh.id, wh.warehouse_name)}
                            >
                              Activate
                            </button>
                            <button
                              className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                              onClick={() => handleDeleteRecord('warehouses', wh.id, wh.warehouse_name)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                      <td className="border px-2 py-1">{wh.id}</td>
                      <td className="border px-2 py-1">{wh.warehouse_code}</td>
                      <td className="border px-2 py-1">{wh.warehouse_name}</td>
                      <td className="border px-2 py-1">{wh.address}</td>
                      <td className="border px-2 py-1">{wh.contact_person}</td>
                      <td className="border px-2 py-1">{wh.phone}</td>
                      <td className="border px-2 py-1">{String(wh.is_active)}</td>
                      <td className="border px-2 py-1">{wh.created_at}</td>
                      <td className="border px-2 py-1">{wh.updated_at}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'locations' && (
          <div>
            <div className="mb-4 flex gap-2 flex-wrap">
              <button
                className="px-4 py-2 text-white rounded text-sm font-bold transition hover:opacity-90"
                style={{ backgroundColor: '#008ecc' }}
                onClick={async () => {
                  setLoading(true);
                  setError(null);
                  try {
                    const data = await getLocations();
                    setLocations(data);
                  } catch (err: any) {
                    setError(err.message || 'Failed to fetch locations');
                  }
                  setLoading(false);
                }}
              >
                🔄 Refresh
              </button>
              <input
                type="text"
                placeholder="🔍 Search locations (code, name, zone, aisle...)"
                className="px-4 py-2 border border-gray-300 rounded text-sm flex-grow max-w-md"
                value={searchQueries.locations}
                onChange={(e) => setSearchQueries(prev => ({ ...prev, locations: e.target.value }))}
              />
            </div>
            <h2 className="text-xl font-bold mb-4">Locations List</h2>
            {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
            <div style={{ maxHeight: 400, overflow: 'auto', minWidth: '100%' }}>
              <table className="min-w-full border bg-white rounded-lg shadow text-xs" style={{ minWidth: 1400 }}>
                <thead>
                  <tr className="bg-gray-200 text-gray-900 sticky top-0">
                    <th className="border px-2 py-1 w-12">
                      <input
                        type="checkbox"
                        checked={(selectedRows['locations'] || new Set()).size === filterData(getFilteredData(locations, 'locations'), searchQueries.locations, ['location_code', 'location_name', 'zone', 'aisle', 'rack']).length && getFilteredData(locations, 'locations').length > 0}
                        onChange={() => toggleSelectAll('locations', filterData(getFilteredData(locations, 'locations'), searchQueries.locations, ['location_code', 'location_name', 'zone', 'aisle', 'rack']))}
                      />
                    </th>
                    <th className="border px-2 py-1">Actions</th>
                    <th className="border px-2 py-1">ID</th>
                    <th className="border px-2 py-1">Warehouse ID</th>
                    <th className="border px-2 py-1">Location Code</th>
                    <th className="border px-2 py-1">Location Name</th>
                    <th className="border px-2 py-1">Location Type</th>
                    <th className="border px-2 py-1">Zone</th>
                    <th className="border px-2 py-1">Aisle</th>
                    <th className="border px-2 py-1">Rack</th>
                    <th className="border px-2 py-1">Level</th>
                    <th className="border px-2 py-1">Bin</th>
                    <th className="border px-2 py-1">Max Weight (kg)</th>
                    <th className="border px-2 py-1">Max Volume (cbm)</th>
                    <th className="border px-2 py-1">Max Pallets</th>
                    <th className="border px-2 py-1">Temperature Controlled</th>
                    <th className="border px-2 py-1">Hazmat Approved</th>
                    <th className="border px-2 py-1">Is Active</th>
                    <th className="border px-2 py-1">Created At</th>
                    <th className="border px-2 py-1">Warehouse Code</th>
                    <th className="border px-2 py-1">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filterData(getFilteredData(locations, 'locations'), searchQueries.locations, ['location_code', 'location_name', 'zone', 'aisle', 'rack']).map(loc => (
                    <tr key={loc.id} className={!loc.is_active ? 'bg-gray-100 opacity-60' : ''}>
                      <td className="border px-2 py-1">
                        <input
                          type="checkbox"
                          checked={(selectedRows['locations'] || new Set()).has(loc.id)}
                          onChange={() => toggleRowSelection('locations', loc.id)}
                        />
                      </td>
                      <td className="border px-2 py-1 whitespace-nowrap flex gap-1">
                        <button
                          className="px-2 py-1 bg-blue-500 text-white rounded text-xs font-bold hover:bg-blue-600"
                          onClick={() => handleEdit('locations', loc)}
                        >
                          Edit
                        </button>
                        {loc.is_active ? (
                          <button
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                            onClick={() => handleDeleteRecord('locations', loc.id, loc.location_code)}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <>
                            <button
                              className="px-2 py-1 bg-green-500 text-white rounded text-xs font-bold hover:bg-green-600"
                              onClick={() => handleActivateRecord('locations', loc.id, loc.location_code)}
                            >
                              Activate
                            </button>
                            <button
                              className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                              onClick={() => handleDeleteRecord('locations', loc.id, loc.location_code)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                      <td className="border px-2 py-1">{loc.id}</td>
                      <td className="border px-2 py-1">{loc.warehouse_id}</td>
                      <td className="border px-2 py-1">{loc.location_code}</td>
                      <td className="border px-2 py-1">{loc.location_name}</td>
                      <td className="border px-2 py-1">{loc.location_type}</td>
                      <td className="border px-2 py-1">{loc.zone}</td>
                      <td className="border px-2 py-1">{loc.aisle}</td>
                      <td className="border px-2 py-1">{loc.rack}</td>
                      <td className="border px-2 py-1">{loc.level}</td>
                      <td className="border px-2 py-1">{loc.bin}</td>
                      <td className="border px-2 py-1">{loc.max_weight_kg}</td>
                      <td className="border px-2 py-1">{loc.max_volume_cbm}</td>
                      <td className="border px-2 py-1">{loc.max_pallets}</td>
                      <td className="border px-2 py-1">{String(loc.temperature_controlled)}</td>
                      <td className="border px-2 py-1">{String(loc.hazmat_approved)}</td>
                      <td className="border px-2 py-1">{String(loc.is_active)}</td>
                      <td className="border px-2 py-1">{loc.created_at}</td>
                      <td className="border px-2 py-1">{loc.warehouse_code}</td>
                      <td className="border px-2 py-1">{loc.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {activeTab === 'users' && (
          <div>
            <div className="flex gap-2 mb-4">
              <button
                className="px-4 py-2 rounded font-bold text-white transition hover:opacity-90"
                style={{ backgroundColor: subUserTab === 'list' ? '#008ecc' : '#cccccc' }}
                onClick={() => setSubUserTab('list')}
              >
                User List
              </button>
              <button
                className="px-4 py-2 rounded font-bold text-white transition hover:opacity-90"
                style={{ backgroundColor: subUserTab === 'warehouse' ? '#008ecc' : '#cccccc' }}
                onClick={() => setSubUserTab('warehouse')}
              >
                Warehouse Assignment
              </button>
              <button
                className="px-4 py-2 rounded font-bold text-white transition hover:opacity-90"
                style={{ backgroundColor: subUserTab === 'page_permissions' ? '#008ecc' : '#cccccc' }}
                onClick={() => setSubUserTab('page_permissions')}
              >
                User Permissions
              </button>
            </div>

            {subUserTab === 'list' && (
            <div>
              <div className="mb-4 flex gap-2 flex-wrap">
                <input
                  type="text"
                  placeholder="🔍 Search users (username, email, name...)"
                  className="px-4 py-2 border border-gray-300 rounded text-sm flex-grow max-w-md"
                  value={searchQueries.users}
                  onChange={(e) => setSearchQueries(prev => ({ ...prev, users: e.target.value }))}
                />
              </div>
              <h2 className="text-xl font-bold mb-4">Users List</h2>
              {error && <div className="text-red-600 text-xs mb-2">{error}</div>}
              <div style={{ maxHeight: 400, overflow: 'auto', minWidth: '100%' }}>
                <table className="min-w-full border bg-white rounded-lg shadow text-xs" style={{ minWidth: 1200 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#008ecc' }} className="text-white sticky top-0">
                      <th className="border px-2 py-1 w-12">
                        <input
                          type="checkbox"
                          checked={(selectedRows['users'] || new Set()).size === filterData(users, searchQueries.users, ['username', 'email', 'full_name', 'role']).length && users.length > 0}
                          onChange={() => toggleSelectAll('users', filterData(users, searchQueries.users, ['username', 'email', 'full_name', 'role']))}
                        />
                      </th>
                      <th className="border px-2 py-1">Actions</th>
                      <th className="border px-2 py-1">ID</th>
                      <th className="border px-2 py-1">Username</th>
                      <th className="border px-2 py-1">Email</th>
                      <th className="border px-2 py-1">Full Name</th>
                      <th className="border px-2 py-1">Role</th>
                      <th className="border px-2 py-1">Warehouse</th>
                      <th className="border px-2 py-1">Is Active</th>
                      <th className="border px-2 py-1">Created At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filterData(users, searchQueries.users, ['username', 'email', 'full_name', 'role']).map(user => (
                      <tr key={user.id} className={!user.is_active ? 'bg-gray-100 opacity-60' : ''}>
                        <td className="border px-2 py-1">
                          <input
                            type="checkbox"
                            checked={(selectedRows['users'] || new Set()).has(user.id)}
                            onChange={() => toggleRowSelection('users', user.id)}
                          />
                        </td>
                        <td className="border px-2 py-1 whitespace-nowrap flex gap-1">
                          <button
                            className="px-2 py-1 bg-blue-500 text-white rounded text-xs font-bold hover:bg-blue-600"
                            onClick={() => handleEdit('users', user)}
                          >
                            Edit
                          </button>
                          {user.is_active ? (
                            <button
                              className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                              onClick={() => handleDeleteRecord('users', user.id, user.full_name)}
                            >
                              Deactivate
                            </button>
                          ) : (
                            <>
                              <button
                                className="px-2 py-1 bg-green-500 text-white rounded text-xs font-bold hover:bg-green-600"
                                onClick={() => handleActivateRecord('users', user.id, user.full_name)}
                              >
                                Activate
                              </button>
                              <button
                                className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-600"
                                onClick={() => handleDeleteRecord('users', user.id, user.full_name)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                        <td className="border px-2 py-1">{user.id}</td>
                        <td className="border px-2 py-1">{user.username}</td>
                        <td className="border px-2 py-1">{user.email}</td>
                        <td className="border px-2 py-1">{user.full_name}</td>
                        <td className="border px-2 py-1">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            user.role === 'Admin' ? 'bg-red-100 text-red-800' :
                            user.role === 'Manager' ? 'bg-blue-100 text-blue-800' :
                            user.role === 'Supervisor' ? 'bg-yellow-100 text-yellow-800' :
                            user.role === 'Operator' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="border px-2 py-1">
                          {(userWarehouseAssignments[user.id]?.length ?? 0) > 0 ? (
                            <span className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded">
                              {userWarehouseAssignments[user.id]?.length ?? 0} assigned
                            </span>
                          ) : (
                            <span className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded">
                              All warehouses
                            </span>
                          )}
                        </td>
                        <td className="border px-2 py-1">{String(user.is_active)}</td>
                        <td className="border px-2 py-1 text-xs">{new Date(user.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            )}

            {subUserTab === 'warehouse' && (
            <div>
              <h2 className="text-2xl font-bold mb-4">🏭 Warehouse Assignment</h2>
              <p className="text-sm text-gray-600 mb-4">Assign warehouses to users</p>
              <div style={{ maxHeight: 600, overflow: 'auto', minWidth: '100%' }}>
                <table className="min-w-full border bg-white rounded-lg shadow text-xs" style={{ minWidth: 900 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#008ecc' }} className="text-white sticky top-0">
                      <th className="border px-2 py-1 text-left">User</th>
                      <th className="border px-2 py-1 text-left">Email</th>
                      <th className="border px-2 py-1 text-left">Role</th>
                      <th className="border px-2 py-1 text-left">Warehouse</th>
                      <th className="border px-2 py-1 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="border px-2 py-1 font-semibold">{user.full_name}</td>
                        <td className="border px-2 py-1">{user.email}</td>
                        <td className="border px-2 py-1">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            user.role === 'Admin' ? 'bg-red-100 text-red-800' :
                            user.role === 'Manager' ? 'bg-blue-100 text-blue-800' :
                            user.role === 'Supervisor' ? 'bg-yellow-100 text-yellow-800' :
                            user.role === 'Operator' ? 'bg-green-100 text-green-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="border px-2 py-1">
                          <select
                            multiple
                            className="border px-2 py-1 rounded text-xs w-full"
                            value={(userWarehouseSelection[user.id] ?? userWarehouseAssignments[user.id] ?? []).map(String)}
                            onChange={(e) => {
                              const selected = Array.from(e.target.selectedOptions, option => parseInt(option.value));
                              setUserWarehouseSelection(prev => ({
                                ...prev,
                                [user.id]: selected
                              }));
                            }}
                          >
                            {warehouses.map(wh => (
                              <option key={wh.id} value={wh.id.toString()}>
                                {wh.warehouse_code}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500 mt-1">(Hold Ctrl/Cmd to select multiple)</p>
                        </td>
                        <td className="border px-2 py-1">
                          {(userWarehouseSelection[user.id]?.length ?? userWarehouseAssignments[user.id]?.length ?? 0) > 0 ? (
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">
                              {userWarehouseSelection[user.id]?.length ?? userWarehouseAssignments[user.id]?.length ?? 0} warehouse(s)
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs font-semibold">
                              All
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={async () => {
                    setWarehouseAssignmentLoading(true);
                    try {
                      console.log('🔍 Starting warehouse assignment save...');
                      console.log('📊 Current selections:', userWarehouseSelection);
                      console.log('📊 Current assignments:', userWarehouseAssignments);
                      
                      // For each user with changed assignments, delete old ones and add new ones
                      for (const userId in userWarehouseSelection) {
                        const uid = parseInt(userId);
                        const currentAssignments = userWarehouseAssignments[uid] ?? [];
                        const newAssignments = userWarehouseSelection[uid];
                        
                        console.log(`📝 Processing user ${uid}: current=${currentAssignments}, new=${newAssignments}`);
                        
                        // Find warehouses to add and remove
                        const toAdd = newAssignments.filter(w => !currentAssignments.includes(w));
                        const toRemove = currentAssignments.filter(w => !newAssignments.includes(w));
                        
                        console.log(`  ➕ To add: ${toAdd}, ➖ To remove: ${toRemove}`);
                        
                        // Delete removed assignments via API route
                        for (const warehouseId of toRemove) {
                          console.log(`  🗑️ DELETE user_warehouse: user_id=${uid}, warehouse_id=${warehouseId}`);
                          const delRes = await fetch('/api/patch-record', {
                            method: 'DELETE',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              table: 'user_warehouses',
                              filters: { user_id: uid, warehouse_id: warehouseId }
                            })
                          });
                          console.log(`  ✓ DELETE response: ${delRes.status}`);
                        }
                        
                        // Insert new assignments via API route
                        for (const warehouseId of toAdd) {
                          const payload: any = {
                            user_id: uid,
                            warehouse_id: warehouseId
                          };
                          // Only set assigned_by if user is logged in
                          if (user?.id) {
                            payload.assigned_by = user.id;
                          }
                          console.log(`  ➕ POST user_warehouse:`, payload);
                          const postRes = await fetch('/api/patch-record', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              table: 'user_warehouses',
                              data: payload
                            })
                          });
                          const responseText = await postRes.text();
                          console.log(`  ✓ POST response: ${postRes.status}`, responseText);
                          if (!postRes.ok) {
                            throw new Error(`Failed to add warehouse assignment: ${postRes.status} - ${responseText}`);
                          }
                        }
                      }
                      
                      // Refresh assignments from database via API route
                      console.log('🔄 Refreshing assignments from database...');
                      const uwRes = await fetch('/api/user-warehouses');
                      console.log(`📥 Fetch response: ${uwRes.status}`);
                      if (uwRes.ok) {
                        const assignments = await uwRes.json();
                        console.log('📊 Fetched assignments:', assignments);
                        const mapped: { [userId: number]: number[] } = {};
                        assignments.forEach((uw: any) => {
                          if (!mapped[uw.user_id]) mapped[uw.user_id] = [];
                          mapped[uw.user_id].push(uw.warehouse_id);
                        });
                        console.log('📝 Mapped assignments:', mapped);
                        setUserWarehouseAssignments(mapped);
                        setUserWarehouseSelection({});
                      }
                      
                      setSuccess(true);
                      alert('✅ Warehouse assignments saved successfully!');
                    } catch (err: any) {
                      setError('Failed to save warehouse assignments: ' + (err.message || 'Unknown error'));
                      alert('❌ Error: ' + (err.message || 'Failed to save'));
                      console.error('🔴 Error details:', err);
                    }
                    setWarehouseAssignmentLoading(false);
                  }}
                  disabled={warehouseAssignmentLoading}
                  className="px-4 py-2 text-white rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#008ecc' }}
                >
                  {warehouseAssignmentLoading ? 'Saving...' : 'Save Assignments'}
                </button>
              </div>
            </div>
            )}

            {subUserTab === 'page_permissions' && (
            <div>
              <h2 className="text-2xl font-bold mb-4">📄 Page Permissions</h2>
              <p className="text-sm text-gray-600 mb-4">Manage page access and access levels for each user</p>
              <div style={{ maxHeight: 600, overflow: 'auto', minWidth: '100%' }}>
                <table className="min-w-full border bg-white rounded-lg shadow text-xs" style={{ minWidth: 1200 }}>
                  <thead>
                    <tr style={{ backgroundColor: '#008ecc' }} className="text-white sticky top-0">
                      <th className="border px-3 py-2 text-left w-40">User (Role)</th>
                      {[
                        'View All',
                        'Dashboard Page',
                        'Inbound Page',
                        'Outbound Page',
                        'Inventory Page',
                        'Stock Movement Page',
                        'Config Page'
                      ].map(page => (
                        <th key={page} className="border px-3 py-2 text-center whitespace-normal" style={{ minWidth: '130px' }}>
                          <div className="text-xs leading-tight">{page}</div>
                          <div className="text-xs text-gray-200 leading-tight">
                            <span>Full / Read-Only</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(user => (
                      <tr key={user.id} className="hover:bg-gray-50">
                        <td className="border px-3 py-2 font-semibold whitespace-nowrap">{user.full_name} ({user.role})</td>
                        {[
                          'View All',
                          'Dashboard Page',
                          'Inbound Page',
                          'Outbound Page',
                          'Inventory Page',
                          'Stock Movement Page',
                          'Config Page'
                        ].map(page => {
                          const currentLevel = userPagePermissions[user.id]?.[page] || '';
                          return (
                            <td key={page} className="border px-3 py-2 text-center">
                              <select
                                className="border px-2 py-1 rounded text-xs w-full"
                                value={currentLevel}
                                onChange={(e) => {
                                  const newLevel = e.target.value;
                                  setUserPagePermissions(prev => ({
                                    ...prev,
                                    [user.id]: {
                                      ...prev[user.id],
                                      [page]: newLevel
                                    }
                                  }));
                                }}
                              >
                                <option value="">-- No Access --</option>
                                <option value="Read Only">Read Only</option>
                                <option value="Full Access">Full Access</option>
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={async () => {
                    setWarehouseAssignmentLoading(true);
                    try {
                      console.log('🔍 Starting page permissions save...');
                      console.log('📊 Current permissions:', userPagePermissions);
                      
                      // Delete all old permissions and insert new ones
                      for (const userId in userPagePermissions) {
                        const uid = parseInt(userId);
                        const pages = userPagePermissions[uid];
                        
                        console.log(`📝 Processing user ${uid}: permissions=`, pages);
                        
                        // Delete old permissions for this user via API route
                        console.log(`  🗑️ DELETE user_permissions for user_id=${uid}`);
                        const delRes = await fetch('/api/patch-record', {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            table: 'user_permissions',
                            filters: { user_id: uid }
                          })
                        });
                        console.log(`  ✓ DELETE response: ${delRes.status}`);
                        
                        // Insert new permissions via API route
                        for (const [pageName, accessLevel] of Object.entries(pages)) {
                          if (accessLevel) { // Only insert if access level is selected
                            const payload: any = {
                              user_id: uid,
                              page_name: pageName,
                              access_level: accessLevel
                            };
                            // Only set assigned_by if user is logged in
                            if (user?.id) {
                              payload.assigned_by = user.id;
                            }
                            console.log(`  ➕ POST:`, payload);
                            const postRes = await fetch('/api/patch-record', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                table: 'user_permissions',
                                data: payload
                              })
                            });
                            const responseText = await postRes.text();
                            console.log(`  ✓ POST response: ${postRes.status}`, responseText);
                            if (!postRes.ok) {
                              throw new Error(`Failed to add permission: ${postRes.status} - ${responseText}`);
                            }
                          }
                        }
                      }
                      
                      // Refresh permissions from database via API route
                      console.log('🔄 Refreshing permissions from database...');
                      const upRes = await fetch('/api/config-records?type=permissions');
                      console.log(`📥 Fetch response: ${upRes.status}`);
                      if (upRes.ok) {
                        const permissions = await upRes.json();
                        console.log('📊 Fetched permissions:', permissions);
                        const mapped: { [userId: number]: { [pageName: string]: string } } = {};
                        permissions.forEach((up: any) => {
                          if (!mapped[up.user_id]) mapped[up.user_id] = {};
                          mapped[up.user_id][up.page_name] = up.access_level;
                        });
                        console.log('📝 Mapped permissions:', mapped);
                        setUserPagePermissions(mapped);
                      }
                      
                      alert('✅ Page permissions saved successfully!');
                    } catch (err: any) {
                      setError('Failed to save page permissions: ' + (err.message || 'Unknown error'));
                      alert('❌ Error: ' + (err.message || 'Failed to save'));
                      console.error('🔴 Error details:', err);
                    }
                    setWarehouseAssignmentLoading(false);
                  }}
                  disabled={warehouseAssignmentLoading}
                  className="px-4 py-2 text-white rounded font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#008ecc' }}
                >
                  {warehouseAssignmentLoading ? 'Saving...' : 'Save Permissions'}
                </button>
              </div>
            </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {showEditModal && editingRecord && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-96 overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">Edit {editingRecord.tab.charAt(0).toUpperCase() + editingRecord.tab.slice(1)}</h2>
            
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
                {error}
              </div>
            )}
            
            {success && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded text-sm">
                ✅ Record updated successfully!
              </div>
            )}
            
            <form onSubmit={(e) => {
              e.preventDefault();
              handleUpdateRecord();
            }}>
              <div className="space-y-4">
                {formFields[editingRecord.tab]?.map((field: any) => {
                  // Skip ID fields - they shouldn't be editable
                  if (field.name === 'id') return null;
                  
                  const currentValue = editingRecord.data[field.name];
                  
                  return (
                    <div key={field.name}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {field.label}
                      </label>
                      
                      {field.type === 'select' ? (
                        <select
                          value={currentValue || ''}
                          onChange={(e) => {
                            setEditingRecord({
                              ...editingRecord,
                              data: { ...editingRecord.data, [field.name]: e.target.value }
                            });
                          }}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        >
                          <option value="">Select {field.label}</option>
                          {field.options?.map((opt: any, index: number) => (
                            <option key={`${opt.value}-${index}`} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'checkbox' ? (
                        <input
                          type="checkbox"
                          checked={currentValue || false}
                          onChange={(e) => {
                            setEditingRecord({
                              ...editingRecord,
                              data: { ...editingRecord.data, [field.name]: e.target.checked }
                            });
                          }}
                          className="w-4 h-4"
                        />
                      ) : (
                        <input
                          type={field.type || 'text'}
                          value={currentValue || ''}
                          onChange={(e) => {
                            setEditingRecord({
                              ...editingRecord,
                              data: { ...editingRecord.data, [field.name]: e.target.value }
                            });
                          }}
                          className="w-full border border-gray-300 rounded px-3 py-2"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              
              <div className="flex gap-2 mt-6">
                <button
                  type="submit"
                  className="flex-1 bg-blue-500 text-white py-2 rounded font-bold hover:bg-blue-600"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 bg-gray-500 text-white py-2 rounded font-bold hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}