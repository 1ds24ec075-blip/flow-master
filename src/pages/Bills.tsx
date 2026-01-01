import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, Loader2, Receipt, Trash2, Eye, CheckCircle, Pencil, Save, X, AlertTriangle, Copy } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { format } from "date-fns";

interface DuplicateMatchDetails {
  matched_bill_id: string;
  matched_bill_number: string | null;
  match_type: "exact_vendor_bill" | "normalized_vendor_bill" | "vendor_amount_date" | "gst_bill_number";
  confidence: "high" | "medium" | "low";
  match_details: string;
}

interface Bill {
  id: string;
  bill_number: string;
  vendor_name: string;
  vendor_gst: string;
  vendor_tin: string;
  bill_date: string;
  total_amount: number;
  payment_status: string;
  image_url: string;
  extraction_confidence: number;
  is_verified: boolean;
  is_duplicate: boolean;
  duplicate_bill_id: string | null;
  duplicate_match_details: DuplicateMatchDetails | null;
  created_at: string;
}

interface EditableBill {
  bill_number: string;
  vendor_name: string;
  vendor_gst: string;
  bill_date: string;
  total_amount: string;
  payment_status: string;
}

export default function Bills() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedBill, setEditedBill] = useState<EditableBill | null>(null);
  const queryClient = useQueryClient();

  const { data: bills, isLoading } = useQuery({
    queryKey: ["bills"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bills" as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as Bill[];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fileName = `${Date.now()}-${file.name}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from("bills" as any)
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: bill, error: insertError } = await supabase
        .from("bills" as any)
        .insert({
          image_url: filePath,
          vendor_name: "Processing...",
          payment_status: "pending",
        } as any)
        .select()
        .single();

      if (insertError) throw insertError;

      const billData = bill as unknown as { id: string };
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const extractResponse = await fetch(
        `${supabaseUrl}/functions/v1/bill-extract`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ billId: billData.id }),
        }
      );

      if (!extractResponse.ok) {
        const errorText = await extractResponse.text();
        throw new Error(`Extraction failed: ${errorText}`);
      }

      return await extractResponse.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to process bill: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (billId: string) => {
      const bill = bills?.find((b) => b.id === billId);
      if (bill?.image_url) {
        await supabase.storage.from("bills" as any).remove([bill.image_url]);
      }

      const { error } = await supabase.from("bills" as any).delete().eq("id", billId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bill deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete bill: ${error.message}`);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (billId: string) => {
      const { error } = await supabase
        .from("bills" as any)
        .update({
          is_verified: true,
          verified_at: new Date().toISOString(),
        } as any)
        .eq("id", billId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bill verified successfully");
      queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to verify bill: ${error.message}`);
    },
  });

  const updateBillMutation = useMutation({
    mutationFn: async ({ billId, updates }: { billId: string; updates: Partial<Bill> }) => {
      const { error } = await supabase
        .from("bills" as any)
        .update(updates as any)
        .eq("id", billId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bill updated successfully");
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      setIsEditing(false);
      setViewDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update bill: ${error.message}`);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const validFiles: File[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name}: File size must be less than 10MB`);
          continue;
        }
        if (!file.type.startsWith("image/")) {
          toast.error(`${file.name}: Only image files are allowed`);
          continue;
        }
        validFiles.push(file);
      }
      setSelectedFiles(validFiles);
    }
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setUploadProgress({ current: 0, total: selectedFiles.length });
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < selectedFiles.length; i++) {
      setUploadProgress({ current: i + 1, total: selectedFiles.length });
      try {
        await uploadMutation.mutateAsync(selectedFiles[i]);
        successCount++;
      } catch {
        failCount++;
      }
    }
    
    setUploading(false);
    setSelectedFiles([]);
    setUploadProgress({ current: 0, total: 0 });
    
    if (successCount > 0) {
      toast.success(`${successCount} bill(s) uploaded and processed successfully!`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} bill(s) failed to process`);
    }
  };

  const handleView = (bill: Bill) => {
    setSelectedBill(bill);
    setIsEditing(false);
    setEditedBill(null);
    setViewDialogOpen(true);
  };

  const handleStartEdit = () => {
    if (selectedBill) {
      setEditedBill({
        bill_number: selectedBill.bill_number || "",
        vendor_name: selectedBill.vendor_name || "",
        vendor_gst: selectedBill.vendor_gst || "",
        bill_date: selectedBill.bill_date || "",
        total_amount: selectedBill.total_amount?.toString() || "0",
        payment_status: selectedBill.payment_status || "pending",
      });
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedBill(null);
  };

  const handleSaveEdit = () => {
    if (!selectedBill || !editedBill) return;

    updateBillMutation.mutate({
      billId: selectedBill.id,
      updates: {
        bill_number: editedBill.bill_number || null,
        vendor_name: editedBill.vendor_name,
        vendor_gst: editedBill.vendor_gst || null,
        bill_date: editedBill.bill_date || null,
        total_amount: parseFloat(editedBill.total_amount) || 0,
        payment_status: editedBill.payment_status,
      } as any,
    });
  };

  const getImageUrl = (path: string) => {
    const { data } = supabase.storage.from("bills").getPublicUrl(path);
    return data.publicUrl;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Bills Management</h1>
        <p className="text-muted-foreground">
          Upload and manage bill photos with automatic data extraction
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Bill Photo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="bill-upload">Select Bill Images</Label>
            <Input
              id="bill-upload"
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileSelect}
              disabled={uploading}
            />
            {selectedFiles.length > 0 && (
              <div className="text-sm text-muted-foreground space-y-1">
                <p className="font-medium">{selectedFiles.length} file(s) selected:</p>
                <ul className="list-disc list-inside max-h-32 overflow-y-auto">
                  {selectedFiles.map((file, index) => (
                    <li key={index}>
                      {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Button
            onClick={handleUpload}
            disabled={selectedFiles.length === 0 || uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing {uploadProgress.current} of {uploadProgress.total}...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload and Extract {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Recent Bills
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : bills && bills.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Bill Number</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bills.map((bill) => (
                    <TableRow key={bill.id} className={bill.is_duplicate ? "bg-red-50" : ""}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {bill.is_duplicate && (
                            <span title="Duplicate">
                              <Copy className="h-4 w-4 text-red-500" />
                            </span>
                          )}
                          {bill.bill_number || "N/A"}
                        </div>
                      </TableCell>
                      <TableCell>{bill.vendor_name}</TableCell>
                      <TableCell>
                        {bill.bill_date
                          ? format(new Date(bill.bill_date), "dd MMM yyyy")
                          : "N/A"}
                      </TableCell>
                      <TableCell className="text-right">
                        ₹{bill.total_amount.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {bill.is_duplicate && (
                            <Badge variant="destructive">
                              Duplicate
                            </Badge>
                          )}
                          <Badge
                            variant={
                              bill.payment_status === "paid"
                                ? "default"
                                : bill.payment_status === "pending"
                                ? "secondary"
                                : "destructive"
                            }
                          >
                            {bill.payment_status}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            bill.extraction_confidence >= 80
                              ? "default"
                              : bill.extraction_confidence >= 60
                              ? "secondary"
                              : "destructive"
                          }
                        >
                          {bill.extraction_confidence}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleView(bill)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {!bill.is_verified && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => verifyMutation.mutate(bill.id)}
                            >
                              <CheckCircle className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteMutation.mutate(bill.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No bills uploaded yet. Upload your first bill to get started!
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={viewDialogOpen} onOpenChange={(open) => {
        setViewDialogOpen(open);
        if (!open) {
          setIsEditing(false);
          setEditedBill(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Bill Details</DialogTitle>
              {selectedBill && !isEditing && (
                <Button variant="outline" size="sm" onClick={handleStartEdit}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
              {isEditing && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveEdit} disabled={updateBillMutation.isPending}>
                    {updateBillMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>
          {selectedBill && (
            <div className="space-y-4">
              {/* Duplicate Detection Alert */}
              {selectedBill.is_duplicate && selectedBill.duplicate_match_details && (
                <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                  <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
                    <AlertTriangle className="h-5 w-5" />
                    Duplicate Bill Detected
                  </div>
                  <div className="text-sm text-red-600 space-y-1">
                    <p><strong>Match Type:</strong> {selectedBill.duplicate_match_details.match_type.replace(/_/g, " ")}</p>
                    <p><strong>Confidence:</strong> <span className={`font-medium ${
                      selectedBill.duplicate_match_details.confidence === "high" ? "text-red-700" : 
                      selectedBill.duplicate_match_details.confidence === "medium" ? "text-orange-600" : "text-yellow-600"
                    }`}>{selectedBill.duplicate_match_details.confidence.toUpperCase()}</span></p>
                    {selectedBill.duplicate_match_details.matched_bill_number && (
                      <p><strong>Matched Bill #:</strong> {selectedBill.duplicate_match_details.matched_bill_number}</p>
                    )}
                    <p><strong>Reason:</strong> {selectedBill.duplicate_match_details.match_details}</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Bill Number</Label>
                  {isEditing ? (
                    <Input
                      value={editedBill?.bill_number || ""}
                      onChange={(e) => setEditedBill(prev => prev ? { ...prev, bill_number: e.target.value } : null)}
                      placeholder="Enter bill number"
                    />
                  ) : (
                    <p className="text-sm font-medium mt-1">
                      {selectedBill.bill_number || "N/A"}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Vendor Name</Label>
                  {isEditing ? (
                    <Input
                      value={editedBill?.vendor_name || ""}
                      onChange={(e) => setEditedBill(prev => prev ? { ...prev, vendor_name: e.target.value } : null)}
                      placeholder="Enter vendor name"
                    />
                  ) : (
                    <p className="text-sm font-medium mt-1">
                      {selectedBill.vendor_name}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>GST Number</Label>
                  {isEditing ? (
                    <Input
                      value={editedBill?.vendor_gst || ""}
                      onChange={(e) => setEditedBill(prev => prev ? { ...prev, vendor_gst: e.target.value } : null)}
                      placeholder="Enter GST number (15 chars)"
                    />
                  ) : (
                    <p className="text-sm font-medium mt-1">
                      {selectedBill.vendor_gst || "N/A"}
                    </p>
                  )}
                </div>
                {selectedBill.vendor_tin && (
                  <div className="space-y-2">
                    <Label>TIN Number</Label>
                    <p className="text-sm font-medium mt-1">
                      {selectedBill.vendor_tin}
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Bill Date</Label>
                  {isEditing ? (
                    <Input
                      type="date"
                      value={editedBill?.bill_date || ""}
                      onChange={(e) => setEditedBill(prev => prev ? { ...prev, bill_date: e.target.value } : null)}
                    />
                  ) : (
                    <p className="text-sm font-medium mt-1">
                      {selectedBill.bill_date
                        ? format(new Date(selectedBill.bill_date), "dd MMM yyyy")
                        : "N/A"}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Total Amount (₹)</Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      step="0.01"
                      value={editedBill?.total_amount || ""}
                      onChange={(e) => setEditedBill(prev => prev ? { ...prev, total_amount: e.target.value } : null)}
                      placeholder="Enter amount"
                    />
                  ) : (
                    <p className="text-sm font-medium mt-1">
                      ₹{selectedBill.total_amount.toFixed(2)}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Payment Status</Label>
                  {isEditing ? (
                    <Select
                      value={editedBill?.payment_status || "pending"}
                      onValueChange={(value) => setEditedBill(prev => prev ? { ...prev, payment_status: value } : null)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="overdue">Overdue</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge
                      className="mt-1"
                      variant={
                        selectedBill.payment_status === "paid"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {selectedBill.payment_status}
                    </Badge>
                  )}
                </div>
              </div>
              {selectedBill.image_url && (
                <div>
                  <Label>Bill Image</Label>
                  <img
                    src={getImageUrl(selectedBill.image_url)}
                    alt="Bill"
                    className="mt-2 rounded-lg border max-w-full h-auto"
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
