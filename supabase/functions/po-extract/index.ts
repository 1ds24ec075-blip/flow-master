import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { poId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Extracting PO:', poId);

    // Get PO record
    const { data: poDoc, error: fetchError } = await supabase
      .from('po_intake_documents')
      .select('*')
      .eq('id', poId)
      .single();

    if (fetchError) throw fetchError;

    // Get file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('po-documents')
      .download(poDoc.file_path);

    if (downloadError) throw downloadError;

    console.log('File downloaded, size:', fileData.size);

    // Convert to base64 for AI processing
    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const imageUrl = `data:${poDoc.file_type};base64,${base64}`;

    // Layer 1: Basic OCR - Extract all text
    console.log('Running Layer 1 OCR...');
    const ocrResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract all text from this document exactly as it appears. Return only the text, no formatting.' },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }],
      }),
    });

    const ocrData = await ocrResponse.json();
    const ocrText = ocrData.choices?.[0]?.message?.content || '';
    console.log('Layer 1 OCR completed, text length:', ocrText.length);

    // Layer 2: Structured Extraction
    console.log('Running Layer 2 structured extraction...');
    const extractResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
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
    
    // Clean up markdown if present
    structuredData = structuredData.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const extracted = JSON.parse(structuredData);
    
    console.log('Layer 2 extraction completed:', extracted);

    // Merge layers with confidence scoring
    const mergedData = {
      ...extracted,
      raw_ocr_text: ocrText,
      extraction_method: 'dual_layer_ai',
    };

    // Calculate field-level confidence scores
    const confidenceScores = {
      client_name: extracted.client_name ? 90 : 50,
      po_number: extracted.po_number ? 95 : 50,
      po_date: extracted.po_date ? 85 : 50,
      delivery_date: extracted.delivery_date ? 80 : 50,
      items: extracted.items?.length > 0 ? 90 : 50,
      overall: extracted.confidence || 85,
    };

    // Update PO record with extracted data
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

    return new Response(JSON.stringify(updatedPo), {
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