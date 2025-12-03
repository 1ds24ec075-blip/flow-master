import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { poId } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Extracting PO:', poId);

    const { data: poDoc, error: fetchError } = await supabase
      .from('po_intake_documents')
      .select('*')
      .eq('id', poId)
      .single();

    if (fetchError) throw fetchError;

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('po-documents')
      .download(poDoc.file_path);

    if (downloadError) throw downloadError;

    console.log('File downloaded, size:', fileData.size);

    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const imageUrl = `data:${poDoc.file_type};base64,${base64}`;

    console.log('Running single-layer extraction with OpenAI GPT-4o Mini...');

    const extractResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are a Purchase Order extraction expert. Analyze this Purchase Order document image and extract ALL information with high precision.\n\nExtract the following fields and return as valid JSON:\n{\n  \"client_name\": \"company or person name (exact as shown)\",\n  \"po_number\": \"PO reference number\",\n  \"po_date\": \"date of PO in YYYY-MM-DD format\",\n  \"delivery_date\": \"expected delivery date in YYYY-MM-DD format\",\n  \"items\": [\n    {\n      \"item_name\": \"product/service name\",\n      \"qty\": 0,\n      \"rate\": 0,\n      \"gst\": 18,\n      \"amount\": 0\n    }\n  ],\n  \"subtotal\": 0,\n  \"tax_amount\": 0,\n  \"total_amount\": 0,\n  \"notes\": \"any special instructions or notes\",\n  \"confidence\": 95\n}\n\nCRITICAL INSTRUCTIONS:\n- Extract ALL line items from the PO (do not skip any)\n- For Indian formats: handle lakhs (L), crores (Cr) notation and convert to numbers\n- Parse dates in DD/MM/YYYY, DD-MM-YYYY, or other formats and convert to YYYY-MM-DD\n- If GST % is mentioned per item, use that value; otherwise default to 18\n- Calculate amounts if not explicitly stated: amount = qty × rate × (1 + gst/100)\n- For subtotal: sum of all item amounts before tax\n- For tax_amount: sum of GST on all items\n- For total_amount: subtotal + tax_amount (or grand total if shown)\n- If a field is not found or unclear, use null\n- Confidence score: your overall confidence in the extraction (0-100)\n- Return ONLY valid JSON, no markdown formatting, no explanation\n\nBe extremely accurate with numbers, dates, and item details.`
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl
              }
            }
          ]
        }],
        temperature: 0.1,
        max_tokens: 2048,
        response_format: { type: "json_object" }
      }),
    });

    const extractData = await extractResponse.json();

    if (extractData.error) {
      console.error('OpenAI API error:', extractData.error);
      throw new Error(`Extraction failed: ${extractData.error.message || JSON.stringify(extractData.error)}`);
    }

    let structuredData = extractData.choices?.[0]?.message?.content || '{}';

    structuredData = structuredData.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    console.log('Raw extraction response:', structuredData.substring(0, 500));

    const extracted = JSON.parse(structuredData);

    console.log('Extraction completed:', {
      client: extracted.client_name,
      po_number: extracted.po_number,
      items_count: extracted.items?.length,
      total: extracted.total_amount,
      confidence: extracted.confidence
    });

    const mergedData = {
      ...extracted,
      extraction_method: 'openai_gpt4o_mini',
      model: 'gpt-4o-mini',
      extracted_at: new Date().toISOString(),
    };

    const confidenceScores = {
      client_name: extracted.client_name ? 90 : 50,
      po_number: extracted.po_number ? 95 : 50,
      po_date: extracted.po_date ? 85 : 50,
      delivery_date: extracted.delivery_date ? 80 : 50,
      items: extracted.items?.length > 0 ? 90 : 50,
      overall: extracted.confidence || 85,
    };

    const { data: updatedPo, error: updateError } = await supabase
      .from('po_intake_documents')
      .update({
        extracted_data: mergedData,
        confidence_scores: confidenceScores,
        status: 'extracted',
      })
      .eq('id', poId)
      .select()
      .single();

    if (updateError) throw updateError;

    console.log('PO extraction completed successfully');

    console.log('Saving to purchase_orders table...');

    let clientId = null;
    if (extracted.client_name) {
      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .ilike('name', extracted.client_name)
        .maybeSingle();

      if (existingClient) {
        clientId = existingClient.id;
      } else {
        const { data: newClient, error: clientError } = await supabase
          .from('clients')
          .insert({ name: extracted.client_name })
          .select('id')
          .single();

        if (!clientError && newClient) {
          clientId = newClient.id;
        }
      }
    }

    const totalAmount = extracted.total_amount || extracted.items?.reduce((sum: number, item: any) => {
      return sum + (item.amount || (item.qty * item.rate * (1 + (item.gst || 0) / 100)));
    }, 0) || 0;

    const { data: purchaseOrder, error: poInsertError } = await supabase
      .from('purchase_orders')
      .insert({
        po_number: extracted.po_number || `PO-${Date.now()}`,
        client_id: clientId,
        po_details: extracted.notes || `PO imported from ${poDoc.file_name}`,
        material_items: extracted.items || [],
        amount: totalAmount,
        status: 'draft',
        created_by: poDoc.uploaded_by,
      })
      .select()
      .single();

    if (poInsertError) {
      console.error('Error creating purchase order:', poInsertError);
    } else {
      console.log('Purchase order created successfully:', purchaseOrder.id);
    }

    return new Response(JSON.stringify({
      ...updatedPo,
      purchase_order_id: purchaseOrder?.id,
      purchase_order_created: !poInsertError,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in po-extract:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
