import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { encode as base64Encode } from "https://deno.land/std@0.208.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generate PDF as base64 string using HTML to PDF approach
function generateSalesOrderPDF(order: any, items: any[], soNumber: string): string {
  // Create a simple text-based PDF structure
  // Using a basic PDF structure that can be parsed by most PDF readers
  
  const companyName = "YOUR COMPANY NAME";
  const companyAddress = "123 Business Street, City, State 12345";
  const companyContact = "Phone: (555) 123-4567 | Email: sales@company.com";
  
  const orderDate = order.order_date ? new Date(order.order_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  const deliveryDate = order.delivery_date ? new Date(order.delivery_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) : "N/A";
  
  // Calculate totals
  const subtotal = items.reduce((sum, item) => sum + (item.total_price || 0), 0);
  const total = order.total_amount || subtotal;
  
  // Build items table rows
  const itemRows = items.map((item, idx) => {
    const desc = item.description || "-";
    const qty = item.quantity || 0;
    const unit = item.unit || "nos";
    const price = item.unit_price || 0;
    const itemTotal = item.total_price || 0;
    return `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; text-align: center; color: #fff; background-color: #2c5282;">${idx + 1}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; background-color: ${idx % 2 === 0 ? '#f7fafc' : '#fff'};">${desc}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; text-align: center; background-color: ${idx % 2 === 0 ? '#f7fafc' : '#fff'};">${qty}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; text-align: center; background-color: ${idx % 2 === 0 ? '#f7fafc' : '#fff'};">${unit}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; text-align: right; background-color: ${idx % 2 === 0 ? '#f7fafc' : '#fff'};">Rs.${price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
        <td style="padding: 10px; border-bottom: 1px solid #e0e0e0; text-align: right; background-color: ${idx % 2 === 0 ? '#f7fafc' : '#fff'};">Rs.${itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
      </tr>
    `;
  }).join('');

  // Create HTML that will be the PDF content
  const pdfHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 40px; color: #333; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2c5282; padding-bottom: 20px; margin-bottom: 30px; }
    .company-info { flex: 1; }
    .company-name { font-size: 24px; font-weight: bold; color: #2c5282; margin-bottom: 5px; }
    .company-details { font-size: 12px; color: #666; }
    .so-info { text-align: right; }
    .so-title { font-size: 28px; font-weight: bold; color: #2c5282; margin-bottom: 5px; text-align: left; }
    .so-number { font-size: 16px; color: #666; }
    .section { margin-bottom: 25px; }
    .section-title { font-size: 14px; font-weight: bold; color: #333; margin-bottom: 10px; }
    .info-grid { display: grid; grid-template-columns: 120px 1fr; gap: 5px; font-size: 13px; }
    .info-label { font-weight: 600; color: #555; }
    .bill-to { background-color: #f7fafc; padding: 15px; border-radius: 5px; }
    .items-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    .items-table th { background-color: #2c5282; color: white; padding: 12px 10px; text-align: left; font-size: 12px; font-weight: 600; }
    .items-table th:first-child { width: 40px; text-align: center; }
    .items-table th:nth-child(3), .items-table th:nth-child(4) { text-align: center; }
    .items-table th:nth-child(5), .items-table th:nth-child(6) { text-align: right; }
    .totals { margin-top: 20px; text-align: right; }
    .total-row { display: flex; justify-content: flex-end; gap: 40px; padding: 8px 0; font-size: 14px; }
    .total-label { color: #666; min-width: 100px; }
    .total-value { min-width: 120px; text-align: right; }
    .grand-total { font-weight: bold; color: #2c5282; font-size: 16px; border-top: 2px solid #2c5282; padding-top: 10px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="company-info">
      <div class="company-name">${companyName}</div>
      <div class="company-details">${companyAddress}</div>
      <div class="company-details">${companyContact}</div>
    </div>
    <div class="so-info">
      <div class="so-title">SALES ORDER</div>
      <div class="so-number">${soNumber}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Order Information</div>
    <div class="info-grid">
      <span class="info-label">PO Number:</span>
      <span>${order.po_number || "-"}</span>
      <span class="info-label">Order Date:</span>
      <span>${orderDate}</span>
      <span class="info-label">Delivery Date:</span>
      <span>${deliveryDate}</span>
    </div>
  </div>

  <div class="section bill-to">
    <div class="section-title">Bill To:</div>
    <div style="font-size: 14px; font-weight: 600;">${order.customer_name || "-"}</div>
    <div style="font-size: 13px; color: #555; margin-top: 5px;">${order.customer_address || order.billing_address || order.shipping_address || "-"}</div>
    ${order.gst_number ? `<div style="font-size: 12px; color: #666; margin-top: 5px;">GST: ${order.gst_number}</div>` : ''}
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th>#</th>
        <th>Description</th>
        <th>Qty</th>
        <th>Unit</th>
        <th>Price</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="totals">
    <div class="total-row">
      <span class="total-label">Subtotal:</span>
      <span class="total-value">Rs.${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
    </div>
    <div class="total-row grand-total">
      <span class="total-label">TOTAL:</span>
      <span class="total-value">Rs.${total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
    </div>
  </div>

  <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
    <p style="font-size: 12px; color: #666;"><strong>Payment Terms:</strong> ${order.payment_terms || "As per agreement"}</p>
    <p style="font-size: 11px; color: #999; margin-top: 10px;">This is a system-generated Sales Order.</p>
  </div>
</body>
</html>
  `;

  return pdfHtml;
}

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
      console.error("Order fetch error:", orderError);
      throw new Error("Order not found");
    }

    const { data: items } = await supabase
      .from("po_order_items")
      .select("*")
      .eq("po_order_id", orderId)
      .order("item_number");

    // Get customer email - priority: passed param > customer_master > email_from field
    let email = recipientEmail;
    
    // Try customer_master if no email passed
    if (!email && order.customer_master_id) {
      const { data: customer } = await supabase
        .from("customer_master")
        .select("email")
        .eq("id", order.customer_master_id)
        .single();
      email = customer?.email;
    }

    // Try to extract email from email_from field (format: "Name <email@example.com>")
    if (!email && order.email_from) {
      const emailMatch = order.email_from.match(/<([^>]+)>/);
      if (emailMatch && emailMatch[1]) {
        email = emailMatch[1];
      } else if (order.email_from.includes("@")) {
        // If no angle brackets, the whole field might be just an email
        email = order.email_from.trim();
      }
    }

    if (!email) {
      return new Response(JSON.stringify({ error: "No recipient email found. Order has no linked customer or email source." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log("Resolved recipient email:", email);

    const GMAIL_USER = Deno.env.get("GMAIL_SMTP_USER");
    const GMAIL_PASS = Deno.env.get("GMAIL_SMTP_PASSWORD");

    if (!GMAIL_USER || !GMAIL_PASS) {
      throw new Error("Gmail SMTP credentials not configured");
    }

    // Generate SO number
    const soNumber = `SO-${order.po_number?.replace(/^PO-?/i, "") || Date.now()}`;
    
    // Generate PDF HTML content
    const pdfHtml = generateSalesOrderPDF(order, items || [], soNumber);
    
    // Encode HTML as base64 for attachment
    const htmlBytes = new TextEncoder().encode(pdfHtml);
    const htmlBase64 = base64Encode(htmlBytes);

    // Create a simple email body
    const emailBody = `
Dear Customer,

Please find attached the Sales Order ${soNumber} for your Purchase Order ${order.po_number || "N/A"}.

Order Summary:
- PO Reference: ${order.po_number || "-"}
- Order Date: ${order.order_date ? new Date(order.order_date).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN')}
- Total Amount: Rs. ${order.total_amount?.toLocaleString('en-IN') || 0}

Thank you for your business!

Best regards,
Your Company Name
    `;

    const subject = `Sales Order ${soNumber} - Reference PO: ${order.po_number || "N/A"}`;

    console.log("Sending email to:", email);
    console.log("Subject:", subject);

    // Send email using Gmail SMTP
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: {
          username: GMAIL_USER,
          password: GMAIL_PASS,
        },
      },
    });

    try {
      await client.send({
        from: GMAIL_USER,
        to: email,
        subject: subject,
        content: emailBody,
        html: pdfHtml,
        attachments: [
          {
            filename: `${soNumber}.html`,
            content: htmlBase64,
            encoding: "base64",
            contentType: "text/html",
          },
        ],
      });
      
      console.log("Email sent successfully to:", email);
      await client.close();
    } catch (emailError: unknown) {
      console.error("SMTP Error:", emailError);
      await client.close();
      const errMsg = emailError instanceof Error ? emailError.message : "Unknown SMTP error";
      throw new Error(`Failed to send email: ${errMsg}`);
    }

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
  } catch (error: unknown) {
    console.error("Error sending SO:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
