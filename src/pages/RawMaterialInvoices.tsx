import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SupplierSummaryCards } from "@/components/supplier-dashboard/SupplierSummaryCards";
import { PayablesCharts } from "@/components/supplier-dashboard/PayablesCharts";
import { SupplierTable, SupplierRow } from "@/components/supplier-dashboard/SupplierTable";
import { SupplierAlerts, AlertItem } from "@/components/supplier-dashboard/SupplierAlerts";
import { SupplierDetailDialog } from "@/components/supplier-dashboard/SupplierDetailDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, CheckCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";

export default function RawMaterialInvoices() {
  const [tab, setTab] = useState("dashboard");
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [detailSupplierId, setDetailSupplierId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ po_id: "", invoice_number: "", amount: "" });
  const queryClient = useQueryClient();

  // Queries
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers_all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["raw_material_invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_invoices")
        .select("*, purchase_orders(po_number), suppliers(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: purchaseOrders } = useQuery({
    queryKey: ["available_pos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_orders")
        .select("id, po_number")
        .in("status", ["sent", "processing"])
        .order("po_number");
      if (error) throw error;
      return data;
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("raw_material_invoices").insert({
        ...data, amount: parseFloat(data.amount), status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["raw_material_invoices"] });
      toast.success("Invoice uploaded successfully");
      setInvoiceDialogOpen(false);
      setFormData({ po_id: "", invoice_number: "", amount: "" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (invoice: any) => {
      await supabase.from("raw_material_invoices").update({ status: "approved" }).eq("id", invoice.id);
      await supabase.from("purchase_orders").update({ status: "materials_received" }).eq("id", invoice.po_id);
      await supabase.from("approvals").insert({ linked_invoice_type: "raw_materials", linked_invoice_id: invoice.id, status: "approved" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["raw_material_invoices"] });
      queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
      toast.success("Invoice approved");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("raw_material_invoices").update({ status: "rejected" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["raw_material_invoices"] });
      toast.success("Invoice rejected");
    },
  });

  // Computed data
  const supplierRows: SupplierRow[] = useMemo(() => {
    if (!suppliers || !invoices) return [];
    return suppliers.map((s) => {
      const sInvoices = invoices.filter((inv) => inv.supplier_id === s.id);
      const outstanding = sInvoices
        .filter((inv) => inv.status === "pending" || inv.status === "awaiting_approval")
        .reduce((sum, inv) => sum + (inv.amount || 0), 0);
      const overdue = sInvoices
        .filter((inv) => {
          if (inv.status !== "pending") return false;
          const created = new Date(inv.created_at || "");
          const daysSince = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
          return daysSince > ((s as any).credit_days || 30);
        })
        .reduce((sum, inv) => sum + (inv.amount || 0), 0);
      const lastOrder = sInvoices.length > 0 ? new Date(sInvoices[0].created_at || "").toLocaleDateString("en-IN") : null;
      const creditLimit = (s as any).credit_limit || 0;
      const creditDays = (s as any).credit_days || 30;
      const risk: "low" | "medium" | "high" =
        overdue > 0 || outstanding > creditLimit ? "high" :
        outstanding > creditLimit * 0.8 ? "medium" : "low";

      return { id: s.id, name: s.name, material_type: s.material_type, outstanding, overdue, credit_limit: creditLimit, credit_days: creditDays, last_order_date: lastOrder, risk };
    });
  }, [suppliers, invoices]);

  const summaryData = useMemo(() => ({
    totalActive: suppliers?.length || 0,
    totalPayables: supplierRows.reduce((s, r) => s + r.outstanding, 0),
    overdueAmount: supplierRows.reduce((s, r) => s + r.overdue, 0),
    dueThisWeek: invoices?.filter((inv) => {
      if (inv.status !== "pending") return false;
      const created = new Date(inv.created_at || "");
      const daysOld = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
      return daysOld <= 7;
    }).length || 0,
    riskSuppliers: supplierRows.filter((r) => r.risk === "high").length,
  }), [suppliers, supplierRows, invoices]);

  const agingData = useMemo(() => {
    if (!invoices) return [];
    const buckets = { "0-30": 0, "30-60": 0, "60-90": 0, "90+": 0 };
    invoices.filter((inv) => inv.status === "pending" || inv.status === "awaiting_approval").forEach((inv) => {
      const days = (Date.now() - new Date(inv.created_at || "").getTime()) / (1000 * 60 * 60 * 24);
      if (days <= 30) buckets["0-30"] += inv.amount || 0;
      else if (days <= 60) buckets["30-60"] += inv.amount || 0;
      else if (days <= 90) buckets["60-90"] += inv.amount || 0;
      else buckets["90+"] += inv.amount || 0;
    });
    return Object.entries(buckets).map(([range, amount]) => ({ range, amount }));
  }, [invoices]);

  const topSuppliers = useMemo(() => {
    return [...supplierRows]
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 5)
      .filter((s) => s.outstanding > 0)
      .map((s) => ({ name: s.name, amount: s.outstanding }));
  }, [supplierRows]);

  const alerts: AlertItem[] = useMemo(() => {
    const result: AlertItem[] = [];
    supplierRows.forEach((s) => {
      if (s.overdue > 0) result.push({ type: "overdue", message: `₹${s.overdue.toLocaleString("en-IN")} overdue`, supplierName: s.name });
      if (s.credit_limit > 0 && s.outstanding > s.credit_limit) result.push({ type: "credit_exceeded", message: `Outstanding exceeds credit limit by ₹${(s.outstanding - s.credit_limit).toLocaleString("en-IN")}`, supplierName: s.name });
      if (s.risk === "high") result.push({ type: "high_risk", message: "High risk supplier", supplierName: s.name });
    });
    return result;
  }, [supplierRows]);

  // Detail dialog
  const detailSupplier = useMemo(() => {
    if (!detailSupplierId || !suppliers || !invoices) return null;
    const s = suppliers.find((sup) => sup.id === detailSupplierId);
    if (!s) return null;
    const sInvoices = invoices.filter((inv) => inv.supplier_id === s.id);
    const totalPurchases = sInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
    const totalPaid = sInvoices.filter((inv) => inv.status === "approved").reduce((sum, inv) => sum + (inv.amount || 0), 0);
    return {
      id: s.id, name: s.name, email: s.email, gst_number: s.gst_number,
      material_type: s.material_type, payment_terms: s.payment_terms,
      credit_limit: (s as any).credit_limit || 0, credit_days: (s as any).credit_days || 30,
      totalPurchases, totalPaid, outstanding: totalPurchases - totalPaid,
      invoices: sInvoices.map((inv) => ({ id: inv.id, invoice_number: inv.invoice_number, amount: inv.amount, status: inv.status || "pending", created_at: inv.created_at })),
    };
  }, [detailSupplierId, suppliers, invoices]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Supplier Invoices</h1>
          <p className="text-muted-foreground">Dashboard, invoices & supplier management</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4 mt-4">
          <SupplierAlerts alerts={alerts} />
          <SupplierSummaryCards data={summaryData} />
          <PayablesCharts agingData={agingData} topSuppliers={topSuppliers} />
          <div>
            <h3 className="text-lg font-semibold mb-3">All Suppliers</h3>
            <SupplierTable suppliers={supplierRows} onViewDetails={(id) => setDetailSupplierId(id)} />
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={invoiceDialogOpen} onOpenChange={(o) => { setInvoiceDialogOpen(o); if (!o) setFormData({ po_id: "", invoice_number: "", amount: "" }); }}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4 mr-2" />Upload Invoice</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Upload Supplier Invoice</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(formData); }} className="space-y-4">
                  <div>
                    <Label>Purchase Order *</Label>
                    <Select value={formData.po_id} onValueChange={(v) => setFormData({ ...formData, po_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select PO" /></SelectTrigger>
                      <SelectContent>
                        {purchaseOrders?.map((po) => (<SelectItem key={po.id} value={po.id}>{po.po_number}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Invoice Number *</Label>
                    <Input value={formData.invoice_number} onChange={(e) => setFormData({ ...formData, invoice_number: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Amount *</Label>
                    <Input type="number" step="0.01" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} required />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setInvoiceDialogOpen(false)}>Cancel</Button>
                    <Button type="submit">Upload</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="bg-card rounded-lg border">
            {invoicesLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading...</div>
            ) : invoices && invoices.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                      <TableCell>{invoice.purchase_orders?.po_number}</TableCell>
                      <TableCell>{invoice.suppliers?.name || "-"}</TableCell>
                      <TableCell>₹{invoice.amount?.toLocaleString()}</TableCell>
                      <TableCell><StatusBadge status={invoice.status as any} /></TableCell>
                      <TableCell className="text-right space-x-2">
                        {invoice.status === "pending" && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => approveMutation.mutate(invoice)}>
                              <CheckCircle className="h-4 w-4 mr-1" />Approve
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => rejectMutation.mutate(invoice.id)}>
                              <XCircle className="h-4 w-4 mr-1" />Reject
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-8 text-center text-muted-foreground">No invoices found. Upload supplier invoices to get started.</div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <SupplierDetailDialog
        supplier={detailSupplier}
        open={!!detailSupplierId}
        onOpenChange={(o) => { if (!o) setDetailSupplierId(null); }}
      />
    </div>
  );
}
