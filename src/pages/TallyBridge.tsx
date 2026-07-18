import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

interface Bridge {
  id: string;
  name: string;
  api_key: string;
  tally_url: string;
  is_active: boolean;
  last_seen_at: string | null;
  last_ip: string | null;
  created_at: string;
}

interface Job {
  id: string;
  bridge_id: string | null;
  source_type: string;
  source_id: string | null;
  label: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  tally_response: string | null;
  created_at: string;
  completed_at: string | null;
}

function generateApiKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "tbk_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bridgeHealth(b: Bridge): { label: string; tone: "green" | "amber" | "red" } {
  if (!b.is_active) return { label: "Disabled", tone: "red" };
  if (!b.last_seen_at) return { label: "Never connected", tone: "amber" };
  const secs = (Date.now() - new Date(b.last_seen_at).getTime()) / 1000;
  if (secs < 30) return { label: "Online", tone: "green" };
  if (secs < 300) return { label: "Idle", tone: "amber" };
  return { label: "Offline", tone: "red" };
}

const toneClasses = {
  green: "bg-emerald-100 text-emerald-700 border-emerald-200",
  amber: "bg-amber-100 text-amber-700 border-amber-200",
  red: "bg-red-100 text-red-700 border-red-200",
} as const;

export default function TallyBridge() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("Office PC");
  const [newUrl, setNewUrl] = useState("http://localhost:9000");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { data: bridges } = useQuery({
    queryKey: ["tally-bridges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tally_bridges" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Bridge[];
    },
    refetchInterval: 5000,
  });

  const { data: jobs } = useQuery({
    queryKey: ["tally-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tally_push_jobs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as Job[];
    },
    refetchInterval: 3000,
  });

  const createBridge = useMutation({
    mutationFn: async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!userRes.user) throw new Error("Not signed in");
      const apiKey = generateApiKey();
      const { data, error } = await supabase
        .from("tally_bridges" as any)
        .insert({
          user_id: userRes.user.id,
          name: newName.trim() || "Tally Bridge",
          api_key: apiKey,
          tally_url: newUrl.trim() || "http://localhost:9000",
        })
        .select()
        .single();
      if (error) throw error;
      return { bridge: data as unknown as Bridge, apiKey };
    },
    onSuccess: ({ apiKey }) => {
      setCreatedKey(apiKey);
      queryClient.invalidateQueries({ queryKey: ["tally-bridges"] });
      toast.success("Bridge registered");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (b: Bridge) => {
      const { error } = await supabase
        .from("tally_bridges" as any)
        .update({ is_active: !b.is_active })
        .eq("id", b.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tally-bridges"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBridge = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tally_bridges" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Bridge removed");
      queryClient.invalidateQueries({ queryKey: ["tally-bridges"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retryJob = useMutation({
    mutationFn: async (job: Job) => {
      const { error } = await supabase
        .from("tally_push_jobs" as any)
        .update({ status: "pending", last_error: null, tally_response: null, completed_at: null, picked_at: null })
        .eq("id", job.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Requeued");
      queryClient.invalidateQueries({ queryKey: ["tally-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteJob = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tally_push_jobs" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tally-jobs"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-2 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-bold">Tally Bridge</h1>
          <p className="text-sm text-muted-foreground">
            Push vouchers from Talligence straight into your local Tally via a lightweight desktop agent.
          </p>
        </div>
        <Button onClick={() => { setCreatedKey(null); setCreateOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Register new bridge
        </Button>
      </div>

      {/* Setup steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Plug className="h-4 w-4" /> How it works</CardTitle>
          <CardDescription>
            Copy the <code>tally-bridge/</code> folder from this project onto the machine running Tally,
            paste the API key into <code>.env</code>, then run <code>npm install &amp;&amp; npm start</code>.
            The agent polls this app every few seconds and forwards queued vouchers to Tally on
            <code> http://localhost:9000</code>. Status is reported back in the table below.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Bridges */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registered bridges</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!bridges || bridges.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No bridges yet. Click <b>Register new bridge</b> to create one.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Tally URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bridges.map((b) => {
                  const h = bridgeHealth(b);
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="font-mono text-xs">{b.tally_url}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={toneClasses[h.tone]}>{h.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {b.last_seen_at ? formatDistanceToNow(new Date(b.last_seen_at), { addSuffix: true }) : "—"}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="outline" onClick={() => toggleActive.mutate(b)}>
                          {b.is_active ? "Disable" : "Enable"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => deleteBridge.mutate(b.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Queue */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Push queue</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["tally-jobs"] })}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {!jobs || jobs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No jobs yet. Send a bill or PO to Tally via Bridge to see it here.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-xs">{j.source_type}</TableCell>
                    <TableCell className="text-xs">{j.label || j.source_id?.slice(0, 8) || "—"}</TableCell>
                    <TableCell>
                      {j.status === "sent" ? (
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" variant="outline">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> sent
                        </Badge>
                      ) : j.status === "failed" ? (
                        <Badge className="bg-red-100 text-red-700 border-red-200" variant="outline">
                          <XCircle className="h-3 w-3 mr-1" /> failed
                        </Badge>
                      ) : j.status === "processing" ? (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-200" variant="outline">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" /> processing
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200" variant="outline">
                          <Clock className="h-3 w-3 mr-1" /> pending
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{j.attempts}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(j.created_at), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-xs max-w-[280px] truncate" title={j.last_error || ""}>
                      {j.last_error || ""}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      {j.status !== "pending" && j.status !== "processing" && (
                        <Button size="sm" variant="outline" onClick={() => retryJob.mutate(j)}>
                          Retry
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => deleteJob.mutate(j.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) setCreatedKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Register a Tally Bridge</DialogTitle>
            <DialogDescription>
              This generates an API key you paste into the desktop agent's <code>.env</code>. The key is shown only once.
            </DialogDescription>
          </DialogHeader>

          {!createdKey ? (
            <div className="space-y-3">
              <div>
                <Label>Bridge name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Office PC" />
              </div>
              <div>
                <Label>Tally HTTP URL</Label>
                <Input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="http://localhost:9000" />
                <p className="text-xs text-muted-foreground mt-1">
                  Usually <code>http://localhost:9000</code>. Change only if Tally listens on another port.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Label>API key (copy now — you won't see it again)</Label>
              <div className="flex gap-2">
                <Input readOnly value={createdKey} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(createdKey);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Paste this into <code>tally-bridge/.env</code> as <code>BRIDGE_KEY</code>, then run
                <code> npm install &amp;&amp; npm start</code> on the Tally machine.
              </div>
            </div>
          )}

          <DialogFooter>
            {!createdKey ? (
              <Button onClick={() => createBridge.mutate()} disabled={createBridge.isPending}>
                {createBridge.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Create bridge
              </Button>
            ) : (
              <Button onClick={() => { setCreateOpen(false); setCreatedKey(null); }}>Done</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
