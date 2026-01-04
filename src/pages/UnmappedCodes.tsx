import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Check, X, Plus, AlertTriangle, Link2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface UnmappedCode {
  id: string;
  document_id: string;
  document_type: string;
  sender_type: string;
  sender_id: string | null;
  original_product_code: string;
  original_description: string | null;
  original_unit_price: number | null;
  suggested_product_id: string | null;
  suggestion_confidence: number;
  suggestion_reason: string | null;
  status: string;
  created_at: string;
}

interface Product {
  id: string;
  internal_code: string;
  name: string;
}

export default function UnmappedCodes() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedCode, setSelectedCode] = useState<UnmappedCode | null>(null);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [createMapping, setCreateMapping] = useState(true);
  const [newProductData, setNewProductData] = useState({
    internal_code: "",
    name: "",
    description: "",
    default_unit: "PCS",
    default_unit_price: "",
  });

  // Fetch unmapped codes
  const { data: unmappedCodes, isLoading } = useQuery({
    queryKey: ["unmapped_product_codes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unmapped_product_codes")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as UnmappedCode[];
    },
  });

  // Fetch products for mapping
  const { data: products } = useQuery({
    queryKey: ["product_master_active"],
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

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async ({
      unmappedId,
      productId,
      createMapping,
    }: {
      unmappedId: string;
      productId: string;
      createMapping: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke("approve-product-mapping", {
        body: {
          unmapped_id: unmappedId,
          action: "approve",
          internal_product_id: productId,
          create_mapping: createMapping,
          resolved_by: "user",
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unmapped_product_codes"] });
      toast.success("Mapping approved successfully");
      setShowApproveDialog(false);
      setSelectedCode(null);
      setSelectedProductId("");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to approve mapping");
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async (unmappedId: string) => {
      const { data, error } = await supabase.functions.invoke("approve-product-mapping", {
        body: {
          unmapped_id: unmappedId,
          action: "reject",
          resolved_by: "user",
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unmapped_product_codes"] });
      toast.success("Code rejected");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to reject code");
    },
  });

  // Create new product mutation
  const createProductMutation = useMutation({
    mutationFn: async ({
      unmappedId,
      productData,
    }: {
      unmappedId: string;
      productData: typeof newProductData;
    }) => {
      const { data, error } = await supabase.functions.invoke("approve-product-mapping", {
        body: {
          unmapped_id: unmappedId,
          action: "create_new",
          new_product_data: {
            internal_code: productData.internal_code,
            name: productData.name,
            description: productData.description,
            default_unit: productData.default_unit,
            default_unit_price: productData.default_unit_price
              ? Number(productData.default_unit_price)
              : null,
          },
          resolved_by: "user",
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unmapped_product_codes"] });
      queryClient.invalidateQueries({ queryKey: ["product_master"] });
      toast.success("New product created and mapped");
      setShowCreateDialog(false);
      setSelectedCode(null);
      setNewProductData({
        internal_code: "",
        name: "",
        description: "",
        default_unit: "PCS",
        default_unit_price: "",
      });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create product");
    },
  });

  const openApproveDialog = (code: UnmappedCode) => {
    setSelectedCode(code);
    setSelectedProductId(code.suggested_product_id || "");
    setShowApproveDialog(true);
  };

  const openCreateDialog = (code: UnmappedCode) => {
    setSelectedCode(code);
    setNewProductData({
      internal_code: code.original_product_code?.toUpperCase().replace(/[^A-Z0-9-]/g, "-") || "",
      name: code.original_description || "",
      description: "",
      default_unit: "PCS",
      default_unit_price: code.original_unit_price?.toString() || "",
    });
    setShowCreateDialog(true);
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.85) return <Badge className="bg-green-500">High ({(confidence * 100).toFixed(0)}%)</Badge>;
    if (confidence >= 0.60) return <Badge className="bg-yellow-500">Medium ({(confidence * 100).toFixed(0)}%)</Badge>;
    if (confidence > 0) return <Badge className="bg-red-500">Low ({(confidence * 100).toFixed(0)}%)</Badge>;
    return <Badge variant="secondary">None</Badge>;
  };

  const getSuggestedProduct = (code: UnmappedCode) => {
    if (!code.suggested_product_id) return null;
    return products?.find((p) => p.id === code.suggested_product_id);
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
              <AlertTriangle className="h-6 w-6 text-yellow-500" />
              Unmapped Product Codes
            </h1>
            <p className="text-sm text-muted-foreground">
              Review and approve product code mappings
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Pending Review</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-yellow-600">{unmappedCodes?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">With Suggestions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-600">
              {unmappedCodes?.filter((c) => c.suggested_product_id).length || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Unmapped Codes Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Original Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Doc Type</TableHead>
                <TableHead>Suggestion</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : unmappedCodes?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <Check className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    All product codes are mapped!
                  </TableCell>
                </TableRow>
              ) : (
                unmappedCodes?.map((code) => {
                  const suggestedProduct = getSuggestedProduct(code);
                  return (
                    <TableRow key={code.id}>
                      <TableCell className="font-mono font-medium">
                        {code.original_product_code}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {code.original_description || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {code.sender_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{code.document_type}</Badge>
                      </TableCell>
                      <TableCell>
                        {suggestedProduct ? (
                          <div className="text-sm">
                            <span className="font-mono">{suggestedProduct.internal_code}</span>
                            <br />
                            <span className="text-muted-foreground">{suggestedProduct.name}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">No suggestion</span>
                        )}
                      </TableCell>
                      <TableCell>{getConfidenceBadge(code.suggestion_confidence)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openApproveDialog(code)}
                            title="Map to existing product"
                          >
                            <Link2 className="h-4 w-4 mr-1" />
                            Map
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openCreateDialog(code)}
                            title="Create new product"
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            New
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => rejectMutation.mutate(code.id)}
                            disabled={rejectMutation.isPending}
                            title="Reject"
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Approve/Map Dialog */}
      <Dialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Map Product Code</DialogTitle>
            <DialogDescription>
              Map "{selectedCode?.original_product_code}" to an existing product
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm font-medium">Original Code</p>
              <p className="font-mono">{selectedCode?.original_product_code}</p>
              {selectedCode?.original_description && (
                <>
                  <p className="text-sm font-medium mt-2">Description</p>
                  <p className="text-sm text-muted-foreground">{selectedCode.original_description}</p>
                </>
              )}
              {selectedCode?.suggestion_reason && (
                <>
                  <p className="text-sm font-medium mt-2">AI Suggestion Reason</p>
                  <p className="text-sm text-muted-foreground">{selectedCode.suggestion_reason}</p>
                </>
              )}
            </div>
            <div>
              <Label>Map to Product *</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a product" />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      <span className="font-mono">{product.internal_code}</span> - {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="createMapping"
                checked={createMapping}
                onChange={(e) => setCreateMapping(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="createMapping" className="cursor-pointer">
                Save mapping for future documents from this sender
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                approveMutation.mutate({
                  unmappedId: selectedCode!.id,
                  productId: selectedProductId,
                  createMapping,
                })
              }
              disabled={!selectedProductId || approveMutation.isPending}
            >
              <Check className="h-4 w-4 mr-1" />
              Approve Mapping
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create New Product Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Product</DialogTitle>
            <DialogDescription>
              Create a new product and map "{selectedCode?.original_product_code}" to it
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Internal Code *</Label>
                <Input
                  value={newProductData.internal_code}
                  onChange={(e) =>
                    setNewProductData({ ...newProductData, internal_code: e.target.value })
                  }
                  placeholder="PROD-001"
                />
              </div>
              <div>
                <Label>Name *</Label>
                <Input
                  value={newProductData.name}
                  onChange={(e) => setNewProductData({ ...newProductData, name: e.target.value })}
                  placeholder="Product Name"
                />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input
                value={newProductData.description}
                onChange={(e) =>
                  setNewProductData({ ...newProductData, description: e.target.value })
                }
                placeholder="Optional description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Default Unit</Label>
                <Input
                  value={newProductData.default_unit}
                  onChange={(e) =>
                    setNewProductData({ ...newProductData, default_unit: e.target.value })
                  }
                  placeholder="PCS"
                />
              </div>
              <div>
                <Label>Unit Price</Label>
                <Input
                  type="number"
                  value={newProductData.default_unit_price}
                  onChange={(e) =>
                    setNewProductData({ ...newProductData, default_unit_price: e.target.value })
                  }
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createProductMutation.mutate({
                  unmappedId: selectedCode!.id,
                  productData: newProductData,
                })
              }
              disabled={
                !newProductData.internal_code ||
                !newProductData.name ||
                createProductMutation.isPending
              }
            >
              <Plus className="h-4 w-4 mr-1" />
              Create & Map
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
