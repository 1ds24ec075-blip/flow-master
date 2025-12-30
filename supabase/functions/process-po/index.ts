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
    const { pdfBase64, filename, emailSubject, emailFrom, emailDate, extractOnly } = await req.json();

    if (!pdfBase64) {
      return new Response(JSON.stringify({ error: "pdfBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    // Extract PO data using AI
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "system",
            content: `You are a PO extraction expert. Extract data from Purchase Order PDFs into structured JSON. Handle Indian formats (₹, GST, dates like DD-MM-YYYY). 

IMPORTANT: 
- subtotal = sum of line items BEFORE tax
- tax_amount = the actual tax value (e.g., 19.00)
- tax_rate = the tax percentage if shown (e.g., 10 for 10%)
- total_amount = the FINAL TOTAL including tax (subtotal + tax_amount)

Return ONLY valid JSON with this structure:
{
  "po_number": "string",
  "vendor_name": "string",
  "vendor_address": "string", 
  "customer_name": "string",
  "customer_address": "string",
  "customer_email": "string or null",
  "order_date": "YYYY-MM-DD or null",
  "delivery_date": "YYYY-MM-DD or null",
  "payment_terms": "string or null",
  "subtotal": number,
  "tax_rate": number or null,
  "tax_amount": number or null,
  "total_amount": number,
  "currency": "INR or USD or EUR",
  "items": [{"description": "string", "quantity": number, "unit": "string", "unit_price": number}]
}`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Extract all PO data from this document:" },
              { type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfBase64}` } }
            ]
          }
        ],
      }),
    });

    const aiData = await aiResponse.json();
    let extractedText = aiData.choices?.[0]?.message?.content || "{}";
    
    // Clean up response
    extractedText = extractedText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    
    let extracted;
    try {
      extracted = JSON.parse(extractedText);
    } catch {
      extracted = {};
    }

    // If extractOnly, return the extracted data
    if (extractOnly) {
      return new Response(JSON.stringify({ extracted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save to database
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check for duplicates
    let status = "pending";
    if (extracted.po_number && emailFrom) {
      const { data: existing } = await supabase
        .from("po_orders")
        .select("id")
        .eq("po_number", extracted.po_number)
        .eq("email_from", emailFrom)
        .neq("status", "duplicate")
        .maybeSingle();
      
      if (existing) {
        status = "duplicate";
      }
    }

    // Check prices against price_list (2% tolerance)
    const mismatches: any[] = [];
    if (extracted.items && status !== "duplicate") {
      const { data: priceList } = await supabase.from("price_list").select("*");
      
      for (const item of extracted.items) {
        const priceItem = priceList?.find(p => 
          item.description?.toLowerCase().includes(p.product_name?.toLowerCase() || p.sku.toLowerCase())
        );
        
        if (priceItem && item.unit_price) {
          const diff = Math.abs(item.unit_price - priceItem.unit_price) / priceItem.unit_price * 100;
          if (diff > 2) {
            mismatches.push({
              description: item.description,
              expected_price: priceItem.unit_price,
              actual_price: item.unit_price,
              difference_percent: diff,
            });
          }
        }
      }
      
      if (mismatches.length > 0) {
        status = "price_mismatch";
      }
    }

    // Match customer
    let customerMasterId = null;
    if (extracted.customer_name) {
      const { data: customer } = await supabase
        .from("customer_master")
        .select("id, email")
        .ilike("customer_name", `%${extracted.customer_name}%`)
        .maybeSingle();
      
      if (customer) {
        customerMasterId = customer.id;
      }
    }

    // Insert order
    const { data: order, error: orderError } = await supabase
      .from("po_orders")
      .insert({
        po_number: extracted.po_number,
        vendor_name: extracted.vendor_name,
        vendor_address: extracted.vendor_address,
        customer_name: extracted.customer_name,
        customer_address: extracted.customer_address,
        order_date: extracted.order_date,
        delivery_date: extracted.delivery_date,
        payment_terms: extracted.payment_terms,
        total_amount: extracted.total_amount,
        currency: extracted.currency || "INR",
        status,
        original_filename: filename,
        email_subject: emailSubject,
        email_from: emailFrom,
        email_date: emailDate,
        customer_master_id: customerMasterId,
        price_mismatch_details: mismatches.length > 0 ? { mismatches } : null,
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // Insert line items
    if (extracted.items?.length > 0) {
      const items = extracted.items.map((item: any, index: number) => ({
        po_order_id: order.id,
        item_number: index + 1,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        total_price: (item.quantity || 1) * (item.unit_price || 0),
      }));
      
      await supabase.from("po_order_items").insert(items);
    }

    // Auto-send email if no issues
    if (status === "pending" && customerMasterId) {
      try {
        await supabase.functions.invoke("send-sales-order", {
          body: { orderId: order.id },
        });
        await supabase.from("po_orders").update({ status: "converted" }).eq("id", order.id);
      } catch (e) {
        console.error("Failed to send SO email:", e);
      }
    }

    return new Response(JSON.stringify({ success: true, order }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Error processing PO:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});