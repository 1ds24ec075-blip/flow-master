import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activityLogger";
import { 
  Upload, 
  FileText, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw
} from "lucide-react";
import { format, startOfMonth, addMonths, subMonths } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface Transaction {
  date: string;
  description: string;
  amount: number;
  type: "credit" | "debit";
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

interface ParseResult {
  transactions: Transaction[];
  verification_results: VerificationResult[];
  summary: {
    total_transactions: number;
    total_bills: number;
    matched_bills: number;
    unmatched_bills: number;
    high_confidence_matches: number;
    medium_confidence_matches: number;
    low_confidence_matches: number;
  };
}

export default function BankStatementParser() {
  const [statementText, setStatementText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (uploadedFile) {
      setFile(uploadedFile);
      setError(null);

      // For text files, read content
      if (uploadedFile.type === "text/plain") {
        const reader = new FileReader();
        reader.onload = (event) => {
          setStatementText(event.target?.result as string);
        };
        reader.readAsText(uploadedFile);
      }
    }
  };

  const handleParse = async () => {
    if (!statementText && !file) {
      toast.error("Please upload a file or paste statement text");
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      let payload: Record<string, any> = {
        fileName: file?.name || "pasted_statement.txt",
        month: format(startOfMonth(selectedMonth), 'yyyy-MM-dd'),
      };

      if (file && file.type === "application/pdf") {
        // Convert PDF to base64
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        payload.pdfBase64 = base64;
      } else {
        payload.statementText = statementText;
      }

      const { data, error: parseError } = await supabase.functions.invoke(
        "bank-statement-parser",
        { body: payload }
      );

      if (parseError) throw parseError;

      setResult(data);
      
      await logActivity({
        activityType: "parse",
        entityType: "bank_statement",
        status: "success",
        metadata: { 
          fileName: file?.name,
          month: format(selectedMonth, 'MMMM yyyy'),
          transactionsCount: data.transactions?.length,
          matchedBills: data.summary?.matched_bills,
        },
      });

      toast.success(`Parsed ${data.transactions?.length || 0} transactions, matched ${data.summary?.matched_bills || 0} bills`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to parse statement";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreviousMonth = () => {
    setSelectedMonth(prev => subMonths(prev, 1));
    setResult(null);
  };

  const handleNextMonth = () => {
    setSelectedMonth(prev => addMonths(prev, 1));
    setResult(null);
  };

  const exportJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bank_verification_${format(selectedMonth, 'yyyy-MM')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getConfidenceBadge = (confidence: string | null) => {
    switch (confidence) {
      case 'high':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">High</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Medium</Badge>;
      case 'low':
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Low</Badge>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Bank Statement Parser</h1>
          <p className="text-muted-foreground mt-1">
            Upload bank statements to verify expenses against recorded bills
          </p>
        </div>
        
        {/* Month Selector */}
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-4 py-2">
          <Button variant="ghost" size="icon" onClick={handlePreviousMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-medium min-w-[140px] text-center">
            {format(selectedMonth, 'MMMM yyyy')}
          </span>
          <Button variant="ghost" size="icon" onClick={handleNextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
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
            Upload a bank statement (PDF or text) to automatically verify bills for {format(selectedMonth, 'MMMM yyyy')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Upload File (PDF or Text)</Label>
              <Input
                type="file"
                accept=".txt,.pdf"
                onChange={handleFileUpload}
                className="cursor-pointer"
              />
              {file && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  {file.name}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Or Paste Statement Text</Label>
              <Textarea
                placeholder="Paste your bank statement text here..."
                value={statementText}
                onChange={(e) => setStatementText(e.target.value)}
                rows={4}
                disabled={file?.type === "application/pdf"}
              />
            </div>
          </div>

          <Button onClick={handleParse} disabled={isLoading} className="w-full">
            {isLoading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Parse & Verify Bills
              </>
            )}
          </Button>

          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Section */}
      {result && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card className="bg-card">
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{result.summary.total_transactions}</p>
                  <p className="text-sm text-muted-foreground">Transactions</p>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-card">
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">{result.summary.total_bills}</p>
                  <p className="text-sm text-muted-foreground">Bills to Verify</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-green-500/10 border-green-500/30">
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-400">{result.summary.matched_bills}</p>
                  <p className="text-sm text-green-400/80">Verified</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-red-500/10 border-red-500/30">
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-400">{result.summary.unmatched_bills}</p>
                  <p className="text-sm text-red-400/80">Unverified</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card">
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {result.summary.total_bills > 0 
                      ? Math.round((result.summary.matched_bills / result.summary.total_bills) * 100) 
                      : 0}%
                  </p>
                  <p className="text-sm text-muted-foreground">Match Rate</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Verified Bills */}
          {result.verification_results.filter(r => r.matched).length > 0 && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-green-400">
                    <CheckCircle className="h-5 w-5" />
                    Verified Bills ({result.summary.matched_bills})
                  </CardTitle>
                  <CardDescription>
                    Bills matched with bank transactions
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={exportJson}>
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Bill Amount</TableHead>
                      <TableHead>Bill Date</TableHead>
                      <TableHead>Transaction</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Match Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.verification_results
                      .filter(r => r.matched)
                      .map((item) => (
                        <TableRow key={item.bill_id}>
                          <TableCell className="font-medium">{item.bill_vendor}</TableCell>
                          <TableCell>₹{item.bill_amount.toLocaleString()}</TableCell>
                          <TableCell>{item.bill_date}</TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <p className="text-muted-foreground">{item.matched_transaction?.description}</p>
                              <p className="font-medium">₹{item.matched_transaction?.amount.toLocaleString()}</p>
                            </div>
                          </TableCell>
                          <TableCell>{getConfidenceBadge(item.match_confidence)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[200px]">
                            {item.match_reason}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Unverified Bills */}
          {result.verification_results.filter(r => !r.matched).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-400">
                  <XCircle className="h-5 w-5" />
                  Unverified Bills ({result.summary.unmatched_bills})
                </CardTitle>
                <CardDescription>
                  Bills without matching bank transactions - may need manual review
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Bill Number</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.verification_results
                      .filter(r => !r.matched)
                      .map((item) => (
                        <TableRow key={item.bill_id}>
                          <TableCell className="font-medium">{item.bill_vendor}</TableCell>
                          <TableCell>{item.bill_number || '-'}</TableCell>
                          <TableCell>₹{item.bill_amount.toLocaleString()}</TableCell>
                          <TableCell>{item.bill_date}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-yellow-400 border-yellow-400/30">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              No Match
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* All Transactions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                All Transactions ({result.transactions.length})
              </CardTitle>
              <CardDescription>
                Extracted transactions from the bank statement
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.transactions.map((tx, index) => (
                    <TableRow key={index}>
                      <TableCell>{tx.date}</TableCell>
                      <TableCell className="max-w-[300px] truncate">{tx.description}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            tx.type === "credit"
                              ? "text-green-400 border-green-400/30"
                              : "text-red-400 border-red-400/30"
                          }
                        >
                          {tx.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ₹{tx.amount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
