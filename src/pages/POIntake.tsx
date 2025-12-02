import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function POIntake() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [currentPoId, setCurrentPoId] = useState<string | null>(null);
  const [editedData, setEditedData] = useState<any>(null);
  const queryClient = useQueryClient();

  const { data: currentPo, isLoading: poLoading } = useQuery({
    queryKey: ["po-intake", currentPoId],
    queryFn: async () => {
      if (!currentPoId) return null;
      const { data, error } = await supabase
        .from("po_intake_documents")
        .select("*")
        .eq("id", currentPoId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!currentPoId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("uploadedBy", "current_user");

      const { data, error } = await supabase.functions.invoke("po-upload", {
        body: formData,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setCurrentPoId(data.id);
      setSelectedFile(null);
      toast.success("File uploaded successfully!");
      queryClient.invalidateQueries({ queryKey: ["po-intake"] });
    },
    onError: (error: any) => {
      toast.error(`Upload failed: ${error.message}`);
    },
  });

  const extractMutation = useMutation({
    mutationFn: async (poId: string) => {
      const { data, error } = await supabase.functions.invoke("po-extract", {
        body: { poId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setEditedData(data.extracted_data);
      if (data.purchase_order_created) {
        toast.success("Extraction completed and saved to Purchase Orders!");
      } else {
        toast.success("Extraction completed! Data is shown below.");
      }
      queryClient.invalidateQueries({ queryKey: ["po-intake", currentPoId] });
    },
    onError: (error: any) => {
      toast.error(`Extraction failed: ${error.message}`);
    },
  });


  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const handleExtract = () => {
    if (currentPoId) {
      extractMutation.mutate(currentPoId);
    }
  };


  const getStatusBadge = (status: string) => {
    const colors = {
      uploaded: "bg-blue-500",
      extracted: "bg-yellow-500",
      saved: "bg-green-500",
      ready_for_tally: "bg-purple-500",
    };
    return (
      <Badge className={colors[status as keyof typeof colors] || "bg-gray-500"}>
        {status.replace(/_/g, " ").toUpperCase()}
      </Badge>
    );
  };

  const getConfidenceBadge = (score: number) => {
    if (score >= 90) return <Badge className="bg-green-500">High ({score}%)</Badge>;
    if (score >= 70) return <Badge className="bg-yellow-500">Medium ({score}%)</Badge>;
    return <Badge className="bg-red-500">Low ({score}%)</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">PO Intake & Extraction</h1>
        <p className="text-muted-foreground">Upload PO document → AI will extract and automatically save to Purchase Orders</p>
      </div>

      {/* Upload Section */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Upload className="h-5 w-5" />
          1. Upload PO Document
        </h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="file-upload">Select File (PDF, PNG, JPG, DOC, TXT)</Label>
            <Input
              id="file-upload"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt"
              onChange={handleFileSelect}
              className="mt-2"
            />
          </div>
          {selectedFile && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded">
              <FileText className="h-5 w-5" />
              <span className="flex-1">{selectedFile.name}</span>
              <span className="text-sm text-muted-foreground">
                {(selectedFile.size / 1024).toFixed(2)} KB
              </span>
            </div>
          )}
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || uploadMutation.isPending}
            className="w-full"
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload File
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* Current PO Status */}
      {currentPo && (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Current Document</h3>
            {getStatusBadge(currentPo.status)}
          </div>
          <div className="text-sm space-y-1">
            <p><span className="font-medium">File:</span> {currentPo.file_name}</p>
            <p><span className="font-medium">Uploaded:</span> {new Date(currentPo.created_at).toLocaleString()}</p>
          </div>
        </Card>
      )}

      {/* Extract Section */}
      {currentPo && currentPo.status === "uploaded" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <FileText className="h-5 w-5" />
            2. Extract & Save to Purchase Orders
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            AI will extract data using dual-layer OCR and automatically save to Purchase Orders database
          </p>
          <Button
            onClick={handleExtract}
            disabled={extractMutation.isPending}
            className="w-full"
          >
            {extractMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Extracting & Saving... (this may take 30-60 seconds)
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Extract & Save PO Data
              </>
            )}
          </Button>
        </Card>
      )}

      {/* Extracted Data View Section */}
      {currentPo && editedData && currentPo.status === "extracted" && (
        <Card className="p-6 bg-green-50 dark:bg-green-950">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-green-700 dark:text-green-300">
            <CheckCircle className="h-5 w-5" />
            Extraction Complete & Saved to Purchase Orders
          </h2>

          {currentPo.confidence_scores && (
            <div className="mb-4 p-3 bg-white dark:bg-gray-800 rounded">
              <p className="text-sm font-medium mb-2">Confidence Scores:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(currentPo.confidence_scores).map(([field, score]) => (
                  <div key={field} className="text-sm">
                    <span className="font-medium">{field}:</span> {getConfidenceBadge(score as number)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="font-medium text-gray-700 dark:text-gray-300">Client Name</p>
                <p>{editedData.client_name || "N/A"}</p>
              </div>
              <div>
                <p className="font-medium text-gray-700 dark:text-gray-300">PO Number</p>
                <p>{editedData.po_number || "N/A"}</p>
              </div>
              <div>
                <p className="font-medium text-gray-700 dark:text-gray-300">PO Date</p>
                <p>{editedData.po_date || "N/A"}</p>
              </div>
              <div>
                <p className="font-medium text-gray-700 dark:text-gray-300">Delivery Date</p>
                <p>{editedData.delivery_date || "N/A"}</p>
              </div>
            </div>

            <div>
              <p className="font-medium text-gray-700 dark:text-gray-300 mb-2">Items</p>
              <div className="space-y-2">
                {editedData.items?.map((item: any, index: number) => (
                  <div key={index} className="p-3 bg-white dark:bg-gray-800 rounded">
                    <p><span className="font-medium">Item:</span> {item.item_name}</p>
                    <p><span className="font-medium">Qty:</span> {item.qty} | <span className="font-medium">Rate:</span> ₹{item.rate} | <span className="font-medium">GST:</span> {item.gst}%</p>
                  </div>
                ))}
              </div>
            </div>

            {editedData.notes && (
              <div>
                <p className="font-medium text-gray-700 dark:text-gray-300">Notes</p>
                <p>{editedData.notes}</p>
              </div>
            )}

            <div className="pt-4 border-t">
              <p className="text-green-700 dark:text-green-300 font-medium">
                This data has been automatically saved to the Purchase Orders page. You can view and manage it there.
              </p>
            </div>
          </div>
        </Card>
      )}

    </div>
  );
}