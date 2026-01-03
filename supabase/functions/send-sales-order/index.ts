import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Generate PDF using jsPDF
function generateSalesOrderPDF(order: any, items: any[], soNumber: string): string {
  const doc = new jsPDF();
  
  const companyName = "YOUR COMPANY NAME";
  const companyAddress = "123 Business Street, City, State 12345";
  const companyContact = "Phone: (555) 123-4567 | Email: sales@company.com";
  
  const orderDate = order.order_date 
    ? new Date(order.order_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) 
    : new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  const deliveryDate = order.delivery_date 
    ? new Date(order.delivery_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) 
    : "N/A";
  
  // Colors
  const primaryBlue = [44, 82, 130]; // #2c5282
  const darkGray = [51, 51, 51];
  const lightGray = [102, 102, 102];
  
  let y = 20;
  const leftMargin = 15;
  const pageWidth = 210;
  const rightMargin = pageWidth - 15;
  
  // Company Name (left side)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.text(companyName, leftMargin, y);
  
  // SALES ORDER (right side)
  doc.setFontSize(24);
  doc.text("SALES ORDER", rightMargin, y, { align: "right" });
  
  y += 8;
  
  // Company details
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.text(companyAddress, leftMargin, y);
  
  // SO Number
  doc.setFontSize(12);
  doc.text(soNumber, rightMargin, y, { align: "right" });
  
  y += 5;
  doc.setFontSize(10);
  doc.text(companyContact, leftMargin, y);
  
  y += 10;
  
  // Horizontal line
  doc.setDrawColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.setLineWidth(0.5);
  doc.line(leftMargin, y, rightMargin, y);
  
  y += 15;
  
  // Order Information
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text("Order Information", leftMargin, y);
  
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  
  const infoLabels = ["PO Number:", "Order Date:", "Delivery Date:"];
  const infoValues = [order.po_number || "-", orderDate, deliveryDate];
  
  infoLabels.forEach((label, idx) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(85, 85, 85);
    doc.text(label, leftMargin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    doc.text(infoValues[idx], leftMargin + 35, y);
    y += 6;
  });
  
  y += 5;
  
  // Bill To section
  doc.setFillColor(247, 250, 252);
  doc.rect(leftMargin, y - 3, rightMargin - leftMargin, 25, "F");
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text("Bill To:", leftMargin + 3, y + 3);
  
  y += 10;
  doc.setFontSize(11);
  doc.text(order.customer_name || "-", leftMargin + 3, y);
  
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  const address = order.customer_address || order.billing_address || order.shipping_address || "-";
  const addressLines = doc.splitTextToSize(address, rightMargin - leftMargin - 10);
  doc.text(addressLines, leftMargin + 3, y);
  
  y += (addressLines.length * 5) + 15;
  
  // Items table
  const tableTop = y;
  const tableWidth = rightMargin - leftMargin;
  const colWidths = [10, 55, 18, 18, 35, 40]; // Adjusted for better proportions
  const headers = ["#", "Description", "Qty", "Unit", "Unit Price", "Total"];
  
  // Table header
  doc.setFillColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.rect(leftMargin, tableTop, rightMargin - leftMargin, 10, "F");
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  
  let xPos = leftMargin + 2;
  headers.forEach((header, idx) => {
    if (idx === 0 || idx === 2 || idx === 3) {
      doc.text(header, xPos + colWidths[idx] / 2, tableTop + 7, { align: "center" });
    } else if (idx === 4 || idx === 5) {
      doc.text(header, xPos + colWidths[idx] - 2, tableTop + 7, { align: "right" });
    } else {
      doc.text(header, xPos + 2, tableTop + 7);
    }
    xPos += colWidths[idx];
  });
  
  y = tableTop + 10;
  
  // Table rows
  const subtotal = items.reduce((sum, item) => sum + (item.total_price || 0), 0);
  
  items.forEach((item, idx) => {
    const rowHeight = 8;
    
    // Alternating row colors
    if (idx % 2 === 0) {
      doc.setFillColor(247, 250, 252);
      doc.rect(leftMargin, y, rightMargin - leftMargin, rowHeight, "F");
    }
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    
    xPos = leftMargin + 2;
    const unitPrice = item.unit_price || 0;
    const totalPrice = item.total_price || 0;
    const rowData = [
      String(idx + 1),
      item.description || "-",
      String(item.quantity || 0),
      item.unit || "nos",
      `₹${unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `₹${totalPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    ];
    
    rowData.forEach((data, colIdx) => {
      if (colIdx === 0 || colIdx === 2 || colIdx === 3) {
        doc.text(data, xPos + colWidths[colIdx] / 2, y + 5.5, { align: "center" });
      } else if (colIdx === 4 || colIdx === 5) {
        doc.text(data, xPos + colWidths[colIdx] - 2, y + 5.5, { align: "right" });
      } else {
        // Truncate long descriptions
        const maxWidth = colWidths[colIdx] - 4;
        const truncated = doc.splitTextToSize(data, maxWidth)[0];
        doc.text(truncated, xPos + 2, y + 5.5);
      }
      xPos += colWidths[colIdx];
    });
    
    // Row bottom line
    doc.setDrawColor(224, 224, 224);
    doc.setLineWidth(0.1);
    doc.line(leftMargin, y + rowHeight, rightMargin, y + rowHeight);
    
    y += rowHeight;
  });
  
  y += 15;
  
  // Totals
  const total = order.total_amount || subtotal;
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.text("Subtotal:", rightMargin - 55, y);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text(`₹${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, rightMargin, y, { align: "right" });
  
  y += 10;
  
  // Total line
  doc.setDrawColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.setLineWidth(0.5);
  doc.line(rightMargin - 85, y - 3, rightMargin, y - 3);
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.text("TOTAL:", rightMargin - 55, y + 3);
  doc.text(`₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, rightMargin, y + 3, { align: "right" });
  
  y += 25;
  
  // Footer
  doc.setDrawColor(224, 224, 224);
  doc.setLineWidth(0.1);
  doc.line(leftMargin, y, rightMargin, y);
  
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.text("Payment Terms:", leftMargin, y);
  doc.setFont("helvetica", "normal");
  doc.text(order.payment_terms || "As per agreement", leftMargin + 30, y);
  
  y += 8;
  doc.setFontSize(8);
  doc.setTextColor(153, 153, 153);
  doc.text("This is a system-generated Sales Order.", leftMargin, y);
  
  // Return base64 encoded PDF
  return doc.output("datauristring").split(",")[1];
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
    
    // Generate PDF as base64
    console.log("Generating PDF for order:", orderId);
    const pdfBase64 = generateSalesOrderPDF(order, items || [], soNumber);
    console.log("PDF generated successfully, size:", pdfBase64.length);

    // Create email body
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
        attachments: [
          {
            filename: `${soNumber}.pdf`,
            content: pdfBase64,
            encoding: "base64",
            contentType: "application/pdf",
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
