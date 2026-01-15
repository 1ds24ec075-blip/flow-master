import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CATEGORIES = [
  'Business Expense',
  'Business Income',
  'Transfers',
  'Personal / Owner',
  'Unknown'
];

interface RawTransaction {
  transaction_date?: string;
  narration?: string;
  amount?: number | string;
  transaction_type?: 'debit' | 'credit' | string;
  reference_number?: string;
  utr?: string;
  cheque_no?: string;
}

interface Transaction {
  transaction_date: string;
  narration: string;
  amount: number;
  transaction_type: 'debit' | 'credit';
  reference_number?: string;
}

interface ClassifiedTransaction extends Transaction {
  category: string;
  confidence: number;
}

interface ValidationResult {
  isValid: boolean;
  reason?: string;
}

// ========== STRICT TRANSACTION VALIDATION ==========

// Check if a value is masked (e.g., ****, XXXXXXXX, ####)
const isMaskedValue = (value: string): boolean => {
  if (!value) return false;
  const str = value.trim();
  // Check for common mask patterns
  if (/^[\*]+$/.test(str)) return true; // All asterisks
  if (/^[X]+$/i.test(str)) return true; // All X's
  if (/^[#]+$/.test(str)) return true; // All hashes
  if (/^\*{2,}.*\*{2,}$/.test(str)) return true; // Surrounded by asterisks
  if (/^X{4,}/i.test(str)) return true; // Starts with 4+ X's
  return false;
};

// Check if a value looks like a summary/footer/separator row
const isSummaryRow = (narration: string): boolean => {
  if (!narration) return false;
  const lower = narration.toLowerCase().trim();
  
  const summaryPatterns = [
    'total', 'grand total', 'sub total', 'subtotal',
    'opening balance', 'closing balance', 'balance b/f', 'balance c/f',
    'statement from', 'statement period', 'account no', 'account number',
    'ifsc', 'branch', 'customer id', 'cif no',
    '---', '===', '***', '###',
    'page', 'continued', 'end of statement'
  ];
  
  for (const pattern of summaryPatterns) {
    if (lower.includes(pattern)) return true;
  }
  
  // Check if it's just numbers or symbols (separator rows)
  if (/^[\s\-\=\*\#\.\,]+$/.test(narration)) return true;
  
  return false;
};

// Check if date is valid
const isValidDate = (dateStr: string | undefined | null): boolean => {
  if (!dateStr) return false;
  const str = String(dateStr).trim();
  if (!str) return false;
  if (isMaskedValue(str)) return false;
  
  // Check for common date patterns
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return true;
  // DD/MM/YY or DD-MM-YY
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2}$/.test(str)) return true;
  // DD/MM/YYYY or DD-MM-YYYY
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(str)) return true;
  
  // Try native parsing
  try {
    const parsed = new Date(str);
    return !isNaN(parsed.getTime());
  } catch {
    return false;
  }
};

// Check if amount is valid numeric
const isValidAmount = (amount: number | string | undefined | null): boolean => {
  if (amount === undefined || amount === null) return false;
  const num = typeof amount === 'string' ? parseFloat(amount.replace(/[,\s]/g, '')) : amount;
  return !isNaN(num) && isFinite(num) && num !== 0;
};

// Check if narration is valid (non-empty, non-masked)
const isValidNarration = (narration: string | undefined | null): boolean => {
  if (!narration) return false;
  const str = String(narration).trim();
  if (!str || str.length < 3) return false;
  if (isMaskedValue(str)) return false;
  if (isSummaryRow(str)) return false;
  return true;
};

// Check if transaction type is valid
const isValidTransactionType = (type: string | undefined | null): boolean => {
  if (!type) return false;
  const lower = String(type).toLowerCase().trim();
  return ['debit', 'credit', 'dr', 'cr', 'd', 'c'].includes(lower);
};

// Normalize transaction type to debit/credit
const normalizeTransactionType = (type: string): 'debit' | 'credit' => {
  const lower = String(type).toLowerCase().trim();
  if (['credit', 'cr', 'c'].includes(lower)) return 'credit';
  return 'debit';
};

// Count valid identifiers (reference, UTR, cheque no)
const countValidIdentifiers = (tx: RawTransaction): number => {
  let count = 0;
  
  const checkIdentifier = (value: string | undefined | null): boolean => {
    if (!value) return false;
    const str = String(value).trim();
    if (!str || str.length < 3) return false;
    if (isMaskedValue(str)) return false;
    return true;
  };
  
  if (checkIdentifier(tx.reference_number)) count++;
  if (checkIdentifier(tx.utr)) count++;
  if (checkIdentifier(tx.cheque_no)) count++;
  
  return count;
};

// Main validation function
const validateTransaction = (tx: RawTransaction): ValidationResult => {
  // Check mandatory: Transaction Date
  if (!isValidDate(tx.transaction_date)) {
    return { isValid: false, reason: 'Missing or invalid date' };
  }
  
  // Check mandatory: Narration/Party Name
  if (!isValidNarration(tx.narration)) {
    return { isValid: false, reason: 'Missing or invalid narration' };
  }
  
  // Check mandatory: Amount
  if (!isValidAmount(tx.amount)) {
    return { isValid: false, reason: 'Missing or invalid amount' };
  }
  
  // Check mandatory: Debit/Credit indicator
  if (!isValidTransactionType(tx.transaction_type)) {
    return { isValid: false, reason: 'Missing debit/credit indicator' };
  }
  
  // Check: At least 2 of 3 identifiers required (Reference, UTR, Cheque No)
  // Note: Some banks only provide 1 identifier, so we'll require at least 1
  const identifierCount = countValidIdentifiers(tx);
  if (identifierCount < 1) {
    // If no identifiers at all, try to extract from narration
    const narration = tx.narration || '';
    const hasRefInNarration = /\b[A-Z0-9]{8,20}\b/i.test(narration);
    if (!hasRefInNarration) {
      return { isValid: false, reason: 'Missing reference/UTR/cheque number' };
    }
  }
  
  return { isValid: true };
};

// ========== END VALIDATION ==========

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { transactions, businessName, accountName, fileName, uploadId } = await req.json();

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return new Response(JSON.stringify({ error: 'No transactions provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use defaults if fields are empty/null
    const effectiveBusinessName = businessName?.trim() || 'Default Business';
    
    console.log(`Received ${transactions.length} raw rows for ${effectiveBusinessName}`);

    // ========== STRICT VALIDATION - Filter valid transactions ==========
    const validTransactions: Transaction[] = [];
    const rejectedRows: { index: number; reason: string }[] = [];

    transactions.forEach((rawTx: RawTransaction, index: number) => {
      const validation = validateTransaction(rawTx);
      
      if (validation.isValid) {
        const amount = typeof rawTx.amount === 'string' 
          ? parseFloat(String(rawTx.amount).replace(/[,\s]/g, '')) 
          : (rawTx.amount || 0);
        
        validTransactions.push({
          transaction_date: String(rawTx.transaction_date).trim(),
          narration: String(rawTx.narration).trim(),
          amount: Math.abs(amount),
          transaction_type: normalizeTransactionType(rawTx.transaction_type || 'debit'),
          reference_number: rawTx.reference_number || rawTx.utr || rawTx.cheque_no || undefined
        });
      } else {
        rejectedRows.push({ index: index + 1, reason: validation.reason || 'Validation failed' });
      }
    });

    console.log(`Valid transactions: ${validTransactions.length}, Rejected: ${rejectedRows.length}`);
    if (rejectedRows.length > 0) {
      console.log('Sample rejected rows:', rejectedRows.slice(0, 5));
    }

    // If no valid transactions, return early
    if (validTransactions.length === 0) {
      // Update upload status to failed
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      
      await supabase
        .from('segregation_uploads')
        .update({ 
          status: 'failed',
          total_transactions: 0
        })
        .eq('id', uploadId);

      return new Response(JSON.stringify({ 
        error: 'No valid transactions found after validation',
        rejectedCount: rejectedRows.length,
        sampleRejections: rejectedRows.slice(0, 10)
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch existing rules for this business
    const { data: existingRules } = await supabase
      .from('segregation_rules')
      .select('pattern, category')
      .eq('business_name', effectiveBusinessName);

    const rulesMap = new Map<string, string>();
    if (existingRules) {
      existingRules.forEach(rule => {
        rulesMap.set(rule.pattern.toLowerCase(), rule.category);
      });
    }

    console.log(`Found ${rulesMap.size} existing rules for ${effectiveBusinessName}`);

    // Use AI to classify transactions
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    const classifiedTransactions: ClassifiedTransaction[] = [];

    // Process in batches of 20 for efficiency
    const batchSize = 20;
    for (let i = 0; i < validTransactions.length; i += batchSize) {
      const batch = validTransactions.slice(i, i + batchSize);
      
      // First check rules for each transaction
      const needsAI: number[] = [];
      batch.forEach((tx: Transaction, idx: number) => {
        const narrationLower = tx.narration?.toLowerCase() || '';
        let matched = false;
        
        // Check against learned rules
        for (const [pattern, category] of rulesMap) {
          if (narrationLower.includes(pattern)) {
            classifiedTransactions.push({
              ...tx,
              category,
              confidence: 95 // High confidence for learned rules
            });
            matched = true;
            break;
          }
        }
        
        if (!matched) {
          needsAI.push(i + idx);
        }
      });

      // Use AI for unmatched transactions
      if (needsAI.length > 0 && LOVABLE_API_KEY) {
        const txForAI = needsAI.map(idx => validTransactions[idx]);
        
        const prompt = `You are a financial transaction classifier for small businesses. Classify each transaction into one of these categories:
- Business Expense (rent, utilities, supplies, vendor payments, subscriptions, software)
- Business Income (customer payments, sales, refunds received)
- Transfers (bank to bank transfers, internal movements, between own accounts)
- Personal / Owner (personal expenses, owner withdrawals, salary to owner)
- Unknown (unclear transactions)

Also provide a confidence score (0-100) for each classification.

Transactions to classify:
${txForAI.map((tx: Transaction, idx: number) => `${idx + 1}. Date: ${tx.transaction_date}, Narration: "${tx.narration}", Amount: ${tx.amount}, Type: ${tx.transaction_type}`).join('\n')}

Respond with JSON array only, no explanation:
[{"index": 1, "category": "Business Expense", "confidence": 85}, ...]`;

        try {
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: 'You are a financial transaction classifier. Respond only with valid JSON arrays.' },
                { role: 'user', content: prompt }
              ],
            }),
          });

          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            const content = aiData.choices?.[0]?.message?.content || '[]';
            
            // Extract JSON from response
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              const classifications = JSON.parse(jsonMatch[0]);
              
              classifications.forEach((cls: { index: number; category: string; confidence: number }) => {
                const originalIdx = needsAI[cls.index - 1];
                const tx = validTransactions[originalIdx];
                classifiedTransactions.push({
                  ...tx,
                  category: CATEGORIES.includes(cls.category) ? cls.category : 'Unknown',
                  confidence: Math.min(100, Math.max(0, cls.confidence))
                });
              });
            }
          }
        } catch (aiError) {
          console.error('AI classification error:', aiError);
          // Fallback: classify based on simple rules
          needsAI.forEach(idx => {
            const tx = validTransactions[idx];
            classifiedTransactions.push({
              ...tx,
              category: classifyBySimpleRules(tx),
              confidence: 50
            });
          });
        }
      } else if (needsAI.length > 0) {
        // No AI available, use simple rules
        needsAI.forEach(idx => {
          const tx = validTransactions[idx];
          classifiedTransactions.push({
            ...tx,
            category: classifyBySimpleRules(tx),
            confidence: 50
          });
        });
      }
    }

    // Helper function to parse various date formats to YYYY-MM-DD
    const parseDate = (dateStr: string | null | undefined): string | null => {
      if (!dateStr) return null;
      
      const str = String(dateStr).trim();
      if (!str) return null;
      
      // Already in YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        return str;
      }
      
      // DD/MM/YY or DD-MM-YY format
      let match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
      if (match) {
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        const year = parseInt(match[3], 10);
        const fullYear = year > 50 ? 1900 + year : 2000 + year;
        return `${fullYear}-${month}-${day}`;
      }
      
      // DD/MM/YYYY or DD-MM-YYYY format
      match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (match) {
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        const year = match[3];
        return `${year}-${month}-${day}`;
      }
      
      // Try native Date parsing as fallback
      try {
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split('T')[0];
        }
      } catch {
        // ignore
      }
      
      return null;
    };

    // Store transactions in database
    const transactionsToInsert = classifiedTransactions.map(tx => ({
      upload_id: uploadId,
      transaction_date: parseDate(tx.transaction_date),
      narration: tx.narration,
      amount: Math.abs(tx.amount),
      transaction_type: tx.transaction_type,
      suggested_category: tx.category,
      confidence_score: tx.confidence
    }));

    const { error: insertError } = await supabase
      .from('segregated_transactions')
      .insert(transactionsToInsert);

    if (insertError) {
      console.error('Insert error:', insertError);
      throw insertError;
    }

    // Update upload status
    await supabase
      .from('segregation_uploads')
      .update({ 
        status: 'completed',
        total_transactions: classifiedTransactions.length
      })
      .eq('id', uploadId);

    // Calculate summary
    const summary = {
      total: classifiedTransactions.length,
      byCategory: {} as Record<string, number>,
      lowConfidence: classifiedTransactions.filter(t => t.confidence < 70).length
    };

    classifiedTransactions.forEach(tx => {
      summary.byCategory[tx.category] = (summary.byCategory[tx.category] || 0) + 1;
    });

    console.log('Classification complete:', summary);

    return new Response(JSON.stringify({
      success: true,
      summary,
      transactions: classifiedTransactions
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Smart segregation error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function classifyBySimpleRules(tx: Transaction): string {
  const narration = (tx.narration || '').toLowerCase();
  
  // Transfer patterns
  if (narration.includes('transfer') || narration.includes('neft') || 
      narration.includes('rtgs') || narration.includes('imps') ||
      narration.includes('to self') || narration.includes('from self')) {
    return 'Transfers';
  }
  
  // Personal patterns
  if (narration.includes('atm') || narration.includes('cash withdrawal') ||
      narration.includes('personal') || narration.includes('owner')) {
    return 'Personal / Owner';
  }
  
  // Income patterns (credits)
  if (tx.transaction_type === 'credit') {
    if (narration.includes('payment') || narration.includes('received') ||
        narration.includes('sale') || narration.includes('invoice')) {
      return 'Business Income';
    }
  }
  
  // Expense patterns (debits)
  if (tx.transaction_type === 'debit') {
    if (narration.includes('bill') || narration.includes('rent') ||
        narration.includes('utility') || narration.includes('vendor') ||
        narration.includes('purchase') || narration.includes('subscription')) {
      return 'Business Expense';
    }
  }
  
  // Default based on type
  return tx.transaction_type === 'debit' ? 'Business Expense' : 'Business Income';
}
