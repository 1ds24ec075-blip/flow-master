import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  FileSpreadsheet, Link2, RefreshCw, CheckCircle, XCircle, Clock,
  Loader2, FolderOpen, Boxes, ArrowLeftRight, Zap
} from "lucide-react";

interface ExcelIntegrationData {
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

interface SyncSummary {
  totalItems: number;
  dbUpdatesFromExcel: number;
  newFromExcel: number;
}

export default function ExcelIntegration() {
  const [integration, setIntegration] = useState<ExcelIntegrationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingInventory, setIsSyncingInventory] = useState(false);
  const [files, setFiles] = useState<OneDriveFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(false);
  const [syncInterval, setSyncInterval] = useState("3");
  const [lastSyncSummary, setLastSyncSummary] = useState<SyncSummary | null>(null);
  const autoSyncRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");
    if (success === "true") {
      toast({ title: "Connected Successfully", description: "Your Microsoft account has been connected." });
      window.history.replaceState({}, "", "/excel-integration");
    } else if (error) {
      toast({ title: "Connection Failed", description: decodeURIComponent(error), variant: "destructive" });
      window.history.replaceState({}, "", "/excel-integration");
    }
  }, [toast]);

  useEffect(() => { fetchIntegration(); }, []);

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
      if (data) await loadFiles(data.id);
    } catch (error) {
      console.error("Error fetching integration:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = () => {
    setIsConnecting(true);
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    window.open(`${supabaseUrl}/functions/v1/excel-auth-start`, "_blank");
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
      setAutoSyncEnabled(false);
      toast({ title: "Disconnected", description: "Your Microsoft account has been disconnected." });
    } catch (error) {
      toast({ title: "Error", description: "Failed to disconnect account.", variant: "destructive" });
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
        .update({ selected_file_id: fileId, selected_file_name: file.name })
        .eq("id", integration.id);
      if (error) throw error;
      setIntegration({ ...integration, selected_file_id: fileId, selected_file_name: file.name });
      toast({ title: "File Selected", description: `${file.name} will be used for syncing.` });
    } catch (error) {
      toast({ title: "Error", description: "Failed to select file.", variant: "destructive" });
    }
  };

  const handleSyncBills = async () => {
    if (!integration || !integration.selected_file_id) {
      toast({ title: "No File Selected", description: "Please select an Excel file first.", variant: "destructive" });
      return;
    }
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("excel-sync", {
        body: { integrationId: integration.id, action: "sync-bills", fileId: integration.selected_file_id, sheetName: "Bills" },
      });
      if (error) throw error;
      toast({ title: "Sync Complete", description: `Successfully synced ${data.rowsWritten} bills to Excel.` });
      await fetchIntegration();
    } catch (error) {
      toast({ title: "Sync Failed", description: error instanceof Error ? error.message : "Failed to sync bills.", variant: "destructive" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncInventory = useCallback(async (silent = false) => {
    if (!integration || !integration.selected_file_id) {
      if (!silent) toast({ title: "No File Selected", description: "Please select an Excel file first.", variant: "destructive" });
      return;
    }
    setIsSyncingInventory(true);
    try {
      const { data, error } = await supabase.functions.invoke("excel-sync", {
        body: { integrationId: integration.id, action: "sync-inventory", fileId: integration.selected_file_id, sheetName: "Inventory" },
      });
      if (error) throw error;
      setLastSyncSummary(data.summary);
      if (!silent) {
        const s = data.summary as SyncSummary;
        toast({
          title: "Inventory Synced",
          description: `${s.totalItems} items synced. ${s.dbUpdatesFromExcel} updated from Excel, ${s.newFromExcel} new items imported.`,
        });
      }
      await fetchIntegration();
    } catch (error) {
      if (!silent) {
        toast({ title: "Inventory Sync Failed", description: error instanceof Error ? error.message : "Failed to sync.", variant: "destructive" });
      }
    } finally {
      setIsSyncingInventory(false);
    }
  }, [integration, toast]);

  // Auto-sync polling
  useEffect(() => {
    if (autoSyncRef.current) {
      clearInterval(autoSyncRef.current);
      autoSyncRef.current = null;
    }

    if (autoSyncEnabled && integration?.selected_file_id) {
      const intervalMs = parseInt(syncInterval) * 60 * 1000;
      // Immediate first sync
      handleSyncInventory(true);
      autoSyncRef.current = setInterval(() => {
        handleSyncInventory(true);
      }, intervalMs);
    }

    return () => {
      if (autoSyncRef.current) clearInterval(autoSyncRef.current);
    };
  }, [autoSyncEnabled, syncInterval, handleSyncInventory, integration?.selected_file_id]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "connected": return <Badge className="bg-primary text-primary-foreground">Connected</Badge>;
      case "synced": return <Badge className="bg-success text-success-foreground">Synced</Badge>;
      case "syncing": return <Badge className="bg-warning text-warning-foreground">Syncing</Badge>;
      case "error": return <Badge variant="destructive">Error</Badge>;
      case "token_expired": return <Badge variant="destructive">Token Expired</Badge>;
      default: return <Badge variant="secondary">Disconnected</Badge>;
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
          Connect to Microsoft Excel/OneDrive for bi-directional live sync.
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
                  <CheckCircle className="h-8 w-8 text-success" />
                  <div>
                    <p className="font-medium">{integration.display_name || integration.email_address}</p>
                    <p className="text-sm text-muted-foreground">{integration.email_address}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(integration.sync_status)}
                  <Button variant="outline" size="sm" onClick={handleDisconnect}>Disconnect</Button>
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
              <p className="text-muted-foreground mb-4">No Microsoft account connected.</p>
              <Button onClick={handleConnect} disabled={isConnecting}>
                {isConnecting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting...</>
                ) : (
                  <><Link2 className="mr-2 h-4 w-4" />Connect Microsoft Account</>
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
              Choose an Excel file from your OneDrive for syncing.
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
                    <SelectItem key={file.id} value={file.id}>{file.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => loadFiles(integration.id)} disabled={isLoadingFiles}>
                {isLoadingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
            {integration.selected_file_name && (
              <p className="text-sm text-muted-foreground">
                Currently selected: <strong>{integration.selected_file_name}</strong>
              </p>
            )}
            {files.length === 0 && !isLoadingFiles && (
              <Alert>
                <AlertDescription>No Excel files found in your OneDrive.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Inventory Bi-Directional Sync Card */}
      {integration && integration.selected_file_id && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" />
              Inventory Live Sync
              <Badge variant="outline" className="ml-2 text-xs">
                <ArrowLeftRight className="h-3 w-3 mr-1" />
                Bi-Directional
              </Badge>
            </CardTitle>
            <CardDescription>
              Inventory data syncs both ways — changes in Excel update the app, and vice versa. Conflicts are resolved by last write wins.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Auto-Sync Controls */}
            <div className="flex items-center justify-between p-4 rounded-lg bg-muted/40 border">
              <div className="flex items-center gap-3">
                <Zap className={`h-5 w-5 ${autoSyncEnabled ? "text-success" : "text-muted-foreground"}`} />
                <div>
                  <Label htmlFor="auto-sync" className="font-medium">Auto-Sync</Label>
                  <p className="text-xs text-muted-foreground">Automatically sync every {syncInterval} min</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Select value={syncInterval} onValueChange={setSyncInterval}>
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 min</SelectItem>
                    <SelectItem value="2">2 min</SelectItem>
                    <SelectItem value="3">3 min</SelectItem>
                    <SelectItem value="5">5 min</SelectItem>
                  </SelectContent>
                </Select>
                <Switch id="auto-sync" checked={autoSyncEnabled} onCheckedChange={setAutoSyncEnabled} />
              </div>
            </div>

            {/* Manual Sync Button */}
            <div className="flex items-center gap-4">
              <Button onClick={() => handleSyncInventory(false)} disabled={isSyncingInventory}>
                {isSyncingInventory ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing Inventory...</>
                ) : (
                  <><RefreshCw className="mr-2 h-4 w-4" />Sync Inventory Now</>
                )}
              </Button>
              {autoSyncEnabled && (
                <span className="text-xs text-success flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  Live sync active
                </span>
              )}
            </div>

            {/* Last Sync Summary */}
            {lastSyncSummary && (
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-muted/30 border text-center">
                  <p className="text-2xl font-bold text-foreground">{lastSyncSummary.totalItems}</p>
                  <p className="text-xs text-muted-foreground">Total Items</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 border text-center">
                  <p className="text-2xl font-bold text-primary">{lastSyncSummary.dbUpdatesFromExcel}</p>
                  <p className="text-xs text-muted-foreground">Updated from Excel</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 border text-center">
                  <p className="text-2xl font-bold text-success">{lastSyncSummary.newFromExcel}</p>
                  <p className="text-xs text-muted-foreground">New from Excel</p>
                </div>
              </div>
            )}

            <Alert>
              <AlertDescription>
                <strong>How it works:</strong> The "Inventory" worksheet in your Excel file syncs bi-directionally.
                Edit quantities, thresholds, or add new rows in Excel — they'll appear here on next sync.
                Changes made in the app are pushed to Excel too. The <strong>Last Modified</strong> column determines which version wins on conflicts.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      {/* Bills Sync Card */}
      {integration && integration.selected_file_id && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Sync Bills & Expenses
            </CardTitle>
            <CardDescription>Export bills from the database to the "Bills" worksheet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleSyncBills} disabled={isSyncing}>
              {isSyncing ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Syncing...</>
              ) : (
                <><RefreshCw className="mr-2 h-4 w-4" />Sync Bills Now</>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
