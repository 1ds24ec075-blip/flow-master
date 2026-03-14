import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Search, CheckCircle2, AlertCircle, HelpCircle, Link2, ArrowRight, Loader2 } from "lucide-react";

interface BankTransaction {
  id: string;
  transaction_date: string | null;
  description: string | null;
  amount: number | null;
  transaction_type: string | null;
  reference_number: string | null;
  matched_status: string;
}

interface MatchSuggestion {
  invoice_id: string;
  invoice_type: "client" | "supplier";
  invoice_number: string;
  invoice_amount: number;
  remaining_balance: number;
  entity_name: string;
  due_date: string | null;
  score: number;
  match_reasons: string[];
}

export default function Reconciliation() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedTxn, setSelectedTxn] = useState<BankTransaction | null>(null);
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState("unmatched");

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["reconciliation_transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_transactions")
        .select("id, transaction_date, description, amount, transaction_type, reference_number, matched_status")
        .order("transaction_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as BankTransaction[];
    },
  });

  const { data: allocationHistory = [] } = useQuery({
    queryKey: ["payment_allocations_history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_allocations")
        .select("*, bank_transactions(transaction_date, description, amount)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: ledgerSummary } = useQuery({
    queryKey: ["ledger_summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ledger_entries")
        .select("ledger_type, amount, status");
      if (error) throw error;

      const totals = { receivable: 0, payable: 0, payment: 0, reconciled: 0 };
      for (const e of data ?? []) {
        if (e.ledger_type === "receivable") totals.receivable += e.amount ?? 0;
        else if (e.ledger_type === "payable") totals.payable += e.amount ?? 0;
        else if (e.ledger_type === "payment") totals.payment += Math.abs(e.amount ?? 0);
        if (e.status === "reconciled") totals.reconciled += Math.abs(e.amount ?? 0);
      }
      return totals;
    },
  });

  const handleSuggest = async (txn: BankTransaction) => {
    setSelectedTxn(txn);
    setSuggestions([]);
    setAllocations({});
    setLoadingSuggestions(true);

    try {
      const { data, error } = await supabase.functions.invoke("reconcile-transactions", {
        body: { action: "suggest", transaction_id: txn.id },
      });
      if (error) throw error;
      setSuggestions(data.matches ?? []);
    } catch (err: any) {
      toast.error("Failed to get suggestions: " + err.message);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const allocs = Object.entries(allocations)
        .filter(([, amt]) => amt > 0)
        .map(([key, amt]) => {
          const suggestion = suggestions.find((s) => s.invoice_id === key);
          return {
            invoice_id: key,
            invoice_type: suggestion?.invoice_type ?? "client",
            allocated_amount: amt,
            match_score: suggestion?.score,
            match_method: "suggested",
          };
        });

      if (allocs.length === 0) throw new Error("No allocations to confirm");

      const { data, error } = await supabase.functions.invoke("reconcile-transactions", {
        body: { action: "confirm", transaction_id: selectedTxn!.id, allocations: allocs },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Allocations confirmed and aliases learned!");
      setSelectedTxn(null);
      queryClient.invalidateQueries({ queryKey: ["reconciliation_transactions"] });
      queryClient.invalidateQueries({ queryKey: ["payment_allocations_history"] });
      queryClient.invalidateQueries({ queryKey: ["ledger_summary"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const filtered = transactions.filter((t) => {
    const matchesSearch =
      !search ||
      t.description?.toLowerCase().includes(search.toLowerCase()) ||
      t.reference_number?.toLowerCase().includes(search.toLowerCase());
    if (activeTab === "unmatched") return matchesSearch && t.matched_status === "unmatched";
    if (activeTab === "confirmed") return matchesSearch && t.matched_status === "confirmed";
    return matchesSearch;
  });

  const totalAllocated = Object.values(allocations).reduce((s, v) => s + v, 0);
  const txnAmount = Math.abs(selectedTxn?.amount ?? 0);
  const remaining = txnAmount - totalAllocated;

  const statusBadge = (status: string) => {
    switch (status) {
      case "confirmed":
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle2 className="h-3 w-3 mr-1" />Confirmed</Badge>;
      case "suggested":
        return <Badge className="bg-amber-100 text-amber-700 border-amber-200"><HelpCircle className="h-3 w-3 mr-1" />Suggested</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground"><AlertCircle className="h-3 w-3 mr-1" />Unmatched</Badge>;
    }
  };

  const scoreColor = (score: number) => {
    if (score >= 70) return "text-emerald-600 bg-emerald-50";
    if (score >= 40) return "text-amber-600 bg-amber-50";
    return "text-red-600 bg-red-50";
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Bank Reconciliation</h1>
        <p className="text-sm text-muted-foreground mt-1">Match bank transactions to invoices and track payment allocations</p>
      </div>

      {/* Ledger Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Receivables</p>
            <p className="text-xl font-bold text-emerald-600">₹{(ledgerSummary?.receivable ?? 0).toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Payables</p>
            <p className="text-xl font-bold text-red-600">₹{(ledgerSummary?.payable ?? 0).toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Bank Payments</p>
            <p className="text-xl font-bold text-foreground">₹{(ledgerSummary?.payment ?? 0).toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Reconciled</p>
            <p className="text-xl font-bold text-blue-600">₹{(ledgerSummary?.reconciled ?? 0).toLocaleString("en-IN")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Transactions Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base">Bank Transactions</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search narration..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
            <TabsList className="h-8">
              <TabsTrigger value="unmatched" className="text-xs px-3">
                Unmatched ({transactions.filter((t) => t.matched_status === "unmatched").length})
              </TabsTrigger>
              <TabsTrigger value="confirmed" className="text-xs px-3">
                Confirmed ({transactions.filter((t) => t.matched_status === "confirmed").length})
              </TabsTrigger>
              <TabsTrigger value="all" className="text-xs px-3">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[50vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-24">Date</TableHead>
                  <TableHead className="text-xs">Narration</TableHead>
                  <TableHead className="text-xs w-20">Type</TableHead>
                  <TableHead className="text-xs w-28 text-right">Amount</TableHead>
                  <TableHead className="text-xs w-28">Status</TableHead>
                  <TableHead className="text-xs w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No transactions found</TableCell>
                  </TableRow>
                ) : (
                  filtered.map((txn) => (
                    <TableRow key={txn.id} className="text-sm">
                      <TableCell className="text-xs">{txn.transaction_date ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[250px] truncate">{txn.description ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] ${txn.transaction_type === "credit" ? "border-emerald-300 text-emerald-600" : "border-red-300 text-red-600"}`}>
                          {txn.transaction_type ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-xs">
                        ₹{Math.abs(txn.amount ?? 0).toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell>{statusBadge(txn.matched_status)}</TableCell>
                      <TableCell>
                        {txn.matched_status !== "confirmed" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleSuggest(txn)}>
                            <Link2 className="h-3 w-3 mr-1" />Match
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Allocation History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent Allocations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[30vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Bank Narration</TableHead>
                  <TableHead className="text-xs">Invoice</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs text-right">Allocated</TableHead>
                  <TableHead className="text-xs">Method</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocationHistory.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-muted-foreground text-sm">No allocations yet</TableCell>
                  </TableRow>
                ) : (
                  allocationHistory.map((a: any) => (
                    <TableRow key={a.id} className="text-xs">
                      <TableCell>{(a.bank_transactions as any)?.transaction_date ?? "—"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{(a.bank_transactions as any)?.description ?? "—"}</TableCell>
                      <TableCell>{a.invoice_id?.substring(0, 8)}...</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{a.invoice_type}</Badge></TableCell>
                      <TableCell className="text-right font-medium">₹{(a.allocated_amount ?? 0).toLocaleString("en-IN")}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{a.match_method}</Badge></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Match Dialog */}
      <Dialog open={!!selectedTxn} onOpenChange={(v) => !v && setSelectedTxn(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-5 w-5 text-primary" />
              Match Transaction to Invoices
            </DialogTitle>
          </DialogHeader>

          {selectedTxn && (
            <div className="space-y-4">
              {/* Transaction Summary */}
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="font-medium">{selectedTxn.transaction_date ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Amount</p>
                    <p className="font-bold text-lg">₹{txnAmount.toLocaleString("en-IN")}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Narration</p>
                    <p className="font-medium text-xs">{selectedTxn.description ?? "—"}</p>
                  </div>
                </div>
              </div>

              {/* Allocation Summary Bar */}
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">Allocated:</span>
                <span className="font-bold text-primary">₹{totalAllocated.toLocaleString("en-IN")}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Remaining:</span>
                <span className={`font-bold ${remaining < 0 ? "text-destructive" : remaining === 0 ? "text-emerald-600" : "text-foreground"}`}>
                  ₹{remaining.toLocaleString("en-IN")}
                </span>
              </div>

              {/* Suggestions */}
              {loadingSuggestions ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Analyzing matches...
                </div>
              ) : suggestions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No invoice matches found for this transaction.
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Suggested Matches</p>
                  {suggestions.map((s) => (
                    <div
                      key={s.invoice_id}
                      className={`rounded-lg border p-3 transition-colors ${allocations[s.invoice_id] ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{s.entity_name || "Unknown"}</span>
                            <Badge variant="outline" className="text-[10px]">{s.invoice_type}</Badge>
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${scoreColor(s.score)}`}>
                              {s.score}%
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Inv #{s.invoice_number} · Total: ₹{s.invoice_amount.toLocaleString("en-IN")} · Remaining: ₹{s.remaining_balance.toLocaleString("en-IN")}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {s.match_reasons.map((r, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px]">{r}</Badge>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            className="w-28 h-8 text-sm text-right"
                            placeholder="Amount"
                            value={allocations[s.invoice_id] ?? ""}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0;
                              setAllocations((prev) => ({ ...prev, [s.invoice_id]: Math.min(val, s.remaining_balance) }));
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-xs"
                            onClick={() => setAllocations((prev) => ({ ...prev, [s.invoice_id]: s.remaining_balance }))}
                          >
                            Full
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Confirm */}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setSelectedTxn(null)} className="flex-1 h-9 text-sm">
                  Cancel
                </Button>
                <Button
                  onClick={() => confirmMutation.mutate()}
                  disabled={confirmMutation.isPending || totalAllocated === 0}
                  className="flex-1 h-9 text-sm"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />
                  {confirmMutation.isPending ? "Confirming..." : `Confirm Allocation (₹${totalAllocated.toLocaleString("en-IN")})`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
