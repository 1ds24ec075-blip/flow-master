import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { 
  Upload, Download, Filter, AlertCircle, CheckCircle, TrendingUp, TrendingDown, 
  ArrowLeftRight, User, HelpCircle, FileText, Flag, Check, X, Receipt, 
  CreditCard, ArrowUpDown, Banknote, Trash2, Plus, PenLine
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import * as XLSX from "xlsx";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Transaction {
  id?: string;
  transaction_date: string;
  narration: string;
  amount: number;
  transaction_type: 'debit' | 'credit';
  suggested_category: string;
  final_category?: string;
  confidence_score: number;
  is_reviewed?: boolean;
}

interface TallyVoucher {
  id?: string;
  upload_id?: string;
  transaction_id?: string;
  voucher_type: 'Payment' | 'Receipt' | 'Contra' | 'Journal';
  voucher_date: string;
  amount: number;
  bank_ledger: string;
  party_ledger: string;
  reference_number: string;
  narration: string;
  payment_mode: string;
  status: 'draft' | 'flagged' | 'approved' | 'created';
  flag_reason?: string;
  is_duplicate: boolean;
  is_manual?: boolean;
}

interface Ledger {
  id: string;
  ledger_name: string;
  ledger_group: string;
  ledger_type: string;
}

interface UploadSession {
  id: string;
  business_name: string;
  account_name: string;
  file_name: string;
  total_transactions: number;
  status: string;
  created_at: string;
}

const CATEGORIES = [
  'Business Expense',
  'Business Income',
  'Transfers',
  'Personal / Owner',
  'Unknown'
];

const categoryIcons: Record<string, React.ReactNode> = {
  'Business Expense': <TrendingDown className="h-4 w-4 text-destructive" />,
  'Business Income': <TrendingUp className="h-4 w-4 text-green-500" />,
  'Transfers': <ArrowLeftRight className="h-4 w-4 text-blue-500" />,
  'Personal / Owner': <User className="h-4 w-4 text-orange-500" />,
  'Unknown': <HelpCircle className="h-4 w-4 text-muted-foreground" />,
};

const voucherTypeIcons: Record<string, React.ReactNode> = {
  'Payment': <CreditCard className="h-4 w-4 text-red-500" />,
  'Receipt': <Banknote className="h-4 w-4 text-green-500" />,
  'Contra': <ArrowUpDown className="h-4 w-4 text-blue-500" />,
  'Journal': <FileText className="h-4 w-4 text-purple-500" />,
};

// Keyword-to-ledger mapping for intelligent ledger selection
const LEDGER_KEYWORDS: Record<string, string[]> = {
  'Salary & Wages': ['salary', 'wage', 'payroll', 'staff'],
  'Rent Paid': ['rent', 'lease', 'property'],
  'Electricity Charges': ['electricity', 'power', 'utility', 'electric'],
  'Telephone Expenses': ['telephone', 'phone', 'mobile', 'airtel', 'jio', 'vodafone', 'bsnl'],
  'Travelling Expenses': ['travel', 'uber', 'ola', 'cab', 'taxi', 'flight', 'train', 'irctc'],
  'Office Expenses': ['office', 'stationery', 'supplies', 'amazon', 'flipkart'],
  'Professional Fees': ['consultant', 'professional', 'legal', 'audit', 'accounting'],
  'Bank Charges': ['bank charge', 'service charge', 'annual fee', 'maintenance'],
  'Interest Paid': ['interest', 'emi', 'loan'],
  'Interest Received': ['interest credit', 'fd interest', 'savings interest'],
  'Sales Account': ['sale', 'revenue', 'income', 'payment received'],
  'Purchase Account': ['purchase', 'buy', 'vendor'],
};

export default function SmartSegregation() {
  const [businessName, setBusinessName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [showPdfWarning, setShowPdfWarning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showLowConfidence, setShowLowConfidence] = useState(false);
  const [uploadHistory, setUploadHistory] = useState<UploadSession[]>([]);
  const [currentUploadId, setCurrentUploadId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    byCategory: Record<string, number>;
    totalDebit: number;
    totalCredit: number;
  } | null>(null);

  // Matched parties state (real-time matching without voucher generation)
  interface MatchedParty {
    transactionId: string;
    transactionDate: string;
    narration: string;
    amount: number;
    transactionType: 'debit' | 'credit';
    partyName: string;
    partyType: 'customer' | 'supplier';
    matchType: 'upi' | 'bank';
  }
  const [matchedParties, setMatchedParties] = useState<MatchedParty[]>([]);

  // Voucher state
  const [activeTab, setActiveTab] = useState("transactions");
  const [vouchers, setVouchers] = useState<TallyVoucher[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [voucherFilter, setVoucherFilter] = useState<string>("all");
  const [isGeneratingVouchers, setIsGeneratingVouchers] = useState(false);

  // Manual voucher form state
  const [showManualVoucherDialog, setShowManualVoucherDialog] = useState(false);
  const [manualVoucher, setManualVoucher] = useState({
    voucher_type: 'Payment' as 'Payment' | 'Receipt' | 'Contra' | 'Journal',
    voucher_date: new Date().toISOString().split('T')[0],
    amount: '',
    bank_ledger: '',
    party_ledger: '',
    reference_number: '',
    narration: '',
    payment_mode: 'NEFT/RTGS'
  });

  useEffect(() => {
    fetchUploadHistory();
    fetchLedgers();
  }, []);

  useEffect(() => {
    let filtered = [...transactions];
    
    if (categoryFilter !== "all") {
      filtered = filtered.filter(t => 
        (t.final_category || t.suggested_category) === categoryFilter
      );
    }
    
    if (showLowConfidence) {
      filtered = filtered.filter(t => t.confidence_score < 70);
    }
    
    setFilteredTransactions(filtered);
  }, [transactions, categoryFilter, showLowConfidence]);

  useEffect(() => {
    if (file) {
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      setShowPdfWarning(isPdf);
    } else {
      setShowPdfWarning(false);
    }
  }, [file]);

  const fetchLedgers = async () => {
    const { data } = await supabase
      .from('ledger_master')
      .select('*')
      .eq('is_active', true)
      .order('ledger_name');
    
    if (data) {
      setLedgers(data);
    }
  };

  const fetchUploadHistory = async () => {
    const { data, error } = await supabase
      .from('segregation_uploads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (data) {
      setUploadHistory(data);
    }
  };

  const deleteUpload = async (uploadId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the parent onClick
    
    if (!confirm('Are you sure you want to delete this upload? This will also delete all associated transactions and vouchers.')) {
      return;
    }

    try {
      // Delete vouchers first (due to foreign key)
      await supabase
        .from('tally_vouchers')
        .delete()
        .eq('upload_id', uploadId);

      // Delete transactions (due to foreign key)
      await supabase
        .from('segregated_transactions')
        .delete()
        .eq('upload_id', uploadId);

      // Delete the upload record
      const { error } = await supabase
        .from('segregation_uploads')
        .delete()
        .eq('id', uploadId);

      if (error) throw error;

      toast.success('Upload deleted successfully');
      fetchUploadHistory();
      
      // Clear current view if the deleted upload was being viewed
      if (currentUploadId === uploadId) {
        setTransactions([]);
        setVouchers([]);
        setCurrentUploadId(null);
        setSummary(null);
      }
    } catch (error: any) {
      toast.error('Failed to delete upload: ' + error.message);
    }
  };

  const fetchTransactions = async (uploadId: string) => {
    const { data, error } = await supabase
      .from('segregated_transactions')
      .select('*')
      .eq('upload_id', uploadId)
      .order('transaction_date', { ascending: false });
    
    if (data) {
      const typedData = data.map(tx => ({
        ...tx,
        transaction_type: tx.transaction_type as 'debit' | 'credit'
      }));
      setTransactions(typedData);
      calculateSummary(typedData);
      
      // Run real-time party matching
      await matchPartiesRealTime(typedData);
    }

    // Also fetch existing vouchers
    await fetchVouchers(uploadId);
  };

  // Real-time party matching without voucher generation
  const matchPartiesRealTime = async (txns: Transaction[]) => {
    // Fetch customers for credit matching
    const { data: customers } = await supabase
      .from('customer_master')
      .select('customer_name, bank_account, upi_payment_patterns, tally_ledger_name')
      .eq('is_active', true);

    // Fetch suppliers for debit matching
    const { data: suppliers } = await supabase
      .from('suppliers')
      .select('name, bank_account, upi_payment_patterns');

    const matched: MatchedParty[] = [];

    for (const tx of txns) {
      if (!tx.id) continue;
      
      // Skip excluded transactions
      if (shouldExcludeTransaction(tx.narration, tx.amount)) continue;

      // Check for customer match (credits)
      if (tx.transaction_type === 'credit' && customers && customers.length > 0) {
        const customerMatch = matchCustomerStrict(tx.narration, customers);
        if (customerMatch.status === 'matched' && customerMatch.matchType !== 'none') {
          matched.push({
            transactionId: tx.id,
            transactionDate: tx.transaction_date,
            narration: tx.narration,
            amount: tx.amount,
            transactionType: tx.transaction_type,
            partyName: customerMatch.customerName,
            partyType: 'customer',
            matchType: customerMatch.matchType as 'upi' | 'bank'
          });
          continue; // Skip supplier check if customer matched
        }
      }

      // Check for supplier match (debits)
      if (tx.transaction_type === 'debit' && suppliers && suppliers.length > 0) {
        const supplierMatch = matchSupplierStrict(tx.narration, suppliers);
        if (supplierMatch.status === 'matched' && supplierMatch.matchType !== 'none') {
          matched.push({
            transactionId: tx.id,
            transactionDate: tx.transaction_date,
            narration: tx.narration,
            amount: tx.amount,
            transactionType: tx.transaction_type,
            partyName: supplierMatch.supplierName,
            partyType: 'supplier',
            matchType: supplierMatch.matchType as 'upi' | 'bank'
          });
        }
      }
    }

    setMatchedParties(matched);
  };


  const fetchVouchers = async (uploadId: string) => {
    const { data } = await supabase
      .from('tally_vouchers')
      .select('*')
      .eq('upload_id', uploadId)
      .order('voucher_date', { ascending: false });
    
    if (data) {
      setVouchers(data as TallyVoucher[]);
    }
  };

  const calculateSummary = (txns: Transaction[]) => {
    const byCategory: Record<string, number> = {};
    let totalDebit = 0;
    let totalCredit = 0;

    txns.forEach(tx => {
      const cat = tx.final_category || tx.suggested_category;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      
      if (tx.transaction_type === 'debit') {
        totalDebit += tx.amount;
      } else {
        totalCredit += tx.amount;
      }
    });

    setSummary({
      total: txns.length,
      byCategory,
      totalDebit,
      totalCredit
    });
  };

  // Extract payment mode from narration
  const extractPaymentMode = (narration: string): string => {
    const upperNarration = narration.toUpperCase();
    if (upperNarration.includes('UPI')) return 'UPI';
    if (upperNarration.includes('NEFT')) return 'NEFT';
    if (upperNarration.includes('RTGS')) return 'RTGS';
    if (upperNarration.includes('IMPS')) return 'IMPS';
    if (upperNarration.includes('CASH')) return 'Cash';
    if (upperNarration.includes('CHQ') || upperNarration.includes('CHEQUE')) return 'Cheque';
    if (upperNarration.includes('DD') || upperNarration.includes('DEMAND DRAFT')) return 'DD';
    return 'Electronic';
  };

  // Extract reference number from narration
  const extractReferenceNumber = (narration: string): string => {
    // Look for common reference patterns
    const patterns = [
      /(?:ref|txn|utr|rrn|neft|rtgs|imps)[:\s]*([A-Z0-9]+)/i,
      /([0-9]{12,})/,
      /([A-Z]{4}[0-9]{12,})/i,
    ];
    
    for (const pattern of patterns) {
      const match = narration.match(pattern);
      if (match) return match[1];
    }
    
    return '';
  };

  // Intelligent ledger selection based on narration keywords
  const selectLedger = (narration: string, category: string, transactionType: 'debit' | 'credit'): string => {
    const lowerNarration = narration.toLowerCase();
    
    // Check keyword mappings
    for (const [ledger, keywords] of Object.entries(LEDGER_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lowerNarration.includes(keyword)) {
          return ledger;
        }
      }
    }
    
    // Fallback based on category
    if (category === 'Business Expense') return 'Office Expenses';
    if (category === 'Business Income') return 'Sales Account';
    if (category === 'Transfers') return 'Bank Account';
    if (category === 'Personal / Owner') return 'Suspense A/c';
    
    return 'Suspense A/c';
  };

  // Determine voucher type based on transaction
  const determineVoucherType = (transaction: Transaction): 'Payment' | 'Receipt' | 'Contra' | 'Journal' => {
    const category = transaction.final_category || transaction.suggested_category;
    
    // Transfers between own accounts = Contra
    if (category === 'Transfers') return 'Contra';
    
    // Money going out = Payment
    if (transaction.transaction_type === 'debit') return 'Payment';
    
    // Money coming in = Receipt
    return 'Receipt';
  };

  // Check for duplicate reference
  const checkDuplicateReference = async (referenceNumber: string): Promise<boolean> => {
    if (!referenceNumber) return false;
    
    const { data } = await supabase
      .from('tally_vouchers')
      .select('id')
      .eq('reference_number', referenceNumber)
      .limit(1);
    
    return (data?.length || 0) > 0;
  };

  // Extract UPI ID from narration (strict extraction)
  const extractUpiId = (narration: string): string | null => {
    // Common UPI ID patterns: name@bank, number@upi, etc.
    const upiPatterns = [
      /([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/i,
      /upi[:\s]*([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/i,
    ];
    
    for (const pattern of upiPatterns) {
      const match = narration.match(pattern);
      if (match) {
        return match[1].toLowerCase().trim();
      }
    }
    return null;
  };

  // Extract bank account number from narration (strict extraction)
  const extractBankAccount = (narration: string): string | null => {
    // Look for patterns like "A/c: 1234567890" or account numbers (9-18 digits)
    const patterns = [
      /a\/c[:\s]*(\d{9,18})/i,
      /acc(?:ount)?[:\s]*(\d{9,18})/i,
      /(\d{9,18})/,
    ];
    
    for (const pattern of patterns) {
      const match = narration.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    return null;
  };

  // Normalize UPI ID for comparison
  const normalizeUpiId = (upi: string | null): string | null => {
    if (!upi) return null;
    return upi.toLowerCase().trim().replace(/[^\w@.-]/g, '');
  };

  // Extract username part from a full UPI ID (e.g., "harish.narayanan2806" from "harish.narayanan2806@okicici")
  const extractUpiUsername = (upi: string): string => {
    const atIndex = upi.indexOf('@');
    return atIndex > 0 ? upi.substring(0, atIndex).toLowerCase().trim() : upi.toLowerCase().trim();
  };

  // Check if any UPI pattern's username appears in the narration (for partial matching)
  const checkUpiPatternInNarration = (narration: string, upiPatterns: string): boolean => {
    const normalizedNarration = narration.toLowerCase().replace(/[^a-z0-9]/g, '');
    const patterns = upiPatterns.split(/[,\/]/).map(p => p.trim()).filter(Boolean);
    
    for (const pattern of patterns) {
      // Get the username part of the UPI pattern
      const username = extractUpiUsername(pattern);
      // Normalize by removing special chars for comparison
      const normalizedUsername = username.replace(/[^a-z0-9]/g, '');
      
      // Check if username (min 6 chars) appears in narration
      if (normalizedUsername.length >= 6 && normalizedNarration.includes(normalizedUsername)) {
        return true;
      }
    }
    return false;
  };

  // STRICT Customer Matching - UPI ID or Bank Account ONLY (No narration/name matching)
  const matchCustomerStrict = (
    narration: string,
    customers: { customer_name: string; bank_account: string | null; upi_payment_patterns: string | null; tally_ledger_name: string | null }[]
  ): { status: 'matched' | 'multiple' | 'none'; customerName: string; ledgerName: string; matchType: 'upi' | 'bank' | 'none' } => {
    const extractedUpi = extractUpiId(narration);
    const extractedBank = extractBankAccount(narration);
    
    const matches: { customer: typeof customers[0]; matchType: 'upi' | 'bank' }[] = [];
    
    for (const customer of customers) {
      // Try exact UPI ID match first (full UPI extracted from narration)
      if (extractedUpi && customer.upi_payment_patterns) {
        const customerUpis = customer.upi_payment_patterns
          .split(/[,\/]/)
          .map(p => normalizeUpiId(p.trim()))
          .filter(Boolean);
        
        const normalizedExtracted = normalizeUpiId(extractedUpi);
        if (normalizedExtracted && customerUpis.includes(normalizedExtracted)) {
          matches.push({ customer, matchType: 'upi' });
          continue; // Found match, skip to next customer
        }
      }
      
      // Fallback: Check if UPI pattern's username appears in narration (partial match)
      if (customer.upi_payment_patterns && checkUpiPatternInNarration(narration, customer.upi_payment_patterns)) {
        matches.push({ customer, matchType: 'upi' });
        continue;
      }
      
      // Try exact bank account match
      if (extractedBank && customer.bank_account) {
        const customerBank = customer.bank_account.trim();
        if (extractedBank === customerBank) {
          matches.push({ customer, matchType: 'bank' });
        }
      }
    }
    
    // If more than one match, skip (ambiguous)
    if (matches.length > 1) {
      return { status: 'multiple', customerName: '', ledgerName: '', matchType: 'none' };
    }
    
    if (matches.length === 1) {
      const match = matches[0];
      return {
        status: 'matched',
        customerName: match.customer.customer_name,
        ledgerName: match.customer.tally_ledger_name || match.customer.customer_name,
        matchType: match.matchType
      };
    }
    
    return { status: 'none', customerName: '', ledgerName: '', matchType: 'none' };
  };

  // STRICT Supplier Matching - UPI ID or Bank Account ONLY (No narration/name matching)
  const matchSupplierStrict = (
    narration: string,
    suppliers: { name: string; bank_account: string | null; upi_payment_patterns: string | null }[]
  ): { status: 'matched' | 'multiple' | 'none'; supplierName: string; matchType: 'upi' | 'bank' | 'none' } => {
    const extractedUpi = extractUpiId(narration);
    const extractedBank = extractBankAccount(narration);
    
    const matches: { supplier: typeof suppliers[0]; matchType: 'upi' | 'bank' }[] = [];
    
    for (const supplier of suppliers) {
      // Try exact UPI ID match first (full UPI extracted from narration)
      if (extractedUpi && supplier.upi_payment_patterns) {
        const supplierUpis = supplier.upi_payment_patterns
          .split(/[,\/]/)
          .map(p => normalizeUpiId(p.trim()))
          .filter(Boolean);
        
        const normalizedExtracted = normalizeUpiId(extractedUpi);
        if (normalizedExtracted && supplierUpis.includes(normalizedExtracted)) {
          matches.push({ supplier, matchType: 'upi' });
          continue; // Found match, skip to next supplier
        }
      }
      
      // Fallback: Check if UPI pattern's username appears in narration (partial match)
      if (supplier.upi_payment_patterns && checkUpiPatternInNarration(narration, supplier.upi_payment_patterns)) {
        matches.push({ supplier, matchType: 'upi' });
        continue;
      }
      
      // Try exact bank account match
      if (extractedBank && supplier.bank_account) {
        const supplierBank = supplier.bank_account.trim();
        if (extractedBank === supplierBank) {
          matches.push({ supplier, matchType: 'bank' });
        }
      }
    }
    
    // If more than one match, skip (ambiguous)
    if (matches.length > 1) {
      return { status: 'multiple', supplierName: '', matchType: 'none' };
    }
    
    if (matches.length === 1) {
      const match = matches[0];
      return {
        status: 'matched',
        supplierName: match.supplier.name,
        matchType: match.matchType
      };
    }
    
    return { status: 'none', supplierName: '', matchType: 'none' };
  };

  // Check if transaction should be excluded (bank charges, interest, reversal, balance)
  const shouldExcludeTransaction = (narration: string, amount: number): boolean => {
    const lowerNarration = narration.toLowerCase();
    const exclusionKeywords = ['bank charge', 'service charge', 'interest', 'reversal', 'balance', 'int.pd', 'int.cr'];
    
    // Exclude zero or negative amounts
    if (amount <= 0) return true;
    
    // Check for exclusion keywords
    for (const keyword of exclusionKeywords) {
      if (lowerNarration.includes(keyword)) return true;
    }
    
    return false;
  };

  // Generate vouchers for ALL transactions
  const generateVouchers = async () => {
    await generateVouchersInternal(false);
  };

  // Generate vouchers ONLY for matched parties
  const generateVouchersForMatchedOnly = async () => {
    await generateVouchersInternal(true);
  };

  // Internal voucher generation function
  const generateVouchersInternal = async (matchedOnly: boolean) => {
    if (!currentUploadId || transactions.length === 0) {
      toast.error("No transactions to process");
      return;
    }

    setIsGeneratingVouchers(true);
    
    try {
      const newVouchers: TallyVoucher[] = [];
      const existingRefs = new Set<string>();
      
      // Get existing references to avoid duplicates
      const { data: existingVouchers } = await supabase
        .from('tally_vouchers')
        .select('reference_number')
        .not('reference_number', 'is', null);
      
      existingVouchers?.forEach(v => {
        if (v.reference_number) existingRefs.add(v.reference_number);
      });

      // Fetch customers for credit matching (Receipt Voucher)
      const { data: customers } = await supabase
        .from('customer_master')
        .select('customer_name, bank_account, upi_payment_patterns, tally_ledger_name')
        .eq('is_active', true);

      // Fetch suppliers for debit matching (Payment Voucher)
      const { data: suppliers } = await supabase
        .from('suppliers')
        .select('name, bank_account, upi_payment_patterns');

      for (const tx of transactions) {
        if (!tx.id) continue;
        
        // Skip excluded transactions (bank charges, interest, reversal, zero amounts)
        if (shouldExcludeTransaction(tx.narration, tx.amount)) continue;
        
        const category = tx.final_category || tx.suggested_category;
        const referenceNumber = extractReferenceNumber(tx.narration);
        const paymentMode = extractPaymentMode(tx.narration);
        const extractedUpi = extractUpiId(tx.narration);
        const extractedBank = extractBankAccount(tx.narration);
        
        // If both UPI and bank account are null in transaction, skip voucher creation for party matching
        const hasPartyIdentifier = extractedUpi || extractedBank;
        
        let voucherType = determineVoucherType(tx);
        let partyLedger = selectLedger(tx.narration, category, tx.transaction_type);
        let matchSource = '';
        let matchType: 'customer' | 'supplier' | 'none' | 'multiple' = 'none';
        let shouldSkip = false;
        
        // STRICT: Try to match against Customer Master for credits (Receipt Voucher) - UPI/Bank ONLY
        if (tx.transaction_type === 'credit' && customers && customers.length > 0 && hasPartyIdentifier) {
          const customerMatch = matchCustomerStrict(tx.narration, customers);
          
          if (customerMatch.status === 'multiple') {
            // Multiple matches - skip this transaction
            shouldSkip = true;
            matchType = 'multiple';
          } else if (customerMatch.status === 'matched') {
            voucherType = 'Receipt';
            partyLedger = customerMatch.ledgerName;
            matchSource = `Matched Customer (${customerMatch.matchType.toUpperCase()}): ${customerMatch.customerName}`;
            matchType = 'customer';
          }
        }
        
        // STRICT: Try to match against Suppliers for debits (Payment Voucher) - UPI/Bank ONLY
        if (!shouldSkip && tx.transaction_type === 'debit' && suppliers && suppliers.length > 0 && hasPartyIdentifier) {
          const supplierMatch = matchSupplierStrict(tx.narration, suppliers);
          
          if (supplierMatch.status === 'multiple') {
            // Multiple matches - skip this transaction
            shouldSkip = true;
            matchType = 'multiple';
          } else if (supplierMatch.status === 'matched') {
            voucherType = 'Payment';
            partyLedger = supplierMatch.supplierName;
            matchSource = `Matched Supplier (${supplierMatch.matchType.toUpperCase()}): ${supplierMatch.supplierName}`;
            matchType = 'supplier';
          }
        }
        
        // Skip if multiple matches found (ambiguous)
        if (shouldSkip) {
          console.log(`Skipping transaction due to multiple matches: ${tx.narration.substring(0, 50)}...`);
          continue;
        }
        
        // If matchedOnly mode, skip transactions that didn't match any party
        if (matchedOnly && matchType === 'none') {
          continue;
        }
        
        // Check for duplicate
        const isDuplicate = referenceNumber ? existingRefs.has(referenceNumber) : false;
        
        // Determine status based on confidence and category
        let status: 'draft' | 'flagged' | 'approved' = 'draft';
        let flagReason = '';
        
        if (isDuplicate) {
          status = 'flagged';
          flagReason = 'Duplicate reference number detected';
        } else if (matchSource) {
          // Customer/Supplier matched = auto-approve (priority for matched parties)
          status = 'approved';
          flagReason = matchSource;
        } else if (category === 'Unknown' || category === 'Personal / Owner') {
          status = 'flagged';
          flagReason = 'Category needs clarification - unclear if business transaction';
        } else if (tx.confidence_score < 70) {
          status = 'flagged';
          flagReason = 'Low confidence classification - requires manual review';
        } else if (tx.confidence_score >= 85 && partyLedger !== 'Suspense A/c') {
          // High confidence + clear ledger = auto-approve
          status = 'approved';
        }
        
        const voucher: TallyVoucher = {
          upload_id: currentUploadId,
          transaction_id: tx.id,
          voucher_type: voucherType,
          voucher_date: tx.transaction_date,
          amount: tx.amount,
          bank_ledger: 'Bank Account',
          party_ledger: partyLedger,
          reference_number: referenceNumber,
          narration: tx.narration,
          payment_mode: paymentMode,
          status,
          flag_reason: flagReason || undefined,
          is_duplicate: isDuplicate,
        };
        
        newVouchers.push(voucher);
        if (referenceNumber) existingRefs.add(referenceNumber);
      }

      // Insert vouchers
      if (newVouchers.length > 0) {
        const { error } = await supabase
          .from('tally_vouchers')
          .insert(newVouchers);
        
        if (error) throw error;
        
        await fetchVouchers(currentUploadId);
        
        const approved = newVouchers.filter(v => v.status === 'approved').length;
        const flagged = newVouchers.filter(v => v.status === 'flagged').length;
        const draft = newVouchers.filter(v => v.status === 'draft').length;
        
        toast.success(`Generated ${newVouchers.length} vouchers`, {
          description: `${approved} approved, ${draft} draft, ${flagged} flagged for review`
        });
        
        setActiveTab("vouchers");
      }
    } catch (error) {
      console.error('Voucher generation error:', error);
      toast.error('Failed to generate vouchers');
    } finally {
      setIsGeneratingVouchers(false);
    }
  };

  // Update voucher status
  const updateVoucherStatus = async (voucherId: string, status: 'approved' | 'flagged') => {
    const { error } = await supabase
      .from('tally_vouchers')
      .update({ status, flag_reason: status === 'flagged' ? 'Manually flagged for review' : null })
      .eq('id', voucherId);
    
    if (error) {
      toast.error('Failed to update voucher');
      return;
    }
    
    setVouchers(prev => prev.map(v => 
      v.id === voucherId ? { ...v, status } : v
    ));
    
    toast.success(`Voucher ${status === 'approved' ? 'approved' : 'flagged'}`);
  };

  // Update voucher ledger
  const updateVoucherLedger = async (voucherId: string, field: 'party_ledger' | 'bank_ledger', value: string) => {
    const { error } = await supabase
      .from('tally_vouchers')
      .update({ [field]: value })
      .eq('id', voucherId);
    
    if (error) {
      toast.error('Failed to update ledger');
      return;
    }
    
    setVouchers(prev => prev.map(v => 
      v.id === voucherId ? { ...v, [field]: value } : v
    ));
  };

  // Export vouchers to Excel (Tally format)
  const exportVouchersToExcel = () => {
    const approvedVouchers = vouchers.filter(v => v.status === 'approved' || v.status === 'created');
    
    if (approvedVouchers.length === 0) {
      toast.error('No approved vouchers to export');
      return;
    }

    const exportData = approvedVouchers.map(v => ({
      'Voucher Type': v.voucher_type,
      'Date': v.voucher_date,
      'Amount': v.amount,
      'Dr/Cr': v.voucher_type === 'Payment' ? 'Cr' : 'Dr',
      'Bank Ledger': v.bank_ledger,
      'Party/Expense Ledger': v.party_ledger,
      'Reference Number': v.reference_number,
      'Payment Mode': v.payment_mode,
      'Narration': v.narration,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tally Vouchers');
    XLSX.writeFile(wb, `tally-vouchers-${new Date().toISOString().split('T')[0]}.xlsx`);
    
    toast.success('Exported vouchers for Tally import');
  };

  // Create manual voucher
  const createManualVoucher = async () => {
    if (!manualVoucher.amount || !manualVoucher.bank_ledger || !manualVoucher.party_ledger) {
      toast.error('Please fill all required fields');
      return;
    }

    const amount = parseFloat(manualVoucher.amount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const newVoucher = {
      upload_id: currentUploadId,
      voucher_type: manualVoucher.voucher_type,
      voucher_date: manualVoucher.voucher_date,
      amount: amount,
      bank_ledger: manualVoucher.bank_ledger,
      party_ledger: manualVoucher.party_ledger,
      reference_number: manualVoucher.reference_number || `MANUAL-${Date.now()}`,
      narration: manualVoucher.narration || `Manual ${manualVoucher.voucher_type} voucher`,
      payment_mode: manualVoucher.payment_mode,
      status: 'draft',
      is_duplicate: false,
      is_manual: true
    };

    const { data, error } = await supabase
      .from('tally_vouchers')
      .insert([newVoucher])
      .select()
      .single();

    if (error) {
      toast.error('Failed to create voucher');
      console.error(error);
      return;
    }

    setVouchers(prev => [data as TallyVoucher, ...prev]);
    setShowManualVoucherDialog(false);
    setManualVoucher({
      voucher_type: 'Payment',
      voucher_date: new Date().toISOString().split('T')[0],
      amount: '',
      bank_ledger: '',
      party_ledger: '',
      reference_number: '',
      narration: '',
      payment_mode: 'NEFT/RTGS'
    });
    toast.success('Manual voucher created');
  };


  const parseExcelFile = async (file: File): Promise<Transaction[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
          
          const transactions: Transaction[] = [];
          let headerRow = -1;

          const normalize = (v: any) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

          // STRICT COLUMN MAPPING - Find header row with Date, Narration, Amount, Type
          const scanLimit = Math.min(60, jsonData.length);
          for (let i = 0; i < scanLimit; i++) {
            const row = jsonData[i];
            if (!row || row.length < 3) continue;

            const rowCells = row.map((c: any) => normalize(c));
            const hasDate = rowCells.some((c: string) => c === 'date' || c.includes('txn date') || c.includes('transaction date'));
            const hasNarration = rowCells.some((c: string) => c.includes('narration') || c.includes('description') || c.includes('particular'));
            const hasAmount = rowCells.some((c: string) => c === 'amount' || c.includes('amt'));
            const hasType = rowCells.some((c: string) => c === 'type' || c === 'dr/cr' || c === 'cr/dr');
            
            // Also check for Withdrawal/Deposit columns as alternative to Amount+Type
            const hasWithdrawal = rowCells.some((c: string) => c.includes('withdrawal') || c.includes('debit') || c === 'dr');
            const hasDeposit = rowCells.some((c: string) => c.includes('deposit') || c.includes('credit') || c === 'cr');

            if (hasDate && hasNarration && ((hasAmount && hasType) || (hasWithdrawal || hasDeposit))) {
              headerRow = i;
              break;
            }
          }

          if (headerRow === -1) {
            // Fallback: find first row with Date and Narration
            for (let i = 0; i < scanLimit; i++) {
              const row = jsonData[i];
              if (!row || row.length < 2) continue;
              const rowCells = row.map((c: any) => normalize(c));
              const hasDate = rowCells.some((c: string) => c.includes('date'));
              const hasNarration = rowCells.some((c: string) => c.includes('narration') || c.includes('description') || c.includes('particular'));
              if (hasDate && hasNarration) {
                headerRow = i;
                break;
              }
            }
          }

          if (headerRow === -1) headerRow = 0;
          const headers = jsonData[headerRow]?.map((h: any) => normalize(h)) || [];
          
          // FIXED COLUMN MAPPING - Only read from these specific columns
          const dateIdx = headers.findIndex((h: string) => 
            h === 'date' || h.includes('txn date') || h.includes('transaction date') || h.includes('posting date')
          );
          
          const narrationIdx = headers.findIndex((h: string) => 
            h.includes('narration') || h.includes('description') || h.includes('particular')
          );
          
          // Amount column - MUST be labeled "Amount" or "Amt", NOT balance/closing
          const amountIdx = headers.findIndex((h: string) => 
            (h === 'amount' || h === 'amt' || h.includes('amount')) && 
            !h.includes('balance') && !h.includes('closing') && !h.includes('withdrawal') && !h.includes('deposit')
          );
          
          // Type column - "Type", "Dr/Cr", "Cr/Dr"
          const typeIdx = headers.findIndex((h: string) => 
            h === 'type' || h === 'dr/cr' || h === 'cr/dr' || h.includes('transaction type')
          );
          
          // Alternative: Withdrawal/Deposit columns
          const withdrawalIdx = headers.findIndex((h: string) => 
            (h.includes('withdrawal') || (h.includes('debit') && !h.includes('balance'))) &&
            !h.includes('balance') && !h.includes('closing')
          );
          
          const depositIdx = headers.findIndex((h: string) => 
            (h.includes('deposit') || (h.includes('credit') && !h.includes('balance'))) &&
            !h.includes('balance') && !h.includes('closing')
          );

          console.log('STRICT Column mapping:', { 
            dateIdx, narrationIdx, amountIdx, typeIdx, withdrawalIdx, depositIdx,
            headers 
          });
          
          // Skip metadata rows containing account info
          const metadataKeywords = [
            'account no', 'account number', 'a/c no', 'acc no',
            'statement from', 'statement period', 'statement date',
            'nomination', 'joint holder', 'customer id', 'cust id',
            'address', 'phone', 'email', 'ifsc', 'micr', 'branch',
            'od limit', 'currency', 'account status', 'account type',
            'opening balance', 'a/c open date', 'preferred customer'
          ];
          
          // Maximum reasonable transaction amount (10 crore = 10,00,00,000)
          const MAX_TRANSACTION_AMOUNT = 100000000;
          
          for (let i = headerRow + 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;
            
            const nonEmptyCells = row.filter((cell: any) => cell !== null && cell !== undefined && cell !== '');
            if (nonEmptyCells.length < 2) continue;
            
            // Skip metadata rows
            const rowText = row.map((cell: any) => String(cell || '').toLowerCase()).join(' ');
            const isMetadataRow = metadataKeywords.some(keyword => rowText.includes(keyword));
            if (isMetadataRow) {
              console.log('Skipping metadata row:', row);
              continue;
            }
            
            // STRICT: Read ONLY from specified columns
            let date = dateIdx >= 0 ? row[dateIdx] : null;
            const narration = narrationIdx >= 0 ? String(row[narrationIdx] || '') : '';
            
            let amount = 0;
            let type: 'debit' | 'credit' = 'debit';
            
            // Method 1: Amount + Type columns (preferred)
            if (amountIdx >= 0 && typeIdx >= 0) {
              const rawAmount = parseFloat(String(row[amountIdx] || '0').replace(/[^0-9.-]/g, '')) || 0;
              const typeValue = normalize(row[typeIdx]);
              
              amount = Math.abs(rawAmount);
              
              // Cr = Credit = Receipt, Dr = Debit = Payment
              if (typeValue === 'cr' || typeValue === 'credit' || typeValue.includes('cr')) {
                type = 'credit';
              } else {
                type = 'debit';
              }
            }
            // Method 2: Separate Withdrawal/Deposit columns
            else if (withdrawalIdx >= 0 || depositIdx >= 0) {
              const withdrawalAmt = withdrawalIdx >= 0 ? 
                (parseFloat(String(row[withdrawalIdx] || '0').replace(/[^0-9.-]/g, '')) || 0) : 0;
              const depositAmt = depositIdx >= 0 ? 
                (parseFloat(String(row[depositIdx] || '0').replace(/[^0-9.-]/g, '')) || 0) : 0;

              if (withdrawalAmt > 0) {
                amount = withdrawalAmt;
                type = 'debit';
              } else if (depositAmt > 0) {
                amount = depositAmt;
                type = 'credit';
              }
            }
            // Method 3: Only Amount column without Type (default to debit)
            else if (amountIdx >= 0) {
              const rawAmount = parseFloat(String(row[amountIdx] || '0').replace(/[^0-9.-]/g, '')) || 0;
              amount = Math.abs(rawAmount);
              type = rawAmount < 0 ? 'debit' : 'credit';
            }
            
            // VALIDATION: Skip if amount is too large (likely a balance)
            if (amount > MAX_TRANSACTION_AMOUNT && type === 'credit') {
              console.log('Skipping possible balance row (amount > 10Cr, credit):', { amount, row });
              continue;
            }
            
            // Skip zero or invalid amounts
            if (amount <= 0) continue;
            
            // Parse date
            let parsedDate = '';
            if (date) {
              if (typeof date === 'number') {
                const excelDate = new Date((date - 25569) * 86400 * 1000);
                parsedDate = excelDate.toISOString().split('T')[0];
              } else {
                // Try to parse various date formats
                const dateStr = String(date).trim();
                // DD/MM/YYYY or DD-MM-YYYY
                const dmyMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
                if (dmyMatch) {
                  const day = dmyMatch[1].padStart(2, '0');
                  const month = dmyMatch[2].padStart(2, '0');
                  let year = dmyMatch[3];
                  if (year.length === 2) {
                    year = parseInt(year) > 50 ? '19' + year : '20' + year;
                  }
                  parsedDate = `${year}-${month}-${day}`;
                } else {
                  parsedDate = dateStr;
                }
              }
            }
            
            transactions.push({
              transaction_date: parsedDate,
              narration: narration.trim() || `Transaction ${i}`,
              amount,
              transaction_type: type,
              suggested_category: 'Unknown',
              confidence_score: 0
            });
          }
          
          console.log(`Parsed ${transactions.length} valid transactions`);
          resolve(transactions);
        } catch (error) {
          console.error('Excel parsing error:', error);
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsBinaryString(file);
    });
  };

  const parsePdfFile = async (file: File): Promise<Transaction[]> => {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64Data = result.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const response = await supabase.functions.invoke('parse-pdf-statement', {
      body: { pdfBase64: base64 }
    });

    if (response.error) throw new Error(response.error.message);

    const data = response.data;

    if (data.code === 'PASSWORD_REQUIRED' || data.code === 'PASSWORD_INCORRECT' || 
        data.code === 'PDF_ENCRYPTED' || data.code === 'PDF_UNREADABLE') {
      const error = new Error(data.error);
      (error as any).code = data.code;
      (error as any).isPasswordProtected = data.isPasswordProtected;
      (error as any).suggestion = data.suggestion;
      throw error;
    }

    if (!data.success && data.error) throw new Error(data.error);

    return data.transactions.map((tx: any) => ({
      transaction_date: tx.transaction_date,
      narration: tx.narration,
      amount: tx.amount,
      transaction_type: tx.transaction_type,
      suggested_category: 'Unknown',
      confidence_score: 0
    }));
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error("Please select a file");
      return;
    }

    const effectiveBusinessName = businessName.trim() || 'Default Business';
    const effectiveAccountName = accountName.trim() || 'Primary Account';

    setIsProcessing(true);
    
    try {
      let parsedTransactions: Transaction[];
      const isPdf = file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        toast.info("Processing PDF file...");
        parsedTransactions = await parsePdfFile(file);
      } else {
        parsedTransactions = await parseExcelFile(file);
      }
      
      if (parsedTransactions.length === 0) {
        toast.error("No transactions found in the file");
        setIsProcessing(false);
        return;
      }

      toast.info(`Found ${parsedTransactions.length} transactions. Classifying...`);

      const { data: uploadData, error: uploadError } = await supabase
        .from('segregation_uploads')
        .insert({
          business_name: effectiveBusinessName,
          account_name: effectiveAccountName,
          file_name: file.name,
          status: 'processing'
        })
        .select()
        .single();

      if (uploadError) throw uploadError;

      setCurrentUploadId(uploadData.id);

      const response = await supabase.functions.invoke('smart-segregation', {
        body: {
          transactions: parsedTransactions,
          businessName: effectiveBusinessName,
          accountName: effectiveAccountName,
          fileName: file.name,
          uploadId: uploadData.id
        }
      });

      if (response.error) throw response.error;

      toast.success(`Successfully classified ${response.data.summary.total} transactions`);
      
      await fetchTransactions(uploadData.id);
      await fetchUploadHistory();
      
      setFile(null);

    } catch (error: any) {
      console.error('Upload error:', error);
      
      if (error.code === 'PASSWORD_REQUIRED' || error.code === 'PASSWORD_INCORRECT' || error.isPasswordProtected) {
        toast.error(error.message || 'PDF password required', { duration: 8000 });
      } else if (error.code === 'PDF_ENCRYPTED' || error.code === 'PDF_UNREADABLE') {
        toast.error(error.message || 'Cannot read encrypted PDF. Please use Excel/CSV format instead.', { 
          duration: 10000,
          description: error.suggestion || 'Download the statement as Excel/CSV from your bank portal.'
        });
      } else {
        toast.error(error instanceof Error ? error.message : 'Failed to process file');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCategoryChange = async (transactionId: string, newCategory: string) => {
    const { error } = await supabase
      .from('segregated_transactions')
      .update({ 
        final_category: newCategory,
        is_reviewed: true 
      })
      .eq('id', transactionId);

    if (error) {
      toast.error('Failed to update category');
      return;
    }

    setTransactions(prev => prev.map(t => 
      t.id === transactionId 
        ? { ...t, final_category: newCategory, is_reviewed: true }
        : t
    ));

    const transaction = transactions.find(t => t.id === transactionId);
    if (transaction && businessName) {
      const pattern = extractPattern(transaction.narration);
      if (pattern) {
        await supabase
          .from('segregation_rules')
          .upsert({
            business_name: businessName,
            pattern,
            category: newCategory,
            usage_count: 1
          }, {
            onConflict: 'business_name,pattern'
          });
      }
    }

    toast.success('Category updated and rule saved');
  };

  const extractPattern = (narration: string): string => {
    const words = narration.toLowerCase().split(/[\s\/\-]+/);
    const stopWords = ['upi', 'neft', 'rtgs', 'imps', 'ref', 'no', 'the', 'to', 'from', 'by'];
    
    for (const word of words) {
      if (word.length > 3 && !stopWords.includes(word) && !/^\d+$/.test(word)) {
        return word;
      }
    }
    return words[0] || '';
  };

  const exportToExcel = () => {
    if (transactions.length === 0) {
      toast.error('No transactions to export');
      return;
    }

    const exportData = transactions.map(t => ({
      'Date': t.transaction_date,
      'Narration': t.narration,
      'Amount': t.amount,
      'Type': t.transaction_type === 'debit' ? 'Dr' : 'Cr',
      'Category': t.final_category || t.suggested_category,
      'Confidence %': t.confidence_score,
      'Reviewed': t.is_reviewed ? 'Yes' : 'No'
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    XLSX.writeFile(wb, `segregated-${businessName}-${new Date().toISOString().split('T')[0]}.xlsx`);
    
    toast.success('Exported to Excel');
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 85) {
      return <Badge variant="default" className="bg-green-500">{confidence}%</Badge>;
    } else if (confidence >= 70) {
      return <Badge variant="secondary">{confidence}%</Badge>;
    } else {
      return <Badge variant="destructive">{confidence}%</Badge>;
    }
  };

  const getVoucherStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-green-500"><Check className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'flagged':
        return <Badge variant="destructive"><Flag className="h-3 w-3 mr-1" />Flagged</Badge>;
      case 'created':
        return <Badge className="bg-blue-500"><FileText className="h-3 w-3 mr-1" />Created</Badge>;
      default:
        return <Badge variant="secondary">Draft</Badge>;
    }
  };

  const filteredVouchers = voucherFilter === 'all' 
    ? vouchers 
    : vouchers.filter(v => v.status === voucherFilter);

  const voucherSummary = {
    total: vouchers.length,
    approved: vouchers.filter(v => v.status === 'approved').length,
    flagged: vouchers.filter(v => v.status === 'flagged').length,
    draft: vouchers.filter(v => v.status === 'draft').length,
  };

  return (
    <Layout>
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="space-y-6 p-1">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Smart Bank Statement Segregation</h1>
              <p className="text-muted-foreground mt-1">
                Automatically categorize transactions & create Tally vouchers
              </p>
            </div>
          </div>

          {/* Upload Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Statement
              </CardTitle>
              <CardDescription>
                Upload bank or card statements (Excel, CSV, PDF) to automatically classify transactions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="businessName">Business Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input
                      id="businessName"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="Default Business"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Used for personalized rules</p>
                  </div>
                  <div>
                    <Label htmlFor="accountName">Bank/Card Account <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Input
                      id="accountName"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      placeholder="Primary Account"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Helps organize multiple accounts</p>
                  </div>
                  <div>
                    <Label htmlFor="file">Statement File</Label>
                    <Input
                      id="file"
                      type="file"
                      accept=".xlsx,.xls,.csv,.pdf"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </div>
                </div>

                {showPdfWarning && (
                  <div className="flex items-start gap-4 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
                    <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div className="flex-1 space-y-2">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        PDF files detected
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        <strong>Note:</strong> Password-protected PDFs cannot be processed. If your bank statement is encrypted, 
                        please download it as <strong>Excel (.xlsx)</strong> or <strong>CSV</strong> format from your bank's 
                        online portal instead.
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button 
                    onClick={handleUpload} 
                    disabled={isProcessing || !file}
                    size="lg"
                  >
                    {isProcessing ? 'Processing...' : 'Classify Transactions'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{summary.total}</div>
                  <div className="text-sm text-muted-foreground">Total Transactions</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold text-green-500">
                    ₹{summary.totalCredit.toLocaleString('en-IN')}
                  </div>
                  <div className="text-sm text-muted-foreground">Total Income</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold text-destructive">
                    ₹{summary.totalDebit.toLocaleString('en-IN')}
                  </div>
                  <div className="text-sm text-muted-foreground">Total Expenses</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold">{summary.byCategory['Business Expense'] || 0}</div>
                  <div className="text-sm text-muted-foreground">Business Expenses</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold text-orange-500">
                    {transactions.filter(t => t.confidence_score < 70).length}
                  </div>
                  <div className="text-sm text-muted-foreground">Needs Review</div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Tabs for Transactions and Vouchers */}
          {transactions.length > 0 && (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex items-center justify-between">
                <TabsList>
                  <TabsTrigger value="transactions" className="flex items-center gap-2">
                    <Receipt className="h-4 w-4" />
                    Transactions ({transactions.length})
                  </TabsTrigger>
                  <TabsTrigger value="matched" className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Matched Parties ({matchedParties.length})
                  </TabsTrigger>
                  <TabsTrigger value="vouchers" className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Tally Vouchers ({vouchers.length})
                  </TabsTrigger>
                </TabsList>
                
                {activeTab === 'transactions' && vouchers.length === 0 && (
                  <Button 
                    onClick={generateVouchers} 
                    disabled={isGeneratingVouchers}
                    className="bg-primary"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    {isGeneratingVouchers ? 'Generating...' : 'Generate Tally Vouchers'}
                  </Button>
                )}
              </div>

              {/* Transactions Tab */}
              <TabsContent value="transactions" className="space-y-4">
                <div className="flex flex-wrap gap-4 items-center justify-between">
                  <div className="flex gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4" />
                      <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="Filter by category" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Categories</SelectItem>
                          {CATEGORIES.map(cat => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant={showLowConfidence ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => setShowLowConfidence(!showLowConfidence)}
                    >
                      <AlertCircle className="h-4 w-4 mr-2" />
                      Low Confidence Only
                    </Button>
                  </div>
                  <Button onClick={exportToExcel} variant="outline">
                    <Download className="h-4 w-4 mr-2" />
                    Export to Excel
                  </Button>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>Classified Transactions ({filteredTransactions.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">Date</TableHead>
                            <TableHead>Narration</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                            <TableHead className="w-[80px]">Type</TableHead>
                            <TableHead className="w-[180px]">Category</TableHead>
                            <TableHead className="w-[100px]">Confidence</TableHead>
                            <TableHead className="w-[60px]">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredTransactions.map((tx) => (
                            <TableRow 
                              key={tx.id}
                              className={tx.confidence_score < 70 ? 'bg-orange-50 dark:bg-orange-950/20' : ''}
                            >
                              <TableCell className="text-sm">{tx.transaction_date}</TableCell>
                              <TableCell className="max-w-[300px] truncate" title={tx.narration}>
                                {tx.narration}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                ₹{tx.amount.toLocaleString('en-IN')}
                              </TableCell>
                              <TableCell>
                                <Badge variant={tx.transaction_type === 'debit' ? 'destructive' : 'default'}>
                                  {tx.transaction_type === 'debit' ? 'Dr' : 'Cr'}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Select 
                                  value={tx.final_category || tx.suggested_category}
                                  onValueChange={(val) => tx.id && handleCategoryChange(tx.id, val)}
                                >
                                  <SelectTrigger className="h-8">
                                    <div className="flex items-center gap-2">
                                      {categoryIcons[tx.final_category || tx.suggested_category]}
                                      <SelectValue />
                                    </div>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {CATEGORIES.map(cat => (
                                      <SelectItem key={cat} value={cat}>
                                        <div className="flex items-center gap-2">
                                          {categoryIcons[cat]}
                                          {cat}
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>{getConfidenceBadge(tx.confidence_score)}</TableCell>
                              <TableCell>
                                {tx.is_reviewed ? (
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Matched Parties Tab */}
              <TabsContent value="matched" className="space-y-4">
                {matchedParties.length === 0 ? (
                  <Card>
                    <CardContent className="pt-6 text-center">
                      <p className="text-muted-foreground">
                        No matched parties found. Add UPI patterns or Bank Account numbers to Customer/Supplier Master to enable matching.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* Action Button */}
                    <div className="flex justify-end">
                      <Button 
                        onClick={generateVouchersForMatchedOnly} 
                        disabled={isGeneratingVouchers || matchedParties.length === 0}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {isGeneratingVouchers ? 'Generating...' : `Generate Vouchers for ${matchedParties.length} Matched Parties`}
                      </Button>
                    </div>

                    {/* Matched Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Card>
                        <CardContent className="pt-4">
                          <div className="text-2xl font-bold text-green-500">
                            {matchedParties.filter(m => m.partyType === 'customer').length}
                          </div>
                          <div className="text-sm text-muted-foreground">Customer Matches</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <div className="text-2xl font-bold text-blue-500">
                            {matchedParties.filter(m => m.partyType === 'supplier').length}
                          </div>
                          <div className="text-sm text-muted-foreground">Supplier Matches</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <div className="text-2xl font-bold text-purple-500">
                            {matchedParties.filter(m => m.matchType === 'upi').length}
                          </div>
                          <div className="text-sm text-muted-foreground">UPI Matches</div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <div className="text-2xl font-bold text-orange-500">
                            {matchedParties.filter(m => m.matchType === 'bank').length}
                          </div>
                          <div className="text-sm text-muted-foreground">Bank A/c Matches</div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Customer Matches Section */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-green-600">
                          <TrendingUp className="h-5 w-5" />
                          Customer Matches (Receipts)
                        </CardTitle>
                        <CardDescription>
                          Credit transactions matched to Customer Master via UPI or Bank Account
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {matchedParties.filter(m => m.partyType === 'customer').length === 0 ? (
                          <p className="text-muted-foreground text-sm">No customer matches found</p>
                        ) : (
                          <div className="rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[100px]">Date</TableHead>
                                  <TableHead>Customer Name</TableHead>
                                  <TableHead>Match Type</TableHead>
                                  <TableHead className="text-right">Amount</TableHead>
                                  <TableHead>Narration</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {matchedParties
                                  .filter(m => m.partyType === 'customer')
                                  .map((m) => (
                                    <TableRow key={m.transactionId}>
                                      <TableCell className="text-sm">{m.transactionDate}</TableCell>
                                      <TableCell className="font-medium">{m.partyName}</TableCell>
                                      <TableCell>
                                        <Badge variant="outline" className={m.matchType === 'upi' ? 'border-purple-500 text-purple-600' : 'border-orange-500 text-orange-600'}>
                                          {m.matchType.toUpperCase()}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-right font-medium text-green-600">
                                        ₹{m.amount.toLocaleString('en-IN')}
                                      </TableCell>
                                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={m.narration}>
                                        {m.narration}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Supplier Matches Section */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-blue-600">
                          <TrendingDown className="h-5 w-5" />
                          Supplier Matches (Payments)
                        </CardTitle>
                        <CardDescription>
                          Debit transactions matched to Supplier Master via UPI or Bank Account
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {matchedParties.filter(m => m.partyType === 'supplier').length === 0 ? (
                          <p className="text-muted-foreground text-sm">No supplier matches found</p>
                        ) : (
                          <div className="rounded-md border">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[100px]">Date</TableHead>
                                  <TableHead>Supplier Name</TableHead>
                                  <TableHead>Match Type</TableHead>
                                  <TableHead className="text-right">Amount</TableHead>
                                  <TableHead>Narration</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {matchedParties
                                  .filter(m => m.partyType === 'supplier')
                                  .map((m) => (
                                    <TableRow key={m.transactionId}>
                                      <TableCell className="text-sm">{m.transactionDate}</TableCell>
                                      <TableCell className="font-medium">{m.partyName}</TableCell>
                                      <TableCell>
                                        <Badge variant="outline" className={m.matchType === 'upi' ? 'border-purple-500 text-purple-600' : 'border-orange-500 text-orange-600'}>
                                          {m.matchType.toUpperCase()}
                                        </Badge>
                                      </TableCell>
                                      <TableCell className="text-right font-medium text-destructive">
                                        ₹{m.amount.toLocaleString('en-IN')}
                                      </TableCell>
                                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={m.narration}>
                                        {m.narration}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </>
                )}
              </TabsContent>

              {/* Vouchers Tab */}
              <TabsContent value="vouchers" className="space-y-4">
                {/* Voucher Summary */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-2xl font-bold">{voucherSummary.total}</div>
                      <div className="text-sm text-muted-foreground">Total Vouchers</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-2xl font-bold text-green-500">{voucherSummary.approved}</div>
                      <div className="text-sm text-muted-foreground">Approved</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-2xl font-bold text-destructive">{voucherSummary.flagged}</div>
                      <div className="text-sm text-muted-foreground">Flagged for Review</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-2xl font-bold text-muted-foreground">{voucherSummary.draft}</div>
                      <div className="text-sm text-muted-foreground">Draft</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Voucher Filters & Actions */}
                <div className="flex flex-wrap gap-4 items-center justify-between">
                  <div className="flex gap-4 items-center">
                    <div className="flex items-center gap-2">
                      <Filter className="h-4 w-4" />
                      <Select value={voucherFilter} onValueChange={setVoucherFilter}>
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="Filter by status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Vouchers</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="flagged">Flagged</SelectItem>
                          <SelectItem value="draft">Draft</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Dialog open={showManualVoucherDialog} onOpenChange={setShowManualVoucherDialog}>
                      <DialogTrigger asChild>
                        <Button variant="default" className="bg-primary">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Manual Voucher
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader className="pb-3 border-b">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-md bg-purple-100 flex items-center justify-center">
                              <PenLine className="h-4 w-4 text-purple-600" />
                            </div>
                            <div>
                              <DialogTitle className="text-base font-semibold">Add Manual Voucher</DialogTitle>
                              <DialogDescription className="text-xs">
                                Highlighted in purple for identification.
                              </DialogDescription>
                            </div>
                          </div>
                        </DialogHeader>

                        <div className="space-y-3 py-3 max-h-[60vh] overflow-y-auto">
                          {/* Basic Info */}
                          <div className="space-y-2">
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Basic Info</h4>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Voucher Type <span className="text-destructive">*</span></Label>
                                <Select 
                                  value={manualVoucher.voucher_type} 
                                  onValueChange={(val) => setManualVoucher(prev => ({ ...prev, voucher_type: val as any }))}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Payment">Payment</SelectItem>
                                    <SelectItem value="Receipt">Receipt</SelectItem>
                                    <SelectItem value="Contra">Contra</SelectItem>
                                    <SelectItem value="Journal">Journal</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Date <span className="text-destructive">*</span></Label>
                                <Input 
                                  type="date"
                                  className="h-9"
                                  value={manualVoucher.voucher_date}
                                  onChange={(e) => setManualVoucher(prev => ({ ...prev, voucher_date: e.target.value }))}
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Amount (₹) <span className="text-destructive">*</span></Label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
                                <Input 
                                  type="number"
                                  placeholder="0.00"
                                  className="h-9 pl-7 font-medium"
                                  value={manualVoucher.amount}
                                  onChange={(e) => setManualVoucher(prev => ({ ...prev, amount: e.target.value }))}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Ledgers */}
                          <div className="space-y-2">
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ledgers</h4>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Bank/Cash <span className="text-destructive">*</span></Label>
                                <Select 
                                  value={manualVoucher.bank_ledger} 
                                  onValueChange={(val) => setManualVoucher(prev => ({ ...prev, bank_ledger: val }))}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ledgers.filter(l => l.ledger_type === 'Bank' || l.ledger_type === 'Cash').map(l => (
                                      <SelectItem key={l.id} value={l.ledger_name}>{l.ledger_name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Party/Expense <span className="text-destructive">*</span></Label>
                                <Select 
                                  value={manualVoucher.party_ledger} 
                                  onValueChange={(val) => setManualVoucher(prev => ({ ...prev, party_ledger: val }))}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue placeholder="Select" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ledgers.map(l => (
                                      <SelectItem key={l.id} value={l.ledger_name}>{l.ledger_name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>

                          {/* Transaction Details */}
                          <div className="space-y-2">
                            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Details</h4>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Payment Mode</Label>
                                <Select 
                                  value={manualVoucher.payment_mode} 
                                  onValueChange={(val) => setManualVoucher(prev => ({ ...prev, payment_mode: val }))}
                                >
                                  <SelectTrigger className="h-9">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="NEFT/RTGS">NEFT/RTGS</SelectItem>
                                    <SelectItem value="UPI">UPI</SelectItem>
                                    <SelectItem value="Cheque">Cheque</SelectItem>
                                    <SelectItem value="Cash">Cash</SelectItem>
                                    <SelectItem value="Card">Card</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">Reference No.</Label>
                                <Input 
                                  placeholder="Optional"
                                  className="h-9"
                                  value={manualVoucher.reference_number}
                                  onChange={(e) => setManualVoucher(prev => ({ ...prev, reference_number: e.target.value }))}
                                />
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Narration</Label>
                              <Input 
                                placeholder="Description (optional)"
                                className="h-9"
                                value={manualVoucher.narration}
                                onChange={(e) => setManualVoucher(prev => ({ ...prev, narration: e.target.value }))}
                              />
                            </div>
                          </div>
                        </div>

                        <DialogFooter className="pt-3 border-t gap-2 sm:gap-0">
                          <Button variant="outline" size="sm" onClick={() => setShowManualVoucherDialog(false)}>
                            Cancel
                          </Button>
                          <Button size="sm" onClick={createManualVoucher} className="bg-purple-600 hover:bg-purple-700">
                            <Plus className="h-3.5 w-3.5 mr-1.5" />
                            Create Voucher
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <Button onClick={exportVouchersToExcel} variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Export for Tally
                    </Button>
                  </div>
                </div>

                {/* Vouchers Table */}
                <Card>
                  <CardHeader>
                    <CardTitle>Tally Vouchers ({filteredVouchers.length})</CardTitle>
                    <CardDescription>
                      Review and approve vouchers before exporting to Tally
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[100px]">Date</TableHead>
                            <TableHead className="w-[100px]">Type</TableHead>
                            <TableHead className="text-right w-[120px]">Amount</TableHead>
                            <TableHead className="w-[150px]">Bank Ledger</TableHead>
                            <TableHead className="w-[180px]">Party/Expense Ledger</TableHead>
                            <TableHead className="w-[100px]">Payment Mode</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead className="w-[120px]">Status</TableHead>
                            <TableHead className="w-[100px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredVouchers.map((voucher) => (
                            <TableRow 
                              key={voucher.id}
                              className={
                                voucher.is_manual 
                                  ? 'bg-purple-50 dark:bg-purple-950/30 border-l-4 border-l-purple-500' 
                                  : voucher.status === 'flagged' 
                                    ? 'bg-red-50 dark:bg-red-950/20' 
                                    : ''
                              }
                            >
                              <TableCell className="text-sm">{voucher.voucher_date}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {voucherTypeIcons[voucher.voucher_type]}
                                  <span className="text-sm">{voucher.voucher_type}</span>
                                  {voucher.is_manual && (
                                    <Badge className="bg-purple-500 text-white text-xs px-1.5 py-0.5">
                                      <PenLine className="h-3 w-3 mr-1" />
                                      MANUAL
                                    </Badge>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                ₹{voucher.amount.toLocaleString('en-IN')}
                              </TableCell>
                              <TableCell>
                                <Select 
                                  value={voucher.bank_ledger}
                                  onValueChange={(val) => voucher.id && updateVoucherLedger(voucher.id, 'bank_ledger', val)}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ledgers.filter(l => l.ledger_type === 'Bank' || l.ledger_type === 'Cash').map(l => (
                                      <SelectItem key={l.id} value={l.ledger_name}>{l.ledger_name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Select 
                                  value={voucher.party_ledger}
                                  onValueChange={(val) => voucher.id && updateVoucherLedger(voucher.id, 'party_ledger', val)}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ledgers.map(l => (
                                      <SelectItem key={l.id} value={l.ledger_name}>{l.ledger_name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className="text-sm">{voucher.payment_mode}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate" title={voucher.reference_number}>
                                {voucher.reference_number || '—'}
                                {voucher.is_duplicate && (
                                  <Badge variant="destructive" className="ml-1 text-xs">DUP</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  {getVoucherStatusBadge(voucher.status)}
                                  {voucher.flag_reason && (
                                    <span className="text-xs text-destructive" title={voucher.flag_reason}>
                                      {voucher.flag_reason.substring(0, 30)}...
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  {voucher.status !== 'approved' && (
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      className="h-7 w-7 p-0 text-green-600"
                                      onClick={() => voucher.id && updateVoucherStatus(voucher.id, 'approved')}
                                      title="Approve"
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {voucher.status !== 'flagged' && (
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      className="h-7 w-7 p-0 text-destructive"
                                      onClick={() => voucher.id && updateVoucherStatus(voucher.id, 'flagged')}
                                      title="Flag for review"
                                    >
                                      <Flag className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Accounting Guidelines */}
                <Card className="bg-muted/30">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Voucher Creation Rules
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground space-y-2">
                    <p>• <strong>Payment Voucher</strong> — Money going out of the bank account</p>
                    <p>• <strong>Receipt Voucher</strong> — Money coming into the bank account</p>
                    <p>• <strong>Contra Voucher</strong> — Transfer between own bank/cash accounts</p>
                    <p>• Flagged items require manual review — do not guess unclear transactions</p>
                    <p>• Duplicate reference numbers are automatically detected and flagged</p>
                    <p>• GST is not assumed — verify before Tally import</p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}

          {/* Upload History */}
          {uploadHistory.length > 0 && transactions.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Uploads</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {uploadHistory.map(upload => (
                    <div 
                      key={upload.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        setBusinessName(upload.business_name || '');
                        setAccountName(upload.account_name || '');
                        fetchTransactions(upload.id);
                        setCurrentUploadId(upload.id);
                      }}
                    >
                      <div className="flex-1">
                        <div className="font-medium">{upload.business_name || 'Default Business'} - {upload.account_name || 'Primary Account'}</div>
                        <div className="text-sm text-muted-foreground">{upload.file_name}</div>
                      </div>
                      <div className="text-right mr-3">
                        <div className="text-sm">{upload.total_transactions} transactions</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(upload.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => deleteUpload(upload.id, e)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Disclaimer */}
          <div className="text-center text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg">
            <AlertCircle className="h-4 w-4 inline mr-2" />
            Think like an experienced accountant — accuracy is more important than automation. 
            If something looks unclear, flag it instead of guessing.
          </div>
        </div>
      </ScrollArea>
    </Layout>
  );
}
