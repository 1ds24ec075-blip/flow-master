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

function cleanText(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseAmount(value: string): number | null {
  const normalized = value.replace(/[^0-9,.-]/g, '');
  if (!normalized) return null;

  const parsed = Number(normalized.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOcrDate(rawValue: string): string | null {
  const match = rawValue.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!match) return null;

  let first = Number(match[1]);
  let second = Number(match[2]);
  let year = Number(match[3]);

  if (year < 100) {
    year += year >= 50 ? 1900 : 2000;
  }

  let day = first;
  let month = second;

  if (first > 12 && second <= 12) {
    day = first;
    month = second;
  } else if (second > 12 && first <= 12) {
    day = second;
    month = first;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function extractDateFromText(text: string): string | null {
  const keywordPatterns = [
    /invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i,
    /bill\s*date\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i,
    /date\s*[:\-]?\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/i,
  ];

  for (const pattern of keywordPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const parsed = parseOcrDate(match[1]);
      if (parsed) return parsed;
    }
  }

  const fallbackMatch = text.match(/\b(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})\b/);
  if (fallbackMatch?.[1]) {
    return parseOcrDate(fallbackMatch[1]);
  }

  return null;
}

function extractBillNumber(lines: string[]): string | null {
  const patterns = [
    /tax\s*invoice\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9/\-_.]+)/i,
    /invoice\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9/\-_.]+)/i,
    /bill\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9/\-_.]+)/i,
    /receipt\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9/\-_.]+)/i,
    /(?:^|\b)(?:no\.?|invoice\s*#|bill\s*#)\s*[:\-]?\s*([A-Z0-9/\-_.]+)/i,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match?.[1]) {
        return cleanText(match[1]).replace(/[.,;:]+$/, '');
      }
    }
  }

  return null;
}

function extractVendorName(lines: string[]): string | null {
  const stopWords = [
    'invoice',
    'bill',
    'receipt',
    'tax invoice',
    'gst',
    'tin',
    'date',
    'customer',
    'copy',
    'original',
  ];

  for (const line of lines.slice(0, 8)) {
    const normalized = line.toLowerCase();
    const hasDigits = /\d/.test(line);
    const isStopLine = stopWords.some((word) => normalized.includes(word));

    if (!hasDigits && !isStopLine && line.length > 2) {
      return cleanText(line);
    }
  }

  return lines[0] ? cleanText(lines[0]) : null;
}

function extractGstNumber(text: string): string | null {
  const match = text.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z0-9]Z[A-Z0-9]\b/);
  return match?.[0] || null;
}

function extractTinNumber(text: string): string | null {
  const tinKeywordMatch = text.match(/TIN(?:\s*NO\.?|\s*#|\s*:)?\s*(\d{11})/i);
  if (tinKeywordMatch?.[1]) {
    return tinKeywordMatch[1];
  }

  return null;
}

function extractPaymentMethod(text: string): string | null {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('upi')) return 'upi';
  if (lowerText.includes('card') || lowerText.includes('debit') || lowerText.includes('credit')) return 'card';
  if (lowerText.includes('cash')) return 'cash';
  if (lowerText.includes('bank transfer') || lowerText.includes('neft') || lowerText.includes('rtgs') || lowerText.includes('imps')) return 'bank transfer';
  return null;
}

function extractAmountForKeywords(lines: string[], keywords: RegExp[]): number | null {
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (!keywords.some((pattern) => pattern.test(lowerLine))) {
      continue;
    }

    const amountMatches = [...line.matchAll(/(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi)];
    if (amountMatches.length > 0) {
      for (let index = amountMatches.length - 1; index >= 0; index -= 1) {
        const parsed = parseAmount(amountMatches[index][1]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }
  }

  return null;
}

function extractTaxAmount(lines: string[]): number | null {
  let totalTax = 0;
  let foundTax = false;

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (!/(cgst|sgst|igst|gst\s*amount|tax\s*amount|tax)/i.test(lowerLine)) {
      continue;
    }

    const amountMatches = [...line.matchAll(/(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi)];
    if (amountMatches.length > 0) {
      const parsed = parseAmount(amountMatches[amountMatches.length - 1][1]);
      if (parsed !== null) {
        totalTax += parsed;
        foundTax = true;
      }
    }
  }

  return foundTax ? totalTax : null;
}

function extractSubtotal(lines: string[]): number | null {
  return extractAmountForKeywords(lines, [/subtotal/i, /sub\s*total/i, /taxable\s*amount/i]);
}

function extractTotalAmount(lines: string[]): number | null {
  return extractAmountForKeywords(lines, [
    /grand\s*total/i,
    /net\s*total/i,
    /amount\s*due/i,
    /balance\s*due/i,
    /total\s*payable/i,
    /invoice\s*total/i,
    /bill\s*total/i,
    /^total$/i,
    /\btotal\b/i,
  ]);
}

function extractItems(lines: string[]): Array<{ item_description: string; quantity: number; unit_price: number; tax_rate: number; amount: number }> {
  const items: Array<{ item_description: string; quantity: number; unit_price: number; tax_rate: number; amount: number }> = [];

  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (
      /(subtotal|grand total|net total|amount due|balance due|total payable|invoice total|bill total|cgst|sgst|igst|gst|tax|invoice no|bill no|receipt no|date|thank you|terms|round off)/i.test(lowerLine)
    ) {
      continue;
    }

    const numbers = [...line.matchAll(/(?:₹|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi)]
      .map((match) => parseAmount(match[1]))
      .filter((value): value is number => value !== null);

    if (numbers.length < 2) {
      continue;
    }

    const description = cleanText(
      line.replace(/(?:₹|rs\.?|inr)?\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?/gi, ' ').replace(/\s+/g, ' '),
    );

    if (!description || description.length < 2) {
      continue;
    }

    const amount = numbers[numbers.length - 1];
    const unitPrice = numbers.length >= 3 ? numbers[1] : amount;
    const quantity = numbers.length >= 3 ? numbers[0] : 1;

    items.push({
      item_description: description,
      quantity,
      unit_price: unitPrice,
      tax_rate: 0,
      amount,
    });

    if (items.length >= 20) {
      break;
    }
  }

  return items;
}

function parseBillFromOcrText(ocrText: string) {
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);

  const billNumber = extractBillNumber(lines);
  const vendorName = extractVendorName(lines);
  const billDate = extractDateFromText(ocrText);
  const vendorGst = extractGstNumber(ocrText);
  const vendorTin = extractTinNumber(ocrText);
  const subtotal = extractSubtotal(lines);
  const taxAmount = extractTaxAmount(lines);
  const totalAmount = extractTotalAmount(lines) ?? taxAmount ?? subtotal ?? null;
  const paymentMethod = extractPaymentMethod(ocrText);
  const items = extractItems(lines);

  return {
    bill_number: billNumber,
    vendor_name: vendorName,
    vendor_gst: vendorGst,
    vendor_tin: vendorTin,
    bill_date: billDate,
    subtotal: subtotal ?? 0,
    tax_amount: taxAmount ?? 0,
    total_amount: totalAmount ?? 0,
    currency: 'INR',
    payment_method: paymentMethod,
    items,
    notes: null,
    confidence: items.length > 0 ? 80 : 70,
    handwriting_detected: /handwritten|hand writing|written by hand/i.test(ocrText),
    extraction_notes: 'Extracted from Google Vision OCR text.',
  };
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
    const visionApiKey = Deno.env.get('GOOGLE_VISION_API_KEY') || Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('VISION_API_KEY');

    console.log('Environment check:', {
      hasSupabaseUrl: !!supabaseUrl,
      hasSupabaseKey: !!supabaseKey,
      hasVisionApiKey: !!visionApiKey,
    });

    if (!visionApiKey) {
      throw new Error('GOOGLE_VISION_API_KEY is not configured');
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

    console.log('Image encoded, base64 length:', base64.length, 'characters');
    console.log('Running extraction with Google Vision OCR...');

    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64 },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
            },
          ],
        }),
      },
    );

    console.log('Google Vision response status:', visionResponse.status, visionResponse.statusText);

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('Google Vision error response:', errorText);

      if (visionResponse.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      throw new Error(`Google Vision returned ${visionResponse.status}: ${errorText}`);
    }

    const visionData = await visionResponse.json();
    const visionError = visionData.responses?.[0]?.error;
    if (visionError) {
      throw new Error(`Google Vision error: ${visionError.message || 'Unknown Vision API error'}`);
    }

    const ocrText = visionData.responses?.[0]?.fullTextAnnotation?.text || visionData.responses?.[0]?.textAnnotations?.[0]?.description || '';

    if (!ocrText) {
      throw new Error('Google Vision did not return readable text for this bill');
    }

    console.log('Google Vision OCR text length:', ocrText.length);
    const extracted = parseBillFromOcrText(ocrText);

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