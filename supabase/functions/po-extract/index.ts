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
    const gcpApiKey = Deno.env.get('GCP_API_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

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

    console.log('Running Layer 1: Google Cloud Vision OCR...');
    const ocrResponse = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${gcpApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [{
          image: {
            content: base64,
          },
          features: [
            { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }
          ],
        }],
      }),
    });

    const ocrData = await ocrResponse.json();
    const ocrText = ocrData.responses?.[0]?.fullTextAnnotation?.text || '';
    console.log('Layer 1 Google Cloud Vision OCR completed, text length:', ocrText.length);

    console.log('Running Layer 2: Gemini 1.5 Pro Vision structured extraction...');
    const extractResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-1.5-pro',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract the following fields from this Purchase Order document and return as JSON:
{
  "client_name": "company or person name",
  "po_number": "PO reference number",
  "po_date": "date of PO (YYYY-MM-DD format)",
  "delivery_date": "expected delivery date (YYYY-MM-DD format)",
  "items": [
    {
      "item_name": "product/service name",
      "qty": 0,
      "rate": 0,
      "gst": 18,
      "amount": 0
    }
  ],
  "subtotal": 0,
  "tax_amount": 0,
  "total_amount": 0,
  "notes": "any special instructions or notes",
  "confidence": 95
}

Be precise. If a field is not found, use null. Return ONLY the JSON object, no markdown or explanation.` 
            },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }],
      }),
    });

    const extractData = await extractResponse.json();
    let structuredData = extractData.choices?.[0]?.message?.content || '{}';
    
    structuredData = structuredData.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const extracted = JSON.parse(structuredData);
    
    console.log('Layer 2 extraction completed:', extracted);

    const mergedData = {
      ...extracted,
      raw_ocr_text: ocrText,
      extraction_method: 'gcp_vision_gemini_pro',
      layer1: 'Google Cloud Vision OCR',
      layer2: 'Gemini 1.5 Pro Vision',
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
