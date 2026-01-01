import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// ============= Duplicate Detection Helpers =============

function normalizeName(name: string | null): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeBillNumber(billNumber: string | null): string {
  if (!billNumber) return "";
  return billNumber
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^0+/, "")
    .trim();
}

function amountsMatch(amount1: number | null, amount2: number | null, tolerance = 1): boolean {
  if (amount1 === null || amount2 === null) return false;
  return Math.abs(amount1 - amount2) <= tolerance;
}

function datesMatch(date1: string | null, date2: string | null, daysTolerance = 5): boolean {
  if (!date1 || !date2) return false;
  try {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffMs = Math.abs(d1.getTime() - d2.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays <= daysTolerance;
  } catch {
    return false;
  }
}

interface DuplicateMatchResult {
  isDuplicate: boolean;
  matchedBillId: string | null;
  matchedBillNumber: string | null;
  matchType: "exact_vendor_bill" | "normalized_vendor_bill" | "vendor_amount_date" | "gst_bill_number" | null;
  confidence: "high" | "medium" | "low" | null;
  matchDetails: string | null;
}

async function checkForDuplicateBill(
  supabase: any,
  currentBillId: string,
  vendorName: string | null,
  billNumber: string | null,
  billDate: string | null,
  totalAmount: number | null,
  vendorGst: string | null
): Promise<DuplicateMatchResult> {
  const noMatch: DuplicateMatchResult = {
    isDuplicate: false,
    matchedBillId: null,
    matchedBillNumber: null,
    matchType: null,
    confidence: null,
    matchDetails: null,
  };

  if (!vendorName && !billNumber && !vendorGst) {
    return noMatch;
  }

  // Fetch existing bills (excluding current one)
  const { data: existingBills, error } = await supabase
    .from("bills")
    .select("id, bill_number, vendor_name, vendor_gst, bill_date, total_amount")
    .neq("id", currentBillId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error || !existingBills || existingBills.length === 0) {
    return noMatch;
  }

  const normalizedVendor = normalizeName(vendorName);
  const normalizedBillNum = normalizeBillNumber(billNumber);

  for (const bill of existingBills) {
    // Layer 1: Exact vendor name + bill number match (HIGH confidence)
    if (vendorName && billNumber && bill.vendor_name && bill.bill_number) {
      if (
        bill.vendor_name.toLowerCase() === vendorName.toLowerCase() &&
        bill.bill_number.toLowerCase() === billNumber.toLowerCase()
      ) {
        console.log(`Duplicate found: Exact vendor+bill match with ${bill.id}`);
        return {
          isDuplicate: true,
          matchedBillId: bill.id,
          matchedBillNumber: bill.bill_number,
          matchType: "exact_vendor_bill",
          confidence: "high",
          matchDetails: `Exact match: Vendor "${vendorName}" with Bill# "${billNumber}"`,
        };
      }
    }

    // Layer 2: Normalized vendor + bill number match (HIGH confidence)
    if (normalizedVendor && normalizedBillNum) {
      const existingNormalizedVendor = normalizeName(bill.vendor_name);
      const existingNormalizedBillNum = normalizeBillNumber(bill.bill_number);
      if (
        existingNormalizedVendor === normalizedVendor &&
        existingNormalizedBillNum === normalizedBillNum
      ) {
        console.log(`Duplicate found: Normalized vendor+bill match with ${bill.id}`);
        return {
          isDuplicate: true,
          matchedBillId: bill.id,
          matchedBillNumber: bill.bill_number,
          matchType: "normalized_vendor_bill",
          confidence: "high",
          matchDetails: `Normalized match: Vendor "${vendorName}" → "${normalizedVendor}", Bill# "${billNumber}" → "${normalizedBillNum}"`,
        };
      }
    }

    // Layer 3: GST + Bill Number match (HIGH confidence)
    if (vendorGst && billNumber && bill.vendor_gst && bill.bill_number) {
      if (
        bill.vendor_gst === vendorGst &&
        normalizeBillNumber(bill.bill_number) === normalizedBillNum
      ) {
        console.log(`Duplicate found: GST+Bill# match with ${bill.id}`);
        return {
          isDuplicate: true,
          matchedBillId: bill.id,
          matchedBillNumber: bill.bill_number,
          matchType: "gst_bill_number",
          confidence: "high",
          matchDetails: `GST+Bill# match: GST "${vendorGst}" with Bill# "${billNumber}"`,
        };
      }
    }

    // Layer 4: Vendor + Amount + Date match (MEDIUM confidence)
    if (normalizedVendor && totalAmount && billDate) {
      const existingNormalizedVendor = normalizeName(bill.vendor_name);
      if (
        existingNormalizedVendor === normalizedVendor &&
        amountsMatch(bill.total_amount, totalAmount) &&
        datesMatch(bill.bill_date, billDate)
      ) {
        console.log(`Duplicate found: Vendor+Amount+Date match with ${bill.id}`);
        return {
          isDuplicate: true,
          matchedBillId: bill.id,
          matchedBillNumber: bill.bill_number,
          matchType: "vendor_amount_date",
          confidence: "medium",
          matchDetails: `Vendor+Amount+Date match: "${vendorName}" with ₹${totalAmount} on ${billDate}`,
        };
      }
    }
  }

  return noMatch;
}

// ============= Main Handler =============

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
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    console.log('Environment check:', {
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey,
      hasLovableApiKey: !!lovableApiKey,
    });

    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials are missing');
    }

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
    console.log('Running extraction with Lovable AI (Gemini Flash)...');

    const extractionPrompt = `You are an expert OCR and document extraction specialist with advanced capabilities for reading HANDWRITTEN text, messy receipts, and low-quality scans.

CRITICAL HANDWRITING RECOGNITION GUIDELINES:
1. For handwritten text: Look carefully at each character, consider context to disambiguate similar letters (0 vs O, 1 vs l vs I, 5 vs S, 8 vs B, 2 vs Z)
2. Read numbers digit by digit - handwritten amounts are often the most critical data
3. For dates: Consider common date formats and validate the date makes logical sense
4. If text is partially obscured or smudged, use surrounding context to infer meaning
5. Pay special attention to:
   - Handwritten totals (often circled or underlined)
   - Handwritten corrections or additions
   - Signatures that may contain names
   - Margin notes with prices or quantities

CRITICAL GST vs TIN DISTINCTION:
- GST Number (GSTIN) format: 15 characters - 2 digit state code + 10 character PAN + 1 entity code + 1Z + 1 checksum
  Example: 27AABCU9603R1ZM, 09AAACH7409R1ZZ
  Pattern: First 2 digits (01-37), then 5 uppercase letters, then 4 digits, then 1 letter, then 1 alphanumeric, then Z, then 1 alphanumeric
- TIN Number: 11-digit number that was used before GST era (pre-2017)
  Example: 27400200717, 09123456789
  Pattern: Just 11 digits, often starts with state code (2 digits)
- IMPORTANT: If a document shows "TIN No." or "TIN:" with an 11-digit number, extract it as vendor_tin, NOT as vendor_gst
- Only extract as vendor_gst if it matches the 15-character GSTIN format
- If both TIN and GST are present, extract both separately

EXTRACTION RULES:
- Analyze the ENTIRE image systematically: top-to-bottom, left-to-right
- For printed + handwritten mixed documents: extract BOTH
- If handwritten text overwrites/corrects printed text, prefer the handwritten version
- Look for handwritten calculations in margins that may indicate the true total

Extract the following fields and return as valid JSON:
{
  "bill_number": "bill/invoice/receipt number (check for handwritten bill # at top)",
  "vendor_name": "merchant or vendor name (may be stamped, printed, or handwritten)",
  "vendor_gst": "GST number ONLY if it matches 15-char GSTIN format (e.g., 27AABCU9603R1ZM), else null",
  "vendor_tin": "TIN number if present (11-digit number), else null",
  "bill_date": "date of bill in YYYY-MM-DD format (check for handwritten dates)",
  "subtotal": 0,
  "tax_amount": 0,
  "total_amount": 0,
  "currency": "INR",
  "payment_method": "cash/card/upi/etc (look for handwritten payment notes)",
  "items": [
    {
      "item_description": "item name (may be abbreviated or handwritten)",
      "quantity": 1,
      "unit_price": 0,
      "tax_rate": 0,
      "amount": 0
    }
  ],
  "notes": "any additional handwritten notes, corrections, or annotations",
  "confidence": 95,
  "handwriting_detected": true,
  "extraction_notes": "brief note about document quality and any challenges"
}

CRITICAL INSTRUCTIONS:
- Extract ALL line items from the bill (do not skip any, even if handwritten)
- For Indian formats: handle lakhs (L), crores (Cr) notation and convert to numbers
- Parse dates in DD/MM/YYYY, DD-MM-YYYY, or handwritten formats and convert to YYYY-MM-DD
- Extract GST/tax information accurately (CGST, SGST, IGST)
- GST VALIDATION: Only put a value in vendor_gst if it strictly matches the GSTIN format (15 chars, pattern: ##XXXXX####X#Z#)
- TIN EXTRACTION: If you see "TIN No." or "TIN:" followed by an 11-digit number, put it in vendor_tin
- DO NOT put TIN numbers in the vendor_gst field!
- Calculate amounts if not explicitly stated
- For subtotal: sum of all item amounts before tax
- For tax_amount: total GST/tax amount
- For total_amount: final payable amount (prioritize handwritten totals if present)
- If payment method is visible (cash/card/UPI), extract it
- If a field is not found or unclear, use null
- Confidence score: your overall confidence in the extraction (0-100), lower for poor handwriting
- Set handwriting_detected to true if ANY handwritten content is present
- Return ONLY valid JSON, no markdown formatting, no explanation

QUALITY ASSESSMENT:
- If image is blurry/tilted, still attempt extraction
- For very poor quality, provide best effort with lower confidence score
- Note any specific fields that were difficult to read in extraction_notes`;

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
            { type: 'text', text: extractionPrompt },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }],
      }),
    });

    console.log('Lovable AI response status:', extractResponse.status, extractResponse.statusText);

    if (!extractResponse.ok) {
      const errorText = await extractResponse.text();
      console.error('Lovable AI error response:', errorText);
      
      if (extractResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (extractResponse.status === 402) {
        throw new Error('API credits exhausted. Please add credits to continue.');
      }
      throw new Error(`Lovable AI returned ${extractResponse.status}: ${errorText}`);
    }

    const extractData = await extractResponse.json();
    console.log('Lovable AI response received');

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

    // Validate GST format before saving - must be 15 chars matching GSTIN pattern
    const gstPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
    const validatedGst = extracted.vendor_gst && gstPattern.test(extracted.vendor_gst) 
      ? extracted.vendor_gst 
      : null;
    
    // Log GST validation result
    if (extracted.vendor_gst && !validatedGst) {
      console.log('GST validation failed:', extracted.vendor_gst, '- does not match GSTIN format');
    }

    // ============= Duplicate Detection =============
    console.log('Checking for duplicate bills...');
    const duplicateCheck = await checkForDuplicateBill(
      supabase,
      billId,
      extracted.vendor_name,
      extracted.bill_number,
      extracted.bill_date,
      extracted.total_amount,
      validatedGst
    );

    if (duplicateCheck.isDuplicate) {
      console.log('Duplicate bill detected:', duplicateCheck);
    }

    const { data: updatedBill, error: updateError } = await supabase
      .from('bills')
      .update({
        bill_number: extracted.bill_number || bill.bill_number,
        vendor_name: extracted.vendor_name || bill.vendor_name,
        vendor_gst: validatedGst || bill.vendor_gst,
        vendor_tin: extracted.vendor_tin || bill.vendor_tin,
        bill_date: extracted.bill_date || bill.bill_date,
        total_amount: extracted.total_amount || 0,
        extraction_confidence: extracted.confidence || 0,
        is_duplicate: duplicateCheck.isDuplicate,
        duplicate_bill_id: duplicateCheck.matchedBillId,
        duplicate_match_details: duplicateCheck.isDuplicate ? {
          matched_bill_id: duplicateCheck.matchedBillId,
          matched_bill_number: duplicateCheck.matchedBillNumber,
          match_type: duplicateCheck.matchType,
          confidence: duplicateCheck.confidence,
          match_details: duplicateCheck.matchDetails,
        } : null,
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

    console.log('Bill extraction completed successfully', duplicateCheck.isDuplicate ? '(DUPLICATE DETECTED)' : '');

    return new Response(JSON.stringify({
      ...updatedBill,
      duplicate_detected: duplicateCheck.isDuplicate,
      duplicate_match_details: duplicateCheck.isDuplicate ? {
        matched_bill_id: duplicateCheck.matchedBillId,
        matched_bill_number: duplicateCheck.matchedBillNumber,
        match_type: duplicateCheck.matchType,
        confidence: duplicateCheck.confidence,
        match_details: duplicateCheck.matchDetails,
      } : null,
    }), {
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