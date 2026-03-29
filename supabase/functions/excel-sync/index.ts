import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID") || "common";

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const tokenParams = new URLSearchParams({
    client_id: clientId!,
    client_secret: clientSecret!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: "https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/User.Read offline_access",
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
  });

  if (!response.ok) {
    console.error("Failed to refresh token:", await response.text());
    return null;
  }

  return await response.json();
}

async function getValidToken(supabase: any, integration: any, integrationId: string) {
  let accessToken = integration.access_token;
  const tokenExpiry = new Date(integration.token_expires_at);

  if (tokenExpiry <= new Date()) {
    console.log("Token expired, refreshing...");
    const newTokens = await refreshAccessToken(integration.refresh_token);
    if (!newTokens) {
      await supabase
        .from("excel_integrations")
        .update({ sync_status: "token_expired", error_message: "Failed to refresh token" })
        .eq("id", integrationId);
      return null;
    }
    const newExpiry = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
    await supabase
      .from("excel_integrations")
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        token_expires_at: newExpiry,
      })
      .eq("id", integrationId);
    accessToken = newTokens.access_token;
  }
  return accessToken;
}

async function ensureWorksheet(accessToken: string, fileId: string, sheetName: string) {
  // Check if worksheet exists
  const checkRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${sheetName}')`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (checkRes.ok) return true;
  await checkRes.text(); // consume body

  // Create worksheet
  const createRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets/add`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: sheetName }),
    }
  );
  if (!createRes.ok) {
    const err = await createRes.text();
    console.error("Failed to create worksheet:", err);
    return false;
  }
  await createRes.text();
  return true;
}

const INVENTORY_HEADERS = [
  "ID", "SKU", "Item Name", "Current Quantity", "Minimum Threshold",
  "Default Reorder Qty", "Unit", "Is Active", "Last Modified"
];

function parseExcelRow(row: any[]): Record<string, any> | null {
  if (!row || row.length < 2 || !row[0] || row[0] === "ID") return null;
  return {
    id: row[0]?.toString() || "",
    sku: row[1]?.toString() || "",
    item_name: row[2]?.toString() || "",
    current_quantity: parseInt(row[3]?.toString() || "0", 10) || 0,
    minimum_threshold: parseInt(row[4]?.toString() || "10", 10) || 10,
    default_reorder_quantity: parseInt(row[5]?.toString() || "50", 10) || 50,
    unit: row[6]?.toString() || "units",
    is_active: (row[7]?.toString() || "Yes") === "Yes",
    updated_at: row[8]?.toString() || null,
  };
}

function dbRowToExcel(item: any): any[] {
  return [
    item.id,
    item.sku,
    item.item_name,
    item.current_quantity,
    item.minimum_threshold,
    item.default_reorder_quantity,
    item.unit,
    item.is_active ? "Yes" : "No",
    item.updated_at,
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Missing Supabase configuration");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json().catch(() => ({}));
    const { integrationId, action, fileId, sheetName } = body;

    const { data: integration, error: integrationError } = await supabase
      .from("excel_integrations")
      .select("*")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      return new Response(
        JSON.stringify({ error: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getValidToken(supabase, integration, integrationId);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Token expired, please reconnect" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    switch (action) {
      case "list-files": {
        const filesResponse = await fetch(
          "https://graph.microsoft.com/v1.0/me/drive/root/search(q='.xlsx')?$top=50",
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!filesResponse.ok) throw new Error("Failed to list files");
        const filesData = await filesResponse.json();
        return new Response(
          JSON.stringify({ files: filesData.value }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "read-sheet": {
        if (!fileId) throw new Error("fileId is required");
        const worksheetName = sheetName || "Sheet1";
        const sheetResponse = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/usedRange`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!sheetResponse.ok) throw new Error("Failed to read sheet data");
        const sheetData = await sheetResponse.json();
        return new Response(
          JSON.stringify({ data: sheetData }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "write-sheet": {
        if (!fileId || !body.data) throw new Error("fileId and data are required");
        const worksheetName = sheetName || "Sheet1";
        const range = body.range || "A1";
        const writeResponse = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/range(address='${range}')`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: body.data }),
          }
        );
        if (!writeResponse.ok) throw new Error("Failed to write to sheet");
        await writeResponse.text();
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "sync-bills": {
        if (!fileId) throw new Error("fileId is required for syncing bills");
        const worksheetName = sheetName || "Bills";

        const { data: bills, error: billsError } = await supabase
          .from("bills")
          .select("*")
          .order("created_at", { ascending: false });

        if (billsError) throw new Error("Failed to fetch bills");

        const headers = [
          "ID", "Vendor Name", "Bill Number", "Bill Date", "Total Amount",
          "Payment Status", "Category", "GST Number", "Verified", "Created At"
        ];

        const billRows = bills.map((bill: any) => [
          bill.id, bill.vendor_name, bill.bill_number || "", bill.bill_date || "",
          bill.total_amount?.toString() || "0", bill.payment_status || "pending",
          bill.category_id || "", bill.vendor_gst || "",
          bill.is_verified ? "Yes" : "No", bill.created_at,
        ]);

        const allRows = [headers, ...billRows];
        const rangeAddress = `A1:J${allRows.length}`;
        const writeResponse = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/range(address='${rangeAddress}')`,
          {
            method: "PATCH",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: allRows }),
          }
        );

        if (!writeResponse.ok) throw new Error("Failed to sync bills to Excel");
        await writeResponse.text();

        await supabase.from("excel_integrations").update({
          last_sync_at: new Date().toISOString(),
          sync_status: "synced",
          error_message: null,
        }).eq("id", integrationId);

        return new Response(
          JSON.stringify({ success: true, rowsWritten: billRows.length }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "sync-inventory": {
        if (!fileId) throw new Error("fileId is required");
        const worksheetName = sheetName || "Inventory";

        // Ensure worksheet exists
        await ensureWorksheet(accessToken, fileId, worksheetName);

        // 1. Read current Excel data
        let excelRows: any[][] = [];
        const sheetResponse = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/usedRange`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (sheetResponse.ok) {
          const sheetData = await sheetResponse.json();
          excelRows = sheetData.values || [];
        } else {
          await sheetResponse.text();
        }

        // 2. Read DB inventory
        const { data: dbItems, error: dbErr } = await supabase
          .from("inventory_items")
          .select("*")
          .order("created_at", { ascending: true });

        if (dbErr) throw new Error("Failed to fetch inventory items");

        // 3. Parse Excel rows (skip header)
        const excelMap = new Map<string, Record<string, any>>();
        const excelNewRows: Record<string, any>[] = [];
        for (let i = 1; i < excelRows.length; i++) {
          const parsed = parseExcelRow(excelRows[i]);
          if (!parsed) continue;
          if (parsed.id && parsed.id.length > 10) {
            excelMap.set(parsed.id, parsed);
          } else {
            // New row added in Excel (no valid UUID id)
            if (parsed.sku && parsed.item_name) {
              excelNewRows.push(parsed);
            }
          }
        }

        // 4. Build DB map
        const dbMap = new Map<string, any>();
        for (const item of (dbItems || [])) {
          dbMap.set(item.id, item);
        }

        const dbUpdates: any[] = [];
        const excelUpdates: any[] = [];
        let newInserts = 0;

        // 5. Merge: items in both — last write wins
        for (const [id, dbItem] of dbMap) {
          const excelItem = excelMap.get(id);
          if (excelItem) {
            const dbTime = new Date(dbItem.updated_at).getTime();
            const excelTime = excelItem.updated_at ? new Date(excelItem.updated_at).getTime() : 0;

            if (excelTime > dbTime) {
              // Excel wins — update DB
              dbUpdates.push({
                id,
                sku: excelItem.sku,
                item_name: excelItem.item_name,
                current_quantity: excelItem.current_quantity,
                minimum_threshold: excelItem.minimum_threshold,
                default_reorder_quantity: excelItem.default_reorder_quantity,
                unit: excelItem.unit,
                is_active: excelItem.is_active,
              });
            }
            // If DB is newer or same, Excel will get DB version (handled below)
            excelMap.delete(id);
          }
          // Item only in DB → will be added to Excel
          excelUpdates.push(dbItem);
        }

        // 6. Items only in Excel (deleted from DB or orphaned) — skip them
        // New rows from Excel without valid ID → insert into DB
        for (const newRow of excelNewRows) {
          const { error: insertErr } = await supabase
            .from("inventory_items")
            .insert({
              sku: newRow.sku,
              item_name: newRow.item_name,
              current_quantity: newRow.current_quantity,
              minimum_threshold: newRow.minimum_threshold,
              default_reorder_quantity: newRow.default_reorder_quantity,
              unit: newRow.unit,
              is_active: newRow.is_active,
            });
          if (!insertErr) newInserts++;
        }

        // 7. Apply DB updates from Excel changes
        for (const update of dbUpdates) {
          const { id, ...fields } = update;
          await supabase.from("inventory_items").update(fields).eq("id", id);
        }

        // 8. Re-read DB to get final state (with new inserts and updates)
        const { data: finalItems } = await supabase
          .from("inventory_items")
          .select("*")
          .order("created_at", { ascending: true });

        // 9. Write complete inventory back to Excel
        const finalRows = (finalItems || []).map(dbRowToExcel);
        const allRows = [INVENTORY_HEADERS, ...finalRows];

        // Clear existing data first
        try {
          const clearRes = await fetch(
            `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/range/clear`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ applyTo: "All" }),
            }
          );
          await clearRes.text();
        } catch (e) {
          console.log("Clear failed (may be empty sheet):", e);
        }

        if (allRows.length > 0) {
          const rangeAddress = `A1:I${allRows.length}`;
          const writeRes = await fetch(
            `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/range(address='${rangeAddress}')`,
            {
              method: "PATCH",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ values: allRows }),
            }
          );
          if (!writeRes.ok) {
            const err = await writeRes.text();
            console.error("Failed to write inventory to Excel:", err);
            throw new Error("Failed to write inventory to Excel");
          }
          await writeRes.text();
        }

        // 10. Update sync timestamp
        await supabase.from("excel_integrations").update({
          last_sync_at: new Date().toISOString(),
          sync_status: "synced",
          error_message: null,
        }).eq("id", integrationId);

        return new Response(
          JSON.stringify({
            success: true,
            summary: {
              totalItems: (finalItems || []).length,
              dbUpdatesFromExcel: dbUpdates.length,
              newFromExcel: newInserts,
            },
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (error: unknown) {
    console.error("Error in excel-sync:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
