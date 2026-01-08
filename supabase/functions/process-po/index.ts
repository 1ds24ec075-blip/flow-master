import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Normalize PO number for comparison - strips all non-alphanumeric characters
function normalizePONumber(poNumber: string): string {
  return (poNumber || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

// Normalize vendor/customer name for comparison
function normalizeName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Generate fingerprint from order details
function generateFingerprint(customerName: string, items: any[]): string {
  const normalizedCustomer = normalizeName(customerName);
  const itemCount = items?.length || 0;
  const totalQty = items?.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0) || 0;
  return `${normalizedCustomer}|${itemCount}|${totalQty}`;
}

// Check if two amounts are within tolerance (default 1%)
function amountsMatch(amount1: number, amount2: number, tolerancePercent: number = 1): boolean {
  if (!amount1 || !amount2) return false;
  const diff = Math.abs(amount1 - amount2) / Math.max(amount1, amount2) * 100;
  return diff <= tolerancePercent;
}

// Check if two dates are within range (default 3 days)
function datesMatch(date1: string | null, date2: string | null, dayRange: number = 3): boolean {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffDays = Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= dayRange;
}

interface DuplicateMatch {
  matched_order_id: string;
  matched_po_number: string;
  match_type: "exact_po_number" | "normalized_po_number" | "vendor_amount_date" | "fingerprint" | "email_filename";
  confidence: "high" | "medium" | "low";
  match_details: string;
}

async function checkForDuplicates(
  supabase: any,
  extracted: any,
  emailFrom: string | null,
  emailSubject: string | null,
  filename: string | null
): Promise<DuplicateMatch | null> {
  
  // Fetch recent orders (last 90 days) for comparison
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const { data: recentOrders } = await supabase
    .from("po_orders")
    .select("id, po_number, vendor_name, customer_name, total_amount, order_date, email_from, email_subject, original_filename")
    .neq("status", "duplicate")
    .gte("created_at", ninetyDaysAgo.toISOString());
  
  if (!recentOrders || recentOrders.length === 0) return null;

  const extractedPONormalized = normalizePONumber(extracted.po_number);
  const extractedVendorNormalized = normalizeName(extracted.vendor_name);
  const extractedFingerprint = generateFingerprint(extracted.customer_name, extracted.items);

  for (const order of recentOrders) {
    // Layer 1: Exact PO number + same sender (HIGH confidence)
    if (extracted.po_number && order.po_number === extracted.po_number && emailFrom && order.email_from === emailFrom) {
      return {
        matched_order_id: order.id,
        matched_po_number: order.po_number,
        match_type: "exact_po_number",
        confidence: "high",
        match_details: `Exact PO number "${order.po_number}" from same sender "${emailFrom}"`
      };
    }

    // Layer 2: Normalized PO number match (HIGH confidence)
    if (extractedPONormalized && extractedPONormalized.length >= 3) {
      const orderPONormalized = normalizePONumber(order.po_number);
      if (orderPONormalized && orderPONormalized === extractedPONormalized) {
        return {
          matched_order_id: order.id,
          matched_po_number: order.po_number,
          match_type: "normalized_po_number",
          confidence: "high",
          match_details: `Normalized PO numbers match: "${extracted.po_number}" ≈ "${order.po_number}"`
        };
      }
    }

    // Layer 3: Vendor + Amount + Date match (MEDIUM confidence)
    const vendorNormalized = normalizeName(order.vendor_name);
    const vendorMatches = extractedVendorNormalized && vendorNormalized && 
      (extractedVendorNormalized.includes(vendorNormalized) || vendorNormalized.includes(extractedVendorNormalized));
    
    if (vendorMatches && 
        amountsMatch(extracted.total_amount, order.total_amount) && 
        datesMatch(extracted.order_date, order.order_date)) {
      return {
        matched_order_id: order.id,
        matched_po_number: order.po_number || "N/A",
        match_type: "vendor_amount_date",
        confidence: "medium",
        match_details: `Same vendor "${order.vendor_name}", amount ₹${order.total_amount}, and date within 3 days`
      };
    }

    // Layer 4: Email subject or filename match (MEDIUM confidence)
    if (emailSubject && order.email_subject && emailSubject === order.email_subject) {
      return {
        matched_order_id: order.id,
        matched_po_number: order.po_number || "N/A",
        match_type: "email_filename",
        confidence: "medium",
        match_details: `Same email subject: "${emailSubject}"`
      };
    }
    
    if (filename && order.original_filename && filename === order.original_filename) {
      return {
        matched_order_id: order.id,
        matched_po_number: order.po_number || "N/A",
        match_type: "email_filename",
        confidence: "medium",
        match_details: `Same filename: "${filename}"`
      };
    }

    // Layer 5: Fingerprint match (LOW confidence - within 30 days only)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const orderDate = new Date(order.order_date || order.created_at);
    
    if (orderDate >= thirtyDaysAgo) {
      const orderFingerprint = generateFingerprint(order.customer_name, []);
      // Simplified fingerprint check - just customer name and if amounts are very close
      if (extractedFingerprint.split("|")[0] === orderFingerprint.split("|")[0] &&
          amountsMatch(extracted.total_amount, order.total_amount, 0.5)) {
        return {
          matched_order_id: order.id,
          matched_po_number: order.po_number || "N/A",
          match_type: "fingerprint",
          confidence: "low",
          match_details: `Similar order: same customer "${order.customer_name}" with nearly identical amount`
        };
      }
    }
  }

  return null;
}

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

    // Enhanced multi-layer duplicate detection
    let status = "pending";
    let duplicateMatchDetails: DuplicateMatch | null = null;
    
    duplicateMatchDetails = await checkForDuplicates(supabase, extracted, emailFrom, emailSubject, filename);
    
    if (duplicateMatchDetails) {
      status = "duplicate";
      console.log(`Duplicate detected: ${duplicateMatchDetails.match_type} (${duplicateMatchDetails.confidence}) - ${duplicateMatchDetails.match_details}`);
    }

    // ========================================
    // MULTI-PARTY PRODUCT CODE RESOLUTION
    // ========================================
    const mismatches: any[] = [];
    const unmatchedItems: any[] = [];
    let productResolutionResults: any = null;
    
    if (extracted.items && status !== "duplicate") {
      // Load all reference data for resolution
      const [
        { data: allProducts },
        { data: customerMappings },
        { data: vendorMappings },
        { data: priceList },
      ] = await Promise.all([
        supabase.from("product_master").select("*").eq("is_active", true),
        supabase.from("customer_product_mapping").select("*").eq("is_active", true),
        supabase.from("vendor_product_mapping").select("*").eq("is_active", true),
        supabase.from("price_list").select("*"),
      ]);

      // Identify sender (customer or vendor)
      let senderType: 'customer' | 'vendor' | 'unknown' = 'unknown';
      let senderId: string | null = null;

      // Try to identify by email domain or customer name
      if (emailFrom) {
        const emailDomain = emailFrom.split("@")[1]?.toLowerCase();
        if (emailDomain) {
          const { data: customers } = await supabase
            .from("customer_master")
            .select("id, email")
            .not("email", "is", null);
          const matchedCustomer = customers?.find((c: any) => 
            c.email?.toLowerCase().includes(emailDomain)
          );
          if (matchedCustomer) {
            senderType = 'customer';
            senderId = matchedCustomer.id;
          }
        }
      }
      
      if (senderType === 'unknown' && extracted.customer_name) {
        const { data: customer } = await supabase
          .from("customer_master")
          .select("id")
          .ilike("customer_name", `%${extracted.customer_name}%`)
          .maybeSingle();
        if (customer) {
          senderType = 'customer';
          senderId = customer.id;
        }
      }

      // Resolve each line item
      const resolvedItems: any[] = [];
      for (const item of extracted.items) {
        const productCode = item.product_code || item.description || "";
        const normalizedCode = productCode.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        
        let resolution = {
          original_product_code: productCode,
          resolved_internal_product_id: null as string | null,
          resolution_method: 'unresolved',
          confidence_score: 0,
          status: 'unmapped',
          matched_product: null as any,
        };

        // Priority 1: Customer mapping (if sender is customer)
        if (senderType === 'customer' && senderId) {
          const customerMapping = customerMappings?.find((m: any) => 
            m.customer_id === senderId && 
            (m.customer_product_code || "").toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedCode &&
            m.is_active
          );
          if (customerMapping) {
            const product = allProducts?.find((p: any) => p.id === customerMapping.internal_product_id);
            if (product) {
              resolution = {
                original_product_code: productCode,
                resolved_internal_product_id: product.id,
                resolution_method: 'customer_mapping',
                confidence_score: 1.0,
                status: 'resolved',
                matched_product: product,
              };
            }
          }
        }

        // Priority 2: Internal product code match
        if (resolution.status !== 'resolved') {
          const internalMatch = allProducts?.find((p: any) => 
            (p.internal_code || "").toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedCode && p.is_active
          );
          if (internalMatch) {
            resolution = {
              original_product_code: productCode,
              resolved_internal_product_id: internalMatch.id,
              resolution_method: 'internal_code_match',
              confidence_score: 0.85,
              status: 'resolved',
              matched_product: internalMatch,
            };
          }
        }

        // Priority 3: Product name matching from product_master
        if (resolution.status !== 'resolved') {
          const itemDesc = (item.description || "").toLowerCase().trim();
          const itemDescNormalized = itemDesc.replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
          
          console.log(`[Resolution] Attempting name match for: "${itemDesc}" (normalized: "${itemDescNormalized}")`);
          console.log(`[Resolution] Products available: ${allProducts?.length || 0}`);
          
          // Exact name match
          let productMatch = allProducts?.find((p: any) => {
            if (!p.name || !p.is_active) return false;
            const productName = p.name.toLowerCase().trim();
            console.log(`[Resolution] Comparing exact: "${productName}" vs "${itemDesc}"`);
            return productName === itemDesc;
          });
          
          // Fuzzy name match - check if description contains product name or vice versa
          if (!productMatch) {
            productMatch = allProducts?.find((p: any) => {
              if (!p.name || !p.is_active) return false;
              const productName = p.name.toLowerCase().trim();
              const productNameNormalized = productName.replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
              const matches = (itemDesc.includes(productName) || productName.includes(itemDesc)) ||
                     (itemDescNormalized.includes(productNameNormalized) || productNameNormalized.includes(itemDescNormalized));
              if (matches) console.log(`[Resolution] Fuzzy matched: "${productName}"`);
              return matches;
            });
          }
          
          // Word-based matching (at least 2 significant words match)
          if (!productMatch) {
            const itemWords = itemDescNormalized.split(/\s+/).filter((w: string) => w.length > 2);
            console.log(`[Resolution] Word matching, item words: ${itemWords.join(", ")}`);
            productMatch = allProducts?.find((p: any) => {
              if (!p.name || !p.is_active) return false;
              const productWords = p.name.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w: string) => w.length > 2);
              const commonWords = itemWords.filter((w: string) => productWords.includes(w));
              console.log(`[Resolution] Product "${p.name}" words: ${productWords.join(", ")}, common: ${commonWords.join(", ")}`);
              return commonWords.length >= 2 || (commonWords.length >= 1 && itemWords.length <= 2);
            });
          }
          
          if (productMatch) {
            console.log(`[Resolution] MATCHED to product: ${productMatch.name} (price: ${productMatch.default_unit_price})`);
            resolution = {
              original_product_code: productCode,
              resolved_internal_product_id: productMatch.id,
              resolution_method: 'product_name_match',
              confidence_score: 0.80,
              status: 'resolved',
              matched_product: productMatch,
            };
          } else {
            console.log(`[Resolution] NO MATCH found for "${itemDesc}"`);
          }
        }

        // Priority 4: Price list matching (legacy fallback)
        if (resolution.status !== 'resolved') {
          const itemDesc = (item.description || "").toLowerCase().trim();
          let priceItem = priceList?.find((p: any) => 
            p.sku && itemDesc.includes(p.sku.toLowerCase())
          );
          if (!priceItem) {
            priceItem = priceList?.find((p: any) => {
              const productName = (p.product_name || "").toLowerCase().trim();
              const sku = (p.sku || "").toLowerCase().trim();
              return (productName && (itemDesc.includes(productName) || productName.includes(itemDesc))) ||
                     (sku && (itemDesc.includes(sku) || sku.includes(itemDesc)));
            });
          }
          if (priceItem) {
            resolution = {
              original_product_code: productCode,
              resolved_internal_product_id: null,
              resolution_method: 'price_list_match',
              confidence_score: 0.70,
              status: 'resolved',
              matched_product: priceItem,
            };
          }
        }

        // Check price if resolved
        if (resolution.matched_product && item.unit_price) {
          const expectedPrice = resolution.matched_product.default_unit_price || resolution.matched_product.unit_price;
          if (expectedPrice) {
            const diff = Math.abs(item.unit_price - expectedPrice) / expectedPrice * 100;
            if (diff > 2) {
              mismatches.push({
                description: item.description,
                matched_product: resolution.matched_product.name || resolution.matched_product.product_name || resolution.matched_product.sku,
                expected_price: expectedPrice,
                actual_price: item.unit_price,
                difference_percent: Math.round(diff * 100) / 100,
                resolution_method: resolution.resolution_method,
                confidence_score: resolution.confidence_score,
              });
            }
          }
        } else if (item.unit_price && resolution.status !== 'resolved') {
          // Item NOT matched anywhere
          unmatchedItems.push({
            description: item.description,
            product_code: productCode,
            unit_price: item.unit_price,
            reason: "Product code not found in mappings or price list",
            sender_type: senderType,
            sender_id: senderId,
          });
        }

        resolvedItems.push({
          ...item,
          ...resolution,
        });
      }

      productResolutionResults = {
        sender_type: senderType,
        sender_id: senderId,
        items: resolvedItems,
        unmapped_count: resolvedItems.filter((i: any) => i.status !== 'resolved').length,
      };
      
      // Set status based on issues found
      if (mismatches.length > 0 || unmatchedItems.length > 0) {
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
        price_mismatch_details: (mismatches.length > 0 || unmatchedItems.length > 0) ? { mismatches, unmatchedItems } : null,
        duplicate_match_details: duplicateMatchDetails,
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // Insert line items with resolution metadata
    if (extracted.items?.length > 0) {
      const resolvedItemsMap = productResolutionResults?.items || [];
      const items = extracted.items.map((item: any, index: number) => {
        const resolved = resolvedItemsMap[index] || {};
        return {
          po_order_id: order.id,
          item_number: index + 1,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          total_price: (item.quantity || 1) * (item.unit_price || 0),
          original_product_code: resolved.original_product_code || item.product_code || null,
          resolved_internal_product_id: resolved.resolved_internal_product_id || null,
          resolution_method: resolved.resolution_method || null,
          resolution_confidence: resolved.confidence_score || null,
          resolution_status: resolved.status === 'resolved' ? 'resolved' : 'pending',
        };
      });
      
      await supabase.from("po_order_items").insert(items);

      // Create unmapped_product_codes entries for unresolved items
      const senderType = productResolutionResults?.sender_type || 'unknown';
      const senderId = productResolutionResults?.sender_id || null;
      
      for (const resolved of resolvedItemsMap) {
        if (resolved.status !== 'resolved') {
          await supabase.from("unmapped_product_codes").insert({
            document_id: order.id,
            document_type: 'PO',
            sender_type: senderType,
            sender_id: senderId,
            original_product_code: resolved.original_product_code || resolved.description,
            original_description: resolved.description,
            original_unit_price: resolved.unit_price,
            original_quantity: resolved.quantity,
            status: 'pending',
          });
        }
      }
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