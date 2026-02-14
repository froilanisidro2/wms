import { NextRequest, NextResponse } from 'next/server';

const apiKey = process.env.NEXT_PUBLIC_X_API_KEY || '';
// Internal API calls use HTTP on internal network (safe, faster)
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || 'http://47.128.154.44:8030').replace(/^https?:\/\//, 'http://');
const urlGatepassHeaders = (process.env.NEXT_PUBLIC_URL_GATEPASS_HEADERS || `${API_BASE}/gatepass_headers`).replace(/^https?:\/\//, 'http://');
const urlLoadingChecklist = (process.env.NEXT_PUBLIC_URL_LOADING_CHECKLIST || `${API_BASE}/loading_checklist`).replace(/^https?:\/\//, 'http://');
const urlSOInventory = (process.env.NEXT_PUBLIC_URL_SO_INVENTORY || `${API_BASE}/so_inventory`).replace(/^https?:\/\//, 'http://');

/**
 * Get gatepass records with optional filtering
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const soHeaderId = searchParams.get('so_header_id');
    const gatepassId = searchParams.get('gatepass_id');
    const action = searchParams.get('action');

    // Handle loading checklist fetch
    if (action === 'loading-checklist' && gatepassId) {
      console.log(`📦 Fetching loading checklist for gatepass ${gatepassId}`);
      const url = `${urlLoadingChecklist}?gatepass_id=eq.${gatepassId}&order=id.asc`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'x-api-key': apiKey },
      });

      if (!response.ok) {
        throw new Error(`Loading checklist API returned ${response.status}`);
      }

      const data = await response.json();
      const records = Array.isArray(data) ? data : (data ? [data] : []);
      
      console.log(`✅ Fetched ${records.length} loading checklist items`);
      return NextResponse.json(records);
    }

    // Default: fetch gatepass headers
    let url = urlGatepassHeaders;
    if (soHeaderId) {
      url += `?so_header_id=eq.${soHeaderId}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      throw new Error(`Gatepass API returned ${response.status}`);
    }

    const data = await response.json();
    const records = Array.isArray(data) ? data : (data ? [data] : []);

    return NextResponse.json({
      success: true,
      data: records,
    });
  } catch (error) {
    console.error('Error fetching gatepass records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch gatepass records' },
      { status: 500 }
    );
  }
}

/**
 * Create new gatepass
 */
export async function POST(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON body', details: String(parseError) },
        { status: 400 }
      );
    }

    const action = body.action;
    console.log('Processing action:', action, 'with body:', JSON.stringify(body).substring(0, 200));

    // Update existing gatepass header
    if (action === 'update-gatepass') {
      try {
        const gatepassId = body.gatepassId;
        if (!gatepassId) {
          throw new Error('gatepassId is required for update-gatepass action');
        }

        const updateData = {
          driver_name: body.driver_name,
          driver_phone: body.driver_phone,
          vehicle_plate_no: body.vehicle_plate_no,
          trucking_company: body.trucking_company,
          route: body.route,
          remarks: body.remarks,
          status: body.status || 'Issued',
          updated_at: new Date().toISOString(),
        };

        console.log('Updating gatepass:', gatepassId, 'with data:', JSON.stringify(updateData));

        const response = await fetch(`${urlGatepassHeaders}?id=eq.${gatepassId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(updateData),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`PostgREST returned ${response.status}:`, errorText);
          throw new Error(`Failed to update gatepass: ${response.status} - ${errorText}`);
        }

        console.log('✅ Gatepass updated successfully:', gatepassId);

        return NextResponse.json({
          success: true,
          message: 'Gatepass updated successfully',
          gatepassId,
        });
      } catch (err) {
        console.error('Error in update-gatepass action:', err);
        throw err;
      }
    }

    // Create gatepass header
    if (action === 'create-gatepass') {
      try {
        const gatepassData = {
          so_header_id: body.so_header_id,
          so_inventory_id: body.so_inventory_id || null,
          gatepass_number: body.gatepass_number,
          gatepass_date: body.gatepass_date,
          driver_name: body.driver_name,
          driver_phone: body.driver_phone,
          vehicle_plate_no: body.vehicle_plate_no,
          trucking_company: body.trucking_company,
          route: body.route,
          item_code: body.item_code || null,
          item_name: body.item_name || null,
          batch_number: body.batch_number || null,
          manufacturing_date: body.manufacturing_date || null,
          expiry_date: body.expiry_date || null,
          weight_uom_kg: body.weight_uom_kg || null,
          uom: body.uom || null,
          status: 'Issued',
          loading_checklist_status: 'Pending',
          remarks: body.remarks,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        console.log('Sending gatepass data to PostgREST:', JSON.stringify(gatepassData));

        const response = await fetch(urlGatepassHeaders, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(gatepassData),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`PostgREST returned ${response.status}:`, errorText);
          throw new Error(`Failed to create gatepass: ${response.status} - ${errorText}`);
        }

        const responseText = await response.text();
        console.log('PostgREST response:', responseText);
        
        let result;
        let gatepassId;
        
        if (responseText) {
          try {
            result = JSON.parse(responseText);
            gatepassId = Array.isArray(result) ? result[0]?.id : result?.id;
          } catch (e) {
            console.warn('PostgREST returned non-JSON response, will query gatepass by date+header');
            // PostgREST may not return data, so we'll fetch the latest gatepass for this SO
            const latestResponse = await fetch(
              `${urlGatepassHeaders}?so_header_id=eq.${body.so_header_id}&order=id.desc&limit=1`,
              {
                method: 'GET',
                headers: { 'x-api-key': apiKey },
              }
            );
            if (latestResponse.ok) {
              const latestData = await latestResponse.json();
              gatepassId = Array.isArray(latestData) && latestData.length > 0 ? latestData[0].id : null;
            }
          }
        } else {
          // Empty response - fetch the latest gatepass for this SO
          console.warn('PostgREST returned empty response, will query gatepass by date+header');
          const latestResponse = await fetch(
            `${urlGatepassHeaders}?so_header_id=eq.${body.so_header_id}&order=id.desc&limit=1`,
            {
              method: 'GET',
              headers: { 'x-api-key': apiKey },
            }
          );
          if (latestResponse.ok) {
            const latestData = await latestResponse.json();
            gatepassId = Array.isArray(latestData) && latestData.length > 0 ? latestData[0].id : null;
          }
        }

        console.log('Gatepass created with ID:', gatepassId);

        return NextResponse.json({
          success: true,
          message: 'Gatepass created successfully',
          gatepassId,
        });
      } catch (err) {
        console.error('Error in create-gatepass action:', err);
        throw err;
      }
    }

    // Create loading checklist items
    if (action === 'create-loading-checklist') {
      try {
        const items = body.items || [];
        const createdItems = [];
        let hasErrors = false;
        const errors = [];

        console.log(`Processing ${items.length} loading checklist items for gatepass ${body.gatepass_id}`);

        for (const item of items) {
          try {
            // Fetch batch details from so_inventory if so_inventory_id is provided
            let batchDetails: any = {
              batch_number: item.batch_number,
              manufacturing_date: item.manufacturing_date || null,
              expiry_date: item.expiry_date || null,
              weight_uom_kg: item.weight_kg || item.weight_uom_kg,
              uom: item.uom,
              pallet_id: item.pallet_id,
            };

            if (item.so_inventory_id) {
              try {
                const soInventoryResponse = await fetch(
                  `${urlSOInventory}?id=eq.${item.so_inventory_id}`,
                  {
                    method: 'GET',
                    headers: { 'x-api-key': apiKey },
                  }
                );

                if (soInventoryResponse.ok) {
                  const soInventoryData = await soInventoryResponse.json();
                  const soInventory = Array.isArray(soInventoryData) ? soInventoryData[0] : soInventoryData;

                  if (soInventory) {
                    // Override with so_inventory data if available
                    batchDetails.batch_number = soInventory.batch_number || item.batch_number;
                    batchDetails.manufacturing_date = soInventory.manufacturing_date || item.manufacturing_date;
                    batchDetails.expiry_date = soInventory.expiry_date || item.expiry_date;
                    batchDetails.weight_uom_kg = soInventory.weight_uom_kg || item.weight_kg || item.weight_uom_kg;
                    batchDetails.uom = soInventory.uom || item.uom;
                    batchDetails.pallet_id = soInventory.pallet_id || item.pallet_id;
                  }
                }
              } catch (err) {
                console.error('Error fetching so_inventory details for so_line', item.so_line_id, ':', err);
                // Continue with provided batch details
              }
            }

            const checklistData = {
              gatepass_id: body.gatepass_id,
              so_line_id: item.so_line_id,
              so_inventory_id: item.so_inventory_id,
              item_id: item.item_id,
              item_code: item.item_code,
              item_name: item.item_name,
              batch_number: batchDetails.batch_number,
              manufacturing_date: batchDetails.manufacturing_date,
              expiry_date: batchDetails.expiry_date,
              ordered_qty: item.ordered_quantity,
              packed_qty: item.ordered_quantity,
              weight_uom_kg: batchDetails.weight_uom_kg,
              uom: batchDetails.uom,
              pallet_id: batchDetails.pallet_id,
              location_code: item.location_code,
              status: 'Pending',
              remarks: item.remarks,
              created_at: new Date().toISOString(),
            };

            console.log(`[LoadingChecklist] SO line ${item.so_line_id} - so_inventory_id: ${checklistData.so_inventory_id}, batch_number: ${checklistData.batch_number}, mfg_date: ${checklistData.manufacturing_date}, exp_date: ${checklistData.expiry_date}`);

            const response = await fetch(urlLoadingChecklist, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'Prefer': 'return=representation',
              },
              body: JSON.stringify(checklistData),
            });

            if (response.ok) {
              const responseText = await response.text();
              let result;
              if (responseText) {
                try {
                  result = JSON.parse(responseText);
                  createdItems.push(Array.isArray(result) ? result[0] : result);
                } catch (e) {
                  console.warn(`PostgREST returned non-JSON for SO line ${item.so_line_id}, assuming success`);
                  createdItems.push({ so_line_id: item.so_line_id });
                }
              } else {
                console.warn(`PostgREST returned empty response for SO line ${item.so_line_id}, assuming success`);
                createdItems.push({ so_line_id: item.so_line_id });
              }
              console.log(`✅ Created loading_checklist for SO line ${item.so_line_id}`);
            } else {
              const errorText = await response.text();
              const errorMsg = `Failed to create loading checklist for SO line ${item.so_line_id}: ${response.status} - ${errorText}`;
              console.error(errorMsg);
              errors.push(errorMsg);
              hasErrors = true;
            }
          } catch (itemError) {
            const errorMsg = `Error processing loading checklist item for SO line ${item.so_line_id}: ${String(itemError)}`;
            console.error(errorMsg);
            errors.push(errorMsg);
            hasErrors = true;
          }
        }

        console.log(`Completed loading checklist creation: ${createdItems.length} succeeded, ${errors.length} failed`);

        return NextResponse.json({
          success: !hasErrors,
          message: `Created ${createdItems.length} loading checklist items${hasErrors ? ' (with some errors)' : ''}`,
          items: createdItems,
          errors: hasErrors ? errors : undefined,
        });
      } catch (err) {
        console.error('Error in create-loading-checklist action:', err);
        throw err;
      }
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('ERROR in POST /api/gatepass:', {
      message: errorMessage,
      stack: errorStack,
      error
    });
    return NextResponse.json(
      { 
        error: 'Failed to process gatepass request',
        details: errorMessage,
        stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * Update gatepass
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updateData } = body;

    const response = await fetch(`${urlGatepassHeaders}?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        ...updateData,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to update gatepass: ${response.status}`);
    }

    return NextResponse.json({
      success: true,
      message: 'Gatepass updated successfully',
    });
  } catch (error) {
    console.error('Error updating gatepass:', error);
    return NextResponse.json(
      { error: 'Failed to update gatepass' },
      { status: 500 }
    );
  }
}

export const maxDuration = 300; // 5 minutes for gatepass operations
