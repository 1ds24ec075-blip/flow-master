import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertTriangle, CreditCard, Banknote, Loader2, ShieldCheck,
} from "lucide-react";

interface OrderForReview {
  id: string;
  po_number: string | null;
  customer_name: string | null;
  total_amount: number | null;
  payment_terms: string | null;
  currency: string;
  [key: string]: any;
}

interface CustomerCredit {
  payment_terms: string | null;
  [key: string]: any;
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
  open, onOpenChange, order, customerCredit, onConfirm, isPending,
}: Props) {
  const [selectedType, setSelectedType] = useState<"ADVANCE" | "CREDIT">("ADVANCE");
  const [creditDays, setCreditDays] = useState(30);

  const handleOpen = (isOpen: boolean) => {
    if (isOpen && order) {
      setSelectedType("ADVANCE");
      setCreditDays(30);
    }
    onOpenChange(isOpen);
  };

  if (!order) return null;

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
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-semibold">Select Final Decision</Label>
            <RadioGroup
              value={selectedType}
              onValueChange={(v) => setSelectedType(v as "ADVANCE" | "CREDIT")}
              className="grid grid-cols-2 gap-3"
            >
              <label className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${selectedType === "ADVANCE" ? "border-green-500 bg-green-50" : "border-muted hover:border-green-300"}`}>
                <RadioGroupItem value="ADVANCE" />
                <div className="flex items-center gap-2">
                  <Banknote className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-semibold text-sm">Advance</p>
                    <p className="text-xs text-muted-foreground">Proforma Invoice</p>
                  </div>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-all ${selectedType === "CREDIT" ? "border-blue-500 bg-blue-50" : "border-muted hover:border-blue-300"}`}>
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
              <Input id="creditDays" type="number" min={1} max={365} value={creditDays} onChange={(e) => setCreditDays(parseInt(e.target.value) || 30)} className="w-32" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => onConfirm(selectedType, selectedType === "CREDIT" ? creditDays : undefined)}
            disabled={isPending}
            className={selectedType === "ADVANCE" ? "bg-green-600 hover:bg-green-700" : "bg-blue-600 hover:bg-blue-700"}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirm & Process
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
