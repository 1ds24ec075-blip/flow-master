import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Upload, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface Transaction {
  date: string;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
}

interface Match {
  expense_name: string;
  amount: number;
  matched_with: Transaction | null;
}

interface ParseResult {
  transactions: Transaction[];
  matches: Match[];
}

export default function BankStatementParser() {
  const [statementText, setStatementText] = useState('');
  const [fileName, setFileName] = useState('');
  const [expensesJson, setExpensesJson] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState('');
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [isPdf, setIsPdf] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const isPdfFile = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    setIsPdf(isPdfFile);

    const reader = new FileReader();

    if (isPdfFile) {
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setPdfBase64(base64);
        setStatementText(''); // Clear text when PDF is uploaded
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setStatementText(text);
        setPdfBase64(null);
      };
      reader.readAsText(file);
    }
  };

  const handleParse = async () => {
    if (!statementText.trim() && !pdfBase64) {
      setError('Please provide bank statement text or upload a PDF');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      let expenses = [];
      if (expensesJson.trim()) {
        try {
          expenses = JSON.parse(expensesJson);
        } catch {
          throw new Error('Invalid expenses JSON format');
        }
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bank-statement-parser`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          statementText: isPdf ? '' : statementText,
          pdfBase64: isPdf ? pdfBase64 : null,
          expenses,
          fileName: fileName || 'uploaded_statement.txt',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to parse statement');
      }

      const data = await response.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to parse bank statement');
    } finally {
      setLoading(false);
    }
  };

  const exportJson = () => {
    if (!result) return;

    const dataStr = JSON.stringify(result, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = 'bank_statement_parsed.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Bank Statement Parser</h1>
        <p className="text-muted-foreground">
          Upload and parse bank statements to extract transactions and match with expenses
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Statement
            </CardTitle>
            <CardDescription>
              Upload a text file or paste your bank statement content
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file-upload">Upload File (PDF, TXT, CSV)</Label>
              <Input
                id="file-upload"
                type="file"
                accept=".pdf,.txt,.csv"
                onChange={handleFileUpload}
                disabled={loading}
              />
              {isPdf && pdfBase64 && (
                <p className="text-sm text-muted-foreground">
                  PDF uploaded: {fileName} - AI will extract transactions from the document
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="statement-text">Or Paste Statement Text</Label>
              <Textarea
                id="statement-text"
                placeholder="Paste your bank statement here..."
                value={statementText}
                onChange={(e) => setStatementText(e.target.value)}
                rows={10}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expenses-json">Expenses (Optional JSON)</Label>
              <Textarea
                id="expenses-json"
                placeholder='[{"amount": 5000, "name": "Swiggy"}, {"amount": 12000, "name": "Internet Bill"}]'
                value={expensesJson}
                onChange={(e) => setExpensesJson(e.target.value)}
                rows={4}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Format: [&#123;"amount": number, "name": "string"&#125;]
              </p>
            </div>

            <Button
              onClick={handleParse}
              disabled={loading || (!statementText.trim() && !pdfBase64)}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Parsing...
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Parse Statement
                </>
              )}
            </Button>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Results</CardTitle>
                <Button onClick={exportJson} variant="outline" size="sm">
                  Export JSON
                </Button>
              </div>
              <CardDescription>
                Found {result.transactions.length} transactions
                {result.matches.length > 0 && ` and ${result.matches.length} expense matches`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <h3 className="font-semibold">Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Total Credits</p>
                    <p className="text-2xl font-bold text-green-600">
                      ₹{result.transactions
                        .filter(t => t.type === 'credit')
                        .reduce((sum, t) => sum + t.amount, 0)
                        .toFixed(2)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Total Debits</p>
                    <p className="text-2xl font-bold text-red-600">
                      ₹{result.transactions
                        .filter(t => t.type === 'debit')
                        .reduce((sum, t) => sum + t.amount, 0)
                        .toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>

              {result.matches.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold">Expense Matches</h3>
                  <div className="space-y-2">
                    {result.matches.map((match, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div>
                          <p className="font-medium">{match.expense_name}</p>
                          <p className="text-sm text-muted-foreground">₹{match.amount}</p>
                        </div>
                        {match.matched_with ? (
                          <Badge variant="default" className="gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Matched
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <XCircle className="h-3 w-3" />
                            Not Found
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {result && result.transactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extracted Transactions</CardTitle>
            <CardDescription>All transactions found in the statement</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
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
                  {result.transactions.map((transaction, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">
                        {transaction.date || 'N/A'}
                      </TableCell>
                      <TableCell>{transaction.description || 'N/A'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={transaction.type === 'credit' ? 'default' : 'secondary'}
                        >
                          {transaction.type}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold ${
                          transaction.type === 'credit' ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        ₹{transaction.amount?.toFixed(2) || '0.00'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
