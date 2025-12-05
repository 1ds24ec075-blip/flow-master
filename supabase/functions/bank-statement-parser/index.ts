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

interface Expense {
  amount: number;
  name: string;
}

interface Match {
  expense_name: string;
  amount: number;
  matched_with: Transaction | null;
}

function matchTransactions(transactions: Transaction[], expenses: Expense[]): Match[] {
  const matches: Match[] = [];

  for (const expense of expenses) {
    let matchedTransaction: Transaction | null = null;

    for (const transaction of transactions) {
      const amountMatch = Math.abs(transaction.amount - expense.amount) < 0.01;
      const descriptionMatch = transaction.description
        .toLowerCase()
        .includes(expense.name.toLowerCase());

      if (amountMatch || descriptionMatch) {
        matchedTransaction = transaction;
        break;
      }
    }

    matches.push({
      expense_name: expense.name,
      amount: expense.amount,
      matched_with: matchedTransaction,
    });
  }

  return matches;
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

    const { statementText, expenses, fileName } = await req.json();

    if (!statementText || typeof statementText !== 'string') {
      return new Response(
        JSON.stringify({ error: 'statementText is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key is not configured');
    }

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
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: EXTRACTION_PROMPT },
            { role: 'user', content: statementText },
          ],
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

      for (const transaction of transactions) {
        await supabase.from('bank_transactions').insert({
          statement_id: statement.id,
          transaction_date: transaction.date,
          description: transaction.description,
          amount: transaction.amount,
          transaction_type: transaction.type,
        });
      }

      let matches: Match[] = [];
      if (expenses && Array.isArray(expenses) && expenses.length > 0) {
        matches = matchTransactions(transactions, expenses);

        for (const match of matches) {
          if (match.matched_with) {
            const { data: transactionRecord } = await supabase
              .from('bank_transactions')
              .select('id')
              .eq('statement_id', statement.id)
              .eq('transaction_date', match.matched_with.date)
              .eq('amount', match.matched_with.amount)
              .maybeSingle();

            if (transactionRecord) {
              await supabase.from('expense_matches').insert({
                transaction_id: transactionRecord.id,
                expense_name: match.expense_name,
                matched_amount: match.amount,
              });
            }
          }
        }
      }

      const responseData = {
        transactions,
        matches,
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