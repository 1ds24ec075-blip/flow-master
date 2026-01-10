import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { integrationId, action, fileId, sheetName } = body;

    // Get integration details
    const { data: integration, error: integrationError } = await supabase
      .from("excel_integrations")
      .select("*")
      .eq("id", integrationId)
      .single();

    if (integrationError || !integration) {
      console.error("Integration not found:", integrationError);
      return new Response(
        JSON.stringify({ error: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if token needs refresh
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

        return new Response(
          JSON.stringify({ error: "Token expired, please reconnect" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update tokens in database
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

    // Handle different actions
    switch (action) {
      case "list-files": {
        // List Excel files in OneDrive
        const filesResponse = await fetch(
          "https://graph.microsoft.com/v1.0/me/drive/root/search(q='.xlsx')?$top=50",
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!filesResponse.ok) {
          throw new Error("Failed to list files");
        }

        const filesData = await filesResponse.json();
        return new Response(
          JSON.stringify({ files: filesData.value }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "read-sheet": {
        if (!fileId) {
          throw new Error("fileId is required");
        }

        // Get worksheet data
        const worksheetName = sheetName || "Sheet1";
        const sheetResponse = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/usedRange`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        if (!sheetResponse.ok) {
          const errorText = await sheetResponse.text();
          console.error("Failed to read sheet:", errorText);
          throw new Error("Failed to read sheet data");
        }

        const sheetData = await sheetResponse.json();
        return new Response(
          JSON.stringify({ data: sheetData }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "write-sheet": {
        if (!fileId || !body.data) {
          throw new Error("fileId and data are required");
        }

        const worksheetName = sheetName || "Sheet1";
        const range = body.range || "A1";

        const writeResponse = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/range(address='${range}')`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ values: body.data }),
          }
        );

        if (!writeResponse.ok) {
          const errorText = await writeResponse.text();
          console.error("Failed to write to sheet:", errorText);
          throw new Error("Failed to write to sheet");
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case "sync-bills": {
        if (!fileId) {
          throw new Error("fileId is required for syncing bills");
        }

        const worksheetName = sheetName || "Bills";
        
        // Read current sheet data
        const sheetResponse = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/usedRange`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          }
        );

        let existingRows: string[][] = [];
        if (sheetResponse.ok) {
          const sheetData = await sheetResponse.json();
          existingRows = sheetData.values || [];
        }

        // Get bills from database
        const { data: bills, error: billsError } = await supabase
          .from("bills")
          .select("*")
          .order("created_at", { ascending: false });

        if (billsError) {
          throw new Error("Failed to fetch bills");
        }

        // Create header row if sheet is empty
        const headers = [
          "ID", "Vendor Name", "Bill Number", "Bill Date", "Total Amount",
          "Payment Status", "Category", "GST Number", "Verified", "Created At"
        ];

        // Convert bills to rows
        const billRows = bills.map(bill => [
          bill.id,
          bill.vendor_name,
          bill.bill_number || "",
          bill.bill_date || "",
          bill.total_amount?.toString() || "0",
          bill.payment_status || "pending",
          bill.category_id || "",
          bill.vendor_gst || "",
          bill.is_verified ? "Yes" : "No",
          bill.created_at,
        ]);

        const allRows = [headers, ...billRows];

        // Write to Excel
        const rangeAddress = `A1:J${allRows.length}`;
        const writeResponse = await fetch(
          `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/workbook/worksheets('${worksheetName}')/range(address='${rangeAddress}')`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ values: allRows }),
          }
        );

        if (!writeResponse.ok) {
          const errorText = await writeResponse.text();
          console.error("Failed to sync bills:", errorText);
          throw new Error("Failed to sync bills to Excel");
        }

        // Update last sync time
        await supabase
          .from("excel_integrations")
          .update({ 
            last_sync_at: new Date().toISOString(),
            sync_status: "synced",
            error_message: null,
          })
          .eq("id", integrationId);

        return new Response(
          JSON.stringify({ success: true, rowsWritten: billRows.length }),
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
