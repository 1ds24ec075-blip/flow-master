import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  Users,
  List,
  AlertTriangle,
  RefreshCw,
  Eye,
  Trash2,
  Download,
  Mail,
  FileText,
  Upload,
  Loader2,
  Code,
  Clock,
  CheckCircle2,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

interface DuplicateMatchDetails {
  matched_order_id: string;
  matched_po_number: string;
  match_type: "exact_po_number" | "normalized_po_number" | "vendor_amount_date" | "fingerprint" | "email_filename";
  confidence: "high" | "medium" | "low";
  match_details: string;
}

interface POOrder {
  id: string;
  po_number: string | null;
  vendor_name: string | null;
  customer_name: string | null;
  order_date: string | null;
  total_amount: number | null;
  currency: string;
  status: string;
  created_at: string;
  billing_address: string | null;
  shipping_address: string | null;
  payment_terms: string | null;
  delivery_date: string | null;
  email_subject: string | null;
  email_from: string | null;
  email_date: string | null;
  customer_address: string | null;
  vendor_address: string | null;
  duplicate_match_details: DuplicateMatchDetails | null;
}

// Map database row to POOrder with proper type handling
function mapToPOOrder(row: any): POOrder {
  return {
    ...row,
    duplicate_match_details: row.duplicate_match_details as DuplicateMatchDetails | null,
  };
}

interface POOrderItem {
  id: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_price: number | null;
}

interface LineItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export default function PODashboard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedPO, setSelectedPO] = useState<POOrder | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAppsScriptDialog, setShowAppsScriptDialog] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [sendEmailAfterSave, setSendEmailAfterSave] = useState(false);
  
  const [formData, setFormData] = useState({
    poNumber: "",
    currency: "INR",
    customerName: "",
    customerEmail: "",
    customerAddress: "",
    vendorName: "",
    vendorAddress: "",
    orderDate: "",
    deliveryDate: "",
  });
  
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, unit: "Nos", unitPrice: 0 },
  ]);

  const { data: orders, isLoading, refetch } = useQuery({
    queryKey: ["po-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("po_orders")
        .select("*")
        .neq("status", "price_mismatch")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map(mapToPOOrder);
    },
    refetchInterval: 30000,
  });

  const { data: priceMismatchCount } = useQuery({
    queryKey: ["price-mismatch-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("po_orders")
        .select("*", { count: "exact", head: true })
        .eq("status", "price_mismatch");
      if (error) throw error;
      return count || 0;
    },
  });

  const { data: orderItems } = useQuery({
    queryKey: ["po-order-items", selectedPO?.id],
    queryFn: async () => {
      if (!selectedPO?.id) return [];
      const { data, error } = await supabase
        .from("po_order_items")
        .select("*")
        .eq("po_order_id", selectedPO.id)
        .order("item_number");
      if (error) throw error;
      return data as POOrderItem[];
    },
    enabled: !!selectedPO?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("po_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["po-orders"] });
      toast.success("Order deleted successfully");
    },
    onError: () => {
      toast.error("Failed to delete order");
    },
  });

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      const totalAmount = lineItems.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0
      );

      const { data: order, error: orderError } = await supabase
        .from("po_orders")
        .insert({
          po_number: formData.poNumber || `PO-${Date.now()}`,
          customer_name: formData.customerName,
          customer_address: formData.customerAddress,
          vendor_name: formData.vendorName,
          vendor_address: formData.vendorAddress,
          order_date: formData.orderDate || null,
          delivery_date: formData.deliveryDate || null,
          total_amount: totalAmount,
          currency: formData.currency,
          status: "pending",
        })
        .select()
        .single();

      if (orderError) throw orderError;

      const itemsToInsert = lineItems
        .filter((item) => item.description)
        .map((item, index) => ({
          po_order_id: order.id,
          item_number: index + 1,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unitPrice,
          total_price: item.quantity * item.unitPrice,
        }));

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from("po_order_items")
          .insert(itemsToInsert);
        if (itemsError) throw itemsError;
      }

      return order;
    },
    onSuccess: async (order) => {
      queryClient.invalidateQueries({ queryKey: ["po-orders"] });
      toast.success("Order created successfully");
      setShowAddDialog(false);
      resetForm();

      if (sendEmailAfterSave && formData.customerEmail) {
        try {
          await supabase.functions.invoke("send-sales-order", {
            body: { orderId: order.id, recipientEmail: formData.customerEmail },
          });
          toast.success("Sales order email sent!");
        } catch (e) {
          toast.error("Order created but email failed to send");
        }
      }
    },
    onError: () => {
      toast.error("Failed to create order");
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async ({ orderId, email }: { orderId: string; email?: string }) => {
      const { data, error } = await supabase.functions.invoke("send-sales-order", {
        body: { orderId, recipientEmail: email },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Sales order email sent successfully!");
      queryClient.invalidateQueries({ queryKey: ["po-orders"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to send email: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFormData({
      poNumber: "",
      currency: "INR",
      customerName: "",
      customerEmail: "",
      customerAddress: "",
      vendorName: "",
      vendorAddress: "",
      orderDate: "",
      deliveryDate: "",
    });
    setLineItems([{ description: "", quantity: 1, unit: "Nos", unitPrice: 0 }]);
    setUploadedFile(null);
    setSendEmailAfterSave(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.type !== "application/pdf") {
      toast.error("Please upload a PDF file");
      return;
    }

    setUploadedFile(file);
    setIsExtracting(true);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        
        const { data, error } = await supabase.functions.invoke("process-po", {
          body: {
            pdfBase64: base64,
            filename: file.name,
            extractOnly: true,
          },
        });

        if (error) throw error;

        if (data?.extracted) {
          const ext = data.extracted;
          setFormData({
            poNumber: ext.po_number || "",
            currency: ext.currency || "INR",
            customerName: ext.customer_name || "",
            customerEmail: ext.customer_email || "",
            customerAddress: ext.customer_address || "",
            vendorName: ext.vendor_name || "",
            vendorAddress: ext.vendor_address || "",
            orderDate: ext.order_date || "",
            deliveryDate: ext.delivery_date || "",
          });

          if (ext.items && ext.items.length > 0) {
            setLineItems(
              ext.items.map((item: { description?: string; quantity?: number; unit?: string; unit_price?: number }) => ({
                description: item.description || "",
                quantity: item.quantity || 1,
                unit: item.unit || "Nos",
                unitPrice: item.unit_price || 0,
              }))
            );
          }

          toast.success("Data extracted successfully!");
        }
      };
      reader.readAsDataURL(file);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Extraction failed: ${errorMessage}`);
    } finally {
      setIsExtracting(false);
    }
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, unit: "Nos", unitPrice: 0 }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const totalAmount = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );

  const stats = {
    total: orders?.length || 0,
    processed: orders?.filter((o) => o.status === "processed").length || 0,
    converted: orders?.filter((o) => o.status === "converted").length || 0,
    totalValue: orders?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0,
  };

  const appsScriptCode = `// Google Apps Script - Purchase Order Processor
const SUPABASE_URL = "${import.meta.env.VITE_SUPABASE_URL}";
const SUPABASE_KEY = "${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}";
const EDGE_FUNCTION_URL = SUPABASE_URL + "/functions/v1/process-po";

function createTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processNewPOEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('processNewPOEmails')
    .timeBased()
    .everyHours(1)
    .create();
}

function processNewPOEmails() {
  const searchQuery = 'is:unread (subject:po OR subject:"purchase order") has:attachment';
  const threads = GmailApp.search(searchQuery, 0, 10);
  
  threads.forEach(thread => {
    const messages = thread.getMessages();
    messages.forEach(message => {
      if (message.isUnread()) {
        processMessage(message);
        message.markRead();
      }
    });
  });
}

function processMessage(message) {
  const attachments = message.getAttachments();
  const subject = message.getSubject();
  const from = message.getFrom();
  const date = message.getDate().toISOString();
  
  attachments.forEach(attachment => {
    const filename = attachment.getName().toLowerCase();
    if (filename.endsWith('.pdf')) {
      const blob = attachment.copyBlob();
      const base64 = Utilities.base64Encode(blob.getBytes());
      sendToProcessor(base64, attachment.getName(), subject, from, date);
    }
  });
}

function sendToProcessor(pdfBase64, filename, emailSubject, emailFrom, emailDate) {
  const payload = {
    pdfBase64: pdfBase64,
    filename: filename,
    emailSubject: emailSubject,
    emailFrom: emailFrom,
    emailDate: emailDate
  };
  
  const options = {
    method: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + SUPABASE_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  UrlFetchApp.fetch(EDGE_FUNCTION_URL, options);
}`;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="border-muted-foreground text-muted-foreground">
            Pending
          </Badge>
        );
      case "processed":
        return (
          <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
            Processed
          </Badge>
        );
      case "converted":
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            Converted
          </Badge>
        );
      case "duplicate":
        return (
          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
            Duplicate
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 bg-slate-50 min-h-screen p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-background rounded-xl p-4 shadow-sm border">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
            <FileText className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">PO Processor</h1>
            <p className="text-sm text-muted-foreground">
              Purchase Order to Sales Order Converter
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                Add PO
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Purchase Order</DialogTitle>
              </DialogHeader>
              <div className="space-y-6">
                {/* PDF Upload */}
                <div className="border-2 border-dashed rounded-lg p-6 text-center">
                  <Input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="pdf-upload"
                    disabled={isExtracting}
                  />
                  <label htmlFor="pdf-upload" className="cursor-pointer">
                    {isExtracting ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        <span>Extracting data...</span>
                      </div>
                    ) : uploadedFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileText className="h-6 w-6" />
                        <span>{uploadedFile.name}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="h-8 w-8 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          Upload PDF to auto-extract data
                        </span>
                      </div>
                    )}
                  </label>
                </div>

                {/* Form Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>PO Number *</Label>
                    <Input
                      value={formData.poNumber}
                      onChange={(e) =>
                        setFormData({ ...formData, poNumber: e.target.value })
                      }
                      placeholder="PO-001"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select
                      value={formData.currency}
                      onValueChange={(v) =>
                        setFormData({ ...formData, currency: v })
                      }
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
                  <div className="space-y-2">
                    <Label>Customer Name *</Label>
                    <Input
                      value={formData.customerName}
                      onChange={(e) =>
                        setFormData({ ...formData, customerName: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Customer Email</Label>
                    <Input
                      type="email"
                      value={formData.customerEmail}
                      onChange={(e) =>
                        setFormData({ ...formData, customerEmail: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <Label>Customer Address</Label>
                    <Textarea
                      value={formData.customerAddress}
                      onChange={(e) =>
                        setFormData({ ...formData, customerAddress: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Vendor Name</Label>
                    <Input
                      value={formData.vendorName}
                      onChange={(e) =>
                        setFormData({ ...formData, vendorName: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Vendor Address</Label>
                    <Input
                      value={formData.vendorAddress}
                      onChange={(e) =>
                        setFormData({ ...formData, vendorAddress: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Order Date</Label>
                    <Input
                      type="date"
                      value={formData.orderDate}
                      onChange={(e) =>
                        setFormData({ ...formData, orderDate: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Delivery Date</Label>
                    <Input
                      type="date"
                      value={formData.deliveryDate}
                      onChange={(e) =>
                        setFormData({ ...formData, deliveryDate: e.target.value })
                      }
                    />
                  </div>
                </div>

                {/* Line Items */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-lg">Line Items</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Item
                    </Button>
                  </div>
                  {lineItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5 space-y-1">
                        <Label className="text-xs">Description</Label>
                        <Input
                          value={item.description}
                          onChange={(e) =>
                            updateLineItem(index, "description", e.target.value)
                          }
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Qty</Label>
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) =>
                            updateLineItem(index, "quantity", Number(e.target.value))
                          }
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Unit</Label>
                        <Input
                          value={item.unit}
                          onChange={(e) =>
                            updateLineItem(index, "unit", e.target.value)
                          }
                        />
                      </div>
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Unit Price</Label>
                        <Input
                          type="number"
                          value={item.unitPrice}
                          onChange={(e) =>
                            updateLineItem(index, "unitPrice", Number(e.target.value))
                          }
                        />
                      </div>
                      <div className="col-span-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLineItem(index)}
                          disabled={lineItems.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="text-right font-semibold">
                    Total: {formData.currency} {totalAmount.toLocaleString()}
                  </div>
                </div>

                {/* Send Email Option */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="send-email"
                    checked={sendEmailAfterSave}
                    onCheckedChange={(checked) => setSendEmailAfterSave(!!checked)}
                    disabled={!formData.customerEmail}
                  />
                  <Label htmlFor="send-email" className="text-sm">
                    Send Sales Order email after saving
                    {!formData.customerEmail && " (requires customer email)"}
                  </Label>
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAddDialog(false);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createOrderMutation.mutate()}
                    disabled={!formData.customerName || createOrderMutation.isPending}
                  >
                    {createOrderMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Order"
                    )}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Button variant="outline" onClick={() => navigate("/customer-master")} className="bg-background">
            <Users className="h-4 w-4 mr-2" />
            Customers
          </Button>
          <Button variant="outline" onClick={() => navigate("/price-list")} className="bg-background">
            <List className="h-4 w-4 mr-2" />
            Price List
          </Button>
          <Button
            variant="outline"
            className="relative bg-background"
            onClick={() => navigate("/review")}
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            Review
            {priceMismatchCount ? (
              <Badge className="ml-2 bg-orange-500 text-white">{priceMismatchCount}</Badge>
            ) : null}
          </Button>
          <Dialog open={showAppsScriptDialog} onOpenChange={setShowAppsScriptDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" className="bg-background">
                <Code className="h-4 w-4 mr-2" />
                Apps Script
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Google Apps Script Setup</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Copy this script to Google Apps Script to automatically process PO emails from Gmail.
                </p>
                <div className="relative">
                  <pre className="bg-muted p-4 rounded-lg text-xs overflow-auto max-h-96">
                    {appsScriptCode}
                  </pre>
                  <Button
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => {
                      navigator.clipboard.writeText(appsScriptCode);
                      toast.success("Copied to clipboard!");
                    }}
                  >
                    Copy
                  </Button>
                </div>
                <div className="text-sm space-y-2">
                  <p><strong>Setup Instructions:</strong></p>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Go to script.google.com</li>
                    <li>Create a new project</li>
                    <li>Paste this code</li>
                    <li>Run createTrigger() once to set up hourly processing</li>
                    <li>Authorize the script when prompted</li>
                  </ol>
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

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-background shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Orders</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-background shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-orange-100 flex items-center justify-center">
                <Clock className="h-6 w-6 text-orange-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Processed</p>
                <p className="text-2xl font-bold">{stats.processed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-background shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Converted</p>
                <p className="text-2xl font-bold">{stats.converted}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-background shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-blue-100 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold">₹{stats.totalValue.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Orders Table */}
      <Card className="bg-background shadow-sm border">
        <CardHeader className="pb-3">
          <CardTitle>Purchase Orders</CardTitle>
          <CardDescription>View and manage all processed purchase orders</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : orders && orders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-medium">PO Number</TableHead>
                  <TableHead className="font-medium">Vendor</TableHead>
                  <TableHead className="font-medium">Customer</TableHead>
                  <TableHead className="font-medium">Date</TableHead>
                  <TableHead className="font-medium">Amount</TableHead>
                  <TableHead className="font-medium">Status</TableHead>
                  <TableHead className="font-medium text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">
                      {order.po_number || "-"}
                    </TableCell>
                    <TableCell>{order.vendor_name || "-"}</TableCell>
                    <TableCell>{order.customer_name || "-"}</TableCell>
                    <TableCell>
                      {order.order_date
                        ? new Date(order.order_date).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "-"}
                    </TableCell>
                    <TableCell>
                      ₹{order.total_amount?.toLocaleString() || "0"}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(order.status)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedPO(order)}
                            >
                              <Eye className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>
                                Order Details - {selectedPO?.po_number}
                              </DialogTitle>
                            </DialogHeader>
                            {selectedPO && (
                              <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                  <div>
                                    <Label className="text-muted-foreground">Vendor</Label>
                                    <p>{selectedPO.vendor_name || "-"}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {selectedPO.vendor_address}
                                    </p>
                                  </div>
                                  <div>
                                    <Label className="text-muted-foreground">Customer</Label>
                                    <p>{selectedPO.customer_name || "-"}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {selectedPO.customer_address}
                                    </p>
                                  </div>
                                  <div>
                                    <Label className="text-muted-foreground">Order Date</Label>
                                    <p>
                                      {selectedPO.order_date
                                        ? new Date(selectedPO.order_date).toLocaleDateString()
                                        : "-"}
                                    </p>
                                  </div>
                                  <div>
                                    <Label className="text-muted-foreground">Delivery Date</Label>
                                    <p>
                                      {selectedPO.delivery_date
                                        ? new Date(selectedPO.delivery_date).toLocaleDateString()
                                        : "-"}
                                    </p>
                                  </div>
                                  <div>
                                    <Label className="text-muted-foreground">Payment Terms</Label>
                                    <p>{selectedPO.payment_terms || "-"}</p>
                                  </div>
                                  <div>
                                    <Label className="text-muted-foreground">Total</Label>
                                    <p className="font-semibold">
                                      {selectedPO.currency}{" "}
                                      {selectedPO.total_amount?.toLocaleString()}
                                    </p>
                                  </div>
                                </div>

                                {orderItems && orderItems.length > 0 && (
                                  <div>
                                    <Label className="text-muted-foreground">Line Items</Label>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Description</TableHead>
                                          <TableHead>Qty</TableHead>
                                          <TableHead>Unit</TableHead>
                                          <TableHead>Unit Price</TableHead>
                                          <TableHead>Total</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {orderItems.map((item) => (
                                          <TableRow key={item.id}>
                                            <TableCell>{item.description}</TableCell>
                                            <TableCell>{item.quantity}</TableCell>
                                            <TableCell>{item.unit}</TableCell>
                                            <TableCell>{item.unit_price}</TableCell>
                                            <TableCell>{item.total_price}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}

                                {selectedPO.status === "duplicate" && selectedPO.duplicate_match_details && (
                                  <div className="bg-red-50 border border-red-200 p-3 rounded-lg text-sm">
                                    <Label className="text-red-700 font-medium flex items-center gap-2">
                                      <AlertTriangle className="h-4 w-4" />
                                      Duplicate Detection Details
                                    </Label>
                                    <div className="mt-2 space-y-1 text-red-600">
                                      <p><strong>Match Type:</strong> {selectedPO.duplicate_match_details.match_type.replace(/_/g, " ")}</p>
                                      <p><strong>Confidence:</strong> <span className={`font-medium ${
                                        selectedPO.duplicate_match_details.confidence === "high" ? "text-red-700" : 
                                        selectedPO.duplicate_match_details.confidence === "medium" ? "text-orange-600" : "text-yellow-600"
                                      }`}>{selectedPO.duplicate_match_details.confidence.toUpperCase()}</span></p>
                                      <p><strong>Matched PO:</strong> {selectedPO.duplicate_match_details.matched_po_number}</p>
                                      <p><strong>Reason:</strong> {selectedPO.duplicate_match_details.match_details}</p>
                                    </div>
                                  </div>
                                )}

                                {selectedPO.email_from && (
                                  <div className="bg-muted p-3 rounded-lg text-sm">
                                    <Label className="text-muted-foreground">Email Source</Label>
                                    <p>From: {selectedPO.email_from}</p>
                                    <p>Subject: {selectedPO.email_subject}</p>
                                    <p>
                                      Date:{" "}
                                      {selectedPO.email_date
                                        ? new Date(selectedPO.email_date).toLocaleString()
                                        : "-"}
                                    </p>
                                  </div>
                                )}

                                <div className="flex justify-end gap-2">
                                  <Button variant="outline">
                                    <Download className="h-4 w-4 mr-2" />
                                    Download PDF
                                  </Button>
                                  <Button
                                    onClick={() =>
                                      sendEmailMutation.mutate({ orderId: selectedPO.id })
                                    }
                                    disabled={sendEmailMutation.isPending}
                                  >
                                    {sendEmailMutation.isPending ? (
                                      <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Sending...
                                      </>
                                    ) : (
                                      <>
                                        <Mail className="h-4 w-4 mr-2" />
                                        Send Email
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </DialogContent>
                        </Dialog>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Order</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete this order? This action
                                cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(order.id)}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              No purchase orders found. Add a PO or set up Gmail integration.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
