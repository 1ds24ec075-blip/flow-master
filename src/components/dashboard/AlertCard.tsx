import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, DollarSign, TrendingUp, Lightbulb, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

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

interface AlertCardProps {
  alert: Alert;
  onDismiss?: (id: string) => void;
}

const typeIcons = {
  overdue: Clock,
  pending: AlertTriangle,
  cash_flow: DollarSign,
  unusual_spending: TrendingUp,
  recommendation: Lightbulb,
};

const severityStyles = {
  low: 'border-muted bg-muted/20',
  medium: 'border-warning/50 bg-warning/10',
  high: 'border-destructive/50 bg-destructive/10',
  critical: 'border-destructive bg-destructive/20 animate-pulse',
};

const severityBadge = {
  low: 'secondary',
  medium: 'outline',
  high: 'destructive',
  critical: 'destructive',
} as const;

export function AlertCard({ alert, onDismiss }: AlertCardProps) {
  const navigate = useNavigate();
  const Icon = typeIcons[alert.type] || AlertTriangle;

  const handleAction = () => {
    if (alert.actionUrl) {
      navigate(alert.actionUrl);
    }
  };

  return (
    <Card className={cn("transition-all hover:shadow-md", severityStyles[alert.severity])}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            "flex-shrink-0 p-2 rounded-full",
            alert.severity === 'high' || alert.severity === 'critical' 
              ? 'bg-destructive/20 text-destructive' 
              : alert.severity === 'medium' 
                ? 'bg-warning/20 text-warning' 
                : 'bg-muted text-muted-foreground'
          )}>
            <Icon className="h-4 w-4" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-sm truncate">{alert.title}</h4>
              <Badge variant={severityBadge[alert.severity]} className="text-xs flex-shrink-0">
                {alert.severity}
              </Badge>
            </div>
            
            <p className="text-sm text-muted-foreground mb-3">
              {alert.description}
            </p>

            {alert.actionUrl && alert.actionLabel && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleAction}
                className="gap-1"
              >
                {alert.actionLabel}
                <ArrowRight className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
