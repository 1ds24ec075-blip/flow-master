import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// =============================================
// APPROVE/REJECT UNMAPPED PRODUCT CODE MAPPINGS
// =============================================

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      unmapped_id,           // ID from unmapped_product_codes table
      action,                // 'approve' | 'reject' | 'create_new'
      internal_product_id,   // For 'approve' - the product to map to
      create_mapping,        // Boolean - whether to persist the mapping for future use
      new_product_data,      // For 'create_new' - { internal_code, name, description, default_unit, default_unit_price }
      resolved_by,           // User identifier
    } = await req.json();

    if (!unmapped_id || !action) {
      return new Response(
        JSON.stringify({ error: "unmapped_id and action are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the unmapped record
    const { data: unmapped, error: fetchError } = await supabase
      .from("unmapped_product_codes")
      .select("*")
      .eq("id", unmapped_id)
      .single();

    if (fetchError || !unmapped) {
      return new Response(
        JSON.stringify({ error: "Unmapped record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let resolvedProductId = internal_product_id;
    let newStatus = 'approved';

    // Handle different actions
    if (action === 'approve') {
      if (!internal_product_id) {
        // Use suggested product if no explicit product provided
        if (unmapped.suggested_product_id) {
          resolvedProductId = unmapped.suggested_product_id;
        } else {
          return new Response(
            JSON.stringify({ error: "internal_product_id is required for approval" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Verify the product exists
      const { data: product } = await supabase
        .from("product_master")
        .select("id, internal_code, name")
        .eq("id", resolvedProductId)
        .single();

      if (!product) {
        return new Response(
          JSON.stringify({ error: "Product not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Create persistent mapping if requested
      if (create_mapping && unmapped.sender_id) {
        if (unmapped.sender_type === 'customer') {
          const { error: mappingError } = await supabase
            .from("customer_product_mapping")
            .upsert({
              customer_id: unmapped.sender_id,
              customer_product_code: unmapped.original_product_code,
              internal_product_id: resolvedProductId,
              customer_product_name: unmapped.original_description,
              is_active: true,
            }, {
              onConflict: 'customer_id,customer_product_code',
            });

          if (mappingError) {
            console.error("Error creating customer mapping:", mappingError);
          } else {
            console.log(`Created customer mapping: ${unmapped.original_product_code} -> ${product.internal_code}`);
          }
        } else if (unmapped.sender_type === 'vendor') {
          const { error: mappingError } = await supabase
            .from("vendor_product_mapping")
            .upsert({
              vendor_id: unmapped.sender_id,
              vendor_product_code: unmapped.original_product_code,
              internal_product_id: resolvedProductId,
              vendor_product_name: unmapped.original_description,
              is_active: true,
            }, {
              onConflict: 'vendor_id,vendor_product_code',
            });

          if (mappingError) {
            console.error("Error creating vendor mapping:", mappingError);
          } else {
            console.log(`Created vendor mapping: ${unmapped.original_product_code} -> ${product.internal_code}`);
          }
        }
      }

      // Log the resolution
      await supabase.from("product_resolution_log").insert({
        document_id: unmapped.document_id,
        document_type: unmapped.document_type,
        original_product_code: unmapped.original_product_code,
        resolved_internal_product_id: resolvedProductId,
        resolution_method: create_mapping ? 'manual_mapping' : 'ai_suggestion_approved',
        confidence_score: 1.0, // User approved = full confidence
        sender_type: unmapped.sender_type,
        sender_id: unmapped.sender_id,
      });

    } else if (action === 'reject') {
      newStatus = 'rejected';
      resolvedProductId = null;

    } else if (action === 'create_new') {
      // Create a new product in product_master
      if (!new_product_data?.internal_code || !new_product_data?.name) {
        return new Response(
          JSON.stringify({ error: "internal_code and name are required for new product" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: newProduct, error: createError } = await supabase
        .from("product_master")
        .insert({
          internal_code: new_product_data.internal_code,
          name: new_product_data.name,
          description: new_product_data.description || unmapped.original_description,
          default_unit: new_product_data.default_unit || 'PCS',
          default_unit_price: new_product_data.default_unit_price || unmapped.original_unit_price,
          is_active: true,
        })
        .select()
        .single();

      if (createError) {
        return new Response(
          JSON.stringify({ error: `Failed to create product: ${createError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      resolvedProductId = newProduct.id;
      newStatus = 'new_product';

      // Auto-create mapping for the sender
      if (unmapped.sender_id) {
        if (unmapped.sender_type === 'customer') {
          await supabase.from("customer_product_mapping").insert({
            customer_id: unmapped.sender_id,
            customer_product_code: unmapped.original_product_code,
            internal_product_id: resolvedProductId,
            customer_product_name: unmapped.original_description,
            is_active: true,
          });
        } else if (unmapped.sender_type === 'vendor') {
          await supabase.from("vendor_product_mapping").insert({
            vendor_id: unmapped.sender_id,
            vendor_product_code: unmapped.original_product_code,
            internal_product_id: resolvedProductId,
            vendor_product_name: unmapped.original_description,
            is_active: true,
          });
        }
      }

      // Log the resolution
      await supabase.from("product_resolution_log").insert({
        document_id: unmapped.document_id,
        document_type: unmapped.document_type,
        original_product_code: unmapped.original_product_code,
        resolved_internal_product_id: resolvedProductId,
        resolution_method: 'manual_mapping',
        confidence_score: 1.0,
        sender_type: unmapped.sender_type,
        sender_id: unmapped.sender_id,
      });

      console.log(`Created new product: ${new_product_data.internal_code} and mapped from ${unmapped.original_product_code}`);
    }

    // Update the unmapped record
    const { error: updateError } = await supabase
      .from("unmapped_product_codes")
      .update({
        status: newStatus,
        resolved_product_id: resolvedProductId,
        resolved_by,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", unmapped_id);

    if (updateError) {
      console.error("Error updating unmapped record:", updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        resolved_product_id: resolvedProductId,
        status: newStatus,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error approving product mapping:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
