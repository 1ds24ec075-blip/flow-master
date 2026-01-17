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

// Transaction status types based on validation
type TransactionStatus = 'AUTO_POST' | 'NEEDS_REVIEW' | 'INVALID' | 'SUMMARY' | 'DUPLICATE';

interface RawTransaction {
  transaction_date?: string;
  narration?: string;
  amount?: number | string;
  debit_amount?: number | string;
  credit_amount?: number | string;
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
  status: TransactionStatus;
  reason?: string;
  amount?: number;
  transactionType?: 'debit' | 'credit';
}

// ========== STEP 1: HARD VALIDATION (NON-NEGOTIABLE) ==========

// Check if a value is masked (e.g., ****, XXXXXXXX, ####)
const isMaskedValue = (value: string): boolean => {
  if (!value) return false;
  const str = value.trim();
  if (/^[\*]+$/.test(str)) return true;
  if (/^[X]+$/i.test(str)) return true;
  if (/^[#]+$/.test(str)) return true;
  if (/^\*{2,}.*\*{2,}$/.test(str)) return true;
  if (/^X{4,}/i.test(str)) return true;
  return false;
};

// ========== STEP 2: SUMMARY & NON-TRANSACTION FILTER ==========

const SUMMARY_PATTERNS = [
  'statement summary',
  'opening balance',
  'closing balance',
  'total',
  'debits',
  'credits',
  'dr count',
  'cr count',
  'balance b/f',
  'balance c/f',
  'grand total',
  'sub total',
  'subtotal',
  'statement from',
  'statement period',
  'account no',
  'account number',
  'ifsc',
  'branch',
  'customer id',
  'cif no',
  'page',
  'continued',
  'end of statement',
  'debit count',
  'credit count',
  'closing bal',
  '---',
  '===',
  '***',
  '###'
];

const isSummaryRow = (narration: string): boolean => {
  if (!narration) return false;
  const lower = narration.toLowerCase().trim();
  
  for (const pattern of SUMMARY_PATTERNS) {
    if (lower.includes(pattern)) return true;
  }
  
  // Separator rows (just symbols)
  if (/^[\s\-\=\*\#\.\,]+$/.test(narration)) return true;
  
  // Generic placeholders like "Transaction 123", "Row 456", "Entry 789"
  if (/^transaction\s*\d+$/i.test(lower)) return true;
  if (/^row\s*\d+$/i.test(lower)) return true;
  if (/^entry\s*\d+$/i.test(lower)) return true;
  
  return false;
};

// ========== DATE VALIDATION ==========

const parseAndValidateDate = (dateStr: string | undefined | null): { valid: boolean; normalized?: string } => {
  if (!dateStr) return { valid: false };
  const str = String(dateStr).trim();
  if (!str) return { valid: false };
  if (isMaskedValue(str)) return { valid: false };
  
  const parseDateForValidation = (s: string): { date: Date | null; normalized: string | null } => {
    // YYYY-MM-DD
    let match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const d = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      return { date: d, normalized: s };
    }
    
    // DD/MM/YYYY or DD-MM-YYYY
    match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];
      const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      return { date: d, normalized: `${year}-${month}-${day}` };
    }
    
    // DD/MM/YY or DD-MM-YY
    match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = parseInt(match[3], 10);
      const fullYear = year > 50 ? 1900 + year : 2000 + year;
      const d = new Date(fullYear, parseInt(month) - 1, parseInt(day));
      return { date: d, normalized: `${fullYear}-${month}-${day}` };
    }
    
    // Try native parsing
    try {
      const parsed = new Date(s);
      if (!isNaN(parsed.getTime())) {
        return { date: parsed, normalized: parsed.toISOString().split('T')[0] };
      }
    } catch {}
    
    return { date: null, normalized: null };
  };
  
  const result = parseDateForValidation(str);
  if (!result.date || isNaN(result.date.getTime())) return { valid: false };
  
  // Check year is in realistic range (2000-2099)
  const year = result.date.getFullYear();
  if (year < 2000 || year > 2099) {
    console.log(`Rejecting date with invalid year: ${str} -> year ${year}`);
    return { valid: false };
  }
  
  return { valid: true, normalized: result.normalized || undefined };
};

// ========== AMOUNT VALIDATION ==========

const parseAmount = (value: number | string | undefined | null): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && isMaskedValue(value)) return null;
  
  const num = typeof value === 'string' 
    ? parseFloat(String(value).replace(/[,\s₹$]/g, '')) 
    : value;
  
  if (isNaN(num) || !isFinite(num)) return null;
  return num;
};

// ========== STEP 4: TRANSACTION TYPE IDENTIFICATION ==========

const determineTransactionType = (
  rawTx: RawTransaction
): { type: 'debit' | 'credit' | null; amount: number | null } => {
  // Check for separate debit/credit columns first
  const debitAmt = parseAmount(rawTx.debit_amount);
  const creditAmt = parseAmount(rawTx.credit_amount);
  
  // Both have values - INVALID
  if (debitAmt !== null && debitAmt > 0 && creditAmt !== null && creditAmt > 0) {
    return { type: null, amount: null };
  }
  
  // Credit amount exists and > 0
  if (creditAmt !== null && creditAmt > 0) {
    return { type: 'credit', amount: creditAmt };
  }
  
  // Debit amount exists and > 0
  if (debitAmt !== null && debitAmt > 0) {
    return { type: 'debit', amount: debitAmt };
  }
  
  // Fallback to single amount column + type indicator
  const amount = parseAmount(rawTx.amount);
  if (amount === null || amount <= 0) {
    return { type: null, amount: null };
  }
  
  // Check transaction_type field
  if (rawTx.transaction_type) {
    const lower = String(rawTx.transaction_type).toLowerCase().trim();
    if (['credit', 'cr', 'c'].includes(lower)) {
      return { type: 'credit', amount };
    }
    if (['debit', 'dr', 'd'].includes(lower)) {
      return { type: 'debit', amount };
    }
  }
  
  // Cannot determine type
  return { type: null, amount: null };
};

// ========== FINGERPRINT FOR DUPLICATE DETECTION ==========

const generateFingerprint = (
  date: string,
  amount: number,
  type: 'debit' | 'credit',
  narration: string
): string => {
  const normalizedNarration = (narration || '').toLowerCase().trim().replace(/\s+/g, ' ').slice(0, 100);
  // Simple hash using string concatenation - good enough for duplicate detection within a batch
  return `${date}|${amount.toFixed(2)}|${type}|${normalizedNarration}`;
};

// ========== MAIN VALIDATION FUNCTION ==========

const validateTransaction = (rawTx: RawTransaction): ValidationResult => {
  const narration = (rawTx.narration || '').trim();
  
  // STEP 2: Check if it's a summary row first
  if (isSummaryRow(narration)) {
    return { status: 'SUMMARY', reason: 'Summary/total/header row detected' };
  }
  
  // STEP 1: HARD VALIDATION - Date is mandatory
  const dateResult = parseAndValidateDate(rawTx.transaction_date);
  if (!dateResult.valid) {
    return { status: 'INVALID', reason: 'Missing or invalid date (must be valid calendar date, year 2000-2099)' };
  }
  
  // STEP 1 & 4: Amount + Type validation (exactly ONE of debit/credit)
  const typeResult = determineTransactionType(rawTx);
  if (typeResult.type === null || typeResult.amount === null || typeResult.amount <= 0) {
    return { status: 'INVALID', reason: 'Missing/invalid amount or cannot determine debit/credit (exactly one required)' };
  }
  
  // PASSED HARD VALIDATION
  return {
    status: 'NEEDS_REVIEW', // Will be upgraded to AUTO_POST if party matches
    amount: typeResult.amount,
    transactionType: typeResult.type
  };
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

    const effectiveBusinessName = businessName?.trim() || 'Default Business';
    
    console.log(`Received ${transactions.length} raw rows for ${effectiveBusinessName}`);

    // ========== STRICT VALIDATION - Filter transactions by status ==========
    const validTransactions: Transaction[] = [];
    const rejectedRows: { index: number; reason: string; status: TransactionStatus }[] = [];
    const processedFingerprints = new Set<string>();

    for (let i = 0; i < transactions.length; i++) {
      const rawTx = transactions[i] as RawTransaction;
      const validation = validateTransaction(rawTx);
      
      if (validation.status === 'INVALID' || validation.status === 'SUMMARY') {
        rejectedRows.push({ 
          index: i + 1, 
          reason: validation.reason || 'Validation failed',
          status: validation.status
        });
        continue;
      }
      
      // Passed hard validation - extract data
      const dateResult = parseAndValidateDate(rawTx.transaction_date);
      const narration = (rawTx.narration || '').trim();
      
      // Generate fingerprint for duplicate detection
      const fingerprint = generateFingerprint(
        dateResult.normalized!,
        validation.amount!,
        validation.transactionType!,
        narration
      );
      
      // Check for duplicates within this batch
      if (processedFingerprints.has(fingerprint)) {
        rejectedRows.push({
          index: i + 1,
          reason: 'Duplicate transaction (same date, amount, type, narration)',
          status: 'DUPLICATE'
        });
        continue;
      }
      processedFingerprints.add(fingerprint);
      
      validTransactions.push({
        transaction_date: dateResult.normalized!,
        narration: narration || 'No narration',
        amount: Math.abs(validation.amount!),
        transaction_type: validation.transactionType!,
        reference_number: rawTx.reference_number || rawTx.utr || rawTx.cheque_no || undefined
      });
    }

    console.log(`Valid transactions: ${validTransactions.length}, Rejected: ${rejectedRows.length}`);
    
    // Log rejection breakdown
    const rejectionBreakdown = rejectedRows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('Rejection breakdown:', rejectionBreakdown);
    
    if (rejectedRows.length > 0) {
      console.log('Sample rejected rows:', rejectedRows.slice(0, 10));
    }

    // If no valid transactions, return early
    if (validTransactions.length === 0) {
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
        rejectionBreakdown,
        sampleRejections: rejectedRows.slice(0, 15)
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
              confidence: 95
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

    // Store transactions in database
    const transactionsToInsert = classifiedTransactions.map(tx => ({
      upload_id: uploadId,
      transaction_date: tx.transaction_date,
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
      lowConfidence: classifiedTransactions.filter(t => t.confidence < 70).length,
      rejected: {
        total: rejectedRows.length,
        breakdown: rejectionBreakdown
      }
    };

    classifiedTransactions.forEach(tx => {
      summary.byCategory[tx.category] = (summary.byCategory[tx.category] || 0) + 1;
    });

    console.log('Classification complete:', summary);

    return new Response(JSON.stringify({
      success: true,
      summary,
      transactions: classifiedTransactions,
      rejectedRows: rejectedRows.slice(0, 20) // Include sample for debugging
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
