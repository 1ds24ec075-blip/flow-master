import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";

interface Invoice {
  id: string;
  invoice_number: string;
  amount: number | null;
  status: string;
  created_at: string | null;
}

interface SupplierDetail {
  id: string;
  name: string;
  email: string | null;
  gst_number: string | null;
  material_type: string | null;
  payment_terms: string | null;
  credit_limit: number;
  credit_days: number;
  totalPurchases: number;
  totalPaid: number;
  outstanding: number;
  invoices: Invoice[];
}

interface Props {
  supplier: SupplierDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SupplierDetailDialog({ supplier, open, onOpenChange }: Props) {
  if (!supplier) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{supplier.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Email:</span> {supplier.email || "-"}</div>
            <div><span className="text-muted-foreground">GST:</span> {supplier.gst_number || "-"}</div>
            <div><span className="text-muted-foreground">Category:</span> {supplier.material_type || "-"}</div>
            <div><span className="text-muted-foreground">Payment Terms:</span> {supplier.payment_terms || "-"}</div>
            <div><span className="text-muted-foreground">Credit Limit:</span> ₹{supplier.credit_limit.toLocaleString("en-IN")}</div>
            <div><span className="text-muted-foreground">Credit Days:</span> {supplier.credit_days}</div>
          </div>

          {/* Financials */}
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">Total Purchases</CardTitle>
              </CardHeader>
              <CardContent><p className="text-lg font-bold">₹{supplier.totalPurchases.toLocaleString("en-IN")}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">Total Paid</CardTitle>
              </CardHeader>
              <CardContent><p className="text-lg font-bold text-emerald-600">₹{supplier.totalPaid.toLocaleString("en-IN")}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">Outstanding</CardTitle>
              </CardHeader>
              <CardContent><p className={`text-lg font-bold ${supplier.outstanding > 0 ? "text-destructive" : ""}`}>₹{supplier.outstanding.toLocaleString("en-IN")}</p></CardContent>
            </Card>
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
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplier.invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-4">No invoices</TableCell>
                    </TableRow>
                  ) : (
                    supplier.invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">{inv.invoice_number}</TableCell>
                        <TableCell className="text-right">₹{(inv.amount || 0).toLocaleString("en-IN")}</TableCell>
                        <TableCell><StatusBadge status={inv.status as any} /></TableCell>
                        <TableCell>{inv.created_at ? new Date(inv.created_at).toLocaleDateString("en-IN") : "-"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
