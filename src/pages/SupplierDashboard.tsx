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
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, CheckCircle, XCircle, Edit, Trash2, Upload, FileText } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";

export default function SupplierDashboard() {
  const [tab, setTab] = useState("dashboard");
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [detailSupplierId, setDetailSupplierId] = useState<string | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<any>(null);
  const [formData, setFormData] = useState({ po_id: "", supplier_id: "", invoice_number: "", amount: "", invoice_date: "" });
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [supplierForm, setSupplierForm] = useState({
    name: "", email: "", gst_number: "", material_type: "", payment_terms: "",
    notes: "", bank_account: "", bank_name: "", upi_payment_patterns: "",
  });
  const queryClient = useQueryClient();

  const resetSupplierForm = () => {
    setSupplierForm({ name: "", email: "", gst_number: "", material_type: "", payment_terms: "", notes: "", bank_account: "", bank_name: "", upi_payment_patterns: "" });
    setEditingSupplier(null);
  };

  // Queries
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("*").order("name");
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
      const { data, error } = await supabase.from("purchase_orders").select("id, po_number").in("status", ["sent", "processing"]).order("po_number");
      if (error) throw error;
      return data;
    },
  });

  // Invoice Mutations
  const createInvoiceMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      let invoice_file: string | null = null;

      // Upload file if provided
      if (invoiceFile) {
        const fileExt = invoiceFile.name.split(".").pop();
        const filePath = `supplier-invoices/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage.from("bills").upload(filePath, invoiceFile);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("bills").getPublicUrl(filePath);
        invoice_file = urlData.publicUrl;
      }

      const insertData: any = {
        invoice_number: data.invoice_number,
        amount: parseFloat(data.amount),
        status: "pending",
        supplier_id: data.supplier_id || null,
        po_id: data.po_id || null,
        invoice_file,
      };

      const { error } = await supabase.from("raw_material_invoices").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["raw_material_invoices"] });
      toast.success("Invoice uploaded");
      setInvoiceDialogOpen(false);
      setFormData({ po_id: "", supplier_id: "", invoice_number: "", amount: "", invoice_date: "" });
      setInvoiceFile(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to upload invoice");
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

  // Supplier Mutations
  const createSupplierMutation = useMutation({
    mutationFn: async (data: typeof supplierForm) => {
      const { error } = await supabase.from("suppliers").insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers_all"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier created");
      setSupplierDialogOpen(false);
      resetSupplierForm();
    },
  });

  const updateSupplierMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof supplierForm }) => {
      const { error } = await supabase.from("suppliers").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers_all"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier updated");
      setSupplierDialogOpen(false);
      resetSupplierForm();
    },
  });

  const deleteSupplierMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suppliers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["suppliers_all"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier deleted");
    },
  });

  const handleEditSupplier = (supplier: any) => {
    setEditingSupplier(supplier);
    setSupplierForm({
      name: supplier.name || "", email: supplier.email || "", gst_number: supplier.gst_number || "",
      material_type: supplier.material_type || "", payment_terms: supplier.payment_terms || "",
      notes: supplier.notes || "", bank_account: supplier.bank_account || "",
      bank_name: supplier.bank_name || "", upi_payment_patterns: supplier.upi_payment_patterns || "",
    });
    setSupplierDialogOpen(true);
  };

  const handleSupplierSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSupplier) {
      updateSupplierMutation.mutate({ id: editingSupplier.id, data: supplierForm });
    } else {
      createSupplierMutation.mutate(supplierForm);
    }
  };

  // Computed data
  const supplierRows: SupplierRow[] = useMemo(() => {
    if (!suppliers || !invoices) return [];
    return suppliers.map((s) => {
      const sInvoices = invoices.filter((inv) => inv.supplier_id === s.id);
      const outstanding = sInvoices.filter((inv) => inv.status === "pending" || inv.status === "awaiting_approval").reduce((sum, inv) => sum + (inv.amount || 0), 0);
      const overdue = sInvoices.filter((inv) => {
        if (inv.status !== "pending") return false;
        const created = new Date(inv.created_at || "");
        return (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24) > ((s as any).credit_days || 30);
      }).reduce((sum, inv) => sum + (inv.amount || 0), 0);
      const lastOrder = sInvoices.length > 0 ? new Date(sInvoices[0].created_at || "").toLocaleDateString("en-IN") : null;
      const creditLimit = (s as any).credit_limit || 0;
      const creditDays = (s as any).credit_days || 30;
      const risk: "low" | "medium" | "high" = overdue > 0 || outstanding > creditLimit ? "high" : outstanding > creditLimit * 0.8 ? "medium" : "low";
      return { id: s.id, name: s.name, material_type: s.material_type, outstanding, overdue, credit_limit: creditLimit, credit_days: creditDays, last_order_date: lastOrder, risk };
    });
  }, [suppliers, invoices]);

  const summaryData = useMemo(() => ({
    totalActive: suppliers?.length || 0,
    totalPayables: supplierRows.reduce((s, r) => s + r.outstanding, 0),
    overdueAmount: supplierRows.reduce((s, r) => s + r.overdue, 0),
    dueThisWeek: invoices?.filter((inv) => inv.status === "pending" && (Date.now() - new Date(inv.created_at || "").getTime()) / (1000 * 60 * 60 * 24) <= 7).length || 0,
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

  const topSuppliers = useMemo(() => [...supplierRows].sort((a, b) => b.outstanding - a.outstanding).slice(0, 5).filter((s) => s.outstanding > 0).map((s) => ({ name: s.name, amount: s.outstanding })), [supplierRows]);

  const alerts: AlertItem[] = useMemo(() => {
    const result: AlertItem[] = [];
    supplierRows.forEach((s) => {
      if (s.overdue > 0) result.push({ type: "overdue", message: `₹${s.overdue.toLocaleString("en-IN")} overdue`, supplierName: s.name });
      if (s.credit_limit > 0 && s.outstanding > s.credit_limit) result.push({ type: "credit_exceeded", message: `Outstanding exceeds credit limit by ₹${(s.outstanding - s.credit_limit).toLocaleString("en-IN")}`, supplierName: s.name });
      if (s.risk === "high") result.push({ type: "high_risk", message: "High risk supplier", supplierName: s.name });
    });
    return result;
  }, [supplierRows]);

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
          <h1 className="text-3xl font-bold">Supplier Hub</h1>
          <p className="text-muted-foreground">Suppliers, invoices & payables — all in one place</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers ({suppliers?.length || 0})</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard" className="space-y-4 mt-4">
          <SupplierAlerts alerts={alerts} />
          <SupplierSummaryCards data={summaryData} />
          <PayablesCharts agingData={agingData} topSuppliers={topSuppliers} />
          <div>
            <h3 className="text-lg font-semibold mb-3">All Suppliers</h3>
            <SupplierTable suppliers={supplierRows} onViewDetails={(id) => setDetailSupplierId(id)} />
          </div>
        </TabsContent>

        {/* Suppliers Tab */}
        <TabsContent value="suppliers" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={supplierDialogOpen} onOpenChange={(o) => { setSupplierDialogOpen(o); if (!o) resetSupplierForm(); }}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Supplier</Button></DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[85vh]">
                <DialogHeader><DialogTitle>{editingSupplier ? "Edit Supplier" : "Add New Supplier"}</DialogTitle></DialogHeader>
                <ScrollArea className="max-h-[70vh] pr-4">
                  <form onSubmit={handleSupplierSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div><Label>Supplier Name *</Label><Input value={supplierForm.name} onChange={e => setSupplierForm({ ...supplierForm, name: e.target.value })} required /></div>
                      <div><Label>Email</Label><Input type="email" value={supplierForm.email} onChange={e => setSupplierForm({ ...supplierForm, email: e.target.value })} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><Label>GST Number</Label><Input value={supplierForm.gst_number} onChange={e => setSupplierForm({ ...supplierForm, gst_number: e.target.value })} /></div>
                      <div><Label>Material Type</Label><Input value={supplierForm.material_type} onChange={e => setSupplierForm({ ...supplierForm, material_type: e.target.value })} /></div>
                    </div>
                    <div><Label>Payment Terms</Label><Input value={supplierForm.payment_terms} onChange={e => setSupplierForm({ ...supplierForm, payment_terms: e.target.value })} /></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><Label>Bank Account</Label><Input value={supplierForm.bank_account} onChange={e => setSupplierForm({ ...supplierForm, bank_account: e.target.value })} /></div>
                      <div><Label>Bank Name</Label><Input value={supplierForm.bank_name} onChange={e => setSupplierForm({ ...supplierForm, bank_name: e.target.value })} /></div>
                    </div>
                    <div><Label>UPI / Payment Patterns</Label><Textarea value={supplierForm.upi_payment_patterns} onChange={e => setSupplierForm({ ...supplierForm, upi_payment_patterns: e.target.value })} placeholder="comma separated" /></div>
                    <div><Label>Notes</Label><Textarea value={supplierForm.notes} onChange={e => setSupplierForm({ ...supplierForm, notes: e.target.value })} /></div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={() => setSupplierDialogOpen(false)}>Cancel</Button>
                      <Button type="submit">{editingSupplier ? "Update" : "Create"}</Button>
                    </div>
                  </form>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>

          <div className="bg-card rounded-lg border">
            {!suppliers || suppliers.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No suppliers yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Material Type</TableHead>
                    <TableHead>GST Number</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((supplier) => (
                    <TableRow key={supplier.id}>
                      <TableCell className="font-medium">{supplier.name}</TableCell>
                      <TableCell>{supplier.email || "-"}</TableCell>
                      <TableCell>{supplier.material_type || "-"}</TableCell>
                      <TableCell>{supplier.gst_number || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleEditSupplier(supplier)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => { if (confirm("Delete this supplier?")) deleteSupplierMutation.mutate(supplier.id); }}><Trash2 className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices" className="space-y-4 mt-4">
          <div className="flex justify-end">
            <Dialog open={invoiceDialogOpen} onOpenChange={(o) => { setInvoiceDialogOpen(o); if (!o) { setFormData({ po_id: "", supplier_id: "", invoice_number: "", amount: "", invoice_date: "" }); setInvoiceFile(null); } }}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Upload Invoice</Button></DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Upload Supplier Invoice</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); if (!formData.supplier_id) { toast.error("Please select a supplier"); return; } createInvoiceMutation.mutate(formData); }} className="space-y-4">
                  {/* Supplier */}
                  <div>
                    <Label>Supplier *</Label>
                    <Select value={formData.supplier_id} onValueChange={v => setFormData({ ...formData, supplier_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select Supplier" /></SelectTrigger>
                      <SelectContent>{suppliers?.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {/* PO (optional) */}
                  <div>
                    <Label>Purchase Order <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <Select value={formData.po_id} onValueChange={v => setFormData({ ...formData, po_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Link to PO (if any)" /></SelectTrigger>
                      <SelectContent>{purchaseOrders?.map(po => <SelectItem key={po.id} value={po.id}>{po.po_number}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>Invoice Number *</Label><Input value={formData.invoice_number} onChange={e => setFormData({ ...formData, invoice_number: e.target.value })} required /></div>
                    <div><Label>Amount (₹) *</Label><Input type="number" step="0.01" value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} required /></div>
                  </div>
                  <div><Label>Invoice Date <span className="text-muted-foreground text-xs">(optional)</span></Label><Input type="date" value={formData.invoice_date} onChange={e => setFormData({ ...formData, invoice_date: e.target.value })} /></div>
                  {/* File upload */}
                  <div>
                    <Label>Attach Invoice (PDF / Image)</Label>
                    <div className="mt-1">
                      {invoiceFile ? (
                        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-3">
                          <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                          <span className="text-sm truncate flex-1">{invoiceFile.name}</span>
                          <Button type="button" variant="ghost" size="sm" onClick={() => setInvoiceFile(null)}>Remove</Button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center gap-2 rounded-md border-2 border-dashed border-border p-6 cursor-pointer hover:bg-muted/50 transition-colors">
                          <Upload className="h-8 w-8 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">Click to select PDF, JPG, or PNG</span>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e => { if (e.target.files?.[0]) setInvoiceFile(e.target.files[0]); }} />
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setInvoiceDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={createInvoiceMutation.isPending}>
                      {createInvoiceMutation.isPending ? "Uploading..." : "Save Invoice"}
                    </Button>
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
                      <TableCell className="whitespace-nowrap">₹{invoice.amount?.toLocaleString("en-IN")}</TableCell>
                      <TableCell><StatusBadge status={invoice.status as any} /></TableCell>
                      <TableCell className="text-right space-x-2">
                        {invoice.status === "pending" && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => approveMutation.mutate(invoice)}><CheckCircle className="h-4 w-4 mr-1" />Approve</Button>
                            <Button variant="outline" size="sm" onClick={() => rejectMutation.mutate(invoice.id)}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="p-8 text-center text-muted-foreground">No invoices found.</div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <SupplierDetailDialog supplier={detailSupplier} open={!!detailSupplierId} onOpenChange={(o) => { if (!o) setDetailSupplierId(null); }} />
    </div>
  );
}
