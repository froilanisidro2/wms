/**
 * Excel Importer Utility for WMS System
 * Handles parsing Excel files and mapping data to database tables
 */

/**
 * Parse Excel file using SheetJS library
 * @param file - Excel file to parse
 * @returns Parsed data by sheet name
 */
export async function parseExcelFile(file: File): Promise<{ [sheetName: string]: any[] }> {
  // Dynamic import of SheetJS to avoid SSR issues
  const XLSX = await import('xlsx');

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const data = event.target?.result as ArrayBuffer;
        const workbook = XLSX.read(data, { type: 'array' });

        const result: { [key: string]: any[] } = {};

        // Parse each sheet
        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const sheetData = XLSX.utils.sheet_to_json(worksheet);
          result[sheetName] = sheetData;
        });

        resolve(result);
      } catch (error) {
        reject(new Error(`Failed to parse Excel file: ${error}`));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Validate and map vendor data
 */
export function mapVendorData(rawData: any[]): any[] {
  return rawData.map((row) => ({
    vendor_code: row['Vendor Code'] || row['vendor_code'] || '',
    vendor_name: row['Vendor Name'] || row['vendor_name'] || '',
    contact_person: row['Contact Person'] || row['contact_person'] || '',
    address: row['Address'] || row['address'] || '',
    phone: row['Phone'] || row['phone'] || '',
    email: row['Email'] || row['email'] || '',
    tin: row['TIN'] || row['tin'] || '',
    payment_terms: row['Payment Terms'] || row['payment_terms'] || '',
    delivery_terms: row['Delivery Terms'] || row['delivery_terms'] || '',
    contact_number: row['Contact Number'] || row['contact_number'] || '',
  }));
}

/**
 * Validate and map customer data
 */
export function mapCustomerData(rawData: any[]): any[] {
  return rawData.map((row) => ({
    customer_code: row['Customer Code'] || row['customer_code'] || '',
    customer_name: row['Customer Name'] || row['customer_name'] || '',
    contact_person: row['Contact Person'] || row['contact_person'] || '',
    address: row['Address'] || row['address'] || '',
    phone: row['Phone'] || row['phone'] || '',
    email: row['Email'] || row['email'] || '',
    tin: row['TIN'] || row['tin'] || '',
  }));
}

/**
 * Validate and map items data
 */
export function mapItemData(rawData: any[]): any[] {
  return rawData.map((row) => ({
    item_code: row['Item Code'] || row['item_code'] || '',
    item_name: row['Item Name'] || row['item_name'] || '',
    description: row['Description'] || row['description'] || '',
    item_uom: row['Item UOM'] || row['item_uom'] || 'pcs',
    min_stock_level: parseInt(row['Min Stock'] || row['min_stock_level'] || '10') || 10,
    max_stock_level: parseInt(row['Max Stock'] || row['max_stock_level'] || '100') || 100,
    reorder_point: parseInt(row['Reorder Point'] || row['reorder_point'] || '20') || 20,
    abc_classification: row['ABC Class'] || row['abc_classification'] || 'C',
    item_category: row['Item Category'] || row['item_category'] || '',
    item_group: row['Item Group'] || row['item_group'] || '',
    length_cm: parseFloat(row['Length (CM)'] || row['length_cm'] || '0') || 0,
    width_cm: parseFloat(row['Width (CM)'] || row['width_cm'] || '0') || 0,
    height_cm: parseFloat(row['Height (CM)'] || row['height_cm'] || '0') || 0,
    volume_cbm: parseFloat(row['Volume (CBM)'] || row['volume_cbm'] || '0') || 0,
    pallet_height_cm: parseFloat(row['Pallet Height (CM)'] || row['pallet_height_cm'] || '0') || 0,
    stackable: (row['Stackable'] || row['stackable'] || 'No').toLowerCase() === 'yes',
    max_stack_height: parseInt(row['Max Stack Height'] || row['max_stack_height'] || '1') || 1,
    batch_tracking: (row['Batch Tracking'] || row['batch_tracking'] || 'No').toLowerCase() === 'yes',
    serial_tracking: (row['Serial Tracking'] || row['serial_tracking'] || 'No').toLowerCase() === 'yes',
    expiry_tracking: (row['Expiry Tracking'] || row['expiry_tracking'] || 'No').toLowerCase() === 'yes',
    shelf_life_days: parseInt(row['Shelf Life Days'] || row['shelf_life_days'] || '0') || 0,
    is_perishable: (row['Is Perishable'] || row['is_perishable'] || 'No').toLowerCase() === 'yes',
    allocation_rule: row['Allocation Rule'] || row['allocation_rule'] || 'FIFO',
    picking_method: row['Picking Method'] || row['picking_method'] || 'Single-bin',
    brand: row['Brand'] || row['brand'] || '',
    color: row['Color'] || row['color'] || '',
    pallet_config: row['Pallet Config'] || row['pallet_config'] || '',
    weight_uom_kg: parseFloat(row['Weight UOM (KG)'] || row['weight_uom_kg'] || '0') || 0,
    is_active: (row['Status'] || row['is_active'] || 'Active').toLowerCase() === 'active',
  }));
}

/**
 * Validate and map warehouse data
 */
export function mapWarehouseData(rawData: any[]): any[] {
  return rawData.map((row) => ({
    warehouse_code: row['Warehouse Code'] || row['warehouse_code'] || '',
    warehouse_name: row['Warehouse Name'] || row['warehouse_name'] || '',
    address: row['Address'] || row['address'] || '',
    phone: row['Phone'] || row['phone'] || '',
    manager_name: row['Manager Name'] || row['manager_name'] || '',
    status: row['Status'] || row['status'] || 'Active',
  }));
}

/**
 * Validate and map location data
 */
export function mapLocationData(rawData: any[]): any[] {
  return rawData.map((row) => ({
    location_code: row['Location Code'] || row['location_code'] || '',
    location_name: row['Location Name'] || row['location_name'] || '',
    warehouse_id: (row['Warehouse ID'] || row['warehouse_id']) ? parseInt(row['Warehouse ID'] || row['warehouse_id']) : null,
    location_type: row['Location Type'] || row['location_type'] || '',
    zone: row['Zone'] || row['zone'] || '',
    aisle: row['Aisle'] || row['aisle'] || '',
    rack: row['Rack'] || row['rack'] || '',
    level: row['Level'] || row['level'] || '',
    bin: row['Bin'] || row['bin'] || '',
    max_weight_kg: (row['Max Weight (KG)'] || row['max_weight_kg']) ? parseFloat(row['Max Weight (KG)'] || row['max_weight_kg']) : null,
    max_volume_cbm: (row['Max Volume (CBM)'] || row['max_volume_cbm']) ? parseFloat(row['Max Volume (CBM)'] || row['max_volume_cbm']) : null,
    max_pallets: (row['Max Pallets'] || row['max_pallets']) ? parseInt(row['Max Pallets'] || row['max_pallets']) : null,
    temperature_controlled: (row['Temperature Controlled'] || row['temperature_controlled'] || 'No').toLowerCase() === 'yes',
    hazmat_approved: (row['Hazmat Approved'] || row['hazmat_approved'] || 'No').toLowerCase() === 'yes',
    is_active: (row['Status'] || row['is_active'] || 'Active').toLowerCase() === 'active',
  }));
}

/**
 * Validate and map user data
 */
export function mapUserData(rawData: any[]): any[] {
  return rawData.map((row) => ({
    username: row['Username'] || row['username'] || '',
    email: row['Email'] || row['email'] || '',
    full_name: row['Full Name'] || row['full_name'] || '',
    role: row['Role'] || row['role'] || 'User',
    status: row['Status'] || row['status'] || 'Active',
  }));
}

/**
 * Batch POST data to backend with duplicate detection
 * Checks for existing records by unique identifiers before inserting
 * Now routes through API layer to avoid CSP violations
 */
export async function bulkImportData(
  endpoint: string,
  data: any[],
  apiKey: string,
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number; skipped: number; errors: string[] }> {
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];

  // Extract table name from endpoint URL for API route
  // Example: 'http://172.31.39.68:8030/vendors' → 'vendors'
  const tableName = endpoint.split('/').pop() || 'unknown';

  // Determine the unique identifier field based on endpoint
  let uniqueField = 'id';
  let codeField = 'code';
  
  if (endpoint.includes('vendor')) {
    codeField = 'vendor_code';
  } else if (endpoint.includes('customer')) {
    codeField = 'customer_code';
  } else if (endpoint.includes('item')) {
    codeField = 'item_code';
  } else if (endpoint.includes('warehouse')) {
    codeField = 'warehouse_code';
  } else if (endpoint.includes('location')) {
    codeField = 'location_code';
  } else if (endpoint.includes('user')) {
    codeField = 'username';
  }

  // Fetch existing records via API layer to check for duplicates
  let existingRecords: any[] = [];
  try {
    // Route through API instead of direct backend call to avoid CSP violations
    const checkRes = await fetch(`/api/config-records?type=${tableName}`);
    if (checkRes.ok) {
      const responseData = await checkRes.json();
      // The API returns {vendors: [...], customers: [...], etc}
      existingRecords = Array.isArray(responseData[tableName]) 
        ? responseData[tableName] 
        : Array.isArray(responseData) 
          ? responseData 
          : [];
    }
  } catch (error) {
    console.warn('Failed to fetch existing records for duplicate check:', error);
  }

  // Create a set of existing codes for quick lookup
  const existingCodes = new Set(
    existingRecords.map((rec: any) => rec[codeField]).filter(Boolean)
  );

  for (let i = 0; i < data.length; i++) {
    const record = data[i];
    
    // Check if record already exists
    if (record[codeField] && existingCodes.has(record[codeField])) {
      skippedCount++;
      errors.push(`Row ${i + 1}: Skipped - ${codeField} "${record[codeField]}" already exists`);
      if (onProgress) {
        onProgress(i + 1, data.length);
      }
      continue;
    }

    try {
      // Clean the record - remove null, undefined, and empty string values
      const cleanedRecord: any = {};
      Object.keys(record).forEach((key) => {
        const value = record[key];
        // Keep the value if it's not null, undefined, empty string, or NaN
        if (value !== null && value !== undefined && value !== '' && !Number.isNaN(value)) {
          cleanedRecord[key] = value;
        }
      });

      // Route through API layer instead of direct backend call to avoid CSP violations
      const res = await fetch(`/api/bulk-insert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          table: tableName,
          data: cleanedRecord,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        // Check if it's a duplicate constraint error
        if (res.status === 409 || errorText.includes('duplicate')) {
          skippedCount++;
          errors.push(`Row ${i + 1}: Skipped - Duplicate record (${record[codeField]})`);
        } else {
          failedCount++;
          errors.push(`Row ${i + 1}: ${res.status} - ${errorText}`);
        }
      } else {
        successCount++;
        // Add to existing codes to prevent duplicates within batch
        if (record[codeField]) {
          existingCodes.add(record[codeField]);
        }
      }
    } catch (error) {
      failedCount++;
      errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (onProgress) {
      onProgress(i + 1, data.length);
    }
  }

  return { success: successCount, failed: failedCount, skipped: skippedCount, errors };
}
