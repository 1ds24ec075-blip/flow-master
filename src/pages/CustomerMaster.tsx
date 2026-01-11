import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  Upload,
  Download,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Customer {
  id: string;
  customer_name: string;
  gst_number: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  payment_terms: string | null;
  currency: string;
  tally_ledger_name: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  bank_account: string | null;
  upi_payment_patterns: string | null;
  bank_name: string | null;
}

export default function CustomerMaster() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [importData, setImportData] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const [formData, setFormData] = useState({
    customer_name: "",
    gst_number: "",
    tally_ledger_name: "",
    email: "",
    phone: "",
    billing_address: "",
    shipping_address: "",
    payment_terms: "",
    currency: "INR",
    is_active: true,
    bank_account: "",
    upi_payment_patterns: "",
    bank_name: "",
  });

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customer-master"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_master")
        .select("*")
        .order("customer_name");
      if (error) throw error;
      return data as Customer[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("customer_master").insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-master"] });
      toast.success("Customer created successfully");
      setShowDialog(false);
      resetForm();
    },
    onError: () => {
      toast.error("Failed to create customer");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const { error } = await supabase
        .from("customer_master")
        .update(data)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-master"] });
      toast.success("Customer updated successfully");
      setShowDialog(false);
      setEditingCustomer(null);
      resetForm();
    },
    onError: () => {
      toast.error("Failed to update customer");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("customer_master").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-master"] });
      toast.success("Customer deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete customer");
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (data: any[]) => {
      const { error } = await supabase.from("customer_master").insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-master"] });
      toast.success(`${importData.length} customers imported successfully`);
      setShowImportDialog(false);
      setImportData([]);
    },
    onError: () => {
      toast.error("Failed to import customers");
    },
  });

  const resetForm = () => {
    setFormData({
      customer_name: "",
      gst_number: "",
      tally_ledger_name: "",
      email: "",
      phone: "",
      billing_address: "",
      shipping_address: "",
      payment_terms: "",
      currency: "INR",
      is_active: true,
      bank_account: "",
      upi_payment_patterns: "",
      bank_name: "",
    });
  };

  const openEditDialog = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      customer_name: customer.customer_name,
      gst_number: customer.gst_number || "",
      tally_ledger_name: customer.tally_ledger_name || "",
      email: customer.email || "",
      phone: customer.phone || "",
      billing_address: customer.billing_address || "",
      shipping_address: customer.shipping_address || "",
      payment_terms: customer.payment_terms || "",
      currency: customer.currency,
      is_active: customer.is_active,
      bank_account: customer.bank_account || "",
      upi_payment_patterns: customer.upi_payment_patterns || "",
      bank_name: customer.bank_name || "",
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target?.result, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet);

        const mappedData = jsonData.map((row: any) => ({
          customer_name: row["Customer Name"] || row["customer_name"] || "",
          gst_number: row["GST Number"] || row["gst_number"] || null,
          tally_ledger_name: row["Tally Ledger"] || row["tally_ledger_name"] || null,
          email: row["Email"] || row["email"] || null,
          phone: row["Phone"] || row["phone"] || null,
          billing_address: row["Billing Address"] || row["billing_address"] || null,
          shipping_address: row["Shipping Address"] || row["shipping_address"] || null,
          payment_terms: row["Payment Terms"] || row["payment_terms"] || null,
          currency: row["Currency"] || row["currency"] || "INR",
          is_active: true,
          bank_account: row["Bank Account"] || row["bank_account"] || null,
          upi_payment_patterns: row["UPI Patterns"] || row["upi_payment_patterns"] || null,
          bank_name: row["Bank Name"] || row["bank_name"] || null,
        })).filter((row: any) => row.customer_name);

        setImportData(mappedData);
        setShowImportDialog(true);
      } catch (error) {
        toast.error("Failed to parse file");
      } finally {
        setIsImporting(false);
      }
    };

    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const template = [
      {
        "Customer Name": "Example Corp",
        "GST Number": "22AAAAA0000A1Z5",
        "Tally Ledger": "Example Corp",
        "Email": "contact@example.com",
        "Phone": "9876543210",
        "Billing Address": "123 Main St",
        "Shipping Address": "456 Shipping Lane",
        "Payment Terms": "Net 30",
        "Currency": "INR",
        "Bank Account": "1234567890",
        "UPI Patterns": "company@upi",
        "Bank Name": "HDFC Bank",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(template);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Customers");
    XLSX.writeFile(workbook, "customer_master_template.xlsx");
  };

  const stats = {
    total: customers?.length || 0,
    active: customers?.filter((c) => c.is_active).length || 0,
    withGst: customers?.filter((c) => c.gst_number).length || 0,
  };

  return (
    <ScrollArea className="h-[calc(100vh-2rem)]">
      <div className="space-y-6 pr-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/po-dashboard")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Customer Master</h1>
          <p className="text-muted-foreground">Manage your customer database</p>
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            Template
          </Button>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Import
          </Button>
          <Dialog
            open={showDialog}
            onOpenChange={(open) => {
              setShowDialog(open);
              if (!open) {
                setEditingCustomer(null);
                resetForm();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Customer
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>
                  {editingCustomer ? "Edit Customer" : "Add Customer"}
                </DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Customer Name *</Label>
                  <Input
                    value={formData.customer_name}
                    onChange={(e) =>
                      setFormData({ ...formData, customer_name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>GST Number</Label>
                  <Input
                    value={formData.gst_number}
                    onChange={(e) =>
                      setFormData({ ...formData, gst_number: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tally Ledger Name</Label>
                  <Input
                    value={formData.tally_ledger_name}
                    onChange={(e) =>
                      setFormData({ ...formData, tally_ledger_name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select
                    value={formData.currency}
                    onValueChange={(v) => setFormData({ ...formData, currency: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INR">INR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Billing Address</Label>
                  <Textarea
                    value={formData.billing_address}
                    onChange={(e) =>
                      setFormData({ ...formData, billing_address: e.target.value })
                    }
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Shipping Address</Label>
                  <Textarea
                    value={formData.shipping_address}
                    onChange={(e) =>
                      setFormData({ ...formData, shipping_address: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payment Terms</Label>
                  <Input
                    value={formData.payment_terms}
                    onChange={(e) =>
                      setFormData({ ...formData, payment_terms: e.target.value })
                    }
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, is_active: checked })
                    }
                  />
                  <Label>Active</Label>
                </div>

                {/* Banking Information Section */}
                <div className="col-span-2 pt-4 border-t">
                  <h3 className="font-semibold mb-3 text-sm text-muted-foreground">Banking Information</h3>
                </div>
                <div className="space-y-2">
                  <Label>Bank Account Number</Label>
                  <Input
                    value={formData.bank_account}
                    onChange={(e) =>
                      setFormData({ ...formData, bank_account: e.target.value })
                    }
                    placeholder="Enter bank account number"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Bank Name (Optional)</Label>
                  <Input
                    value={formData.bank_name}
                    onChange={(e) =>
                      setFormData({ ...formData, bank_name: e.target.value })
                    }
                    placeholder="e.g., HDFC Bank, SBI"
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>UPI / Payment Reference Patterns</Label>
                  <Input
                    value={formData.upi_payment_patterns}
                    onChange={(e) =>
                      setFormData({ ...formData, upi_payment_patterns: e.target.value })
                    }
                    placeholder="e.g., company@upi, NEFT patterns"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !formData.customer_name ||
                    createMutation.isPending ||
                    updateMutation.isPending
                  }
                >
                  {createMutation.isPending || updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingCustomer ? (
                    "Update"
                  ) : (
                    "Create"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Total Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Active Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{stats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              With GST Number
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{stats.withGst}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : customers && customers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer Name</TableHead>
                  <TableHead>GST Number</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{customer.customer_name}</p>
                        {customer.tally_ledger_name && (
                          <p className="text-xs text-muted-foreground">
                            Tally: {customer.tally_ledger_name}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{customer.gst_number || "-"}</TableCell>
                    <TableCell>{customer.email || "-"}</TableCell>
                    <TableCell>{customer.phone || "-"}</TableCell>
                    <TableCell>{customer.currency}</TableCell>
                    <TableCell>
                      <Badge variant={customer.is_active ? "default" : "secondary"}>
                        {customer.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(customer)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete this customer?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(customer.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No customers found. Add a customer to get started.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Preview Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Preview - {importData.length} customers</DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer Name</TableHead>
                <TableHead>GST Number</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importData.slice(0, 10).map((row, index) => (
                <TableRow key={index}>
                  <TableCell>{row.customer_name}</TableCell>
                  <TableCell>{row.gst_number || "-"}</TableCell>
                  <TableCell>{row.email || "-"}</TableCell>
                  <TableCell>{row.phone || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {importData.length > 10 && (
            <p className="text-sm text-muted-foreground">
              ...and {importData.length - 10} more
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => bulkImportMutation.mutate(importData)}
              disabled={bulkImportMutation.isPending}
            >
              {bulkImportMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                `Import ${importData.length} Customers`
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </ScrollArea>
  );
}