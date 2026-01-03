import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Edit, Trash2, RefreshCw, Loader2, Upload, Download } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";

interface PriceItem {
  id: string;
  sku: string;
  product_name: string | null;
  unit_price: number;
  currency: string;
  created_at: string;
}

export default function PriceList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<PriceItem | null>(null);
  const [importData, setImportData] = useState<any[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const [formData, setFormData] = useState({
    sku: "",
    product_name: "",
    unit_price: 0,
    currency: "INR",
  });

  const { data: items, isLoading, refetch } = useQuery({
    queryKey: ["price-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("price_list")
        .select("*")
        .order("sku");
      if (error) throw error;
      return data as PriceItem[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("price_list").insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-list"] });
      toast.success("Product added successfully");
      setShowDialog(false);
      resetForm();
    },
    onError: () => {
      toast.error("Failed to add product");
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const { error } = await supabase.from("price_list").update(data).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-list"] });
      toast.success("Product updated successfully");
      setShowDialog(false);
      setEditingItem(null);
      resetForm();
    },
    onError: () => {
      toast.error("Failed to update product");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("price_list").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-list"] });
      toast.success("Product deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete product");
    },
  });

  const bulkImportMutation = useMutation({
    mutationFn: async (data: any[]) => {
      const { error } = await supabase.from("price_list").insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["price-list"] });
      toast.success(`${importData.length} products imported successfully`);
      setShowImportDialog(false);
      setImportData([]);
    },
    onError: () => {
      toast.error("Failed to import products");
    },
  });

  const resetForm = () => {
    setFormData({
      sku: "",
      product_name: "",
      unit_price: 0,
      currency: "INR",
    });
  };

  const openEditDialog = (item: PriceItem) => {
    setEditingItem(item);
    setFormData({
      sku: item.sku,
      product_name: item.product_name || "",
      unit_price: item.unit_price,
      currency: item.currency,
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: formData });
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
          sku: row["SKU"] || row["sku"] || "",
          product_name: row["Product Name"] || row["product_name"] || null,
          unit_price: Number(row["Unit Price"] || row["unit_price"] || 0),
          currency: row["Currency"] || row["currency"] || "INR",
        })).filter((row: any) => row.sku && row.unit_price > 0);

        setImportData(mappedData);
        setShowImportDialog(true);
      } catch (error) {
        toast.error("Failed to parse file");
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    reader.readAsBinaryString(file);
  };

  const downloadTemplate = () => {
    const template = [
      {
        "SKU": "SKU-001",
        "Product Name": "Example Product",
        "Unit Price": 100,
        "Currency": "INR",
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(template);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Price List");
    XLSX.writeFile(workbook, "price_list_template.xlsx");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/po-dashboard")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Price List</h1>
          <p className="text-muted-foreground">Manage product pricing for validation</p>
        </div>
        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
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
                setEditingItem(null);
                resetForm();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingItem ? "Edit Product" : "Add Product"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>SKU *</Label>
                  <Input
                    value={formData.sku}
                    onChange={(e) =>
                      setFormData({ ...formData, sku: e.target.value })
                    }
                    placeholder="SKU-001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Product Name</Label>
                  <Input
                    value={formData.product_name}
                    onChange={(e) =>
                      setFormData({ ...formData, product_name: e.target.value })
                    }
                    placeholder="Product Name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Unit Price *</Label>
                  <Input
                    type="number"
                    value={formData.unit_price}
                    onChange={(e) =>
                      setFormData({ ...formData, unit_price: Number(e.target.value) })
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
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={
                    !formData.sku ||
                    formData.unit_price <= 0 ||
                    createMutation.isPending ||
                    updateMutation.isPending
                  }
                >
                  {createMutation.isPending || updateMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingItem ? (
                    "Update"
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : items && items.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.sku}</TableCell>
                    <TableCell>{item.product_name || "-"}</TableCell>
                    <TableCell>{item.unit_price.toLocaleString()}</TableCell>
                    <TableCell>{item.currency}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(item)}
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
                            <AlertDialogTitle>Delete Product</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete this product?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(item.id)}
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
              No products in price list. Add products for price validation.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Preview Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>Import Preview - {importData.length} Products</DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Currency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importData.slice(0, 10).map((item, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{item.sku}</TableCell>
                  <TableCell>{item.product_name || "-"}</TableCell>
                  <TableCell>₹{item.unit_price?.toLocaleString()}</TableCell>
                  <TableCell>{item.currency}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {importData.length > 10 && (
            <p className="text-sm text-muted-foreground text-center">
              ... and {importData.length - 10} more products
            </p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => bulkImportMutation.mutate(importData)}
              disabled={bulkImportMutation.isPending}
            >
              {bulkImportMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              Import {importData.length} Products
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}