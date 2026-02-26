import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { reorder_request_id } = body;

    if (!reorder_request_id) {
      return new Response(JSON.stringify({ error: "Missing reorder_request_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: request, error: reqErr } = await supabase
      .from("reorder_requests")
      .select(`
        *,
        inventory_items (item_name, sku, unit),
        suppliers (name, email)
      `)
      .eq("id", reorder_request_id)
      .maybeSingle();

    if (reqErr || !request) {
      return new Response(JSON.stringify({ error: "Reorder request not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supplierName = request.suppliers?.name ?? "Supplier";
    const supplierEmail = request.suppliers?.email ?? null;
    const itemName = request.inventory_items?.item_name ?? "Unknown Item";
    const sku = request.inventory_items?.sku ?? "";
    const unit = request.inventory_items?.unit ?? "units";
    const quantity = request.quantity_requested;
    const deliveryDate = request.requested_delivery_date ?? "";
    const note = request.internal_note ?? "";
    const companyName = "Your Company";

    const subject = `Restock Request – ${itemName} – ${companyName}`;
    const emailBody = `Dear ${supplierName},

We hope this message finds you well.

We are writing to request a restock of the following item:

  Item Name    : ${itemName}
  SKU          : ${sku}
  Quantity     : ${quantity} ${unit}
  Delivery By  : ${deliveryDate}${note ? `\n  Note         : ${note}` : ""}

Please confirm receipt of this order at your earliest convenience.

Thank you,
${companyName} Procurement Team`;

    await supabase.from("supplier_communications").insert({
      reorder_request_id,
      supplier_id: request.supplier_id,
      communication_type: "email",
      subject,
      body: emailBody,
      recipient_email: supplierEmail ?? "",
      status: "sent",
    });

    return new Response(
      JSON.stringify({ success: true, subject, recipient: supplierEmail }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message ?? "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
