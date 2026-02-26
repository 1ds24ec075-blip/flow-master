import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Search,
  CreditCard,
  FileCheck,
  Truck,
  FileText,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  PO_RECEIVED: { label: "PO Received", className: "bg-slate-100 text-slate-700", icon: Clock },
  pending: { label: "PO Received", className: "bg-slate-100 text-slate-700", icon: Clock },
  UNDER_REVIEW: { label: "Under Review", className: "bg-amber-100 text-amber-800", icon: Search },
  AWAITING_PAYMENT: { label: "Awaiting Payment", className: "bg-orange-100 text-orange-800", icon: CreditCard },
  SO_CREATED: { label: "SO Created", className: "bg-blue-100 text-blue-800", icon: FileCheck },
  DISPATCHED: { label: "Dispatched", className: "bg-cyan-100 text-cyan-800", icon: Truck },
  INVOICED: { label: "Invoiced", className: "bg-teal-100 text-teal-800", icon: FileText },
  PAYMENT_PENDING: { label: "Payment Pending", className: "bg-yellow-100 text-yellow-800", icon: AlertTriangle },
  PAYMENT_COMPLETED: { label: "Payment Complete", className: "bg-green-100 text-green-800", icon: CheckCircle2 },
  OVERDUE: { label: "Overdue", className: "bg-red-100 text-red-800", icon: XCircle },
  converted: { label: "Converted", className: "bg-green-100 text-green-800", icon: CheckCircle2 },
  price_mismatch: { label: "Price Mismatch", className: "bg-orange-100 text-orange-800", icon: AlertTriangle },
  delivery_date_issue: { label: "Delivery Issue", className: "bg-red-100 text-red-800", icon: AlertTriangle },
  duplicate: { label: "Duplicate", className: "bg-red-100 text-red-800", icon: XCircle },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || {
    label: status,
    className: "bg-gray-100 text-gray-700",
    icon: Clock,
  };
  const Icon = config.icon;

  return (
    <Badge className={`${config.className} hover:${config.className} gap-1 font-medium`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

export function RiskBadge({ riskFlag }: { riskFlag: string | null }) {
  if (!riskFlag || riskFlag === "NONE") return null;

  const labels: Record<string, string> = {
    CREDIT_LIMIT_EXCEEDED: "Credit Limit Exceeded",
    OVERDUE_INVOICES: "Overdue Invoices",
    CREDIT_LIMIT_EXCEEDED_AND_OVERDUE: "Credit Limit + Overdue",
  };

  return (
    <Badge className="bg-red-100 text-red-700 hover:bg-red-100 gap-1 font-medium">
      <AlertTriangle className="h-3 w-3" />
      {labels[riskFlag] || riskFlag}
    </Badge>
  );
}
