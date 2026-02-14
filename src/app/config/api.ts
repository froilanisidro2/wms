// API functions for config tables


const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';

/**
 * Fetches config/master data from the cached API endpoint
 * Uses server-side caching with 7-day TTL
 */
async function fetchConfigData(endpoint: string, refresh: boolean = true) {
  if (!endpoint) throw new Error('Endpoint is not defined');
  
  try {
    // Call the server-side cached API instead of external API directly
    // Use refresh=true to force fresh data on initial load
    const refreshParam = refresh ? '?refresh=true' : '';
    const response = await fetch(`/api/config-records${refreshParam}`);
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    
    const data = await response.json();
    
    // Return the specific endpoint data requested
    const endpointMap: { [key: string]: keyof typeof data } = {
      'vendors': 'vendors',
      'customers': 'customers',
      'items': 'items',
      'warehouses': 'warehouses',
      'locations': 'locations',
      'companies': 'companies',
    };
    
    const key = endpointMap[endpoint];
    return key ? data[key] : [];
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error);
    throw error;
  }
}

// Specific functions for each config/master table
export async function getVendors() {
  return fetchConfigData('vendors');
}

export async function getCustomers() {
  return fetchConfigData('customers');
}

export async function getItems() {
  return fetchConfigData('items');
}

export async function getWarehouses() {
  return fetchConfigData('warehouses');
}

export async function getLocations() {
  return fetchConfigData('locations');
}

export async function getCompanies() {
  return fetchConfigData('companies');
}
