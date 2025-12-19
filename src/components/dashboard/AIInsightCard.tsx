import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Lightbulb, DollarSign, BarChart3, AlertTriangle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface AIInsightCardProps {
  insight: Insight;
}

const categoryIcons = {
  revenue: DollarSign,
  expenses: BarChart3,
  efficiency: BarChart3,
  risk: AlertTriangle,
  opportunity: Lightbulb,
};

const categoryColors = {
  revenue: 'text-success',
  expenses: 'text-warning',
  efficiency: 'text-primary',
  risk: 'text-destructive',
  opportunity: 'text-secondary',
};

const priorityStyles = {
  low: 'border-border',
  medium: 'border-primary/30',
  high: 'border-warning/50 bg-warning/5',
};

export function AIInsightCard({ insight }: AIInsightCardProps) {
  const Icon = categoryIcons[insight.category] || Lightbulb;
  const isAIRecommendation = insight.id.startsWith('ai-rec');
  
  const TrendIcon = insight.trend === 'up' 
    ? TrendingUp 
    : insight.trend === 'down' 
      ? TrendingDown 
      : Minus;

  const trendColor = insight.trend === 'up' 
    ? 'text-success' 
    : insight.trend === 'down' 
      ? 'text-destructive' 
      : 'text-muted-foreground';

  return (
    <Card className={cn("transition-all hover:shadow-md", priorityStyles[insight.priority])}>
      <CardHeader className="flex flex-row items-start justify-between pb-2 space-y-0">
        <div className="flex items-center gap-2">
          {isAIRecommendation ? (
            <Sparkles className="h-4 w-4 text-secondary" />
          ) : (
            <Icon className={cn("h-4 w-4", categoryColors[insight.category])} />
          )}
          <CardTitle className="text-sm font-medium">
            {insight.title}
          </CardTitle>
        </div>
        <Badge 
          variant={insight.priority === 'high' ? 'destructive' : 'secondary'} 
          className="text-xs"
        >
          {insight.category}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {insight.metric && (
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold">{insight.metric}</span>
            {insight.trend && insight.trendValue && (
              <div className={cn("flex items-center gap-1 text-sm", trendColor)}>
                <TrendIcon className="h-4 w-4" />
                <span>{insight.trendValue}</span>
              </div>
            )}
          </div>
        )}
        <p className="text-sm text-muted-foreground">{insight.summary}</p>
      </CardContent>
    </Card>
  );
}
