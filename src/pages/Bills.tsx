import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Upload, Loader2, Receipt, Trash2, Eye, CheckCircle, Pencil, Save, X, AlertTriangle, Copy, Download, Send, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
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

import { buildBillSyncJobs, stockItemNameFor, DEFAULT_STOCK_UNIT } from "@tally/jobs";
import { serializeVoucherToXML } from "@tally/serializer";

// Display-only. The agent gets the authoritative company name from the cloud.
const TALLY_COMPANY_NAME = "Guhanesh";

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
  tally_status?: string | null;
  tally_xml?: string | null;
  tally_error?: string | null;
  tally_uploaded_at?: string | null;
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

interface ExpenseLineItem {
  item_description?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  tax_rate?: number | null;
  amount?: number | null;
}

interface TallyImportRow {
  Date: string;
  "Voucher Type": string;
  "Voucher Number": string;
  "Party Ledger": string;
  "Item Name": string;
  Quantity: number;
  Unit: string;
  Rate: number;
  Amount: number;
  CGST: number;
  SGST: number;
  Narration: string;
}

const normalizeAmount = (value?: number | null) => Number(Number(value ?? 0).toFixed(2));

const tallyStatusVariant = (status?: string | null) => {
  if (status === "sent") return "default" as const;
  if (status === "failed") return "destructive" as const;
  if (status === "queued" || status === "ready") return "secondary" as const;
  return "outline" as const;
};

const tallyStatusHint = (status?: string | null) => {
  switch (status) {
    case "queued":
      return "Waiting for the desktop agent to push it — it syncs whenever Tally is open.";
    case "sent":
      return "Booked in Tally.";
    case "failed":
      return "Tally rejected this voucher. Fix the underlying data and queue it again.";
    default:
      return "Not queued yet.";
  }
};

const getItemQuantity = (item: ExpenseLineItem) => {
  const quantity = normalizeAmount(item.quantity);
  return quantity > 0 ? quantity : 1;
};

const getItemAmount = (item: ExpenseLineItem) => normalizeAmount(item.amount ?? item.unit_price ?? 0);

const formatTallyImportDate = (dateValue?: string | null) => {
  if (!dateValue) return null;
  const parsedDate = new Date(dateValue);
  if (Number.isNaN(parsedDate.getTime())) return null;
  return format(parsedDate, "dd-MM-yyyy");
};

const allocateCurrencyShares = (total: number, baseAmounts: number[]) => {
  if (total <= 0 || baseAmounts.length === 0) return baseAmounts.map(() => 0);

  const totalBase = normalizeAmount(baseAmounts.reduce((sum, amount) => sum + amount, 0));
  const shares: number[] = [];
  let remaining = normalizeAmount(total);

  baseAmounts.forEach((amount, index) => {
    if (index === baseAmounts.length - 1) {
      shares.push(normalizeAmount(remaining));
      return;
    }

    const proportion = totalBase > 0 ? amount / totalBase : 0;
    const allocated = normalizeAmount(total * proportion);
    shares.push(allocated);
    remaining = normalizeAmount(remaining - allocated);
  });

  return shares;
};

/** Rows for the spreadsheet export, which is a different shape from the voucher. */
const buildTallyImportRows = (bill: Bill, items: ExpenseLineItem[]) => {
  const referenceNumber = (bill.bill_number || `BILL-${bill.id.slice(0, 8)}`).trim();
  const partyLedger = bill.vendor_name?.trim();
  const voucherDate = formatTallyImportDate(bill.bill_date);

  if (!partyLedger) throw new Error("Party ledger name is missing.");
  if (!voucherDate) throw new Error("Bill date is missing or invalid.");

  const validItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => stockItemNameFor(item, index) && getItemAmount(item) > 0);

  if (validItems.length === 0) {
    throw new Error(`No valid line items found for bill ${referenceNumber}`);
  }

  const totalAmount = normalizeAmount(bill.total_amount);
  const inventoryTotal = normalizeAmount(
    validItems.reduce((sum, { item }) => sum + getItemAmount(item), 0),
  );
  const gstTotal = normalizeAmount(totalAmount - inventoryTotal);

  if (gstTotal < 0) {
    throw new Error(`Bill ${referenceNumber} has item totals greater than the invoice total`);
  }

  const cgstTotal = gstTotal > 0 ? normalizeAmount(gstTotal / 2) : 0;
  const sgstTotal = gstTotal > 0 ? normalizeAmount(gstTotal - cgstTotal) : 0;
  const rowAmounts = validItems.map(({ item }) => getItemAmount(item));
  const cgstShares = allocateCurrencyShares(cgstTotal, rowAmounts);
  const sgstShares = allocateCurrencyShares(sgstTotal, rowAmounts);

  return validItems.map(({ item, index }, rowIndex) => {
    const itemName = stockItemNameFor(item, index);
    const quantity = getItemQuantity(item);
    const amount = getItemAmount(item);
    const rate = quantity > 0 ? amount / quantity : amount;

    return {
      Date: voucherDate,
      "Voucher Type": "Purchase",
      "Voucher Number": referenceNumber,
      "Party Ledger": partyLedger,
      "Item Name": itemName,
      Quantity: quantity,
      Unit: DEFAULT_STOCK_UNIT,
      Rate: rate,
      Amount: amount,
      CGST: cgstShares[rowIndex],
      SGST: sgstShares[rowIndex],
      Narration: `Purchase bill ${referenceNumber} from ${partyLedger}`,
    } satisfies TallyImportRow;
  });
};

/**
 * Renders the voucher for the manual-download path only.
 *
 * The sync path never calls this — it enqueues JSON and the desktop agent
 * renders the XML at send time through this same serializer.
 */
const buildBillTallyXml = (bill: Bill, items: ExpenseLineItem[]) => {
  const { voucher } = buildBillSyncJobs(bill, items);
  return serializeVoucherToXML(voucher, TALLY_COMPANY_NAME);
};


export default function Bills({ embedded = false }: { embedded?: boolean }) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [lineItems, setLineItems] = useState<any[] | null>(null);
  const [lineItemsLoading, setLineItemsLoading] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedBill, setEditedBill] = useState<EditableBill | null>(null);
  const [tallyProcessingId, setTallyProcessingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: bills, isLoading } = useQuery({
    queryKey: ["bills"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bills" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);

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

      const extractedBill = await extractResponse.json();

      try {
        await fetch(
          `${supabaseUrl}/functions/v1/bill-generate-tally`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ billId: billData.id }),
          }
        );
      } catch (error) {
        console.warn("Tally payload generation skipped after extraction", error);
      }

      return extractedBill;
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

  const generateTallyMutation = useMutation({
    mutationFn: async ({ bill, sendToTally }: { bill: Bill; sendToTally: boolean }) => {
      setTallyProcessingId(bill.id);

      if (bill.is_duplicate) throw new Error("Duplicate bills cannot be sent to Tally");
      if (!bill.vendor_name || bill.vendor_name === "Processing...") throw new Error("Bill extraction is not complete");
      if (!bill.total_amount || bill.total_amount <= 0) throw new Error("Bill has no valid amount");

      // Queue it. The desktop agent renders the XML and pushes it the next time
      // Tally is up, so this no longer needs the browser to reach localhost:9000.
      if (sendToTally) {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey =
          import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        // The session token, not the anon key: the anon key ships in this bundle,
        // so sending it would leave the endpoint open to anyone.
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) throw new Error("Please sign in to send bills to Tally");

        const response = await fetch(`${supabaseUrl}/functions/v1/tally-enqueue`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.session.access_token}`,
            apikey: supabaseKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ billId: bill.id }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || `Could not queue the bill (HTTP ${response.status})`);

        return { queued: true as const, jobs: payload.queued ?? 0, tally_xml: null };
      }

      // Download path: render locally through the same serializer the agent uses.
      const { data: items, error: itemsError } = await supabase
        .from("expense_line_items" as any)
        .select("item_description, quantity, unit_price, tax_rate, amount")
        .eq("bill_id", bill.id)
        .order("created_at", { ascending: true });

      if (itemsError) throw itemsError;

      const tallyXml = buildBillTallyXml(bill, (items || []) as ExpenseLineItem[]);
      return { queued: false as const, jobs: 0, tally_xml: tallyXml };
    },
    onSuccess: (payload, variables) => {
      queryClient.invalidateQueries({ queryKey: ["bills"] });

      if (payload.queued) {
        toast.success(`Queued for Tally (${payload.jobs} job${payload.jobs === 1 ? "" : "s"})`, {
          description: "The desktop agent will push it the next time Tally is open.",
        });
        return;
      }

      downloadTallyXml(variables.bill.id, payload.tally_xml!);
      toast.success("Tally XML generated");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
    onSettled: () => {
      setTallyProcessingId(null);
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
          if (!file.type.startsWith("image/") && file.type !== 'application/pdf') {
            toast.error(`${file.name}: Only image or PDF files are allowed`);
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
    // fetch line items for the bill
    (async () => {
      try {
        setLineItemsLoading(true);
        const { data: items, error } = await supabase
          .from('expense_line_items' as any)
          .select('*')
          .eq('bill_id', bill.id)
          .order('id', { ascending: true });

        if (error) throw error;
        setLineItems(items || []);
      } catch (err) {
        console.error('Failed to load line items', err);
        setLineItems([]);
      } finally {
        setLineItemsLoading(false);
      }
    })();
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

  const fetchBillLineItems = async (billId: string) => {
    const { data: items, error } = await supabase
      .from("expense_line_items" as any)
      .select("item_description, quantity, unit_price, tax_rate, amount")
      .eq("bill_id", billId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return (items || []) as ExpenseLineItem[];
  };

  const downloadTallyXml = (billId: string, xml: string) => {
    const bill = bills?.find((item) => item.id === billId);
    const safeBillNumber = (bill?.bill_number || billId.slice(0, 8)).replace(/[^a-z0-9-]/gi, "_");
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tally-bill-${safeBillNumber}.xml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const exportBillsToExcel = async () => {
    if (!bills || bills.length === 0) {
      toast.error("No bills available to export");
      return;
    }

    try {
      const rows = await Promise.all(
        bills.map(async (bill) => {
          const items = await fetchBillLineItems(bill.id);
          return buildTallyImportRows(bill, items);
        })
      );

      const flatRows = rows.flat();
      if (flatRows.length === 0) {
        throw new Error("No valid line items found to export");
      }

      const worksheet = XLSX.utils.json_to_sheet(flatRows);
      worksheet["!cols"] = [
        { wch: 14 },
        { wch: 16 },
        { wch: 20 },
        { wch: 28 },
        { wch: 34 },
        { wch: 10 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 10 },
        { wch: 10 },
        { wch: 36 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Tally Import");
      XLSX.writeFile(workbook, `tally-import-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Tally import spreadsheet downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export Tally import spreadsheet");
    }
  };

  const exportSingleBillToExcel = async (bill: Bill) => {
    try {
      if (!bill.vendor_name || bill.vendor_name === "Processing...") {
        throw new Error("Bill extraction is not complete");
      }
      if (!bill.total_amount || bill.total_amount <= 0) {
        throw new Error("Bill has no valid amount");
      }

      const items = await fetchBillLineItems(bill.id);
      const tallyRows = buildTallyImportRows(bill, items);
      const worksheet = XLSX.utils.json_to_sheet(tallyRows);
      worksheet["!cols"] = [
        { wch: 14 },
        { wch: 16 },
        { wch: 20 },
        { wch: 28 },
        { wch: 34 },
        { wch: 10 },
        { wch: 10 },
        { wch: 12 },
        { wch: 12 },
        { wch: 10 },
        { wch: 10 },
        { wch: 36 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Tally Import");

      const safeBillNumber = (tallyRows[0]?.["Voucher Number"] || `BILL-${bill.id.slice(0, 8)}`).replace(/[^a-z0-9-]/gi, "_");
      XLSX.writeFile(workbook, `tally-import-${safeBillNumber}.xlsx`);
      toast.success("Tally import spreadsheet downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to export bill spreadsheet");
    }
  };

  const handleGenerateTally = (bill: Bill) => {
    generateTallyMutation.mutate({ bill, sendToTally: false });
  };

  const handleSendToTally = (bill: Bill) => {
    generateTallyMutation.mutate({ bill, sendToTally: true });
  };

  return (
    <div className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-3xl font-bold">Bills Management</h1>
          <p className="text-muted-foreground">
            Upload and manage bill photos with automatic data extraction
          </p>
        </div>
      )}

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
              accept="image/*,application/pdf"
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
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Recent Bills
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={exportBillsToExcel}
            disabled={!bills || bills.length === 0}
            title="Download bills spreadsheet"
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Excel
          </Button>
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
                    <TableHead>Tally</TableHead>
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
                          variant={tallyStatusVariant(bill.tally_status)}
                          title={bill.tally_error || tallyStatusHint(bill.tally_status)}
                        >
                          {bill.tally_status || "not_generated"}
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
                            onClick={() => handleGenerateTally(bill)}
                            disabled={tallyProcessingId === bill.id || bill.is_duplicate}
                            title="Generate Tally XML"
                          >
                            {tallyProcessingId === bill.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => exportSingleBillToExcel(bill)}
                            disabled={tallyProcessingId === bill.id || bill.is_duplicate}
                            title="Download this bill as Excel"
                          >
                            <FileSpreadsheet className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSendToTally(bill)}
                            disabled={tallyProcessingId === bill.id || bill.is_duplicate}
                            title="Send to Tally"
                          >
                            <Send className="h-4 w-4" />
                          </Button>
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
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateTally(selectedBill)}
                    disabled={tallyProcessingId === selectedBill.id || selectedBill.is_duplicate}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Tally XML
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => exportSingleBillToExcel(selectedBill)}
                    disabled={tallyProcessingId === selectedBill.id || selectedBill.is_duplicate}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Excel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSendToTally(selectedBill)}
                    disabled={tallyProcessingId === selectedBill.id || selectedBill.is_duplicate}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Tally
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleStartEdit}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                </div>
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
                <div className="space-y-2">
                  <Label>Tally Status</Label>
                  <div className="space-y-1">
                    <Badge variant={tallyStatusVariant(selectedBill.tally_status)}>
                      {selectedBill.tally_status || "not_generated"}
                    </Badge>
                    {selectedBill.tally_error ? (
                      <p className="text-xs text-destructive">{selectedBill.tally_error}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {tallyStatusHint(selectedBill.tally_status)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              {selectedBill.image_url && (
                <div>
                  <Label>Bill Image</Label>
                  {selectedBill.image_url.toLowerCase().endsWith('.pdf') ? (
                    <div className="mt-2">
                      <a href={getImageUrl(selectedBill.image_url)} target="_blank" rel="noreferrer" className="text-blue-600 underline">View PDF</a>
                    </div>
                  ) : (
                    <img
                      src={getImageUrl(selectedBill.image_url)}
                      alt="Bill"
                      className="mt-2 rounded-lg border max-w-full h-auto"
                    />
                  )}
                </div>
              )}
              {/* Line items extracted from OCR */}
              <div>
                <Label>Line Items</Label>
                {lineItemsLoading ? (
                  <div className="py-4">Loading line items...</div>
                ) : lineItems && lineItems.length > 0 ? (
                  <div className="rounded-md border mt-2 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Quantity</TableHead>
                          <TableHead className="text-right">Unit Price</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lineItems.map((item, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{item.item_description}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">₹{(item.unit_price || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-right">₹{(item.amount || 0).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mt-2">No line items extracted.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
