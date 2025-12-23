import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    // Use AI Vision to extract transactions from PDF
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ 
        error: 'AI service not configured',
        code: 'AI_NOT_CONFIGURED'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use Gemini to extract transaction data from PDF
    const extractionPrompt = `You are a bank statement parser. Analyze this bank statement PDF and extract all transactions.

For each transaction, extract:
1. Date (in YYYY-MM-DD format if possible, otherwise keep original format)
2. Description/Narration (the transaction description)
3. Amount (numeric value only, no currency symbols)
4. Type: "debit" for withdrawals/expenses OR "credit" for deposits/income

Return ONLY a valid JSON array with this exact structure:
[
  {
    "transaction_date": "2024-01-15",
    "narration": "NEFT-ABCD CORP-Ref123",
    "amount": 15000.00,
    "transaction_type": "credit"
  }
]

Important rules:
- Extract ALL transactions visible in the statement
- For amounts with Dr/Cr suffix: Dr = debit, Cr = credit
- If debit and credit are in separate columns, use the column with value
- Skip header rows, summary rows, and balance rows
- Only include actual transactions
- Return empty array [] if no transactions found

Return ONLY the JSON array, no explanations.`;

    console.log('Sending PDF to AI for extraction...');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { 
            role: 'user', 
            content: [
              { type: 'text', text: extractionPrompt },
              { 
                type: 'image_url', 
                image_url: { 
                  url: `data:application/pdf;base64,${pdfBase64}` 
                } 
              }
            ]
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ 
          error: 'Rate limit exceeded. Please try again in a moment.',
          code: 'RATE_LIMITED'
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ 
          error: 'AI credits exhausted. Please add credits.',
          code: 'PAYMENT_REQUIRED'
        }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Check if error is about encrypted/unreadable PDF
      if (errorText.includes('no pages') || errorText.includes('encrypted') || errorText.includes('password')) {
        return new Response(JSON.stringify({ 
          error: 'Cannot read this PDF. It may be encrypted or corrupted. Please try downloading an unprotected version or Excel/CSV format from your bank.',
          code: 'PDF_UNREADABLE',
          isPasswordProtected: true
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`AI service error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || '[]';
    
    console.log('AI response received, parsing transactions...');
    console.log('Raw response length:', content.length);

    // Extract JSON from response
    let transactions: ParsedTransaction[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        transactions = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.log('Raw AI response:', content.substring(0, 500));
    }

    // Validate and clean transactions
    const validTransactions = transactions
      .filter((tx: ParsedTransaction) => tx.narration && tx.amount > 0)
      .map((tx: ParsedTransaction) => ({
        transaction_date: tx.transaction_date || '',
        narration: String(tx.narration).trim(),
        amount: Math.abs(Number(tx.amount) || 0),
        transaction_type: tx.transaction_type === 'credit' ? 'credit' : 'debit' as 'debit' | 'credit'
      }));

    console.log(`Extracted ${validTransactions.length} valid transactions from PDF`);

    return new Response(JSON.stringify({
      success: true,
      transactions: validTransactions,
      message: `Successfully extracted ${validTransactions.length} transactions`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

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
