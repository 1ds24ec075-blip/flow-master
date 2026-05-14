import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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
    /tax\s*invoice\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\/\-_.]+)/i,
    /invoice\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\/\-_.]+)/i,
    /bill\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\/\-_.]+)/i,
    /receipt\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z0-9\/\-_.]+)/i,
    /(?:^|\b)(?:no\.?|invoice\s*#|bill\s*#)\s*[:\-]?\s*([A-Z0-9\/\-_.]+)/i,
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
  const paymentMethod = /upi|card|debit|credit|cash|bank transfer|neft|rtgs|imps/i.test(ocrText) ? (ocrText.match(/upi|card|debit|credit|cash|bank transfer|neft|rtgs|imps/i)?.[0] || null) : null;
  const items = extractItems(lines);

  return {
    invoice_number: billNumber,
    vendor_name: vendorName,
    vendor_gst: vendorGst,
    vendor_tin: vendorTin,
    invoice_date: billDate,
    subtotal: subtotal ?? 0,
    tax_amount: taxAmount ?? 0,
    amount: totalAmount ?? 0,
    currency: 'INR',
    payment_method: paymentMethod,
    items,
    confidence: items.length > 0 ? 80 : 70,
    extraction_notes: 'Extracted from Google Vision OCR text.',
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filePath } = await req.json();
    if (!filePath) throw new Error('filePath is required');

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const visionApiKey = Deno.env.get('GOOGLE_VISION_API_KEY') || Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('VISION_API_KEY');

    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials missing');
    if (!visionApiKey) throw new Error('GOOGLE_VISION_API_KEY is not configured');

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

    console.log('Running Google Vision OCR extraction for supplier invoice...');

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

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('Google Vision error response:', errorText);
      if (visionResponse.status === 429) throw new Error('Rate limit exceeded. Please try again later.');
      throw new Error(`Google Vision returned ${visionResponse.status}: ${errorText}`);
    }

    const visionData = await visionResponse.json();
    const visionError = visionData.responses?.[0]?.error;
    if (visionError) {
      throw new Error(`Google Vision error: ${visionError.message || 'Unknown Vision API error'}`);
    }

    const ocrText = visionData.responses?.[0]?.fullTextAnnotation?.text || visionData.responses?.[0]?.textAnnotations?.[0]?.description || '';

    if (!ocrText) {
      throw new Error('Google Vision did not return readable text for this invoice');
    }

    const extracted = parseBillFromOcrText(ocrText);

    console.log('Extraction complete:', {
      invoice_number: extracted.invoice_number,
      amount: extracted.amount,
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
