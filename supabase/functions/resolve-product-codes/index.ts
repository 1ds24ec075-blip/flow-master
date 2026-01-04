import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// =============================================
// MULTI-PARTY PRODUCT CODE RESOLUTION ENGINE
// =============================================

// Confidence scoring constants
const CONFIDENCE = {
  EXACT_SENDER_MAPPING: 1.00,
  INTERNAL_CODE_MATCH: 0.85,
  CROSS_PARTY_MAPPING: 0.60,
  AI_SUGGESTION: 0.40,
};

// Thresholds
const THRESHOLD = {
  AUTO_ACCEPT: 0.85,
  REQUIRE_APPROVAL: 0.60,
  BLOCK: 0.60,
};

interface DocumentContext {
  document_type: 'PO' | 'SO' | 'INVOICE';
  sender_type: 'customer' | 'vendor' | 'unknown';
  sender_id: string | null;
  receiver_party: 'our_company';
}

interface LineItemResolution {
  original_product_code: string;
  original_description: string;
  resolved_internal_product_id: string | null;
  resolved_product_name: string | null;
  resolution_method: string;
  confidence_score: number;
  status: 'resolved' | 'pending' | 'unmapped' | 'blocked';
  suggestion?: {
    product_id: string;
    product_name: string;
    confidence: number;
    reason: string;
  };
}

interface ResolutionResult {
  document_context: DocumentContext;
  items: LineItemResolution[];
  has_unmapped: boolean;
  unmapped_count: number;
  requires_approval: boolean;
  blocked_count: number;
}

// Normalize product code for matching
function normalizeCode(code: string): string {
  return (code || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

// Identify sender based on GSTIN, email domain, or master records
async function identifySender(
  supabase: any,
  document: {
    gstin?: string;
    email?: string;
    sender_name?: string;
    document_type: string;
  }
): Promise<{ sender_type: 'customer' | 'vendor' | 'unknown'; sender_id: string | null }> {
  
  // Strategy 1: Match by GSTIN (most reliable)
  if (document.gstin) {
    // Check customer_master first
    const { data: customer } = await supabase
      .from("customer_master")
      .select("id")
      .eq("gst_number", document.gstin)
      .maybeSingle();
    
    if (customer) {
      console.log(`Sender identified as customer via GSTIN: ${document.gstin}`);
      return { sender_type: 'customer', sender_id: customer.id };
    }

    // Check suppliers
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("id")
      .eq("gst_number", document.gstin)
      .maybeSingle();
    
    if (supplier) {
      console.log(`Sender identified as vendor via GSTIN: ${document.gstin}`);
      return { sender_type: 'vendor', sender_id: supplier.id };
    }
  }

  // Strategy 2: Match by email domain
  if (document.email) {
    const emailDomain = document.email.split("@")[1]?.toLowerCase();
    if (emailDomain) {
      // Check customer_master
      const { data: customers } = await supabase
        .from("customer_master")
        .select("id, email")
        .not("email", "is", null);
      
      const matchedCustomer = customers?.find((c: any) => 
        c.email?.toLowerCase().includes(emailDomain)
      );
      
      if (matchedCustomer) {
        console.log(`Sender identified as customer via email domain: ${emailDomain}`);
        return { sender_type: 'customer', sender_id: matchedCustomer.id };
      }

      // Check suppliers
      const { data: suppliers } = await supabase
        .from("suppliers")
        .select("id, email")
        .not("email", "is", null);
      
      const matchedSupplier = suppliers?.find((s: any) => 
        s.email?.toLowerCase().includes(emailDomain)
      );
      
      if (matchedSupplier) {
        console.log(`Sender identified as vendor via email domain: ${emailDomain}`);
        return { sender_type: 'vendor', sender_id: matchedSupplier.id };
      }
    }
  }

  // Strategy 3: Fuzzy name matching
  if (document.sender_name) {
    const normalizedName = document.sender_name.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    
    // Check customer_master
    const { data: customer } = await supabase
      .from("customer_master")
      .select("id, customer_name")
      .ilike("customer_name", `%${normalizedName.split(" ")[0]}%`)
      .maybeSingle();
    
    if (customer) {
      console.log(`Sender identified as customer via name: ${document.sender_name}`);
      return { sender_type: 'customer', sender_id: customer.id };
    }

    // Check suppliers
    const { data: supplier } = await supabase
      .from("suppliers")
      .select("id, name")
      .ilike("name", `%${normalizedName.split(" ")[0]}%`)
      .maybeSingle();
    
    if (supplier) {
      console.log(`Sender identified as vendor via name: ${document.sender_name}`);
      return { sender_type: 'vendor', sender_id: supplier.id };
    }
  }

  console.log(`Sender could not be identified, marking as unknown`);
  return { sender_type: 'unknown', sender_id: null };
}

// Core resolution engine - resolves a single product code
async function resolveProductCode(
  supabase: any,
  productCode: string,
  description: string,
  senderType: 'customer' | 'vendor' | 'unknown',
  senderId: string | null,
  allProducts: any[],
  customerMappings: any[],
  vendorMappings: any[]
): Promise<LineItemResolution> {
  
  const normalizedCode = normalizeCode(productCode);
  const result: LineItemResolution = {
    original_product_code: productCode,
    original_description: description,
    resolved_internal_product_id: null,
    resolved_product_name: null,
    resolution_method: 'unresolved',
    confidence_score: 0,
    status: 'unmapped',
  };

  // ========================================
  // RESOLUTION PRIORITY ORDER (per spec)
  // ========================================

  // Priority 1: If sender is customer, try customer_product_mapping
  if (senderType === 'customer' && senderId) {
    const customerMapping = customerMappings.find(m => 
      m.customer_id === senderId && 
      normalizeCode(m.customer_product_code) === normalizedCode &&
      m.is_active
    );
    
    if (customerMapping) {
      const product = allProducts.find(p => p.id === customerMapping.internal_product_id);
      if (product) {
        console.log(`Resolved via customer mapping: ${productCode} -> ${product.internal_code}`);
        return {
          ...result,
          resolved_internal_product_id: product.id,
          resolved_product_name: product.name,
          resolution_method: 'customer_mapping',
          confidence_score: CONFIDENCE.EXACT_SENDER_MAPPING,
          status: 'resolved',
        };
      }
    }
  }

  // Priority 2: If sender is vendor, try vendor_product_mapping
  if (senderType === 'vendor' && senderId) {
    const vendorMapping = vendorMappings.find(m => 
      m.vendor_id === senderId && 
      normalizeCode(m.vendor_product_code) === normalizedCode &&
      m.is_active
    );
    
    if (vendorMapping) {
      const product = allProducts.find(p => p.id === vendorMapping.internal_product_id);
      if (product) {
        console.log(`Resolved via vendor mapping: ${productCode} -> ${product.internal_code}`);
        return {
          ...result,
          resolved_internal_product_id: product.id,
          resolved_product_name: product.name,
          resolution_method: 'vendor_mapping',
          confidence_score: CONFIDENCE.EXACT_SENDER_MAPPING,
          status: 'resolved',
        };
      }
    }
  }

  // Priority 3: Try internal product code match
  const internalMatch = allProducts.find(p => 
    normalizeCode(p.internal_code) === normalizedCode && p.is_active
  );
  
  if (internalMatch) {
    console.log(`Resolved via internal code: ${productCode} -> ${internalMatch.internal_code}`);
    return {
      ...result,
      resolved_internal_product_id: internalMatch.id,
      resolved_product_name: internalMatch.name,
      resolution_method: 'internal_code_match',
      confidence_score: CONFIDENCE.INTERNAL_CODE_MATCH,
      status: 'resolved',
    };
  }

  // Priority 4: Try cross-party mapping (lower confidence)
  // If sender is customer, try vendor mappings; if vendor, try customer mappings
  if (senderType === 'customer') {
    const crossMapping = vendorMappings.find(m => 
      normalizeCode(m.vendor_product_code) === normalizedCode && m.is_active
    );
    if (crossMapping) {
      const product = allProducts.find(p => p.id === crossMapping.internal_product_id);
      if (product) {
        console.log(`Resolved via cross-party (vendor) mapping: ${productCode} -> ${product.internal_code}`);
        return {
          ...result,
          resolved_internal_product_id: product.id,
          resolved_product_name: product.name,
          resolution_method: 'cross_party_mapping',
          confidence_score: CONFIDENCE.CROSS_PARTY_MAPPING,
          status: CONFIDENCE.CROSS_PARTY_MAPPING >= THRESHOLD.AUTO_ACCEPT ? 'resolved' : 'pending',
        };
      }
    }
  } else if (senderType === 'vendor') {
    const crossMapping = customerMappings.find(m => 
      normalizeCode(m.customer_product_code) === normalizedCode && m.is_active
    );
    if (crossMapping) {
      const product = allProducts.find(p => p.id === crossMapping.internal_product_id);
      if (product) {
        console.log(`Resolved via cross-party (customer) mapping: ${productCode} -> ${product.internal_code}`);
        return {
          ...result,
          resolved_internal_product_id: product.id,
          resolved_product_name: product.name,
          resolution_method: 'cross_party_mapping',
          confidence_score: CONFIDENCE.CROSS_PARTY_MAPPING,
          status: CONFIDENCE.CROSS_PARTY_MAPPING >= THRESHOLD.AUTO_ACCEPT ? 'resolved' : 'pending',
        };
      }
    }
  }

  // Priority 5: AI-based suggestion using description similarity
  const descWords = (description || productCode).toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let bestMatch: { product: any; score: number; reason: string } | null = null;

  for (const product of allProducts.filter(p => p.is_active)) {
    const productWords = ((product.name || "") + " " + (product.description || "") + " " + product.internal_code)
      .toLowerCase().split(/\s+/).filter((w: string) => w.length > 2);
    
    const commonWords = descWords.filter(w => 
      productWords.some((pw: string) => pw.includes(w) || w.includes(pw))
    );
    
    const score = commonWords.length / Math.max(descWords.length, 1);
    
    if (score > 0.3 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        product,
        score,
        reason: `Matched words: ${commonWords.join(", ")}`,
      };
    }
  }

  if (bestMatch) {
    const confidence = Math.min(CONFIDENCE.AI_SUGGESTION + (bestMatch.score * 0.3), 0.59);
    console.log(`AI suggestion: ${productCode} -> ${bestMatch.product.internal_code} (${confidence})`);
    return {
      ...result,
      resolved_internal_product_id: null, // Not auto-resolved, needs approval
      resolved_product_name: null,
      resolution_method: 'unresolved',
      confidence_score: confidence,
      status: confidence < THRESHOLD.BLOCK ? 'blocked' : 'unmapped',
      suggestion: {
        product_id: bestMatch.product.id,
        product_name: bestMatch.product.name,
        confidence,
        reason: bestMatch.reason,
      },
    };
  }

  // No match found - mark as unmapped
  console.log(`Product code unresolved: ${productCode}`);
  return {
    ...result,
    status: 'unmapped',
    confidence_score: 0,
  };
}

// Main handler
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      document_id,
      document_type,
      sender_gstin,
      sender_email,
      sender_name,
      items, // Array of { product_code, description, quantity, unit_price }
      persist_results = true, // Whether to save results to database
    } = await req.json();

    if (!document_id || !items || !Array.isArray(items)) {
      return new Response(
        JSON.stringify({ error: "document_id and items array are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Identify sender
    const { sender_type, sender_id } = await identifySender(supabase, {
      gstin: sender_gstin,
      email: sender_email,
      sender_name: sender_name,
      document_type: document_type || 'PO',
    });

    const documentContext: DocumentContext = {
      document_type: document_type || 'PO',
      sender_type,
      sender_id,
      receiver_party: 'our_company',
    };

    // Step 2: Load all reference data
    const [
      { data: allProducts },
      { data: customerMappings },
      { data: vendorMappings },
    ] = await Promise.all([
      supabase.from("product_master").select("*").eq("is_active", true),
      supabase.from("customer_product_mapping").select("*").eq("is_active", true),
      supabase.from("vendor_product_mapping").select("*").eq("is_active", true),
    ]);

    // Step 3: Resolve each line item
    const resolvedItems: LineItemResolution[] = [];
    for (const item of items) {
      const resolution = await resolveProductCode(
        supabase,
        item.product_code || item.description || "",
        item.description || "",
        sender_type,
        sender_id,
        allProducts || [],
        customerMappings || [],
        vendorMappings || []
      );
      resolvedItems.push({
        ...resolution,
        original_description: item.description,
      });
    }

    // Step 4: Calculate summary
    const unmappedItems = resolvedItems.filter(i => i.status === 'unmapped' || i.status === 'blocked');
    const pendingItems = resolvedItems.filter(i => i.status === 'pending');
    const blockedItems = resolvedItems.filter(i => i.status === 'blocked');

    const result: ResolutionResult = {
      document_context: documentContext,
      items: resolvedItems,
      has_unmapped: unmappedItems.length > 0,
      unmapped_count: unmappedItems.length,
      requires_approval: pendingItems.length > 0,
      blocked_count: blockedItems.length,
    };

    // Step 5: Persist results if requested
    if (persist_results) {
      // Log all resolutions
      for (const item of resolvedItems) {
        await supabase.from("product_resolution_log").insert({
          document_id,
          document_type: documentContext.document_type,
          original_product_code: item.original_product_code,
          resolved_internal_product_id: item.resolved_internal_product_id,
          resolution_method: item.resolution_method,
          confidence_score: item.confidence_score,
          sender_type: documentContext.sender_type,
          sender_id: documentContext.sender_id,
        });

        // Create unmapped queue entries for items needing attention
        if (item.status === 'unmapped' || item.status === 'blocked' || item.status === 'pending') {
          await supabase.from("unmapped_product_codes").insert({
            document_id,
            document_type: documentContext.document_type,
            sender_type: documentContext.sender_type,
            sender_id: documentContext.sender_id,
            original_product_code: item.original_product_code,
            original_description: item.original_description,
            suggested_product_id: item.suggestion?.product_id || null,
            suggestion_confidence: item.suggestion?.confidence || 0,
            suggestion_reason: item.suggestion?.reason || null,
            status: 'pending',
          });
        }
      }
    }

    console.log(`Resolution complete: ${resolvedItems.filter(i => i.status === 'resolved').length}/${items.length} resolved`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error resolving product codes:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
