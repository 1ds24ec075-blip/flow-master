import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { supabase } from "@/integrations/supabase/client";
import { LiquidityLineItem } from "@/hooks/useLiquidity";
import { format } from "date-fns";

function formatINR(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

interface SupplierInfo {
  id: string;
  name: string;
  email: string | null;
  gst_number: string | null;
  material_type: string | null;
  payment_terms: string | null;
  credit_limit: number;
  credit_days: number;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  amount: number | null;
  status: string;
  due_date: string | null;
  created_at: string | null;
}

interface Props {
  item: LiquidityLineItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SupplierPaymentDetail({ item, open, onOpenChange }: Props) {
  const [supplier, setSupplier] = useState<SupplierInfo | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item || !open) return;
    setLoading(true);

    (async () => {
      // Get supplier_id from the linked invoice
      if (item.linked_invoice_id && item.linked_invoice_type === "supplier") {
        const { data: inv } = await supabase
          .from("raw_material_invoices")
          .select("supplier_id")
          .eq("id", item.linked_invoice_id)
          .maybeSingle();

        if (inv?.supplier_id) {
          const { data: sup } = await supabase
            .from("suppliers")
            .select("*")
            .eq("id", inv.supplier_id)
            .maybeSingle();

          if (sup) {
            setSupplier({
              id: sup.id,
              name: sup.name,
              email: sup.email,
              gst_number: sup.gst_number,
              material_type: sup.material_type,
              payment_terms: sup.payment_terms,
              credit_limit: sup.credit_limit || 0,
              credit_days: sup.credit_days || 30,
            });

            const { data: allInv } = await supabase
              .from("raw_material_invoices")
              .select("id, invoice_number, amount, status, due_date, created_at")
              .eq("supplier_id", inv.supplier_id)
              .order("created_at", { ascending: false });

            setInvoices((allInv || []) as InvoiceRow[]);
          }
        }
      }
      setLoading(false);
    })();
  }, [item, open]);

  if (!item) return null;

  const totalPurchases = invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const totalPaid = invoices.filter(i => i.status === "approved").reduce((s, i) => s + (i.amount || 0), 0);
  const outstanding = totalPurchases - totalPaid;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{loading ? "Loading..." : supplier?.name || "Supplier Details"}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">Loading supplier details...</div>
        ) : !supplier ? (
          <div className="py-8 text-center text-muted-foreground">
            <p className="font-medium mb-1">Manual Entry</p>
            <p className="text-sm">{item.description}</p>
            <p className="text-sm mt-2">Expected: {formatINR(Number(item.expected_amount))}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Supplier Info */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Email:</span> {supplier.email || "—"}</div>
              <div><span className="text-muted-foreground">GST:</span> {supplier.gst_number || "—"}</div>
              <div><span className="text-muted-foreground">Category:</span> {supplier.material_type || "—"}</div>
              <div><span className="text-muted-foreground">Payment Terms:</span> {supplier.payment_terms || "—"}</div>
              <div><span className="text-muted-foreground">Credit Limit:</span> {formatINR(supplier.credit_limit)}</div>
              <div><span className="text-muted-foreground">Credit Days:</span> {supplier.credit_days}</div>
            </div>

            {/* Financials */}
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Total Purchases</CardTitle></CardHeader>
                <CardContent><p className="text-lg font-bold">{formatINR(totalPurchases)}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Total Paid</CardTitle></CardHeader>
                <CardContent><p className="text-lg font-bold text-emerald-600">{formatINR(totalPaid)}</p></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">Outstanding</CardTitle></CardHeader>
                <CardContent><p className={`text-lg font-bold ${outstanding > 0 ? "text-destructive" : ""}`}>{formatINR(outstanding)}</p></CardContent>
              </Card>
            </div>

            {/* Current Payment Info */}
            <div className="p-3 rounded-lg border bg-muted/30">
              <p className="text-xs text-muted-foreground mb-1">Current Payment Item</p>
              <p className="text-sm font-medium">{item.description}</p>
              <div className="flex gap-4 mt-1 text-sm">
                <span>Expected: {formatINR(Number(item.expected_amount))}</span>
                {item.due_date && <span>Due: {format(new Date(item.due_date), "dd MMM yyyy")}</span>}
                <Badge variant={item.status === "completed" ? "default" : item.status === "overdue" ? "destructive" : "outline"}>{item.status}</Badge>
              </div>
            </div>

            {/* Invoice Ledger */}
            <div>
              <h4 className="text-sm font-medium mb-2">Invoice Ledger</h4>
              <div className="bg-card rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">No invoices</TableCell></TableRow>
                    ) : invoices.map(inv => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                        <TableCell className="text-right">{formatINR(inv.amount || 0)}</TableCell>
                        <TableCell><StatusBadge status={inv.status as any} /></TableCell>
                        <TableCell>{inv.due_date ? format(new Date(inv.due_date), "dd MMM yyyy") : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
