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
    const geminiApiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GCP_API_KEY')!;

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

    if (ocrData.responses?.[0]?.error) {
      console.error('Google Cloud Vision error:', ocrData.responses[0].error);
      throw new Error(`OCR failed: ${ocrData.responses[0].error.message}`);
    }

    const ocrText = ocrData.responses?.[0]?.fullTextAnnotation?.text || '';
    console.log('Layer 1 Google Cloud Vision OCR completed, text length:', ocrText.length);
    if (ocrText.length > 0) {
      console.log('First 500 chars of OCR text:', ocrText.substring(0, 500));
    }

    console.log('Running Layer 2: Gemini 1.5 Pro Vision structured extraction...');

    const mimeType = poDoc.file_type || 'image/jpeg';

    const extractResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: `You are a Purchase Order extraction expert. Analyze this document and extract the following information.\n\nOCR Text from the document:\n${ocrText}\n\nExtract the following fields and return as JSON:\n{\n  \"client_name\": \"company or person name (exact as shown)\",\n  \"po_number\": \"PO reference number\",\n  \"po_date\": \"date of PO in YYYY-MM-DD format\",\n  \"delivery_date\": \"expected delivery date in YYYY-MM-DD format\",\n  \"items\": [\n    {\n      \"item_name\": \"product/service name\",\n      \"qty\": 0,\n      \"rate\": 0,\n      \"gst\": 18,\n      \"amount\": 0\n    }\n  ],\n  \"subtotal\": 0,\n  \"tax_amount\": 0,\n  \"total_amount\": 0,\n  \"notes\": \"any special instructions or notes\",\n  \"confidence\": 95\n}\n\nIMPORTANT:\n- Extract ALL line items from the PO\n- For Indian formats, handle lakhs/crores notation\n- Parse dates in DD/MM/YYYY or DD-MM-YYYY format and convert to YYYY-MM-DD\n- If GST % is mentioned, use that value, otherwise default to 18\n- Calculate amounts if not explicitly stated\n- Use the OCR text above as the primary source\n- If a field is not found, use null\n- Return ONLY valid JSON, no markdown or explanation`
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          topK: 32,
          topP: 1,
          maxOutputTokens: 2048,
        },
      }),
    });

    const extractData = await extractResponse.json();

    if (extractData.error) {
      console.error('Gemini API error:', extractData.error);
      throw new Error(`Gemini extraction failed: ${extractData.error.message}`);
    }

    let structuredData = extractData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    structuredData = structuredData.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    console.log('Raw Gemini response:', structuredData);

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
