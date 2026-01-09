import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to round up to nearest multiple
function roundUpToMultiple(value: number, multiple: number): number {
  if (multiple <= 0) return value;
  return Math.ceil(value / multiple) * multiple;
}

// Generate PDF using jsPDF with enhanced details
function generateSalesOrderPDF(order: any, items: any[], soNumber: string, customer: any): string {
  const doc = new jsPDF();
  
  const companyName = "YOUR COMPANY NAME";
  const companyAddress = "123 Business Street, City, State 12345";
  const companyContact = "Phone: (555) 123-4567 | Email: sales@company.com";
  const companyGSTIN = "GSTIN: 29XXXXX1234X1Z5"; // Your company GSTIN
  
  const orderDate = order.order_date 
    ? new Date(order.order_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) 
    : new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
  const deliveryDate = order.delivery_date 
    ? new Date(order.delivery_date).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' }) 
    : "N/A";
  
  // Colors
  const primaryBlue = [44, 82, 130];
  const darkGray = [51, 51, 51];
  const lightGray = [102, 102, 102];
  
  let y = 20;
  const leftMargin = 15;
  const pageWidth = 210;
  const rightMargin = pageWidth - 15;
  const midPoint = pageWidth / 2;
  
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
  
  y += 5;
  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  doc.text(companyGSTIN, leftMargin, y);
  
  y += 8;
  
  // Horizontal line
  doc.setDrawColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.setLineWidth(0.5);
  doc.line(leftMargin, y, rightMargin, y);
  
  y += 12;
  
  // Order Information
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text("Order Information", leftMargin, y);
  
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  
  const infoLabels = ["PO Number:", "Order Date:", "Delivery Date:", "Payment Terms:"];
  const infoValues = [
    order.po_number || "-", 
    orderDate, 
    deliveryDate,
    order.payment_terms || customer?.payment_terms || "As per agreement"
  ];
  
  infoLabels.forEach((label, idx) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(85, 85, 85);
    doc.text(label, leftMargin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    doc.text(infoValues[idx], leftMargin + 38, y);
    y += 6;
  });
  
  y += 8;
  
  // Bill To and Ship To sections side by side
  const billingAddress = order.billing_address || order.customer_address || customer?.billing_address || "-";
  const shippingAddress = order.shipping_address || customer?.shipping_address || billingAddress;
  const showShipTo = shippingAddress !== billingAddress;
  
  const sectionWidth = showShipTo ? (rightMargin - leftMargin - 10) / 2 : rightMargin - leftMargin;
  
  // Bill To section
  doc.setFillColor(247, 250, 252);
  doc.rect(leftMargin, y - 3, sectionWidth, showShipTo ? 45 : 40, "F");
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.text("Bill To:", leftMargin + 3, y + 3);
  
  let billY = y + 10;
  doc.setFontSize(11);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text(order.customer_name || customer?.customer_name || "-", leftMargin + 3, billY);
  
  billY += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  const addressLines = doc.splitTextToSize(billingAddress, sectionWidth - 10);
  doc.text(addressLines.slice(0, 3), leftMargin + 3, billY);
  
  billY += Math.min(addressLines.length, 3) * 4 + 4;
  
  // Customer GSTIN
  const customerGSTIN = order.gst_number || customer?.gst_number;
  if (customerGSTIN) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("GSTIN: ", leftMargin + 3, billY);
    doc.setFont("helvetica", "normal");
    doc.text(customerGSTIN, leftMargin + 18, billY);
    billY += 4;
  }
  
  // Customer Contact
  const customerPhone = customer?.phone;
  if (customerPhone) {
    doc.setFont("helvetica", "bold");
    doc.text("Phone: ", leftMargin + 3, billY);
    doc.setFont("helvetica", "normal");
    doc.text(customerPhone, leftMargin + 18, billY);
    billY += 4;
  }
  
  // Customer Email
  const customerEmail = customer?.email;
  if (customerEmail) {
    doc.setFont("helvetica", "bold");
    doc.text("Email: ", leftMargin + 3, billY);
    doc.setFont("helvetica", "normal");
    doc.text(customerEmail, leftMargin + 18, billY);
  }
  
  // Ship To section (if different)
  if (showShipTo) {
    const shipX = leftMargin + sectionWidth + 10;
    doc.setFillColor(247, 250, 252);
    doc.rect(shipX, y - 3, sectionWidth, 45, "F");
    
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
    doc.text("Ship To:", shipX + 3, y + 3);
    
    let shipY = y + 10;
    doc.setFontSize(11);
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    doc.text(order.customer_name || customer?.customer_name || "-", shipX + 3, shipY);
    
    shipY += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(85, 85, 85);
    const shipAddressLines = doc.splitTextToSize(shippingAddress, sectionWidth - 10);
    doc.text(shipAddressLines.slice(0, 5), shipX + 3, shipY);
  }
  
  y += showShipTo ? 50 : 45;
  
  // Items table - added PO Qty column for when multiples apply
  const tableTop = y;
  const colWidths = [10, 45, 15, 15, 25, 20, 22]; // #, Desc, PO Qty, SO Qty, Unit Price, GST %, Total
  const headers = ["#", "Description", "PO Qty", "SO Qty", "Unit Price", "GST %", "Total"];
  
  // Table header
  doc.setFillColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.rect(leftMargin, tableTop, rightMargin - leftMargin, 10, "F");
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  
  let xPos = leftMargin;
  headers.forEach((header, idx) => {
    const colCenter = xPos + colWidths[idx] / 2;
    if (idx === 4 || idx === 5 || idx === 6) {
      doc.text(header, xPos + colWidths[idx] - 3, tableTop + 7, { align: "right" });
    } else if (idx === 0 || idx === 2 || idx === 3) {
      doc.text(header, colCenter, tableTop + 7, { align: "center" });
    } else {
      doc.text(header, xPos + 3, tableTop + 7);
    }
    xPos += colWidths[idx];
  });
  
  y = tableTop + 10;
  
  // Calculate totals with quantity multiple rule applied
  let subtotal = 0;
  let totalGST = 0;
  const defaultGSTRate = 18; // Default GST rate

  // Pre-process items to apply quantity multiple rule
  const processedItems = items.map((item) => {
    const poQty = item.quantity || 0;
    let soQty = poQty;
    let multipleNote = "";
    
    // Check if product has sell_in_multiples enabled
    const productMaster = item.product_master;
    if (productMaster?.sell_in_multiples && productMaster?.multiple_quantity > 0) {
      soQty = roundUpToMultiple(poQty, productMaster.multiple_quantity);
      if (soQty !== poQty) {
        multipleNote = `×${productMaster.multiple_quantity}`;
      }
    }
    
    const unitPrice = item.unit_price || 0;
    const totalPrice = soQty * unitPrice; // Use SO quantity for pricing
    const gstRate = productMaster?.gst_rate || item.gst_rate || defaultGSTRate;
    
    subtotal += totalPrice;
    totalGST += totalPrice * (gstRate / 100);
    
    return {
      ...item,
      po_qty: poQty,
      so_qty: soQty,
      total_price: totalPrice,
      gst_rate: gstRate,
      multiple_note: multipleNote,
    };
  });
  
  // Table rows
  processedItems.forEach((item, idx) => {
    const rowHeight = item.multiple_note ? 12 : 8; // Taller row if showing multiple note
    
    if (idx % 2 === 0) {
      doc.setFillColor(247, 250, 252);
      doc.rect(leftMargin, y, rightMargin - leftMargin, rowHeight, "F");
    }
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    
    xPos = leftMargin;
    
    // Build row data
    const poQtyStr = String(item.po_qty);
    const soQtyStr = item.po_qty !== item.so_qty ? String(item.so_qty) : String(item.po_qty);
    const unitPrice = item.unit_price || 0;
    const totalPrice = item.total_price;
    const gstRate = item.gst_rate;
    
    const rowData = [
      String(idx + 1),
      item.description || "-",
      poQtyStr,
      soQtyStr,
      `Rs.${unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      `${gstRate}%`,
      `Rs.${totalPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    ];
    
    rowData.forEach((data, colIdx) => {
      const colCenter = xPos + colWidths[colIdx] / 2;
      if (colIdx === 4 || colIdx === 5 || colIdx === 6) {
        doc.text(data, xPos + colWidths[colIdx] - 3, y + 5.5, { align: "right" });
      } else if (colIdx === 0 || colIdx === 2 || colIdx === 3) {
        doc.text(data, colCenter, y + 5.5, { align: "center" });
      } else {
        const maxWidth = colWidths[colIdx] - 4;
        const truncated = doc.splitTextToSize(data, maxWidth)[0];
        doc.text(truncated, xPos + 3, y + 5.5);
      }
      xPos += colWidths[colIdx];
    });
    
    // Add multiple note badge if applicable
    if (item.multiple_note) {
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(`↑ Rounded up due to product multiple rule (${item.multiple_note})`, leftMargin + colWidths[0] + 3, y + 10);
    }
    
    doc.setDrawColor(224, 224, 224);
    doc.setLineWidth(0.1);
    doc.line(leftMargin, y + rowHeight, rightMargin, y + rowHeight);
    
    y += rowHeight;
  });
  
  y += 12;
  
  // Totals section - right aligned with tax breakdown
  const totalsX = rightMargin - 80;
  const valuesX = rightMargin - 3;
  
  // Subtotal
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.text("Subtotal:", totalsX, y);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text(`Rs.${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valuesX, y, { align: "right" });
  
  y += 7;
  
  // GST Breakdown (CGST + SGST or IGST)
  const cgst = totalGST / 2;
  const sgst = totalGST / 2;
  
  doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.text("CGST:", totalsX, y);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text(`Rs.${cgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valuesX, y, { align: "right" });
  
  y += 6;
  
  doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.text("SGST:", totalsX, y);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text(`Rs.${sgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valuesX, y, { align: "right" });
  
  y += 6;
  
  // Total Tax
  doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
  doc.text("Total Tax:", totalsX, y);
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.text(`Rs.${totalGST.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valuesX, y, { align: "right" });
  
  y += 7;
  
  // Discount (if any)
  const discount = order.discount || 0;
  if (discount > 0) {
    doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
    doc.text("Discount:", totalsX, y);
    doc.setTextColor(34, 139, 34); // Green for discount
    doc.text(`-Rs.${discount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valuesX, y, { align: "right" });
    y += 6;
  }
  
  // Round Off (if any)
  const grandTotal = subtotal + totalGST - discount;
  const roundedTotal = Math.round(grandTotal);
  const roundOff = roundedTotal - grandTotal;
  
  if (Math.abs(roundOff) >= 0.01) {
    doc.setTextColor(lightGray[0], lightGray[1], lightGray[2]);
    doc.text("Round Off:", totalsX, y);
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    const roundOffSign = roundOff >= 0 ? "+" : "-";
    doc.text(`${roundOffSign}Rs.${Math.abs(roundOff).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valuesX, y, { align: "right" });
    y += 6;
  }
  
  y += 4;
  
  // Total line
  doc.setDrawColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.setLineWidth(0.5);
  doc.line(totalsX - 5, y - 2, rightMargin, y - 2);
  
  const finalTotal = order.total_amount || roundedTotal;
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
  doc.text("GRAND TOTAL:", totalsX, y + 5);
  doc.text(`Rs.${finalTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, valuesX, y + 5, { align: "right" });
  
  y += 20;
  
  // Footer
  doc.setDrawColor(224, 224, 224);
  doc.setLineWidth(0.1);
  doc.line(leftMargin, y, rightMargin, y);
  
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(153, 153, 153);
  doc.text("This is a system-generated Sales Order. For queries, please contact us.", leftMargin, y);
  
  y += 5;
  doc.text("Terms & Conditions apply.", leftMargin, y);
  
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
      .select("*, product_master:resolved_internal_product_id(id, name, sell_in_multiples, multiple_quantity, gst_rate)")
      .eq("po_order_id", orderId)
      .order("item_number");

    // Fetch customer details from customer_master - first try by ID, then by name match
    let customer = null;
    if (order.customer_master_id) {
      const { data: customerData } = await supabase
        .from("customer_master")
        .select("*")
        .eq("id", order.customer_master_id)
        .single();
      customer = customerData;
    }
    
    // If no customer found by ID, try matching by customer name
    if (!customer && order.customer_name) {
      const normalizedName = order.customer_name.toLowerCase().trim();
      const { data: customers } = await supabase
        .from("customer_master")
        .select("*")
        .eq("is_active", true);
      
      if (customers && customers.length > 0) {
        // Try exact match first
        customer = customers.find(c => 
          c.customer_name.toLowerCase().trim() === normalizedName
        );
        
        // If no exact match, try partial match
        if (!customer) {
          customer = customers.find(c => 
            c.customer_name.toLowerCase().includes(normalizedName) ||
            normalizedName.includes(c.customer_name.toLowerCase())
          );
        }
      }
      
      if (customer) {
        console.log("Found customer by name match:", customer.customer_name);
      }
    }
    
    // Merge customer_master data into order for any missing fields
    if (customer) {
      console.log("Filling missing order details from customer_master:", customer.id);
      
      // Fill missing fields from customer_master
      if (!order.gst_number && customer.gst_number) {
        order.gst_number = customer.gst_number;
      }
      if (!order.billing_address && customer.billing_address) {
        order.billing_address = customer.billing_address;
      }
      if (!order.shipping_address && customer.shipping_address) {
        order.shipping_address = customer.shipping_address;
      }
      if (!order.payment_terms && customer.payment_terms) {
        order.payment_terms = customer.payment_terms;
      }
      if (!order.tally_ledger_name && customer.tally_ledger_name) {
        order.tally_ledger_name = customer.tally_ledger_name;
      }
      if (!order.customer_address && customer.billing_address) {
        order.customer_address = customer.billing_address;
      }
    }

    // Get customer email - priority: passed param > customer_master > email_from field
    let email = recipientEmail;
    
    if (!email && customer?.email) {
      email = customer.email;
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
    
    // Generate PDF as base64 with customer details
    console.log("Generating PDF for order:", orderId);
    const pdfBase64 = generateSalesOrderPDF(order, items || [], soNumber, customer);
    console.log("PDF generated successfully, size:", pdfBase64.length);

    // Create email body with enhanced details
    const emailBody = `
Dear ${order.customer_name || customer?.customer_name || "Customer"},

Please find attached the Sales Order ${soNumber} for your Purchase Order ${order.po_number || "N/A"}.

Order Summary:
- PO Reference: ${order.po_number || "-"}
- Order Date: ${order.order_date ? new Date(order.order_date).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN')}
- Total Amount: Rs. ${order.total_amount?.toLocaleString('en-IN') || 0}
${order.gst_number || customer?.gst_number ? `- GSTIN: ${order.gst_number || customer?.gst_number}` : ""}

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
