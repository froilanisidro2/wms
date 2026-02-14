/**
 * Browser-safe API helpers for PATCH/update operations
 * 
 * IMPORTANT: Browser code must use these functions, not direct fetch calls
 * All fetch calls to database must go through Next.js API routes
 */

/**
 * Update a database record via API route
 * 
 * @param table - Table name (e.g., 'asn_lines', 'so_lines', 'putaway_transactions')
 * @param id - Record ID
 * @param data - Object with fields to update
 * @returns Response with success status
 */
export async function patchRecord(table: string, id: number, data: Record<string, any>) {
  try {
    const response = await fetch('/api/patch-record', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ table, id, data }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ PATCH ${table} failed:`, errorText);
      throw new Error(`PATCH failed: ${errorText}`);
    }

    const result = await response.json();
    console.log(`✓ PATCH ${table} successful`, result);
    return result;
  } catch (error: any) {
    console.error(`Error updating ${table}:`, error);
    throw error;
  }
}

/**
 * Update ASN lines
 */
export async function patchAsnLine(id: number, data: Record<string, any>) {
  return patchRecord('asn_lines', id, data);
}

/**
 * Update SO lines
 */
export async function patchSoLine(id: number, data: Record<string, any>) {
  return patchRecord('so_lines', id, data);
}

/**
 * Update putaway transactions
 */
export async function patchPutawayTransaction(id: number, data: Record<string, any>) {
  return patchRecord('putaway_transactions', id, data);
}

/**
 * Generic status update function
 */
export async function updateRecordStatus(table: string, id: number, status: string) {
  return patchRecord(table, id, { status });
}

/**
 * Batch update multiple records
 */
export async function patchMultipleRecords(
  updates: Array<{ table: string; id: number; data: Record<string, any> }>
) {
  const results = await Promise.allSettled(
    updates.map((update) => patchRecord(update.table, update.id, update.data))
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    console.error(`⚠️ ${failures.length} PATCH operations failed`);
  }

  return results;
}
