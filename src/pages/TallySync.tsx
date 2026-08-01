import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Copy, Ban, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface TallyAgent {
  id: string;
  name: string;
  company_name: string;
  tally_url: string;
  agent_version: string | null;
  last_seen_at: string | null;
  last_error: string | null;
  tally_running: boolean;
  company_loaded: boolean;
  revoked_at: string | null;
  created_at: string;
}

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tally-agents`;
const ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * tally-agents mints credentials, so it requires a real signed-in user rather
 * than the anon key that ships in this bundle. Every call forwards the session.
 */
async function callTallyAgents<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in to manage Tally agents");

  const response = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Request failed (HTTP ${response.status})`);
  return payload as T;
}

function lastSeenLabel(agent: TallyAgent): string {
  if (!agent.last_seen_at) return "never";
  const minutes = Math.round((Date.now() - new Date(agent.last_seen_at).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export default function TallySync() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", companyName: "", tallyUrl: "http://localhost:9000" });
  // Held in state because the plaintext token is returned exactly once; only its
  // sha256 is stored, so once this dialog closes it cannot be recovered.
  const [mintedToken, setMintedToken] = useState<string | null>(null);

  const { data: agents, isLoading, error } = useQuery({
    queryKey: ["tally-agents"],
    queryFn: async () => {
      const result = await callTallyAgents<{ agents: TallyAgent[] }>({ action: "list" });
      return result.agents ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Give the agent a name");
      if (!form.companyName.trim()) throw new Error("Company name is required");
      return callTallyAgents<{ token: string }>({
        action: "create",
        name: form.name.trim(),
        companyName: form.companyName.trim(),
        tallyUrl: form.tallyUrl.trim() || "http://localhost:9000",
      });
    },
    onSuccess: (result) => {
      setMintedToken(result.token);
      setOpen(false);
      setForm({ name: "", companyName: "", tallyUrl: "http://localhost:9000" });
      queryClient.invalidateQueries({ queryKey: ["tally-agents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (agentId: string) => callTallyAgents({ action: "revoke", agentId }),
    onSuccess: () => {
      toast.success("Agent revoked");
      queryClient.invalidateQueries({ queryKey: ["tally-agents"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Tally Sync Agents</h1>
          <p className="text-muted-foreground">
            Each machine running Tally needs its own agent. It drains the sync queue and pushes
            vouchers into Tally over its local HTTP-XML interface.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["tally-agents"] })}
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Register Agent
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Register a Tally agent</DialogTitle>
                <DialogDescription>
                  The company name must match the Tally company exactly, including case. A
                  mismatch silently breaks every sync.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="agent-name">Agent name</Label>
                  <Input
                    id="agent-name"
                    placeholder="Front desk PC"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-name">Tally company name</Label>
                  <Input
                    id="company-name"
                    placeholder="Exactly as it appears in Tally"
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tally-url">Tally URL</Label>
                  <Input
                    id="tally-url"
                    value={form.tallyUrl}
                    onChange={(e) => setForm({ ...form, tallyUrl: e.target.value })}
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? "Creating…" : "Create agent"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {mintedToken && (
        <Card className="border-amber-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Copy this token now
            </CardTitle>
            <CardDescription>
              Only its SHA-256 is stored, so this is the one and only time it is shown. If you lose
              it you have to register a new agent. Paste it into <code>npm run setup</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={mintedToken} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(mintedToken);
                  toast.success("Token copied");
                }}
                title="Copy token"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setMintedToken(null)}>
              I've saved it — hide this
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Registered agents</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-muted-foreground">Loading…</p>}
          {error && <p className="text-destructive">{(error as Error).message}</p>}
          {!isLoading && !error && !agents?.length && (
            <p className="text-muted-foreground">
              No agents yet. Register one, then run <code>npm run setup</code> in the agent folder
              on the machine where Tally runs.
            </p>
          )}
          {!!agents?.length && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell>{agent.company_name}</TableCell>
                    <TableCell>
                      {agent.revoked_at ? (
                        <Badge variant="destructive">revoked</Badge>
                      ) : agent.tally_running && agent.company_loaded ? (
                        <Badge className="gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          ready
                        </Badge>
                      ) : agent.last_seen_at ? (
                        <Badge variant="secondary" title={agent.last_error ?? undefined}>
                          {agent.tally_running ? "company not loaded" : "Tally closed"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">never connected</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{lastSeenLabel(agent)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {agent.agent_version ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {!agent.revoked_at && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => revokeMutation.mutate(agent.id)}
                          disabled={revokeMutation.isPending}
                          title="Revoke this agent's token"
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
