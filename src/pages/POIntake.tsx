import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Loader2, CheckCircle, AlertCircle, Download } from "lucide-react";
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
      toast.success("Extraction completed! Review the data below.");
      queryClient.invalidateQueries({ queryKey: ["po-intake", currentPoId] });
    },
    onError: (error: any) => {
      toast.error(`Extraction failed: ${error.message}`);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async ({ poId, reviewedData }: { poId: string; reviewedData: any }) => {
      const { data, error } = await supabase.functions.invoke("po-save", {
        body: { poId, reviewedData },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Data saved successfully!");
      queryClient.invalidateQueries({ queryKey: ["po-intake", currentPoId] });
    },
    onError: (error: any) => {
      toast.error(`Save failed: ${error.message}`);
    },
  });

  const tallyMutation = useMutation({
    mutationFn: async (poId: string) => {
      const { data, error } = await supabase.functions.invoke("po-generate-tally", {
        body: { poId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Tally payload generated!");
      queryClient.invalidateQueries({ queryKey: ["po-intake", currentPoId] });
    },
    onError: (error: any) => {
      toast.error(`Tally generation failed: ${error.message}`);
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

  const handleSave = () => {
    if (currentPoId && editedData) {
      saveMutation.mutate({ poId: currentPoId, reviewedData: editedData });
    }
  };

  const handleGenerateTally = () => {
    if (currentPoId) {
      tallyMutation.mutate(currentPoId);
    }
  };

  const handleFieldChange = (field: string, value: any) => {
    setEditedData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    setEditedData((prev: any) => {
      const items = [...(prev.items || [])];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, items };
    });
  };

  const addItem = () => {
    setEditedData((prev: any) => ({
      ...prev,
      items: [...(prev.items || []), { item_name: "", qty: 0, rate: 0, gst: 18, amount: 0 }],
    }));
  };

  const removeItem = (index: number) => {
    setEditedData((prev: any) => ({
      ...prev,
      items: prev.items.filter((_: any, i: number) => i !== index),
    }));
  };

  const downloadTallyPayload = (format: 'json' | 'xml') => {
    if (!currentPo) return;
    
    const content = format === 'json' 
      ? JSON.stringify(currentPo.tally_json, null, 2)
      : currentPo.tally_xml;
    
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tally_po_${currentPo.id}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
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
        <p className="text-muted-foreground">Upload → Extract → Review → Save → Generate Tally Payload</p>
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
            2. AI Extraction (Dual OCR + LLM Parse)
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            This will run two-layer OCR: traditional text extraction + AI structured parsing
          </p>
          <Button
            onClick={handleExtract}
            disabled={extractMutation.isPending}
            className="w-full"
          >
            {extractMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Extracting... (this may take 30-60 seconds)
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Extract PO Data
              </>
            )}
          </Button>
        </Card>
      )}

      {/* Review & Edit Section */}
      {currentPo && editedData && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            3. Review & Edit Extracted Data
          </h2>
          
          {currentPo.confidence_scores && (
            <div className="mb-4 p-3 bg-muted rounded">
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

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Client Name</Label>
                <Input
                  value={editedData.client_name || ""}
                  onChange={(e) => handleFieldChange("client_name", e.target.value)}
                />
              </div>
              <div>
                <Label>PO Number</Label>
                <Input
                  value={editedData.po_number || ""}
                  onChange={(e) => handleFieldChange("po_number", e.target.value)}
                />
              </div>
              <div>
                <Label>PO Date</Label>
                <Input
                  type="date"
                  value={editedData.po_date || ""}
                  onChange={(e) => handleFieldChange("po_date", e.target.value)}
                />
              </div>
              <div>
                <Label>Delivery Date</Label>
                <Input
                  type="date"
                  value={editedData.delivery_date || ""}
                  onChange={(e) => handleFieldChange("delivery_date", e.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>Items</Label>
                <Button onClick={addItem} size="sm" variant="outline">
                  + Add Item
                </Button>
              </div>
              <div className="space-y-3">
                {editedData.items?.map((item: any, index: number) => (
                  <div key={index} className="p-4 border rounded space-y-2">
                    <div className="grid grid-cols-5 gap-2">
                      <Input
                        placeholder="Item Name"
                        value={item.item_name || ""}
                        onChange={(e) => handleItemChange(index, "item_name", e.target.value)}
                        className="col-span-2"
                      />
                      <Input
                        type="number"
                        placeholder="Qty"
                        value={item.qty || 0}
                        onChange={(e) => handleItemChange(index, "qty", parseFloat(e.target.value))}
                      />
                      <Input
                        type="number"
                        placeholder="Rate"
                        value={item.rate || 0}
                        onChange={(e) => handleItemChange(index, "rate", parseFloat(e.target.value))}
                      />
                      <Input
                        type="number"
                        placeholder="GST %"
                        value={item.gst || 18}
                        onChange={(e) => handleItemChange(index, "gst", parseFloat(e.target.value))}
                      />
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => removeItem(index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                value={editedData.notes || ""}
                onChange={(e) => handleFieldChange("notes", e.target.value)}
                rows={3}
              />
            </div>

            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="w-full"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Save to Database
                </>
              )}
            </Button>
          </div>
        </Card>
      )}

      {/* Generate Tally Section */}
      {currentPo && currentPo.status === "saved" && (
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <Download className="h-5 w-5" />
            4. Generate Tally Payload
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Generate JSON and XML payloads for Tally import
          </p>
          <Button
            onClick={handleGenerateTally}
            disabled={tallyMutation.isPending}
            className="w-full"
          >
            {tallyMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Generate Tally Payload
              </>
            )}
          </Button>
        </Card>
      )}

      {/* Download Tally Payloads */}
      {currentPo && currentPo.status === "ready_for_tally" && (
        <Card className="p-6 bg-green-50 dark:bg-green-950">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-green-700 dark:text-green-300">
            <CheckCircle className="h-5 w-5" />
            ✓ Ready for Tally
          </h2>
          <p className="text-sm mb-4">Download the generated payloads:</p>
          <div className="flex gap-2">
            <Button onClick={() => downloadTallyPayload('json')} variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Download JSON
            </Button>
            <Button onClick={() => downloadTallyPayload('xml')} variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Download XML
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}