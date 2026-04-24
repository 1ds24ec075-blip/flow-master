import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, TrendingDown, Activity, RefreshCw, AlertTriangle, CheckCircle2, Bot } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export function MorningBriefCard() {
  const qc = useQueryClient();
  const { data: brief, isLoading } = useQuery({
    queryKey: ["morning-brief"],
    queryFn: async () => {
      const { data } = await supabase.from("morning_briefs").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("morning-brief");
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["morning-brief"] }); qc.invalidateQueries({ queryKey: ["agent-feed"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  // Auto-generate if today's brief is missing
  useEffect(() => {
    if (isLoading || generate.isPending) return;
    const today = new Date().toISOString().split("T")[0];
    if (!brief || brief.brief_date !== today) {
      generate.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, brief?.brief_date]);

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-5 w-5 text-primary" /> Daily Morning Brief
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${generate.isPending ? "animate-spin" : ""}`} /> Generate
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? <Skeleton className="h-24 w-full" /> : !brief ? (
          <p className="text-sm text-muted-foreground">No brief yet. Click Generate to get your AI morning summary.</p>
        ) : (
          <>
            <div>
              <h3 className="font-semibold text-lg leading-tight">{brief.headline}</h3>
              <p className="text-sm text-muted-foreground mt-1">{brief.summary}</p>
            </div>
            {Array.isArray(brief.highlights) && brief.highlights.length > 0 && (
              <div className="space-y-1">
                {(brief.highlights as string[]).map((h, i) => (
                  <div key={i} className="text-sm flex gap-2"><span className="text-primary">▸</span>{h}</div>
                ))}
              </div>
            )}
            {Array.isArray(brief.alerts) && brief.alerts.length > 0 && (
              <div className="space-y-1 pt-2 border-t">
                {(brief.alerts as any[]).map((a, i) => (
                  <div key={i} className="text-sm flex items-start gap-2">
                    <AlertTriangle className={`h-4 w-4 mt-0.5 ${a.severity === "high" ? "text-destructive" : "text-amber-500"}`} />
                    <span>{a.text}</span>
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(brief.recommendations) && brief.recommendations.length > 0 && (
              <div className="bg-muted/50 rounded-md p-2 space-y-1">
                <p className="text-xs font-semibold uppercase text-muted-foreground">AI Recommendations</p>
                {(brief.recommendations as string[]).map((r, i) => (
                  <div key={i} className="text-sm flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 mt-1 text-green-600 flex-shrink-0" />{r}</div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Generated {formatDistanceToNow(new Date(brief.created_at), { addSuffix: true })}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function CashCrisisCard() {
  const qc = useQueryClient();
  const { data: forecast, isLoading } = useQuery({
    queryKey: ["cash-forecast"],
    queryFn: async () => {
      const { data } = await supabase.from("cash_forecasts").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data;
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("cash-crisis-predictor");
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Cash forecast updated"); qc.invalidateQueries({ queryKey: ["cash-forecast"] }); qc.invalidateQueries({ queryKey: ["agent-feed"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
  const isCrisis = forecast?.crisis_severity === "critical" || forecast?.crisis_severity === "high";

  return (
    <Card className={isCrisis ? "border-destructive/40 bg-destructive/5" : "border-border"}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingDown className={`h-5 w-5 ${isCrisis ? "text-destructive" : "text-primary"}`} /> Cash Crisis Predictor (30d)
        </CardTitle>
        <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${run.isPending ? "animate-spin" : ""}`} /> Forecast
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? <Skeleton className="h-24 w-full" /> : !forecast ? (
          <p className="text-sm text-muted-foreground">Run forecast to predict cash position over the next 30 days.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-muted/50 rounded p-2">
                <p className="text-xs text-muted-foreground">Opening</p>
                <p className="font-bold text-sm">{inr(Number(forecast.opening_balance))}</p>
              </div>
              <div className="bg-green-500/10 rounded p-2">
                <p className="text-xs text-muted-foreground">Inflows</p>
                <p className="font-bold text-sm text-green-600">{inr(Number(forecast.total_inflows))}</p>
              </div>
              <div className="bg-red-500/10 rounded p-2">
                <p className="text-xs text-muted-foreground">Outflows</p>
                <p className="font-bold text-sm text-red-600">{inr(Number(forecast.total_outflows))}</p>
              </div>
            </div>
            <div className={`rounded-md p-3 ${isCrisis ? "bg-destructive/10" : "bg-primary/5"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold uppercase">Min Projected Balance</span>
                <Badge variant={isCrisis ? "destructive" : "secondary"}>{forecast.crisis_severity}</Badge>
              </div>
              <p className={`text-xl font-bold ${Number(forecast.projected_min_balance) < 0 ? "text-destructive" : ""}`}>
                {inr(Number(forecast.projected_min_balance))}
              </p>
              {forecast.crisis_day && (
                <p className="text-xs text-destructive mt-1">⚠️ Crisis predicted on {new Date(forecast.crisis_day).toLocaleDateString("en-IN")}</p>
              )}
            </div>
            {forecast.ai_recommendation && (
              <div className="bg-muted/50 rounded-md p-2">
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">CFO Agent Says</p>
                <p className="text-sm">{forecast.ai_recommendation}</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function LiveAgentFeed() {
  const qc = useQueryClient();
  const [pulse, setPulse] = useState(false);

  const { data: feed = [] } = useQuery({
    queryKey: ["agent-feed"],
    queryFn: async () => {
      const { data } = await supabase.from("agent_activity_feed").select("*").order("created_at", { ascending: false }).limit(30);
      return data || [];
    },
  });

  useEffect(() => {
    const ch = supabase.channel("agent-feed-rt")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_activity_feed" }, () => {
        setPulse(true);
        setTimeout(() => setPulse(false), 1500);
        qc.invalidateQueries({ queryKey: ["agent-feed"] });
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const sevColor = (s: string) => s === "critical" ? "text-destructive" : s === "warning" ? "text-amber-500" : "text-primary";

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className={`h-5 w-5 ${pulse ? "text-green-500 animate-pulse" : "text-primary"}`} />
          Live Agent Feed
          <span className="ml-auto flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${pulse ? "bg-green-500" : "bg-green-500/60"} animate-pulse`} />
            LIVE
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[420px] pr-3">
          {feed.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No agent activity yet. Trigger a brief or forecast to see live updates.</p>
          ) : (
            <div className="space-y-3">
              {feed.map((a: any) => (
                <div key={a.id} className="flex gap-3 pb-3 border-b border-border/50 last:border-0">
                  <Bot className={`h-4 w-4 mt-1 flex-shrink-0 ${sevColor(a.severity)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">{a.agent_name}</span>
                      <span className="text-[10px] text-muted-foreground flex-shrink-0">{formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                    </div>
                    <p className="text-sm break-words">{a.summary}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
