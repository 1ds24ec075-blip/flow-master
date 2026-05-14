import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function parseAmount(value: string): number | null {
  const normalized = value.replace(/[^0-9,.-]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOcrDate(rawValue: string): string | null {
  const match = rawValue.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!match) return null;
  let day = Number(match[1]);
  let month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += year >= 50 ? 1900 : 2000;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year) return null;
  return parsed.toISOString().slice(0, 10);
}

function extractTransactionsFromText(ocrText: string): ParsedTransaction[] {
  const lines = ocrText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const transactions: ParsedTransaction[] = [];

  for (const line of lines) {
    // Try to find a date in the line
    const dateMatch = line.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/);
    if (!dateMatch) continue;
    const date = parseOcrDate(dateMatch[1]);
    if (!date) continue;

    // Try to find amounts (two possibilities: debit/credit columns or single amount with DR/CR)
    const amountMatches = [...line.matchAll(/(?:-|\b)([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\b/g)];
    if (amountMatches.length === 0) continue;

    // Use the last numeric value as transaction amount
    const rawAmount = amountMatches[amountMatches.length - 1][1];
    const amount = parseAmount(rawAmount);
    if (amount === null) continue;

    // Determine type: look for DR/CR or credit keywords
    const lower = line.toLowerCase();
    let txType: 'debit' | 'credit' = 'debit';
    if (/\b(cr|credit|deposit|cr\b)/i.test(line) && !/\b(dr|debit|withdrawal|dr\b)/i.test(line)) {
      txType = 'credit';
    } else if (/\b(dr|debit|withdrawal|debited)\b/i.test(line)) {
      txType = 'debit';
    } else if (/cr\b/i.test(line) && !/dr\b/i.test(line)) {
      txType = 'credit';
    }

    // Narration is the line with date and amount removed
    const narration = line.replace(dateMatch[1], '').replace(rawAmount, '').replace(/\b(dr|cr|debit|credit|debited|credited)\b/ig, '').replace(/\s+/g, ' ').trim();

    transactions.push({
      transaction_date: date,
      narration: narration || line,
      amount: Math.abs(amount),
      transaction_type: txType,
    });
  }

  return transactions;
}

interface ParsedTransaction {
  transaction_date: string;
  narration: string;
  amount: number;
  transaction_type: 'debit' | 'credit';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdfBase64, password } = await req.json();

    if (!pdfBase64) {
      return new Response(JSON.stringify({ 
        error: 'No PDF data provided',
        code: 'NO_PDF_DATA'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Processing PDF bank statement...');
    console.log('Password provided:', password ? 'Yes' : 'No');

    // Check if PDF is encrypted by looking at the header
    const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
    const pdfHeader = new TextDecoder().decode(pdfBytes.slice(0, 2048));
    const isEncrypted = pdfHeader.includes('/Encrypt');
    
    console.log('PDF appears encrypted:', isEncrypted);

    // If PDF is encrypted, we cannot process it directly with Gemini
    // Gemini Vision API cannot decrypt password-protected PDFs
    if (isEncrypted) {
      console.log('Encrypted PDF detected - cannot process directly');
      return new Response(JSON.stringify({ 
        error: password 
          ? 'Password-protected PDFs cannot be processed directly. Please convert your PDF to Excel/CSV format first, or use your bank\'s online portal to download an unprotected statement.'
          : 'This PDF is password-protected. Unfortunately, we cannot decrypt PDFs server-side. Please download an unprotected version from your bank\'s portal, or export the statement as Excel/CSV.',
        code: 'PDF_ENCRYPTED',
        isPasswordProtected: true,
        suggestion: 'Most banks offer Excel/CSV download options in their online banking portals. This format works better for transaction extraction.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const visionApiKey = Deno.env.get('GOOGLE_VISION_API_KEY') || Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('VISION_API_KEY');

    if (!visionApiKey) {
      return new Response(JSON.stringify({ 
        error: 'Vision API not configured',
        code: 'VISION_NOT_CONFIGURED'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send PDF to Google Vision for OCR
    console.log('Sending PDF to Google Vision for OCR...');
    const visionResponse = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: pdfBase64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }]
          }
        ]
      })
    });

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text();
      console.error('Google Vision error response:', errorText);
      if (visionResponse.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.', code: 'RATE_LIMITED' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: `Vision API error: ${visionResponse.status}`, code: 'VISION_ERROR' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const visionData = await visionResponse.json();
    const ocrText = visionData.responses?.[0]?.fullTextAnnotation?.text || visionData.responses?.[0]?.textAnnotations?.[0]?.description || '';

    if (!ocrText) {
      return new Response(JSON.stringify({ error: 'Unable to extract text from PDF', code: 'NO_OCR_TEXT' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('OCR text length:', ocrText.length);

    let transactions = extractTransactionsFromText(ocrText);

    // Filter and normalize
    const validTransactions = transactions
      .filter((tx) => tx.narration && tx.amount > 0)
      .map((tx) => ({
        transaction_date: tx.transaction_date || '',
        narration: String(tx.narration).trim(),
        amount: Math.abs(Number(tx.amount) || 0),
        transaction_type: tx.transaction_type === 'credit' ? 'credit' : 'debit'
      }));

    console.log(`Extracted ${validTransactions.length} valid transactions from OCR`);

    return new Response(JSON.stringify({ success: true, transactions: validTransactions, message: `Successfully extracted ${validTransactions.length} transactions` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Parse PDF statement error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Failed to process PDF',
      code: 'PROCESSING_ERROR'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
