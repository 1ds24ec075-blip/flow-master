import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Plus, Pencil, Trash2, Upload, Download, RefreshCw, Package } from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";

interface Product {
  id: string;
  internal_code: string;
  name: string;
  description: string | null;
  default_unit: string | null;
  default_unit_price: number | null;
  hsn_code: string | null;
  gst_rate: number | null;
  is_active: boolean;
  created_at: string;
  sell_in_multiples: boolean | null;
  multiple_quantity: number | null;
}

export default function ProductMaster() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showDialog, setShowDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [importData, setImportData] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    internal_code: "",
    name: "",
    description: "",
    default_unit: "PCS",
    default_unit_price: "",
    hsn_code: "",
    gst_rate: "18",
    sell_in_multiples: false,
    multiple_quantity: "",
  });

  // Fetch products
  const { data: products, isLoading } = useQuery({
    queryKey: ["product_master"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_master")
        .select("*")
        .order("internal_code");
      if (error) throw error;
      return data as Product[];
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Validate multiple quantity when sell_in_multiples is true
      if (data.sell_in_multiples && (!data.multiple_quantity || Number(data.multiple_quantity) <= 0)) {
        throw new Error("Multiple Quantity must be greater than 0 when 'Sell in Multiples' is enabled");
      }
      const { error } = await supabase.from("product_master").insert({
        internal_code: data.internal_code,
        name: data.name,
        description: data.description || null,
        default_unit: data.default_unit || "PCS",
        default_unit_price: data.default_unit_price ? Number(data.default_unit_price) : null,
        hsn_code: data.hsn_code || null,
        gst_rate: data.gst_rate ? Number(data.gst_rate) : 18,
        is_active: true,
        sell_in_multiples: data.sell_in_multiples,
        multiple_quantity: data.sell_in_multiples && data.multiple_quantity ? Number(data.multiple_quantity) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product_master"] });
      toast.success("Product created successfully");
      resetForm();
      setShowDialog(false);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create product");
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      // Validate multiple quantity when sell_in_multiples is true
      if (data.sell_in_multiples && (!data.multiple_quantity || Number(data.multiple_quantity) <= 0)) {
        throw new Error("Multiple Quantity must be greater than 0 when 'Sell in Multiples' is enabled");
      }
      const { error } = await supabase
        .from("product_master")
        .update({
          internal_code: data.internal_code,
          name: data.name,
          description: data.description || null,
          default_unit: data.default_unit || "PCS",
          default_unit_price: data.default_unit_price ? Number(data.default_unit_price) : null,
          hsn_code: data.hsn_code || null,
          gst_rate: data.gst_rate ? Number(data.gst_rate) : 18,
          sell_in_multiples: data.sell_in_multiples,
          multiple_quantity: data.sell_in_multiples && data.multiple_quantity ? Number(data.multiple_quantity) : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product_master"] });
      toast.success("Product updated successfully");
      resetForm();
      setShowDialog(false);
      setEditingProduct(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update product");
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("product_master")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product_master"] });
      toast.success("Product deactivated");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete product");
    },
  });

  // Bulk import mutation
  const bulkImportMutation = useMutation({
    mutationFn: async (items: any[]) => {
      const { error } = await supabase.from("product_master").insert(items);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["product_master"] });
      toast.success(`Imported ${importData.length} products`);
      setShowImportDialog(false);
      setImportData([]);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to import products");
    },
  });

  const resetForm = () => {
    setFormData({
      internal_code: "",
      name: "",
      description: "",
      default_unit: "PCS",
      default_unit_price: "",
      hsn_code: "",
      gst_rate: "18",
      sell_in_multiples: false,
      multiple_quantity: "",
    });
  };

  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      internal_code: product.internal_code,
      name: product.name,
      description: product.description || "",
      default_unit: product.default_unit || "PCS",
      default_unit_price: product.default_unit_price?.toString() || "",
      hsn_code: product.hsn_code || "",
      gst_rate: product.gst_rate?.toString() || "18",
      sell_in_multiples: product.sell_in_multiples || false,
      multiple_quantity: product.multiple_quantity?.toString() || "",
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.internal_code || !formData.name) {
      toast.error("Internal code and name are required");
      return;
    }
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const data = event.target?.result;
      const workbook = XLSX.read(data, { type: "binary" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(sheet);

      const mappedData = jsonData.map((row: any) => ({
        internal_code: row["Internal Code"] || row["internal_code"] || row["SKU"] || "",
        name: row["Name"] || row["name"] || row["Product Name"] || "",
        description: row["Description"] || row["description"] || null,
        default_unit: row["Unit"] || row["default_unit"] || "PCS",
        default_unit_price: Number(row["Unit Price"] || row["default_unit_price"] || 0) || null,
        hsn_code: row["HSN Code"] || row["hsn_code"] || null,
        gst_rate: Number(row["GST Rate"] || row["gst_rate"] || 18),
        is_active: true,
      })).filter((row: any) => row.internal_code && row.name);

      setImportData(mappedData);
      setShowImportDialog(true);
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  const downloadTemplate = () => {
    const template = [
      {
        "Internal Code": "PROD-001",
        "Name": "Sample Product",
        "Description": "Product description",
        "Unit": "PCS",
        "Unit Price": 100,
        "HSN Code": "1234",
        "GST Rate": 18,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    XLSX.writeFile(wb, "product_master_template.xlsx");
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/po-dashboard")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="h-6 w-6" />
              Product Master
            </h1>
            <p className="text-sm text-muted-foreground">Canonical product catalog for code resolution</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["product_master"] })}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-1" />
            Template
          </Button>
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />
            Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFileUpload}
          />
          <Button onClick={() => { resetForm(); setEditingProduct(null); setShowDialog(true); }}>
            <Plus className="h-4 w-4 mr-1" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Products</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{products?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">
              {products?.filter(p => p.is_active).length || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Products Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Internal Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead>GST %</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : products?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No products found. Add your first product to get started.
                  </TableCell>
                </TableRow>
              ) : (
                products?.filter(p => p.is_active).map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-mono font-medium">{product.internal_code}</TableCell>
                    <TableCell>{product.name}</TableCell>
                    <TableCell>{product.default_unit}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {product.default_unit_price
                        ? `₹${product.default_unit_price.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                        : "-"}
                    </TableCell>
                    <TableCell>{product.hsn_code || "-"}</TableCell>
                    <TableCell>{product.gst_rate}%</TableCell>
                    <TableCell>
                      <Badge variant={product.is_active ? "default" : "secondary"}>
                        {product.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(product)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(product.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingProduct ? "Edit Product" : "Add Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Internal Code *</Label>
                <Input
                  value={formData.internal_code}
                  onChange={(e) => setFormData({ ...formData, internal_code: e.target.value })}
                  placeholder="PROD-001"
                />
              </div>
              <div>
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Product Name"
                />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Default Unit</Label>
                <Input
                  value={formData.default_unit}
                  onChange={(e) => setFormData({ ...formData, default_unit: e.target.value })}
                  placeholder="PCS"
                />
              </div>
              <div>
                <Label>Unit Price</Label>
                <Input
                  type="number"
                  value={formData.default_unit_price}
                  onChange={(e) => setFormData({ ...formData, default_unit_price: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>HSN Code</Label>
                <Input
                  value={formData.hsn_code}
                  onChange={(e) => setFormData({ ...formData, hsn_code: e.target.value })}
                  placeholder="1234"
                />
              </div>
              <div>
                <Label>GST Rate (%)</Label>
                <Input
                  type="number"
                  value={formData.gst_rate}
                  onChange={(e) => setFormData({ ...formData, gst_rate: e.target.value })}
                  placeholder="18"
                />
              </div>
            </div>
            
            {/* Quantity Multiple Rule Section */}
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Sell in Multiples</Label>
                  <p className="text-xs text-muted-foreground">Round up PO quantity to nearest multiple in SO</p>
                </div>
                <Switch
                  checked={formData.sell_in_multiples}
                  onCheckedChange={(checked) => setFormData({ ...formData, sell_in_multiples: checked, multiple_quantity: checked ? formData.multiple_quantity : "" })}
                />
              </div>
              {formData.sell_in_multiples && (
                <div>
                  <Label>Multiple Quantity *</Label>
                  <Input
                    type="number"
                    min="1"
                    value={formData.multiple_quantity}
                    onChange={(e) => setFormData({ ...formData, multiple_quantity: e.target.value })}
                    placeholder="e.g. 10, 12, 25"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    PO qty will be rounded up to nearest multiple (e.g., PO=123, Multiple=10 → SO=130)
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingProduct ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Preview Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Preview</DialogTitle>
          </DialogHeader>
          <div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Internal Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {importData.slice(0, 10).map((item, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono">{item.internal_code}</TableCell>
                    <TableCell>{item.name}</TableCell>
                    <TableCell>{item.default_unit}</TableCell>
                    <TableCell>₹{item.default_unit_price || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {importData.length > 10 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                ... and {importData.length - 10} more items
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => bulkImportMutation.mutate(importData)}
              disabled={bulkImportMutation.isPending}
            >
              Import {importData.length} Products
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
