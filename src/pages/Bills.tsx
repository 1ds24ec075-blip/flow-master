import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, Loader2, Receipt, Trash2, Eye, CheckCircle } from "lucide-react";
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
import { format } from "date-fns";

interface Bill {
  id: string;
  bill_number: string;
  vendor_name: string;
  vendor_gst: string;
  bill_date: string;
  total_amount: number;
  payment_status: string;
  image_url: string;
  extraction_confidence: number;
  is_verified: boolean;
  created_at: string;
}

export default function Bills() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: bills, isLoading } = useQuery({
    queryKey: ["bills"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bills")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Bill[];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fileName = `${Date.now()}-${file.name}`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from("bills")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: bill, error: insertError } = await supabase
        .from("bills")
        .insert({
          image_url: filePath,
          vendor_name: "Processing...",
          payment_status: "pending",
        })
        .select()
        .single();

      if (insertError) throw insertError;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const extractResponse = await fetch(
        `${supabaseUrl}/functions/v1/bill-extract`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ billId: bill.id }),
        }
      );

      if (!extractResponse.ok) {
        const errorText = await extractResponse.text();
        throw new Error(`Extraction failed: ${errorText}`);
      }

      return await extractResponse.json();
    },
    onSuccess: () => {
      toast.success("Bill uploaded and processed successfully!");
      queryClient.invalidateQueries({ queryKey: ["bills"] });
      setSelectedFile(null);
    },
    onError: (error: Error) => {
      toast.error(`Failed to process bill: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (billId: string) => {
      const bill = bills?.find((b) => b.id === billId);
      if (bill?.image_url) {
        await supabase.storage.from("bills").remove([bill.image_url]);
      }

      const { error } = await supabase.from("bills").delete().eq("id", billId);
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
        .from("bills")
        .update({
          is_verified: true,
          verified_at: new Date().toISOString(),
        })
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File size must be less than 10MB");
        return;
      }
      if (!file.type.startsWith("image/")) {
        toast.error("Only image files are allowed");
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      await uploadMutation.mutateAsync(selectedFile);
    } finally {
      setUploading(false);
    }
  };

  const handleView = (bill: Bill) => {
    setSelectedBill(bill);
    setViewDialogOpen(true);
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
            <Label htmlFor="bill-upload">Select Bill Image</Label>
            <Input
              id="bill-upload"
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              disabled={uploading}
            />
            {selectedFile && (
              <p className="text-sm text-muted-foreground">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            className="w-full"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload and Extract
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
                    <TableRow key={bill.id}>
                      <TableCell className="font-medium">
                        {bill.bill_number || "N/A"}
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

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bill Details</DialogTitle>
          </DialogHeader>
          {selectedBill && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Bill Number</Label>
                  <p className="text-sm font-medium mt-1">
                    {selectedBill.bill_number || "N/A"}
                  </p>
                </div>
                <div>
                  <Label>Vendor Name</Label>
                  <p className="text-sm font-medium mt-1">
                    {selectedBill.vendor_name}
                  </p>
                </div>
                <div>
                  <Label>GST Number</Label>
                  <p className="text-sm font-medium mt-1">
                    {selectedBill.vendor_gst || "N/A"}
                  </p>
                </div>
                <div>
                  <Label>Bill Date</Label>
                  <p className="text-sm font-medium mt-1">
                    {selectedBill.bill_date
                      ? format(new Date(selectedBill.bill_date), "dd MMM yyyy")
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <Label>Total Amount</Label>
                  <p className="text-sm font-medium mt-1">
                    ₹{selectedBill.total_amount.toFixed(2)}
                  </p>
                </div>
                <div>
                  <Label>Payment Status</Label>
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
