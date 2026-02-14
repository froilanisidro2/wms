/**
 * Excel Template Generator for WMS System
 * Generates downloadable Excel templates for bulk import
 */

/**
 * Generate and download Excel template for a specific entity
 */
export function downloadTemplate(entityType: string) {
  // Dynamic import of SheetJS
  import('xlsx').then((XLSX) => {
    const templates: { [key: string]: any } = {
      vendors: {
        'Vendor Code': 'VND001',
        'Vendor Name': 'Sample Vendor Name',
        'Contact Person': 'John Doe',
        'Address': '123 Main St, City, Country',
        'Phone': '+1234567890',
        'Email': 'vendor@example.com',
        'TIN': '123456789',
        'Payment Terms': 'Net 30',
        'Delivery Terms': 'FOB Shipping Point',
        'Contact Number': '+1234567890',
      },
      customers: {
        'Customer Code': 'CUST001',
        'Customer Name': 'Sample Customer Name',
        'Contact Person': 'Jane Smith',
        'Address': '456 Oak St, City, Country',
        'Phone': '+0987654321',
        'Email': 'customer@example.com',
        'TIN': '987654321',
      },
      items: {
        'Item Code': 'ITEM001',
        'Item Name': 'Sample Product',
        'Description': 'Product description',
        'Item UOM': 'pcs',
        'Min Stock': 10,
        'Max Stock': 500,
        'Reorder Point': 50,
        'ABC Class': 'A',
        'Status': 'Active',
        'Item Category': 'Electronics',
        'Item Group': 'Computers',
        'Length (CM)': 30,
        'Width (CM)': 20,
        'Height (CM)': 15,
        'Volume (CBM)': 0.009,
        'Pallet Height (CM)': 150,
        'Stackable': 'Yes',
        'Max Stack Height': 5,
        'Batch Tracking': 'Yes',
        'Serial Tracking': 'No',
        'Expiry Tracking': 'No',
        'Shelf Life Days': 365,
        'Is Perishable': 'No',
        'Allocation Rule': 'FIFO',
        'Picking Method': 'Single-bin',
        'Brand': 'Sample Brand',
        'Color': 'Black',
        'Pallet Config': 'Standard',
        'Weight UOM (KG)': 1.5,
      },
      warehouses: {
        'Warehouse Code': 'WH001',
        'Warehouse Name': 'Main Warehouse',
        'Address': '789 Industrial Ave, City',
        'Phone': '+1111111111',
        'Manager Name': 'John Manager',
        'Status': 'Active',
      },
      locations: {
        'Location Code': 'LOC001',
        'Location Name': 'Aisle A, Rack 1, Level 1',
        'Warehouse ID': 1,
        'Location Type': 'Aisle',
        'Zone': 'A',
        'Aisle': '1',
        'Rack': '1',
        'Level': '1',
        'Bin': '1',
        'Max Weight (KG)': 1000,
        'Max Volume (CBM)': 10,
        'Max Pallets': 5,
        'Temperature Controlled': 'No',
        'Hazmat Approved': 'No',
        'Status': 'Active',
      },
      users: {
        'Username': 'user001',
        'Email': 'user@example.com',
        'Full Name': 'Sample User',
        'Role': 'Warehouse Staff',
        'Warehouse ID': 1,
        'Status': 'Active',
      },
    };

    const data = templates[entityType] || {};
    const worksheet = XLSX.utils.json_to_sheet([data]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, entityType);

    // Auto-size columns
    const columnWidths = Object.keys(data).map((key) => ({
      wch: Math.max(key.length, String(data[key]).length) + 2,
    }));
    worksheet['!cols'] = columnWidths;

    XLSX.writeFile(workbook, `${entityType}_template.xlsx`);
  });
}
