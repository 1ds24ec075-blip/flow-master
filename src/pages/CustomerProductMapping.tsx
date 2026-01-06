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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Plus,
  ArrowLeft,
  RefreshCw,
  Trash2,
  Edit2,
  Search,
  Link2,
  Users,
  Package,
  Upload,
  Download,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";

interface CustomerMapping {
  id: string;
  customer_id: string;
  customer_product_code: string;
  customer_product_name: string | null;
  internal_product_id: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface Customer {
  id: string;
  customer_name: string;
}

interface Product {
  id: string;
  internal_code: string;
  name: string;
}

interface ImportRow {
  customerName?: string;
  customerProductCode?: string;
  customerProductName?: string;
  internalProductCode?: string;
  notes?: string;
  // Resolved IDs
  customerId?: string;
  internalProductId?: string;
  status: "valid" | "error" | "warning";
  message?: string;
}

export default function CustomerProductMapping() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingMapping, setEditingMapping] = useState<CustomerMapping | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [importData, setImportData] = useState<ImportRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [formData, setFormData] = useState({
    customerId: "",
    customerProductCode: "",
    customerProductName: "",
    internalProductId: "",
    notes: "",
    isActive: true,
  });

  // Fetch customers
  const { data: customers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_master")
        .select("id, customer_name")
        .eq("is_active", true)
        .order("customer_name");
      if (error) throw error;
      return data as Customer[];
    },
  });

  // Fetch products
  const { data: products } = useQuery({
    queryKey: ["products-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_master")
        .select("id, internal_code, name")
        .eq("is_active", true)
        .order("internal_code");
      if (error) throw error;
      return data as Product[];
    },
  });

  // Fetch mappings
  const { data: mappings, isLoading, refetch } = useQuery({
    queryKey: ["customer-mappings", selectedCustomerId],
    queryFn: async () => {
      let query = supabase
        .from("customer_product_mapping")
        .select("*")
        .order("customer_product_code");
      
      if (selectedCustomerId) {
        query = query.eq("customer_id", selectedCustomerId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data as CustomerMapping[];
    },
  });

  // Create mapping
  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("customer_product_mapping").insert({
        customer_id: formData.customerId,
        customer_product_code: formData.customerProductCode,
        customer_product_name: formData.customerProductName || null,
        internal_product_id: formData.internalProductId,
        notes: formData.notes || null,
        is_active: formData.isActive,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-mappings"] });
      toast.success("Mapping created");
      setShowAddDialog(false);
      resetForm();
    },
    onError: (err: Error) => {
      toast.error(`Failed to create mapping: ${err.message}`);
    },
  });

  // Update mapping
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editingMapping) return;
      const { error } = await supabase
        .from("customer_product_mapping")
        .update({
          customer_product_code: formData.customerProductCode,
          customer_product_name: formData.customerProductName || null,
          internal_product_id: formData.internalProductId,
          notes: formData.notes || null,
          is_active: formData.isActive,
        })
        .eq("id", editingMapping.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-mappings"] });
      toast.success("Mapping updated");
      setShowAddDialog(false);
      setEditingMapping(null);
      resetForm();
    },
    onError: (err: Error) => {
      toast.error(`Failed to update mapping: ${err.message}`);
    },
  });

  // Delete mapping
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("customer_product_mapping")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-mappings"] });
      toast.success("Mapping deleted");
    },
    onError: () => {
      toast.error("Failed to delete mapping");
    },
  });

  const resetForm = () => {
    setFormData({
      customerId: selectedCustomerId || "",
      customerProductCode: "",
      customerProductName: "",
      internalProductId: "",
      notes: "",
      isActive: true,
    });
  };

  const openEditDialog = (mapping: CustomerMapping) => {
    setEditingMapping(mapping);
    setFormData({
      customerId: mapping.customer_id,
      customerProductCode: mapping.customer_product_code,
      customerProductName: mapping.customer_product_name || "",
      internalProductId: mapping.internal_product_id,
      notes: mapping.notes || "",
      isActive: mapping.is_active,
    });
    setShowAddDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.customerId || !formData.customerProductCode || !formData.internalProductId) {
      toast.error("Please fill all required fields");
      return;
    }
    if (editingMapping) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const getCustomerName = (customerId: string) => {
    return customers?.find((c) => c.id === customerId)?.customer_name || "Unknown";
  };

  const getProductInfo = (productId: string) => {
    const product = products?.find((p) => p.id === productId);
    return product ? `${product.internal_code} - ${product.name}` : "Unknown";
  };

  const filteredMappings = mappings?.filter((m) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      m.customer_product_code.toLowerCase().includes(term) ||
      m.customer_product_name?.toLowerCase().includes(term) ||
      getProductInfo(m.internal_product_id).toLowerCase().includes(term)
    );
  });

  const stats = {
    total: mappings?.length || 0,
    active: mappings?.filter((m) => m.is_active).length || 0,
    customersWithMappings: new Set(mappings?.map((m) => m.customer_id)).size,
  };

  // ========== IMPORT LOGIC ==========
  
  const downloadTemplate = () => {
    const template = [
      {
        "Customer Name": "Example Customer",
        "Customer Product Code": "CUST-001",
        "Customer Product Name": "Customer's Product Description",
        "Internal Product Code": "INT-001",
        "Notes": "Optional notes"
      }
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mappings");
    XLSX.writeFile(wb, "customer_product_mapping_template.xlsx");
    toast.success("Template downloaded");
  };

  const findColumnIndex = (headers: string[], keywords: string[]): number => {
    return headers.findIndex(h => 
      keywords.some(k => h.toLowerCase().includes(k.toLowerCase()))
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { header: 1 });

        if (jsonData.length < 2) {
          toast.error("File appears to be empty or has no data rows");
          return;
        }

        const headers = (jsonData[0] as string[]).map(h => String(h || "").trim());
        
        // Auto-detect columns
        const customerNameIdx = findColumnIndex(headers, ["customer name", "customer", "client"]);
        const customerCodeIdx = findColumnIndex(headers, ["customer product code", "customer code", "cust code", "their code"]);
        const customerProdNameIdx = findColumnIndex(headers, ["customer product name", "customer description", "their name"]);
        const internalCodeIdx = findColumnIndex(headers, ["internal product code", "internal code", "your code", "our code", "product code"]);
        const notesIdx = findColumnIndex(headers, ["notes", "note", "comments", "remark"]);

        if (customerNameIdx === -1 || customerCodeIdx === -1 || internalCodeIdx === -1) {
          toast.error("Could not find required columns: Customer Name, Customer Product Code, Internal Product Code");
          return;
        }

        const rows: ImportRow[] = [];
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (!row || row.every(cell => !cell)) continue; // Skip empty rows

          const customerName = String(row[customerNameIdx] || "").trim();
          const customerProductCode = String(row[customerCodeIdx] || "").trim();
          const customerProductName = customerProdNameIdx >= 0 ? String(row[customerProdNameIdx] || "").trim() : "";
          const internalProductCode = String(row[internalCodeIdx] || "").trim();
          const notes = notesIdx >= 0 ? String(row[notesIdx] || "").trim() : "";

          if (!customerName || !customerProductCode || !internalProductCode) {
            rows.push({
              customerName,
              customerProductCode,
              customerProductName,
              internalProductCode,
              notes,
              status: "error",
              message: "Missing required fields"
            });
            continue;
          }

          // Match customer
          const matchedCustomer = customers?.find(c => 
            c.customer_name.toLowerCase() === customerName.toLowerCase()
          );

          // Match product
          const matchedProduct = products?.find(p => 
            p.internal_code.toLowerCase() === internalProductCode.toLowerCase() ||
            p.name.toLowerCase() === internalProductCode.toLowerCase()
          );

          if (!matchedCustomer && !matchedProduct) {
            rows.push({
              customerName,
              customerProductCode,
              customerProductName,
              internalProductCode,
              notes,
              status: "error",
              message: "Customer and product not found"
            });
          } else if (!matchedCustomer) {
            rows.push({
              customerName,
              customerProductCode,
              customerProductName,
              internalProductCode,
              notes,
              internalProductId: matchedProduct?.id,
              status: "error",
              message: `Customer "${customerName}" not found`
            });
          } else if (!matchedProduct) {
            rows.push({
              customerName,
              customerProductCode,
              customerProductName,
              internalProductCode,
              notes,
              customerId: matchedCustomer?.id,
              status: "error",
              message: `Product "${internalProductCode}" not found`
            });
          } else {
            rows.push({
              customerName,
              customerProductCode,
              customerProductName,
              internalProductCode,
              notes,
              customerId: matchedCustomer.id,
              internalProductId: matchedProduct.id,
              status: "valid",
              message: "Ready to import"
            });
          }
        }

        setImportData(rows);
        if (rows.length === 0) {
          toast.error("No valid data rows found");
        } else {
          const validCount = rows.filter(r => r.status === "valid").length;
          toast.success(`Parsed ${rows.length} rows, ${validCount} valid`);
        }
      } catch (err) {
        console.error("Parse error:", err);
        toast.error("Failed to parse file");
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const importValidRows = async () => {
    const validRows = importData.filter(r => r.status === "valid" && r.customerId && r.internalProductId);
    if (validRows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }

    setIsImporting(true);
    try {
      const insertData = validRows.map(row => ({
        customer_id: row.customerId!,
        customer_product_code: row.customerProductCode!,
        customer_product_name: row.customerProductName || null,
        internal_product_id: row.internalProductId!,
        notes: row.notes || null,
        is_active: true,
      }));

      const { error } = await supabase
        .from("customer_product_mapping")
        .insert(insertData);

      if (error) throw error;

      toast.success(`Imported ${validRows.length} mappings`);
      setShowImportDialog(false);
      setImportData([]);
      refetch();
    } catch (err: any) {
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6 bg-slate-50 min-h-screen p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-background rounded-xl p-4 shadow-sm border">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/po-dashboard")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="h-12 w-12 rounded-lg bg-purple-100 flex items-center justify-center">
            <Link2 className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Customer Product Mapping</h1>
            <p className="text-sm text-muted-foreground">
              Map customer product codes to your internal products
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog
            open={showAddDialog}
            onOpenChange={(open) => {
              setShowAddDialog(open);
              if (!open) {
                setEditingMapping(null);
                resetForm();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                className="bg-purple-600 hover:bg-purple-700"
                onClick={() => {
                  resetForm();
                  setShowAddDialog(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Mapping
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingMapping ? "Edit Mapping" : "Add Product Mapping"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Customer *</Label>
                  <Select
                    value={formData.customerId}
                    onValueChange={(v) => setFormData({ ...formData, customerId: v })}
                    disabled={!!editingMapping}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.customer_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Customer's Product Code *</Label>
                  <Input
                    value={formData.customerProductCode}
                    onChange={(e) =>
                      setFormData({ ...formData, customerProductCode: e.target.value })
                    }
                    placeholder="e.g., CUST-SKU-001"
                  />
                  <p className="text-xs text-muted-foreground">
                    The product code the customer uses in their POs
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Customer's Product Name</Label>
                  <Input
                    value={formData.customerProductName}
                    onChange={(e) =>
                      setFormData({ ...formData, customerProductName: e.target.value })
                    }
                    placeholder="Optional - customer's description"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Your Internal Product *</Label>
                  <Select
                    value={formData.internalProductId}
                    onValueChange={(v) => setFormData({ ...formData, internalProductId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select your product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.internal_code} - {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Any additional notes..."
                    rows={2}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label>Active</Label>
                  <Switch
                    checked={formData.isActive}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, isActive: checked })
                    }
                  />
                </div>

                <Button
                  onClick={handleSubmit}
                  className="w-full"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {editingMapping ? "Update Mapping" : "Create Mapping"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showImportDialog} onOpenChange={(open) => {
            setShowImportDialog(open);
            if (!open) setImportData([]);
          }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="bg-background">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5" />
                  Import Product Mappings
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                  <div className="flex-1">
                    <h4 className="font-medium">1. Download Template</h4>
                    <p className="text-sm text-muted-foreground">
                      Get the Excel template with required columns
                    </p>
                  </div>
                  <Button variant="outline" onClick={downloadTemplate}>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </div>

                <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
                  <div className="flex-1">
                    <h4 className="font-medium">2. Upload Your File</h4>
                    <p className="text-sm text-muted-foreground">
                      Excel (.xlsx) or CSV with: Customer Name, Customer Product Code, Internal Product Code
                    </p>
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                  />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload
                  </Button>
                </div>

                {importData.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {importData.filter(r => r.status === "valid").length} Valid
                        </Badge>
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          {importData.filter(r => r.status === "error").length} Errors
                        </Badge>
                      </div>
                      <Button
                        onClick={importValidRows}
                        disabled={isImporting || importData.filter(r => r.status === "valid").length === 0}
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        {isImporting ? "Importing..." : `Import ${importData.filter(r => r.status === "valid").length} Mappings`}
                      </Button>
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Status</TableHead>
                            <TableHead>Customer</TableHead>
                            <TableHead>Customer Code</TableHead>
                            <TableHead>Internal Code</TableHead>
                            <TableHead>Message</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importData.map((row, idx) => (
                            <TableRow key={idx} className={row.status === "error" ? "bg-red-50" : ""}>
                              <TableCell>
                                {row.status === "valid" ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                ) : (
                                  <AlertCircle className="h-4 w-4 text-red-600" />
                                )}
                              </TableCell>
                              <TableCell>{row.customerName}</TableCell>
                              <TableCell><code className="bg-muted px-1 rounded">{row.customerProductCode}</code></TableCell>
                              <TableCell><code className="bg-muted px-1 rounded">{row.internalProductCode}</code></TableCell>
                              <TableCell className="text-sm text-muted-foreground">{row.message}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}

                <div className="text-sm text-muted-foreground bg-blue-50 p-3 rounded-lg">
                  <strong>Tips:</strong>
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    <li>Customer names must match exactly with your Customer Master</li>
                    <li>Internal Product Code must match your Product Master codes</li>
                    <li>Only valid rows (green) will be imported</li>
                  </ul>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Button variant="outline" onClick={() => refetch()} className="bg-background">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-background shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-purple-100 flex items-center justify-center">
                <Link2 className="h-6 w-6 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-sm text-muted-foreground">Total Mappings</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-background shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center">
                <Package className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.active}</p>
                <p className="text-sm text-muted-foreground">Active Mappings</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-background shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.customersWithMappings}</p>
                <p className="text-sm text-muted-foreground">Customers with Mappings</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-background shadow-sm border">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">
                Filter by Customer
              </Label>
              <Select
                value={selectedCustomerId || "all"}
                onValueChange={(v) => setSelectedCustomerId(v === "all" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All customers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All customers</SelectItem>
                  {customers?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.customer_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground mb-1 block">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by code or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mappings Table */}
      <Card className="bg-background shadow-sm border">
        <CardHeader>
          <CardTitle>Product Mappings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : !filteredMappings?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              No mappings found. Add mappings for customers who use their own product codes.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Customer Code</TableHead>
                  <TableHead>Customer Name</TableHead>
                  <TableHead>Your Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMappings.map((mapping) => (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-medium">
                      {getCustomerName(mapping.customer_id)}
                    </TableCell>
                    <TableCell>
                      <code className="bg-muted px-2 py-1 rounded text-sm">
                        {mapping.customer_product_code}
                      </code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {mapping.customer_product_name || "-"}
                    </TableCell>
                    <TableCell>{getProductInfo(mapping.internal_product_id)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={mapping.is_active ? "default" : "secondary"}
                        className={mapping.is_active ? "bg-green-100 text-green-800" : ""}
                      >
                        {mapping.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(mapping)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(mapping.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4">
          <h3 className="font-semibold text-blue-900 mb-2">How it works</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Some customers send POs with their own product codes instead of yours</li>
            <li>Add mappings here to link their codes to your internal products</li>
            <li>When a PO arrives, the system automatically resolves their codes to your products</li>
            <li>If a code can't be matched, it appears in the "Unmapped" queue for review</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
