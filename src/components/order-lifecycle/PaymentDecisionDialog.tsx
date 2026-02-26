import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { RiskBadge } from "./OrderStatusBadge";
import {
  AlertTriangle,
  CreditCard,
  Banknote,
  Loader2,
  ShieldCheck,
} from "lucide-react";

interface OrderForReview {
  id: string;
  po_number: string | null;
  customer_name: string | null;
  total_amount: number | null;
  payment_terms: string | null;
  suggested_payment_type: string | null;
  suggestion_reason: string | null;
  risk_flag: string | null;
  currency: string;
}

interface CustomerCredit {
  outstanding_amount: number;
  credit_limit: number;
  has_overdue_invoices: boolean;
  default_credit_days: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: OrderForReview | null;
  customerCredit: CustomerCredit | null;
  onConfirm: (paymentType: "ADVANCE" | "CREDIT", creditDays?: number) => void;
  isPending: boolean;
}

export function PaymentDecisionDialog({
  open,
  onOpenChange,
  order,
  customerCredit,
  onConfirm,
  isPending,
}: Props) {
  const [selectedType, setSelectedType] = useState<"ADVANCE" | "CREDIT">(
    (order?.suggested_payment_type as "ADVANCE" | "CREDIT") || "ADVANCE"
  );
  const [creditDays, setCreditDays] = useState(
    customerCredit?.default_credit_days || 30
  );

  const handleOpen = (isOpen: boolean) => {
    if (isOpen && order) {
      setSelectedType((order.suggested_payment_type as "ADVANCE" | "CREDIT") || "ADVANCE");
      setCreditDays(customerCredit?.default_credit_days || 30);
    }
    onOpenChange(isOpen);
  };

  if (!order) return null;

  const hasRisk = order.risk_flag && order.risk_flag !== "NONE";
  const orderValue = order.total_amount || 0;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            Payment Decision - {order.po_number}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Customer</p>
              <p className="font-semibold">{order.customer_name || "-"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Order Value</p>
              <p className="font-semibold text-lg">
                {order.currency} {orderValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">PO Payment Terms</p>
              <p className="font-medium">{order.payment_terms || "Not specified"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">System Suggestion</p>
              <div className="flex items-center gap-2">
                <Badge className={
                  order.suggested_payment_type === "CREDIT"
                    ? "bg-blue-100 text-blue-800 hover:bg-blue-100"
                    : "bg-green-100 text-green-800 hover:bg-green-100"
                }>
                  {order.suggested_payment_type || "ADVANCE"}
                </Badge>
                <RiskBadge riskFlag={order.risk_flag} />
              </div>
            </div>
          </div>

          {order.suggestion_reason && (
            <div className="bg-slate-50 border rounded-lg p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">Suggestion Reason</p>
              {order.suggestion_reason}
            </div>
          )}

          {customerCredit && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 border rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Outstanding</p>
                <p className="text-sm font-bold mt-1">
                  {order.currency} {customerCredit.outstanding_amount.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="bg-slate-50 border rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Credit Limit</p>
                <p className="text-sm font-bold mt-1">
                  {order.currency} {customerCredit.credit_limit.toLocaleString("en-IN")}
                </p>
              </div>
              <div className="bg-slate-50 border rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Overdue</p>
                <p className={`text-sm font-bold mt-1 ${customerCredit.has_overdue_invoices ? "text-red-600" : "text-green-600"}`}>
                  {customerCredit.has_overdue_invoices ? "Yes" : "No"}
                </p>
              </div>
            </div>
          )}

          {hasRisk && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">
                Review required. Credit risk detected. Manual confirmation is mandatory before proceeding.
              </p>
            </div>
          )}

          <div className="space-y-3">
            <Label className="text-sm font-semibold">Select Final Decision</Label>
            <RadioGroup
              value={selectedType}
              onValueChange={(v) => setSelectedType(v as "ADVANCE" | "CREDIT")}
              className="grid grid-cols-2 gap-3"
            >
              <label
                className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                  selectedType === "ADVANCE"
                    ? "border-green-500 bg-green-50"
                    : "border-muted hover:border-green-300"
                }`}
              >
                <RadioGroupItem value="ADVANCE" />
                <div className="flex items-center gap-2">
                  <Banknote className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-semibold text-sm">Advance</p>
                    <p className="text-xs text-muted-foreground">Proforma Invoice</p>
                  </div>
                </div>
              </label>
              <label
                className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${
                  selectedType === "CREDIT"
                    ? "border-blue-500 bg-blue-50"
                    : "border-muted hover:border-blue-300"
                }`}
              >
                <RadioGroupItem value="CREDIT" />
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="font-semibold text-sm">Credit</p>
                    <p className="text-xs text-muted-foreground">SO + AR Entry</p>
                  </div>
                </div>
              </label>
            </RadioGroup>
          </div>

          {selectedType === "CREDIT" && (
            <div className="space-y-2">
              <Label htmlFor="creditDays">Credit Days</Label>
              <Input
                id="creditDays"
                type="number"
                min={1}
                max={365}
                value={creditDays}
                onChange={(e) => setCreditDays(parseInt(e.target.value) || 30)}
                className="w-32"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(selectedType, selectedType === "CREDIT" ? creditDays : undefined)}
            disabled={isPending}
            className={selectedType === "ADVANCE" ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Confirm & Process
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
