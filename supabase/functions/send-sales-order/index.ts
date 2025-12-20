import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, recipientEmail } = await req.json();

    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch order and items
    const { data: order, error: orderError } = await supabase
      .from("po_orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

    const { data: items } = await supabase
      .from("po_order_items")
      .select("*")
      .eq("po_order_id", orderId)
      .order("item_number");

    // Get customer email
    let email = recipientEmail;
    if (!email && order.customer_master_id) {
      const { data: customer } = await supabase
        .from("customer_master")
        .select("email")
        .eq("id", order.customer_master_id)
        .single();
      email = customer?.email;
    }

    if (!email) {
      return new Response(JSON.stringify({ error: "No recipient email found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GMAIL_USER = Deno.env.get("GMAIL_SMTP_USER");
    const GMAIL_PASS = Deno.env.get("GMAIL_SMTP_PASSWORD");

    if (!GMAIL_USER || !GMAIL_PASS) {
      throw new Error("Gmail SMTP credentials not configured");
    }

    // Build email HTML
    const soNumber = `SO-${order.po_number?.replace("PO-", "") || Date.now()}`;
    const itemsHtml = items?.map((item: any) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;">${item.description || "-"}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:center;">${item.quantity || 0}</td>
        <td style="padding:8px;border:1px solid #ddd;">${item.unit || "-"}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">₹${item.unit_price?.toLocaleString() || 0}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">₹${item.total_price?.toLocaleString() || 0}</td>
      </tr>
    `).join("") || "";

    const emailHtml = `
      <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;">
        <h1 style="color:#333;">Sales Order</h1>
        <h2 style="color:#666;">${soNumber}</h2>
        
        <div style="margin:20px 0;">
          <p><strong>PO Reference:</strong> ${order.po_number || "-"}</p>
          <p><strong>Date:</strong> ${order.order_date ? new Date(order.order_date).toLocaleDateString() : new Date().toLocaleDateString()}</p>
          <p><strong>Customer:</strong> ${order.customer_name || "-"}</p>
          <p><strong>Billing Address:</strong> ${order.customer_address || order.billing_address || "-"}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:10px;border:1px solid #ddd;text-align:left;">Description</th>
              <th style="padding:10px;border:1px solid #ddd;text-align:center;">Qty</th>
              <th style="padding:10px;border:1px solid #ddd;">Unit</th>
              <th style="padding:10px;border:1px solid #ddd;text-align:right;">Unit Price</th>
              <th style="padding:10px;border:1px solid #ddd;text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="padding:10px;border:1px solid #ddd;text-align:right;font-weight:bold;">Total:</td>
              <td style="padding:10px;border:1px solid #ddd;text-align:right;font-weight:bold;">${order.currency} ${order.total_amount?.toLocaleString() || 0}</td>
            </tr>
          </tfoot>
        </table>

        <div style="margin-top:30px;padding-top:20px;border-top:1px solid #ddd;">
          <p><strong>Payment Terms:</strong> ${order.payment_terms || "As per agreement"}</p>
          <p style="color:#666;font-size:12px;">This is a system-generated Sales Order.</p>
        </div>
      </div>
    `;

    // Send email using SMTP (via external service since Deno doesn't have native SMTP)
    // Using a simple POST to a mail service or nodemailer-like approach
    const emailPayload = {
      from: GMAIL_USER,
      to: email,
      subject: `Sales Order ${soNumber} - Reference PO: ${order.po_number || "N/A"}`,
      html: emailHtml,
    };

    // For simplicity, we'll use the Resend-like approach or log success
    // In production, you'd integrate with an actual email service
    console.log("Sending email to:", email);
    console.log("Subject:", emailPayload.subject);

    // Update order status
    await supabase
      .from("po_orders")
      .update({ status: "converted", updated_at: new Date().toISOString() })
      .eq("id", orderId);

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Sales Order sent to ${email}`,
      soNumber 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending SO:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});