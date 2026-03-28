import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck } from "lucide-react";

interface MismatchAlert {
  id: string;
  entity_id: string | null;
  metadata: {
    invoice_number?: string;
    invoice_amount?: number;
    po_amount?: number;
    difference_percent?: number;
    po_id?: string;
  };
  created_at: string;
}

export function ValidationAlerts() {
  const { data: alerts } = useQuery({
    queryKey: ["validation-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("*")
        .eq("activity_type", "amount_mismatch_alert")
        .eq("status", "warning")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as MismatchAlert[];
    },
  });

  if (!alerts || alerts.length === 0) {
    return (
      <Card className="border-green-200 bg-green-50/30">
        <CardContent className="p-4 flex items-center gap-3 text-green-700">
          <ShieldCheck className="h-5 w-5" />
          <span className="text-sm font-medium">No amount mismatch alerts</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-orange-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-orange-700">
          <AlertTriangle className="h-4 w-4" />
          PO–Invoice Amount Mismatches ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.map((alert) => {
          const meta = typeof alert.metadata === 'string' 
            ? JSON.parse(alert.metadata) 
            : alert.metadata;
          return (
            <div
              key={alert.id}
              className="flex items-center justify-between text-sm p-2 rounded bg-orange-50 border border-orange-100"
            >
              <span className="font-medium">
                Invoice #{meta?.invoice_number || "—"}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  ₹{meta?.invoice_amount?.toLocaleString()} vs ₹{meta?.po_amount?.toLocaleString()}
                </span>
                <Badge variant="outline" className="text-orange-600">
                  {meta?.difference_percent?.toFixed(1)}% off
                </Badge>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
