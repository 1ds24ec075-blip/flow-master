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
    const body = await req.json();
    console.log('Received request body:', body);

    const { billId } = body;
    if (!billId) {
      throw new Error('billId is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

    console.log('Environment check:', {
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey,
      hasOpenAIKey: !!openaiApiKey,
      openaiKeyPrefix: openaiApiKey ? openaiApiKey.substring(0, 7) : 'MISSING'
    });

    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not configured in Supabase secrets. Please add it via: Supabase Dashboard > Edge Functions > Secrets');
    }

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials are missing');
    }

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Extracting Bill:', billId);

    const { data: bill, error: fetchError } = await supabase
      .from('bills')
      .select('*')
      .eq('id', billId)
      .single();

    if (fetchError) throw fetchError;

    if (!bill.image_url) {
      throw new Error('Bill has no image to extract');
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('bills')
      .download(bill.image_url);

    if (downloadError) throw downloadError;

    console.log('File downloaded, size:', fileData.size, 'bytes');

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const binString = Array.from(bytes, (byte) =>
      String.fromCodePoint(byte),
    ).join("");
    const base64 = btoa(binString);

    const fileType = fileData.type || 'image/jpeg';
    const imageUrl = `data:${fileType};base64,${base64}`;

    console.log('Image encoded, base64 length:', base64.length, 'characters');
    console.log('Running extraction with OpenAI GPT-4o Mini...');

    const requestBody = {
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are a bill/receipt extraction expert. Analyze this bill or receipt image and extract ALL information with high precision.\n\nExtract the following fields and return as valid JSON:\n{\n  \"bill_number\": \"bill/invoice/receipt number\",\n  \"vendor_name\": \"merchant or vendor name\",\n  \"vendor_gst\": \"GST number if available\",\n  \"bill_date\": \"date of bill in YYYY-MM-DD format\",\n  \"subtotal\": 0,\n  \"tax_amount\": 0,\n  \"total_amount\": 0,\n  \"currency\": \"INR\",\n  \"payment_method\": \"cash/card/upi/etc\",\n  \"items\": [\n    {\n      \"item_description\": \"item name\",\n      \"quantity\": 1,\n      \"unit_price\": 0,\n      \"tax_rate\": 0,\n      \"amount\": 0\n    }\n  ],\n  \"notes\": \"any additional information\",\n  \"confidence\": 95\n}\n\nCRITICAL INSTRUCTIONS:\n- Extract ALL line items from the bill (do not skip any)\n- For Indian formats: handle lakhs (L), crores (Cr) notation and convert to numbers\n- Parse dates in DD/MM/YYYY, DD-MM-YYYY, or other formats and convert to YYYY-MM-DD\n- Extract GST/tax information accurately\n- Calculate amounts if not explicitly stated\n- For subtotal: sum of all item amounts before tax\n- For tax_amount: total GST/tax amount\n- For total_amount: final payable amount\n- If payment method is visible (cash/card/UPI), extract it\n- If a field is not found or unclear, use null\n- Confidence score: your overall confidence in the extraction (0-100)\n- Return ONLY valid JSON, no markdown formatting, no explanation\n\nBe extremely accurate with numbers, dates, and item details.`
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
      };

    console.log('Making OpenAI API request...');

    const extractResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('OpenAI response status:', extractResponse.status, extractResponse.statusText);

    if (!extractResponse.ok) {
      const errorText = await extractResponse.text();
      console.error('OpenAI API error response:', errorText);
      throw new Error(`OpenAI API returned ${extractResponse.status}: ${errorText}`);
    }

    const extractData = await extractResponse.json();
    console.log('OpenAI response received, has choices:', !!extractData.choices);

    if (extractData.error) {
      console.error('OpenAI API error:', extractData.error);
      throw new Error(`Extraction failed: ${extractData.error.message || JSON.stringify(extractData.error)}`);
    }

    let structuredData = extractData.choices?.[0]?.message?.content || '{}';
    structuredData = structuredData.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    console.log('Raw extraction response:', structuredData.substring(0, 500));

    const extracted = JSON.parse(structuredData);

    console.log('Extraction completed:', {
      vendor: extracted.vendor_name,
      bill_number: extracted.bill_number,
      items_count: extracted.items?.length,
      total: extracted.total_amount,
      confidence: extracted.confidence
    });

    const { data: updatedBill, error: updateError } = await supabase
      .from('bills')
      .update({
        bill_number: extracted.bill_number || bill.bill_number,
        vendor_name: extracted.vendor_name || bill.vendor_name,
        vendor_gst: extracted.vendor_gst || bill.vendor_gst,
        bill_date: extracted.bill_date || bill.bill_date,
        subtotal: extracted.subtotal || 0,
        tax_amount: extracted.tax_amount || 0,
        total_amount: extracted.total_amount || 0,
        currency: extracted.currency || 'INR',
        payment_method: extracted.payment_method || bill.payment_method,
        description: extracted.notes || bill.description,
        extraction_confidence: extracted.confidence || 0,
      })
      .eq('id', billId)
      .select()
      .single();

    if (updateError) throw updateError;

    if (extracted.items && extracted.items.length > 0) {
      await supabase
        .from('expense_line_items')
        .delete()
        .eq('bill_id', billId);

      const lineItems = extracted.items.map((item: any) => ({
        bill_id: billId,
        item_description: item.item_description || '',
        quantity: item.quantity || 1,
        unit_price: item.unit_price || 0,
        tax_rate: item.tax_rate || 0,
        amount: item.amount || 0,
      }));

      const { error: lineItemsError } = await supabase
        .from('expense_line_items')
        .insert(lineItems);

      if (lineItemsError) {
        console.error('Error inserting line items:', lineItemsError);
      }
    }

    console.log('Bill extraction completed successfully');

    return new Response(JSON.stringify(updatedBill), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in bill-extract:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});