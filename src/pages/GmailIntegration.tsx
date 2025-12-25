import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Mail, Loader2, RefreshCw, Trash2, CheckCircle, XCircle, Eye } from "lucide-react";
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
  DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";

interface GmailIntegration {
  id: string;
  email_address: string;
  is_active: boolean;
  last_sync_at: string;
  sync_status: string;
  error_message: string;
  subject_filters: string[];
  created_at: string;
}

interface ProcessedEmail {
  id: string;
  email_id: string;
  subject: string;
  sender: string;
  received_at: string;
  processed_at: string;
  status: string;
  error_message: string;
  attachments_count: number;
  bills_created: number;
}

export default function GmailIntegration() {
  const [emailsDialogOpen, setEmailsDialogOpen] = useState(false);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // Handle OAuth callback parameters
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    const email = searchParams.get("email");

    if (success === "true") {
      toast.success(`Gmail account ${email ? `(${email}) ` : ""}connected successfully!`);
      queryClient.invalidateQueries({ queryKey: ["gmail_integrations"] });
      // Clear the URL params
      setSearchParams({});
    } else if (error) {
      toast.error(`Failed to connect Gmail: ${error}`);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, queryClient]);

  const { data: integrations, isLoading } = useQuery({
    queryKey: ["gmail_integrations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gmail_integrations" as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as GmailIntegration[];
    },
  });

  const { data: processedEmails, isLoading: emailsLoading } = useQuery({
    queryKey: ["processed_emails", selectedIntegrationId],
    queryFn: async () => {
      if (!selectedIntegrationId) return [];

      const { data, error } = await supabase
        .from("processed_emails" as any)
        .select("*")
        .eq("integration_id", selectedIntegrationId)
        .order("processed_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as unknown as ProcessedEmail[];
    },
    enabled: !!selectedIntegrationId,
  });

  const syncMutation = useMutation({
    mutationFn: async (integrationId: string) => {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(
        `${supabaseUrl}/functions/v1/gmail-sync`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ integrationId }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sync failed: ${errorText}`);
      }

      return await response.json();
    },
    onSuccess: (data) => {
      toast.success(`Sync completed! Processed ${data.processed} emails, created ${data.billsCreated} bills`);
      queryClient.invalidateQueries({ queryKey: ["gmail_integrations"] });
      queryClient.invalidateQueries({ queryKey: ["processed_emails"] });
      queryClient.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (error: Error) => {
      toast.error(`Sync failed: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (integrationId: string) => {
      const { error } = await supabase
        .from("gmail_integrations" as any)
        .delete()
        .eq("id", integrationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Gmail integration removed successfully");
      queryClient.invalidateQueries({ queryKey: ["gmail_integrations"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove integration: ${error.message}`);
    },
  });

  const handleConnectGmail = () => {
    setIsConnecting(true);
    // Redirect to the OAuth start edge function
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    window.location.href = `${supabaseUrl}/functions/v1/gmail-auth-start`;
  };

  const handleViewEmails = (integrationId: string) => {
    setSelectedIntegrationId(integrationId);
    setEmailsDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="default">Active</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
      case "disconnected":
        return <Badge variant="secondary">Disconnected</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getEmailStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge variant="default">Success</Badge>;
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "pending":
        return <Badge variant="secondary">Pending</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Gmail Integration</h1>
          <p className="text-muted-foreground">
            Connect your Gmail to automatically import invoices and bills
          </p>
        </div>
        <Button onClick={handleConnectGmail} disabled={isConnecting}>
          {isConnecting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Mail className="mr-2 h-4 w-4" />
          )}
          Connect Gmail
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
          <CardDescription>
            Manage your Gmail integrations and sync settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : integrations && integrations.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Sync</TableHead>
                    <TableHead>Subject Filters</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {integrations.map((integration) => (
                    <TableRow key={integration.id}>
                      <TableCell className="font-medium">
                        {integration.email_address}
                      </TableCell>
                      <TableCell>{getStatusBadge(integration.sync_status)}</TableCell>
                      <TableCell>
                        {integration.last_sync_at
                          ? format(new Date(integration.last_sync_at), "dd MMM yyyy HH:mm")
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {integration.subject_filters?.map((filter, idx) => (
                            <Badge key={idx} variant="outline">
                              {filter}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewEmails(integration.id)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => syncMutation.mutate(integration.id)}
                            disabled={syncMutation.isPending}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteMutation.mutate(integration.id)}
                            disabled={deleteMutation.isPending}
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
              No Gmail accounts connected yet. Click "Connect Gmail" to get started.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={emailsDialogOpen} onOpenChange={setEmailsDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Processed Emails</DialogTitle>
            <DialogDescription>
              View all emails that have been processed from this Gmail account
            </DialogDescription>
          </DialogHeader>
          {emailsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : processedEmails && processedEmails.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    <TableHead>Sender</TableHead>
                    <TableHead>Received</TableHead>
                    <TableHead>Attachments</TableHead>
                    <TableHead>Bills Created</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedEmails.map((email) => (
                    <TableRow key={email.id}>
                      <TableCell className="font-medium max-w-xs truncate">
                        {email.subject}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{email.sender}</TableCell>
                      <TableCell>
                        {email.received_at && format(new Date(email.received_at), "dd MMM yyyy HH:mm")}
                      </TableCell>
                      <TableCell>{email.attachments_count}</TableCell>
                      <TableCell>
                        {email.bills_created > 0 ? (
                          <Badge variant="default" className="gap-1">
                            <CheckCircle className="h-3 w-3" />
                            {email.bills_created}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <XCircle className="h-3 w-3" />
                            0
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{getEmailStatusBadge(email.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No emails processed yet. Trigger a sync to start processing emails.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
