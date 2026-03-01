import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filePath } = await req.json();
    if (!filePath) throw new Error('filePath is required');

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!lovableApiKey) throw new Error('LOVABLE_API_KEY is not configured');
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials missing');

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Downloading file from storage:', filePath);
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('bills')
      .download(filePath);

    if (downloadError) throw downloadError;

    console.log('File downloaded, size:', fileData.size, 'type:', fileData.type);

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
    const base64 = btoa(binString);

    // Determine mime type
    const mimeType = fileData.type || (filePath.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    console.log('Running AI extraction for supplier invoice...');

    const extractionPrompt = `You are an expert document extraction specialist for supplier/vendor invoices. Extract ALL data from this invoice document.

CRITICAL FIELDS TO EXTRACT:
1. **Invoice Number** - The invoice/bill number
2. **Invoice Date** - When the invoice was issued
3. **Due Date / Payment Due Date** - When payment is due. Look for:
   - "Due Date", "Payment Due", "Due By", "Pay By", "Payment Terms" fields
   - "Net 30", "Net 60" etc. - calculate due date from invoice date
   - Any date that indicates when payment should be made
4. **Total Amount** - The total payable amount (including taxes)
5. **Supplier/Vendor Name** - Who issued the invoice
6. **GST Number** - Supplier's GSTIN (15-char format)
7. **Line Items** - All items with description, quantity, unit price, amount

DATE PARSING RULES:
- Convert ALL dates to YYYY-MM-DD format
- Handle DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, MM/DD/YYYY formats
- For Indian invoices, assume DD/MM/YYYY format
- If only payment terms like "Net 30" are given and invoice_date is available, calculate due_date = invoice_date + 30 days

Return ONLY valid JSON:
{
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "amount": 0,
  "vendor_name": "string or null",
  "vendor_gst": "15-char GSTIN or null",
  "payment_terms": "string description or null",
  "items": [
    {
      "description": "string",
      "quantity": 1,
      "unit_price": 0,
      "amount": 0
    }
  ],
  "confidence": 90,
  "extraction_notes": "brief notes about extraction quality"
}

IMPORTANT:
- Extract ALL visible dates, especially the due date
- For handwritten invoices, read carefully character by character
- If due date is not explicitly shown but payment terms are (e.g. "Net 30"), calculate it from invoice date
- Return ONLY valid JSON, no markdown, no explanation`;

    // Use inline_data for PDFs, image_url for images
    let messageContent: any[];
    if (mimeType === 'application/pdf') {
      messageContent = [
        { type: 'text', text: extractionPrompt },
        {
          type: 'image_url',
          image_url: { url: dataUrl }
        }
      ];
    } else {
      messageContent = [
        { type: 'text', text: extractionPrompt },
        { type: 'image_url', image_url: { url: dataUrl } }
      ];
    }

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
          content: messageContent,
        }],
      }),
    });

    if (!extractResponse.ok) {
      const errorText = await extractResponse.text();
      console.error('AI error:', extractResponse.status, errorText);
      if (extractResponse.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
      if (extractResponse.status === 402) throw new Error('API credits exhausted.');
      throw new Error(`AI returned ${extractResponse.status}: ${errorText}`);
    }

    const extractData = await extractResponse.json();
    let structuredData = extractData.choices?.[0]?.message?.content || '{}';
    structuredData = structuredData.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    console.log('Raw extraction:', structuredData.substring(0, 500));

    const extracted = JSON.parse(structuredData);

    console.log('Extraction complete:', {
      invoice_number: extracted.invoice_number,
      amount: extracted.amount,
      due_date: extracted.due_date,
      invoice_date: extracted.invoice_date,
      vendor: extracted.vendor_name,
      confidence: extracted.confidence,
    });

    return new Response(JSON.stringify(extracted), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in supplier-invoice-extract:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
