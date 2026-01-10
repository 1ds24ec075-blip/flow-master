import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { FileSpreadsheet, Link2, RefreshCw, CheckCircle, XCircle, Clock, Loader2, FolderOpen } from "lucide-react";

interface ExcelIntegration {
  id: string;
  email_address: string;
  display_name: string | null;
  is_active: boolean;
  sync_status: string;
  last_sync_at: string | null;
  error_message: string | null;
  selected_file_id: string | null;
  selected_file_name: string | null;
  sync_interval_minutes: number;
}

interface OneDriveFile {
  id: string;
  name: string;
  webUrl: string;
  lastModifiedDateTime: string;
}

export default function ExcelIntegration() {
  const [integration, setIntegration] = useState<ExcelIntegration | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [files, setFiles] = useState<OneDriveFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const { toast } = useToast();

  // Check URL params for OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");

    if (success === "true") {
      toast({
        title: "Connected Successfully",
        description: "Your Microsoft account has been connected.",
      });
      // Clean URL
      window.history.replaceState({}, "", "/excel-integration");
    } else if (error) {
      toast({
        title: "Connection Failed",
        description: decodeURIComponent(error),
        variant: "destructive",
      });
      window.history.replaceState({}, "", "/excel-integration");
    }
  }, [toast]);

  // Fetch existing integration
  useEffect(() => {
    fetchIntegration();
  }, []);

  const fetchIntegration = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("excel_integrations")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      setIntegration(data);

      if (data) {
        await loadFiles(data.id);
      }
    } catch (error) {
      console.error("Error fetching integration:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = () => {
    setIsConnecting(true);
    // Redirect to OAuth start endpoint
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    window.location.href = `${supabaseUrl}/functions/v1/excel-auth-start`;
  };

  const handleDisconnect = async () => {
    if (!integration) return;

    try {
      const { error } = await supabase
        .from("excel_integrations")
        .update({ is_active: false, sync_status: "disconnected" })
        .eq("id", integration.id);

      if (error) throw error;

      setIntegration(null);
      toast({
        title: "Disconnected",
        description: "Your Microsoft account has been disconnected.",
      });
    } catch (error) {
      console.error("Error disconnecting:", error);
      toast({
        title: "Error",
        description: "Failed to disconnect account.",
        variant: "destructive",
      });
    }
  };

  const loadFiles = async (integrationId: string) => {
    setIsLoadingFiles(true);
    try {
      const { data, error } = await supabase.functions.invoke("excel-sync", {
        body: { integrationId, action: "list-files" },
      });

      if (error) throw error;
      setFiles(data.files || []);
    } catch (error) {
      console.error("Error loading files:", error);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleSelectFile = async (fileId: string) => {
    if (!integration) return;

    const file = files.find((f) => f.id === fileId);
    if (!file) return;

    try {
      const { error } = await supabase
        .from("excel_integrations")
        .update({ 
          selected_file_id: fileId, 
          selected_file_name: file.name 
        })
        .eq("id", integration.id);

      if (error) throw error;

      setIntegration({
        ...integration,
        selected_file_id: fileId,
        selected_file_name: file.name,
      });

      toast({
        title: "File Selected",
        description: `${file.name} will be used for syncing bills.`,
      });
    } catch (error) {
      console.error("Error selecting file:", error);
      toast({
        title: "Error",
        description: "Failed to select file.",
        variant: "destructive",
      });
    }
  };

  const handleSync = async () => {
    if (!integration || !integration.selected_file_id) {
      toast({
        title: "No File Selected",
        description: "Please select an Excel file first.",
        variant: "destructive",
      });
      return;
    }

    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("excel-sync", {
        body: {
          integrationId: integration.id,
          action: "sync-bills",
          fileId: integration.selected_file_id,
          sheetName: "Bills",
        },
      });

      if (error) throw error;

      toast({
        title: "Sync Complete",
        description: `Successfully synced ${data.rowsWritten} bills to Excel.`,
      });

      await fetchIntegration();
    } catch (error) {
      console.error("Error syncing:", error);
      toast({
        title: "Sync Failed",
        description: error instanceof Error ? error.message : "Failed to sync bills.",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected":
        return <Badge className="bg-blue-500">Connected</Badge>;
      case "synced":
        return <Badge className="bg-green-500">Synced</Badge>;
      case "syncing":
        return <Badge className="bg-yellow-500">Syncing</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      case "token_expired":
        return <Badge variant="destructive">Token Expired</Badge>;
      default:
        return <Badge variant="secondary">Disconnected</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Excel Integration</h1>
        <p className="text-muted-foreground">
          Connect to Microsoft Excel/OneDrive for bi-directional sync of Bills & Expenses.
        </p>
      </div>

      {/* Connection Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Microsoft Account Connection
          </CardTitle>
          <CardDescription>
            Connect your Microsoft account to sync with Excel files stored in OneDrive.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {integration ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-8 w-8 text-green-500" />
                  <div>
                    <p className="font-medium">{integration.display_name || integration.email_address}</p>
                    <p className="text-sm text-muted-foreground">{integration.email_address}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(integration.sync_status)}
                  <Button variant="outline" size="sm" onClick={handleDisconnect}>
                    Disconnect
                  </Button>
                </div>
              </div>

              {integration.last_sync_at && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Last synced: {new Date(integration.last_sync_at).toLocaleString()}
                </div>
              )}

              {integration.error_message && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{integration.error_message}</AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">
                No Microsoft account connected. Connect to start syncing.
              </p>
              <Button onClick={handleConnect} disabled={isConnecting}>
                {isConnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 h-4 w-4" />
                    Connect Microsoft Account
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* File Selection Card */}
      {integration && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Select Excel File
            </CardTitle>
            <CardDescription>
              Choose an Excel file from your OneDrive to sync with Bills & Expenses.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Select
                value={integration.selected_file_id || ""}
                onValueChange={handleSelectFile}
                disabled={isLoadingFiles}
              >
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder="Select an Excel file..." />
                </SelectTrigger>
                <SelectContent>
                  {files.map((file) => (
                    <SelectItem key={file.id} value={file.id}>
                      {file.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                onClick={() => loadFiles(integration.id)}
                disabled={isLoadingFiles}
              >
                {isLoadingFiles ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>

            {integration.selected_file_name && (
              <p className="text-sm text-muted-foreground">
                Currently selected: <strong>{integration.selected_file_name}</strong>
              </p>
            )}

            {files.length === 0 && !isLoadingFiles && (
              <Alert>
                <AlertDescription>
                  No Excel files found in your OneDrive. Make sure you have .xlsx files uploaded.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sync Controls Card */}
      {integration && integration.selected_file_id && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Sync Bills & Expenses
            </CardTitle>
            <CardDescription>
              Export bills from the database to your selected Excel file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Button onClick={handleSync} disabled={isSyncing}>
                {isSyncing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sync Now
                  </>
                )}
              </Button>
            </div>

            <Alert>
              <AlertDescription>
                <strong>How it works:</strong> Clicking "Sync Now" will export all your bills to 
                the "Bills" worksheet in your selected Excel file. The data includes bill number, 
                vendor, amount, dates, and status.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
