import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Mail, RefreshCw, Trash2, Loader2, Plug, CheckCircle2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";

interface GmailIntegrationRow {
  id: string;
  email_address: string;
  is_active: boolean;
  sync_status: string | null;
  last_sync_at: string | null;
  error_message: string | null;
  created_at: string;
}

const GmailIntegration = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<GmailIntegrationRow[]>([]);

  // Auth gate
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate("/auth");
    });
  }, [navigate]);

  // Handle OAuth callback query params
  useEffect(() => {
    const success = searchParams.get("success");
    const email = searchParams.get("email");
    const error = searchParams.get("error");
    if (success && email) {
      toast({ title: "Gmail connected", description: email });
      setSearchParams({});
    } else if (error) {
      toast({ title: "Gmail connection failed", description: error, variant: "destructive" });
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, toast]);

  const loadIntegrations = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("gmail_integrations")
      .select("id, email_address, is_active, sync_status, last_sync_at, error_message, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load integrations", description: error.message, variant: "destructive" });
    } else {
      setIntegrations(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadIntegrations();
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      const { data, error } = await supabase.functions.invoke("gmail-auth-start", { body: {} });
      if (error) throw error;
      if (!data?.url) throw new Error("No OAuth URL returned");
      window.location.href = data.url;
    } catch (e: any) {
      toast({ title: "Could not start Gmail connection", description: e?.message || "Unknown error", variant: "destructive" });
      setConnecting(false);
    }
  };

  const handleSync = async (id: string) => {
    setSyncingId(id);
    try {
      const { data, error } = await supabase.functions.invoke("gmail-sync", { body: { integrationId: id } });
      if (error) throw error;
      toast({
        title: "Sync complete",
        description: `Processed ${data?.processed ?? 0} email(s), created ${data?.billsCreated ?? 0} bill(s).`,
      });
      loadIntegrations();
    } catch (e: any) {
      toast({ title: "Sync failed", description: e?.message || "Unknown error", variant: "destructive" });
    } finally {
      setSyncingId(null);
    }
  };

  const handleDisconnect = async (id: string, email: string) => {
    if (!confirm(`Disconnect ${email}? Stored tokens will be deleted.`)) return;
    const { error } = await supabase.from("gmail_integrations").delete().eq("id", id);
    if (error) {
      toast({ title: "Failed to disconnect", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Disconnected", description: email });
      loadIntegrations();
    }
  };

  const statusBadge = (status: string | null, isActive: boolean) => {
    if (!isActive) return <Badge variant="outline">Inactive</Badge>;
    if (status === "active") return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">Active</Badge>;
    if (status === "error") return <Badge variant="destructive">Error</Badge>;
    return <Badge variant="secondary">{status || "Pending"}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Gmail Integration</h1>
        <p className="text-muted-foreground">
          Connect your Gmail inbox so we can automatically import POs, invoices and bills.
        </p>
      </div>

      <Alert>
        <Mail className="h-4 w-4" />
        <AlertTitle>Per-user, secure connection</AlertTitle>
        <AlertDescription>
          Each user connects their own Gmail. We request read-only access, store tokens encrypted, and delete
          everything when you disconnect. See our <a href="/privacy" className="underline">privacy policy</a>.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-primary" />
            Connect a Gmail account
          </CardTitle>
          <CardDescription>
            You'll be redirected to Google to grant read-only access to your inbox.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleConnect} disabled={connecting} size="lg">
            {connecting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting…</>
            ) : (
              <><Mail className="h-4 w-4 mr-2" /> Connect Gmail</>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your connected inboxes</CardTitle>
          <CardDescription>Manage and sync the Gmail accounts linked to your user.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : integrations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Gmail accounts connected yet.</p>
          ) : (
            <div className="space-y-3">
              {integrations.map((it) => (
                <div
                  key={it.id}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {it.sync_status === "error" ? (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      )}
                      <span className="font-medium truncate">{it.email_address}</span>
                      {statusBadge(it.sync_status, it.is_active)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Last sync: {it.last_sync_at ? new Date(it.last_sync_at).toLocaleString() : "Never"}
                    </p>
                    {it.error_message && (
                      <p className="text-xs text-destructive truncate">{it.error_message}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync(it.id)}
                      disabled={syncingId === it.id}
                    >
                      {syncingId === it.id ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Syncing…</>
                      ) : (
                        <><RefreshCw className="h-4 w-4 mr-2" /> Sync now</>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnect(it.id, it.email_address)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Disconnect
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default GmailIntegration;
