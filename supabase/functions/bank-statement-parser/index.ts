import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

const EXTRACTION_PROMPT = `You are a strict bank statement parser. Extract ONLY the transactions from the provided bank statement text.

RULES (CRITICAL - FOLLOW EXACTLY):
1. Do NOT hallucinate or make up transactions
2. If a field is missing, use null - NEVER guess
3. Amount must be numeric only (no currency symbols)
4. Keep each transaction separate - do not merge lines
5. Date format: YYYY-MM-DD
6. Type must be either "credit" or "debit"
7. Return ONLY valid JSON - no extra text

OUTPUT FORMAT:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "transaction description",
      "amount": 0,
      "type": "credit | debit"
    }
  ]
}

Extract the transactions now:`;

interface Transaction {
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
}

interface Bill {
  id: string;
  vendor_name: string;
  total_amount: number;
  bill_date: string;
  bill_number: string | null;
  payment_status: string;
}

interface VerificationResult {
  bill_id: string;
  bill_vendor: string;
  bill_amount: number;
  bill_date: string;
  bill_number: string | null;
  matched: boolean;
  matched_transaction: Transaction | null;
  match_confidence: 'high' | 'medium' | 'low' | null;
  match_reason: string | null;
}

// Fuzzy string matching - Levenshtein distance based similarity
function stringSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  
  // Check word overlap
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const commonWords = words1.filter(w => words2.some(w2 => w2.includes(w) || w.includes(w2)));
  
  if (commonWords.length > 0) {
    return 0.5 + (commonWords.length / Math.max(words1.length, words2.length)) * 0.3;
  }
  
  return 0;
}

// Check date proximity (within N days)
function datesWithinDays(date1: string, date2: string, days: number): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

// Match bills with transactions
function matchBillsWithTransactions(
  bills: Bill[],
  transactions: Transaction[]
): VerificationResult[] {
  const results: VerificationResult[] = [];
  const usedTransactions = new Set<number>();

  for (const bill of bills) {
    let bestMatch: { transaction: Transaction; index: number; confidence: 'high' | 'medium' | 'low'; reason: string } | null = null;
    let bestScore = 0;

    for (let i = 0; i < transactions.length; i++) {
      if (usedTransactions.has(i)) continue;
      
      const transaction = transactions[i];
      
      // Only match with debit transactions (money going out for bills)
      if (transaction.type !== 'debit') continue;
      
      let score = 0;
      let matchReasons: string[] = [];

      // Amount matching (with ±1 tolerance for rounding)
      const amountDiff = Math.abs(transaction.amount - bill.total_amount);
      if (amountDiff < 0.01) {
        score += 50;
        matchReasons.push('Exact amount match');
      } else if (amountDiff <= 1) {
        score += 40;
        matchReasons.push('Amount match (±1)');
      } else if (amountDiff <= bill.total_amount * 0.01) {
        score += 30;
        matchReasons.push('Amount within 1%');
      }

      // Vendor name similarity
      const nameSimilarity = stringSimilarity(bill.vendor_name, transaction.description);
      if (nameSimilarity >= 0.8) {
        score += 30;
        matchReasons.push('Vendor name match');
      } else if (nameSimilarity >= 0.5) {
        score += 15;
        matchReasons.push('Partial vendor match');
      }

      // Date proximity (bill date should be close to transaction date)
      if (bill.bill_date && transaction.date) {
        if (datesWithinDays(bill.bill_date, transaction.date, 3)) {
          score += 20;
          matchReasons.push('Date within 3 days');
        } else if (datesWithinDays(bill.bill_date, transaction.date, 7)) {
          score += 10;
          matchReasons.push('Date within 7 days');
        }
      }

      // Update best match if this is better
      if (score > bestScore && score >= 40) { // Minimum threshold
        bestScore = score;
        const confidence = score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low';
        bestMatch = {
          transaction,
          index: i,
          confidence,
          reason: matchReasons.join(', ')
        };
      }
    }

    if (bestMatch) {
      usedTransactions.add(bestMatch.index);
      results.push({
        bill_id: bill.id,
        bill_vendor: bill.vendor_name,
        bill_amount: bill.total_amount,
        bill_date: bill.bill_date,
        bill_number: bill.bill_number,
        matched: true,
        matched_transaction: bestMatch.transaction,
        match_confidence: bestMatch.confidence,
        match_reason: bestMatch.reason
      });
    } else {
      results.push({
        bill_id: bill.id,
        bill_vendor: bill.vendor_name,
        bill_amount: bill.total_amount,
        bill_date: bill.bill_date,
        bill_number: bill.bill_number,
        matched: false,
        matched_transaction: null,
        match_confidence: null,
        match_reason: null
      });
    }
  }

  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { statementText, pdfBase64, fileName, month } = await req.json();

    if (!statementText && !pdfBase64) {
      return new Response(
        JSON.stringify({ error: 'statementText or pdfBase64 is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key is not configured');
    }

    console.log('Processing bank statement for month:', month);

    // Fetch bills for the selected month
    let billsQuery = supabase
      .from('bills')
      .select('id, vendor_name, total_amount, bill_date, bill_number, payment_status')
      .eq('bank_verified', false);

    if (month) {
      const startDate = new Date(month);
      const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
      billsQuery = billsQuery
        .gte('bill_date', startDate.toISOString().split('T')[0])
        .lte('bill_date', endDate.toISOString().split('T')[0]);
    }

    const { data: bills, error: billsError } = await billsQuery;

    if (billsError) {
      console.error('Error fetching bills:', billsError);
      throw new Error('Failed to fetch bills from database');
    }

    console.log(`Found ${bills?.length || 0} unverified bills for the period`);

    // Create statement record
    const { data: statement, error: statementError } = await supabase
      .from('bank_statements')
      .insert({
        file_name: fileName || 'uploaded_statement.txt',
        status: 'processing',
      })
      .select()
      .single();

    if (statementError) throw statementError;

    try {
      let messages: any[];

      if (pdfBase64) {
        console.log('Processing PDF with vision model');
        messages = [
          { role: 'system', content: EXTRACTION_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extract all transactions from this bank statement PDF. Follow the extraction rules strictly.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: pdfBase64,
                },
              },
            ],
          },
        ];
      } else {
        messages = [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: statementText },
        ];
      }

      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      });

      if (!openaiResponse.ok) {
        const error = await openaiResponse.text();
        console.error('OpenAI API error:', error);
        throw new Error('Failed to parse bank statement');
      }

      const openaiData = await openaiResponse.json();
      const parsedContent = openaiData.choices[0].message.content;
      const extractedData = JSON.parse(parsedContent);

      if (!extractedData.transactions || !Array.isArray(extractedData.transactions)) {
        throw new Error('Invalid extraction format');
      }

      const transactions: Transaction[] = extractedData.transactions;
      console.log(`Extracted ${transactions.length} transactions from statement`);

      // Store transactions in database
      for (const transaction of transactions) {
        await supabase.from('bank_transactions').insert({
          statement_id: statement.id,
          transaction_date: transaction.date,
          description: transaction.description,
          amount: transaction.amount,
          transaction_type: transaction.type,
        });
      }

      // Match bills with transactions
      const verificationResults = matchBillsWithTransactions(bills || [], transactions);
      
      // Update matched bills in database
      const matchedResults = verificationResults.filter(r => r.matched);
      console.log(`Matched ${matchedResults.length} bills with transactions`);

      for (const result of matchedResults) {
        // Get the transaction ID from the database
        const { data: txRecord } = await supabase
          .from('bank_transactions')
          .select('id')
          .eq('statement_id', statement.id)
          .eq('transaction_date', result.matched_transaction?.date)
          .eq('amount', result.matched_transaction?.amount)
          .maybeSingle();

        if (txRecord) {
          await supabase
            .from('bills')
            .update({
              bank_verified: true,
              bank_transaction_id: txRecord.id,
              verified_date: new Date().toISOString(),
            })
            .eq('id', result.bill_id);
        }
      }

      const responseData = {
        transactions,
        verification_results: verificationResults,
        summary: {
          total_transactions: transactions.length,
          total_bills: bills?.length || 0,
          matched_bills: matchedResults.length,
          unmatched_bills: verificationResults.filter(r => !r.matched).length,
          high_confidence_matches: matchedResults.filter(r => r.match_confidence === 'high').length,
          medium_confidence_matches: matchedResults.filter(r => r.match_confidence === 'medium').length,
          low_confidence_matches: matchedResults.filter(r => r.match_confidence === 'low').length,
        }
      };

      await supabase
        .from('bank_statements')
        .update({
          status: 'completed',
          parsed_data: responseData,
          processed_at: new Date().toISOString(),
        })
        .eq('id', statement.id);

      return new Response(JSON.stringify(responseData), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (processingError) {
      await supabase
        .from('bank_statements')
        .update({
          status: 'failed',
          error_message: processingError instanceof Error ? processingError.message : 'Unknown error',
          processed_at: new Date().toISOString(),
        })
        .eq('id', statement.id);

      throw processingError;
    }
  } catch (error) {
    console.error('Error in bank-statement-parser:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
