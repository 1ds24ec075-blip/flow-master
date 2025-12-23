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

    // Use AI Vision to extract transactions from PDF directly
    // Gemini can handle password-protected PDFs by analyzing the visual content
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

    // First, try to check if PDF is encrypted by looking at the header
    const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
    const pdfHeader = new TextDecoder().decode(pdfBytes.slice(0, 1024));
    const isEncrypted = pdfHeader.includes('/Encrypt');
    
    console.log('PDF appears encrypted:', isEncrypted);

    // Use Gemini to extract transaction data from PDF
    // Note: If PDF is encrypted and we can't decrypt it, we need to inform the user
    const extractionPrompt = `You are a bank statement parser. Analyze this bank statement PDF and extract all transactions.

${password ? `The PDF password is: ${password}` : ''}

For each transaction, extract:
1. Date (in YYYY-MM-DD format if possible, otherwise keep original format)
2. Description/Narration (the transaction description)
3. Amount (numeric value only, no currency symbols)
4. Type: "debit" for withdrawals/expenses OR "credit" for deposits/income

Return ONLY a valid JSON object with this structure:
{
  "success": true,
  "transactions": [
    {
      "transaction_date": "2024-01-15",
      "narration": "NEFT-ABCD CORP-Ref123",
      "amount": 15000.00,
      "transaction_type": "credit"
    }
  ],
  "error": null
}

If you cannot read the PDF content (blank pages, encrypted content you can't access):
{
  "success": false,
  "transactions": [],
  "error": "PDF content is encrypted or unreadable"
}

Important rules:
- Extract ALL transactions visible in the statement
- For amounts with Dr/Cr suffix: Dr = debit, Cr = credit
- If debit and credit are in separate columns, use the column with value
- Skip header rows, summary rows, and balance rows
- Only include actual transactions
- Return empty transactions array if no transactions found

Return ONLY the JSON object, no explanations.`;

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
      
      throw new Error(`AI service error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || '{}';
    
    console.log('AI response received, parsing transactions...');
    console.log('Raw response length:', content.length);

    // Extract JSON from response
    let result: { success: boolean; transactions: ParsedTransaction[]; error: string | null } = {
      success: false,
      transactions: [],
      error: null
    };

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        // Try to parse as array for backward compatibility
        const arrayMatch = content.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          result = {
            success: true,
            transactions: JSON.parse(arrayMatch[0]),
            error: null
          };
        }
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.log('Raw AI response:', content.substring(0, 500));
    }

    // Check if AI reported an error (likely encrypted PDF it couldn't read)
    if (!result.success && result.error) {
      console.log('AI reported error:', result.error);
      
      // If encrypted and no password provided, ask for password
      if (isEncrypted && !password) {
        return new Response(JSON.stringify({ 
          error: 'This PDF is password-protected. Please enter the password.',
          code: 'PASSWORD_REQUIRED',
          isPasswordProtected: true
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // If password was provided but still can't read
      if (password) {
        return new Response(JSON.stringify({ 
          error: 'Incorrect password or unable to decrypt PDF. Please verify the password.',
          code: 'PASSWORD_INCORRECT',
          isPasswordProtected: true
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Validate and clean transactions
    const validTransactions = (result.transactions || [])
      .filter((tx: ParsedTransaction) => tx.narration && tx.amount > 0)
      .map((tx: ParsedTransaction) => ({
        transaction_date: tx.transaction_date || '',
        narration: String(tx.narration).trim(),
        amount: Math.abs(Number(tx.amount) || 0),
        transaction_type: tx.transaction_type === 'credit' ? 'credit' : 'debit' as 'debit' | 'credit'
      }));

    console.log(`Extracted ${validTransactions.length} valid transactions from PDF`);

    // If no transactions found and PDF appears encrypted
    if (validTransactions.length === 0 && isEncrypted) {
      return new Response(JSON.stringify({ 
        error: password 
          ? 'Could not extract transactions. The password may be incorrect or the PDF format is not supported.'
          : 'This PDF appears to be password-protected. Please enter the password.',
        code: 'PASSWORD_REQUIRED',
        isPasswordProtected: true
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
