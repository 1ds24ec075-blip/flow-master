import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Upload, Download, Filter, AlertCircle, CheckCircle, TrendingUp, TrendingDown, ArrowLeftRight, User, HelpCircle } from "lucide-react";
import * as XLSX from "xlsx";

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

  useEffect(() => {
    fetchUploadHistory();
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

  // Show PDF warning when PDF is selected
  useEffect(() => {
    if (file) {
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      setShowPdfWarning(isPdf);
    } else {
      setShowPdfWarning(false);
    }
  }, [file]);

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
          
          console.log('Excel data rows:', jsonData.length);
          console.log('First 5 rows:', jsonData.slice(0, 5));
          
          // Find header row and parse transactions
          const transactions: Transaction[] = [];
          let headerRow = -1;
          
          // Look for common header patterns - more flexible matching
          for (let i = 0; i < Math.min(15, jsonData.length); i++) {
            const row = jsonData[i];
            if (!row || row.length < 2) continue;
            const rowStr = row.join(' ').toLowerCase();
            
            // Check for date column
            const hasDate = rowStr.includes('date') || rowStr.includes('txn') || rowStr.includes('value');
            // Check for description column
            const hasDesc = rowStr.includes('narration') || rowStr.includes('description') || 
                           rowStr.includes('particular') || rowStr.includes('remark') || 
                           rowStr.includes('detail') || rowStr.includes('memo');
            // Check for amount columns
            const hasAmount = rowStr.includes('amount') || rowStr.includes('debit') || 
                             rowStr.includes('credit') || rowStr.includes('withdrawal') || 
                             rowStr.includes('deposit') || rowStr.includes('dr') || rowStr.includes('cr');
            
            if ((hasDate && hasDesc) || (hasDate && hasAmount) || (hasDesc && hasAmount)) {
              headerRow = i;
              console.log('Found header at row:', i, 'Content:', row);
              break;
            }
          }
          
          if (headerRow === -1) {
            // Fallback: find first row with multiple text values that look like headers
            for (let i = 0; i < Math.min(10, jsonData.length); i++) {
              const row = jsonData[i];
              if (!row || row.length < 3) continue;
              const textCells = row.filter((cell: any) => typeof cell === 'string' && cell.length > 0);
              if (textCells.length >= 3) {
                headerRow = i;
                console.log('Fallback header at row:', i, 'Content:', row);
                break;
              }
            }
          }
          
          if (headerRow === -1) headerRow = 0;
          
          const headers = jsonData[headerRow]?.map((h: any) => String(h || '').toLowerCase().trim()) || [];
          console.log('Detected headers:', headers);
          
          // Find column indices - more flexible matching
          const dateIdx = headers.findIndex((h: string) => 
            h.includes('date') || h.includes('txn') || h === 'value'
          );
          const narrationIdx = headers.findIndex((h: string) => 
            h.includes('narration') || h.includes('description') || h.includes('particular') ||
            h.includes('remark') || h.includes('detail') || h.includes('memo') || h.includes('reference')
          );
          const debitIdx = headers.findIndex((h: string) => 
            h.includes('debit') || h.includes('withdrawal') || h === 'dr' || h.includes('dr.')
          );
          const creditIdx = headers.findIndex((h: string) => 
            h.includes('credit') || h.includes('deposit') || h === 'cr' || h.includes('cr.')
          );
          const amountIdx = headers.findIndex((h: string) => 
            (h.includes('amount') || h === 'amt') && !h.includes('debit') && !h.includes('credit')
          );
          
          console.log('Column indices - date:', dateIdx, 'narration:', narrationIdx, 
                      'debit:', debitIdx, 'credit:', creditIdx, 'amount:', amountIdx);
          
          // If no narration column found, try to use any text-heavy column
          let effectiveNarrationIdx = narrationIdx;
          if (effectiveNarrationIdx === -1) {
            // Find the column with the longest average text content (excluding date/amount columns)
            const skipCols = new Set([dateIdx, debitIdx, creditIdx, amountIdx].filter(i => i >= 0));
            let maxAvgLength = 0;
            for (let col = 0; col < headers.length; col++) {
              if (skipCols.has(col)) continue;
              let totalLength = 0;
              let count = 0;
              for (let row = headerRow + 1; row < Math.min(headerRow + 20, jsonData.length); row++) {
                const cell = jsonData[row]?.[col];
                if (cell && typeof cell === 'string') {
                  totalLength += cell.length;
                  count++;
                }
              }
              const avgLength = count > 0 ? totalLength / count : 0;
              if (avgLength > maxAvgLength) {
                maxAvgLength = avgLength;
                effectiveNarrationIdx = col;
              }
            }
            console.log('Auto-detected narration column:', effectiveNarrationIdx, 'avg length:', maxAvgLength);
          }
          
          // Parse data rows
          for (let i = headerRow + 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.length === 0) continue;
            
            // Skip empty rows
            const nonEmptyCells = row.filter((cell: any) => cell !== null && cell !== undefined && cell !== '');
            if (nonEmptyCells.length < 2) continue;
            
            let date = dateIdx >= 0 ? row[dateIdx] : null;
            const narration = effectiveNarrationIdx >= 0 ? String(row[effectiveNarrationIdx] || '') : '';
            
            let amount = 0;
            let type: 'debit' | 'credit' = 'debit';
            
            if (debitIdx >= 0 && creditIdx >= 0) {
              const debitAmt = parseFloat(String(row[debitIdx] || '0').replace(/[^0-9.-]/g, '')) || 0;
              const creditAmt = parseFloat(String(row[creditIdx] || '0').replace(/[^0-9.-]/g, '')) || 0;
              
              if (debitAmt > 0) {
                amount = debitAmt;
                type = 'debit';
              } else if (creditAmt > 0) {
                amount = creditAmt;
                type = 'credit';
              }
            } else if (amountIdx >= 0) {
              const rawAmt = parseFloat(String(row[amountIdx] || '0').replace(/[^0-9.-]/g, '')) || 0;
              amount = Math.abs(rawAmt);
              type = rawAmt < 0 ? 'debit' : 'credit';
            } else {
              // Try to find any numeric column that could be an amount
              for (let col = 0; col < row.length; col++) {
                if (col === dateIdx || col === effectiveNarrationIdx) continue;
                const val = parseFloat(String(row[col] || '0').replace(/[^0-9.-]/g, ''));
                if (!isNaN(val) && val !== 0) {
                  amount = Math.abs(val);
                  type = val < 0 ? 'debit' : 'credit';
                  break;
                }
              }
            }
            
            // Be more lenient - allow transactions even without narration
            if (amount > 0) {
              // Parse date
              let parsedDate = '';
              if (date) {
                if (typeof date === 'number') {
                  // Excel serial date
                  const excelDate = new Date((date - 25569) * 86400 * 1000);
                  parsedDate = excelDate.toISOString().split('T')[0];
                } else {
                  parsedDate = String(date);
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
          }
          
          console.log('Parsed transactions:', transactions.length);
          if (transactions.length === 0 && jsonData.length > 1) {
            console.log('Sample data rows:', jsonData.slice(headerRow + 1, headerRow + 4));
          }
          
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
    // Convert file to base64
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix
        const base64Data = result.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    // Call edge function to parse PDF
    const response = await supabase.functions.invoke('parse-pdf-statement', {
      body: {
        pdfBase64: base64
      }
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    const data = response.data;

    // Handle various error codes
    if (data.code === 'PASSWORD_REQUIRED' || data.code === 'PASSWORD_INCORRECT' || 
        data.code === 'PDF_ENCRYPTED' || data.code === 'PDF_UNREADABLE') {
      const error = new Error(data.error);
      (error as any).code = data.code;
      (error as any).isPasswordProtected = data.isPasswordProtected;
      (error as any).suggestion = data.suggestion;
      throw error;
    }

    if (!data.success && data.error) {
      throw new Error(data.error);
    }

    // Map to Transaction interface
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

    // Use defaults if fields are empty
    const effectiveBusinessName = businessName.trim() || 'Default Business';
    const effectiveAccountName = accountName.trim() || 'Primary Account';

    setIsProcessing(true);
    
    try {
      let parsedTransactions: Transaction[];
      const isPdf = file.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        // Parse PDF file
        toast.info("Processing PDF file...");
        parsedTransactions = await parsePdfFile(file);
      } else {
        // Parse Excel/CSV file
        parsedTransactions = await parseExcelFile(file);
      }
      
      if (parsedTransactions.length === 0) {
        toast.error("No transactions found in the file");
        setIsProcessing(false);
        return;
      }

      toast.info(`Found ${parsedTransactions.length} transactions. Classifying...`);

      // Create upload session
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

      // Call edge function to classify
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
      
      // Fetch the stored transactions
      await fetchTransactions(uploadData.id);
      await fetchUploadHistory();
      
      // Reset form
      setFile(null);

    } catch (error: any) {
      console.error('Upload error:', error);
      
      // Handle password-related errors
      if (error.code === 'PASSWORD_REQUIRED' || error.code === 'PASSWORD_INCORRECT' || error.isPasswordProtected) {
        toast.error(error.message || 'PDF password required', { duration: 8000 });
        // Keep the file so user can try again
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
    // Update in database
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

    // Update local state
    setTransactions(prev => prev.map(t => 
      t.id === transactionId 
        ? { ...t, final_category: newCategory, is_reviewed: true }
        : t
    ));

    // Save as learning rule
    const transaction = transactions.find(t => t.id === transactionId);
    if (transaction && businessName) {
      // Extract key pattern from narration (first meaningful word)
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
    // Extract meaningful patterns for learning
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

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Smart Bank Statement Segregation</h1>
            <p className="text-muted-foreground mt-1">
              Automatically categorize your bank transactions • Not final accounting
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

              {/* PDF notice */}
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
                    <p className="text-xs text-muted-foreground">
                      Most banks offer Excel/CSV download options which work better for transaction extraction.
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
                  ₹{summary.totalCredit.toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Total Income</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-2xl font-bold text-destructive">
                  ₹{summary.totalDebit.toLocaleString()}
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

        {/* Filters and Export */}
        {transactions.length > 0 && (
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
        )}

        {/* Results Table */}
        {filteredTransactions.length > 0 && (
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
                        <TableCell className="text-sm">
                          {tx.transaction_date}
                        </TableCell>
                        <TableCell className="max-w-[300px] truncate" title={tx.narration}>
                          {tx.narration}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ₹{tx.amount.toLocaleString()}
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
                        <TableCell>
                          {getConfidenceBadge(tx.confidence_score)}
                        </TableCell>
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
                      setBusinessName(upload.business_name);
                      setAccountName(upload.account_name);
                      fetchTransactions(upload.id);
                      setCurrentUploadId(upload.id);
                    }}
                  >
                    <div>
                      <div className="font-medium">{upload.business_name} - {upload.account_name}</div>
                      <div className="text-sm text-muted-foreground">{upload.file_name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">{upload.total_transactions} transactions</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(upload.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Disclaimer */}
        <div className="text-center text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg">
          <AlertCircle className="h-4 w-4 inline mr-2" />
          This is not final accounting. No automatic posting or compliance claims. 
          Categories are AI-suggested and may require manual review.
        </div>
      </div>
    </Layout>
  );
}
