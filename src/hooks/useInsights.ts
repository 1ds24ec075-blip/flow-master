import { useQuery } from "@tanstack/react-query";

interface Alert {
  id: string;
  type: 'overdue' | 'pending' | 'cash_flow' | 'unusual_spending' | 'recommendation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  actionUrl?: string;
  actionLabel?: string;
  entity?: string;
  amount?: number;
  dueDate?: string;
}

interface Insight {
  id: string;
  category: 'revenue' | 'expenses' | 'efficiency' | 'risk' | 'opportunity';
  title: string;
  summary: string;
  metric?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  priority: 'low' | 'medium' | 'high';
}

interface Summary {
  totalRevenue: number;
  thisMonthRevenue: number;
  revenueGrowth: number;
  pendingAmount: number;
  outstandingBills: number;
  pendingApprovals: number;
  activeClients: number;
  activeSuppliers: number;
  quotationConversion: number;
  activePOs: number;
}

interface InsightsResponse {
  success: boolean;
  alerts: Alert[];
  insights: Insight[];
  summary: Summary;
  generatedAt: string;
}

export function useInsights() {
  return useQuery<InsightsResponse>({
    queryKey: ["business-insights"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<InsightsResponse>(
        "generate-insights",
        { body: { type: "dashboard" } }
      );

      if (error) throw error;
      if (!data) throw new Error("Failed to fetch insights");

      return data;
    },
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    refetchInterval: 10 * 60 * 1000, // Refetch every 10 minutes
  });
}
